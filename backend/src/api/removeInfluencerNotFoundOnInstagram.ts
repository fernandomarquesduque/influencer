/**
 * Remove influenciador que não existe mais no Instagram (S3 + RocksDB/SQLite auxiliar).
 * Não apaga conta auth/créditos/pagamentos — só o purge admin faz isso.
 */

import { wipeInfluencerS3Prefix } from '../s3/influencerProfileStorage.js';
import type { CompositeStorage } from '../storage/compositeStorage.js';
import type { SqliteSync } from '../storage/sqliteSync.js';
import type { CreditsCampaignsDb } from '../storage/creditsCampaignsDb.js';
import type { AuthDb } from '../auth/authDb.js';

export function isProfileNotFoundExtractError(error: string | undefined | null): boolean {
  const e = String(error ?? '').trim();
  if (!e) return false;
  if (e === 'Perfil não encontrado') return true;
  return e.includes('Perfil não encontrado');
}

export type RemoveInfluencerNotFoundDeps = {
  db: CompositeStorage;
  sqlite: SqliteSync;
  creditsCampaignsDb: CreditsCampaignsDb;
  authDb: AuthDb;
};

export type RemoveInfluencerNotFoundResult = {
  handle: string;
  s3ObjectsRemoved: number;
  dbRemoved: boolean;
};

export async function removeInfluencerNotFoundOnInstagram(
  rawHandle: string,
  deps: RemoveInfluencerNotFoundDeps
): Promise<RemoveInfluencerNotFoundResult> {
  const handle = rawHandle.replace(/^@/, '').trim().toLowerCase();
  if (!handle) {
    return { handle: rawHandle, s3ObjectsRemoved: 0, dbRemoved: false };
  }

  let s3ObjectsRemoved = 0;
  try {
    s3ObjectsRemoved = await wipeInfluencerS3Prefix(handle);
  } catch (e) {
    console.error(`[remove-not-found] S3 @${handle}:`, e instanceof Error ? e.message : e);
  }

  let dbRemoved = false;
  try {
    await deps.db.deleteProfileCompletely(handle);
    dbRemoved = true;
  } catch (e) {
    console.error(`[remove-not-found] RocksDB @${handle}:`, e instanceof Error ? e.message : e);
  }

  try {
    deps.sqlite.deleteDirectQueueByHandle(handle);
    deps.sqlite.deleteAllFavoritesByProfileHandle(handle);
    deps.authDb.clearProfileVerification(handle);
    deps.creditsCampaignsDb.removeHandleFromAllCampaigns(handle);
  } catch (e) {
    console.error(`[remove-not-found] SQLite/aux @${handle}:`, e instanceof Error ? e.message : e);
  }

  return { handle, s3ObjectsRemoved, dbRemoved };
}
