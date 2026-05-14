/**
 * Reconstrói profile_search_fts + profile_search_aux a partir do RocksDB.
 * Uso (na pasta backend): npm run rebuild-search-index
 */
import { RocksDBStorage } from '../storage/rocksdb.js';
import { SqliteSync } from '../storage/sqliteSync.js';
import { CompositeStorage } from '../storage/compositeStorage.js';
import { rebuildAllProfileSearchIndexes } from '../api/profileSearchIndexSync.js';

const rocksPath = process.env.STORAGE_DB_PATH ?? './data/rocksdb';
const sqlitePath = process.env.SQLITE_DB_PATH ?? './data/influencer.db';

async function main(): Promise<void> {
  const rocks = new RocksDBStorage({ dbPath: rocksPath });
  const sqlite = new SqliteSync(sqlitePath);
  const db = new CompositeStorage(rocks, sqlite);
  try {
    await rebuildAllProfileSearchIndexes(db);
  } finally {
    await db.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
