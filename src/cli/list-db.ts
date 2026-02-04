/**
 * Lista dados armazenados no RocksDB (Level).
 *
 * Uso:
 *   npx tsx src/cli/list-db.ts                    # resumo: contagem + lista de handles
 *   npx tsx src/cli/list-db.ts --profiles         # lista todos os perfis (resumo)
 *   npx tsx src/cli/list-db.ts --profiles --json  # lista perfis em JSON (um por linha)
 *   npx tsx src/cli/list-db.ts --posts            # lista todos os posts (resumo)
 *   npx tsx src/cli/list-db.ts --handle <handle>   # exibe um perfil por handle (JSON)
 *   npx tsx src/cli/list-db.ts --bucket <nome>    # lista chaves do bucket (ex: profile, post)
 *
 * Importante: não rode com o crawler ativo (o banco fica aberto em um único processo).
 */
import { RocksDBStorage } from '../storage/rocksdb.js';

const dbPath = process.env.STORAGE_DB_PATH ?? './data/rocksdb';

function parseArgs(): {
  profiles: boolean;
  posts: boolean;
  json: boolean;
  handle: string | null;
  bucket: string | null;
} {
  const argv = process.argv.slice(2);
  let profiles = false;
  let posts = false;
  let json = false;
  let handle: string | null = null;
  let bucket: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--profiles') profiles = true;
    else if (argv[i] === '--posts') posts = true;
    else if (argv[i] === '--json') json = true;
    else if ((argv[i] === '--handle' || argv[i] === '-h') && argv[i + 1]) handle = argv[++i];
    else if (argv[i] === '--bucket' && argv[i + 1]) bucket = argv[++i];
  }
  if (!profiles && !posts && !handle && !bucket) profiles = true;
  return { profiles, posts, json, handle, bucket };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const db = new RocksDBStorage({ dbPath });

  try {
    if (args.handle) {
      const key = args.handle.toLowerCase().replace(/^@/, '');
      const value = await db.get('profile', key);
      if (value == null) {
        console.error('Perfil não encontrado:', args.handle);
        process.exit(1);
      }
      console.log(JSON.stringify(value, null, 2));
      return;
    }

    if (args.bucket) {
      const keys = await db.listKeys(args.bucket);
      console.log(`Bucket "${args.bucket}": ${keys.length} chaves`);
      keys.forEach((k) => console.log('  ', k));
      return;
    }

    if (args.profiles) {
      const items = await db.getByBucket<Record<string, unknown>>('profile');
      console.log('Perfis:', items.length);
      if (args.json) {
        items.forEach(({ key, value }) => {
          console.log(JSON.stringify({ key, ...value }));
        });
      } else {
        items.forEach(({ key, value }) => {
          const handle = value?.handle ?? key;
          const followers = value?.followers ?? '?';
          const name = value?.display_name ?? '';
          console.log(`  @${handle}  followers=${followers}  ${name ? `name="${name}"` : ''}`);
        });
      }
    }

    if (args.posts) {
      const items = await db.getByBucket<Record<string, unknown>>('post');
      console.log('Posts:', items.length);
      if (args.json) {
        items.forEach(({ key, value }) => {
          console.log(JSON.stringify({ key, ...value }));
        });
      } else {
        items.forEach(({ key, value }) => {
          const shortcode = value?.shortcode ?? value?.post_url ?? '';
          const profile = value?.profile_handle ?? '';
          console.log(`  ${key}  profile=${profile}  shortcode=${shortcode}`);
        });
      }
    }
  } finally {
    await db.close();
  }
}

main().catch((e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string } };
  if (err?.code === 'LEVEL_DATABASE_NOT_OPEN' || err?.cause?.code === 'LEVEL_LOCKED') {
    console.error('Banco está em uso por outro processo (ex.: crawler). Feche-o e tente de novo.');
  } else {
    console.error(e);
  }
  process.exit(1);
});
