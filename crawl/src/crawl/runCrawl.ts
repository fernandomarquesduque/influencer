import { DEFAULT_CRAWL_CONFIG, type CrawlConfig, type DiscoveredBy, type Entity } from '../types/index.js';
import { InstagramClient } from '../instagramClient/index.js';
import { ensureLoggedIn } from '../instagramClient/login.js';
import { discoverAndProcessByHashtag, discoverAndProcessByHomeFeed, discoverAndProcessByExplore, type DiscoveredProfileRef } from '../discoveryService/index.js';
import { extractProfile } from '../profileExtractor/index.js';
import type { Page } from 'playwright';
import { crawlLog, crawlLogExtract } from '../utils/crawlLogger.js';
import { getBusinessBlockReason, getFollowersFromEntity, hasPostWithMinLikes, hasRejectedProfileKeyword, isBlocklistedHandle, isBusinessFromEntity, isPersonOrCreator, isPrivateFromEntity, qualifiesAsInfluencer } from '../utils/entityAccess.js';
import { reset429Run } from '../utils/rateLimit429.js';
import { buildSlimProfile } from '../utils/slimProfile.js';
/** Storage usado pelo crawl: RocksDB ou Composite (RocksDB + SQLite). */
export interface CrawlStorage {
  save(entity: Entity & { handle: string }): Promise<{ path: string; bytes: number }>;
  savePosts(profileHandle: string, posts: Entity[], collectedAt: string): Promise<number>;
  deletePostsByHandle?(profileHandle: string): Promise<number>;
  listHandles(): Promise<Set<string>>;
  clearAll(): Promise<void>;
}

const MIN_FOLLOWERS_FLOOR = process.env.MIN_FOLLOWERS ? (parseInt(process.env.MIN_FOLLOWERS, 10) || 0) : 0;
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
  const minPostLikesRaw = parseInt(process.env.MIN_POST_LIKES ?? String(DEFAULT_CRAWL_CONFIG.minPostLikesToSave), 10);
  const minPostLikesToSave = Number.isNaN(minPostLikesRaw) || minPostLikesRaw < 0 ? DEFAULT_CRAWL_CONFIG.minPostLikesToSave : minPostLikesRaw;
  const minPostsWithMinLikesRaw = parseInt(process.env.MIN_POSTS_WITH_MIN_LIKES ?? String(DEFAULT_CRAWL_CONFIG.minPostsWithMinLikesToSave), 10);
  const minPostsWithMinLikesToSave = Number.isNaN(minPostsWithMinLikesRaw) || minPostsWithMinLikesRaw < 1 ? DEFAULT_CRAWL_CONFIG.minPostsWithMinLikesToSave : minPostsWithMinLikesRaw;
  return {
    ...DEFAULT_CRAWL_CONFIG,
    maxPostsPerTag: parseInt(process.env.MAX_POSTS_PER_TAG ?? String(DEFAULT_CRAWL_CONFIG.maxPostsPerTag), 10) || DEFAULT_CRAWL_CONFIG.maxPostsPerTag,
    maxProfiles: parseInt(process.env.MAX_PROFILES ?? String(DEFAULT_CRAWL_CONFIG.maxProfiles), 10) || DEFAULT_CRAWL_CONFIG.maxProfiles,
    headless: process.env.HEADFUL === 'true' ? false : process.env.HEADFUL === 'false' ? true : process.env.NODE_ENV === 'production' ? true : false,
    authStatePath: process.env.AUTH_STATE_PATH ?? DEFAULT_CRAWL_CONFIG.authStatePath,
    minFollowersToSave,
    minPostLikesToSave,
    minPostsWithMinLikesToSave,
    excludeBusinessProfiles: process.env.EXCLUDE_BUSINESS_PROFILES !== 'false',
    saveOnlyBrazilian: process.env.SAVE_ONLY_BRAZILIAN === 'true',
    maxPostsToAnalyzeForInsights: parseInt(process.env.MAX_POSTS_FOR_INSIGHTS ?? String(DEFAULT_CRAWL_CONFIG.maxPostsToAnalyzeForInsights), 10) || DEFAULT_CRAWL_CONFIG.maxPostsToAnalyzeForInsights,
  };
}

function logProfileOutcome(handle: string, saved: boolean, detail: string): void {
  if (saved) {
    crawlLogExtract(`@${handle} → salvo (${detail})`);
  } else {
    crawlLogExtract(`@${handle} → rejeitado: ${detail}`);
  }
}

async function processOneProfileWithTimeout(
  client: InstagramClient,
  ref: DiscoveredProfileRef,
  discoveredBy: DiscoveredBy,
  discoveredValue: string,
  config: CrawlConfig,
  storage: CrawlStorage,
  existingHandles: Set<string>,
  pageFromDiscovery?: Page
): Promise<boolean> {
  const useDiscoveryPage = pageFromDiscovery != null;
  const page = useDiscoveryPage ? pageFromDiscovery : await client.newPage();

  for (let attempt = 0; attempt <= PROFILE_PROCESS_MAX_RETRIES; attempt++) {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('PROFILE_TIMEOUT')), PROFILE_PROCESS_TIMEOUT_MS)
    );
    const work = async (): Promise<boolean> => {
      try {
        if (existingHandles.has(ref.handle.toLowerCase())) return false;
        const result = await extractProfile(page, ref.handle, discoveredBy, discoveredValue, config, { pageAlreadyOnProfile: useDiscoveryPage });
        if (!result) {
          logProfileOutcome(ref.handle, false, 'falha ao extrair');
          return false;
        }
        const { profile: rawProfile, posts } = result;
        const raw = rawProfile as Record<string, unknown>;
        const slim = buildSlimProfile(
          raw,
          ref.handle,
          ref.followersFromDiscovery ?? getFollowersFromEntity(raw),
          posts,
          discoveredBy,
          discoveredValue
        );
        const profileObj = slim as Record<string, unknown>;
        let followers = ref.followersFromDiscovery ?? getFollowersFromEntity(profileObj);
        if (ref.followersFromDiscovery != null && ref.followersFromDiscovery > 0) {
          profileObj.followers_count = ref.followersFromDiscovery;
        }
        const minRequired = config.minFollowersToSave > 0 ? Math.max(config.minFollowersToSave, MIN_FOLLOWERS_FLOOR) : 0;
        if (isPrivateFromEntity(raw)) {
          throw new Error('FILTER_REJECT:perfil privado');
        }
        if (isBusinessFromEntity(raw)) {
          const reason = getBusinessBlockReason(raw);
          throw new Error(`FILTER_REJECT:empresa (${reason ?? 'conta/categoria'})`);
        }
        if (config.excludeBusinessProfiles) {
          if (!qualifiesAsInfluencer(profileObj, minRequired)) {
            throw new Error('FILTER_REJECT:não qualifica (estabelecimento/tipo/seguidores)');
          }
        } else {
          if (!isPersonOrCreator(profileObj)) {
            const reason = getBusinessBlockReason(raw);
            throw new Error(`FILTER_REJECT:conta empresa (${reason ?? 'conta/categoria'})`);
          }
          if (minRequired > 0 && followers < minRequired) {
            throw new Error(`FILTER_REJECT:abaixo do mínimo (${followers} < ${minRequired})`);
          }
        }
        if (config.minPostLikesToSave > 0) {
          if (!hasPostWithMinLikes(posts, config.minPostLikesToSave, config.minPostsWithMinLikesToSave)) {
            throw new Error(`FILTER_REJECT:precisa de ${config.minPostsWithMinLikesToSave}+ posts com ${config.minPostLikesToSave}+ curtidas`);
          }
        }
        if (isBlocklistedHandle(ref.handle)) {
          throw new Error('FILTER_REJECT:handle bloqueado');
        }
        if (hasRejectedProfileKeyword(raw)) {
          throw new Error('FILTER_REJECT:perfil com palavra rejeitada');
        }
        await storage.save(slim as Entity & { handle: string });
        const collectedAt = String(slim._collected_at ?? new Date().toISOString());
        await storage.savePosts(slim.handle, posts, collectedAt);
        existingHandles.add(ref.handle.toLowerCase());
        logProfileOutcome(ref.handle, true, `${followers} seguidores`);
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === 'RATE_LIMIT_429') throw err;
        if (msg.startsWith('FILTER_REJECT:')) throw err;
        logProfileOutcome(ref.handle, false, msg.slice(0, 60));
        return false;
      }
    };

    try {
      const ok = await Promise.race([work(), timeoutPromise]);
      if (ok) {
        if (!useDiscoveryPage) await page.close().catch(() => { });
        return true;
      }
      if (attempt < PROFILE_PROCESS_MAX_RETRIES) continue;
      logProfileOutcome(ref.handle, false, 'falha após retentativas');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.startsWith('FILTER_REJECT:')) {
        const reason = msg.slice('FILTER_REJECT:'.length);
        logProfileOutcome(ref.handle, false, reason);
        if (!useDiscoveryPage) await page.close().catch(() => { });
        return false;
      }
      if (msg === 'RATE_LIMIT_429') {
        if (!useDiscoveryPage) await page.close().catch(() => { });
        throw err;
      }
      const isTimeout = msg.includes('PROFILE_TIMEOUT') || msg.toLowerCase().includes('timeout');
      logProfileOutcome(ref.handle, false, isTimeout ? 'timeout' : msg.slice(0, 60));
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
  /** Se definido, limita quantos posts da hashtag abrir (senão usa config.maxPostsPerTag). */
  maxPosts?: number;
  clear?: boolean;
}

export interface RunCrawlCallbacks {
  /** Retorna true para solicitar parada do crawl (ex.: usuário clicou em Parar). */
  shouldAbort?: () => boolean;
}

export interface RunCrawlResult {
  saved: number;
  processed: number;
  failed: number;
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
  const effectiveMaxPosts = options.maxPosts !== undefined ? options.maxPosts : config.maxPostsPerTag;
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
    const user = process.env.INSTAGRAM_USER?.trim();
    const password = process.env.INSTAGRAM_PASSWORD;
    if (user && password) {
      crawlLog('Verificando sessão Instagram (ensureLoggedIn)...');
      const loggedIn = await ensureLoggedIn(client, user, password);
      if (!loggedIn) {
        throw new Error(
          'Não foi possível manter sessão no Instagram. Verifique INSTAGRAM_USER e INSTAGRAM_PASSWORD no .env ou rode npm run login (HEADFUL=true para 2FA).'
        );
      }
      crawlLog('Sessão Instagram OK.');
    } else {
      crawlLog('INSTAGRAM_USER ou INSTAGRAM_PASSWORD não definidos no .env; usando apenas sessão salva em data/instagram-auth.json se existir.');
    }
    crawlLog(`Hashtag: ${tag}, max posts: ${effectiveMaxPosts}, max perfis: ${effectiveMaxProfiles}, min seguidores: ${config.minFollowersToSave}, regra: ${config.minPostsWithMinLikesToSave}+ posts com ${config.minPostLikesToSave}+ curtidas`);
    if (process.env.CRAWL_SAFE === '1' || process.env.CRAWL_SAFE === 'true') {
      crawlLog('CRAWL_SAFE=1: ritmo lento (5–8 req/min) para reduzir risco de 429.');
    }

    const result = await discoverAndProcessByHashtag(
      client,
      tag,
      effectiveMaxPosts,
      effectiveMaxProfiles,
      config.minFollowersToSave,
      existingHandles,
      (ref, pageAlreadyOnProfile) => processOneProfileWithTimeout(client, ref, 'hashtag', tag, config, storage, existingHandles, pageAlreadyOnProfile),
      shouldAbort,
      config.excludeBusinessProfiles
    );

    crawlLog(`Concluído. Perfis salvos nesta execução: ${result.saved}`);
    return { saved: result.saved, processed: result.processed, failed: result.failed, tag };
  } finally {
    await client.close();
  }
}

export interface RunCrawlFromFeedOptions {
  limit?: number;
  clear?: boolean;
}

export interface RunCrawlFromFeedResult {
  saved: number;
  processed: number;
  failed: number;
  source: 'feed';
}

/**
 * Executa o crawl a partir do feed principal (home): abre a página inicial, rola para carregar posts,
 * e processa cada perfil que aparece nos posts (extrai e salva se qualificar).
 * Requer sessão logada (INSTAGRAM_USER/INSTAGRAM_PASSWORD ou npm run login).
 */
export async function runCrawlFromFeed(
  options: RunCrawlFromFeedOptions,
  storage: CrawlStorage,
  callbacks?: RunCrawlCallbacks
): Promise<RunCrawlFromFeedResult> {
  const config = buildConfigFromEnv();
  const effectiveMaxProfiles = options.limit !== undefined ? options.limit : config.maxProfiles;
  const shouldAbort = callbacks?.shouldAbort;

  if (options.clear) {
    await storage.clearAll();
    crawlLog('Banco limpo (RocksDB).');
  }
  reset429Run();

  const existingHandles = new Set<string>();
  const client = new InstagramClient({
    headless: config.headless,
    authStatePath: config.authStatePath,
  });

  try {
    await client.init();
    const user = process.env.INSTAGRAM_USER?.trim();
    const password = process.env.INSTAGRAM_PASSWORD;
    if (user && password) {
      crawlLog('Verificando sessão Instagram (ensureLoggedIn)...');
      const loggedIn = await ensureLoggedIn(client, user, password);
      if (!loggedIn) {
        throw new Error(
          'Não foi possível manter sessão no Instagram. Verifique INSTAGRAM_USER e INSTAGRAM_PASSWORD no .env ou rode npm run login (HEADFUL=true para 2FA).'
        );
      }
      crawlLog('Sessão Instagram OK.');
    } else {
      crawlLog('INSTAGRAM_USER ou INSTAGRAM_PASSWORD não definidos no .env; usando apenas sessão salva em data/instagram-auth.json se existir.');
    }
    crawlLog(`Feed principal: max posts: ${config.maxPostsPerTag}, max perfis: ${effectiveMaxProfiles}, min seguidores: ${config.minFollowersToSave}, regra: ${config.minPostsWithMinLikesToSave}+ posts com ${config.minPostLikesToSave}+ curtidas`);
    if (process.env.CRAWL_SAFE === '1' || process.env.CRAWL_SAFE === 'true') {
      crawlLog('CRAWL_SAFE=1: ritmo lento (5–8 req/min) para reduzir risco de 429.');
    }

    const result = await discoverAndProcessByHomeFeed(
      client,
      config.maxPostsPerTag,
      effectiveMaxProfiles,
      config.minFollowersToSave,
      existingHandles,
      (ref, pageAlreadyOnProfile) =>
        processOneProfileWithTimeout(client, ref, 'feed', 'home', config, storage, existingHandles, pageAlreadyOnProfile),
      shouldAbort,
      config.excludeBusinessProfiles
    );

    crawlLog(`Concluído (feed). Perfis salvos nesta execução: ${result.saved}`);
    return { saved: result.saved, processed: result.processed, failed: result.failed, source: 'feed' };
  } finally {
    await client.close();
  }
}

export interface RunCrawlFromExploreOptions {
  limit?: number;
  clear?: boolean;
}

export interface RunCrawlFromExploreResult {
  saved: number;
  processed: number;
  failed: number;
  source: 'explore';
}

/**
 * Executa o crawl a partir do Explore (https://www.instagram.com/explore/): navega na página,
 * clica em posts da grade, abre o perfil do autor e processa. Loop até limite ou interrupção.
 */
export async function runCrawlFromExplore(
  options: RunCrawlFromExploreOptions,
  storage: CrawlStorage,
  callbacks?: RunCrawlCallbacks
): Promise<RunCrawlFromExploreResult> {
  const config = buildConfigFromEnv();
  const effectiveMaxProfiles = options.limit !== undefined ? options.limit : config.maxProfiles;
  const shouldAbort = callbacks?.shouldAbort;

  if (options.clear) {
    await storage.clearAll();
    crawlLog('Banco limpo (RocksDB).');
  }
  reset429Run();

  const existingHandles = new Set<string>();
  const client = new InstagramClient({
    headless: config.headless,
    authStatePath: config.authStatePath,
  });

  try {
    await client.init();
    const user = process.env.INSTAGRAM_USER?.trim();
    const password = process.env.INSTAGRAM_PASSWORD;
    if (user && password) {
      crawlLog('Verificando sessão Instagram (ensureLoggedIn)...');
      const loggedIn = await ensureLoggedIn(client, user, password);
      if (!loggedIn) {
        throw new Error(
          'Não foi possível manter sessão no Instagram. Verifique INSTAGRAM_USER e INSTAGRAM_PASSWORD no .env ou rode npm run login (HEADFUL=true para 2FA).'
        );
      }
      crawlLog('Sessão Instagram OK.');
    } else {
      crawlLog('INSTAGRAM_USER ou INSTAGRAM_PASSWORD não definidos no .env; usando apenas sessão salva em data/instagram-auth.json se existir.');
    }
    crawlLog(`Explore: max perfis: ${effectiveMaxProfiles}, min seguidores: ${config.minFollowersToSave}, regra: ${config.minPostsWithMinLikesToSave}+ posts com ${config.minPostLikesToSave}+ curtidas`);
    if (process.env.CRAWL_SAFE === '1' || process.env.CRAWL_SAFE === 'true') {
      crawlLog('CRAWL_SAFE=1: ritmo lento para reduzir risco de 429.');
    }

    const result = await discoverAndProcessByExplore(
      client,
      effectiveMaxProfiles,
      config.minFollowersToSave,
      existingHandles,
      (ref, pageAlreadyOnProfile) =>
        processOneProfileWithTimeout(client, ref, 'explore', 'explore', config, storage, existingHandles, pageAlreadyOnProfile),
      shouldAbort,
      config.excludeBusinessProfiles
    );

    crawlLog(`Concluído (Explore). Perfis salvos nesta execução: ${result.saved}`);
    return { saved: result.saved, processed: result.processed, failed: result.failed, source: 'explore' };
  } finally {
    await client.close();
  }
}
