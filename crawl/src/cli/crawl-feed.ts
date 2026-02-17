import dotenv from 'dotenv';
dotenv.config({ override: true });
import { createStorage } from '../storage/index.js';
import type { RocksDBStorage } from '../storage/rocksdb.js';
import { runCrawlFromFeed } from '../crawl/runCrawl.js';
import { crawlLog } from '../utils/crawlLogger.js';

function parseArgs(): { limit: number | undefined; clear: boolean; delayExtraMs: number } {
  const argv = process.argv.slice(2);
  let limit: number | undefined;
  let clear = false;
  let delayExtraMs = 0;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit' && argv[i + 1]) {
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
  return { limit, clear, delayExtraMs };
}

async function main(): Promise<void> {
  const { limit, clear, delayExtraMs } = parseArgs();

  if (delayExtraMs > 0) {
    process.env.CRAWL_DELAY_EXTRA_MS = String(delayExtraMs);
  }

  const storage = createStorage({}) as RocksDBStorage;

  try {
    crawlLog('Iniciando crawl a partir do feed principal (home)...');
    const result = await runCrawlFromFeed({ limit, clear }, storage);
    console.log(`Concluído. Perfis salvos: ${result.saved} (processados: ${result.processed}, rejeitados: ${result.failed})`);
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
