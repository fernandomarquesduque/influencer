/**
 * Servidor local para exibir a lista de influenciadores e controlar a coleta (Iniciar/Parar).
 * Funciona em Mac e Windows.
 */

import './loadEnv.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import {
  getLedger,
  getGoogleQueue,
  getProblemasDbCount,
  getProblemasEventosSessao,
  removeFromGoogleQueue,
  clearGoogleQueue,
  removeProfile,
  removeIssueById,
} from './memoryStorage.js';
import { getProcessingState } from './processingStatus.js';
import * as runner from './runner.js';
import { loadConfig } from './config.js';
import type { InstagramClient } from './instagram.js';
import type { Page } from 'playwright';
import { freePortForUi } from './freeUiPort.js';
import { isRemoteIngestConfigured } from './serverIngest.js';

const PORT = Number(process.env.COLLECTOR_UI_PORT) || 3967;

/** Porta em que a UI está escutando (após startServer subir). */
export let uiListenPort = PORT;

function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
} as const;

/** Máximo de linhas de Problemas na API/UI — evita HTML/JSON enorme (lista completa continua no SQLite). */
const PROBLEMAS_API_LIMIT = 50;

function sendJson(res: ServerResponse, status: number, data: object): void {
  res.writeHead(status, JSON_HEADERS);
  res.end(JSON.stringify(data));
}

export function createCollectorRequestHandler(
  client: InstagramClient,
  pageRef: { page: Page },
  rebindPersistence: (newPage: Page) => void
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = req.url?.split('?')[0] ?? '/';

    if (url === '/api/health') {
      sendJson(res, 200, { ok: true, port: uiListenPort });
      return;
    }

    if (url === '/api/defaults') {
      const c = loadConfig();
      const n = (x: number, fb: number) => (Number.isFinite(x) ? Math.floor(x) : fb);
      sendJson(res, 200, {
        minFollowersToSave: n(c.minFollowersToSave, 5000),
        maxFollowersToSave: n(c.maxFollowersToSave, 1000000),
        minPostLikesToSave: n(c.minPostLikesToSave, 200),
        minPostsWithMinLikesToSave: n(c.minPostsWithMinLikesToSave, 4),
        maxPostsPerTag: n(c.maxPostsPerTag, 30),
        maxProfiles: n(c.maxProfiles, 19999),
        maxSerpPages: 20,
        excludeBusinessProfiles: !!c.excludeBusinessProfiles,
        requireBioBrazilianPortuguese: !!c.requireBioBrazilianPortuguese,
        skipIfAlreadyInRemoteDb: !!c.skipIfAlreadyInRemoteDb,
        allowedAccountTypes: Array.isArray(c.allowedAccountTypes) ? c.allowedAccountTypes : [],
        /** Sem isso, «Pular @ se já estiver no banco» não consulta a API (fica sem efeito). */
        remoteIngestConfigured: isRemoteIngestConfigured(),
      });
      return;
    }

    if (url === '/api/status') {
      sendJson(res, 200, {
        running: runner.isRunning(),
        scheduled: runner.isCollectionStartScheduled(),
        message: runner.getStatusMessage(),
        processing: getProcessingState(),
      });
      return;
    }

    if (url === '/api/stop' && req.method === 'POST') {
      runner.requestAbort();
      sendJson(res, 200, { stopped: true });
      return;
    }

    if (url === '/api/start' && req.method === 'POST') {
      if (runner.isRunning() || runner.isCollectionStartScheduled()) {
        sendJson(res, 200, { started: false, error: 'Coleta já em andamento ou iniciando.' });
        return;
      }
      try {
        const body = await parseBody(req);
        const mode = (body.mode as string) || 'hashtag';
        const tag = body.tag as string | undefined;
        let tags: string[] | undefined;
        if (Array.isArray(body.tags)) {
          tags = (body.tags as unknown[])
            .filter((x): x is string => typeof x === 'string')
            .map((t) => t.replace(/^#/, '').trim())
            .filter((t) => t.length > 0);
          if (tags.length === 0) tags = undefined;
        }
        let handles: string[] | undefined;
        if (Array.isArray(body.handles)) {
          handles = (body.handles as unknown[])
            .filter((x): x is string => typeof x === 'string')
            .map((h) => h.replace(/^@+/, '').trim().toLowerCase())
            .filter((h) => /^[a-z0-9._]{2,30}$/.test(h));
          if (handles.length === 0) handles = undefined;
        }
        const baseCfg = loadConfig();
        const num = (v: unknown, fallback: number) => {
          if (v === undefined || v === null || v === '') return fallback;
          const n = typeof v === 'number' ? v : parseInt(String(v), 10);
          return Number.isFinite(n) ? n : fallback;
        };
        const limit = num(body.limit, baseCfg.maxProfiles);
        const minFollowers = num(body.minFollowers, baseCfg.minFollowersToSave);
        const maxFollowers = num(body.maxFollowers, baseCfg.maxFollowersToSave);
        const minPostLikes = num(body.minPostLikes, baseCfg.minPostLikesToSave);
        const minPostsWithMinLikes = num(body.minPostsWithMinLikes, baseCfg.minPostsWithMinLikesToSave);
        const maxPostsPerTag = num(body.maxPostsPerTag, baseCfg.maxPostsPerTag);
        const excludeBusinessProfiles =
          typeof body.excludeBusinessProfiles === 'boolean'
            ? body.excludeBusinessProfiles
            : baseCfg.excludeBusinessProfiles;
        const requireBioBrazilianPortuguese =
          typeof body.requireBioBrazilianPortuguese === 'boolean'
            ? body.requireBioBrazilianPortuguese
            : baseCfg.requireBioBrazilianPortuguese;
        const skipIfAlreadyInRemoteDb =
          typeof body.skipIfAlreadyInRemoteDb === 'boolean'
            ? body.skipIfAlreadyInRemoteDb
            : baseCfg.skipIfAlreadyInRemoteDb;
        const allowedAccountTypes = Array.isArray(body.allowedAccountTypes)
          ? (body.allowedAccountTypes as unknown[])
              .map((x) => (typeof x === 'number' ? x : parseInt(String(x), 10)))
              .filter((n): n is number => n === 1 || n === 2 || n === 3)
          : baseCfg.allowedAccountTypes;
        const googleQuery =
          typeof body.googleQuery === 'string' ? String(body.googleQuery).trim() : undefined;
        const googleQdrRaw = typeof body.googleQdr === 'string' ? String(body.googleQdr).trim().toLowerCase() : undefined;
        const googleQdr =
          googleQdrRaw && ['h', 'd', 'w', 'm', 'y'].includes(googleQdrRaw) ? googleQdrRaw : undefined;
        const maxSerpPages = num(body.maxSerpPages, 20);
        const udmValuesRaw = Array.isArray(body.udmValues) ? body.udmValues : undefined;
        const udmValues =
          udmValuesRaw?.map((u) => (u === null || u === undefined ? '' : String(u).trim())).filter((u) => u !== undefined) ??
          ['39', '7', ''];
        const runOpts = {
          mode: mode as 'hashtag' | 'feed' | 'explore' | 'google' | 'handles',
          tag,
          tags,
          handles,
          googleQuery: googleQuery || undefined,
          googleQdr,
          maxSerpPages: Math.max(1, Math.min(50, maxSerpPages)),
          udmValues: udmValues.length > 0 ? udmValues : ['39', '7', ''],
          limit,
          minFollowers,
          maxFollowers,
          minPostLikes,
          minPostsWithMinLikes,
          maxPostsPerTag,
          excludeBusinessProfiles,
          requireBioBrazilianPortuguese,
          skipIfAlreadyInRemoteDb,
          allowedAccountTypes,
        };
        if (!runner.tryScheduleCollection()) {
          sendJson(res, 200, { started: false, error: 'Não foi possível iniciar (tente de novo).' });
          return;
        }
        try {
          sendJson(res, 200, { started: true, message: 'Coleta iniciada.' });
        } catch (sendErr) {
          runner.clearScheduledStart();
          throw sendErr;
        }
        setImmediate(() => {
          runner
            .runCollection(client, pageRef, rebindPersistence, runOpts)
            .then((r) => {
              console.log(`[coleta] ${r.saved} salvos, ${r.processed} processados.`);
            })
            .catch((e) => {
              console.error('[coleta] Erro:', e);
            });
        });
      } catch (e) {
        sendJson(res, 500, { started: false, error: e instanceof Error ? e.message : String(e) });
      }
      return;
    }

    if (url === '/api/remove' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        const handle = typeof body.handle === 'string' ? body.handle : '';
        const removed = removeProfile(handle);
        sendJson(res, removed ? 200 : 404, {
          ok: removed,
          removed,
          error: removed ? undefined : 'Perfil não encontrado na lista.',
        });
      } catch (e) {
        sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
      }
      return;
    }

    if (url === '/api/remove-google-queue' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        const handle = typeof body.handle === 'string' ? body.handle : '';
        const removed = removeFromGoogleQueue(handle);
        sendJson(res, removed ? 200 : 404, {
          ok: removed,
          removed,
          error: removed ? undefined : 'Handle não encontrado na fila Google.',
        });
      } catch (e) {
        sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
      }
      return;
    }

    if (url === '/api/clear-google-queue' && req.method === 'POST') {
      try {
        const count = clearGoogleQueue();
        sendJson(res, 200, { cleared: true, count });
      } catch (e) {
        sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
      }
      return;
    }

    if (url === '/api/remove-issue' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        const id = typeof body.id === 'string' ? body.id.trim() : '';
        if (!id) {
          sendJson(res, 400, { ok: false, removed: false, error: 'Informe o id do registro.' });
          return;
        }
        const removed = removeIssueById(id);
        sendJson(res, removed ? 200 : 404, {
          ok: removed,
          removed,
          error: removed ? undefined : 'Registro não encontrado.',
        });
      } catch (e) {
        sendJson(res, 500, { ok: false, removed: false, error: e instanceof Error ? e.message : String(e) });
      }
      return;
    }

    if (url === '/api/list' || url === '/list') {
      const L = getLedger();
      const googleQueue = getGoogleQueue();
      const row = (p: { handle: string; profile: Record<string, unknown>; collectedAt: string }) => ({
        handle: p.handle,
        handleKey: String(p.handle).replace(/^@/, '').trim().toLowerCase(),
        full_name: p.profile.full_name,
        followers_count: p.profile.followers_count,
        account_type: p.profile.account_type,
        collectedAt: p.collectedAt,
      });
      const hostFromEndpoint = (u: string): string => {
        try {
          return new URL(u).host;
        } catch {
          return '';
        }
      };
      const integrados = L.integrados.map((p) => ({
        ...row(p),
        integratedAt: p.integratedAt,
        apiHost: p.apiHost ?? '',
        rocksDbVerified: p.rocksDbVerified ?? '',
      }));
      const problemas = L.problemas.slice(0, PROBLEMAS_API_LIMIT).map((x) => ({
        id: x.id,
        handle: x.handle,
        handleKey: x.handleKey,
        kind: x.kind,
        kindLabel:
          x.kind === 'extracao'
            ? 'Extração'
            : x.kind === 'regra'
              ? 'Regra'
              : 'Erro API',
        detail: x.detail ?? '',
        at: x.at,
        full_name: x.full_name,
        followers_count: x.followers_count,
        attemptedEndpoint: x.attemptedEndpoint ?? '',
        attemptedHost: hostFromEndpoint(x.attemptedEndpoint ?? ''),
      }));
      const processing = getProcessingState();
      const googleQueriesState = runner.getGoogleQueriesState();
      res.writeHead(200, JSON_HEADERS);
      res.end(
        JSON.stringify(
          {
            counts: {
              coletados: L.coletados.length,
              problemas: getProblemasDbCount(),
              problemasUi: L.problemas.length,
              problemasEventosSessao: getProblemasEventosSessao(),
              integrados: L.integrados.length,
              googleQueue: googleQueue.length,
              emProcessamento: processing ? 1 : 0,
            },
            processing,
            googleQueriesState: googleQueriesState
              ? {
                queries: googleQueriesState.queries,
                currentIndex: googleQueriesState.currentIndex,
                phase: googleQueriesState.phase,
              }
              : null,
            coletados: L.coletados.map(row),
            problemas,
            integrados,
            googleQueue: googleQueue.map((x) => ({ handle: x.handle, addedAt: x.addedAt, snippet: x.snippet })),
            influencers: [...L.coletados.map(row), ...L.integrados.map(row)],
          },
          null,
          2
        )
      );
      return;
    }

    if (url === '/' || url === '/index.html') {
      const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Cache-Control" content="no-store">
  <title>Influencer Collector</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; max-width: 1100px; margin: 0 auto; padding: 1rem; background: #1a1a1a; color: #e0e0e0; }
    .table-scroll { overflow: auto; max-height: 420px; margin: 0.5rem 0 1.25rem; -webkit-overflow-scrolling: touch; }
    h1 { font-size: 1.4rem; margin-bottom: 0.5rem; }
    .sub { color: #888; font-size: 0.9rem; margin-bottom: 1.5rem; }
    .controls { display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; margin-bottom: 1.5rem; }
    button { padding: 0.6rem 1.2rem; border: none; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 0.95rem; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-start { background: #0a7c42; color: #fff; }
    .btn-stop { background: #c53030; color: #fff; }
    .btn-start:hover:not(:disabled) { background: #0d9c52; }
    .btn-stop:hover:not(:disabled) { background: #e53e3e; }
    .row-clickable { cursor: pointer; }
    .row-clickable:hover { background: rgba(255,255,255,0.04); }
    .btn-remove-queue, .btn-remove-issue { padding: 0.3rem 0.6rem; font-size: 0.8rem; background: transparent; color: #f87171; border: 1px solid #7f1d1d; border-radius: 4px; cursor: pointer; }
    .btn-remove-queue:hover, .btn-remove-issue:hover { background: #450a0a; color: #fca5a5; }
    .btn-clear-queue { margin-left: 0.5rem; padding: 0.35rem 0.75rem; font-size: 0.85rem; background: transparent; color: #f87171; border: 1px solid #7f1d1d; border-radius: 4px; cursor: pointer; }
    .btn-clear-queue:hover { background: #450a0a; color: #fca5a5; }
    #udmOptionsWrap { margin-top: 0.5rem; }
    #udmOptionsWrap label { margin-right: 1rem; font-weight: normal; }
    td.snippet-cell { max-width: 28rem; word-break: break-word; color: #94a3b8; font-size: 0.9rem; }
    tr.row-processing { background: linear-gradient(90deg, #1e3a2f 0%, #1a2e24 100%); outline: 1px solid #2d6a4f; }
    tr.row-processing td { color: #86efac !important; }
    tr.row-search-current { background: linear-gradient(90deg, #1e3a2f 0%, #1a2e24 100%); outline: 1px solid #2d6a4f; }
    tr.row-search-current td { color: #86efac !important; }
    tr.row-search-done td { color: #94a3b8; }
    tr.row-search-pending td { color: #64748b; }
    td.query-cell { font-size: 0.85rem; word-break: break-all; max-width: 32rem; }
    code.ep { font-size: 0.72rem; word-break: break-all; display: block; max-width: 24rem; color: #a7f3d0; background: #0f172a; padding: 0.35rem 0.5rem; border-radius: 4px; }
    td.verify-cell { font-size: 0.82rem; line-height: 1.4; max-width: 26rem; color: #cbd5e1; }
    .verify-ok { color: #4ade80; font-weight: 600; }
    .verify-warn { color: #fbbf24; }
    .verify-skip { color: #94a3b8; }
    .pulse-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #4ade80; margin-right: 8px; animation: pulse 1.2s ease-in-out infinite; vertical-align: middle; }
    @keyframes pulse { 0%,100%{opacity:1;transform:scale(1);} 50%{opacity:0.5;transform:scale(0.85);} }
    label { display: flex; align-items: center; gap: 0.5rem; }
    select, input { padding: 0.5rem; border-radius: 4px; border: 1px solid #444; background: #2d2d2d; color: #e0e0e0; }
    .count { font-size: 1.1rem; margin-bottom: 1rem; }
    .count strong { color: #4ade80; }
    .count .n-pend { color: #fbbf24; }
    .count .n-err { color: #f87171; }
    .count .n-ok { color: #4ade80; }
    .count .n-queue { color: #38bdf8; }
    h2.section { font-size: 1.05rem; margin: 1.25rem 0 0.5rem; color: #a3a3a3; border-bottom: 1px solid #333; padding-bottom: 0.35rem; }
    .kind-erro { color: #f87171; }
    .kind-regra { color: #fb923c; }
    .kind-ext { color: #38bdf8; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #333; padding: 0.6rem 0.8rem; text-align: left; }
    #rowsProblemas td:nth-child(4) { max-width: 420px; white-space: normal; word-break: break-word; line-height: 1.35; font-size: 0.88rem; }
    th { background: #2d2d2d; }
    tr:hover { background: #252525; }
    .status { padding: 0.5rem; border-radius: 4px; margin-bottom: 1rem; }
    .status.idle { background: #2d2d2d; color: #888; }
    .status.running { background: #1e3a2f; color: #4ade80; }
    fieldset { border: 1px solid #444; border-radius: 8px; padding: 1rem; margin-bottom: 1rem; }
    legend { padding: 0 0.5rem; color: #aaa; font-size: 0.95rem; }
    .rules-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 0.75rem; align-items: end; }
    .rules-grid label { flex-direction: column; align-items: flex-start; gap: 0.25rem; font-size: 0.85rem; color: #bbb; }
    .rules-grid input[type="number"] { width: 100%; max-width: 120px; }
    .hint { font-size: 0.75rem; color: #666; margin-top: 0.35rem; }
    #tagLabel { flex-direction: column; align-items: flex-start; width: 100%; max-width: 420px; }
    #googleLabel { flex: 1 0 100%; flex-direction: column; align-items: flex-start; width: 100%; }
    #handlesLabel { flex: 1 0 100%; flex-direction: column; align-items: flex-start; width: 100%; }
    #googleLabel #googleQuery { width: 100%; display: block; }
    #handlesLabel #handlesInput { width: 100%; display: block; }
    #qdrLabel { flex: 0 0 auto; }
    #tags { width: 100%; min-height: 88px; padding: 0.5rem; border-radius: 4px; border: 1px solid #444; background: #2d2d2d; color: #e0e0e0; font-family: inherit; resize: vertical; }
  </style>
</head>
<body>
  <h1>Influencer Collector</h1>
  <p class="sub">Browser já está no Instagram. No modo <strong>Google</strong>, a aba principal mostra a busca; perfis abrem em abas novas. Depois a aba volta ao Instagram.</p>
  <div id="status" class="status idle">Parado — clique em &quot;Iniciar coleta&quot; para começar.</div>
  <p id="apiHint" style="color:#f59e0b;font-size:0.85rem;margin:0 0 0.75rem;display:none;"></p>
  <fieldset>
    <legend>Regras da coleta (valores iniciais vêm do .env se existir)</legend>
    <div class="rules-grid">
      <label>Mín. seguidores <input type="number" id="minFollowers" min="0" step="100" value="5000"></label>
      <label>Máx. seguidores (0 = sem limite) <input type="number" id="maxFollowers" min="0" step="1000" value="1000000"></label>
      <label>Mín. curtidas por post <input type="number" id="minPostLikes" min="0" step="10" value="200"></label>
      <label>Qtd. posts com essa curtida <input type="number" id="minPostsWithMinLikes" min="1" max="50" step="1" value="4"></label>
      <label>Máx. posts na hashtag <input type="number" id="maxPostsPerTag" min="1" max="200" step="1" value="30"></label>
      <label>Limite de perfis nesta rodada <input type="number" id="limit" min="1" max="100000" step="1" value="10"></label>
    </div>
    <div class="account-types-block" style="margin-top:0.75rem;">
      <div style="font-size:0.9rem;margin-bottom:0.35rem;">Tipos de conta Instagram aceitos <span style="color:#888">(account_type — nenhum marcado = aceitar todos)</span>:</div>
      <label style="margin-right:1rem;"><input type="checkbox" id="acctType1" value="1"> Pessoal</label>
      <label style="margin-right:1rem;"><input type="checkbox" id="acctType2" value="2"> Criador</label>
      <label><input type="checkbox" id="acctType3" value="3"> Empresa</label>
    </div>
    <label style="margin-top:0.75rem;"><input type="checkbox" id="excludeBusiness" checked> Excluir perfis de empresa / estabelecimento</label>
    <label style="margin-top:0.5rem;"><input type="checkbox" id="requireBioPtBr" checked> Exigir bio em português brasileiro (rejeita outros idiomas e pt-PT sem sinais de BR)</label>
    <label style="margin-top:0.5rem;"><input type="checkbox" id="skipIfAlreadyInRemoteDb" checked> Pular @ se já estiver no banco (consulta à API antes de extrair — exige <code>COLLECTOR_API_BASE</code> + chave)</label>
    <p id="remoteIngestWarn" class="hint" style="display:none;color:#f59e0b;margin-top:0.35rem;border-left:3px solid #f59e0b;padding-left:0.65rem;"></p>
    <p class="hint">Filtro por tipo: se marcar ao menos um, o coletor rejeita na primeira leitura do perfil quando o <code>account_type</code> do Instagram não estiver na lista (aparece em Problemas). .env: <code>COLLECTOR_ALLOWED_ACCOUNT_TYPES=1,2,3</code> (vazio = todos). Bio com menos de ~22 caracteres úteis (sem links e @) é aceita como <strong>pt-BR</strong> sem checagem de idioma. Opcional no .env: <code>COLLECTOR_BIO_PT_BR_MIN_USEFUL_CHARS</code> (padrão 22; 0 = sempre checar idioma). Para desligar toda a regra de idioma: <code>COLLECTOR_REQUIRE_BIO_PT_BR=false</code>. Pular @ no banco: também <code>COLLECTOR_SKIP_IF_ALREADY_IN_DB=false</code>. Valores salvos no navegador (localStorage).</p>
  </fieldset>
  <div class="controls">
    <label>Modo: <select id="mode"><option value="hashtag">Hashtag</option><option value="feed">Feed</option><option value="explore">Explore</option><option value="google">Google (site:instagram.com…)</option><option value="handles">Arrobas (@perfil)</option></select></label>
    <label id="tagLabel">Tags (modo Hashtag — uma por linha ou separadas por vírgula):
    <textarea id="tags" rows="4" placeholder="moda&#10;beleza&#10;lifestylebr">microinfluencerbr</textarea></label>
    <label id="googleLabel" style="display:none;">Consulta(s) Google — uma por linha (ex.: <code>site:instagram.com mae mario</code>); após terminar uma, vai para a próxima:
    <textarea id="googleQuery" rows="3" placeholder="site:instagram.com mae mario&#10;site:instagram.com pai nintendo"></textarea></label>
    <label id="handlesLabel" style="display:none;">Lista de arrobas — uma por linha (com ou sem @):
    <textarea id="handlesInput" rows="4" placeholder="@perfil1&#10;perfil2&#10;@perfil_3"></textarea></label>
    <label id="qdrLabel" style="display:none;">Filtro de tempo (qdr):
      <select id="qdr">
        <option value="h">Última hora</option>
        <option value="d">Últimas 24 horas</option>
        <option value="w" selected>Última semana</option>
        <option value="m">Último mês</option>
        <option value="y">Último ano</option>
      </select>
    </label>
    <label id="serpPagesLabel" style="display:none;">Páginas SERP (Google) <input type="number" id="maxSerpPages" min="1" max="50" step="1" value="20"></label>
    <div id="udmOptionsWrap" style="display:none;">
      <span class="udm-options-label">Tipos de SERP (udm):</span>
      <label><input type="checkbox" id="udm39" checked> udm=39</label>
      <label><input type="checkbox" id="udm7" checked> udm=7 (vídeos/reels)</label>
      <label><input type="checkbox" id="udmNone" checked> Sem udm (geral)</label>
    </div>
    <button type="button" id="btnStart" class="btn-start">Iniciar coleta</button>
    <button type="button" id="btnStop" class="btn-stop" disabled>Parar coleta</button>
  </div>
  <div class="count">
    <strong id="countC" class="n-pend">0</strong> coletados (aguardando API ou sem API)
    · <strong id="countI" class="n-ok">0</strong> integrados
    · <strong id="countP" class="n-err">0</strong> erros<span id="countPEvents" style="color:#94a3b8;font-weight:500"></span>
    · <strong id="countG" class="n-queue">0</strong> na fila Google — atualiza a cada 5s
  </div>
  <p id="listProgressLine" style="display:none;margin:-0.35rem 0 1rem;font-size:0.95rem;color:#a5b4fc;"></p>
  <h2 class="section">Linhas da busca (progresso)</h2>
  <p class="hint" style="margin-top:0">Qual consulta está em execução e as próximas — atualiza durante a coleta no modo Google.</p>
  <div class="table-scroll" id="searchLinesWrap" style="margin-bottom:1.25rem">
  <table>
    <thead><tr><th>#</th><th>Linha da busca (consulta)</th><th>Status</th></tr></thead>
    <tbody id="rowsSearchLines"></tbody>
  </table>
  </div>
  <h2 class="section">Fila Google (aguardando processamento no Instagram)</h2>
  <p class="hint" style="margin-top:0">Handles descobertos na busca Google; o processamento no Instagram ocorre em seguida, <strong>1 perfil por vez</strong>. <button type="button" id="btnClearGoogleQueue" class="btn-clear-queue">Apagar tudo</button></p>
  <div class="table-scroll">
  <table>
    <thead><tr><th>#</th><th>Handle</th><th>Descrição Google (trecho / palavra-chave)</th><th>Adicionado em</th><th></th></tr></thead>
    <tbody id="rowsGoogleQueue"></tbody>
  </table>
  </div>
  <h2 class="section">1 — Coletados</h2>
  <p class="hint" style="margin-top:0">Inclui <strong>em processamento agora</strong> (linha destacada) e perfis já extraídos aguardando API; com API OK, o perfil vai para Integrados.</p>
  <div class="table-scroll">
  <table>
    <thead><tr><th>#</th><th>Handle</th><th>Status / nome</th><th>Seguidores</th><th>Desde</th></tr></thead>
    <tbody id="rowsColetados"></tbody>
  </table>
  </div>
  <h2 class="section">2 — Integrados com sucesso (API / RocksDB)</h2>
  <p class="hint" style="margin-top:0"><strong>Confirmação no RocksDB</strong> = resposta do GET <code>collector-verify-profile</code> feito logo após o ingest (se a API tiver essa rota).</p>
  <div class="table-scroll">
  <table>
    <thead><tr><th>#</th><th>Handle</th><th>Nome</th><th>Seguidores</th><th>Tipo perfil</th><th>Host (API)</th><th>Confirmação (consulta pós-ingest)</th><th>Integrado em</th></tr></thead>
    <tbody id="rowsIntegrados"></tbody>
  </table>
  </div>
  <h2 class="section">3 — Erro (após processamento)</h2>
  <p id="problemasTotalizer" class="problemas-totalizer" style="margin:0.25rem 0 0.65rem;padding:0.55rem 0.75rem;border-radius:6px;background:linear-gradient(90deg,#2c1518 0%,#1f1a24 100%);border:1px solid #7f1d1d;font-size:1rem;line-height:1.45;">
    <span style="color:#fecaca">Total de registros de erro no SQLite (abaixo: até ${PROBLEMAS_API_LIMIT} mais recentes):</span>
    <strong id="problemasTotalCount" style="color:#fca5a5;font-size:1.15rem;margin:0 0.25rem">0</strong>
  </p>
  <p class="hint" style="margin-top:0">Problemas ficam no <strong>SQLite</strong> (<code>data/collector-issues.sqlite</code> ou <code>COLLECTOR_ISSUES_DB_PATH</code>). Migração automática do JSON antigo na primeira subida. Opcional: append <code>collector-issues-append.jsonl</code> (<code>COLLECTOR_ISSUES_APPEND=off</code> desliga). <strong>Remover</strong> uma linha tira o @ da lista de bloqueio — na próxima coleta o perfil pode ser processado de novo.</p>
  <div class="table-scroll">
  <table>
    <thead><tr><th>#</th><th>Handle</th><th>Tipo</th><th>Detalhe</th><th>Host</th><th>POST tentado</th><th>Quando</th><th></th></tr></thead>
    <tbody id="rowsProblemas"></tbody>
  </table>
  </div>
  <script>
(function() {
  var API = window.location.origin;
  function apiUrl(path) { return API + path; }
  function showApiErr(msg) {
    var el = document.getElementById('apiHint');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
  }
  var remoteIngestOk = false;
  function updateRemoteSkipWarning() {
    var w = document.getElementById('remoteIngestWarn');
    var sk = document.getElementById('skipIfAlreadyInRemoteDb');
    if (!w || !sk) return;
    if (!remoteIngestOk && sk.checked) {
      w.style.display = 'block';
      w.textContent = 'API remota não configurada neste coletor — «Pular @ no banco» não consulta nada. No .env: COLLECTOR_API_BASE (ex.: https://seu-dominio.com/api) e COLLECTOR_INGEST_KEY igual ao COLLECTOR_INGEST_SECRET do servidor. Reinicie após editar.';
    } else {
      w.style.display = 'none';
      w.textContent = '';
    }
  }
  function initUi() {
    var modeEl = document.getElementById('mode');
    var tagLabel = document.getElementById('tagLabel');
    var googleLabel = document.getElementById('googleLabel');
    var handlesLabel = document.getElementById('handlesLabel');
    var qdrLabel = document.getElementById('qdrLabel');
    var btnStartEl = document.getElementById('btnStart');
    if (!modeEl || !tagLabel || !btnStartEl) {
      showApiErr('Erro interno: recarregue a página (Ctrl+F5).');
      return;
    }
    var startRequestInFlight = false;
    var FILTER_STORAGE_KEY = 'influencerCollector.uiFilters.v1';
    function collectAllowedAccountTypes() {
      var out = [];
      var t1 = document.getElementById('acctType1');
      var t2 = document.getElementById('acctType2');
      var t3 = document.getElementById('acctType3');
      if (t1 && t1.checked) out.push(1);
      if (t2 && t2.checked) out.push(2);
      if (t3 && t3.checked) out.push(3);
      return out;
    }
    function applyAccountTypeCheckboxes(arr) {
      var types = Array.isArray(arr) ? arr : [];
      var t1 = document.getElementById('acctType1');
      var t2 = document.getElementById('acctType2');
      var t3 = document.getElementById('acctType3');
      if (t1) t1.checked = types.indexOf(1) >= 0;
      if (t2) t2.checked = types.indexOf(2) >= 0;
      if (t3) t3.checked = types.indexOf(3) >= 0;
    }
    function saveUiFilters() {
      try {
        var tagsEl = document.getElementById('tags');
        localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify({
          minFollowers: document.getElementById('minFollowers') && document.getElementById('minFollowers').value,
          maxFollowers: document.getElementById('maxFollowers') && document.getElementById('maxFollowers').value,
          minPostLikes: document.getElementById('minPostLikes') && document.getElementById('minPostLikes').value,
          minPostsWithMinLikes: document.getElementById('minPostsWithMinLikes') && document.getElementById('minPostsWithMinLikes').value,
          maxPostsPerTag: document.getElementById('maxPostsPerTag') && document.getElementById('maxPostsPerTag').value,
          limit: document.getElementById('limit') && document.getElementById('limit').value,
          excludeBusiness: !!(document.getElementById('excludeBusiness') && document.getElementById('excludeBusiness').checked),
          requireBioPtBr: !!(document.getElementById('requireBioPtBr') && document.getElementById('requireBioPtBr').checked),
          skipIfAlreadyInRemoteDb: !!(document.getElementById('skipIfAlreadyInRemoteDb') && document.getElementById('skipIfAlreadyInRemoteDb').checked),
          mode: modeEl.value,
          tags: tagsEl ? String(tagsEl.value) : '',
          googleQuery: (document.getElementById('googleQuery') && document.getElementById('googleQuery').value) || '',
          handlesInput: (document.getElementById('handlesInput') && document.getElementById('handlesInput').value) || '',
          googleQdr: (document.getElementById('qdr') && document.getElementById('qdr').value) || 'w',
          maxSerpPages: document.getElementById('maxSerpPages') && document.getElementById('maxSerpPages').value,
          udm39: !!(document.getElementById('udm39') && document.getElementById('udm39').checked),
          udm7: !!(document.getElementById('udm7') && document.getElementById('udm7').checked),
          udmNone: !!(document.getElementById('udmNone') && document.getElementById('udmNone').checked),
          allowedAccountTypes: collectAllowedAccountTypes()
        }));
      } catch (e) { /* private mode / quota */ }
    }
    function loadUiFilters() {
      try {
        var raw = localStorage.getItem(FILTER_STORAGE_KEY);
        if (!raw) return null;
        var o = JSON.parse(raw);
        return o && typeof o === 'object' ? o : null;
      } catch (e) { return null; }
    }
    function applyUiFilters(s) {
      if (!s) return;
      function setNum(id, v) {
        if (v === undefined || v === null || v === '') return;
        var n = typeof v === 'number' ? v : parseInt(String(v), 10);
        if (!Number.isFinite(n)) return;
        var el = document.getElementById(id);
        if (el) el.value = String(n);
      }
      setNum('minFollowers', s.minFollowers);
      setNum('maxFollowers', s.maxFollowers);
      setNum('minPostLikes', s.minPostLikes);
      setNum('minPostsWithMinLikes', s.minPostsWithMinLikes);
      setNum('maxPostsPerTag', s.maxPostsPerTag);
      setNum('limit', s.limit);
      setNum('maxSerpPages', s.maxSerpPages);
      if (typeof s.excludeBusiness === 'boolean') {
        var ex = document.getElementById('excludeBusiness');
        if (ex) ex.checked = s.excludeBusiness;
      }
      if (typeof s.requireBioPtBr === 'boolean') {
        var rb = document.getElementById('requireBioPtBr');
        if (rb) rb.checked = s.requireBioPtBr;
      }
      if (typeof s.skipIfAlreadyInRemoteDb === 'boolean') {
        var sk = document.getElementById('skipIfAlreadyInRemoteDb');
        if (sk) sk.checked = s.skipIfAlreadyInRemoteDb;
      }
      if (s.mode === 'hashtag' || s.mode === 'feed' || s.mode === 'explore' || s.mode === 'google' || s.mode === 'handles') modeEl.value = s.mode;
      if (typeof s.tags === 'string') {
        var te = document.getElementById('tags');
        if (te) te.value = s.tags;
      }
      if (typeof s.googleQuery === 'string') {
        var gq = document.getElementById('googleQuery');
        if (gq) gq.value = s.googleQuery;
      }
      if (typeof s.handlesInput === 'string') {
        var hi = document.getElementById('handlesInput');
        if (hi) hi.value = s.handlesInput;
      }
      if (typeof s.googleQdr === 'string') {
        var qdrEl = document.getElementById('qdr');
        if (qdrEl) qdrEl.value = s.googleQdr;
      }
      tagLabel.style.display = modeEl.value === 'hashtag' ? '' : 'none';
      if (googleLabel) googleLabel.style.display = modeEl.value === 'google' ? '' : 'none';
      if (handlesLabel) handlesLabel.style.display = modeEl.value === 'handles' ? '' : 'none';
      var serpPagesLabel = document.getElementById('serpPagesLabel');
      if (serpPagesLabel) serpPagesLabel.style.display = modeEl.value === 'google' ? '' : 'none';
      if (qdrLabel) qdrLabel.style.display = modeEl.value === 'google' ? '' : 'none';
      var udmWrap = document.getElementById('udmOptionsWrap');
      if (udmWrap) udmWrap.style.display = modeEl.value === 'google' ? '' : 'none';
      if (typeof s.udm39 === 'boolean') { var u39 = document.getElementById('udm39'); if (u39) u39.checked = s.udm39; }
      if (typeof s.udm7 === 'boolean') { var u7 = document.getElementById('udm7'); if (u7) u7.checked = s.udm7; }
      if (typeof s.udmNone === 'boolean') { var uN = document.getElementById('udmNone'); if (uN) uN.checked = s.udmNone; }
      if (Array.isArray(s.allowedAccountTypes)) applyAccountTypeCheckboxes(s.allowedAccountTypes);
    }
    function bindFilterPersistence() {
      ['minFollowers', 'maxFollowers', 'minPostLikes', 'minPostsWithMinLikes', 'maxPostsPerTag', 'limit', 'maxSerpPages'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) {
          el.addEventListener('input', saveUiFilters);
          el.addEventListener('change', saveUiFilters);
        }
      });
      var ex = document.getElementById('excludeBusiness');
      if (ex) ex.addEventListener('change', saveUiFilters);
      var rb = document.getElementById('requireBioPtBr');
      if (rb) rb.addEventListener('change', saveUiFilters);
      var skDb = document.getElementById('skipIfAlreadyInRemoteDb');
      if (skDb) skDb.addEventListener('change', function() { saveUiFilters(); updateRemoteSkipWarning(); });
      var tagsEl = document.getElementById('tags');
      if (tagsEl) tagsEl.addEventListener('input', saveUiFilters);
      var gqEl = document.getElementById('googleQuery');
      if (gqEl) gqEl.addEventListener('input', saveUiFilters);
      var hiEl = document.getElementById('handlesInput');
      if (hiEl) hiEl.addEventListener('input', saveUiFilters);
      var qdrEl = document.getElementById('qdr');
      if (qdrEl) qdrEl.addEventListener('change', saveUiFilters);
      ['udm39', 'udm7', 'udmNone'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('change', saveUiFilters);
      });
      ['acctType1', 'acctType2', 'acctType3'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('change', saveUiFilters);
      });
    }
    bindFilterPersistence();
    var udmOptionsWrap = document.getElementById('udmOptionsWrap');
    if (udmOptionsWrap) udmOptionsWrap.style.display = modeEl.value === 'google' ? '' : 'none';
    function numFromInput(id, defVal) {
      var el = document.getElementById(id);
      var v = el ? parseInt(String(el.value).trim(), 10) : NaN;
      return Number.isFinite(v) ? v : defVal;
    }
    modeEl.addEventListener('change', function() {
      tagLabel.style.display = this.value === 'hashtag' ? '' : 'none';
      if (googleLabel) googleLabel.style.display = this.value === 'google' ? '' : 'none';
      if (handlesLabel) handlesLabel.style.display = this.value === 'handles' ? '' : 'none';
      var serpPagesLabel = document.getElementById('serpPagesLabel');
      if (serpPagesLabel) serpPagesLabel.style.display = this.value === 'google' ? '' : 'none';
      var qdrLabelCh = document.getElementById('qdrLabel');
      if (qdrLabelCh) qdrLabelCh.style.display = this.value === 'google' ? '' : 'none';
      var udmWrapCh = document.getElementById('udmOptionsWrap');
      if (udmWrapCh) udmWrapCh.style.display = this.value === 'google' ? '' : 'none';
      var searchLinesWrapCh = document.getElementById('searchLinesWrap');
      if (searchLinesWrapCh) searchLinesWrapCh.style.display = this.value === 'google' ? '' : 'none';
      saveUiFilters();
    });
    tagLabel.style.display = modeEl.value === 'hashtag' ? '' : 'none';
    if (googleLabel) googleLabel.style.display = modeEl.value === 'google' ? '' : 'none';
    if (handlesLabel) handlesLabel.style.display = modeEl.value === 'handles' ? '' : 'none';
    if (qdrLabel) qdrLabel.style.display = modeEl.value === 'google' ? '' : 'none';
    var serpPagesLabelInit = document.getElementById('serpPagesLabel');
    if (serpPagesLabelInit) serpPagesLabelInit.style.display = modeEl.value === 'google' ? '' : 'none';
    var udmWrapInit = document.getElementById('udmOptionsWrap');
    if (udmWrapInit) udmWrapInit.style.display = modeEl.value === 'google' ? '' : 'none';
    var searchLinesWrapInit = document.getElementById('searchLinesWrap');
    if (searchLinesWrapInit) searchLinesWrapInit.style.display = modeEl.value === 'google' ? '' : 'none';

    fetch(apiUrl('/api/defaults'), { cache: 'no-store' })
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(d) {
        function setNum(id, v, fb) {
          var n = typeof v === 'number' ? v : parseInt(String(v), 10);
          var el = document.getElementById(id);
          if (el) el.value = String(Number.isFinite(n) ? n : fb);
        }
        setNum('minFollowers', d.minFollowersToSave, 5000);
        setNum('maxFollowers', d.maxFollowersToSave, 1000000);
        setNum('minPostLikes', d.minPostLikesToSave, 200);
        setNum('minPostsWithMinLikes', d.minPostsWithMinLikesToSave, 4);
        setNum('maxPostsPerTag', d.maxPostsPerTag, 30);
        setNum('limit', d.maxProfiles, 19999);
        setNum('maxSerpPages', d.maxSerpPages, 20);
        var ex = document.getElementById('excludeBusiness');
        if (ex) ex.checked = d.excludeBusinessProfiles !== false;
        var rb = document.getElementById('requireBioPtBr');
        if (rb) rb.checked = d.requireBioBrazilianPortuguese !== false;
        var skDb = document.getElementById('skipIfAlreadyInRemoteDb');
        if (skDb) skDb.checked = d.skipIfAlreadyInRemoteDb !== false;
        remoteIngestOk = d.remoteIngestConfigured === true;
        applyAccountTypeCheckboxes(Array.isArray(d.allowedAccountTypes) ? d.allowedAccountTypes : []);
        var saved = loadUiFilters();
        if (saved) applyUiFilters(saved);
        updateRemoteSkipWarning();
      })
      .catch(function() {
        showApiErr('Não foi possível carregar regras do servidor — usando valores exibidos nos campos. Verifique se o app (npm start) está rodando.');
        var saved = loadUiFilters();
        if (saved) applyUiFilters(saved);
      });

    function escapeAttr(s) {
      return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
    }
    function listProgressHuman(p) {
      if (!p || p.listTotal == null || p.listIndex == null || !(p.listTotal > 0)) return '';
      var rem = p.listRemaining != null ? p.listRemaining : (p.listTotal - p.listIndex + 1);
      var label = p.listKind === 'handles' ? 'Lista de arrobas' : p.listKind === 'hashtag' ? 'Hashtags' : p.listKind === 'google_queries' ? 'Consultas Google' : 'Lista';
      return label + ': ' + p.listIndex + '/' + p.listTotal + ' — faltam ' + rem + ' até o fim';
    }
    function refreshList() {
      fetch(apiUrl('/api/list'), { cache: 'no-store' })
        .then(function(r) {
          if (!r.ok) throw new Error('list ' + r.status);
          return r.json();
        })
        .then(function(d) {
          var c = d.counts || {};
          document.getElementById('countC').textContent = c.coletados != null ? c.coletados : 0;
          var probDb = c.problemas != null ? c.problemas : 0;
          document.getElementById('countP').textContent = probDb;
          var ptot = document.getElementById('problemasTotalCount');
          if (ptot) ptot.textContent = probDb;
          var coletados = Array.isArray(d.coletados) ? d.coletados : [];
          var problemas = Array.isArray(d.problemas) ? d.problemas : [];
          var evHint = document.getElementById('countPEvents');
          if (evHint) {
            var evN = c.problemasEventosSessao != null ? c.problemasEventosSessao : 0;
            if (probDb > problemas.length) {
              evHint.textContent = ' · tabela: ' + problemas.length + ' mais recente(s); total SQLite: ' + probDb;
            } else if (evN > probDb) {
              evHint.textContent = ' · ' + evN + ' eventos nesta execução';
            } else {
              evHint.textContent = '';
            }
          }
          document.getElementById('countI').textContent = c.integrados != null ? c.integrados : 0;
          var countGEl = document.getElementById('countG');
          if (countGEl) countGEl.textContent = c.googleQueue != null ? c.googleQueue : 0;
          var integrados = Array.isArray(d.integrados) ? d.integrados : [];
          var googleQueue = Array.isArray(d.googleQueue) ? d.googleQueue : [];
          var procFull = d.processing;
          var proc = procFull && procFull.handle ? procFull : null;
          var lpLine = document.getElementById('listProgressLine');
          if (lpLine) {
            var lhRow = listProgressHuman(procFull);
            if (lhRow) { lpLine.style.display = 'block'; lpLine.textContent = lhRow; }
            else { lpLine.style.display = 'none'; lpLine.textContent = ''; }
          }
          var gqState = d.googleQueriesState && Array.isArray(d.googleQueriesState.queries) ? d.googleQueriesState : null;
          var searchLinesEl = document.getElementById('rowsSearchLines');
          var searchLinesWrap = document.getElementById('searchLinesWrap');
          if (searchLinesEl) {
            if (gqState) {
              var qs = gqState.queries;
              var cur = typeof gqState.currentIndex === 'number' ? gqState.currentIndex : -1;
              var phase = gqState.phase || 'discover';
              searchLinesEl.innerHTML = qs.map(function(q, i) {
                var status = '';
                var rowClass = '';
                if (i < cur) { status = 'Concluído'; rowClass = 'row-search-done'; }
                else if (i === cur) {
                  status = phase === 'process' ? 'Processando fila…' : 'Preenchendo fila…';
                  rowClass = 'row-search-current';
                } else { status = 'Aguardando'; rowClass = 'row-search-pending'; }
                var qShort = (q || '').length > 80 ? (q.slice(0, 77) + '…') : (q || '');
                return '<tr class="' + rowClass + '"><td>' + (i + 1) + '</td><td class="query-cell"><code>' + escapeAttr(qShort) + '</code></td><td>' + escapeAttr(status) + '</td></tr>';
              }).join('');
            } else {
              searchLinesEl.innerHTML = '<tr><td colspan="3" style="color:#888">Nenhuma execução em andamento. Inicie a coleta no modo Google para ver o progresso das linhas de busca.</td></tr>';
            }
          }
          if (searchLinesWrap) searchLinesWrap.style.display = modeEl && modeEl.value === 'google' ? '' : 'none';
          function rowProcessing(p) {
            var t = '';
            try { t = p.since ? new Date(p.since).toLocaleString('pt-BR') : ''; } catch (e) { t = String(p.since || ''); }
            var hk = String(p.handle || '').replace(/^@/,'').toLowerCase();
            var folCell = '—';
            if (p.followers_count != null && p.followers_count !== '' && Number(p.followers_count) > 0) {
              folCell = Number(p.followers_count).toLocaleString('pt-BR');
            }
            var typePart = '';
            if (p.account_type !== null && p.account_type !== undefined && p.account_type !== '') {
              var atn = Number(p.account_type);
              if (!isNaN(atn)) {
                var atl = atn === 1 ? 'Pessoal' : atn === 2 ? 'Criador' : atn === 3 ? 'Empresa' : '';
                typePart = 'account_type=' + atn + (atl ? ' (' + atl + ')' : '');
              }
            }
            var bits = [];
            if (p.full_name) bits.push(String(p.full_name));
            if (typePart) bits.push(typePart);
            if (p.category) {
              var c = String(p.category);
              if (c.length > 72) c = c.slice(0, 69) + '…';
              bits.push('categoria: ' + c);
            }
            var sub = bits.length
              ? '<br><span class="proc-profile-detail" style="display:block;margin-top:0.25rem;opacity:0.92;font-size:0.82em;font-weight:normal;line-height:1.35">' + escapeAttr(bits.join(' · ')) + '</span>'
              : '';
            var listHint = listProgressHuman(p);
            var listHtml = listHint
              ? '<br><span class="list-qty-hint" style="display:block;margin-top:0.35rem;font-size:0.88em;font-weight:600;color:#a5b4fc">' + escapeAttr(listHint) + '</span>'
              : '';
            var apiLine = '';
            if (p.remotePrecheck === 'not_in_db') {
              apiLine = '<br><span class="verify-ok proc-api-precheck" style="display:block;margin-top:0.35rem;font-size:0.86em;font-weight:600;line-height:1.4">API crawl: perfil <strong>não</strong> encontrado no banco remoto (<code>collector-verify-profile</code>).</span>';
            } else if (p.remotePrecheck === 'unknown') {
              apiLine = '<br><span class="verify-warn proc-api-precheck" style="display:block;margin-top:0.35rem;font-size:0.86em;font-weight:600;line-height:1.4">API crawl: não foi possível verificar no servidor (rede, timeout ou rota indisponível).</span>';
            } else if (p.remotePrecheck === 'off') {
              apiLine = '<br><span class="verify-skip proc-api-precheck" style="display:block;margin-top:0.35rem;font-size:0.86em;line-height:1.4">API crawl: pré-check não usado (sem <code>COLLECTOR_API_BASE</code>/chave ou «Pular @…» desmarcado).</span>';
            }
            return '<tr class="row-processing row-clickable" data-handle="' + escapeAttr(hk) + '"><td>…</td><td>@' + escapeAttr(p.handle) + '</td><td><span class="pulse-dot"></span><strong>Em processamento</strong> — ' + escapeAttr(p.stage || '') + listHtml + apiLine + sub + '</td><td>' + folCell + '</td><td>' + escapeAttr(t) + '</td></tr>';
          }
          function rowColetado(x, i) {
            var hk = x.handleKey || String(x.handle).replace(/^@/,'').toLowerCase();
            return '<tr class="row-clickable" data-handle="' + escapeAttr(hk) + '"><td>' + (i + 1) + '</td><td>@' + escapeAttr(x.handle) + '</td><td>' + escapeAttr(x.full_name || '') + '</td><td>' + (x.followers_count != null ? Number(x.followers_count).toLocaleString('pt-BR') : '') + '</td><td>' + escapeAttr(x.collectedAt || '') + '</td></tr>';
          }
          function rowProb(x, i) {
            var cls = x.kind === 'erro_api' ? 'kind-erro' : (x.kind === 'regra' ? 'kind-regra' : 'kind-ext');
            var hostP = x.attemptedHost ? '<strong>' + escapeAttr(x.attemptedHost) + '</strong>' : '—';
            var urlP = x.attemptedEndpoint ? '<code class="ep">' + escapeAttr(x.attemptedEndpoint) + '</code>' : '—';
            var hk = x.handleKey || String(x.handle || '').replace(/^@/,'').toLowerCase();
            var iid = x.id ? escapeAttr(String(x.id)) : '';
            var rm = iid ? '<button type="button" class="btn-remove-issue" data-issue-id="' + iid + '">Remover</button>' : '—';
            return '<tr class="row-clickable" data-handle="' + escapeAttr(hk) + '"><td>' + (i + 1) + '</td><td>@' + escapeAttr(x.handle) + '</td><td class="' + cls + '">' + escapeAttr(x.kindLabel || x.kind) + '</td><td>' + escapeAttr(x.detail || '') + '</td><td>' + hostP + '</td><td>' + urlP + '</td><td>' + escapeAttr(x.at || '') + '</td><td>' + rm + '</td></tr>';
          }
          function rowInt(x, i) {
            var hk = x.handleKey || String(x.handle).replace(/^@/,'').toLowerCase();
            var typeCell = '—';
            if (x.account_type != null && x.account_type !== '') {
              var atn = Number(x.account_type);
              if (!isNaN(atn)) {
                var atl = atn === 1 ? 'Pessoal' : atn === 2 ? 'Criador' : atn === 3 ? 'Empresa' : '';
                typeCell = String(atn) + (atl ? ' (' + atl + ')' : '');
              }
            }
            var host = x.apiHost ? '<strong>' + escapeAttr(x.apiHost) + '</strong>' : '<span style="color:#888">—</span>';
            var v = x.rocksDbVerified;
            var conf = '<span style="color:#888">—</span> <small>(registro antigo)</small>';
            if (v === 'confirmed') {
              conf = '<span class="verify-ok">Sim</span> — GET <code>collector-verify-profile</code> encontrou o perfil no RocksDB após o ingest.';
            } else if (v === 'unavailable') {
              conf = '<span class="verify-warn">Não confirmado</span> — ingest OK, mas a consulta de verificação não respondeu (rota antiga, rede ou outro worker IIS).';
            } else if (v === 'skipped') {
              conf = '<span class="verify-skip">Não executada</span> — <code>COLLECTOR_SKIP_VERIFY</code> ou fluxo sem verificação.';
            }
            return '<tr class="row-clickable" data-handle="' + escapeAttr(hk) + '"><td>' + (i + 1) + '</td><td>@' + escapeAttr(x.handle) + '</td><td>' + escapeAttr(x.full_name || '') + '</td><td>' + (x.followers_count != null ? Number(x.followers_count).toLocaleString('pt-BR') : '') + '</td><td>' + escapeAttr(typeCell) + '</td><td>' + host + '</td><td class="verify-cell">' + conf + '</td><td>' + escapeAttr(x.integratedAt || '') + '</td></tr>';
          }
          function rowGoogleQueue(x, i) {
            var h = (x.handle || '').toLowerCase();
            var added = '';
            try { added = x.addedAt ? new Date(x.addedAt).toLocaleString('pt-BR') : ''; } catch (e) { added = escapeAttr(x.addedAt || ''); }
            var snip = (x.snippet || '').trim();
            if (snip.length > 180) snip = snip.slice(0, 177) + '…';
            return '<tr class="row-clickable" data-handle="' + escapeAttr(h) + '"><td>' + (i + 1) + '</td><td>@' + escapeAttr(x.handle) + '</td><td class="snippet-cell">' + escapeAttr(snip) + '</td><td>' + escapeAttr(added) + '</td><td><button type="button" class="btn-remove-queue" data-handle="' + escapeAttr(h) + '">Excluir</button></td></tr>';
          }
          var rowsC = [];
          if (proc) rowsC.push(rowProcessing(procFull));
          coletados.forEach(function(x, i) { rowsC.push(rowColetado(x, i)); });
          document.getElementById('rowsColetados').innerHTML = rowsC.length ? rowsC.join('') : '<tr><td colspan="5" style="color:#666">Nenhum nesta lista (nem em processamento).</td></tr>';
          var gqEl = document.getElementById('rowsGoogleQueue');
          if (gqEl) gqEl.innerHTML = googleQueue.length ? googleQueue.map(rowGoogleQueue).join('') : '<tr><td colspan="5" style="color:#666">Nenhum. Use o modo Google para preencher a fila.</td></tr>';
          document.getElementById('rowsProblemas').innerHTML = problemas.length ? problemas.map(rowProb).join('') : '<tr><td colspan="8" style="color:#666">Nenhum.</td></tr>';
          document.getElementById('rowsIntegrados').innerHTML = integrados.length ? integrados.map(rowInt).join('') : '<tr><td colspan="8" style="color:#666">Nenhum ainda.</td></tr>';
        })
        .catch(function() {
          document.getElementById('countC').textContent = '?';
          document.getElementById('countP').textContent = '?';
          var ptotE = document.getElementById('problemasTotalCount');
          if (ptotE) ptotE.textContent = '?';
          var evH = document.getElementById('countPEvents');
          if (evH) evH.textContent = '';
          document.getElementById('countI').textContent = '?';
          var countGEl = document.getElementById('countG');
          if (countGEl) countGEl.textContent = '?';
          showApiErr('Lista não atualizou — confira se o collector está ativo nesta mesma porta (' + window.location.port + ').');
        });
    }
    function onRowClick(e) {
      var tr = e.target.closest('tr');
      if (!tr) return;
      var handle = tr.getAttribute('data-handle');
      if (!handle) return;
      window.open('https://www.instagram.com/' + handle + '/', '_blank');
    }
    function onGoogleQueueClick(e) {
      var btn = e.target.closest('.btn-remove-queue');
      if (btn) {
        e.preventDefault();
        e.stopPropagation();
        var h = btn.getAttribute('data-handle');
        if (!h) return;
        fetch(apiUrl('/api/remove-google-queue'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ handle: h }) })
          .then(function(r) { return r.json(); })
          .then(function(d) {
            if (d.removed) refreshList();
            else if (d.error) alert(d.error);
          })
          .catch(function() { alert('Não foi possível excluir da fila.'); });
        return;
      }
      onRowClick(e);
    }
    function onProblemasTableClick(e) {
      var btn = e.target.closest('.btn-remove-issue');
      if (btn) {
        e.preventDefault();
        e.stopPropagation();
        var id = btn.getAttribute('data-issue-id');
        if (!id) return;
        fetch(apiUrl('/api/remove-issue'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id }) })
          .then(function(r) { return r.json(); })
          .then(function(d) {
            if (d.removed) refreshList();
            else if (d.error) alert(d.error);
          })
          .catch(function() { alert('Não foi possível remover o registro.'); });
        return;
      }
      onRowClick(e);
    }
    document.getElementById('rowsColetados').addEventListener('click', onRowClick);
    document.getElementById('rowsGoogleQueue').addEventListener('click', onGoogleQueueClick);
    document.getElementById('rowsProblemas').addEventListener('click', onProblemasTableClick);
    document.getElementById('rowsIntegrados').addEventListener('click', onRowClick);
    var btnClearGq = document.getElementById('btnClearGoogleQueue');
    if (btnClearGq) {
      btnClearGq.addEventListener('click', function() {
        if (!confirm('Apagar todos os itens da Fila Google?')) return;
        fetch(apiUrl('/api/clear-google-queue'), { method: 'POST', headers: { 'Content-Type': 'application/json' } })
          .then(function(r) { return r.json(); })
          .then(function(d) {
            if (d.cleared) { refreshList(); }
            else if (d.error) alert(d.error);
          })
          .catch(function() { alert('Não foi possível limpar a fila.'); });
      });
    }
    refreshList();
    setInterval(refreshList, 2000);

    btnStartEl.addEventListener('click', function(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (startRequestInFlight) return;
      var st = document.getElementById('status');
      var btnS = btnStartEl;
      var btnP = document.getElementById('btnStop');
      try {
        startRequestInFlight = true;
        st.className = 'status running';
        st.textContent = 'Enviando pedido ao servidor…';
        btnS.disabled = true;
        var mode = document.getElementById('mode').value;
        var tags = (document.getElementById('tags').value || '')
          .split(/[\\n,;]+/)
          .map(function(t) { return t.replace(/^#/, '').trim(); })
          .filter(function(t) { return t.length > 0; });
        var gq = (document.getElementById('googleQuery') && document.getElementById('googleQuery').value || '').trim();
        var handles = (document.getElementById('handlesInput') && document.getElementById('handlesInput').value || '')
          .split(/[\\n,;]+/)
          .map(function(h) { return h.replace(/^@+/, '').trim().toLowerCase(); })
          .filter(function(h) { return /^[a-z0-9._]{2,30}$/.test(h); });
        if (mode === 'google' && !gq) {
          startRequestInFlight = false;
          btnS.disabled = false;
          st.className = 'status idle';
          st.textContent = 'Preencha a consulta Google (site:instagram.com…).';
          return;
        }
        if (mode === 'handles' && handles.length === 0) {
          startRequestInFlight = false;
          btnS.disabled = false;
          st.className = 'status idle';
          st.textContent = 'Preencha ao menos uma arroba válida (@perfil) para o modo Arrobas.';
          return;
        }
        var udmValues = [];
        if (mode === 'google') {
          if (document.getElementById('udm39') && document.getElementById('udm39').checked) udmValues.push('39');
          if (document.getElementById('udm7') && document.getElementById('udm7').checked) udmValues.push('7');
          if (document.getElementById('udmNone') && document.getElementById('udmNone').checked) udmValues.push('');
        }
        var payload = {
          mode: mode,
          tags: tags.length ? tags : undefined,
          handles: mode === 'handles' ? handles : undefined,
          googleQuery: mode === 'google' ? gq : undefined,
          googleQdr: mode === 'google' ? ((document.getElementById('qdr') && document.getElementById('qdr').value) || undefined) : undefined,
          maxSerpPages: numFromInput('maxSerpPages', 20),
          udmValues: mode === 'google' && udmValues.length > 0 ? udmValues : undefined,
          limit: numFromInput('limit', 19999),
          minFollowers: numFromInput('minFollowers', 5000),
          maxFollowers: numFromInput('maxFollowers', 1000000),
          minPostLikes: numFromInput('minPostLikes', 200),
          minPostsWithMinLikes: numFromInput('minPostsWithMinLikes', 4),
          maxPostsPerTag: numFromInput('maxPostsPerTag', 30),
          excludeBusinessProfiles: !!(document.getElementById('excludeBusiness') && document.getElementById('excludeBusiness').checked),
          requireBioBrazilianPortuguese: !!(document.getElementById('requireBioPtBr') && document.getElementById('requireBioPtBr').checked),
          skipIfAlreadyInRemoteDb: !!(document.getElementById('skipIfAlreadyInRemoteDb') && document.getElementById('skipIfAlreadyInRemoteDb').checked),
          allowedAccountTypes: collectAllowedAccountTypes()
        };
        var ctrl = new AbortController();
        var to = setTimeout(function() { ctrl.abort(); }, 120000);
        fetch(apiUrl('/api/start'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify(payload),
          signal: ctrl.signal
        }).then(function(r) {
          return r.text().then(function(text) {
            try { return { ok: r.ok, data: JSON.parse(text || '{}') }; }
            catch (e2) { throw new Error(r.ok ? 'Resposta inválida' : ('HTTP ' + r.status + ' ' + text.slice(0, 80))); }
          });
        }).then(function(x) {
          var d = x.data;
          if (d.started) {
            st.className = 'status running';
            st.textContent = 'Coletando… ' + (d.message || '');
            btnS.disabled = true;
            btnP.disabled = false;
          } else {
            st.className = 'status idle';
            st.textContent = 'Erro: ' + (d.error || d.message || 'não foi possível iniciar');
            btnS.disabled = false;
            btnP.disabled = true;
          }
        }).catch(function(e) {
          st.className = 'status idle';
          var msg = (e && e.name === 'AbortError') ? 'Tempo esgotado — o servidor não respondeu.' : (e && e.message ? e.message : String(e));
          st.textContent = 'Erro: ' + msg;
          btnS.disabled = false;
          btnP.disabled = true;
          showApiErr('Use a URL exata que o terminal mostrou ao rodar npm start (ex.: http://127.0.0.1:3967). O collector precisa estar rodando na mesma máquina.');
        }).finally(function() {
          clearTimeout(to);
          startRequestInFlight = false;
        });
      } catch (err) {
        startRequestInFlight = false;
        st.className = 'status idle';
        st.textContent = 'Erro no navegador: ' + (err && err.message ? err.message : String(err));
        btnS.disabled = false;
      }
    });

    document.getElementById('btnStop').onclick = function() {
      fetch(apiUrl('/api/stop'), { method: 'POST' }).then(() => {
        document.getElementById('status').className = 'status idle';
        document.getElementById('status').textContent = 'Parado pelo usuário.';
        document.getElementById('btnStart').disabled = false;
        document.getElementById('btnStop').disabled = true;
      }).catch(() => {});
    };

    setInterval(function() {
      if (startRequestInFlight) return;
      fetch(apiUrl('/api/status'), { cache: 'no-store' })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          var active = d.running || d.scheduled;
          var stEl = document.getElementById('status');
          var msg = d.message || '';
          var procRaw = d.processing;
          var procSt = procRaw && procRaw.handle ? procRaw : null;
          var listHintSt = listProgressHuman(procRaw);
          if (active) {
            stEl.className = 'status running';
            if (procSt && procSt.handle) {
              stEl.textContent = 'Coletando… @' + procSt.handle + ' — ' + (procSt.stage || 'em andamento') + (listHintSt ? ' · ' + listHintSt : '');
            } else if (listHintSt) {
              stEl.textContent = 'Coletando… ' + listHintSt + (msg ? ' · ' + msg : '');
            } else {
              stEl.textContent = d.scheduled && !d.running ? 'Iniciando coleta…' : ('Coletando… ' + msg);
            }
            btnStartEl.disabled = true;
            document.getElementById('btnStop').disabled = false;
          } else {
            btnStartEl.disabled = false;
            document.getElementById('btnStop').disabled = true;
            if (msg.indexOf('Erro:') === 0) {
              stEl.className = 'status idle';
              stEl.textContent = msg;
            } else if (msg.indexOf('Concluído:') === 0) {
              stEl.className = 'status idle';
              stEl.textContent = msg;
            }
          }
        })
        .catch(function() {});
    }, 2000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initUi);
  else initUi();
})();
  </script>
</body>
</html>`;
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      });
      res.end(html);
      return;
    }

    res.writeHead(404);
    res.end();
  };
}

export function startServer(
  client: InstagramClient,
  pageRef: { page: Page },
  rebindPersistence: (newPage: Page) => void
): void {
  const handler = createCollectorRequestHandler(client, pageRef, rebindPersistence);

  const attemptListen = (retriedAfterKill: boolean): void => {
    const server = createServer(handler);
    const onError = (err: NodeJS.ErrnoException): void => {
      server.removeListener('error', onError);
      try {
        server.close();
      } catch {
        /* */
      }
      if (err.code === 'EADDRINUSE' && !retriedAfterKill) {
        console.warn(
          `[Collector] Porta ${PORT} ainda em uso — encerrando processo(s) na porta e tentando de novo...`
        );
        freePortForUi(PORT);
        setTimeout(() => attemptListen(true), 600);
        return;
      }
      console.error(
        '\n[Collector] Não foi possível abrir a interface HTTP.',
        err.code === 'EADDRINUSE'
          ? `\n  A porta ${PORT} continua ocupada (outro app ou sem permissão para encerrar o processo).\n  Feche manualmente ou altere COLLECTOR_UI_PORT no .env\n`
          : err.message
      );
      process.exit(1);
    };
    server.on('error', onError);
    server.listen(PORT, '0.0.0.0', () => {
      server.removeListener('error', onError);
      uiListenPort = PORT;
      console.log('\n' + '='.repeat(56));
      console.log('[Collector] Abra no navegador:');
      console.log(`   http://127.0.0.1:${PORT}/`);
      console.log(`   http://localhost:${PORT}/`);
      console.log('='.repeat(56) + '\n');
    });
  };

  console.log(`[Collector] Garantindo porta ${PORT} da interface (encerrando listener anterior, se houver)...`);
  freePortForUi(PORT);
  setTimeout(() => attemptListen(false), 400);
}
