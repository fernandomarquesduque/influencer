/**
 * Relatório admin: @ citados em posts mas sem cadastro no bucket `profile`.
 * Estratégia padrão `profiles` evita varrer todos os posts (502 em bases grandes).
 */

import type { CompositeStorage } from '../storage/compositeStorage.js';
import { collectMentionHandlesFromPostItem } from './profilesSearch.js';

export type UnregisteredMentionsStrategy = 'profiles' | 'posts';

export interface UnregisteredMentionsReport {
  strategy: UnregisteredMentionsStrategy;
  postsInDb?: number;
  postsScanned: number;
  /** Amostra de posts (`strategy=posts`) ou perfis (`strategy=profiles`). */
  postSampleSize?: number;
  profileSampleSize?: number;
  maxPostsPerProfile?: number;
  maxReturn?: number;
  profilesInDb: number;
  uniqueMentions: number;
  notRegisteredCount: number;
  notRegisteredReturned?: number;
  notRegisteredTruncated?: boolean;
  notRegistered: string[];
}

export type UnregisteredMentionsQuery = {
  sample?: unknown;
  postSample?: unknown;
  limit?: unknown;
  maxReturn?: unknown;
  strategy?: unknown;
  maxPostsPerProfile?: unknown;
};

const PROFILE_SAMPLE_DEFAULT = 800;
const PROFILE_SAMPLE_CAP = 3_000;
const PROFILE_RETURN_DEFAULT = 500;
const PROFILE_RETURN_CAP = 2_000;
const MAX_POSTS_PER_PROFILE_DEFAULT = 15;
const MAX_POSTS_PER_PROFILE_CAP = 40;

const POSTS_SAMPLE_DEFAULT = 2_000;
const POSTS_SAMPLE_CAP = 5_000;
const POSTS_RETURN_DEFAULT = 500;
const POSTS_RETURN_CAP = 2_000;

const POSTS_READ_BATCH = 32;
const PROFILE_SCAN_CONCURRENCY = 4;

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
}

/** Amostra uniforme de até `k` itens de um iterable (sem materializar tudo). */
function reservoirSampleFromIterable(keys: Iterable<string>, k: number): string[] {
  if (k <= 0) return [];
  const reservoir: string[] = [];
  let seen = 0;
  for (const key of keys) {
    seen++;
    if (reservoir.length < k) {
      reservoir.push(key);
    } else {
      const j = Math.floor(Math.random() * seen);
      if (j < k) reservoir[j] = key;
    }
  }
  return reservoir;
}

let profileHandleCache: { set: Set<string>; count: number; expiresAt: number } | null = null;
let profileHandlePending: Promise<{ set: Set<string>; count: number }> | null = null;

function profileHandleCacheTtlMs(): number {
  const n = Number(process.env.UNREGISTERED_MENTIONS_PROFILE_CACHE_TTL_MS);
  if (Number.isFinite(n) && n >= 60_000) return n;
  return 5 * 60_000;
}

async function getProfileHandleSet(storage: CompositeStorage): Promise<{ set: Set<string>; count: number }> {
  const now = Date.now();
  if (profileHandleCache && now < profileHandleCache.expiresAt) {
    return { set: profileHandleCache.set, count: profileHandleCache.count };
  }
  if (profileHandlePending) return profileHandlePending;

  profileHandlePending = (async () => {
    try {
      const set = new Set<string>();
      const count = await storage.iterateKeysInBucket('profile', (key) => {
        const h = String(key ?? '').replace(/^@+/, '').trim().toLowerCase();
        if (h.length > 0) set.add(h);
      });
      profileHandleCache = { set, count, expiresAt: Date.now() + profileHandleCacheTtlMs() };
      return { set, count };
    } finally {
      profileHandlePending = null;
    }
  })();

  return profileHandlePending;
}

/** Serializa execuções pesadas para não derrubar o processo com relatórios concorrentes. */
let reportLock: Promise<void> = Promise.resolve();

export function parseUnregisteredMentionsParams(query: UnregisteredMentionsQuery): {
  strategy: UnregisteredMentionsStrategy;
  sampleSize: number;
  maxReturn: number;
  maxPostsPerProfile: number;
} {
  const strategyRaw = String(query.strategy ?? 'profiles').toLowerCase();
  const strategy: UnregisteredMentionsStrategy = strategyRaw === 'posts' ? 'posts' : 'profiles';

  const clamp = (raw: unknown, cap: number, fallback: number, min = 50): number => {
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n) || n < min) return fallback;
    return Math.min(cap, n);
  };

  if (strategy === 'posts') {
    return {
      strategy,
      sampleSize: clamp(query.sample ?? query.postSample, POSTS_SAMPLE_CAP, POSTS_SAMPLE_DEFAULT),
      maxReturn: clamp(query.limit ?? query.maxReturn, POSTS_RETURN_CAP, POSTS_RETURN_DEFAULT),
      maxPostsPerProfile: 0,
    };
  }

  return {
    strategy,
    sampleSize: clamp(query.sample, PROFILE_SAMPLE_CAP, PROFILE_SAMPLE_DEFAULT),
    maxReturn: clamp(query.limit ?? query.maxReturn, PROFILE_RETURN_CAP, PROFILE_RETURN_DEFAULT),
    maxPostsPerProfile: clamp(
      query.maxPostsPerProfile,
      MAX_POSTS_PER_PROFILE_CAP,
      MAX_POSTS_PER_PROFILE_DEFAULT
    ),
  };
}

function finalizeMissingList(
  allMentions: Set<string>,
  profileSet: Set<string>,
  maxReturn: number
): {
  notRegistered: string[];
  notRegisteredCount: number;
  notRegisteredReturned: number;
  notRegisteredTruncated: boolean;
} {
  let missing = [...allMentions].filter((h) => !profileSet.has(h));
  const notRegisteredCount = missing.length;
  shuffleInPlace(missing);
  const notRegisteredTruncated = missing.length > maxReturn;
  if (notRegisteredTruncated) {
    missing = missing.slice(0, maxReturn);
  }
  return {
    notRegistered: missing.map((h) => `@${h}`),
    notRegisteredCount,
    notRegisteredReturned: missing.length,
    notRegisteredTruncated,
  };
}

async function buildViaProfilesStrategy(
  storage: CompositeStorage,
  profileSet: Set<string>,
  profilesInDb: number,
  postsInDb: number | undefined,
  sampleSize: number,
  maxReturn: number,
  maxPostsPerProfile: number
): Promise<UnregisteredMentionsReport> {
  const sampledProfiles = reservoirSampleFromIterable(profileSet, sampleSize);
  const allMentions = new Set<string>();
  let postsScanned = 0;

  for (let i = 0; i < sampledProfiles.length; i += PROFILE_SCAN_CONCURRENCY) {
    const chunk = sampledProfiles.slice(i, i + PROFILE_SCAN_CONCURRENCY);
    const buckets = await Promise.all(
      chunk.map((handle) =>
        storage.getByBucket<Record<string, unknown>>('post', `${handle}:`, { sort: false })
      )
    );
    for (const items of buckets) {
      const capped =
        items.length > maxPostsPerProfile ? items.slice(0, maxPostsPerProfile) : items;
      postsScanned += capped.length;
      for (const { value } of capped) {
        if (value == null || typeof value !== 'object') continue;
        for (const h of collectMentionHandlesFromPostItem(value)) {
          allMentions.add(h);
        }
      }
    }
  }

  const missing = finalizeMissingList(allMentions, profileSet, maxReturn);
  return {
    strategy: 'profiles',
    postsInDb,
    postsScanned,
    profileSampleSize: sampleSize,
    maxPostsPerProfile,
    maxReturn,
    profilesInDb,
    uniqueMentions: allMentions.size,
    ...missing,
  };
}

async function buildViaPostsStrategy(
  storage: CompositeStorage,
  profileSet: Set<string>,
  profilesInDb: number,
  sampleSize: number,
  maxReturn: number
): Promise<UnregisteredMentionsReport> {
  const postSample = await storage.reservoirSampleKeysInBucket('post', sampleSize);
  const allMentions = new Set<string>();

  for (let i = 0; i < postSample.sample.length; i += POSTS_READ_BATCH) {
    const chunk = postSample.sample.slice(i, i + POSTS_READ_BATCH);
    const values = await Promise.all(
      chunk.map((key) => storage.get<Record<string, unknown>>('post', key))
    );
    for (const value of values) {
      if (value == null || typeof value !== 'object') continue;
      for (const h of collectMentionHandlesFromPostItem(value)) {
        allMentions.add(h);
      }
    }
  }

  const missing = finalizeMissingList(allMentions, profileSet, maxReturn);
  return {
    strategy: 'posts',
    postsInDb: postSample.totalKeys,
    postsScanned: postSample.sample.length,
    postSampleSize: sampleSize,
    maxReturn,
    profilesInDb,
    uniqueMentions: allMentions.size,
    ...missing,
  };
}

async function buildUnregisteredMentionsReport(
  storage: CompositeStorage,
  query: UnregisteredMentionsQuery
): Promise<UnregisteredMentionsReport> {
  const { strategy, sampleSize, maxReturn, maxPostsPerProfile } = parseUnregisteredMentionsParams(query);

  const { set: profileSet, count: profilesInDb } = await getProfileHandleSet(storage);

  if (strategy === 'profiles') {
    return buildViaProfilesStrategy(
      storage,
      profileSet,
      profilesInDb,
      undefined,
      sampleSize,
      maxReturn,
      maxPostsPerProfile
    );
  }

  return buildViaPostsStrategy(storage, profileSet, profilesInDb, sampleSize, maxReturn);
}

export async function getUnregisteredMentionsReport(
  storage: CompositeStorage,
  query: UnregisteredMentionsQuery
): Promise<UnregisteredMentionsReport> {
  const prev = reportLock;
  let release!: () => void;
  reportLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await prev;
  try {
    return await buildUnregisteredMentionsReport(storage, query);
  } finally {
    release();
  }
}
