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
 * Padrão: 5–9 s. Em CRAWL_SAFE=1: ~10–16 s (4–6 req/min). Use CRAWL_SAFE=1 ou --delay-extra se bloquear.
 */
export function humanDelay(): Promise<void> {
  const safe = getSafeMode();
  const base = safe ? 10_000 : 5000;
  const jitter = safe ? 6000 : 4000;
  const ms = Math.round(base + Math.random() * jitter);
  const actual = Math.round(ms * getFastMultiplier()) + getDelayExtraMs();
  return new Promise((r) => setTimeout(r, Math.max(2000, actual)));
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

/** Delay fixo para modo rápido (extract-profile API). Usa multiplicador 0.3 para reduzir ~70%. */
export function delayMsFast(ms: number): number {
  return Math.max(100, Math.round(ms * 0.3));
}

/**
 * Delay entre perfis no fluxo da API (extrair perfil). Usa MIN_DELAY_MS / MAX_DELAY_MS do env.
 * Padrão 8–20 s para reduzir bloqueio quando vários perfis são extraídos em sequência.
 */
export function profileExtractDelay(): Promise<void> {
  const min = Math.max(0, parseInt(process.env.MIN_DELAY_MS ?? '8000', 10) || 8000);
  const max = Math.max(min, parseInt(process.env.MAX_DELAY_MS ?? '20000', 10) || 20000);
  const ms = min + Math.floor(Math.random() * (max - min + 1));
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Delay curto para extract-profile via API (um perfil por vez, usuário esperando).
 * Usa EXTRACT_PROFILE_DELAY_MS do env (padrão 2000ms). Muito mais rápido que profileExtractDelay.
 */
export function profileExtractDelayForApi(): Promise<void> {
  const ms = Math.max(0, parseInt(process.env.EXTRACT_PROFILE_DELAY_MS ?? '2000', 10) || 2000);
  return new Promise((r) => setTimeout(r, ms));
}

/** humanDelay enxuto para modo rápido (extract-profile API). ~1–2 s em vez de 5–9 s. */
export function humanDelayFast(): Promise<void> {
  const ms = 1000 + Math.floor(Math.random() * 1000);
  return new Promise((r) => setTimeout(r, ms));
}
