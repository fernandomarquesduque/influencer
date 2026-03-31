/**
 * Perfil em extração/envio — exibido na UI em “Coletados” enquanto o browser/API trabalham.
 */

export type ListQueueKind = 'handles' | 'hashtag' | 'google_queries';

export interface ListQueueProgress {
  kind: ListQueueKind;
  /** Posição atual na lista (1-based). */
  index: number;
  total: number;
}

/**
 * Resultado do GET `collector-verify-profile` antes da extração (opção «Pular @ se já estiver no banco»).
 * - `off` — não consultou (API/chave ausente ou opção desmarcada).
 * - `not_in_db` — API respondeu: perfil não está no RocksDB.
 * - `unknown` — não foi possível confirmar (rede, timeout ou rota 404).
 */
export type RemotePrecheckUi = 'off' | 'not_in_db' | 'unknown';

export interface ProcessingState {
  handle: string;
  stage: string;
  since: string;
  /** Pré-verificação na API crawl antes do Instagram (se aplicável). */
  remotePrecheck?: RemotePrecheckUi;
  /** Nome completo do Instagram, quando já lido no gate ou na extração. */
  full_name?: string;
  /** Seguidores quando já conhecidos. */
  followers_count?: number | null;
  /** `account_type` do Instagram (1–3) quando detectável. */
  account_type?: number | null;
  /** Categoria do perfil (texto curto). */
  category?: string;
  /** Progresso da “lista” desta rodada (arrobas / hashtags / linhas Google). Preenchido via merge com `listQueue`. */
  listKind?: ListQueueKind;
  listIndex?: number;
  listTotal?: number;
  /** Itens restantes incluindo o da posição atual (até o fim da lista). */
  listRemaining?: number;
}

let current: ProcessingState | null = null;

let listQueue: ListQueueProgress | null = null;

export function setListQueueProgress(progress: ListQueueProgress | null): void {
  listQueue = progress;
}

/** Texto igual ao hint da UI (contador de lista: arrobas / hashtags / Google). */
export function formatListProgressLogSuffix(): string {
  const lq = listQueue;
  if (!lq || lq.total <= 0) return '';
  const rem = Math.max(0, lq.total - lq.index + 1);
  if (lq.kind === 'handles') {
    return `Lista de arrobas: ${lq.index}/${lq.total} — faltam ${rem} até o fim`;
  }
  if (lq.kind === 'hashtag') {
    return `Hashtags: ${lq.index}/${lq.total} — faltam ${rem} até o fim`;
  }
  return `Consultas Google: ${lq.index}/${lq.total} — faltam ${rem} até o fim`;
}

export function setProcessingState(state: ProcessingState | null): void {
  current = state;
}

function stageBetweenProfiles(kind: ListQueueKind): string {
  if (kind === 'handles') return 'Avançando na lista de arrobas…';
  if (kind === 'hashtag') return 'Trocando de hashtag…';
  return 'Avançando consulta Google…';
}

export function getProcessingState(): ProcessingState | null {
  const lq = listQueue;
  const listPatch =
    lq && lq.total > 0
      ? {
          listKind: lq.kind,
          listIndex: lq.index,
          listTotal: lq.total,
          listRemaining: Math.max(0, lq.total - lq.index + 1),
        }
      : {};
  if (!current && !lq) return null;
  if (!current) {
    if (!lq || lq.total <= 0) return null;
    return {
      handle: '',
      stage: stageBetweenProfiles(lq.kind),
      since: new Date().toISOString(),
      ...listPatch,
    };
  }
  return { ...current, ...listPatch };
}
