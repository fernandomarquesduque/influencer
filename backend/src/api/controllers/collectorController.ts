import type { Request, Response } from 'express';
import {
  getLlmQualification,
  hasCompletedLlmProfile,
  scheduleSearchCacheRewarmDebounced,
  warmSearchCache,
} from '../profilesSearch.js';
import type { CompositeStorage } from '../../storage/compositeStorage.js';
import type { Entity } from '../../types/index.js';
import { resyncInfluencerS3AfterDbMediaReset } from '../../storage/s3InfluencerImage.js';
import { buildExpectedPostKeySet, pruneStalePostMediaAfterSave } from '../../storage/postMediaKeys.js';
import { buildNormalizedPost } from '../../utils/slimPost.js';
import type { SlimProfile } from '../../utils/slimProfile.js';
import { mergeProfilePreservingLlm } from '../../utils/preserveLlmOnProfileMerge.js';
import { foldMainCategoryKey, snapMainCategoryToTaxonomy } from '../../lib/mainCategoryTaxonomy.js';

/** Mesma regra que em `bumpFacetMainCategory` (busca): canônico ou texto bruto se o snap falhar. */
function llmMainCategoryBucket(raw: string): string | null {
  const t = String(raw ?? '').trim();
  if (!t) return null;
  return snapMainCategoryToTaxonomy(t) ?? t;
}

function llmMainCategoryBucketsMatch(rawProfileMc: string, filterRaw: string): boolean {
  const a = llmMainCategoryBucket(rawProfileMc);
  const b = llmMainCategoryBucket(filterRaw);
  if (!a || !b) return false;
  return foldMainCategoryKey(a) === foldMainCategoryKey(b);
}

type LlmMainCategoryLabelsPayload = {
  items: Array<{ label: string; count: number }>;
  labels: string[];
  totalDistinct: number;
  returned: number;
  totalInfluencersLlm: number;
  listTruncated: boolean;
  cached?: boolean;
};

const LLM_MAIN_CATEGORIES_CACHE_TTL_MS = 10 * 60 * 1000;
let llmMainCategoryLabelsCache: { data: LlmMainCategoryLabelsPayload; fetchedAt: number } | null = null;

function invalidateLlmMainCategoryLabelsCache(): void {
  llmMainCategoryLabelsCache = null;
}

type LlmCoverageCounts = { totalProfiles: number; withoutLlm: number; withLlm: number };

const LLM_COVERAGE_STATS_CACHE_TTL_MS = 2 * 60 * 1000;
let llmCoverageStatsCache: { data: LlmCoverageCounts; fetchedAt: number } | null = null;

function invalidateLlmCoverageStatsCache(): void {
  llmCoverageStatsCache = null;
}

function invalidateLlmCollectorStatsCaches(): void {
  invalidateLlmMainCategoryLabelsCache();
  invalidateLlmCoverageStatsCache();
}

async function getLlmCoverageCountsFromStorage(storage: CompositeStorage): Promise<LlmCoverageCounts> {
  const totalProfiles = await storage.countKeysInBucket('profile');
  const withLlm = storage.countProfileSearchAuxWithLlm();
  const withoutLlm = Math.max(0, totalProfiles - withLlm);
  return { totalProfiles, withoutLlm, withLlm };
}

async function getLlmCoverageCountsCached(
  storage: CompositeStorage,
  forceRefresh = false
): Promise<LlmCoverageCounts & { cached: boolean }> {
  const now = Date.now();
  const cache = llmCoverageStatsCache;
  const cacheFresh =
    !forceRefresh && cache != null && now - cache.fetchedAt < LLM_COVERAGE_STATS_CACHE_TTL_MS;
  if (cacheFresh) return { ...cache.data, cached: true };
  const data = await getLlmCoverageCountsFromStorage(storage);
  llmCoverageStatsCache = { data, fetchedAt: now };
  return { ...data, cached: false };
}

function isLlmPendingStatsOnlyRequest(opts: {
  includeContent: boolean;
  limit: number;
  offset: number;
  handleFilter: string;
  mainCategoryRaw: string;
}): boolean {
  return (
    !opts.includeContent &&
    opts.limit <= 1 &&
    opts.offset === 0 &&
    !opts.handleFilter &&
    !opts.mainCategoryRaw
  );
}

function aggregateLlmMainCategoryLabelsFromStorage(storage: CompositeStorage): LlmMainCategoryLabelsPayload {
  const rawRows = storage.aggregateLlmMainCategoryLabelCounts();
  const acc = new Map<string, number>();
  for (const { label, count } of rawRows) {
    const bucket = llmMainCategoryBucket(label);
    if (!bucket) continue;
    acc.set(bucket, (acc.get(bucket) ?? 0) + count);
  }
  const sorted = [...acc.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'));
  let totalInfluencersLlm = 0;
  for (const [, c] of sorted) totalInfluencersLlm += c;
  const rowsAll = sorted.map(([label, count]) => ({ label, count }));
  return {
    items: rowsAll,
    labels: rowsAll.map((r) => r.label),
    totalDistinct: acc.size,
    returned: rowsAll.length,
    totalInfluencersLlm,
    listTruncated: false,
  };
}

type JsonRecord = Record<string, unknown>;

export interface CollectorIngestResponse {
  ok: true;
  handle: string;
  /** true se já existia perfil no RocksDB (merge aplicado) */
  updated: boolean;
}

export interface CollectorIngestFullResponse extends CollectorIngestResponse {
  savedPosts: number;
  savedReels: number;
  savedTagged: number;
}

export interface CollectorLlmPendingItem {
  handle: string;
  profile: Record<string, unknown>;
}

interface LlmQueueCandidate extends CollectorLlmPendingItem {
  missingLlmInfo: boolean;
  qualifiedAtMs: number;
}

/** Nó já chegou normalizado pelo coletor (evita segundo parse de GraphQL gigante no servidor). */
function isPreNormalizedMediaNode(item: unknown): boolean {
  if (item == null || typeof item !== 'object' || Array.isArray(item)) return false;
  const o = item as Record<string, unknown>;
  const post = o.post;
  const influencer = o.influencer;
  if (post == null || typeof post !== 'object' || influencer == null || typeof influencer !== 'object') return false;
  const sc = String((post as Record<string, unknown>).shortcode ?? '').trim();
  return sc.length > 0;
}

function normalizeRawMediaNodes(nodes: unknown[], collectedAt: string): Entity[] {
  const out: Entity[] = [];
  const seen = new Set<string>();
  for (const item of nodes) {
    if (item == null || typeof item !== 'object') continue;
    if (isPreNormalizedMediaNode(item)) {
      const o = item as Record<string, unknown>;
      const sc = String((o.post as Record<string, unknown>).shortcode ?? '').trim();
      if (!sc || seen.has(sc)) continue;
      seen.add(sc);
      out.push(item as Entity);
      continue;
    }
    const node = item as Record<string, unknown>;
    const code = node.shortcode ?? node.code;
    if (code == null) continue;
    const sc = String(code);
    if (seen.has(sc)) continue;
    seen.add(sc);
    try {
      out.push(buildNormalizedPost(node, collectedAt) as Entity);
    } catch (e) {
      console.warn('[collector-ingest-full] node ignorado', sc, e instanceof Error ? e.message : e);
    }
  }
  return out;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function firstNonEmptyString(values: unknown[]): string {
  for (const value of values) {
    const s = String(value ?? '').trim();
    if (s) return s;
  }
  return '';
}

function extractPostText(post: Record<string, unknown>): string {
  const content =
    post.content != null && typeof post.content === 'object' && !Array.isArray(post.content)
      ? (post.content as Record<string, unknown>)
      : null;
  const direct = firstNonEmptyString([
    content?.caption_text,
    content?.accessibility_caption,
    post.caption_text,
    post.caption,
    post.text,
    post.description,
    post.title,
  ]);
  if (direct) return direct;
  const captionObj = post.caption;
  if (captionObj != null && typeof captionObj === 'object' && !Array.isArray(captionObj)) {
    const nested = firstNonEmptyString([(captionObj as Record<string, unknown>).text]);
    if (nested) return nested;
  }
  const nodeCaption = post.edge_media_to_caption;
  if (nodeCaption != null && typeof nodeCaption === 'object' && !Array.isArray(nodeCaption)) {
    const edges = asArray((nodeCaption as Record<string, unknown>).edges);
    for (const edge of edges) {
      if (edge == null || typeof edge !== 'object' || Array.isArray(edge)) continue;
      const node = (edge as Record<string, unknown>).node;
      if (node == null || typeof node !== 'object' || Array.isArray(node)) continue;
      const text = firstNonEmptyString([(node as Record<string, unknown>).text]);
      if (text) return text;
    }
  }
  return '';
}

function extractPostHashtags(post: Record<string, unknown>): string[] {
  const content =
    post.content != null && typeof post.content === 'object' && !Array.isArray(post.content)
      ? (post.content as Record<string, unknown>)
      : null;
  const raw = asArray(content?.hashtags ?? post.hashtags);
  const tags: string[] = [];
  for (const item of raw) {
    const tag = String(item ?? '')
      .trim()
      .replace(/^#/, '')
      .toLowerCase();
    if (!tag || tags.includes(tag)) continue;
    tags.push(tag);
    if (tags.length >= 10) break;
  }
  return tags;
}

function buildLlmContentContext(rows: Array<{ key: string; value: Record<string, unknown> }>, maxItems: number): JsonRecord {
  const counts = { post: 0, reel: 0, tagged: 0, other: 0 };
  const normalized = rows
    .map(({ key, value }) => {
      const parts = String(key).split(':');
      const kind = parts[1] || 'other';
      const shortcode = parts[2] || String(value.shortcode ?? '').trim();
      const collectedAt = firstNonEmptyString([value._collected_at, value.collected_at, value.taken_at]);
      const text = extractPostText(value);
      const hashtags = extractPostHashtags(value);
      return { kind, shortcode, collectedAt, text, hashtags };
    })
    .filter((item) => item.shortcode || item.text);

  for (const item of normalized) {
    if (item.kind === 'post') counts.post += 1;
    else if (item.kind === 'reel') counts.reel += 1;
    else if (item.kind === 'tagged') counts.tagged += 1;
    else counts.other += 1;
  }

  normalized.sort((a, b) => Date.parse(b.collectedAt || '') - Date.parse(a.collectedAt || ''));
  const samples = normalized.slice(0, Math.max(1, maxItems)).map((item) => ({
    kind: item.kind,
    shortcode: item.shortcode || null,
    collectedAt: item.collectedAt || null,
    text: item.text || '',
    hashtags: item.hashtags,
  }));

  return {
    mediaCounts: counts,
    samples,
  };
}

/**
 * Controller: ingest do influencer-collector → RocksDB (`ingestProfile` slim · `ingestProfileFull` + mídias).
 */
export function createCollectorController(storage: CompositeStorage) {
  return {
    /**
     * POST body: objeto JSON do perfil (campos slim + handle obrigatório).
     * Faz merge com registro existente no bucket profile.
     */
    async ingestProfile(req: Request, res: Response): Promise<void> {
      try {
        const body = req.body as Record<string, unknown> | null;
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          res.status(400).json({
            error: 'Body deve ser um objeto JSON com os campos do perfil (incluindo handle).',
            code: 'COLLECTOR_INGEST_INVALID_BODY',
          });
          return;
        }

        const handle = String(body.handle ?? '')
          .trim()
          .toLowerCase()
          .replace(/^@/, '');
        if (!handle) {
          res.status(400).json({
            error: 'Campo handle é obrigatório.',
            code: 'COLLECTOR_INGEST_MISSING_HANDLE',
          });
          return;
        }

        const existing = await storage.loadByHandle(handle);
        const existingRec =
          existing != null && typeof existing === 'object' && !Array.isArray(existing)
            ? (existing as Record<string, unknown>)
            : null;
        const merged = mergeProfilePreservingLlm(existingRec, { ...body, handle });

        await storage.save(merged as Entity & { handle: string }, { skipSearchInvalidation: true });

        await storage.finalizeSearchAfterHandlePersist(handle);
        scheduleSearchCacheRewarmDebounced(storage);

        const payload: CollectorIngestResponse = {
          ok: true,
          handle,
          updated: existing != null,
        };
        res.status(200).json(payload);
      } catch (e) {
        console.error('[collectorController.ingestProfile]', e instanceof Error ? e.stack : e);
        res.status(500).json({
          error: e instanceof Error ? e.message : String(e),
          code: 'COLLECTOR_INGEST_ERROR',
        });
      }
    },

    /**
     * Perfil + nós brutos GraphQL (feed, reels, marcados) → normaliza com buildNormalizedPost e grava no RocksDB.
     * Substitui posts/reels/tagged anteriores desse handle.
     */
    async ingestProfileFull(req: Request, res: Response): Promise<void> {
      try {
        const body = req.body as Record<string, unknown> | null;
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          res.status(400).json({
            error: 'Body inválido. Envie { profile, feedMedia?, reelMedia?, taggedMedia? }.',
            code: 'COLLECTOR_INGEST_FULL_INVALID',
          });
          return;
        }

        const profileObj = body.profile as Record<string, unknown> | undefined;
        const flatProfile =
          profileObj != null && typeof profileObj === 'object'
            ? profileObj
            : (body as Record<string, unknown>);

        const handle = String(flatProfile.handle ?? body.handle ?? '')
          .trim()
          .toLowerCase()
          .replace(/^@/, '');
        if (!handle) {
          res.status(400).json({
            error: 'profile.handle (ou handle) é obrigatório.',
            code: 'COLLECTOR_INGEST_MISSING_HANDLE',
          });
          return;
        }

        const collectedAt = String(
          flatProfile._collected_at ?? body._collected_at ?? new Date().toISOString()
        );

        const feedRaw = asArray(body.feedMedia ?? body.feed_media);
        const reelRaw = asArray(body.reelMedia ?? body.reel_media);
        const taggedRaw = asArray(body.taggedMedia ?? body.tagged_media);

        const posts = normalizeRawMediaNodes(feedRaw, collectedAt);
        const reels = normalizeRawMediaNodes(reelRaw, collectedAt);
        const tagged = normalizeRawMediaNodes(taggedRaw, collectedAt);

        const existing = await storage.loadByHandle(handle);
        const existingRec =
          existing != null && typeof existing === 'object' && !Array.isArray(existing)
            ? (existing as Record<string, unknown>)
            : null;
        const slimMerge = mergeProfilePreservingLlm(existingRec, { ...flatProfile, handle });

        await resyncInfluencerS3AfterDbMediaReset(slimMerge as SlimProfile, {
          posts,
          reels,
          tagged,
          highlights: [],
        });
        const skip = { skipSearchInvalidation: true } as const;
        await storage.save(slimMerge as Entity & { handle: string }, skip);

        let savedPosts = 0;
        let savedReels = 0;
        let savedTagged = 0;
        if (posts.length > 0) {
          savedPosts = await storage.saveMedia(handle, 'post', posts, collectedAt, skip);
        }
        if (reels.length > 0) {
          savedReels = await storage.saveMedia(handle, 'reel', reels, collectedAt, skip);
        }
        if (tagged.length > 0) {
          savedTagged = await storage.saveMedia(handle, 'tagged', tagged, collectedAt, skip);
        }

        const keepKeys = buildExpectedPostKeySet(handle, posts, reels, tagged, []);
        await pruneStalePostMediaAfterSave(storage, handle, keepKeys);

        await storage.finalizeSearchAfterHandlePersist(handle);
        scheduleSearchCacheRewarmDebounced(storage);

        const payload: CollectorIngestFullResponse = {
          ok: true,
          handle,
          updated: existing != null,
          savedPosts,
          savedReels,
          savedTagged,
        };
        res.status(200).json(payload);
      } catch (e) {
        console.error('[collectorController.ingestProfileFull]', e instanceof Error ? e.stack : e);
        res.status(500).json({
          error: e instanceof Error ? e.message : String(e),
          code: 'COLLECTOR_INGEST_FULL_ERROR',
        });
      }
    },

    /**
     * Confirma se o perfil existe no RocksDB (e contagens de mídia) — para o collector validar após ingest.
     */
    async verifyProfile(req: Request, res: Response): Promise<void> {
      try {
        const fromQuery = String(req.query.handle ?? '')
          .trim()
          .toLowerCase()
          .replace(/^@/, '');
        const body = req.body as { handle?: string } | null | undefined;
        const fromBody =
          body != null && typeof body === 'object' && !Array.isArray(body)
            ? String(body.handle ?? '')
                .trim()
                .toLowerCase()
                .replace(/^@/, '')
            : '';
        const handle = fromQuery || fromBody;
        if (!handle) {
          res.status(400).json({
            error: 'Informe o handle: GET ?handle=usuario ou POST JSON { "handle": "usuario" }.',
            code: 'COLLECTOR_VERIFY_MISSING_HANDLE',
          });
          return;
        }

        const profile = await storage.loadByHandle(handle);
        if (!profile) {
          res.status(200).json({
            ok: true,
            found: false,
            handle,
            message: 'Perfil não encontrado no RocksDB.',
          });
          return;
        }

        const p = profile as Record<string, unknown>;
        const rows = await storage.getByBucket<Record<string, unknown>>('post', `${handle}:`);
        let post = 0;
        let reel = 0;
        let tagged = 0;
        for (const { key } of rows) {
          const kind = key.split(':')[1];
          if (kind === 'post') post += 1;
          else if (kind === 'reel') reel += 1;
          else if (kind === 'tagged') tagged += 1;
        }

        res.status(200).json({
          ok: true,
          found: true,
          handle,
          full_name: p.full_name ?? null,
          followers_count: typeof p.followers_count === 'number' ? p.followers_count : null,
          _collected_at: p._collected_at != null ? String(p._collected_at) : null,
          mediaCounts: { post, reel, tagged },
          message: 'Perfil presente no RocksDB.',
        });
      } catch (e) {
        console.error('[collectorController.verifyProfile]', e instanceof Error ? e.stack : e);
        res.status(500).json({
          error: e instanceof Error ? e.message : String(e),
          code: 'COLLECTOR_VERIFY_ERROR',
        });
      }
    },

    /**
     * Lista perfis ainda não qualificados por LLM (llm.status !== "done").
     * Usado pelo worker qualify rodando fora do servidor (via API segura por X-Collector-Key).
     */
    async listLlmPending(req: Request, res: Response): Promise<void> {
      try {
        const limitRaw = Number(req.query.limit ?? 20);
        const offsetRaw = Number(req.query.offset ?? 0);
        const refreshAllRaw = String(req.query.refreshAll ?? '').trim().toLowerCase();
        const refreshAll = refreshAllRaw === '1' || refreshAllRaw === 'true' || refreshAllRaw === 'yes';
        const includeContentRaw = String(req.query.includeContent ?? '').trim().toLowerCase();
        const includeContent =
          includeContentRaw === '1' || includeContentRaw === 'true' || includeContentRaw === 'yes';
        const mediaLimitRaw = Number(req.query.mediaLimit ?? 24);
        const mediaLimit = Math.max(1, Math.min(60, Number.isFinite(mediaLimitRaw) ? Math.floor(mediaLimitRaw) : 24));
        const limit = Math.max(1, Math.min(200, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 20));
        const offset = Math.max(0, Number.isFinite(offsetRaw) ? Math.floor(offsetRaw) : 0);
        const handleFilter = String(req.query.handle ?? '')
          .trim()
          .toLowerCase()
          .replace(/^@/, '');
        const mainCategoryRaw = String(req.query.mainCategory ?? '').trim();
        const forceRefresh =
          String(req.query.refresh ?? '').trim() === '1' ||
          String(req.query.refresh ?? '').trim().toLowerCase() === 'true';
        const coverageStatsRaw = String(req.query.coverageStats ?? '').trim().toLowerCase();
        const coverageStats = coverageStatsRaw === '1' || coverageStatsRaw === 'true' || coverageStatsRaw === 'yes';

        if (coverageStats) {
          const counts = await getLlmCoverageCountsCached(storage, forceRefresh);
          res.status(200).json({
            ok: true,
            totalProfiles: counts.totalProfiles,
            withoutLlm: counts.withoutLlm,
            withLlm: counts.withLlm,
            cached: counts.cached,
          });
          return;
        }

        if (
          isLlmPendingStatsOnlyRequest({
            includeContent,
            limit,
            offset,
            handleFilter,
            mainCategoryRaw,
          })
        ) {
          const counts = await getLlmCoverageCountsCached(storage, forceRefresh);
          const totalPending = refreshAll ? counts.totalProfiles : counts.withoutLlm;
          res.status(200).json({
            ok: true,
            totalPending,
            limit,
            offset,
            items: [],
            cached: counts.cached,
          });
          return;
        }

        const profiles = await storage.getByBucket<Record<string, unknown>>('profile');
        const pending: LlmQueueCandidate[] = [];
        for (const { key, value } of profiles) {
          const profile = value as Record<string, unknown>;
          const llm = profile.llm;
          const llmObj =
            llm != null && typeof llm === 'object' && !Array.isArray(llm) ? (llm as Record<string, unknown>) : null;
          const llmStatus = llmObj != null ? String(llmObj.status ?? '') : '';
          const qualifiedAtRaw = llmObj != null ? String(llmObj.qualifiedAt ?? '') : '';
          const qualifiedAtMs = qualifiedAtRaw ? Date.parse(qualifiedAtRaw) : Number.NaN;
          const hasValidQualifiedAt = Number.isFinite(qualifiedAtMs);
          const missingLlmInfo = llmStatus !== 'done' || !hasValidQualifiedAt;
          if (!refreshAll && !missingLlmInfo) continue;
          const handle = String(profile.handle ?? key ?? '')
            .trim()
            .toLowerCase()
            .replace(/^@/, '');
          if (!handle) continue;
          pending.push({
            handle,
            profile: { ...profile, handle },
            missingLlmInfo,
            qualifiedAtMs: hasValidQualifiedAt ? qualifiedAtMs : 0,
          });
        }

        pending.sort((a, b) => {
          if (a.missingLlmInfo !== b.missingLlmInfo) return a.missingLlmInfo ? -1 : 1;
          if (a.qualifiedAtMs !== b.qualifiedAtMs) return a.qualifiedAtMs - b.qualifiedAtMs;
          return a.handle.localeCompare(b.handle, 'pt-BR');
        });

        let afterMainCategory = pending;
        if (mainCategoryRaw) {
          afterMainCategory = pending.filter((item) => {
            const q = getLlmQualification(item.profile);
            if (!q) return false;
            const rawMc = String(q.mainCategory ?? '').trim();
            return llmMainCategoryBucketsMatch(rawMc, mainCategoryRaw);
          });
        }

        const filtered = handleFilter ? afterMainCategory.filter((p) => p.handle === handleFilter) : afterMainCategory;
        const totalPending = filtered.length;
        const page = filtered.slice(offset, offset + limit);
        const items: CollectorLlmPendingItem[] = [];
        for (const item of page) {
          if (!includeContent) {
            items.push({ handle: item.handle, profile: item.profile });
            continue;
          }
          const mediaRows = await storage.getByBucket<Record<string, unknown>>('post', `${item.handle}:`);
          const llmContent = buildLlmContentContext(mediaRows, mediaLimit);
          items.push({
            handle: item.handle,
            profile: {
              ...item.profile,
              _llm_content: llmContent,
            },
          });
        }
        res.status(200).json({
          ok: true,
          totalPending,
          limit,
          offset,
          items,
        });
      } catch (e) {
        console.error('[collectorController.listLlmPending]', e instanceof Error ? e.stack : e);
        res.status(500).json({
          error: e instanceof Error ? e.message : String(e),
          code: 'COLLECTOR_LLM_PENDING_ERROR',
        });
      }
    },

    /**
     * Agrega `qualification.mainCategory` (LLM concluído) via índice SQLite (`profile_search_aux`).
     * Chave = taxonomia canônica ou texto bruto se o snap não encaixar (alinhado à busca / filtro da fila).
     * Sem `limit` na query: devolve todas as facetas + contagens. `limit` positivo corta a lista ordenada (máx. 100k).
     */
    async listLlmMainCategoryLabels(req: Request, res: Response): Promise<void> {
      try {
        const limitStr = req.query.limit;
        const limitParsed =
          limitStr != null && String(limitStr).trim() !== '' ? Number(limitStr) : Number.NaN;
        const hasCap = Number.isFinite(limitParsed) && limitParsed > 0;
        const cap = hasCap ? Math.max(1, Math.min(100_000, Math.floor(limitParsed))) : null;
        const forceRefresh =
          String(req.query.refresh ?? '').trim() === '1' ||
          String(req.query.refresh ?? '').trim().toLowerCase() === 'true';

        const now = Date.now();
        const cache = llmMainCategoryLabelsCache;
        const cacheFresh =
          !forceRefresh && cache != null && now - cache.fetchedAt < LLM_MAIN_CATEGORIES_CACHE_TTL_MS;
        const base = cacheFresh
          ? cache.data
          : (() => {
              const data = aggregateLlmMainCategoryLabelsFromStorage(storage);
              llmMainCategoryLabelsCache = { data, fetchedAt: now };
              return data;
            })();

        const rowsAll = base.items;
        const rows = cap != null ? rowsAll.slice(0, cap) : rowsAll;
        const labels = rows.map((r) => r.label);
        res.status(200).json({
          ok: true,
          items: rows,
          labels,
          totalDistinct: base.totalDistinct,
          returned: rows.length,
          totalInfluencersLlm: base.totalInfluencersLlm,
          listTruncated: cap != null && rowsAll.length > rows.length,
          cached: cacheFresh,
        });
      } catch (e) {
        console.error('[collectorController.listLlmMainCategoryLabels]', e instanceof Error ? e.stack : e);
        res.status(500).json({
          error: e instanceof Error ? e.message : String(e),
          code: 'COLLECTOR_LLM_MAIN_CATEGORIES_ERROR',
        });
      }
    },

    /**
     * Ingest de classificação LLM no mesmo JSON do perfil.
     * Body: { handle: string, llm: object }
     */
    async ingestLlm(req: Request, res: Response): Promise<void> {
      try {
        const body = req.body as Record<string, unknown> | null;
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          res.status(400).json({
            error: 'Body deve ser objeto JSON com { handle, llm }.',
            code: 'COLLECTOR_LLM_INVALID_BODY',
          });
          return;
        }
        const handle = String(body.handle ?? '')
          .trim()
          .toLowerCase()
          .replace(/^@/, '');
        if (!handle) {
          res.status(400).json({
            error: 'Campo handle é obrigatório.',
            code: 'COLLECTOR_LLM_MISSING_HANDLE',
          });
          return;
        }
        const llm = body.llm;
        if (llm == null || typeof llm !== 'object' || Array.isArray(llm)) {
          res.status(400).json({
            error: 'Campo llm deve ser um objeto.',
            code: 'COLLECTOR_LLM_MISSING_PAYLOAD',
          });
          return;
        }

        const existing = await storage.loadByHandle(handle);
        if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
          res.status(404).json({
            error: 'Perfil não encontrado para este handle.',
            code: 'COLLECTOR_LLM_PROFILE_NOT_FOUND',
          });
          return;
        }

        const allowRaw = String(req.query.allowLlmReplace ?? '').trim().toLowerCase();
        const allowLlmReplace = allowRaw === '1' || allowRaw === 'true' || allowRaw === 'yes';
        const exRec = existing as Record<string, unknown>;
        if (!allowLlmReplace && hasCompletedLlmProfile(exRec)) {
          res.status(409).json({
            error:
              'Já existe classificação LLM concluída para este perfil. Inclua ?allowLlmReplace=1 na URL para substituir (reprocessamento explícito).',
            code: 'COLLECTOR_LLM_ALREADY_COMPLETED',
          });
          return;
        }

        const merged = {
          ...exRec,
          handle,
          llm,
        };
        await storage.save(merged as Entity & { handle: string }, { skipSearchInvalidation: true });
        invalidateLlmCollectorStatsCaches();
        // Nao await warmSearchCache aqui: recarrega profile+post inteiro do disco e pode levar minutos,
        // fazendo o qualify abortar o POST (QUALIFY_INGEST_TIMEOUT_MS). Rewarm em background mantem o mesmo destino final.
        scheduleSearchCacheRewarmDebounced(storage);

        res.status(200).json({
          ok: true,
          handle,
          updated: true,
        });
      } catch (e) {
        console.error('[collectorController.ingestLlm]', e instanceof Error ? e.stack : e);
        res.status(500).json({
          error: e instanceof Error ? e.message : String(e),
          code: 'COLLECTOR_LLM_INGEST_ERROR',
        });
      }
    },

    /**
     * Persiste sentimento LLM por post/reel (bucket `post`, chave handle:kind:shortcode).
     * Body: { handle, model?, items: [{ kind, shortcode, sentiment, confidence? }] }
     */
    async ingestPostSentiments(req: Request, res: Response): Promise<void> {
      try {
        const body = req.body as Record<string, unknown> | null;
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          res.status(400).json({
            error: 'Body deve ser objeto JSON com { handle, items }.',
            code: 'COLLECTOR_POST_SENTIMENT_INVALID_BODY',
          });
          return;
        }
        const handle = String(body.handle ?? '')
          .trim()
          .toLowerCase()
          .replace(/^@/, '');
        if (!handle) {
          res.status(400).json({
            error: 'Campo handle é obrigatório.',
            code: 'COLLECTOR_POST_SENTIMENT_MISSING_HANDLE',
          });
          return;
        }
        const itemsRaw = body.items;
        if (!Array.isArray(itemsRaw) || itemsRaw.length === 0) {
          res.status(400).json({
            error: 'Campo items deve ser um array não vazio.',
            code: 'COLLECTOR_POST_SENTIMENT_MISSING_ITEMS',
          });
          return;
        }
        const model = String(body.model ?? 'qualify-post-sentiment').trim() || 'qualify-post-sentiment';
        const analyzedAt = new Date().toISOString();
        let updated = 0;
        let skipped = 0;
        const errors: string[] = [];

        for (const row of itemsRaw.slice(0, 80)) {
          if (row == null || typeof row !== 'object' || Array.isArray(row)) {
            skipped++;
            continue;
          }
          const o = row as Record<string, unknown>;
          const kind = String(o.kind ?? 'post')
            .trim()
            .toLowerCase();
          const mediaKind = kind === 'reel' || kind === 'tagged' ? kind : 'post';
          const shortcode = String(o.shortcode ?? '').trim();
          if (!shortcode) {
            skipped++;
            continue;
          }
          const sentimentToken = String(o.sentiment ?? '')
            .trim()
            .toLowerCase()
            .split(/\s+/)[0]
            ?.replace(/[^a-z]/g, '') ?? '';
          let sentiment: 'positivo' | 'negativo' | null = null;
          if (sentimentToken === 'positivo' || sentimentToken === 'positive' || sentimentToken === 'pos') {
            sentiment = 'positivo';
          } else if (sentimentToken === 'negativo' || sentimentToken === 'negative' || sentimentToken === 'neg') {
            sentiment = 'negativo';
          }
          if (!sentiment) {
            skipped++;
            continue;
          }
          const key = `${handle}:${mediaKind}:${shortcode}`;
          const existing = await storage.get<Record<string, unknown>>('post', key);
          if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
            errors.push(`${key}: post não encontrado`);
            skipped++;
            continue;
          }
          const confRaw = Number(o.confidence);
          const confidence = Number.isFinite(confRaw) ? Math.max(0, Math.min(1, confRaw)) : undefined;
          const prevLlm =
            existing.llm != null && typeof existing.llm === 'object' && !Array.isArray(existing.llm)
              ? (existing.llm as Record<string, unknown>)
              : {};
          const nextLlm: Record<string, unknown> = {
            ...prevLlm,
            sentiment,
            analyzedAt,
            model,
          };
          if (confidence != null) nextLlm.confidence = confidence;
          await storage.set('post', key, { ...existing, llm: nextLlm }, { skipSearchInvalidation: true });
          updated++;
        }

        if (updated > 0) scheduleSearchCacheRewarmDebounced(storage);

        res.status(200).json({
          ok: true,
          handle,
          updated,
          skipped,
          errors: errors.length > 0 ? errors.slice(0, 20) : undefined,
        });
      } catch (e) {
        console.error('[collectorController.ingestPostSentiments]', e instanceof Error ? e.stack : e);
        res.status(500).json({
          error: e instanceof Error ? e.message : String(e),
          code: 'COLLECTOR_POST_SENTIMENT_INGEST_ERROR',
        });
      }
    },
  };
}

export type CollectorController = ReturnType<typeof createCollectorController>;
