/**
 * Auditoria de mídia S3 (avatar/capas) e resumo para o painel admin.
 */

import type { CompositeStorage } from '../storage/compositeStorage.js';
import type { ProfileRefDb } from '../storage/profileRefDb.js';
import { hasCompletedLlmProfile } from './profilesSearch.js';
import { getProfilePicUrlFromRecord } from './profileMediaHelpers.js';
import { getExtractRefreshQueueSnapshot, isHandleInExtractRefreshQueue } from './extractRefreshQueue.js';

export type AdminMediaS3Filter = 'avatar' | 'covers' | 'any';

export type AdminMediaS3MissingRow = {
  handle: string;
  profile_ref: string;
  full_name?: string;
  followers_count?: number;
  missing_avatar: boolean;
  posts_with_media: number;
  posts_missing_stable_cover: number;
  collected_at?: string;
  in_extract_queue: boolean;
};

export type AdminMediaS3AuditSummary = {
  /** Handles na base (todos). */
  total_profiles: number;
  /** Perfis com classificação LLM concluída (`llm.status === "done"`). */
  llm_done_profiles: number;
  missing_avatar: number;
  missing_covers: number;
  missing_any: number;
  extract_queue_length: number;
};

export type AdminMediaS3AuditResponse = {
  generated_at: string;
  summary: AdminMediaS3AuditSummary;
  total: number;
  items: AdminMediaS3MissingRow[];
};

export function hasStableS3ImageUrl(url: unknown): boolean {
  if (typeof url !== 'string') return false;
  const u = url.trim();
  if (!u.startsWith('http')) return false;
  return u.includes('/influencers/');
}

function normalizeHandle(h: string): string {
  return h.replace(/^@/, '').trim().toLowerCase();
}

async function countPostsMissingStableCover(
  storage: CompositeStorage,
  handle: string
): Promise<{ withMedia: number; missingStable: number }> {
  const prefix = `${handle}:`;
  const items = await storage.getByBucket<Record<string, unknown>>('post', prefix, { sort: false });
  let withMedia = 0;
  let missingStable = 0;
  for (const { value } of items) {
    const media = value.media as Record<string, unknown> | undefined;
    const coverImages = media?.cover_images;
    const videoVersions = media?.video_versions;
    const hasVisual =
      (Array.isArray(coverImages) && coverImages.length > 0) ||
      (Array.isArray(videoVersions) && videoVersions.length > 0);
    if (!hasVisual) continue;
    withMedia++;
    const stable = media?.stable_cover_url;
    if (!hasStableS3ImageUrl(stable)) missingStable++;
  }
  return { withMedia, missingStable };
}

type AuditCacheEntry = {
  expiresAt: number;
  rows: AdminMediaS3MissingRow[];
  summary: AdminMediaS3AuditSummary;
};

let auditCache: AuditCacheEntry | null = null;
let auditPending: Promise<AuditCacheEntry> | null = null;

function auditTtlMs(): number {
  const n = Number(process.env.ADMIN_MEDIA_S3_CACHE_TTL_MS);
  if (Number.isFinite(n) && n >= 5000) return n;
  return 120_000;
}

async function buildAuditRows(
  storage: CompositeStorage,
  profileRefDb: ProfileRefDb
): Promise<AuditCacheEntry> {
  const handles = Array.from(await storage.listHandles())
    .map(normalizeHandle)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  const queueSnap = getExtractRefreshQueueSnapshot();
  const queueSet = new Set(queueSnap.pending.map(normalizeHandle));

  const rows: AdminMediaS3MissingRow[] = [];
  let llmDoneProfiles = 0;
  let missingAvatar = 0;
  let missingCovers = 0;
  let missingAny = 0;

  for (const handle of handles) {
    const profile = (await storage.loadByHandle(handle)) as Record<string, unknown> | null;
    if (!profile) continue;
    if (!hasCompletedLlmProfile(profile)) continue;

    llmDoneProfiles++;

    const stableAvatar = profile.stable_profile_pic_url;
    const missing_avatar = !hasStableS3ImageUrl(stableAvatar);
    const { withMedia, missingStable } = await countPostsMissingStableCover(storage, handle);
    const missing_covers = withMedia > 0 && missingStable > 0;

    if (!missing_avatar && !missing_covers) continue;

    if (missing_avatar) missingAvatar++;
    if (missing_covers) missingCovers++;
    missingAny++;

    const followers =
      typeof profile.followers_count === 'number'
        ? profile.followers_count
        : typeof (profile.data as { user?: { follower_count?: number } })?.user?.follower_count === 'number'
          ? (profile.data as { user: { follower_count: number } }).user.follower_count
          : undefined;

    const collectedAt =
      typeof profile._collected_at === 'string' ? profile._collected_at : undefined;

    rows.push({
      handle,
      profile_ref: profileRefDb.getOrCreateRef(handle),
      full_name:
        (typeof profile.full_name === 'string' && profile.full_name) ||
        (typeof profile.name === 'string' && profile.name) ||
        undefined,
      followers_count: followers,
      missing_avatar,
      posts_with_media: withMedia,
      posts_missing_stable_cover: missingStable,
      collected_at: collectedAt,
      in_extract_queue: queueSet.has(handle),
    });
  }

  const summary: AdminMediaS3AuditSummary = {
    total_profiles: handles.length,
    llm_done_profiles: llmDoneProfiles,
    missing_avatar: missingAvatar,
    missing_covers: missingCovers,
    missing_any: missingAny,
    extract_queue_length: queueSnap.length,
  };

  return { expiresAt: Date.now() + auditTtlMs(), rows, summary };
}

async function getAuditCache(
  storage: CompositeStorage,
  profileRefDb: ProfileRefDb,
  bypassCache: boolean
): Promise<AuditCacheEntry> {
  const now = Date.now();
  if (!bypassCache && auditCache && now < auditCache.expiresAt) {
    return auditCache;
  }

  if (!bypassCache && auditPending) {
    return auditPending;
  }

  const work = buildAuditRows(storage, profileRefDb).then((entry) => {
    auditCache = entry;
    auditPending = null;
    return entry;
  });

  auditPending = work;
  return work;
}

export async function getAdminMediaS3Audit(
  storage: CompositeStorage,
  profileRefDb: ProfileRefDb,
  opts: {
    limit?: number;
    offset?: number;
    filter?: AdminMediaS3Filter;
    q?: string;
    refresh?: boolean;
  } = {}
): Promise<AdminMediaS3AuditResponse> {
  const limit = Math.min(Math.max(1, opts.limit ?? 50), 200);
  const offset = Math.max(0, opts.offset ?? 0);
  const filter = opts.filter ?? 'any';
  const q = (opts.q ?? '').trim().toLowerCase();

  const cache = await getAuditCache(storage, profileRefDb, opts.refresh === true);

  const filtered = filterAuditRows(cache.rows, filter, q);

  const slice = filtered.slice(offset, offset + limit).map((row) => ({
    ...row,
    in_extract_queue: isHandleInExtractRefreshQueue(row.handle),
  }));

  const queueSnap = getExtractRefreshQueueSnapshot();

  return {
    generated_at: new Date().toISOString(),
    summary: {
      ...cache.summary,
      extract_queue_length: queueSnap.length,
    },
    total: filtered.length,
    items: slice,
  };
}

function filterAuditRows(
  rows: AdminMediaS3MissingRow[],
  filter: AdminMediaS3Filter,
  q: string
): AdminMediaS3MissingRow[] {
  let filtered = rows;
  if (filter === 'avatar') filtered = filtered.filter((r) => r.missing_avatar);
  else if (filter === 'covers') filtered = filtered.filter((r) => r.posts_missing_stable_cover > 0);
  const qNorm = q.trim().toLowerCase();
  if (qNorm) {
    filtered = filtered.filter(
      (r) => r.handle.includes(qNorm) || r.full_name?.toLowerCase().includes(qNorm)
    );
  }
  return filtered;
}

/** Handles de todos os perfis pendentes que batem com filtro/busca (usa cache da auditoria). */
export async function listAdminMediaS3FilteredHandles(
  storage: CompositeStorage,
  profileRefDb: ProfileRefDb,
  opts: {
    filter?: AdminMediaS3Filter;
    q?: string;
    refresh?: boolean;
    /** Não retorna handles que já estão na fila de extração. */
    excludeInQueue?: boolean;
  } = {}
): Promise<{ total: number; handles: string[] }> {
  const filter = opts.filter ?? 'any';
  const cache = await getAuditCache(storage, profileRefDb, opts.refresh === true);
  let filtered = filterAuditRows(cache.rows, filter, opts.q ?? '');
  if (opts.excludeInQueue !== false) {
    const queueSet = new Set(getExtractRefreshQueueSnapshot().pending.map(normalizeHandle));
    filtered = filtered.filter((r) => !queueSet.has(r.handle) && !r.in_extract_queue);
  }
  const handles = filtered.map((r) => r.handle);
  return { total: handles.length, handles };
}

/** Perfis com avatar IG mas sem URL estável S3 (amostra rápida sem varrer posts). */
export function profileMissingStableAvatar(profile: Record<string, unknown>): boolean {
  if (hasStableS3ImageUrl(profile.stable_profile_pic_url)) return false;
  const igUrl = getProfilePicUrlFromRecord(profile);
  return Boolean(igUrl?.startsWith('http'));
}

export type AdminBulkEnqueueMode = 'missing_s3' | 'all_llm';

export type AdminBulkEnqueueBatchResult = {
  /** Handles elegíveis neste lote (ainda não na fila; o caller enfileira). */
  handles: string[];
  scanned: number;
  next_offset: number;
  total_handles: number;
  done: boolean;
};

let sortedHandlesCache: { handles: string[]; expiresAt: number } | null = null;

async function getSortedHandles(storage: CompositeStorage): Promise<string[]> {
  const now = Date.now();
  if (sortedHandlesCache && now < sortedHandlesCache.expiresAt) {
    return sortedHandlesCache.handles;
  }
  const handles = Array.from(await storage.listHandles())
    .map(normalizeHandle)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  sortedHandlesCache = { handles, expiresAt: now + 300_000 };
  return handles;
}

export async function profileMissingS3Media(
  storage: CompositeStorage,
  handle: string,
  profile: Record<string, unknown>
): Promise<boolean> {
  if (!hasCompletedLlmProfile(profile)) return false;
  const missing_avatar = !hasStableS3ImageUrl(profile.stable_profile_pic_url);
  if (missing_avatar) return true;
  const { withMedia, missingStable } = await countPostsMissingStableCover(storage, handle);
  return withMedia > 0 && missingStable > 0;
}

/**
 * Varre a base em lotes (sem montar auditoria completa). `offset` é índice na lista ordenada de handles.
 */
export async function scanBulkEnqueueBatch(
  storage: CompositeStorage,
  opts: {
    mode: AdminBulkEnqueueMode;
    offset?: number;
    batch_size?: number;
  }
): Promise<AdminBulkEnqueueBatchResult> {
  const batchSize = Math.min(Math.max(1, opts.batch_size ?? 40), 200);
  const offset = Math.max(0, opts.offset ?? 0);
  const allHandles = await getSortedHandles(storage);
  const slice = allHandles.slice(offset, offset + batchSize);
  const handles: string[] = [];

  for (const handle of slice) {
    const profile = (await storage.loadByHandle(handle)) as Record<string, unknown> | null;
    if (!profile || !hasCompletedLlmProfile(profile)) continue;
    if (opts.mode === 'all_llm') {
      handles.push(handle);
      continue;
    }
    if (await profileMissingS3Media(storage, handle, profile)) {
      handles.push(handle);
    }
  }

  const nextOffset = offset + slice.length;
  return {
    handles,
    scanned: slice.length,
    next_offset: nextOffset,
    total_handles: allHandles.length,
    done: nextOffset >= allHandles.length,
  };
}
