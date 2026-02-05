/**
 * Faixas de preço para categorização (valores = mínimo da faixa em reais, para filtro no banco).
 */
export const PRICE_BUCKETS = [
  { value: 0, label: 'Até R$ 500' },
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

export const PRICING_FIELD_LABELS: Record<PricingFieldKey, string> = {
  post_unique: '1️⃣ Post único (publipost)',
  stories: '2️⃣ Stories',
  package_monthly: '3️⃣ Pacote mensal',
  commission: '4️⃣ Comissão / afiliado',
  permuta: '5️⃣ Permuta',
  image_rights: '6️⃣ Uso de imagem (direitos)',
  content_delivery: '7️⃣ Entrega de conteúdo (sem postar)',
  launch: '8️⃣ Lançamento / campanha',
}
