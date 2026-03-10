import type { Page, Response } from 'playwright';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type { Entity, DiscoveredBy } from '../types/index.js';
import type { CrawlConfig } from '../types/index.js';
import { InstagramClient } from '../instagramClient/index.js';
import { buildNormalizedPost } from '../utils/slimPost.js';
import { delayMs, delayMsFast, humanDelay, humanDelayFast } from '../utils/delay.js';
import { logTimestamp } from '../utils/logTimestamp.js';
import { record429 } from '../utils/rateLimit429.js';
import { getFollowersFromEntity } from '../utils/entityAccess.js';

const RESPONSE_LOG_DIR = process.env.RESPONSE_LOG_DIR ?? './data/response-log';

/**
 * Aplica multiplicador de milhar (mil/k = *1000, milhão/m = *1e6).
 */
function applyFollowersMultiplier(num: number, rest: string): number {
  const lower = rest.toLowerCase();
  if (lower.includes('milh') || lower.includes('m ') || /^[\d.,\s]*m\s/i.test(rest)) return Math.round(num * 1000000);
  if (lower.includes('mil') || lower.includes('k') || lower.includes(' k')) return Math.round(num * 1000);
  return Math.round(num);
}

/** Extrai número de seguidores do texto da página (para filtro na descoberta). */
function parseFollowersFromText(fullText: string): number | null {
  const lines = fullText.split(/\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/(\d[\d.,\s]*)\s*(?:mil|k|m|milhão|milhões)?\s*seguidores/i)
      ?? line.match(/(\d[\d.,\s]*)\s*(?:mil|k|m)?\s*followers?/i);
    if (match) {
      const numStr = match[1].replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
      const n = parseFloat(numStr);
      if (!isNaN(n)) return applyFollowersMultiplier(n, match[0] || '');
      return null;
    }
  }
  const followersMatch = fullText.match(/(\d[\d.,\s]*)\s*(?:mil|k|m|milhão|milhões)?\s*seguidores/i)
    ?? fullText.match(/(\d[\d.,\s]*)\s*(?:mil|k|m)?\s*followers?/i);
  if (followersMatch) {
    const numStr = followersMatch[1].replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
    const n = parseFloat(numStr);
    if (isNaN(n)) return null;
    return applyFollowersMultiplier(n, followersMatch[0] || '');
  }
  return null;
}

function parseTitleToFollowersCount(t: string): number | null {
  const numStr = t.trim().replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const num = parseFloat(numStr);
  return !Number.isNaN(num) && num > 0 ? Math.round(num) : null;
}

/** Parseia número com ponto ou vírgula como separador de milhar (ex: 1.876 → 1876, 1.216 → 1216). */
function parseCountWithThousandsSeparator(text: string): number | null {
  const numStr = text.replace(/\s/g, '').replace(/\./g, '').replace(',', '');
  const n = parseInt(numStr, 10);
  return Number.isNaN(n) || n < 0 ? null : n;
}

async function getFollowersFromTitleAttribute(page: Page): Promise<number | null> {
  let value: number | null = await page.evaluate(() => {
    const link = document.querySelector('a[href*="/followers/"]');
    if (!link) return null;
    const span = link.querySelector('span[title]');
    if (!span || !(span as HTMLElement).title) return null;
    const t = (span as HTMLElement).title.trim().replace(/\s/g, '');
    if (!t) return null;
    const numStr = t.replace(/\./g, '').replace(',', '.');
    const num = parseFloat(numStr);
    return !Number.isNaN(num) && num > 0 ? num : null;
  }).catch(() => null);
  if (value == null) {
    const titleAttr = await page.locator('a[href*="/followers/"] span[title]').first().getAttribute('title').catch(() => null);
    if (titleAttr) value = parseTitleToFollowersCount(titleAttr);
  }
  return value;
}

const GET_FOLLOWERS_TIMEOUT_MS = 28_000;

/** URL patterns para capturar resposta de perfil (GraphQL). */
const PROFILE_RESPONSE_URL = /graphql\/query/i;

export interface GetFollowersOptions {
  /** Se definido, chama em vez de page.goto(profileUrl) (ex.: clique no autor para abrir perfil). */
  doNavigate?: () => Promise<void>;
  /** Se true, a página já está no perfil; não navega, só lê. Use após abrir perfil por clique. */
  skipGoto?: boolean;
}

async function readFollowersFromCurrentPage(page: Page): Promise<number | null> {
  await humanDelay();
  await page.waitForTimeout(delayMs(1000));
  const main = page.locator('main').first();
  await main.waitFor({ state: 'visible', timeout: 8000 }).catch(() => null);
  if ((await main.count()) === 0) return null;
  await page.locator('a[href*="/followers/"]').first().waitFor({ state: 'visible', timeout: 6000 }).catch(() => null);
  let followers: number | null = await getFollowersFromTitleAttribute(page);
  if (followers == null) {
    const textContent = await main.allTextContents().then((arr) => arr.join('\n'));
    followers = parseFollowersFromText(textContent.replace(/\s+/g, ' '));
  }
  if (followers == null) {
    const followersText = await page.locator('header, main').filter({ hasText: /seguidores|followers/i }).first().textContent().catch(() => null);
    if (followersText) followers = parseFollowersFromText(followersText);
  }
  return followers;
}

/**
 * Retorna apenas o número de seguidores (para qualificar na descoberta).
 * Usa a mesma interceptação da API que getFollowersAndMinimalProfile; fallback em DOM só se nenhum body for capturado.
 */
export async function getFollowersFromProfile(page: Page, profileUrl: string, options?: GetFollowersOptions): Promise<number | null> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('getFollowersFromProfile timeout')), GET_FOLLOWERS_TIMEOUT_MS)
  );
  try {
    const result = await Promise.race([
      getFollowersAndMinimalProfile(page, profileUrl, options).then((r) => r.followers),
      timeoutPromise,
    ]);
    return result;
  } catch {
    return null;
  }
}

/**
 * Retorna seguidores e o primeiro body de API com data.user (Polaris) capturado na página.
 * Usado na descoberta para rodar qualifiesAsInfluencer antes da extração completa.
 * Com doNavigate: executa a função (ex.: clique no autor) em vez de page.goto(profileUrl); o listener é anexado antes.
 */
export async function getFollowersAndMinimalProfile(
  page: Page,
  profileUrl: string,
  options?: GetFollowersOptions
): Promise<{ followers: number | null; minimalProfile: Record<string, unknown> | null }> {
  let capturedBody: Record<string, unknown> | null = null;
  const onResponse = async (response: import('playwright').Response) => {
    if (capturedBody != null) return;
    const url = response.url();
    if (!PROFILE_RESPONSE_URL.test(url) || response.status() >= 400) return;
    const contentType = response.headers()['content-type'] ?? '';
    if (!contentType.includes('application/json')) return;
    try {
      const body = await response.json();
      if (body != null && typeof body === 'object' && hasDataUser(body as Record<string, unknown>)) {
        capturedBody = body as Record<string, unknown>;
      }
    } catch {
      // ignore
    }
  };
  page.on('response', onResponse);
  try {
    if (options?.skipGoto) {
      await page.waitForTimeout(800);
      const followers = capturedBody != null ? getFollowersFromEntity(capturedBody) : await readFollowersFromCurrentPage(page);
      return { followers: followers != null && followers > 0 ? followers : null, minimalProfile: capturedBody };
    }
    if (options?.doNavigate) {
      await options.doNavigate();
    } else {
      await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    }
    await page.waitForTimeout(2500);
    const fromApi = capturedBody != null ? getFollowersFromEntity(capturedBody) : 0;
    const followers = fromApi > 0 ? fromApi : await readFollowersFromCurrentPage(page);
    return { followers: followers != null && followers > 0 ? followers : null, minimalProfile: capturedBody };
  } finally {
    page.off('response', onResponse);
  }
}

/** Verifica se o body tem data.user (perfil). */
function hasDataUser(b: Record<string, unknown>): boolean {
  return b?.data != null && typeof b.data === 'object' && (b.data as Record<string, unknown>)?.user != null;
}

/** Verifica se o body tem data.user com métricas completas (Polaris). */
function hasDataUserWithMetrics(b: Record<string, unknown>): boolean {
  if (!hasDataUser(b)) return false;
  const user = (b.data as Record<string, unknown>).user as Record<string, unknown>;
  return user?.media_count != null || user?.following_count != null;
}

/** Retorna data.user.username do body (perfil da resposta). Usado para garantir que usamos o perfil visitado, não o viewer. */
function getDataUserUsername(b: Record<string, unknown>): string | undefined {
  const user = (b?.data as Record<string, unknown>)?.['user'];
  if (user == null || typeof user !== 'object') return undefined;
  const u = user as Record<string, unknown>;
  const v = u.username;
  return v != null ? String(v).trim() : undefined;
}

/** Merge profundo de objetos (para juntar timeline + respostas de perfil em uma só). */
function deepMergeResponses(responses: unknown[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const r of responses) {
    if (r == null || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    for (const key of Object.keys(o)) {
      const existing = result[key];
      const next = o[key];
      if (next != null && typeof next === 'object' && !Array.isArray(next) && existing != null && typeof existing === 'object' && !Array.isArray(existing)) {
        result[key] = deepMergeResponses([existing, next]);
      } else if (next !== undefined) {
        result[key] = next;
      }
    }
  }
  return result;
}

/** URLs que podem conter dados de perfil (response completo). */
const RESPONSE_URL_PATTERNS = [
  /graphql\/query/i,
  /api\/v1\/users\/.*\/info/i,
  /web\/profile\/web_profile_info/i,
];

const MAX_CAPTURED_RESPONSES = 20;
const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2MB

/**
 * ARQUITETURA DE EXTRAÇÃO — SEMPRE VIA INTERCEPTAÇÃO DA API
 * --------------------------------------------------------------------------
 * Toda extração de dados (perfil, posts, reels, marcados, destaques, métricas)
 * é feita exclusivamente a partir das respostas HTTP/GraphQL capturadas em
 * page.on('response'). O DOM/HTML é usado APENAS para:
 * - Navegação (goto, clique em abas) para disparar as requisições;
 * - Clicar em um destaque para disparar a requisição de reel media (itens/data).
 * Nada é lido do DOM para listas, métricas ou metadados — tudo vem dos bodies
 * em `captured` e do parser parseHighlightMediaFromResponse quando abrimos
 * um destaque. Centralize aqui qualquer novo parser de resposta.
 */

/** Caminhos conhecidos para edges de timeline (user ou feed). */
const TIMELINE_EDGES_PATHS = [
  'data.xdt_api__v1__feed__user_timeline_graphql_connection.edges',
  'data.xdt_api__v1__feed__timeline__connection.edges',
  'data.feed_user_timeline.edges',
];

/** Caminhos para edges de reels (aba Reels do perfil). */
const REELS_EDGES_PATHS = [
  'data.xdt_api__v1__feed__reels_media_graphql_connection.edges',
  'data.reels_media.edges',
  'data.user.edge_felix_video_timeline.edges',
];

/** Caminhos para edges de marcados (aba Tagged do perfil). Inclui usertags (API real da aba Marcados). */
const TAGGED_EDGES_PATHS = [
  'data.xdt_api__v1__usertags__user_id__feed_connection.edges',
  'data.xdt_api__v1__usertags__user_id__feed_connection.media',
  'data.xdt_api__v1__feed__user_tagged_posts_connection.edges',
  'data.user.edge_web_feed_timeline.edges',
  'data.user.edge_owner_to_tagged_media.edges',
];

/** Caminhos para highlights (círculos de destaques acima do feed; às vezes vêm no mesmo response do perfil). */
const HIGHLIGHTS_EDGES_PATHS = [
  'data.user.edge_highlight_reels.edges',
  'data.xdt_api__v1__feed__reels_media_graphql_connection.edges',
  'data.user.edge_felix_combined_draft_media.edges',
  'graphql.user.edge_highlight_reels.edges',
];

/**
 * Procura em obj um array de itens de mídia (com taken_at_timestamp ou timestamp)
 * ou um objeto com media_count. Retorna { itemCount, dateIso, weeksAgo } ou null.
 */
function parseHighlightMediaFromResponse(obj: unknown): { itemCount: number; dateIso: string | null; weeksAgo: number | null } | null {
  if (obj == null || typeof obj !== 'object') return null;
  const seen = new Set<unknown>();

  function findReelMediaArray(current: unknown): number[] | null {
    if (current == null || seen.has(current)) return null;
    if (typeof current !== 'object') return null;
    seen.add(current);
    if (Array.isArray(current)) {
      if (current.length < 1 || current.length > 100) return null;
      const first = current[0];
      if (first != null && typeof first === 'object') {
        const node = (first as Record<string, unknown>).node ?? first;
        const rec = node as Record<string, unknown>;
        const ts = rec.taken_at_timestamp ?? rec.timestamp;
        if (typeof ts === 'number' && ts > 0) {
          const count = current.length;
          const timestamps = current
            .map((item) => {
              const n = (item as Record<string, unknown>)?.node ?? item;
              const t = (n as Record<string, unknown>)?.taken_at_timestamp ?? (n as Record<string, unknown>)?.timestamp;
              return typeof t === 'number' ? t : 0;
            })
            .filter((t) => t > 0);
          if (timestamps.length === count) return [count, Math.min(...timestamps), Math.max(...timestamps)];
        }
      }
      return null;
    }
    for (const v of Object.values(current as Record<string, unknown>)) {
      const found = findReelMediaArray(v);
      if (found) return found;
    }
    return null;
  }

  function findMediaCount(current: unknown): { count: number; maxTs?: number } | null {
    if (current == null || typeof current !== 'object') return null;
    if (Array.isArray(current)) return null;
    const o = current as Record<string, unknown>;
    const count = o.media_count ?? o.item_count;
    if (typeof count === 'number' && count >= 1 && count <= 100) {
      const maxTs = o.latest_reel_media ?? o.timestamp;
      const maxTsNum = typeof maxTs === 'number' && maxTs > 0 ? maxTs : undefined;
      return { count, maxTs: maxTsNum };
    }
    for (const v of Object.values(o)) {
      const found = findMediaCount(v);
      if (found) return found;
    }
    return null;
  }

  let itemCount = 0;
  let minTs = 0;
  let maxTs = 0;
  const fromArray = findReelMediaArray(obj);
  if (fromArray && fromArray[0] > 0) {
    [itemCount, minTs, maxTs] = fromArray;
  } else {
    const fromCount = findMediaCount(obj);
    if (fromCount && fromCount.count > 0) {
      itemCount = fromCount.count;
      if (fromCount.maxTs) maxTs = fromCount.maxTs;
    }
  }
  if (itemCount === 0) return null;
  let dateIso: string | null = null;
  if (minTs > 0) {
    const d = new Date(minTs * 1000);
    if (!Number.isNaN(d.getTime())) dateIso = d.toISOString().slice(0, 10);
  }
  let weeksAgo: number | null = null;
  if (maxTs > 0) {
    const now = Math.floor(Date.now() / 1000);
    const diff = now - maxTs;
    const weeks = Math.floor(diff / (7 * 24 * 3600));
    if (weeks >= 0 && weeks <= 5000) weeksAgo = weeks;
  }
  return { itemCount, dateIso, weeksAgo };
}

function getIn(obj: unknown, path: string): unknown {
  if (obj == null || typeof obj !== 'object') return undefined;
  const parts = path.split('.');
  let current: unknown = obj;
  for (const p of parts) {
    if (current == null || typeof current !== 'object') break;
    current = (current as Record<string, unknown>)[p];
  }
  return current;
}

function getEdgesFromRaw(raw: unknown, paths: string[] = TIMELINE_EDGES_PATHS): unknown[] {
  if (raw == null || typeof raw !== 'object') return [];
  for (const path of paths) {
    const current = getIn(raw, path);
    if (Array.isArray(current)) return current;
  }
  return [];
}

function getEdgesFromRawTimeline(raw: unknown): unknown[] {
  return getEdgesFromRaw(raw, TIMELINE_EDGES_PATHS);
}

/** Verifica se um array parece ser edges de mídia (objetos com node.shortcode ou node.code). */
function isMediaEdgesArray(arr: unknown): arr is unknown[] {
  if (!Array.isArray(arr) || arr.length === 0) return false;
  const first = arr[0];
  if (first == null || typeof first !== 'object') return false;
  const node = (first as Record<string, unknown>).node;
  if (node == null || typeof node !== 'object') return false;
  const n = node as Record<string, unknown>;
  return (n.shortcode != null || n.code != null);
}

/**
 * Busca recursiva por todas as estruturas edges cujo caminho (chave) contém o hint (ex: "tagged", "highlight").
 * A API do Instagram pode usar nomes variados; isso captura mesmo que o path mude.
 */
function findAllEdgesByKeyHint(obj: unknown, hint: string, seen = new Set<unknown>()): unknown[][] {
  if (obj == null || seen.has(obj)) return [];
  if (typeof obj !== 'object') return [];
  seen.add(obj);
  const o = obj as Record<string, unknown>;
  const hintLower = hint.toLowerCase();
  const out: unknown[][] = [];
  for (const [key, value] of Object.entries(o)) {
    const keyLower = key.toLowerCase();
    if (keyLower.includes(hintLower) && Array.isArray(value) && isMediaEdgesArray(value)) {
      out.push(value);
    }
    out.push(...findAllEdgesByKeyHint(value, hint, seen));
  }
  return out;
}

/** Edge de destaque: node tem id (string), não obrigatoriamente shortcode. */
function isHighlightEdgeNode(node: unknown): node is Record<string, unknown> {
  if (node == null || typeof node !== 'object') return false;
  const n = node as Record<string, unknown>;
  const id = n.id ?? n.pk;
  return typeof id === 'string' && id.length > 0;
}

/** Retorna edges cujo node tem id (destaques da API: edge_highlight_reels). */
function getHighlightEdgesFromRaw(raw: unknown): unknown[] {
  const fromPaths = getEdgesFromRaw(raw, HIGHLIGHTS_EDGES_PATHS);
  if (fromPaths.length > 0) {
    const first = fromPaths[0];
    if (first != null && typeof first === 'object' && isHighlightEdgeNode((first as Record<string, unknown>).node)) {
      return fromPaths;
    }
  }
  const seen = new Set<unknown>();
  function find(obj: unknown): unknown[] {
    if (obj == null || seen.has(obj)) return [];
    if (typeof obj !== 'object') return [];
    seen.add(obj);
    const o = obj as Record<string, unknown>;
    for (const value of Object.values(o)) {
      if (!Array.isArray(value) || value.length === 0) continue;
      const first = value[0];
      if (first != null && typeof first === 'object') {
        const node = (first as Record<string, unknown>).node;
        if (isHighlightEdgeNode(node)) return value;
      }
      const nested = find(value);
      if (nested.length > 0) return nested;
    }
    return [];
  }
  return find(raw);
}

/** Extrai URL da capa do nó de destaque (cover_media, cover_media_cropped_thumbnail, etc.). */
function getHighlightCoverUrl(node: Record<string, unknown>): string | null {
  const cover = node.cover_media_cropped_thumbnail ?? node.cover_media ?? node.cover;
  if (cover != null && typeof cover === 'object') {
    const c = cover as Record<string, unknown>;
    const url = c.url ?? (c.image_versions2 && typeof c.image_versions2 === 'object'
      ? getIn((c.image_versions2 as Record<string, unknown>).candidates as unknown[], '0.url')
      : undefined);
    if (typeof url === 'string' && url.length > 0) return url;
  }
  return null;
}

/** Constrói Entity de destaque a partir do node da API (id, title, cover) + meta opcional. */
function buildHighlightEntityFromNode(
  node: Record<string, unknown>,
  collectedAt: string,
  meta?: { itemCount: number; weeksAgo: number | null; dateIso: string | null }
): Entity {
  const id = String(node.id ?? node.pk ?? '');
  const title = typeof node.title === 'string' ? node.title : undefined;
  const coverUrl = getHighlightCoverUrl(node);
  const itemCount = meta?.itemCount;
  let highlightDateIso: string | undefined;
  if (meta?.dateIso) highlightDateIso = meta.dateIso;
  else if (meta?.weeksAgo != null && meta.weeksAgo >= 0) {
    const d = new Date();
    d.setDate(d.getDate() - meta.weeksAgo * 7);
    highlightDateIso = d.toISOString().slice(0, 10);
  }
  return {
    influencer: { is_verified: false, is_private: false },
    post: {
      shortcode: id,
      collected_at: collectedAt,
      highlight_id: id,
      ...(itemCount != null && itemCount > 0 && { highlight_item_count: itemCount }),
      ...(meta?.weeksAgo != null && { highlight_weeks_ago: meta.weeksAgo }),
      ...(highlightDateIso && { highlight_date_iso: highlightDateIso }),
    },
    content: { caption_text: title },
    media: {
      cover_images: coverUrl ? [{ width: 56, height: 56, url: coverUrl }] : [],
      video_versions: [],
    },
    metrics: {},
    flags: {},
  };
}

/** Lista de ids de destaques a partir dos bodies (para abrir cada um e disparar reel media). */
function getHighlightIdsFromBodies(bodies: unknown[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const body of bodies) {
    const edges = getHighlightEdgesFromRaw(body);
    for (const edge of edges) {
      if (edge == null || typeof edge !== 'object') continue;
      const node = (edge as Record<string, unknown>).node;
      if (!isHighlightEdgeNode(node)) continue;
      const id = String((node as Record<string, unknown>).id ?? (node as Record<string, unknown>).pk);
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }
  return ids;
}

/**
 * Extrai itens de mídia de edges e normaliza (influencer, post, content, media, metrics, flags).
 */
function extractMediaFromEdges(edges: unknown[], collectedAt: string): Entity[] {
  const out: Entity[] = [];
  for (const edge of edges) {
    if (edge == null || typeof edge !== 'object') continue;
    const node = (edge as Record<string, unknown>).node;
    if (node == null || typeof node !== 'object') continue;
    const nodeObj = node as Record<string, unknown>;
    const code = nodeObj.code ?? nodeObj.shortcode;
    if (code == null) continue;
    const normalized = buildNormalizedPost(nodeObj, collectedAt);
    out.push(normalized as Entity);
  }
  return out;
}

/**
 * Extrai posts do response da API (timeline) e normaliza para o formato de persistência.
 * Separa por tipo: posts (feed) e reels (product_type clips/reel).
 */
function extractPostsFromRawResponse(raw: unknown, collectedAt: string): Entity[] {
  const edges = getEdgesFromRawTimeline(raw);
  return extractMediaFromEdges(edges, collectedAt);
}

/** Storage opcional para salvar highlights em background (evita dependência circular com runCrawl). */
export interface ExtractProfileStorageForHighlights {
  saveMedia?(profileHandle: string, mediaKind: 'highlight', items: Entity[], collectedAt: string): Promise<number>;
}

export interface ExtractProfileOptions {
  /** Quando true, a página já está no perfil (ex.: após getFollowersFromProfile); evita novo goto e reduz scroll/delays. */
  pageAlreadyOnProfile?: boolean;
  /** Quando true, usa delays mínimos (extract-profile API, usuário esperando). */
  fastMode?: boolean;
  /** Quando fornecido com storage, a coleta de destaques roda em background (não bloqueia o retorno). */
  client?: InstagramClient;
  /** Quando fornecido com client, highlights são salvos ao concluir a coleta em background. */
  storage?: ExtractProfileStorageForHighlights;
}

/**
 * Coleta de destaques em background (própria page): obtém IDs (API + abas + DOM se necessário),
 * abre cada destaque para meta, monta entidades e salva via storage.saveMedia.
 * Roda sempre que client e storage são passados em options (inclui fast mode).
 */
async function collectHighlightsInBackground(
  client: InstagramClient,
  handle: string,
  config: CrawlConfig,
  fastMode: boolean,
  storage: ExtractProfileStorageForHighlights,
  logStep: (msg: string) => void
): Promise<void> {
  const profileUrl = InstagramClient.profileUrl(handle);
  const d = fastMode ? delayMsFast : delayMs;
  const keyHandle = handle.toLowerCase().replace(/^@/, '');
  const captured: { url: string; status: number; body?: unknown }[] = [];
  const highlightMetaById = new Map<string, { itemCount: number; weeksAgo: number | null; dateIso: string | null }>();
  let pendingHighlightId: string | null = null;
  let resolveMetaPromise: ((m: { itemCount: number; dateIso: string | null; weeksAgo: number | null } | null) => void) | null = null;

  const page = await client.newPage();
  const onResponse = async (response: Response) => {
    const url = response.url();
    const status = response.status();
    if (status >= 400 || !RESPONSE_URL_PATTERNS.some((p) => p.test(url)) || captured.length >= MAX_CAPTURED_RESPONSES) return;
    const ct = response.headers()['content-type'] ?? '';
    if (!ct.includes('application/json')) return;
    try {
      const body = await response.json();
      if (body != null && typeof body === 'object') {
        captured.push({ url, status, body });
        if (pendingHighlightId && resolveMetaPromise) {
          const meta = parseHighlightMediaFromResponse(body);
          if (meta && meta.itemCount > 0) {
            highlightMetaById.set(pendingHighlightId, { itemCount: meta.itemCount, weeksAgo: meta.weeksAgo, dateIso: meta.dateIso });
            const resolve = resolveMetaPromise;
            resolveMetaPromise = null;
            pendingHighlightId = null;
            resolve(meta);
          }
        }
      }
    } catch {
      /* ignore */
    }
  };
  try {
    page.on('response', onResponse);

    logStep('[highlights bg] abrindo perfil para coleta de destaques...');
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(fastMode ? 600 : 2000);

    let highlightIds = getHighlightIdsFromBodies(captured.map((c) => c.body).filter((b): b is Record<string, unknown> => b != null && typeof b === 'object'));

    if (highlightIds.length === 0 && !fastMode) {
      const waitAfterTab = 2500;
      const tryClickTabByIndex = async (tabIndex: number): Promise<boolean> => {
        const tabList = page.locator('[role="tablist"]').first();
        if ((await tabList.count()) === 0) return false;
        const tabLinks = tabList.locator('a[href]');
        if (tabIndex >= (await tabLinks.count())) return false;
        try {
          await tabLinks.nth(tabIndex).click({ timeout: 5000 });
          await page.waitForTimeout(waitAfterTab);
          return true;
        } catch {
          return false;
        }
      };
      await tryClickTabByIndex(1);
      await tryClickTabByIndex(3).catch(() => tryClickTabByIndex(2));
      highlightIds = getHighlightIdsFromBodies(captured.map((c) => c.body).filter((b): b is Record<string, unknown> => b != null && typeof b === 'object'));
    }

    if (highlightIds.length === 0) {
      const scraped = await page
        .evaluate(() => {
          const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/stories/highlights/"]'));
          return links
            .map((a) => {
              const m = a.getAttribute('href')?.match(/\/stories\/highlights\/(\d+)/);
              return m ? m[1]! : null;
            })
            .filter((id): id is string => id != null);
        })
        .catch(() => []);
      if (scraped.length > 0) {
        highlightIds = [...new Set(scraped)];
        logStep(`[highlights bg] ${highlightIds.length} id(s) do DOM.`);
      }
    }

    const bodies = captured.map((c) => c.body).filter((b): b is Record<string, unknown> => b != null && typeof b === 'object');
    const collectedAt = new Date().toISOString();
    const seenIds = new Set<string>();
    const allHighlights: Entity[] = [];

    for (const body of bodies) {
      const edges = getHighlightEdgesFromRaw(body);
      for (const edge of edges) {
        if (edge == null || typeof edge !== 'object') continue;
        const node = (edge as Record<string, unknown>).node;
        if (!isHighlightEdgeNode(node)) continue;
        const id = String((node as Record<string, unknown>).id ?? (node as Record<string, unknown>).pk);
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        allHighlights.push(buildHighlightEntityFromNode(node as Record<string, unknown>, collectedAt, highlightMetaById.get(id)));
      }
    }

    if (highlightIds.length > 0) {
      const maxOpen = Math.min(highlightIds.length, 12);
      logStep(`[highlights bg] abrindo ${maxOpen} destaque(s)...`);
      for (let i = 0; i < maxOpen; i++) {
        const highlightId = highlightIds[i]!;
        try {
          const link = page.locator(`a[href*="/stories/highlights/${highlightId}"]`).first();
          if ((await link.count()) === 0) continue;
          await link.scrollIntoViewIfNeeded().catch(() => null);
          const metaPromise = new Promise<{ itemCount: number; dateIso: string | null; weeksAgo: number | null } | null>((r) => {
            resolveMetaPromise = r;
          });
          pendingHighlightId = highlightId;
          await link.click({ timeout: 5000 });
          await page.waitForSelector('[aria-label="Fechar"]', { timeout: 10000 }).catch(() => null);
          const meta = await Promise.race([
            metaPromise,
            new Promise<null>((resolve) => setTimeout(() => {
              if (resolveMetaPromise) resolveMetaPromise(null);
              resolveMetaPromise = null;
              pendingHighlightId = null;
              resolve(null);
            }, 4500)),
          ]);
          if (!meta && !highlightMetaById.has(highlightId)) {
            await page.waitForTimeout(1200);
            const highlightCountScript = `(function(){
              var closeEl=document.querySelector('[aria-label="Fechar"]');
              if(!closeEl) return {itemCount:0,weeksAgo:null,dateIso:null};
              var bar=closeEl.closest('section')&&document.querySelector('[role="progressbar"]');
              var n=bar&&bar.children?bar.children.length:0;
              if(n<1||n>50)n=0;
              var timeEl=(closeEl.closest('section')||document.body).querySelector('time[datetime]');
              var dateIso=timeEl&&timeEl.getAttribute('datetime')?new Date(timeEl.getAttribute('datetime')).toISOString().slice(0,10):null;
              return{itemCount:n,weeksAgo:null,dateIso:dateIso};
            })();`;
            const domMeta = await page.evaluate(highlightCountScript).catch(() => ({ itemCount: 0, weeksAgo: null, dateIso: null })) as { itemCount: number; weeksAgo: number | null; dateIso: string | null };
            if (domMeta.itemCount > 0 || domMeta.dateIso) highlightMetaById.set(highlightId, domMeta);
          }
          await page.waitForTimeout(500);
          const closeBtn = page.locator('[aria-label="Fechar"]').first();
          if ((await closeBtn.count()) > 0) await closeBtn.click({ timeout: 3000 }).catch(() => null);
          await page.waitForTimeout(800);
        } catch (e) {
          logStep(`[highlights bg] erro destaque ${i + 1}: ${e instanceof Error ? e.message : String(e)}`);
          await page.keyboard.press('Escape').catch(() => null);
          await page.waitForTimeout(400);
        }
      }

      seenIds.clear();
      allHighlights.length = 0;
      for (const body of bodies) {
        const edges = getHighlightEdgesFromRaw(body);
        for (const edge of edges) {
          if (edge == null || typeof edge !== 'object') continue;
          const node = (edge as Record<string, unknown>).node;
          if (!isHighlightEdgeNode(node)) continue;
          const id = String((node as Record<string, unknown>).id ?? (node as Record<string, unknown>).pk);
          if (seenIds.has(id)) continue;
          seenIds.add(id);
          allHighlights.push(buildHighlightEntityFromNode(node as Record<string, unknown>, collectedAt, highlightMetaById.get(id)));
        }
      }
    }

    if (allHighlights.length > 0 && typeof storage.saveMedia === 'function') {
      await storage.saveMedia(keyHandle, 'highlight', allHighlights, collectedAt);
      logStep(`[highlights bg] salvos ${allHighlights.length} destaque(s).`);
    } else if (allHighlights.length === 0) {
      logStep('[highlights bg] nenhum destaque para salvar.');
    }
  } finally {
    page.off('response', onResponse);
    await page.close().catch(() => null);
  }
}

/**
 * Extrai perfil 100% genérico: intercepta a response da página e retorna o body completo.
 * Nenhuma entidade fixa; o que for retornado pela API é armazenado como está.
 */
export async function extractProfile(
  page: Page,
  handle: string,
  discoveredBy: DiscoveredBy,
  discoveredValue: string,
  _config: CrawlConfig,
  options: ExtractProfileOptions = {}
): Promise<{ profile: Entity & { handle: string }; posts: Entity[]; reels: Entity[]; tagged: Entity[]; highlights: Entity[] } | null> {
  const t0 = Date.now();
  const logStep = (msg: string) => console.log(`[extractProfile] ${logTimestamp()} @${handle} +${Date.now() - t0}ms ${msg}`);
  const { pageAlreadyOnProfile = false, fastMode = false, client: optClient, storage: optStorage } = options;
  const profileUrl = InstagramClient.profileUrl(handle);
  const d = fastMode ? delayMsFast : delayMs;
  const humanD = fastMode ? humanDelayFast : humanDelay;
  /** Quando true, destaques rodam em background e o retorno traz highlights vazio. */
  let runHighlightsAsync = false;
  /** Metadados + body para debug e limite de memória; só guardamos body quando status ok e JSON. */
  const captured: { url: string; status: number; body?: unknown }[] = [];
  let had429 = false;
  /** Por destaque (id): quantidade de itens e data — preenchido por interceptação ou fallback DOM. */
  const highlightMetaById = new Map<string, { itemCount: number; weeksAgo: number | null; dateIso: string | null }>();
  /** Quando abrimos um destaque: id que estamos esperando e resolver da promise (resposta da API). */
  let pendingHighlightId: string | null = null;
  let resolveHighlightMeta: ((m: { itemCount: number; dateIso: string | null; weeksAgo: number | null } | null) => void) | null = null;
  /** Fallback DOM: preenchidos quando a API não retorna tagged/highlights (ex.: paths diferentes). */
  let scrapedHighlightTrays: { id: string; title: string; cover_url: string | null }[] = [];
  let scrapedTaggedItems: { shortcode: string; cover_url: string | null; caption: string; is_reel: boolean }[] = [];
  logStep(`iniciando (fastMode=${fastMode}) — extração via interceptação; fallback DOM só lista (sem hover); métricas só da API`);

  const onResponse = async (response: Response) => {
    const url = response.url();
    const status = response.status();
    // Tratar 429, 401, 403 e 302 como possível bloqueio (record429 só se falharmos ao extrair).
    if (status === 429 || status === 401 || status === 403 || status === 302) {
      had429 = true;
      return;
    }
    if (url.includes('/accounts/login/') || url.includes('/challenge/')) {
      had429 = true;
      return;
    }
    if (!RESPONSE_URL_PATTERNS.some((p) => p.test(url))) return;
    if (captured.length >= MAX_CAPTURED_RESPONSES) return;
    if (status >= 400) return;
    const contentType = response.headers()['content-type'] ?? '';
    if (!contentType.includes('application/json')) return;
    const contentLength = response.headers()['content-length'];
    if (contentLength != null) {
      const len = parseInt(contentLength, 10);
      if (!Number.isNaN(len) && len > MAX_BODY_BYTES) return;
    }
    try {
      const body = await response.json();
      if (body != null && typeof body === 'object') {
        captured.push({ url, status, body });
        // Interceptação: se estamos esperando dados de um destaque, tentar extrair da resposta da API.
        if (pendingHighlightId && resolveHighlightMeta) {
          const meta = parseHighlightMediaFromResponse(body);
          if (meta && meta.itemCount > 0) {
            highlightMetaById.set(pendingHighlightId, {
              itemCount: meta.itemCount,
              weeksAgo: meta.weeksAgo,
              dateIso: meta.dateIso,
            });
            const id = pendingHighlightId;
            pendingHighlightId = null;
            const resolve = resolveHighlightMeta;
            resolveHighlightMeta = null;
            resolve(meta);
            logStep(`[highlights] API interceptada para destaque ${id}: itemCount=${meta.itemCount} dateIso=${meta.dateIso ?? 'null'} weeksAgo=${meta.weeksAgo ?? 'null'}`);
          }
        }
      }
    } catch {
      // ignore
    }
  };

  page.on('response', onResponse);

  try {
    if (pageAlreadyOnProfile) {
      logStep('recarregando página (já no perfil)...');
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
      await humanD();
      await page.waitForTimeout(fastMode ? 400 : d(1500));
    } else {
      try {
        logStep('goto perfil...');
        await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      } catch (navErr) {
        const navMsg = navErr instanceof Error ? navErr.message : String(navErr);
        if (/ERR_HTTP_RESPONSE_CODE_FAILURE|net::ERR/i.test(navMsg)) {
          throw new Error('Sessão do Instagram expirada ou não logada. Execute o login na pasta crawl: npm run login');
        }
        throw navErr;
      }
      logStep('página carregada, delay...');
      await humanD();
      await page.waitForTimeout(fastMode ? 400 : d(1500));

      const urlAfterGoto = page.url();
      if (urlAfterGoto.includes('/accounts/login') || urlAfterGoto.includes('/challenge/')) {
        throw new Error('Sessão do Instagram expirada ou não logada. Execute o login na pasta crawl: npm run login');
      }
    }

    logStep('aguardando URL do perfil...');
    const profilePath = `/${handle.replace(/^@/, '')}/`;
    const onProfile = await page.waitForFunction(
      (path) => !window.location.pathname.includes('/p/') && window.location.pathname.includes(path),
      profilePath,
      { timeout: pageAlreadyOnProfile ? 5000 : 10000 }
    ).catch(() => null);
    if (!onProfile) {
      logStep('perfil não visível ou timeout.');
      if (had429) {
        record429();
        throw new Error('RATE_LIMIT_429');
      }
      return null;
    }
    logStep('perfil visível, scroll e espera...');

    // Página de login: só confiar na URL (texto da página dá falso positivo: "Entrar" aparece em botões do perfil)
    const isLoginPage = await page.evaluate(() => {
      const href = (window.location?.href ?? '').toLowerCase();
      return href.includes('/accounts/login') || href.includes('/challenge/');
    }).catch(() => false);
    if (isLoginPage) {
      throw new Error('Sessão do Instagram expirada ou não logada. Execute o login na pasta crawl: npm run login');
    }

    // Perfil não existe: Instagram exibe "Sorry, this page isn't available" (ou equivalente)
    const pageNotAvailable = await page.evaluate(() => {
      const text = document.body?.innerText ?? '';
      return /isn't available|page isn't available|não está disponível|não encontrado/i.test(text);
    }).catch(() => false);
    if (pageNotAvailable) {
      throw new Error('Perfil não encontrado');
    }

    await page.waitForTimeout(d(pageAlreadyOnProfile ? 400 : 1000));

    if (pageAlreadyOnProfile) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.5)).catch(() => null);
      await page.waitForTimeout(d(400));
      await page.mouse.wheel(0, 600).catch(() => null);
      await page.waitForTimeout(d(800));
    } else {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.5)).catch(() => null);
      await page.waitForTimeout(fastMode ? 200 : d(500));
      await page.mouse.wheel(0, 800).catch(() => null);
      await page.waitForTimeout(fastMode ? 400 : d(1000));
    }

    logStep('aguardando respostas da API (Polaris)...');
    await page.waitForTimeout(fastMode ? 600 : 2000);

    const runHighlightsInBackground = Boolean(optClient && optStorage && typeof optStorage.saveMedia === 'function');
    if (runHighlightsInBackground) {
      runHighlightsAsync = true;
      void collectHighlightsInBackground(optClient!, handle, _config, fastMode, optStorage!, logStep).catch((err) =>
        logStep(`[highlights] em background falhou: ${err instanceof Error ? err.message : String(err)}`)
      );
    }

    if (!runHighlightsInBackground) {
      let highlightIds: string[] = [];
      if (!fastMode) {
        const keyHandle = handle.toLowerCase().replace(/^@/, '');
        const waitAfterTab = 2500;

        // Abas são <a> dentro de [role="tablist"]: índice 0=Posts, 1=Reels, 2=Salvos, 3=Marcados (não usam role="tab").
        const tryClickTabByIndex = async (tabIndex: number, label: string): Promise<boolean> => {
        const tabList = page.locator('[role="tablist"]').first();
        if (await tabList.count() === 0) return false;
        const tabLinks = tabList.locator('a[href]');
        const n = await tabLinks.count();
        if (tabIndex >= n) return false;
        try {
          await tabLinks.nth(tabIndex).scrollIntoViewIfNeeded().catch(() => null);
          await tabLinks.nth(tabIndex).click({ timeout: 5000 });
          logStep(`aba ${label} clicada (índice ${tabIndex}), aguardando...`);
          await page.waitForTimeout(waitAfterTab);
          return true;
        } catch {
          return false;
        }
      };

      const tryClickLinkByHref = async (pathPart: string, label: string): Promise<boolean> => {
        const selectors = [
          `a[href*="${keyHandle}/${pathPart}"]`,
          `a[href*="/${pathPart}/"]`,
          `a[href*="${pathPart}"]`,
        ];
        for (const sel of selectors) {
          const link = page.locator(sel).first();
          if (await link.count() > 0) {
            try {
              await link.scrollIntoViewIfNeeded().catch(() => null);
              await link.click({ timeout: 5000 });
              logStep(`aba ${label} clicada (link), aguardando...`);
              await page.waitForTimeout(waitAfterTab);
              return true;
            } catch {
              continue;
            }
          }
        }
        return false;
      };

      // 1) Reels: índice 1 na tablist ou link com reels
      let reelsOk = await tryClickTabByIndex(1, 'Reels');
      if (!reelsOk) reelsOk = await tryClickLinkByHref('reels', 'Reels');
      if (!reelsOk) logStep('aba Reels não encontrada.');

      // 2) Marcados (tagged): índice 3 (ou 2 se só houver 3 abas: Posts, Reels, Marcados)
      let taggedOk = await tryClickTabByIndex(3, 'Marcados');
      if (!taggedOk) taggedOk = await tryClickTabByIndex(2, 'Marcados');
      if (!taggedOk) taggedOk = await tryClickLinkByHref('tagged', 'Marcados');
      if (!taggedOk) logStep('aba Marcados não encontrada.');

      // Ids dos destaques: primeiro dos bodies; se zero, fallback DOM (círculos na página).
      const bodiesSoFar = captured.map((c) => c.body).filter((b): b is Record<string, unknown> => b != null && typeof b === 'object');
      highlightIds = getHighlightIdsFromBodies(bodiesSoFar);
      if (highlightIds.length === 0 && taggedOk) {
        scrapedHighlightTrays = await page
          .evaluate(() => {
            const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/stories/highlights/"]'));
            return links
              .map((a) => {
                const match = a.getAttribute('href')?.match(/\/stories\/highlights\/(\d+)/);
                const id = match ? match[1]! : null;
                if (!id) return null;
                const title = (a.getAttribute('aria-label') || a.querySelector('span')?.textContent?.trim() || '').replace(/^Ver destaque de\s*/i, '').trim();
                const img = a.querySelector('img');
                const coverUrl = img ? (img.getAttribute('src') || (img as HTMLImageElement).src) : null;
                return { id, title, cover_url: coverUrl };
              })
              .filter((x): x is { id: string; title: string; cover_url: string | null } => x != null && x.id != null);
          })
          .catch(() => []);
        if (scrapedHighlightTrays.length > 0) {
          highlightIds = scrapedHighlightTrays.map((t) => t.id);
          logStep(`[fallback DOM] ${highlightIds.length} destaque(s) do DOM (API não retornou ids).`);
        }
      }
    } else {
      const bodiesSoFar = captured.map((c) => c.body).filter((b): b is Record<string, unknown> => b != null && typeof b === 'object');
      highlightIds = getHighlightIdsFromBodies(bodiesSoFar);
    }
    if (highlightIds.length > 0) {
      logStep(`${highlightIds.length} destaque(s) da API; abrindo cada um para interceptar reel media.`);
      const maxHighlightsToOpen = Math.min(highlightIds.length, 12);
      let resolveMetaPromise: ((m: { itemCount: number; dateIso: string | null; weeksAgo: number | null } | null) => void) | null = null;
      for (let i = 0; i < maxHighlightsToOpen; i++) {
        const highlightId = highlightIds[i]!;
        try {
          const highlightLink = page.locator(`a[href*="/stories/highlights/${highlightId}"]`).first();
          if ((await highlightLink.count()) === 0) continue;
          await highlightLink.scrollIntoViewIfNeeded().catch(() => null);
          const metaPromise = new Promise<{ itemCount: number; dateIso: string | null; weeksAgo: number | null } | null>((r) => {
            resolveMetaPromise = r;
          });
          resolveHighlightMeta = (m) => {
            if (resolveMetaPromise) {
              resolveMetaPromise(m);
              resolveMetaPromise = null;
            }
            resolveHighlightMeta = null;
            pendingHighlightId = null;
          };
          pendingHighlightId = highlightId;
          logStep(`[highlights] destaque ${i + 1}/${maxHighlightsToOpen} clique (id=${highlightId}), aguardando viewer e resposta da API...`);
          await highlightLink.click({ timeout: 5000 });
          await page.waitForSelector('[aria-label="Fechar"]', { timeout: 10000 }).catch(() => null);
          const metaFromApi = await Promise.race([
            metaPromise,
            new Promise<null>((resolve) =>
              setTimeout(() => {
                if (resolveMetaPromise) resolveMetaPromise(null);
                resolveMetaPromise = null;
                resolveHighlightMeta = null;
                pendingHighlightId = null;
                resolve(null);
              }, 4500)
            ),
          ]);
          if (metaFromApi && metaFromApi.itemCount > 0) {
            logStep(`[highlights] destaque ${highlightId} via API: itemCount=${metaFromApi.itemCount} dateIso=${metaFromApi.dateIso ?? 'null'} weeksAgo=${metaFromApi.weeksAgo ?? 'null'}`);
          } else if (!metaFromApi) {
            logStep(`[highlights] destaque ${highlightId} sem resposta da API em 4.5s; tentando fallback DOM para contagem.`);
            if (!highlightMetaById.has(highlightId)) {
              await page.waitForFunction(
                () => {
                  const closeEl = document.querySelector('[aria-label="Fechar"]');
                  if (!closeEl) return false;
                  let el: Element | null = closeEl;
                  while (el) {
                    const bar = el.querySelector('.x1ned7t2.x78zum5');
                    if (bar && bar.children.length >= 2) return true;
                    const roleBar = el.querySelector('[role="progressbar"]');
                    if (roleBar && roleBar.children.length >= 2) return true;
                    el = el.parentElement;
                  }
                  return false;
                },
                { timeout: 5000 }
              ).catch(() => null);
              await page.waitForTimeout(1200);
              const highlightCountScript = `
                (function() {
                  var candidates = [];
                  function push(n) { if (n >= 1 && n <= 50) candidates.push(n); }
                  var closeEl = document.querySelector('[aria-label="Fechar"]');
                  var progressParent = null, el = closeEl;
                  while (el) {
                    var found = el.querySelector('.x1ned7t2.x78zum5');
                    if (found) { progressParent = found; break; }
                    el = el.parentElement;
                  }
                  if (progressParent) {
                    push(progressParent.querySelectorAll(':scope > div').length);
                    push(progressParent.querySelectorAll(':scope > div.x1lix1fw').length);
                  }
                  var bar = document.querySelector('[role="progressbar"]');
                  if (bar) { push(bar.children.length); if (bar.firstElementChild) push(bar.firstElementChild.children.length); }
                  var itemCount = candidates.length > 0 ? Math.max.apply(null, candidates) : 0;
                  var dateIso = null, weeksAgo = null;
                  var viewer = closeEl ? (closeEl.closest('section') || closeEl.closest('div[role="dialog"]') || document.body) : document.body;
                  var timeEl = viewer.querySelector('time[datetime]');
                  if (timeEl && timeEl.getAttribute('datetime')) {
                    var d = new Date(timeEl.getAttribute('datetime'));
                    if (!Number.isNaN(d.getTime())) dateIso = d.toISOString().slice(0, 10);
                  }
                  if (!dateIso && viewer) {
                    var txt = (viewer.innerText || '').match(/(\\d+)\\s*sem\\b/);
                    if (txt) { var n = parseInt(txt[1], 10); if (n >= 0 && n <= 5000) weeksAgo = n; }
                  }
                  return { itemCount: itemCount, weeksAgo: weeksAgo, dateIso: dateIso };
                })();
              `;
              const domMeta = await page.evaluate(highlightCountScript).catch(() => ({ itemCount: 0, weeksAgo: null, dateIso: null })) as { itemCount: number; weeksAgo: number | null; dateIso: string | null };
              if (domMeta.itemCount > 0 || domMeta.dateIso || domMeta.weeksAgo != null) {
                highlightMetaById.set(highlightId, { itemCount: domMeta.itemCount, weeksAgo: domMeta.weeksAgo, dateIso: domMeta.dateIso });
                logStep(`[highlights] destaque ${highlightId} fallback DOM: itemCount=${domMeta.itemCount} dateIso=${domMeta.dateIso ?? 'null'}`);
              }
            }
          }
          await page.waitForTimeout(500);
          const closeBtn = page.locator('[aria-label="Fechar"]').first();
          const closeCount = await closeBtn.count();
          logStep(`[highlights] botão Fechar visível=${closeCount > 0}, fechando viewer...`);
          if (closeCount > 0) {
            await closeBtn.click({ timeout: 3000 }).catch((e) => logStep(`[highlights] clique Fechar falhou: ${e}`));
            await page.waitForTimeout(800);
          }
          logStep(`[highlights] destaque ${i + 1} concluído; total com dados até agora: ${highlightMetaById.size}`);
        } catch (e) {
          logStep(`[highlights] erro no destaque ${i + 1}: ${e instanceof Error ? e.message : String(e)}`);
          try {
            await page.keyboard.press('Escape').catch(() => null);
            await page.waitForTimeout(400);
          } catch {
            // ignora
          }
          try {
            await page.keyboard.press('Escape').catch(() => null);
            await page.waitForTimeout(400);
          } catch {
            // ignora
          }
        }
      }
      logStep(`${highlightMetaById.size} destaques com itens/data obtidos.`);
    }
    }
  } finally {
    page.off('response', onResponse);
  }

  const bodies = captured.map((c) => c.body).filter((b): b is Record<string, unknown> => b != null && typeof b === 'object');
  const hasUsableProfile = bodies.some((b) => hasDataUser(b));
  logStep(`pronto: ${bodies.length} respostas, hasUsableProfile=${hasUsableProfile}`);

  if (bodies.length === 0 || !hasUsableProfile) {
    if (had429) {
      record429();
      throw new Error('RATE_LIMIT_429');
    }
    return null;
  }

  // Garantir que usamos o perfil do usuário visitado (handle), não do viewer (logado). Várias respostas podem ter data.user.
  const keyHandle = handle.toLowerCase().replace(/^@/, '');
  const bodyForRequestedProfile = (predicate: (r: Record<string, unknown>) => boolean) =>
    bodies.find((r) => {
      if (!r || !predicate(r)) return false;
      const username = getDataUserUsername(r);
      return username != null && username.toLowerCase() === keyHandle;
    }) as Record<string, unknown> | undefined;

  const merged = bodies.length > 1 ? deepMergeResponses(bodies) : bodies[0];
  const polarisFull = bodies.find((r): r is Record<string, unknown> => r != null && hasDataUserWithMetrics(r));
  const polarisAny = bodies.find((r): r is Record<string, unknown> => r != null && hasDataUser(r));
  // Preferir body que seja do perfil solicitado (username === handle), para friendship_status correto (ex.: 2FA request-code).
  const rawForProfile =
    bodyForRequestedProfile(hasDataUserWithMetrics) ??
    bodyForRequestedProfile(hasDataUser) ??
    polarisFull ??
    polarisAny ??
    merged;

  try {
    await mkdir(RESPONSE_LOG_DIR, { recursive: true });
    const logPath = join(RESPONSE_LOG_DIR, 'last-profile-response.json');
    await writeFile(logPath, JSON.stringify(rawForProfile, null, 2), 'utf-8');
  } catch {
    // ignore
  }

  // Perfil = JSON completo da API (data.user + extensions + status etc.), com metadados de coleta.
  const profile = (typeof rawForProfile === 'object' && rawForProfile !== null
    ? { ...(rawForProfile as object) }
    : { raw: rawForProfile }) as Record<string, unknown>;
  const key = handle.toLowerCase().replace(/^@/, '');
  if (!profile.handle) profile.handle = key;
  profile._collected_at = new Date().toISOString();
  profile._discovered_by = discoveredBy;
  profile._discovered_value = discoveredValue;

  const collectedAt = String(profile._collected_at);
  // Posts e reels da timeline: extrair do merge e de cada resposta; separar por product_type.
  const seenShortcodesPosts = new Set<string>();
  const seenShortcodesReels = new Set<string>();
  const seenShortcodesTagged = new Set<string>();
  const seenShortcodesHighlights = new Set<string>();
  const allPosts: Entity[] = [];
  const allReels: Entity[] = [];
  const allTagged: Entity[] = [];
  const allHighlights: Entity[] = [];

  const shortcodeOf = (p: Entity): string => {
    const po = p as Record<string, unknown>;
    const postBlock = po?.post as Record<string, unknown> | undefined;
    return (postBlock?.shortcode != null ? String(postBlock.shortcode) : String(po?.shortcode ?? '')) || '';
  };

  const addTimelineFrom = (raw: unknown): void => {
    for (const p of extractPostsFromRawResponse(raw, collectedAt)) {
      const sc = shortcodeOf(p);
      if (!sc) continue;
      const postBlock = (p as Record<string, unknown>).post as Record<string, unknown> | undefined;
      const productType = postBlock?.product_type;
      const isReel = productType === 'clips' || productType === 'reel' || (typeof productType === 'string' && productType.toLowerCase().includes('reel'));
      if (isReel) {
        if (!seenShortcodesReels.has(sc)) {
          seenShortcodesReels.add(sc);
          allReels.push(p);
        }
      } else {
        if (!seenShortcodesPosts.has(sc)) {
          seenShortcodesPosts.add(sc);
          allPosts.push(p);
        }
      }
    }
  };

  addTimelineFrom(merged);
  for (const r of bodies) {
    if (r !== merged) addTimelineFrom(r);
  }

  const addFromPaths = (paths: string[], seen: Set<string>, out: Entity[]): void => {
    for (const body of bodies) {
      const edges = getEdgesFromRaw(body, paths);
      for (const p of extractMediaFromEdges(edges, collectedAt)) {
        const sc = shortcodeOf(p);
        if (sc && !seen.has(sc)) {
          seen.add(sc);
          out.push(p);
        }
      }
    }
  };

  addFromPaths(REELS_EDGES_PATHS, seenShortcodesReels, allReels);
  addFromPaths(TAGGED_EDGES_PATHS, seenShortcodesTagged, allTagged);
  addFromPaths(HIGHLIGHTS_EDGES_PATHS, seenShortcodesHighlights, allHighlights);

  // Marcados: somente da API (TAGGED_EDGES_PATHS + findAllEdgesByKeyHint) — sem DOM.
  // Destaques: somente da API (getHighlightEdgesFromRaw) + meta de interceptação ao abrir cada um.
  for (const body of bodies) {
    const edges = getHighlightEdgesFromRaw(body);
    for (const edge of edges) {
      if (edge == null || typeof edge !== 'object') continue;
      const node = (edge as Record<string, unknown>).node;
      if (!isHighlightEdgeNode(node)) continue;
      const id = String((node as Record<string, unknown>).id ?? (node as Record<string, unknown>).pk);
      if (seenShortcodesHighlights.has(id)) continue;
      seenShortcodesHighlights.add(id);
      const meta = highlightMetaById.get(id);
      allHighlights.push(buildHighlightEntityFromNode(node as Record<string, unknown>, collectedAt, meta ?? undefined));
    }
  }

  // Fallback: busca profunda por qualquer objeto cujo caminho contenha "tagged", "usertags" ou "highlight" com edges de mídia
  for (const body of bodies) {
    const taggedArrays = [
      ...findAllEdgesByKeyHint(body, 'tagged'),
      ...findAllEdgesByKeyHint(body, 'usertags'),
    ];
    for (const edges of taggedArrays) {
      for (const p of extractMediaFromEdges(edges, collectedAt)) {
        const sc = shortcodeOf(p);
        if (sc && !seenShortcodesTagged.has(sc)) {
          seenShortcodesTagged.add(sc);
          allTagged.push(p);
        }
      }
    }
    const highlightArrays = findAllEdgesByKeyHint(body, 'highlight');
    for (const edges of highlightArrays) {
      for (const p of extractMediaFromEdges(edges, collectedAt)) {
        const sc = shortcodeOf(p);
        if (sc && !seenShortcodesHighlights.has(sc)) {
          seenShortcodesHighlights.add(sc);
          allHighlights.push(p);
        }
      }
    }
  }

  // Fallback DOM: quando a API não retorna marcados (ex.: paths diferentes), extrair do grid da aba Marcados
  if (allTagged.length === 0 && !fastMode) {
    try {
      scrapedTaggedItems = await page
        .evaluate(() => {
          const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/p/"], a[href*="/reel/"]'));
          const seen = new Set<string>();
          return links
            .map((a) => {
              const href = a.getAttribute('href') || '';
              const pMatch = href.match(/\/p\/([^/]+)\/?$/);
              const reelMatch = href.match(/\/reel\/([^/]+)\/?$/);
              const shortcode = reelMatch ? reelMatch[1]! : pMatch ? pMatch[1]! : null;
              if (!shortcode || seen.has(shortcode)) return null;
              seen.add(shortcode);
              const img = a.querySelector('img');
              const coverUrl = img ? (img.getAttribute('src') || (img as HTMLImageElement).src) : null;
              const caption = (img?.getAttribute('alt') || '').slice(0, 500);
              return { shortcode, cover_url: coverUrl, caption, is_reel: /\/reel\//.test(href) };
            })
            .filter((x): x is { shortcode: string; cover_url: string | null; caption: string; is_reel: boolean } => x != null && x.shortcode != null);
        })
        .catch(() => []);
      if (scrapedTaggedItems.length > 0) {
        logStep(`[fallback DOM] ${scrapedTaggedItems.length} marcados do grid (API não retornou); métricas só da interceptação.`);
        for (const item of scrapedTaggedItems) {
          if (seenShortcodesTagged.has(item.shortcode)) continue;
          seenShortcodesTagged.add(item.shortcode);
          allTagged.push({
            influencer: { is_verified: false, is_private: false },
            post: {
              shortcode: item.shortcode,
              collected_at: collectedAt,
              product_type: item.is_reel ? 'reel' : undefined,
            },
            content: { caption_text: item.caption || undefined },
            media: {
              cover_images: item.cover_url ? [{ width: 144, height: 144, url: item.cover_url }] : [],
              video_versions: [],
            },
            metrics: {},
            flags: {},
          } as Entity);
        }
      }
    } catch (e) {
      logStep(`[fallback DOM] erro ao extrair marcados: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Fallback DOM: destaques da lista scrapedHighlightTrays (quando API não retornou edge_highlight_reels)
  if (allHighlights.length === 0 && scrapedHighlightTrays.length > 0) {
    for (const tray of scrapedHighlightTrays) {
      if (seenShortcodesHighlights.has(tray.id)) continue;
      seenShortcodesHighlights.add(tray.id);
      const meta = highlightMetaById.get(tray.id);
      const itemCount = meta?.itemCount;
      let highlightDateIso: string | undefined;
      if (meta?.dateIso) highlightDateIso = meta.dateIso;
      else if (meta?.weeksAgo != null && meta.weeksAgo >= 0) {
        const d = new Date();
        d.setDate(d.getDate() - meta.weeksAgo * 7);
        highlightDateIso = d.toISOString().slice(0, 10);
      }
      allHighlights.push({
        influencer: { is_verified: false, is_private: false },
        post: {
          shortcode: tray.id,
          collected_at: collectedAt,
          highlight_id: tray.id,
          ...(itemCount != null && itemCount > 0 && { highlight_item_count: itemCount }),
          ...(meta?.weeksAgo != null && { highlight_weeks_ago: meta.weeksAgo }),
          ...(highlightDateIso && { highlight_date_iso: highlightDateIso }),
        },
        content: { caption_text: tray.title || undefined },
        media: {
          cover_images: tray.cover_url ? [{ width: 56, height: 56, url: tray.cover_url }] : [],
          video_versions: [],
        },
        metrics: {},
        flags: {},
      } as Entity);
    }
    logStep(`[fallback DOM] ${scrapedHighlightTrays.length} destaques do DOM.`);
  }

  if (allTagged.length === 0 && allHighlights.length === 0 && bodies.length > 0) {
    try {
      const dataKeys = bodies.map((b, i) => {
        const data = (b as Record<string, unknown>).data;
        return { i, topKeys: Object.keys(b as object), dataKeys: data && typeof data === 'object' ? Object.keys(data) : [] };
      });
      await mkdir(RESPONSE_LOG_DIR, { recursive: true });
      await writeFile(
        join(RESPONSE_LOG_DIR, 'captured-bodies-keys.json'),
        JSON.stringify(dataKeys, null, 2),
        'utf-8'
      );
      logStep(`tagged/highlights zerados: chaves das ${bodies.length} respostas em captured-bodies-keys.json`);
    } catch {
      // ignora falha de debug
    }
  }

  // Log JSON da interceptação da API (sempre) + amostras de marcados para debug dos números
  try {
    await mkdir(RESPONSE_LOG_DIR, { recursive: true });
    const logDir = RESPONSE_LOG_DIR;

    // 0) SEMPRE: gravar as respostas interceptadas (JSON bruto) para inspecionar a estrutura da API
    const bodiesToLog = bodies.slice(0, 3);
    await writeFile(
      join(logDir, 'last-captured-api-responses.json'),
      JSON.stringify(
        {
          description: 'Respostas HTTP/GraphQL interceptadas (até 3 primeiras). Use para ver a estrutura real da API e ajustar extração.',
          count: bodiesToLog.length,
          bodies: bodiesToLog,
        },
        null,
        2
      ),
      'utf-8'
    );
    logStep(`JSON da interceptação da API em ${logDir}/last-captured-api-responses.json (${bodiesToLog.length} body(s))`);

    // 1) Primeiro body que tiver edges de tagged (caminhos conhecidos ou hint "tagged") + amostra dos nodes
    let firstBodyWithTagged: Record<string, unknown> | null = null;
    const taggedNodesSample: unknown[] = [];
    for (const body of bodies) {
      const fromPaths = getEdgesFromRaw(body, TAGGED_EDGES_PATHS);
      const fromHint = findAllEdgesByKeyHint(body, 'tagged').flat();
      const edges = fromPaths.length > 0 ? fromPaths : fromHint;
      if (edges.length > 0) {
        if (!firstBodyWithTagged) firstBodyWithTagged = body as Record<string, unknown>;
        for (const edge of edges.slice(0, 3)) {
          if (edge != null && typeof edge === 'object' && (edge as Record<string, unknown>).node)
            taggedNodesSample.push((edge as Record<string, unknown>).node);
        }
        if (taggedNodesSample.length >= 3) break;
      }
    }
    if (firstBodyWithTagged) {
      await writeFile(
        join(logDir, 'last-captured-body-with-tagged.json'),
        JSON.stringify(firstBodyWithTagged, null, 2),
        'utf-8'
      );
      logStep(`JSON da API com marcados em ${logDir}/last-captured-body-with-tagged.json`);
    }
    if (taggedNodesSample.length > 0) {
      await writeFile(
        join(logDir, 'last-tagged-nodes-sample.json'),
        JSON.stringify(
          { description: 'Amostra dos nodes (edge.node) de marcados da API; ver like_count, comment_count, edge_liked_by, edge_media_to_comment', nodes: taggedNodesSample },
          null,
          2
        ),
        'utf-8'
      );
      logStep(`Amostra dos nodes de marcados (API) em ${logDir}/last-tagged-nodes-sample.json`);
    }

    // 2) Entidades de marcados que estamos extraindo (o que vai pro frontend — conferir metrics.likes/comments)
    if (allTagged.length > 0) {
      const entitiesSample = allTagged.slice(0, 4).map((e) => {
        const rec = e as Record<string, unknown>;
        const post = rec?.post as Record<string, unknown> | undefined;
        const content = rec?.content as Record<string, unknown> | undefined;
        return {
          shortcode: post?.shortcode ?? rec?.shortcode,
          metrics: rec.metrics,
          content_caption: content?.caption_text,
        };
      });
      await writeFile(
        join(logDir, 'last-tagged-entities-extracted.json'),
        JSON.stringify(
          {
            description: 'Métricas e campos que extraímos para marcados (comparar com o que o Instagram mostra na tela)',
            totalTagged: allTagged.length,
            sample: entitiesSample,
          },
          null,
          2
        ),
        'utf-8'
      );
      logStep(`Entidades de marcados extraídas (amostra) em ${logDir}/last-tagged-entities-extracted.json`);
    }

    // 3) Se usamos fallback DOM: amostra do que veio do overlay (texto bruto + métricas parseadas)
    if (scrapedTaggedItems.length > 0) {
      const domSample = scrapedTaggedItems.slice(0, 4).map((item) => ({
        shortcode: item.shortcode,
        caption: item.caption?.slice(0, 80),
      }));
      await writeFile(
        join(logDir, 'last-tagged-dom-fallback-sample.json'),
        JSON.stringify(
          {
            description: 'Fallback DOM: apenas lista de marcados do grid (métricas vêm só da interceptação da API).',
            totalScraped: scrapedTaggedItems.length,
            sample: domSample,
          },
          null,
          2
        ),
        'utf-8'
      );
      logStep(`Amostra do fallback DOM (marcados) em ${logDir}/last-tagged-dom-fallback-sample.json`);
    }
  } catch (e) {
    logStep(`[log] falha ao escrever JSON de debug: ${e instanceof Error ? e.message : String(e)}`);
  }

  console.log(
    `[extractProfile] ${logTimestamp()} @${handle} extraído: posts=${allPosts.length} reels=${allReels.length} tagged=${allTagged.length} highlights=${allHighlights.length}`
  );

  return {
    profile: profile as Entity & { handle: string },
    posts: allPosts,
    reels: allReels,
    tagged: allTagged,
    highlights: runHighlightsAsync ? [] : allHighlights,
  };
}

const SUPPLEMENT_WAIT_AFTER_TAB_MS = 2200;

/**
 * Extrai apenas Reels e Marcados com a página já aberta no perfil.
 * Usado em fastMode após a extração principal: clica nas abas Reels e Marcados,
 * intercepta as respostas da API e retorna as entidades. Não navega nem extrai perfil/posts.
 */
export async function extractReelsAndTaggedFromCurrentPage(
  page: Page,
  handle: string,
  collectedAt: string
): Promise<{ reels: Entity[]; tagged: Entity[] }> {
  const t0 = Date.now();
  const logStep = (msg: string) =>
    console.log(`[extractReelsAndTagged] ${logTimestamp()} @${handle} +${Date.now() - t0}ms ${msg}`);
  const keyHandle = handle.toLowerCase().replace(/^@/, '');

  const captured: { url: string; status: number; body?: unknown }[] = [];
  const onResponse = async (response: Response) => {
    const url = response.url();
    const status = response.status();
    if (status === 429 || status >= 400) return;
    if (!RESPONSE_URL_PATTERNS.some((p) => p.test(url))) return;
    if (captured.length >= MAX_CAPTURED_RESPONSES) return;
    const contentType = response.headers()['content-type'] ?? '';
    if (!contentType.includes('application/json')) return;
    try {
      const body = await response.json();
      if (body != null && typeof body === 'object') captured.push({ url, status, body });
    } catch {
      // ignore
    }
  };

  page.on('response', onResponse);
  try {
    const tryClickTabByIndex = async (tabIndex: number, label: string): Promise<boolean> => {
      const tabList = page.locator('[role="tablist"]').first();
      if ((await tabList.count()) === 0) return false;
      const tabLinks = tabList.locator('a[href]');
      const n = await tabLinks.count();
      if (tabIndex >= n) return false;
      try {
        await tabLinks.nth(tabIndex).scrollIntoViewIfNeeded().catch(() => null);
        await tabLinks.nth(tabIndex).click({ timeout: 5000 });
        logStep(`aba ${label} clicada (índice ${tabIndex})`);
        await page.waitForTimeout(SUPPLEMENT_WAIT_AFTER_TAB_MS);
        return true;
      } catch {
        return false;
      }
    };
    const tryClickLinkByHref = async (pathPart: string, label: string): Promise<boolean> => {
      const selectors = [
        `a[href*="${keyHandle}/${pathPart}"]`,
        `a[href*="/${pathPart}/"]`,
        `a[href*="${pathPart}"]`,
      ];
      for (const sel of selectors) {
        const link = page.locator(sel).first();
        if ((await link.count()) > 0) {
          try {
            await link.scrollIntoViewIfNeeded().catch(() => null);
            await link.click({ timeout: 5000 });
            logStep(`aba ${label} clicada (link)`);
            await page.waitForTimeout(SUPPLEMENT_WAIT_AFTER_TAB_MS);
            return true;
          } catch {
            continue;
          }
        }
      }
      return false;
    };

    let reelsOk = await tryClickTabByIndex(1, 'Reels');
    if (!reelsOk) reelsOk = await tryClickLinkByHref('reels', 'Reels');
    if (!reelsOk) logStep('aba Reels não encontrada.');

    let taggedOk = await tryClickTabByIndex(3, 'Marcados');
    if (!taggedOk) taggedOk = await tryClickTabByIndex(2, 'Marcados');
    if (!taggedOk) taggedOk = await tryClickLinkByHref('tagged', 'Marcados');
    if (!taggedOk) logStep('aba Marcados não encontrada.');
  } finally {
    page.off('response', onResponse);
  }

  const bodies = captured.map((c) => c.body).filter((b): b is Record<string, unknown> => b != null && typeof b === 'object');
  const shortcodeOf = (p: Entity): string => {
    const po = p as Record<string, unknown>;
    const postBlock = (po?.post as Record<string, unknown> | undefined);
    return (postBlock?.shortcode != null ? String(postBlock.shortcode) : String((po as { shortcode?: string }).shortcode ?? '')) || '';
  };
  const seenReels = new Set<string>();
  const seenTagged = new Set<string>();
  const allReels: Entity[] = [];
  const allTagged: Entity[] = [];

  const addFromPaths = (paths: string[], seen: Set<string>, out: Entity[]): void => {
    for (const body of bodies) {
      const edges = getEdgesFromRaw(body, paths);
      for (const p of extractMediaFromEdges(edges, collectedAt)) {
        const sc = shortcodeOf(p);
        if (sc && !seen.has(sc)) {
          seen.add(sc);
          out.push(p);
        }
      }
    }
  };

  addFromPaths(REELS_EDGES_PATHS, seenReels, allReels);
  addFromPaths(TAGGED_EDGES_PATHS, seenTagged, allTagged);

  for (const body of bodies) {
    const taggedArrays = [
      ...findAllEdgesByKeyHint(body, 'tagged'),
      ...findAllEdgesByKeyHint(body, 'usertags'),
    ];
    for (const edges of taggedArrays) {
      for (const p of extractMediaFromEdges(edges, collectedAt)) {
        const sc = shortcodeOf(p);
        if (sc && !seenTagged.has(sc)) {
          seenTagged.add(sc);
          allTagged.push(p);
        }
      }
    }
  }

  if (allTagged.length === 0) {
    try {
      const scraped = await page
        .evaluate(() => {
          const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/p/"], a[href*="/reel/"]'));
          const seen = new Set<string>();
          return links
            .map((a) => {
              const href = a.getAttribute('href') || '';
              const pMatch = href.match(/\/p\/([^/]+)\/?$/);
              const reelMatch = href.match(/\/reel\/([^/]+)\/?$/);
              const shortcode = reelMatch ? reelMatch[1]! : pMatch ? pMatch[1]! : null;
              if (!shortcode || seen.has(shortcode)) return null;
              seen.add(shortcode);
              const img = a.querySelector('img');
              const coverUrl = img ? (img.getAttribute('src') || (img as HTMLImageElement).src) : null;
              const caption = (img?.getAttribute('alt') || '').slice(0, 500);
              return { shortcode, cover_url: coverUrl, caption, is_reel: /\/reel\//.test(href) };
            })
            .filter((x): x is { shortcode: string; cover_url: string | null; caption: string; is_reel: boolean } => x != null && x.shortcode != null);
        })
        .catch(() => []);
      for (const item of scraped) {
        if (seenTagged.has(item.shortcode)) continue;
        seenTagged.add(item.shortcode);
        allTagged.push({
          influencer: { is_verified: false, is_private: false },
          post: {
            shortcode: item.shortcode,
            collected_at: collectedAt,
            product_type: item.is_reel ? 'reel' : undefined,
          },
          content: { caption_text: item.caption || undefined },
          media: {
            cover_images: item.cover_url ? [{ width: 144, height: 144, url: item.cover_url }] : [],
            video_versions: [],
          },
          metrics: {},
          flags: {},
        } as Entity);
      }
      if (scraped.length > 0) logStep(`[fallback DOM] ${scraped.length} marcados do grid.`);
    } catch (e) {
      logStep(`[fallback DOM] erro ao extrair marcados: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  logStep(`reels=${allReels.length} tagged=${allTagged.length}`);
  return { reels: allReels, tagged: allTagged };
}
