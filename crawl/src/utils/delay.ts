/** CRAWL_FAST=1 reduz delays (~40%). CRAWL_SAFE=1 usa ritmo mais lento (5–8 req/min) para evitar 429. */
const FAST_MULTIPLIER = process.env.CRAWL_FAST === '1' || process.env.CRAWL_FAST === 'true' ? 0.4 : 1;
const SAFE_MODE = process.env.CRAWL_SAFE === '1' || process.env.CRAWL_SAFE === 'true';

export function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const min = Math.round(minMs * FAST_MULTIPLIER);
  const max = Math.round(maxMs * FAST_MULTIPLIER);
  const ms = Math.floor(Math.random() * (Math.max(max - min + 1, 1))) + min;
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Delay entre requisições pesadas (abrir post, abrir perfil) para evitar rate limit (429).
 * Regra prática: 3–6 s com jitter. Em CRAWL_SAFE=1: ~8–12 s (5–8 req/min).
 */
export function humanDelay(): Promise<void> {
  const base = SAFE_MODE ? 8000 : 3000;
  const jitter = SAFE_MODE ? 4000 : 3000;
  const ms = Math.round(base + Math.random() * jitter);
  const actual = Math.round(ms * FAST_MULTIPLIER);
  return new Promise((r) => setTimeout(r, Math.max(1000, actual)));
}

/** Backoff longo ao detectar 429 (Too Many Requests). Padrão 15 min. */
export const RATE_LIMIT_BACKOFF_MS = 15 * 60 * 1000;

export function rateLimitBackoff(): Promise<void> {
  const ms = RATE_LIMIT_BACKOFF_MS;
  return new Promise((r) => setTimeout(r, ms));
}

/** Delay fixo em ms (respeita CRAWL_FAST). */
export function delayMs(ms: number): number {
  return Math.max(100, Math.round(ms * FAST_MULTIPLIER));
}
