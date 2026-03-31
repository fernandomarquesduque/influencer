/**
 * Descoberta de perfis por hashtag, feed, explore ou busca Google (site:instagram.com).
 */

import type { BrowserContext, Page } from 'playwright';
import { InstagramClient } from './instagram.js';
import {
  getFollowersAndMinimalProfile,
  extractProfile,
  extractProfileFull,
  INSTAGRAM_PROFILE_UNAVAILABLE_DETAIL,
  isInstagramProfileUnavailablePage,
  readFollowersFromDOM,
} from './profileExtractor.js';
import { buildSlimProfile } from './slimProfile.js';
import {
  getFollowersFromEntity,
  hasPostWithMinLikes,
  hasRejectedProfileKeyword,
  isBlocklistedHandle,
  isBusinessFromEntity,
  isPrivateFromEntity,
  qualifiesAsInfluencer,
  containsRejectedKeyword,
  explainRejectedProfileKeyword,
  explainCommercialOrEstablishment,
  explainNotQualifiesAsInfluencer,
  explainRejectedEstablishmentKeywordInBio,
  explainAccountTypeFilterMismatch,
  getAccountType,
  summarizeProfileForUi,
  type Entity,
} from './entityRules.js';
import { explainBioNotBrazilianPortuguese } from './bioLanguageBr.js';
import {
  addToGoogleQueue,
  listHandles,
  recordDuplicate,
  recordIssue,
  registerCollectedWithIntegration,
  setLastGoogleSerpExtraction,
  takeNextFromGoogleQueue,
} from './memoryStorage.js';
import {
  isProfileAlreadyOnRemoteServer,
  isRemoteIngestConfigured,
  pushProfileFullToServer,
  pushProfileToServerRocksDb,
} from './serverIngest.js';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { existsSync } from 'fs';
import type { CollectorConfig } from './config.js';
import { coletaLog } from './coletaLog.js';
import { setProcessingState } from './processingStatus.js';

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Se o perfil já está no servidor, marca duplicata, atualiza existingHandles e retorna true (caller retorna cedo). */
async function skipIfHandleAlreadyOnRemoteServer(
  config: CollectorConfig,
  handle: string,
  existingHandles: Set<string>,
  handleLower: string,
  logSuffix?: string
): Promise<boolean> {
  if (!isRemoteIngestConfigured() || !config.skipIfAlreadyInRemoteDb) return false;
  const hk = handle.replace(/^@/, '').trim().toLowerCase();
  if (!(await isProfileAlreadyOnRemoteServer(hk))) return false;
  recordDuplicate(handle);
  coletaLog(
    `@${hk}: já cadastrado no banco (API/RocksDB), pulando${logSuffix ? ` ${logSuffix}` : ''}.`
  );
  existingHandles.add(hk);
  if (handleLower !== hk) existingHandles.add(handleLower);
  return true;
}

/** true = rejeitou (já registrou issue + log). */
function rejectByAllowedAccountTypes(
  config: CollectorConfig,
  handle: string,
  minimal: Record<string, unknown> | null | undefined,
  followers: number | null | undefined,
  logCtx: string,
  issuePrefix?: string
): boolean {
  if (!config.allowedAccountTypes.length || !minimal) return false;
  const entity = {
    handle,
    username: handle,
    ...minimal,
    followers_count: followers ?? getFollowersFromEntity(minimal),
  } as Record<string, unknown>;
  const msg = explainAccountTypeFilterMismatch(entity, config.allowedAccountTypes);
  if (!msg) return false;
  recordIssue(handle, 'extracao', issuePrefix ? `${issuePrefix} ${msg}` : msg, {
    followers_count: followers ?? undefined,
  });
  coletaLog(`${logCtx}: @${handle}: ${msg}`);
  return true;
}

type ProfileUiPatch = {
  full_name?: string;
  followers_count?: number | null;
  account_type?: number | null;
  category?: string;
};

/**
 * Com filtro de tipos ativo: se o primeiro JSON ainda não traz `account_type`, espera GraphQL mais longo
 * **antes** da extração completa (evita minutos de timeline/Reels só para reprovar tipo 3).
 */
async function probeAccountTypeIfStillUnknown(
  page: Page,
  profileUrl: string,
  pageAlready: boolean,
  config: CollectorConfig,
  handle: string,
  minimal: Record<string, unknown>,
  followers: number | null | undefined,
  proc: (stage: string, patch?: ProfileUiPatch) => void
): Promise<boolean> {
  if (!config.allowedAccountTypes.length) return true;
  const f0 = followers ?? getFollowersFromEntity(minimal);
  const ent0 = {
    handle,
    username: handle,
    ...minimal,
    followers_count: f0,
  } as Record<string, unknown>;
  if (getAccountType(ent0) != null) return true;
  proc('Confirmando tipo de conta (leitura do perfil)…');
  coletaLog(`@${handle}: account_type ainda ausente no JSON — aguardando Instagram antes da extração completa…`);
  let typeSnap = await getFollowersAndMinimalProfile(page, profileUrl, {
    skipGoto: pageAlready,
    quickGate: false,
  });
  if (!typeSnap.minimalProfile && pageAlready) {
    await randomDelay(180, 420);
    typeSnap = await getFollowersAndMinimalProfile(page, profileUrl, { skipGoto: true, quickGate: false });
  }
  const min = typeSnap.minimalProfile ?? minimal;
  const f = typeSnap.followers ?? followers;
  if (rejectByAllowedAccountTypes(config, handle, min, f, `@${handle}`)) return false;
  proc(
    'Validando perfil…',
    summarizeProfileForUi(
      { handle, username: handle, ...min, followers_count: f ?? getFollowersFromEntity(min) } as Record<string, unknown>,
      f
    )
  );
  return true;
}

/** Regras de qualificação sobre perfil + posts (timeline). Retorna false se reprovou (já registrou issue). */
function runCollectorProfileRules(
  raw: Record<string, unknown>,
  posts: Entity[],
  handle: string,
  config: CollectorConfig,
  proc: (stage: string, patch?: ProfileUiPatch) => void,
  validationStageLabel: string
): boolean {
  const followers = getFollowersFromEntity(raw);
  proc(validationStageLabel, summarizeProfileForUi(raw, followers));

  const typeRej = explainAccountTypeFilterMismatch(raw, config.allowedAccountTypes);
  if (typeRej) {
    recordIssue(handle, 'extracao', typeRej);
    coletaLog(`@${handle}: ${typeRej}`);
    return false;
  }

  if (config.maxFollowersToSave > 0 && followers > config.maxFollowersToSave) {
    recordIssue(
      handle,
      'regra',
      `Máximo de seguidores: ${config.maxFollowersToSave.toLocaleString('pt-BR')}; @${handle} tem ${followers.toLocaleString('pt-BR')}.`
    );
    return false;
  }

  const rejListaPosExtract = explainRejectedEstablishmentKeywordInBio(raw);
  if (rejListaPosExtract) {
    recordIssue(handle, 'regra', rejListaPosExtract);
    coletaLog(`@${handle}: rejeitado por bio (lista) após leitura do perfil — não envia à API.`);
    return false;
  }

  if (config.requireBioBrazilianPortuguese) {
    const bioRegra = explainBioNotBrazilianPortuguese(raw);
    if (bioRegra) {
      recordIssue(handle, 'regra', bioRegra);
      return false;
    }
  }
  if (isPrivateFromEntity(raw)) {
    recordIssue(
      handle,
      'regra',
      'Perfil privado — não dá para validar posts/seguidores para o filtro do coletor.'
    );
    return false;
  }
  if (hasRejectedProfileKeyword(raw)) {
    recordIssue(handle, 'regra', explainRejectedProfileKeyword(raw));
    return false;
  }
  if (isBusinessFromEntity(raw)) {
    recordIssue(handle, 'regra', explainCommercialOrEstablishment(raw));
    return false;
  }
  if (config.excludeBusinessProfiles && !qualifiesAsInfluencer(raw, config.minFollowersToSave)) {
    recordIssue(handle, 'regra', explainNotQualifiesAsInfluencer(raw, config.minFollowersToSave));
    return false;
  }
  if (!config.excludeBusinessProfiles) {
    if (!qualifiesAsInfluencer(raw, config.minFollowersToSave)) {
      recordIssue(handle, 'regra', explainNotQualifiesAsInfluencer(raw, config.minFollowersToSave));
      return false;
    }
  }
  if (
    config.minPostLikesToSave > 0 &&
    !hasPostWithMinLikes(posts, config.minPostLikesToSave, config.minPostsWithMinLikesToSave)
  ) {
    recordIssue(handle, 'regra', `Posts sem curtidas suficientes (mín. ${config.minPostLikesToSave})`);
    return false;
  }
  if (isBlocklistedHandle(handle)) {
    recordIssue(handle, 'regra', `Handle @${handle} está na lista de bloqueio interna do coletor.`);
    return false;
  }
  return true;
}

function followersFromSnap(snap: {
  followers: number | null;
  minimalProfile: Record<string, unknown> | null;
}): number | null {
  if (snap.followers != null && snap.followers > 0) return snap.followers;
  if (snap.minimalProfile) {
    const f = getFollowersFromEntity(snap.minimalProfile as Record<string, unknown>);
    return f > 0 ? f : null;
  }
  return null;
}

/**
 * API + entidade GraphQL + DOM quando há mín./máx. de seguidores (quickGate costuma deixar API vazia).
 */
async function resolveFollowersForEarlyGate(
  page: Page,
  snap: { followers: number | null; minimalProfile: Record<string, unknown> | null },
  config: CollectorConfig
): Promise<number | null> {
  let f = followersFromSnap(snap);
  if (f != null) return f;
  if (config.minFollowersToSave <= 0 && config.maxFollowersToSave <= 0) return null;
  const fromDom = await readFollowersFromDOM(page);
  return fromDom != null && fromDom > 0 ? fromDom : null;
}

/** Conta links de post na grade da página atual (hashtag/explore). */
async function countGridPostLinks(page: Page): Promise<number> {
  let n = await page.locator('article a[href^="/p/"]').count();
  if (n === 0) n = await page.locator('main a[href*="/p/"]').count();
  return n;
}

/**
 * Hashtag abre por `tagUrl` = `/explore/search/keyword/?q=…` ou o IG usa `/explore/tags/…`.
 * Reconhecer os dois evita `goto` a cada post (reload desnecessário da grade).
 */
function isOnHashtagGridPage(url: string, tag: string): boolean {
  const tagKey = tag.replace(/^#/, '').trim().toLowerCase();
  if (!tagKey) return false;
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();
    if (path.includes('/explore/tags/')) {
      const seg = path.split('/explore/tags/')[1]?.split('/')[0] ?? '';
      let decoded = seg;
      try {
        decoded = decodeURIComponent(seg);
      } catch {
        /* keep seg */
      }
      return decoded.toLowerCase().replace(/^#/, '') === tagKey;
    }
    if (path.includes('/explore/search/keyword')) {
      const q = (u.searchParams.get('q') ?? '').trim().replace(/^#/, '').toLowerCase();
      return q === tagKey;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Garante URL da hashtag + grade com posts suficientes (lazy load).
 * Modo hashtag: a grade fica na aba principal; post/perfil abrem em abas novas (evita reload da grade).
 */
async function ensureHashtagGridReady(
  page: Page,
  tagUrl: string,
  tag: string,
  neededCount: number
): Promise<void> {
  if (!isOnHashtagGridPage(page.url(), tag)) {
    coletaLog(`#${tag}: abrindo página da hashtag (grade precisa estar visível)…`);
    await page.goto(tagUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await randomDelay(1800, 2800);
  }

  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForTimeout(600);

  let n = await countGridPostLinks(page);
  if (n === 0) {
    await page.evaluate(() => window.scrollTo(0, 500));
    await page.waitForTimeout(1200);
    n = await countGridPostLinks(page);
  }

  let scrolls = 0;
  while (n < neededCount && scrolls < 45) {
    await page.evaluate(() => window.scrollBy(0, 800));
    await page.waitForTimeout(450);
    const n2 = await countGridPostLinks(page);
    if (n2 > n) n = n2;
    scrolls++;
    if (n2 === n && scrolls % 8 === 0) {
      await page.evaluate(() => window.scrollBy(0, 400));
      await page.waitForTimeout(600);
    }
  }

  if (n < neededCount) {
    coletaLog(`#${tag}: recarregando hashtag — só ${n} post(s) visíveis, preciso ≥${neededCount}.`);
    await page.goto(tagUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await randomDelay(2000, 3200);
    await page.evaluate(() => window.scrollTo(0, 400));
    n = await countGridPostLinks(page);
    scrolls = 0;
    while (n < neededCount && scrolls < 45) {
      await page.evaluate(() => window.scrollBy(0, 800));
      await page.waitForTimeout(450);
      n = await countGridPostLinks(page);
      scrolls++;
    }
  }
}

function randomDelay(min: number, max: number): Promise<void> {
  return delay(min + Math.random() * (max - min));
}

const profileUrlRe = /instagram\.com\/[^/]+\/?(\?.*)?$/;
const profileHrefRe = /^\/[^/]+\/?$/;
const isProfileHref = (h: string) =>
  profileHrefRe.test(h.replace(/\?.*$/, '')) && !h.includes('/p/') && !h.includes('/reel/');

export type DiscoveryMode = 'hashtag' | 'feed' | 'explore' | 'google' | 'handles';

export interface DiscoveryOptions {
  mode: DiscoveryMode;
  tag?: string;
  /** Modo handles: lista direta de @arrobas para extrair (uma por linha na UI). */
  handles?: string[];
  /** Modo Google: consulta completa (ex.: site:instagram.com ("pai" OR "mãe") mario). */
  googleQuery?: string;
  /** Modo Google: filtro de tempo do Google (qdr). Valores principais: h/d/w/m/y. Default: w. */
  googleQdr?: string;
  /** Máximo de páginas SERP do Google a extrair por consulta (padrão 20). */
  maxSerpPages?: number;
  /** Valores udm para rodar a busca (ex.: ['39', '7', ''] = udm 39, depois 7, depois sem udm). Vazio = só uma busca sem parâmetro udm. */
  udmValues?: string[];
  maxProfiles: number;
  config: CollectorConfig;
  shouldAbort: () => boolean;
  onCollected?: (handle: string, followers: number) => void;
  /** Perfis já visitados nesta coleta (várias hashtags / feed / explore) + opc. problemas — não reabrir na grade. */
  sessionTriedHandles?: Set<string>;
  /** Caminho para salvar/carregar cookies do Google (evita captcha na próxima vez). */
  googleSessionPath?: string;
}

async function processOneProfile(
  page: Page,
  handle: string,
  config: CollectorConfig,
  existingHandles: Set<string>,
  discoveredBy: string,
  discoveredValue: string,
  options?: {
    pageAlreadyOnProfile?: boolean;
    skipGate?: boolean;
    /** Dados já lidos no pipeline (ex.: Google) — preenche a UI antes da extração completa. */
    prefillProfileSnap?: { minimal: Record<string, unknown>; followers?: number | null };
  },
  onCollected?: (handle: string, followers: number) => void
): Promise<boolean> {
  const handleLower = handle.toLowerCase();
  if (existingHandles.has(handleLower)) {
    recordDuplicate(handle);
    coletaLog(`@${handle}: duplicado (processOneProfile), ignorado.`);
    return false;
  }

  if (await skipIfHandleAlreadyOnRemoteServer(config, handle, existingHandles, handleLower)) {
    return false;
  }

  const hk = handle.replace(/^@/, '').trim().toLowerCase();
  let profileUi: {
    full_name?: string;
    followers_count?: number | null;
    account_type?: number | null;
    category?: string;
  } = {};
  const proc = (stage: string, patch?: typeof profileUi) => {
    if (patch) Object.assign(profileUi, patch);
    setProcessingState({
      handle: hk,
      stage,
      since: new Date().toISOString(),
      ...profileUi,
    });
  };
  proc('Validando perfil…');
  const prefill = options?.prefillProfileSnap;
  if (prefill?.minimal) {
    const pf = prefill.followers ?? null;
    const fol = pf ?? getFollowersFromEntity(prefill.minimal);
    proc(
      'Validando perfil…',
      summarizeProfileForUi(
        { handle, username: handle, ...prefill.minimal, followers_count: fol } as Record<string, unknown>,
        pf
      )
    );
  }

  const profileUrl = InstagramClient.profileUrl(handle);
  const pageAlready = options?.pageAlreadyOnProfile ?? false;
  const skipGate = options?.skipGate ?? false;
  const useRemote = isRemoteIngestConfigured();

  if (!skipGate && pageAlready) {
    await page.waitForTimeout(400);
    if (await isInstagramProfileUnavailablePage(page)) {
      coletaLog(`@${handle}: perfil inexistente ou indisponível (página atual).`);
      recordIssue(handle, 'extracao', INSTAGRAM_PROFILE_UNAVAILABLE_DETAIL);
      return false;
    }
  }

  let rawProfile: Record<string, unknown>;
  let posts: Entity[];
  let mediaBundle: {
    feed: Record<string, unknown>[];
    reel: Record<string, unknown>[];
    tagged: Record<string, unknown>[];
  } | null = null;

  if (!skipGate) {
    /** Seguidores primeiro; depois bio/pt-BR/tipo — evita trabalho inútil se já está fora da faixa. */
    coletaLog(`@${handle}: validando seguidores e bio antes de coletar timeline/Reels…`);
    let gateSnap = await getFollowersAndMinimalProfile(page, profileUrl, { skipGoto: pageAlready });
    if (!gateSnap.minimalProfile && pageAlready) {
      await randomDelay(1200, 2200);
      gateSnap = await getFollowersAndMinimalProfile(page, profileUrl, { skipGoto: true });
    }
    const gateFollowers = await resolveFollowersForEarlyGate(page, gateSnap, config);
    if (gateSnap.minimalProfile) {
      const gateEntity = {
        handle,
        username: handle,
        ...(gateSnap.minimalProfile as Record<string, unknown>),
        followers_count:
          gateFollowers ??
          gateSnap.followers ??
          getFollowersFromEntity(gateSnap.minimalProfile as Record<string, unknown>),
      } as Record<string, unknown>;
      proc('Validando perfil…', summarizeProfileForUi(gateEntity, gateFollowers ?? gateSnap.followers));
    }
    if (config.maxFollowersToSave > 0 && gateFollowers != null && gateFollowers > config.maxFollowersToSave) {
      recordIssue(
        handle,
        'regra',
        `Máximo de seguidores: ${config.maxFollowersToSave.toLocaleString('pt-BR')}; @${handle} tem ${gateFollowers.toLocaleString('pt-BR')}.`,
        { followers_count: gateFollowers }
      );
      coletaLog(`@${handle}: acima do máximo de seguidores (${gateFollowers.toLocaleString('pt-BR')}).`);
      return false;
    }
    if (config.minFollowersToSave > 0) {
      if (gateFollowers == null || gateFollowers < config.minFollowersToSave) {
        const detail = `Antes de extrair o perfil completo: exige pelo menos ${config.minFollowersToSave.toLocaleString(
          'pt-BR'
        )} seguidores; @${handle} tem ${gateFollowers != null ? gateFollowers.toLocaleString('pt-BR') : '—'}.`;
        recordIssue(handle, 'regra', detail, { followers_count: gateFollowers ?? undefined });
        coletaLog(`@${handle}: ${detail}`);
        return false;
      }
    }
    if (gateSnap.minimalProfile) {
      const minimal = gateSnap.minimalProfile as Record<string, unknown>;
      const rejEst = explainRejectedEstablishmentKeywordInBio(minimal);
      if (rejEst) {
        recordIssue(handle, 'regra', rejEst);
        return false;
      }
      if (config.requireBioBrazilianPortuguese) {
        const gateEntity = {
          handle,
          username: handle,
          ...minimal,
          followers_count: gateFollowers ?? gateSnap.followers ?? getFollowersFromEntity(minimal),
        } as Record<string, unknown>;
        const rejLang = explainBioNotBrazilianPortuguese(gateEntity);
        if (rejLang) {
          recordIssue(handle, 'regra', rejLang);
          return false;
        }
      }
      if (
        rejectByAllowedAccountTypes(
          config,
          handle,
          minimal,
          gateFollowers ?? gateSnap.followers,
          `@${handle}`
        )
      ) {
        return false;
      }
      if (
        !(await probeAccountTypeIfStillUnknown(
          page,
          profileUrl,
          pageAlready,
          config,
          handle,
          minimal,
          gateFollowers ?? gateSnap.followers,
          proc
        ))
      ) {
        return false;
      }
    }
  } else {
    coletaLog(`@${handle}: gate já validado (pipeline) → extraindo perfil completo uma vez.`);
    if (config.allowedAccountTypes.length > 0 && options?.prefillProfileSnap?.minimal) {
      const pf = options.prefillProfileSnap;
      const pfFol = pf.followers ?? null;
      if (rejectByAllowedAccountTypes(config, handle, pf.minimal, pfFol, `@${handle}`)) return false;
      if (
        !(await probeAccountTypeIfStillUnknown(
          page,
          profileUrl,
          pageAlready,
          config,
          handle,
          pf.minimal,
          pfFol,
          proc
        ))
      ) {
        return false;
      }
    }
  }

  proc('Extraindo dados no Instagram…');

  try {
    if (useRemote) {
      coletaLog(`@${handle}: extração COMPLETA (timeline + Reels + Marcados)…`);
      proc('Capturando timeline, Reels e marcados (pode levar 1–3 min)…');
      const fullResult = await extractProfileFull(page, handle, profileUrl, {
        pageAlreadyOnProfile: pageAlready,
        afterInitialLoad: async ({ profile: p }) => {
          const bioListaEarly = explainRejectedEstablishmentKeywordInBio(p);
          if (bioListaEarly) {
            recordIssue(handle, 'regra', bioListaEarly, {
              followers_count: getFollowersFromEntity(p) || undefined,
            });
            coletaLog(`@${handle}: rejeitado por bio (pré-extração completa).`);
            return false;
          }
          if (config.requireBioBrazilianPortuguese) {
            const bioLangEarly = explainBioNotBrazilianPortuguese(p);
            if (bioLangEarly) {
              recordIssue(handle, 'regra', bioLangEarly, {
                followers_count: getFollowersFromEntity(p) || undefined,
              });
              coletaLog(`@${handle}: bio fora de pt-BR (pré-extração completa).`);
              return false;
            }
          }
          if (config.allowedAccountTypes.length > 0) {
            const msg = explainAccountTypeFilterMismatch(p, config.allowedAccountTypes);
            if (msg) {
              recordIssue(handle, 'extracao', msg, {
                followers_count: getFollowersFromEntity(p) || undefined,
              });
              coletaLog(`@${handle}: ${msg}`);
              return false;
            }
          }
          return true;
        },
        afterTimeline: async ({ profile, posts: timelinePosts }) =>
          runCollectorProfileRules(
            profile,
            timelinePosts as Entity[],
            handle,
            config,
            proc,
            'Validando regras (antes de Reels/Marcados)…'
          ),
      });
      if (fullResult.ok) {
        const full = fullResult.data;
        rawProfile = full.profile;
        posts = full.postsForRules as Entity[];
        mediaBundle = {
          feed: full.feedMedia,
          reel: full.reelMedia,
          tagged: full.taggedMedia,
        };
        coletaLog(
          `@${handle}: captura OK → feed=${full.feedMedia.length} reels=${full.reelMedia.length} marcados=${full.taggedMedia.length} itens GraphQL`
        );
      } else if (fullResult.reason === 'validation') {
        coletaLog(`@${handle}: extração completa interrompida antes de Reels/Marcados (regras).`);
        return false;
      } else {
        coletaLog(`@${handle}: extração completa falhou → tentando extração rápida…`);
        proc('Extração rápida (fallback)…');
        const extracted = await extractProfile(page, handle, profileUrl, {
          pageAlreadyOnProfile: pageAlready,
        });
        if (!extracted) {
          recordIssue(handle, 'extracao', 'Não foi possível extrair dados do perfil');
          coletaLog(`@${handle}: falha na extração rápida também.`);
          return false;
        }
        rawProfile = extracted.profile;
        posts = extracted.posts as Entity[];
      }
    } else {
      coletaLog(`@${handle}: extração rápida (sem API remota configurada)…`);
      proc('Extração rápida do perfil…');
      const extracted = await extractProfile(page, handle, profileUrl, {
        pageAlreadyOnProfile: pageAlready,
      });
      if (!extracted) {
        recordIssue(handle, 'extracao', 'Não foi possível extrair dados do perfil');
        return false;
      }
      rawProfile = extracted.profile;
      posts = extracted.posts as Entity[];
    }
    const raw = rawProfile as Record<string, unknown>;
    const followers = getFollowersFromEntity(raw);

    /**
     * Sempre validar de novo no perfil final: `account_type` e outros campos às vezes só aparecem
     * depois de mais respostas GraphQL (Reels/Marcados). Antes pulávamos isso quando o [full] dava OK.
     */
    if (
      !runCollectorProfileRules(
        raw,
        posts,
        handle,
        config,
        proc,
        'Validando regras (perfil final, antes da API)…'
      )
    ) {
      return false;
    }

    const slim = buildSlimProfile(
      raw,
      handle,
      followers,
      posts,
      discoveredBy,
      discoveredValue
    );
    const nMedia =
      mediaBundle != null
        ? mediaBundle.feed.length + mediaBundle.reel.length + mediaBundle.tagged.length
        : 0;
    coletaLog(
      `@${handle}: enviando para API (${nMedia > 0 ? `ingest-full ~${nMedia} mídias` : 'só perfil slim'})…`
    );
    proc(
      nMedia > 0
        ? `Enviando para API (~${nMedia} itens de mídia)…`
        : 'Enviando perfil para API…',
      summarizeProfileForUi(raw, followers)
    );
    const pushResult = await registerCollectedWithIntegration(
      slim as Record<string, unknown> & { handle: string },
      mediaBundle,
      pushProfileFullToServer,
      pushProfileToServerRocksDb
    );
    if (pushResult.skipped) {
      existingHandles.add(handleLower);
      onCollected?.(handle, followers);
      return true;
    }
    if (!pushResult.ok) {
      coletaLog(
        `@${handle}: API falhou — NÃO contado como salvo no servidor. Endpoint: ${pushResult.endpoint ?? '—'}`
      );
      return false;
    }
    existingHandles.add(handleLower);
    onCollected?.(handle, followers);
    return true;
  } finally {
    setProcessingState(null);
  }
}

/** Obtém o handle do autor na página do post (modal ou página). */
async function getAuthorFromPostPage(page: Page): Promise<string | null> {
  for (const sel of ['section a[href^="/"]', 'header a[href^="/"]', '[role="presentation"] a[href^="/"]']) {
    try {
      const el = page.locator(sel).first();
      await el.waitFor({ state: 'attached', timeout: 5000 });
      const h = await el.getAttribute('href');
      if (h && isProfileHref(h)) {
        const handle = h.replace(/^\//, '').split('/')[0]?.trim().split('?')[0] ?? '';
        if (handle) return handle;
      }
    } catch {
      continue;
    }
  }
  try {
    const hrefs = await page.locator('section a[href^="/"]').evaluateAll((nodes) =>
      nodes.map((a) => (a as HTMLAnchorElement).getAttribute('href')).filter((h): h is string => !!h)
    );
    const first = hrefs.find((h) => isProfileHref(h));
    if (first) return first.replace(/^\//, '').split('/')[0]?.trim().split('?')[0] ?? null;
  } catch {
    // ignore
  }
  return null;
}

const IG_GOOGLE_RESERVED = new Set([
  'p',
  'reel',
  'reels',
  'stories',
  'explore',
  'accounts',
  'direct',
  'tv',
  'legal',
  'about',
  'support',
  'privacy',
  'help',
  'developer',
  'nametag',
  'professional_dashboard',
  'www',
]);

function normalizeGoogleQdr(qdr?: string): string | '' {
  const allowed = new Set(['h', 'd', 'w', 'm', 'y']);
  if (qdr == null) return 'w';
  const t = qdr.trim().toLowerCase();
  if (t === '') return '';
  return allowed.has(t) ? t : 'w';
}

/** Monta a URL de busca no Google. udm opcional: '39', '7' ou '' (vazio = busca geral sem udm). qdr opcional: h/d/w/m/y. */
function googleSearchUrl(query: string, udm?: string, qdr?: string): string {
  const q = query.trim();
  const qParam =
    /site:\s*instagram\.com/i.test(q) ? q : `site:instagram.com ${q}`;
  const params = new URLSearchParams({
    q: qParam,
    num: '100',
    hl: 'pt-BR',
  });
  const qdrNorm = normalizeGoogleQdr(qdr);
  // Google usa o filtro de tempo dentro de `tbs`, ex.: `tbs=qdr:w`
  if (qdrNorm) params.set('tbs', `qdr:${qdrNorm}`);
  if (udm != null && udm !== '') params.set('udm', udm);
  return `https://www.google.com/search?${params.toString()}`;
}

export interface SerpHandleItem {
  handle: string;
  snippet: string;
}

/** Reel/post URL que não tem handle na SERP — é preciso abrir a página do Instagram para obter o @. */
export interface SerpReelToResolve {
  reelUrl: string;
  snippet: string;
}

export interface SerpScrapeResult {
  handles: SerpHandleItem[];
  reelUrls: SerpReelToResolve[];
}

/**
 * Extrai handles e URLs de reel/post dos resultados do Google.
 * - Links diretos: instagram.com/username → handle.
 * - Reels/posts com link de perfil no bloco → handle.
 * - Reels/posts sem link de perfil (só "Instagram · Nome" no snippet) → reelUrl para resolver depois no Instagram.
 * Script em string para evitar __name do bundler no page.evaluate (roda no browser).
 */
async function scrapeInstagramHandlesFromGoogleSerp(page: Page): Promise<SerpScrapeResult> {
  const reserved = [...IG_GOOGLE_RESERVED];
  const scriptBody = `
    var blocked = new Set(R);
    var order = [];
    var reelUrls = [];
    var seen = new Set();
    var reelSeen = new Set();
    function add(seg, snippet) {
      var u = String(seg).toLowerCase().replace(/^@/, '').replace(/\\.$/, '').trim();
      if (!u || u.length < 2 || u.length > 30 || blocked.has(u) || seen.has(u)) return;
      if (!/^[a-z0-9._]+$/.test(u)) return;
      seen.add(u);
      var sn = (snippet || '').replace(/\\s+/g, ' ').trim().slice(0, 400);
      order.push({ handle: u, snippet: sn });
    }
    function addReelUrl(url, snippet) {
      try {
        var u = String(url).trim();
        if (!u || !/instagram\\.com\\/(reel|p)\\//i.test(u)) return;
        if (u.indexOf('google.') !== -1) {
          var parsed = new URL(u, 'https://www.google.com');
          var q = parsed.searchParams.get('url') || parsed.searchParams.get('q');
          if (q) u = /^https?:/i.test(q) ? q : 'https://' + q;
        }
        if (reelSeen.has(u)) return;
        reelSeen.add(u);
        var sn = (snippet || '').replace(/\\s+/g, ' ').trim().slice(0, 400);
        reelUrls.push({ reelUrl: u, snippet: sn });
      } catch (e) {}
    }
    function ingestLink(raw) {
      if (!raw || !/instagram/i.test(raw)) return;
      try {
        var s = String(raw).trim();
        if (/^\\/\\//.test(s)) s = 'https:' + s;
        if (s.indexOf('google.') !== -1 && (s.indexOf('url?') !== -1 || s.indexOf('/url') !== -1)) {
          var u = new URL(s, 'https://www.google.com');
          var q = u.searchParams.get('q') || u.searchParams.get('url');
          if (q) s = /^https?:/i.test(q) ? q : 'https://' + q;
        }
        var dec;
        try { dec = decodeURIComponent(s); } catch (e) { dec = s; }
        var m = dec.match(/instagram\\.com\\/([^/?#]+)/i);
        if (!m) return;
        var seg = m[1].toLowerCase();
        if (seg === 'p' || seg === 'reel' || seg === 'reels' || seg === 'tv') return;
        add(seg, '');
      } catch (e) {}
    }
    document.querySelectorAll('a[href]').forEach(function(a) { ingestLink(a.href); });
    document.querySelectorAll('[data-url], [cite]').forEach(function(el) {
      ingestLink(el.getAttribute('data-url') || el.getAttribute('cite') || '');
    });
    var postReelLinks = document.querySelectorAll('a[href*="instagram.com/p/"], a[href*="instagram.com/reel/"]');
    for (var i = 0; i < postReelLinks.length; i++) {
      var el = postReelLinks[i];
      var block = el;
      var foundProfile = false;
      for (var up = 0; up < 20 && block && block !== document.body; up++) {
        if (block.innerText && /Instagram/i.test(block.innerText)) {
          var blockSnip = (block.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 400);
          var profileLink = block.querySelector('a[href*="instagram.com/"]');
          if (profileLink) {
            var href = profileLink.getAttribute('href') || '';
            try {
              if (href.indexOf('google.') !== -1) {
                var u = new URL(href, 'https://www.google.com');
                var q = u.searchParams.get('url') || u.searchParams.get('q');
                if (q) href = q;
              }
              var segMatch = href.match(/instagram\\.com\\/([^/?#]+)/i);
              if (segMatch) {
                var seg = segMatch[1].toLowerCase();
                if (seg !== 'p' && seg !== 'reel' && seg !== 'reels' && seg !== 'tv') { add(seg, blockSnip); foundProfile = true; break; }
              }
            } catch (e) {}
          }
          if (!foundProfile) {
            var reelLink = block.querySelector('a[href*="instagram.com/reel/"], a[href*="instagram.com/p/"]');
            var href = reelLink ? (reelLink.getAttribute('href') || '') : (el.href || '');
            if (href) addReelUrl(href, blockSnip);
          }
          break;
        }
        block = block.parentElement;
      }
    }
    return { handles: order, reelUrls: reelUrls };
  `;
  return page.evaluate(new Function('R', scriptBody) as (R: string[]) => SerpScrapeResult, reserved);
}

/**
 * Abre a URL do reel/post no Instagram e extrai o handle do autor da página (não confia no snippet do Google).
 */
async function resolveHandleFromReelUrl(
  ctx: BrowserContext,
  reelUrl: string,
  shouldAbort: () => boolean
): Promise<string | null> {
  let tab: Page | null = null;
  try {
    tab = await ctx.newPage();
    const resolved = await tab.goto(reelUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
    const finalUrl = resolved?.url() ?? tab.url();
    const pathMatch = finalUrl.match(/instagram\.com\/([^/]+)/i);
    if (pathMatch) {
      const seg = pathMatch[1]!.toLowerCase();
      if (seg !== 'p' && seg !== 'reel' && seg !== 'reels' && seg !== 'tv' && seg.length >= 2 && seg.length <= 30) {
        return seg;
      }
    }
    await new Promise((r) => setTimeout(r, 1500));
    const handleFromLink = await tab.evaluate(() => {
      const links = document.querySelectorAll('a[href^="/"]');
      for (let i = 0; i < links.length; i++) {
        const a = links[i];
        const href = (a as HTMLAnchorElement).getAttribute('href');
        if (!href) continue;
        const pathPart = (href.split('?')[0] ?? '').replace(/^\//, '');
        const segments = pathPart.split('/').filter(Boolean);
        if (segments.length >= 2) {
          const first = segments[0].toLowerCase();
          const second = segments[1].toLowerCase();
          if ((second === 'reels' || second === 'reel' || second === 'p') && /^[a-z0-9._]+$/.test(first) && first.length >= 2 && first.length <= 30) {
            return first;
          }
        }
      }
      return null;
    });
    return handleFromLink;
  } catch (e) {
    coletaLog(`Reel: falha ao resolver handle de ${reelUrl.slice(0, 60)}… — ${e instanceof Error ? e.message : String(e)}`);
    return null;
  } finally {
    if (tab) await tab.close().catch(() => { });
  }
}

/** Rola a página do Google para baixo para carregar mais resultados (infinite scroll, ex.: udm=7 vídeos). */
async function scrollGoogleSerpToLoadMore(page: Page, rounds: number = 5): Promise<void> {
  for (let r = 0; r < rounds; r++) {
    await page.evaluate(() => {
      window.scrollBy(0, window.innerHeight * 0.8);
    });
    await new Promise((resolve) => setTimeout(resolve, 1500 + Math.random() * 800));
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise((resolve) => setTimeout(resolve, 600));
}

async function clickGoogleNextPage(page: Page): Promise<boolean> {
  const next = page.locator('#pnnext, a#pnnext, a[aria-label="Next"], a[aria-label="Próxima"]').first();
  try {
    if ((await next.count()) === 0) return false;
    await next.click({ timeout: 12000 });
    await page.waitForTimeout(2400);
    return true;
  } catch {
    return false;
  }
}

/**
 * Abre instagram.com/handle em nova aba, pré-filtros + processOneProfile (igual fluxo hashtag).
 */
async function profileExtractionPipelineNewTab(
  ctx: BrowserContext,
  handle: string,
  config: CollectorConfig,
  existingHandles: Set<string>,
  triedInSession: Set<string>,
  sess: Set<string> | undefined,
  discoveredBy: string,
  discoveredValue: string,
  onCollected: ((h: string, f: number) => void) | undefined,
  logCtx: string
): Promise<{ saved: number; processed: number }> {
  const handleLower = handle.toLowerCase();
  if (await skipIfHandleAlreadyOnRemoteServer(config, handle, existingHandles, handleLower, `(${logCtx})`)) {
    triedInSession.add(handleLower);
    sess?.add(handleLower);
    return { saved: 0, processed: 0 };
  }
  const hkUi = handle.replace(/^@/, '').trim().toLowerCase();
  const processingSince = new Date().toISOString();
  const touchProcessing = (stage: string, patch?: ProfileUiPatch): void => {
    setProcessingState({
      handle: hkUi,
      stage,
      since: processingSince,
      ...(patch ?? {}),
    });
  };
  /** Mostra @ e etapa na UI desde a abertura da aba (goto + gate rápido podem levar vários segundos). */
  touchProcessing('Abrindo perfil no Instagram…');
  const profileUrlFull = InstagramClient.profileUrl(handle);
  const profileTab = await ctx.newPage();
  let saved = 0;
  let processed = 0;
  try {
    try {
      await profileTab.goto(profileUrlFull, { waitUntil: 'domcontentloaded', timeout: 25000 });
    } catch {
      coletaLog(`${logCtx}: @${handle}: falha ao abrir perfil no Instagram (timeout ou rede).`);
      recordIssue(
        handle,
        'extracao',
        'Falha ao abrir o perfil no Instagram (timeout ou rede).'
      );
      triedInSession.add(handleLower);
      return { saved: 0, processed: 1 };
    }

    touchProcessing('Página carregada — lendo seguidores e validando regras…');

    await profileTab.waitForTimeout(400);
    if (await isInstagramProfileUnavailablePage(profileTab)) {
      coletaLog(`${logCtx}: @${handle}: perfil inexistente ou indisponível no Instagram.`);
      recordIssue(handle, 'extracao', INSTAGRAM_PROFILE_UNAVAILABLE_DETAIL);
      triedInSession.add(handleLower);
      return { saved: 0, processed: 1 };
    }

    await randomDelay(800, 1500);

    let snapH = await getFollowersAndMinimalProfile(profileTab, profileUrlFull, {
      skipGoto: true,
      quickGate: true,
    });
    if (!snapH.minimalProfile) {
      await randomDelay(180, 420);
      snapH = await getFollowersAndMinimalProfile(profileTab, profileUrlFull, {
        skipGoto: true,
        quickGate: true,
      });
    }
    if (!snapH.minimalProfile && (await isInstagramProfileUnavailablePage(profileTab))) {
      coletaLog(
        `${logCtx}: @${handle}: perfil inexistente ou indisponível (após tentativa rápida de dados).`
      );
      recordIssue(handle, 'extracao', INSTAGRAM_PROFILE_UNAVAILABLE_DETAIL);
      triedInSession.add(handleLower);
      return { saved: 0, processed: 1 };
    }

    const needFollowerLimits = config.minFollowersToSave > 0 || config.maxFollowersToSave > 0;
    let followersResolved = await resolveFollowersForEarlyGate(profileTab, snapH, config);
    /** Modo rápido: não faz segunda captura longa aqui; segue para próxima validação sem travar o fluxo. */
    if (needFollowerLimits && followersResolved == null) {
      coletaLog(
        `${logCtx}: @${handle}: seguidores indisponíveis no gate rápido — pulando espera longa para seguir mais rápido.`
      );
    }

    if (config.maxFollowersToSave > 0 && followersResolved != null && followersResolved > config.maxFollowersToSave) {
      recordIssue(
        handle,
        'regra',
        `Máximo de seguidores: ${config.maxFollowersToSave.toLocaleString('pt-BR')}; @${handle} tem ${followersResolved.toLocaleString('pt-BR')}.`,
        { followers_count: followersResolved }
      );
      coletaLog(
        `${logCtx}: @${handle}: acima do máximo de seguidores (${followersResolved.toLocaleString('pt-BR')}).`
      );
      triedInSession.add(handleLower);
      return { saved: 0, processed: 1 };
    }

    if (config.minFollowersToSave > 0) {
      if (followersResolved == null || followersResolved < config.minFollowersToSave) {
        const detail = `Antes de extrair o perfil completo: exige pelo menos ${config.minFollowersToSave.toLocaleString(
          'pt-BR'
        )} seguidores; @${handle} tem ${followersResolved != null ? followersResolved.toLocaleString('pt-BR') : '—'}.`;
        recordIssue(handle, 'regra', detail, { followers_count: followersResolved ?? undefined });
        coletaLog(`${logCtx}: @${handle}: ${detail}`);
        triedInSession.add(handleLower);
        return { saved: 0, processed: 1 };
      }
    }

    if (snapH.minimalProfile) {
      const rejBioH = explainRejectedEstablishmentKeywordInBio(
        snapH.minimalProfile as Record<string, unknown>
      );
      if (rejBioH) {
        recordIssue(handle, 'regra', rejBioH, {
          followers_count: followersResolved ?? snapH.followers ?? undefined,
        });
        triedInSession.add(handleLower);
        return { saved: 0, processed: 1 };
      }
    }
    if (
      snapH.minimalProfile &&
      rejectByAllowedAccountTypes(
        config,
        handle,
        snapH.minimalProfile as Record<string, unknown>,
        followersResolved ?? snapH.followers,
        logCtx
      )
    ) {
      triedInSession.add(handleLower);
      return { saved: 0, processed: 1 };
    }

    if (config.minFollowersToSave > 0) {
      const followers = followersResolved!;
      const bioEarlyHashtag =
        config.requireBioBrazilianPortuguese && snapH.minimalProfile
          ? explainBioNotBrazilianPortuguese({
            handle,
            username: handle,
            ...snapH.minimalProfile,
            followers_count: followers,
          } as Record<string, unknown>)
          : null;
      if (bioEarlyHashtag) {
        recordIssue(handle, 'regra', bioEarlyHashtag, {
          followers_count: followers,
        });
        triedInSession.add(handleLower);
        return { saved: 0, processed: 1 };
      }
      if (config.excludeBusinessProfiles && snapH.minimalProfile) {
        const entity = {
          handle,
          username: handle,
          ...snapH.minimalProfile,
          followers_count: followers,
        } as Record<string, unknown>;
        if (hasRejectedProfileKeyword(entity)) {
          recordIssue(handle, 'regra', explainRejectedProfileKeyword(entity), {
            followers_count: followers,
          });
          triedInSession.add(handleLower);
          return { saved: 0, processed: 1 };
        }
        if (isBusinessFromEntity(entity)) {
          recordIssue(handle, 'regra', explainCommercialOrEstablishment(entity), {
            followers_count: followers,
          });
          triedInSession.add(handleLower);
          return { saved: 0, processed: 1 };
        }
        if (!qualifiesAsInfluencer(entity, config.minFollowersToSave)) {
          recordIssue(handle, 'regra', explainNotQualifiesAsInfluencer(entity, config.minFollowersToSave), {
            followers_count: followers,
          });
          triedInSession.add(handleLower);
          return { saved: 0, processed: 1 };
        }
      }
    } else {
      if (config.requireBioBrazilianPortuguese && snapH.minimalProfile) {
        const bioEarly0 = explainBioNotBrazilianPortuguese({
          handle,
          username: handle,
          ...snapH.minimalProfile,
        } as Record<string, unknown>);
        if (bioEarly0) {
          recordIssue(handle, 'regra', bioEarly0);
          triedInSession.add(handleLower);
          return { saved: 0, processed: 1 };
        }
      }
      if (config.excludeBusinessProfiles && snapH.minimalProfile) {
        const fol =
          followersResolved ??
          snapH.followers ??
          getFollowersFromEntity(snapH.minimalProfile as Record<string, unknown>);
        const entity = {
          handle,
          username: handle,
          ...snapH.minimalProfile,
          followers_count: fol,
        } as Record<string, unknown>;
        if (hasRejectedProfileKeyword(entity)) {
          recordIssue(handle, 'regra', explainRejectedProfileKeyword(entity));
          triedInSession.add(handleLower);
          return { saved: 0, processed: 1 };
        }
        if (isBusinessFromEntity(entity)) {
          recordIssue(handle, 'regra', explainCommercialOrEstablishment(entity));
          triedInSession.add(handleLower);
          return { saved: 0, processed: 1 };
        }
        if (!qualifiesAsInfluencer(entity, config.minFollowersToSave)) {
          recordIssue(handle, 'regra', explainNotQualifiesAsInfluencer(entity, config.minFollowersToSave));
          triedInSession.add(handleLower);
          return { saved: 0, processed: 1 };
        }
      }
    }

    triedInSession.add(handleLower);
    processed = 1;
    // Só pula o gate em processOneProfile se já validamos bio (estabelecimento) aqui; senão deixa o gate rodar
    const gateAlreadyValidated = !!snapH.minimalProfile;
    coletaLog(`@${handle}: pré-filtros OK → extraindo (${logCtx}) em aba secundária (uma vez).`);
    const ok = await processOneProfile(
      profileTab,
      handle,
      config,
      existingHandles,
      discoveredBy,
      discoveredValue,
      {
        pageAlreadyOnProfile: true,
        skipGate: gateAlreadyValidated,
        prefillProfileSnap:
          snapH.minimalProfile != null
            ? {
                minimal: snapH.minimalProfile as Record<string, unknown>,
                followers: followersResolved ?? snapH.followers ?? null,
              }
            : undefined,
      },
      onCollected
    );
    if (ok) saved = 1;
    return { saved, processed: 1 };
  } finally {
    setProcessingState(null);
    sess?.add(handleLower);
    await profileTab.close().catch(() => { });
  }
}

/** Descoberta via Google: busca site:instagram.com…, extrai @ da SERP, abre cada perfil em nova aba. */
export async function discoverByGoogle(
  client: InstagramClient,
  page: Page,
  options: DiscoveryOptions
): Promise<{ saved: number; processed: number }> {
  const query = (options.googleQuery ?? '').trim();
  if (!query) {
    coletaLog(
      'Modo Google: defina a consulta (ex.: site:instagram.com ("pai" OR "mãe") mario).'
    );
    return { saved: 0, processed: 0 };
  }

  const { config, shouldAbort, sessionTriedHandles: sess, googleSessionPath } = options;
  const existingHandles = listHandles();
  const triedInSession = new Set<string>();
  const serpSeen = new Set<string>();
  const maxPages = Math.max(1, Math.min(50, options.maxSerpPages ?? 20));
  const ctx = page.context();

  if (googleSessionPath && existsSync(googleSessionPath)) {
    try {
      const raw = await readFile(googleSessionPath, 'utf-8');
      const data = JSON.parse(raw) as { cookies?: Array<{ name: string; value: string; domain?: string; path?: string }> };
      if (Array.isArray(data.cookies) && data.cookies.length > 0) {
        await ctx.addCookies(data.cookies);
        coletaLog(`Google: sessão carregada (${data.cookies.length} cookie(s)) — evita captcha se ainda válida.`);
      }
    } catch (e) {
      coletaLog(`Google: não foi possível carregar sessão: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const udmValues = options.udmValues ?? ['39', '7', ''];
  const googleQdr = normalizeGoogleQdr(options.googleQdr);
  coletaLog(`Google: busca → ${query.slice(0, 120)}${query.length > 120 ? '…' : ''} (${udmValues.length} tipo(s) de SERP: udm ${udmValues.map((u) => (u === '' ? 'geral' : u)).join(', ')})`);
  coletaLog(`Google: filtro de tempo → qdr=${googleQdr || '(sem filtro)'}`);
  coletaLog(
    'Google: usando aba dedicada para o Google; reels abrem em abas temporárias. A aba principal do Instagram não é alterada.'
  );

  let addedToQueue = 0;
  let googleTab: Page | null = null;
  try {
    googleTab = await ctx.newPage();
    for (const udm of udmValues) {
      if (shouldAbort()) break;
      let addedThisUdm = 0;
      const udmLabel = udm === '' ? '(geral)' : udm;
      coletaLog(`Google: abrindo SERP udm=${udmLabel}… (limite: ${options.maxProfiles} por fluxo)`);
      await googleTab.goto(googleSearchUrl(query, udm, googleQdr), { waitUntil: 'domcontentloaded', timeout: 35000 });
      await randomDelay(2500, 4000);

      try {
        const accept = googleTab
          .locator(
            'button:has-text("Aceitar tudo"), button:has-text("Accept all"), button:has-text("Aceitar"), form[action*="consent"] button'
          )
          .first();
        if ((await accept.count()) > 0) await accept.click({ timeout: 4000 }).catch(() => { });
      } catch {
        /* */
      }
      await randomDelay(1000, 2000);

      coletaLog(
        'Google: aguardando página de resultados (ou resolva captcha/verificação na aba do Google — até 90s).'
      );
      try {
        await googleTab.waitForSelector('div#search, div#rso, #rcnt, a[href*="instagram.com"]', {
          timeout: 90_000,
        });
      } catch {
        coletaLog('Google: timeout aguardando resultados; pode ter captcha. Tente iniciar de novo após resolver.');
        break;
      }
      await randomDelay(1500, 3000);

      for (let pageNum = 0; pageNum < maxPages && !shouldAbort(); pageNum++) {
        if (addedThisUdm >= options.maxProfiles) {
          coletaLog(`Google: udm=${udmLabel} — limite de ${options.maxProfiles} por fluxo atingido.`);
          break;
        }
        if (udm === '7' || udm === '39') {
          coletaLog(`Google: udm=${udm} — rolando a página para carregar mais resultados…`);
          await scrollGoogleSerpToLoadMore(googleTab, 5);
        }
        const result = await scrapeInstagramHandlesFromGoogleSerp(googleTab);
        const allHandles = result.handles.map((x) => x.handle);
        setLastGoogleSerpExtraction(pageNum + 1, allHandles);
        coletaLog(
          `Google: udm=${udmLabel} página SERP ${pageNum + 1}/${maxPages} — ${result.handles.length} handle(s) + ${result.reelUrls.length} reel(s) a resolver.`
        );

        for (const item of result.handles) {
          if (shouldAbort() || addedThisUdm >= options.maxProfiles) break;
          const hl = item.handle.toLowerCase();
          if (serpSeen.has(hl)) continue;
          serpSeen.add(hl);
          if (existingHandles.has(hl) || triedInSession.has(hl) || sess?.has(hl)) continue;
          if (isBlocklistedHandle(item.handle) || containsRejectedKeyword(item.handle)) {
            sess?.add(hl);
            triedInSession.add(hl);
            continue;
          }
          if (addToGoogleQueue(item.handle, item.snippet)) { addedToQueue++; addedThisUdm++; }
        }

        for (const { reelUrl, snippet } of result.reelUrls) {
          if (shouldAbort() || addedThisUdm >= options.maxProfiles) break;
          const resolved = await resolveHandleFromReelUrl(ctx, reelUrl, shouldAbort);
          if (resolved) {
            const hl = resolved.toLowerCase();
            if (serpSeen.has(hl)) continue;
            serpSeen.add(hl);
            if (existingHandles.has(hl) || triedInSession.has(hl) || sess?.has(hl)) continue;
            if (isBlocklistedHandle(resolved) || containsRejectedKeyword(resolved)) {
              sess?.add(hl);
              triedInSession.add(hl);
              continue;
            }
            if (addToGoogleQueue(resolved, snippet)) { addedToQueue++; addedThisUdm++; }
          }
          await randomDelay(400, 800);
        }

        if (shouldAbort() || addedThisUdm >= options.maxProfiles) break;
        let advanced = await clickGoogleNextPage(googleTab);
        if (!advanced && (udm === '7' || udm === '39')) {
          const maxScrollRounds = 3;
          for (let scrollRound = 0; scrollRound < maxScrollRounds && !shouldAbort() && addedThisUdm < options.maxProfiles; scrollRound++) {
            coletaLog(`Google: udm=${udm} — sem botão "Próxima"; rolando para carregar mais (rodada ${scrollRound + 1}/${maxScrollRounds})…`);
            await scrollGoogleSerpToLoadMore(googleTab, 4);
            const more = await scrapeInstagramHandlesFromGoogleSerp(googleTab);
            let gotNew = 0;
            for (const item of more.handles) {
              if (addedThisUdm >= options.maxProfiles) break;
              const hl = item.handle.toLowerCase();
              if (serpSeen.has(hl)) continue;
              serpSeen.add(hl);
              if (existingHandles.has(hl) || triedInSession.has(hl) || sess?.has(hl)) continue;
              if (isBlocklistedHandle(item.handle) || containsRejectedKeyword(item.handle)) {
                sess?.add(hl);
                triedInSession.add(hl);
                continue;
              }
              if (addToGoogleQueue(item.handle, item.snippet)) { addedToQueue++; addedThisUdm++; gotNew++; }
            }
            for (const { reelUrl, snippet } of more.reelUrls) {
              if (shouldAbort() || addedThisUdm >= options.maxProfiles) break;
              const resolved = await resolveHandleFromReelUrl(ctx, reelUrl, shouldAbort);
              if (resolved) {
                const hl = resolved.toLowerCase();
                if (serpSeen.has(hl)) continue;
                serpSeen.add(hl);
                if (existingHandles.has(hl) || triedInSession.has(hl) || sess?.has(hl)) continue;
                if (isBlocklistedHandle(resolved) || containsRejectedKeyword(resolved)) {
                  sess?.add(hl);
                  triedInSession.add(hl);
                  continue;
                }
                if (addToGoogleQueue(resolved, snippet)) { addedToQueue++; addedThisUdm++; gotNew++; }
              }
              await randomDelay(400, 800);
            }
            coletaLog(`Google: udm=${udm} após scroll — +${gotNew} novo(s) na fila.`);
            if (gotNew === 0) break;
          }
          break;
        }
        if (!advanced) {
          coletaLog(`Google: udm=${udmLabel} fim dos resultados (sem próxima página).`);
          break;
        }
      }
      if (addedThisUdm >= options.maxProfiles) {
        coletaLog(`Google: udm=${udmLabel} — limite por fluxo (${options.maxProfiles}) atingido; avançando para o próximo tipo de SERP.`);
      }
    }
    coletaLog(`Google: ${addedToQueue} handle(s) adicionado(s) à fila. O processamento no Instagram ocorre em seguida, 1 perfil por vez.`);
  } finally {
    if (googleTab) {
      await googleTab.close().catch(() => { });
      coletaLog('Google: aba do Google fechada; aba principal do Instagram permanece inalterada.');
    }
    if (googleSessionPath) {
      try {
        const allCookies = await ctx.cookies();
        const googleCookies = allCookies.filter(
          (c) => c.domain && (c.domain.includes('google.com') || c.domain.includes('google.com.br'))
        );
        if (googleCookies.length > 0) {
          const dir = dirname(googleSessionPath);
          await mkdir(dir, { recursive: true });
          await writeFile(
            googleSessionPath,
            JSON.stringify({
              cookies: googleCookies,
              savedAt: new Date().toISOString(),
            }),
            'utf-8'
          );
          coletaLog(`Google: sessão salva (${googleCookies.length} cookie(s)) em ${googleSessionPath}.`);
        }
      } catch (e) {
        coletaLog(`Google: não foi possível salvar sessão: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  return { saved: 0, processed: 0 };
}

/**
 * Processa a fila Google no Instagram: 1 perfil por vez, de forma assíncrona.
 * Deve ser chamado após discoverByGoogle (com a página já no Instagram).
 */
export async function processGoogleQueue(
  _client: InstagramClient,
  page: Page,
  options: DiscoveryOptions
): Promise<{ saved: number; processed: number }> {
  const { config, shouldAbort, onCollected, sessionTriedHandles: sess } = options;
  const ctx = page.context();
  const triedInSession = new Set<string>();
  let saved = 0;
  let processed = 0;
  const query = (options.googleQuery ?? '').trim().slice(0, 500);

  while (!shouldAbort() && saved < options.maxProfiles) {
    const item = takeNextFromGoogleQueue();
    if (!item) break;
    const existingHandles = listHandles();
    let r: { saved: number; processed: number };
    try {
      r = await profileExtractionPipelineNewTab(
        ctx,
        item.handle,
        config,
        existingHandles,
        triedInSession,
        sess,
        'google',
        query,
        onCollected,
        'Google (fila)'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isClosed = /closed|Target page|context or browser has been closed/i.test(msg);
      if (isClosed) {
        coletaLog(`Google (fila): @${item.handle} — janela/aba fechada, indo para o próximo.`);
      } else {
        coletaLog(`Google (fila): @${item.handle} — erro: ${msg}`);
      }
      recordIssue(item.handle, 'extracao', isClosed ? 'Janela ou aba fechada durante a extração.' : msg);
      r = { saved: 0, processed: 1 };
    }
    saved += r.saved;
    processed += r.processed;
    if (r.saved) {
      coletaLog(`Google (fila): @${item.handle} salvo (${saved}/${options.maxProfiles}).`);
    }
    await randomDelay(600, 1200);
  }

  return { saved, processed };
}

/** Descoberta por hashtag: abre posts da grade, pega autor, extrai perfil. */
export async function discoverByHashtag(
  client: InstagramClient,
  page: Page,
  tag: string,
  options: DiscoveryOptions
): Promise<{ saved: number; processed: number }> {
  const { config, shouldAbort, onCollected, sessionTriedHandles: sess } = options;
  const existingHandles = listHandles();
  const triedInSession = new Set<string>();
  let saved = 0;
  let processed = 0;

  const url = InstagramClient.tagUrl(tag);
  if (!isOnHashtagGridPage(page.url(), tag)) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await randomDelay(2000, 4000);
  } else {
    await randomDelay(400, 900);
  }

  const currentUrl = page.url();
  if (currentUrl.includes('/accounts/login/') || currentUrl.includes('/challenge/')) {
    console.log('[discovery] Redirecionado para login — faça login no browser e tente de novo.');
    return { saved: 0, processed: 0 };
  }

  await page.evaluate(() => window.scrollTo(0, 600));
  await randomDelay(1500, 3000);

  let postLinks = page.locator('article a[href^="/p/"]');
  if ((await postLinks.count()) === 0) postLinks = page.locator('a[href*="/p/"]');
  const toProcess = Math.min(options.maxProfiles * 3, await postLinks.count(), config.maxPostsPerTag);
  if (toProcess === 0) {
    coletaLog(`#${tag}: nenhum post na grade para processar.`);
    return { saved: 0, processed: 0 };
  }
  coletaLog(
    `#${tag}: fila de até ${toProcess} posts na grade | meta ${options.maxProfiles} perfil(is) salvos | handles já na base: ${existingHandles.size}`
  );

  for (let postIndex = 0; postIndex < toProcess && saved < options.maxProfiles; postIndex++) {
    if (shouldAbort()) {
      coletaLog(`Parar solicitado — saindo do loop da hashtag #${tag}.`);
      break;
    }
    if (postIndex % 5 === 0 || postIndex === 0) {
      coletaLog(`#${tag}: post ${postIndex + 1}/${toProcess} na grade | salvos até agora: ${saved}/${options.maxProfiles}`);
    }

    await ensureHashtagGridReady(page, url, tag, postIndex + 1);

    postLinks = page.locator('article a[href^="/p/"]');
    if ((await postLinks.count()) === 0) postLinks = page.locator('a[href*="/p/"]');
    const postLink = postLinks.nth(postIndex);
    let authorFromGrid: string | null = null;
    try {
      const postHref = await postLink.getAttribute('href');
      if (postHref?.includes('/p/')) {
        const m = postHref.match(/^\/([^/]+)\/p\//);
        if (m) authorFromGrid = m[1].split('?')[0]?.trim() ?? null;
      }
      if (!authorFromGrid) {
        const fromDom = await postLink.evaluate((el) => {
          const profileRe = /^\/[^/]+\/?$/;
          let root: Element | null = el;
          for (let i = 0; i < 10 && root; i++) {
            root = root.parentElement;
            if (!root) return null;
            const links = root.querySelectorAll('a[href^="/"]');
            for (const a of links) {
              const href = (a as HTMLAnchorElement).getAttribute('href');
              const path = href ? href.split('?')[0] : '';
              if (path && !path.includes('/p/') && profileRe.test(path)) {
                return path.replace(/^\//, '').split('/')[0]?.trim() ?? null;
              }
            }
          }
          return null;
        });
        if (fromDom) authorFromGrid = fromDom;
      }
    } catch {
      // ignore
    }

    if (authorFromGrid) {
      const lower = authorFromGrid.toLowerCase();
      if (existingHandles.has(lower) || triedInSession.has(lower) || sess?.has(lower)) {
        if (existingHandles.has(lower)) {
          recordDuplicate(authorFromGrid);
          coletaLog(`post ${postIndex + 1}: @${authorFromGrid} duplicado (já na base), pulando.`);
        } else if (sess?.has(lower)) {
          coletaLog(
            `post ${postIndex + 1}: @${authorFromGrid} já processado nesta coleta (outra hashtag ou Problemas), pulando.`
          );
        } else {
          coletaLog(`post ${postIndex + 1}: @${authorFromGrid} já tentado nesta rodada #${tag}, pulando.`);
        }
        await randomDelay(800, 1500);
        continue;
      }
      if (isBlocklistedHandle(authorFromGrid) || containsRejectedKeyword(authorFromGrid)) {
        triedInSession.add(lower);
        sess?.add(lower);
        coletaLog(`post ${postIndex + 1}: @${authorFromGrid} bloqueado/lista, pulando.`);
        continue;
      }
    }

    await randomDelay(1500, 3500);
    await postLink.scrollIntoViewIfNeeded().catch(() => { });
    const postHrefAttr = await postLink.getAttribute('href').catch(() => null);
    const postAbsolute =
      postHrefAttr && /\/(p|reel)\//.test(postHrefAttr)
        ? InstagramClient.absoluteUrl(postHrefAttr)
        : null;
    if (!postAbsolute) {
      coletaLog(`post ${postIndex + 1}: sem URL de post/reel, próximo.`);
      await randomDelay(800, 1500);
      continue;
    }

    const ctx = page.context();
    let postTab: Page | null = null;
    let handle: string | null = null;
    try {
      postTab = await ctx.newPage();
      await postTab.goto(postAbsolute, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await randomDelay(1000, 2000);
      handle = await getAuthorFromPostPage(postTab);
    } catch {
      coletaLog(`post ${postIndex + 1}: falha ao abrir post em nova aba, próximo.`);
      handle = null;
    } finally {
      if (postTab) await postTab.close().catch(() => { });
    }

    if (!handle) {
      coletaLog(`post ${postIndex + 1}: não achei autor no post (aba fechada — grade intacta na aba principal).`);
      await randomDelay(800, 1500);
      continue;
    }

    const handleLower = handle.toLowerCase();
    if (existingHandles.has(handleLower) || triedInSession.has(handleLower) || sess?.has(handleLower)) {
      if (existingHandles.has(handleLower)) {
        recordDuplicate(handle);
        coletaLog(`@${handle}: duplicado após abrir post, pulando.`);
      } else if (sess?.has(handleLower)) {
        coletaLog(`@${handle}: já processado nesta coleta, pulando (não reabre perfil).`);
      } else {
        coletaLog(`@${handle}: já tentado nesta sessão na grade, pulando.`);
      }
      await randomDelay(800, 1500);
      continue;
    }

    let rPipe: { saved: number; processed: number };
    try {
      rPipe = await profileExtractionPipelineNewTab(
        ctx,
        handle,
        config,
        existingHandles,
        triedInSession,
        sess,
        'hashtag',
        tag,
        onCollected,
        `#${tag}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isClosed = /closed|Target page|context or browser has been closed/i.test(msg);
      if (isClosed) {
        coletaLog(`#${tag}: @${handle} — janela/aba fechada durante extração, avançando para o próximo post.`);
      } else {
        coletaLog(`#${tag}: @${handle} — erro na extração, avançando para o próximo post: ${msg}`);
      }
      recordIssue(handle, 'extracao', isClosed ? 'Janela ou aba fechada durante a extração.' : msg);
      rPipe = { saved: 0, processed: 1 };
    }
    saved += rPipe.saved;
    processed += rPipe.processed;
    if (rPipe.saved) {
      coletaLog(`@${handle}: concluído e contabilizado (${saved}/${options.maxProfiles} salvos nesta hashtag).`);
    } else if (rPipe.processed) {
      coletaLog(`@${handle}: não entrou como salvo (regra/erro — veja tabela Problemas na UI).`);
    }

    coletaLog(
      `#${tag}: aba do perfil fechada — próximo post ${postIndex + 2}/${toProcess} (sem recarregar a grade na aba principal)`
    );
    await randomDelay(800, 1600);
  }

  return { saved, processed };
}

/** Descoberta pelo feed: rola o feed, pega autor do primeiro post, extrai. */
export async function discoverByFeed(
  client: InstagramClient,
  page: Page,
  options: DiscoveryOptions
): Promise<{ saved: number; processed: number }> {
  const { config, shouldAbort, onCollected, sessionTriedHandles: sess } = options;
  const existingHandles = listHandles();
  const skipped = new Set<string>();
  let saved = 0;
  let processed = 0;

  await page.goto(InstagramClient.homeFeedUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 });
  await randomDelay(2000, 4000);

  if (page.url().includes('/accounts/login/') || page.url().includes('/challenge/')) {
    console.log('[discovery] Faça login no browser e tente de novo.');
    return { saved: 0, processed: 0 };
  }

  while (saved < options.maxProfiles && !shouldAbort()) {
    await randomDelay(1500, 3500);
    const article = page.locator('article').first();
    if ((await article.count()) === 0) {
      await page.evaluate(() => window.scrollBy(0, 400));
      await randomDelay(1000, 2000);
      continue;
    }
    const isSponsored = (await article.locator('text=/patrocinado/i').count()) > 0;
    if (isSponsored) {
      await page.evaluate(() => window.scrollBy(0, 400));
      continue;
    }
    const linkCount = await article.locator('a[href^="/"]').count();
    let authorHref: string | null = null;
    for (let j = 0; j < linkCount; j++) {
      const h = await article.locator('a[href^="/"]').nth(j).getAttribute('href');
      if (h && isProfileHref(h)) {
        authorHref = h;
        break;
      }
    }
    if (!authorHref) {
      await page.evaluate(() => window.scrollBy(0, 400));
      continue;
    }
    const handle = authorHref.replace(/^\//, '').split('/')[0]?.trim().split('?')[0] ?? '';
    const hlFeed = handle.toLowerCase();
    if (!handle || skipped.has(hlFeed) || existingHandles.has(hlFeed) || sess?.has(hlFeed)) {
      if (handle && existingHandles.has(hlFeed)) recordDuplicate(handle);
      if (handle && sess?.has(hlFeed) && !existingHandles.has(hlFeed) && !skipped.has(hlFeed)) {
        coletaLog(`Feed: @${handle} já visto nesta coleta / Problemas, pulando.`);
      }
      await page.evaluate(() => window.scrollBy(0, 400));
      continue;
    }
    if (isBlocklistedHandle(handle) || containsRejectedKeyword(handle)) {
      skipped.add(hlFeed);
      sess?.add(hlFeed);
      await page.evaluate(() => window.scrollBy(0, 400));
      continue;
    }

    try {
      await article.locator(`a[href^="/${handle}"]`).first().click();
      await page.waitForURL(profileUrlRe, { timeout: 20000 });
    } catch {
      await page.evaluate(() => window.scrollBy(0, 400));
      continue;
    }
    await randomDelay(1500, 2500);

    const profileUrlFeed = InstagramClient.profileUrl(handle);
    let snapF = await getFollowersAndMinimalProfile(page, profileUrlFeed, { skipGoto: true });
    if (!snapF.minimalProfile) {
      await randomDelay(1200, 2200);
      snapF = await getFollowersAndMinimalProfile(page, profileUrlFeed, { skipGoto: true });
    }

    const folFeed = await resolveFollowersForEarlyGate(page, snapF, config);
    if (config.maxFollowersToSave > 0 && folFeed != null && folFeed > config.maxFollowersToSave) {
      recordIssue(handle, 'regra', `No feed: máximo ${config.maxFollowersToSave.toLocaleString('pt-BR')} seguidores; @${handle} tem ${folFeed.toLocaleString('pt-BR')}.`, {
        followers_count: folFeed,
      });
      coletaLog(`Feed: @${handle}: acima do máximo de seguidores (${folFeed.toLocaleString('pt-BR')}).`);
      skipped.add(hlFeed);
      sess?.add(hlFeed);
      processed++;
      await page.goBack({ timeout: 15000 });
      continue;
    }
    if (config.minFollowersToSave > 0) {
      if (folFeed == null || folFeed < config.minFollowersToSave) {
        const detail = `No feed: exige ≥${config.minFollowersToSave.toLocaleString('pt-BR')} seguidores para abrir o perfil; @${handle} tem ${folFeed != null ? folFeed.toLocaleString('pt-BR') : '—'}.`;
        recordIssue(handle, 'regra', detail, { followers_count: folFeed ?? undefined });
        coletaLog(`Feed: @${handle}: ${detail}`);
        skipped.add(hlFeed);
        sess?.add(hlFeed);
        processed++;
        await page.goBack({ timeout: 15000 });
        continue;
      }
    }

    if (snapF.minimalProfile) {
      const rejBioF = explainRejectedEstablishmentKeywordInBio(
        snapF.minimalProfile as Record<string, unknown>
      );
      if (rejBioF) {
        recordIssue(handle, 'regra', `No feed: ${rejBioF}`, {
          followers_count: folFeed ?? snapF.followers ?? undefined,
        });
        skipped.add(hlFeed);
        sess?.add(hlFeed);
        processed++;
        await page.goBack({ timeout: 15000 });
        continue;
      }
    }

    if (
      snapF.minimalProfile &&
      rejectByAllowedAccountTypes(
        config,
        handle,
        snapF.minimalProfile as Record<string, unknown>,
        folFeed ?? snapF.followers,
        'Feed',
        'No feed:'
      )
    ) {
      skipped.add(hlFeed);
      sess?.add(hlFeed);
      processed++;
      await page.goBack({ timeout: 15000 });
      continue;
    }

    if (config.minFollowersToSave > 0) {
      const result = snapF;
      const followers = folFeed!;
      const bioEarlyFeed =
        config.requireBioBrazilianPortuguese && result.minimalProfile
          ? explainBioNotBrazilianPortuguese({
            handle,
            username: handle,
            ...result.minimalProfile,
            followers_count: followers,
          } as Record<string, unknown>)
          : null;
      if (bioEarlyFeed) {
        recordIssue(handle, 'regra', `No feed: ${bioEarlyFeed}`, {
          followers_count: followers,
        });
        skipped.add(hlFeed);
        sess?.add(hlFeed);
        processed++;
        await page.goBack({ timeout: 15000 });
        continue;
      }
      if (config.excludeBusinessProfiles && result.minimalProfile) {
        const entity = {
          handle,
          username: handle,
          ...result.minimalProfile,
          followers_count: followers,
        } as Record<string, unknown>;
        let feedDetail = '';
        if (hasRejectedProfileKeyword(entity)) {
          feedDetail = explainRejectedProfileKeyword(entity);
        } else if (isBusinessFromEntity(entity)) {
          feedDetail = explainCommercialOrEstablishment(entity);
        } else if (!qualifiesAsInfluencer(entity, config.minFollowersToSave)) {
          feedDetail = explainNotQualifiesAsInfluencer(entity, config.minFollowersToSave);
        }
        if (feedDetail) {
          recordIssue(handle, 'regra', `No feed: ${feedDetail}`, {
            followers_count: followers,
          });
          skipped.add(hlFeed);
          sess?.add(hlFeed);
          await page.goBack({ timeout: 15000 });
          continue;
        }
      }
    } else {
      if (config.requireBioBrazilianPortuguese && snapF.minimalProfile) {
        const bioF0 = explainBioNotBrazilianPortuguese({
          handle,
          username: handle,
          ...snapF.minimalProfile,
        } as Record<string, unknown>);
        if (bioF0) {
          recordIssue(handle, 'regra', `No feed: ${bioF0}`);
          skipped.add(hlFeed);
          sess?.add(hlFeed);
          processed++;
          await page.goBack({ timeout: 15000 });
          continue;
        }
      }
      if (
        snapF.minimalProfile &&
        rejectByAllowedAccountTypes(
          config,
          handle,
          snapF.minimalProfile as Record<string, unknown>,
          folFeed ?? snapF.followers,
          'Feed',
          'No feed:'
        )
      ) {
        skipped.add(hlFeed);
        sess?.add(hlFeed);
        processed++;
        await page.goBack({ timeout: 15000 });
        continue;
      }
      if (config.excludeBusinessProfiles && snapF.minimalProfile) {
        const fol =
          folFeed ?? snapF.followers ?? getFollowersFromEntity(snapF.minimalProfile as Record<string, unknown>);
        const entity = {
          handle,
          username: handle,
          ...snapF.minimalProfile,
          followers_count: fol,
        } as Record<string, unknown>;
        let feedDetail = '';
        if (hasRejectedProfileKeyword(entity)) {
          feedDetail = explainRejectedProfileKeyword(entity);
        } else if (isBusinessFromEntity(entity)) {
          feedDetail = explainCommercialOrEstablishment(entity);
        } else if (!qualifiesAsInfluencer(entity, config.minFollowersToSave)) {
          feedDetail = explainNotQualifiesAsInfluencer(entity, config.minFollowersToSave);
        }
        if (feedDetail) {
          recordIssue(handle, 'regra', `No feed: ${feedDetail}`);
          skipped.add(hlFeed);
          sess?.add(hlFeed);
          await page.goBack({ timeout: 15000 });
          continue;
        }
      }
    }

    processed++;
    const ok = await processOneProfile(
      page,
      handle,
      config,
      existingHandles,
      'feed',
      'home',
      { pageAlreadyOnProfile: true },
      onCollected
    );
    if (ok) saved++;
    skipped.add(hlFeed);
    sess?.add(hlFeed);

    await page.goBack({ timeout: 15000 });
    await randomDelay(1000, 2000);
  }

  return { saved, processed };
}

/** Descoberta pelo Explore: abre a grade, clica no primeiro post, pega autor e extrai. */
export async function discoverByExplore(
  client: InstagramClient,
  page: Page,
  options: DiscoveryOptions
): Promise<{ saved: number; processed: number }> {
  const { config, shouldAbort, onCollected, sessionTriedHandles: sess } = options;
  const existingHandles = listHandles();
  const skipped = new Set<string>();
  let saved = 0;
  let processed = 0;

  await page.goto(InstagramClient.exploreUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 });
  await randomDelay(2000, 4000);

  if (page.url().includes('/accounts/login/') || page.url().includes('/challenge/')) {
    console.log('[discovery] Faça login no browser e tente de novo.');
    return { saved: 0, processed: 0 };
  }

  await page.evaluate(() => window.scrollBy(0, 400));
  await randomDelay(1500, 3000);

  while (saved < options.maxProfiles && !shouldAbort()) {
    const postLink = page.locator('article a[href*="/p/"], a[href*="/reel/"]').first();
    if ((await postLink.count()) === 0) {
      await page.evaluate(() => window.scrollBy(0, 400));
      await randomDelay(1000, 2000);
      continue;
    }
    await randomDelay(1500, 3000);
    try {
      await postLink.click({ force: true, timeout: 15000 });
      await page.waitForURL(/\/(p|reel)\//, { timeout: 20000 });
    } catch {
      await randomDelay(1000, 2000);
      continue;
    }
    await randomDelay(1000, 2000);

    const handle = await getAuthorFromPostPage(page);
    if (!handle) {
      try {
        await page.goBack({ timeout: 15000 });
      } catch {
        await page.goto(InstagramClient.exploreUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 });
      }
      await randomDelay(1000, 2000);
      continue;
    }

    const handleLower = handle.toLowerCase();
    if (existingHandles.has(handleLower) || skipped.has(handleLower) || sess?.has(handleLower)) {
      if (existingHandles.has(handleLower)) recordDuplicate(handle);
      if (sess?.has(handleLower) && !existingHandles.has(handleLower) && !skipped.has(handleLower)) {
        coletaLog(`Explore: @${handle} já visto nesta coleta / Problemas, pulando.`);
      }
      try {
        await page.goBack({ timeout: 15000 });
      } catch {
        await page.goto(InstagramClient.exploreUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 });
      }
      await randomDelay(1000, 2000);
      continue;
    }
    if (isBlocklistedHandle(handle) || containsRejectedKeyword(handle)) {
      skipped.add(handleLower);
      sess?.add(handleLower);
      try {
        await page.goBack({ timeout: 15000 });
      } catch {
        await page.goto(InstagramClient.exploreUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 });
      }
      continue;
    }

    const profileUrl = InstagramClient.profileUrl(handle);
    if (config.minFollowersToSave > 0) {
      const result = await getFollowersAndMinimalProfile(page, profileUrl, {
        doNavigate: async () => {
          const authorLink = page.locator(`a[href^="/${handle}"]`).first();
          await authorLink.click({ force: true, timeout: 15000 });
          await page.waitForURL(profileUrlRe, { timeout: 20000 });
        },
      });
      const folExplore = await resolveFollowersForEarlyGate(page, result, config);
      if (config.maxFollowersToSave > 0 && folExplore != null && folExplore > config.maxFollowersToSave) {
        recordIssue(handle, 'regra', `No Explore: máximo ${config.maxFollowersToSave.toLocaleString('pt-BR')} seguidores; @${handle} tem ${folExplore.toLocaleString('pt-BR')}.`, {
          followers_count: folExplore,
        });
        coletaLog(`Explore: @${handle}: acima do máximo de seguidores (${folExplore.toLocaleString('pt-BR')}).`);
        skipped.add(handleLower);
        sess?.add(handleLower);
        processed++;
        try {
          await page.goBack({ timeout: 15000 });
          await page.goBack({ timeout: 15000 });
        } catch {
          await page.goto(InstagramClient.exploreUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 });
        }
        await randomDelay(1000, 2000);
        continue;
      }
      if (folExplore == null || folExplore < config.minFollowersToSave) {
        const detail = `No Explore: exige ≥${config.minFollowersToSave.toLocaleString('pt-BR')} seguidores; @${handle} tem ${folExplore != null ? folExplore.toLocaleString('pt-BR') : '—'}.`;
        recordIssue(handle, 'regra', detail, { followers_count: folExplore ?? undefined });
        coletaLog(`Explore: @${handle}: ${detail}`);
        skipped.add(handleLower);
        sess?.add(handleLower);
        processed++;
        try {
          await page.goBack({ timeout: 15000 });
          await page.goBack({ timeout: 15000 });
        } catch {
          await page.goto(InstagramClient.exploreUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 });
        }
        await randomDelay(1000, 2000);
        continue;
      }
      if (result.minimalProfile) {
        const rejBioE = explainRejectedEstablishmentKeywordInBio(
          result.minimalProfile as Record<string, unknown>
        );
        if (rejBioE) {
          recordIssue(handle, 'regra', `No Explore: ${rejBioE}`, {
            followers_count: folExplore ?? result.followers ?? undefined,
          });
          skipped.add(handleLower);
          sess?.add(handleLower);
          processed++;
          try {
            await page.goBack({ timeout: 15000 });
            await page.goBack({ timeout: 15000 });
          } catch {
            await page.goto(InstagramClient.exploreUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 });
          }
          await randomDelay(1000, 2000);
          continue;
        }
      }
      if (
        result.minimalProfile &&
        rejectByAllowedAccountTypes(
          config,
          handle,
          result.minimalProfile as Record<string, unknown>,
          folExplore ?? result.followers,
          'Explore',
          'No Explore:'
        )
      ) {
        skipped.add(handleLower);
        sess?.add(handleLower);
        processed++;
        try {
          await page.goBack({ timeout: 15000 });
          await page.goBack({ timeout: 15000 });
        } catch {
          await page.goto(InstagramClient.exploreUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 });
        }
        await randomDelay(1000, 2000);
        continue;
      }
      const bioEarlyExp =
        config.requireBioBrazilianPortuguese && result.minimalProfile
          ? explainBioNotBrazilianPortuguese({
            handle,
            username: handle,
            ...result.minimalProfile,
            followers_count: folExplore,
          } as Record<string, unknown>)
          : null;
      if (bioEarlyExp) {
        recordIssue(handle, 'regra', `No Explore: ${bioEarlyExp}`, {
          followers_count: folExplore,
        });
        skipped.add(handleLower);
        sess?.add(handleLower);
        processed++;
        try {
          await page.goBack({ timeout: 15000 });
          await page.goBack({ timeout: 15000 });
        } catch {
          await page.goto(InstagramClient.exploreUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 });
        }
        await randomDelay(1000, 2000);
        continue;
      }
      if (config.excludeBusinessProfiles && result.minimalProfile) {
        const entity = {
          handle,
          username: handle,
          ...result.minimalProfile,
          followers_count: folExplore,
        } as Record<string, unknown>;
        let expDetail = '';
        if (hasRejectedProfileKeyword(entity)) {
          expDetail = explainRejectedProfileKeyword(entity);
        } else if (isBusinessFromEntity(entity)) {
          expDetail = explainCommercialOrEstablishment(entity);
        } else if (!qualifiesAsInfluencer(entity, config.minFollowersToSave)) {
          expDetail = explainNotQualifiesAsInfluencer(entity, config.minFollowersToSave);
        }
        if (expDetail) {
          recordIssue(handle, 'regra', `No Explore: ${expDetail}`, {
            followers_count: folExplore,
          });
          skipped.add(handleLower);
          sess?.add(handleLower);
          try {
            await page.goBack({ timeout: 15000 });
            await page.goBack({ timeout: 15000 });
          } catch {
            await page.goto(InstagramClient.exploreUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 });
          }
          await randomDelay(1000, 2000);
          continue;
        }
      }
      const authorLink = page.locator(`a[href^="/${handle}"]`).first();
      await authorLink.click({ force: true, timeout: 15000 });
      await page.waitForURL(profileUrlRe, { timeout: 20000 });
      await randomDelay(1500, 2500);
    } else {
      const authorLink = page.locator(`a[href^="/${handle}"]`).first();
      await authorLink.click({ force: true, timeout: 15000 });
      await page.waitForURL(profileUrlRe, { timeout: 20000 });
      await randomDelay(1500, 2500);
    }

    if (config.minFollowersToSave <= 0) {
      let sExp = await getFollowersAndMinimalProfile(page, profileUrl, { skipGoto: true });
      if (!sExp.minimalProfile) {
        await randomDelay(1200, 2200);
        sExp = await getFollowersAndMinimalProfile(page, profileUrl, { skipGoto: true });
      }
      const folS = await resolveFollowersForEarlyGate(page, sExp, config);
      if (config.maxFollowersToSave > 0 && folS != null && folS > config.maxFollowersToSave) {
        recordIssue(handle, 'regra', `No Explore: máximo ${config.maxFollowersToSave.toLocaleString('pt-BR')} seguidores; @${handle} tem ${folS.toLocaleString('pt-BR')}.`, {
          followers_count: folS,
        });
        coletaLog(`Explore: @${handle}: acima do máximo de seguidores (${folS.toLocaleString('pt-BR')}).`);
        skipped.add(handleLower);
        sess?.add(handleLower);
        processed++;
        try {
          await page.goBack({ timeout: 15000 });
          await page.goBack({ timeout: 15000 });
        } catch {
          await page.goto(InstagramClient.exploreUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 });
        }
        await randomDelay(1000, 2000);
        continue;
      }
      if (sExp.minimalProfile) {
        const rjExp = explainRejectedEstablishmentKeywordInBio(
          sExp.minimalProfile as Record<string, unknown>
        );
        if (rjExp) {
          recordIssue(handle, 'regra', `No Explore: ${rjExp}`, {
            followers_count: folS ?? sExp.followers ?? undefined,
          });
          skipped.add(handleLower);
          sess?.add(handleLower);
          processed++;
          try {
            await page.goBack({ timeout: 15000 });
            await page.goBack({ timeout: 15000 });
          } catch {
            await page.goto(InstagramClient.exploreUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 });
          }
          await randomDelay(1000, 2000);
          continue;
        }
      }
      if (
        sExp.minimalProfile &&
        rejectByAllowedAccountTypes(
          config,
          handle,
          sExp.minimalProfile as Record<string, unknown>,
          folS ?? sExp.followers,
          'Explore',
          'No Explore:'
        )
      ) {
        skipped.add(handleLower);
        sess?.add(handleLower);
        processed++;
        try {
          await page.goBack({ timeout: 15000 });
          await page.goBack({ timeout: 15000 });
        } catch {
          await page.goto(InstagramClient.exploreUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 });
        }
        await randomDelay(1000, 2000);
        continue;
      }
      if (config.requireBioBrazilianPortuguese && sExp.minimalProfile) {
        const bioE0 = explainBioNotBrazilianPortuguese({
          handle,
          username: handle,
          ...sExp.minimalProfile,
        } as Record<string, unknown>);
        if (bioE0) {
          recordIssue(handle, 'regra', `No Explore: ${bioE0}`);
          skipped.add(handleLower);
          sess?.add(handleLower);
          processed++;
          try {
            await page.goBack({ timeout: 15000 });
            await page.goBack({ timeout: 15000 });
          } catch {
            await page.goto(InstagramClient.exploreUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 });
          }
          await randomDelay(1000, 2000);
          continue;
        }
      }
      if (config.excludeBusinessProfiles && sExp.minimalProfile) {
        const fol =
          folS ?? sExp.followers ?? getFollowersFromEntity(sExp.minimalProfile as Record<string, unknown>);
        const entity = {
          handle,
          username: handle,
          ...sExp.minimalProfile,
          followers_count: fol,
        } as Record<string, unknown>;
        let expDetail0 = '';
        if (hasRejectedProfileKeyword(entity)) {
          expDetail0 = explainRejectedProfileKeyword(entity);
        } else if (isBusinessFromEntity(entity)) {
          expDetail0 = explainCommercialOrEstablishment(entity);
        } else if (!qualifiesAsInfluencer(entity, config.minFollowersToSave)) {
          expDetail0 = explainNotQualifiesAsInfluencer(entity, config.minFollowersToSave);
        }
        if (expDetail0) {
          recordIssue(handle, 'regra', `No Explore: ${expDetail0}`);
          skipped.add(handleLower);
          sess?.add(handleLower);
          try {
            await page.goBack({ timeout: 15000 });
            await page.goBack({ timeout: 15000 });
          } catch {
            await page.goto(InstagramClient.exploreUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 });
          }
          await randomDelay(1000, 2000);
          continue;
        }
      }
    }

    processed++;
    const ok = await processOneProfile(
      page,
      handle,
      config,
      existingHandles,
      'explore',
      'explore',
      { pageAlreadyOnProfile: true },
      onCollected
    );
    if (ok) saved++;
    skipped.add(handleLower);
    sess?.add(handleLower);

    try {
      await page.goBack({ timeout: 15000 });
      await page.goBack({ timeout: 15000 });
    } catch {
      await page.goto(InstagramClient.exploreUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 });
    }
    await randomDelay(1500, 3000);
  }

  return { saved, processed };
}

/** Descoberta por lista direta de handles: abre cada perfil e aplica o mesmo pipeline de extração/regras. */
export async function discoverByHandles(
  _client: InstagramClient,
  page: Page,
  options: DiscoveryOptions
): Promise<{ saved: number; processed: number }> {
  const { config, shouldAbort, onCollected, sessionTriedHandles: sess } = options;
  const existingHandles = listHandles();
  const triedInSession = new Set<string>();
  const ctx = page.context();
  let saved = 0;
  let processed = 0;

  const rawHandles = Array.isArray(options.handles) ? options.handles : [];
  const handles = rawHandles
    .map((h) => String(h ?? '').trim().replace(/^@+/, '').toLowerCase())
    .filter((h) => /^[a-z0-9._]{2,30}$/.test(h));

  if (handles.length === 0) {
    coletaLog('Modo Arrobas: informe ao menos um @ válido (uma por linha).');
    return { saved: 0, processed: 0 };
  }

  for (let i = 0; i < handles.length && !shouldAbort() && saved < options.maxProfiles; i++) {
    const handle = handles[i]!;
    const handleLower = handle.toLowerCase();

    if (existingHandles.has(handleLower)) {
      recordDuplicate(handle);
      continue;
    }
    if (triedInSession.has(handleLower) || sess?.has(handleLower)) {
      continue;
    }
    if (isBlocklistedHandle(handle) || containsRejectedKeyword(handle)) {
      triedInSession.add(handleLower);
      sess?.add(handleLower);
      continue;
    }

    const remaining = options.maxProfiles - saved;
    if (remaining <= 0) break;
    coletaLog(`Arrobas ${i + 1}/${handles.length}: @${handle} — restam ${remaining} perfil(is) para salvar.`);

    let rPipe: { saved: number; processed: number };
    try {
      rPipe = await profileExtractionPipelineNewTab(
        ctx,
        handle,
        config,
        existingHandles,
        triedInSession,
        sess,
        'handles',
        'manual-list',
        onCollected,
        'Arrobas'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isClosed = /closed|Target page|context or browser has been closed/i.test(msg);
      if (isClosed) {
        coletaLog(`Arrobas: @${handle} — janela/aba fechada durante extração, indo para o próximo.`);
      } else {
        coletaLog(`Arrobas: @${handle} — erro na extração, indo para o próximo: ${msg}`);
      }
      recordIssue(handle, 'extracao', isClosed ? 'Janela ou aba fechada durante a extração.' : msg);
      rPipe = { saved: 0, processed: 1 };
    }

    saved += rPipe.saved;
    processed += rPipe.processed;
    await randomDelay(80, 180);
  }

  return { saved, processed };
}
