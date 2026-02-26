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

export const PRICING_FIELD_KEYS = [
  'post_unique',
  'stories',
  'package_monthly',
  'commission',
  'permuta',
  'image_rights',
  'content_delivery',
  'launch',
] as const

export type PricingFieldKey = (typeof PRICING_FIELD_KEYS)[number]

/** Títulos curtos e didáticos para o influenciador. */
export const PRICING_FIELD_LABELS: Record<PricingFieldKey, string> = {
  post_unique: '1️⃣ Post no feed',
  stories: '2️⃣ Stories',
  package_monthly: '3️⃣ Pacote mensal',
  commission: '4️⃣ Comissão / afiliado',
  permuta: '5️⃣ Permuta',
  image_rights: '6️⃣ Uso da sua imagem',
  content_delivery: '7️⃣ Entrega de conteúdo (sem postar)',
  launch: '8️⃣ Lançamento / campanha',
}

/** Descrições didáticas: o que é o formato e o que a faixa de valor representa. */
export const PRICING_FIELD_DESCRIPTIONS: Record<PricingFieldKey, string> = {
  post_unique:
    'Um único post no feed (foto ou vídeo) que fica permanente. A faixa indica quanto você cobra por um post desse tipo.',
  stories:
    'Conteúdo em stories que some em 24h (divulgação rápida, bastidores, enquetes). A faixa indica quanto você cobra por story.',
  package_monthly:
    'Pacote com no mínimo 10 posts ou stories por mês. A faixa indica quanto você cobra por mês por esse pacote.',
  commission:
    'Parceria em que você ganha por venda (link, cupom). A faixa é o valor mínimo do negócio em que você aceita esse tipo de parceria.',
  permuta:
    'Troca por produto ou serviço, sem dinheiro. A faixa indica o valor equivalente do que você costuma aceitar em troca (ex.: produto de até R$ 500).',
  image_rights:
    'Marca usa sua foto/vídeo em site, anúncio ou embalagem (você não posta). A faixa indica quanto você cobra pelos direitos de uso.',
  content_delivery:
    'Você produz o conteúdo e entrega para a marca publicar no canal dela (não aparece no seu feed). A faixa indica quanto você cobra pela entrega.',
  launch:
    'Campanha com vários formatos em período curto (lançamento, data especial). A faixa indica quanto você cobra pelo conjunto da campanha.',
}

/**
 * Multiplicador em relação ao "post no feed" (base = 1 post).
 * Garante que cada sugestão esteja de acordo com a regra/descrição do formato.
 */
const FORMAT_MULTIPLIER: Record<PricingFieldKey, number> = {
  post_unique: 1, // 1 post = base
  stories: 0.25, // 1 story = 1/4 do valor de 1 post
  package_monthly: 10, // 10 posts por mês = 10x o valor de 1 post
  commission: 1, // valor mínimo do negócio = pelo menos o valor de 1 post
  permuta: 0.8, // valor equivalente em produto/serviço (em geral um pouco abaixo do post)
  image_rights: 0.5, // direitos de uso (uso em outros canais) ≈ metade do post
  content_delivery: 0.6, // entrega sem postar ≈ 60% do valor de 1 post
  launch: 3, // campanha (vários formatos) ≈ 3x o valor de 1 post
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
