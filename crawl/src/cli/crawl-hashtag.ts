import dotenv from 'dotenv';
dotenv.config({ override: true });
import { createStorage } from '../storage/index.js';
import type { RocksDBStorage } from '../storage/rocksdb.js';
import { runCrawl } from '../crawl/runCrawl.js';

function parseArgs(): { tag: string | null; limit: number | undefined; clear: boolean; delayExtraMs: number } {
  const argv = process.argv.slice(2);
  let tag: string | null = null;
  let limit: number | undefined;
  let clear = false;
  let delayExtraMs = 0;
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
    } else if (a === '--delay-extra' && argv[i + 1]) {
      const n = parseInt(argv[++i], 10);
      if (!Number.isNaN(n) && n >= 0) delayExtraMs = n;
    } else if (a.startsWith('--delay-extra=')) {
      const n = parseInt(a.slice(14), 10);
      if (!Number.isNaN(n) && n >= 0) delayExtraMs = n;
    }
  }
  return { tag, limit, clear, delayExtraMs };
}

async function main(): Promise<void> {
  const { tag, limit, clear, delayExtraMs } = parseArgs();

  if (delayExtraMs > 0) {
    process.env.CRAWL_DELAY_EXTRA_MS = String(delayExtraMs);
  }

  if (!tag || tag.includes('node') || tag.includes('.exe')) {
    console.error('Uso: npm run crawl:hashtag -- --tag <hashtag> [--limit <número>] [--clear] [--delay-extra <ms>]');
    console.error('Ex.: npx tsx src/cli/crawl-hashtag.ts --tag viagem --limit 2 --delay-extra 2000');
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
