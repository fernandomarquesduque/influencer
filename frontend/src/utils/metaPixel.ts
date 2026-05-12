export type MetaPixelTrackParams = Record<string, string | number | boolean>

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void
  }
}

export function trackMetaPixel(event: string, params?: MetaPixelTrackParams): void {
  if (typeof window === 'undefined') return
  const fbq = window.fbq
  if (typeof fbq !== 'function') return
  if (params && Object.keys(params).length > 0) fbq('track', event, params)
  else fbq('track', event)
}

/** Evento customizado no Meta (funil / UI, sem inflar conversões padrão). */
export function trackMetaPixelCustom(event: string, params?: MetaPixelTrackParams): void {
  if (typeof window === 'undefined') return
  const fbq = window.fbq
  if (typeof fbq !== 'function') return
  if (params && Object.keys(params).length > 0) fbq('trackCustom', event, params)
  else fbq('trackCustom', event)
}

/** Clique na app: um nome de evento no Ads (`AppUiClick`) e `action` para filtrar. */
export function trackAppUiClick(action: string, extra?: MetaPixelTrackParams): void {
  trackMetaPixelCustom('AppUiClick', { action, ...extra })
}

