type MetaPixelTrackParams = Record<string, string | number | boolean>

type MetaPixelFn = (action: 'track', event: string, params?: MetaPixelTrackParams) => void

declare global {
  interface Window {
    fbq?: MetaPixelFn
  }
}

export function trackMetaPixel(event: string, params?: MetaPixelTrackParams): void {
  if (typeof window === 'undefined') return
  if (typeof window.fbq !== 'function') return
  window.fbq('track', event, params)
}

