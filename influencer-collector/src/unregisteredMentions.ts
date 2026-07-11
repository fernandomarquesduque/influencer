/**
 * Busca @ citados em posts mas sem cadastro
 * (GET /crawl/collector-unregistered-mentions, X-Collector-Key).
 */

import { getCollectorApiBase, isRemoteIngestConfigured } from './serverIngest.js';
import { coletaLog } from './coletaLog.js';

export type UnregisteredMentionsFetchOptions = {
  strategy?: 'profiles' | 'posts';
  sample?: number;
  limit?: number;
  maxPostsPerProfile?: number;
};

export type UnregisteredMentionsFetchResult = {
  handles: string[];
  notRegisteredCount: number;
  profilesInDb: number;
  postsScanned: number;
};

function normalizeHandle(raw: string): string | null {
  const h = String(raw ?? '')
    .replace(/^@+/, '')
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9._]{2,30}$/.test(h)) return null;
  return h;
}

export function isUnregisteredMentionsApiReady(): boolean {
  return isRemoteIngestConfigured();
}

export async function fetchUnregisteredMentionHandles(
  options: UnregisteredMentionsFetchOptions = {}
): Promise<UnregisteredMentionsFetchResult> {
  const base = getCollectorApiBase();
  const key = process.env.COLLECTOR_INGEST_KEY?.trim();
  if (!base || !key) {
    throw new Error(
      'COLLECTOR_API_BASE e COLLECTOR_INGEST_KEY necessários para consultar menções sem cadastro (mesma chave do ingest).'
    );
  }

  const strategy = options.strategy === 'posts' ? 'posts' : 'profiles';
  const sample = Math.max(
    1,
    Math.min(strategy === 'profiles' ? 3_000 : 5_000, Math.floor(options.sample ?? 800) || 800)
  );
  const limit = Math.max(1, Math.min(2_000, Math.floor(options.limit ?? 500) || 500));
  const maxPostsPerProfile = Math.max(
    1,
    Math.min(40, Math.floor(options.maxPostsPerProfile ?? 15) || 15)
  );

  const params = new URLSearchParams({
    strategy,
    sample: String(sample),
    limit: String(limit),
  });
  if (strategy === 'profiles') {
    params.set('maxPostsPerProfile', String(maxPostsPerProfile));
  }

  const url = `${base}/crawl/collector-unregistered-mentions?${params}`;
  const timeoutMs = Math.min(
    parseInt(process.env.COLLECTOR_UNREGISTERED_TIMEOUT_MS ?? '', 10) || 180_000,
    600_000
  );
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    coletaLog(
      `API → collector-unregistered-mentions strategy=${strategy} sample=${sample} limit=${limit}` +
        (strategy === 'profiles' ? ` maxPostsPerProfile=${maxPostsPerProfile}` : '')
    );
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Collector-Key': key,
      },
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      throw new Error(
        `Resposta inválida de collector-unregistered-mentions (HTTP ${res.status}): ${text.slice(0, 120)}`
      );
    }
    if (!res.ok) {
      const err =
        (typeof json.error === 'string' && json.error) ||
        (typeof json.message === 'string' && json.message) ||
        `HTTP ${res.status}`;
      throw new Error(`collector-unregistered-mentions falhou: ${err}`);
    }

    const rawList = Array.isArray(json.notRegistered) ? json.notRegistered : [];
    const seen = new Set<string>();
    const handles: string[] = [];
    for (const item of rawList) {
      const h = normalizeHandle(typeof item === 'string' ? item : String(item ?? ''));
      if (!h || seen.has(h)) continue;
      seen.add(h);
      handles.push(h);
    }

    const notRegisteredCount =
      typeof json.notRegisteredCount === 'number' && Number.isFinite(json.notRegisteredCount)
        ? Math.floor(json.notRegisteredCount)
        : handles.length;
    const profilesInDb =
      typeof json.profilesInDb === 'number' && Number.isFinite(json.profilesInDb)
        ? Math.floor(json.profilesInDb)
        : 0;
    const postsScanned =
      typeof json.postsScanned === 'number' && Number.isFinite(json.postsScanned)
        ? Math.floor(json.postsScanned)
        : 0;

    coletaLog(
      `API ← collector-unregistered-mentions: ${handles.length} @ na lista` +
        (notRegisteredCount > handles.length ? ` (${notRegisteredCount} na amostra)` : '') +
        ` · ${profilesInDb} perfis no DB · ${postsScanned} posts vistos`
    );

    return { handles, notRegisteredCount, profilesInDb, postsScanned };
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error(
        `Timeout ao consultar collector-unregistered-mentions após ${Math.round(timeoutMs / 1000)}s`
      );
    }
    throw e;
  } finally {
    clearTimeout(to);
  }
}

export function sleepMs(ms: number, shouldAbort?: () => boolean): Promise<void> {
  const n = Math.max(0, Math.floor(ms));
  if (n <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (shouldAbort?.()) {
        resolve();
        return;
      }
      if (Date.now() - started >= n) {
        resolve();
        return;
      }
      setTimeout(tick, Math.min(500, n - (Date.now() - started)));
    };
    setTimeout(tick, Math.min(500, n));
  });
}
