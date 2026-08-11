import type { CompositeStorage } from '../../storage/compositeStorage.js';
import { SEO_SITEMAP_CHUNK_SIZE } from './handlesCache.js';

const DEFAULT_TTL_MS = 5 * 60 * 1000;

export type SeoPostRef = {
  handle: string;
  shortcode: string;
};

type PostsCache = {
  posts: SeoPostRef[];
  expires: number;
};

let cache: PostsCache = { posts: [], expires: 0 };
let inflight: Promise<SeoPostRef[]> | null = null;

const OWN_KINDS = new Set(['post', 'reel']);

/**
 * Extrai handle + shortcode de chave RocksDB `handle:kind:shortcode`.
 * Só posts próprios (feed/reel); ignora tagged/highlight.
 */
export function parseSeoPostKey(key: string): SeoPostRef | null {
  const parts = key.split(':');
  if (parts.length < 3) return null;
  const handle = (parts[0] ?? '').replace(/^@/, '').trim().toLowerCase();
  const kind = (parts[1] ?? '').trim().toLowerCase();
  const shortcode = parts.slice(2).join(':').trim();
  if (!handle || !shortcode || !OWN_KINDS.has(kind)) return null;
  if (handle.includes('/') || shortcode.includes('/') || shortcode.includes('..')) return null;
  return { handle, shortcode };
}

/**
 * Lista todos os posts indexáveis (handle+shortcode), com cache em memória.
 * Usado pelo sitemap de posts.
 */
export async function listAllSeoPostsCached(
  db: CompositeStorage,
  ttlMs = DEFAULT_TTL_MS
): Promise<SeoPostRef[]> {
  const now = Date.now();
  if (cache.posts.length > 0 && cache.expires > now) {
    return cache.posts;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    const keys = await db.listKeys('post');
    const seen = new Set<string>();
    const posts: SeoPostRef[] = [];
    for (const key of keys) {
      const ref = parseSeoPostKey(key);
      if (!ref) continue;
      const id = `${ref.handle}\0${ref.shortcode}`;
      if (seen.has(id)) continue;
      seen.add(id);
      posts.push(ref);
    }
    posts.sort((a, b) => {
      const h = a.handle.localeCompare(b.handle, 'en');
      return h !== 0 ? h : a.shortcode.localeCompare(b.shortcode, 'en');
    });
    cache = { posts, expires: Date.now() + ttlMs };
    return posts;
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}

export function invalidateSeoPostsCache(): void {
  cache = { posts: [], expires: 0 };
}

export { SEO_SITEMAP_CHUNK_SIZE };
