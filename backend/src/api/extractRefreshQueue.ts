/**
 * Fila serial de re-extração de perfis (Playwright → S3). Usada por /api/crawl/queue-refresh e painel admin.
 */

export const REFRESH_MIN_INTERVAL_MS = 60 * 60 * 1000;

const refreshProfileQueue: string[] = [];
const refreshProfileQueueSet = new Set<string>();
const refreshPriorityHandles = new Set<string>();
/** Handle em extração agora (já saiu do array `pending`, mas ainda não terminou). */
let refreshProfileProcessingHandle: string | null = null;

export type ExtractRefreshQueueSnapshot = {
  pending: string[];
  priorityHandles: string[];
  /** @ em Playwright agora (não está mais em `pending`). */
  processing_handle: string | null;
  length: number;
};

export function getExtractRefreshQueueSnapshot(): ExtractRefreshQueueSnapshot {
  const pendingLen = refreshProfileQueue.length;
  const processing = refreshProfileProcessingHandle;
  return {
    pending: [...refreshProfileQueue],
    priorityHandles: [...refreshPriorityHandles],
    processing_handle: processing,
    length: pendingLen + (processing ? 1 : 0),
  };
}

export function setExtractRefreshProcessingHandle(handle: string | null): void {
  refreshProfileProcessingHandle = handle
    ? handle.replace(/^@/, '').trim().toLowerCase()
    : null;
}

/** Playwright/S3/DB pesados em andamento — busca por legenda deve aliviar carga no RocksDB. */
export function isExtractRefreshProcessing(): boolean {
  return refreshProfileProcessingHandle != null;
}

export function isHandleInExtractRefreshQueue(handle: string): boolean {
  const h = handle.toLowerCase().replace(/^@/, '');
  if (refreshProfileProcessingHandle === h) return true;
  return refreshProfileQueueSet.has(h);
}

export type EnqueueRefreshResult = {
  handle: string;
  queued: boolean;
  message: string;
};

/**
 * Enfileira handle para re-extração.
 * A ordem de processamento é sempre FIFO (mais antigo na fila sai primeiro).
 */
export function enqueueExtractRefresh(handle: string, priority: boolean): EnqueueRefreshResult {
  const h = handle.replace(/^@/, '').trim().toLowerCase();
  if (!h) {
    return { handle: h, queued: false, message: 'Handle vazio.' };
  }
  if (refreshProfileQueueSet.has(h)) {
    return { handle: h, queued: false, message: 'Já está na fila.' };
  }
  refreshProfileQueue.push(h);
  if (priority) refreshPriorityHandles.add(h);
  refreshProfileQueueSet.add(h);
  return {
    handle: h,
    queued: true,
    message: 'Na fila para re-extração.',
  };
}

/** Remove handle da fila (após processar ou erro). */
export function dequeueExtractRefreshHandle(handle: string): void {
  const h = handle.toLowerCase().replace(/^@/, '');
  refreshProfileQueueSet.delete(h);
  refreshPriorityHandles.delete(h);
}

/** Próximo handle da fila (FIFO com prioridade no início). */
export function shiftNextExtractRefreshHandle(): string | undefined {
  return refreshProfileQueue.shift();
}

export function isExtractRefreshPriority(handle: string): boolean {
  return refreshPriorityHandles.has(handle.toLowerCase().replace(/^@/, ''));
}

export function clearExtractRefreshPriority(handle: string): void {
  refreshPriorityHandles.delete(handle.toLowerCase().replace(/^@/, ''));
}

/** Remove todos os pendentes da fila (não cancela extração já em andamento). */
export function clearExtractRefreshQueue(): {
  cleared_pending: number;
  processing_handle: string | null;
} {
  const processing = refreshProfileProcessingHandle;
  const cleared = refreshProfileQueue.length;
  for (const h of refreshProfileQueue) {
    refreshProfileQueueSet.delete(h);
    refreshPriorityHandles.delete(h);
  }
  refreshProfileQueue.length = 0;
  return { cleared_pending: cleared, processing_handle: processing };
}
