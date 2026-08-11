/**
 * Modo de acesso ao produto (paywall).
 *
 * ACCESS_MODE=open  → busca, perfis, handles e relatórios liberados (sem exigir plano/créditos)
 * ACCESS_MODE=gated → comportamento pago atual
 *
 * Padrão: open (fase de indexação / tração). Para voltar ao paywall: ACCESS_MODE=gated
 */

export type AccessMode = 'open' | 'gated';

export function getAccessMode(): AccessMode {
  const raw = (process.env.ACCESS_MODE ?? 'open').trim().toLowerCase();
  if (raw === 'gated' || raw === 'paid' || raw === 'closed') return 'gated';
  return 'open';
}

/** true = tudo que era pago fica livre (fonte de verdade no backend). */
export function isOpenAccess(): boolean {
  return getAccessMode() === 'open';
}
