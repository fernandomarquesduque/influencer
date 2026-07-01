import type { CompositeStorage } from '../storage/compositeStorage.js';
import {
  getLlmQualification,
  profileWouldSkipLlmQualify,
} from './profilesSearch.js';
import {
  patchProfileSearchIndexLlmFromProfile,
} from './profileSearchIndexSync.js';
import { foldMainCategoryKey, snapMainCategoryToTaxonomy } from '../lib/mainCategoryTaxonomy.js';

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

export interface CollectorLlmPendingItem {
  handle: string;
  profile: Record<string, unknown>;
}

interface LlmQueueCandidate extends CollectorLlmPendingItem {
  missingLlmInfo: boolean;
  qualifiedAtMs: number;
}

function candidateFromProfile(
  profile: Record<string, unknown>,
  key: string
): LlmQueueCandidate | null {
  const llm = profile.llm;
  const llmObj =
    llm != null && typeof llm === 'object' && !Array.isArray(llm) ? (llm as Record<string, unknown>) : null;
  const llmStatus = llmObj != null ? String(llmObj.status ?? '') : '';
  const qualifiedAtRaw = llmObj != null ? String(llmObj.qualifiedAt ?? '') : '';
  const qualifiedAtMs = qualifiedAtRaw ? Date.parse(qualifiedAtRaw) : Number.NaN;
  const hasValidQualifiedAt = Number.isFinite(qualifiedAtMs);
  const missingLlmInfo = llmStatus !== 'done' || !hasValidQualifiedAt;
  const handle = String(profile.handle ?? key ?? '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '');
  if (!handle) return null;
  return {
    handle,
    profile: { ...profile, handle },
    missingLlmInfo,
    qualifiedAtMs: hasValidQualifiedAt ? qualifiedAtMs : 0,
  };
}

export function compareLlmQueueCandidates(a: LlmQueueCandidate, b: LlmQueueCandidate): number {
  if (a.missingLlmInfo !== b.missingLlmInfo) return a.missingLlmInfo ? -1 : 1;
  if (a.qualifiedAtMs !== b.qualifiedAtMs) return a.qualifiedAtMs - b.qualifiedAtMs;
  return a.handle.localeCompare(b.handle, 'pt-BR');
}

function matchesMainCategory(profile: Record<string, unknown>, mainCategoryRaw: string): boolean {
  const q = getLlmQualification(profile);
  if (!q) return false;
  const rawMc = String(q.mainCategory ?? '').trim();
  return llmMainCategoryBucketsMatch(rawMc, mainCategoryRaw);
}

function updateTopK(top: LlmQueueCandidate[], cand: LlmQueueCandidate, k: number): void {
  if (k <= 0) return;
  if (top.length < k) {
    top.push(cand);
    top.sort(compareLlmQueueCandidates);
    return;
  }
  const worst = top[k - 1];
  if (compareLlmQueueCandidates(cand, worst) >= 0) return;
  top[k - 1] = cand;
  top.sort(compareLlmQueueCandidates);
}

export interface StreamLlmPendingOpts {
  refreshAll: boolean;
  handleFilter: string;
  mainCategoryRaw: string;
  offset: number;
  limit: number;
}

/** Fila sem LLM via SQLite + load pontual no RocksDB (O(limit), nao varre 40k perfis). */
async function streamLlmPendingFromSearchIndex(
  storage: CompositeStorage,
  opts: { offset: number; limit: number; refreshAll: boolean }
): Promise<CollectorLlmPendingItem[]> {
  const limit = Math.max(1, Math.floor(opts.limit));
  const items: CollectorLlmPendingItem[] = [];
  let sqlOffset = Math.max(0, Math.floor(opts.offset));
  const maxSqlSteps = 120;
  for (let step = 0; step < maxSqlSteps && items.length < limit; step++) {
    const handles = storage.listProfileSearchAuxHandlesWithoutLlm(
      Math.max(limit * 32, 64),
      sqlOffset
    );
    if (handles.length === 0) break;
    sqlOffset += handles.length;
    for (const handle of handles) {
      const existing = await storage.loadByHandle(handle);
      if (!existing || typeof existing !== 'object' || Array.isArray(existing)) continue;
      const profileRec = existing as Record<string, unknown>;
      if (!opts.refreshAll && profileWouldSkipLlmQualify(profileRec)) {
        patchProfileSearchIndexLlmFromProfile(storage, handle, profileRec);
        continue;
      }
      const cand = candidateFromProfile(profileRec, handle);
      if (!cand) continue;
      items.push({ handle: cand.handle, profile: cand.profile });
      if (items.length >= limit) break;
    }
  }
  return items;
}

/**
 * Varre perfis no RocksDB um a um (fallback lento). Ordem: pendentes, qualifiedAt, handle.
 */
async function streamLlmPendingFullScan(
  storage: CompositeStorage,
  opts: StreamLlmPendingOpts
): Promise<{ items: CollectorLlmPendingItem[] }> {
  const offset = Math.max(0, Math.floor(opts.offset));
  const limit = Math.max(1, Math.min(200, Math.floor(opts.limit)));
  const need = offset + limit;
  const mainCategoryRaw = opts.mainCategoryRaw.trim();
  const top: LlmQueueCandidate[] = [];

  await storage.forEachProfileInBucket(async (key, profile) => {
    const cand = candidateFromProfile(profile, key);
    if (!cand) return;
    if (!opts.refreshAll && profileWouldSkipLlmQualify(profile)) return;
    if (mainCategoryRaw && !matchesMainCategory(cand.profile, mainCategoryRaw)) return;
    updateTopK(top, cand, need);
  });

  const page = top.slice(offset, offset + limit).map((c) => ({ handle: c.handle, profile: c.profile }));
  return { items: page };
}

export async function streamLlmPendingPage(
  storage: CompositeStorage,
  opts: StreamLlmPendingOpts
): Promise<{ items: CollectorLlmPendingItem[]; scannedAll: boolean }> {
  const handleFilter = opts.handleFilter.trim().toLowerCase().replace(/^@/, '');
  const mainCategoryRaw = opts.mainCategoryRaw.trim();
  const offset = Math.max(0, Math.floor(opts.offset));
  const limit = Math.max(1, Math.min(200, Math.floor(opts.limit)));

  if (handleFilter) {
    const existing = await storage.loadByHandle(handleFilter);
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      return { items: [], scannedAll: true };
    }
    const cand = candidateFromProfile(existing as Record<string, unknown>, handleFilter);
    if (!cand) return { items: [], scannedAll: true };
    if (!opts.refreshAll && profileWouldSkipLlmQualify(existing as Record<string, unknown>)) {
      patchProfileSearchIndexLlmFromProfile(storage, handleFilter, existing as Record<string, unknown>);
      return { items: [], scannedAll: true };
    }
    if (mainCategoryRaw && !matchesMainCategory(cand.profile, mainCategoryRaw)) {
      return { items: [], scannedAll: true };
    }
    return { items: [{ handle: cand.handle, profile: cand.profile }], scannedAll: true };
  }

  if (!opts.refreshAll && !mainCategoryRaw) {
    const indexedItems = await streamLlmPendingFromSearchIndex(storage, {
      offset,
      limit,
      refreshAll: opts.refreshAll,
    });
    return { items: indexedItems, scannedAll: true };
  }

  const full = await streamLlmPendingFullScan(storage, opts);
  return { items: full.items, scannedAll: true };
}
