import { DEFAULT_CRAWL_CONFIG, type CrawlConfig, type Entity } from '../types/index.js';
import { InstagramClient } from '../instagramClient/index.js';
import { extractProfile } from '../profileExtractor/index.js';
import {
  getFollowersFromEntity,
  getInfluencerRejectionDiagnostic,
  hasPostWithMinLikes,
  isPersonOrCreator,
  qualifiesAsInfluencer,
  type InfluencerRejectionDiagnostic,
} from '../utils/entityAccess.js';
import { buildSlimProfile } from '../utils/slimProfile.js';
import { crawlLogExtract } from '../utils/crawlLogger.js';
import type { CrawlStorage } from './runCrawl.js';

const MIN_FOLLOWERS_FLOOR = process.env.MIN_FOLLOWERS ? parseInt(process.env.MIN_FOLLOWERS, 10000) : 0;
const EXTRACT_TIMEOUT_MS = Number(process.env.PROFILE_PROCESS_TIMEOUT_MS) || 180_000;

function buildConfigFromEnv(): CrawlConfig {
  const raw = (() => {
    const v = process.env.MIN_FOLLOWERS?.trim();
    if (v === undefined || v === '') return DEFAULT_CRAWL_CONFIG.minFollowersToSave;
    const n = parseInt(v, 10);
    if (Number.isNaN(n) || n < 0) return DEFAULT_CRAWL_CONFIG.minFollowersToSave;
    return n;
  })();
  const minFollowersToSave = raw === 0 ? 0 : Math.max(raw, MIN_FOLLOWERS_FLOOR);
  const minPostLikesRaw = parseInt(process.env.MIN_POST_LIKES ?? '0', 10);
  const minPostLikesToSave = Number.isNaN(minPostLikesRaw) || minPostLikesRaw < 0 ? 0 : minPostLikesRaw;
  return {
    ...DEFAULT_CRAWL_CONFIG,
    maxPostsPerTag: parseInt(process.env.MAX_POSTS_PER_TAG ?? String(DEFAULT_CRAWL_CONFIG.maxPostsPerTag), 10) || DEFAULT_CRAWL_CONFIG.maxPostsPerTag,
    maxProfiles: parseInt(process.env.MAX_PROFILES ?? String(DEFAULT_CRAWL_CONFIG.maxProfiles), 10) || DEFAULT_CRAWL_CONFIG.maxProfiles,
    headless: process.env.HEADFUL !== 'true',
    authStatePath: process.env.AUTH_STATE_PATH ?? DEFAULT_CRAWL_CONFIG.authStatePath,
    minFollowersToSave,
    minPostLikesToSave,
    excludeBusinessProfiles: process.env.EXCLUDE_BUSINESS_PROFILES !== 'false',
    maxPostsToAnalyzeForInsights: parseInt(process.env.MAX_POSTS_FOR_INSIGHTS ?? String(DEFAULT_CRAWL_CONFIG.maxPostsToAnalyzeForInsights), 10) || DEFAULT_CRAWL_CONFIG.maxPostsToAnalyzeForInsights,
  };
}

export interface ExtractSingleProfileResult {
  success: boolean;
  saved?: boolean;
  handle: string;
  /** Motivo da rejeição (quando success=false e não foi erro de extração) */
  rejectionReason?: string;
  diagnostic?: InfluencerRejectionDiagnostic;
  error?: string;
  followers?: number;
  postsSaved?: number;
}

/**
 * Extrai um perfil específico por handle: abre o perfil, captura dados, aplica filtros
 * (excludeBusinessProfiles + qualifiesAsInfluencer) e, se passar, salva no storage.
 * Retorna diagnóstico quando rejeitado para identificar qual regra bloqueou.
 */
export async function extractSingleProfile(
  handle: string,
  storage: CrawlStorage
): Promise<ExtractSingleProfileResult> {
  const cleanHandle = handle.replace(/^@/, '').trim();
  if (!cleanHandle) {
    return { success: false, handle: handle, error: 'Handle vazio' };
  }

  const config = buildConfigFromEnv();
  const minRequired = config.minFollowersToSave > 0 ? Math.max(config.minFollowersToSave, MIN_FOLLOWERS_FLOOR) : 0;
  const client = new InstagramClient({
    headless: config.headless,
    authStatePath: config.authStatePath,
  });

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Extract profile timeout')), EXTRACT_TIMEOUT_MS)
  );

  try {
    await client.init();
    const page = await client.newPage();
    try {
      const result = await Promise.race([
        (async (): Promise<ExtractSingleProfileResult> => {
          const extracted = await extractProfile(page, cleanHandle, 'seed', '', config);
          if (!extracted) {
            return { success: false, handle: cleanHandle, error: 'Falha ao extrair perfil (página ou API)' };
          }
          const { profile: rawProfile, posts } = extracted;
          const raw = rawProfile as Record<string, unknown>;
          const followersFromRaw = getFollowersFromEntity(raw);
          const slim = buildSlimProfile(raw, cleanHandle, followersFromRaw, posts, 'seed', '');
          const profileObj = slim as Record<string, unknown>;
          const followers = getFollowersFromEntity(profileObj);

          if (config.excludeBusinessProfiles) {
            const pass = qualifiesAsInfluencer(profileObj, minRequired);
            const diagnostic = getInfluencerRejectionDiagnostic(profileObj, minRequired, true);
            if (!pass) {
              return {
                success: false,
                handle: cleanHandle,
                saved: false,
                rejectionReason: diagnostic.reason,
                diagnostic,
                followers,
              };
            }
          } else {
            if (!isPersonOrCreator(profileObj)) {
              const diagnostic = getInfluencerRejectionDiagnostic(profileObj, minRequired, false);
              return {
                success: false,
                handle: cleanHandle,
                saved: false,
                rejectionReason: diagnostic.reason,
                diagnostic,
                followers,
              };
            }
            if (minRequired > 0 && followers < minRequired) {
              const diagnostic = getInfluencerRejectionDiagnostic(profileObj, minRequired, false);
              return {
                success: false,
                handle: cleanHandle,
                saved: false,
                rejectionReason: diagnostic.reason,
                diagnostic,
                followers,
              };
            }
          }

          if (config.minPostLikesToSave > 0) {
            if (!hasPostWithMinLikes(posts, config.minPostLikesToSave)) {
              crawlLogExtract(`@${cleanHandle} regra de curtidas NÃO validada: nenhum post com mais de ${config.minPostLikesToSave} curtidas`);
              return {
                success: false,
                handle: cleanHandle,
                saved: false,
                rejectionReason: 'nenhum_post_com_curtidas_minimas',
                followers,
              };
            }
            crawlLogExtract(`@${cleanHandle} regra de curtidas validada: pelo menos 1 post com > ${config.minPostLikesToSave} curtidas`);
          }

          await storage.save(slim as Entity & { handle: string });
          const collectedAt = String(slim._collected_at ?? new Date().toISOString());
          const postsSaved = await storage.savePosts(slim.handle, posts, collectedAt);
          return {
            success: true,
            saved: true,
            handle: cleanHandle,
            followers,
            postsSaved,
          };
        })(),
        timeoutPromise,
      ]);
      return result;
    } finally {
      await page.close().catch(() => { });
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, handle: cleanHandle, error };
  } finally {
    await client.close();
  }
}
