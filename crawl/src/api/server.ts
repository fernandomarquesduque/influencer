import 'dotenv/config';
import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Request, type Response } from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Raiz do projeto crawl (onde ficam .env e .auth). Funciona com tsx (src/api) e com node após build (dist/api). */
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
import { searchProfiles, scheduleSearchCacheRewarm, warmSearchCache, type ProfilesSearchQuery } from './profilesSearch.js';
import { InstagramClient } from '../instagramClient/index.js';
import { loginWithCredentials } from '../instagramClient/login.js';
import { profileExtractDelay } from '../utils/delay.js';
import { get429BackoffMs, record429 } from '../utils/rateLimit429.js';
import { sendVerificationCode } from '../instagramClient/sendDirectMessage.js';
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

/** Fila de handles para re-extração quando imagem falha (renovar URLs). Uma execução por vez, em série com extract-profile. */
const refreshProfileQueue: string[] = [];
const refreshProfileQueueSet = new Set<string>();

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

/** Executa uma extração (um perfil). Usado pelo extract-profile e pela fila de refresh. forRefresh=true pula todas as validações de qualificação. Se a sessão estiver expirada e houver INSTAGRAM_USER/PASSWORD no .env, tenta login automático e reextrai uma vez. */
async function runOneExtract(handle: string, forRefresh = false, didAutoLogin = false): Promise<ExtractSingleProfileResult> {
  try {
    const now = Date.now();
    if (now < apiExtractBlockedUntil) {
      return {
        success: false,
        handle,
        error: `Rate limit ou bloqueio. Tente novamente em ${Math.ceil((apiExtractBlockedUntil - now) / 60000)} min.`,
      };
    }
    await profileExtractDelay();
    const cooldownEvery = Math.max(0, parseInt(process.env.COOLDOWN_EVERY ?? '10', 10) || 10);
    const cooldownMinMs = Math.max(0, parseInt(process.env.COOLDOWN_MIN_MS ?? '60000', 10) || 60000);
    const cooldownMaxMs = Math.max(cooldownMinMs, parseInt(process.env.COOLDOWN_MAX_MS ?? '180000', 10) || 180000);
    if (cooldownEvery > 0 && apiExtractProfileCount > 0 && apiExtractProfileCount % cooldownEvery === 0) {
      const cooldownMs = cooldownMinMs + Math.floor(Math.random() * (cooldownMaxMs - cooldownMinMs + 1));
      await new Promise((r) => setTimeout(r, cooldownMs));
    }
    const client = getApiExtractClient();
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
        extractSingleProfileWithPage(page, handle, db, config, { forRefresh }),
        timeoutPromise,
      ]);
    } finally {
      await page.close().catch(() => { });
    }
    await client.saveAuthState();

    if (isBlockSignal(result)) {
      record429();
      apiExtractBlockedUntil = Date.now() + get429BackoffMs();
      if (isLoginOrChallengeSignal(result)) {
        await client.closeContext();
      }
      return result;
    }
    apiExtractProfileCount++;
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
      if (apiExtractClient) {
        await apiExtractClient.close().catch(() => { });
        apiExtractClient = null;
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
          return runOneExtract(handle, forRefresh, true);
        }
      } catch (loginErr) {
        console.error('[API] Login automático falhou:', loginErr instanceof Error ? loginErr.message : loginErr);
      }
    }

    console.error(`[API] runOneExtract @${handle} exceção:`, msg, stack ?? '');
    return { success: false, handle, error: msg };
  }
}

/** Processa o próximo handle da fila de refresh (re-extração por falha de imagem). Uma execução por vez. */
function processNextRefresh(): void {
  if (refreshProfileQueue.length === 0) return;
  const handle = refreshProfileQueue.shift()!;
  console.log(`[API] Refresh de imagens iniciado: @${handle}`);
  apiExtractQueue = apiExtractQueue
    .then(() => runOneExtract(handle, true))
    .then((result) => {
      if (result.saved) console.log(`[API] Refresh de imagens concluído: @${handle}`);
      else if (result.error) console.error(`[API] Refresh @${handle} falhou:`, result.error);
      else if (result.rejectionReason) console.warn(`[API] Refresh @${handle} rejeitado:`, result.rejectionReason);
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
        profile_activated = !!sqlite.getActivation(handle)?.activated_at;
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
      profile_activated = !!(activation?.activated_at);
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

/** Solicita código de ativação 2FA: envia (via inbox do Instagram) um código para o nickname. Pode ser chamado sem login (2FA é o login). */
app.post('/api/auth/request-code', async (req: RequestWithAuth, res: Response) => {
  try {
    const nickname = (req.body?.nickname ?? req.body?.handle ?? '').toString().trim().replace(/^@/, '');
    if (!nickname) {
      res.status(400).json({ error: 'Informe o nickname do Instagram' });
      return;
    }
    const userId = req.user ? Number(req.user.sub) : null;
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    authDb.saveProfileVerification(nickname, code, userId, expiresAt);

    const authStatePath = resolveAuthStatePath(
      process.env.INSTAGRAM_AUTH_STATE ?? process.env.AUTH_STATE_PATH ?? '.auth/instagram.json'
    );
    const isDev = process.env.NODE_ENV === 'development';

    if (!existsSync(authStatePath)) {
      if (isDev) {
        res.status(200).json({ sent: false, code, error: 'Sessão do Instagram não configurada. Use o código acima para testar.' });
      } else {
        res.status(503).json({ error: 'Sessão do Instagram não configurada. Execute o login do crawl (npm run login).' });
      }
      return;
    }

    const headless = process.env.HEADFUL === 'true' ? false : process.env.HEADFUL === 'false' ? true : process.env.NODE_ENV === 'production' ? true : false;
    const maxAttempts = 3;
    const delayMs = 2000;
    const client = new InstagramClient({ authStatePath, headless });
    try {
      await client.init();

      const requiredProfile = process.env.INSTAGRAM_PERFIL?.trim().replace(/^@/, '');
      if (requiredProfile && requiredProfile.length > 0) {
        const nickNorm = nickname.trim().toLowerCase();
        const stored = extractProfileResults.get(nickNorm);
        const followsFromExtract =
          stored?.status === 'done' && stored.result && 'followsOfficialProfile' in stored.result
            ? (stored.result as { followsOfficialProfile?: boolean }).followsOfficialProfile
            : undefined;

        if (followsFromExtract === true) {
          // Reutiliza resultado da extração (perfil já foi aberto uma vez); não abre de novo.
        } else if (followsFromExtract === false) {
          const followProfileUrl = `https://www.instagram.com/${requiredProfile}/`;
          res.status(400).json({ error: 'nao_segue_perfil', followProfileUrl });
          return;
        } else {
          // Sem resultado recente da extração: abre o perfil uma vez para checar.
          const page = await client.newPage();
          try {
            const config = buildConfigFromEnv();
            const extracted = await extractProfile(page, nickname, 'seed', '', config);
            if (!extracted) {
              if (isDev) {
                res.status(200).json({ sent: false, code, error: 'Perfil não encontrado ou indisponível.' });
              } else {
                res.status(400).json({ error: 'Perfil não encontrado ou indisponível.' });
              }
              return;
            }
            const profileEntity = extracted.profile as Record<string, unknown>;
            const dataUser = (profileEntity?.data as Record<string, unknown> | undefined)?.user as Record<string, unknown> | undefined;
            const entityUsername = dataUser?.username != null ? String(dataUser.username).trim().toLowerCase() : null;
            if (entityUsername == null || entityUsername !== nickNorm) {
              if (isDev) {
                res.status(200).json({ sent: false, code, error: entityUsername == null ? 'Não foi possível verificar o perfil. Tente novamente.' : 'Resposta da API não corresponde ao perfil solicitado.' });
              } else {
                res.status(400).json({ error: 'Perfil não encontrado ou indisponível.' });
              }
              return;
            }
            if (!isFollowingViewerFromEntity(profileEntity)) {
              const followProfileUrl = `https://www.instagram.com/${requiredProfile}/`;
              res.status(400).json({ error: 'nao_segue_perfil', followProfileUrl });
              return;
            }
          } finally {
            await page.close().catch(() => { });
          }
        }
      }

      let result = await sendVerificationCode(client, nickname, code);
      for (let attempt = 1; !result.ok && attempt < maxAttempts; attempt++) {
        await new Promise((r) => setTimeout(r, delayMs));
        result = await sendVerificationCode(client, nickname, code);
      }
      if (!result.ok) {
        if (isDev) {
          res.status(200).json({ sent: false, code, error: result.error });
        } else {
          res.status(503).json({ error: result.error ?? 'Falha ao enviar mensagem no Instagram.' });
        }
        return;
      }
    } finally {
      await client.close();
    }

    if (isDev) {
      res.status(200).json({ sent: true, code });
    } else {
      res.status(200).json({ sent: true });
    }
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
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
    if (body.profile_handle !== undefined) updates.profile_handle = (body.profile_handle as string).trim() || null;
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

/** LGPD: excluir conta do próprio usuário (influencer). Remove todos os dados: ativação, perfil, posts e conta de login. */
app.delete('/api/account', requireScopes('influencer'), async (req: RequestWithAuth, res: Response) => {
  try {
    const handle = (req.user!.profile_handle || '').replace(/^@/, '').trim().toLowerCase();
    if (!handle) {
      res.status(400).json({ error: 'Conta sem perfil vinculado.' });
      return;
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
    res.status(404).end();
  } catch (e) {
    console.error('[API] proxy-image 502:', e instanceof Error ? e.message : e);
    res.status(502).end();
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
  const sensitive = ['followers_count', 'following_count', 'media_count', 'media_count_visible', 'categories', 'external_url', '_collected_at', '_discovered_by', '_discovered_value'];
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
    sqlite.saveActivation(handle, {
      address: typeof body.address === 'string' ? body.address : undefined,
      city: typeof body.city === 'string' ? body.city : undefined,
      state: typeof body.state === 'string' ? body.state : undefined,
      neighborhood: typeof body.neighborhood === 'string' ? body.neighborhood : undefined,
      country: typeof body.country === 'string' ? body.country : undefined,
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

/** Posts do perfil. Para público que atingiu limite diário, retorna posts sem métricas (likes, comentários, views). */
app.get('/api/posts', rateLimitDataApi, async (req: RequestWithAuth, res: Response) => {
  try {
    const profileFilter = (req.query.profile as string)?.toLowerCase().replace(/^@/, '');
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const items = profileFilter
      ? await db.getByBucket('post', profileFilter + ':')
      : await db.getByBucket('post');
    const total = items.length;
    const slice = items.slice(offset, offset + limit).map(({ key, value }) => {
      const item = value as Record<string, unknown>;
      const post = item?.post as Record<string, unknown> | undefined;
      const content = item?.content as Record<string, unknown> | undefined;
      if (post && post.taken_at == null && content?.caption_created_at != null && typeof content.caption_created_at === 'number') {
        item.post = { ...post, taken_at: content.caption_created_at };
      }
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

/** Executa extração e grava resultado em extractProfileResults (para polling). */
async function runExtractAndStore(handle: string): Promise<void> {
  try {
    const result = await runOneExtract(handle, true);
    if (isBlockSignal(result)) {
      extractProfileResults.set(handle, {
        status: 'error',
        error: result.error ?? 'Bloqueio ou rate limit (429/challenge). Não tente de novo agora.',
      });
      return;
    }
    extractProfileResults.set(handle, { status: 'done', result });
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
    process.env.INSTAGRAM_AUTH_STATE ?? process.env.AUTH_STATE_PATH ?? '.auth/instagram.json'
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
    .then(() => runExtractAndStore(handle))
    .catch((err) => {
      console.error('[API] extract-profile erro:', err instanceof Error ? err.stack : err);
      extractProfileResults.set(handle, { status: 'error', error: err instanceof Error ? err.message : String(err) });
    });
});

/** Enfileira re-extração do perfil (renovar URLs de imagem quando falham). Apenas adm. */
app.post('/api/crawl/queue-refresh', requireScopes('adm'), (req: Request, res: Response) => {
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
  refreshProfileQueue.push(handle);
  refreshProfileQueueSet.add(handle);
  processNextRefresh();
  res.status(202).json({ queued: true, handle, message: 'Perfil na fila para re-extração (renovar imagens). Uma execução por vez.' });
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
  });
})().catch((err) => {
  console.error('Falha ao iniciar a API:', err);
  process.exit(1);
});
