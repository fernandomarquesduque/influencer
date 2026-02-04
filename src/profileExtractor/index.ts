import type { Page, Response } from 'playwright';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type { Entity, DiscoveredBy } from '../types/index.js';
import type { CrawlConfig } from '../types/index.js';
import { InstagramClient } from '../instagramClient/index.js';
import { crawlLogExtract } from '../utils/crawlLogger.js';
import { buildNormalizedPost } from '../utils/slimPost.js';

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

/**
 * Retorna apenas o número de seguidores (para qualificar na descoberta).
 */
export async function getFollowersFromProfile(page: Page, profileUrl: string): Promise<number | null> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('getFollowersFromProfile timeout')), GET_FOLLOWERS_TIMEOUT_MS)
  );
  try {
    const result = await Promise.race([
      (async (): Promise<number | null> => {
        await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(2000);
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
      })(),
      timeoutPromise,
    ]);
    return result;
  } catch {
    return null;
  }
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

/**
 * Extrai perfil 100% genérico: intercepta a response da página e retorna o body completo.
 * Nenhuma entidade fixa; o que for retornado pela API é armazenado como está.
 */
export async function extractProfile(
  page: Page,
  handle: string,
  discoveredBy: DiscoveredBy,
  discoveredValue: string,
  _config: CrawlConfig
): Promise<{ profile: Entity & { handle: string }; posts: Entity[] } | null> {
  const profileUrl = InstagramClient.profileUrl(handle);
  const captured: unknown[] = [];

  const onResponse = async (response: Response) => {
    const url = response.url();
    if (!RESPONSE_URL_PATTERNS.some((p) => p.test(url))) return;
    try {
      const body = await response.json();
      if (body != null && typeof body === 'object') captured.push(body);
    } catch {
      // ignore
    }
  };

  page.on('response', onResponse);

  try {
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(3000);

    const profilePath = `/${handle.replace(/^@/, '')}/`;
    const onProfile = await page.waitForFunction(
      (path) => !window.location.pathname.includes('/p/') && window.location.pathname.includes(path),
      profilePath,
      { timeout: 10000 }
    ).catch(() => null);
    if (!onProfile) return null;

    await page.waitForTimeout(2000);

    // Rolar a página para disparar o carregamento da timeline (posts) e capturar a response.
    await page.evaluate(() => {
      const main = document.querySelector('main');
      if (main) main.scrollTop = main.scrollHeight * 0.3;
    }).catch(() => null);
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      const main = document.querySelector('main');
      if (main) main.scrollTop = main.scrollHeight * 0.6;
    }).catch(() => null);
    await page.waitForTimeout(2500);
  } finally {
    (page as { off: (event: string, handler: (r: Response) => void) => void }).off('response', onResponse);
  }

  if (captured.length === 0) {
    crawlLogExtract('Nenhuma response de perfil capturada.');
    return null;
  }

  // Preferir resposta Polaris (PolarisProfilePageContentQuery) que contém data.user com perfil completo.
  const merged = captured.length > 1 ? deepMergeResponses(captured) : captured[0];
  const polarisRaw =
    typeof merged === 'object' && merged !== null
      ? (captured as unknown[]).find(
        (r) => r != null && typeof r === 'object' && (r as Record<string, unknown>)?.data != null
          && typeof (r as Record<string, unknown>).data === 'object'
          && ((r as Record<string, unknown>).data as Record<string, unknown>)?.user != null
      )
      : null;
  const rawForProfile = polarisRaw ?? merged;

  // Log do response para inspeção
  try {
    await mkdir(RESPONSE_LOG_DIR, { recursive: true });
    const logPath = join(RESPONSE_LOG_DIR, 'last-profile-response.json');
    await writeFile(logPath, JSON.stringify(rawForProfile, null, 2), 'utf-8');
    crawlLogExtract(`Response da API gravada em ${logPath}`);
  } catch (e) {
    crawlLogExtract(`Falha ao gravar response log: ${e instanceof Error ? e.message : String(e)}`);
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
  for (const r of captured) {
    if (r !== merged) addFrom(r);
  }
  if (allPosts.length > 0) {
    crawlLogExtract(`${allPosts.length} posts extraídos da timeline (response da API).`);
  } else {
    crawlLogExtract('Nenhum post extraído da timeline (timeline pode não ter sido capturada).');
  }
  return { profile: profile as Entity & { handle: string }, posts: allPosts };
}
