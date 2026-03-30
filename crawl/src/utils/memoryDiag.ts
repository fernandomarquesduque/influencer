/**
 * Snapshots de memória para diagnosticar OOM (cache de busca × Playwright × Sharp/S3).
 * Desligar: MEMORY_DIAG=0 ou false
 * Capas S3: log a cada N uploads bem-sucedidos (default 10); só início/fim: MEM_DIAG_S3_COVER_EVERY=0
 */
import v8 from 'node:v8';

export function memoryDiagEnabled(): boolean {
  const v = process.env.MEMORY_DIAG;
  if (v === '0' || String(v).toLowerCase() === 'false') return false;
  return true;
}

/** A cada quantas capas S3 logar (0 = só início/fim do lote). */
export function memoryDiagS3CoverEvery(): number {
  const raw = process.env.MEM_DIAG_S3_COVER_EVERY ?? '10';
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return 10;
  return Math.max(0, n);
}

export function logMemorySnapshot(label: string, extra?: Record<string, unknown>): void {
  if (!memoryDiagEnabled()) return;
  const mu = process.memoryUsage();
  const hs = v8.getHeapStatistics();
  const snapshot = {
    rss_mb: Math.round(mu.rss / 1024 / 1024),
    heap_used_mb: Math.round(mu.heapUsed / 1024 / 1024),
    heap_total_mb: Math.round(mu.heapTotal / 1024 / 1024),
    external_mb: Math.round(mu.external / 1024 / 1024),
    array_buffers_mb: Math.round(mu.arrayBuffers / 1024 / 1024),
    v8_heap_limit_mb: Math.round(hs.heap_size_limit / 1024 / 1024),
    v8_used_heap_mb: Math.round(hs.used_heap_size / 1024 / 1024),
    ...(extra && Object.keys(extra).length > 0 ? extra : {}),
  };
  console.log(`[mem] ${label}`, snapshot);
}
