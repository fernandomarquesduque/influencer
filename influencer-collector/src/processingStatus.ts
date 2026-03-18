/**
 * Perfil em extração/envio — exibido na UI em “Coletados” enquanto o browser/API trabalham.
 */

export interface ProcessingState {
  handle: string;
  stage: string;
  since: string;
}

let current: ProcessingState | null = null;

export function setProcessingState(state: ProcessingState | null): void {
  current = state;
}

export function getProcessingState(): ProcessingState | null {
  return current;
}
