/**
 * Rate limit em memória para a API (proteção contra crawlers e extração em massa).
 * Janela fixa de 1 minuto: máximo de N requisições por (IP ou usuário) por minuto.
 */

const WINDOW_MS = 60 * 1000; // 1 minuto

interface WindowState {
  count: number;
  resetAt: number;
}

const store = new Map<string, WindowState>();

/** Limpa entradas expiradas (evitar crescimento infinito do Map). */
function prune(): void {
  const now = Date.now();
  for (const [key, state] of store.entries()) {
    if (state.resetAt <= now) store.delete(key);
  }
}

/** Chama prune a cada 5 minutos. */
let pruneInterval: ReturnType<typeof setInterval> | null = null;
function ensurePruneInterval(): void {
  if (pruneInterval) return;
  pruneInterval = setInterval(() => {
    prune();
  }, 5 * 60 * 1000);
  if (pruneInterval.unref) pruneInterval.unref();
}

/**
 * Verifica se o cliente (key) pode fazer mais uma requisição.
 * @param key Identificador único (ex: "ip:abc123" ou "user:42")
 * @param maxPerWindow Máximo de requisições na janela (1 min)
 * @returns true se permitido; false se excedeu (deve retornar 429)
 */
export function checkApiRateLimit(key: string, maxPerWindow: number): boolean {
  if (maxPerWindow <= 0) return true;
  ensurePruneInterval();
  const now = Date.now();
  let state = store.get(key);
  if (!state || state.resetAt <= now) {
    state = { count: 0, resetAt: now + WINDOW_MS };
    store.set(key, state);
  }
  if (state.count >= maxPerWindow) return false;
  state.count++;
  return true;
}

/**
 * Retorna quantos segundos o cliente deve esperar antes de tentar de novo (para header Retry-After).
 */
export function getRetryAfterSeconds(key: string): number {
  const state = store.get(key);
  if (!state) return 60;
  const remaining = Math.ceil((state.resetAt - Date.now()) / 1000);
  return Math.max(1, Math.min(60, remaining));
}
