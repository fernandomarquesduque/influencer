/** CRAWL_FAST=1 reduz delays (~40%). CRAWL_SAFE=1 usa ritmo mais lento (5–8 req/min). CRAWL_DELAY_EXTRA_MS soma ms em cada delay. */
function getFastMultiplier(): number {
  return process.env.CRAWL_FAST === '1' || process.env.CRAWL_FAST === 'true' ? 0.4 : 1;
}
function getSafeMode(): boolean {
  return process.env.CRAWL_SAFE === '1' || process.env.CRAWL_SAFE === 'true';
}
function getDelayExtraMs(): number {
  return Math.max(0, parseInt(process.env.CRAWL_DELAY_EXTRA_MS ?? '0', 10) || 0);
}

export function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const extra = getDelayExtraMs();
  const min = Math.round(minMs * getFastMultiplier()) + extra;
  const max = Math.round(maxMs * getFastMultiplier()) + extra;
  const ms = Math.floor(Math.random() * (Math.max(max - min + 1, 1))) + min;
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Delay entre requisições pesadas (abrir post, abrir perfil) para evitar rate limit (429).
 * Regra prática: 3–6 s com jitter. Em CRAWL_SAFE=1: ~8–12 s (5–8 req/min).
 */
export function humanDelay(): Promise<void> {
  const safe = getSafeMode();
  const base = safe ? 8000 : 3000;
  const jitter = safe ? 4000 : 3000;
  const ms = Math.round(base + Math.random() * jitter);
  const actual = Math.round(ms * getFastMultiplier()) + getDelayExtraMs();
  return new Promise((r) => setTimeout(r, Math.max(1000, actual)));
}

/** Backoff longo ao detectar 429 (Too Many Requests). Padrão 15 min. */
export const RATE_LIMIT_BACKOFF_MS = 15 * 60 * 1000;

export function rateLimitBackoff(): Promise<void> {
  const ms = RATE_LIMIT_BACKOFF_MS;
  return new Promise((r) => setTimeout(r, ms));
}

/** Delay fixo em ms (respeita CRAWL_FAST e CRAWL_DELAY_EXTRA_MS). */
export function delayMs(ms: number): number {
  return Math.max(100, Math.round(ms * getFastMultiplier()) + getDelayExtraMs());
}
