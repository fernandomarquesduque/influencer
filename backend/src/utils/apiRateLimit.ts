/**
 * Rate limit em memória (proteção contra abuso e freemium na busca pública).
 * Janela configurável por chamada (1 min para API geral, 10 min para busca public/anônimo).
 */

export const API_RATE_WINDOW_MS = 60 * 1000;

const PUBLIC_SEARCH_WINDOW_MINUTES_RAW = Number(process.env.API_RATE_LIMIT_PUBLIC_SEARCH_WINDOW_MINUTES);
/** Janela do rate limit de busca textual (visitante / scope public). Padrão 10 minutos. */
export const PUBLIC_SEARCH_RATE_WINDOW_MS =
  Number.isFinite(PUBLIC_SEARCH_WINDOW_MINUTES_RAW) && PUBLIC_SEARCH_WINDOW_MINUTES_RAW > 0
    ? PUBLIC_SEARCH_WINDOW_MINUTES_RAW * 60 * 1000
    : 10 * 60 * 1000;

/** Máximo de buscas (requests que consomem cota) por janela. */
export const PUBLIC_SEARCH_RATE_MAX = Math.max(
  0,
  Number(process.env.API_RATE_LIMIT_PUBLIC_SEARCH_PER_HOUR) ||
  Number(process.env.PUBLIC_SEARCH_LIMIT_PER_HOUR) ||
  20
);

interface WindowState {
  count: number;
  resetAt: number;
}

const store = new Map<string, WindowState>();

function prune(): void {
  const now = Date.now();
  for (const [key, state] of store.entries()) {
    if (state.resetAt <= now) store.delete(key);
  }
}

let pruneInterval: ReturnType<typeof setInterval> | null = null;
function ensurePruneInterval(): void {
  if (pruneInterval) return;
  pruneInterval = setInterval(prune, 10 * 60 * 1000);
  if (pruneInterval.unref) pruneInterval.unref();
}

function getOrCreateState(key: string, now: number, windowMs: number): WindowState {
  let state = store.get(key);
  if (!state || state.resetAt <= now) {
    state = { count: 0, resetAt: now + windowMs };
    store.set(key, state);
  }
  return state;
}

export type ApiRateLimitOptions = {
  /** Duração da janela (default 1 min). */
  windowMs?: number;
  /** false = só valida, não incrementa (ex.: paginação com cota já esgotada). */
  increment?: boolean;
};

/**
 * Verifica se o cliente (key) pode fazer mais uma requisição na janela.
 * @returns true se permitido; false se excedeu
 */
export function checkApiRateLimit(
  key: string,
  maxPerWindow: number,
  options?: ApiRateLimitOptions
): boolean {
  if (maxPerWindow <= 0) return true;
  const windowMs = options?.windowMs ?? API_RATE_WINDOW_MS;
  const increment = options?.increment !== false;
  ensurePruneInterval();
  const now = Date.now();
  const state = getOrCreateState(key, now, windowMs);
  if (state.count >= maxPerWindow) return false;
  if (increment) state.count++;
  return true;
}

/** Segundos até o fim da janela (header Retry-After / contador na UI). */
export function getRetryAfterSeconds(key: string, windowMs: number = API_RATE_WINDOW_MS): number {
  const state = store.get(key);
  const maxSec = Math.ceil(windowMs / 1000);
  if (!state) return maxSec;
  const remaining = Math.ceil((state.resetAt - Date.now()) / 1000);
  return Math.max(1, Math.min(maxSec, remaining));
}
