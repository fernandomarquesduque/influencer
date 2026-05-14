export const BUSCA_PLANS = {
  basic: {
    id: 'basic',
    name: 'Plano Básico',
    priceBrl: 49,
    credits: 49,
  },
  advanced: {
    id: 'advanced',
    name: 'Plano Avançado',
    priceBrl: 200,
    credits: 200,
  },
} as const

export type BuscaPlanId = keyof typeof BUSCA_PLANS

export function getBuscaPlanById(planId: string | undefined) {
  if (!planId) return null
  const p = BUSCA_PLANS[planId as BuscaPlanId]
  return p ?? null
}
