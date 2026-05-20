/**
 * Gera profile_ref para todos os handles no RocksDB.
 * Uso: npx tsx scripts/backfill-profile-refs.ts
 */

import { RocksDBStorage } from '../src/storage/rocksdb.js';
import { ProfileRefDb } from '../src/storage/profileRefDb.js';

const rocksPath = process.env.STORAGE_DB_PATH ?? './data/rocksdb';
const sqlitePath = process.env.SQLITE_DB_PATH ?? './data/influencer.db';

async function main(): Promise<void> {
  const rocks = new RocksDBStorage({ dbPath: rocksPath });
  const refDb = new ProfileRefDb(sqlitePath);
  const handles = await rocks.listHandles();
  const list = [...handles];
  console.log(`[backfill-profile-refs] ${list.length} handle(s) no RocksDB…`);
  const { created, existing } = refDb.backfillAllHandles(list);
  console.log(`[backfill-profile-refs] concluído: ${created} criado(s), ${existing} já existente(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
