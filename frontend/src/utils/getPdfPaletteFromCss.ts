/**
 * Lê a paleta do PDF a partir das variáveis CSS do tema (theme.css).
 * Única fonte de verdade para cores: frontend/src/theme.css
 */

export type ThemeMode = 'light' | 'dark' | 'sepia' | 'ocean' | 'contrast'

export interface PdfPalette {
  ink: string
  text: string
  textSecondary: string
  textMuted: string
  brand: string
  brandDark: string
  brandSoft: string
  gold: string
  goldSoft: string
  border: string
  borderLight: string
  pageBg: string
  cardBg: string
  cardAlt: string
}

const CSS_VARS: Record<keyof PdfPalette, string> = {
  pageBg: '--app-bg',
  cardBg: '--app-card-bg',
  cardAlt: '--app-card-bg-soft',
  ink: '--app-text',
  text: '--app-text',
  textSecondary: '--app-text-secondary',
  textMuted: '--app-text-tertiary',
  brand: '--app-primary',
  brandDark: '--app-primary-dark',
  brandSoft: '--app-primary-muted',
  gold: '--app-gold',
  goldSoft: '--app-gold-light',
  border: '--app-border',
  borderLight: '--app-border-light',
}

function readCssVar(el: HTMLElement, name: string): string {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') return ''
  return getComputedStyle(el).getPropertyValue(name).trim() || ''
}

/**
 * Aplica o tema no documento, lê as variáveis de theme.css e devolve a paleta para o PDF.
 * Não define cores aqui; todas vêm do CSS.
 */
export function getPdfPaletteFromTheme(theme: ThemeMode): PdfPalette {
  const el = typeof document !== 'undefined' ? document.documentElement : null
  if (!el) {
    return fallbackPalette()
  }
  const prev = el.getAttribute('data-theme')
  el.setAttribute('data-theme', theme)
  const palette = {} as PdfPalette
  for (const key of Object.keys(CSS_VARS) as (keyof PdfPalette)[]) {
    const value = readCssVar(el, CSS_VARS[key])
    palette[key] = value || fallbackPalette()[key]
  }
  if (prev !== null) el.setAttribute('data-theme', prev)
  else el.removeAttribute('data-theme')
  return palette
}

/** Usado apenas quando não há DOM (ex: testes); delega ao tema light via CSS se possível. */
function fallbackPalette(): PdfPalette {
  const el = typeof document !== 'undefined' ? document.documentElement : null
  if (el) {
    const prev = el.getAttribute('data-theme')
    el.setAttribute('data-theme', 'light')
    const palette = {} as PdfPalette
    for (const key of Object.keys(CSS_VARS) as (keyof PdfPalette)[]) {
      palette[key] = readCssVar(el, CSS_VARS[key])
    }
    if (prev !== null) el.setAttribute('data-theme', prev)
    else el.removeAttribute('data-theme')
    return palette
  }
  return {
    ink: '',
    text: '',
    textSecondary: '',
    textMuted: '',
    brand: '',
    brandDark: '',
    brandSoft: '',
    gold: '',
    goldSoft: '',
    border: '',
    borderLight: '',
    pageBg: '',
    cardBg: '',
    cardAlt: '',
  }
}
