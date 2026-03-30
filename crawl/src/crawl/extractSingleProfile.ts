import type { Page } from 'playwright';
import { DEFAULT_CRAWL_CONFIG, type CrawlConfig, type Entity } from '../types/index.js';
import { InstagramClient } from '../instagramClient/index.js';
import { extractProfile } from '../profileExtractor/index.js';
import { logTimestamp } from '../utils/logTimestamp.js';
import {
  getBusinessBlockReason,
  getFollowersFromEntity,
  getInfluencerRejectionDiagnostic,
  hasPostWithMinLikes,
  hasRejectedProfileKeyword,
  isBusinessFromEntity,
  isBlocklistedHandle,
  isFollowingViewerFromEntity,
  isPersonOrCreator,
  qualifiesAsInfluencer,
  type InfluencerRejectionDiagnostic,
} from '../utils/entityAccess.js';
import { buildSlimProfile } from '../utils/slimProfile.js';
import { loadExistingProfileRecordForMerge, mergeProfilePreservingLlm } from '../utils/preserveLlmOnProfileMerge.js';
import { resyncInfluencerS3AfterDbMediaReset } from '../storage/s3InfluencerImage.js';
import type { CrawlStorage } from './runCrawl.js';

const MIN_FOLLOWERS_FLOOR = process.env.MIN_FOLLOWERS ? (parseInt(process.env.MIN_FOLLOWERS, 10) || 0) : 0;
const EXTRACT_TIMEOUT_MS = Number(process.env.PROFILE_PROCESS_TIMEOUT_MS) || 180_000;

export function buildConfigFromEnv(): CrawlConfig {
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

export interface ExtractSingleProfileResult {
  success: boolean;
  saved?: boolean;
  handle: string;
  /** Motivo da rejeição (quando success=false e não foi erro de extração) */
  rejectionReason?: string;
  /** Regra + palavra que identificou empresa (ex.: "handle contém 'loja'") — quando rejectionReason === 'empresa' */
  businessBlockReason?: string;
  diagnostic?: InfluencerRejectionDiagnostic;
  /** URL do perfil obrigatório para seguir (quando rejectionReason === 'nao_segue_perfil') */
  followProfileUrl?: string;
  /** Se o perfil segue a conta oficial (INSTAGRAM_PERFIL). Preenchido quando INSTAGRAM_PERFIL está definido; reutilizado no request-code para evitar abrir o perfil de novo. */
  followsOfficialProfile?: boolean;
  error?: string;
  followers?: number;
  postsSaved?: number;
}

/** Opções para a extração. forRefresh = true pula todas as validações (só reextrai e salva, ex.: renovar imagens). fastMode = true usa delays mínimos (extract-profile API). client + storage habilitam coleta de destaques em background. */
export interface ExtractSingleProfileOptions {
  forRefresh?: boolean;
  fastMode?: boolean;
  /** Quando fornecido com storage, destaques são coletados em background (não bloqueia o retorno). */
  client?: InstagramClient;
}

/**
 * Core: extrai um perfil usando uma page já aberta (para reuso de client/context na API).
 * A page não é fechada por esta função — quem chama deve fechar após salvar estado se necessário.
 * A validação "ser seguidor da conta oficial" (INSTAGRAM_PERFIL) não é feita aqui; só no envio da mensagem no inbox (request-code).
 * Com options.forRefresh = true nenhuma validação de qualificação é feita (apenas extrai e salva).
 */
export async function extractSingleProfileWithPage(
  page: Page,
  handle: string,
  storage: CrawlStorage,
  config: CrawlConfig,
  options?: ExtractSingleProfileOptions
): Promise<ExtractSingleProfileResult> {
  const cleanHandle = handle.replace(/^@/, '').trim();
  if (!cleanHandle) {
    return { success: false, handle: handle, error: 'Handle vazio' };
  }
  const minRequired = config.minFollowersToSave > 0 ? Math.max(config.minFollowersToSave, MIN_FOLLOWERS_FLOOR) : 0;

  const fastMode = options?.fastMode ?? false;
  const extractOpts = { fastMode, client: options?.client, storage: options?.client && storage && typeof storage.saveMedia === 'function' ? storage : undefined };
  const extracted = await extractProfile(page, cleanHandle, 'seed', '', config, extractOpts);
  if (!extracted) {
    return { success: false, handle: cleanHandle, error: 'Falha ao extrair perfil (página ou API)' };
  }
  const t0 = Date.now();
  const logStep = (msg: string) => console.log(`[extractSingleProfile] ${logTimestamp()} @${cleanHandle} +${Date.now() - t0}ms ${msg}`);
  logStep('extractProfile retornou, construindo slim...');
  const { profile: rawProfile, posts, reels = [], tagged = [], highlights = [] } = extracted;
  const raw = rawProfile as Record<string, unknown>;

  const followersFromRaw = getFollowersFromEntity(raw);
  const slim = buildSlimProfile(raw, cleanHandle, followersFromRaw, posts, 'seed', '');
  logStep('slim construído, verificando qualificação...');
  const followers = followersFromRaw > 0 ? followersFromRaw : getFollowersFromEntity(slim as Record<string, unknown>);
  const requiredProfile = process.env.INSTAGRAM_PERFIL?.trim().replace(/^@/, '');
  const followsOfficialProfile =
    requiredProfile && requiredProfile.length > 0 ? isFollowingViewerFromEntity(raw) : undefined;

  const saveAllMedia = async (collectedAt: string): Promise<number> => {
    let total = await storage.savePosts(slim.handle, posts, collectedAt);
    if (typeof storage.saveMedia === 'function') {
      if (reels.length > 0) total += await storage.saveMedia(slim.handle, 'reel', reels, collectedAt);
      if (tagged.length > 0) total += await storage.saveMedia(slim.handle, 'tagged', tagged, collectedAt);
      if (highlights.length > 0) total += await storage.saveMedia(slim.handle, 'highlight', highlights, collectedAt);
    }
    return total;
  };

  if (options?.forRefresh) {
    const collectedAt = String(slim._collected_at ?? new Date().toISOString());
    if (typeof storage.deletePostsByHandle === 'function') {
      logStep('forRefresh: deletando mídia antiga (DB)...');
      await storage.deletePostsByHandle(slim.handle);
    }
    logStep('forRefresh: S3 wipe + avatar + capas...');
    await resyncInfluencerS3AfterDbMediaReset(slim, { posts, reels, tagged, highlights });
    logStep('forRefresh: salvando perfil...');
    const existingRefresh = await loadExistingProfileRecordForMerge(
      storage as CrawlStorage & { loadByHandle?: (h: string) => Promise<Entity | null> },
      slim.handle
    );
    const mergedRefresh = mergeProfilePreservingLlm(existingRefresh, slim as Record<string, unknown>);
    await storage.save(mergedRefresh as Entity & { handle: string });
    logStep('salvando posts, reels, marcados e highlights...');
    const postsSaved = await saveAllMedia(collectedAt);
    logStep(`pronto (${postsSaved} itens).`);
    return { success: true, saved: true, handle: cleanHandle, followers, postsSaved, followsOfficialProfile };
  }

  if (isBusinessFromEntity(raw as Record<string, unknown>)) {
    const businessBlockReason = getBusinessBlockReason(raw as Record<string, unknown>);
    return {
      success: false,
      handle: cleanHandle,
      saved: false,
      rejectionReason: 'empresa',
      businessBlockReason: businessBlockReason ?? undefined,
      followers,
      followsOfficialProfile,
    };
  }

  if (config.excludeBusinessProfiles) {
    const pass = qualifiesAsInfluencer(raw, minRequired);
    const diagnostic = getInfluencerRejectionDiagnostic(raw, minRequired, true);
    if (!pass) {
      return {
        success: false,
        handle: cleanHandle,
        saved: false,
        rejectionReason: diagnostic.reason,
        diagnostic,
        followers,
        followsOfficialProfile,
      };
    }
  } else {
    if (!isPersonOrCreator(raw)) {
      const diagnostic = getInfluencerRejectionDiagnostic(raw, minRequired, false);
      return {
        success: false,
        handle: cleanHandle,
        saved: false,
        rejectionReason: diagnostic.reason,
        diagnostic,
        followers,
        followsOfficialProfile,
      };
    }
    if (minRequired > 0 && followers < minRequired) {
      const diagnostic = getInfluencerRejectionDiagnostic(raw, minRequired, false);
      return {
        success: false,
        handle: cleanHandle,
        saved: false,
        rejectionReason: diagnostic.reason,
        diagnostic,
        followers,
        followsOfficialProfile,
      };
    }
  }

  if (config.minPostLikesToSave > 0) {
    if (!hasPostWithMinLikes(posts, config.minPostLikesToSave, config.minPostsWithMinLikesToSave)) {
      return {
        success: false,
        handle: cleanHandle,
        saved: false,
        rejectionReason: `precisa de ${config.minPostsWithMinLikesToSave}+ posts com ${config.minPostLikesToSave}+ curtidas`,
        followers,
        followsOfficialProfile,
      };
    }
  }

  if (isBlocklistedHandle(cleanHandle)) {
    return {
      success: false,
      handle: cleanHandle,
      saved: false,
      rejectionReason: 'handle bloqueado',
      followers,
      followsOfficialProfile,
    };
  }

  if (hasRejectedProfileKeyword(raw as Record<string, unknown>)) {
    return {
      success: false,
      handle: cleanHandle,
      saved: false,
      rejectionReason: 'perfil com palavra rejeitada',
      followers,
      followsOfficialProfile,
    };
  }

  const collectedAt = String(slim._collected_at ?? new Date().toISOString());
  if (typeof storage.deletePostsByHandle === 'function') {
    logStep('deletando mídia antiga (DB)...');
    await storage.deletePostsByHandle(slim.handle);
  }
  logStep('S3: apaga prefixo influencer + avatar + capas...');
  await resyncInfluencerS3AfterDbMediaReset(slim, { posts, reels, tagged, highlights });
  logStep('salvando perfil...');
  const existingSave = await loadExistingProfileRecordForMerge(
    storage as CrawlStorage & { loadByHandle?: (h: string) => Promise<Entity | null> },
    slim.handle
  );
  const mergedSave = mergeProfilePreservingLlm(existingSave, slim as Record<string, unknown>);
  await storage.save(mergedSave as Entity & { handle: string });
  logStep('salvando posts, reels, marcados e highlights...');
  const postsSaved = await saveAllMedia(collectedAt);
  logStep(`pronto (${postsSaved} itens).`);
  return {
    success: true,
    saved: true,
    handle: cleanHandle,
    followers,
    postsSaved,
    followsOfficialProfile,
  };
}

/**
 * Extrai um perfil específico por handle: cria client + page, chama extractSingleProfileWithPage, fecha tudo.
 * Uso: CLI e chamadas que não compartilham browser (cada execução é isolada).
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
        extractSingleProfileWithPage(page, cleanHandle, storage, config, { client }),
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
