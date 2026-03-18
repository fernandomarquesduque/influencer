/**
 * Servidor local para exibir a lista de influenciadores e controlar a coleta (Iniciar/Parar).
 * Funciona em Mac e Windows.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { getProfiles, removeProfile } from './memoryStorage.js';
import * as runner from './runner.js';
import { loadConfig } from './config.js';
import type { InstagramClient } from './instagram.js';
import type { Page } from 'playwright';

const PORT = Number(process.env.COLLECTOR_UI_PORT) || 3967;
const PORT_TRY_MAX = 15;

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

function sendJson(res: ServerResponse, status: number, data: object): void {
  res.writeHead(status, JSON_HEADERS);
  res.end(JSON.stringify(data));
}

export function createCollectorRequestHandler(
  client: InstagramClient,
  page: Page
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
        minPostLikesToSave: n(c.minPostLikesToSave, 200),
        minPostsWithMinLikesToSave: n(c.minPostsWithMinLikesToSave, 4),
        maxPostsPerTag: n(c.maxPostsPerTag, 30),
        maxProfiles: n(c.maxProfiles, 20),
        excludeBusinessProfiles: !!c.excludeBusinessProfiles,
      });
      return;
    }

    if (url === '/api/status') {
      sendJson(res, 200, {
        running: runner.isRunning(),
        scheduled: runner.isCollectionStartScheduled(),
        message: runner.getStatusMessage(),
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
        const baseCfg = loadConfig();
        const num = (v: unknown, fallback: number) => {
          if (v === undefined || v === null || v === '') return fallback;
          const n = typeof v === 'number' ? v : parseInt(String(v), 10);
          return Number.isFinite(n) ? n : fallback;
        };
        const limit = num(body.limit, baseCfg.maxProfiles);
        const minFollowers = num(body.minFollowers, baseCfg.minFollowersToSave);
        const minPostLikes = num(body.minPostLikes, baseCfg.minPostLikesToSave);
        const minPostsWithMinLikes = num(body.minPostsWithMinLikes, baseCfg.minPostsWithMinLikesToSave);
        const maxPostsPerTag = num(body.maxPostsPerTag, baseCfg.maxPostsPerTag);
        const excludeBusinessProfiles =
          typeof body.excludeBusinessProfiles === 'boolean'
            ? body.excludeBusinessProfiles
            : baseCfg.excludeBusinessProfiles;
        const runOpts = {
          mode: mode as 'hashtag' | 'feed' | 'explore',
          tag,
          tags,
          limit,
          minFollowers,
          minPostLikes,
          minPostsWithMinLikes,
          maxPostsPerTag,
          excludeBusinessProfiles,
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
            .runCollection(client, page, runOpts)
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

    if (url === '/api/list' || url === '/list') {
      const profiles = getProfiles();
      const list = profiles.map((p) => {
        const raw = p.profile as Record<string, unknown>;
        return {
          handle: p.handle,
          handleKey: p.handle.replace(/^@/, '').trim().toLowerCase(),
          full_name: raw.full_name,
          followers_count: raw.followers_count,
          collectedAt: p.collectedAt,
        };
      });
      res.writeHead(200, JSON_HEADERS);
      res.end(JSON.stringify({ count: list.length, influencers: list }, null, 2));
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
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 0 auto; padding: 1rem; background: #1a1a1a; color: #e0e0e0; }
    h1 { font-size: 1.4rem; margin-bottom: 0.5rem; }
    .sub { color: #888; font-size: 0.9rem; margin-bottom: 1.5rem; }
    .controls { display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; margin-bottom: 1.5rem; }
    button { padding: 0.6rem 1.2rem; border: none; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 0.95rem; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-start { background: #0a7c42; color: #fff; }
    .btn-stop { background: #c53030; color: #fff; }
    .btn-start:hover:not(:disabled) { background: #0d9c52; }
    .btn-stop:hover:not(:disabled) { background: #e53e3e; }
    .btn-remove { padding: 0.35rem 0.65rem; font-size: 0.8rem; background: transparent; color: #f87171; border: 1px solid #7f1d1d; border-radius: 4px; cursor: pointer; }
    .btn-remove:hover { background: #450a0a; color: #fca5a5; }
    label { display: flex; align-items: center; gap: 0.5rem; }
    select, input { padding: 0.5rem; border-radius: 4px; border: 1px solid #444; background: #2d2d2d; color: #e0e0e0; }
    .count { font-size: 1.1rem; margin-bottom: 1rem; }
    .count strong { color: #4ade80; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #333; padding: 0.6rem 0.8rem; text-align: left; }
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
    #tags { width: 100%; min-height: 88px; padding: 0.5rem; border-radius: 4px; border: 1px solid #444; background: #2d2d2d; color: #e0e0e0; font-family: inherit; resize: vertical; }
  </style>
</head>
<body>
  <h1>Influencer Collector</h1>
  <p class="sub">Browser já está no Instagram. Ajuste as regras abaixo e inicie a coleta quando quiser.</p>
  <div id="status" class="status idle">Parado — clique em &quot;Iniciar coleta&quot; para começar.</div>
  <p id="apiHint" style="color:#f59e0b;font-size:0.85rem;margin:0 0 0.75rem;display:none;"></p>
  <fieldset>
    <legend>Regras da coleta (valores iniciais vêm do .env se existir)</legend>
    <div class="rules-grid">
      <label>Mín. seguidores <input type="number" id="minFollowers" min="0" step="100" value="5000"></label>
      <label>Mín. curtidas por post <input type="number" id="minPostLikes" min="0" step="10" value="200"></label>
      <label>Qtd. posts com essa curtida <input type="number" id="minPostsWithMinLikes" min="1" max="50" step="1" value="4"></label>
      <label>Máx. posts na hashtag <input type="number" id="maxPostsPerTag" min="1" max="200" step="1" value="30"></label>
      <label>Limite de perfis nesta rodada <input type="number" id="limit" min="1" max="200" step="1" value="20"></label>
    </div>
    <label style="margin-top:0.75rem;"><input type="checkbox" id="excludeBusiness" checked> Excluir perfis de empresa / estabelecimento</label>
    <p class="hint">Esses valores são usados só nesta execução; altere e clique em Iniciar coleta.</p>
  </fieldset>
  <div class="controls">
    <label>Modo: <select id="mode"><option value="hashtag">Hashtag</option><option value="feed">Feed</option><option value="explore">Explore</option></select></label>
    <label id="tagLabel">Tags (modo Hashtag — uma por linha ou separadas por vírgula):
    <textarea id="tags" rows="4" placeholder="moda&#10;beleza&#10;lifestylebr">microinfluencerbr</textarea></label>
    <button type="button" id="btnStart" class="btn-start">Iniciar coleta</button>
    <button type="button" id="btnStop" class="btn-stop" disabled>Parar coleta</button>
  </div>
  <div class="count">Total: <strong id="count">0</strong> influenciadores (atualiza a cada 5s)</div>
  <table>
    <thead><tr><th>#</th><th>Handle</th><th>Nome</th><th>Seguidores</th><th>Coletado em</th><th></th></tr></thead>
    <tbody id="rows"></tbody>
  </table>
  <script>
(function() {
  var API = window.location.origin;
  function apiUrl(path) { return API + path; }
  function showApiErr(msg) {
    var el = document.getElementById('apiHint');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
  }
  function initUi() {
    var modeEl = document.getElementById('mode');
    var tagLabel = document.getElementById('tagLabel');
    var btnStartEl = document.getElementById('btnStart');
    if (!modeEl || !tagLabel || !btnStartEl) {
      showApiErr('Erro interno: recarregue a página (Ctrl+F5).');
      return;
    }
    var startRequestInFlight = false;
    function numFromInput(id, defVal) {
      var el = document.getElementById(id);
      var v = el ? parseInt(String(el.value).trim(), 10) : NaN;
      return Number.isFinite(v) ? v : defVal;
    }
    modeEl.addEventListener('change', function() {
      tagLabel.style.display = this.value === 'hashtag' ? '' : 'none';
    });
    tagLabel.style.display = modeEl.value === 'hashtag' ? '' : 'none';

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
        setNum('minPostLikes', d.minPostLikesToSave, 200);
        setNum('minPostsWithMinLikes', d.minPostsWithMinLikesToSave, 4);
        setNum('maxPostsPerTag', d.maxPostsPerTag, 30);
        setNum('limit', d.maxProfiles, 20);
        var ex = document.getElementById('excludeBusiness');
        if (ex) ex.checked = d.excludeBusinessProfiles !== false;
      })
      .catch(function() {
        showApiErr('Não foi possível carregar regras do servidor — usando valores exibidos nos campos. Verifique se o app (npm start) está rodando.');
      });

    function escapeAttr(s) {
      return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
    }
    function refreshList() {
      fetch(apiUrl('/api/list'), { cache: 'no-store' })
        .then(function(r) {
          if (!r.ok) throw new Error('list ' + r.status);
          return r.json();
        })
        .then(function(d) {
          var rows = Array.isArray(d.influencers) ? d.influencers : [];
          var n = typeof d.count === 'number' ? d.count : rows.length;
          document.getElementById('count').textContent = n;
          var t = document.getElementById('rows');
          t.innerHTML = rows.map(function(x, i) {
            var hk = x.handleKey || String(x.handle).replace(/^@/,'').toLowerCase();
            return '<tr><td>' + (i + 1) + '</td><td>@' + escapeAttr(x.handle) + '</td><td>' + escapeAttr(x.full_name || '') + '</td><td>' + (x.followers_count != null ? Number(x.followers_count).toLocaleString('pt-BR') : '') + '</td><td>' + escapeAttr(x.collectedAt || '') + '</td><td><button type="button" class="btn-remove" data-handle="' + escapeAttr(hk) + '" title="Remover da lista">Excluir</button></td></tr>';
          }).join('');
        })
        .catch(function() {
          document.getElementById('count').textContent = '?';
          showApiErr('Lista não atualizou — confira se o collector está ativo nesta mesma porta (' + window.location.port + ').');
        });
    }
    document.getElementById('rows').addEventListener('click', function(e) {
      var btn = e.target.closest('.btn-remove');
      if (!btn) return;
      var h = btn.getAttribute('data-handle');
      if (!h || !confirm('Remover @' + h + ' da lista?')) return;
      fetch(apiUrl('/api/remove'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ handle: h }) })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (d.removed) refreshList();
          else alert(d.error || 'Não foi possível remover.');
        });
    });
    refreshList();
    setInterval(refreshList, 5000);

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
        var payload = {
          mode: mode,
          tags: tags.length ? tags : undefined,
          limit: numFromInput('limit', 20),
          minFollowers: numFromInput('minFollowers', 5000),
          minPostLikes: numFromInput('minPostLikes', 200),
          minPostsWithMinLikes: numFromInput('minPostsWithMinLikes', 4),
          maxPostsPerTag: numFromInput('maxPostsPerTag', 30),
          excludeBusinessProfiles: !!(document.getElementById('excludeBusiness') && document.getElementById('excludeBusiness').checked)
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
          if (active) {
            stEl.className = 'status running';
            stEl.textContent = d.scheduled && !d.running ? 'Iniciando coleta…' : ('Coletando… ' + msg);
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

export function startServer(client: InstagramClient, page: Page): void {
  const server = createServer(createCollectorRequestHandler(client, page));

  const attemptListen = (port: number): void => {
    const onError = (err: NodeJS.ErrnoException): void => {
      server.off('error', onError);
      if (err.code === 'EADDRINUSE' && port < PORT + PORT_TRY_MAX) {
        console.warn(`[Collector] Porta ${port} em uso — tentando ${port + 1}...`);
        attemptListen(port + 1);
        return;
      }
      console.error(
        '\n[Collector] Não foi possível abrir a interface HTTP.',
        err.code === 'EADDRINUSE'
          ? `\n  Feche o outro programa na porta ${PORT} ou defina COLLECTOR_UI_PORT=3970 no .env\n`
          : err.message
      );
      process.exit(1);
    };
    server.on('error', onError);
    server.listen(port, '0.0.0.0', () => {
      server.off('error', onError);
      uiListenPort = port;
      console.log('\n' + '='.repeat(56));
      console.log('[Collector] Abra no navegador:');
      console.log(`   http://127.0.0.1:${port}/`);
      console.log(`   http://localhost:${port}/`);
      if (port !== PORT) {
        console.log(`   (porta ${PORT} estava ocupada — usando ${port})`);
      }
      console.log('='.repeat(56) + '\n');
    });
  };
  attemptListen(PORT);
}
