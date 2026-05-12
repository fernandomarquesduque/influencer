import dotenv from 'dotenv';
dotenv.config({ override: true });
import { createStorage } from '../storage/index.js';
import type { RocksDBStorage } from '../storage/rocksdb.js';
import { runCrawl, type RunCrawlResult } from '../crawl/runCrawl.js';
import { crawlLog } from '../utils/crawlLogger.js';
import { DEFAULT_TAGS } from './defaultTags.js';

function parseArgs(): { tags: string[]; limit: number | undefined; clear: boolean; delayExtraMs: number } {
  const argv = process.argv.slice(2);
  const tags: string[] = [];
  let limit: number | undefined;
  let clear = false;
  let delayExtraMs = 0;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tag' && argv[i + 1]) {
      const t = argv[++i].replace(/^#/, '');
      if (t) tags.push(t);
    } else if (a.startsWith('--tag=')) {
      const t = a.slice(6).replace(/^#/, '');
      if (t) tags.push(t);
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
  return { tags, limit, clear, delayExtraMs };
}

function isValidTag(t: string): boolean {
  return !!t && !t.includes('node') && !t.includes('.exe');
}

/** Embaralha o array (Fisher–Yates) para processar as hashtags em ordem aleatória. */
function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function main(): Promise<void> {
  const { tags, limit, clear, delayExtraMs } = parseArgs();

  if (delayExtraMs > 0) {
    process.env.CRAWL_DELAY_EXTRA_MS = String(delayExtraMs);
  }

  const validTags = tags.length > 0 ? tags.filter(isValidTag) : DEFAULT_TAGS;
  if (validTags.length === 0) {
    console.error('Uso: npm run extract -- [--limit <n>] [--clear] [--delay-extra <ms>]');
    console.error('  Se bloquear (403/429): use --delay-extra 3000 ou CRAWL_SAFE=1 npm run extract');
    console.error('     Ou: npx tsx src/cli/crawl-hashtag.ts --tag <hashtag> [--tag ...] [--limit <n>]');
    console.error('     Sem --tag: usa a lista DEFAULT_TAGS do arquivo.');
    process.exit(1);
  }

  const order = shuffle(validTags);
  console.log('Ordem (aleatória):', order.join(' '));
  console.log('');

  const storage = createStorage({}) as RocksDBStorage;

  try {
    let totalSaved = 0;
    let lastResult: RunCrawlResult | null = null;
    for (let i = 0; i < order.length; i++) {
      const tag = order[i];
      if (lastResult !== null) {
        crawlLog(`Resumo lote anterior: ${lastResult.processed} processados, ${lastResult.failed} falharam, ${lastResult.saved} salvos.`);
      }
      console.log(`[${i + 1}/${order.length}] Hashtag: ${tag}`);
      const result = await runCrawl({ tag, limit, clear: clear && i === 0 }, storage);
      lastResult = result;
      totalSaved += result.saved;
      console.log(`  → Perfis salvos: ${result.saved}`);
    }
    console.log(`Concluído. Total de perfis salvos: ${totalSaved}`);
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
