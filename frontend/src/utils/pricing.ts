import type { PricingData } from '../api'
import { PRICING_FIELD_KEYS } from '../constants/pricingBuckets'

export type CostTier = 'low' | 'medium' | 'high' | 'very_high'

const COST_TIERS: { tier: CostTier; symbol: string; label: string; minAvg: number }[] = [
  { tier: 'low', symbol: '$', label: ' baixo', minAvg: 0 },
  { tier: 'medium', symbol: '$$', label: 'médio', minAvg: 500 },
  { tier: 'high', symbol: '$$$', label: 'alto', minAvg: 2500 },
  { tier: 'very_high', symbol: '💎', label: 'muito alto', minAvg: 5000 },
]

/**
 * Calcula o custo médio do influenciador a partir das faixas de preço preenchidas (ativação).
 * Retorna o símbolo e a label (ex.: "$$", "médio") ou null se não houver dados.
 */
export function getCostTier(pricing: PricingData | undefined | null): { symbol: string; label: string; tier: CostTier } | null {
  if (!pricing || typeof pricing !== 'object') return null
  const values: number[] = []
  for (const key of PRICING_FIELD_KEYS) {
    const v = pricing[key as keyof PricingData]
    if (v === undefined || v === null || v === '') continue
    const n = typeof v === 'number' ? v : Number(v)
    if (Number.isFinite(n)) values.push(n)
  }
  if (values.length === 0) return null
  const avg = values.reduce((a, b) => a + b, 0) / values.length
  for (let i = COST_TIERS.length - 1; i >= 0; i--) {
    if (avg >= COST_TIERS[i]!.minAvg) {
      const t = COST_TIERS[i]!
      return { symbol: t.symbol, label: t.label, tier: t.tier }
    }
  }
  const t = COST_TIERS[0]!
  return { symbol: t.symbol, label: t.label, tier: t.tier }
}
