import { trackPlansIntent } from './metaPixelFunnel'

export const OPEN_PLANS_MODAL_EVENT = 'busca-influencer:open-plans'

export function openBuscaInfluencerPlansModal(source = 'global_event'): void {
  if (typeof window === 'undefined') return
  // Em ACCESS_MODE=open o front ainda pode abrir o modal (checkout permanece disponível),
  // mas a maioria dos CTAs de paywall já evita chamar isto.
  trackPlansIntent('modal_open', { source })
  window.dispatchEvent(new CustomEvent(OPEN_PLANS_MODAL_EVENT))
}
