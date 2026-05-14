export const BUSCA_PLANS = [
  {
    id: 'basic',
    name: 'Plano Básico',
    priceBrl: 49,
    credits: 49,
    featured: false,
    description:
      'Acesso às informações avançadas do influenciador: métricas, análise de conteúdo e dados estratégicos para decidir com segurança.',
    features: ['Perfil completo desbloqueado', 'Dados avançados e insights do criador'],
  },
  {
    id: 'advanced',
    name: 'Plano Avançado',
    priceBrl: 200,
    credits: 200,
    featured: true,
    description:
      'Tudo do plano básico, mais consultoria personalizada da nossa equipe para encontrar e contratar o criador certo.',
    features: ['Consultoria dedicada à sua marca', 'Gestão completa da contratação'],
  },
] as const

export type BuscaPlanId = (typeof BUSCA_PLANS)[number]['id']

export function getBuscaPlanById(planId: string | undefined) {
  if (!planId) return null
  return BUSCA_PLANS.find((p) => p.id === planId) ?? null
}
