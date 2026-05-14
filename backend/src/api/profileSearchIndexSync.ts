import type { CompositeStorage } from '../storage/compositeStorage.js';
import {
  buildProfileSearchIndexPayload,
  hasCompletedLlmProfile,
} from './profilesSearch.js';
import { upsertInfluencerToMeilisearch } from '../search/meilisearchProfile.js';
import { getCostTierFromPricing, getSuggestedPricingFromFollowers } from '../utils/suggestedPricing.js';

/**
 * Atualiza FTS + tabela auxiliar para um handle (lê perfil + posts só deste handle no RocksDB).
 */
export async function syncProfileSearchIndexForHandle(
  db: CompositeStorage,
  handle: string
): Promise<void> {
  const h = handle.toLowerCase().replace(/^@/, '');
  if (!h) return;
  const profile = await db.get<Record<string, unknown>>('profile', h);
  if (!profile || !hasCompletedLlmProfile(profile)) {
    db.deleteProfileSearchIndex(h);
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
  void upsertInfluencerToMeilisearch(h, profile, payload).catch((e) =>
    console.warn('[meilisearch] sync:', h, e instanceof Error ? e.message : e)
  );
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
