import dotenv from 'dotenv';
dotenv.config({ override: true });
import { DEFAULT_CRAWL_CONFIG, type CrawlConfig } from '../types/index.js';
import { InstagramClient } from '../instagramClient/index.js';
import { discoverAndProcessByHashtag, type DiscoveredProfileRef } from '../discoveryService/index.js';
import { extractProfile } from '../profileExtractor/index.js';
import { createStorage } from '../storage/index.js';
import type { SqliteStorageAdapter } from '../storage/sqlite.js';
import { crawlLog, crawlLogExtract } from '../utils/crawlLogger.js';

/** Mínimo fixo: só salva perfil com mais de 10 mil seguidores (quando o filtro está ativo). */
const MIN_FOLLOWERS_FLOOR = 10000;

/** Timeout total por perfil (extract + save). Se estourar, consideramos que "parou" e retentamos ou pulamos. */
const PROFILE_PROCESS_TIMEOUT_MS = Number(process.env.PROFILE_PROCESS_TIMEOUT_MS) || 180_000; // 3 min

/** Quantas vezes retentar o mesmo perfil em caso de timeout/erro antes de pular e seguir. */
const PROFILE_PROCESS_MAX_RETRIES = 2;

function buildConfigFromEnv(): CrawlConfig {
  const raw = (() => {
    const v = process.env.MIN_FOLLOWERS?.trim();
    if (v === undefined || v === '') return DEFAULT_CRAWL_CONFIG.minFollowersToSave;
    const n = parseInt(v, 10);
    if (Number.isNaN(n) || n < 0) return DEFAULT_CRAWL_CONFIG.minFollowersToSave;
    return n;
  })();
  const minFollowersToSave = raw === 0 ? 0 : Math.max(raw, MIN_FOLLOWERS_FLOOR);
  return {
    ...DEFAULT_CRAWL_CONFIG,
    maxPostsPerTag: parseInt(process.env.MAX_POSTS_PER_TAG ?? String(DEFAULT_CRAWL_CONFIG.maxPostsPerTag), 10) || DEFAULT_CRAWL_CONFIG.maxPostsPerTag,
    maxProfiles: parseInt(process.env.MAX_PROFILES ?? String(DEFAULT_CRAWL_CONFIG.maxProfiles), 10) || DEFAULT_CRAWL_CONFIG.maxProfiles,
    headless: process.env.HEADFUL !== 'true',
    authStatePath: process.env.AUTH_STATE_PATH ?? DEFAULT_CRAWL_CONFIG.authStatePath,
    minFollowersToSave,
    excludeBusinessProfiles: process.env.EXCLUDE_BUSINESS_PROFILES !== 'false',
    maxPostsToAnalyzeForInsights: parseInt(process.env.MAX_POSTS_FOR_INSIGHTS ?? String(DEFAULT_CRAWL_CONFIG.maxPostsToAnalyzeForInsights), 10) || DEFAULT_CRAWL_CONFIG.maxPostsToAnalyzeForInsights,
  };
}

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

/**
 * Processa um perfil com timeout e retries. Se travar (timeout), identifica sozinho,
 * retenta até PROFILE_PROCESS_MAX_RETRIES e, se salvar, retorna true; senão pula e retorna false.
 */
async function processOneProfileWithTimeout(
  client: InstagramClient,
  ref: DiscoveredProfileRef,
  tag: string,
  config: CrawlConfig,
  storage: ReturnType<typeof createStorage>,
  sqlite: SqliteStorageAdapter,
  existingHandles: Set<string>
): Promise<boolean> {
  for (let attempt = 0; attempt <= PROFILE_PROCESS_MAX_RETRIES; attempt++) {
    crawlLogExtract(`[heartbeat] ${new Date().toISOString()} — processando @${ref.handle} (tentativa ${attempt + 1}/${PROFILE_PROCESS_MAX_RETRIES + 1}, timeout ${PROFILE_PROCESS_TIMEOUT_MS / 1000}s)`);
    const page = await client.newPage();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('PROFILE_TIMEOUT')), PROFILE_PROCESS_TIMEOUT_MS)
    );
    const work = async (): Promise<boolean> => {
      try {
        if (existingHandles.has(ref.handle.toLowerCase())) return false;
        crawlLogExtract(`Extraindo perfil completo @${ref.handle}...${attempt > 0 ? ` (tentativa ${attempt + 1})` : ''}`);
        const result = await extractProfile(page, ref.handle, 'hashtag', tag, config);
        if (!result) {
          crawlLogExtract(`Falha ao extrair @${ref.handle}`);
          return false;
        }
        const { profile, posts } = result;
        const followers = profile.followers ?? 0;
        const minRequired = config.minFollowersToSave > 0 ? Math.max(config.minFollowersToSave, MIN_FOLLOWERS_FLOOR) : 0;
        if (minRequired > 0 && followers < minRequired) {
          crawlLogExtract(`@${ref.handle} abaixo de 10 mil (${followers}), pulando`);
          return false;
        }
        if (config.excludeBusinessProfiles && profile.is_business) {
          crawlLogExtract(`@${ref.handle} é perfil de negócio, pulando`);
          return false;
        }
        await storage.save(profile);
        const postsSaved = typeof sqlite.savePosts === 'function'
          ? await sqlite.savePosts(profile.handle, posts, profile.collected_at)
          : 0;
        existingHandles.add(ref.handle.toLowerCase());
        const categories = profile.post_insights?.inferred_categories?.length
          ? profile.post_insights.inferred_categories.join(', ')
          : '(nenhuma)';
        crawlLogExtract(`Salvo @${ref.handle} | followers=${profile.followers ?? '?'} | posts=${postsSaved} | categorias: ${categories}`);
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        crawlLogExtract(`Erro ao processar @${ref.handle}: ${msg}`);
        return false;
      }
    };

    try {
      const ok = await Promise.race([work(), timeoutPromise]);
      if (ok) return true;
      if (attempt < PROFILE_PROCESS_MAX_RETRIES) {
        crawlLogExtract(`@${ref.handle} não qualificado ou falha ao salvar; retentando (${attempt + 1}/${PROFILE_PROCESS_MAX_RETRIES})...`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout = msg.includes('PROFILE_TIMEOUT') || msg.toLowerCase().includes('timeout');
      crawlLogExtract(`Perfil @${ref.handle}: ${isTimeout ? 'timeout (código parou?)' : msg}. ${attempt < PROFILE_PROCESS_MAX_RETRIES ? `Retentando (${attempt + 1}/${PROFILE_PROCESS_MAX_RETRIES})...` : 'Desistindo e seguindo ao próximo.'}`);
      if (attempt === PROFILE_PROCESS_MAX_RETRIES) return false;
    } finally {
      await page.close().catch(() => { });
    }
  }
  return false;
}

async function main(): Promise<void> {
  const { tag, limit: maxProfilesArg, clear } = parseArgs();
  const maxProfiles = maxProfilesArg;

  if (!tag || tag.includes('node') || tag.includes('.exe')) {
    console.error('Uso: npm run crawl:hashtag -- --tag <hashtag> [--limit <número>] [--clear]');
    console.error('Ex.: npx tsx src/cli/crawl-hashtag.ts --tag viagem --limit 2 --clear');
    process.exit(1);
  }

  const config = buildConfigFromEnv();
  const effectiveMaxProfiles = maxProfiles !== undefined ? maxProfiles : config.maxProfiles;

  const storage = createStorage({ config });
  const sqlite = storage as SqliteStorageAdapter;
  if (clear && typeof sqlite.clearAll === 'function') {
    await sqlite.clearAll();
    crawlLog('Banco limpo (profiles, posts, hashtags).');
  }
  const existingHandles = await storage.listHandles();
  const client = new InstagramClient({
    headless: config.headless,
    authStatePath: config.authStatePath,
  });

  try {
    await client.init();
    crawlLog(`Hashtag: ${tag}, max posts: ${config.maxPostsPerTag}, max perfis: ${effectiveMaxProfiles}, min seguidores: ${config.minFollowersToSave}`);

    const saved = await discoverAndProcessByHashtag(
      client,
      tag.replace(/^#/, ''),
      config.maxPostsPerTag,
      effectiveMaxProfiles,
      config.minFollowersToSave,
      existingHandles,
      (ref) => processOneProfileWithTimeout(client, ref, tag, config, storage, sqlite, existingHandles)
    );

    crawlLog(`Concluído. Perfis salvos nesta execução: ${saved}`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
