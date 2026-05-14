/**
 * Meilisearch opcional: espelha o índice de busca para typo/relevância.
 * Busca textual via Meili só com `MEILISEARCH_SEARCH=1` e `MEILISEARCH_HOST` definidos.
 * A fonte da verdade continua sendo RocksDB + SQLite; o Meili é camada de consulta.
 */

import { MeiliSearch, type MeiliSearch as MeiliSearchClient } from 'meilisearch';

/** Subconjunto do payload de índice (evita import circular com `profilesSearch`). */
export interface InfluencerMeiliPayload {
  ftsText: string;
  searchBlob: string;
  followersCount?: number;
  engagementRate?: number;
  avgLikes?: number;
  postsCount?: number;
  accountType?: number | null;
  isPrivate?: boolean;
  categoriesJson?: string;
  costTier?: string | null;
}

/** Filtros numéricos/categóricos espelhados no índice Meili (sem LLM estruturado). */
export interface MeilisearchSearchFilterInput {
  excludePrivate?: boolean;
  minFollowers?: number;
  maxFollowers?: number;
  minEngagementRate?: number;
  minAvgLikes?: number;
  minPostsCount?: number;
  accountTypeFilter?: number[];
  costTiers?: string[];
}

export function buildMeilisearchFilterExpr(f: MeilisearchSearchFilterInput): string | undefined {
  const parts: string[] = [];
  if (f.excludePrivate === true) parts.push('is_private = false');
  if (f.minFollowers != null && Number.isFinite(f.minFollowers)) {
    parts.push(`followers_count >= ${Math.floor(f.minFollowers)}`);
  }
  if (f.maxFollowers != null && Number.isFinite(f.maxFollowers)) {
    parts.push(`followers_count <= ${Math.floor(f.maxFollowers)}`);
  }
  if (f.minEngagementRate != null && Number.isFinite(f.minEngagementRate)) {
    parts.push(`engagement_rate >= ${Number(f.minEngagementRate)}`);
  }
  if (f.minAvgLikes != null && Number.isFinite(f.minAvgLikes)) {
    parts.push(`avg_likes >= ${Math.floor(f.minAvgLikes)}`);
  }
  if (f.minPostsCount != null && Number.isFinite(f.minPostsCount)) {
    parts.push(`posts_count >= ${Math.floor(f.minPostsCount)}`);
  }
  if (f.accountTypeFilter != null && f.accountTypeFilter.length > 0) {
    const nums = f.accountTypeFilter.filter((n) => [1, 2, 3].includes(n));
    if (nums.length > 0) {
      parts.push(`(${nums.map((n) => `account_type = ${n}`).join(' OR ')})`);
    }
  }
  if (f.costTiers != null && f.costTiers.length > 0) {
    const allowed = new Set(['low', 'medium', 'high', 'very_high']);
    const tiers = f.costTiers.map((s) => String(s).toLowerCase()).filter((s) => allowed.has(s));
    if (tiers.length > 0) {
      parts.push(`(${tiers.map((t) => `cost_tier = "${t}"`).join(' OR ')})`);
    }
  }
  return parts.length > 0 ? parts.join(' AND ') : undefined;
}

const INDEX_ID = 'influencer_profiles';

function hostConfigured(): boolean {
  return Boolean(process.env.MEILISEARCH_HOST?.trim());
}

/** Só usa Meili na busca quando `MEILISEARCH_SEARCH=1` (opt-in explícito). */
export function isMeilisearchSearchEnabled(): boolean {
  return hostConfigured() && process.env.MEILISEARCH_SEARCH === '1';
}

function syncEnabled(): boolean {
  return hostConfigured() && process.env.MEILISEARCH_SYNC !== '0';
}

let client: MeiliSearchClient | null = null;

export function getMeiliClient(): MeiliSearchClient | null {
  if (!hostConfigured()) return null;
  if (!client) {
    const host = process.env.MEILISEARCH_HOST!.trim();
    const apiKey = process.env.MEILISEARCH_API_KEY?.trim() ?? '';
    client = new MeiliSearch({ host, apiKey });
  }
  return client;
}

let settingsPromise: Promise<void> | null = null;

function ensureIndexSettingsOnce(): void {
  const c = getMeiliClient();
  if (!c || settingsPromise) return;
  settingsPromise = (async () => {
    try {
      await c.getIndex(INDEX_ID);
    } catch {
      try {
        await c.createIndex(INDEX_ID, { primaryKey: 'id' });
      } catch {
        /* índice criado em corrida */
      }
    }
    try {
      await c.index(INDEX_ID).updateSettings({
        searchableAttributes: ['search_text'],
        filterableAttributes: [
          'followers_count',
          'engagement_rate',
          'avg_likes',
          'posts_count',
          'account_type',
          'is_private',
          'cost_tier',
          'categories',
        ],
        sortableAttributes: ['followers_count', 'engagement_rate', 'avg_likes'],
      });
    } catch (e) {
      console.warn('[meilisearch] updateSettings:', e instanceof Error ? e.message : e);
    }
  })();
}

/**
 * Rankeamento textual via Meili. Retorna null para cair no FTS5 SQLite (ex.: Meili fora ou erro).
 * Ordem dos hits = relevância Meili; `rank` decresce com a posição (compatível com o mapa FTS atual).
 */
export async function searchHandlesViaMeilisearch(
  q: string,
  limit: number,
  filterExpr?: string | null
): Promise<{ handle: string; rank: number }[] | null> {
  if (!isMeilisearchSearchEnabled()) return null;
  const c = getMeiliClient();
  if (!c) return null;
  const trimmed = q.trim();
  if (!trimmed) return null;
  const lim = Math.min(Math.max(1, Math.floor(limit)), 100_000);
  try {
    ensureIndexSettingsOnce();
    const filter = filterExpr?.trim() ? filterExpr.trim() : undefined;
    const res = await c.index(INDEX_ID).search(trimmed, {
      limit: lim,
      attributesToRetrieve: ['id'],
      ...(filter ? { filter } : {}),
    });
    const hits = res.hits as { id?: string }[];
    if (!hits.length) return null;
    const n = hits.length;
    const out: { handle: string; rank: number }[] = [];
    for (let i = 0; i < hits.length; i++) {
      const id = String(hits[i]?.id ?? '')
        .toLowerCase()
        .replace(/^@/, '');
      if (!id) continue;
      out.push({ handle: id, rank: n - i });
    }
    return out.length ? out : null;
  } catch (e) {
    console.warn('[meilisearch] search:', e instanceof Error ? e.message : e);
    return null;
  }
}

export async function upsertInfluencerToMeilisearch(
  handle: string,
  _profile: Record<string, unknown>,
  payload: InfluencerMeiliPayload
): Promise<void> {
  if (!syncEnabled()) return;
  const c = getMeiliClient();
  if (!c) return;
  const id = handle.toLowerCase().replace(/^@/, '');
  if (!id) return;
  try {
    ensureIndexSettingsOnce();
    const searchText = (payload.searchBlob || payload.ftsText || '').slice(0, 500_000);
    let categories: string[] = [];
    if (typeof payload.categoriesJson === 'string' && payload.categoriesJson.trim()) {
      try {
        const parsed = JSON.parse(payload.categoriesJson) as unknown;
        if (Array.isArray(parsed)) {
          categories = parsed.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
        }
      } catch {
        categories = [];
      }
    }
    const doc = {
      id,
      search_text: searchText,
      followers_count: payload.followersCount ?? 0,
      engagement_rate: payload.engagementRate ?? 0,
      avg_likes: payload.avgLikes ?? 0,
      posts_count: payload.postsCount ?? 0,
      account_type:
        payload.accountType != null && [1, 2, 3].includes(payload.accountType) ? payload.accountType : null,
      is_private: payload.isPrivate === true,
      cost_tier: payload.costTier != null && String(payload.costTier).trim() ? String(payload.costTier).trim().toLowerCase() : null,
      categories,
    };
    await c.index(INDEX_ID).updateDocuments([doc], { primaryKey: 'id' });
  } catch (e) {
    console.warn('[meilisearch] upsert', id, e instanceof Error ? e.message : e);
  }
}

export async function deleteInfluencerFromMeilisearch(handle: string): Promise<void> {
  if (!hostConfigured()) return;
  const c = getMeiliClient();
  if (!c) return;
  const id = handle.toLowerCase().replace(/^@/, '');
  if (!id) return;
  try {
    await c.index(INDEX_ID).deleteDocument(id);
  } catch {
    /* documento inexistente */
  }
}
