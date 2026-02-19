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
 * Com doNavigate: executa a função (ex.: clique no autor) em vez de page.goto(profileUrl).
 */
export async function getFollowersFromProfile(page: Page, profileUrl: string, options?: GetFollowersOptions): Promise<number | null> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('getFollowersFromProfile timeout')), GET_FOLLOWERS_TIMEOUT_MS)
  );
  try {
    const result = await Promise.race([
      (async (): Promise<number | null> => {
        if (options?.skipGoto) {
          return readFollowersFromCurrentPage(page);
        }
        if (options?.doNavigate) {
          await options.doNavigate();
        } else {
          await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        }
        return readFollowersFromCurrentPage(page);
      })(),
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
      const followers = await readFollowersFromCurrentPage(page);
      await page.waitForTimeout(500);
      return { followers, minimalProfile: capturedBody };
    }
    if (options?.doNavigate) {
      await options.doNavigate();
    } else {
      await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    }
    const followers = await readFollowersFromCurrentPage(page);
    await page.waitForTimeout(2000);
    return { followers, minimalProfile: capturedBody };
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

/** Caminhos conhecidos para edges de timeline (user ou feed). */
const TIMELINE_EDGES_PATHS = [
  'data.xdt_api__v1__feed__user_timeline_graphql_connection.edges',
  'data.xdt_api__v1__feed__timeline__connection.edges',
  'data.feed_user_timeline.edges',
];

function getEdgesFromRaw(raw: unknown): unknown[] {
  if (raw == null || typeof raw !== 'object') return [];
  const o = raw as Record<string, unknown>;
  for (const path of TIMELINE_EDGES_PATHS) {
    const parts = path.split('.');
    let current: unknown = o;
    for (const p of parts) {
      if (current == null || typeof current !== 'object') break;
      current = (current as Record<string, unknown>)[p];
    }
    if (Array.isArray(current)) return current;
  }
  return [];
}

/**
 * Extrai posts do response da API (timeline) e normaliza para o formato de persistência
 * (influencer, post, content, media, metrics, flags).
 */
function extractPostsFromRawResponse(raw: unknown, collectedAt: string): Entity[] {
  const posts: Entity[] = [];
  const edges = getEdgesFromRaw(raw);
  for (const edge of edges) {
    if (edge == null || typeof edge !== 'object') continue;
    const node = (edge as Record<string, unknown>).node;
    if (node == null || typeof node !== 'object') continue;
    const nodeObj = node as Record<string, unknown>;
    const code = nodeObj.code ?? nodeObj.shortcode;
    if (code == null) continue;
    const normalized = buildNormalizedPost(nodeObj, collectedAt);
    posts.push(normalized as Entity);
  }
  return posts;
}

export interface ExtractProfileOptions {
  /** Quando true, a página já está no perfil (ex.: após getFollowersFromProfile); evita novo goto e reduz scroll/delays. */
  pageAlreadyOnProfile?: boolean;
  /** Quando true, usa delays mínimos (extract-profile API, usuário esperando). */
  fastMode?: boolean;
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
): Promise<{ profile: Entity & { handle: string }; posts: Entity[] } | null> {
  const t0 = Date.now();
  const logStep = (msg: string) => console.log(`[extractProfile] ${logTimestamp()} @${handle} +${Date.now() - t0}ms ${msg}`);
  const { pageAlreadyOnProfile = false, fastMode = false } = options;
  const profileUrl = InstagramClient.profileUrl(handle);
  const d = fastMode ? delayMsFast : delayMs;
  const humanD = fastMode ? humanDelayFast : humanDelay;
  /** Metadados + body para debug e limite de memória; só guardamos body quando status ok e JSON. */
  const captured: { url: string; status: number; body?: unknown }[] = [];
  let had429 = false;
  logStep(`iniciando (fastMode=${fastMode})`);

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
      if (body != null && typeof body === 'object') captured.push({ url, status, body });
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
  // Posts vêm da timeline: extrair do merge e de cada resposta capturada (a timeline pode vir em response separada).
  const seenShortcodes = new Set<string>();
  const allPosts: Entity[] = [];
  const addFrom = (raw: unknown): void => {
    for (const p of extractPostsFromRawResponse(raw, collectedAt)) {
      const po = p as Record<string, unknown>;
      const postBlock = po?.post as Record<string, unknown> | undefined;
      const sc = postBlock?.shortcode != null ? String(postBlock.shortcode) : String(po?.shortcode ?? '');
      if (sc && !seenShortcodes.has(sc)) {
        seenShortcodes.add(sc);
        allPosts.push(p);
      }
    }
  };
  addFrom(merged);
  for (const r of bodies) {
    if (r !== merged) addFrom(r);
  }
  return { profile: profile as Entity & { handle: string }, posts: allPosts };
}
