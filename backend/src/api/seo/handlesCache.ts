import type { CompositeStorage } from '../../storage/compositeStorage.js';

const DEFAULT_TTL_MS = 5 * 60 * 1000;

type HandlesCache = {
  handles: string[];
  expires: number;
};

let cache: HandlesCache = { handles: [], expires: 0 };
let inflight: Promise<string[]> | null = null;

function normalizeHandle(h: string): string {
  return h.replace(/^@/, '').trim().toLowerCase();
}

/**
 * Lista todos os handles de perfil (RocksDB), com cache em memória.
 * Usado por sitemap e diretório SEO.
 */
export async function listAllProfileHandlesCached(
  db: CompositeStorage,
  ttlMs = DEFAULT_TTL_MS
): Promise<string[]> {
  const now = Date.now();
  if (cache.handles.length > 0 && cache.expires > now) {
    return cache.handles;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    const keys = await db.listKeys('profile');
    const handles = keys
      .map((k) => normalizeHandle(k))
      .filter((h) => Boolean(h) && !h.includes(':'));
    handles.sort((a, b) => a.localeCompare(b, 'en'));
    cache = { handles, expires: Date.now() + ttlMs };
    return handles;
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}

export function invalidateSeoHandlesCache(): void {
  cache = { handles: [], expires: 0 };
}

/** Máx. URLs por arquivo de sitemap (limite Google = 50k). */
export const SEO_SITEMAP_CHUNK_SIZE = 40_000;
