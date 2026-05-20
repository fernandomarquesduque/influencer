/**
 * Reindexa FTS + profile_search_aux para um handle (ou profile_ref UUID).
 * Uso: npx node@20 ./node_modules/tsx/dist/cli.mjs scripts/reindex-profile.ts marquesduque
 */
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { RocksDBStorage } from '../src/storage/rocksdb.js';
import { SqliteSync } from '../src/storage/sqliteSync.js';
import { CompositeStorage } from '../src/storage/compositeStorage.js';
import { ProfileRefDb } from '../src/storage/profileRefDb.js';
import { syncProfileSearchIndexForHandle } from '../src/api/profileSearchIndexSync.js';
import { getProfileSummary } from '../src/api/profilesSearch.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const crawlRoot = path.resolve(__dirname, '..');
const dbPath = process.env.SQLITE_DB_PATH ?? path.join(crawlRoot, 'data', 'influencer.db');
const rocksPath = process.env.ROCKSDB_PATH ?? path.join(crawlRoot, 'data', 'rocksdb');

const ident = process.argv[2];
if (!ident) {
  console.error('Uso: scripts/reindex-profile.ts <handle|profile_ref>');
  process.exit(1);
}

const refDb = new ProfileRefDb(dbPath);
const handle = refDb.resolveToHandle(ident) ?? ident.replace(/^@/, '').toLowerCase();

const rocks = new RocksDBStorage({ dbPath: rocksPath });
const sqlite = new SqliteSync(dbPath);
const db = new CompositeStorage(rocks, sqlite);

async function main() {
  console.log('Reindexando', ident, '→', handle);
  await syncProfileSearchIndexForHandle(db, handle);
  const summary = await getProfileSummary(db, handle);
  if (!summary) {
    console.log('Perfil não encontrado no RocksDB.');
    process.exit(1);
  }
  console.log('followers_count:', summary.profile.followers_count);
  console.log('engagement:', {
    er: summary.engagement.engagement_rate,
    posts: summary.engagement.posts_count,
    likes: summary.engagement.total_likes,
    comments: summary.engagement.total_comments,
  });
  const aux = db.getProfileSearchAuxRowsForHandles([handle])[0];
  console.log('aux:', aux ? { followers: aux.followers_count, er: aux.engagement_rate } : null);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
