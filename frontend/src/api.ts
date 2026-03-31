import type { FollowersSizeKey } from '@repo/followersSizeBuckets'

/** Em produção sob subpasta (ex.: /influencer) use VITE_API_BASE=/influencer/api */
const API_BASE = (import.meta.env.VITE_API_BASE as string) || '/api'

/** Token JWT definido pelo AuthContext após login. Usado em todas as requisições autenticadas. */
let authToken: string | null = null
export function setAuthToken(token: string | null): void {
  authToken = token
}

export function authHeaders(): Record<string, string> {
  return authToken ? { Authorization: `Bearer ${authToken}` } : {}
}

/** Header obrigatório no backend para acessar dados de perfil de outro influenciador (em contexto de campanha). */
const X_CAMPAIGN_ID = 'X-Campaign-Id'

/** Headers de auth com opcional X-Campaign-Id (para rotas que exigem campanha quando não é o próprio perfil). */
export function authHeadersWithCampaign(campaignId?: string | null): Record<string, string> {
  const h: Record<string, string> = { ...authHeaders() }
  if (campaignId && campaignId.trim()) h[X_CAMPAIGN_ID] = campaignId.trim()
  return h
}

/** Usa proxy da API para carregar imagem (evita CORS/CORP do CDN do Instagram). Em caso de 403, o backend tenta fallback via proxy público. */
export function proxyImageUrl(url: string | undefined): string | undefined {
  if (!url || typeof url !== 'string') return undefined
  return `${API_BASE}/proxy-image?url=${encodeURIComponent(url)}`
}

/** Instagram/fbcdn → proxy da API; URLs públicas (ex.: S3) sem proxy. */
export function proxyImageUrlForDisplay(url: string | undefined): string | undefined {
  if (!url || typeof url !== 'string') return undefined
  const lower = url.toLowerCase()
  if (
    lower.includes('instagram.') ||
    lower.includes('fbcdn.net') ||
    lower.includes('cdninstagram')
  ) {
    return proxyImageUrl(url)
  }
  return url
}

export interface ProfileItem {
  key: string
  handle?: string
  username?: string
  full_name?: string
  profile_pic_url?: string
  hd_profile_pic_url?: string
  followers_count?: number
  media_count?: number
  following_count?: number
  media_count_visible?: number
  biography?: string
  categories?: string[]
  is_verified?: boolean
  is_private?: boolean
  data?: { user?: Record<string, unknown> }
  /** Seguidores em comum com o viewer (quando disponível). */
  mutual_followers_count?: number
  /** Total de reels/clips. */
  total_clips_count?: number
  /** Categoria do perfil (ex.: conta profissional). */
  category?: string
  category_name?: string
  business_category_name?: string
  overall_category_name?: string
  is_business_account?: boolean
  is_professional_account?: boolean
  /** 1=pessoal, 2=criador, 3=empresa */
  account_type?: number
  /** Links da bio. */
  bio_links?: Array<{ title?: string; url?: string }>
  pronouns?: string[]
  has_chaining?: boolean
  text_post_app_badge_label?: string
  has_clips?: boolean
  has_story_archive?: boolean
  highlight_reel_count?: number
  address_street?: string
  city_name?: string
  zip?: string
  /** URL pública estável (ex.: S3) quando configurado na extração. */
  stable_profile_pic_url?: string
  [key: string]: unknown
}

/** Extrai URL da foto do perfil (lista e detalhe). Aceita qualquer objeto com profile_pic_url/data.user. */
export function getProfilePicUrl(item: ProfileItem | Record<string, unknown> | null | undefined): string | undefined {
  if (!item) return undefined
  const top = (item.profile_pic_url ?? item.hd_profile_pic_url) as string | undefined
  if (top && typeof top === 'string') return top
  const data = (item as Record<string, unknown>).data
  const u = (data && typeof data === 'object' && 'user' in data)
    ? (data as { user?: Record<string, unknown> }).user
    : undefined
  const fromUser = (u?.profile_pic_url ?? u?.hd_profile_pic_url) as string | undefined
  if (fromUser && typeof fromUser === 'string') return fromUser
  const hdInfo = u?.hd_profile_pic_url_info
  if (hdInfo != null && typeof hdInfo === 'object' && 'url' in (hdInfo as object)) {
    const url = (hdInfo as { url?: string }).url
    if (url && typeof url === 'string') return url
  }
  return undefined
}

/** URL da foto estável (S3) — não passa pelo proxy da API. */
export function getStableProfilePicUrl(item: ProfileItem | Record<string, unknown> | null | undefined): string | undefined {
  if (!item) return undefined
  const top = (item as Record<string, unknown>).stable_profile_pic_url
  if (typeof top === 'string' && top.startsWith('http')) return top
  const data = (item as Record<string, unknown>).data
  const u =
    data && typeof data === 'object' && 'user' in data
      ? (data as { user?: Record<string, unknown> }).user?.stable_profile_pic_url
      : undefined
  if (typeof u === 'string' && u.startsWith('http')) return u
  return undefined
}

/**
 * URL da camada de fundo atrás da capa no card (mesmo `cover` / object-fit).
 * Prioriza a mídia do próprio post (`stable_cover_url`, capa, vídeo, `image_url`);
 * só usa a foto estável do perfil quando não há imagem do post (ex.: URL do IG expirada e sem S3).
 */
export function getPostStablePreviewUrl(post: unknown): string | undefined {
  const raw = getPostCoverRawUrl(post as PostItem)
  if (raw) return raw
  const p = post as { influencer?: { stable_profile_pic_url?: string } } | null | undefined
  const u = p?.influencer?.stable_profile_pic_url
  return typeof u === 'string' && u.startsWith('http') ? u : undefined
}

export interface ProfilesResponse {
  total: number
  items: ProfileItem[]
}

/** Engajamento calculado a partir dos posts do perfil. */
export interface EngagementStats {
  posts_count: number
  total_likes: number
  total_comments: number
  total_views: number
  avg_likes: number
  avg_comments: number
  avg_views: number
  engagement_rate: number
  /** ER por alcance: (likes+comments)/views × 100 quando há views (relevante para reels). */
  engagement_rate_by_views?: number
  /** Média de posts por semana (baseado no intervalo de datas dos posts analisados). */
  posts_per_week?: number
  /** ER do post com maior (likes+comments)/seguidores — evita confusão quando ER médio > 100%. */
  engagement_rate_max_viral?: number
  /** Nota quando ER médio > 100%: explica viralização. */
  engagement_rate_note?: string
  /** Número de posts que têm view_count > 0 (reels/vídeos). Usado no CPM para não diluir views pelo total de posts. */
  posts_with_views_count?: number
}

/** Item da listagem com filtros (endpoint /api/profiles/search). */
export interface ProfileListItem {
  key: string
  handle: string
  full_name?: string
  profile_pic_url?: string
  stable_profile_pic_url?: string
  followers_count: number
  following_count?: number
  media_count?: number
  biography?: string
  categories?: string[]
  engagement: EngagementStats
  /** Dados de ativação na plataforma, quando existir. */
  activation?: ProfileActivation
  data?: Record<string, unknown>
  [key: string]: unknown
}

export type ProfilesSort =
  | 'relevance_desc'
  | 'name_asc'
  | 'name_desc'
  | 'engagement_desc'
  | 'engagement_asc'
  | 'followers_desc'
  | 'followers_asc'
  | 'posts_count_desc'
  | 'posts_count_asc'
  | 'avg_likes_desc'
  | 'avg_likes_asc'
  | 'total_likes_desc'
  | 'total_likes_asc'
  | 'total_comments_desc'
  | 'total_comments_asc'
  | 'cost_tier_desc'
  | 'cost_tier_asc'
  | 'favorite_desc'
  | 'favorite_asc'

/** Tipo de mídia no índice (feed, reels, marcados, destaques). */
export type MediaKind = 'post' | 'reel' | 'tagged' | 'highlight'

export interface ProfilesSearchQuery {
  q?: string
  minFollowers?: number
  maxFollowers?: number
  minEngagementRate?: number
  minAvgLikes?: number
  minPostsCount?: number
  /** Faixas engajamento %: 0=baixa, 1=média, 5=alta */
  engagementRateBuckets?: number[]
  /** Faixas média likes: 0, 500, 5000 */
  avgLikesBuckets?: number[]
  /** Faixas posts: 0, 25, 50 */
  postsCountBuckets?: number[]
  /** 'activated' | 'not_activated' */
  activationFilter?: string[]
  cities?: string[]
  states?: string[]
  neighborhoods?: string[]
  socialNetworks?: string[]
  categories?: string | string[]
  /** Excluir perfis privados. */
  excludePrivate?: boolean
  /** Tipo de conta (1=pessoal, 2=criador, 3=empresa). */
  accountTypeFilter?: number[]
  /** Tipo de conteúdo (perfis ativados). */
  contentTypes?: string[]
  /** Galeria Origem (posts): filtrar por tipo de mídia no índice (feed, reels, marcados, destaques). */
  originMediaKinds?: MediaKind[]
  /** Faixas de preço por formato (valores em reais: 0, 50, 100, 250, 500, 1000, 2500, 5000, 15000). */
  pricingFeed?: number[]
  pricingReels?: number[]
  pricingStory?: number[]
  pricingDestaque?: number[]
  /** Faixa de preço: low = abaixo da média, medium = normal, high/very_high = acima da média. */
  costTierFilter?: string[]
  /** Tamanho: nano, micro, medio (ou mid), macro, elite, celebridade. */
  sizeFilter?: string[]
  /** Filtros sobre classificação LLM (`llm.qualification`); multiselect = OR no mesmo campo. */
  llmProfileType?: string[]
  llmMainCategory?: string[]
  llmGender?: string[]
  llmLanguage?: string[]
  llmSubCategories?: string[]
  llmContentPillars?: string[]
  llmAudienceType?: string[]
  llmToneOfVoice?: string[]
  llmRiskLevel?: string[]
  llmIsFamilySafe?: boolean
  llmIsAdultContent?: boolean
  sort?: ProfilesSort
  limit?: number
  offset?: number
}

/** Bucket de facet (ex.: engajamento baixa/média/alta). */
export interface FacetBucket {
  key: string
  label: string
  min?: number
  count: number
}

/** Faixa de preço na sumarização (valor em reais + contagem). */
export interface PricingFacetBucket {
  value: number
  count: number
}

/** Agregações de `llm.qualification` (classificação qualify). */
export interface LlmSearchFacets {
  profileType: { name: string; count: number }[]
  mainCategory: { name: string; count: number }[]
  gender: { name: string; count: number }[]
  language: { name: string; count: number }[]
  subCategories: { name: string; count: number }[]
  contentPillars: { name: string; count: number }[]
  audienceType: { name: string; count: number }[]
  toneOfVoice: { name: string; count: number }[]
  /** Categoria única do prompt: familia | sensivel | adulto. */
  brandSafety: {
    level: { name: string; count: number }[]
  }
}

/** Sumarização dos resultados para filtros (hashtags, engajamento, ativação, tipo de conteúdo, faixas de preço). */
export interface ProfilesSearchFacets {
  /** Hashtags/categorias. */
  categories: { name: string; count: number }[]
  engagement_rate: FacetBucket[]
  avg_likes: FacetBucket[]
  posts_count: FacetBucket[]
  activation: { activated: number; not_activated: number }
  /** Tipo de conteúdo (perfis ativados). */
  content_type: { name: string; count: number }[]
  cities: { name: string; count: number }[]
  states: { name: string; count: number }[]
  neighborhoods: { name: string; count: number }[]
  social: { whatsapp: number; tiktok: number; facebook: number; linkedin: number; twitter: number }
  /** Contagem por faixa de seguidores (porte). */
  followers_buckets?: { key: string; label: string; min: number; max?: number; count: number }[]
  /** Contagem por tipo de conta (1=pessoal, 2=criador, 3=empresa). */
  account_type?: { value: number; label: string; count: number }[]
  /** Faixas de preço por formato (resultado da sumarização). */
  pricing?: {
    feed?: PricingFacetBucket[]
    reels?: PricingFacetBucket[]
    story?: PricingFacetBucket[]
    destaque?: PricingFacetBucket[]
  }
  /** Faixa de preço (low, medium, high, very_high); só entradas com count > 0. */
  cost_tier?: { tier: string; count: number }[]
  /** Contagem por tamanho (UI pode usar `mid` no lugar de `medio`). */
  size_buckets?: { key: string; label: string; count: number }[]
  llm?: LlmSearchFacets
}

export interface ProfilesSearchResponse {
  total: number
  /** Na busca pública/anônima o backend pode omitir `items` (só total + facets). */
  items?: ProfileListItem[]
  facets?: ProfilesSearchFacets
  /** Quando a campanha tem pagamento pendente: valor e stats calculados com base nos filtros (sem retornar items). */
  pricePreview?: {
    amountCents: number
    valueBrl: number
    activatedCount: number
    notActivatedCount: number
    totalLikes?: number
    totalComments?: number
    totalViews?: number
    totalFollowers?: number
    postsCount?: number
    avgEngagementRate?: number
    /** Valor sem desconto (antes de abater perfis já em outros relatórios pagos). */
    originalAmountCents?: number
    originalValueBrl?: number
    /** Quantidade de perfis que já estavam em outro relatório pago (cobrança zerada para eles). */
    alreadyOwnedCount?: number
    /** Perfis que ainda entram na cobrança (novos para o cliente). */
    billableProfileCount?: number
    chargedActivatedCount?: number
    chargedNotActivatedCount?: number
  }
}

/** Resposta normalizada de `fetchProfilesSearch` (sempre inclui `items`, possivelmente vazio). */
export type ProfilesSearchResult = Omit<ProfilesSearchResponse, 'items'> & { items: ProfileListItem[] }

export interface ProfilePreviewItem {
  firstName: string
  profilePicUrl: string
  llmDescription: string
  size: FollowersSizeKey
  category: string
  audience: string
  collectedAt: string | null
  followersCount: number
  engagementRate: number
  totalLikes: number
  totalComments: number
  postsCount: number
}

export interface ProfilesPreviewResponse {
  total: number
  items: ProfilePreviewItem[]
}

/** Serializa filtros de busca para query string (busca pública, campanha, admin). */
export function profilesSearchQueryToParams(query: Partial<ProfilesSearchQuery>): URLSearchParams {
  const params = new URLSearchParams()
  if (query.q) params.set('q', query.q)
  if (query.minFollowers != null) params.set('minFollowers', String(query.minFollowers))
  if (query.maxFollowers != null) params.set('maxFollowers', String(query.maxFollowers))
  if (query.minEngagementRate != null) params.set('minEngagementRate', String(query.minEngagementRate))
  if (query.minAvgLikes != null) params.set('minAvgLikes', String(query.minAvgLikes))
  if (query.minPostsCount != null) params.set('minPostsCount', String(query.minPostsCount))
  if (query.engagementRateBuckets?.length) params.set('engagementRateBuckets', query.engagementRateBuckets.join(','))
  if (query.avgLikesBuckets?.length) params.set('avgLikesBuckets', query.avgLikesBuckets.join(','))
  if (query.postsCountBuckets?.length) params.set('postsCountBuckets', query.postsCountBuckets.join(','))
  if (query.activationFilter?.length) params.set('activationFilter', query.activationFilter.join(','))
  if (query.cities?.length) params.set('cities', query.cities.join(','))
  if (query.states?.length) params.set('states', query.states.join(','))
  if (query.neighborhoods?.length) params.set('neighborhoods', query.neighborhoods.join(','))
  if (query.socialNetworks?.length) params.set('socialNetworks', query.socialNetworks.join(','))
  if (query.categories != null) {
    params.set('categories', Array.isArray(query.categories) ? query.categories.join(',') : String(query.categories))
  }
  if (query.excludePrivate) params.set('excludePrivate', 'true')
  if (query.accountTypeFilter?.length) params.set('accountTypeFilter', query.accountTypeFilter.join(','))
  if (query.costTierFilter?.length) params.set('costTierFilter', query.costTierFilter.join(','))
  if (query.sizeFilter?.length) params.set('sizeFilter', query.sizeFilter.join(','))
  if (query.contentTypes?.length) params.set('contentTypes', query.contentTypes.join(','))
  if (query.pricingFeed?.length) params.set('pricingFeed', query.pricingFeed.join(','))
  if (query.pricingReels?.length) params.set('pricingReels', query.pricingReels.join(','))
  if (query.pricingStory?.length) params.set('pricingStory', query.pricingStory.join(','))
  if (query.pricingDestaque?.length) params.set('pricingDestaque', query.pricingDestaque.join(','))
  if (query.sort) params.set('sort', query.sort)
  if (query.limit != null) params.set('limit', String(query.limit))
  if (query.offset != null) params.set('offset', String(query.offset))
  const llmJoin = (key: string, arr?: string[]) => {
    if (arr?.length) params.set(key, arr.join(','))
  }
  llmJoin('llmProfileType', query.llmProfileType)
  llmJoin('llmMainCategory', query.llmMainCategory)
  llmJoin('llmGender', query.llmGender)
  llmJoin('llmLanguage', query.llmLanguage)
  llmJoin('llmSubCategories', query.llmSubCategories)
  llmJoin('llmContentPillars', query.llmContentPillars)
  llmJoin('llmAudienceType', query.llmAudienceType)
  llmJoin('llmToneOfVoice', query.llmToneOfVoice)
  llmJoin('llmRiskLevel', query.llmRiskLevel)
  if (query.llmIsFamilySafe === true) params.set('llmFamilySafe', '1')
  if (query.llmIsFamilySafe === false) params.set('llmFamilySafe', '0')
  if (query.llmIsAdultContent === true) params.set('llmAdultContent', '1')
  if (query.llmIsAdultContent === false) params.set('llmAdultContent', '0')
  return params
}

export async function fetchProfilesSearch(
  query: ProfilesSearchQuery,
  options?: { signal?: AbortSignal; campaignId?: string | null }
): Promise<ProfilesSearchResult> {
  const params = profilesSearchQueryToParams(query)
  const res = await fetch(`${API_BASE}/profiles/search?${params.toString()}`, {
    headers: authHeadersWithCampaign(options?.campaignId),
    signal: options?.signal,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    const code = (err as { code?: string }).code
    const msg = (err as { error?: string }).error || 'Falha ao buscar perfis'
    const e = new Error(msg) as Error & { code?: string }
    e.code = code
    throw e
  }
  const data = (await res.json()) as ProfilesSearchResponse
  return { ...data, items: data.items ?? [] }
}

export async function fetchProfilesPreview(
  query: ProfilesSearchQuery,
  options?: { signal?: AbortSignal; limit?: number }
): Promise<ProfilesPreviewResponse> {
  const res = await fetch(`${API_BASE}/profiles/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ query, limit: options?.limit ?? 10 }),
    signal: options?.signal,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || 'Falha ao carregar preview de perfis')
  }
  const data = (await res.json()) as Partial<ProfilesPreviewResponse>
  return {
    total: Number(data.total ?? 0),
    items: Array.isArray(data.items) ? data.items as ProfilePreviewItem[] : [],
  }
}

/** Saldo de créditos do usuário autenticado. */
export interface CreditsResponse {
  balance: number
}

export async function fetchCredits(options?: { signal?: AbortSignal }): Promise<CreditsResponse> {
  const res = await fetch(`${API_BASE}/me/credits`, {
    headers: { ...authHeaders() },
    signal: options?.signal,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || 'Falha ao carregar créditos')
  }
  return res.json()
}

/** Pagamento (comprar créditos). */
export interface PaymentItem {
  id: string
  asaasPaymentId: string | null
  amountCents: number
  creditsGranted: number
  status: string
  billingType: string
  invoiceUrl: string | null
  bankSlipUrl: string | null
  pixCopyPaste: string | null
  createdAt: string
  updatedAt: string
}

export interface MyPaymentsResponse {
  payments: PaymentItem[]
}

export async function fetchMyPayments(options?: { limit?: number; offset?: number; signal?: AbortSignal }): Promise<MyPaymentsResponse> {
  const params = new URLSearchParams()
  if (options?.limit != null) params.set('limit', String(options.limit))
  if (options?.offset != null) params.set('offset', String(options.offset))
  const qs = params.toString()
  const res = await fetch(`${API_BASE}/me/payments${qs ? `?${qs}` : ''}`, {
    headers: { ...authHeaders() },
    signal: options?.signal,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || 'Falha ao carregar pagamentos')
  }
  return res.json()
}

export async function fetchPayment(id: string, options?: { signal?: AbortSignal }): Promise<PaymentItem> {
  const res = await fetch(`${API_BASE}/me/payments/${encodeURIComponent(id)}`, {
    headers: { ...authHeaders() },
    signal: options?.signal,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || 'Pagamento não encontrado')
  }
  return res.json()
}

/** Como `fetchPayment`, mas retorna `null` em 404 (cobrança removida). Útil para polling de pendência. */
export async function fetchPaymentIfExists(id: string, options?: { signal?: AbortSignal }): Promise<PaymentItem | null> {
  const res = await fetch(`${API_BASE}/me/payments/${encodeURIComponent(id)}`, {
    headers: { ...authHeaders() },
    signal: options?.signal,
  })
  if (res.status === 404) return null
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || 'Falha ao consultar pagamento')
  }
  return res.json()
}

/** Cancela cobrança pendente no Asaas e remove do histórico local. */
export async function deleteMyPendingPayment(id: string, options?: { signal?: AbortSignal }): Promise<void> {
  const res = await fetch(`${API_BASE}/me/payments/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { ...authHeaders() },
    signal: options?.signal,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || 'Falha ao remover cobrança')
  }
}

/** Cobrança pendente do usuário (no máximo uma). `null` se não houver. */
export async function fetchMyPendingPayment(options?: { signal?: AbortSignal }): Promise<CreatePaymentForCreditsResponse | null> {
  const res = await fetch(`${API_BASE}/me/payments/pending`, {
    headers: { ...authHeaders() },
    signal: options?.signal,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || 'Falha ao consultar cobrança pendente')
  }
  const data = (await res.json()) as { payment: CreatePaymentForCreditsResponse | null }
  return data.payment ?? null
}

export interface CreatePaymentForCreditsResponse {
  paymentId: string
  asaasPaymentId: string | null
  status: string
  credits: number
  amountCents: number
  valueBrl: number
  billingType: string
  invoiceUrl: string | null
  bankSlipUrl: string | null
  pixCopyPaste: string | null
}

/** POST /me/payments retornou 409 — já existe cobrança pendente. */
export class PendingPaymentExistsError extends Error {
  payment: CreatePaymentForCreditsResponse
  constructor(message: string, payment: CreatePaymentForCreditsResponse) {
    super(message)
    this.name = 'PendingPaymentExistsError'
    this.payment = payment
  }
}

/** Checkout público: cadastra como Assinante e cria pagamento. Retorna token + user + dados do pagamento (sem auth). */
export interface RegisterAndCreatePaymentResponse extends CreatePaymentForCreditsResponse {
  token: string
  user: { id: number; username: string; scope: string; profile_handle: string | null }
}

export async function registerAndCreatePayment(
  params: { email: string; password: string; name?: string; credits: number; billingType: 'PIX' | 'BOLETO' },
  options?: { signal?: AbortSignal }
): Promise<RegisterAndCreatePaymentResponse> {
  const res = await fetch(`${API_BASE}/checkout/register-and-pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: params.email.trim().toLowerCase(),
      password: params.password,
      name: params.name?.trim() || undefined,
      credits: params.credits,
      billingType: params.billingType,
    }),
    signal: options?.signal,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || 'Falha ao criar conta e pagamento')
  }
  return data as RegisterAndCreatePaymentResponse
}

/** Pagamento direto do relatório (sem créditos). Logado: query + desiredCount + billingType. Guest: + email, password, name?. */
export interface PayForReportResponse {
  paymentId: string
  asaasPaymentId: string | null
  status: string
  desiredCount: number
  amountCents: number
  valueBrl: number
  billingType: string
  invoiceUrl: string | null
  bankSlipUrl: string | null
  pixCopyPaste: string | null
  campaignId?: string
  token?: string
  user?: { id: number; username: string; scope: string; profile_handle: string | null }
}

/** Preview do preço do relatório (ativados R$2, não ativados R$1). */
export async function reportPricePreview(
  params: { query: ProfilesSearchQuery; desiredCount: number },
  options?: { signal?: AbortSignal }
): Promise<{ amountCents: number; valueBrl: number; activatedCount: number; notActivatedCount: number }> {
  const res = await fetch(`${API_BASE}/checkout/report-price-preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ query: params.query, desiredCount: params.desiredCount }),
    signal: options?.signal,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Falha ao obter preço')
  return data as { amountCents: number; valueBrl: number; activatedCount: number; notActivatedCount: number }
}

export async function payForReport(
  params: {
    query: ProfilesSearchQuery
    desiredCount: number
    billingType: 'PIX' | 'BOLETO'
    expiresAt: string
    email?: string
    password?: string
    name?: string
    cpfCnpj?: string
  },
  options?: { signal?: AbortSignal }
): Promise<PayForReportResponse> {
  const body: Record<string, unknown> = {
    query: params.query,
    desiredCount: params.desiredCount,
    billingType: params.billingType,
    expiresAt: params.expiresAt,
  }
  if (params.email != null) body.email = params.email
  if (params.password != null) body.password = params.password
  if (params.name != null) body.name = params.name
  if (params.cpfCnpj != null) body.cpfCnpj = params.cpfCnpj
  const res = await fetch(`${API_BASE}/checkout/pay-for-report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
    signal: options?.signal,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || 'Falha ao gerar pagamento')
  }
  return data as PayForReportResponse
}

export async function createPaymentForCredits(
  credits: number,
  billingType: 'PIX' | 'BOLETO' = 'PIX',
  options?: { signal?: AbortSignal; cpfCnpj?: string }
): Promise<CreatePaymentForCreditsResponse> {
  const body: Record<string, unknown> = { credits, billingType }
  const cpfDigits = (options?.cpfCnpj ?? '').replace(/\D/g, '')
  if (cpfDigits.length === 11 || cpfDigits.length === 14) {
    body.cpfCnpj = cpfDigits
  }
  const res = await fetch(`${API_BASE}/me/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
    signal: options?.signal,
  })
  const data = (await res.json().catch(() => ({}))) as {
    error?: string
    payment?: CreatePaymentForCreditsResponse
  }
  if (!res.ok) {
    if (res.status === 409 && data.payment) {
      throw new PendingPaymentExistsError(data.error || 'Cobrança pendente', data.payment)
    }
    throw new Error(data.error || 'Falha ao gerar pagamento')
  }
  return data as CreatePaymentForCreditsResponse
}

/** Item de favorito com nome da campanha (quando favoritado a partir de uma campanha). */
export interface FavoriteItem {
  handle: string
  campaignId?: string
  campaignName?: string
}

/** Lista de favoritos do usuário (handles + opcionalmente favorites com campaignName). */
export async function fetchFavorites(options?: { signal?: AbortSignal }): Promise<{ handles: string[]; favorites?: FavoriteItem[] }> {
  const res = await fetch(`${API_BASE}/me/favorites`, {
    headers: { ...authHeaders() },
    signal: options?.signal,
  })
  if (!res.ok) throw new Error('Falha ao carregar favoritos')
  return res.json()
}

/** Adiciona influenciador aos favoritos. campaignId opcional: campanha de onde está favoritando. */
export async function addFavorite(handle: string, options?: { campaignId?: string | null }): Promise<void> {
  const h = handle.replace(/^@/, '').trim()
  const body: { handle: string; campaignId?: string } = { handle: h }
  if (options?.campaignId?.trim()) body.campaignId = options.campaignId.trim()
  const res = await fetch(`${API_BASE}/me/favorites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || 'Falha ao favoritar')
  }
}

/** Remove influenciador dos favoritos. campaignId opcional: remove só essa (handle, campanha); sem campaignId remove todas as entradas do handle. */
export async function removeFavorite(handle: string, options?: { campaignId?: string | null }): Promise<void> {
  const h = handle.replace(/^@/, '').trim()
  const qs = options?.campaignId?.trim() ? `?campaignId=${encodeURIComponent(options.campaignId.trim())}` : ''
  const res = await fetch(`${API_BASE}/me/favorites/${encodeURIComponent(h)}${qs}`, {
    method: 'DELETE',
    headers: { ...authHeaders() },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || 'Falha ao desfavoritar')
  }
}

/** Cria campanha (compra do relatório) e debita créditos. */
export interface CreateCampaignResponse {
  campaignId: string
  handlesCount: number
  creditsUsed: number
}

export interface CreateCampaignError {
  code?: string
  required?: number
  balance?: number
}

/** Defaults públicos: duração do relatório (dias) e data YYYY-MM-DD sugerida na criação. */
export interface CampaignAccessDefaults {
  durationDays: number
  defaultExpiresAt: string
}

export async function fetchCampaignAccessDefaults(options?: {
  signal?: AbortSignal
}): Promise<CampaignAccessDefaults> {
  const res = await fetch(`${API_BASE}/campaign-access-defaults`, { signal: options?.signal })
  const data = (await res.json().catch(() => ({}))) as Partial<CampaignAccessDefaults>
  if (!res.ok || typeof data.durationDays !== 'number' || typeof data.defaultExpiresAt !== 'string') {
    throw new Error('Falha ao carregar configuração de acesso à campanha')
  }
  return data as CampaignAccessDefaults
}

export async function createCampaign(
  query: ProfilesSearchQuery,
  options: { expiresAt: string; name?: string; maxHandles?: number; signal?: AbortSignal }
): Promise<CreateCampaignResponse> {
  const res = await fetch(`${API_BASE}/campaigns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      query,
      name: options?.name ?? (query?.q ? String(query.q).trim() || undefined : undefined),
      maxHandles: options?.maxHandles,
      expiresAt: options?.expiresAt,
    }),
    signal: options?.signal,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const e = new Error((data as { error?: string }).error || 'Falha ao comprar relatório') as Error & CreateCampaignError
    e.code = (data as { code?: string }).code
    e.required = (data as { required?: number }).required
    e.balance = (data as { balance?: number }).balance
    throw e
  }
  return data as CreateCampaignResponse
}

/** Compilado da campanha (quantitativo, cidades, categorias) — retornado quando há pagamento pendente. */
export interface CampaignCompilado {
  totalLikes: number
  totalComments: number
  totalViews: number
  totalFollowers: number
  postsCount: number
  avgEngagementRate: number
  avgLikes: number
  avgComments: number
  avgViews: number
  previewProfiles: Array<{ handle: string; profile_pic_url?: string; full_name?: string; followers_count?: number }>
  topHashtags: string[]
  topLlmCategories?: Array<{ label: string; count: number }>
  topLlmGenders?: Array<{ label: string; count: number }>
  topLlmProfileTypes?: Array<{ label: string; count: number }>
  cities: Array<{ name: string; count: number }>
  states: Array<{ name: string; count: number }>
  activatedCount: number
}

/** Dados da campanha. */
export interface CampaignInfo {
  id: string
  name: string | null
  description: string | null
  /** Query salva na criação da campanha (inclui `q` e filtros). */
  savedQuery?: Partial<ProfilesSearchQuery> | null
  handlesCount: number
  credits_used: number
  /** Quando campanha está paga, igual a credits_used; quando pendente, 0. Use para calcular quantidade não paga. */
  creditsPaid?: number
  created_at: string
  expires_at: string
  paymentStatus?: 'pending' | 'paid'
  pendingPayment?: {
    status: string
    billingType: string | null
    bankSlipUrl: string | null
    invoiceUrl: string | null
    pixCopyPaste: string | null
    amountCents: number
    valueBrl: number
    /** true quando não existe registro de payment; usuário precisa gerar PIX/boleto. */
    paymentMissing?: boolean
  }
  /** Compilado completo (quantitativo, cidades, categorias) quando há pagamento pendente. */
  compilado?: CampaignCompilado
}

export async function getCampaign(
  campaignId: string,
  options?: { signal?: AbortSignal }
): Promise<CampaignInfo> {
  const res = await fetch(`${API_BASE}/campaigns/${campaignId}`, {
    headers: { ...authHeaders() },
    signal: options?.signal,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || 'Campanha não encontrada')
  }
  return res.json()
}

/** Atualiza o nome da campanha. */
export async function updateCampaignName(
  campaignId: string,
  name: string,
  options?: { signal?: AbortSignal }
): Promise<{ ok: boolean; name: string | null; description: string | null }> {
  const res = await fetch(`${API_BASE}/campaigns/${campaignId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ name: name.trim() }),
    signal: options?.signal,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || 'Falha ao atualizar nome')
  }
  return res.json()
}

/** Atualiza a descrição (anotações) da campanha. */
export async function updateCampaignDescription(
  campaignId: string,
  description: string,
  options?: { signal?: AbortSignal }
): Promise<{ ok: boolean; description: string | null }> {
  const res = await fetch(`${API_BASE}/campaigns/${campaignId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ description }),
    signal: options?.signal,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || 'Falha ao salvar anotações')
  }
  return res.json()
}

/** Exclui a campanha (apenas do dono). */
export async function deleteCampaign(
  campaignId: string,
  options?: { signal?: AbortSignal }
): Promise<void> {
  const res = await fetch(`${API_BASE}/campaigns/${campaignId}`, {
    method: 'DELETE',
    headers: { ...authHeaders() },
    signal: options?.signal,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || 'Falha ao excluir campanha')
  }
}

/** Altera a quantidade de perfis a comprar (só quando pagamento pendente). */
export async function setCampaignQuantity(
  campaignId: string,
  quantity: number,
  options?: { signal?: AbortSignal }
): Promise<{ ok: boolean; quantity: number }> {
  const res = await fetch(`${API_BASE}/campaigns/${campaignId}/set-quantity`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ quantity }),
    signal: options?.signal,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || 'Falha ao alterar quantidade')
  }
  return res.json()
}

/** Gera boleto ou PIX para uma campanha que ainda não tem pagamento. */
export async function createCampaignPayment(
  campaignId: string,
  body: { billingType: 'PIX' | 'BOLETO'; cpfCnpj?: string; quantity?: number },
  options?: { signal?: AbortSignal }
): Promise<{
  bankSlipUrl: string | null
  pixCopyPaste: string | null
  invoiceUrl: string | null
  billingType: string
  amountCents: number
  valueBrl: number
}> {
  const res = await fetch(`${API_BASE}/campaigns/${campaignId}/create-payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
    signal: options?.signal,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || 'Falha ao gerar pagamento')
  }
  return res.json()
}

/** Paga a campanha com créditos (1 crédito por influenciador). quantity = quantidade de perfis a pagar; se omitido usa o total da campanha. */
export async function payCampaignWithCredits(
  campaignId: string,
  quantity?: number,
  options?: { signal?: AbortSignal }
): Promise<{ ok: boolean; creditsUsed: number }> {
  const res = await fetch(`${API_BASE}/campaigns/${campaignId}/pay-with-credits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: quantity != null ? JSON.stringify({ quantity }) : undefined,
    signal: options?.signal,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || 'Falha ao pagar com créditos')
  }
  return res.json()
}

/** Stats agregados da campanha (engagement, likes, views, etc.). */
export interface MyCampaignStats {
  totalLikes: number
  totalComments: number
  totalViews: number
  totalFollowers: number
  postsCount: number
  avgEngagementRate: number
  avgLikes: number
  avgComments: number
  avgViews: number
}

/** Perfil de preview para exibir na campanha. */
export interface MyCampaignPreviewProfile {
  handle: string
  profile_pic_url?: string
  full_name?: string
  followers_count?: number
}

export interface MyCampaignItem {
  id: string
  name: string | null
  handlesCount: number
  creditsUsed: number
  created_at: string
  /** Fim da vigência do relatório (mesmo campo da campanha em detalhe). */
  expires_at?: string
  /** Stats de engajamento (preenchido pela API). */
  stats?: MyCampaignStats | null
  /** Amostra de perfis para preview com fotos. */
  previewProfiles?: MyCampaignPreviewProfile[]
  /** 2 hashtags/categorias mais relevantes da campanha. */
  topHashtags?: string[]
  /** Categorias principais LLM mais frequentes nos perfis (rótulo + quantidade, até 8). */
  topLlmCategories?: Array<{ label: string; count: number }>
  /** Gênero agregado na campanha. */
  topLlmGenders?: Array<{ label: string; count: number }>
  /** Tipo de perfil agregado na campanha. */
  topLlmProfileTypes?: Array<{ label: string; count: number }>
  /** Pagamento pendente (PIX/Boleto) para esta campanha. */
  pendingPayment?: {
    status: string
    billingType: string
    bankSlipUrl: string | null
    invoiceUrl: string | null
    pixCopyPaste: string | null
    amountCents: number
    valueBrl: number
  }
}

export interface MyCampaignsResponse {
  campaigns: MyCampaignItem[]
}

/** Lista campanhas do usuário logado. light=true retorna só lista (sem stats) para carregamento rápido. */
export async function fetchMyCampaigns(options?: { signal?: AbortSignal; light?: boolean }): Promise<MyCampaignsResponse> {
  const url = options?.light ? `${API_BASE}/me/campaigns?light=1` : `${API_BASE}/me/campaigns`
  const res = await fetch(url, {
    headers: { ...authHeaders() },
    signal: options?.signal,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || 'Falha ao carregar campanhas')
  }
  return res.json()
}

/** Admin: adicionar créditos a um usuário. Requer scope adm. */
export async function adminAddCredits(
  userId: number,
  amount: number,
  options?: { signal?: AbortSignal }
): Promise<{ balance: number; added: number }> {
  const res = await fetch(`${API_BASE}/admin/users/${userId}/credits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ amount }),
    signal: options?.signal,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || 'Falha ao adicionar créditos')
  }
  return data as { balance: number; added: number }
}

/** Listagem de perfis de uma campanha (paginação + filtros, mesma query que a busca principal sem q/categories). */
export async function fetchCampaignProfiles(
  campaignId: string,
  query: Partial<ProfilesSearchQuery>,
  options?: { signal?: AbortSignal }
): Promise<ProfilesSearchResponse> {
  const params = new URLSearchParams()
  if (query.q?.trim()) params.set('q', query.q.trim())
  if (query.minFollowers != null) params.set('minFollowers', String(query.minFollowers))
  if (query.maxFollowers != null) params.set('maxFollowers', String(query.maxFollowers))
  if (query.minEngagementRate != null) params.set('minEngagementRate', String(query.minEngagementRate))
  if (query.minAvgLikes != null) params.set('minAvgLikes', String(query.minAvgLikes))
  if (query.minPostsCount != null) params.set('minPostsCount', String(query.minPostsCount))
  if (query.engagementRateBuckets?.length) params.set('engagementRateBuckets', query.engagementRateBuckets.join(','))
  if (query.avgLikesBuckets?.length) params.set('avgLikesBuckets', query.avgLikesBuckets.join(','))
  if (query.postsCountBuckets?.length) params.set('postsCountBuckets', query.postsCountBuckets.join(','))
  if (query.cities?.length) params.set('cities', query.cities.join(','))
  if (query.states?.length) params.set('states', query.states.join(','))
  if (query.neighborhoods?.length) params.set('neighborhoods', query.neighborhoods.join(','))
  if (query.socialNetworks?.length) params.set('socialNetworks', query.socialNetworks.join(','))
  if (query.excludePrivate) params.set('excludePrivate', 'true')
  if (query.accountTypeFilter?.length) params.set('accountTypeFilter', query.accountTypeFilter.join(','))
  if (query.contentTypes?.length) params.set('contentTypes', query.contentTypes.join(','))
  if (query.pricingFeed?.length) params.set('pricingFeed', query.pricingFeed.join(','))
  if (query.pricingReels?.length) params.set('pricingReels', query.pricingReels.join(','))
  if (query.pricingStory?.length) params.set('pricingStory', query.pricingStory.join(','))
  if (query.pricingDestaque?.length) params.set('pricingDestaque', query.pricingDestaque.join(','))
  if (query.costTierFilter?.length) params.set('costTierFilter', query.costTierFilter.join(','))
  if (query.sizeFilter?.length) params.set('sizeFilter', query.sizeFilter.join(','))
  if (query.sort) params.set('sort', query.sort)
  if (query.limit != null) params.set('limit', String(query.limit))
  if (query.offset != null) params.set('offset', String(query.offset))
  const llmJoinCamp = (key: string, arr?: string[]) => {
    if (arr?.length) params.set(key, arr.join(','))
  }
  llmJoinCamp('llmProfileType', query.llmProfileType)
  llmJoinCamp('llmMainCategory', query.llmMainCategory)
  llmJoinCamp('llmGender', query.llmGender)
  llmJoinCamp('llmSubCategories', query.llmSubCategories)
  llmJoinCamp('llmContentPillars', query.llmContentPillars)
  llmJoinCamp('llmAudienceType', query.llmAudienceType)
  const qs = params.toString()
  const res = await fetch(`${API_BASE}/campaigns/${campaignId}/profiles${qs ? `?${qs}` : ''}`, {
    headers: { ...authHeaders() },
    signal: options?.signal,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || 'Falha ao carregar perfis da campanha')
  }
  return res.json()
}

export interface PostMedia {
  cover_images?: Array<{ width: number; height: number; url: string }>
  video_versions?: Array<{ width: number; height: number; url: string }>
  /** URL estável (S3) após extração. */
  stable_cover_url?: string
}

export interface PostContent {
  caption_text?: string
  caption_created_at?: number
  hashtags?: string[]
}

export interface PostMetrics {
  likes?: number
  comments?: number
  view_count?: number
}

export interface PostItem {
  key: string
  profile_handle?: string
  /** Tipo de mídia quando extraímos reels, marcados e destaques. */
  content_type?: MediaKind
  influencer?: {
    username?: string
    full_name?: string
    profile_pic_url?: string
    stable_profile_pic_url?: string
    /** Preenchido em post-matches a partir do perfil indexado (patamar na UI). */
    followers_count?: number
    /** Qualificação LLM do perfil (post-matches), quando existir no storage. */
    llm?: unknown
  }
  post?: { shortcode?: string; media_type?: number; taken_at?: number; collected_at?: string;[k: string]: unknown }
  content?: PostContent
  media?: PostMedia
  metrics?: PostMetrics
  image_url?: string
  video_url?: string
  [key: string]: unknown
}

/** URL bruta da capa (S3 estável ou CDN), antes do proxy. */
export function getPostCoverRawUrl(post: PostItem): string | undefined {
  const stable = post.media?.stable_cover_url
  if (typeof stable === 'string' && stable.startsWith('http')) return stable
  const cover = post.media?.cover_images?.[0]?.url
  const video = post.media?.video_versions?.[0]?.url
  const top = post.image_url
  const raw = cover || video || top
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined
}

/** URL pronta para `<img src>` (proxy só quando for Instagram/fbcdn). */
export function getPostCoverDisplayUrl(post: PostItem): string | undefined {
  const raw = getPostCoverRawUrl(post)
  if (!raw) return undefined
  return proxyImageUrlForDisplay(raw) ?? proxyImageUrl(raw)
}

export interface PostsResponse {
  total: number
  items: PostItem[]
}

/** Posts dos perfis da campanha onde `q` bate em legenda/hashtags (dados atuais). */
export async function fetchCampaignPostMatches(
  campaignId: string,
  params: { q?: string; mediaKinds?: MediaKind[]; limit?: number; offset?: number },
  options?: { signal?: AbortSignal }
): Promise<PostsResponse & { q?: string; mediaKindCounts?: Partial<Record<MediaKind, number>> }> {
  const p = new URLSearchParams()
  if (params.q?.trim()) p.set('q', params.q.trim())
  if (params.mediaKinds?.length) p.set('type', params.mediaKinds.join(','))
  p.set('limit', String(params.limit ?? 48))
  p.set('offset', String(params.offset ?? 0))
  const res = await fetch(`${API_BASE}/campaigns/${encodeURIComponent(campaignId)}/post-matches?${p}`, {
    headers: { ...authHeaders() },
    signal: options?.signal,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || 'Falha ao carregar posts da campanha')
  }
  return res.json()
}

const POST_SEARCH_HANDLES_PAGE = 200

/**
 * Handles únicos na campanha com ao menos um post que casa com `q` (mesma API da galeria Origem).
 * Pagina até cobrir `total` para o painel BI bater com a listagem de posts.
 */
export async function fetchCampaignPostSearchHandles(
  campaignId: string,
  params: { q: string; mediaKinds?: MediaKind[] },
  options?: { signal?: AbortSignal }
): Promise<{ handles: string[]; totalPosts: number }> {
  const q = params.q.trim()
  if (!q) return { handles: [], totalPosts: 0 }
  const handles = new Set<string>()
  let offset = 0
  let totalPosts = 0
  for (; ;) {
    const res = await fetchCampaignPostMatches(
      campaignId,
      { q, mediaKinds: params.mediaKinds, limit: POST_SEARCH_HANDLES_PAGE, offset },
      options
    )
    totalPosts = res.total
    for (const it of res.items) {
      const raw = it.profile_handle ?? it.influencer?.username ?? ''
      const h = String(raw).toLowerCase().replace(/^@/, '').trim()
      if (h) handles.add(h)
    }
    if (res.items.length === 0 || offset + res.items.length >= res.total) break
    offset += res.items.length
  }
  return { handles: [...handles], totalPosts }
}

export async function fetchProfiles(
  limit = 50,
  offset = 0,
  since?: string,
  options?: { campaignId?: string | null }
): Promise<ProfilesResponse> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  if (since) params.set('since', since)
  const res = await fetch(`${API_BASE}/profiles?${params.toString()}`, {
    headers: authHeadersWithCampaign(options?.campaignId),
  })
  if (res.status === 401) throw new Error('Faça login para acessar a lista de perfis')
  if (!res.ok) throw new Error('Falha ao carregar perfis')
  return res.json()
}

export async function fetchProfile(handle: string, options?: { campaignId?: string | null }): Promise<ProfileItem | null> {
  const h = handle.replace(/^@/, '')
  const res = await fetch(`${API_BASE}/profiles/${encodeURIComponent(h)}`, {
    headers: authHeadersWithCampaign(options?.campaignId),
  })
  if (res.status === 404) return null
  if (res.status === 429) {
    const err = await res.json().catch(() => ({}))
    const msg = (err as { error?: string }).error || 'Muitas requisições. Aguarde um minuto.'
    throw Object.assign(new Error(msg), { code: 'RATE_LIMIT' })
  }
  if (!res.ok) throw new Error('Falha ao carregar perfil')
  return res.json()
}

/** Resumo do perfil com engagement e BI. Mesmo controle de acesso que o perfil (próprio, campanha ou favorito). */
export interface ProfileSummaryResponse {
  profile: ProfileItem
  engagement?: EngagementStats
  bi?: unknown
}

export async function fetchProfileSummary(handle: string, options?: { campaignId?: string | null }): Promise<ProfileSummaryResponse | null> {
  const h = handle.replace(/^@/, '')
  const res = await fetch(`${API_BASE}/profiles/${encodeURIComponent(h)}/summary`, {
    headers: authHeadersWithCampaign(options?.campaignId),
  })
  if (res.status === 404) return null
  if (res.status === 429) {
    const err = await res.json().catch(() => ({}))
    const msg = (err as { error?: string }).error || 'Muitas requisições. Aguarde um minuto.'
    throw Object.assign(new Error(msg), { code: 'RATE_LIMIT' })
  }
  if (!res.ok) throw new Error('Falha ao carregar resumo do perfil')
  return res.json()
}

/** Perfil de um influenciador dentro de uma campanha. Só retorna dados se o perfil estiver na campanha. */
export async function fetchCampaignProfile(campaignId: string, handle: string): Promise<ProfileItem | null> {
  const h = handle.replace(/^@/, '').trim()
  const res = await fetch(`${API_BASE}/campaigns/${encodeURIComponent(campaignId)}/profiles/${encodeURIComponent(h)}`, {
    headers: { ...authHeaders() },
  })
  if (res.status === 404) return null
  if (res.status === 429) {
    const err = await res.json().catch(() => ({}))
    const msg = (err as { error?: string }).error || 'Muitas requisições. Aguarde um minuto.'
    throw Object.assign(new Error(msg), { code: 'RATE_LIMIT' })
  }
  if (!res.ok) throw new Error('Falha ao carregar perfil da campanha')
  return res.json()
}

/** Ativação do perfil dentro de uma campanha. Só retorna dados se o perfil estiver na campanha. */
export async function fetchCampaignProfileActivation(campaignId: string, handle: string): Promise<ProfileActivation> {
  const h = handle.replace(/^@/, '').trim()
  const res = await fetch(`${API_BASE}/campaigns/${encodeURIComponent(campaignId)}/profiles/${encodeURIComponent(h)}/activation`, {
    headers: { ...authHeaders() },
  })
  if (!res.ok) throw new Error('Falha ao carregar ativação do perfil')
  const data = await res.json()
  if (!data || typeof data !== 'object' || (data as { _redacted?: boolean })._redacted === true) {
    return {}
  }
  return data as ProfileActivation
}

/** Resposta ao solicitar código: pode vir rejeição (nao_segue_perfil) para exibir na tela de erro, sem toast. */
export interface RequestCodeResponse {
  sent: boolean
  code?: string
  error?: string
  /** Quando o backend rejeita por não seguir o perfil oficial (request-code). */
  rejectionReason?: string
  followProfileUrl?: string
}

/**
 * Extract + request-code em uma única chamada (sem polling). Processo todo no backend.
 * Usado no fluxo de cadastro (/app/create) para evitar gap entre extract e envio do código.
 */
export async function requestCodeWithExtract(nickname: string): Promise<RequestCodeResponse & { success?: boolean }> {
  const res = await fetch(`${API_BASE}/auth/request-code-with-extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ nickname: nickname.replace(/^@/, '').trim(), handle: nickname.replace(/^@/, '').trim() }),
  })
  const body = await res.json().catch(() => ({})) as { error?: string; followProfileUrl?: string; sent?: boolean; code?: string }
  if (res.status === 400 && body.error === 'nao_segue_perfil') {
    return { sent: false, success: false, rejectionReason: 'nao_segue_perfil', followProfileUrl: body.followProfileUrl }
  }
  if (!res.ok) {
    throw new Error(body.error || 'Falha ao extrair perfil ou enviar código')
  }
  return { ...body, sent: body.sent ?? true, success: true }
}

/** Solicita envio do código de ativação 2FA para o nickname (via inbox do Instagram). Não entra na fila de extração; execução direta (cadastro em /app/create). */
export async function requestVerificationCode(nickname: string): Promise<RequestCodeResponse & { success?: boolean }> {
  const res = await fetch(`${API_BASE}/auth/request-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ nickname: nickname.replace(/^@/, '').trim() }),
  })
  const body = await res.json().catch(() => ({})) as { error?: string; followProfileUrl?: string; sent?: boolean; code?: string }
  if (res.status === 400 && body.error === 'nao_segue_perfil') {
    return { sent: false, success: false, rejectionReason: 'nao_segue_perfil', followProfileUrl: body.followProfileUrl }
  }
  if (!res.ok) {
    throw new Error(body.error || 'Falha ao solicitar código')
  }
  return { ...body, sent: body.sent ?? true, success: true }
}

/** Valida com o código recebido no Instagram. Sem login: retorna token+user (2FA como login). Assinante que vincula Instagram: mission_completed + credits (50). */
export async function verifyProfile(
  nickname: string,
  code: string
): Promise<{
  verified: boolean
  profile_handle: string
  token?: string
  user?: { id: number; username: string; scope: AuthScope; profile_handle: string | null }
  mission_completed?: boolean
  credits?: number
}> {
  const res = await fetch(`${API_BASE}/auth/verify-profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ nickname: nickname.replace(/^@/, '').trim(), code: code.trim() }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || 'Código inválido ou expirado')
  }
  return res.json()
}

/** Atualiza o perfil do usuário logado (ex.: desvincular Instagram, nome). Retorna user + token atualizados. */
export async function updateMyProfile(params: { profile_handle?: string | null; display_name?: string | null }): Promise<{ user: { id: number; username: string; scope: string; profile_handle: string | null; display_name?: string | null; email_verified?: boolean }; token: string }> {
  const res = await fetch(`${API_BASE}/auth/me`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(params),
  })
  if (res.status === 401) throw new Error('Faça login para atualizar o perfil.')
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || 'Falha ao atualizar perfil')
  }
  return res.json()
}

/** Define a senha do usuário logado (após validação 2FA). Requer autenticação. */
export async function setMyPassword(password: string): Promise<void> {
  const res = await fetch(`${API_BASE}/auth/me/password`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ password }),
  })
  if (res.status === 401) throw new Error('Faça login para definir a senha.')
  if (res.status === 400) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || 'Senha inválida')
  }
  if (!res.ok) throw new Error('Falha ao definir senha')
}

/** Envia mensagem Direct do Instagram para um influenciador. Requer login com scope adm ou assinante. imageBase64 opcional (data URL ou base64). */
export async function sendDirectMessageToInfluencer(handle: string, message: string, imageBase64?: string): Promise<{ ok: boolean }> {
  const body: { handle: string; message: string; imageBase64?: string } = {
    handle: handle.replace(/^@/, '').trim(),
    message: message.trim(),
  }
  if (imageBase64) body.imageBase64 = imageBase64
  const res = await fetch(`${API_BASE}/direct/send-message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string }
  if (res.status === 401) throw new Error('Faça login para enviar mensagem.')
  if (res.status === 403) throw new Error('Sem permissão para enviar mensagem Direct.')
  if (res.status === 400 || res.status === 503) throw new Error(data.error || 'Não foi possível enviar a mensagem.')
  if (!res.ok) throw new Error(data.error || 'Falha ao enviar mensagem.')
  return { ok: data.ok ?? true }
}

/** Templates de mensagem para disparo em massa */
export interface MessageTemplate {
  id: number
  hash: string
  body: string
  reject_hashes?: string[]
  created_at: string
  /** Minutos à frente para agendar o envio (regra do template). */
  send_delay_minutes?: number
}

export async function fetchDirectTemplates(): Promise<{ items: MessageTemplate[] }> {
  const res = await fetch(`${API_BASE}/direct/templates`, { headers: authHeaders() })
  if (res.status === 401 || res.status === 403) throw new Error('Sem permissão.')
  if (!res.ok) throw new Error('Falha ao carregar templates.')
  return res.json()
}

export async function createDirectTemplate(hash: string, body: string, rejectHashes: string[], sendDelayMinutes: number = 1): Promise<{ id: number; hash: string; body: string; reject_hashes: string[]; send_delay_minutes: number }> {
  const res = await fetch(`${API_BASE}/direct/templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      hash: hash.trim(),
      body: body.trim(),
      reject_hashes: rejectHashes.filter(Boolean).map((h) => h.trim()),
      send_delay_minutes: Math.max(1, Math.min(999, Math.floor(sendDelayMinutes))),
    }),
  })
  const data = await res.json().catch(() => ({})) as { error?: string; id?: number; hash?: string; body?: string; reject_hashes?: string[]; send_delay_minutes?: number }
  if (res.status === 400) throw new Error(data.error || 'Dados inválidos')
  if (!res.ok) throw new Error(data.error || 'Falha ao criar template.')
  return { id: data.id!, hash: data.hash!, body: data.body!, reject_hashes: data.reject_hashes ?? [], send_delay_minutes: data.send_delay_minutes ?? 1 }
}

export async function updateDirectTemplate(id: number, opts: { body?: string; reject_hashes?: string[]; send_delay_minutes?: number }): Promise<void> {
  const payload: Record<string, unknown> = {}
  if (opts.body !== undefined) payload.body = opts.body.trim()
  if (opts.reject_hashes !== undefined) payload.reject_hashes = opts.reject_hashes
  if (opts.send_delay_minutes !== undefined) payload.send_delay_minutes = Math.max(1, Math.min(999, Math.floor(opts.send_delay_minutes)))
  if (Object.keys(payload).length === 0) return
  const res = await fetch(`${API_BASE}/direct/templates/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  })
  const data = await res.json().catch(() => ({})) as { error?: string }
  if (res.status === 400 || res.status === 404) throw new Error(data.error || 'Template não encontrado')
  if (!res.ok) throw new Error(data.error || 'Falha ao atualizar template.')
}

/** Fila de disparo: quem recebeu o quê e quando */
export interface DirectQueueItem {
  id: number
  profile_handle: string
  message_hash: string
  status: string
  sent_at: string | null
  error: string | null
  created_at: string
  scheduled_at: string | null
}

/** Handles que já receberam a mensagem com esse hash (para filtro incluir/excluir). */
export async function fetchDirectHandlesByHash(messageHash: string): Promise<{ handles: string[] }> {
  const params = new URLSearchParams({ message_hash: messageHash.trim() })
  const res = await fetch(`${API_BASE}/direct/queue/handles-by-hash?${params}`, { headers: authHeaders() })
  if (res.status === 400 || res.status === 401 || res.status === 403) throw new Error('Sem permissão ou hash inválido.')
  if (!res.ok) throw new Error('Falha ao carregar handles por hash.')
  return res.json()
}

/** Busca entre seus seguidores do Instagram (usa o campo de pesquisa do modal). Use com debounce no frontend. q vazio + scrolls = primeiros N visíveis. */
export async function fetchFollowersSearch(
  q: string,
  opts?: { signal?: AbortSignal; scrolls?: number }
): Promise<{ usernames: string[] }> {
  const params = new URLSearchParams()
  if (q.trim()) params.set('q', q.trim())
  if (opts?.scrolls != null) params.set('scrolls', String(opts.scrolls))
  const res = await fetch(`${API_BASE}/direct/followers/search?${params}`, {
    headers: authHeaders(),
    signal: opts?.signal,
  })
  const data = await res.json().catch(() => ({})) as { usernames?: string[]; error?: string }
  if (res.status === 400 || res.status === 503) throw new Error(data.error || 'Busca indisponível.')
  if (res.status === 401 || res.status === 403) throw new Error('Sem permissão.')
  if (!res.ok) throw new Error(data.error || 'Falha na busca de seguidores.')
  return { usernames: data.usernames ?? [] }
}

export async function fetchDirectQueue(opts?: { status?: string; limit?: number; offset?: number }): Promise<{ total: number; items: DirectQueueItem[] }> {
  const params = new URLSearchParams()
  if (opts?.status) params.set('status', opts.status)
  if (opts?.limit != null) params.set('limit', String(opts.limit))
  if (opts?.offset != null) params.set('offset', String(opts.offset))
  const res = await fetch(`${API_BASE}/direct/queue?${params}`, { headers: authHeaders() })
  if (res.status === 401 || res.status === 403) throw new Error('Sem permissão.')
  if (!res.ok) throw new Error('Falha ao carregar fila.')
  return res.json()
}

export async function addToDirectQueue(
  items: { profile_handle: string; message_hash: string }[] | string[],
  messageHash?: string,
  scheduledAtIso?: string
): Promise<{ added: number }> {
  const base =
    Array.isArray(items) && items.length > 0 && typeof items[0] === 'object'
      ? { items }
      : { handles: items, message_hash: messageHash }
  const body = scheduledAtIso ? { ...base, scheduled_at: scheduledAtIso } : base
  const res = await fetch(`${API_BASE}/direct/queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({})) as { added?: number; error?: string }
  if (res.status === 400) throw new Error(data.error || 'Dados inválidos')
  if (!res.ok) throw new Error(data.error || 'Falha ao adicionar à fila.')
  return { added: data.added ?? 0 }
}

export async function deleteDirectQueue(): Promise<{ deleted: number }> {
  const res = await fetch(`${API_BASE}/direct/queue`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  const data = await res.json().catch(() => ({})) as { deleted?: number; error?: string }
  if (res.status === 401 || res.status === 403) throw new Error('Sem permissão.')
  if (!res.ok) throw new Error(data.error || 'Falha ao deletar fila.')
  return { deleted: data.deleted ?? 0 }
}

export async function deleteDirectQueueItem(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/direct/queue/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  const data = await res.json().catch(() => ({})) as { error?: string }
  if (res.status === 401 || res.status === 403) throw new Error('Sem permissão.')
  if (res.status === 404) throw new Error('Item não encontrado.')
  if (!res.ok) throw new Error(data.error || 'Falha ao remover item.')
}

/** Atualiza um item da fila (template, data de agendamento e/ou status). */
export async function updateDirectQueueItem(
  id: number,
  payload: { message_hash?: string; scheduled_at?: string | null; status?: 'pending' | 'sent' | 'failed' }
): Promise<void> {
  const res = await fetch(`${API_BASE}/direct/queue/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  })
  const data = await res.json().catch(() => ({})) as { error?: string }
  if (res.status === 400 || res.status === 404) throw new Error(data.error || 'Item não encontrado ou já enviado.')
  if (res.status === 401 || res.status === 403) throw new Error('Sem permissão.')
  if (!res.ok) throw new Error(data.error || 'Falha ao atualizar item.')
}

/** Status do serviço de fila em background. */
export async function fetchDirectQueueServiceStatus(): Promise<{ running: boolean; paused: boolean; intervalMinutes: number }> {
  const res = await fetch(`${API_BASE}/direct/queue/service-status`, { headers: authHeaders() })
  if (res.status === 401 || res.status === 403) throw new Error('Sem permissão.')
  if (!res.ok) throw new Error('Falha ao carregar status do serviço.')
  return res.json()
}

/** Pausa o serviço de fila em background. */
export async function pauseDirectQueueService(): Promise<void> {
  const res = await fetch(`${API_BASE}/direct/queue/service-pause`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({}),
  })
  if (!res.ok) throw new Error('Falha ao pausar serviço.')
}

/** Retoma o serviço de fila em background. */
export async function resumeDirectQueueService(): Promise<void> {
  const res = await fetch(`${API_BASE}/direct/queue/service-resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({}),
  })
  if (!res.ok) throw new Error('Falha ao retomar serviço.')
}

/** Altera o intervalo entre envios (1, 10, 50 ou 100 min). */
export async function updateDirectQueueServiceInterval(minutes: number): Promise<void> {
  const res = await fetch(`${API_BASE}/direct/queue/service-interval`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ intervalMinutes: minutes }),
  })
  const data = await res.json().catch(() => ({})) as { error?: string }
  if (res.status === 400) throw new Error(data.error || 'Intervalo inválido')
  if (!res.ok) throw new Error('Falha ao alterar intervalo.')
}

export async function fetchPosts(
  profileHandle: string,
  limit = 50,
  offset = 0,
  type?: MediaKind,
  options?: { campaignId?: string | null }
): Promise<PostsResponse> {
  const h = profileHandle.replace(/^@/, '')
  const params = new URLSearchParams({ profile: h, limit: String(limit), offset: String(offset) })
  if (type) params.set('type', type)
  const res = await fetch(`${API_BASE}/posts?${params.toString()}`, {
    headers: authHeadersWithCampaign(options?.campaignId),
  })
  if (res.status === 429) {
    const err = await res.json().catch(() => ({}))
    const msg = (err as { error?: string }).error || 'Muitas requisições. Aguarde um minuto.'
    throw Object.assign(new Error(msg), { code: 'RATE_LIMIT' })
  }
  if (!res.ok) throw new Error('Falha ao carregar posts')
  return res.json()
}

/** Status do crawl (GET /api/crawl/status). */
export interface CrawlStatusResponse {
  running: boolean
  last?: { saved: number; tag: string; finishedAt: string }
}

export async function fetchCrawlStatus(): Promise<CrawlStatusResponse> {
  const res = await fetch(`${API_BASE}/crawl/status`, {
    headers: { ...authHeaders() },
  })
  if (res.status === 401 || res.status === 403) throw new Error('Acesso restrito a administradores')
  if (!res.ok) throw new Error('Falha ao obter status do crawl')
  return res.json()
}

/** Inicia o crawl (POST /api/crawl). Retorna 202 com started: true. */
export async function startCrawl(params: { tag: string; limit?: number; clear?: boolean }): Promise<{ started: boolean; tag: string; limit: number | null; clear?: boolean }> {
  const res = await fetch(`${API_BASE}/crawl`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      tag: params.tag.replace(/^#/, '').trim(),
      limit: params.limit,
      clear: params.clear ?? false,
    }),
  })
  if (res.status === 409) throw new Error('Crawl já em andamento.')
  if (res.status === 400) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Tag é obrigatória')
  }
  if (!res.ok) throw new Error('Falha ao iniciar crawl')
  return res.json()
}

/** Solicita parada do crawl (POST /api/crawl/stop). */
export async function stopCrawl(): Promise<{ ok: boolean; message: string }> {
  const res = await fetch(`${API_BASE}/crawl/stop`, {
    method: 'POST',
    headers: { ...authHeaders() },
  })
  if (res.status === 401 || res.status === 403) throw new Error('Acesso restrito a administradores')
  if (!res.ok) throw new Error('Falha ao parar crawl')
  return res.json()
}

/** Resultado da extração de um perfil específico (POST /api/crawl/extract-profile). */
export interface ExtractProfileResult {
  success: boolean
  saved?: boolean
  handle: string
  rejectionReason?: string
  /** URL do perfil para seguir (quando rejectionReason === 'nao_segue_perfil') */
  followProfileUrl?: string
  diagnostic?: {
    pass: boolean
    reason?: string
    accountType?: number
    followers: number
    category?: string
    isBusiness?: boolean
    isPrivate?: boolean
    followsRequiredProfile?: boolean
    minRequired?: number
  }
  error?: string
  followers?: number
  postsSaved?: number
}

const EXTRACT_STATUS_POLL_MS = 1000
const EXTRACT_STATUS_MAX_POLLS = 120 // ~5 min

/** Extrai um perfil (POST retorna 202; resultado vem em background). Faz polling até done/error. */
export async function extractProfileToBackend(handleOrUrl: string): Promise<ExtractProfileResult> {
  const body = handleOrUrl.startsWith('http') ? { url: handleOrUrl } : { handle: handleOrUrl }
  const res = await fetch(`${API_BASE}/crawl/extract-profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({})) as { error?: string; handle?: string; accepted?: boolean }
  if (res.status === 400) throw new Error(data.error || 'Handle ou URL inválido')
  if (res.status === 503) throw new Error(data.error || 'Serviço indisponível. Tente mais tarde.')
  if (res.status === 500) throw new Error(data.error || 'Erro ao extrair perfil')
  if (res.status !== 202) return data as ExtractProfileResult

  const handle = (data.handle ?? handleOrUrl.replace(/^@/, '').trim()).toLowerCase()
  for (let i = 0; i < EXTRACT_STATUS_MAX_POLLS; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, EXTRACT_STATUS_POLL_MS))
    const statusRes = await fetch(`${API_BASE}/crawl/extract-profile/status?handle=${encodeURIComponent(handle)}`, { headers: authHeaders() })
    const statusData = await statusRes.json().catch(() => ({})) as { status: string; result?: ExtractProfileResult; error?: string }
    if (statusData.status === 'done' && statusData.result) return statusData.result
    if (statusData.status === 'error') throw new Error(statusData.error || 'Erro ao extrair perfil')
  }
  throw new Error('Extração demorou demais. Tente novamente.')
}

/** Enfileira re-extração do perfil para renovar URLs de imagem. priority=true (só adm) coloca na frente da fila e ignora intervalo de 60 min. */
export async function queueRefreshProfile(
  handle: string,
  options?: { priority?: boolean }
): Promise<{ queued: boolean; handle: string; message: string }> {
  const h = handle.replace(/^@/, '').trim()
  if (!h) return { queued: false, handle: h, message: 'Handle vazio.' }
  const res = await fetch(`${API_BASE}/crawl/queue-refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ handle: h, priority: options?.priority === true }),
  })
  const data = await res.json().catch(() => ({}))
  if (res.status === 400) return { queued: false, handle: h, message: data.error || 'Requisição inválida' }
  if (res.status === 403) return { queued: false, handle: h, message: data.error || 'Sem permissão.' }
  return { queued: !!data.queued, handle: h, message: data.message || (data.queued ? 'Na fila.' : 'Já na fila.') }
}

/** Valores/tarifas (8 tipos de entrega). */
export interface PricingData {
  feed?: string
  reels?: string
  story?: string
  destaque?: string
}

/** Dados de ativação do perfil na plataforma (cadastro completo do influenciador). */
export interface ProfileActivation {
  address?: string
  /** Número e complemento do endereço (obrigatório quando allow_gifts). */
  address_number?: string
  zip_code?: string
  city?: string
  state?: string
  neighborhood?: string
  country?: string
  /** Autorização para marcas enviarem brindes ao endereço informado. */
  allow_gifts?: boolean
  whatsapp?: string
  tiktok?: string
  facebook?: string
  linkedin?: string
  twitter?: string
  websites?: string
  gender?: string
  description?: string
  about_topics?: string
  /** Tipos de conteúdo (ex.: fitness, moda, adulto). */
  content_type?: string[]
  /** Público que influencia: classes socioeconômicas (A, B, C, D). */
  influence_audience?: string[]
  /** Faixa etária que influencia (ex.: 18-24, 25-34). */
  influence_age_range?: string[]
  /** Gênero predominante do público (feminino, masculino, equilibrado, prefiro_nao_definir). */
  audience_gender?: string
  /** Marcas com as quais já trabalhou (texto livre, opcional). */
  brands_worked_with?: string
  pricing?: PricingData
  activated_at?: string
  updated_at?: string
}

export async function fetchProfileActivation(handle: string, options?: { campaignId?: string | null }): Promise<ProfileActivation> {
  const h = handle.replace(/^@/, '')
  const res = await fetch(`${API_BASE}/profiles/${encodeURIComponent(h)}/activation`, {
    headers: authHeadersWithCampaign(options?.campaignId),
  })
  if (!res.ok) throw new Error('Falha ao carregar ativação')
  const data = await res.json()
  if (!data || typeof data !== 'object' || (data as { _redacted?: boolean })._redacted === true) {
    return {}
  }
  return data as ProfileActivation
}

export async function saveProfileActivation(handle: string, data: Omit<ProfileActivation, 'activated_at' | 'updated_at'>): Promise<ProfileActivation> {
  const h = handle.replace(/^@/, '')
  const res = await fetch(`${API_BASE}/profiles/${encodeURIComponent(h)}/activation`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Falha ao salvar ativação')
  const out = await res.json()
  return out && typeof out === 'object' ? out : {}
}

/** Cadastro público como Assinante (sem pagamento). Retorna token + user.
 * CONTRATO BACKEND: ao criar o usuário, o backend deve disparar e-mail de validação e marcar o usuário como email_verified: false.
 * O endpoint GET /api/auth/me deve retornar user.email_verified (boolean) para o frontend bloquear pagamento até validação.
 */
export async function registerAssinanteApi(params: { email: string; password: string; name?: string }): Promise<{ token: string; user: { id: number; username: string; scope: string; profile_handle: string | null; email_verified?: boolean; display_name?: string | null }; email_sent?: boolean }> {
  const res = await fetch(`${API_BASE}/auth/register-assinante`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: params.email.trim().toLowerCase(),
      password: params.password,
      name: params.name?.trim() || undefined,
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Falha ao cadastrar')
  return data as { token: string; user: { id: number; username: string; scope: string; profile_handle: string | null; email_verified?: boolean; display_name?: string | null }; email_sent?: boolean }
}

/** Onboarding por e-mail no checkout: apenas cadastro (nome, e-mail, senha). Não cria pagamento.
 * Usa registerAssinanteApi. Backend deve enviar e-mail de validação ao criar a conta.
 */
export async function registerCheckoutUser(params: { email: string; password: string; name?: string }): Promise<{ token: string; user: { id: number; username: string; scope: string; profile_handle: string | null; email_verified?: boolean; display_name?: string | null }; email_sent?: boolean }> {
  return registerAssinanteApi(params)
}

/** Reenviar e-mail de validação para o usuário logado.
 * CONTRATO BACKEND: POST /api/auth/resend-verification (Authorization: Bearer token).
 * Resposta: { ok: true, email_sent?: boolean } ou { error: string }.
 */
export async function resendVerificationEmail(options?: { signal?: AbortSignal }): Promise<{ email_sent?: boolean }> {
  const res = await fetch(`${API_BASE}/auth/resend-verification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    signal: options?.signal,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Falha ao reenviar e-mail')
  return { email_sent: (data as { email_sent?: boolean }).email_sent }
}

/** Valida e-mail pelo token (link no e-mail). Backend concede 10 créditos (missão 1). */
export async function verifyEmailByToken(token: string, options?: { signal?: AbortSignal }): Promise<{ success: true; credits: number }> {
  const res = await fetch(`${API_BASE}/auth/verify-email?token=${encodeURIComponent(token)}`, { signal: options?.signal })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Link inválido ou expirado')
  return data as { success: true; credits: number }
}

/** Admin: tipos de usuário (scope). */
export type AuthScope = 'adm' | 'assinante' | 'influencer' | 'public'

export interface AdminDashboardStats {
  generatedAt: string
  rocksdb: { profiles: number; posts: number }
  sqlite: {
    available: boolean
    tables: Record<string, number>
    usersByScope?: { scope: string; count: number }[]
    campaignsByPayment?: { payment_status: string; count: number }[]
    paymentsByStatus?: { status: string; count: number }[]
  }
}

/** Evita 2× fetch no React Strict Mode (dev): mesma Promise até concluir. */
let adminDashboardStatsInFlight: Promise<AdminDashboardStats> | null = null

export async function fetchAdminDashboardStats(opts?: { fresh?: boolean }): Promise<AdminDashboardStats> {
  const fresh = opts?.fresh === true
  const url = fresh
    ? `${API_BASE}/admin/stats?fresh=1`
    : `${API_BASE}/admin/stats`

  const run = async (): Promise<AdminDashboardStats> => {
    const res = await fetch(url, { headers: { ...authHeaders() } })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(err?.error || 'Falha ao carregar estatísticas')
    }
    return (await res.json()) as AdminDashboardStats
  }

  if (fresh) {
    return run()
  }

  if (adminDashboardStatsInFlight) {
    return adminDashboardStatsInFlight
  }
  const p = run().finally(() => {
    if (adminDashboardStatsInFlight === p) {
      adminDashboardStatsInFlight = null
    }
  })
  adminDashboardStatsInFlight = p
  return p
}

/** Resposta de GET /api/admin/reports/unregistered-mentions */
export interface AdminUnregisteredMentionsReport {
  postsScanned: number
  profilesInDb: number
  uniqueMentions: number
  notRegisteredCount: number
  /** Handles com @ que não existem no bucket `profile` do RocksDB */
  notRegistered: string[]
}

export async function fetchAdminUnregisteredMentionsReport(): Promise<AdminUnregisteredMentionsReport> {
  const res = await fetch(`${API_BASE}/admin/reports/unregistered-mentions`, {
    headers: { ...authHeaders() },
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(err?.error || 'Falha ao gerar relatório de menções')
  }
  return (await res.json()) as AdminUnregisteredMentionsReport
}

export interface AdminUser {
  id: number
  username: string
  scope: AuthScope
  profile_handle: string | null
  created_at?: string
}

export async function fetchAdminUsers(): Promise<AdminUser[]> {
  const res = await fetch(`${API_BASE}/admin/users`, { headers: { ...authHeaders() } })
  if (!res.ok) throw new Error('Falha ao listar usuários')
  const data = await res.json()
  return (data?.users ?? []) as AdminUser[]
}

export async function createAdminUser(payload: {
  username: string
  password: string
  scope: AuthScope
  profile_handle?: string | null
}): Promise<AdminUser> {
  const res = await fetch(`${API_BASE}/admin/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || 'Falha ao criar usuário')
  }
  const data = await res.json()
  return data?.user as AdminUser
}

export async function updateAdminUser(
  id: number,
  payload: { username?: string; password?: string; scope?: AuthScope; profile_handle?: string | null }
): Promise<AdminUser> {
  const res = await fetch(`${API_BASE}/admin/users/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || 'Falha ao atualizar usuário')
  }
  const data = await res.json()
  return data?.user as AdminUser
}

export async function deleteAdminUser(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/admin/users/${id}`, {
    method: 'DELETE',
    headers: { ...authHeaders() },
  })
  if (!res.ok) throw new Error('Falha ao excluir usuário')
}

/** Admin: excluir influenciador por completo (dados locais + S3 + usuário se existir). */
export async function adminPurgeInfluencer(handle: string): Promise<{ ok: boolean; s3ObjectsRemoved?: number }> {
  const h = handle.replace(/^@/, '').trim()
  const res = await fetch(`${API_BASE}/admin/influencers/${encodeURIComponent(h)}`, {
    method: 'DELETE',
    headers: { ...authHeaders() },
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(err?.error || 'Falha ao excluir influenciador')
  }
  return (await res.json().catch(() => ({}))) as { ok: boolean; s3ObjectsRemoved?: number }
}

const ADMIN_PURGE_BATCH_CHUNK = 100

/** Admin: lista perfis do índice com filtros (inclui facetas LLM). */
export async function fetchAdminInfluencers(
  query: Partial<ProfilesSearchQuery>,
  options?: { signal?: AbortSignal; includeFacets?: boolean }
): Promise<ProfilesSearchResult> {
  const params = profilesSearchQueryToParams(query)
  if (options?.includeFacets === false) params.set('includeFacets', 'false')
  const res = await fetch(`${API_BASE}/admin/influencers?${params.toString()}`, {
    headers: { ...authHeaders() },
    signal: options?.signal,
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(err?.error || 'Falha ao listar influenciadores')
  }
  const data = (await res.json()) as ProfilesSearchResponse
  return { ...data, items: data.items ?? [] }
}

export interface AdminPurgeBatchResult {
  ok: boolean
  removed: string[]
  failed: { handle: string; error: string }[]
  s3ObjectsRemoved: number
}

/** Admin: purge em lote (várias requisições se > 100 handles). */
export async function adminPurgeInfluencersBatch(handles: string[]): Promise<AdminPurgeBatchResult> {
  const unique: string[] = []
  const seen = new Set<string>()
  for (const x of handles) {
    const h = String(x ?? '')
      .replace(/^@+/, '')
      .toLowerCase()
      .trim()
    if (!h || seen.has(h)) continue
    seen.add(h)
    unique.push(h)
  }
  const removed: string[] = []
  const failed: { handle: string; error: string }[] = []
  let s3ObjectsRemoved = 0
  for (let i = 0; i < unique.length; i += ADMIN_PURGE_BATCH_CHUNK) {
    const chunk = unique.slice(i, i + ADMIN_PURGE_BATCH_CHUNK)
    const res = await fetch(`${API_BASE}/admin/influencers/purge-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ handles: chunk }),
    })
    const data = (await res.json().catch(() => ({}))) as Partial<AdminPurgeBatchResult> & { error?: string }
    if (!res.ok) {
      throw new Error(data.error || 'Falha na exclusão em lote')
    }
    if (Array.isArray(data.removed)) removed.push(...data.removed)
    if (Array.isArray(data.failed)) failed.push(...data.failed)
    s3ObjectsRemoved += Number(data.s3ObjectsRemoved) || 0
  }
  return {
    ok: failed.length === 0,
    removed,
    failed,
    s3ObjectsRemoved,
  }
}

/** LGPD: excluir conta. Influencer: própria conta. Adm: pode passar handle para excluir conta de outro usuário. */
export async function deleteAccount(handle?: string): Promise<void> {
  const url = handle ? `${API_BASE}/account?handle=${encodeURIComponent(handle.replace(/^@/, ''))}` : `${API_BASE}/account`
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { ...authHeaders() },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(err?.error || 'Falha ao excluir conta')
  }
}

/** Projetos para influenciadores (estilo Workana). */
export interface ProjectItem {
  id: number
  title: string
  description: string
  client_name: string | null
  budget_min: number | null
  budget_max: number | null
  category: string | null
  requirements: string | null
  status: string
  created_at: string
  updated_at: string
  applications_count?: number
  has_applied?: boolean
}

export async function fetchProjects(params?: {
  status?: string
  category?: string
  limit?: number
  offset?: number
}): Promise<{ total: number; items: ProjectItem[] }> {
  const search = new URLSearchParams()
  if (params?.status) search.set('status', params.status)
  if (params?.category) search.set('category', params.category)
  if (params?.limit != null) search.set('limit', String(params.limit))
  if (params?.offset != null) search.set('offset', String(params.offset))
  const res = await fetch(`${API_BASE}/projects?${search.toString()}`, {
    headers: { ...authHeaders() },
  })
  if (res.status === 401) throw new Error('Faça login para ver os projetos')
  if (!res.ok) throw new Error('Falha ao carregar projetos')
  return res.json()
}

export async function fetchProject(id: number): Promise<ProjectItem | null> {
  const res = await fetch(`${API_BASE}/projects/${id}`, {
    headers: { ...authHeaders() },
  })
  if (res.status === 404) return null
  if (res.status === 401) throw new Error('Faça login para ver o projeto')
  if (!res.ok) throw new Error('Falha ao carregar projeto')
  return res.json()
}

export async function applyToProject(projectId: number, message?: string): Promise<void> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ message: message || '' }),
  })
  const data = await res.json().catch(() => ({})) as { error?: string }
  if (res.status === 401) throw new Error(data.error || 'Faça login para se candidatar')
  if (res.status === 409) throw new Error(data.error || 'Você já se candidatou')
  if (!res.ok) throw new Error(data.error || 'Falha ao enviar candidatura')
}

export async function createProject(payload: {
  title: string
  description: string
  client_name?: string
  budget_min?: number
  budget_max?: number
  category?: string
  requirements?: string
  status?: string
}): Promise<ProjectItem> {
  const res = await fetch(`${API_BASE}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  })
  const data = await res.json().catch(() => ({})) as ProjectItem & { error?: string }
  if (!res.ok) throw new Error(data.error || 'Falha ao criar projeto')
  return data
}
