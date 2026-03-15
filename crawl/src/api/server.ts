import 'dotenv/config';
import crypto from 'node:crypto';
import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Request, type Response } from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Raiz do projeto crawl (onde ficam .env e data/). Funciona com tsx (src/api) e com node após build (dist/api). */
const _twoUp = path.resolve(__dirname, '../..');
const CRAWL_ROOT = path.basename(_twoUp) === 'dist' ? path.resolve(__dirname, '../../..') : _twoUp;

function resolveAuthStatePath(relativeOrAbsolute: string): string {
  if (path.isAbsolute(relativeOrAbsolute)) return relativeOrAbsolute;
  return path.resolve(CRAWL_ROOT, relativeOrAbsolute);
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
import { searchProfiles, getProfileSummary, scheduleSearchCacheRewarm, warmSearchCache, type ProfilesSearchQuery, type ProfileListItem } from './profilesSearch.js';
import { CreditsCampaignsDb, isCampaignIdGuid } from '../storage/creditsCampaignsDb.js';
import { PaymentsDb, type PaymentRow } from '../storage/paymentsDb.js';
import * as asaas from '../asaas/client.js';
import { InstagramClient } from '../instagramClient/index.js';
import { loginWithCredentials } from '../instagramClient/login.js';
import { profileExtractDelay, profileExtractDelayForApi } from '../utils/delay.js';
import { logTimestamp } from '../utils/logTimestamp.js';
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
import { signJwt, getJwtSecret } from '../auth/jwt.js';
import { verifyPassword, hashPassword } from '../auth/password.js';
import type { AuthScope } from '../auth/types.js';
import { listTables, queryTable, isAllowedTable } from './dbQueries.js';

const require = createRequire(import.meta.url);
const openApiRocksdb = require('./openapi-rocksdb.json');
const openApiSqlite = require('./openapi-sqlite.json');

/** iisnode define process.env.PORT; fora do IIS usamos API_PORT ou 3500 */
const PORT = Number(process.env.PORT) || Number(process.env.API_PORT) || 3500;
const rocksPath = process.env.STORAGE_DB_PATH ?? './data/rocksdb';
const sqlitePath = process.env.SQLITE_DB_PATH ?? './data/influencer.db';

const app = express();
app.use(express.json());

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
const db = new CompositeStorage(rocks, sqlite, (storage) => scheduleSearchCacheRewarm(storage));
const authDb = new AuthDb(sqlitePath);
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
    await (fromExtractProfileApi ? profileExtractDelayForApi() : profileExtractDelay());
    const cooldownEvery = Math.max(0, parseInt(process.env.COOLDOWN_EVERY ?? '10', 10) || 10);
    const cooldownMinMs = Math.max(0, parseInt(process.env.COOLDOWN_MIN_MS ?? '60000', 10) || 60000);
    const cooldownMaxMs = Math.max(cooldownMinMs, parseInt(process.env.COOLDOWN_MAX_MS ?? '180000', 10) || 180000);
    if (!options?.skipCount && cooldownEvery > 0 && apiExtractProfileCount > 0 && apiExtractProfileCount % cooldownEvery === 0) {
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
        extractSingleProfileWithPage(page, handle, db, config, { forRefresh, fastMode: fromExtractProfileApi, client }),
        timeoutPromise,
      ]);
      console.log(`[runOneExtract] @${handle} extração concluída, fechando página...`);
    } finally {
      const skipCloseForSupplement = fromExtractProfileApi && result?.success === true;
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
    if (fromExtractProfileApi && result.success && page) {
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
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        scope: user.scope,
        profile_handle: user.profile_handle,
        ...(profile_activated !== undefined && { profile_activated }),
      },
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Usuário atual (a partir do JWT). Para influencer com profile_handle, inclui profile_activated (cadastro de ativação completo). */
app.get('/api/auth/me', (req: RequestWithAuth, res: Response) => {
  if (!req.user) {
    res.status(200).json({ user: null });
    return;
  }
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
  res.json({
    user: {
      id: Number(req.user.sub),
      username: req.user.username,
      scope: req.user.scope,
      profile_handle: profileHandle,
      ...(profile_activated !== undefined && { profile_activated }),
    },
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
  flowOptions?: { client?: InstagramClient }
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

  const maxAttempts = 3;
  const delayMs = 2000;
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
        if (followsFromExtract === true) {
          logStep('Usando cache (segue perfil), pulando abertura de perfil.');
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
              return { sent: false, error: 'Perfil não encontrado ou indisponível.' };
            }
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
          } finally {
            // Fechar página em background para não travar o fluxo (page.close() pode demorar)
            void page.close().then(() => { /* página fechada */ }).catch(() => { });
            logStep('Página em fechamento (background).');
          }
        }
      }

      // Quando usamos cache (segue perfil) e follow-back está ativo: seguir de volta em background (não bloqueia envio do código)
      const followBackEnabled = process.env.FOLLOW_BACK_ENABLED !== 'false';
      if (followBackEnabled && requiredProfile && requiredProfile.length > 0) {
        const followsFromExtract = (() => {
          const stored = extractProfileResults.get(nickname.trim().toLowerCase());
          return stored?.status === 'done' && stored.result && 'followsOfficialProfile' in stored.result
            ? (stored.result as { followsOfficialProfile?: boolean }).followsOfficialProfile
            : undefined;
        })();
        if (followsFromExtract === true) {
          void followUser(client, nickname)
            .then((followResult) => {
              if (!followResult.ok) logStep(`Follow-back (cache, em background) falhou: ${followResult.error ?? 'erro'}`);
              else if (followResult.alreadyFollowing) logStep('Follow-back (cache, em background): já estávamos seguindo.');
              else logStep('Follow-back (cache, em background): seguimos o influenciador.');
            })
            .catch((err) => logStep(`Follow-back (cache) em background falhou: ${err instanceof Error ? err.message : String(err)}`));
        }
      }

      logStep('Enviando código por Direct...');
      const tSend = Date.now();
      let result = await sendVerificationCode(client, nickname, code);
      for (let attempt = 1; !result.ok && attempt < maxAttempts; attempt++) {
        logStep(`sendVerificationCode tentativa ${attempt} retornou ok=false, nova tentativa em ${delayMs}ms...`);
        await new Promise((r) => setTimeout(r, delayMs));
        result = await sendVerificationCode(client, nickname, code);
      }
      logStep(`sendVerificationCode concluído em ${Date.now() - tSend}ms (ok=${result.ok}).`);
      if (!result.ok) {
        logStep(`Erro: ${result.error ?? 'desconhecido'}`);
        return { sent: false, error: result.error ?? 'Falha ao enviar mensagem no Instagram.' };
      }
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
    const userId = req.user ? Number(req.user.sub) : null;
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    authDb.saveProfileVerification(nickname, code, userId, new Date(Date.now() + 15 * 60 * 1000).toISOString());

    const flowPromise = performRequestCodeFlow(nickname, code, userId);
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

/** Envia mensagem Direct do Instagram para um influenciador (handle). Requer scope adm ou assinante. Body: handle, message (opcional se imageBase64), imageBase64 (opcional, data URL ou base64). */
app.post('/api/direct/send-message', requireScopes('adm', 'assinante'), async (req: RequestWithAuth, res: Response) => {
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
    logStep(`Cadastro: extração imediata (fora da fila) + envio de código para @${nickname}`);

    const authStatePath = resolveAuthStatePath(process.env.INSTAGRAM_AUTH_STATE ?? process.env.AUTH_STATE_PATH ?? 'data/instagram-auth.json');
    if (!existsSync(authStatePath)) {
      res.status(503).json({ error: 'Sessão do Instagram não configurada. Execute o login do crawl (npm run login).' });
      return;
    }

    const handle = nickname.replace(/^@/, '');
    extractProfileResults.set(handle, { status: 'pending' });
    const priorityClient = getPriorityExtractClient();
    try {
      await runExtractAndStore(handle, { client: priorityClient, skipCount: true });
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
    logStep(`Extract pronto em ${Date.now() - t0}ms, enviando código...`);

    const userId = req.user ? Number(req.user.sub) : null;
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    authDb.saveProfileVerification(nickname, code, userId, new Date(Date.now() + 15 * 60 * 1000).toISOString());

    const flowPromise = performRequestCodeFlow(nickname, code, userId, { client: priorityClient });
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
      const existingByUsername = authDb.getByUsername(nickname);
      if (existingByUsername && existingByUsername.id !== currentUserId) {
        authDb.updateUser(existingByUsername.id, { profile_handle: nickname });
        return res.status(200).json({ verified: true, profile_handle: nickname });
      }
      authDb.updateUser(currentUserId, { profile_handle: nickname, username: nickname });
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

/** LGPD: excluir conta. Influencer: própria conta (via profile_handle do JWT). Adm: qualquer conta via query handle=. */
app.delete('/api/account', requireScopes('adm', 'influencer'), async (req: RequestWithAuth, res: Response) => {
  try {
    let handle: string;
    if (req.user!.scope === 'adm') {
      handle = (req.query?.handle ?? '').toString().trim().replace(/^@/, '').toLowerCase();
      if (!handle) {
        res.status(400).json({ error: 'Informe o handle (query: handle=)' });
        return;
      }
    } else {
      handle = (req.user!.profile_handle || '').replace(/^@/, '').trim().toLowerCase();
      if (!handle) {
        res.status(400).json({ error: 'Conta sem perfil vinculado.' });
        return;
      }
    }
    const user = authDb.getByProfileHandle(handle);
    if (!user) {
      res.status(404).json({ error: 'Usuário não encontrado.' });
      return;
    }
    sqlite.deleteActivation(handle);
    sqlite.deleteProjectApplicationsByHandle(handle);
    await rocks.deleteByKeyPrefix('post', `${handle}:`);
    await rocks.delete('profile', handle);
    authDb.clearProfileVerification(handle);
    authDb.deleteUser(user.id);
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
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
    const handles = creditsCampaignsDb.getCampaignHandlesIfActive(campaignId, userId);
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
    const slice = items.slice(offset, offset + limit).map(({ key, value }) => ({ key, ...value as object }));
    res.json({ total, items: slice });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

const PUBLIC_PAGE_SIZE = 12;
/** Requisições por minuto por IP (anônimo). Configurável por API_RATE_LIMIT_PER_MIN_IP. */
const RATE_LIMIT_PER_MIN_IP = Number(process.env.API_RATE_LIMIT_PER_MIN_IP) || 30;
/** Requisições por minuto por usuário (public/influencer). Configurável por API_RATE_LIMIT_PER_MIN_USER. */
const RATE_LIMIT_PER_MIN_USER = Number(process.env.API_RATE_LIMIT_PER_MIN_USER) || 60;
/** Requisições por minuto para adm/assinante. Configurável por API_RATE_LIMIT_PER_MIN_SUBSCRIBER. */
const RATE_LIMIT_PER_MIN_SUBSCRIBER = Number(process.env.API_RATE_LIMIT_PER_MIN_SUBSCRIBER) || 120;

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

/** Reduz perfil para versão sem dados sensíveis (público que atingiu limite). Mantém apenas bio e dados mínimos de exibição (foto, nome, handle). */
function redactProfile(profile: Record<string, unknown>): Record<string, unknown> {
  const out = { ...profile };
  const sensitive = ['followers_count', 'following_count', 'media_count', 'media_count_visible', 'categories', 'external_url', 'mutual_followers_count', 'total_clips_count', '_collected_at', '_discovered_by', '_discovered_value'];
  for (const k of sensitive) {
    out[k] = null;
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
          follower_count: null,
          following_count: null,
          media_count: null,
          external_url: null,
        }
        : d.user,
    };
  }
  out._redacted = true;
  return out;
}

/** Reduz lista de posts removendo métricas (likes, comentários, views) para público que atingiu limite. */
function redactPostsItems(items: Array<{ key: string;[k: string]: unknown }>): Array<Record<string, unknown>> {
  return items.map(({ key, ...item }) => {
    const out = { key, ...item } as Record<string, unknown>;
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

/** Engajamento zerado para respostas sem login (nenhum dado de métrica retornado). */
const ZERO_ENGAGEMENT = {
  posts_count: 0,
  total_likes: 0,
  total_comments: 0,
  total_views: 0,
  avg_likes: 0,
  avg_comments: 0,
  avg_views: 0,
  engagement_rate: 0,
};

/** Remove dados de métrica da listagem de busca quando o usuário não está logado. */
function redactSearchResultForAnonymous(result: { total: number; items: Record<string, unknown>[]; facets: Record<string, unknown> }): typeof result {
  const items = result.items.map((item) => {
    const out = { ...item };
    out.followers_count = 0;
    out.engagement = ZERO_ENGAGEMENT;
    return out;
  });
  const facets = { ...result.facets };
  facets.engagement_rate = [];
  facets.avg_likes = [];
  facets.posts_count = [];
  return { total: result.total, items, facets };
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
      sort,
      limit,
      offset,
    };
    let restrictToHandles: string[] | undefined;
    let queryForSearch = query;
    const canSearchWithoutCampaign = quantitativosOnly || (req.user && (req.user.scope === 'adm' || req.user.scope === 'assinante'));
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
    const result = await searchProfiles(db, queryForSearch, restrictToHandles?.length ? { restrictToHandles } : undefined);
    if (quantitativosOnly) {
      res.json(result);
      return;
    }
    if (!req.user) {
      res.json(redactSearchResultForAnonymous(result as unknown as { total: number; items: Record<string, unknown>[]; facets: Record<string, unknown> }));
      return;
    }
    res.json(result);
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
/** Preço por influenciador ativado no relatório (R$ 2,00). */
const REPORT_PRICE_CENTS_ACTIVATED = 200;
/** Preço por influenciador não ativado no relatório (R$ 1,00). */
const REPORT_PRICE_CENTS_NOT_ACTIVATED = 100;

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
    }));
    res.json({ payments });
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
    const row = paymentsDb.getById(id, userId);
    if (!row) {
      res.status(404).json({ error: 'Pagamento não encontrado' });
      return;
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
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Cadastro público: cria usuário como Assinante (sem pagamento). Body: email, password, name?. Retorna token + user. */
app.post('/api/auth/register-assinante', async (req: Request, res: Response) => {
  try {
    const body = req.body as { email?: string; password?: string; name?: string };
    const email = (body?.email ?? '').toString().trim().toLowerCase();
    const password = (body?.password ?? '').toString();
    const name = (body?.name ?? '').toString().trim() || email;
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
    const userId = authDb.createUser(email, passwordHash, 'assinante' as AuthScope, null);
    const authUser = authDb.getById(userId);
    if (!authUser) {
      res.status(500).json({ error: 'Erro ao criar conta' });
      return;
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
      },
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Checkout público: cadastra como Assinante e cria pagamento (PIX/Boleto). Body: email, password, name?, credits, billingType. Retorna token + user + dados do pagamento. */
app.post('/api/checkout/register-and-pay', async (req: Request, res: Response) => {
  try {
    if (!asaas.isAsaasConfigured()) {
      res.status(503).json({ error: 'Pagamentos temporariamente indisponíveis' });
      return;
    }
    const body = req.body as { email?: string; password?: string; name?: string; credits?: number; billingType?: string };
    const email = (body?.email ?? '').toString().trim().toLowerCase();
    const password = (body?.password ?? '').toString();
    const name = (body?.name ?? '').toString().trim() || email;
    const credits = Number(body?.credits);
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
    const userId = authDb.createUser(email, passwordHash, 'assinante' as AuthScope, null);
    const authUser = authDb.getById(userId);
    if (!authUser) {
      res.status(500).json({ error: 'Erro ao criar conta' });
      return;
    }

    const amountCents = credits * CREDITS_PRICE_CENTS;
    const valueBrl = amountCents / 100;
    const displayName = name || email;
    const externalRef = `user_${userId}`;

    let asaasCustomerId: string | null = null;
    const existingCustomer = await asaas.findCustomersByExternalReference(externalRef);
    if (existingCustomer?.data && existingCustomer.data.length > 0 && existingCustomer.data[0].id) {
      asaasCustomerId = existingCustomer.data[0].id;
    } else {
      const created = await asaas.createCustomer({
        name: displayName,
        email,
        externalReference: externalRef,
      });
      asaasCustomerId = created?.id ?? null;
    }
    if (!asaasCustomerId) {
      res.status(502).json({ error: 'Não foi possível criar cliente no gateway' });
      return;
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
    const pixCopyPaste = asaasPayment?.pixTransaction?.payload ?? asaasPayment?.pixTransaction?.qrCode ?? null;

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
      },
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

/** Cria campanha a partir da query e quantidade. Retorna campaignId ou null se nenhum handle. */
async function createReportCampaignFromQuery(
  query: ProfilesSearchQuery,
  reportCount: number,
  userId: number,
  expiresAt?: string
): Promise<string | null> {
  const { handles } = await getReportHandlesAndPrice(query, reportCount);
  if (handles.length === 0) return null;
  return creditsCampaignsDb.createCampaign(userId, handles, 0, query.q?.trim() || 'Relatório', expiresAt);
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
      res.status(503).json({ error: 'Pagamentos temporariamente indisponíveis' });
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
        let asaasCustomerId: string | null = null;
        const existingTemp = await asaas.findCustomersByExternalReference(tempExternalRef);
        if (existingTemp?.data && existingTemp.data.length > 0 && existingTemp.data[0].id) {
          asaasCustomerId = existingTemp.data[0].id;
        } else {
          const created = await asaas.createCustomer({
            name: displayNameGuest,
            email,
            cpfCnpj,
            externalReference: tempExternalRef,
          });
          asaasCustomerId = created?.id ?? null;
        }
        if (!asaasCustomerId) {
          res.status(502).json({ error: 'Não foi possível criar cliente no gateway' });
          return;
        }
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
        const pixCopyPaste = asaasPayment?.pixTransaction?.payload ?? asaasPayment?.pixTransaction?.qrCode ?? null;
        const hasPaymentUrl = Boolean(bankSlipUrl || pixCopyPaste);
        if (!hasPaymentUrl || !asaasPaymentId) {
          res.status(502).json({ error: 'Não foi possível gerar o pagamento. Tente novamente.' });
          return;
        }
        const password = (body?.password ?? '').toString();
        const passwordToUse = password.length >= 6 ? password : crypto.randomBytes(16).toString('hex');
        const passwordHash = hashPassword(passwordToUse);
        try {
          userId = authDb.createUser(email, passwordHash, 'assinante' as AuthScope, null);
        } catch (createErr: unknown) {
          const msg = createErr instanceof Error ? createErr.message : String(createErr);
          if (msg.includes('UNIQUE') && msg.includes('username')) {
            res.status(409).json({ error: 'Já existe uma conta com este e-mail. Faça login para continuar.' });
            return;
          }
          throw createErr;
        }
        authUser = authDb.getById(userId)!;
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
        };
        if (campaignIdGuest) out.campaignId = campaignIdGuest;
        if (token) {
          out.token = token;
          out.user = { id: authUser.id, username: authUser.username, scope: authUser.scope, profile_handle: authUser.profile_handle };
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

    let asaasCustomerId: string | null = null;
    const existingCustomer = await asaas.findCustomersByExternalReference(externalRef);
    if (existingCustomer?.data && existingCustomer.data.length > 0 && existingCustomer.data[0].id) {
      asaasCustomerId = existingCustomer.data[0].id;
    } else {
      const cpfCnpjOpt = (body?.cpfCnpj ?? '').toString().replace(/\D/g, '');
      const created = await asaas.createCustomer({
        name: displayName,
        email,
        externalReference: externalRef,
        ...(cpfCnpjOpt.length === 11 || cpfCnpjOpt.length === 14 ? { cpfCnpj: cpfCnpjOpt } : {}),
      });
      asaasCustomerId = created?.id ?? null;
    }
    if (!asaasCustomerId) {
      res.status(502).json({ error: 'Não foi possível criar cliente no gateway' });
      return;
    }

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
    const pixCopyPaste = asaasPayment?.pixTransaction?.payload ?? asaasPayment?.pixTransaction?.qrCode ?? null;

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
      res.status(503).json({ error: 'Pagamentos temporariamente indisponíveis' });
      return;
    }
    const userId = Number(req.user.sub);
    const body = req.body as { credits?: number; billingType?: string };
    const credits = Number(body?.credits);
    if (!Number.isFinite(credits) || credits < 1 || credits > 10000) {
      res.status(400).json({ error: 'Envie credits (1 a 10000)' });
      return;
    }
    const billingType = (body?.billingType ?? 'PIX').toUpperCase() === 'BOLETO' ? 'BOLETO' : 'PIX';
    const amountCents = credits * CREDITS_PRICE_CENTS;
    const valueBrl = amountCents / 100;

    const authUser = authDb.getById(userId);
    if (!authUser) {
      res.status(401).json({ error: 'Usuário não encontrado' });
      return;
    }
    const name = authUser.profile_handle ? `@${authUser.profile_handle}` : authUser.username;
    const email = authUser.username.includes('@') ? authUser.username : `user${userId}@payments.influencer.local`;
    const externalRef = `user_${userId}`;

    let asaasCustomerId: string | null = null;
    const existing = await asaas.findCustomersByExternalReference(externalRef);
    if (existing?.data && existing.data.length > 0 && existing.data[0].id) {
      asaasCustomerId = existing.data[0].id;
    } else {
      const created = await asaas.createCustomer({
        name,
        email,
        externalReference: externalRef,
      });
      asaasCustomerId = created?.id ?? null;
    }
    if (!asaasCustomerId) {
      res.status(502).json({ error: 'Não foi possível criar cliente no gateway' });
      return;
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
    const pixCopyPaste = asaasPayment?.pixTransaction?.payload ?? asaasPayment?.pixTransaction?.qrCode ?? null;

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
    const confirmedStatus = payment?.status?.toUpperCase();
    const isPaid =
      confirmedStatus === 'RECEIVED' ||
      confirmedStatus === 'CONFIRMED' ||
      confirmedStatus === 'DONE' ||
      confirmedStatus === 'RECEIVED_IN_CASH';
    if (isPaid && row.status === 'PENDING') {
      paymentsDb.updateStatusByAsaasId(asaasId, 'CONFIRMED');
      const reportCount = row.report_desired_count;
      const reportQueryStr = row.report_query;
      const existingCampaignId = (row as PaymentRow & { campaign_id?: string | null }).campaign_id;
      if (reportCount != null && reportCount > 0 && reportQueryStr && !existingCampaignId) {
        try {
          await createReportCampaignFromQuery(
            JSON.parse(reportQueryStr) as ProfilesSearchQuery,
            reportCount,
            row.user_id
          );
        } catch (e) {
          console.error('[payments/webhook] report campaign create', e);
        }
      } else if (!reportQueryStr || reportCount == null || reportCount <= 0) {
        creditsCampaignsDb.addCredits(row.user_id, row.credits_granted, 'payment', row.id);
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
      return {
        handle: r.profile_handle,
        campaignId: campaignId ?? undefined,
        campaignName: campaignName ?? undefined,
      };
    });
    res.json({ handles: rows.map((r) => r.profile_handle), favorites });
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
    const handle = (req.body?.handle ?? req.body?.profile_handle ?? '').toString().trim().replace(/^@/, '');
    if (!handle) {
      res.status(400).json({ error: 'handle é obrigatório' });
      return;
    }
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
    res.status(201).json({ ok: true, handle, campaignId: campaignId ?? null });
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
    const handle = (req.params.handle ?? '').replace(/^@/, '').trim();
    if (!handle) {
      res.status(400).json({ error: 'handle é obrigatório' });
      return;
    }
    const campaignIdRaw = (req.query.campaignId ?? req.query.campaign_id) as string | undefined;
    const campaignId = typeof campaignIdRaw === 'string' && campaignIdRaw.trim() && isCampaignIdGuid(campaignIdRaw.trim()) ? campaignIdRaw.trim() : undefined;
    sqlite.removeFavorite(userId, handle, campaignId ?? null);
    res.json({ ok: true, handle, campaignId: campaignId ?? null });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Resultado de stats e preview de uma campanha. */
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
}

/** Agrega stats de engajamento e preview dos perfis da campanha. Só retorna dados para campanha ativa. */
async function getCampaignStats(campaignId: string, userId: number): Promise<CampaignStatsResult | null> {
  const handles = creditsCampaignsDb.getCampaignHandlesIfActive(campaignId, userId);
  if (!handles || handles.length === 0) return null;
  const result = await searchProfiles(db, { limit: 10000, offset: 0, sort: 'engagement_desc' }, { restrictToHandles: handles });
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
  };
}

/** Lista campanhas do usuário logado (com stats de engajamento por campanha). */
app.get('/api/me/campaigns', async (req: RequestWithAuth, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Login necessário' });
      return;
    }
    const userId = Number(req.user.sub);
    const rows = creditsCampaignsDb.listCampaigns(userId);
    const campaigns = await Promise.all(
      rows.map(async (r) => {
        const base: Record<string, unknown> = {
          id: r.id,
          name: r.name,
          handlesCount: r.handles_count,
          creditsUsed: r.credits_used,
          created_at: r.created_at,
          expires_at: r.expires_at,
        };
        const payment = paymentsDb.getByCampaignId(r.id, userId);
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
        }
        const data = await getCampaignStats(r.id, userId);
        if (!data) return base;
        const { previewProfiles, topHashtags, ...stats } = data;
        return { ...base, stats, previewProfiles, topHashtags };
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
    const allHandles: string[] = [];
    const pageSize = 100;
    let offset = 0;
    for (; ;) {
      if (maxHandles != null && allHandles.length >= maxHandles) break;
      const q: ProfilesSearchQuery = { ...query, limit: pageSize, offset };
      const result = await searchProfiles(db, q);
      for (const item of result.items) {
        if (item.handle) {
          allHandles.push(item.handle);
          if (maxHandles != null && allHandles.length >= maxHandles) break;
        }
      }
      if (result.items.length < pageSize) break;
      offset += pageSize;
      if (offset >= result.total) break;
    }
    const finalHandles = maxHandles != null ? allHandles.slice(0, maxHandles) : allHandles;
    if (finalHandles.length === 0) {
      res.status(400).json({ error: 'Nenhum perfil no resultado da busca' });
      return;
    }
    const creditsNeeded = finalHandles.length * CREDITS_PER_INFLUENCER;
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
    if (!creditsCampaignsDb.spendCredits(userId, creditsNeeded, 'campaign', undefined)) {
      res.status(402).json({ error: 'Falha ao debitar créditos', code: 'DEBIT_FAILED' });
      return;
    }
    const campaignId = creditsCampaignsDb.createCampaign(userId, finalHandles, creditsNeeded, body.name, expiresAt);
    res.status(201).json({ campaignId, handlesCount: finalHandles.length, creditsUsed: creditsNeeded });
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
      created_at: campaign.created_at,
      expires_at: campaign.expires_at,
    };
    const payment = paymentsDb.getByCampaignId(campaignId, userId);
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
    }
    res.json(payload);
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

/** Parseia query params para ProfilesSearchQuery (mesma lógica da busca principal, sem q/categories). */
function buildCampaignProfilesQuery(req: { query: Record<string, unknown> }): ProfilesSearchQuery {
  const parseNumList = (v: unknown): number[] | undefined => {
    if (v == null) return undefined;
    if (Array.isArray(v)) return v.map(Number).filter(Number.isFinite);
    if (typeof v === 'string') return v.split(',').map((x) => Number(x.trim())).filter(Number.isFinite);
    return undefined;
  };
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
  const sort = (req.query.sort as string) || 'engagement_desc';
  const limit = Math.min(Math.max(0, Number(req.query.limit) || 50), 200);
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const q = (req.query.q as string)?.trim() || undefined;
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
    sort,
    limit,
    offset,
  };
}

/** Cache do contexto (lista completa) por campanha para aplicar filtros em cima sem refazer a busca. TTL 5 min. */
const CAMPAIGN_CONTEXT_CACHE_TTL_MS = 5 * 60 * 1000;
const campaignContextCache = new Map<
  string,
  { items: ProfileListItem[]; ts: number }
>();

function getCachedCampaignContext(campaignId: string): ProfileListItem[] | null {
  const entry = campaignContextCache.get(campaignId);
  if (!entry || Date.now() - entry.ts > CAMPAIGN_CONTEXT_CACHE_TTL_MS) return null;
  return entry.items;
}

function setCachedCampaignContext(campaignId: string, items: ProfileListItem[]): void {
  campaignContextCache.set(campaignId, { items, ts: Date.now() });
}

const COST_TIER_VALUES = ['low', 'medium', 'high', 'very_high'] as const;

function parseCostTierFilter(v: unknown): string[] | undefined {
  if (v == null) return undefined;
  const arr = Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.split(',').map((x) => x.trim().toLowerCase()) : [];
  const filtered = arr.filter((s) => (COST_TIER_VALUES as readonly string[]).includes(s));
  return filtered.length > 0 ? filtered : undefined;
}

/** Nome do header para contexto de campanha. Obrigatório ao acessar dados de outro influenciador. */
const X_CAMPAIGN_ID = 'x-campaign-id';

function normalizeHandle(h: string | undefined): string {
  return (h ?? '').replace(/^@/, '').trim().toLowerCase();
}

/**
 * Middleware: autoriza acesso a dados de um perfil somente se (1) o usuário logado é o dono do perfil, ou
 * (2) o header X-Campaign-Id é enviado com um GUID de campanha do usuário que contenha o handle.
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
    const handle = normalizeHandle(rawHandle);
    if (!handle) {
      if (options?.requireHandle) {
        res.status(403).json({
          error: 'Para acessar dados de perfil, informe o handle (ex.: profile=@handle na query) ou use o header X-Campaign-Id em uma rota de campanha.',
          code: 'HANDLE_REQUIRED',
        });
        return;
      }
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
    const campaignIdRaw = (req.headers[X_CAMPAIGN_ID] ?? req.headers['x-campaign-id']) as string | undefined;
    const campaignId = typeof campaignIdRaw === 'string' ? campaignIdRaw.trim() : '';
    if (!campaignId || !isCampaignIdGuid(campaignId)) {
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
  if (!campaignId || !isCampaignIdGuid(campaignId)) {
    res.status(403).json({
      error: 'Envie o header X-Campaign-Id com o ID de uma campanha válida.',
      code: 'CAMPAIGN_ID_REQUIRED',
    });
    return;
  }
  const userId = Number(req.user.sub);
  const campaign = creditsCampaignsDb.getCampaignIfActive(campaignId, userId);
  if (!campaign) {
    res.status(403).json({ error: 'Campanha não encontrada, expirada ou sem acesso.', code: 'CAMPAIGN_NOT_FOUND' });
    return;
  }
  (req as RequestWithAuth).allowedCampaignId = campaignId;
  next();
}

/** Listagem de perfis de uma campanha (paginação + filtros iguais à busca principal). */
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
    const handles = creditsCampaignsDb.getCampaignHandlesIfActive(campaignId, userId);
    if (!handles || handles.length === 0) {
      res.status(404).json({ error: 'Campanha não encontrada, expirada ou sem perfis' });
      return;
    }
    const query = buildCampaignProfilesQuery(req);
    let contextItems: ProfileListItem[] | null = getCachedCampaignContext(campaignId);
    if (contextItems == null) {
      const fullResult = await searchProfiles(db, { limit: 10000, offset: 0, sort: 'engagement_desc' }, { restrictToHandles: handles });
      contextItems = fullResult.items;
      setCachedCampaignContext(campaignId, contextItems);
    }
    const result = await searchProfiles(db, query, { initialItems: contextItems });
    res.json({ total: result.total, items: result.items, facets: result.facets });
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
    const handle = (req.params.handle ?? '').replace(/^@/, '').trim().toLowerCase();
    if (!handle) {
      res.status(400).json({ error: 'Handle inválido' });
      return;
    }
    const userId = Number(req.user.sub);
    const handles = creditsCampaignsDb.getCampaignHandlesIfActive(campaignId, userId);
    if (!handles || handles.length === 0) {
      res.status(404).json({ error: 'Campanha não encontrada, expirada ou sem perfis' });
      return;
    }
    const handleInCampaign = handles.some((h) => String(h).replace(/^@/, '').trim().toLowerCase() === handle);
    if (!handleInCampaign) {
      res.status(404).json({ error: 'Perfil não encontrado nesta campanha', handle: req.params.handle });
      return;
    }
    const value = await db.get('profile', handle);
    if (value == null) {
      res.status(404).json({ error: 'Perfil não encontrado', handle: req.params.handle });
      return;
    }
    const profile = value as Record<string, unknown>;
    res.setHeader('Cache-Control', 'no-store');
    res.json(profile);
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
    const handle = (req.params.handle ?? '').replace(/^@/, '').trim().toLowerCase();
    if (!handle) {
      res.status(400).json({ error: 'Handle inválido' });
      return;
    }
    const userId = Number(req.user.sub);
    const handles = creditsCampaignsDb.getCampaignHandlesIfActive(campaignId, userId);
    if (!handles || handles.length === 0) {
      res.status(404).json({ error: 'Campanha não encontrada, expirada ou sem perfis' });
      return;
    }
    const handleInCampaign = handles.some((h) => String(h).replace(/^@/, '').trim().toLowerCase() === handle);
    if (!handleInCampaign) {
      res.status(404).json({ error: 'Perfil não encontrado nesta campanha', handle: req.params.handle });
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
    res.json(data);
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

/** Dados de ativação do perfil. Só retorna dados completos se for o próprio influenciador ou com X-Campaign-Id. */
app.get(
  '/api/profiles/:handle/activation',
  rateLimitDataApi,
  requireProfileOrCampaign((req) => req.params.handle, { requireAuth: false }),
  async (req: RequestWithAuth, res: Response) => {
    try {
      if (!req.user) {
        res.status(200).json({ _redacted: true });
        return;
      }
      const handle = normalizeHandle(req.params.handle);
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
      res.json(data);
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
    const handle = (req.params.handle || '').replace(/^@/, '');
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

    res.json(data ?? {});
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Perfil por handle. Só retorna dados se for o próprio influenciador ou com X-Campaign-Id de campanha que contenha o perfil. */
app.get(
  '/api/profiles/:handle',
  rateLimitDataApi,
  requireProfileOrCampaign((req) => req.params.handle),
  async (req: RequestWithAuth, res: Response) => {
    try {
      const handle = normalizeHandle(req.params.handle);
      const value = await db.get('profile', handle);
      if (value == null) {
        res.status(404).json({ error: 'Perfil não encontrado', handle: req.params.handle });
        return;
      }
      const profile = value as Record<string, unknown>;
      res.setHeader('Cache-Control', 'no-store');
      res.json(profile);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  }
);

/** Resumo do perfil com engagement e BI. Só retorna dados completos se for o próprio influenciador ou com X-Campaign-Id. */
app.get(
  '/api/profiles/:handle/summary',
  rateLimitDataApi,
  requireProfileOrCampaign((req) => req.params.handle, { requireAuth: false }),
  async (req: RequestWithAuth, res: Response) => {
    try {
      const handle = normalizeHandle(req.params.handle);
      const summary = await getProfileSummary(db, handle);
      if (summary == null) {
        res.status(404).json({ error: 'Perfil não encontrado', handle: req.params.handle });
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      if (!req.user) {
        res.json({ profile: redactProfile(summary.profile), engagement: summary.engagement, bi: summary.bi });
        return;
      }
      res.json(summary);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  }
);

const MEDIA_TYPES = ['post', 'reel', 'tagged', 'highlight'] as const;

/** Deriva content_type do item: valor salvo ou chave handle:type:shortcode (retrocompat: handle:shortcode = post). */
function getContentTypeFromItem(key: string, value: Record<string, unknown>): string {
  const ct = value.content_type;
  if (typeof ct === 'string' && MEDIA_TYPES.includes(ct as (typeof MEDIA_TYPES)[number])) return ct;
  const parts = key.split(':');
  if (parts.length >= 3 && MEDIA_TYPES.includes(parts[1] as (typeof MEDIA_TYPES)[number])) return parts[1];
  return 'post';
}

/** Posts/reels/marcados/highlights do perfil. Requer profile=@handle (próprio ou com X-Campaign-Id). */
app.get(
  '/api/posts',
  rateLimitDataApi,
  requireProfileOrCampaign((req) => req.query.profile as string | undefined, { requireHandle: true, requireAuth: false }),
  async (req: RequestWithAuth, res: Response) => {
    try {
      const profileFilter = normalizeHandle(req.query.profile as string | undefined);
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
      if (!req.user) {
        res.json({ total, items: redactPostsItems(slice), _redacted: true });
        return;
      }
      res.json({ total, items: slice });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  }
);

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
    extractProfileResults.set(handle, { status: 'done', result });
    console.log(`[runExtractAndStore] ${logTimestamp()} @${handle} pronto em ${Date.now() - t0}ms (status=done)`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const isLoginRelated = /ERR_HTTP_RESPONSE_CODE_FAILURE|net::ERR|sessão|login/i.test(msg);
    let error = isLoginRelated
      ? 'Sessão do Instagram expirada ou não logada. Execute o login na pasta crawl: npm run login'
      : msg;
    if (msg === 'Perfil não encontrado') {
      error = 'Perfil não encontrado. Se o perfil existir, a sessão do Instagram pode ter expirado. Execute na pasta crawl: npm run login';
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
      error: `Sessão do Instagram não configurada. Execute o login na pasta crawl: npm run login (arquivo esperado: ${authStatePath})`,
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
  let handle = (req.body?.handle ?? req.body?.url ?? '').toString().trim();
  if (!handle) {
    res.status(400).json({ error: 'Envie "handle" (ex.: rafaellacassol).' });
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
  console.log('Aquecendo cache de busca (perfis + posts)...');
  const t0 = Date.now();
  try {
    await warmSearchCache(db);
    console.log(`Cache de busca aquecido em ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
  } catch (err: unknown) {
    const code = err && typeof err === 'object' && 'code' in err ? (err as { code?: string }).code : undefined;
    const causeCode = err instanceof Error && err.cause && typeof err.cause === 'object' && 'code' in err.cause ? (err.cause as { code?: string }).code : undefined;
    if (code === 'LEVEL_DATABASE_NOT_OPEN' || causeCode === 'LEVEL_LOCKED') {
      console.warn('Cache de busca não carregado (banco em uso por outro processo?). API sobe sem cache; buscas podem ser mais lentas.');
    } else {
      throw err;
    }
  }
  app.listen(PORT, () => {
    console.log(`API: http://localhost:${PORT}`);
    console.log(`Swagger RocksDB: http://localhost:${PORT}/api-docs/rocksdb`);
    console.log(`Swagger SQLite: http://localhost:${PORT}/api-docs/sqlite`);
    // Aquecer o browser em background para o primeiro extract-profile não esperar abrir o Chromium
    getApiExtractClient()
      .init()
      .then(() => console.log('Browser (Chromium) aquecido e pronto para extract-profile.'))
      .catch((err) => console.warn('Warmup do browser falhou (primeiro extract-profile pode demorar):', err instanceof Error ? err.message : err));
    // Worker de fila de disparo em background (roda sempre que há pendentes)
    startDirectQueueWorker();
  });
})().catch((err) => {
  console.error('Falha ao iniciar a API:', err);
  process.exit(1);
});
