import dotenv from 'dotenv';
dotenv.config({ override: true });
import { createStorage } from '../storage/index.js';
import type { RocksDBStorage } from '../storage/rocksdb.js';
import { runCrawl } from '../crawl/runCrawl.js';

function parseArgs(): { tag: string | null; limit: number | undefined; clear: boolean } {
  const argv = process.argv.slice(2);
  let tag: string | null = null;
  let limit: number | undefined;
  let clear = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tag' && argv[i + 1]) {
      tag = argv[++i].replace(/^#/, '');
    } else if (a.startsWith('--tag=')) {
      tag = a.slice(6).replace(/^#/, '') || null;
    } else if (a === '--limit' && argv[i + 1]) {
      const n = parseInt(argv[++i], 10);
      if (!Number.isNaN(n)) limit = n;
    } else if (a.startsWith('--limit=')) {
      const n = parseInt(a.slice(8), 10);
      if (!Number.isNaN(n)) limit = n;
    } else if (a === '--clear') {
      clear = true;
    }
  }
  return { tag, limit, clear };
}

async function main(): Promise<void> {
  const { tag, limit, clear } = parseArgs();

  if (!tag || tag.includes('node') || tag.includes('.exe')) {
    console.error('Uso: npm run crawl:hashtag -- --tag <hashtag> [--limit <número>] [--clear]');
    console.error('Ex.: npx tsx src/cli/crawl-hashtag.ts --tag viagem --limit 2 --clear');
    process.exit(1);
  }

  const storage = createStorage({}) as RocksDBStorage;

  try {
    const result = await runCrawl({ tag, limit, clear }, storage);
    console.log(`Concluído. Perfis salvos nesta execução: ${result.saved}`);
  } finally {
    if (typeof storage.close === 'function') {
      await storage.close();
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
