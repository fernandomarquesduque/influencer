/**
 * Design system do relatório — cores e tokens vêm da folha central (index.css).
 * Todas as cores usam var(--app-*) para uma única fonte de verdade.
 */
export const reportTokens = {
  colors: {
    pageBg: 'transparent',
    pageBgBlob: 'var(--app-bg-blob1)',
    cardBg: 'var(--app-card-bg)',
    cardBgSoft: 'var(--app-card-bg-soft)',
    cardBgHighlight: 'var(--app-primary-muted)',
    border: 'var(--app-border)',
    borderLight: 'var(--app-border-light)',
    progressTrail: 'var(--app-progress-trail)',
    text: 'var(--app-text)',
    textSecondary: 'var(--app-text-secondary)',
    textMuted: 'var(--app-text-tertiary)',
    primary: 'var(--app-primary)',
    primaryHover: 'var(--app-primary-dark)',
    primaryDark: 'var(--app-primary-dark)',
    primaryMuted: 'var(--app-primary-muted)',
    success: 'var(--app-success)',
    successBg: 'var(--app-success-bg)',
    successBorder: 'var(--app-success-border)',
    warning: 'var(--app-warning)',
    warningBg: 'var(--app-warning-bg)',
    warningBorder: 'var(--app-warning-border)',
    danger: 'var(--app-error)',
    gold: 'var(--app-gold)',
    goldLight: 'var(--app-gold-light)',
    goldBorder: 'var(--app-gold-border)',
    heroGradient: 'var(--app-hero-gradient)',
    heroBlob: 'radial-gradient(ellipse 80% 50% at 50% -20%, var(--app-primary-muted), transparent)',
    glassBg: 'var(--app-glass-bg)',
    glassBorder: 'var(--app-glass-border)',
    cardBgStrategic: 'var(--app-primary-muted)',
    cardBgAnalytical: 'var(--app-card-bg-soft)',
  },
  radius: {
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    full: 9999,
  },
  /** Legacy: número único para borderRadius (equivale a radius.lg) */
  radiusLegacy: 16,
  shadow: {
    sm: 'var(--app-shadow-sm)',
    md: 'var(--app-shadow-md)',
    lg: 'var(--app-shadow-lg)',
    xl: 'var(--app-shadow-xl)',
    glow: 'var(--app-shadow-glow)',
  },
  /** Legacy: string única */
  shadowLegacy: 'var(--app-shadow-lg)',
  /** Legacy: sombra forte para cards */
  shadowStrong: 'var(--app-shadow-xl)',
  /** Legacy: número para radius grande (equivale a radius.xl) */
  radiusLarge: 24,
  spacing: {
    xs: 6,
    sm: 10,
    md: 16,
    lg: 20,
    xl: 20,
    section: 56,
  },
  typography: {
    hero: { fontSize: 26, fontWeight: 800, lineHeight: 1.2 },
    h1: { fontSize: 24, fontWeight: 700 },
    h2: { fontSize: 20, fontWeight: 700 },
    h3: { fontSize: 16, fontWeight: 600 },
    body: { fontSize: 14 },
    bodySmall: { fontSize: 13 },
    caption: { fontSize: 12 },
    overline: { fontSize: 11, fontWeight: 600, letterSpacing: '0.04em' },
  },
  layout: {
    maxWidth: 1080,
    contentPadding: 24,
    /** Padding horizontal em mobile para não colar nas bordas */
    contentPaddingMobile: 16,
  },
  animation: {
    fadeIn: 'reportFadeIn 0.35s ease',
    hoverTransition: 'transform 0.2s ease, box-shadow 0.2s ease',
  },
} as const

export type ReportTokens = typeof reportTokens
