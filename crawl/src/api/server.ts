import 'dotenv/config';
import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import express, { type Request, type Response } from 'express';
import swaggerUi from 'swagger-ui-express';
import { createRequire } from 'node:module';
import { RocksDBStorage } from '../storage/rocksdb.js';
import { SqliteSync } from '../storage/sqliteSync.js';
import { CompositeStorage } from '../storage/compositeStorage.js';
import { runCrawl } from '../crawl/runCrawl.js';
import { extractSingleProfile } from '../crawl/extractSingleProfile.js';
import { searchProfiles, type ProfilesSearchQuery } from './profilesSearch.js';
import { InstagramClient } from '../instagramClient/index.js';
import { sendVerificationCode } from '../instagramClient/sendDirectMessage.js';
import { AuthDb } from '../auth/authDb.js';
import { authOptional, requireScopes, canEditProfile, type RequestWithAuth } from '../auth/middleware.js';
import { signJwt, getJwtSecret } from '../auth/jwt.js';
import { verifyPassword, hashPassword } from '../auth/password.js';
import type { AuthScope } from '../auth/types.js';
import { listTables, queryTable, isAllowedTable } from './dbQueries.js';

const require = createRequire(import.meta.url);
const openApiSpec = require('./openapi.json');

const PORT = Number(process.env.API_PORT) || 3000;
const rocksPath = process.env.STORAGE_DB_PATH ?? './data/rocksdb';
const sqlitePath = process.env.SQLITE_DB_PATH ?? './data/influencer.db';

const app = express();
app.use(express.json());

const rocks = new RocksDBStorage({ dbPath: rocksPath });
const sqlite = new SqliteSync(sqlitePath);
const db = new CompositeStorage(rocks, sqlite);
const authDb = new AuthDb(sqlitePath);

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
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        scope: user.scope,
        profile_handle: user.profile_handle,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Usuário atual (a partir do JWT). */
app.get('/api/auth/me', (req: RequestWithAuth, res: Response) => {
  if (!req.user) {
    res.status(200).json({ user: null });
    return;
  }
  res.json({
    user: {
      id: Number(req.user.sub),
      username: req.user.username,
      scope: req.user.scope,
      profile_handle: req.user.profile_handle ?? null,
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

    const authStatePath = process.env.INSTAGRAM_AUTH_STATE ?? '.auth/instagram.json';
    const isDev = process.env.NODE_ENV === 'development';

    if (!existsSync(authStatePath)) {
      if (isDev) {
        res.status(200).json({ sent: false, code, error: 'Sessão do Instagram não configurada. Use o código acima para testar.' });
      } else {
        res.status(503).json({ error: 'Sessão do Instagram não configurada. Execute o login do crawl (npm run login).' });
      }
      return;
    }

    const headless = process.env.HEADFUL !== 'true';
    const maxAttempts = 3;
    const delayMs = 2000;
    const client = new InstagramClient({ authStatePath, headless });
    try {
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
      authDb.updateUser(currentUserId, { profile_handle: nickname, username: nickname });
      return res.status(200).json({ verified: true, profile_handle: nickname });
    }

    if (verified !== 'valid_no_user') {
      res.status(400).json({ error: 'Código foi solicitado com outra conta. Use o mesmo login ou solicite um novo código.' });
      return;
    }

    let user = authDb.getByProfileHandle(nickname);
    if (!user) {
      const randomPassword = crypto.randomBytes(32).toString('hex');
      const id = authDb.createUser(nickname, hashPassword(randomPassword), 'influencer', nickname);
      user = authDb.getById(id)!;
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

/** Proxy de imagem para evitar bloqueio por CORS/referrer (ex.: CDN do Instagram). */
app.get('/api/proxy-image', async (req: Request, res: Response) => {
  const url = (req.query.url as string)?.trim();
  if (!url || (!url.startsWith('https://') && !url.startsWith('http://'))) {
    res.status(400).json({ error: 'Query "url" obrigatória e deve ser http(s).' });
    return;
  }
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
    if (!r.ok) {
      res.status(r.status).end();
      return;
    }
    const contentType = r.headers.get('content-type') || 'image/jpeg';
    res.setHeader('content-type', contentType);
    res.setHeader('cache-control', 'public, max-age=86400');
    const buf = await r.arrayBuffer();
    res.end(Buffer.from(buf));
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/profiles', async (req: Request, res: Response) => {
  try {
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
const PUBLIC_MAX_REQUESTS_PER_DAY = 10;

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

/** Listagem de perfis com filtros avançados e engajamento. Público (anônimo ou scope public): 1ª página, até 10 requisições/dia. */
app.get('/api/profiles/search', async (req: RequestWithAuth, res: Response) => {
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
          res.status(403).json({ error: 'Limite de 10 buscas por dia. Seja assinante para buscar sem limite.', code: 'PUBLIC_SEARCH_LIMIT' });
          return;
        }
        authDb.addPublicRequest(userId);
      } else if (!req.user) {
        const ip = (req.ip || req.socket?.remoteAddress || 'unknown').toString();
        const ipHash = crypto.createHash('sha256').update(ip + (process.env.ANON_SEARCH_SALT || '')).digest('hex');
        const count = authDb.countAnonymousRequestsToday(ipHash);
        if (count >= PUBLIC_MAX_REQUESTS_PER_DAY) {
          res.status(403).json({ error: 'Limite de 10 buscas por dia. Faça login ou seja assinante para mais.', code: 'PUBLIC_SEARCH_LIMIT' });
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
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Dados de ativação do perfil (cadastro completo na plataforma). Para público que atingiu limite diário, retorna vazio para evitar vazamento. */
app.get('/api/profiles/:handle/activation', async (req: RequestWithAuth, res: Response) => {
  try {
    const handle = (req.params.handle || '').replace(/^@/, '');
    if (publicAtLimit(req)) {
      res.status(200).json({ _redacted: true });
      return;
    }
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
app.get('/api/profiles/:handle', async (req: RequestWithAuth, res: Response) => {
  try {
    const handle = (req.params.handle || '').replace(/^@/, '');
    const key = handle.toLowerCase();
    const value = await db.get('profile', key);
    if (value == null) {
      res.status(404).json({ error: 'Perfil não encontrado', handle: req.params.handle });
      return;
    }
    const profile = value as Record<string, unknown>;
    if (publicAtLimit(req)) {
      res.json(redactProfile(profile));
      return;
    }
    res.json(profile);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Posts do perfil. Para público que atingiu limite diário, retorna posts sem métricas (likes, comentários, views). */
app.get('/api/posts', async (req: RequestWithAuth, res: Response) => {
  try {
    const profileFilter = (req.query.profile as string)?.toLowerCase().replace(/^@/, '');
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    let items = await db.getByBucket('post');
    if (profileFilter) {
      items = items.filter((i) => i.key.startsWith(profileFilter + ':'));
    }
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
    if (publicAtLimit(req)) {
      res.json({ total, items: redactPostsItems(slice), _redacted: true });
      return;
    }
    res.json({ total, items: slice });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/buckets/:bucket', async (req: Request, res: Response) => {
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

app.delete('/api/clear', async (_req: Request, res: Response) => {
  try {
    await db.clearAll();
    res.json({ ok: true, message: 'Todos os dados do banco foram removidos.' });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/crawl/status', (_req: Request, res: Response) => {
  res.json({
    running: crawlInProgress,
    ...(lastCrawlResult && { last: lastCrawlResult }),
  });
});

app.post('/api/crawl/stop', (_req: Request, res: Response) => {
  crawlAbortRequested = true;
  res.json({ ok: true, message: 'Parada solicitada. O crawl encerrará após o perfil atual.' });
});

/** Extrai um perfil específico por URL ou handle. Útil para testar e para incluir perfis que não passaram no crawl por hashtag. */
app.post('/api/crawl/extract-profile', async (req: Request, res: Response) => {
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
  handle = handle.replace(/^@/, '');
  try {
    const result = await extractSingleProfile(handle, db);
    res.json(result);
  } catch (e) {
    res.status(500).json({
      success: false,
      handle,
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

app.post('/api/crawl', async (req: Request, res: Response) => {
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

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
}));

app.get('/api-docs.json', (_req: Request, res: Response) => {
  res.json(openApiSpec);
});

app.listen(PORT, () => {
  console.log(`API: http://localhost:${PORT}`);
  console.log(`Swagger UI: http://localhost:${PORT}/api-docs`);
});
