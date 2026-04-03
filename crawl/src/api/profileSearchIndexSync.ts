import type { CompositeStorage } from '../storage/compositeStorage.js';
import {
  buildProfileSearchIndexPayload,
  hasCompletedLlmProfile,
} from './profilesSearch.js';

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
  db.upsertProfileSearchIndexFromPayload(h, payload);
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
