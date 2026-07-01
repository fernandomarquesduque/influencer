import type { CompositeStorage } from '../storage/compositeStorage.js';
import {
  buildProfileSearchIndexPayload,
  getLlmQualification,
  hasCompletedLlmProfile,
  normalizeBrandSafetyLevel,
} from './profilesSearch.js';
import { snapMainCategoryToTaxonomy } from '../lib/mainCategoryTaxonomy.js';
import {
  deleteInfluencerFromMeilisearch,
  upsertInfluencerToMeilisearch,
} from '../search/meilisearchProfile.js';
import { getCostTierFromPricing, getSuggestedPricingFromFollowers } from '../utils/suggestedPricing.js';

/**
 * Corrige só `llm_qualification_json` no SQLite a partir do perfil já carregado do RocksDB.
 * Usado na fila LLM quando o índice está atrasado — não recarrega posts nem reindexa FTS.
 */
export function patchProfileSearchIndexLlmFromProfile(
  db: CompositeStorage,
  handle: string,
  profile: Record<string, unknown>
): void {
  const h = handle.toLowerCase().replace(/^@/, '');
  if (!h) return;
  const qual = getLlmQualification(profile);
  let llmQualificationJson: string | null = null;
  let llmBrandLevel: string | null = null;
  if (qual) {
    const mc = snapMainCategoryToTaxonomy(String(qual.mainCategory ?? '').trim());
    llmQualificationJson = JSON.stringify({
      ...qual,
      mainCategoryCanonical: mc ?? null,
    });
    llmBrandLevel = normalizeBrandSafetyLevel(qual.brandSafety);
  }
  db.patchProfileSearchAuxLlmFields(h, llmQualificationJson, llmBrandLevel);
}

/**
 * Atualiza FTS + `profile_search_aux` para um handle (lê perfil + posts no RocksDB).
 * Perfis sem LLM concluído permanecem no índice com `llm_qualification_json` vazio
 * (fila/cobertura do qualify); a busca pública exige `requireIndexedLlm`.
 */
export async function syncProfileSearchIndexForHandle(
  db: CompositeStorage,
  handle: string
): Promise<void> {
  const h = handle.toLowerCase().replace(/^@/, '');
  if (!h) return;
  const profile = await db.get<Record<string, unknown>>('profile', h);
  if (!profile) {
    db.deleteProfileSearchIndex(h);
    void deleteInfluencerFromMeilisearch(h).catch(() => {});
    return;
  }
  const postsRaw = await db.getByBucket<Record<string, unknown>>('post', `${h}:`);
  const posts = postsRaw.map(({ value }) => value);
  const payload = buildProfileSearchIndexPayload(profile, h, posts);
  const act = db.getActivation(h);
  let costTier = getCostTierFromPricing(act?.pricing as Record<string, unknown> | undefined);
  if (!costTier) {
    costTier = getCostTierFromPricing(
      getSuggestedPricingFromFollowers(payload.followersCount) as unknown as Record<string, unknown>
    );
  }
  db.upsertProfileSearchIndexFromPayload(h, { ...payload, costTier });
  if (hasCompletedLlmProfile(profile)) {
    void upsertInfluencerToMeilisearch(h, profile, payload).catch((e) =>
      console.warn('[meilisearch] sync:', h, e instanceof Error ? e.message : e)
    );
  } else {
    void deleteInfluencerFromMeilisearch(h).catch(() => {});
  }
}

/** Reindexa todos os perfis do RocksDB (útil após migração ou reparo). */
export async function rebuildAllProfileSearchIndexes(db: CompositeStorage): Promise<void> {
  const handles = await db.listHandles();
  const list = [...handles].sort();
  let i = 0;
  for (const h of list) {
    await syncProfileSearchIndexForHandle(db, h);
    i++;
    if (i % 500 === 0) {
      console.log(`[profile-search-index] rebuild ${i}/${list.length} handles…`);
    }
  }
  console.log(`[profile-search-index] rebuild concluído: ${list.length} handle(s).`);
}
