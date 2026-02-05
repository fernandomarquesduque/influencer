import { DEFAULT_CRAWL_CONFIG, type CrawlConfig, type Entity } from '../types/index.js';
import { InstagramClient } from '../instagramClient/index.js';
import { discoverAndProcessByHashtag, type DiscoveredProfileRef } from '../discoveryService/index.js';
import { extractProfile } from '../profileExtractor/index.js';
import type { Page } from 'playwright';
import { crawlLog, crawlLogExtract } from '../utils/crawlLogger.js';
import { getFollowersFromEntity, isPersonOrCreator, qualifiesAsInfluencer } from '../utils/entityAccess.js';
import { reset429Run } from '../utils/rateLimit429.js';
import { buildSlimProfile } from '../utils/slimProfile.js';
/** Storage usado pelo crawl: RocksDB ou Composite (RocksDB + SQLite). */
export interface CrawlStorage {
  save(entity: Entity & { handle: string }): Promise<{ path: string; bytes: number }>;
  savePosts(profileHandle: string, posts: Entity[], collectedAt: string): Promise<number>;
  listHandles(): Promise<Set<string>>;
  clearAll(): Promise<void>;
}

const MIN_FOLLOWERS_FLOOR = 10000;
const PROFILE_PROCESS_TIMEOUT_MS = Number(process.env.PROFILE_PROCESS_TIMEOUT_MS) || 180_000;
const PROFILE_PROCESS_MAX_RETRIES = 1;

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

async function processOneProfileWithTimeout(
  client: InstagramClient,
  ref: DiscoveredProfileRef,
  tag: string,
  config: CrawlConfig,
  storage: CrawlStorage,
  existingHandles: Set<string>,
  pageFromDiscovery?: Page
): Promise<boolean> {
  const useDiscoveryPage = pageFromDiscovery != null;
  const page = useDiscoveryPage ? pageFromDiscovery : await client.newPage();

  for (let attempt = 0; attempt <= PROFILE_PROCESS_MAX_RETRIES; attempt++) {
    crawlLogExtract(`[heartbeat] ${new Date().toISOString()} — processando @${ref.handle} (tentativa ${attempt + 1}/${PROFILE_PROCESS_MAX_RETRIES + 1}, timeout ${PROFILE_PROCESS_TIMEOUT_MS / 1000}s)`);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('PROFILE_TIMEOUT')), PROFILE_PROCESS_TIMEOUT_MS)
    );
    const work = async (): Promise<boolean> => {
      try {
        if (existingHandles.has(ref.handle.toLowerCase())) return false;
        crawlLogExtract(`Extraindo perfil completo @${ref.handle}...${attempt > 0 ? ` (tentativa ${attempt + 1})` : ''}`);
        const result = await extractProfile(page, ref.handle, 'hashtag', tag, config, { pageAlreadyOnProfile: useDiscoveryPage });
        if (!result) {
          crawlLogExtract(`Falha ao extrair @${ref.handle}`);
          return false;
        }
        const { profile: rawProfile, posts } = result;
        const raw = rawProfile as Record<string, unknown>;
        const slim = buildSlimProfile(
          raw,
          ref.handle,
          ref.followersFromDiscovery ?? getFollowersFromEntity(raw),
          posts,
          'hashtag',
          tag
        );
        const profileObj = slim as Record<string, unknown>;
        let followers = ref.followersFromDiscovery ?? getFollowersFromEntity(profileObj);
        if (ref.followersFromDiscovery != null && ref.followersFromDiscovery > 0) {
          profileObj.followers_count = ref.followersFromDiscovery;
        }
        const minRequired = config.minFollowersToSave > 0 ? Math.max(config.minFollowersToSave, MIN_FOLLOWERS_FLOOR) : 0;
        if (config.excludeBusinessProfiles) {
          if (!qualifiesAsInfluencer(profileObj, minRequired)) {
            crawlLogExtract(`@${ref.handle} não qualifica como influenciador (filtro estabelecimento + tipo + seguidores), pulando`);
            throw new Error('FILTER_REJECT');
          }
        } else {
          if (!isPersonOrCreator(profileObj)) {
            crawlLogExtract(`@${ref.handle} não é pessoa/criador (conta empresa), pulando`);
            throw new Error('FILTER_REJECT');
          }
          if (minRequired > 0 && followers < minRequired) {
            crawlLogExtract(`@${ref.handle} abaixo do mínimo (${followers} < ${minRequired}), pulando`);
            throw new Error('FILTER_REJECT');
          }
        }
        await storage.save(slim as Entity & { handle: string });
        const collectedAt = String(slim._collected_at ?? new Date().toISOString());
        const postsSaved = await storage.savePosts(slim.handle, posts, collectedAt);
        existingHandles.add(ref.handle.toLowerCase());
        crawlLogExtract(`Salvo @${ref.handle} | followers=${followers} | posts=${postsSaved}`);
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        crawlLogExtract(`Erro ao processar @${ref.handle}: ${msg}`);
        return false;
      }
    };

    try {
      const ok = await Promise.race([work(), timeoutPromise]);
      if (ok) {
        if (!useDiscoveryPage) await page.close().catch(() => { });
        return true;
      }
      if (attempt < PROFILE_PROCESS_MAX_RETRIES) {
        crawlLogExtract(`@${ref.handle} falha ao extrair/salvar; retentando (${attempt + 1}/${PROFILE_PROCESS_MAX_RETRIES})...`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'FILTER_REJECT') {
        if (!useDiscoveryPage) await page.close().catch(() => { });
        return false;
      }
      const isTimeout = msg.includes('PROFILE_TIMEOUT') || msg.toLowerCase().includes('timeout');
      crawlLogExtract(`Perfil @${ref.handle}: ${isTimeout ? 'timeout (código parou?)' : msg}. ${attempt < PROFILE_PROCESS_MAX_RETRIES ? `Retentando (${attempt + 1}/${PROFILE_PROCESS_MAX_RETRIES})...` : 'Desistindo e seguindo ao próximo.'}`);
      if (attempt === PROFILE_PROCESS_MAX_RETRIES) {
        if (!useDiscoveryPage) await page.close().catch(() => { });
        return false;
      }
    }
  }
  if (!useDiscoveryPage) await page.close().catch(() => { });
  return false;
}

export interface RunCrawlOptions {
  tag: string;
  limit?: number;
  clear?: boolean;
}

export interface RunCrawlCallbacks {
  /** Retorna true para solicitar parada do crawl (ex.: usuário clicou em Parar). */
  shouldAbort?: () => boolean;
}

export interface RunCrawlResult {
  saved: number;
  tag: string;
}

/**
 * Executa o crawl por hashtag usando o storage fornecido (ex.: RocksDB da API).
 * Não fecha o storage ao final — quem chama é responsável.
 */
export async function runCrawl(
  options: RunCrawlOptions,
  storage: CrawlStorage,
  callbacks?: RunCrawlCallbacks
): Promise<RunCrawlResult> {
  const tag = options.tag.replace(/^#/, '').trim();
  if (!tag) {
    throw new Error('tag é obrigatória');
  }

  const config = buildConfigFromEnv();
  const effectiveMaxProfiles = options.limit !== undefined ? options.limit : config.maxProfiles;
  const shouldAbort = callbacks?.shouldAbort;

  if (options.clear) {
    await storage.clearAll();
    crawlLog('Banco limpo (RocksDB).');
  }
  reset429Run();

  /** Handles já processados nesta execução (evita reprocessar o mesmo perfil na mesma run). Perfis já no banco são atualizados com novos dados. */
  const existingHandles = new Set<string>();
  const client = new InstagramClient({
    headless: config.headless,
    authStatePath: config.authStatePath,
  });

  try {
    await client.init();
    crawlLog(`Hashtag: ${tag}, max posts: ${config.maxPostsPerTag}, max perfis: ${effectiveMaxProfiles}, min seguidores: ${config.minFollowersToSave}`);
    if (process.env.CRAWL_SAFE === '1' || process.env.CRAWL_SAFE === 'true') {
      crawlLog('CRAWL_SAFE=1: ritmo lento (5–8 req/min) para reduzir risco de 429.');
    }

    const saved = await discoverAndProcessByHashtag(
      client,
      tag,
      config.maxPostsPerTag,
      effectiveMaxProfiles,
      config.minFollowersToSave,
      existingHandles,
      (ref, pageAlreadyOnProfile) => processOneProfileWithTimeout(client, ref, tag, config, storage, existingHandles, pageAlreadyOnProfile),
      shouldAbort,
      config.excludeBusinessProfiles
    );

    crawlLog(`Concluído. Perfis salvos nesta execução: ${saved}`);
    return { saved, tag };
  } finally {
    await client.close();
  }
}
