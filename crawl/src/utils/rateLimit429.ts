/**
 * Estado de rate limit (429) por run do crawl.
 * 1º 429: pausa 10–30 min e continua.
 * 2º 429 no mesmo run: pausa 12h e encerra o crawl.
 */

let count429ThisRun = 0;

export function record429(): void {
  count429ThisRun++;
}

export function get429Count(): number {
  return count429ThisRun;
}

/** Backoff em ms: 1º 429 = 10–30 min; 2º+ = 12h. */
export function get429BackoffMs(): number {
  if (count429ThisRun <= 1) {
    const tenMin = 10 * 60 * 1000;
    const thirtyMin = 30 * 60 * 1000;
    return tenMin + Math.floor(Math.random() * (thirtyMin - tenMin + 1));
  }
  return 12 * 60 * 60 * 1000; // 12h
}

/** true se já tomou 429 duas vezes no mesmo run → encerrar crawl. */
export function shouldAbortRunAfter429(): boolean {
  return count429ThisRun >= 2;
}

export function reset429Run(): void {
  count429ThisRun = 0;
}
