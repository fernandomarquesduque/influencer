/**
 * Diagnóstico rápido: seguidores / engagement de um perfil.
 * Uso: npx node@20 ./node_modules/tsx/dist/cli.mjs scripts/debug-profile-metrics.ts [profileRef|handle]
 */
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { CompositeStorage } from '../src/storage/compositeStorage.js';
import { getProfileSummary, getProfileEngagementByType } from '../src/api/profilesSearch.js';
import { ProfileRefDb } from '../src/storage/profileRefDb.js';
import { getFollowersFromProfile } from '../src/utils/suggestedPricing.js';
import { resolveFollowersCountForProfile } from '../src/utils/followersResolve.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const crawlRoot = path.resolve(__dirname, '..');
const dbPath = process.env.SQLITE_DB_PATH ?? path.join(crawlRoot, 'data', 'influencer.db');
const rocksPath = process.env.ROCKSDB_PATH ?? path.join(crawlRoot, 'data', 'rocksdb');

const ident = process.argv[2] ?? 'c74bdf61-31d7-4ad8-8d27-dc30ed4b3898';

async function main() {
  const refDb = new ProfileRefDb(dbPath);
  const handle = refDb.resolveToHandle(ident) ?? ident.replace(/^@/, '').toLowerCase();
  console.log('ident:', ident, '→ handle:', handle);

  const sqlite = new Database(dbPath, { readonly: true });
  const aux = sqlite
    .prepare(
      'SELECT followers_count, engagement_rate, posts_count, substr(engagement_json,1,200) AS eng_preview FROM profile_search_aux WHERE handle = ?'
    )
    .get(handle) as Record<string, unknown> | undefined;
  console.log('sqlite aux:', aux);

  const refRow = sqlite.prepare('SELECT profile_ref FROM profile_ref WHERE profile_handle = ?').get(handle) as
    | { profile_ref: string }
    | undefined;
  console.log('profile_ref:', refRow?.profile_ref);

  sqlite.close();

  const db = new CompositeStorage(rocksPath, dbPath);
  await db.open();

  const profile = await db.get<Record<string, unknown>>('profile', handle);
  if (!profile) {
    console.log('profile: NOT FOUND in RocksDB');
    await db.close();
    return;
  }

  const directFc = profile.followers_count;
  const entityFc = getFollowersFromProfile(profile);
  const getFollowersFn = (p: Record<string, unknown>) => {
    // profilesSearch getFollowers is not exported - use inline from summary
    return getFollowersFromProfile(p);
  };
  const auxRow = db.getProfileSearchAuxRowsForHandles([handle])[0];
  const resolved = resolveFollowersCountForProfile(profile, getFollowersFn, auxRow);

  console.log('profile.followers_count:', directFc);
  console.log('getFollowersFromProfile:', entityFc);
  console.log('resolveFollowersCountForProfile:', resolved);
  console.log('aux row followers:', auxRow?.followers_count);

  const postsRaw = await db.getByBucket<Record<string, unknown>>('post', handle + ':');
  let sampleLikes = 0;
  let totalLikes = 0;
  let totalComments = 0;
  for (const { value: p } of postsRaw.slice(0, 5)) {
    const m = p.metrics as Record<string, unknown> | undefined;
    const likes = Number(m?.likes ?? p.like_count ?? 0);
    const comments = Number(m?.comments ?? p.comment_count ?? 0);
    sampleLikes += likes;
    console.log('  post sample', p.content_type, 'likes', likes, 'comments', comments);
  }
  for (const { value: p } of postsRaw) {
    const m = p.metrics as Record<string, unknown> | undefined;
    totalLikes += Number(m?.likes ?? p.like_count ?? 0);
    totalComments += Number(m?.comments ?? p.comment_count ?? 0);
  }
  console.log('posts total:', postsRaw.length, 'likes sum:', totalLikes, 'comments sum:', totalComments);

  const summary = await getProfileSummary(db, handle);
  if (summary) {
    console.log('getProfileSummary engagement:', {
      followers: summary.profile.followers_count,
      er: summary.engagement.engagement_rate,
      posts: summary.engagement.posts_count,
      total_likes: summary.engagement.total_likes,
    });
    const byType = await getProfileEngagementByType(db, handle);
    console.log('engagementByType:', byType);
  }

  await db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
