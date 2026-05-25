/**
 * Rótulos e cores de patamar alinhados a `@repo/followersSizeBuckets` (mesmo arquivo que o crawl).
 * Chave de API: nano | micro | medio | macro | elite | celebridade (`mid` é alias legado de `medio`).
 */

import {
  FOLLOWERS_SIZE_BUCKETS,
  followersCountToSizeKey,
  type FollowersSizeBucketDef,
  type FollowersSizeKey,
} from '@repo/followersSizeBuckets'

export type InfluencerTierLabel = 'Nano' | 'Micro' | 'Mid' | 'Macro' | 'Elite' | 'Celeb' | '—'

/** Limiar de seguidores em forma curta (ex.: 10k, 200k, 1M) — chips do wizard e UI densa. */
export function formatFollowersBoundCompact(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0'
  if (n >= 1_000_000) {
    const m = n / 1_000_000
    const t = Number.isInteger(m) ? String(m) : m.toFixed(1).replace(/\.0$/, '')
    return `${t}M`
  }
  if (n >= 1_000) {
    const k = n / 1_000
    const t = Number.isInteger(k) ? String(k) : k.toFixed(1).replace(/\.0$/, '')
    return `${t}k`
  }
  return String(Math.round(n))
}

/** Faixa de patamar curta (ex.: `até 10k`, `200k – 1M`, `1M+`). */
export function formatPatamarRangeCompact(p: { min: number; max: number | undefined }): string {
  const f = formatFollowersBoundCompact
  if (p.max == null) return `${f(p.min)}+`
  if (p.min === 0) return `até ${f(p.max)}`
  return `${f(p.min)} – ${f(p.max)}`
}

function formatPatamarRange(b: FollowersSizeBucketDef): string {
  const fmt = (n: number) => n.toLocaleString('pt-BR')
  if (b.max == null) return `${fmt(b.min)}+`
  if (b.min === 0) return `até ${fmt(b.max)}`
  return `${fmt(b.min)} – ${fmt(b.max)}`
}

/** Chave API → rótulo curto na UI (Mid para `medio`). */
export function sizeKeyToShortTierLabel(key: FollowersSizeKey): InfluencerTierLabel {
  if (key === 'nano') return 'Nano'
  if (key === 'micro') return 'Micro'
  if (key === 'medio') return 'Mid'
  if (key === 'macro') return 'Macro'
  if (key === 'elite') return 'Elite'
  return 'Celeb'
}

export function getInfluencerTierShort(followers: number | undefined | null): InfluencerTierLabel {
  if (followers == null || !Number.isFinite(followers)) return '—'
  const key = followersCountToSizeKey(followers)
  return sizeKeyToShortTierLabel(key)
}

export function getInfluencerTierTooltip(followers: number | undefined | null): string | undefined {
  if (followers == null || !Number.isFinite(followers) || followers < 0) return undefined
  const key = followersCountToSizeKey(followers)
  const b = FOLLOWERS_SIZE_BUCKETS.find((x) => x.key === key)
  if (!b) return undefined
  const short = sizeKeyToShortTierLabel(key)
  return `${short} (${formatPatamarRange(b)} seg.)`
}

/** Título estilo detalhe (ex.: página do perfil / media kit). */
export function getInfluencerTierLongLabel(followers: number | undefined | null): string {
  const short = getInfluencerTierShort(followers)
  if (short === '—') return '—'
  if (short === 'Celeb' || short === 'Elite') return short
  return `${short} Influencer`
}

/** Chave de porte vinda da API (`size`, buckets de busca). */
export function sizeBucketKeyToTierLabel(key: string | undefined | null): InfluencerTierLabel {
  const k = String(key ?? '').trim().toLowerCase()
  if (k === 'mid') return 'Mid'
  if (k === 'subnano') return 'Nano'
  if (k === 'nano' || k === 'micro' || k === 'medio' || k === 'macro' || k === 'elite' || k === 'celebridade') {
    return sizeKeyToShortTierLabel(k as FollowersSizeKey)
  }
  return '—'
}

export function getInfluencerTierTooltipFromLabel(tier: InfluencerTierLabel): string | undefined {
  if (tier === '—') return undefined
  const keyMap: Record<Exclude<InfluencerTierLabel, '—'>, FollowersSizeKey> = {
    Nano: 'nano',
    Micro: 'micro',
    Mid: 'medio',
    Macro: 'macro',
    Elite: 'elite',
    Celeb: 'celebridade',
  }
  const b = FOLLOWERS_SIZE_BUCKETS.find((x) => x.key === keyMap[tier])
  if (!b) return undefined
  return `${tier} (${formatPatamarRange(b)} seg.)`
}

const TIER_SOLID_HEX: Record<Exclude<InfluencerTierLabel, '—'>, string> = {
  Nano: '#722ed1',
  Micro: '#1890ff',
  Mid: '#13c2c2',
  Macro: '#eb2f96',
  Elite: '#531dab',
  Celeb: '#d48806',
}

/** Cor sólida (tom base do gradiente do selo) para chaves de bucket da API. */
export function getInfluencerTierSolidHexForBucketKey(key: string | undefined | null): string | undefined {
  const tier = sizeBucketKeyToTierLabel(key)
  if (tier === '—') return undefined
  return TIER_SOLID_HEX[tier]
}

/** Mesma paleta, a partir do rótulo já resolvido (ex.: selo compacto alinhado a chips). */
export function getInfluencerTierSolidHexForTierLabel(tier: InfluencerTierLabel): string | undefined {
  if (tier === '—') return undefined
  return TIER_SOLID_HEX[tier]
}

/** Fundo do selo de patamar (igual à tabela de influenciadores da campanha). */
export function getInfluencerTierGradientCss(tier: InfluencerTierLabel): string {
  if (tier === 'Nano') return 'linear-gradient(90deg, #722ed1, #9254de)'
  if (tier === 'Micro') return 'linear-gradient(90deg, #1890ff, #40a9ff)'
  if (tier === 'Mid') return 'linear-gradient(90deg, #13c2c2, #36cfc9)'
  if (tier === 'Macro') return 'linear-gradient(90deg, #eb2f96, #f759ab)'
  if (tier === 'Elite') return 'linear-gradient(90deg, #391085, #b37feb)'
  if (tier === 'Celeb') return 'linear-gradient(90deg, #ad6800, #ffc53d)'
  return 'rgba(0,0,0,0.25)'
}
