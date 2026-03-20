/** Patamar por seguidores — mesmos cortes da listagem de campanha (Nano / Micro / Mid / Macro). */

export type InfluencerTierLabel = 'Nano' | 'Micro' | 'Mid' | 'Macro' | '—'

export function getInfluencerTierShort(followers: number | undefined | null): InfluencerTierLabel {
  if (followers == null || !Number.isFinite(followers)) return '—'
  if (followers < 10_000) return 'Nano'
  if (followers < 50_000) return 'Micro'
  if (followers < 500_000) return 'Mid'
  return 'Macro'
}

export function getInfluencerTierTooltip(followers: number | undefined | null): string | undefined {
  if (followers == null || !Number.isFinite(followers) || followers < 0) return undefined
  if (followers < 10_000) return 'Nano (até 10k seg.)'
  if (followers < 50_000) return 'Micro (10k–50k)'
  if (followers < 500_000) return 'Mid (50k–500k)'
  return 'Macro (500k+)'
}

/** Fundo do selo de patamar (igual à tabela de influenciadores da campanha). */
export function getInfluencerTierGradientCss(tier: InfluencerTierLabel): string {
  if (tier === 'Nano') return 'linear-gradient(90deg, #722ed1, #9254de)'
  if (tier === 'Micro') return 'linear-gradient(90deg, #1890ff, #40a9ff)'
  if (tier === 'Mid') return 'linear-gradient(90deg, #13c2c2, #36cfc9)'
  if (tier === 'Macro') return 'linear-gradient(90deg, #eb2f96, #f759ab)'
  return 'rgba(0,0,0,0.25)'
}
