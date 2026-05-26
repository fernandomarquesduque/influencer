export const OPEN_PLANS_MODAL_EVENT = 'busca-influencer:open-plans'

export function openBuscaInfluencerPlansModal(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(OPEN_PLANS_MODAL_EVENT))
}
