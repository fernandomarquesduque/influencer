import { trackPlansIntent } from './metaPixelFunnel'

export const OPEN_PLANS_MODAL_EVENT = 'busca-influencer:open-plans'

export function openBuscaInfluencerPlansModal(source = 'global_event'): void {
  if (typeof window === 'undefined') return
  trackPlansIntent('modal_open', { source })
  window.dispatchEvent(new CustomEvent(OPEN_PLANS_MODAL_EVENT))
}
