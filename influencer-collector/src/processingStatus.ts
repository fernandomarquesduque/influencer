/**
 * Perfil em extração/envio — exibido na UI em “Coletados” enquanto o browser/API trabalham.
 */

export interface ProcessingState {
  handle: string;
  stage: string;
  since: string;
  /** Nome completo do Instagram, quando já lido no gate ou na extração. */
  full_name?: string;
  /** Seguidores quando já conhecidos. */
  followers_count?: number | null;
  /** `account_type` do Instagram (1–3) quando detectável. */
  account_type?: number | null;
  /** Categoria do perfil (texto curto). */
  category?: string;
}

let current: ProcessingState | null = null;

export function setProcessingState(state: ProcessingState | null): void {
  current = state;
}

export function getProcessingState(): ProcessingState | null {
  return current;
}
