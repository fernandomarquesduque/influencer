/**
 * Verifica quantos perfis e posts estão armazenados no RocksDB.
 * Uso: npx tsx src/cli/check-db.ts
 */
import { RocksDBStorage } from '../storage/rocksdb.js';

async function main(): Promise<void> {
  const db = new RocksDBStorage({ dbPath: process.env.STORAGE_DB_PATH ?? './data/rocksdb' });
  try {
    const profileKeys = await db.listKeys('profile');
    const postKeys = await db.listKeys('post');
    console.log('RocksDB:', db['dbPath']);
    console.log('Perfis (profile):', profileKeys.length);
    console.log('Posts (post):', postKeys.length);
    if (profileKeys.length > 0) {
      console.log('Handles:', profileKeys.slice(0, 10).join(', ') + (profileKeys.length > 10 ? '...' : ''));
    }
  } finally {
    await db.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
