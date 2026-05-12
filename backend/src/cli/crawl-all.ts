import dotenv from 'dotenv';
dotenv.config({ override: true });
import { createStorage } from '../storage/index.js';
import type { RocksDBStorage } from '../storage/rocksdb.js';
import { runCrawl, runCrawlFromExplore, runCrawlFromFeed } from '../crawl/runCrawl.js';
import { crawlLog } from '../utils/crawlLogger.js';
import { DEFAULT_TAGS } from './defaultTags.js';

/** Embaralha o array (Fisher–Yates) para ordem aleatória a cada execução. */
function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function parseArgs(): { limit: number; clear: boolean; delayExtraMs: number } {
  const argv = process.argv.slice(2);
  let limit = 30;
  let clear = false;
  let delayExtraMs = 0;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit' && argv[i + 1]) {
      const n = parseInt(argv[++i], 10);
      if (!Number.isNaN(n) && n > 0) limit = n;
    } else if (a.startsWith('--limit=')) {
      const n = parseInt(a.slice(8), 10);
      if (!Number.isNaN(n) && n > 0) limit = n;
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
  let totalSaved = 0;
  let round = 0;
  const tagsRotation = shuffle(DEFAULT_TAGS);

  try {
    crawlLog('=== Ciclo infinito: 1 hashtag por ciclo (ordem aleatória) → Explore → Feed; Ctrl+C para parar ===');
    crawlLog('');

    while (true) {
      round++;
      const tag = tagsRotation[(round - 1) % tagsRotation.length];
      crawlLog(`========== CICLO ${round} (hashtag: #${tag}) ==========`);
      crawlLog('');

      crawlLog(`--- 1/3 Hashtag #${tag} ---`);
      try {
        const r1 = await runCrawl({ tag, limit, maxPosts: 10, clear: clear && round === 1 }, storage);
        totalSaved += r1.saved;
        crawlLog(`Hashtag concluída. Salvos nesta fase: ${r1.saved}. Total acumulado: ${totalSaved}`);
      } catch (err) {
        crawlLog(`Hashtag erro: ${err instanceof Error ? err.message : String(err)}. Indo para a próxima fase.`);
      }
      crawlLog('');

      crawlLog('--- 2/3 Explore ---');
      try {
        const r2 = await runCrawlFromExplore({ limit: 2 }, storage);
        totalSaved += r2.saved;
        crawlLog(`Explore concluído. Salvos nesta fase: ${r2.saved}. Total acumulado: ${totalSaved}`);
      } catch (err) {
        crawlLog(`Explore erro: ${err instanceof Error ? err.message : String(err)}. Indo para a próxima fase.`);
      }
      crawlLog('');
      /*
            crawlLog('--- 3/3 Feed ---');
            try {
              const r3 = await runCrawlFromFeed({ limit: 5, clear: false }, storage);
              totalSaved += r3.saved;
              crawlLog(`Feed concluído. Salvos nesta fase: ${r3.saved}. Total acumulado: ${totalSaved}`);
            } catch (err) {
              crawlLog(`Feed erro: ${err instanceof Error ? err.message : String(err)}. Fim do ciclo.`);
            }
            crawlLog('');
      
            crawlLog(`Fim do ciclo ${round}. Total de perfis salvos: ${totalSaved}. Iniciando próximo ciclo...`);
            crawlLog('');
            */
    }
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
