import { DEFAULT_CRAWL_CONFIG, type CrawlConfig, type Entity } from '../types/index.js';
import { InstagramClient } from '../instagramClient/index.js';
import { discoverAndProcessByHashtag, type DiscoveredProfileRef } from '../discoveryService/index.js';
import { extractProfile } from '../profileExtractor/index.js';
import { crawlLog, crawlLogExtract } from '../utils/crawlLogger.js';
import { getFollowersFromEntity, isBusinessFromEntity } from '../utils/entityAccess.js';
/** Storage usado pelo crawl: RocksDB ou Composite (RocksDB + SQLite). */
export interface CrawlStorage {
  save(entity: Entity & { handle: string }): Promise<{ path: string; bytes: number }>;
  savePosts(profileHandle: string, posts: Entity[], collectedAt: string): Promise<number>;
  listHandles(): Promise<Set<string>>;
  clearAll(): Promise<void>;
}

const MIN_FOLLOWERS_FLOOR = 10000;
const PROFILE_PROCESS_TIMEOUT_MS = Number(process.env.PROFILE_PROCESS_TIMEOUT_MS) || 180_000;
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

async function processOneProfileWithTimeout(
  client: InstagramClient,
  ref: DiscoveredProfileRef,
  tag: string,
  config: CrawlConfig,
  storage: CrawlStorage,
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
        const profileObj = profile as Record<string, unknown>;
        // Preferir seguidores da descoberta (já lidos na página); senão tentar da response da API.
        let followers = ref.followersFromDiscovery ?? getFollowersFromEntity(profileObj);
        if (ref.followersFromDiscovery != null && ref.followersFromDiscovery > 0) {
          profileObj.followers_count = ref.followersFromDiscovery;
        }
        const minRequired = config.minFollowersToSave > 0 ? Math.max(config.minFollowersToSave, MIN_FOLLOWERS_FLOOR) : 0;
        if (minRequired > 0 && followers < minRequired) {
          crawlLogExtract(`@${ref.handle} abaixo de 10 mil (${followers}), pulando`);
          return false;
        }
        if (config.excludeBusinessProfiles && isBusinessFromEntity(profileObj)) {
          crawlLogExtract(`@${ref.handle} é perfil de negócio, pulando`);
          return false;
        }
        await storage.save(profile as Entity & { handle: string });
        const collectedAt = String(profileObj._collected_at ?? new Date().toISOString());
        const postsSaved = await storage.savePosts(profile.handle, posts, collectedAt);
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

export interface RunCrawlOptions {
  tag: string;
  limit?: number;
  clear?: boolean;
}

export interface RunCrawlResult {
  saved: number;
  tag: string;
}

/**
 * Executa o crawl por hashtag usando o storage fornecido (ex.: RocksDB da API).
 * Não fecha o storage ao final — quem chama é responsável.
 */
export async function runCrawl(options: RunCrawlOptions, storage: CrawlStorage): Promise<RunCrawlResult> {
  const tag = options.tag.replace(/^#/, '').trim();
  if (!tag) {
    throw new Error('tag é obrigatória');
  }

  const config = buildConfigFromEnv();
  const effectiveMaxProfiles = options.limit !== undefined ? options.limit : config.maxProfiles;

  if (options.clear) {
    await storage.clearAll();
    crawlLog('Banco limpo (RocksDB).');
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
      tag,
      config.maxPostsPerTag,
      effectiveMaxProfiles,
      config.minFollowersToSave,
      existingHandles,
      (ref) => processOneProfileWithTimeout(client, ref, tag, config, storage, existingHandles)
    );

    crawlLog(`Concluído. Perfis salvos nesta execução: ${saved}`);
    return { saved, tag };
  } finally {
    await client.close();
  }
}
