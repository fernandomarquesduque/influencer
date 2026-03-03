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
import { searchProfiles, getProfileSummary, scheduleSearchCacheRewarm, warmSearchCache, type ProfilesSearchQuery } from './profilesSearch.js';
import { InstagramClient } from '../instagramClient/index.js';
import { loginWithCredentials } from '../instagramClient/login.js';
import { profileExtractDelay, profileExtractDelayForApi } from '../utils/delay.js';
import { logTimestamp } from '../utils/logTimestamp.js';
import { get429BackoffMs, record429 } from '../utils/rateLimit429.js';
import { sendVerificationCode, sendDirectMessage } from '../instagramClient/sendDirectMessage.js';
import { followUser, followUserFromCurrentPage } from '../instagramClient/followUser.js';
import { openFollowersModal, searchInFollowersModal } from '../instagramClient/getMyFollowers.js';
import type { Page } from 'playwright';
import { extractProfile } from '../profileExtractor/index.js';
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
    const page = await client.newPage();
    const config = buildConfigFromEnv();
    const extractTimeoutMs = Math.max(60000, parseInt(process.env.PROFILE_PROCESS_TIMEOUT_MS ?? '180000', 10) || 180000);
    const timeoutPromise = new Promise<ExtractSingleProfileResult>((_, reject) =>
      setTimeout(() => reject(new Error(`Extract profile timeout (${extractTimeoutMs / 1000}s)`)), extractTimeoutMs)
    );
    let result: ExtractSingleProfileResult;
    try {
      result = await Promise.race([
        extractSingleProfileWithPage(page, handle, db, config, { forRefresh, fastMode: fromExtractProfileApi }),
        timeoutPromise,
      ]);
      console.log(`[runOneExtract] @${handle} extração concluída, fechando página...`);
    } finally {
      const tClose = Date.now();
      await page.close().catch(() => { });
      console.log(`[runOneExtract] @${handle} página fechada em ${Date.now() - tClose}ms`);
    }
    const tAuth = Date.now();
    await client.saveAuthState();
    console.log(`[runOneExtract] @${handle} auth state salvo em ${Date.now() - tAuth}ms`);

    if (isBlockSignal(result)) {
      record429();
      apiExtractBlockedUntil = Date.now() + get429BackoffMs();
      if (isLoginOrChallengeSignal(result)) {
        await client.closeContext();
      }
      return result;
    }
    if (result.success && result.saved
      && !forRefresh
    ) {
      console.log(`[runOneExtract] @${result.handle} extração salva, tentando enfileirar #selecao (30 min)`);
      enqueueSelectionMessageIfAllowed(result.handle);
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
    return { success: false, handle, error: msg };
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
            const extracted = await extractProfile(page, nickname, 'seed', '', config, { fastMode: true });
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
            // Seguir de volta: influenciador nos segue → seguimos ele antes de enviar o código
            const followBackEnabled = process.env.FOLLOW_BACK_ENABLED !== 'false';
            if (followBackEnabled) {
              const followResult = await followUserFromCurrentPage(page);
              if (!followResult.ok) logStep(`Follow-back falhou (não bloqueia envio): ${followResult.error ?? 'erro'}`);
              else if (followResult.alreadyFollowing) logStep('Follow-back: já estávamos seguindo.');
              else logStep('Follow-back: seguimos o influenciador.');
            }
          } finally {
            // Fechar página em background para não travar o fluxo (page.close() pode demorar)
            void page.close().then(() => { /* página fechada */ }).catch(() => { });
            logStep('Página em fechamento (background).');
          }
        }
      }

      // Quando usamos cache (segue perfil) e follow-back está ativo: abrir perfil só para seguir de volta
      const followBackEnabled = process.env.FOLLOW_BACK_ENABLED !== 'false';
      if (followBackEnabled && requiredProfile && requiredProfile.length > 0) {
        const followsFromExtract = (() => {
          const stored = extractProfileResults.get(nickname.trim().toLowerCase());
          return stored?.status === 'done' && stored.result && 'followsOfficialProfile' in stored.result
            ? (stored.result as { followsOfficialProfile?: boolean }).followsOfficialProfile
            : undefined;
        })();
        if (followsFromExtract === true) {
          const followResult = await followUser(client, nickname);
          if (!followResult.ok) logStep(`Follow-back (cache) falhou (não bloqueia envio): ${followResult.error ?? 'erro'}`);
          else if (followResult.alreadyFollowing) logStep('Follow-back (cache): já estávamos seguindo.');
          else logStep('Follow-back (cache): seguimos o influenciador.');
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
    console.warn('[API] proxy-image: CDN retornou', r.status, 'para', url.slice(0, 80) + '...');
    if (r.status === 403 || !r.ok) {
      for (const toProxyUrl of FALLBACK_PROXIES) {
        try {
          const proxyUrl = toProxyUrl(url);
          r = await fetchWithTimeout(proxyUrl, { headers: { Accept: 'image/*,*/*;q=0.8' } });
          if (r.ok) {
            const done = await tryStream(r);
            if (done) return;
          }
        } catch (err) {
          console.warn('[API] proxy-image fallback falhou:', err instanceof Error ? err.message : err);
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

/** Lista bruta de perfis (com dados completos). Apenas autenticados — evita extração pública. */
app.get('/api/profiles', rateLimitDataApi, async (req: RequestWithAuth, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Faça login para acessar a lista de perfis.', code: 'UNAUTHORIZED' });
      return;
    }
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const since = (req.query.since as string)?.trim();
    let items = await db.getByBucket('profile');
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
/** Limite diário de buscas para anônimos e usuários public (proteção contra extração em massa). Configurável por API_PUBLIC_MAX_REQUESTS_PER_DAY. */
const PUBLIC_MAX_REQUESTS_PER_DAY = Number(process.env.API_PUBLIC_MAX_REQUESTS_PER_DAY) || 50;
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

/** Retorna true se o visitante é público (ou anônimo) e já atingiu o limite de requisições/dia — nesse caso as APIs de perfil/ativação/posts devem retornar dados redigidos. Admin e assinante nunca sofrem limite. */
function publicAtLimit(req: RequestWithAuth): boolean {
  if (req.user?.scope === 'adm' || req.user?.scope === 'assinante') {
    return false;
  }
  if (req.user?.scope === 'public') {
    return authDb.countPublicRequestsToday(Number(req.user.sub)) >= PUBLIC_MAX_REQUESTS_PER_DAY;
  }
  if (!req.user) {
    const ip = (req.ip || (req as unknown as { socket?: { remoteAddress?: string } }).socket?.remoteAddress || 'unknown').toString();
    const ipHash = crypto.createHash('sha256').update(ip + (process.env.ANON_SEARCH_SALT || '')).digest('hex');
    return authDb.countAnonymousRequestsToday(ipHash) >= PUBLIC_MAX_REQUESTS_PER_DAY;
  }
  return false;
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

/** Listagem de perfis com filtros avançados e engajamento. Público (anônimo ou scope public): 1ª página, até PUBLIC_MAX_REQUESTS_PER_DAY requisições/dia. */
app.get('/api/profiles/search', rateLimitDataApi, async (req: RequestWithAuth, res: Response) => {
  try {
    const q = (req.query.q as string)?.trim();
    const parseNumList = (v: unknown): number[] | undefined => {
      if (v == null) return undefined;
      if (Array.isArray(v)) return v.map((x) => Number(x)).filter(Number.isFinite);
      if (typeof v === 'string') return v.split(',').map((x) => Number(x.trim())).filter(Number.isFinite);
      return undefined;
    };
    const isPublicOrAnonymous = !req.user || req.user.scope === 'public';
    if (isPublicOrAnonymous) {
      if (Number(req.query.offset) > 0) {
        res.status(403).json({ error: 'Assinantes podem ver mais páginas. Seja premium.', code: 'PUBLIC_PAGE_LIMIT' });
        return;
      }
      if (req.user?.scope === 'public') {
        const userId = Number(req.user.sub);
        const count = authDb.countPublicRequestsToday(userId);
        if (count >= PUBLIC_MAX_REQUESTS_PER_DAY) {
          res.status(403).json({ error: `Limite de ${PUBLIC_MAX_REQUESTS_PER_DAY} buscas por dia. Seja assinante para buscar sem limite.`, code: 'PUBLIC_SEARCH_LIMIT' });
          return;
        }
        authDb.addPublicRequest(userId);
      } else if (!req.user) {
        const ip = (req.ip || req.socket?.remoteAddress || 'unknown').toString();
        const ipHash = crypto.createHash('sha256').update(ip + (process.env.ANON_SEARCH_SALT || '')).digest('hex');
        const count = authDb.countAnonymousRequestsToday(ipHash);
        if (count >= PUBLIC_MAX_REQUESTS_PER_DAY) {
          res.status(403).json({ error: `Limite de ${PUBLIC_MAX_REQUESTS_PER_DAY} buscas por dia. Faça login ou seja assinante para mais.`, code: 'PUBLIC_SEARCH_LIMIT' });
          return;
        }
        authDb.addAnonymousRequest(ipHash);
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
    const sort = (req.query.sort as string) || 'engagement_desc';
    const limitRaw = isPublicOrAnonymous ? PUBLIC_PAGE_SIZE : Math.min(Math.max(0, Number(req.query.limit) || 50), 200);
    const offsetRaw = isPublicOrAnonymous ? 0 : Math.max(0, Number(req.query.offset) || 0);
    const limit = isPublicOrAnonymous ? PUBLIC_PAGE_SIZE : limitRaw;
    const offset = isPublicOrAnonymous ? 0 : offsetRaw;

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
      categories,
      contentTypes: Array.isArray(contentTypes) ? contentTypes.map(String).filter(Boolean) : typeof contentTypes === 'string' ? contentTypes?.split(',').map((x) => x.trim()).filter(Boolean) : undefined,
      pricingPostUnique: parseNumList(req.query.pricingPostUnique),
      pricingStories: parseNumList(req.query.pricingStories),
      pricingPackageMonthly: parseNumList(req.query.pricingPackageMonthly),
      pricingCommission: parseNumList(req.query.pricingCommission),
      pricingPermuta: parseNumList(req.query.pricingPermuta),
      pricingImageRights: parseNumList(req.query.pricingImageRights),
      pricingContentDelivery: parseNumList(req.query.pricingContentDelivery),
      pricingLaunch: parseNumList(req.query.pricingLaunch),
      sort,
      limit,
      offset,
    };
    const result = await searchProfiles(db, query);
    if (!req.user) {
      res.json(redactSearchResultForAnonymous(result as unknown as { total: number; items: Record<string, unknown>[]; facets: Record<string, unknown> }));
      return;
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Dados de ativação do perfil (cadastro completo na plataforma). Sem login não retorna dados (contato, preços). */
app.get('/api/profiles/:handle/activation', rateLimitDataApi, async (req: RequestWithAuth, res: Response) => {
  try {
    if (!req.user || publicAtLimit(req)) {
      res.status(200).json({ _redacted: true });
      return;
    }
    const handle = (req.params.handle || '').replace(/^@/, '');
    const data = sqlite.getActivation(handle);
    if (data == null) {
      res.status(200).json({});
      return;
    }
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

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

/** Perfil por handle. Para público que atingiu limite diário, retorna versão redigida (sem contagens, bio, etc.) para evitar vazamento. */
app.get('/api/profiles/:handle', rateLimitDataApi, async (req: RequestWithAuth, res: Response) => {
  try {
    const handle = (req.params.handle || '').replace(/^@/, '');
    const key = handle.toLowerCase();
    const value = await db.get('profile', key);
    if (value == null) {
      res.status(404).json({ error: 'Perfil não encontrado', handle: req.params.handle });
      return;
    }
    const profile = value as Record<string, unknown>;
    res.setHeader('Cache-Control', 'no-store');
    if (!req.user || publicAtLimit(req)) {
      res.json(redactProfile(profile));
      return;
    }
    res.json(profile);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Resumo do perfil com engagement e BI (métricas derivadas 100% do Instagram). Retorna profile + engagement + bi. */
app.get('/api/profiles/:handle/summary', rateLimitDataApi, async (req: RequestWithAuth, res: Response) => {
  try {
    const handle = (req.params.handle || '').replace(/^@/, '');
    const summary = await getProfileSummary(db, handle);
    if (summary == null) {
      res.status(404).json({ error: 'Perfil não encontrado', handle: req.params.handle });
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    if (!req.user || publicAtLimit(req)) {
      res.json({ profile: redactProfile(summary.profile), engagement: summary.engagement, bi: summary.bi });
      return;
    }
    res.json(summary);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

const MEDIA_TYPES = ['post', 'reel', 'tagged', 'highlight'] as const;

/** Deriva content_type do item: valor salvo ou chave handle:type:shortcode (retrocompat: handle:shortcode = post). */
function getContentTypeFromItem(key: string, value: Record<string, unknown>): string {
  const ct = value.content_type;
  if (typeof ct === 'string' && MEDIA_TYPES.includes(ct as (typeof MEDIA_TYPES)[number])) return ct;
  const parts = key.split(':');
  if (parts.length >= 3 && MEDIA_TYPES.includes(parts[1] as (typeof MEDIA_TYPES)[number])) return parts[1];
  return 'post';
}

/** Posts/reels/marcados/highlights do perfil. type=post|reel|tagged|highlight filtra; sem type retorna todos. */
app.get('/api/posts', rateLimitDataApi, async (req: RequestWithAuth, res: Response) => {
  try {
    const profileFilter = (req.query.profile as string)?.toLowerCase().replace(/^@/, '');
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
    if (!req.user || publicAtLimit(req)) {
      res.json({ total, items: redactPostsItems(slice), _redacted: true });
      return;
    }
    res.json({ total, items: slice });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Projetos para influenciadores (estilo Workana). Lista e detalhe: usuário logado. Criar: adm. Candidatar: influenciador. */
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
  await warmSearchCache(db);
  console.log(`Cache de busca aquecido em ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
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
