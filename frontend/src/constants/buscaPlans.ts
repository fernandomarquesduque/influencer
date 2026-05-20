export const BUSCA_PLANS = [
  {
    id: 'basic',
    name: 'Plano Básico',
    badge: 'Essencial',
    tagline: 'Métricas, @ e contato na sua região',
    priceBrl: 49,
    credits: 49,
    featured: false,
    description:
      'Encontre criadores na sua região, compare com dados reais e contrate sem adivinhar preço nem perder tempo em DM.',
    features: [
      'Preço sugerido por formato de publicidade',
      'Desbloqueie o @ e o perfil completo do criador',
      'Engajamento, alcance e análise de conteúdo',
      'Filtre por cidade e contrate na sua região',
      'Contato facilitado quando o criador ativou WhatsApp',
      'Solicite contratação direto pela plataforma',
    ],
  },
  {
    id: 'advanced',
    name: 'Plano Avançado',
    badge: 'Recomendado',
    tagline: 'Negociação, qualificação e descontos exclusivos',
    priceBrl: 200,
    credits: 200,
    featured: true,
    description:
      'Tudo do Plano Básico. Nossa equipe qualifica os criadores ideais para sua campanha, negocia em seu nome e busca condições exclusivas — você só aprova.',
    features: [
      'Tudo do Plano Básico incluído',
      'Qualificação dos influenciadores para o seu job',
      'Negociação completa feita pela nossa equipe',
      'Descontos exclusivos nas contratações',
      'Gestão da campanha até o pagamento ao criador',
    ],
  },
] as const

export type BuscaPlanId = (typeof BUSCA_PLANS)[number]['id']

export function getBuscaPlanById(planId: string | undefined) {
  if (!planId) return null
  return BUSCA_PLANS.find((p) => p.id === planId) ?? null
}
