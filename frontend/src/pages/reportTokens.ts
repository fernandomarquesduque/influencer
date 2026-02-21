/**
 * Design system local do relatório — paleta premium, leve (Notion + Stripe + Linear).
 * Uso: cores, radius, sombras, tipografia, espaçamento.
 */
export const reportTokens = {
  colors: {
    pageBg: '#f2f6f2',
    pageBgBlob: 'rgba(99, 102, 241, 0.04)',
    cardBg: '#ffffff',
    cardBgSoft: '#fafbfc',
    cardBgHighlight: 'rgba(99, 102, 241, 0.04)',
    border: 'rgba(0,0,0,0.06)',
    borderLight: 'rgba(0,0,0,0.04)',
    text: '#1e293b',
    textSecondary: '#64748b',
    textMuted: '#94a3b8',
    primary: '#6366f1',
    primaryHover: '#4f46e5',
    primaryDark: '#4f46e5',
    primaryMuted: 'rgba(99, 102, 241, 0.12)',
    success: '#10b981',
    successBg: 'rgba(16, 185, 129, 0.08)',
    successBorder: 'rgba(16, 185, 129, 0.35)',
    warning: '#f59e0b',
    warningBg: 'rgba(245, 158, 11, 0.08)',
    warningBorder: 'rgba(245, 158, 11, 0.35)',
    danger: '#ef4444',
    /** Premium / valor (acento dourado suave) */
    gold: '#d4a853',
    goldLight: 'rgba(212, 168, 83, 0.14)',
    goldBorder: 'rgba(212, 168, 83, 0.35)',
    /** Hero */
    heroGradient: 'linear-gradient(135deg, #eef2ff 0%, #f5f3ff 40%, #fefce8 100%)',
    heroBlob: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(99, 102, 241, 0.12), transparent)',
    /** Glass */
    glassBg: 'rgba(255,255,255,0.72)',
    glassBorder: 'rgba(255,255,255,0.9)',
    /** Legacy (aliases) */
    cardBgStrategic: '#f0f4ff',
    cardBgAnalytical: '#f8fafc',
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
    sm: '0 1px 2px rgba(0,0,0,0.04)',
    md: '0 4px 12px rgba(0,0,0,0.05)',
    lg: '0 10px 30px rgba(0,0,0,0.06)',
    xl: '0 20px 40px rgba(0,0,0,0.08)',
    glow: '0 0 0 1px rgba(99, 102, 241, 0.1)',
  },
  /** Legacy: string única */
  shadowLegacy: '0 10px 30px rgba(0,0,0,.06)',
  /** Legacy: sombra forte para cards */
  shadowStrong: '0 10px 30px rgba(0,0,0,0.08)',
  /** Legacy: número para radius grande (equivale a radius.xl) */
  radiusLarge: 24,
  spacing: {
    xs: 6,
    sm: 10,
    md: 16,
    lg: 24,
    xl: 32,
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
