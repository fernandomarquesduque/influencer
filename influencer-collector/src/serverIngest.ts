/**
 * Envia o perfil (e opcionalmente feed/reels/marcados) para a API → RocksDB.
 */

import type { Entity } from './entityRules.js';
import type {
  CollectorMediaPayload,
  IntegrationPushResult,
  RocksDbVerifyStatus,
} from './memoryStorage.js';
import { coletaLog } from './coletaLog.js';

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

let warnedApiSuffix = false;

/**
 * IIS/publicação: a API crawl fica em https://domínio/api — não na raiz do site.
 * Se COLLECTOR_API_BASE for só o domínio, o POST ia para /crawl/... no front (nada no RocksDB).
 */
export function getCollectorApiBase(): string | null {
  const base = process.env.COLLECTOR_API_BASE?.trim();
  if (!base) return null;
  if (
    process.env.COLLECTOR_API_NO_AUTO_SUFFIX === '1' ||
    process.env.COLLECTOR_API_NO_AUTO_SUFFIX?.toLowerCase() === 'true'
  ) {
    return normalizeBaseUrl(base);
  }
  let s = base.trim();
  if (!/^https?:\/\//i.test(s)) {
    s = 'https://' + s;
  }
  try {
    const u = new URL(s);
    const pathOnly = (u.pathname || '').replace(/\/+$/, '') || '/';
    const alreadyHasApiPath = /^\/api(\/|$)/i.test(pathOnly);
    if (!alreadyHasApiPath && (pathOnly === '/' || pathOnly === '') && !/^api\./i.test(u.hostname)) {
      const fixed = `${u.origin}/api`;
      if (!warnedApiSuffix) {
        warnedApiSuffix = true;
        console.warn(
          '\n[Collector→API] ═══════════════════════════════════════════════════════'
        );
        console.warn(
          `[Collector→API] COLLECTOR_API_BASE estava sem /api — os POSTs iam para o site errado.`
        );
        console.warn(`[Collector→API] Usando agora: ${fixed}`);
        console.warn(
          `[Collector→API] Ajuste o .env: COLLECTOR_API_BASE=${fixed} (e https se possível).`
        );
        console.warn(
          '[Collector→API] Sem isso, a busca no site nunca encontra os perfis (dados não vão ao RocksDB).'
        );
        console.warn(
          '[Collector→API] Se sua API não usa /api, defina COLLECTOR_API_NO_AUTO_SUFFIX=true.\n'
        );
      }
      return fixed;
    }
    return normalizeBaseUrl(u.origin + (pathOnly === '/' ? '' : pathOnly));
  } catch {
    return normalizeBaseUrl(base);
  }
}

export function isRemoteIngestConfigured(): boolean {
  return Boolean(getCollectorApiBase() && process.env.COLLECTOR_INGEST_KEY?.trim());
}

let warnedMissingConfig = false;

function extractHandleForVerify(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const o = body as Record<string, unknown>;
  if (typeof o.handle === 'string' && o.handle.trim()) {
    return o.handle.replace(/^@/, '').trim().toLowerCase();
  }
  const p = o.profile;
  if (p != null && typeof p === 'object' && !Array.isArray(p)) {
    const h = (p as Record<string, unknown>).handle;
    if (typeof h === 'string' && h.trim()) return h.replace(/^@/, '').trim().toLowerCase();
  }
  return null;
}

/** Confirma no servidor que o perfil está no RocksDB (após ingest). */
async function verifyProfileOnServer(
  base: string,
  key: string,
  handle: string
): Promise<'ok' | 'not_found' | 'unavailable'> {
  const verifyUrl = `${base.replace(/\/+$/, '')}/crawl/collector-verify-profile?handle=${encodeURIComponent(handle)}`;
  const ms = Math.min(parseInt(process.env.COLLECTOR_VERIFY_TIMEOUT_MS ?? '', 10) || 20000, 60000);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(verifyUrl, {
      method: 'GET',
      headers: { 'X-Collector-Key': key },
      signal: ac.signal,
    });
    if (r.status === 404) return 'unavailable';
    if (!r.ok) return 'unavailable';
    const j = (await r.json()) as { found?: boolean };
    return j.found === true ? 'ok' : 'not_found';
  } catch {
    return 'unavailable';
  } finally {
    clearTimeout(timer);
  }
}

function apiTimeoutMs(path: string): number {
  const isFull = path.includes('collector-ingest-full');
  const env = isFull
    ? process.env.COLLECTOR_API_TIMEOUT_FULL_MS
    : process.env.COLLECTOR_API_TIMEOUT_SLIM_MS;
  const parsed = env ? parseInt(env, 10) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return isFull ? 600_000 : 120_000;
}

async function postCollector(
  path: string,
  body: unknown
): Promise<IntegrationPushResult> {
  const base = getCollectorApiBase();
  const key = process.env.COLLECTOR_INGEST_KEY?.trim();
  if (!base || !key) {
    if (!warnedMissingConfig) {
      warnedMissingConfig = true;
      console.warn(
        '[Collector→API] Sem COLLECTOR_API_BASE/COLLECTOR_INGEST_KEY — perfis ficam só em “Coletados”.'
      );
    }
    return { ok: false, skipped: true };
  }
  const url = `${base.replace(/\/+$/, '')}/crawl/${path}`;
  const t0 = Date.now();
  let bodyStr: string;
  try {
    bodyStr = JSON.stringify(body);
  } catch {
    return {
      ok: false,
      skipped: false,
      error: 'Falha ao serializar JSON para API',
      endpoint: url,
    };
  }
  const kb = (bodyStr.length / 1024).toFixed(0);
  const timeoutMs = apiTimeoutMs(path);
  coletaLog(`API → ${path} (~${kb} KB) enviando… (timeout ${Math.round(timeoutMs / 1000)}s)`);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    /**
     * fetch segue 301/302 trocando POST por GET — a API Express responde "Cannot GET …/collector-ingest-full".
     * Seguimos redirecionamentos manualmente e repetimos POST (ex.: http→https, www).
     */
    let postUrl = url;
    let res: Response | null = null;
    const postHeaders = {
      'Content-Type': 'application/json',
      'X-Collector-Key': key,
    };
    for (let hop = 0; hop < 8; hop++) {
      res = await fetch(postUrl, {
        method: 'POST',
        headers: postHeaders,
        body: bodyStr,
        signal: ac.signal,
        redirect: 'manual',
      });
      const st = res.status;
      if (st >= 300 && st < 400) {
        const loc = res.headers.get('location')?.trim();
        if (loc) {
          const next = new URL(loc, postUrl).href;
          if (hop === 0) {
            coletaLog(
              `[Collector→API] Redirecionamento ${st} ${postUrl} → ${next} (repetindo POST; evite URL que redireciona — use a URL final em COLLECTOR_API_BASE).`
            );
          }
          postUrl = next;
          continue;
        }
      }
      break;
    }
    if (!res) {
      return { ok: false, skipped: false, error: 'Sem resposta da API', endpoint: postUrl };
    }
    const text = await res.text();
    const ms = Date.now() - t0;
    if (!res.ok) {
      let msg = text;
      try {
        const j = JSON.parse(text) as { error?: string };
        if (j.error) msg = j.error;
      } catch {
        /* use text */
      }
      const err = `${res.status} ${msg}`;
      coletaLog(`API ← ${path} FALHA ${ms}ms — ${err.slice(0, 120)}`);
      return { ok: false, skipped: false, error: err, endpoint: postUrl };
    }

    const trimmed = text.trim();
    if (trimmed.startsWith('<') || trimmed.startsWith('<!')) {
      const hint =
        'Resposta foi HTML (site estático), não a API crawl. Use COLLECTOR_API_BASE=…/api (ex.: https://buscainfluencer.com.br/api).';
      coletaLog(`API ← ${path} ERRO: ${hint}`);
      return {
        ok: false,
        skipped: false,
        error: hint,
        endpoint: postUrl,
      };
    }
    let ingestJson: { ok?: boolean; handle?: string } | null = null;
    try {
      ingestJson = JSON.parse(text) as { ok?: boolean };
    } catch {
      coletaLog(`API ← ${path} ERRO: corpo não é JSON da API de ingest.`);
      return {
        ok: false,
        skipped: false,
        error: 'Resposta não é JSON válido da API — confira COLLECTOR_API_BASE (precisa …/api).',
        endpoint: postUrl,
      };
    }
    if (ingestJson?.ok !== true) {
      const errMsg =
        (ingestJson as { error?: string }).error ??
        'API não retornou ok:true — possível URL errada ou chave inválida no servidor certo.';
      coletaLog(`API ← ${path} ERRO: ${errMsg}`);
      return { ok: false, skipped: false, error: errMsg, endpoint: postUrl };
    }

    coletaLog(`API ← ${path} OK em ${ms}ms (ingest confirmado no servidor)`);

    /** Base da API após redirecionamentos (ex. http→https), para o GET de verificação. */
    const ingestApiBase = postUrl.replace(/\/crawl\/collector-ingest-(?:full|profile).*$/i, '');

    const skipVerify =
      process.env.COLLECTOR_SKIP_VERIFY === '1' ||
      process.env.COLLECTOR_SKIP_VERIFY?.toLowerCase() === 'true';

    let verifyStatus: RocksDbVerifyStatus = 'skipped';
    if (skipVerify) {
      verifyStatus = 'skipped';
    } else {
      const h = extractHandleForVerify(body);
      if (h) {
        const v = await verifyProfileOnServer(ingestApiBase || base, key, h);
        if (v === 'not_found') {
          coletaLog(
            `API ← verify @${h}: perfil NÃO encontrado no RocksDB após ingest (republicar API ou COLLECTOR_SKIP_VERIFY se multi-worker).`
          );
          return {
            ok: false,
            skipped: false,
            error:
              'POST OK mas verificação GET /collector-verify-profile retornou found=false — dado não visível no servidor.',
            endpoint: postUrl,
            verifyStatus: 'unavailable',
          };
        }
        if (v === 'ok') {
          verifyStatus = 'confirmed';
          coletaLog(`API ← verify @${h}: confirmado no RocksDB (GET collector-verify-profile).`);
        } else {
          verifyStatus = 'unavailable';
          coletaLog(
            `API ← verify: não foi possível confirmar (rota antiga ou rede) — ingest POST foi aceito.`
          );
        }
      }
    }

    let apiHost = '';
    try {
      apiHost = new URL(postUrl).host;
    } catch {
      /* ignore */
    }
    return { ok: true, skipped: false, endpoint: postUrl, verifyStatus, apiHost };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const ms = Date.now() - t0;
    const timedOut =
      e instanceof Error && (msg.includes('abort') || msg === 'The operation was aborted.');
    if (timedOut) {
      coletaLog(
        `API ← ${path} TIMEOUT após ${Math.round(ms / 1000)}s — o coletor segue para o próximo perfil. Aumente COLLECTOR_API_TIMEOUT_FULL_MS se a API for lenta.`
      );
      return {
        ok: false,
        skipped: false,
        error: `Timeout ${timeoutMs}ms ao enviar para API`,
        endpoint: url,
      };
    }
    coletaLog(`API ← ${path} erro rede ${ms}ms — ${msg}`);
    return { ok: false, skipped: false, error: msg, endpoint: url };
  } finally {
    clearTimeout(timer);
  }
}

export async function pushProfileToServerRocksDb(
  entity: Entity & { handle: string }
): Promise<IntegrationPushResult> {
  return postCollector('collector-ingest-profile', entity);
}

/** Perfil slim + nós GraphQL (feed, reels, marcados) para métricas no site. */
export async function pushProfileFullToServer(
  slim: Entity & { handle: string },
  media: CollectorMediaPayload
): Promise<IntegrationPushResult> {
  return postCollector('collector-ingest-full', {
    profile: slim,
    feedMedia: media.feed,
    reelMedia: media.reel,
    taggedMedia: media.tagged,
  });
}
