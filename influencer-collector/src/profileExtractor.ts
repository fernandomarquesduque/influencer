/**
 * Extração de perfil e seguidores — interceptação da API GraphQL.
 */

import type { Page } from 'playwright';
import { getFollowersFromEntity } from './entityRules.js';

const PROFILE_RESPONSE_URL = /graphql\/query/i;
const TIMEOUT_MS = 25_000;

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

function hasDataUser(b: Record<string, unknown>): boolean {
  return (
    b?.data != null &&
    typeof b.data === 'object' &&
    (b.data as Record<string, unknown>)?.user != null
  );
}

function applyMultiplier(num: number, rest: string): number {
  const lower = rest.toLowerCase();
  if (lower.includes('milh') || /m\s/i.test(rest)) return Math.round(num * 1_000_000);
  if (lower.includes('mil') || lower.includes('k')) return Math.round(num * 1000);
  return Math.round(num);
}

function parseFollowersFromText(fullText: string): number | null {
  const match = fullText.match(
    /(\d[\d.,\s]*)\s*(?:mil|k|m|milhão|milhões)?\s*seguidores/i
  ) ?? fullText.match(/(\d[\d.,\s]*)\s*(?:mil|k|m)?\s*followers?/i);
  if (!match) return null;
  const numStr = match[1].replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(numStr);
  if (Number.isNaN(n)) return null;
  return applyMultiplier(n, match[0] ?? '');
}

async function readFollowersFromDOM(page: Page): Promise<number | null> {
  await page.waitForTimeout(1500);
  const main = page.locator('main').first();
  await main.waitFor({ state: 'visible', timeout: 8000 }).catch(() => null);
  const link = page.locator('a[href*="/followers/"]').first();
  const span = link.locator('span[title]').first();
  const title = await span.getAttribute('title').catch(() => null);
  if (title) {
    const numStr = title.replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
    const n = parseFloat(numStr);
    if (!Number.isNaN(n) && n > 0) return Math.round(n);
  }
  const text = await main.allTextContents().then((a) => a.join('\n'));
  return parseFollowersFromText(text.replace(/\s+/g, ' '));
}

export interface GetFollowersOptions {
  doNavigate?: () => Promise<void>;
  skipGoto?: boolean;
}

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
    const ct = response.headers()['content-type'] ?? '';
    if (!ct.includes('application/json')) return;
    try {
      const body = (await response.json()) as Record<string, unknown>;
      if (body != null && hasDataUser(body)) capturedBody = body;
    } catch {
      // ignore
    }
  };
  page.on('response', onResponse);
  try {
    if (options?.skipGoto) {
      await page.waitForTimeout(800);
      const followers =
        capturedBody != null
          ? getFollowersFromEntity(capturedBody)
          : await readFollowersFromDOM(page);
      return {
        followers: followers != null && followers > 0 ? followers : null,
        minimalProfile: capturedBody,
      };
    }
    if (options?.doNavigate) {
      await options.doNavigate();
    } else {
      await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    }
    await page.waitForTimeout(2500);
    const fromApi = capturedBody != null ? getFollowersFromEntity(capturedBody) : 0;
    const followers =
      fromApi > 0 ? fromApi : await readFollowersFromDOM(page);
    return {
      followers: followers != null && followers > 0 ? followers : null,
      minimalProfile: capturedBody,
    };
  } finally {
    page.off('response', onResponse);
  }
}

const TIMELINE_EDGES_PATHS = [
  'data.xdt_api__v1__feed__user_timeline_graphql_connection.edges',
  'data.xdt_api__v1__feed__timeline__connection.edges',
  'data.feed_user_timeline.edges',
];

function getEdgesFromRaw(raw: unknown): unknown[] {
  if (raw == null || typeof raw !== 'object') return [];
  for (const path of TIMELINE_EDGES_PATHS) {
    const current = getIn(raw, path);
    if (Array.isArray(current)) return current;
  }
  return [];
}

function extractUserFromRaw(raw: Record<string, unknown>): Record<string, unknown> | null {
  const user = getIn(raw, 'data.user');
  if (user != null && typeof user === 'object') return user as Record<string, unknown>;
  const edges = getEdgesFromRaw(raw);
  if (edges.length === 0) return null;
  const first = edges[0];
  if (first == null || typeof first !== 'object') return null;
  const node = (first as Record<string, unknown>).node;
  if (node == null || typeof node !== 'object') return null;
  const u = (node as Record<string, unknown>).user;
  return u != null && typeof u === 'object' ? (u as Record<string, unknown>) : null;
}

function toNum(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.floor(v);
  if (typeof v === 'string') {
    const n = parseInt(v.replace(/\D/g, ''), 10);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}

/** Constrói um post normalizado com like_count a partir de node da API. */
function nodeToPost(edge: unknown): Record<string, unknown> | null {
  if (edge == null || typeof edge !== 'object') return null;
  const node = (edge as Record<string, unknown>).node;
  if (node == null || typeof node !== 'object') return null;
  const n = node as Record<string, unknown>;
  const edgeLikedBy = n.edge_liked_by as Record<string, unknown> | undefined;
  const edgePreview = n.edge_media_preview_like as Record<string, unknown> | undefined;
  const likeCount =
    toNum(edgeLikedBy?.count ?? n.like_count) ?? toNum(edgePreview?.count);
  return {
    ...n,
    like_count: likeCount ?? 0,
    metrics: { likes: likeCount ?? 0 },
  };
}

export interface ExtractedProfile {
  profile: Record<string, unknown>;
  posts: Record<string, unknown>[];
}

/**
 * Extrai perfil completo + posts da timeline interceptando respostas GraphQL.
 */
export async function extractProfile(
  page: Page,
  handle: string,
  profileUrl: string,
  options?: { pageAlreadyOnProfile?: boolean }
): Promise<ExtractedProfile | null> {
  const captured: Record<string, unknown>[] = [];
  const onResponse = async (response: import('playwright').Response) => {
    const url = response.url();
    if (!/graphql\/query/i.test(url) || response.status() >= 400) return;
    const ct = response.headers()['content-type'] ?? '';
    if (!ct.includes('application/json')) return;
    try {
      const body = (await response.json()) as Record<string, unknown>;
      if (body != null && (hasDataUser(body) || getEdgesFromRaw(body).length > 0)) {
        captured.push(body);
      }
    } catch {
      // ignore
    }
  };
  page.on('response', onResponse);
  try {
    if (options?.pageAlreadyOnProfile) {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
    } else {
      await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    }
    await page.waitForTimeout(3000);
    let profileRaw: Record<string, unknown> | null = null;
    const allPosts: Record<string, unknown>[] = [];
    const seenShortcode = new Set<string>();
    for (const body of captured) {
      if (hasDataUser(body) && profileRaw == null) {
        profileRaw = body;
      }
      const edges = getEdgesFromRaw(body);
      for (const edge of edges) {
        const post = nodeToPost(edge);
        if (!post) continue;
        const code = String(post.shortcode ?? post.code ?? '');
        if (code && !seenShortcode.has(code)) {
          seenShortcode.add(code);
          allPosts.push(post);
        }
      }
    }
    if (!profileRaw) return null;
    const user = extractUserFromRaw(profileRaw);
    const profile: Record<string, unknown> = {
      ...profileRaw,
      handle,
      username: handle,
      ...(user ?? {}),
      _collected_at: new Date().toISOString(),
    };
    return { profile, posts: allPosts };
  } finally {
    page.off('response', onResponse);
  }
}
