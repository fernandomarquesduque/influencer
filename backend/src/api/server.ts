import crypto from 'node:crypto';
import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Raiz do projeto backend (onde ficam .env e data/). Funciona com tsx (src/api) e com node após build (dist/api). */
const _twoUp = path.resolve(__dirname, '../..');
const BACKEND_ROOT = path.basename(_twoUp) === 'dist' ? path.resolve(__dirname, '../../..') : _twoUp;

/** .env na pasta backend — não depende do cwd (evita depurador/IDE com cwd errado sem AWS). */
const BACKEND_ENV_PATH = path.join(BACKEND_ROOT, '.env');
dotenv.config({ path: BACKEND_ENV_PATH });
dotenv.config();
logMemorySnapshot('API pós-.env (baseline de processo)');

function resolveAuthStatePath(relativeOrAbsolute: string): string {
  if (path.isAbsolute(relativeOrAbsolute)) return relativeOrAbsolute;
  return path.resolve(BACKEND_ROOT, relativeOrAbsolute);
}
import swaggerUi from 'swagger-ui-express';
import { createRequire } from 'node:module';
import { RocksDBStorage } from '../storage/rocksdb.js';
import { SqliteSync } from '../storage/sqliteSync.js';
import { CompositeStorage } from '../storage/compositeStorage.js';
import { runCrawl } from '../crawl/runCrawl.js';
import {
  extractSingleProfileWithPage,
  buildConfigFromEnv,
  type ExtractSingleProfileResult,
} from '../crawl/extractSingleProfile.js';
import {
  searchProfiles,
  narrowHandlesByProfilesQuery,
  getProfileSummary,
  getProfileEngagementByType,
  isSearchCacheWarmBlockedError,
  scheduleSearchCacheRewarm,
  scheduleSearchCacheWarmRetries,
  warmSearchCache,
  getLlmQualification,
  matchesQuery,
  getPostSearchableNormalized,
  getPostTimestamp,
  computePostsPerWeek,
  collectMentionHandlesFromPostItem,
  computeCampaignFacetBoostScore,
  hasCampaignFacetBoostInQuery,
  stripCampaignFacetBoostFromProfilesQuery,
  type ProfilesSearchQuery,
  type ProfileListItem,
  type ProfilesSearchFacets,
} from './profilesSearch.js';
import { rebuildAllProfileSearchIndexes, syncProfileSearchIndexForHandle } from './profileSearchIndexSync.js';
import { CreditsCampaignsDb, isCampaignIdGuid } from '../storage/creditsCampaignsDb.js';
import { PaymentsDb, type PaymentRow } from '../storage/paymentsDb.js';
import * as asaas from '../asaas/client.js';
import { getBuscaPlanById } from '../billing/buscaPlans.js';
import { InstagramClient } from '../instagramClient/index.js';
import { loginWithCredentials } from '../instagramClient/login.js';
import { profileExtractDelay, profileExtractDelayForApi } from '../utils/delay.js';
import { logTimestamp } from '../utils/logTimestamp.js';
import { logMemorySnapshot } from '../utils/memoryDiag.js';
import {
  getSuggestedPricingFromFollowers,
  suggestedPricingToActivationFormat,
  getFollowersFromProfile,
  isPricingEmpty,
} from '../utils/suggestedPricing.js';
import { get429BackoffMs, record429 } from '../utils/rateLimit429.js';
import { sendVerificationCode, sendDirectMessage } from '../instagramClient/sendDirectMessage.js';
import { followUser, followUserFromCurrentPage } from '../instagramClient/followUser.js';
import { openFollowersModal, searchInFollowersModal } from '../instagramClient/getMyFollowers.js';
import type { Page } from 'playwright';
import { extractProfile, extractReelsAndTaggedFromCurrentPage } from '../profileExtractor/index.js';
import { isFollowingViewerFromEntity } from '../utils/entityAccess.js';
import { AuthDb } from '../auth/authDb.js';
import { authOptional, requireScopes, requireScopesOrPublic, canEditProfile, type RequestWithAuth } from '../auth/middleware.js';
import { checkApiRateLimit, getRetryAfterSeconds } from '../utils/apiRateLimit.js';
import {
  redactContactInfoInActivation,
  redactContactInfoInPostItems,
  redactContactInfoInProfile,
  redactContactInfoInProfileListItem,
  redactContactInfoInText,
} from '../utils/redactContactInfo.js';
import { signJwt, verifyJwt, getJwtSecret } from '../auth/jwt.js';
import { verifyPassword, hashPassword } from '../auth/password.js';
import type { AuthScope } from '../auth/types.js';
import { listTables, queryTable, isAllowedTable } from './dbQueries.js';
import { getAdminStatsSnapshot } from './adminStats.js';
import { createCollectorController } from './controllers/collectorController.js';
import { createCollectorCrawlRouter } from './routes/collectorRoutes.js';
import { requireCollectorIngestSecret } from './middleware/collectorIngestAuth.js';
import {
  pickAdminQualificationPatch,
  applyQualificationPatchToProfileRecord,
} from './adminLlmQualificationPatch.js';
import { followersCountToSizeKey, type FollowersSizeKey } from './followersSizeBuckets.js';
import { sendVerificationEmail } from '../email/sendVerificationEmail.js';
import { sendPasswordResetCode } from '../email/sendPasswordResetCode.js';
import { logS3StartupStatus, wipeInfluencerS3Prefix } from '../s3/influencerProfileStorage.js';
import { campaignAccessDurationDays, defaultCampaignExpiresAtIso } from '../config/campaignAccess.js';
import { ProfileRefDb } from '../storage/profileRefDb.js';
import { streamProfileAvatarMedia, streamProfileCoverMedia } from './profileMedia.js';
import {
  buildPublicProfilePreviewDto,
  enrichListItemsWithRefs,
  enrichPostItemsWithRefs,
  sanitizePostItemsForClient,
  sanitizeProfileForClient,
  shouldIncludeHandleInApi,
} from '../utils/profilePublicDto.js';
import { profileAvatarMediaPath } from '../utils/profileMediaUrls.js';

const require = createRequire(import.meta.url);
const openApiRocksdb = require('./openapi-rocksdb.json');
const openApiSqlite = require('./openapi-sqlite.json');

/** iisnode define process.env.PORT; fora do IIS usamos API_PORT ou 3500 */
const PORT = Number(process.env.PORT) || Number(process.env.API_PORT) || 3500;
const rocksPath = process.env.STORAGE_DB_PATH ?? './data/rocksdb';
const sqlitePath = process.env.SQLITE_DB_PATH ?? './data/influencer.db';

const app = express();

function wrapJsonBodyParser(parser: RequestHandler): RequestHandler {
  return (req, res, next) => {
    parser(req, res, ((err?: unknown) => {
      if (!err) {
        next();
        return;
      }
      const meta = err as { type?: string };
      const isParseFail = err instanceof SyntaxError || meta.type === 'entity.parse.failed';
      if (isParseFail && req.method !== 'GET' && req.method !== 'HEAD') {
        const pathOnly = (req.originalUrl ?? req.url ?? '').split('?')[0];
        console.warn(
          '[API] Body JSON inválido:',
          req.method,
          pathOnly,
          err instanceof Error ? err.message : String(err),
        );
        res.status(400).json({ error: 'Body JSON inválido', code: 'INVALID_JSON_BODY' });
        return;
      }
      next(err);
    }) as NextFunction);
  };
}

const jsonDefault = wrapJsonBodyParser(express.json({ limit: '2mb' }));
const jsonCollectorFull = wrapJsonBodyParser(express.json({ limit: '80mb' }));
app.use((req, res, next) => {
  const p = req.url?.split('?')[0] ?? '';
  if (req.method === 'POST' && p.includes('collector-ingest-full')) {
    return jsonCollectorFull(req, res, next);
  }
  return jsonDefault(req, res, next);
});

/** iisnode: a Application IIS em /api repassa só o path relativo (ex.: /profiles/search). Prefixa /api para as rotas. */
app.use((req, _res, next) => {
  if (req.path && !req.path.startsWith('/api')) {
    const q = req.url?.includes('?') ? '?' + req.url.split('?')[1] : '';
    req.url = '/api' + req.path + q;
    (req as { path?: string }).path = '/api' + req.path;
  }
  next();
});

/** Log de rejeições não tratadas (promises) para não perder erros em background. */
process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
  console.error('[API] unhandledRejection:', reason instanceof Error ? reason.stack : reason, promise);
});

const rocks = new RocksDBStorage({ dbPath: rocksPath });
const sqlite = new SqliteSync(sqlitePath);
const db = new CompositeStorage(
  rocks,
  sqlite,
  (storage) => scheduleSearchCacheRewarm(storage),
  (storage, handle) => {
    try {
      profileRefDb.getOrCreateRef(handle);
    } catch (_) {
      /* handle inválido */
    }
    void syncProfileSearchIndexForHandle(storage, handle);
  }
);
const collectorController = createCollectorController(db);
app.use('/api/crawl', createCollectorCrawlRouter(collectorController));
const authDb = new AuthDb(sqlitePath);
const profileRefDb = new ProfileRefDb(sqlitePath);
const creditsCampaignsDb = new CreditsCampaignsDb(sqlitePath);
const paymentsDb = new PaymentsDb(sqlitePath);

/** Hash do template usado para convocar perfis aprovados para seleção. */
const SELECTION_QUEUE_HASH = 'selecao';

/** Enfileira automaticamente uma mensagem de seleção (#selecao) após extração bem-sucedida, respeitando as regras de rejeição do template. */
function enqueueSelectionMessageIfAllowed(handle: string): void {
  const cleanHandle = handle.replace(/^@/, '').trim().toLowerCase();
  if (!cleanHandle) {
    console.log('[direct-queue] seleção automática: handle vazio, ignorando');
    return;
  }
  try {
    const template = sqlite.getMessageTemplateByHash(SELECTION_QUEUE_HASH);
    if (!template) {
      console.log(`[direct-queue] seleção automática: template "${SELECTION_QUEUE_HASH}" não existe, @${cleanHandle} não enfileirado`);
      return;
    }
    const rejectHashes = Array.isArray(template.reject_hashes) ? template.reject_hashes : [];
    if (rejectHashes.length === 0) {
      console.log(`[direct-queue] seleção automática: template "${SELECTION_QUEUE_HASH}" sem reject_hashes, @${cleanHandle} não enfileirado`);
      return;
    }
    for (const h of rejectHashes) {
      const rejectHash = (h ?? '').trim();
      if (!rejectHash) continue;
      if (sqlite.hasAlreadyReceivedMessage(cleanHandle, rejectHash)) {
        console.log(`[direct-queue] seleção automática: @${cleanHandle} já recebeu hash "${rejectHash}", não enfileirar #selecao`);
        return;
      }
    }
    const delayMin = Math.max(1, Math.min(999, template.send_delay_minutes ?? 30));
    const scheduledAt = new Date(Date.now() + delayMin * 60 * 1000).toISOString();
    const queueId = sqlite.addToDirectQueue(cleanHandle, SELECTION_QUEUE_HASH, scheduledAt);
    if (queueId > 0) {
      console.log(`[direct-queue] seleção automática: @${cleanHandle} enfileirado #selecao (id=${queueId}, agendado ${delayMin} min)`);
    } else {
      console.log(`[direct-queue] seleção automática: @${cleanHandle} não enfileirado (addToDirectQueue retornou 0, já pendente este hash?)`);
    }
  } catch (e) {
    console.error(
      '[direct-queue] erro ao enfileirar seleção automática:',
      e instanceof Error ? e.message : e
    );
  }
}

/** Worker de extração por perfil: 1 client + 1 context quentes, fila com concorrência 1. */
let apiExtractClient: InstagramClient | null = null;
let apiExtractQueue: Promise<void> = Promise.resolve();
/** Timestamp até quando a API não deve aceitar novas extrações (backoff após 429/challenge). */
let apiExtractBlockedUntil = 0;
/** Contador de perfis extraídos nesta instância (para cooldown a cada N). */
let apiExtractProfileCount = 0;

/** Resultado de extract-profile em background (por handle, para polling). */
const extractProfileResults = new Map<
  string,
  { status: 'pending' } | { status: 'done'; result: ExtractSingleProfileResult } | { status: 'error'; error: string }
>();

/** Promise que resolve quando todos os envios de código 2FA (request-code) em andamento terminarem. A fila de extract/refresh espera isso para dar prioridade absoluta ao 2FA. */
let requestCodeFlushPromise: Promise<void> = Promise.resolve();

/** Fila de handles para re-extração quando imagem falha (renovar URLs). Uma execução por vez, em série com extract-profile. */
const refreshProfileQueue: string[] = [];
const refreshProfileQueueSet = new Set<string>();
/** Handles enfileirados com priority=true (admin); ao processar, não aplica o intervalo de 60 min. */
const refreshPriorityHandles = new Set<string>();
/** Só enfileirar/executar refresh se a última extração do perfil foi há mais de 60 min (evita re-extração em loop quando cache ainda serve dado antigo). */
const REFRESH_MIN_INTERVAL_MS = 60 * 60 * 1000;

function getApiExtractClient(): InstagramClient {
  if (!apiExtractClient) {
    const config = buildConfigFromEnv();
    apiExtractClient = new InstagramClient({
      headless: config.headless,
      authStatePath: resolveAuthStatePath(config.authStatePath),
    });
  }
  return apiExtractClient;
}

/** Client dedicado ao cadastro (/app/create). Extração roda imediatamente sem depender da apiExtractQueue. */
let priorityExtractClient: InstagramClient | null = null;
function getPriorityExtractClient(): InstagramClient {
  if (!priorityExtractClient) {
    const config = buildConfigFromEnv();
    priorityExtractClient = new InstagramClient({
      headless: config.headless,
      authStatePath: resolveAuthStatePath(config.authStatePath),
    });
  }
  return priorityExtractClient;
}

/** Uma única página reutilizada para busca de seguidores (modal já aberto). Evita abrir novo Chrome a cada request. */
let followersSearchPage: Page | null = null;
let followersSearchProfile: string | null = null;
let followersSearchLock: Promise<void> = Promise.resolve();
let followersSearchRelease: () => void = () => { };

function isBlockSignal(result: ExtractSingleProfileResult): boolean {
  const err = (result.error ?? '').toLowerCase();
  return (
    err.includes('429') ||
    err.includes('rate_limit') ||
    err.includes('rate_limit_429') ||
    err.includes('/challenge') ||
    err.includes('challenge') ||
    err.includes('accounts/login') ||
    err.includes('please wait') ||
    err.includes('suspicious') ||
    err.includes('too many requests') ||
    err.includes('temporarily blocked')
  );
}

/** Indica se a mensagem de erro é de sessão expirada / não logada (para tentar login automático). */
function isSessionExpiredError(msg: string): boolean {
  return (
    msg.includes('Sessão') &&
    (msg.includes('expirada') || msg.includes('não logada') || msg.includes('npm run login'))
  );
}

/** Opções extras para runOneExtract. client: usar este em vez do client da fila. skipCount: não incrementar apiExtractProfileCount (ex.: extração prioritária de cadastro). */
interface RunOneExtractOptions {
  client?: InstagramClient;
  skipCount?: boolean;
  /** Pula delay antes da extração (cadastro com fast). */
  fast?: boolean;
}

/** Executa uma extração (um perfil). Usado pelo extract-profile e pela fila de refresh. forRefresh=true pula todas as validações de qualificação. fromExtractProfileApi=true usa delay curto (2s em vez de 8–20s). Se a sessão estiver expirada e houver INSTAGRAM_USER/PASSWORD no .env, tenta login automático e reextrai uma vez. Com options.client a extração usa esse client (ex.: cadastro imediato sem fila). */
async function runOneExtract(
  handle: string,
  forRefresh = false,
  didAutoLogin = false,
  fromExtractProfileApi = false,
  options?: RunOneExtractOptions
): Promise<ExtractSingleProfileResult> {
  let page: Page | undefined;
  let result: ExtractSingleProfileResult | undefined;
  try {
    const now = Date.now();
    if (now < apiExtractBlockedUntil) {
      return {
        success: false,
        handle,
        error: `Rate limit ou bloqueio. Tente novamente em ${Math.ceil((apiExtractBlockedUntil - now) / 60000)} min.`,
      };
    }
    if (!options?.fast) {
      await (fromExtractProfileApi ? profileExtractDelayForApi() : profileExtractDelay());
    }
    const cooldownEvery = Math.max(0, parseInt(process.env.COOLDOWN_EVERY ?? '10', 10) || 10);
    const cooldownMinMs = Math.max(0, parseInt(process.env.COOLDOWN_MIN_MS ?? '60000', 10) || 60000);
    const cooldownMaxMs = Math.max(cooldownMinMs, parseInt(process.env.COOLDOWN_MAX_MS ?? '180000', 10) || 180000);
    if (
      !options?.fast &&
      !options?.skipCount &&
      cooldownEvery > 0 &&
      apiExtractProfileCount > 0 &&
      apiExtractProfileCount % cooldownEvery === 0
    ) {
      const cooldownMs = cooldownMinMs + Math.floor(Math.random() * (cooldownMaxMs - cooldownMinMs + 1));
      await new Promise((r) => setTimeout(r, cooldownMs));
    }
    const client = options?.client ?? getApiExtractClient();
    await client.init();
    page = await client.newPage();
    const config = buildConfigFromEnv();
    const extractTimeoutMs = Math.max(60000, parseInt(process.env.PROFILE_PROCESS_TIMEOUT_MS ?? '180000', 10) || 180000);
    const timeoutPromise = new Promise<ExtractSingleProfileResult>((_, reject) =>
      setTimeout(() => reject(new Error(`Extract profile timeout (${extractTimeoutMs / 1000}s)`)), extractTimeoutMs)
    );
    try {
      result = await Promise.race([
        extractSingleProfileWithPage(page, handle, db, config, {
          forRefresh,
          fastMode: fromExtractProfileApi || options?.fast === true,
          signupLight: options?.fast === true && fromExtractProfileApi,
          client,
        }),
        timeoutPromise,
      ]);
      console.log(`[runOneExtract] @${handle} extração concluída, fechando página...`);
    } finally {
      const skipCloseForSupplement = fromExtractProfileApi && result?.success === true && !options?.fast;
      if (!skipCloseForSupplement && page) {
        const tClose = Date.now();
        await page.close().catch(() => { });
        console.log(`[runOneExtract] @${handle} página fechada em ${Date.now() - tClose}ms`);
      } else if (skipCloseForSupplement) {
        console.log(`[runOneExtract] @${handle} página mantida aberta para supplement reels/tagged em background`);
      }
    }
    const tAuth = Date.now();
    await client.saveAuthState();
    console.log(`[runOneExtract] @${handle} auth state salvo em ${Date.now() - tAuth}ms`);

    if (result === undefined) {
      return { success: false, handle, error: 'Extração não retornou resultado.' };
    }
    if (isBlockSignal(result)) {
      record429();
      apiExtractBlockedUntil = Date.now() + get429BackoffMs();
      if (isLoginOrChallengeSignal(result)) {
        await client.closeContext();
      }
      if (fromExtractProfileApi && result.success && page) await page.close().catch(() => { });
      return result;
    }
    if (result.success && result.saved
      && !forRefresh
    ) {
      console.log(`[runOneExtract] @${result.handle} extração salva, tentando enfileirar #selecao (30 min)`);
      enqueueSelectionMessageIfAllowed(result.handle);
    }
    if (fromExtractProfileApi && result.success && page && !options?.fast) {
      runSupplementReelsAndTagged(page, handle, db).catch(() => { });
    }
    if (!options?.skipCount) apiExtractProfileCount++;
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;

    if (
      !didAutoLogin &&
      isSessionExpiredError(msg) &&
      process.env.INSTAGRAM_USER &&
      process.env.INSTAGRAM_PASSWORD
    ) {
      console.log('[API] Sessão expirada detectada; executando login automático...');
      const clientToClose = options?.client ? priorityExtractClient : apiExtractClient;
      if (clientToClose) {
        await clientToClose.close().catch(() => { });
        if (options?.client) priorityExtractClient = null;
        else apiExtractClient = null;
      }
      const config = buildConfigFromEnv();
      const authPath = resolveAuthStatePath(config.authStatePath);
      const loginClient = new InstagramClient({ authStatePath: authPath, headless: config.headless });
      try {
        await loginClient.init();
        const ok = await loginWithCredentials(
          loginClient,
          process.env.INSTAGRAM_USER,
          process.env.INSTAGRAM_PASSWORD
        );
        await loginClient.close();
        if (ok) {
          console.log('[API] Login automático OK; reextraindo perfil...');
          return runOneExtract(handle, forRefresh, true, fromExtractProfileApi, options);
        }
      } catch (loginErr) {
        console.error('[API] Login automático falhou:', loginErr instanceof Error ? loginErr.message : loginErr);
      }
    }

    console.error(`[API] runOneExtract @${handle} exceção:`, msg, stack ?? '');
    if (fromExtractProfileApi && result?.success && page) await page.close().catch(() => { });
    return { success: false, handle, error: msg };
  }
}

/** Storage com loadByHandle e saveMedia para o supplement de reels/tagged. */
interface SupplementStorage {
  loadByHandle(handle: string): Promise<{ _collected_at?: string } | null>;
  saveMedia?(profileHandle: string, mediaKind: 'reel' | 'tagged', items: unknown[], collectedAt: string): Promise<number>;
}

/** Executa em background: extrai reels e marcados da página já no perfil e persiste. Fecha a página ao terminar. */
async function runSupplementReelsAndTagged(
  page: Page,
  handle: string,
  storage: SupplementStorage
): Promise<void> {
  const cleanHandle = handle.replace(/^@/, '').trim().toLowerCase();
  try {
    const profile = await storage.loadByHandle(cleanHandle);
    const collectedAt =
      (profile && typeof (profile as { _collected_at?: string })._collected_at === 'string'
        ? (profile as { _collected_at: string })._collected_at
        : null) ?? new Date().toISOString();
    const { reels, tagged } = await extractReelsAndTaggedFromCurrentPage(page, cleanHandle, collectedAt);
    if (typeof storage.saveMedia === 'function') {
      if (reels.length > 0) await storage.saveMedia(cleanHandle, 'reel', reels, collectedAt);
      if (tagged.length > 0) await storage.saveMedia(cleanHandle, 'tagged', tagged, collectedAt);
      if (reels.length > 0 || tagged.length > 0) {
        console.log(`[runSupplementReelsAndTagged] @${cleanHandle} salvos: reels=${reels.length} tagged=${tagged.length}`);
      }
    }
  } catch (err) {
    console.error(
      '[runSupplementReelsAndTagged] @' + cleanHandle + ':',
      err instanceof Error ? err.message : String(err)
    );
  } finally {
    await page.close().catch(() => { });
  }
}

/** Processa o próximo handle da fila de refresh (re-extração por falha de imagem). Uma execução por vez. Só executa se última extração foi há mais de 60 min. */
function processNextRefresh(): void {
  if (refreshProfileQueue.length === 0) return;
  const handle = refreshProfileQueue.shift()!;
  apiExtractQueue = apiExtractQueue
    .then(() => requestCodeFlushPromise)
    .then(async () => {
      const isPriority = refreshPriorityHandles.has(handle);
      if (isPriority) refreshPriorityHandles.delete(handle);
      if (!isPriority) {
        const profile = await db.loadByHandle(handle);
        const collectedAt = profile && typeof (profile as { _collected_at?: string })._collected_at === 'string'
          ? (profile as { _collected_at: string })._collected_at
          : null;
        if (collectedAt) {
          const lastMs = Date.now() - new Date(collectedAt).getTime();
          if (lastMs < REFRESH_MIN_INTERVAL_MS) {
            console.log(`[API] Refresh @${handle} ignorado: última extração há ${Math.round(lastMs / 60000)} min (mínimo 60 min).`);
            return;
          }
        }
      }
      console.log(`[API] Refresh de imagens iniciado: @${handle}${isPriority ? ' (prioritário)' : ''}`);
      return runOneExtract(handle, true);
    })
    .then(async (result) => {
      if (result == null) return;
      if (result.saved) console.log(`[API] Refresh de imagens concluído: @${handle}`);
      else if (result.error) {
        console.error(`[API] Refresh @${handle} falhou:`, result.error);
        if (result.error === 'Perfil não encontrado' || String(result.error).includes('Perfil não encontrado')) {
          try {
            await db.deleteProfileCompletely(handle);
            console.log(`[API] Perfil @${handle} excluído completamente (não existe mais no Instagram).`);
          } catch (err) {
            console.error(`[API] Erro ao excluir perfil @${handle}:`, err instanceof Error ? err.message : err);
          }
        }
      } else if (result.rejectionReason) console.warn(`[API] Refresh @${handle} rejeitado:`, result.rejectionReason);
    })
    .catch((err) => {
      console.error(`[API] Refresh @${handle} erro:`, err instanceof Error ? err.stack : err);
    })
    .finally(() => {
      refreshProfileQueueSet.delete(handle.toLowerCase());
      processNextRefresh();
    });
}

/** Sinal de que a sessão caiu em login/challenge — deve fechar o context para recriar na próxima. */
function isLoginOrChallengeSignal(result: ExtractSingleProfileResult): boolean {
  const err = (result.error ?? '').toLowerCase();
  return (
    err.includes('/challenge') ||
    err.includes('accounts/login') ||
    err.includes('sessão') ||
    err.includes('login') ||
    err.includes('expirada')
  );
}

/** Middleware: extrai JWT e define req.user (opcional). */
app.use('/api', authOptional);

/** Estado do crawl (mesmo processo = mesmo RocksDB, sem lock). */
let crawlInProgress = false;
let lastCrawlResult: { saved: number; tag: string; finishedAt: string } | null = null;
/** Quando true, o crawl em execução deve parar no próximo ciclo. */
let crawlAbortRequested = false;

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

/**
 * Público: duração padrão do acesso à campanha (dias) e data de expiração sugerida YYYY-MM-DD.
 * Alinha front (checkout / criação de relatório) com CAMPAIGN_ACCESS_DURATION_DAYS no servidor.
 */
app.get('/api/campaign-access-defaults', (_req: Request, res: Response) => {
  res.json({
    durationDays: campaignAccessDurationDays(),
    defaultExpiresAt: defaultCampaignExpiresAtIso(),
  });
});

/** Login: retorna JWT e dados do usuário. Aceita username (handle do influencer ou admin). */
app.post('/api/auth/login', (req: Request, res: Response) => {
  try {
    const login = (req.body?.login ?? req.body?.username ?? '').toString().trim().replace(/^@/, '');
    const password = (req.body?.password ?? '').toString();
    if (!login || !password) {
      res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
      return;
    }
    const user = authDb.getByUsername(login);
    if (!user || !verifyPassword(password, user.password_hash)) {
      res.status(401).json({ error: 'Usuário ou senha inválidos' });
      return;
    }
    const secret = getJwtSecret();
    const token = signJwt(
      { sub: String(user.id), username: user.username, scope: user.scope as AuthScope, profile_handle: user.profile_handle ?? undefined },
      secret
    );
    let profile_activated: boolean | undefined;
    if (user.scope === 'influencer') {
      if (!user.profile_handle || !String(user.profile_handle).trim()) {
        profile_activated = false;
      } else {
        const handle = String(user.profile_handle).replace(/^@/, '').trim().toLowerCase();
        const act = sqlite.getActivation(handle);
        profile_activated = !!(act?.city && String(act.city).trim());
      }
    }
    const email_verified = user.email_verified !== undefined ? user.email_verified === 1 : undefined;
    const display_name = (user as { display_name?: string | null }).display_name ?? null;
    const billing_cpf_cnpj = (user as { billing_cpf_cnpj?: string | null }).billing_cpf_cnpj ?? null;
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        scope: user.scope,
        profile_handle: user.profile_handle,
        ...(display_name != null && { display_name }),
        ...(profile_activated !== undefined && { profile_activated }),
        ...(email_verified !== undefined && { email_verified: email_verified === true }),
        ...(billing_cpf_cnpj && { billing_cpf_cnpj }),
      },
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Usuário atual (a partir do JWT). Para influencer com profile_handle, inclui profile_activated. Para assinante, inclui email_verified. */
app.get('/api/auth/me', (req: RequestWithAuth, res: Response) => {
  if (!req.user) {
    res.status(200).json({ user: null });
    return;
  }
  const userId = Number(req.user.sub);
  const dbUser = authDb.getById(userId);
  const profileHandle = req.user.profile_handle ?? null;
  let profile_activated: boolean | undefined;
  if (req.user.scope === 'influencer') {
    if (!profileHandle || !String(profileHandle).trim()) {
      profile_activated = false;
    } else {
      const handle = String(profileHandle).replace(/^@/, '').trim().toLowerCase();
      const activation = sqlite.getActivation(handle);
      profile_activated = !!(activation?.city && String(activation.city).trim());
    }
  }
  const email_verified = dbUser?.email_verified !== undefined ? dbUser.email_verified === 1 : undefined;
  const display_name = dbUser && 'display_name' in dbUser ? (dbUser as { display_name?: string | null }).display_name ?? null : null;
  const billing_cpf_cnpj = dbUser ? ((dbUser as { billing_cpf_cnpj?: string | null }).billing_cpf_cnpj ?? null) : null;
  const profile_ref =
    profileHandle && String(profileHandle).trim()
      ? profileRefDb.getOrCreateRef(String(profileHandle).replace(/^@/, '').trim().toLowerCase())
      : null;
  res.json({
    user: {
      id: userId,
      username: req.user.username,
      scope: req.user.scope,
      profile_ref,
      display_name,
      ...(profile_activated !== undefined && { profile_activated }),
      ...(email_verified !== undefined && { email_verified: email_verified === true }),
      ...(billing_cpf_cnpj && { billing_cpf_cnpj }),
    },
  });
});

/** Atualiza o perfil do usuário logado (ex.: desvincular Instagram, nome). Body: { profile_handle?: string | null, display_name?: string | null }. Retorna user atualizado e token. */
app.patch('/api/auth/me', (req: RequestWithAuth, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Faça login para atualizar o perfil.' });
    return;
  }
  const userId = Number(req.user.sub);
  const body = req.body as { profile_handle?: string | null; display_name?: string | null; name?: string | null; billing_cpf_cnpj?: string | null };
  const updates: { profile_handle?: string | null; display_name?: string | null } = {};
  if (body.profile_handle !== undefined) {
    updates.profile_handle = body.profile_handle == null || (typeof body.profile_handle === 'string' && !body.profile_handle.trim())
      ? null
      : String(body.profile_handle).replace(/^@/, '').trim();
  }
  if (body.display_name !== undefined || body.name !== undefined) {
    const raw = body.display_name !== undefined ? body.display_name : body.name;
    updates.display_name = raw == null || (typeof raw === 'string' && !raw.trim()) ? null : String(raw).trim();
  }
  if (Object.keys(updates).length > 0) {
    authDb.updateUser(userId, updates);
  }
  if (body.billing_cpf_cnpj !== undefined) {
    const raw = body.billing_cpf_cnpj == null ? '' : String(body.billing_cpf_cnpj);
    const d = raw.replace(/\D/g, '');
    try {
      authDb.setBillingCpfCnpj(userId, d.length === 11 || d.length === 14 ? d : null);
    } catch {
      res.status(400).json({ error: 'CPF/CNPJ inválido (use 11 ou 14 dígitos, ou vazio para limpar).' });
      return;
    }
  }
  const updated = authDb.getById(userId);
  if (!updated) {
    res.status(500).json({ error: 'Erro ao atualizar perfil.' });
    return;
  }
  const secret = getJwtSecret();
  const token = signJwt(
    { sub: String(updated.id), username: updated.username, scope: updated.scope as AuthScope, profile_handle: updated.profile_handle ?? undefined },
    secret
  );
  const email_verified = updated.email_verified !== undefined ? updated.email_verified === 1 : undefined;
  const display_name = (updated as { display_name?: string | null }).display_name ?? null;
  const billing_cpf_cnpj = (updated as { billing_cpf_cnpj?: string | null }).billing_cpf_cnpj ?? null;
  res.status(200).json({
    user: {
      id: updated.id,
      username: updated.username,
      scope: updated.scope,
      profile_handle: updated.profile_handle ?? null,
      display_name,
      ...(email_verified !== undefined && { email_verified: email_verified === true }),
      ...(billing_cpf_cnpj && { billing_cpf_cnpj }),
    },
    token,
  });
});

/** Define a senha do usuário logado (após validação 2FA). Requer autenticação. */
app.patch('/api/auth/me/password', (req: RequestWithAuth, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Faça login para definir a senha.' });
    return;
  }
  const password = (req.body?.password ?? '').toString();
  if (!password || password.length < 6) {
    res.status(400).json({ error: 'A senha deve ter no mínimo 6 caracteres.' });
    return;
  }
  const userId = Number(req.user.sub);
  authDb.updateUser(userId, { password_hash: hashPassword(password) });
  res.status(200).json({ ok: true });
});

/** Executa o fluxo de envio de código (client init, verificação segue, sendDM). Compartilhado por request-code e request-code-with-extract. Com client opcional usa esse (ex.: mesmo browser do cadastro prioritário). */
async function performRequestCodeFlow(
  nickname: string,
  code: string,
  _userId: number | null,
  flowOptions?: {
    client?: InstagramClient;
    /** Extração acabou de rodar no mesmo fluxo (request-code-with-extract): evita 2ª visita ao perfil que costuma falhar no browser já em uso. */
    trustFreshExtract?: boolean;
    /** Sem delays humanos no envio do DM e uma tentativa só. */
    fast?: boolean;
  }
): Promise<{ sent: boolean; error?: string; followProfileUrl?: string; nao_segue_perfil?: boolean }> {
  const t0 = Date.now();
  const logStep = (msg: string) => console.log(`[request-code] ${logTimestamp()} +${Date.now() - t0}ms ${msg}`);
  logStep(`Iniciando para @${nickname}`);
  const authStatePath = resolveAuthStatePath(
    process.env.INSTAGRAM_AUTH_STATE ?? process.env.AUTH_STATE_PATH ?? 'data/instagram-auth.json'
  );
  if (!existsSync(authStatePath)) {
    logStep('Sessão não configurada (arquivo ausente).');
    return { sent: false, error: 'Sessão do Instagram não configurada. Execute o login do crawl (npm run login).' };
  }

  const fast = flowOptions?.fast === true;
  const maxAttempts = fast ? 2 : 3;
  const delayMs = fast ? 0 : 2000;
  try {
    const client = flowOptions?.client ?? getApiExtractClient();
    try {
      await client.init();
      logStep('Browser pronto (reutilizado).');

      const requiredProfile = process.env.INSTAGRAM_PERFIL?.trim().replace(/^@/, '');
      if (requiredProfile && requiredProfile.length > 0) {
        const nickNorm = nickname.trim().toLowerCase();
        const stored = extractProfileResults.get(nickNorm);
        const followsFromExtract =
          stored?.status === 'done' && stored.result && 'followsOfficialProfile' in stored.result
            ? (stored.result as { followsOfficialProfile?: boolean }).followsOfficialProfile
            : undefined;

        // Só confiamos no cache quando diz que segue (true). Quando false ou ausente, reabrimos o perfil e verificamos:
        // a API às vezes não envia friendship_status ou envia incorreto, e o usuário pode estar seguindo.
        // Após request-code-with-extract, não reabrir se o cache já tem followsOfficialProfile (2ª visita no mesmo client costuma falhar).
        const useCachedFollowOnly =
          flowOptions?.trustFreshExtract === true && stored?.status === 'done' && followsFromExtract !== undefined;
        const skipRevalidateProfile = fast && flowOptions?.trustFreshExtract === true && stored?.status === 'done';
        if (skipRevalidateProfile) {
          if (followsFromExtract === false) {
            logStep('[fast] Cache: não segue perfil oficial.');
            return { sent: false, nao_segue_perfil: true, followProfileUrl: `https://www.instagram.com/${requiredProfile}/` };
          }
          logStep('[fast] Cache de extração recente, pulando revalidação de perfil.');
        } else if (followsFromExtract === true) {
          logStep('Usando cache (segue perfil), pulando abertura de perfil.');
        } else if (useCachedFollowOnly && followsFromExtract === false) {
          logStep('Usando cache (não segue perfil), sem 2ª extração.');
          return { sent: false, nao_segue_perfil: true, followProfileUrl: `https://www.instagram.com/${requiredProfile}/` };
        } else {
          logStep(followsFromExtract === false ? 'Cache disse não seguir; reabrindo perfil para confirmar...' : 'Sem cache: abrindo perfil para verificar se segue...');
          const page = await client.newPage();
          try {
            const config = buildConfigFromEnv();
            const tExtract = Date.now();
            const extracted = await extractProfile(page, nickname, 'seed', '', config, {
              fastMode: true,
              client,
              storage: typeof db.saveMedia === 'function' ? db : undefined,
            });
            logStep(`extractProfile concluído em ${Date.now() - tExtract}ms.`);
            logStep('Verificando perfil (username, segue oficial)...');
            if (!extracted) {
              if (stored?.status === 'done' && followsFromExtract === false) {
                logStep('2ª extração falhou; usando cache (não segue perfil).');
                return { sent: false, nao_segue_perfil: true, followProfileUrl: `https://www.instagram.com/${requiredProfile}/` };
              }
              return {
                sent: false,
                error:
                  stored?.status === 'done'
                    ? 'Não foi possível verificar o perfil. Tente novamente.'
                    : 'Perfil não encontrado ou indisponível.',
              };
            } else {
              const profileEntity = extracted.profile as Record<string, unknown>;
              const dataUser = (profileEntity?.data as Record<string, unknown> | undefined)?.user as Record<string, unknown> | undefined;
              const entityUsername = dataUser?.username != null ? String(dataUser.username).trim().toLowerCase() : null;
              if (entityUsername == null || entityUsername !== nickNorm) {
                return { sent: false, error: entityUsername == null ? 'Não foi possível verificar o perfil. Tente novamente.' : 'Resposta da API não corresponde ao perfil solicitado.' };
              }
              if (!isFollowingViewerFromEntity(profileEntity)) {
                return { sent: false, nao_segue_perfil: true, followProfileUrl: `https://www.instagram.com/${requiredProfile}/` };
              }
              logStep('Perfil OK.');
              // Seguir de volta em background (não bloqueia envio do código)
              const followBackEnabled = process.env.FOLLOW_BACK_ENABLED !== 'false';
              if (followBackEnabled) {
                void followUser(client, nickname)
                  .then((followResult) => {
                    if (!followResult.ok) logStep(`Follow-back (em background) falhou: ${followResult.error ?? 'erro'}`);
                    else if (followResult.alreadyFollowing) logStep('Follow-back (em background): já estávamos seguindo.');
                    else logStep('Follow-back (em background): seguimos o influenciador.');
                  })
                  .catch((err) => logStep(`Follow-back em background falhou: ${err instanceof Error ? err.message : String(err)}`));
              }
            }
          } finally {
            // Fechar página em background para não travar o fluxo (page.close() pode demorar)
            void page.close().then(() => { /* página fechada */ }).catch(() => { });
            logStep('Página em fechamento (background).');
          }
        }
      }

      const followBackEnabled = process.env.FOLLOW_BACK_ENABLED !== 'false';
      const runFollowBackAfterDm = () => {
        if (!followBackEnabled || !requiredProfile || requiredProfile.length === 0) return;
        const stored = extractProfileResults.get(nickname.trim().toLowerCase());
        const follows =
          stored?.status === 'done' && stored.result && 'followsOfficialProfile' in stored.result
            ? (stored.result as { followsOfficialProfile?: boolean }).followsOfficialProfile
            : undefined;
        if (follows !== true) return;
        void followUser(client, nickname)
          .then((followResult) => {
            if (!followResult.ok) logStep(`Follow-back (após DM) falhou: ${followResult.error ?? 'erro'}`);
            else if (followResult.alreadyFollowing) logStep('Follow-back (após DM): já estávamos seguindo.');
            else logStep('Follow-back (após DM): seguimos o influenciador.');
          })
          .catch((err) => logStep(`Follow-back (após DM) falhou: ${err instanceof Error ? err.message : String(err)}`));
      };

      logStep('Enviando código por Direct...');
      const tSend = Date.now();
      const storedForSend = extractProfileResults.get(nickname.trim().toLowerCase());
      const skipFollowerListCheck =
        fast ||
        (storedForSend?.status === 'done' &&
          storedForSend.result &&
          'followsOfficialProfile' in storedForSend.result &&
          (storedForSend.result as { followsOfficialProfile?: boolean }).followsOfficialProfile === true);
      const sendOpts =
        skipFollowerListCheck || fast
          ? {
              ...(skipFollowerListCheck ? { skipFollowerListCheck: true as const } : {}),
              ...(fast ? { fast: true as const } : {}),
            }
          : undefined;
      let result = await sendVerificationCode(client, nickname, code, sendOpts);
      for (let attempt = 1; !result.ok && attempt < maxAttempts; attempt++) {
        logStep(`sendVerificationCode tentativa ${attempt} retornou ok=false, nova tentativa em ${delayMs}ms...`);
        await new Promise((r) => setTimeout(r, delayMs));
        result = await sendVerificationCode(client, nickname, code, sendOpts);
      }
      logStep(`sendVerificationCode concluído em ${Date.now() - tSend}ms (ok=${result.ok}).`);
      if (!result.ok) {
        logStep(`Erro: ${result.error ?? 'desconhecido'}`);
        return { sent: false, error: result.error ?? 'Falha ao enviar mensagem no Instagram.' };
      }
      runFollowBackAfterDm();
    } finally {
      // Não fechar o client: é compartilhado (getApiExtractClient) para o próximo request ser rápido
    }

    logStep(`Total ${Date.now() - t0}ms — sucesso.`);
    return { sent: true };
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error(`[request-code] ${logTimestamp()} +${Date.now() - t0}ms ERRO:`, errMsg, e instanceof Error ? e.stack : '');
    return { sent: false, error: errMsg };
  }
}

/** Solicita código de ativação 2FA: envia (via inbox do Instagram) um código para o nickname. Pode ser chamado sem login (2FA é o login). Prioridade absoluta: invocado imediatamente; a fila de extract/refresh espera o 2FA terminar. */
app.post('/api/auth/request-code', async (req: RequestWithAuth, res: Response) => {
  try {
    const nickname = (req.body?.nickname ?? req.body?.handle ?? '').toString().trim().replace(/^@/, '');
    if (!nickname) {
      res.status(400).json({ error: 'Informe o nickname do Instagram' });
      return;
    }
    const fast = req.body?.fast === true || req.body?.fast === 'true';
    const userId = req.user ? Number(req.user.sub) : null;
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    authDb.saveProfileVerification(nickname, code, userId, new Date(Date.now() + 15 * 60 * 1000).toISOString());

    const flowPromise = performRequestCodeFlow(nickname, code, userId, fast ? { fast: true } : undefined);
    requestCodeFlushPromise = requestCodeFlushPromise.then(async () => {
      await flowPromise;
    });
    const result = await flowPromise;
    if (result.nao_segue_perfil && result.followProfileUrl) {
      res.status(400).json({ error: 'nao_segue_perfil', followProfileUrl: result.followProfileUrl });
      return;
    }
    if (result.error && !result.sent) {
      const isDev = process.env.NODE_ENV === 'development';
      if (isDev && result.error.includes('não configurada')) {
        res.status(200).json({ sent: false, code, error: result.error });
      } else {
        res.status(503).json({ error: result.error });
      }
      return;
    }
    const isDev = process.env.NODE_ENV === 'development';
    res.status(200).json(isDev ? { sent: true, code } : { sent: true });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: errMsg });
  }
});

/** Envia mensagem Direct do Instagram para um influenciador (handle). Apenas administradores. Body: handle, message (opcional se imageBase64), imageBase64 (opcional, data URL ou base64). */
app.post('/api/direct/send-message', requireScopes('adm'), async (req: RequestWithAuth, res: Response) => {
  let tempImagePath: string | null = null;
  try {
    const handle = (req.body?.handle ?? req.body?.nickname ?? '').toString().trim().replace(/^@/, '').toLowerCase();
    const message = (req.body?.message ?? '').toString().trim();
    const imageBase64 = (req.body?.imageBase64 ?? req.body?.image) as string | undefined;
    if (!handle) {
      res.status(400).json({ error: 'Informe o handle do influenciador.' });
      return;
    }
    if (!message && !imageBase64) {
      res.status(400).json({ error: 'Informe o texto da mensagem ou anexe uma imagem.' });
      return;
    }
    if (imageBase64) {
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
      const buf = Buffer.from(base64Data, 'base64');
      if (buf.length > 10 * 1024 * 1024) {
        res.status(400).json({ error: 'Imagem muito grande. Máximo 10 MB.' });
        return;
      }
      tempImagePath = path.join(os.tmpdir(), `dm-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.jpg`);
      writeFileSync(tempImagePath, buf);
    }
    const client = getApiExtractClient();
    await client.init();
    const result = await sendDirectMessage(client, handle, message || ' ', tempImagePath ?? undefined);
    if (!result.ok) {
      res.status(503).json({ error: result.error ?? 'Falha ao enviar mensagem no Instagram.' });
      return;
    }
    res.status(200).json({ ok: true, message: 'Mensagem enviada.' });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: errMsg });
  } finally {
    if (tempImagePath && existsSync(tempImagePath)) {
      try { unlinkSync(tempImagePath); } catch { /* ignore */ }
    }
  }
});

/** Lista templates de mensagem para disparo em massa. */
app.get('/api/direct/templates', requireScopes('adm', 'assinante'), (_req: RequestWithAuth, res: Response) => {
  try {
    const items = sqlite.listMessageTemplates();
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Cria template de mensagem (hash único + corpo + reject_hashes obrigatório + send_delay_minutes). */
app.post('/api/direct/templates', requireScopes('adm', 'assinante'), (req: RequestWithAuth, res: Response) => {
  try {
    const hash = (req.body?.hash ?? '').toString().trim();
    const body = (req.body?.body ?? req.body?.message ?? '').toString().trim();
    const raw = req.body?.reject_hashes;
    const rejectHashes = Array.isArray(raw) ? raw.map((h: unknown) => String(h ?? '').trim()).filter(Boolean) : [];
    const sendDelayMinutes = typeof req.body?.send_delay_minutes === 'number' ? req.body.send_delay_minutes : (parseInt(String(req.body?.send_delay_minutes ?? 1), 10) || 1);
    if (!hash || !body) {
      res.status(400).json({ error: 'Informe hash e body (texto) do template.' });
      return;
    }
    if (rejectHashes.length === 0) {
      res.status(400).json({ error: 'Informe ao menos um hash em reject_hashes (obrigatório).' });
      return;
    }
    const id = sqlite.createMessageTemplate(hash, body, rejectHashes, sendDelayMinutes);
    const delay = Math.max(1, Math.min(999, Math.floor(sendDelayMinutes)));
    res.status(201).json({ id, hash, body, reject_hashes: rejectHashes, send_delay_minutes: delay });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    if (err.includes('UNIQUE')) res.status(400).json({ error: 'Já existe um template com esse hash.' });
    else res.status(500).json({ error: err });
  }
});

/** Atualiza o texto (body), reject_hashes e/ou send_delay_minutes de um template por id. */
app.put('/api/direct/templates/:id', requireScopes('adm', 'assinante'), (req: RequestWithAuth, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'ID inválido.' });
      return;
    }
    const body = (req.body?.body ?? req.body?.message ?? '').toString().trim();
    const raw = req.body?.reject_hashes;
    const rejectHashes = raw === undefined ? undefined : (Array.isArray(raw) ? raw.map((h: unknown) => String(h ?? '').trim()).filter(Boolean) : []);
    const sendDelayMinutes = req.body?.send_delay_minutes;
    const sendDelay = sendDelayMinutes === undefined ? undefined : (typeof sendDelayMinutes === 'number' ? sendDelayMinutes : (parseInt(String(sendDelayMinutes), 10) || 1));
    if (!body && rejectHashes === undefined && sendDelay === undefined) {
      res.status(400).json({ error: 'Informe body, reject_hashes e/ou send_delay_minutes.' });
      return;
    }
    if (rejectHashes !== undefined && rejectHashes.length === 0) {
      res.status(400).json({ error: 'reject_hashes deve ter ao menos um hash.' });
      return;
    }
    const opts: { body?: string; rejectHashes?: string[]; send_delay_minutes?: number } = {};
    if (body) opts.body = body;
    if (rejectHashes !== undefined) opts.rejectHashes = rejectHashes;
    if (sendDelay !== undefined) opts.send_delay_minutes = sendDelay;
    const updated = sqlite.updateMessageTemplate(id, opts);
    if (!updated) res.status(404).json({ error: 'Template não encontrado.' });
    else res.json({ id, body: body || undefined, reject_hashes: rejectHashes, send_delay_minutes: sendDelay });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Busca na lista de seguidores do Instagram (usa o campo de pesquisa do modal). Reutiliza uma única aba: só manipula o input em vez de abrir novo Chrome. */
app.get('/api/direct/followers/search', requireScopes('adm', 'assinante'), async (req: RequestWithAuth, res: Response) => {
  try {
    const q = (req.query?.q ?? '').toString().trim().slice(0, 80);
    const myProfile = (process.env.INSTAGRAM_PERFIL ?? process.env.INSTAGRAM_USER ?? '').toString().trim().replace(/^@/, '');
    if (!myProfile) {
      res.status(503).json({ error: 'INSTAGRAM_PERFIL não configurado.' });
      return;
    }
    const client = getApiExtractClient();
    await client.init();
    // Para autocomplete (q preenchido) queremos resposta rápida: usar apenas a
    // primeira "página" do modal. Quando q vazio (botão "Adicionar todos"),
    // permitimos mais scrolls configuráveis.
    const maxScrolls = q
      ? 0
      : Math.min(8, parseInt(String(req.query?.scrolls ?? 6), 10) || 6);

    const waitForTurn = followersSearchLock;
    followersSearchLock = new Promise<void>((r) => {
      followersSearchRelease = r;
    });
    await waitForTurn;
    try {
      if (followersSearchPage && followersSearchProfile === myProfile && !followersSearchPage.isClosed()) {
        const result = await searchInFollowersModal(followersSearchPage, q, maxScrolls);
        if (!result.error) {
          res.json({ usernames: result.usernames });
          return;
        }
        await followersSearchPage.close().catch(() => { });
        followersSearchPage = null;
        followersSearchProfile = null;
      }
      const opened = await openFollowersModal(client, myProfile);
      if (opened.error || !opened.page) {
        res.status(400).json({ error: opened.error ?? 'Erro ao abrir modal', usernames: [] });
        return;
      }
      followersSearchPage = opened.page;
      followersSearchProfile = myProfile;
      const result = await searchInFollowersModal(opened.page, q, maxScrolls);
      if (result.error) {
        res.status(400).json({ error: result.error, usernames: [] });
        return;
      }
      res.json({ usernames: result.usernames });
    } finally {
      followersSearchRelease();
    }
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e), usernames: [] });
  }
});

/** Handles que já receberam a mensagem com o hash (para filtro incluir/excluir no disparo). */
app.get('/api/direct/queue/handles-by-hash', requireScopes('adm', 'assinante'), (req: RequestWithAuth, res: Response) => {
  try {
    const messageHash = (req.query?.message_hash ?? req.query?.hash ?? '').toString().trim();
    if (!messageHash) {
      res.status(400).json({ error: 'Informe message_hash (ou hash) na query.' });
      return;
    }
    const handles = sqlite.getHandlesByMessageHash(messageHash);
    res.json({ handles });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Lista fila de disparo (quem recebeu o quê e quando). */
app.get('/api/direct/queue', requireScopes('adm', 'assinante'), (req: RequestWithAuth, res: Response) => {
  try {
    const status = (req.query?.status as string)?.trim();
    const limit = Math.min(500, Math.max(1, parseInt(String(req.query?.limit ?? 200), 10) || 200));
    const offset = Math.max(0, parseInt(String(req.query?.offset ?? 0), 10) || 0);
    const { total, items } = sqlite.listDirectQueue({ status: status || undefined, limit, offset });
    res.json({ total, items });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Deleta toda a fila de disparo. */
app.delete('/api/direct/queue', requireScopes('adm', 'assinante'), (req: RequestWithAuth, res: Response) => {
  try {
    const deleted = sqlite.deleteAllDirectQueue();
    res.json({ deleted });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Deleta um item da fila por id. */
app.delete('/api/direct/queue/:id', requireScopes('adm', 'assinante'), (req: RequestWithAuth, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'ID inválido.' });
      return;
    }
    const removed = sqlite.deleteDirectQueueItem(id);
    if (!removed) res.status(404).json({ error: 'Item não encontrado.' });
    else res.json({ deleted: 1 });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Atualiza um item pendente da fila (template e/ou data de agendamento). */
app.patch('/api/direct/queue/:id', requireScopes('adm', 'assinante'), (req: RequestWithAuth, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'ID inválido.' });
      return;
    }
    const body = req.body ?? {};
    const messageHash =
      body.message_hash !== undefined ? String(body.message_hash).trim() : undefined;
    const scheduledAtRaw = body.scheduled_at;
    const scheduledAt =
      scheduledAtRaw !== undefined
        ? typeof scheduledAtRaw === 'string' && scheduledAtRaw.trim()
          ? new Date(scheduledAtRaw).toISOString()
          : null
        : undefined;
    const statusBody = body.status;
    const statusRaw =
      statusBody !== undefined && typeof statusBody === 'string' && ['pending', 'sent', 'failed'].includes(statusBody.trim())
        ? statusBody.trim()
        : undefined;
    const status = statusRaw as 'pending' | 'sent' | 'failed' | undefined;
    if (messageHash === undefined && scheduledAt === undefined && status === undefined) {
      res.status(400).json({ error: 'Envie message_hash, scheduled_at e/ou status para atualizar.' });
      return;
    }
    const updated = sqlite.updatePendingDirectQueueItem(id, {
      ...(messageHash !== undefined && { message_hash: messageHash }),
      ...(scheduledAt !== undefined && { scheduled_at: scheduledAt }),
      ...(status !== undefined && { status }),
    });
    if (!updated) {
      res.status(404).json({ error: 'Item não encontrado ou já foi enviado.' });
      return;
    }
    res.json({ updated: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Adiciona itens à fila de disparo (handle + hash do template). */
app.post('/api/direct/queue', requireScopes('adm', 'assinante'), (req: RequestWithAuth, res: Response) => {
  try {
    const items = req.body?.items ?? req.body?.handles;
    if (!Array.isArray(items)) {
      res.status(400).json({ error: 'Envie items: [{ profile_handle, message_hash }, ...] ou handles com message_hash no body.' });
      return;
    }
    const messageHash = (req.body?.message_hash ?? '').toString().trim();
    const scheduledAtRaw = req.body?.scheduled_at;
    const scheduledAt =
      typeof scheduledAtRaw === 'string' && scheduledAtRaw.trim()
        ? new Date(scheduledAtRaw).toISOString()
        : null;
    let added = 0;
    for (const it of items) {
      const handle = (typeof it === 'string' ? it : it?.profile_handle ?? it?.handle ?? '').toString().trim();
      const hash = (typeof it === 'object' && it && 'message_hash' in it ? (it as { message_hash?: string }).message_hash : messageHash).toString().trim();
      if (handle && hash) {
        try {
          const id = (sqlite as unknown as { addToDirectQueue: (h: string, m: string, s?: string | null) => number }).addToDirectQueue(
            handle,
            hash,
            scheduledAt ?? undefined
          );
          if (id > 0) added++;
        } catch (_) { /* skip erro */ }
      }
    }
    res.status(201).json({ added });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

const WELCOME_QUEUE_HASH = 'bemvindo';
const WELCOME_DEFAULT_BODY = 'Olá! Bem-vindo à plataforma. Seu cadastro foi ativado.';

/** Retorna mensagem de erro se o perfil já recebeu algum dos reject_hashes do template; null se pode enviar. */
function getRejectReasonIfAlreadyReceived(
  profileHandle: string,
  template: { reject_hashes?: string[] }
): string | null {
  const rejectHashes = Array.isArray(template.reject_hashes) ? template.reject_hashes : [];
  for (const h of rejectHashes) {
    const rejectHash = (h ?? '').trim();
    if (!rejectHash) continue;
    if (sqlite.hasAlreadyReceivedMessage(profileHandle, rejectHash)) {
      return `Perfil já recebeu o template "${rejectHash}".`;
    }
  }
  return null;
}

/** Substitui {firstname} e {nickname} no corpo do template pelos dados do perfil. */
async function resolveTemplateBody(body: string, profileHandle: string): Promise<string> {
  const handle = profileHandle.trim().toLowerCase().replace(/^@/, '');
  let firstname = handle;
  try {
    const entity = await db.loadByHandle(handle);
    if (entity && typeof entity === 'object') {
      const data = entity.data as { user?: { full_name?: string } } | undefined;
      const fullName = (typeof data?.user?.full_name === 'string' ? data.user.full_name : (entity as { full_name?: string }).full_name) ?? '';
      firstname = fullName.trim() ? fullName.trim().split(/\s+/)[0] ?? handle : handle;
    }
  } catch {
    // mantém firstname = handle se não houver perfil
  }
  const nickname = profileHandle.trim().replace(/^@/, '') || handle;
  return body
    .replace(/\{firstname\}/gi, firstname)
    .replace(/\{nickname\}/gi, nickname);
}

/** Processa um item da fila por id (para envio imediato ex.: bem-vindo na primeira ativação). */
async function processDirectQueueItemById(id: number): Promise<{ ok: boolean; error?: string }> {
  const item = sqlite.getDirectQueueItemById(id);
  if (!item || item.status !== 'pending') return { ok: false, error: 'Item não encontrado ou já processado' };
  const template = sqlite.getMessageTemplateByHash(item.message_hash);
  if (!template) {
    sqlite.updateDirectQueueItem(id, 'failed', `Template "${item.message_hash}" não encontrado`);
    return { ok: false, error: 'Template não encontrado' };
  }
  const rejectReason = getRejectReasonIfAlreadyReceived(item.profile_handle, template);
  if (rejectReason) {
    sqlite.updateDirectQueueItem(id, 'failed', rejectReason);
    return { ok: false, error: rejectReason };
  }
  const client = getApiExtractClient();
  await client.init();
  const message = await resolveTemplateBody(template.body, item.profile_handle);
  const result = await sendDirectMessage(client, item.profile_handle, message);
  sqlite.updateDirectQueueItem(id, result.ok ? 'sent' : 'failed', result.error ?? undefined);
  return { ok: result.ok ?? false, error: result.error };
}

/** Worker em background: fila de disparo roda no servidor (não depende do frontend).
 *  Importante: o intervalo é fixo de 1 minuto; o agendamento fino é feito por scheduled_at em cada item.
 */
let directQueueWorkerPaused = false;
const DIRECT_QUEUE_TICK_MS = 60 * 1000;
let directQueueWorkerTimer: ReturnType<typeof setInterval> | null = null;

async function runDirectQueueWorkerTick(): Promise<void> {
  if (directQueueWorkerPaused) return;
  try {
    const next = sqlite.getNextPendingDirectQueueItem();
    if (!next) return;
    const template = sqlite.getMessageTemplateByHash(next.message_hash);
    if (!template) {
      sqlite.updateDirectQueueItem(next.id, 'failed', `Template "${next.message_hash}" não encontrado`);
      return;
    }
    const rejectReason = getRejectReasonIfAlreadyReceived(next.profile_handle, template);
    if (rejectReason) {
      sqlite.updateDirectQueueItem(next.id, 'failed', rejectReason);
      console.log(`[direct-queue] @${next.profile_handle}: rejeitado (${rejectReason})`);
      return;
    }
    const client = getApiExtractClient();
    await client.init();
    const message = await resolveTemplateBody(template.body, next.profile_handle);
    const result = await sendDirectMessage(client, next.profile_handle, message);
    sqlite.updateDirectQueueItem(next.id, result.ok ? 'sent' : 'failed', result.error ?? undefined);
    console.log(`[direct-queue] @${next.profile_handle}: ${result.ok ? 'OK' : result.error ?? 'erro'}`);
  } catch (e) {
    console.error('[direct-queue] Erro:', e instanceof Error ? e.message : e);
  }
}

function startDirectQueueWorker(): void {
  if (directQueueWorkerTimer) return;
  directQueueWorkerTimer = setInterval(runDirectQueueWorkerTick, DIRECT_QUEUE_TICK_MS);
  console.log('[direct-queue] Worker iniciado (intervalo fixo: 1 min)');
}

function stopDirectQueueWorker(): void {
  if (directQueueWorkerTimer) {
    clearInterval(directQueueWorkerTimer);
    directQueueWorkerTimer = null;
  }
}

/** Status do serviço de fila em background. */
app.get('/api/direct/queue/service-status', requireScopes('adm', 'assinante'), (_req: RequestWithAuth, res: Response) => {
  res.json({
    running: !directQueueWorkerPaused && directQueueWorkerTimer != null,
    paused: directQueueWorkerPaused,
    intervalMinutes: 1,
  });
});

/** Pausa o serviço de fila. */
app.post('/api/direct/queue/service-pause', requireScopes('adm', 'assinante'), (_req: RequestWithAuth, res: Response) => {
  directQueueWorkerPaused = true;
  res.json({ paused: true });
});

/** Retoma o serviço de fila. */
app.post('/api/direct/queue/service-resume', requireScopes('adm', 'assinante'), (_req: RequestWithAuth, res: Response) => {
  directQueueWorkerPaused = false;
  res.json({ paused: false });
});

/** Mantido por compatibilidade: não altera mais o intervalo (fixo em 1 min). */
app.put('/api/direct/queue/service-interval', requireScopes('adm', 'assinante'), (req: RequestWithAuth, res: Response) => {
  void req; // ignorado
  res.json({ intervalMinutes: 1 });
});

/** Processa o próximo item pendente da fila: envia 1 DM e atualiza status. Retorna { processed, handle, ok, error }. */
app.post('/api/direct/queue/process-next', requireScopes('adm', 'assinante'), async (req: RequestWithAuth, res: Response) => {
  try {
    const next = sqlite.getNextPendingDirectQueueItem();
    if (!next) {
      res.json({ processed: false });
      return;
    }
    const template = sqlite.getMessageTemplateByHash(next.message_hash);
    if (!template) {
      sqlite.updateDirectQueueItem(next.id, 'failed', `Template "${next.message_hash}" não encontrado`);
      res.json({ processed: true, handle: next.profile_handle, ok: false, error: 'Template não encontrado' });
      return;
    }
    const rejectReason = getRejectReasonIfAlreadyReceived(next.profile_handle, template);
    if (rejectReason) {
      sqlite.updateDirectQueueItem(next.id, 'failed', rejectReason);
      res.json({ processed: true, handle: next.profile_handle, ok: false, error: rejectReason });
      return;
    }
    const client = getApiExtractClient();
    await client.init();
    const message = await resolveTemplateBody(template.body, next.profile_handle);
    const result = await sendDirectMessage(client, next.profile_handle, message);
    sqlite.updateDirectQueueItem(next.id, result.ok ? 'sent' : 'failed', result.error ?? undefined);
    res.json({ processed: true, handle: next.profile_handle, ok: result.ok ?? false, error: result.error });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: errMsg });
  }
});

/** Extract + request-code em sequência (sem frontend entre as etapas). Cadastro: extração roda imediatamente no client prioritário, sem depender da apiExtractQueue. */
app.post('/api/auth/request-code-with-extract', requireScopesOrPublic('adm'), async (req: RequestWithAuth, res: Response) => {
  const t0 = Date.now();
  const logStep = (msg: string) => console.log(`[request-code-with-extract] ${logTimestamp()} +${Date.now() - t0}ms ${msg}`);
  try {
    const now = Date.now();
    if (now < apiExtractBlockedUntil) {
      res.status(503).json({ error: `Rate limit. Tente novamente em ${Math.ceil((apiExtractBlockedUntil - now) / 60000)} min.` });
      return;
    }
    const nickname = (req.body?.nickname ?? req.body?.handle ?? '').toString().trim().replace(/^@/, '').toLowerCase();
    if (!nickname) {
      res.status(400).json({ error: 'Informe o nickname do Instagram' });
      return;
    }
    const fast = req.body?.fast === true || req.body?.fast === 'true';
    logStep(`Cadastro: extração imediata (fora da fila) + envio de código para @${nickname}${fast ? ' [fast]' : ''}`);

    const authStatePath = resolveAuthStatePath(process.env.INSTAGRAM_AUTH_STATE ?? process.env.AUTH_STATE_PATH ?? 'data/instagram-auth.json');
    if (!existsSync(authStatePath)) {
      res.status(503).json({ error: 'Sessão do Instagram não configurada. Execute o login do crawl (npm run login).' });
      return;
    }

    const handle = nickname.replace(/^@/, '');
    extractProfileResults.set(handle, { status: 'pending' });
    const priorityClient = getPriorityExtractClient();
    try {
      await runExtractAndStore(handle, { client: priorityClient, skipCount: true, fast });
    } catch (err) {
      console.error('[API] request-code-with-extract extract erro:', err instanceof Error ? err.stack : err);
      const stored = extractProfileResults.get(handle);
      if (stored?.status === 'error') {
        res.status(400).json({ error: stored.error ?? 'Erro na extração' });
        return;
      }
      extractProfileResults.set(handle, { status: 'error', error: err instanceof Error ? err.message : String(err) });
      res.status(400).json({ error: err instanceof Error ? err.message : 'Erro na extração' });
      return;
    }
    const stored = extractProfileResults.get(handle);
    if (stored?.status !== 'done') {
      res.status(400).json({ error: stored?.status === 'error' ? (stored as { error: string }).error : 'Erro na extração' });
      return;
    }
    if (!stored.result.success) {
      res.status(400).json({
        error: stored.result.error ?? stored.result.rejectionReason ?? 'Falha ao extrair perfil',
        rejectionReason: stored.result.rejectionReason,
        followProfileUrl: stored.result.followProfileUrl,
      });
      return;
    }
    logStep(`Extract pronto em ${Date.now() - t0}ms, enviando código...`);

    const userId = req.user ? Number(req.user.sub) : null;
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    authDb.saveProfileVerification(nickname, code, userId, new Date(Date.now() + 15 * 60 * 1000).toISOString());

    const flowPromise = performRequestCodeFlow(nickname, code, userId, {
      client: priorityClient,
      trustFreshExtract: true,
      ...(fast ? { fast: true } : {}),
    });
    requestCodeFlushPromise = requestCodeFlushPromise.then(async () => {
      await flowPromise;
    });
    const result = await flowPromise;
    if (result.nao_segue_perfil && result.followProfileUrl) {
      res.status(400).json({ error: 'nao_segue_perfil', followProfileUrl: result.followProfileUrl });
      return;
    }
    if (result.error && !result.sent) {
      res.status(503).json({ error: result.error });
      return;
    }
    logStep(`Concluído em ${Date.now() - t0}ms`);
    res.status(200).json({ sent: true, code: process.env.NODE_ENV === 'development' ? code : undefined });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    logStep(`ERRO: ${errMsg}`);
    res.status(500).json({ error: errMsg });
  }
});

/** Valida com o código recebido no Instagram. Se não estiver logado, o 2FA faz o login (retorna token + user). */
app.post('/api/auth/verify-profile', (req: RequestWithAuth, res: Response) => {
  try {
    const nickname = (req.body?.nickname ?? req.body?.handle ?? '').toString().trim().replace(/^@/, '');
    const code = (req.body?.code ?? '').toString().trim();
    if (!nickname || !code) {
      res.status(400).json({ error: 'Informe o nickname e o código' });
      return;
    }
    const verified = authDb.getProfileVerification(nickname, code);
    if (verified === null) {
      res.status(400).json({ error: 'Código inválido ou expirado. Solicite um novo código.' });
      return;
    }
    authDb.clearProfileVerification(nickname);

    if (req.user) {
      const currentUserId = Number(req.user.sub);
      if (verified !== 'valid_no_user' && verified !== currentUserId) {
        res.status(400).json({ error: 'Código não corresponde à sua conta.' });
        return;
      }
      const currentUser = authDb.getById(currentUserId);
      const isAssinanteLinkingInstagram = currentUser?.scope === 'assinante' && !currentUser.profile_handle && !authDb.isMissionInstagramClaimed(currentUserId);
      const existingByUsername = authDb.getByUsername(nickname);
      // Só desvia para outro usuário se o atual NÃO for assinante vinculando Instagram (missão)
      if (existingByUsername && existingByUsername.id !== currentUserId && currentUser?.scope !== 'assinante') {
        authDb.updateUser(existingByUsername.id, { profile_handle: nickname });
        return res.status(200).json({ verified: true, profile_handle: nickname });
      }
      // Assinante: se o nickname já é username de outro usuário, só atualizar profile_handle (evitar UNIQUE)
      if (currentUser?.scope === 'assinante' && existingByUsername && existingByUsername.id !== currentUserId) {
        authDb.updateUser(currentUserId, { profile_handle: nickname });
      } else {
        authDb.updateUser(currentUserId, { profile_handle: nickname, username: nickname });
      }
      if (currentUser?.scope === 'assinante') {
        if (isAssinanteLinkingInstagram) {
          authDb.setMissionInstagramClaimed(currentUserId);
          creditsCampaignsDb.addCredits(currentUserId, MISSION_INSTAGRAM_CREDITS, 'mission_instagram', undefined);
        }
        const secret = getJwtSecret();
        const user = authDb.getById(currentUserId)!;
        const newToken = signJwt(
          { sub: String(user.id), username: user.username, scope: user.scope as AuthScope, profile_handle: user.profile_handle ?? undefined },
          secret
        );
        return res.status(200).json({
          verified: true,
          profile_handle: nickname,
          mission_completed: true,
          credits: MISSION_INSTAGRAM_CREDITS,
          token: newToken,
          user: { id: user.id, username: user.username, scope: user.scope, profile_handle: user.profile_handle },
        });
      }
      return res.status(200).json({ verified: true, profile_handle: nickname });
    }

    if (verified !== 'valid_no_user') {
      res.status(400).json({ error: 'Código foi solicitado com outra conta. Use o mesmo login ou solicite um novo código.' });
      return;
    }

    let user = authDb.getByProfileHandle(nickname);
    if (!user) {
      const existingByUsername = authDb.getByUsername(nickname);
      if (existingByUsername) {
        authDb.updateUser(existingByUsername.id, { profile_handle: nickname, scope: 'influencer' });
        user = authDb.getById(existingByUsername.id)!;
      } else {
        const randomPassword = crypto.randomBytes(32).toString('hex');
        const id = authDb.createUser(nickname, hashPassword(randomPassword), 'influencer', nickname);
        user = authDb.getById(id)!;
      }
    }
    const secret = getJwtSecret();
    const token = signJwt(
      { sub: String(user.id), username: user.username, scope: user.scope as AuthScope, profile_handle: user.profile_handle ?? undefined },
      secret
    );
    res.status(200).json({
      token,
      user: {
        id: user.id,
        username: user.username,
        scope: user.scope,
        profile_handle: user.profile_handle,
      },
      verified: true,
      profile_handle: nickname,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Admin: listar usuários (apenas adm). */
app.get('/api/admin/users', requireScopes('adm'), (req: RequestWithAuth, res: Response) => {
  try {
    const users = authDb.listUsers();
    res.json({ users });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Admin: criar usuário (apenas adm). */
app.post('/api/admin/users', requireScopes('adm'), (req: RequestWithAuth, res: Response) => {
  try {
    const body = req.body as Record<string, unknown>;
    const username = (body.username ?? body.email ?? '').toString().trim().replace(/^@/, '');
    const password = (body.password ?? '').toString();
    const scope = (body.scope ?? 'public').toString() as AuthScope;
    const profileHandle = body.profile_handle != null ? (body.profile_handle as string).trim() || null : null;
    if (!username || !password) {
      res.status(400).json({ error: 'username e password são obrigatórios' });
      return;
    }
    const allowed: AuthScope[] = ['adm', 'assinante', 'influencer', 'public'];
    if (!allowed.includes(scope)) {
      res.status(400).json({ error: 'scope inválido. Use: adm, assinante, influencer, public' });
      return;
    }
    if (authDb.getByUsername(username)) {
      res.status(409).json({ error: 'Já existe um usuário com este username' });
      return;
    }
    const passwordHash = hashPassword(password);
    const id = authDb.createUser(username, passwordHash, scope, profileHandle);
    const user = authDb.getById(id);
    if (!user) {
      res.status(500).json({ error: 'Erro ao criar usuário' });
      return;
    }
    res.status(201).json({
      user: {
        id: user.id,
        username: user.username,
        scope: user.scope,
        profile_handle: user.profile_handle,
        created_at: user.created_at,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Admin: obter usuário por id (apenas adm). */
app.get('/api/admin/users/:id', requireScopes('adm'), (req: RequestWithAuth, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      res.status(400).json({ error: 'id inválido' });
      return;
    }
    const user = authDb.getById(id);
    if (!user) {
      res.status(404).json({ error: 'Usuário não encontrado' });
      return;
    }
    res.json({
      user: {
        id: user.id,
        username: user.username,
        scope: user.scope,
        profile_handle: user.profile_handle,
        created_at: user.created_at,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Admin: atualizar usuário (apenas adm). */
app.put('/api/admin/users/:id', requireScopes('adm'), (req: RequestWithAuth, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      res.status(400).json({ error: 'id inválido' });
      return;
    }
    const user = authDb.getById(id);
    if (!user) {
      res.status(404).json({ error: 'Usuário não encontrado' });
      return;
    }
    const body = req.body as Record<string, unknown>;
    const updates: { username?: string; password_hash?: string; scope?: AuthScope; profile_handle?: string | null } = {};
    if (body.username !== undefined) updates.username = (body.username as string).trim().replace(/^@/, '');
    if (body.password !== undefined && (body.password as string).toString()) {
      updates.password_hash = hashPassword((body.password as string).toString());
    }
    if (body.scope !== undefined) {
      const scope = (body.scope as string).toString() as AuthScope;
      const allowed: AuthScope[] = ['adm', 'assinante', 'influencer', 'public'];
      if (!allowed.includes(scope)) {
        res.status(400).json({ error: 'scope inválido' });
        return;
      }
      updates.scope = scope;
    }
    if (body.profile_handle !== undefined) updates.profile_handle = body.profile_handle != null ? (String(body.profile_handle).trim() || null) : null;
    authDb.updateUser(id, updates);
    const updated = authDb.getById(id);
    if (!updated) {
      res.status(500).json({ error: 'Erro ao atualizar' });
      return;
    }
    res.json({
      user: {
        id: updated.id,
        username: updated.username,
        scope: updated.scope,
        profile_handle: updated.profile_handle,
        created_at: updated.created_at,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Admin: totais da base (RocksDB + SQLite). Cache em memória (TTL); `?fresh=1` força novo scan. */
app.get('/api/admin/stats', requireScopes('adm'), async (req: Request, res: Response) => {
  try {
    const fresh =
      req.query.fresh === '1' ||
      req.query.fresh === 'true' ||
      String(req.query.refresh ?? '').toLowerCase() === '1';
    const stats = await getAdminStatsSnapshot(sqlitePath, db, { bypassCache: fresh });
    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/**
 * Admin: varre todos os posts (RocksDB), extrai @menções em legendas/texto auxiliar e retorna as que
 * não possuem entrada no bucket `profile`.
 */
app.get('/api/admin/reports/unregistered-mentions', requireScopes('adm'), async (_req: Request, res: Response) => {
  try {
    const [postRows, profileRows] = await Promise.all([
      db.getByBucket<Record<string, unknown>>('post'),
      db.getByBucket<Record<string, unknown>>('profile'),
    ]);
    const profileSet = new Set(
      profileRows
        .map(({ key }) => String(key ?? '').replace(/^@+/, '').trim().toLowerCase())
        .filter((k) => k.length > 0)
    );
    const allMentions = new Set<string>();
    for (const { value } of postRows) {
      for (const h of collectMentionHandlesFromPostItem(value as Record<string, unknown>)) {
        allMentions.add(h);
      }
    }
    const missing = [...allMentions].filter((h) => !profileSet.has(h)).sort((a, b) => a.localeCompare(b));
    res.json({
      postsScanned: postRows.length,
      profilesInDb: profileSet.size,
      uniqueMentions: allMentions.size,
      notRegisteredCount: missing.length,
      notRegistered: missing.map((h) => `@${h}`),
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Admin: listar tabelas do banco (apenas adm). */
app.get('/api/admin/db/tables', requireScopes('adm'), (_req: Request, res: Response) => {
  try {
    const tables = listTables(sqlitePath);
    res.json({ tables });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Admin: consultar tabela (apenas adm). Query: limit (default 100), offset (default 0). */
app.get('/api/admin/db/tables/:table', requireScopes('adm'), (req: Request, res: Response) => {
  try {
    const table = (req.params.table || '').trim();
    if (!isAllowedTable(table)) {
      res.status(400).json({ error: `Tabela não permitida: ${table}` });
      return;
    }
    const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 100));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const result = queryTable(sqlitePath, table, limit, offset);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

type AdminPurgeCoreResult =
  | { ok: true; handle: string; s3ObjectsRemoved: number }
  | { ok: false; handle: string; error: string; statusCode: 400 | 500 };

/** Núcleo compartilhado: purge completo (sem invalidar cache de campanha). */
async function purgeInfluencerAsAdminCore(rawInput: string): Promise<AdminPurgeCoreResult> {
  const resolved = profileRefDb.resolveToHandle(rawInput.trim()) ?? rawInput.replace(/^@+/, '').toLowerCase().trim();
  const handle = resolved;
  if (!handle || handle.length > 200) {
    return { ok: false, handle: rawInput.trim() || '(vazio)', error: 'Identificador inválido', statusCode: 400 };
  }

  let s3ObjectsRemoved = 0;
  try {
    s3ObjectsRemoved = await wipeInfluencerS3Prefix(handle);
  } catch (e) {
    console.error('[admin purge] S3:', e instanceof Error ? e.message : e);
  }

  const authUser = authDb.getByProfileHandle(handle);
  const userId = authUser?.id;

  try {
    await db.deleteProfileCompletely(handle);
  } catch (e) {
    console.error('[admin purge] storage:', e instanceof Error ? e.message : e);
    return { ok: false, handle, error: 'Falha ao apagar dados locais do perfil', statusCode: 500 };
  }

  try {
    sqlite.deleteDirectQueueByHandle(handle);
    sqlite.deleteAllFavoritesByProfileHandle(handle);
    authDb.clearProfileVerification(handle);
    creditsCampaignsDb.removeHandleFromAllCampaigns(handle);
  } catch (e) {
    console.error('[admin purge] sqlite/auth:', e instanceof Error ? e.message : e);
  }

  if (userId != null && Number.isFinite(userId)) {
    try {
      creditsCampaignsDb.deleteAllByUserId(userId);
      paymentsDb.deleteAllByUserId(userId);
      sqlite.deleteAllFavoritesByUserId(userId);
      authDb.clearProfileVerificationByUserId(userId);
      authDb.deleteUser(userId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[admin purge] auth user:', msg);
      return {
        ok: false,
        handle,
        error: 'Perfil apagado, mas falhou ao remover usuário vinculado. Verifique logs.',
        statusCode: 500,
      };
    }
  }

  return { ok: true, handle, s3ObjectsRemoved };
}

/**
 * Admin: apaga influenciador por completo — RocksDB (perfil + mídias), SQLite (ativação, fila, favoritos globais,
 * retira o handle das campanhas), prefixo S3 `influencers/<handle>/`, e conta auth + pagamentos/créditos se existir.
 */
app.delete('/api/admin/influencers/:handle', requireScopes('adm'), async (req: RequestWithAuth, res: Response) => {
  const raw = decodeURIComponent(String(req.params.handle ?? '').trim());
  const result = await purgeInfluencerAsAdminCore(raw);
  if (!result.ok) {
    res.status(result.statusCode).json({ error: result.error });
    return;
  }
  clearCampaignContextCache();
  res.json({ ok: true, s3ObjectsRemoved: result.s3ObjectsRemoved });
});

/**
 * Qualify / automações: purge completo com X-Collector-Key (mesmo efeito do DELETE admin).
 * Corpo: { "handle": "usuario" }.
 */
app.post('/api/crawl/collector-delete-profile', requireCollectorIngestSecret, async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as { handle?: unknown };
    const raw = String(body.handle ?? '').trim();
    const result = await purgeInfluencerAsAdminCore(raw);
    if (!result.ok) {
      res.status(result.statusCode).json({
        ok: false,
        error: result.error,
        code: 'COLLECTOR_DELETE_FAILED',
      });
      return;
    }
    clearCampaignContextCache();
    res.json({ ok: true, handle: result.handle, s3ObjectsRemoved: result.s3ObjectsRemoved });
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      code: 'COLLECTOR_DELETE_ERROR',
    });
  }
});

/** Admin: mescla campos em `llm.qualification` do perfil no RocksDB (classificação exibida na UI). */
app.patch(
  '/api/admin/influencers/:handle/llm-qualification',
  requireScopes('adm'),
  rateLimitDataApi,
  async (req: RequestWithAuth, res: Response) => {
    try {
      const raw = decodeURIComponent(String(req.params.handle ?? '').trim());
      const handle = raw.replace(/^@+/, '').toLowerCase().trim();
      if (!handle) {
        res.status(400).json({ error: 'Handle inválido' });
        return;
      }
      const parsed = pickAdminQualificationPatch(req.body);
      if (!parsed.ok) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      const existing = await db.loadByHandle(handle);
      if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
        res.status(404).json({ error: 'Perfil não encontrado' });
        return;
      }
      const merged = applyQualificationPatchToProfileRecord(
        existing as Record<string, unknown>,
        handle,
        parsed.patch
      );
      await db.save(merged, { skipSearchInvalidation: true });
      scheduleSearchCacheRewarm(db);
      res.json({ ok: true, handle, llm: merged.llm });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  }
);

const ADMIN_PURGE_BATCH_MAX = 100;

/** Admin: exclusão em lote (mesmo efeito do DELETE por handle). Máx. 100 handles por requisição. */
app.post('/api/admin/influencers/purge-batch', requireScopes('adm'), rateLimitDataApi, async (req: RequestWithAuth, res: Response) => {
  try {
    const body = (req.body ?? {}) as { handles?: unknown };
    if (!Array.isArray(body.handles)) {
      res.status(400).json({ error: 'Envie um JSON com { handles: string[] }' });
      return;
    }
    const seen = new Set<string>();
    const handles: string[] = [];
    for (const x of body.handles) {
      const n = String(x ?? '')
        .replace(/^@+/, '')
        .toLowerCase()
        .trim();
      if (!n || seen.has(n)) continue;
      seen.add(n);
      handles.push(n);
    }
    if (handles.length === 0) {
      res.status(400).json({ error: 'Nenhum handle válido' });
      return;
    }
    if (handles.length > ADMIN_PURGE_BATCH_MAX) {
      res.status(400).json({ error: `Máximo de ${ADMIN_PURGE_BATCH_MAX} handles por requisição` });
      return;
    }
    const removed: string[] = [];
    const failed: { handle: string; error: string }[] = [];
    let s3ObjectsRemoved = 0;
    for (const h of handles) {
      const r = await purgeInfluencerAsAdminCore(h);
      if (r.ok) {
        removed.push(r.handle);
        s3ObjectsRemoved += r.s3ObjectsRemoved;
      } else {
        failed.push({ handle: r.handle, error: r.error });
      }
    }
    if (removed.length > 0) clearCampaignContextCache();
    res.json({ ok: true, removed, failed, s3ObjectsRemoved });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Admin: excluir usuário (apenas adm). */
app.delete('/api/admin/users/:id', requireScopes('adm'), (req: RequestWithAuth, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      res.status(400).json({ error: 'id inválido' });
      return;
    }
    const user = authDb.getById(id);
    if (!user) {
      res.status(404).json({ error: 'Usuário não encontrado' });
      return;
    }
    authDb.deleteUser(id);
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** LGPD: excluir conta e todos os dados do usuário. Assinante: própria conta. Influencer: própria conta. Adm: query handle=. */
app.delete('/api/account', requireScopes('adm', 'assinante', 'influencer'), async (req: RequestWithAuth, res: Response) => {
  let userId: number;
  let handle: string | null = null;
  try {
    if (req.user!.scope === 'adm') {
      const handleParam = (req.query?.handle ?? '').toString().trim().replace(/^@/, '').toLowerCase();
      if (!handleParam) {
        res.status(400).json({ error: 'Informe o handle (query: handle=)' });
        return;
      }
      handle = handleParam;
      const user = authDb.getByProfileHandle(handle);
      if (!user) {
        res.status(404).json({ error: 'Usuário não encontrado.' });
        return;
      }
      userId = user.id;
    } else {
      userId = Number(req.user!.sub);
      const user = authDb.getById(userId);
      if (!user) {
        res.status(404).json({ error: 'Usuário não encontrado.' });
        return;
      }
      handle = (user.profile_handle || '').replace(/^@/, '').trim().toLowerCase() || null;
    }
  } catch (e) {
    console.error('[DELETE /api/account] Erro ao obter usuário:', e instanceof Error ? e.message : e);
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    return;
  }

  const safeRun = (name: string, fn: () => void | Promise<void>): void => {
    try {
      const p = fn();
      if (p && typeof (p as Promise<unknown>).then === 'function') {
        (p as Promise<void>).catch((err) => console.error(`[DELETE /api/account] ${name}:`, err instanceof Error ? err.message : err));
      }
    } catch (err) {
      console.error(`[DELETE /api/account] ${name}:`, err instanceof Error ? err.message : err);
    }
  };

  const safeRunAsync = async (name: string, fn: () => void | Promise<void>): Promise<void> => {
    try {
      await Promise.resolve(fn());
    } catch (err) {
      console.error(`[DELETE /api/account] ${name}:`, err instanceof Error ? err.message : err);
    }
  };

  if (handle) {
    safeRun('deleteActivation', () => sqlite.deleteActivation(handle!));
    safeRun('deleteProjectApplicationsByHandle', () => sqlite.deleteProjectApplicationsByHandle(handle!));
    safeRun('deleteDirectQueueByHandle', () => sqlite.deleteDirectQueueByHandle(handle!));
    await safeRunAsync('rocks.deleteByKeyPrefix(post)', async () => { await rocks.deleteByKeyPrefix('post', `${handle!}:`); });
    await safeRunAsync('rocks.delete(profile)', () => rocks.delete('profile', handle!));
    safeRun('clearProfileVerification', () => authDb.clearProfileVerification(handle!));
  }
  safeRun('creditsCampaignsDb.deleteAllByUserId', () => creditsCampaignsDb.deleteAllByUserId(userId));
  safeRun('paymentsDb.deleteAllByUserId', () => paymentsDb.deleteAllByUserId(userId));
  safeRun('sqlite.deleteAllFavoritesByUserId', () => sqlite.deleteAllFavoritesByUserId(userId));
  safeRun('clearProfileVerificationByUserId', () => authDb.clearProfileVerificationByUserId(userId));

  try {
    authDb.deleteUser(userId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('não encontrado') || msg.includes('Usuário não encontrado')) {
      res.status(204).end();
      return;
    }
    console.error('[DELETE /api/account] deleteUser:', msg);
    res.status(500).json({ error: 'Falha ao excluir conta. Tente novamente.' });
    return;
  }
  res.status(204).end();
});

/** Headers para o proxy de imagem: CDN do Instagram (fbcdn) exige Referer + User-Agent de navegador. */
const PROXY_IMAGE_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://www.instagram.com/',
  'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Dest': 'image',
  'Sec-Fetch-Mode': 'no-cors',
};

/** Timeout em ms para cada tentativa de fetch no proxy de imagem. */
const PROXY_FETCH_TIMEOUT_MS = 12_000;

/** Fallbacks (proxy público) quando a requisição direta ao CDN retorna 403 ou falha. wsrv.nl é focado em imagens e costuma funcionar com CDNs. */
const FALLBACK_PROXIES: ((targetUrl: string) => string)[] = [
  (u) => `https://wsrv.nl/?url=${encodeURIComponent(u)}`,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
];

type FetchResponse = Awaited<ReturnType<typeof fetch>>;

async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<FetchResponse> {
  const { timeoutMs = PROXY_FETCH_TIMEOUT_MS, ...fetchOptions } = options;
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...fetchOptions, signal: ac.signal });
    return r;
  } finally {
    clearTimeout(id);
  }
}

/** Avatar do perfil por profile_ref (sem @ na URL). */
app.get('/api/media/p/:profileRef/avatar', rateLimitDataApi, async (req: Request, res: Response) => {
  try {
    await streamProfileAvatarMedia(profileRefDb, db, req.params.profileRef, res);
  } catch (e) {
    console.error('[API] media avatar:', e instanceof Error ? e.message : e);
    if (!res.headersSent) res.status(500).json({ error: 'Erro ao carregar imagem' });
  }
});

/** Capa de post/reel por profile_ref + mediaKey (sem handle na URL). */
app.get('/api/media/p/:profileRef/covers/:mediaKey', rateLimitDataApi, async (req: Request, res: Response) => {
  try {
    await streamProfileCoverMedia(profileRefDb, db, req.params.profileRef, req.params.mediaKey, res);
  } catch (e) {
    console.error('[API] media cover:', e instanceof Error ? e.message : e);
    if (!res.headersSent) res.status(500).json({ error: 'Erro ao carregar imagem' });
  }
});

/** Proxy de imagem para evitar bloqueio por CORS/CORP (ex.: CDN do Instagram). Timeout + fallbacks em caso de 403 ou erro. */
app.get('/api/proxy-image', async (req: Request, res: Response) => {
  const url = (req.query.url as string)?.trim();
  if (!url || (!url.startsWith('https://') && !url.startsWith('http://'))) {
    res.status(400).json({ error: 'Query "url" obrigatória e deve ser http(s).' });
    return;
  }
  const tryStream = async (response: FetchResponse): Promise<boolean> => {
    if (!response.ok) return false;
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    // CDN do Instagram às vezes retorna 200 com HTML (ex.: "imagem indisponível"); não repassar como imagem
    if (!contentType.toLowerCase().includes('image/') && !contentType.toLowerCase().includes('octet-stream')) {
      return false;
    }
    res.setHeader('content-type', contentType);
    res.setHeader('cache-control', 'public, max-age=86400');
    const buf = await response.arrayBuffer();
    res.end(Buffer.from(buf));
    return true;
  };

  try {
    let r = await fetchWithTimeout(url, { headers: PROXY_IMAGE_HEADERS });
    if (r.ok) {
      const done = await tryStream(r);
      if (done) return;
    }
    if (r.status === 403 || !r.ok) {
      for (const toProxyUrl of FALLBACK_PROXIES) {
        try {
          const proxyUrl = toProxyUrl(url);
          r = await fetchWithTimeout(proxyUrl, { headers: { Accept: 'image/*,*/*;q=0.8' } });
          if (r.ok) {
            const done = await tryStream(r);
            if (done) return;
          }
        } catch {
          continue;
        }
      }
    }
    res.status(404).setHeader('content-type', 'application/json').json({
      error: 'Imagem não disponível',
      reason: 'CDN retornou erro ou URL expirada; fallbacks não conseguiram buscar a imagem.',
    });
  } catch (e) {
    console.error('[API] proxy-image 502:', e instanceof Error ? e.message : e);
    res.status(502).setHeader('content-type', 'application/json').json({
      error: 'Erro no proxy de imagem',
      reason: e instanceof Error ? e.message : String(e),
    });
  }
});

/** Lista de perfis restrita a uma campanha. Exige header X-Campaign-Id. */
app.get('/api/profiles', rateLimitDataApi, requireCampaignIdHeader, async (req: RequestWithAuth, res: Response) => {
  try {
    const campaignId = req.allowedCampaignId!;
    const userId = Number(req.user!.sub);
    const handles =
      campaignId === 'all'
        ? creditsCampaignsDb.getAllPaidHandlesUnion(userId)
        : creditsCampaignsDb.getCampaignHandlesIfActive(campaignId, userId);
    if (!handles || handles.length === 0) {
      res.json({ total: 0, items: [] });
      return;
    }
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const since = (req.query.since as string)?.trim();
    const handleSet = new Set(handles.map((h) => normalizeHandle(h)));
    let items = (await db.getByBucket('profile'))
      .filter(({ key }) => handleSet.has(key));
    if (since) {
      const sinceTime = new Date(since).getTime();
      if (!Number.isNaN(sinceTime)) {
        items = items.filter(({ value }) => {
          const v = value as Record<string, unknown>;
          const collected = v?._collected_at;
          if (collected == null) return false;
          const t = typeof collected === 'string' ? new Date(collected).getTime() : Number(collected);
          return !Number.isNaN(t) && t >= sinceTime;
        });
      }
    }
    const total = items.length;
    const slice = items
      .slice(offset, offset + limit)
      .map(({ key, value }) => redactContactInfoInProfile({ key, ...(value as object) }));
    res.json({ total, items: slice });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

const PUBLIC_PAGE_SIZE = 12;

const COST_TIER_VALUES = ['low', 'medium', 'high', 'very_high'] as const;

function parseCostTierFilter(v: unknown): string[] | undefined {
  if (v == null) return undefined;
  const arr = Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.split(',').map((x) => x.trim().toLowerCase()) : [];
  const filtered = arr.filter((s) => (COST_TIER_VALUES as readonly string[]).includes(s));
  return filtered.length > 0 ? filtered : undefined;
}

/** Requisições por minuto por IP (anônimo). Configurável por API_RATE_LIMIT_PER_MIN_IP. */
const RATE_LIMIT_PER_MIN_IP = Number(process.env.API_RATE_LIMIT_PER_MIN_IP) || 120;
/** Requisições por minuto por usuário (public/influencer). Configurável por API_RATE_LIMIT_PER_MIN_USER. */
const RATE_LIMIT_PER_MIN_USER = Number(process.env.API_RATE_LIMIT_PER_MIN_USER) || 120;
/** Requisições por minuto para adm/assinante. Configurável por API_RATE_LIMIT_PER_MIN_SUBSCRIBER. */
const RATE_LIMIT_PER_MIN_SUBSCRIBER = Number(process.env.API_RATE_LIMIT_PER_MIN_SUBSCRIBER) || 300;

function getClientKeyForRateLimit(req: RequestWithAuth): string {
  if (req.user) return `u:${req.user.sub}`;
  const ip = (req.ip || (req as unknown as { socket?: { remoteAddress?: string } }).socket?.remoteAddress || 'unknown').toString();
  const ipHash = crypto.createHash('sha256').update(ip + (process.env.ANON_SEARCH_SALT || '')).digest('hex');
  return `ip:${ipHash}`;
}

function getRateLimitMax(req: RequestWithAuth): number {
  if (!req.user) return RATE_LIMIT_PER_MIN_IP;
  if (req.user.scope === 'adm' || req.user.scope === 'assinante') return RATE_LIMIT_PER_MIN_SUBSCRIBER;
  return RATE_LIMIT_PER_MIN_USER;
}

/** Middleware: limita requisições por minuto (proteção contra crawlers). Retorna 429 se exceder. */
function rateLimitDataApi(req: RequestWithAuth, res: Response, next: () => void): void {
  const key = getClientKeyForRateLimit(req);
  const max = getRateLimitMax(req);
  if (!checkApiRateLimit(key, max)) {
    res.setHeader('Retry-After', String(getRetryAfterSeconds(key)));
    res.status(429).json({
      error: 'Muitas requisições. Aguarde um minuto antes de tentar novamente.',
      code: 'RATE_LIMIT',
    });
    return;
  }
  next();
}

/** Foto e bio para prévia pública (bio com @/telefone redigidos). */
function pickPublicProfileDisplayFields(profile: Record<string, unknown>): Record<string, unknown> {
  const data = profile.data != null && typeof profile.data === 'object' && !Array.isArray(profile.data)
    ? (profile.data as Record<string, unknown>)
    : undefined;
  const user = data?.user != null && typeof data.user === 'object' && !Array.isArray(data.user)
    ? (data.user as Record<string, unknown>)
    : undefined;
  const out: Record<string, unknown> = {};
  const pic =
    (typeof profile.profile_pic_url === 'string' && profile.profile_pic_url) ||
    (typeof profile.hd_profile_pic_url === 'string' && profile.hd_profile_pic_url) ||
    (typeof user?.profile_pic_url === 'string' && user.profile_pic_url) ||
    (typeof user?.hd_profile_pic_url === 'string' && user.hd_profile_pic_url);
  if (pic) {
    out.profile_pic_url = pic;
    const hd = profile.hd_profile_pic_url ?? user?.hd_profile_pic_url;
    if (typeof hd === 'string' && hd) out.hd_profile_pic_url = hd;
  }
  const stable = profile.stable_profile_pic_url ?? user?.stable_profile_pic_url;
  if (typeof stable === 'string' && stable.startsWith('http')) {
    out.stable_profile_pic_url = stable;
  }
  const bioRaw = profile.biography ?? user?.biography;
  if (typeof bioRaw === 'string' && bioRaw.trim()) {
    out.biography = redactContactInfoInText(bioRaw.trim());
  }
  return out;
}

/** Prévia pública: profile_ref + avatar_url (sem @). */
function buildPublicProfilePreview(
  handle: string,
  profile: Record<string, unknown>,
  engagement: Record<string, unknown>,
  engagementByType: Awaited<ReturnType<typeof getProfileEngagementByType>>
): Record<string, unknown> {
  const ref = profileRefForHandle(handle);
  const followers = getFollowersFromProfile(profile);
  return buildPublicProfilePreviewDto(
    ref,
    { ...profile, followers_count: followers > 0 ? followers : profile.followers_count },
    engagement,
    engagementByType,
    pickPublicProfileDisplayFields
  );
}

/** Reduz perfil para versão sem dados sensíveis (público que atingiu limite). Mantém apenas bio e dados mínimos de exibição (foto, nome, handle). */
function redactProfile(profile: Record<string, unknown>, opts?: { allBasePreview?: boolean }): Record<string, unknown> {
  const out = { ...profile };
  const alwaysStrip = ['categories', 'external_url', 'mutual_followers_count', '_collected_at', '_discovered_by', '_discovered_value'];
  const countsStrip = ['followers_count', 'following_count', 'media_count', 'media_count_visible', 'total_clips_count'];
  for (const k of alwaysStrip) {
    out[k] = null;
  }
  if (!opts?.allBasePreview) {
    for (const k of countsStrip) {
      out[k] = null;
    }
  }
  if (out.data && typeof out.data === 'object') {
    const d = out.data as Record<string, unknown>;
    const u = d.user as Record<string, unknown> | undefined;
    out.data = {
      user: u != null
        ? {
          username: u?.username,
          full_name: u?.full_name,
          profile_pic_url: u?.profile_pic_url,
          is_verified: u?.is_verified,
          biography: u?.biography,
          follower_count: opts?.allBasePreview ? u?.follower_count ?? null : null,
          following_count: opts?.allBasePreview ? u?.following_count ?? null : null,
          media_count: opts?.allBasePreview ? u?.media_count ?? null : null,
          external_url: null,
        }
        : d.user,
    };
  }
  out._redacted = true;
  if (opts?.allBasePreview) {
    (out as { _all_base_preview?: boolean })._all_base_preview = true;
  }
  return redactContactInfoInProfile(out);
}

/** Reduz lista de posts removendo métricas (likes, comentários, views) para público que atingiu limite. */
function redactPostsItems(items: Array<{ key: string;[k: string]: unknown }>): Array<Record<string, unknown>> {
  return redactContactInfoInPostItems(items).map((out) => {
    if (out.metrics && typeof out.metrics === 'object') {
      out.metrics = { likes: null, comments: null, view_count: null };
    }
    if (out.post && typeof out.post === 'object') {
      const p = out.post as Record<string, unknown>;
      out.post = { ...p, like_count: null, comment_count: null, play_count: null };
    }
    return out;
  });
}

/** Posts para resposta da API: oculta @ e inclui `profile_ref` opaco por item. */
function preparePostItemsForApiResponse(
  items: Array<{ key: string; [k: string]: unknown }>,
  req?: RequestWithAuth
): Array<Record<string, unknown>> {
  return enrichPostItemsWithRefs(items, profileRefDb, req);
}

function prepareProfileListItemsForApiResponse(items: ProfileListItem[], req?: RequestWithAuth): ProfileListItem[] {
  return enrichListItemsWithRefs(items, profileRefDb, req);
}

/** Resposta de busca para público/anônimo: só totais e facets agregados — sem lista de perfis (`items`). */
function publicSearchPayload(result: { total: number; facets: Record<string, unknown> }): { total: number; facets: Record<string, unknown> } {
  const facets = { ...result.facets };
  facets.engagement_rate = [];
  facets.avg_likes = [];
  facets.posts_count = [];
  return { total: result.total, facets };
}

interface ProfilePreviewItem {
  firstName: string;
  profilePicUrl: string;
  llmDescription: string;
  size: FollowersSizeKey;
  category: string;
  audience: string;
  collectedAt: string | null;
  /** Métricas do perfil (mesma base da listagem / `engagement`). */
  followersCount: number;
  /** Taxa de engajamento % (média de interações por post vs seguidores). */
  engagementRate: number;
  totalLikes: number;
  totalComments: number;
  postsCount: number;
  avgLikes?: number;
  avgComments?: number;
}

/** Varia o tamanho do texto no preview (cards com alturas diferentes) + um slot mais rico com metadados LLM. */
function varyPreviewPersonaDescription(raw: string, item: ProfileListItem, previewIndex: number): string {
  const q = getLlmQualification(item as unknown as Record<string, unknown>);
  const cat = String(q?.mainCategory ?? '').trim();
  const aud0 =
    Array.isArray(q?.audienceType) && q?.audienceType[0] && typeof q.audienceType[0] === 'string'
      ? q.audienceType[0].trim()
      : '';

  const base = String(raw ?? '').trim();
  if (!base) {
    if (cat || aud0) {
      const one = [cat && `Conteúdo em ${cat}.`, aud0 && `Público ${aud0}.`].filter(Boolean);
      if (previewIndex % 2 === 0) return one[0] ?? 'Sem descrição LLM disponível.';
      return one.join(' ') || 'Sem descrição LLM disponível.';
    }
    return 'Sem descrição LLM disponível.';
  }

  const mode = previewIndex % 5;
  const firstSentence = (() => {
    const m = base.match(/^.{1,200}?[.!?](?:\s|$)/);
    return m ? m[0].trim() : base.slice(0, Math.min(95, base.length));
  })();

  if (mode === 0) {
    return firstSentence.length > 100 ? `${firstSentence.slice(0, 97)}…` : firstSentence;
  }
  if (mode === 1) {
    const cut = base.length > 145 ? `${base.slice(0, 142)}…` : base;
    return cut;
  }
  if (mode === 2) {
    return base.length > 260 ? `${base.slice(0, 257)}…` : base;
  }
  if (mode === 3) {
    return base;
  }
  const tail = [cat && `Categoria: ${cat}.`, aud0 && `Público-alvo: ${aud0}.`].filter(Boolean).join(' ');
  return tail ? `${base} ${tail}` : base;
}

function buildProfilePreviewItem(item: ProfileListItem, previewIndex: number): ProfilePreviewItem {
  const fullName = String(item.full_name ?? '').trim();
  const firstName = (() => {
    const chooseFromParts = (parts: string[]): string | null => {
      const clean = parts.map((p) => p.trim()).filter(Boolean);
      const long = clean.find((p) => p.length > 4);
      if (long) return long;
      return clean[0] ?? null;
    };
    if (fullName) {
      const fromName = chooseFromParts(fullName.split(/\s+/));
      if (fromName) return fromName;
    }
    return 'Influenciador';
  })();
  const q = getLlmQualification(item as unknown as Record<string, unknown>);
  const personaRaw = String(q?.personaSummary ?? '').trim();
  const llmDescription = redactContactInfoInText(varyPreviewPersonaDescription(personaRaw, item, previewIndex));
  const category = String(q?.mainCategory ?? '').trim() || '-';
  const audienceArr = Array.isArray(q?.audienceType)
    ? (q!.audienceType as unknown[])
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .slice(0, 6)
    : [];
  const audience = audienceArr.join(' / ') || '-';
  const hKey = String(item.handle ?? item.key ?? '')
    .toLowerCase()
    .replace(/^@/, '');
  const previewRef = hKey ? profileRefDb.getOrCreateRef(hKey) : '';
  const profilePicUrl = previewRef ? profileAvatarMediaPath(previewRef) : '';
  const followers = Number(item.followers_count ?? 0);
  const size = followersCountToSizeKey(followers);
  const collectedAtRaw = (item as Record<string, unknown>)._collected_at;
  const collectedAt = typeof collectedAtRaw === 'string' && collectedAtRaw.trim() ? collectedAtRaw : null;
  const eng = item.engagement;
  const engagementRate = Number(eng?.engagement_rate ?? 0);
  const totalLikes = Number(eng?.total_likes ?? 0);
  const totalComments = Number(eng?.total_comments ?? 0);
  const postsCount = Number(eng?.posts_count ?? 0);
  const avgLikes = Number(eng?.avg_likes ?? 0);
  const avgComments = Number(eng?.avg_comments ?? 0);
  return {
    firstName,
    profilePicUrl,
    llmDescription,
    size,
    category,
    audience,
    collectedAt,
    followersCount: followers,
    engagementRate: Number.isFinite(engagementRate) ? engagementRate : 0,
    totalLikes: Number.isFinite(totalLikes) ? totalLikes : 0,
    totalComments: Number.isFinite(totalComments) ? totalComments : 0,
    postsCount: Number.isFinite(postsCount) ? postsCount : 0,
    avgLikes: Number.isFinite(avgLikes) ? avgLikes : 0,
    avgComments: Number.isFinite(avgComments) ? avgComments : 0,
  };
}

function collectedAtDesc(a: ProfileListItem, b: ProfileListItem): number {
  const getMs = (it: ProfileListItem): number => {
    const raw = (it as Record<string, unknown>)._collected_at;
    if (typeof raw !== 'string' || !raw.trim()) return 0;
    const ms = new Date(raw).getTime();
    return Number.isFinite(ms) ? ms : 0;
  };
  return getMs(b) - getMs(a);
}

function getPrimaryAudienceKey(item: ProfileListItem): string {
  const q = getLlmQualification(item as unknown as Record<string, unknown>);
  const firstAudience = Array.isArray(q?.audienceType) ? q?.audienceType[0] : null;
  if (typeof firstAudience === 'string' && firstAudience.trim()) {
    return firstAudience.trim().toLowerCase();
  }
  return 'sem_publico';
}

function getPrimaryCategoryKey(item: ProfileListItem): string {
  const q = getLlmQualification(item as unknown as Record<string, unknown>);
  const cat = typeof q?.mainCategory === 'string' ? q.mainCategory : '';
  const normalized = cat.trim().toLowerCase();
  return normalized || 'sem_categoria';
}

/**
 * Mistura os perfis por público e categoria principais sem perder recência:
 * - começa dos mais atuais
 * - alterna por grupos audiência+categoria (round-robin)
 * - fallback para preencher com os restantes.
 */
function pickMixedRecentPreviewItems(sortedByRecent: ProfileListItem[], limit: number): ProfileListItem[] {
  const groups = new Map<string, ProfileListItem[]>();
  for (const item of sortedByRecent) {
    const key = `${getPrimaryAudienceKey(item)}|${getPrimaryCategoryKey(item)}`;
    const arr = groups.get(key);
    if (arr) arr.push(item);
    else groups.set(key, [item]);
  }
  const orderedGroupKeys = [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([k]) => k);
  const selected: ProfileListItem[] = [];
  while (selected.length < limit && orderedGroupKeys.length > 0) {
    let consumedInRound = 0;
    for (const key of orderedGroupKeys) {
      if (selected.length >= limit) break;
      const arr = groups.get(key);
      if (arr && arr.length > 0) {
        const next = arr.shift();
        if (next) {
          selected.push(next);
          consumedInRound++;
        }
      }
    }
    if (consumedInRound === 0) break;
  }
  if (selected.length < limit) {
    const selectedHandles = new Set(selected.map((i) => i.handle));
    for (const item of sortedByRecent) {
      if (selected.length >= limit) break;
      if (selectedHandles.has(item.handle)) continue;
      selected.push(item);
      selectedHandles.add(item.handle);
    }
  }
  return selected.slice(0, limit);
}

/** Listagem de perfis com filtros avançados e engajamento. Público (anônimo ou scope public): 1ª página.
 * Com limit=0 retorna só quantitativos (total + facets), sem autenticação nem X-Campaign-Id. */
app.get('/api/profiles/search', rateLimitDataApi, async (req: RequestWithAuth, res: Response) => {
  try {
    const q = (req.query.q as string)?.trim();
    const parseNumList = (v: unknown): number[] | undefined => {
      if (v == null) return undefined;
      if (Array.isArray(v)) return v.map((x) => Number(x)).filter(Number.isFinite);
      if (typeof v === 'string') return v.split(',').map((x) => Number(x.trim())).filter(Number.isFinite);
      return undefined;
    };
    const parseStrList = (v: unknown): string[] | undefined => {
      if (v == null) return undefined;
      if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
      if (typeof v === 'string') return v.split(',').map((x) => x.trim()).filter(Boolean);
      return undefined;
    };
    const optStrList = (v: unknown): string[] | undefined => {
      const a = parseStrList(v);
      return a?.length ? a : undefined;
    };
    const llmFamilyRaw = req.query.llmFamilySafe;
    const llmIsFamilySafe =
      llmFamilyRaw === '1' || llmFamilyRaw === 'true'
        ? true
        : llmFamilyRaw === '0' || llmFamilyRaw === 'false'
          ? false
          : undefined;
    const llmAdultRaw = req.query.llmAdultContent;
    const llmIsAdultContent =
      llmAdultRaw === '1' || llmAdultRaw === 'true'
        ? true
        : llmAdultRaw === '0' || llmAdultRaw === 'false'
          ? false
          : undefined;

    const quantitativosOnly = Number(req.query.limit) === 0;
    const isPublicOrAnonymous = !quantitativosOnly && (!req.user || req.user.scope === 'public');

    if (!quantitativosOnly && isPublicOrAnonymous) {
      if (Number(req.query.offset) > 0) {
        res.status(403).json({ error: 'Assinantes podem ver mais páginas. Seja premium.', code: 'PUBLIC_PAGE_LIMIT' });
        return;
      }
    }

    const minFollowers = req.query.minFollowers != null ? Number(req.query.minFollowers) : undefined;
    const maxFollowers = req.query.maxFollowers != null ? Number(req.query.maxFollowers) : undefined;
    const minEngagementRate = req.query.minEngagementRate != null ? Number(req.query.minEngagementRate) : undefined;
    const minAvgLikes = req.query.minAvgLikes != null ? Number(req.query.minAvgLikes) : undefined;
    const minPostsCount = req.query.minPostsCount != null ? Number(req.query.minPostsCount) : undefined;
    const categories = req.query.categories as string | string[] | undefined;
    const contentTypes = req.query.contentTypes as string | string[] | undefined;
    const engagementRateBuckets = req.query.engagementRateBuckets;
    const avgLikesBuckets = req.query.avgLikesBuckets;
    const postsCountBuckets = req.query.postsCountBuckets;
    const activationFilter = req.query.activationFilter;
    const cities = req.query.cities;
    const states = req.query.states;
    const neighborhoods = req.query.neighborhoods;
    const socialNetworks = req.query.socialNetworks;
    const excludePrivate = req.query.excludePrivate === 'true';
    const accountTypeFilter = req.query.accountTypeFilter;
    const sizeFilterRaw = req.query.sizeFilter;
    const sizeFilterArr =
      Array.isArray(sizeFilterRaw)
        ? sizeFilterRaw.map(String).filter(Boolean)
        : typeof sizeFilterRaw === 'string'
          ? sizeFilterRaw.split(',').map((x) => x.trim()).filter(Boolean)
          : undefined;
    const sort = (req.query.sort as string) || 'engagement_desc';
    const limitRaw = quantitativosOnly ? 0 : (isPublicOrAnonymous ? PUBLIC_PAGE_SIZE : Math.min(Math.max(0, Number(req.query.limit) || 50), 200));
    const offsetRaw = quantitativosOnly ? 0 : (isPublicOrAnonymous ? 0 : Math.max(0, Number(req.query.offset) || 0));
    const limit = quantitativosOnly ? 0 : (isPublicOrAnonymous ? PUBLIC_PAGE_SIZE : limitRaw);
    const offset = quantitativosOnly ? 0 : (isPublicOrAnonymous ? 0 : offsetRaw);

    const query: ProfilesSearchQuery = {
      q: q || undefined,
      minFollowers: Number.isFinite(minFollowers) ? minFollowers : undefined,
      maxFollowers: Number.isFinite(maxFollowers) ? maxFollowers : undefined,
      minEngagementRate: Number.isFinite(minEngagementRate) ? minEngagementRate : undefined,
      minAvgLikes: Number.isFinite(minAvgLikes) ? minAvgLikes : undefined,
      minPostsCount: Number.isFinite(minPostsCount) ? minPostsCount : undefined,
      engagementRateBuckets: Array.isArray(engagementRateBuckets) ? engagementRateBuckets.map(Number).filter(Number.isFinite) : typeof engagementRateBuckets === 'string' ? engagementRateBuckets.split(',').map((x) => Number(x.trim())).filter(Number.isFinite) : undefined,
      avgLikesBuckets: Array.isArray(avgLikesBuckets) ? avgLikesBuckets.map(Number).filter(Number.isFinite) : typeof avgLikesBuckets === 'string' ? avgLikesBuckets.split(',').map((x) => Number(x.trim())).filter(Number.isFinite) : undefined,
      postsCountBuckets: Array.isArray(postsCountBuckets) ? postsCountBuckets.map(Number).filter(Number.isFinite) : typeof postsCountBuckets === 'string' ? postsCountBuckets.split(',').map((x) => Number(x.trim())).filter(Number.isFinite) : undefined,
      activationFilter: Array.isArray(activationFilter) ? activationFilter.map(String).filter(Boolean) : typeof activationFilter === 'string' ? activationFilter.split(',').map((x) => x.trim()).filter(Boolean) : undefined,
      cities: Array.isArray(cities) ? cities.map(String).filter(Boolean) : typeof cities === 'string' ? cities.split(',').map((x) => x.trim()).filter(Boolean) : undefined,
      states: Array.isArray(states) ? states.map(String).filter(Boolean) : typeof states === 'string' ? states.split(',').map((x) => x.trim()).filter(Boolean) : undefined,
      neighborhoods: Array.isArray(neighborhoods) ? neighborhoods.map(String).filter(Boolean) : typeof neighborhoods === 'string' ? neighborhoods.split(',').map((x) => x.trim()).filter(Boolean) : undefined,
      socialNetworks: Array.isArray(socialNetworks) ? socialNetworks.map(String).filter(Boolean) : typeof socialNetworks === 'string' ? socialNetworks.split(',').map((x) => x.trim()).filter(Boolean) : undefined,
      excludePrivate,
      accountTypeFilter: parseNumList(accountTypeFilter)?.filter((n) => [1, 2, 3].includes(n)),
      categories,
      contentTypes: Array.isArray(contentTypes) ? contentTypes.map(String).filter(Boolean) : typeof contentTypes === 'string' ? contentTypes?.split(',').map((x) => x.trim()).filter(Boolean) : undefined,
      pricingFeed: parseNumList(req.query.pricingFeed),
      pricingReels: parseNumList(req.query.pricingReels),
      pricingStory: parseNumList(req.query.pricingStory),
      pricingDestaque: parseNumList(req.query.pricingDestaque),
      costTierFilter: parseCostTierFilter(req.query.costTierFilter),
      sizeFilter: sizeFilterArr?.length ? sizeFilterArr : undefined,
      llmProfileType: optStrList(req.query.llmProfileType),
      llmMainCategory: optStrList(req.query.llmMainCategory),
      llmGender: optStrList(req.query.llmGender),
      llmLanguage: optStrList(req.query.llmLanguage),
      llmAudienceType: optStrList(req.query.llmAudienceType),
      llmToneOfVoice: optStrList(req.query.llmToneOfVoice),
      llmRiskLevel: optStrList(req.query.llmRiskLevel),
      ...(llmIsFamilySafe !== undefined ? { llmIsFamilySafe } : {}),
      ...(llmIsAdultContent !== undefined ? { llmIsAdultContent } : {}),
      sort,
      limit,
      offset,
      includeFacets: req.query.includeFacets === 'false' ? false : true,
    };
    let restrictToHandles: string[] | undefined;
    let queryForSearch = query;
    const canSearchWithoutCampaign =
      quantitativosOnly ||
      (req.user && (req.user.scope === 'adm' || req.user.scope === 'assinante' || req.user.scope === 'influencer'));
    if (!quantitativosOnly && req.user) {
      const raw = (req.headers[X_CAMPAIGN_ID] ?? req.headers['x-campaign-id']) as string | undefined;
      const campaignId = typeof raw === 'string' ? raw.trim() : '';
      if (!campaignId || !isCampaignIdGuid(campaignId)) {
        if (limit === 0 || canSearchWithoutCampaign) {
          restrictToHandles = undefined;
          queryForSearch = limit === 0 ? { ...query, limit: 0, offset: 0 } : query;
        } else {
          res.status(403).json({
            error: 'Para buscar perfis, envie o header X-Campaign-Id com o ID de uma campanha.',
            code: 'CAMPAIGN_ID_REQUIRED',
          });
          return;
        }
      } else {
        const userId = Number(req.user.sub);
        const handles = creditsCampaignsDb.getCampaignHandlesIfActive(campaignId, userId);
        if (!handles || handles.length === 0) {
          res.status(403).json({ error: 'Campanha não encontrada, expirada ou sem perfis.', code: 'CAMPAIGN_NOT_FOUND' });
          return;
        }
        restrictToHandles = handles;
      }
    }
    const result = await searchProfiles(db, queryForSearch, {
      ...(restrictToHandles?.length ? { restrictToHandles } : {}),
      /** Só total + facets na resposta: ordenação e BI da fatia são custo puro O(n log n) / I/O. */
      skipSort: true,
      skipInstagramBi: true,
    });
    // Segurança: nunca retorne `items` (lista de perfis) neste endpoint.
    // Este endpoint serve apenas agregações (`total` + `facets`) para qualquer usuário.
    res.json(publicSearchPayload(result as unknown as { total: number; facets: Record<string, unknown> }));
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Preview de perfis para dashboard: 10 mais atuais com metadados LLM resumidos. */
app.post('/api/profiles/preview', rateLimitDataApi, async (req: RequestWithAuth, res: Response) => {
  try {
    const body = (req.body ?? {}) as { query?: ProfilesSearchQuery; limit?: number };
    const query = (body.query ?? {}) as ProfilesSearchQuery;
    const limitRaw = Number(body.limit);
    const limit = Number.isFinite(limitRaw) ? Math.min(50, Math.max(1, Math.floor(limitRaw))) : 10;
    const searchQuery: ProfilesSearchQuery = {
      ...query,
      sort: 'relevance_desc',
      limit: Math.max(100, limit),
      offset: 0,
      includeFacets: false,
    };
    const result = await searchProfiles(db, searchQuery);
    const recent = [...result.items].sort(collectedAtDesc);
    const mixed = pickMixedRecentPreviewItems(recent, limit);
    const items = mixed.map((it, index) => buildProfilePreviewItem(it, index));
    res.json({ total: result.total, items });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Créditos do usuário autenticado. */
app.get('/api/me/credits', async (req: RequestWithAuth, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Login necessário' });
      return;
    }
    const userId = Number(req.user.sub);
    const balance = creditsCampaignsDb.getBalance(userId);
    res.json({ balance });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Preço por crédito em centavos (ex.: 100 = R$ 1,00). */
const CREDITS_PRICE_CENTS = Math.max(1, Number(process.env.CREDITS_PRICE_CENTS) || 100);
/** Dias entre a criação da assinatura e o vencimento da 1ª cobrança (trial; 0 = sem trial). */
const BUSCA_PLAN_TRIAL_DAYS = Math.min(
  120,
  Math.max(0, Number(process.env.BUSCA_PLAN_TRIAL_DAYS ?? '7') || 7)
);
/** Preço por influenciador ativado no relatório (R$ 2,00). */
const REPORT_PRICE_CENTS_ACTIVATED = 200;
/** Preço por influenciador não ativado no relatório (R$ 1,00). */
const REPORT_PRICE_CENTS_NOT_ACTIVATED = 100;

function addDaysLocalYyyyMmDd(days: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function luhnValid(cardDigits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = cardDigits.length - 1; i >= 0; i--) {
    const ch = cardDigits.charCodeAt(i) - 48;
    if (ch < 0 || ch > 9) return false;
    let n = ch;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function parseCardExpiry(exp: string): { month: string; year: string } | null {
  const s = exp.replace(/\s/g, '');
  const m = /^(\d{2})\/(\d{2,4})$/.exec(s);
  if (!m) return null;
  const monthNum = Number(m[1]);
  if (monthNum < 1 || monthNum > 12) return null;
  const yRaw = m[2];
  const year = yRaw.length === 2 ? `20${yRaw}` : yRaw;
  if (!/^\d{4}$/.test(year)) return null;
  const now = new Date();
  const curYm = now.getFullYear() * 100 + (now.getMonth() + 1);
  const expYm = Number(year) * 100 + monthNum;
  if (expYm < curYm) return null;
  return { month: String(monthNum).padStart(2, '0'), year };
}

function planPaymentInTrialWindow(row: PaymentRow): boolean {
  if (!row.plan_first_due_date || row.status !== 'PENDING') return false;
  const due = row.plan_first_due_date.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return false;
  const today = addDaysLocalYyyyMmDd(0);
  return due >= today;
}

/** Id da assinatura vinculada à cobrança (GET /payments/:id), quando o Asaas expõe o campo. */
function asaasPaymentLinkedSubscriptionId(pay: { subscription?: unknown }): string | null {
  const s = pay.subscription;
  if (typeof s === 'string' && s.trim()) return s.trim();
  if (s && typeof s === 'object' && s !== null && 'id' in s) {
    const id = (s as { id?: unknown }).id;
    if (typeof id === 'string' && id.trim()) return id.trim();
  }
  return null;
}

function paymentRowPlanFields(row: PaymentRow) {
  const dueRaw = row.plan_first_due_date?.trim().slice(0, 10) ?? null;
  const planFirstInvoiceDue = dueRaw && /^\d{4}-\d{2}-\d{2}$/.test(dueRaw) ? dueRaw : null;
  return {
    planId: row.plan_id?.trim() || null,
    planFirstInvoiceDue,
    asaasSubscriptionId: row.asaas_subscription_id?.trim() || null,
  };
}

/** Converte linha payment → corpo igual ao POST /me/payments (modal de PIX/boleto). */
function paymentRowToCreditsChargePayload(row: PaymentRow) {
  const plan = paymentRowPlanFields(row);
  return {
    paymentId: row.id,
    asaasPaymentId: row.asaas_payment_id,
    status: row.status,
    credits: row.credits_granted,
    amountCents: row.amount_cents,
    valueBrl: row.amount_cents / 100,
    billingType: row.billing_type,
    invoiceUrl: row.invoice_url,
    bankSlipUrl: row.bank_slip_url,
    pixCopyPaste: row.pix_copy_paste,
    ...plan,
  };
}

type ResolveAsaasCustomerParams = {
  externalRef: string;
  name: string;
  email: string;
  cpfCnpj?: string;
  /** Fluxo /me/payments: após create sem id, tenta buscar de novo pelo externalRef. */
  retryFindAfterCreate?: boolean;
};

type ResolveAsaasCustomerOk = { ok: true; asaasCustomerId: string };
type ResolveAsaasCustomerErr = {
  ok: false;
  message: string;
  /** Diagnóstico bruto (URLs, payloads, erros Asaas) — útil em suporte. */
  gatewayDetails: Record<string, unknown>;
};
type ResolveAsaasCustomerResult = ResolveAsaasCustomerOk | ResolveAsaasCustomerErr;

/**
 * Busca ou cria cliente Asaas e devolve motivo + corpo de resposta quando falha (para API retornar 502 explicativo).
 */
async function resolveAsaasCustomerId(params: ResolveAsaasCustomerParams): Promise<ResolveAsaasCustomerResult> {
  const { externalRef, name, email, cpfCnpj, retryFindAfterCreate } = params;
  const createPayload: {
    name: string;
    email: string;
    externalReference: string;
    cpfCnpj?: string;
  } = {
    name,
    email,
    externalReference: externalRef,
    ...(cpfCnpj && (cpfCnpj.length === 11 || cpfCnpj.length === 14) ? { cpfCnpj } : {}),
  };
  let findInitial: unknown;
  try {
    const existing = await asaas.findCustomersByExternalReference(externalRef);
    findInitial = existing;
    const first = existing?.data?.[0];
    if (first?.id) return { ok: true, asaasCustomerId: first.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      message: `Falha ao buscar cliente no provedor de pagamentos: ${msg}`,
      gatewayDetails: {
        step: 'findCustomersByExternalReference',
        externalRef,
        error: msg,
        stack: e instanceof Error ? e.stack : undefined,
      },
    };
  }
  let createResult: unknown;
  let findAfter: unknown;
  try {
    const created = await asaas.createCustomer(createPayload);
    createResult = created;
    if (created?.id) return { ok: true, asaasCustomerId: created.id };
    if (retryFindAfterCreate) {
      const again = await asaas.findCustomersByExternalReference(externalRef);
      findAfter = again;
      const a = again?.data?.[0];
      if (a?.id) return { ok: true, asaasCustomerId: a.id };
    }
    return {
      ok: false,
      message:
        'O provedor de pagamentos não devolveu id de cliente após criar (resposta sem id ou listagem inesperada). Confira a configuração da API e a chave.',
      gatewayDetails: {
        step: 'createCustomer',
        externalRef,
        findInitial,
        createPayload,
        createResult,
        findAfter: findAfter ?? null,
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      message: `Falha ao criar cliente no provedor de pagamentos: ${msg}`,
      gatewayDetails: {
        step: 'createCustomer',
        externalRef,
        findInitial,
        createPayload,
        createResult: createResult ?? null,
        error: msg,
        stack: e instanceof Error ? e.stack : undefined,
      },
    };
  }
}

function jsonAsaasCustomerGatewayError(r: ResolveAsaasCustomerErr): { error: string; gatewayDetails: Record<string, unknown> } {
  return { error: r.message, gatewayDetails: r.gatewayDetails };
}

function respondPaymentsUnavailable(res: Response): void {
  const reason = asaas.paymentsUnavailableReason();
  const showDetail =
    reason != null && (process.env.ASAAS_DEBUG === '1' || process.env.NODE_ENV !== 'production');
  const suffix = showDetail ? ` (${reason})` : '';
  res.status(503).json({ error: `Pagamentos temporariamente indisponíveis${suffix}` });
}

/**
 * Status Asaas equivalente a “pago” para liberar crédito/acesso (alinha webhooks PAYMENT_CONFIRMED e PAYMENT_RECEIVED).
 * - Cartão: CONFIRMED = aprovado e capturado; RECEIVED se aparecer.
 * - PIX: RECEIVED (quase sempre); CONFIRMED em alguns fluxos.
 * - Boleto: RECEIVED ou CONFIRMED (ex. compensação D+1).
 * Não liberar: PENDING, AUTHORIZED (cartão ainda não capturado), REFUSED, OVERDUE, etc.
 */
function asaasRemoteStatusIsPaid(status: string | undefined): boolean {
  const u = (status ?? '').trim().toUpperCase();
  return (
    u === 'RECEIVED' ||
    u === 'CONFIRMED' ||
    u === 'DONE' ||
    u === 'RECEIVED_IN_CASH'
  );
}

/** 1ª cobrança da assinatura em estado terminal negativo — não criar usuário no checkout convidado. PENDING (ex.: trial) é aceito). */
function isAsaasPlanFirstPaymentRejected(status: string | undefined): boolean {
  const u = (status ?? '').trim().toUpperCase();
  if (!u) return true;
  const rejected = new Set([
    'REFUSED',
    'FAILED',
    'CANCELLED',
    'DELETED',
    'CHARGEBACK_REQUESTED',
    'CHARGEBACK_DISPUTE',
    'AWAITING_CHARGEBACK_REVERSAL',
  ]);
  return rejected.has(u);
}

/** Evita liberar crédito se `asaas_payment_id` apontar para outra cobrança (ex. listagem errada no POST). */
function asaasRemotePaymentMatchesPendingRow(
  remote: { billingType?: string; value?: number },
  row: PaymentRow
): boolean {
  const rBt = (remote.billingType ?? '').trim().toUpperCase();
  const localBt = (row.billing_type ?? '').trim().toUpperCase();
  if (rBt && localBt && rBt !== localBt) {
    console.warn(
      `[payments] Ignorando confirmação: Asaas billingType=${rBt} ≠ registro local ${localBt} (asaas_id=${row.asaas_payment_id})`
    );
    return false;
  }
  const v = remote.value;
  if (typeof v === 'number' && Number.isFinite(v)) {
    const wantBrl = row.amount_cents / 100;
    if (Math.abs(v - wantBrl) > 0.009) {
      console.warn(
        `[payments] Ignorando confirmação: Asaas value=${v} ≠ registro R$ ${wantBrl} (asaas_id=${row.asaas_payment_id})`
      );
      return false;
    }
  }
  return true;
}

/**
 * Marca pagamento como confirmado e aplica créditos / campanha (mesma regra do webhook).
 * Só deve ser chamado quando `row.status === 'PENDING'`.
 */
async function finalizePendingPaymentRow(row: PaymentRow): Promise<void> {
  const asaasId = row.asaas_payment_id?.trim();
  if (!asaasId) return;
  const fresh = paymentsDb.confirmPendingByAsaasIdIfStillPending(asaasId);
  if (!fresh) return;
  const reportCount = fresh.report_desired_count;
  const reportQueryStr = fresh.report_query;
  const existingCampaignId = (fresh as PaymentRow & { campaign_id?: string | null }).campaign_id;
  if (reportCount != null && reportCount > 0 && reportQueryStr && !existingCampaignId) {
    try {
      await createReportCampaignFromQuery(
        JSON.parse(reportQueryStr) as ProfilesSearchQuery,
        reportCount,
        fresh.user_id
      );
    } catch (e) {
      console.error('[payments] finalize report campaign create', e);
    }
  } else if (existingCampaignId && reportCount != null && reportCount > 0) {
    try {
      creditsCampaignsDb.setCampaignQuantity(existingCampaignId, fresh.user_id, reportCount);
      creditsCampaignsDb.setCampaignPaymentStatus(existingCampaignId, fresh.user_id, 'paid');
    } catch (e) {
      console.error('[payments] finalize trim campaign', e);
    }
  } else if (existingCampaignId) {
    try {
      creditsCampaignsDb.setCampaignPaymentStatus(existingCampaignId, fresh.user_id, 'paid');
    } catch (e) {
      console.error('[payments] finalize set campaign paid', e);
    }
  } else if (!reportQueryStr || reportCount == null || reportCount <= 0) {
    creditsCampaignsDb.addCredits(fresh.user_id, fresh.credits_granted, 'payment', fresh.id);
  }
}

/**
 * Sem webhook: ao consultar pendência, pergunta ao Asaas se a cobrança já foi paga e atualiza o SQLite.
 */
async function syncPendingPaymentFromAsaasIfConfigured(row: PaymentRow): Promise<void> {
  if (row.status !== 'PENDING') return;
  const asaasId = row.asaas_payment_id?.trim();
  if (!asaasId || !asaas.isAsaasConfigured()) return;
  try {
    const remote = await asaas.getPayment(asaasId);
    if (
      asaasRemotePaymentMatchesPendingRow(remote, row) &&
      asaasRemoteStatusIsPaid(remote?.status)
    ) {
      await finalizePendingPaymentRow(row);
    }
  } catch (e) {
    console.warn('[payments] Asaas getPayment (sync pendente):', e instanceof Error ? e.message : e);
  }
}

/** Lista pagamentos do usuário (comprar créditos). */
app.get('/api/me/payments', async (req: RequestWithAuth, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Login necessário' });
      return;
    }
    const userId = Number(req.user.sub);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const rows = paymentsDb.listByUser(userId, limit, offset);
    const payments = rows.map((r) => ({
      id: r.id,
      asaasPaymentId: r.asaas_payment_id,
      amountCents: r.amount_cents,
      creditsGranted: r.credits_granted,
      status: r.status,
      billingType: r.billing_type,
      invoiceUrl: r.invoice_url,
      bankSlipUrl: r.bank_slip_url,
      pixCopyPaste: r.pix_copy_paste,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      ...paymentRowPlanFields(r),
    }));
    res.json({ payments });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Cobrança pendente única do usuário (para reabrir PIX/boleto no modal). Deve vir antes de /:id. */
app.get('/api/me/payments/pending', async (req: RequestWithAuth, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Login necessário' });
      return;
    }
    const userId = Number(req.user.sub);
    let row = paymentsDb.getFirstPendingForUser(userId);
    if (row) {
      await syncPendingPaymentFromAsaasIfConfigured(row);
      row = paymentsDb.getFirstPendingForUser(userId);
    }
    if (!row) {
      res.json({ payment: null });
      return;
    }
    res.json({ payment: paymentRowToCreditsChargePayload(row) });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Status da assinatura de plano (acesso ao app para assinantes). */
app.get('/api/me/subscription', async (req: RequestWithAuth, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Login necessário' });
      return;
    }
    const userId = Number(req.user.sub);
    const pending = paymentsDb.getFirstPendingForUser(userId);
    if (pending?.plan_id) {
      await syncPendingPaymentFromAsaasIfConfigured(pending);
    }
    const active = paymentsDb.hasActivePlanSubscription(userId);
    const latest = paymentsDb.getLatestPlanPayment(userId);
    const pendingAfter = paymentsDb.getFirstPendingForUser(userId);
    const inTrial = Boolean(
      active && latest && latest.status === 'PENDING' && planPaymentInTrialWindow(latest)
    );
    res.json({
      active,
      planId: latest?.plan_id ?? null,
      subscriptionId: latest?.asaas_subscription_id ?? null,
      hasPendingPlanPayment: Boolean(pendingAfter?.plan_id),
      inTrial,
      planFirstInvoiceDue:
        inTrial && latest?.plan_first_due_date
          ? latest.plan_first_due_date.trim().slice(0, 10)
          : null,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Detalhe de um pagamento do usuário. */
app.get('/api/me/payments/:id', async (req: RequestWithAuth, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Login necessário' });
      return;
    }
    const userId = Number(req.user.sub);
    const id = String(req.params.id ?? '').trim();
    let row = paymentsDb.getById(id, userId);
    if (!row) {
      res.status(404).json({ error: 'Pagamento não encontrado' });
      return;
    }
    if (row.status === 'PENDING') {
      await syncPendingPaymentFromAsaasIfConfigured(row);
      row = paymentsDb.getById(id, userId);
      if (!row) {
        res.status(404).json({ error: 'Pagamento não encontrado' });
        return;
      }
    }
    res.json({
      id: row.id,
      asaasPaymentId: row.asaas_payment_id,
      amountCents: row.amount_cents,
      creditsGranted: row.credits_granted,
      status: row.status,
      billingType: row.billing_type,
      invoiceUrl: row.invoice_url,
      bankSlipUrl: row.bank_slip_url,
      pixCopyPaste: row.pix_copy_paste,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...paymentRowPlanFields(row),
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Remove cobrança pendente (cancela no Asaas quando aplicável e apaga o registro local). */
app.delete('/api/me/payments/:id', async (req: RequestWithAuth, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Login necessário' });
      return;
    }
    const userId = Number(req.user.sub);
    const id = String(req.params.id ?? '').trim();
    const row = paymentsDb.getById(id, userId);
    if (!row) {
      res.status(404).json({ error: 'Pagamento não encontrado' });
      return;
    }
    if (row.status !== 'PENDING') {
      res.status(400).json({ error: 'Só é possível remover cobranças pendentes.' });
      return;
    }
    const subId = row.asaas_subscription_id?.trim() || null;
    const asaasId = row.asaas_payment_id?.trim() || null;
    if (asaas.isAsaasConfigured()) {
      if (subId) {
        try {
          await asaas.deleteAsaasSubscription(subId);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          res.status(502).json({
            error: msg || 'Não foi possível cancelar a assinatura no provedor de pagamentos.',
          });
          return;
        }
      }
      if (asaasId) {
        try {
          await asaas.deleteAsaasPayment(asaasId);
        } catch (e) {
          console.warn(
            '[payments] deleteAsaasPayment (parcela já removida com assinatura?):',
            e instanceof Error ? e.message : e
          );
        }
      }
    }
    if (!paymentsDb.deleteByIdForUser(id, userId)) {
      res.status(404).json({ error: 'Pagamento não encontrado' });
      return;
    }
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/**
 * Verifica se já existe usuário com o e-mail (usado no passo 1 do checkout de plano).
 * Evita preencher dados de cartão para depois descobrir duplicidade na assinatura.
 */
app.post('/api/auth/email-registered', (req: Request, res: Response) => {
  try {
    const email = (req.body?.email ?? '').toString().trim().toLowerCase();
    if (!email || !email.includes('@')) {
      res.status(400).json({ error: 'E-mail inválido' });
      return;
    }
    const registered = Boolean(authDb.getByUsername(email));
    res.status(200).json({ registered });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Cadastro público: cria usuário como Assinante (sem pagamento). Validação de e-mail não é obrigatória; retorna token + user (email_verified: true). Body: email, password, name?. */
app.post('/api/auth/register-assinante', async (req: Request, res: Response) => {
  try {
    const body = req.body as { email?: string; password?: string; name?: string };
    const email = (body?.email ?? '').toString().trim().toLowerCase();
    const password = (body?.password ?? '').toString();
    const name = (body?.name ?? '').toString().trim() || null;
    if (!email || !email.includes('@')) {
      res.status(400).json({ error: 'E-mail é obrigatório e deve ser válido' });
      return;
    }
    if (!password || password.length < 6) {
      res.status(400).json({ error: 'A senha deve ter no mínimo 6 caracteres' });
      return;
    }
    if (authDb.getByUsername(email)) {
      res.status(409).json({ error: 'Já existe uma conta com este e-mail. Faça login.' });
      return;
    }
    const passwordHash = hashPassword(password);
    const userId = authDb.createUser(email, passwordHash, 'assinante' as AuthScope, null, name, 0);
    const authUser = authDb.getById(userId);
    if (!authUser) {
      res.status(500).json({ error: 'Erro ao criar conta' });
      return;
    }
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    authDb.setEmailVerification(userId, verificationToken, expiresAt);
    const frontBase = process.env.FRONTEND_BASE_URL || process.env.VITE_APP_URL || 'http://localhost:5173';
    const verifyUrl = `${frontBase.replace(/\/$/, '')}/verify-email?token=${encodeURIComponent(verificationToken)}`;
    const emailResult = await sendVerificationEmail({
      to: email,
      subject: '✨ 5 créditos: valide seu e-mail e comece a usar',
      verifyUrl,
      bodyText: 'Confirme seu e-mail agora e ganhe 5 créditos para gerar seus primeiros relatórios de influenciadores — sem custo.',
    });
    if (!emailResult.sent && emailResult.error) {
      console.warn('[register-assinante] E-mail não enviado:', emailResult.error);
    }
    const secret = getJwtSecret();
    const token = signJwt(
      { sub: String(userId), username: authUser.username, scope: 'assinante' as AuthScope, profile_handle: authUser.profile_handle ?? undefined },
      secret
    );
    res.status(201).json({
      token,
      user: {
        id: authUser.id,
        username: authUser.username,
        scope: authUser.scope,
        profile_handle: authUser.profile_handle,
        email_verified: false,
        display_name: (authUser as { display_name?: string | null }).display_name ?? null,
      },
      email_sent: emailResult.sent,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

const FORGOT_PW_CODE_TTL_MIN = 15;
const FORGOT_PW_JWT_SEC = 15 * 60;
const FORGOT_PW_THROTTLE_SEC = 60;

/** Pedido de código por e-mail (contas assinante). Resposta genérica se o e-mail não existir. */
app.post('/api/auth/forgot-password/request', async (req: Request, res: Response) => {
  try {
    const email = (req.body?.email ?? '').toString().trim().toLowerCase();
    const generic = { ok: true as const };
    if (!email || !email.includes('@')) {
      res.status(200).json(generic);
      return;
    }
    const user = authDb.getByUsername(email);
    if (!user || user.scope !== 'assinante') {
      res.status(200).json(generic);
      return;
    }
    if (authDb.isPasswordResetRecentlyRequested(email, FORGOT_PW_THROTTLE_SEC)) {
      res.status(200).json(generic);
      return;
    }
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + FORGOT_PW_CODE_TTL_MIN * 60 * 1000)
      .toISOString()
      .slice(0, 19)
      .replace('T', ' ');
    authDb.savePasswordResetCode(email, code, expiresAt);
    const emailResult = await sendPasswordResetCode({ to: email, code });
    if (!emailResult.sent && emailResult.error) {
      console.warn('[forgot-password] E-mail não enviado:', emailResult.error);
    }
    res.status(200).json(generic);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Valida o código de 6 dígitos e devolve JWT de uso único para definir a nova senha. */
app.post('/api/auth/forgot-password/verify', async (req: Request, res: Response) => {
  try {
    const email = (req.body?.email ?? '').toString().trim().toLowerCase();
    const code = (req.body?.code ?? '').toString().trim();
    if (!email || !email.includes('@') || !/^\d{6}$/.test(code)) {
      res.status(400).json({ error: 'Informe o e-mail e o código de 6 dígitos.' });
      return;
    }
    if (!authDb.tryConsumePasswordResetCode(email, code)) {
      res.status(400).json({ error: 'Código inválido ou expirado. Solicite um novo código.' });
      return;
    }
    const user = authDb.getByUsername(email);
    if (!user || user.scope !== 'assinante') {
      res.status(400).json({ error: 'Não foi possível concluir a redefinição.' });
      return;
    }
    const secret = getJwtSecret();
    const resetToken = signJwt(
      {
        sub: String(user.id),
        username: user.username,
        scope: 'assinante' as AuthScope,
        profile_handle: user.profile_handle ?? undefined,
        pwd_reset: true,
      },
      secret,
      FORGOT_PW_JWT_SEC,
    );
    res.status(200).json({ resetToken });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Define nova senha com o JWT retornado por /forgot-password/verify. */
app.post('/api/auth/forgot-password/complete', async (req: Request, res: Response) => {
  try {
    const resetToken = (req.body?.resetToken ?? '').toString().trim();
    const password = (req.body?.password ?? '').toString();
    if (!resetToken) {
      res.status(400).json({ error: 'Sessão inválida. Confirme o código novamente.' });
      return;
    }
    if (!password || password.length < 6) {
      res.status(400).json({ error: 'A senha deve ter no mínimo 6 caracteres.' });
      return;
    }
    let payload;
    try {
      payload = verifyJwt(resetToken, getJwtSecret());
    } catch {
      res.status(400).json({ error: 'Sessão expirada. Solicite um novo código por e-mail.' });
      return;
    }
    if (payload.pwd_reset !== true || payload.scope !== 'assinante') {
      res.status(400).json({ error: 'Token inválido para redefinição de senha.' });
      return;
    }
    const userId = Number(payload.sub);
    if (!Number.isFinite(userId) || userId < 1) {
      res.status(400).json({ error: 'Token inválido.' });
      return;
    }
    const user = authDb.getById(userId);
    if (!user || user.scope !== 'assinante') {
      res.status(400).json({ error: 'Usuário não encontrado.' });
      return;
    }
    authDb.updateUser(userId, { password_hash: hashPassword(password) });
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

const MISSION_EMAIL_CREDITS = 5;
const MISSION_INSTAGRAM_CREDITS = 10;

/** Valida e-mail pelo token (link no e-mail). Concede 5 créditos (missão 1) e retorna sucesso para o front exibir confete. */
app.get('/api/auth/verify-email', (req: Request, res: Response) => {
  try {
    const token = (req.query?.token ?? '').toString().trim();
    if (!token) {
      res.status(400).json({ error: 'Token ausente' });
      return;
    }
    console.log('[verify-email] Token recebido, tamanho:', token.length, 'início:', token.slice(0, 8) + '...');

    let userId: number | null = authDb.getUserIdByEmailVerificationToken(token);

    if (!userId && (process.env.ALLOW_DEV_VERIFY_BYPASS === '1' || process.env.NODE_ENV !== 'production') && (token === 'dev-bypass' || token === 'dev')) {
      const users = authDb.listUsers();
      const unverified = users.find((u) => (u as { email_verified?: number }).email_verified === 0);
      if (unverified) {
        userId = unverified.id;
        console.log('[verify-email] Dev bypass: validando usuário id=', userId);
      }
    }

    if (!userId) {
      console.log('[verify-email] Token não encontrado ou expirado no banco.');
      res.status(400).json({ error: 'Link inválido ou expirado. Solicite um novo e-mail de validação.' });
      return;
    }

    const userRow = authDb.getById(userId);
    if (userRow?.email_verified === 1) {
      console.log('[verify-email] Usuário já validado, retornando sucesso (idempotente).');
      res.status(200).json({ success: true, credits: MISSION_EMAIL_CREDITS });
      return;
    }

    authDb.setEmailVerified(userId);
    creditsCampaignsDb.addCredits(userId, MISSION_EMAIL_CREDITS, 'mission_email', undefined);
    console.log('[verify-email] E-mail validado e créditos concedidos, userId=', userId);
    res.status(200).json({ success: true, credits: MISSION_EMAIL_CREDITS });
  } catch (e) {
    console.error('[verify-email] Erro:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Reenvia o e-mail de validação para o usuário logado. */
app.post('/api/auth/resend-verification', authOptional, async (req: RequestWithAuth, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Faça login para reenviar o e-mail.' });
      return;
    }
    const userId = Number(req.user.sub);
    const authUser = authDb.getById(userId);
    if (!authUser) {
      res.status(404).json({ error: 'Usuário não encontrado' });
      return;
    }
    if (authUser.email_verified === 1) {
      res.status(200).json({ ok: true, message: 'E-mail já validado' });
      return;
    }
    const email = authUser.username;
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    authDb.setEmailVerification(userId, verificationToken, expiresAt);
    const frontBase = process.env.FRONTEND_BASE_URL || process.env.VITE_APP_URL || 'http://localhost:5173';
    const verifyUrl = `${frontBase.replace(/\/$/, '')}/verify-email?token=${encodeURIComponent(verificationToken)}`;
    const emailResult = await sendVerificationEmail({
      to: email,
      subject: '✨ 5 créditos: valide seu e-mail e comece a usar',
      verifyUrl,
      bodyText: 'Confirme seu e-mail agora e ganhe 5 créditos para gerar seus primeiros relatórios de influenciadores — sem custo.',
    });
    if (!emailResult.sent && emailResult.error) {
      console.warn('[resend-verification] E-mail não enviado:', emailResult.error);
    }
    res.status(200).json({ ok: true, email_sent: emailResult.sent });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Checkout público: cadastra como Assinante e cria pagamento (PIX/Boleto). Body: email, password, name?, credits, billingType. Retorna token + user + dados do pagamento. */
app.post('/api/checkout/register-and-pay', async (req: Request, res: Response) => {
  try {
    if (!asaas.isAsaasConfigured()) {
      respondPaymentsUnavailable(res);
      return;
    }
    const body = req.body as { email?: string; password?: string; name?: string; credits?: number; billingType?: string; cpfCnpj?: string };
    const email = (body?.email ?? '').toString().trim().toLowerCase();
    const password = (body?.password ?? '').toString();
    const name = (body?.name ?? '').toString().trim() || email;
    const credits = Number(body?.credits);
    const cpfDigits = (body?.cpfCnpj ?? '').toString().replace(/\D/g, '');
    if (cpfDigits.length !== 11 && cpfDigits.length !== 14) {
      res.status(400).json({ error: 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.' });
      return;
    }
    if (!email || !email.includes('@')) {
      res.status(400).json({ error: 'E-mail é obrigatório e deve ser válido' });
      return;
    }
    if (!password || password.length < 6) {
      res.status(400).json({ error: 'A senha deve ter no mínimo 6 caracteres' });
      return;
    }
    if (!Number.isFinite(credits) || credits < 1 || credits > 10000) {
      res.status(400).json({ error: 'Envie credits (1 a 10000)' });
      return;
    }
    const billingType = (body?.billingType ?? 'PIX').toUpperCase() === 'BOLETO' ? 'BOLETO' : 'PIX';

    const existing = authDb.getByUsername(email);
    if (existing) {
      res.status(409).json({ error: 'Já existe uma conta com este e-mail. Faça login e compre em Meus pagamentos.' });
      return;
    }

    const passwordHash = hashPassword(password);
    const userId = authDb.createUser(email, passwordHash, 'assinante' as AuthScope, null, undefined, 0);
    const authUser = authDb.getById(userId);
    if (!authUser) {
      res.status(500).json({ error: 'Erro ao criar conta' });
      return;
    }
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    authDb.setEmailVerification(userId, verificationToken, expiresAt);
    const frontBase = process.env.FRONTEND_BASE_URL || process.env.VITE_APP_URL || 'http://localhost:5173';
    const verifyUrl = `${frontBase.replace(/\/$/, '')}/verify-email?token=${encodeURIComponent(verificationToken)}`;
    const emailResult = await sendVerificationEmail({
      to: email,
      subject: '✨ 5 créditos: valide seu e-mail e comece a usar',
      verifyUrl,
      bodyText: 'Confirme seu e-mail agora e ganhe 5 créditos para gerar seus primeiros relatórios de influenciadores — sem custo.',
    });
    if (!emailResult.sent && emailResult.error) {
      console.warn('[register-and-pay] E-mail não enviado:', emailResult.error);
    }

    const amountCents = credits * CREDITS_PRICE_CENTS;
    const valueBrl = amountCents / 100;
    const displayName = name || email;
    const externalRef = `user_${userId}`;

    const customerRes = await resolveAsaasCustomerId({
      externalRef,
      name: displayName,
      email,
      cpfCnpj: cpfDigits,
      retryFindAfterCreate: true,
    });
    if (!customerRes.ok) {
      res.status(502).json(jsonAsaasCustomerGatewayError(customerRes));
      return;
    }
    const asaasCustomerId = customerRes.asaasCustomerId;
    try {
      await asaas.updateCustomer(asaasCustomerId, { name: displayName, cpfCnpj: cpfDigits });
    } catch (updateErr) {
      console.warn('[register-and-pay] Asaas updateCustomer:', updateErr);
    }
    try {
      authDb.setBillingCpfCnpj(userId, cpfDigits);
    } catch (saveDocErr) {
      console.warn('[register-and-pay] setBillingCpfCnpj:', saveDocErr);
    }

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + (billingType === 'BOLETO' ? 3 : 1));
    const dueStr = dueDate.toISOString().slice(0, 10);

    const paymentPayload = {
      customer: asaasCustomerId,
      value: valueBrl,
      dueDate: dueStr,
      billingType: billingType as 'PIX' | 'BOLETO',
      description: `${credits} créditos - Influencer`,
      externalReference: `credits_${userId}_${Date.now()}`,
    };
    const asaasPayment = await asaas.createPayment(paymentPayload);
    const asaasPaymentId = asaasPayment?.id ?? null;
    const invoiceUrl = asaasPayment?.invoiceUrl ?? null;
    const bankSlipUrl = asaasPayment?.bankSlipUrl ?? null;
    const pixCopyPaste = await asaas.resolvePixCopyPasteAfterCreate(
      billingType as 'PIX' | 'BOLETO',
      asaasPaymentId,
      asaasPayment
    );

    const paymentId = paymentsDb.createPayment({
      userId,
      asaasPaymentId,
      asaasCustomerId,
      amountCents,
      creditsGranted: credits,
      status: 'PENDING',
      billingType: billingType as 'PIX' | 'BOLETO',
      invoiceUrl,
      bankSlipUrl,
      pixCopyPaste,
    });

    const secret = getJwtSecret();
    const token = signJwt(
      { sub: String(userId), username: authUser.username, scope: 'assinante' as AuthScope, profile_handle: authUser.profile_handle ?? undefined },
      secret
    );

    res.status(201).json({
      token,
      user: {
        id: authUser.id,
        username: authUser.username,
        scope: authUser.scope,
        profile_handle: authUser.profile_handle,
        email_verified: false,
      },
      email_sent: emailResult.sent,
      paymentId,
      asaasPaymentId,
      status: 'PENDING',
      credits,
      amountCents,
      valueBrl,
      billingType,
      invoiceUrl,
      bankSlipUrl,
      pixCopyPaste,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/**
 * Checkout de plano: assinatura Asaas (cartão).
 * - Com JWT: fluxo do usuário já logado.
 * - Sem JWT: envie `email`, `password` e `name`. A conta local só é criada após o Asaas aceitar o cartão
 *   (ou período de teste com 1ª cobrança pendente — não é recusa).
 */
app.post('/api/checkout/plan-subscribe', async (req: RequestWithAuth, res: Response) => {
  try {
    if (!asaas.isAsaasConfigured()) {
      respondPaymentsUnavailable(res);
      return;
    }
    const body = req.body as {
      planId?: string;
      cpfCnpj?: string;
      cardHolderName?: string;
      cardNumber?: string;
      cardExpiry?: string;
      cardCcv?: string;
      postalCode?: string;
      addressNumber?: string;
      email?: string;
      password?: string;
      name?: string;
      /** DDD + número (10 ou 11 dígitos) — obrigatório no Asaas em creditCardHolderInfo.phone */
      holderPhone?: string;
    };
    const planId = (body?.planId ?? '').toString().trim();
    const plan = getBuscaPlanById(planId);
    if (!plan) {
      res.status(400).json({ error: 'Plano inválido' });
      return;
    }
    const cpfDigits = (body?.cpfCnpj ?? '').toString().replace(/\D/g, '');
    if (cpfDigits.length !== 11 && cpfDigits.length !== 14) {
      res.status(400).json({ error: 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.' });
      return;
    }

    const cardHolderName = (body?.cardHolderName ?? '').toString().trim();
    const cardDigits = (body?.cardNumber ?? '').toString().replace(/\D/g, '');
    const cardExpiryRaw = (body?.cardExpiry ?? '').toString().trim();
    const ccv = (body?.cardCcv ?? '').toString().replace(/\D/g, '');
    /** Asaas exige CEP e número no titular; o formulário não coleta — placeholders genéricos. */
    let postalCodeDigits = (body?.postalCode ?? '').toString().replace(/\D/g, '');
    let holderAddressNumber = (body?.addressNumber ?? '').toString().trim();
    if (postalCodeDigits.length !== 8) {
      postalCodeDigits = '01001000';
    }
    if (!holderAddressNumber) {
      holderAddressNumber = 'S/N';
    }

    if (!cardHolderName || cardHolderName.length < 3) {
      res.status(400).json({ error: 'Informe o nome impresso no cartão.' });
      return;
    }
    if (cardDigits.length < 13 || cardDigits.length > 19 || !luhnValid(cardDigits)) {
      res.status(400).json({ error: 'Número do cartão inválido.' });
      return;
    }
    const exp = parseCardExpiry(cardExpiryRaw);
    if (!exp) {
      res.status(400).json({ error: 'Validade inválida. Use MM/AA ou MM/AAAA.' });
      return;
    }
    if (ccv.length < 3 || ccv.length > 4) {
      res.status(400).json({ error: 'CVV inválido.' });
      return;
    }

    const holderPhoneDigits = (body?.holderPhone ?? '').toString().replace(/\D/g, '');
    if (holderPhoneDigits.length !== 10 && holderPhoneDigits.length !== 11) {
      res.status(400).json({
        error: 'Informe o telefone do titular com DDD (10 ou 11 dígitos, sem código do país).',
      });
      return;
    }

    let userId!: number;
    let displayName: string;
    let email: string;
    let externalRef: string;
    /** Cadastro convidado: preenchido só após o gateway aceitar; senha em memória até createUser. */
    let guestPasswordPlain: string | undefined;
    let guestNameTrim: string | undefined;

    if (req.user) {
      userId = Number(req.user.sub);
      const authRow = authDb.getById(userId);
      if (!authRow) {
        res.status(401).json({ error: 'Usuário não encontrado' });
        return;
      }
      displayName =
        authRow.profile_handle != null && String(authRow.profile_handle).trim() !== ''
          ? `@${authRow.profile_handle}`
          : authRow.username;
      email = authRow.username.includes('@') ? authRow.username : `user${userId}@payments.influencer.local`;
      externalRef = `user_${userId}`;
    } else {
      const emailTrim = (body?.email ?? '').toString().trim().toLowerCase();
      const password = (body?.password ?? '').toString();
      const nameTrim = (body?.name ?? '').toString().trim();
      if (!emailTrim || !emailTrim.includes('@')) {
        res.status(400).json({ error: 'E-mail é obrigatório e deve ser válido' });
        return;
      }
      if (!password || password.length < 6) {
        res.status(400).json({ error: 'A senha deve ter no mínimo 6 caracteres' });
        return;
      }
      if (!nameTrim || nameTrim.length < 2) {
        res.status(400).json({ error: 'Informe seu nome ou marca (mín. 2 caracteres).' });
        return;
      }
      if (authDb.getByUsername(emailTrim)) {
        res.status(409).json({
          error: 'Já existe uma conta com este e-mail. Use a opção de login no checkout.',
        });
        return;
      }
      guestPasswordPlain = password;
      guestNameTrim = nameTrim;
      displayName = nameTrim;
      email = emailTrim;
      externalRef = `plan_pre_${crypto.randomUUID().replace(/-/g, '')}`;
    }

    if (req.user) {
      const pendingExisting = paymentsDb.getFirstPendingForUser(userId);
      if (pendingExisting) {
        res.status(409).json({
          error: 'Já existe uma cobrança pendente. Conclua ou cancele em Meus pagamentos antes de assinar.',
          payment: paymentRowToCreditsChargePayload(pendingExisting),
        });
        return;
      }
    }

    const customerRes = await resolveAsaasCustomerId({
      externalRef,
      name: displayName,
      email,
      cpfCnpj: cpfDigits,
      retryFindAfterCreate: true,
    });
    if (!customerRes.ok) {
      res.status(502).json(jsonAsaasCustomerGatewayError(customerRes));
      return;
    }
    const asaasCustomerId = customerRes.asaasCustomerId;
    try {
      await asaas.updateCustomer(asaasCustomerId, { name: displayName, cpfCnpj: cpfDigits });
    } catch (updateErr) {
      console.warn('[plan-subscribe] Asaas updateCustomer:', updateErr);
    }
    if (req.user) {
      try {
        authDb.setBillingCpfCnpj(userId, cpfDigits);
      } catch (saveDocErr) {
        console.warn('[plan-subscribe] setBillingCpfCnpj:', saveDocErr);
      }
    }

    const nextDueStr = addDaysLocalYyyyMmDd(BUSCA_PLAN_TRIAL_DAYS);
    const credits = plan.credits;
    const valueBrl = plan.priceBrl;
    const amountCents = credits * CREDITS_PRICE_CENTS;

    const subscriptionExtRef = req.user
      ? `plan_${planId}_user_${userId}_${Date.now()}`
      : `plan_${planId}_guest_${crypto.randomUUID().replace(/-/g, '')}_${Date.now()}`;

    const subscription = await asaas.createSubscription({
      customer: asaasCustomerId,
      billingType: 'CREDIT_CARD',
      value: valueBrl,
      nextDueDate: nextDueStr,
      cycle: 'MONTHLY',
      description: `${plan.name} - Busca Influencer (mensal)`,
      externalReference: subscriptionExtRef,
      creditCard: {
        holderName: cardHolderName,
        number: cardDigits,
        expiryMonth: exp.month,
        expiryYear: exp.year,
        ccv,
      },
      creditCardHolderInfo: {
        name: displayName,
        email,
        cpfCnpj: cpfDigits,
        postalCode: postalCodeDigits,
        addressNumber: holderAddressNumber,
        phone: holderPhoneDigits,
        ...(holderPhoneDigits.length === 11 ? { mobilePhone: holderPhoneDigits } : {}),
      },
    });
    const subscriptionId = subscription?.id ?? null;
    if (!subscriptionId) {
      res.status(502).json({ error: 'Assinatura criada no gateway sem identificador. Tente em Meus pagamentos.' });
      return;
    }

    const asaasPayment = await asaas.waitForSubscriptionFirstPayment(subscriptionId);
    const asaasPaymentId = asaasPayment?.id ?? null;
    const invoiceUrl = asaasPayment?.invoiceUrl ?? null;
    const bankSlipUrl = asaasPayment?.bankSlipUrl ?? null;
    const remoteStatus = (asaasPayment?.status ?? 'PENDING').toUpperCase();

    let subscriptionIdToStore = subscriptionId;
    if (asaasPaymentId && asaas.isAsaasConfigured()) {
      try {
        const payDetail = await asaas.getPayment(asaasPaymentId);
        const linkedSub = asaasPaymentLinkedSubscriptionId(payDetail);
        if (linkedSub && linkedSub !== subscriptionId) {
          console.warn(
            '[plan-subscribe] Cobrança vincula assinatura',
            linkedSub,
            'POST /subscriptions retornou',
            subscriptionId
          );
          subscriptionIdToStore = linkedSub;
        }
      } catch (e) {
        console.warn('[plan-subscribe] getPayment pós-assinatura:', e instanceof Error ? e.message : e);
      }
      try {
        const subRow = await asaas.getSubscription(subscriptionIdToStore);
        if (!subRow?.id) {
          console.warn('[plan-subscribe] GET /subscriptions/:id sem id — confira ambiente Asaas');
        }
      } catch (e) {
        console.warn('[plan-subscribe] getSubscription:', e instanceof Error ? e.message : e);
      }
    }

    if (!asaasPaymentId) {
      res.status(502).json({
        error: 'Não foi possível confirmar a cobrança no gateway. Tente novamente em instantes ou em Meus pagamentos.',
      });
      return;
    }
    if (isAsaasPlanFirstPaymentRejected(remoteStatus)) {
      res.status(402).json({
        error: 'Cartão recusado ou cobrança não autorizada. Confira os dados do cartão ou use outro cartão.',
      });
      return;
    }

    if (!req.user) {
      const passwordHash = hashPassword(guestPasswordPlain!);
      userId = authDb.createUser(
        email,
        passwordHash,
        'assinante' as AuthScope,
        null,
        guestNameTrim,
        0
      );
      const created = authDb.getById(userId);
      if (!created) {
        res.status(500).json({ error: 'Erro ao criar conta após confirmação do pagamento' });
        return;
      }
      const verificationToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
      authDb.setEmailVerification(userId, verificationToken, expiresAt);
      const frontBase = process.env.FRONTEND_BASE_URL || process.env.VITE_APP_URL || 'http://localhost:5173';
      const verifyUrl = `${frontBase.replace(/\/$/, '')}/verify-email?token=${encodeURIComponent(verificationToken)}`;
      void sendVerificationEmail({
        to: email,
        subject: '✨ 5 créditos: valide seu e-mail e comece a usar',
        verifyUrl,
        bodyText: 'Confirme seu e-mail agora e ganhe 5 créditos para gerar seus primeiros relatórios de influenciadores — sem custo.',
      }).catch(() => {});
      try {
        authDb.setBillingCpfCnpj(userId, cpfDigits);
      } catch (saveDocErr) {
        console.warn('[plan-subscribe] setBillingCpfCnpj (guest):', saveDocErr);
      }
    }

    const localStatus =
      remoteStatus === 'RECEIVED' || remoteStatus === 'CONFIRMED' || remoteStatus === 'RECEIVED_IN_CASH'
        ? 'CONFIRMED'
        : 'PENDING';

    const paymentId = paymentsDb.createPayment({
      userId,
      asaasPaymentId,
      asaasCustomerId,
      amountCents,
      creditsGranted: credits,
      status: localStatus,
      billingType: 'CREDIT_CARD',
      invoiceUrl,
      bankSlipUrl,
      pixCopyPaste: null,
      planId,
      asaasSubscriptionId: subscriptionIdToStore,
      planFirstDueDate: nextDueStr,
    });

    if (localStatus === 'CONFIRMED' && asaasPaymentId) {
      const row = paymentsDb.getByAsaasPaymentId(asaasPaymentId);
      if (row) {
        await finalizePendingPaymentRow(row);
      }
    }

    const authRowFinal = authDb.getById(userId);
    const tokenGuest =
      !req.user && authRowFinal
        ? signJwt(
            {
              sub: String(userId),
              username: authRowFinal.username,
              scope: 'assinante' as AuthScope,
              profile_handle: authRowFinal.profile_handle ?? undefined,
            },
            getJwtSecret()
          )
        : undefined;

    res.status(201).json({
      subscriptionId: subscriptionIdToStore,
      paymentId,
      asaasPaymentId,
      status: localStatus,
      credits,
      amountCents,
      valueBrl,
      billingType: 'CREDIT_CARD',
      invoiceUrl,
      bankSlipUrl,
      pixCopyPaste: null,
      planId,
      planFirstInvoiceDue: nextDueStr,
      ...(tokenGuest && authRowFinal
        ? {
            token: tokenGuest,
            user: {
              id: authRowFinal.id,
              username: authRowFinal.username,
              scope: authRowFinal.scope,
              profile_handle: authRowFinal.profile_handle,
              email_verified: authRowFinal.email_verified === 1 ? true : false,
            },
          }
        : {}),
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Obtém handles do relatório pela query e calcula o valor (R$2 ativados, R$1 não ativados). */
async function getReportHandlesAndPrice(
  query: ProfilesSearchQuery,
  reportCount: number
): Promise<{ handles: string[]; amountCents: number; activatedCount: number; notActivatedCount: number }> {
  const allHandles: string[] = [];
  const pageSize = 100;
  let offset = 0;
  for (; ;) {
    if (allHandles.length >= reportCount) break;
    const q: ProfilesSearchQuery = { ...query, limit: pageSize, offset };
    const result = await searchProfiles(db, q);
    for (const item of result.items) {
      if (item.handle) {
        allHandles.push(item.handle);
        if (allHandles.length >= reportCount) break;
      }
    }
    if (result.items.length < pageSize) break;
    offset += pageSize;
    if (offset >= result.total) break;
  }
  const finalHandles = allHandles.slice(0, reportCount);
  if (finalHandles.length === 0) return { handles: [], amountCents: 0, activatedCount: 0, notActivatedCount: 0 };
  const activations = db.getActivationsBatch(finalHandles);
  let activatedCount = 0;
  for (const h of finalHandles) {
    const act = activations.get(h.toLowerCase().replace(/^@/, ''));
    if (act?.city && String(act.city).trim()) activatedCount++;
  }
  const notActivatedCount = finalHandles.length - activatedCount;
  const amountCents = activatedCount * REPORT_PRICE_CENTS_ACTIVATED + notActivatedCount * REPORT_PRICE_CENTS_NOT_ACTIVATED;
  return { handles: finalHandles, amountCents, activatedCount, notActivatedCount };
}

function normalizeReportHandleKey(h: string): string {
  return String(h).toLowerCase().replace(/^@/, '').trim();
}

/** Preço do relatório descontando perfis que o usuário já possui em outras campanhas pagas. */
function sumReportPriceWithOwnershipDedup(
  items: ProfileListItem[],
  ownedElsewhere: ReadonlySet<string>
): {
  amountCents: number;
  originalAmountCents: number;
  alreadyOwnedCount: number;
  chargedActivatedCount: number;
  chargedNotActivatedCount: number;
  totalActivatedCount: number;
} {
  let amountCents = 0;
  let originalAmountCents = 0;
  let alreadyOwnedCount = 0;
  let chargedActivatedCount = 0;
  let chargedNotActivatedCount = 0;
  let totalActivatedCount = 0;
  for (const item of items) {
    const key = normalizeReportHandleKey(String((item as ProfileListItem).handle ?? ''));
    if (!key) continue;
    const act = (item as ProfileListItem).activation;
    const isActivated = Boolean(act?.city && String(act.city).trim());
    if (isActivated) totalActivatedCount++;
    const tierCents = isActivated ? REPORT_PRICE_CENTS_ACTIVATED : REPORT_PRICE_CENTS_NOT_ACTIVATED;
    originalAmountCents += tierCents;
    if (ownedElsewhere.has(key)) {
      alreadyOwnedCount++;
      continue;
    }
    amountCents += tierCents;
    if (isActivated) chargedActivatedCount++;
    else chargedNotActivatedCount++;
  }
  return {
    amountCents,
    originalAmountCents,
    alreadyOwnedCount,
    chargedActivatedCount,
    chargedNotActivatedCount,
    totalActivatedCount,
  };
}

/** Créditos a debitar = perfis no prefixo da lista que ainda não estão em outro relatório pago. */
function countBillableCreditsForHandlePrefix(
  orderedHandles: string[],
  prefixLen: number,
  ownedSet: ReadonlySet<string>
): number {
  let c = 0;
  const n = Math.min(Math.max(0, prefixLen), orderedHandles.length);
  for (let i = 0; i < n; i++) {
    const k = normalizeReportHandleKey(orderedHandles[i]);
    if (k && !ownedSet.has(k)) c++;
  }
  return c;
}

/** Valor em centavos da campanha inteira (ou erro null) com desconto por propriedade em outras campanhas. */
async function getCampaignBillableReportPricing(
  campaignId: string,
  userId: number
): Promise<{
  amountCents: number;
  originalAmountCents: number;
  alreadyOwnedCount: number;
  profileCount: number;
} | null> {
  const handles = creditsCampaignsDb.getCampaignHandlesIfActive(campaignId, userId);
  if (!handles || handles.length === 0) return null;
  const owned = new Set(creditsCampaignsDb.getAllPaidHandlesUnion(userId));
  const result = await searchProfiles(
    db,
    { limit: Math.min(10000, handles.length), offset: 0, sort: 'engagement_desc' },
    { restrictToHandles: handles }
  );
  const sums = sumReportPriceWithOwnershipDedup(result.items as ProfileListItem[], owned);
  return {
    amountCents: sums.amountCents,
    originalAmountCents: sums.originalAmountCents,
    alreadyOwnedCount: sums.alreadyOwnedCount,
    profileCount: result.items.length,
  };
}

/** Cria campanha a partir da query e quantidade. Retorna campaignId ou null se nenhum handle. */
async function createReportCampaignFromQuery(
  query: ProfilesSearchQuery,
  reportCount: number,
  userId: number,
  expiresAt?: string
): Promise<string | null> {
  const { handles } = await getReportHandlesAndPrice(query, reportCount);
  if (handles.length === 0) return null;
  let queryJson: string | null = null;
  try {
    queryJson = JSON.stringify(query);
  } catch {
    queryJson = null;
  }
  return creditsCampaignsDb.createCampaign(userId, handles, 0, query.q?.trim() || 'Relatório', expiresAt, queryJson);
}

/** Preview do preço do relatório (ativados R$2, não ativados R$1). Body: { query, desiredCount }. */
app.post('/api/checkout/report-price-preview', async (req: Request, res: Response) => {
  try {
    const body = req.body as { query?: ProfilesSearchQuery; desiredCount?: number };
    const query = body?.query;
    const desiredCount = body?.desiredCount != null ? Math.min(10000, Math.max(1, Number(body.desiredCount))) : NaN;
    if (!query || typeof query !== 'object' || !Number.isFinite(desiredCount)) {
      res.status(400).json({ error: 'Envie query e desiredCount' });
      return;
    }
    const { amountCents, activatedCount, notActivatedCount } = await getReportHandlesAndPrice(query, desiredCount);
    res.json({ amountCents, valueBrl: amountCents / 100, activatedCount, notActivatedCount });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Pagamento direto do relatório (sem créditos). Guest: body { email, name?, query, desiredCount, billingType } — senha opcional (gera automática se omitida). Logado: auth + body { query, desiredCount, billingType }. Cria campanha com status pendente na hora. */
app.post('/api/checkout/pay-for-report', authOptional, async (req: RequestWithAuth, res: Response) => {
  try {
    if (!asaas.isAsaasConfigured()) {
      respondPaymentsUnavailable(res);
      return;
    }
    const body = req.body as { email?: string; password?: string; name?: string; cpfCnpj?: string; query?: ProfilesSearchQuery; desiredCount?: number; billingType?: string; expiresAt?: string };
    const query = body?.query;
    const desiredCount = body?.desiredCount != null ? Math.min(10000, Math.max(1, Number(body.desiredCount))) : NaN;
    if (!query || typeof query !== 'object' || !Number.isFinite(desiredCount)) {
      res.status(400).json({ error: 'Envie query (filtros da busca) e desiredCount (1 a 10000)' });
      return;
    }
    const expiresAt = (body?.expiresAt ?? '').toString().trim();
    if (!expiresAt || !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) {
      res.status(400).json({ error: 'Envie expiresAt no formato YYYY-MM-DD (data de expiração da campanha obrigatória)' });
      return;
    }
    const billingType = (body?.billingType ?? 'PIX').toUpperCase() === 'BOLETO' ? 'BOLETO' : 'PIX';

    let userId: number | undefined;
    let authUser: { id: number; username: string; scope: string; profile_handle: string | null } | undefined;
    let token: string | undefined;

    if (!req.user) {
      const email = (body?.email ?? '').toString().trim().toLowerCase();
      const name = (body?.name ?? '').toString().trim() || email;
      if (!email || !email.includes('@')) {
        res.status(400).json({ error: 'Informe um e-mail válido.' });
        return;
      }
      const existingUser = authDb.getByUsername(email);
      if (existingUser) {
        const password = (body?.password ?? '').toString();
        if (!password || !verifyPassword(password, existingUser.password_hash)) {
          res.status(409).json({ error: 'Já existe uma conta com este e-mail. Faça login para continuar.' });
          return;
        }
        userId = existingUser.id;
        authUser = authDb.getById(userId)!;
        token = signJwt(
          { sub: String(userId), username: authUser.username, scope: authUser.scope as AuthScope, profile_handle: authUser.profile_handle ?? undefined },
          getJwtSecret()
        );
      } else {
        const cpfCnpj = (body?.cpfCnpj ?? '').toString().replace(/\D/g, '');
        if (cpfCnpj.length !== 11 && cpfCnpj.length !== 14) {
          res.status(400).json({ error: 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.' });
          return;
        }
        const displayNameGuest = name;
        const tempExternalRef = `guest_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        const guestCustomerRes = await resolveAsaasCustomerId({
          externalRef: tempExternalRef,
          name: displayNameGuest,
          email,
          cpfCnpj,
        });
        if (!guestCustomerRes.ok) {
          res.status(502).json(jsonAsaasCustomerGatewayError(guestCustomerRes));
          return;
        }
        const asaasCustomerId = guestCustomerRes.asaasCustomerId;
        const { handles: reportHandles, amountCents: amountCentsGuest } = await getReportHandlesAndPrice(query, desiredCount);
        if (reportHandles.length === 0) {
          res.status(400).json({ error: 'Nenhum perfil encontrado para o relatório. Ajuste os filtros.' });
          return;
        }
        const valueBrlGuest = amountCentsGuest / 100;
        const dueDateGuest = new Date();
        dueDateGuest.setDate(dueDateGuest.getDate() + (billingType === 'BOLETO' ? 3 : 1));
        const dueStrGuest = dueDateGuest.toISOString().slice(0, 10);
        const paymentPayloadGuest = {
          customer: asaasCustomerId,
          value: valueBrlGuest,
          dueDate: dueStrGuest,
          billingType: billingType as 'PIX' | 'BOLETO',
          description: `Relatório - ${desiredCount} influenciadores`,
          externalReference: `report_pending_${Date.now()}`,
        };
        const asaasPayment = await asaas.createPayment(paymentPayloadGuest);
        const asaasPaymentId = asaasPayment?.id ?? null;
        const invoiceUrl = asaasPayment?.invoiceUrl ?? null;
        const bankSlipUrl = asaasPayment?.bankSlipUrl ?? null;
        const pixCopyPaste = await asaas.resolvePixCopyPasteAfterCreate(
          billingType as 'PIX' | 'BOLETO',
          asaasPaymentId,
          asaasPayment
        );
        const hasPaymentUrl = Boolean(bankSlipUrl || pixCopyPaste);
        if (!hasPaymentUrl || !asaasPaymentId) {
          res.status(502).json({ error: 'Não foi possível gerar o pagamento. Tente novamente.' });
          return;
        }
        const password = (body?.password ?? '').toString();
        const passwordToUse = password.length >= 6 ? password : crypto.randomBytes(16).toString('hex');
        const passwordHash = hashPassword(passwordToUse);
        try {
          userId = authDb.createUser(email, passwordHash, 'assinante' as AuthScope, null, undefined, 0);
        } catch (createErr: unknown) {
          const msg = createErr instanceof Error ? createErr.message : String(createErr);
          if (msg.includes('UNIQUE') && msg.includes('username')) {
            res.status(409).json({ error: 'Já existe uma conta com este e-mail. Faça login para continuar.' });
            return;
          }
          throw createErr;
        }
        authUser = authDb.getById(userId)!;
        const verificationTokenGuest = crypto.randomBytes(32).toString('hex');
        const expiresAtGuest = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
        authDb.setEmailVerification(userId, verificationTokenGuest, expiresAtGuest);
        const frontBaseGuest = process.env.FRONTEND_BASE_URL || process.env.VITE_APP_URL || 'http://localhost:5173';
        const verifyUrlGuest = `${frontBaseGuest.replace(/\/$/, '')}/verify-email?token=${encodeURIComponent(verificationTokenGuest)}`;
        const emailResultGuest = await sendVerificationEmail({
          to: email,
          subject: '✨ 5 créditos: valide seu e-mail e comece a usar',
          verifyUrl: verifyUrlGuest,
          bodyText: 'Confirme seu e-mail agora e ganhe 5 créditos para gerar seus primeiros relatórios de influenciadores — sem custo.',
        });
        if (!emailResultGuest.sent && emailResultGuest.error) {
          console.warn('[checkout-guest] E-mail não enviado:', emailResultGuest.error);
        }
        token = signJwt(
          { sub: String(userId), username: authUser.username, scope: 'assinante' as AuthScope, profile_handle: authUser.profile_handle ?? undefined },
          getJwtSecret()
        );
        const campaignIdGuest = await createReportCampaignFromQuery(query, desiredCount, userId, expiresAt);
        const paymentId = paymentsDb.createPayment({
          userId,
          asaasPaymentId,
          asaasCustomerId,
          amountCents: amountCentsGuest,
          creditsGranted: 0,
          status: 'PENDING',
          billingType: billingType as 'PIX' | 'BOLETO',
          invoiceUrl,
          bankSlipUrl,
          pixCopyPaste,
          reportQuery: JSON.stringify(query),
          reportDesiredCount: desiredCount,
          campaignId: campaignIdGuest ?? undefined,
        });
        const out: Record<string, unknown> = {
          paymentId,
          asaasPaymentId,
          status: 'PENDING',
          desiredCount,
          amountCents: amountCentsGuest,
          valueBrl: valueBrlGuest,
          billingType,
          invoiceUrl,
          bankSlipUrl,
          pixCopyPaste,
          email_sent: emailResultGuest.sent,
        };
        if (campaignIdGuest) out.campaignId = campaignIdGuest;
        if (token) {
          out.token = token;
          out.user = { id: authUser.id, username: authUser.username, scope: authUser.scope, profile_handle: authUser.profile_handle, email_verified: false };
        }
        res.status(201).json(out);
        return;
      }
    }
    if (req.user) {
      userId = Number(req.user.sub);
      authUser = authDb.getById(userId)!;
      if (!authUser) {
        res.status(401).json({ error: 'Usuário não encontrado' });
        return;
      }
    }

    if (userId == null || !authUser) {
      res.status(500).json({ error: 'Não foi possível identificar o usuário' });
      return;
    }

    const { handles: reportHandles, amountCents } = await getReportHandlesAndPrice(query, desiredCount);
    if (reportHandles.length === 0) {
      res.status(400).json({ error: 'Nenhum perfil encontrado para o relatório. Ajuste os filtros.' });
      return;
    }
    const valueBrl = amountCents / 100;
    const displayName = req.user
      ? (authUser.profile_handle ? `@${authUser.profile_handle}` : authUser.username)
      : ((body?.name ?? '').toString().trim() || authUser.username);
    const email = authUser.username.includes('@') ? authUser.username : `user${userId}@payments.influencer.local`;
    const externalRef = `user_${userId}`;

    const cpfCnpjOpt = (body?.cpfCnpj ?? '').toString().replace(/\D/g, '');
    const reportCustomerRes = await resolveAsaasCustomerId({
      externalRef,
      name: displayName,
      email,
      cpfCnpj: cpfCnpjOpt.length === 11 || cpfCnpjOpt.length === 14 ? cpfCnpjOpt : undefined,
    });
    if (!reportCustomerRes.ok) {
      res.status(502).json(jsonAsaasCustomerGatewayError(reportCustomerRes));
      return;
    }
    const asaasCustomerId = reportCustomerRes.asaasCustomerId;

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + (billingType === 'BOLETO' ? 3 : 1));
    const dueStr = dueDate.toISOString().slice(0, 10);

    const paymentPayload = {
      customer: asaasCustomerId,
      value: valueBrl,
      dueDate: dueStr,
      billingType: billingType as 'PIX' | 'BOLETO',
      description: `Relatório - ${desiredCount} influenciadores`,
      externalReference: `report_${userId}_${Date.now()}`,
    };
    const asaasPayment = await asaas.createPayment(paymentPayload);
    const asaasPaymentId = asaasPayment?.id ?? null;
    const invoiceUrl = asaasPayment?.invoiceUrl ?? null;
    const bankSlipUrl = asaasPayment?.bankSlipUrl ?? null;
    const pixCopyPaste = await asaas.resolvePixCopyPasteAfterCreate(
      billingType as 'PIX' | 'BOLETO',
      asaasPaymentId,
      asaasPayment
    );

    const campaignIdReport = await createReportCampaignFromQuery(query, desiredCount, userId, expiresAt);
    const paymentId = paymentsDb.createPayment({
      userId,
      asaasPaymentId,
      asaasCustomerId,
      amountCents,
      creditsGranted: 0,
      status: 'PENDING',
      billingType: billingType as 'PIX' | 'BOLETO',
      invoiceUrl,
      bankSlipUrl,
      pixCopyPaste,
      reportQuery: JSON.stringify(query),
      reportDesiredCount: desiredCount,
      campaignId: campaignIdReport ?? undefined,
    });

    const out: Record<string, unknown> = {
      paymentId,
      asaasPaymentId,
      status: 'PENDING',
      desiredCount,
      amountCents,
      valueBrl,
      billingType,
      invoiceUrl,
      bankSlipUrl,
      pixCopyPaste,
    };
    if (campaignIdReport) out.campaignId = campaignIdReport;
    if (token) {
      out.token = token;
      out.user = { id: authUser.id, username: authUser.username, scope: authUser.scope, profile_handle: authUser.profile_handle };
    }
    res.status(201).json(out);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Cria pagamento para comprar créditos (PIX ou BOLETO via Asaas). */
app.post('/api/me/payments', async (req: RequestWithAuth, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Login necessário' });
      return;
    }
    if (!asaas.isAsaasConfigured()) {
      respondPaymentsUnavailable(res);
      return;
    }
    const userId = Number(req.user.sub);
    const body = req.body as { credits?: number; billingType?: string; cpfCnpj?: string; customerName?: string };
    const credits = Number(body?.credits);
    if (!Number.isFinite(credits) || credits < 1 || credits > 10000) {
      res.status(400).json({ error: 'Envie credits (1 a 10000)' });
      return;
    }
    const billingType = (body?.billingType ?? 'PIX').toUpperCase() === 'BOLETO' ? 'BOLETO' : 'PIX';
    const cpfDigits = (body?.cpfCnpj ?? '').replace(/\D/g, '');
    if (billingType === 'BOLETO' && cpfDigits.length !== 11 && cpfDigits.length !== 14) {
      res.status(400).json({ error: 'Para boleto, informe CPF (11 dígitos) ou CNPJ (14 dígitos).' });
      return;
    }
    const amountCents = credits * CREDITS_PRICE_CENTS;
    const valueBrl = amountCents / 100;

    const authUser = authDb.getById(userId);
    if (!authUser) {
      res.status(401).json({ error: 'Usuário não encontrado' });
      return;
    }

    const pendingExisting = paymentsDb.getFirstPendingForUser(userId);
    if (pendingExisting) {
      res.status(409).json({
        error:
          'Já existe uma cobrança pendente. Conclua o pagamento, reabra pelo botão de compra ou cancele em Meus pagamentos antes de gerar outra.',
        payment: paymentRowToCreditsChargePayload(pendingExisting),
      });
      return;
    }

    const rawTitularName = (body?.customerName ?? '').toString().trim();
    const fallbackName = authUser.profile_handle ? `@${authUser.profile_handle}` : authUser.username;
    const nameForAsaas =
      rawTitularName.length >= 2 ? rawTitularName.slice(0, 200) : fallbackName;
    const email = authUser.username.includes('@') ? authUser.username : `user${userId}@payments.influencer.local`;
    const externalRef = `user_${userId}`;

    const mePayCustomerRes = await resolveAsaasCustomerId({
      externalRef,
      name: nameForAsaas,
      email,
      cpfCnpj: cpfDigits.length === 11 || cpfDigits.length === 14 ? cpfDigits : undefined,
      retryFindAfterCreate: true,
    });
    if (!mePayCustomerRes.ok) {
      res.status(502).json(jsonAsaasCustomerGatewayError(mePayCustomerRes));
      return;
    }
    const asaasCustomerId = mePayCustomerRes.asaasCustomerId;
    try {
      const patch: { name: string; cpfCnpj?: string } = { name: nameForAsaas };
      if (cpfDigits.length === 11 || cpfDigits.length === 14) {
        patch.cpfCnpj = cpfDigits;
      }
      await asaas.updateCustomer(asaasCustomerId, patch);
    } catch (updateErr) {
      console.warn('[me/payments] Asaas updateCustomer:', updateErr);
    }

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + (billingType === 'BOLETO' ? 3 : 1));
    const dueStr = dueDate.toISOString().slice(0, 10);

    const paymentPayload = {
      customer: asaasCustomerId,
      value: valueBrl,
      dueDate: dueStr,
      billingType: billingType as 'PIX' | 'BOLETO',
      description: `${credits} créditos - Influencer`,
      externalReference: `credits_${userId}_${Date.now()}`,
    };
    const asaasPayment = await asaas.createPayment(paymentPayload);
    const asaasPaymentId = asaasPayment?.id ?? null;
    const invoiceUrl = asaasPayment?.invoiceUrl ?? null;
    const bankSlipUrl = asaasPayment?.bankSlipUrl ?? null;
    const pixCopyPaste = await asaas.resolvePixCopyPasteAfterCreate(
      billingType as 'PIX' | 'BOLETO',
      asaasPaymentId,
      asaasPayment
    );

    const paymentId = paymentsDb.createPayment({
      userId,
      asaasPaymentId,
      asaasCustomerId,
      amountCents,
      creditsGranted: credits,
      status: 'PENDING',
      billingType: billingType as 'PIX' | 'BOLETO',
      invoiceUrl,
      bankSlipUrl,
      pixCopyPaste,
    });

    if (cpfDigits.length === 11 || cpfDigits.length === 14) {
      try {
        authDb.setBillingCpfCnpj(userId, cpfDigits);
      } catch (saveDocErr) {
        console.warn('[me/payments] setBillingCpfCnpj:', saveDocErr);
      }
    }

    res.status(201).json({
      paymentId,
      asaasPaymentId,
      status: 'PENDING',
      credits,
      amountCents,
      valueBrl,
      billingType,
      invoiceUrl,
      bankSlipUrl,
      pixCopyPaste,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Webhook Asaas: confirmação de pagamento. Atualiza status e libera créditos. */
app.post('/api/payments/webhook', async (req: Request, res: Response) => {
  try {
    const body = req.body as { event?: string; payment?: { id?: string; status?: string } };
    const event = body?.event;
    const payment = body?.payment;
    if (event !== 'PAYMENT_RECEIVED' && event !== 'PAYMENT_CONFIRMED' && event !== 'PAYMENT_RECEIVED_IN_CASH') {
      res.status(200).json({ received: true });
      return;
    }
    const asaasId = payment?.id;
    if (!asaasId || typeof asaasId !== 'string') {
      res.status(400).json({ error: 'payment.id obrigatório' });
      return;
    }
    const row = paymentsDb.getByAsaasPaymentId(asaasId);
    if (!row) {
      res.status(200).json({ received: true });
      return;
    }
    const confirmedStatus = payment?.status;
    if (asaasRemoteStatusIsPaid(confirmedStatus) && row.status === 'PENDING') {
      let allowFinalize = true;
      if (asaas.isAsaasConfigured()) {
        try {
          const remote = await asaas.getPayment(asaasId);
          allowFinalize = asaasRemotePaymentMatchesPendingRow(remote, row);
        } catch (e) {
          console.warn('[payments/webhook] getPayment validação:', e instanceof Error ? e.message : e);
          allowFinalize = false;
        }
      }
      if (allowFinalize) {
        await finalizePendingPaymentRow(row);
      }
    }
    res.status(200).json({ received: true });
  } catch (e) {
    console.error('[payments/webhook]', e);
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Lista handles favoritados pelo usuário. Inclui campaignName quando há campaign_id ou quando o handle está em alguma campanha do usuário. */
app.get('/api/me/favorites', async (req: RequestWithAuth, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Login necessário' });
      return;
    }
    const userId = Number(req.user.sub);
    const rows = sqlite.getFavorites(userId);
    const normalizedHandle = (h: string) => (h || '').toLowerCase().replace(/^@/, '').trim();
    const favorites = rows.map((r) => {
      let campaignName: string | null = null;
      let campaignId: string | null = r.campaign_id;
      if (r.campaign_id) {
        const camp = creditsCampaignsDb.getCampaign(r.campaign_id, userId);
        campaignName = camp?.name ?? null;
      }
      if (!campaignName) {
        const h = normalizedHandle(r.profile_handle);
        const campaigns = creditsCampaignsDb.listCampaigns(userId);
        for (const camp of campaigns) {
          const handles = creditsCampaignsDb.getCampaignHandles(camp.id, userId);
          if (handles?.some((x) => normalizedHandle(x) === h)) {
            campaignName = camp.name ?? null;
            campaignId = camp.id;
            break;
          }
        }
      }
      const ref = profileRefDb.getOrCreateRef(r.profile_handle);
      return {
        profile_ref: ref,
        campaignId: campaignId ?? undefined,
        campaignName: campaignName ?? undefined,
      };
    });
    res.json({
      profile_refs: favorites.map((f) => f.profile_ref),
      favorites,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Adiciona influenciador aos favoritos. Body: { handle: string, campaignId?: string }. */
app.post('/api/me/favorites', async (req: RequestWithAuth, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Login necessário' });
      return;
    }
    const userId = Number(req.user.sub);
    const ident = (req.body?.profile_ref ?? req.body?.handle ?? req.body?.profile_handle ?? '')
      .toString()
      .trim();
    const handle = resolveProfileParam(ident) ?? normalizeHandle(ident);
    if (!handle) {
      res.status(400).json({ error: 'profile_ref é obrigatório' });
      return;
    }
    profileRefDb.getOrCreateRef(handle);
    const campaignId = (req.body?.campaignId ?? req.body?.campaign_id ?? '').toString().trim() || undefined;
    if (campaignId && !isCampaignIdGuid(campaignId)) {
      res.status(400).json({ error: 'campaignId inválido' });
      return;
    }
    if (campaignId) {
      const camp = creditsCampaignsDb.getCampaignIfActive(campaignId, userId);
      if (!camp) {
        res.status(400).json({ error: 'Campanha não encontrada ou expirada' });
        return;
      }
    }
    sqlite.addFavorite(userId, handle, campaignId);
    res.status(201).json({
      ok: true,
      profile_ref: profileRefDb.getOrCreateRef(handle),
      campaignId: campaignId ?? null,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Remove influenciador dos favoritos. Query campaignId opcional: remove só essa (handle, campanha); sem campaignId remove todas as entradas do handle. */
app.delete('/api/me/favorites/:handle', async (req: RequestWithAuth, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Login necessário' });
      return;
    }
    const userId = Number(req.user.sub);
    const ident = (req.params.handle ?? '').trim();
    const handle = resolveProfileParam(ident) ?? normalizeHandle(ident);
    if (!handle) {
      res.status(400).json({ error: 'profile_ref inválido' });
      return;
    }
    const campaignIdRaw = (req.query.campaignId ?? req.query.campaign_id) as string | undefined;
    const campaignId = typeof campaignIdRaw === 'string' && campaignIdRaw.trim() && isCampaignIdGuid(campaignIdRaw.trim()) ? campaignIdRaw.trim() : undefined;
    sqlite.removeFavorite(userId, handle, campaignId ?? null);
    res.json({ ok: true, profile_ref: profileRefDb.getOrCreateRef(handle), campaignId: campaignId ?? null });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Resultado de stats e preview de uma campanha (compilado para exibição em pagamento pendente). */
interface CampaignStatsResult {
  totalLikes: number;
  totalComments: number;
  totalViews: number;
  totalFollowers: number;
  postsCount: number;
  avgEngagementRate: number;
  avgLikes: number;
  avgComments: number;
  avgViews: number;
  previewProfiles: Array<{ handle: string; profile_pic_url?: string; full_name?: string; followers_count?: number }>;
  topHashtags: string[];
  /** Categorias principais LLM mais frequentes entre os perfis (rótulo + quantidade de perfis, até 8). */
  topLlmCategories: Array<{ label: string; count: number }>;
  /** Gênero inferido pelo LLM (feminino, masculino, etc.) por quantidade de perfis. */
  topLlmGenders: Array<{ label: string; count: number }>;
  /** Tipo de perfil inferido pelo LLM (criador, empresa, etc.) por quantidade de perfis. */
  topLlmProfileTypes: Array<{ label: string; count: number }>;
  /** Cidades presentes nos perfis ativados (nome e quantidade). */
  cities: Array<{ name: string; count: number }>;
  /** Estados presentes nos perfis ativados (nome e quantidade). */
  states: Array<{ name: string; count: number }>;
  /** Quantidade de perfis com ativação (cidade preenchida). */
  activatedCount: number;
  amountCents?: number;
  valueBrl?: number;
  originalAmountCents?: number;
  /** Perfis que já estão em outro relatório pago (sem cobrança de novo). */
  alreadyOwnedInOtherReports?: number;
}

/** Agrega stats de engajamento e preview dos perfis da campanha. Só retorna dados para campanha ativa. */
async function getCampaignStats(campaignId: string, userId: number): Promise<CampaignStatsResult | null> {
  const handles = creditsCampaignsDb.getCampaignHandlesIfActive(campaignId, userId);
  if (!handles || handles.length === 0) return null;
  const limit = Math.min(handles.length, 2000);
  /** Sem facetas nem BI: só agregados + preview (evita milhares de leituras Rocks / CPU). */
  const result = await searchProfiles(
    db,
    { limit, offset: 0, sort: 'engagement_desc', includeFacets: false },
    { restrictToHandles: handles, skipInstagramBi: true },
  );
  let totalLikes = 0;
  let totalComments = 0;
  let totalViews = 0;
  let totalFollowers = 0;
  let postsCount = 0;
  let engagementSum = 0;
  let engCount = 0;
  let avgLikesSum = 0;
  let avgCommentsSum = 0;
  let avgViewsSum = 0;
  for (const item of result.items) {
    const eng = (item as ProfileListItem).engagement;
    totalLikes += eng?.total_likes ?? 0;
    totalComments += eng?.total_comments ?? 0;
    totalViews += eng?.total_views ?? 0;
    postsCount += eng?.posts_count ?? 0;
    avgLikesSum += eng?.avg_likes ?? 0;
    avgCommentsSum += eng?.avg_comments ?? 0;
    avgViewsSum += eng?.avg_views ?? 0;
    totalFollowers += (item as ProfileListItem).followers_count ?? 0;
    if (eng?.engagement_rate != null && Number.isFinite(eng.engagement_rate)) {
      engagementSum += eng.engagement_rate;
      engCount++;
    }
  }
  const n = result.items.length;
  const previewProfiles = result.items.slice(0, 8).map((i) => ({
    handle: (i as ProfileListItem).handle,
    profile_pic_url: (i as ProfileListItem).profile_pic_url,
    full_name: (i as ProfileListItem).full_name,
    followers_count: (i as ProfileListItem).followers_count,
  }));
  const categoryCount = new Map<string, number>();
  for (const item of result.items) {
    const cats = (item as ProfileListItem).categories ?? [];
    for (const c of cats) {
      const key = String(c).trim().toLowerCase();
      if (!key) continue;
      categoryCount.set(key, (categoryCount.get(key) ?? 0) + 1);
    }
  }
  const topHashtags = [...categoryCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([key]) => key);

  const llmCategoryByNorm = new Map<string, { count: number; label: string }>();
  for (const item of result.items) {
    const q = getLlmQualification(item as unknown as Record<string, unknown>);
    if (!q) continue;
    const raw = String(q.mainCategory ?? '').trim();
    if (!raw || raw === '-') continue;
    const norm = raw.toLowerCase();
    const cur = llmCategoryByNorm.get(norm);
    if (cur) cur.count += 1;
    else llmCategoryByNorm.set(norm, { count: 1, label: raw });
  }
  const topLlmCategories = [...llmCategoryByNorm.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
    .map((v) => ({ label: v.label, count: v.count }));

  const llmGenderByNorm = new Map<string, { count: number; label: string }>();
  const llmProfileTypeByNorm = new Map<string, { count: number; label: string }>();
  for (const item of result.items) {
    const q = getLlmQualification(item as unknown as Record<string, unknown>);
    if (!q) continue;
    const genderRaw = String(q.gender ?? '').trim();
    if (genderRaw && genderRaw !== '-') {
      const gn = genderRaw.toLowerCase();
      const gCur = llmGenderByNorm.get(gn);
      if (gCur) gCur.count += 1;
      else llmGenderByNorm.set(gn, { count: 1, label: genderRaw });
    }
    const ptRaw = String(q.profileType ?? '').trim();
    if (ptRaw && ptRaw !== '-') {
      const pn = ptRaw.toLowerCase();
      const pCur = llmProfileTypeByNorm.get(pn);
      if (pCur) pCur.count += 1;
      else llmProfileTypeByNorm.set(pn, { count: 1, label: ptRaw });
    }
  }
  const topLlmGenders = [...llmGenderByNorm.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
    .map((v) => ({ label: v.label, count: v.count }));
  const topLlmProfileTypes = [...llmProfileTypeByNorm.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
    .map((v) => ({ label: v.label, count: v.count }));

  const cityCount = new Map<string, number>();
  const stateCount = new Map<string, number>();
  let activatedCount = 0;
  for (const item of result.items) {
    const act = (item as ProfileListItem).activation;
    if (act?.city?.trim()) {
      activatedCount++;
      const city = act.city.trim();
      cityCount.set(city, (cityCount.get(city) ?? 0) + 1);
    }
    if (act?.state?.trim()) {
      const state = act.state.trim();
      stateCount.set(state, (stateCount.get(state) ?? 0) + 1);
    }
  }
  const cities = [...cityCount.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
  const states = [...stateCount.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  const notActivatedCount = n - activatedCount;
  const fallbackCents = activatedCount * REPORT_PRICE_CENTS_ACTIVATED + notActivatedCount * REPORT_PRICE_CENTS_NOT_ACTIVATED;
  const billablePricing = await getCampaignBillableReportPricing(campaignId, userId);
  const amountCents = billablePricing?.amountCents ?? fallbackCents;

  return {
    totalLikes,
    totalComments,
    totalViews,
    totalFollowers,
    postsCount,
    avgEngagementRate: engCount > 0 ? Math.round((engagementSum / engCount) * 100) / 100 : 0,
    avgLikes: n > 0 ? Math.round(avgLikesSum / n) : 0,
    avgComments: n > 0 ? Math.round(avgCommentsSum / n) : 0,
    avgViews: n > 0 ? Math.round(avgViewsSum / n) : 0,
    previewProfiles,
    topHashtags,
    topLlmCategories,
    topLlmGenders,
    topLlmProfileTypes,
    cities,
    states,
    activatedCount,
    amountCents,
    valueBrl: amountCents / 100,
    originalAmountCents: billablePricing?.originalAmountCents,
    alreadyOwnedInOtherReports: billablePricing?.alreadyOwnedCount,
  };
}

/** Lista campanhas do usuário logado (com stats de engajamento por campanha). Query: light=1 retorna só lista (sem stats) para carregamento rápido. */
app.get('/api/me/campaigns', async (req: RequestWithAuth, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Login necessário' });
      return;
    }
    const userId = Number(req.user.sub);
    const light = (req.query?.light ?? '') === '1' || (req.query?.light ?? '') === 'true';
    const rows = creditsCampaignsDb.listCampaigns(userId);
    if (light) {
      const campaigns = rows.map((r) => {
        const base: Record<string, unknown> = {
          id: r.id,
          name: r.name,
          handlesCount: r.handles_count,
          creditsUsed: r.credits_used,
          creditsPaid: r.payment_status === 'paid' ? r.credits_used : 0,
          created_at: r.created_at,
          expires_at: r.expires_at,
          paymentStatus: r.payment_status,
        };
        const payment = paymentsDb.getByCampaignId(r.id, userId);
        const hasPending = r.payment_status === 'pending';
        if (hasPending) {
          if (payment && payment.status === 'PENDING') {
            base.pendingPayment = {
              status: payment.status,
              billingType: payment.billing_type,
              bankSlipUrl: payment.bank_slip_url,
              invoiceUrl: payment.invoice_url,
              pixCopyPaste: payment.pix_copy_paste,
              amountCents: payment.amount_cents,
              valueBrl: payment.amount_cents / 100,
            };
          } else {
            base.pendingPayment = { status: 'PENDING', paymentMissing: true };
          }
        }
        return base;
      });
      res.json({ campaigns });
      return;
    }
    const campaigns = await Promise.all(
      rows.map(async (r) => {
        const base: Record<string, unknown> = {
          id: r.id,
          name: r.name,
          handlesCount: r.handles_count,
          creditsUsed: r.credits_used,
          creditsPaid: r.payment_status === 'paid' ? r.credits_used : 0,
          created_at: r.created_at,
          expires_at: r.expires_at,
          paymentStatus: r.payment_status,
        };
        const payment = paymentsDb.getByCampaignId(r.id, userId);
        const hasPending = r.payment_status === 'pending';
        if (hasPending) {
          if (payment && payment.status === 'PENDING') {
            base.pendingPayment = {
              status: payment.status,
              billingType: payment.billing_type,
              bankSlipUrl: payment.bank_slip_url,
              invoiceUrl: payment.invoice_url,
              pixCopyPaste: payment.pix_copy_paste,
              amountCents: payment.amount_cents,
              valueBrl: payment.amount_cents / 100,
            };
          } else {
            base.pendingPayment = { status: 'PENDING', paymentMissing: true };
          }
        }
        const data = await getCampaignStats(r.id, userId);
        if (!data) return base;
        const { previewProfiles, topHashtags, topLlmCategories, topLlmGenders, topLlmProfileTypes, ...stats } = data;
        return {
          ...base,
          stats,
          previewProfiles,
          topHashtags,
          topLlmCategories,
          topLlmGenders,
          topLlmProfileTypes,
        };
      })
    );
    res.json({ campaigns });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Cria campanha (compra do relatório): resolve a busca, grava handles e debita créditos (1 por influenciador). Requer login. */
const CREDITS_PER_INFLUENCER = 1;
app.post('/api/campaigns', rateLimitDataApi, async (req: RequestWithAuth, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Login necessário para comprar relatório' });
      return;
    }
    const userId = Number(req.user.sub);
    const body = req.body as { query?: ProfilesSearchQuery; name?: string; maxHandles?: number | string; expiresAt?: string };
    const query = body?.query;
    if (!query || typeof query !== 'object') {
      res.status(400).json({ error: 'Envie { query: {...} } com os filtros da busca' });
      return;
    }
    const expiresAt = (body?.expiresAt ?? '').toString().trim();
    if (!expiresAt || !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) {
      res.status(400).json({ error: 'Envie expiresAt no formato YYYY-MM-DD (data de expiração da campanha obrigatória)' });
      return;
    }
    const rawMax = body?.maxHandles;
    const parsedMax = rawMax != null ? Number(rawMax) : NaN;
    const maxHandles = Number.isFinite(parsedMax) && parsedMax > 0
      ? Math.min(Math.floor(parsedMax), 10000)
      : undefined;
    const requestedLimit = maxHandles ?? 10000;
    const result = await searchProfiles(
      db,
      { ...query, limit: requestedLimit, offset: 0, includeFacets: false },
      { allowLargeLimit: true }
    );
    const allHandles = result.items.map((item) => item.handle).filter(Boolean) as string[];
    const finalHandles = maxHandles != null ? allHandles.slice(0, maxHandles) : allHandles;
    if (finalHandles.length === 0) {
      res.status(400).json({ error: 'Nenhum perfil no resultado da busca' });
      return;
    }
    const creditsNeeded = finalHandles.length * CREDITS_PER_INFLUENCER;
    const campaignName = (body?.name ?? '').toString().trim() || (query?.q ?? '').toString().trim() || undefined;
    let queryJson: string | null = null;
    try {
      queryJson = JSON.stringify(query);
    } catch {
      queryJson = null;
    }
    const campaignId = creditsCampaignsDb.createCampaign(userId, finalHandles, creditsNeeded, campaignName, expiresAt, queryJson);
    res.status(201).json({ campaignId, handlesCount: finalHandles.length, creditsUsed: creditsNeeded });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Visão agregada "Todos": metadados sintéticos (base completa de perfis). */
app.get('/api/campaigns/all', async (req: RequestWithAuth, res: Response) => {
  try {
    const userId = req.user ? Number(req.user.sub) : null;
    const rows = userId != null ? creditsCampaignsDb.listCampaigns(userId) : [];
    const handlesCount = await db.countKeysInBucket('profile');
    const paidRows = rows.filter((r) => r.payment_status === 'paid');
    const oldestCreated =
      paidRows.length > 0
        ? paidRows.reduce((a, b) => (a.created_at < b.created_at ? a : b)).created_at
        : new Date().toISOString();
    const maxExpires =
      paidRows.length > 0
        ? paidRows.reduce((a, b) => (a.expires_at > b.expires_at ? a : b)).expires_at
        : new Date(Date.now() + 365 * 864e5).toISOString();
    res.json({
      id: 'all',
      name: 'Base completa',
      description: 'Todos os perfis disponíveis na base.',
      handlesCount,
      creditsUsed: 0,
      creditsPaid: 0,
      created_at: oldestCreated,
      expires_at: maxExpires,
      paymentStatus: 'paid',
      aggregate: true,
      paidCampaignsCount: paidRows.length,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Dados da campanha (para listar por campanha). */
app.get('/api/campaigns/:id', async (req: RequestWithAuth, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Login necessário' });
      return;
    }
    const campaignId = String(req.params.id ?? '').trim();
    if (!isCampaignIdGuid(campaignId)) {
      res.status(400).json({ error: 'ID da campanha inválido' });
      return;
    }
    const userId = Number(req.user.sub);
    const campaign = creditsCampaignsDb.getCampaignIfActive(campaignId, userId);
    if (!campaign) {
      res.status(404).json({ error: 'Campanha não encontrada ou expirada' });
      return;
    }
    const payload: Record<string, unknown> = {
      id: campaign.id,
      name: campaign.name,
      description: campaign.description ?? null,
      handlesCount: campaign.handles_count,
      creditsUsed: campaign.credits_used,
      creditsPaid: campaign.payment_status === 'paid' ? campaign.credits_used : 0,
      created_at: campaign.created_at,
      expires_at: campaign.expires_at,
      paymentStatus: campaign.payment_status,
    };
    if (campaign.query_json && typeof campaign.query_json === 'string' && campaign.query_json.trim()) {
      try {
        payload.savedQuery = JSON.parse(campaign.query_json) as unknown;
      } catch {
        /* ignora JSON inválido */
      }
    }
    const payment = paymentsDb.getByCampaignId(campaignId, userId);
    const hasPendingPayment = campaign.payment_status === 'pending';
    if (hasPendingPayment) {
      if (payment && payment.status === 'PENDING') {
        payload.pendingPayment = {
          status: payment.status,
          billingType: payment.billing_type,
          bankSlipUrl: payment.bank_slip_url,
          invoiceUrl: payment.invoice_url,
          pixCopyPaste: payment.pix_copy_paste,
          amountCents: payment.amount_cents,
          valueBrl: payment.amount_cents / 100,
        };
      } else {
        try {
          const compilado = await getCampaignStats(campaignId, userId);
          const amountCents = compilado?.amountCents ?? campaign.handles_count * 100;
          payload.pendingPayment = {
            status: 'PENDING',
            billingType: null,
            bankSlipUrl: null,
            invoiceUrl: null,
            pixCopyPaste: null,
            amountCents,
            valueBrl: amountCents / 100,
            paymentMissing: true,
          };
          if (compilado) payload.compilado = compilado;
        } catch (e) {
          console.warn('[GET /api/campaigns/:id] compilado for paymentMissing failed', e);
          payload.pendingPayment = {
            status: 'PENDING',
            billingType: null,
            bankSlipUrl: null,
            invoiceUrl: null,
            pixCopyPaste: null,
            amountCents: campaign.handles_count * 100,
            valueBrl: (campaign.handles_count * 100) / 100,
            paymentMissing: true,
          };
        }
      }
      if (payload.pendingPayment && !(payload.pendingPayment as Record<string, unknown>).paymentMissing) {
        try {
          const compilado = await getCampaignStats(campaignId, userId);
          if (compilado) payload.compilado = compilado;
        } catch (e) {
          console.warn('[GET /api/campaigns/:id] compilado failed', e);
        }
      }
    }
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Altera a quantidade de perfis a comprar (só quando pagamento pendente). Reduz a campanha aos primeiros N handles. */
app.patch('/api/campaigns/:id/set-quantity', async (req: RequestWithAuth, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Login necessário' });
      return;
    }
    const campaignId = String(req.params.id ?? '').trim();
    if (!isCampaignIdGuid(campaignId)) {
      res.status(400).json({ error: 'ID da campanha inválido' });
      return;
    }
    const userId = Number(req.user.sub);
    const campaign = creditsCampaignsDb.getCampaignIfActive(campaignId, userId);
    if (!campaign) {
      res.status(404).json({ error: 'Campanha não encontrada ou expirada' });
      return;
    }
    if (campaign.payment_status === 'paid') {
      res.status(400).json({ error: 'Não é possível alterar a quantidade após o pagamento.' });
      return;
    }
    const quantity = typeof req.body?.quantity === 'number'
      ? Math.floor(req.body.quantity)
      : Number(req.body?.quantity);
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > campaign.handles_count) {
      res.status(400).json({
        error: `Informe uma quantidade entre 1 e ${campaign.handles_count}.`,
      });
      return;
    }
    if (quantity === campaign.handles_count) {
      res.json({ ok: true, quantity: campaign.handles_count });
      return;
    }
    const ok = creditsCampaignsDb.setCampaignQuantity(campaignId, userId, quantity);
    if (!ok) {
      res.status(400).json({ error: 'Não foi possível alterar a quantidade.' });
      return;
    }
    res.json({ ok: true, quantity });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Atualiza o nome da campanha. */
app.patch('/api/campaigns/:id', async (req: RequestWithAuth, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Login necessário' });
      return;
    }
    const campaignId = String(req.params.id ?? '').trim();
    if (!isCampaignIdGuid(campaignId)) {
      res.status(400).json({ error: 'ID da campanha inválido' });
      return;
    }
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : undefined;
    const description = typeof req.body?.description === 'string' ? req.body.description : undefined;
    const userId = Number(req.user.sub);
    const campExists = creditsCampaignsDb.getCampaignIfActive(campaignId, userId);
    if (!campExists) {
      res.status(404).json({ error: 'Campanha não encontrada ou expirada' });
      return;
    }
    if (name !== undefined) {
      const ok = creditsCampaignsDb.updateCampaignName(campaignId, userId, name ?? '');
      if (!ok) {
        res.status(404).json({ error: 'Campanha não encontrada' });
        return;
      }
    }
    if (description !== undefined) {
      const ok = creditsCampaignsDb.updateCampaignDescription(campaignId, userId, description);
      if (!ok) {
        res.status(404).json({ error: 'Campanha não encontrada' });
        return;
      }
    }
    const camp = creditsCampaignsDb.getCampaignIfActive(campaignId, userId);
    res.json({
      ok: true,
      name: camp?.name ?? null,
      description: camp?.description ?? null,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Exclui a campanha (apenas do dono). */
app.delete('/api/campaigns/:id', async (req: RequestWithAuth, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Login necessário' });
      return;
    }
    const campaignId = String(req.params.id ?? '').trim();
    if (!isCampaignIdGuid(campaignId)) {
      res.status(400).json({ error: 'ID da campanha inválido' });
      return;
    }
    const userId = Number(req.user.sub);
    const ok = creditsCampaignsDb.deleteCampaign(campaignId, userId);
    if (!ok) {
      res.status(404).json({ error: 'Campanha não encontrada ou já excluída' });
      return;
    }
    res.status(204).send();
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Gera boleto ou PIX para uma campanha que ainda não tem pagamento (payment ausente ou excluído). */
app.post('/api/campaigns/:id/create-payment', async (req: RequestWithAuth, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Login necessário' });
      return;
    }
    if (!asaas.isAsaasConfigured()) {
      respondPaymentsUnavailable(res);
      return;
    }
    const campaignId = String(req.params.id ?? '').trim();
    if (!isCampaignIdGuid(campaignId)) {
      res.status(400).json({ error: 'ID da campanha inválido' });
      return;
    }
    const userId = Number(req.user.sub);
    const campaign = creditsCampaignsDb.getCampaignIfActive(campaignId, userId);
    if (!campaign) {
      res.status(404).json({ error: 'Campanha não encontrada ou expirada' });
      return;
    }
    const existingPayment = paymentsDb.getByCampaignId(campaignId, userId);
    if (existingPayment) {
      if (existingPayment.status === 'PENDING') {
        res.json({
          bankSlipUrl: existingPayment.bank_slip_url,
          pixCopyPaste: existingPayment.pix_copy_paste,
          invoiceUrl: existingPayment.invoice_url,
          billingType: existingPayment.billing_type,
          amountCents: existingPayment.amount_cents,
          valueBrl: existingPayment.amount_cents / 100,
        });
        return;
      }
      res.status(400).json({ error: 'Esta campanha já possui um pagamento registrado.' });
      return;
    }
    if (campaign.payment_status === 'paid') {
      res.status(400).json({ error: 'Campanha já foi paga.' });
      return;
    }
    const body = req.body as { billingType?: string; cpfCnpj?: string; quantity?: number };
    const billingType = (body?.billingType ?? 'PIX').toUpperCase() === 'BOLETO' ? 'BOLETO' : 'PIX';
    if (billingType === 'BOLETO') {
      const cpfCnpj = (body?.cpfCnpj ?? '').toString().replace(/\D/g, '');
      if (cpfCnpj.length !== 11 && cpfCnpj.length !== 14) {
        res.status(400).json({ error: 'Para boleto, informe CPF (11 dígitos) ou CNPJ (14 dígitos).' });
        return;
      }
    }
    const quantity = (body?.quantity != null && Number.isFinite(body.quantity))
      ? Math.min(campaign.handles_count, Math.max(1, Math.floor(body.quantity)))
      : campaign.handles_count;
    const ownedPaySet = new Set(creditsCampaignsDb.getAllPaidHandlesUnion(userId));
    let amountCents: number;
    if (quantity < campaign.handles_count) {
      const handles = creditsCampaignsDb.getCampaignHandlesIfActive(campaignId, userId);
      const firstN = handles ? handles.slice(0, quantity) : [];
      if (firstN.length === 0) {
        amountCents = quantity * 100;
      } else {
        const result = await searchProfiles(db, { limit: firstN.length, offset: 0, sort: 'engagement_desc' }, { restrictToHandles: firstN });
        const sums = sumReportPriceWithOwnershipDedup(result.items as ProfileListItem[], ownedPaySet);
        amountCents = sums.amountCents;
      }
    } else {
      const pricing = await getCampaignBillableReportPricing(campaignId, userId);
      amountCents = pricing?.amountCents ?? campaign.handles_count * 100;
    }
    const valueBrl = amountCents / 100;

    const authUser = authDb.getById(userId);
    if (!authUser) {
      res.status(401).json({ error: 'Usuário não encontrado' });
      return;
    }
    const displayName = authUser.profile_handle ? `@${authUser.profile_handle}` : authUser.username;
    const email = authUser.username.includes('@') ? authUser.username : `user${userId}@payments.influencer.local`;
    const externalRef = `user_${userId}`;
    const cpfCnpjCamp = (body?.cpfCnpj ?? '').toString().replace(/\D/g, '');
    const campCustomerRes = await resolveAsaasCustomerId({
      externalRef,
      name: displayName,
      email,
      cpfCnpj: cpfCnpjCamp.length === 11 || cpfCnpjCamp.length === 14 ? cpfCnpjCamp : undefined,
    });
    if (!campCustomerRes.ok) {
      res.status(502).json(jsonAsaasCustomerGatewayError(campCustomerRes));
      return;
    }
    const asaasCustomerId = campCustomerRes.asaasCustomerId;
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + (billingType === 'BOLETO' ? 3 : 1));
    const dueStr = dueDate.toISOString().slice(0, 10);
    const paymentPayload = {
      customer: asaasCustomerId,
      value: valueBrl,
      dueDate: dueStr,
      billingType: billingType as 'PIX' | 'BOLETO',
      description: `Relatório - ${quantity} influenciadores`,
      externalReference: `report_${userId}_${campaignId.slice(0, 8)}_${Date.now()}`,
    };
    const asaasPayment = await asaas.createPayment(paymentPayload);
    const asaasPaymentId = asaasPayment?.id ?? null;
    const invoiceUrl = asaasPayment?.invoiceUrl ?? null;
    const bankSlipUrl = asaasPayment?.bankSlipUrl ?? null;
    const pixCopyPaste = await asaas.resolvePixCopyPasteAfterCreate(
      billingType as 'PIX' | 'BOLETO',
      asaasPaymentId,
      asaasPayment
    );
    const hasPaymentUrl = Boolean(bankSlipUrl || pixCopyPaste);
    if (!hasPaymentUrl || !asaasPaymentId) {
      res.status(502).json({ error: 'Não foi possível gerar o pagamento. Tente novamente.' });
      return;
    }
    paymentsDb.createPayment({
      userId,
      asaasPaymentId,
      asaasCustomerId,
      amountCents,
      creditsGranted: 0,
      status: 'PENDING',
      billingType: billingType as 'PIX' | 'BOLETO',
      invoiceUrl,
      bankSlipUrl,
      pixCopyPaste,
      campaignId,
      reportDesiredCount: quantity < campaign.handles_count ? quantity : undefined,
    });
    res.status(201).json({
      bankSlipUrl,
      pixCopyPaste,
      invoiceUrl,
      billingType,
      amountCents,
      valueBrl,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Paga a campanha com créditos (1 crédito por influenciador). Libera o relatório sem PIX/boleto. */
app.post('/api/campaigns/:id/pay-with-credits', async (req: RequestWithAuth, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Login necessário' });
      return;
    }
    const campaignId = String(req.params.id ?? '').trim();
    if (!isCampaignIdGuid(campaignId)) {
      res.status(400).json({ error: 'ID da campanha inválido' });
      return;
    }
    const userId = Number(req.user.sub);
    const campaign = creditsCampaignsDb.getCampaignIfActive(campaignId, userId);
    if (!campaign) {
      res.status(404).json({ error: 'Campanha não encontrada ou expirada' });
      return;
    }
    if (campaign.payment_status === 'paid') {
      res.status(400).json({ error: 'Esta campanha já foi paga.' });
      return;
    }
    const handlesList = creditsCampaignsDb.getCampaignHandlesIfActive(campaignId, userId);
    if (!handlesList || handlesList.length === 0) {
      res.status(404).json({ error: 'Campanha sem perfis' });
      return;
    }
    const bodyQuantity = req.body && typeof (req.body as { quantity?: number }).quantity === 'number'
      ? Math.floor((req.body as { quantity: number }).quantity)
      : null;
    const prefixLen =
      bodyQuantity != null && bodyQuantity >= 1 && bodyQuantity <= campaign.handles_count
        ? bodyQuantity
        : campaign.handles_count;
    const ownedSet = new Set(creditsCampaignsDb.getAllPaidHandlesUnion(userId));
    const creditsNeeded = countBillableCreditsForHandlePrefix(handlesList, prefixLen, ownedSet);
    if (creditsNeeded === 0) {
      if (prefixLen < campaign.handles_count) {
        creditsCampaignsDb.setCampaignQuantity(campaignId, userId, prefixLen);
      }
      creditsCampaignsDb.setCampaignCreditsUsed(campaignId, userId, 0);
      creditsCampaignsDb.setCampaignPaymentStatus(campaignId, userId, 'paid');
      res.json({ ok: true, creditsUsed: 0 });
      return;
    }
    const balance = creditsCampaignsDb.getBalance(userId);
    if (balance < creditsNeeded) {
      res.status(402).json({
        error: `Créditos insuficientes. Necessário: ${creditsNeeded}, saldo: ${balance}`,
        code: 'INSUFFICIENT_CREDITS',
        required: creditsNeeded,
        balance,
      });
      return;
    }
    if (!creditsCampaignsDb.spendCredits(userId, creditsNeeded, 'campaign', campaignId)) {
      res.status(402).json({ error: 'Falha ao debitar créditos', code: 'DEBIT_FAILED' });
      return;
    }
    if (!creditsCampaignsDb.setCampaignCreditsUsed(campaignId, userId, creditsNeeded)) {
      res.status(500).json({ error: 'Falha ao atualizar campanha' });
      return;
    }
    if (prefixLen < campaign.handles_count) {
      creditsCampaignsDb.setCampaignQuantity(campaignId, userId, prefixLen);
    }
    creditsCampaignsDb.setCampaignPaymentStatus(campaignId, userId, 'paid');
    res.json({ ok: true, creditsUsed: creditsNeeded });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Parseia query params para ProfilesSearchQuery (mesma lógica da busca principal, sem q/categories). */
function buildCampaignProfilesQuery(
  req: { query: Record<string, unknown> },
  opts?: { maxLimit?: number }
): ProfilesSearchQuery {
  const parseNumList = (v: unknown): number[] | undefined => {
    if (v == null) return undefined;
    if (Array.isArray(v)) return v.map(Number).filter(Number.isFinite);
    if (typeof v === 'string') return v.split(',').map((x) => Number(x.trim())).filter(Number.isFinite);
    return undefined;
  };
  const parseStrList = (v: unknown): string[] | undefined => {
    if (v == null) return undefined;
    if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
    if (typeof v === 'string') return v.split(',').map((x) => x.trim()).filter(Boolean);
    return undefined;
  };
  const optStrList = (v: unknown): string[] | undefined => {
    const a = parseStrList(v);
    return a?.length ? a : undefined;
  };
  const llmFamilyRaw = req.query.llmFamilySafe;
  const llmIsFamilySafe =
    llmFamilyRaw === '1' || llmFamilyRaw === 'true'
      ? true
      : llmFamilyRaw === '0' || llmFamilyRaw === 'false'
        ? false
        : undefined;
  const llmAdultRaw = req.query.llmAdultContent;
  const llmIsAdultContent =
    llmAdultRaw === '1' || llmAdultRaw === 'true'
      ? true
      : llmAdultRaw === '0' || llmAdultRaw === 'false'
        ? false
        : undefined;
  const minFollowers = req.query.minFollowers != null ? Number(req.query.minFollowers) : undefined;
  const maxFollowers = req.query.maxFollowers != null ? Number(req.query.maxFollowers) : undefined;
  const minEngagementRate = req.query.minEngagementRate != null ? Number(req.query.minEngagementRate) : undefined;
  const minAvgLikes = req.query.minAvgLikes != null ? Number(req.query.minAvgLikes) : undefined;
  const minPostsCount = req.query.minPostsCount != null ? Number(req.query.minPostsCount) : undefined;
  const contentTypes = req.query.contentTypes as string | string[] | undefined;
  const engagementRateBuckets = req.query.engagementRateBuckets;
  const avgLikesBuckets = req.query.avgLikesBuckets;
  const postsCountBuckets = req.query.postsCountBuckets;
  const activationFilter = req.query.activationFilter;
  const cities = req.query.cities;
  const states = req.query.states;
  const neighborhoods = req.query.neighborhoods;
  const socialNetworks = req.query.socialNetworks;
  const excludePrivate = req.query.excludePrivate === 'true';
  const accountTypeFilter = req.query.accountTypeFilter;
  const sizeFilter = req.query.sizeFilter;
  const sort = (req.query.sort as string) || 'engagement_desc';
  const maxLimit = opts?.maxLimit ?? 200;
  const limit = Math.min(Math.max(0, Number(req.query.limit) || 50), maxLimit);
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const q = (req.query.q as string)?.trim() || undefined;
  const sizeFilterArr = Array.isArray(sizeFilter) ? sizeFilter.map(String).filter(Boolean) : typeof sizeFilter === 'string' ? sizeFilter.split(',').map((x) => x.trim()).filter(Boolean) : undefined;
  return {
    q,
    minFollowers: Number.isFinite(minFollowers) ? minFollowers : undefined,
    maxFollowers: Number.isFinite(maxFollowers) ? maxFollowers : undefined,
    minEngagementRate: Number.isFinite(minEngagementRate) ? minEngagementRate : undefined,
    minAvgLikes: Number.isFinite(minAvgLikes) ? minAvgLikes : undefined,
    minPostsCount: Number.isFinite(minPostsCount) ? minPostsCount : undefined,
    engagementRateBuckets: Array.isArray(engagementRateBuckets) ? engagementRateBuckets.map(Number).filter(Number.isFinite) : typeof engagementRateBuckets === 'string' ? engagementRateBuckets.split(',').map((x) => Number(x.trim())).filter(Number.isFinite) : undefined,
    avgLikesBuckets: Array.isArray(avgLikesBuckets) ? avgLikesBuckets.map(Number).filter(Number.isFinite) : typeof avgLikesBuckets === 'string' ? avgLikesBuckets.split(',').map((x) => Number(x.trim())).filter(Number.isFinite) : undefined,
    postsCountBuckets: Array.isArray(postsCountBuckets) ? postsCountBuckets.map(Number).filter(Number.isFinite) : typeof postsCountBuckets === 'string' ? postsCountBuckets.split(',').map((x) => Number(x.trim())).filter(Number.isFinite) : undefined,
    activationFilter: Array.isArray(activationFilter) ? activationFilter.map(String).filter(Boolean) : typeof activationFilter === 'string' ? activationFilter.split(',').map((x) => x.trim()).filter(Boolean) : undefined,
    cities: Array.isArray(cities) ? cities.map(String).filter(Boolean) : typeof cities === 'string' ? cities.split(',').map((x) => x.trim()).filter(Boolean) : undefined,
    states: Array.isArray(states) ? states.map(String).filter(Boolean) : typeof states === 'string' ? states.split(',').map((x) => x.trim()).filter(Boolean) : undefined,
    neighborhoods: Array.isArray(neighborhoods) ? neighborhoods.map(String).filter(Boolean) : typeof neighborhoods === 'string' ? neighborhoods.split(',').map((x) => x.trim()).filter(Boolean) : undefined,
    socialNetworks: Array.isArray(socialNetworks) ? socialNetworks.map(String).filter(Boolean) : typeof socialNetworks === 'string' ? socialNetworks.split(',').map((x) => x.trim()).filter(Boolean) : undefined,
    excludePrivate,
    accountTypeFilter: parseNumList(accountTypeFilter)?.filter((n) => [1, 2, 3].includes(n)),
    contentTypes: Array.isArray(contentTypes) ? contentTypes.map(String).filter(Boolean) : typeof contentTypes === 'string' ? contentTypes?.split(',').map((x) => x.trim()).filter(Boolean) : undefined,
    pricingFeed: parseNumList(req.query.pricingFeed),
    pricingReels: parseNumList(req.query.pricingReels),
    pricingStory: parseNumList(req.query.pricingStory),
    pricingDestaque: parseNumList(req.query.pricingDestaque),
    costTierFilter: parseCostTierFilter(req.query.costTierFilter),
    sizeFilter: sizeFilterArr?.length ? sizeFilterArr : undefined,
    llmProfileType: optStrList(req.query.llmProfileType),
    llmMainCategory: optStrList(req.query.llmMainCategory),
    llmGender: optStrList(req.query.llmGender),
    llmLanguage: optStrList(req.query.llmLanguage),
    llmAudienceType: optStrList(req.query.llmAudienceType),
    llmToneOfVoice: optStrList(req.query.llmToneOfVoice),
    llmRiskLevel: optStrList(req.query.llmRiskLevel),
    ...(llmIsFamilySafe !== undefined ? { llmIsFamilySafe } : {}),
    ...(llmIsAdultContent !== undefined ? { llmIsAdultContent } : {}),
    sort,
    limit,
    offset,
  };
}

/** Admin: lista todos os perfis (índice) com filtros iguais à busca de campanha + facetas LLM; até 500 por página. */
app.get('/api/admin/influencers', requireScopes('adm'), rateLimitDataApi, async (req: RequestWithAuth, res: Response) => {
  try {
    const base = buildCampaignProfilesQuery(req);
    const limitParam = Number(req.query.limit);
    const offsetParam = Number(req.query.offset);
    const adminLimit = Math.min(Math.max(1, Number.isFinite(limitParam) ? limitParam : 50), 500);
    const adminOffset = Math.max(0, Number.isFinite(offsetParam) ? offsetParam : 0);
    const categoriesRaw = req.query.categories;
    const categories =
      Array.isArray(categoriesRaw)
        ? categoriesRaw.map(String).filter(Boolean)
        : typeof categoriesRaw === 'string'
          ? categoriesRaw.split(',').map((x) => x.trim()).filter(Boolean)
          : undefined;
    const query: ProfilesSearchQuery = {
      ...base,
      limit: adminLimit,
      offset: adminOffset,
      ...(categories?.length ? { categories } : {}),
      includeFacets: req.query.includeFacets === 'false' ? false : true,
    };
    const result = await searchProfiles(db, query, { allowLargeLimit: true });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ total: result.total, items: prepareProfileListItemsForApiResponse(result.items, req), facets: result.facets });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Cache do contexto (lista completa) por campanha para aplicar filtros em cima sem refazer a busca. TTL 5 min. */
const CAMPAIGN_CONTEXT_CACHE_TTL_MS = 5 * 60 * 1000;
const campaignContextCache = new Map<
  string,
  { items: ProfileListItem[]; baseFacets: ProfilesSearchFacets; ts: number }
>();

function getCachedCampaignContext(campaignId: string): {
  items: ProfileListItem[];
  baseFacets: ProfilesSearchFacets;
} | null {
  const entry = campaignContextCache.get(campaignId);
  if (!entry || Date.now() - entry.ts > CAMPAIGN_CONTEXT_CACHE_TTL_MS) return null;
  return { items: entry.items, baseFacets: entry.baseFacets };
}

function setCachedCampaignContext(
  campaignId: string,
  items: ProfileListItem[],
  baseFacets: ProfilesSearchFacets
): void {
  campaignContextCache.set(campaignId, { items, baseFacets, ts: Date.now() });
}

/** Invalida listagens agregadas de campanha (ex.: após purge admin ou mudança em handles_json). */
function clearCampaignContextCache(): void {
  campaignContextCache.clear();
}

/** Nome do header para contexto de campanha. Obrigatório ao acessar dados de outro influenciador. */
const X_CAMPAIGN_ID = 'x-campaign-id';

function normalizeHandle(h: string | undefined): string {
  return (h ?? '').replace(/^@/, '').trim().toLowerCase();
}

/** Resolve profile_ref (UUID) ou handle legado → handle interno (nunca retornar ao cliente). */
function resolveProfileParam(identifier: string | undefined): string | null {
  return profileRefDb.resolveToHandle(identifier ?? '');
}

function profileRefForHandle(handle: string): string {
  return profileRefDb.getOrCreateRef(normalizeHandle(handle));
}

/** Acesso completo ao perfil (assinatura ativa, campanha paga com o handle, próprio perfil, favorito, adm). */
function hasFullProfileDataAccess(req: RequestWithAuth, profileHandle: string): boolean {
  const handle = normalizeHandle(profileHandle);
  if (!handle || !req.user) return false;
  const user = req.user;
  if (canEditProfile(user, handle)) return true;
  const loggedHandle = normalizeHandle(user.profile_handle ?? '');
  if (loggedHandle && loggedHandle === handle) return true;
  const userId = Number(user.sub);
  if (!Number.isFinite(userId)) return false;
  const favorites = sqlite.getFavoriteHandles(userId);
  if (favorites.some((h) => normalizeHandle(h) === handle)) return true;
  if (user.scope === 'assinante' && paymentsDb.hasActivePlanSubscription(userId)) return true;
  const campaignIdRaw = (req.headers[X_CAMPAIGN_ID] ?? req.headers['x-campaign-id']) as string | undefined;
  const campaignId = typeof campaignIdRaw === 'string' ? campaignIdRaw.trim() : '';
  if (campaignId && campaignId.toLowerCase() !== 'all' && isCampaignIdGuid(campaignId)) {
    const handles = creditsCampaignsDb.getCampaignHandlesIfActiveAndPaid(campaignId, userId);
    if (handles?.some((h) => normalizeHandle(h) === handle)) return true;
  }
  return false;
}

/** Prévia pública (hero + LLM): anônimo ou sem direito de ver dados completos — logado ou não. */
function shouldUsePublicProfilePreview(req: RequestWithAuth, profileHandle: string): boolean {
  return !hasFullProfileDataAccess(req, profileHandle);
}

/**
 * Middleware: autoriza acesso a dados de um perfil somente se (1) o usuário logado é o dono do perfil, ou
 * (2) o header X-Campaign-Id é enviado com um GUID de campanha do usuário que contenha o handle, ou
 * (3) o usuário é assinante com plano ativo (incl. período de trial da 1ª cobrança).
 * Preenche req.allowedCampaignId quando liberado via campanha.
 * getHandle: extrai o handle da requisição (ex.: req => req.params.handle ou req => req.query.profile).
 * requireHandle: se true, retorna 403 quando getHandle retorna vazio (ex.: GET /api/posts sem profile).
 * requireAuth: se false, quando não há usuário chama next() (handler pode retornar dados redigidos); default true.
 */
function requireProfileOrCampaign(
  getHandle: (req: RequestWithAuth) => string | undefined,
  options?: { requireHandle?: boolean; requireAuth?: boolean }
) {
  const requireAuth = options?.requireAuth !== false;
  return (req: RequestWithAuth, res: Response, next: () => void): void => {
    if (!req.user) {
      if (!requireAuth) {
        next();
        return;
      }
      res.status(401).json({ error: 'Login necessário', code: 'UNAUTHORIZED' });
      return;
    }
    const rawHandle = getHandle(req);
    const handle = resolveProfileParam(rawHandle ?? '') ?? '';
    if (!handle) {
      if (options?.requireHandle) {
        res.status(403).json({
          error: 'Para acessar dados de perfil, informe profile_ref ou use o header X-Campaign-Id em uma rota de campanha.',
          code: 'PROFILE_REF_REQUIRED',
        });
        return;
      }
      next();
      return;
    }
    // Adm ou próprio influenciador: não exige X-Campaign-Id (permitir ativação e visualização de perfil).
    if (canEditProfile(req.user, handle)) {
      (req as RequestWithAuth).allowedCampaignId = undefined;
      next();
      return;
    }
    const loggedHandle = normalizeHandle(req.user.profile_handle ?? '');
    if (loggedHandle && loggedHandle === handle) {
      (req as RequestWithAuth).allowedCampaignId = undefined;
      next();
      return;
    }
    const userId = Number(req.user.sub);
    const favoriteHandles = sqlite.getFavoriteHandles(userId);
    if (favoriteHandles.some((h) => normalizeHandle(h) === handle)) {
      (req as RequestWithAuth).allowedCampaignId = undefined;
      next();
      return;
    }
    if (req.user.scope === 'assinante' && paymentsDb.hasActivePlanSubscription(userId)) {
      (req as RequestWithAuth).allowedCampaignId = undefined;
      next();
      return;
    }
    const campaignIdRaw = (req.headers[X_CAMPAIGN_ID] ?? req.headers['x-campaign-id']) as string | undefined;
    const campaignId = typeof campaignIdRaw === 'string' ? campaignIdRaw.trim() : '';
    if (!campaignId) {
      res.status(403).json({
        error: 'Para acessar dados de outro influenciador, envie o header X-Campaign-Id com o ID de uma campanha que contenha esse perfil.',
        code: 'CAMPAIGN_ID_REQUIRED',
      });
      return;
    }
    if (campaignId.toLowerCase() === 'all') {
      (req as RequestWithAuth).allowedCampaignId = 'all';
      next();
      return;
    }
    if (!isCampaignIdGuid(campaignId)) {
      res.status(403).json({
        error: 'Para acessar dados de outro influenciador, envie o header X-Campaign-Id com o ID de uma campanha que contenha esse perfil.',
        code: 'CAMPAIGN_ID_REQUIRED',
      });
      return;
    }
    const handles = creditsCampaignsDb.getCampaignHandlesIfActive(campaignId, userId);
    if (!handles || !handles.some((h) => normalizeHandle(h) === handle)) {
      res.status(403).json({
        error: 'Perfil não encontrado nesta campanha, campanha expirada ou inválida.',
        code: 'PROFILE_NOT_IN_CAMPAIGN',
      });
      return;
    }
    (req as RequestWithAuth).allowedCampaignId = campaignId;
    next();
  };
}

/** Middleware: exige header X-Campaign-Id válido e que a campanha pertença ao usuário. Preenche req.allowedCampaignId. */
function requireCampaignIdHeader(req: RequestWithAuth, res: Response, next: () => void): void {
  if (!req.user) {
    res.status(401).json({ error: 'Login necessário', code: 'UNAUTHORIZED' });
    return;
  }
  const raw = (req.headers[X_CAMPAIGN_ID] ?? req.headers['x-campaign-id']) as string | undefined;
  const campaignId = typeof raw === 'string' ? raw.trim() : '';
  if (!campaignId) {
    res.status(403).json({
      error: 'Envie o header X-Campaign-Id com o ID de uma campanha válida.',
      code: 'CAMPAIGN_ID_REQUIRED',
    });
    return;
  }
  const userId = Number(req.user.sub);
  if (campaignId.toLowerCase() === 'all') {
    (req as RequestWithAuth).allowedCampaignId = 'all';
    next();
    return;
  }
  if (!isCampaignIdGuid(campaignId)) {
    res.status(403).json({
      error: 'Envie o header X-Campaign-Id com o ID de uma campanha válida.',
      code: 'CAMPAIGN_ID_REQUIRED',
    });
    return;
  }
  const campaign = creditsCampaignsDb.getCampaignIfActive(campaignId, userId);
  if (!campaign) {
    res.status(403).json({ error: 'Campanha não encontrada, expirada ou sem acesso.', code: 'CAMPAIGN_NOT_FOUND' });
    return;
  }
  (req as RequestWithAuth).allowedCampaignId = campaignId;
  next();
}

/** Listagem agregada: base completa de perfis (mesma experiência da campanha). */
app.get('/api/campaigns/all/profiles', rateLimitDataApi, async (req: RequestWithAuth, res: Response) => {
  try {
    const cacheKey = 'all-base:public-v2';
    const query = buildCampaignProfilesQuery(req, { maxLimit: 10000 });
    const ctxAll = getCachedCampaignContext(cacheKey);
    let contextItems: ProfileListItem[];
    let campaignBaseFacets: ProfilesSearchFacets | undefined;
    if (ctxAll == null) {
      const fullResult = await searchProfiles(
        db,
        { limit: 10000, offset: 0, sort: 'engagement_desc' },
        { skipInstagramBi: true, allowLargeLimit: true, includeProfilesWithoutLlm: true, skipAuxBackfill: true },
      );
      contextItems = fullResult.items;
      campaignBaseFacets = fullResult.facets;
      if (contextItems.length > 0) setCachedCampaignContext(cacheKey, contextItems, fullResult.facets);
    } else {
      contextItems = ctxAll.items;
      campaignBaseFacets = ctxAll.baseFacets;
    }
    const result = await searchProfiles(db, query, {
      initialItems: contextItems,
      ...(campaignBaseFacets != null ? { campaignBaseFacets } : {}),
    });
    res.json({ total: result.total, items: prepareProfileListItemsForApiResponse(result.items, req), facets: result.facets });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Listagem de perfis de uma campanha (paginação + filtros iguais à busca principal). Com pagamento pendente: retorna também items para preview/checkout no cliente (facets + total + pricePreview inalterados). */
app.get('/api/campaigns/:id/profiles', rateLimitDataApi, async (req: RequestWithAuth, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Login necessário' });
      return;
    }
    const campaignId = String(req.params.id ?? '').trim();
    if (!isCampaignIdGuid(campaignId)) {
      res.status(400).json({ error: 'ID da campanha inválido' });
      return;
    }
    const userId = Number(req.user.sub);
    const campaign = creditsCampaignsDb.getCampaignIfActive(campaignId, userId);
    if (!campaign) {
      res.status(404).json({ error: 'Campanha não encontrada, expirada ou sem perfis' });
      return;
    }
    const handles = creditsCampaignsDb.getCampaignHandlesIfActive(campaignId, userId);
    if (!handles || handles.length === 0) {
      res.status(404).json({ error: 'Campanha não encontrada, expirada ou sem perfis' });
      return;
    }
    const payment = paymentsDb.getByCampaignId(campaignId, userId);
    const pendingPayment = campaign.payment_status === 'pending';

    const query = buildCampaignProfilesQuery(req, { maxLimit: 10000 });
    const ctxCamp = getCachedCampaignContext(campaignId);
    let contextItems: ProfileListItem[];
    let campaignBaseFacets: ProfilesSearchFacets | undefined;
    if (ctxCamp == null) {
      const fullResult = await searchProfiles(
        db,
        { limit: 10000, offset: 0, sort: 'engagement_desc' },
        { restrictToHandles: handles, skipInstagramBi: true },
      );
      contextItems = fullResult.items;
      campaignBaseFacets = fullResult.facets;
      if (contextItems.length > 0) setCachedCampaignContext(campaignId, contextItems, fullResult.facets);
    } else {
      contextItems = ctxCamp.items;
      campaignBaseFacets = ctxCamp.baseFacets;
    }
    const queryForResult = pendingPayment ? { ...query, limit: 10000, offset: 0 } : query;
    const result = await searchProfiles(db, queryForResult, {
      initialItems: contextItems,
      ...(campaignBaseFacets != null ? { campaignBaseFacets } : {}),
      ...(pendingPayment ? { skipInstagramBi: true } : {}),
    });

    if (pendingPayment) {
      let activatedCount = 0;
      let totalLikes = 0;
      let totalComments = 0;
      let totalViews = 0;
      let totalFollowers = 0;
      let postsCount = 0;
      let engSum = 0;
      let engCount = 0;
      for (const item of result.items) {
        const it = item as ProfileListItem;
        const act = it.activation;
        if (act?.city && String(act.city).trim()) activatedCount++;
        totalFollowers += it.followers_count ?? 0;
        const eng = it.engagement;
        if (eng) {
          totalLikes += eng.total_likes ?? 0;
          totalComments += eng.total_comments ?? 0;
          totalViews += eng.total_views ?? 0;
          postsCount += eng.posts_count ?? 0;
          if (Number.isFinite(eng.engagement_rate)) {
            engSum += eng.engagement_rate;
            engCount++;
          }
        }
      }
      const notActivatedCount = result.items.length - activatedCount;
      const ownedElsewhere = new Set(creditsCampaignsDb.getAllPaidHandlesUnion(userId));
      const priceSums = sumReportPriceWithOwnershipDedup(result.items as ProfileListItem[], ownedElsewhere);
      const amountCents = priceSums.amountCents;
      const avgEngagementRate = engCount > 0 ? Math.round((engSum / engCount) * 100) / 100 : 0;
      const billableProfileCount = result.items.length - priceSums.alreadyOwnedCount;
      res.json({
        total: result.total,
        items: prepareProfileListItemsForApiResponse(result.items, req),
        facets: result.facets,
        pricePreview: {
          amountCents,
          valueBrl: amountCents / 100,
          activatedCount,
          notActivatedCount,
          totalLikes,
          totalComments,
          totalViews,
          totalFollowers,
          postsCount,
          avgEngagementRate,
          originalAmountCents: priceSums.originalAmountCents,
          originalValueBrl: priceSums.originalAmountCents / 100,
          alreadyOwnedCount: priceSums.alreadyOwnedCount,
          billableProfileCount,
          chargedActivatedCount: priceSums.chargedActivatedCount,
          chargedNotActivatedCount: priceSums.chargedNotActivatedCount,
        },
      });
      return;
    }
    res.json({ total: result.total, items: prepareProfileListItemsForApiResponse(result.items, req), facets: result.facets });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Perfil na visão agregada "Todos" (base completa). */
app.get('/api/campaigns/all/profiles/:handle', rateLimitDataApi, async (req: RequestWithAuth, res: Response) => {
  try {
    const handle = resolveProfileParam(req.params.handle);
    if (!handle) {
      res.status(404).json({ error: 'Perfil não encontrado' });
      return;
    }
    const ref = profileRefForHandle(handle);
    const value = await db.get('profile', handle);
    if (value == null) {
      res.status(404).json({ error: 'Perfil não encontrado' });
      return;
    }
    const profile = value as Record<string, unknown>;
    res.setHeader('Cache-Control', 'no-store');
    if (shouldUsePublicProfilePreview(req, handle)) {
      const summary = await getProfileSummary(db, handle);
      if (summary == null) {
        res.status(404).json({ error: 'Perfil não encontrado' });
        return;
      }
      res.json(
        buildPublicProfilePreview(
          handle,
          summary.profile,
          summary.engagement as unknown as Record<string, unknown>,
          await getProfileEngagementByType(db, handle)
        )
      );
      return;
    }
    res.json(
      sanitizeProfileForClient(profile, {
        profileRef: ref,
        handle,
        includeHandleForAdmin: shouldIncludeHandleInApi(req),
      })
    );
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Perfil de um influenciador dentro de uma campanha. Só retorna dados se o perfil estiver na campanha. */
app.get('/api/campaigns/:id/profiles/:handle', rateLimitDataApi, async (req: RequestWithAuth, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Login necessário' });
      return;
    }
    const campaignId = String(req.params.id ?? '').trim();
    if (!isCampaignIdGuid(campaignId)) {
      res.status(400).json({ error: 'ID da campanha inválido' });
      return;
    }
    const handle = resolveProfileParam(req.params.handle);
    if (!handle) {
      res.status(404).json({ error: 'Perfil não encontrado' });
      return;
    }
    const ref = profileRefForHandle(handle);
    const userId = Number(req.user.sub);
    const handles = creditsCampaignsDb.getCampaignHandlesIfActiveAndPaid(campaignId, userId);
    if (!handles || handles.length === 0) {
      res.status(404).json({ error: 'Campanha não encontrada, expirada, sem pagamento ou sem perfis' });
      return;
    }
    const handleInCampaign = handles.some((h) => String(h).replace(/^@/, '').trim().toLowerCase() === handle);
    if (!handleInCampaign) {
      res.status(404).json({ error: 'Perfil não encontrado nesta campanha' });
      return;
    }
    const value = await db.get('profile', handle);
    if (value == null) {
      res.status(404).json({ error: 'Perfil não encontrado' });
      return;
    }
    const profile = value as Record<string, unknown>;
    res.setHeader('Cache-Control', 'no-store');
    res.json(
      sanitizeProfileForClient(profile, {
        profileRef: ref,
        handle,
        includeHandleForAdmin: shouldIncludeHandleInApi(req),
      })
    );
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Ativação na visão agregada "Todos" (base completa). */
app.get('/api/campaigns/all/profiles/:handle/activation', rateLimitDataApi, async (req: RequestWithAuth, res: Response) => {
  try {
    const handle = resolveProfileParam(req.params.handle);
    if (!handle) {
      res.status(404).json({ error: 'Perfil não encontrado' });
      return;
    }
    const data = sqlite.getActivation(handle);
    if (data == null) {
      res.status(200).json({});
      return;
    }
    if (isPricingEmpty(data.pricing as Record<string, unknown> | undefined)) {
      try {
        const profile = await db.loadByHandle(handle);
        const followers = getFollowersFromProfile(profile as Record<string, unknown> | null);
        const suggested = getSuggestedPricingFromFollowers(followers);
        (data as { pricing?: Record<string, string> }).pricing = suggestedPricingToActivationFormat(suggested);
      } catch (_) {
        /* ignore */
      }
    }
    res.setHeader('Cache-Control', 'no-store');
    if (shouldUsePublicProfilePreview(req, handle)) {
      res.json({ _redacted: true, _all_base_preview: true });
      return;
    }
    res.json(redactContactInfoInActivation(data as unknown as Record<string, unknown>));
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Ativação do perfil dentro de uma campanha. Só retorna dados se o perfil estiver na campanha. */
app.get('/api/campaigns/:id/profiles/:handle/activation', rateLimitDataApi, async (req: RequestWithAuth, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Login necessário' });
      return;
    }
    const campaignId = String(req.params.id ?? '').trim();
    if (!isCampaignIdGuid(campaignId)) {
      res.status(400).json({ error: 'ID da campanha inválido' });
      return;
    }
    const handle = resolveProfileParam(req.params.handle);
    if (!handle) {
      res.status(404).json({ error: 'Perfil não encontrado' });
      return;
    }
    const userId = Number(req.user.sub);
    const handles = creditsCampaignsDb.getCampaignHandlesIfActiveAndPaid(campaignId, userId);
    if (!handles || handles.length === 0) {
      res.status(404).json({ error: 'Campanha não encontrada, expirada, sem pagamento ou sem perfis' });
      return;
    }
    const handleInCampaign = handles.some((h) => String(h).replace(/^@/, '').trim().toLowerCase() === handle);
    if (!handleInCampaign) {
      res.status(404).json({ error: 'Perfil não encontrado nesta campanha' });
      return;
    }
    const data = sqlite.getActivation(handle);
    if (data == null) {
      res.status(200).json({});
      return;
    }
    if (isPricingEmpty(data.pricing as Record<string, unknown> | undefined)) {
      try {
        const profile = await db.loadByHandle(handle);
        const followers = getFollowersFromProfile(profile as Record<string, unknown> | null);
        const suggested = getSuggestedPricingFromFollowers(followers);
        (data as { pricing?: Record<string, string> }).pricing = suggestedPricingToActivationFormat(suggested);
      } catch (_) {
        // ignorar
      }
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json(redactContactInfoInActivation(data as unknown as Record<string, unknown>));
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Admin: adicionar créditos a um usuário. */
app.post('/api/admin/users/:userId/credits', requireScopes('adm'), async (req: RequestWithAuth, res: Response) => {
  try {
    const targetUserId = Number(req.params.userId);
    const body = req.body as { amount?: number };
    const amount = Number(body?.amount);
    if (!Number.isFinite(targetUserId) || !Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ error: 'userId e amount (número positivo) obrigatórios' });
      return;
    }
    creditsCampaignsDb.addCredits(targetUserId, amount, 'admin_add', undefined);
    const balance = creditsCampaignsDb.getBalance(targetUserId);
    res.json({ balance, added: amount });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Dados de ativação do perfil. Anônimo: vazio/redigido; logado: mesmas regras de acesso que GET /api/profiles/:handle. */
app.get(
  '/api/profiles/:handle/activation',
  rateLimitDataApi,
  requireProfileOrCampaign((req) => req.params.handle, { requireAuth: false }),
  async (req: RequestWithAuth, res: Response) => {
    try {
      const handle = resolveProfileParam(req.params.handle);
      if (!handle) {
        res.status(404).json({ error: 'Perfil não encontrado' });
        return;
      }
      if (shouldUsePublicProfilePreview(req, handle)) {
        res.status(200).json({ _redacted: true, _all_base_preview: true });
        return;
      }
      const data = sqlite.getActivation(handle);
      if (data == null) {
        res.status(200).json({});
        return;
      }
      if (isPricingEmpty(data.pricing as Record<string, unknown> | undefined)) {
        try {
          const profile = await db.loadByHandle(handle);
          const followers = getFollowersFromProfile(profile as Record<string, unknown> | null);
          const suggested = getSuggestedPricingFromFollowers(followers);
          (data as { pricing?: Record<string, string> }).pricing = suggestedPricingToActivationFormat(suggested);
        } catch (_) {
          // Se não conseguir carregar perfil (ex.: handle não existe no RocksDB), mantém pricing vazio
        }
      }
      res.json(redactContactInfoInActivation(data as unknown as Record<string, unknown>));
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  }
);

app.put('/api/profiles/:handle/activation', async (req: RequestWithAuth, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Não autenticado', code: 'UNAUTHORIZED' });
      return;
    }
    const handle = resolveProfileParam(req.params.handle);
    if (!handle) {
      res.status(404).json({ error: 'Perfil não encontrado' });
      return;
    }
    if (!canEditProfile(req.user, handle)) {
      res.status(403).json({ error: 'Sem permissão para editar este perfil', code: 'FORBIDDEN' });
      return;
    }
    const existing = sqlite.getActivation(handle);
    const isFirstActivation = !existing || !existing.activated_at;

    const body = req.body as Record<string, unknown>;
    const pricing = body.pricing;
    const pricingObj =
      pricing != null && typeof pricing === 'object' && !Array.isArray(pricing)
        ? (pricing as Record<string, unknown>)
        : undefined;
    const contentType = body.content_type;
    const contentTypeArr =
      Array.isArray(contentType) ? contentType.filter((x): x is string => typeof x === 'string')
        : typeof contentType === 'string' ? (contentType ? [contentType] : undefined)
          : undefined;
    const influenceAudienceArr =
      Array.isArray(body.influence_audience) ? body.influence_audience.filter((x): x is string => typeof x === 'string')
        : typeof body.influence_audience === 'string' ? (body.influence_audience ? [body.influence_audience] : undefined)
          : undefined;
    const influenceAgeRangeArr =
      Array.isArray(body.influence_age_range) ? body.influence_age_range.filter((x): x is string => typeof x === 'string')
        : typeof body.influence_age_range === 'string' ? (body.influence_age_range ? [body.influence_age_range] : undefined)
          : undefined;
    const neighborhoodVal =
      Array.isArray(body.neighborhood)
        ? body.neighborhood.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean).join(', ')
        : typeof body.neighborhood === 'string' && body.neighborhood.trim()
          ? body.neighborhood.trim()
          : undefined;
    const city = typeof body.city === 'string' ? body.city.trim() : '';
    const state = typeof body.state === 'string' ? body.state.trim() : '';
    if (!city || !state) {
      res.status(400).json({ error: 'Cidade e estado (UF) são obrigatórios.' });
      return;
    }
    sqlite.saveActivation(handle, {
      address: typeof body.address === 'string' ? body.address : undefined,
      address_number: typeof body.address_number === 'string' ? body.address_number.trim() || undefined : undefined,
      zip_code: typeof body.zip_code === 'string' ? body.zip_code.trim() || undefined : undefined,
      city: city || undefined,
      state: state || undefined,
      neighborhood: neighborhoodVal || undefined,
      country: typeof body.country === 'string' ? body.country : undefined,
      allow_gifts: typeof body.allow_gifts === 'boolean' ? body.allow_gifts : undefined,
      whatsapp: typeof body.whatsapp === 'string' ? body.whatsapp : undefined,
      tiktok: typeof body.tiktok === 'string' ? body.tiktok : undefined,
      facebook: typeof body.facebook === 'string' ? body.facebook : undefined,
      linkedin: typeof body.linkedin === 'string' ? body.linkedin : undefined,
      twitter: typeof body.twitter === 'string' ? body.twitter : undefined,
      websites: typeof body.websites === 'string' ? body.websites : undefined,
      gender: typeof body.gender === 'string' ? body.gender : undefined,
      description: typeof body.description === 'string' ? body.description : undefined,
      about_topics: typeof body.about_topics === 'string' ? body.about_topics : undefined,
      pricing: pricingObj,
      content_type: contentTypeArr?.length ? contentTypeArr : undefined,
      influence_audience: influenceAudienceArr?.length ? influenceAudienceArr : undefined,
      influence_age_range: influenceAgeRangeArr?.length ? influenceAgeRangeArr : undefined,
      audience_gender: typeof body.audience_gender === 'string' ? body.audience_gender.trim() || undefined : undefined,
      brands_worked_with: typeof body.brands_worked_with === 'string' ? body.brands_worked_with.trim() || undefined : undefined,
    });
    const data = sqlite.getActivation(handle);

    //if (isFirstActivation) {
    if (!sqlite.getMessageTemplateByHash(WELCOME_QUEUE_HASH)) {
      try {
        sqlite.createMessageTemplate(WELCOME_QUEUE_HASH, WELCOME_DEFAULT_BODY, [WELCOME_QUEUE_HASH]);
        console.log(`[activation] template #${WELCOME_QUEUE_HASH} criado (não existia)`);
      } catch (_) {
        /* já existe */
      }
    }
    try {
      const template = sqlite.getMessageTemplateByHash(WELCOME_QUEUE_HASH);
      const delayMin = template ? Math.max(1, Math.min(999, template.send_delay_minutes ?? 1)) : 1;
      const scheduledAt = new Date(Date.now() + delayMin * 60 * 1000).toISOString();
      const queueId = sqlite.addToDirectQueue(handle, WELCOME_QUEUE_HASH, scheduledAt);
      if (queueId > 0) {
        console.log(`[activation] @${handle} enfileirado #${WELCOME_QUEUE_HASH} (id=${queueId}, agendado ${delayMin} min)`);
      } else {
        console.log(`[activation] @${handle} não enfileirado #${WELCOME_QUEUE_HASH} (já recebido ou já pendente este hash)`);
      }
    } catch (e) {
      console.error('[activation] Envio de bem-vindo na fila:', e instanceof Error ? e.message : String(e));
    }
    //}

    res.json(data != null ? redactContactInfoInActivation(data as unknown as Record<string, unknown>) : {});
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Perfil por handle. Anônimo ou sem campanha paga: prévia redigida (hero + engagement); acesso completo conforme assinatura/campanha/próprio perfil. */
app.get(
  '/api/profiles/:handle',
  rateLimitDataApi,
  async (req: RequestWithAuth, res: Response) => {
    try {
      const handle = resolveProfileParam(req.params.handle);
      if (!handle) {
        res.status(404).json({ error: 'Perfil não encontrado' });
        return;
      }
      const ref = profileRefForHandle(handle);
      if (db.getProfileSearchAuxRowsForHandles([handle]).length === 0) {
        await syncProfileSearchIndexForHandle(db, handle).catch((e) =>
          console.warn('[profiles] lazy search index sync:', handle, e instanceof Error ? e.message : e)
        );
      }
      const summary = await getProfileSummary(db, handle);
      if (summary == null) {
        res.status(404).json({ error: 'Perfil não encontrado' });
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      if (shouldUsePublicProfilePreview(req, handle)) {
        res.json(
          buildPublicProfilePreview(
            handle,
            summary.profile,
            summary.engagement as unknown as Record<string, unknown>,
            await getProfileEngagementByType(db, handle)
          )
        );
        return;
      }
      const prof = summary.profile as Record<string, unknown>;
      const fc = getFollowersFromProfile(prof);
      if (fc > 0) prof.followers_count = fc;
      const out = sanitizeProfileForClient(prof, {
        profileRef: ref,
        handle,
        includeHandleForAdmin: shouldIncludeHandleInApi(req),
      });
      out.engagement = summary.engagement;
      out.engagementByType = await getProfileEngagementByType(db, handle);
      res.json(out);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  }
);

/** Resumo do perfil com engagement e BI. Anônimo: preview redigido; logado: mesmas regras de acesso que GET /api/profiles/:handle. */
app.get(
  '/api/profiles/:handle/summary',
  rateLimitDataApi,
  requireProfileOrCampaign((req) => req.params.handle, { requireAuth: false }),
  async (req: RequestWithAuth, res: Response) => {
    try {
      const handle = resolveProfileParam(req.params.handle);
      if (!handle) {
        res.status(404).json({ error: 'Perfil não encontrado' });
        return;
      }
      const ref = profileRefForHandle(handle);
      const summary = await getProfileSummary(db, handle);
      if (summary == null) {
        res.status(404).json({ error: 'Perfil não encontrado' });
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      if (shouldUsePublicProfilePreview(req, handle)) {
        res.json({
          profile: buildPublicProfilePreview(
            handle,
            summary.profile,
            summary.engagement as unknown as Record<string, unknown>,
            await getProfileEngagementByType(db, handle)
          ),
          engagement: summary.engagement,
        });
        return;
      }
      res.json({
        ...summary,
        profile: sanitizeProfileForClient(summary.profile as Record<string, unknown>, {
          profileRef: ref,
          handle,
          includeHandleForAdmin: shouldIncludeHandleInApi(req),
        }),
      });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  }
);

const MEDIA_TYPES = ['post', 'reel', 'tagged', 'highlight'] as const;

function parsePostMatchTypeFilters(typeQuery: string | undefined): string[] {
  if (!typeQuery || typeof typeQuery !== 'string') return [];
  return typeQuery
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((t): t is (typeof MEDIA_TYPES)[number] =>
      MEDIA_TYPES.includes(t as (typeof MEDIA_TYPES)[number])
    );
}

/** Deriva content_type do item: valor salvo ou chave handle:type:shortcode (retrocompat: handle:shortcode = post). */
function getContentTypeFromItem(key: string, value: Record<string, unknown>): string {
  const ct = value.content_type;
  if (typeof ct === 'string' && MEDIA_TYPES.includes(ct as (typeof MEDIA_TYPES)[number])) return ct;
  const parts = key.split(':');
  if (parts.length >= 3 && MEDIA_TYPES.includes(parts[1] as (typeof MEDIA_TYPES)[number])) return parts[1];
  return 'post';
}

/** Posts/reels/marcados/highlights do perfil. Requer profile=@handle; acesso conforme requireProfileOrCampaign. */
app.get(
  '/api/posts',
  rateLimitDataApi,
  requireProfileOrCampaign((req) => req.query.profile as string | undefined, { requireHandle: true, requireAuth: false }),
  async (req: RequestWithAuth, res: Response) => {
    try {
      const profileFilter = resolveProfileParam(req.query.profile as string | undefined) ?? '';
      const typeFilter = (req.query.type as string)?.toLowerCase();
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const offset = Number(req.query.offset) || 0;
      const items = profileFilter
        ? await db.getByBucket('post', profileFilter + ':')
        : await db.getByBucket('post');
      let filtered = items;
      if (typeFilter && MEDIA_TYPES.includes(typeFilter as (typeof MEDIA_TYPES)[number])) {
        filtered = items.filter(({ key, value }) => {
          const v = value as Record<string, unknown>;
          return getContentTypeFromItem(key, v) === typeFilter;
        });
      }
      const total = filtered.length;
      const slice = filtered.slice(offset, offset + limit).map(({ key, value }) => {
        const item = value as Record<string, unknown>;
        const post = item?.post as Record<string, unknown> | undefined;
        const content = item?.content as Record<string, unknown> | undefined;
        if (post && post.taken_at == null && content?.caption_created_at != null && typeof content.caption_created_at === 'number') {
          item.post = { ...post, taken_at: content.caption_created_at };
        }
        if (!item.content_type) item.content_type = getContentTypeFromItem(key, item);
        return { key, ...item };
      });
      if (profileFilter && shouldUsePublicProfilePreview(req, profileFilter)) {
        res.json({ total: 0, items: [], _redacted: true, _all_base_preview: true });
        return;
      }
      const ref = profileFilter ? profileRefForHandle(profileFilter) : '';
      const itemsOut = ref
        ? sanitizePostItemsForClient(slice, ref, shouldIncludeHandleInApi(req))
        : preparePostItemsForApiResponse(slice, req);
      res.json({ total, items: itemsOut });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  }
);

/** Handle do perfil a partir da chave do bucket post (ex.: `user:reel:ABC` → `user`). */
function postBucketKeyToHandle(key: string): string {
  const idx = key.indexOf(':');
  if (idx <= 0) return normalizeHandle(key);
  return normalizeHandle(key.slice(0, idx));
}

/** Shortcode normalizado para deduplicar a mesma mídia salva em chaves diferentes. */
function postItemShortcodeForDedupe(key: string, item: Record<string, unknown>): string {
  const post = item.post as Record<string, unknown> | undefined;
  const sc = post?.shortcode ?? (item as { shortcode?: unknown }).shortcode;
  if (sc != null && String(sc).trim()) return String(sc).trim().toLowerCase();
  const parts = key.split(':');
  if (parts.length >= 1) return String(parts[parts.length - 1] ?? '').toLowerCase();
  return key.toLowerCase();
}

/** Campos de `influencer` em post-matches, lidos do perfil indexado (RocksDB). */
function influencerFieldsFromProfile(profile: Record<string, unknown> | null | undefined): {
  followers_count: number;
  posts_per_week?: number;
  full_name?: string;
  profile_pic_url?: string;
  stable_profile_pic_url?: string;
  username?: string;
} {
  if (!profile || typeof profile !== 'object') {
    return { followers_count: 0 };
  }
  const followers_count = getFollowersFromProfile(profile);
  const topFull = typeof profile.full_name === 'string' ? profile.full_name.trim() : '';
  const data = profile.data as { user?: Record<string, unknown> } | undefined;
  const u = data?.user;
  const rootUser = profile.user;
  const uRoot =
    rootUser != null && typeof rootUser === 'object' && !Array.isArray(rootUser)
      ? (rootUser as Record<string, unknown>)
      : undefined;
  const userFull =
    (u && typeof u.full_name === 'string' ? String(u.full_name).trim() : '') ||
    (uRoot && typeof uRoot.full_name === 'string' ? String(uRoot.full_name).trim() : '') ||
    '';
  const full_name = topFull || userFull || undefined;
  const picTop =
    typeof profile.profile_pic_url === 'string' && profile.profile_pic_url.startsWith('http')
      ? profile.profile_pic_url
      : undefined;
  const picUser =
    u && typeof u.profile_pic_url === 'string' && u.profile_pic_url.startsWith('http')
      ? u.profile_pic_url
      : undefined;
  const picRoot =
    uRoot && typeof uRoot.profile_pic_url === 'string' && uRoot.profile_pic_url.startsWith('http')
      ? uRoot.profile_pic_url
      : undefined;
  const hd = u?.hd_profile_pic_url_info as { url?: string } | undefined;
  const hdRoot = uRoot?.hd_profile_pic_url_info as { url?: string } | undefined;
  const picHd = hd && typeof hd.url === 'string' && hd.url.startsWith('http') ? hd.url : undefined;
  const picHdRoot =
    hdRoot && typeof hdRoot.url === 'string' && hdRoot.url.startsWith('http') ? hdRoot.url : undefined;
  const profile_pic_url = picTop ?? picUser ?? picRoot ?? picHd ?? picHdRoot;
  const stableRaw = profile.stable_profile_pic_url;
  const stable_profile_pic_url =
    typeof stableRaw === 'string' && stableRaw.startsWith('http') ? stableRaw : undefined;
  const unameRaw = (profile.username ?? u?.username ?? uRoot?.username ?? profile.handle) as string | undefined;
  const username =
    typeof unameRaw === 'string' && unameRaw.trim() ? normalizeHandle(unameRaw) : undefined;
  const llmRaw = profile.llm;
  const llm =
    llmRaw != null && typeof llmRaw === 'object' && !Array.isArray(llmRaw) ? llmRaw : undefined;
  return {
    followers_count,
    ...(full_name ? { full_name } : {}),
    ...(profile_pic_url ? { profile_pic_url } : {}),
    ...(stable_profile_pic_url ? { stable_profile_pic_url } : {}),
    ...(username ? { username } : {}),
    ...(llm ? { llm } : {}),
  };
}

const POST_MATCHES_HANDLE_BATCH = 32;
const POST_MATCHES_FTS_HANDLE_LIMIT = Math.max(
  200,
  Number(process.env.POST_MATCHES_FTS_HANDLE_LIMIT) || 800
);
/** Máximo de perfis cujos posts são lidos no RocksDB por requisição (performance). */
const POST_MATCHES_MAX_SCAN_HANDLES = Math.max(
  40,
  Number(process.env.POST_MATCHES_MAX_SCAN_HANDLES) || 180
);
/** Posts além de offset+limit antes de parar o scan (1 post/perfil → poucos perfis bastam). */
const POST_MATCHES_EARLY_STOP_BUFFER = 4;

type PostMatchRowScratch = { key: string; value: Record<string, unknown>; ts: number; ct: string };

function postMatchTaggedRank(ct: string): number {
  return ct === 'tagged' ? 1 : 0;
}

/** true se `a` deve substituir `b` como melhor post do perfil. */
function isBetterPostMatchRow(a: PostMatchRowScratch, b: PostMatchRowScratch): boolean {
  const rankA = postMatchTaggedRank(a.ct);
  const rankB = postMatchTaggedRank(b.ct);
  if (rankA !== rankB) return rankA < rankB;
  if (a.ts !== b.ts) return a.ts > b.ts;
  return a.key.localeCompare(b.key) < 0;
}

/** Limite FTS menor para termos curtos/ambíguos (ex.: "das") — menos handles → scan mais rápido. */
function postMatchesFtsHandleLimitForQuery(qRaw: string): number {
  const ceiling = POST_MATCHES_FTS_HANDLE_LIMIT;
  const t = qRaw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!t) return Math.min(400, ceiling);
  const words = t.split(' ').map((w) => w.trim()).filter((w) => w.length >= 2);
  if (words.length === 0) return Math.min(300, ceiling);
  if (words.length === 1) {
    const w = words[0]!;
    if (w.length <= 3) return Math.min(200, ceiling);
    if (w.length <= 5) return Math.min(400, ceiling);
    return Math.min(700, ceiling);
  }
  return Math.min(1000, ceiling);
}

/** Evita revarrer RocksDB a cada página / refetch (post-matches “Todos” com muitos perfis). */
const POST_MATCHES_CACHE_TTL_MS = 90_000;
const POST_MATCHES_CACHE_MAX = 40;
const ALL_POST_MATCHES_HANDLES_TTL_MS = Math.max(
  5_000,
  Number(process.env.ALL_POST_MATCHES_HANDLES_TTL_MS) || 60_000
);

type PostMatchesCachedRow = { key: string; value: Record<string, unknown>; ct: string };

interface PostMatchesCachePayload {
  total: number;
  mediaKindCounts: Record<string, number>;
  rows: PostMatchesCachedRow[];
  scanPartial?: boolean;
  handlesScanned?: number;
  handlesTotal?: number;
}

const postMatchesResultCache = new Map<string, { expires: number; payload: PostMatchesCachePayload }>();
const postMatchNarrowHandlesCache = new Map<string, { expires: number; handles: string[] }>();
const POST_MATCH_NARROW_CACHE_TTL_MS = 50_000;
const POST_MATCH_NARROW_CACHE_MAX = 60;
const allPostMatchesHandlesCache = {
  expires: 0,
  handles: [] as string[],
};

function postMatchesCacheKey(
  userId: number,
  normHandles: string[],
  qRaw: string,
  typeFilters: string[],
  boostFp: string
): string {
  const fp = crypto.createHash('sha256').update([...normHandles].sort().join('\0')).digest('hex').slice(0, 24);
  return `${userId}|${fp}|${qRaw}|${typeFilters.join(',')}|${boostFp}`;
}

function postMatchesFacetBoostFingerprint(req: RequestWithAuth): string {
  if (req.query.facetBoostSort !== '1') return '';
  const base = buildCampaignProfilesQuery(req, { maxLimit: 1 });
  if (!hasCampaignFacetBoostInQuery(base)) return '';
  return crypto.createHash('sha256').update(JSON.stringify(base)).digest('hex').slice(0, 12);
}

async function sortPostMatchRowsByCampaignFacetBoost(
  rows: PostMatchesCachedRow[],
  query: ProfilesSearchQuery
): Promise<PostMatchesCachedRow[]> {
  if (!hasCampaignFacetBoostInQuery(query) || rows.length < 2) return rows;
  const handleScores = new Map<string, number>();
  const handles = [...new Set(rows.map((r) => postBucketKeyToHandle(r.key)).filter(Boolean))];
  await Promise.all(
    handles.map(async (h) => {
      const profile = (await db.loadByHandle(h)) as Record<string, unknown> | null;
      const auxRows = db.getProfileSearchAuxRowsForHandles([h]);
      const fc = auxRows[0]?.followers_count;
      handleScores.set(h, computeCampaignFacetBoostScore(profile, query, fc));
    })
  );
  return [...rows]
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const ha = postBucketKeyToHandle(a.row.key);
      const hb = postBucketKeyToHandle(b.row.key);
      const sa = handleScores.get(ha) ?? 0;
      const sb = handleScores.get(hb) ?? 0;
      if (sb !== sa) return sb - sa;
      return a.index - b.index;
    })
    .map(({ row }) => row);
}

function postMatchesCacheGet(key: string): PostMatchesCachePayload | null {
  const e = postMatchesResultCache.get(key);
  const now = Date.now();
  if (!e || e.expires <= now) {
    if (e) postMatchesResultCache.delete(key);
    return null;
  }
  return e.payload;
}

function postMatchesCacheSet(key: string, payload: PostMatchesCachePayload): void {
  const now = Date.now();
  for (const [k, v] of postMatchesResultCache) {
    if (v.expires <= now) postMatchesResultCache.delete(k);
  }
  postMatchesResultCache.set(key, { expires: now + POST_MATCHES_CACHE_TTL_MS, payload });
  while (postMatchesResultCache.size > POST_MATCHES_CACHE_MAX) {
    const first = postMatchesResultCache.keys().next().value;
    if (first !== undefined) postMatchesResultCache.delete(first);
  }
}

function postMatchNarrowCacheKey(scopedHandles: string[], pq: ProfilesSearchQuery): string {
  const hfp = crypto.createHash('sha256').update(scopedHandles.join('\0')).digest('hex').slice(0, 20);
  const fq = crypto.createHash('sha256').update(JSON.stringify(pq)).digest('hex').slice(0, 16);
  return `${hfp}|${fq}`;
}

function postMatchNarrowCacheGet(key: string): string[] | null {
  const e = postMatchNarrowHandlesCache.get(key);
  const now = Date.now();
  if (!e || e.expires <= now) {
    if (e) postMatchNarrowHandlesCache.delete(key);
    return null;
  }
  return e.handles;
}

function postMatchNarrowCacheSet(key: string, handles: string[]): void {
  const now = Date.now();
  for (const [k, v] of postMatchNarrowHandlesCache) {
    if (v.expires <= now) postMatchNarrowHandlesCache.delete(k);
  }
  postMatchNarrowHandlesCache.set(key, { expires: now + POST_MATCH_NARROW_CACHE_TTL_MS, handles });
  while (postMatchNarrowHandlesCache.size > POST_MATCH_NARROW_CACHE_MAX) {
    const first = postMatchNarrowHandlesCache.keys().next().value;
    if (first !== undefined) postMatchNarrowHandlesCache.delete(first);
  }
}

function postMatchesQueryToFtsExpression(q: string): string | null {
  const t = q.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!t) return null;
  const words = t.split(' ').map((w) => w.trim()).filter((w) => w.length >= 2);
  if (words.length === 0) return null;
  const parts = words.map((w) => {
    if (/^[a-z0-9_]+$/i.test(w)) return `content:${w}*`;
    const esc = w.replace(/"/g, '""');
    return `content:"${esc}"*`;
  });
  return parts.join(' AND ');
}

/**
 * Pré-filtra handles pelo índice FTS (legendas/posts agregados no SQLite).
 * Se há expressão FTS válida e zero linhas, retorna [] — não varrer todos os perfis no RocksDB (caso típico: termo sem match).
 * Ordem: relevância da FTS (bm25 ascendente na query).
 */
function scopeHandlesForPostCaptionSearch(handlesUniverse: string[], qRaw: string): string[] {
  const trimmed = qRaw.trim();
  if (!trimmed) return handlesUniverse;
  const expr = postMatchesQueryToFtsExpression(trimmed);
  if (!expr) return handlesUniverse;
  const fts = db.searchProfileHandlesFts(expr, postMatchesFtsHandleLimitForQuery(trimmed));
  if (fts.length === 0) return [];
  const universe = new Set(handlesUniverse.map((h) => normalizeHandle(h)).filter(Boolean));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of fts) {
    const h = normalizeHandle(row.handle);
    if (!h || !universe.has(h) || seen.has(h)) continue;
    seen.add(h);
    out.push(h);
  }
  return out;
}

/** Filtros de perfil na query string (LLM, porte, geo, etc.) — `q` aqui é só legenda dos posts (tratado à parte). */
function postMatchesHasProfileSideFilters(pq: ProfilesSearchQuery): boolean {
  if (pq.minFollowers != null || pq.maxFollowers != null) return true;
  if (pq.minEngagementRate != null || pq.minAvgLikes != null || pq.minPostsCount != null) return true;
  if ((pq.engagementRateBuckets?.length ?? 0) > 0) return true;
  if ((pq.avgLikesBuckets?.length ?? 0) > 0) return true;
  if ((pq.postsCountBuckets?.length ?? 0) > 0) return true;
  if ((pq.activationFilter?.length ?? 0) > 0) return true;
  if ((pq.cities?.length ?? 0) > 0 || (pq.states?.length ?? 0) > 0 || (pq.neighborhoods?.length ?? 0) > 0) return true;
  if ((pq.socialNetworks?.length ?? 0) > 0) return true;
  if (pq.excludePrivate) return true;
  if ((pq.accountTypeFilter?.length ?? 0) > 0) return true;
  if (pq.categories != null && (Array.isArray(pq.categories) ? pq.categories.length > 0 : String(pq.categories).trim() !== '')) return true;
  if ((pq.contentTypes?.length ?? 0) > 0) return true;
  if (
    (pq.pricingFeed?.length ?? 0) > 0 ||
    (pq.pricingReels?.length ?? 0) > 0 ||
    (pq.pricingStory?.length ?? 0) > 0 ||
    (pq.pricingDestaque?.length ?? 0) > 0
  ) {
    return true;
  }
  if ((pq.costTierFilter?.length ?? 0) > 0) return true;
  if ((pq.sizeFilter?.length ?? 0) > 0) return true;
  const llmArr = [
    pq.llmProfileType,
    pq.llmMainCategory,
    pq.llmGender,
    pq.llmLanguage,
    pq.llmAudienceType,
    pq.llmToneOfVoice,
    pq.llmRiskLevel,
  ];
  if (llmArr.some((a) => (a?.length ?? 0) > 0)) return true;
  if (pq.llmIsFamilySafe === true || pq.llmIsFamilySafe === false) return true;
  if (pq.llmIsAdultContent === true || pq.llmIsAdultContent === false) return true;
  return false;
}

/** Restringe handles aos que passam nos mesmos filtros de perfil da listagem (exceto `q` de legenda). */
function narrowPostMatchHandlesByProfileFilters(
  req: RequestWithAuth,
  scopedHandles: string[]
): string[] {
  if (scopedHandles.length === 0) return scopedHandles;
  const base = buildCampaignProfilesQuery(req, { maxLimit: 1 });
  const pq: ProfilesSearchQuery = { ...base, q: undefined };
  if (!postMatchesHasProfileSideFilters(stripCampaignFacetBoostFromProfilesQuery(pq))) return scopedHandles;
  const norm = scopedHandles.map((h) => normalizeHandle(h)).filter(Boolean);
  const nKey = postMatchNarrowCacheKey(norm, pq);
  const hit = postMatchNarrowCacheGet(nKey);
  if (hit) return hit;
  const narrowed = narrowHandlesByProfilesQuery(db, norm, pq);
  postMatchNarrowCacheSet(nKey, narrowed);
  return narrowed;
}

/**
 * Posts/reels/etc. dos handles informados (`q` na legenda/hashtags). Usado por campanha única e visão "Todos".
 */
async function runPostMatchesForHandles(
  req: RequestWithAuth,
  res: Response,
  normHandles: string[]
): Promise<void> {
  try {
    const handleSet = new Set(normHandles.map((h) => normalizeHandle(h)));
    const qRaw = (req.query.q as string | undefined)?.trim() ?? '';
    const typeFilters = parsePostMatchTypeFilters(req.query.type as string | undefined);
    const limitRaw = req.query.limit;
    const limitParsed =
      limitRaw != null && String(limitRaw).trim() !== '' ? Number(limitRaw) : Number.NaN;
    const limit = Number.isFinite(limitParsed) ? Math.min(Math.max(0, limitParsed), 200) : 48;
    const offset = Math.max(0, Number(req.query.offset) || 0);

    const userId = Number(req.user?.sub ?? 0);
    const cacheOwner = Number.isFinite(userId) && userId > 0 ? userId : 0;
    const boostFp = postMatchesFacetBoostFingerprint(req);
    const cacheKey =
      normHandles.length > 0
        ? postMatchesCacheKey(cacheOwner, normHandles, qRaw, typeFilters, boostFp)
        : '';
    const cached = cacheKey ? postMatchesCacheGet(cacheKey) : null;

    let orderedRows: PostMatchesCachedRow[];
    let total: number;
    let mediaKindCounts: Record<string, number>;
    let scanPartial = false;
    let handlesScanned = 0;
    const handlesTotal = normHandles.length;

    if (cached) {
      orderedRows = cached.rows;
      total = cached.total;
      mediaKindCounts = cached.mediaKindCounts;
      scanPartial = cached.scanPartial === true;
      handlesScanned = cached.handlesScanned ?? handlesTotal;
    } else {
      const bestPerHandle = new Map<string, PostMatchRowScratch>();

      const buildFilteredSorted = (): PostMatchesCachedRow[] => {
        const sorted = [...bestPerHandle.values()].sort((a, b) => {
          const rankA = postMatchTaggedRank(a.ct);
          const rankB = postMatchTaggedRank(b.ct);
          if (rankA !== rankB) return rankA - rankB;
          return b.ts - a.ts || a.key.localeCompare(b.key);
        });
        const filtered =
          typeFilters.length > 0 ? sorted.filter((x) => typeFilters.includes(x.ct)) : sorted;
        return filtered.map(({ key, value, ct }) => ({ key, value, ct }));
      };

      const ingestPosts = (items: { key: string; value: Record<string, unknown> }[]): void => {
        for (const { key, value } of items) {
          const h = postBucketKeyToHandle(key);
          if (!handleSet.has(h)) continue;
          const item = value as Record<string, unknown>;
          const ct = getContentTypeFromItem(key, item);
          if (!qRaw && ct === 'tagged') continue;
          if (qRaw) {
            const searchable = getPostSearchableNormalized(item);
            const { match } = matchesQuery(searchable, qRaw);
            if (!match) continue;
          }
          const ts = getPostTimestamp(item) ?? 0;
          const candidate: PostMatchRowScratch = { key, value: item, ts, ct };
          const prev = bestPerHandle.get(h);
          if (!prev || isBetterPostMatchRow(candidate, prev)) {
            bestPerHandle.set(h, candidate);
          }
        }
      };

      const maxScan = Math.min(normHandles.length, POST_MATCHES_MAX_SCAN_HANDLES);
      const needCount = limit > 0 ? offset + limit : 0;

      for (let i = 0; i < maxScan; i += POST_MATCHES_HANDLE_BATCH) {
        const batch = normHandles.slice(i, i + POST_MATCHES_HANDLE_BATCH);
        const parts = await Promise.all(
          batch.map((h) =>
            db.getByBucket<Record<string, unknown>>('post', `${h}:`, { sort: false })
          )
        );
        for (const items of parts) ingestPosts(items);
        handlesScanned = Math.min(i + batch.length, maxScan);

        if (needCount > 0) {
          const rowsSoFar = buildFilteredSorted();
          if (rowsSoFar.length >= needCount + POST_MATCHES_EARLY_STOP_BUFFER) {
            if (handlesScanned < normHandles.length) scanPartial = true;
            break;
          }
        }
      }

      if (handlesScanned < normHandles.length && handlesScanned >= maxScan) {
        scanPartial = true;
      }

      orderedRows = buildFilteredSorted();
      const sortQuery = buildCampaignProfilesQuery(req, { maxLimit: 1 });
      if (req.query.facetBoostSort === '1' && hasCampaignFacetBoostInQuery(sortQuery)) {
        orderedRows = await sortPostMatchRowsByCampaignFacetBoost(orderedRows, sortQuery);
      }

      mediaKindCounts = {};
      for (const row of bestPerHandle.values()) {
        const k = row.ct;
        mediaKindCounts[k] = (mediaKindCounts[k] ?? 0) + 1;
      }

      total = orderedRows.length;
      if (!scanPartial && cacheKey) {
        postMatchesCacheSet(cacheKey, {
          total,
          mediaKindCounts,
          rows: orderedRows,
          scanPartial: false,
          handlesScanned: handlesTotal,
          handlesTotal,
        });
      }
    }

    const scanMeta =
      scanPartial || handlesScanned < handlesTotal
        ? { partial: true as const, handlesScanned, handlesTotal }
        : undefined;

    const handlesOnlyRaw = req.query.handlesOnly ?? req.query.handles_only;
    const handlesOnly =
      handlesOnlyRaw === '1' ||
      handlesOnlyRaw === 'true' ||
      String(handlesOnlyRaw ?? '').toLowerCase() === 'yes';
    if (handlesOnly && qRaw) {
      const profileHandlesSet = new Set<string>();
      for (const row of orderedRows) {
        const h = postBucketKeyToHandle(row.key);
        if (h) profileHandlesSet.add(h);
      }
      const profileHandles = [...profileHandlesSet].sort((a, b) => a.localeCompare(b));
      const profileRefs = profileHandles.map((h) => profileRefDb.getOrCreateRef(h));
      const payload = {
        total,
        items: [] as unknown[],
        profileRefs,
        ...(shouldIncludeHandleInApi(req) ? { profileHandles } : {}),
        mediaKindCounts,
        q: qRaw || undefined,
        ...(scanMeta ? { scanMeta } : {}),
      };
      if (!req.user) {
        res.json({ ...payload, _redacted: true });
        return;
      }
      res.json(payload);
      return;
    }

    const slice = orderedRows.slice(offset, offset + limit).map(({ key, value, ct }) => {
      const item = { ...value } as Record<string, unknown>;
      const post = item?.post as Record<string, unknown> | undefined;
      const content = item?.content as Record<string, unknown> | undefined;
      if (post && post.taken_at == null && content?.caption_created_at != null && typeof content.caption_created_at === 'number') {
        item.post = { ...post, taken_at: content.caption_created_at };
      }
      if (!item.content_type) item.content_type = ct;
      item.profile_handle = postBucketKeyToHandle(key);
      return { key, ...item };
    });

    const handlesInSlice = new Set<string>();
    for (const row of slice) {
      const ph = (row as Record<string, unknown>).profile_handle;
      if (typeof ph === 'string' && ph.trim()) handlesInSlice.add(normalizeHandle(ph));
    }
    const influencerByHandle = new Map<
      string,
      ReturnType<typeof influencerFieldsFromProfile>
    >();
    await Promise.all(
      [...handlesInSlice].map(async (h) => {
        const profile = await db.loadByHandle(h);
        const fields = influencerFieldsFromProfile(profile as Record<string, unknown> | null);
        const postsRaw = await db.getByBucket<Record<string, unknown>>('post', `${h}:`);
        const posts_per_week = computePostsPerWeek(postsRaw.map(({ value }) => value));
        influencerByHandle.set(h, { ...fields, posts_per_week });
      })
    );
    for (const row of slice) {
      const ph = (row as Record<string, unknown>).profile_handle;
      if (typeof ph !== 'string' || !ph.trim()) continue;
      const h = normalizeHandle(ph);
      const fromProfile = influencerByHandle.get(h) ?? { followers_count: 0 };
      const prev = (row as Record<string, unknown>).influencer;
      const base =
        typeof prev === 'object' && prev !== null && !Array.isArray(prev)
          ? { ...(prev as Record<string, unknown>) }
          : {};
      // O `influencer` dentro do post costuma ser o user da mídia (ex. dono do post em "marcados").
      // Sempre exibir o perfil da campanha (`profile_handle` / bucket), não misturar nome/foto do nó.
      delete base.full_name;
      delete base.username;
      delete base.profile_pic_url;
      delete base.hd_profile_pic_url;
      delete base.hd_profile_pic_url_info;
      delete base.stable_profile_pic_url;
      delete base.llm;
      (row as Record<string, unknown>).influencer = {
        ...base,
        ...fromProfile,
        username: fromProfile.username ?? h,
      };
    }

    res.json({
      total,
      items: preparePostItemsForApiResponse(slice, req),
      q: qRaw || undefined,
      mediaKindCounts,
      ...(scanMeta ? { scanMeta } : {}),
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}

app.get('/api/campaigns/all/post-matches', rateLimitDataApi, async (req: RequestWithAuth, res: Response) => {
  try {
    const now = Date.now();
    let handles = allPostMatchesHandlesCache.handles;
    if (allPostMatchesHandlesCache.expires <= now || handles.length === 0) {
      const keys = await db.listKeys('profile');
      handles = keys.map((k) => normalizeHandle(k)).filter(Boolean);
      allPostMatchesHandlesCache.handles = handles;
      allPostMatchesHandlesCache.expires = now + ALL_POST_MATCHES_HANDLES_TTL_MS;
    }
    if (handles.length === 0) {
      res.json({ total: 0, items: [], q: undefined, mediaKindCounts: {} });
      return;
    }
    const qRaw = (req.query.q as string | undefined)?.trim() ?? '';
    const scopedHandles = scopeHandlesForPostCaptionSearch(handles, qRaw);
    if (scopedHandles.length === 0) {
      res.json({ total: 0, items: [], q: qRaw || undefined, mediaKindCounts: {} });
      return;
    }
    const narrowedAll = narrowPostMatchHandlesByProfileFilters(req, scopedHandles);
    await runPostMatchesForHandles(req, res, narrowedAll);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/**
 * Posts/reels/etc. dos perfis da campanha onde `q` aparece na legenda/hashtags (dados atuais do storage).
 * Sem `q`, retorna todos os itens da campanha (filtráveis por `type`).
 */
app.get('/api/campaigns/:id/post-matches', rateLimitDataApi, async (req: RequestWithAuth, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Login necessário' });
      return;
    }
    const campaignId = String(req.params.id ?? '').trim();
    if (!isCampaignIdGuid(campaignId)) {
      res.status(400).json({ error: 'ID da campanha inválido' });
      return;
    }
    const userId = Number(req.user.sub);
    const handles = creditsCampaignsDb.getCampaignHandlesIfActive(campaignId, userId);
    if (!handles || handles.length === 0) {
      res.status(404).json({ error: 'Campanha não encontrada ou expirada' });
      return;
    }
    const normalizedHandles = Array.from(new Set(handles.map((h) => normalizeHandle(h))));
    const qRaw = (req.query.q as string | undefined)?.trim() ?? '';
    const scopedHandles = scopeHandlesForPostCaptionSearch(normalizedHandles, qRaw);
    if (scopedHandles.length === 0) {
      res.json({ total: 0, items: [], q: qRaw || undefined, mediaKindCounts: {} });
      return;
    }
    const narrowed = narrowPostMatchHandlesByProfileFilters(req, scopedHandles);
    await runPostMatchesForHandles(req, res, narrowed);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Projetos para influenciadores (estilo Workana). Lista e detalhe: usuário logado. Cadastrar: adm. Candidatar: influenciador. */
app.get('/api/projects', rateLimitDataApi, async (req: RequestWithAuth, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Faça login para ver os projetos.', code: 'UNAUTHORIZED' });
      return;
    }
    const status = (req.query.status as string) || 'open';
    const category = (req.query.category as string)?.trim();
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 20), 50);
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const result = sqlite.listProjects({ status, category, limit, offset });
    const profileHandle = req.user?.profile_handle ?? authDb.getById(Number(req.user?.sub ?? 0))?.profile_handle ?? undefined;
    const items = profileHandle
      ? result.items.map((p) => ({
        ...p,
        has_applied: sqlite.hasApplied(p.id, profileHandle),
      }))
      : result.items;
    res.json({ total: result.total, items });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/projects/:id', rateLimitDataApi, async (req: RequestWithAuth, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Faça login para ver o projeto.', code: 'UNAUTHORIZED' });
      return;
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      res.status(400).json({ error: 'ID inválido' });
      return;
    }
    const project = sqlite.getProjectById(id);
    if (!project) {
      res.status(404).json({ error: 'Projeto não encontrado' });
      return;
    }
    const applicationsCount = sqlite.getProjectApplicationsCount(id);
    const hasApplied = req.user.profile_handle
      ? sqlite.hasApplied(id, req.user.profile_handle)
      : false;
    res.json({ ...project, applications_count: applicationsCount, has_applied: hasApplied });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/api/projects', requireScopes('adm'), async (req: RequestWithAuth, res: Response) => {
  try {
    const body = req.body as Record<string, unknown>;
    const title = (body.title as string)?.trim();
    const description = (body.description as string)?.trim();
    if (!title || !description) {
      res.status(400).json({ error: 'Título e descrição são obrigatórios' });
      return;
    }
    const id = sqlite.createProject({
      title,
      description,
      client_name: (body.client_name as string)?.trim() || null,
      budget_min: typeof body.budget_min === 'number' ? body.budget_min : (body.budget_min != null ? Number(body.budget_min) : null),
      budget_max: typeof body.budget_max === 'number' ? body.budget_max : (body.budget_max != null ? Number(body.budget_max) : null),
      category: (body.category as string)?.trim() || null,
      requirements: (body.requirements as string)?.trim() || null,
      status: (body.status as string) === 'closed' ? 'closed' : 'open',
    });
    const project = sqlite.getProjectById(id);
    res.status(201).json(project);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/api/projects/:id/apply', rateLimitDataApi, async (req: RequestWithAuth, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Faça login para se candidatar.', code: 'UNAUTHORIZED' });
      return;
    }
    const handle = req.user.profile_handle?.replace(/^@/, '');
    if (!handle) {
      res.status(400).json({ error: 'Complete seu perfil de influenciador para se candidatar.' });
      return;
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      res.status(400).json({ error: 'ID inválido' });
      return;
    }
    const project = sqlite.getProjectById(id);
    if (!project) {
      res.status(404).json({ error: 'Projeto não encontrado' });
      return;
    }
    if (project.status !== 'open') {
      res.status(400).json({ error: 'Este projeto não está mais aceitando candidaturas.' });
      return;
    }
    const message = (req.body as { message?: string })?.message?.trim();
    const ok = sqlite.applyToProject(id, handle, message);
    if (!ok) {
      res.status(409).json({ error: 'Você já se candidatou a este projeto.' });
      return;
    }
    res.status(201).json({ success: true, message: 'Candidatura enviada.' });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/buckets/:bucket', requireScopes('adm'), async (req: Request, res: Response) => {
  try {
    const bucket = req.params.bucket;
    if (bucket !== 'profile' && bucket !== 'post') {
      res.status(400).json({ error: 'Bucket deve ser profile ou post' });
      return;
    }
    const keys = await db.listKeys(bucket);
    res.json({ bucket, keys });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.delete('/api/clear', requireScopes('adm'), async (_req: Request, res: Response) => {
  try {
    await db.clearAll();
    res.json({ ok: true, message: 'Todos os dados do banco foram removidos.' });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/crawl/status', requireScopes('adm'), (_req: Request, res: Response) => {
  res.json({
    running: crawlInProgress,
    ...(lastCrawlResult && { last: lastCrawlResult }),
  });
});

app.post('/api/crawl/stop', requireScopes('adm'), (_req: Request, res: Response) => {
  crawlAbortRequested = true;
  res.json({ ok: true, message: 'Parada solicitada. O crawl encerrará após o perfil atual.' });
});

/** Executa extração e grava resultado em extractProfileResults (para polling). Usa delay curto e modo rápido. Com options.client roda com esse client (cadastro imediato, sem fila). */
async function runExtractAndStore(handle: string, runOptions?: RunOneExtractOptions): Promise<void> {
  const t0 = Date.now();
  try {
    console.log(`[runExtractAndStore] @${handle} runOneExtract iniciando...`);
    const result = await runOneExtract(handle, true, false, true, runOptions);
    console.log(`[runExtractAndStore] @${handle} runOneExtract retornou em ${Date.now() - t0}ms, gravando resultado...`);
    if (isBlockSignal(result)) {
      extractProfileResults.set(handle, {
        status: 'error',
        error: result.error ?? 'Bloqueio ou rate limit (429/challenge). Não tente de novo agora.',
      });
      return;
    }
    if (!result.success) {
      const err =
        result.error ??
        (result.rejectionReason === 'nao_segue_perfil'
          ? 'nao_segue_perfil'
          : result.rejectionReason
            ? `Perfil não qualificado: ${result.rejectionReason}`
            : 'Falha ao extrair perfil (página ou API)');
      extractProfileResults.set(handle, { status: 'error', error: err });
      return;
    }
    extractProfileResults.set(handle, { status: 'done', result });
    console.log(`[runExtractAndStore] ${logTimestamp()} @${handle} pronto em ${Date.now() - t0}ms (status=done)`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const isLoginRelated = /ERR_HTTP_RESPONSE_CODE_FAILURE|net::ERR|sessão|login/i.test(msg);
    let error = isLoginRelated
      ? 'Sessão do Instagram expirada ou não logada. Execute o login na pasta backend: npm run login'
      : msg;
    if (msg === 'Perfil não encontrado') {
      error = 'Perfil não encontrado. Se o perfil existir, a sessão do Instagram pode ter expirado. Execute na pasta backend: npm run login';
    }
    extractProfileResults.set(handle, { status: 'error', error });
  }
}

/** Status da extração em background (GET para polling). Público ou adm (fluxo de cadastro em /app/create). */
app.get('/api/crawl/extract-profile/status', requireScopesOrPublic('adm'), (req: Request, res: Response) => {
  const handle = (req.query?.handle ?? '').toString().trim().replace(/^@/, '');
  if (!handle) {
    res.status(400).json({ error: 'Query "handle" é obrigatória.' });
    return;
  }
  const stored = extractProfileResults.get(handle.toLowerCase());
  if (!stored) {
    res.status(200).json({ status: 'pending', handle });
    return;
  }
  if (stored.status === 'pending') {
    res.status(200).json({ status: 'pending', handle });
    return;
  }
  if (stored.status === 'done') {
    console.log(`[extract-status] ${logTimestamp()} @${handle} retornando done (frontend vai chamar request-code)`);
    res.status(200).json({ status: 'done', handle, result: stored.result });
    return;
  }
  res.status(200).json({ status: 'error', handle, error: stored.error });
});

/** Extrai um perfil específico por URL ou handle (cadastro de influenciador). Retorna 202 imediatamente; a extração roda em background. Público ou adm (fluxo /app/create). */
app.post('/api/crawl/extract-profile', requireScopesOrPublic('adm'), (req: Request, res: Response) => {
  let handle = (req.body?.handle ?? req.body?.url ?? '').toString().trim();
  if (!handle) {
    res.status(400).json({ error: 'Envie "handle" (ex.: rafaellacassol) ou "url" (ex.: https://www.instagram.com/rafaellacassol/).' });
    return;
  }
  if (handle.startsWith('http://') || handle.startsWith('https://')) {
    try {
      const u = new URL(handle);
      const path = u.pathname.replace(/\/$/, '');
      const match = path.match(/\/([^/]+)$/);
      handle = match ? match[1] : handle;
    } catch {
      res.status(400).json({ error: 'URL inválida.' });
      return;
    }
  }
  handle = handle.replace(/^@/, '').toLowerCase();

  const authStatePath = resolveAuthStatePath(
    process.env.INSTAGRAM_AUTH_STATE ?? process.env.AUTH_STATE_PATH ?? 'data/instagram-auth.json'
  );
  if (!existsSync(authStatePath)) {
    res.status(503).json({
      success: false,
      handle,
      error: `Sessão do Instagram não configurada. Execute o login na pasta backend: npm run login (arquivo esperado: ${authStatePath})`,
    });
    return;
  }

  const now = Date.now();
  if (now < apiExtractBlockedUntil) {
    res.status(503).json({
      success: false,
      handle,
      error: `Rate limit ou bloqueio. Tente novamente em ${Math.ceil((apiExtractBlockedUntil - now) / 60000)} min.`,
    });
    res.set('Retry-After', String(Math.ceil(get429BackoffMs() / 1000)));
    return;
  }

  extractProfileResults.set(handle, { status: 'pending' });
  res.status(202).json({
    accepted: true,
    handle,
    message: 'Extração em andamento. Consulte GET /api/crawl/extract-profile/status?handle=' + handle,
  });

  apiExtractQueue = apiExtractQueue
    .then(() => requestCodeFlushPromise)
    .then(() => runExtractAndStore(handle))
    .catch((err) => {
      console.error('[API] extract-profile erro:', err instanceof Error ? err.stack : err);
      extractProfileResults.set(handle, { status: 'error', error: err instanceof Error ? err.message : String(err) });
    });
});

/** Enfileira re-extração do perfil (renovar URLs de imagem). Adm ou influencer. Com priority=true (só adm) coloca na frente da fila e ignora o intervalo de 60 min. */
app.post('/api/crawl/queue-refresh', requireScopes('adm', 'influencer'), async (req: Request, res: Response) => {
  const priority = req.body?.priority === true;
  if (priority && (req as RequestWithAuth).user?.scope !== 'adm') {
    res.status(403).json({ error: 'Apenas administradores podem forçar atualização prioritária.' });
    return;
  }
  let handle = resolveProfileParam(
    String(req.body?.profile_ref ?? req.body?.handle ?? req.body?.url ?? '').trim()
  );
  if (!handle) {
    res.status(400).json({ error: 'Envie "profile_ref" do perfil.' });
    return;
  }
  if (handle.startsWith('http://') || handle.startsWith('https://')) {
    try {
      const u = new URL(handle);
      const path = u.pathname.replace(/\/$/, '');
      const match = path.match(/\/([^/]+)$/);
      handle = match ? match[1] : handle;
    } catch {
      res.status(400).json({ error: 'URL inválida.' });
      return;
    }
  }
  handle = handle.replace(/^@/, '').toLowerCase();
  if (refreshProfileQueueSet.has(handle)) {
    res.status(202).json({ queued: false, handle, message: 'Perfil já está na fila de atualização.' });
    return;
  }
  if (!priority) {
    const profile = await db.loadByHandle(handle);
    const collectedAt = profile && typeof (profile as { _collected_at?: string })._collected_at === 'string'
      ? (profile as { _collected_at: string })._collected_at
      : null;
    if (collectedAt) {
      const lastMs = Date.now() - new Date(collectedAt).getTime();
      if (lastMs < REFRESH_MIN_INTERVAL_MS) {
        res.status(202).json({
          queued: false,
          handle,
          message: `Última extração há ${Math.round(lastMs / 60000)} min. Só é possível re-extrair após 60 min.`,
        });
        return;
      }
    }
  }
  if (priority) {
    refreshProfileQueue.unshift(handle);
    refreshPriorityHandles.add(handle);
  } else {
    refreshProfileQueue.push(handle);
  }
  refreshProfileQueueSet.add(handle);
  processNextRefresh();
  res.status(202).json({
    queued: true,
    handle,
    message: priority ? 'Perfil na fila com prioridade para re-extração.' : 'Perfil na fila para re-extração (renovar imagens). Uma execução por vez.',
  });
});

app.post('/api/crawl', requireScopes('adm'), async (req: Request, res: Response) => {
  if (crawlInProgress) {
    res.status(409).json({ error: 'Crawl já em andamento. Aguarde ou consulte GET /api/crawl/status.' });
    return;
  }
  const tag = (req.body?.tag ?? '').toString().replace(/^#/, '').trim();
  if (!tag) {
    res.status(400).json({ error: 'Campo "tag" é obrigatório no body (ex.: { "tag": "viagem" }).' });
    return;
  }
  const limit = req.body?.limit != null ? Number(req.body.limit) : undefined;
  const clear = Boolean(req.body?.clear);

  res.status(202).json({ started: true, tag, limit: limit ?? null, clear });

  crawlInProgress = true;
  crawlAbortRequested = false;
  runCrawl(
    { tag, limit, clear },
    db,
    { shouldAbort: () => crawlAbortRequested }
  )
    .then((result) => {
      lastCrawlResult = { saved: result.saved, tag: result.tag, finishedAt: new Date().toISOString() };
    })
    .catch((err) => {
      console.error('[API] Crawl falhou:', err);
      lastCrawlResult = { saved: 0, tag, finishedAt: new Date().toISOString() };
    })
    .finally(() => {
      crawlInProgress = false;
      crawlAbortRequested = false;
    });
});

// Specs por URL; cada Swagger usa serveFiles para ter init script próprio (evita variável global compartilhada).
app.get('/api-docs/rocksdb.json', (_req: Request, res: Response) => {
  res.json(openApiRocksdb);
});
app.get('/api-docs/sqlite.json', (_req: Request, res: Response) => {
  res.json(openApiSqlite);
});
const swaggerCss = '.swagger-ui .topbar { display: none }';
const rocksdbSwaggerOpts = { swaggerUrl: '/api-docs/rocksdb.json', customCss: swaggerCss };
const sqliteSwaggerOpts = { swaggerUrl: '/api-docs/sqlite.json', customCss: swaggerCss };
const rocksdbServe = swaggerUi.serveFiles(undefined as unknown as object, rocksdbSwaggerOpts);
const sqliteServe = swaggerUi.serveFiles(undefined as unknown as object, sqliteSwaggerOpts);
app.use('/api-docs/rocksdb', rocksdbServe[0], rocksdbServe[1], swaggerUi.setup(null, rocksdbSwaggerOpts));
app.use('/api-docs/sqlite', sqliteServe[0], sqliteServe[1], swaggerUi.setup(null, sqliteSwaggerOpts));
app.get('/api-docs', (_req: Request, res: Response) => {
  res.redirect(302, '/api-docs/rocksdb');
});

(async () => {
  const warmSearch =
    process.env.API_WARM_SEARCH_CACHE !== '0' &&
    String(process.env.API_WARM_SEARCH_CACHE ?? '').toLowerCase() !== 'false';
  const t0 = Date.now();
  try {
    if (warmSearch) {
      console.log('Aquecendo cache de busca (só perfis; posts indexados no SQLite FTS)...');
      await warmSearchCache(db);
      console.log(`Cache de busca aquecido em ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
      const auxN = db.countProfileSearchAuxRows();
      const handleN = (await db.listHandles()).size;
      if (handleN > 50 && auxN < Math.floor(handleN * 0.85)) {
        console.warn(
          `[profile-search-index] índice desatualizado (${auxN} linhas aux / ${handleN} perfis). Reconstruindo em background…`,
        );
        void rebuildAllProfileSearchIndexes(db).catch((e) =>
          console.warn('[profile-search-index] rebuild falhou:', e instanceof Error ? e.message : e),
        );
      }
    } else {
      console.log(
        'Cache de busca: aquecimento na subida desligado (API_WARM_SEARCH_CACHE=false). Menor pico de RAM; a 1ª busca pode ler o disco.',
      );
    }
  } catch (err: unknown) {
    if (isSearchCacheWarmBlockedError(err)) {
      console.warn(
        'Cache de busca não carregado no startup (banco em uso?). Retentativas em background até liberar — buscas ficam rápidas assim que o lock cessar.',
      );
      scheduleSearchCacheWarmRetries(db);
    } else {
      throw err;
    }
  }
  logMemorySnapshot('antes de HTTP listen (warm/cache resolvido)');
  app.listen(PORT, () => {
    logMemorySnapshot('HTTP listen ativo');
    console.log(`API: http://localhost:${PORT}`);
    console.log(`Swagger RocksDB: http://localhost:${PORT}/api-docs/rocksdb`);
    console.log(`Swagger SQLite: http://localhost:${PORT}/api-docs/sqlite`);
    logS3StartupStatus({ envPath: BACKEND_ENV_PATH, backendRoot: BACKEND_ROOT });
    const asaasReason = asaas.paymentsUnavailableReason();
    if (asaasReason) {
      console.warn(`[asaas] ${asaasReason} — endpoints de pagamento retornam 503 até configurar a chave.`);
    } else {
      console.log(`[asaas] API configurada (${asaas.isAsaasSandbox() ? 'sandbox' : 'produção'}).`);
    }
    // Aquecer o browser em background para o primeiro extract-profile não esperar abrir o Chromium
    getApiExtractClient()
      .init()
      .then(() => {
        logMemorySnapshot('Browser (Chromium) pronto p/ extract');
        console.log('Browser (Chromium) aquecido e pronto para extract-profile.');
      })
      .catch((err) => console.warn('Warmup do browser falhou (primeiro extract-profile pode demorar):', err instanceof Error ? err.message : err));
    // Worker de fila de disparo em background (roda sempre que há pendentes)
    startDirectQueueWorker();
  });
})().catch((err) => {
  console.error('Falha ao iniciar a API:', err);
  process.exit(1);
});
