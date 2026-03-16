/**
 * Faixas de preço para categorização (valores = mínimo da faixa em reais, para filtro no banco).
 * Começam abaixo de R$ 100 para ser acessível a nano/micro influenciadores.
 */
export const PRICE_BUCKETS = [
  { value: 0, label: 'Até R$ 100' },
  { value: 50, label: 'R$ 50 – R$ 100' },
  { value: 100, label: 'R$ 100 – R$ 250' },
  { value: 250, label: 'R$ 250 – R$ 500' },
  { value: 500, label: 'R$ 500 – R$ 1.000' },
  { value: 1000, label: 'R$ 1.000 – R$ 2.500' },
  { value: 2500, label: 'R$ 2.500 – R$ 5.000' },
  { value: 5000, label: 'R$ 5.000 – R$ 15.000' },
  { value: 15000, label: 'Acima de R$ 15.000' },
] as const

export type PriceBucketValue = (typeof PRICE_BUCKETS)[number]['value']

export const PRICING_FIELD_KEYS = ['feed', 'reels', 'story', 'destaque'] as const

export type PricingFieldKey = (typeof PRICING_FIELD_KEYS)[number]

/** Títulos curtos e didáticos para o influenciador. */
export const PRICING_FIELD_LABELS: Record<PricingFieldKey, string> = {
  feed: 'Valor por Feed',
  reels: 'Valor por Reels',
  story: 'Valor por story',
  destaque: 'Valor por Destaque',
}

/** Descrições didáticas: o que é o formato e o que a faixa de valor representa. */
export const PRICING_FIELD_DESCRIPTIONS: Record<PricingFieldKey, string> = {
  feed: 'Um único post no feed (foto ou vídeo) que fica permanente. A faixa indica quanto você cobra por um post desse tipo.',
  reels: 'Vídeo curto (Reels) no feed. A faixa indica quanto você cobra por um reel.',
  story: 'Conteúdo em stories que some em 24h. A faixa indica quanto você cobra por story.',
  destaque: 'Conteúdo que fica nos destaques do perfil. A faixa indica quanto você cobra por destaque.',
}

/**
 * Multiplicador em relação ao "feed" (base = 1).
 */
export const FORMAT_MULTIPLIER: Record<PricingFieldKey, number> = {
  feed: 1,
  reels: 1.2,
  story: 0.25,
  destaque: 0.5,
}

/** Valor base sugerido por post (em reais) a partir de seguidores. Conservador, começa baixo. */
function getBaseValueFromFollowers(followers: number): number {
  if (followers < 500) return 30
  if (followers < 2000) return 50
  if (followers < 5000) return 80
  if (followers < 10000) return 150
  if (followers < 25000) return 250
  if (followers < 50000) return 400
  if (followers < 100000) return 700
  if (followers < 500000) return 1500
  return 4000
}

/** Retorna o value do bucket cuja faixa contém o valor em reais (maior mínimo <= reais). */
function valueToBucketValue(reais: number): PriceBucketValue {
  const values = PRICE_BUCKETS.map((b) => b.value).sort((a, b) => b - a)
  for (const v of values) {
    if (v <= reais) return v as PriceBucketValue
  }
  return PRICE_BUCKETS[0].value
}

/**
 * Sugere faixas de preço por formato com base no número de seguidores do perfil.
 * Valores começam baixos (até R$ 100) para perfis pequenos.
 */
export function getSuggestedPricingFromFollowers(
  followersCount: number
): Partial<Record<PricingFieldKey, number>> {
  const base = getBaseValueFromFollowers(Math.max(0, followersCount))
  const result: Partial<Record<PricingFieldKey, number>> = {}
  for (const key of PRICING_FIELD_KEYS) {
    const mult = FORMAT_MULTIPLIER[key]
    const value = Math.round(base * mult)
    result[key] = valueToBucketValue(Math.max(0, value))
  }
  return result
}

/** Faixa de preço (min/max/sugerido) em reais para o feed, baseada no tamanho do perfil. */
export function getPricingRangeFromFollowers(followersCount: number): {
  min: number
  max: number
  suggestedFeed: number
} {
  const base = getBaseValueFromFollowers(Math.max(0, followersCount))
  const min = Math.max(0, Math.floor(base * 0.4))
  const max = Math.min(15000, Math.ceil(base * 2.5))
  return {
    min: min < 50 ? 0 : min,
    max: Math.max(100, max),
    suggestedFeed: base,
  }
}
