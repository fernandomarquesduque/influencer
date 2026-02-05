const API_BASE = '/api'

/** Usa proxy da API para carregar imagem (evita bloqueio CORS/referrer do Instagram). */
export function proxyImageUrl(url: string | undefined): string | undefined {
  if (!url || typeof url !== 'string') return undefined
  return `${API_BASE}/proxy-image?url=${encodeURIComponent(url)}`
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
  [key: string]: unknown
}

/** Extrai URL da foto do perfil (lista e detalhe). Aceita qualquer objeto com profile_pic_url/data.user. */
export function getProfilePicUrl(item: ProfileItem | Record<string, unknown> | null | undefined): string | undefined {
  if (!item) return undefined
  const top = (item.profile_pic_url ?? item.hd_profile_pic_url) as string | undefined
  if (top && typeof top === 'string') return top
  const u = item.data?.user as Record<string, unknown> | undefined
  const fromUser = (u?.profile_pic_url ?? u?.hd_profile_pic_url) as string | undefined
  if (fromUser && typeof fromUser === 'string') return fromUser
  const hdInfo = u?.hd_profile_pic_url_info
  if (hdInfo != null && typeof hdInfo === 'object' && 'url' in (hdInfo as object)) {
    const url = (hdInfo as { url?: string }).url
    if (url && typeof url === 'string') return url
  }
  return undefined
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
  /** Média de posts por semana (baseado no intervalo de datas dos posts analisados). */
  posts_per_week?: number
}

/** Item da listagem com filtros (endpoint /api/profiles/search). */
export interface ProfileListItem {
  key: string
  handle: string
  full_name?: string
  profile_pic_url?: string
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
  | 'engagement_desc'
  | 'engagement_asc'
  | 'followers_desc'
  | 'followers_asc'
  | 'avg_likes_desc'
  | 'avg_likes_asc'
  | 'total_likes_desc'
  | 'total_likes_asc'

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
  /** Tipo de conteúdo (perfis ativados). */
  contentTypes?: string[]
  /** Faixas de preço por formato (valores em reais: 0, 500, 1000, 2500, 5000, 15000). */
  pricingPostUnique?: number[]
  pricingStories?: number[]
  pricingPackageMonthly?: number[]
  pricingCommission?: number[]
  pricingPermuta?: number[]
  pricingImageRights?: number[]
  pricingContentDelivery?: number[]
  pricingLaunch?: number[]
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
  /** Faixas de preço por formato (resultado da sumarização). */
  pricing?: {
    post_unique?: PricingFacetBucket[]
    stories?: PricingFacetBucket[]
    package_monthly?: PricingFacetBucket[]
    commission?: PricingFacetBucket[]
    permuta?: PricingFacetBucket[]
    image_rights?: PricingFacetBucket[]
    content_delivery?: PricingFacetBucket[]
    launch?: PricingFacetBucket[]
  }
}

export interface ProfilesSearchResponse {
  total: number
  items: ProfileListItem[]
  facets?: ProfilesSearchFacets
}

export async function fetchProfilesSearch(query: ProfilesSearchQuery): Promise<ProfilesSearchResponse> {
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
  if (query.contentTypes?.length) params.set('contentTypes', query.contentTypes.join(','))
  if (query.pricingPostUnique?.length) params.set('pricingPostUnique', query.pricingPostUnique.join(','))
  if (query.pricingStories?.length) params.set('pricingStories', query.pricingStories.join(','))
  if (query.pricingPackageMonthly?.length) params.set('pricingPackageMonthly', query.pricingPackageMonthly.join(','))
  if (query.pricingCommission?.length) params.set('pricingCommission', query.pricingCommission.join(','))
  if (query.pricingPermuta?.length) params.set('pricingPermuta', query.pricingPermuta.join(','))
  if (query.pricingImageRights?.length) params.set('pricingImageRights', query.pricingImageRights.join(','))
  if (query.pricingContentDelivery?.length) params.set('pricingContentDelivery', query.pricingContentDelivery.join(','))
  if (query.pricingLaunch?.length) params.set('pricingLaunch', query.pricingLaunch.join(','))
  if (query.sort) params.set('sort', query.sort)
  if (query.limit != null) params.set('limit', String(query.limit))
  if (query.offset != null) params.set('offset', String(query.offset))
  const res = await fetch(`${API_BASE}/profiles/search?${params.toString()}`)
  if (!res.ok) throw new Error('Falha ao buscar perfis')
  return res.json()
}

export interface PostMedia {
  cover_images?: Array<{ width: number; height: number; url: string }>
  video_versions?: Array<{ width: number; height: number; url: string }>
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
  influencer?: { username?: string; full_name?: string; profile_pic_url?: string }
  post?: { shortcode?: string; media_type?: number; taken_at?: number; collected_at?: string;[k: string]: unknown }
  content?: PostContent
  media?: PostMedia
  metrics?: PostMetrics
  image_url?: string
  video_url?: string
  [key: string]: unknown
}

export interface PostsResponse {
  total: number
  items: PostItem[]
}

export async function fetchProfiles(limit = 50, offset = 0, since?: string): Promise<ProfilesResponse> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  if (since) params.set('since', since)
  const res = await fetch(`${API_BASE}/profiles?${params.toString()}`)
  if (!res.ok) throw new Error('Falha ao carregar perfis')
  return res.json()
}

export async function fetchProfile(handle: string): Promise<ProfileItem | null> {
  const h = handle.replace(/^@/, '')
  const res = await fetch(`${API_BASE}/profiles/${encodeURIComponent(h)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error('Falha ao carregar perfil')
  return res.json()
}

export async function fetchPosts(profileHandle: string, limit = 50, offset = 0): Promise<PostsResponse> {
  const h = profileHandle.replace(/^@/, '')
  const res = await fetch(`${API_BASE}/posts?profile=${encodeURIComponent(h)}&limit=${limit}&offset=${offset}`)
  if (!res.ok) throw new Error('Falha ao carregar posts')
  return res.json()
}

/** Status do crawl (GET /api/crawl/status). */
export interface CrawlStatusResponse {
  running: boolean
  last?: { saved: number; tag: string; finishedAt: string }
}

export async function fetchCrawlStatus(): Promise<CrawlStatusResponse> {
  const res = await fetch(`${API_BASE}/crawl/status`)
  if (!res.ok) throw new Error('Falha ao obter status do crawl')
  return res.json()
}

/** Inicia o crawl (POST /api/crawl). Retorna 202 com started: true. */
export async function startCrawl(params: { tag: string; limit?: number; clear?: boolean }): Promise<{ started: boolean; tag: string; limit: number | null; clear?: boolean }> {
  const res = await fetch(`${API_BASE}/crawl`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  const res = await fetch(`${API_BASE}/crawl/stop`, { method: 'POST' })
  if (!res.ok) throw new Error('Falha ao parar crawl')
  return res.json()
}

/** Resultado da extração de um perfil específico (POST /api/crawl/extract-profile). */
export interface ExtractProfileResult {
  success: boolean
  saved?: boolean
  handle: string
  rejectionReason?: string
  diagnostic?: {
    pass: boolean
    reason?: string
    accountType?: number
    followers: number
    category?: string
    isBusiness?: boolean
    minRequired?: number
  }
  error?: string
  followers?: number
  postsSaved?: number
}

/** Extrai um perfil específico por URL ou handle (POST /api/crawl/extract-profile). Pode demorar ~1 min. */
export async function extractProfileToBackend(handleOrUrl: string): Promise<ExtractProfileResult> {
  const res = await fetch(`${API_BASE}/crawl/extract-profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      handleOrUrl.startsWith('http') ? { url: handleOrUrl } : { handle: handleOrUrl }
    ),
  })
  const data = await res.json().catch(() => ({}))
  if (res.status === 400) throw new Error(data.error || 'Handle ou URL inválido')
  if (res.status === 500) throw new Error(data.error || 'Erro ao extrair perfil')
  return data
}

/** Valores/tarifas (8 tipos de entrega). */
export interface PricingData {
  post_unique?: string
  stories?: string
  package_monthly?: string
  commission?: string
  permuta?: string
  image_rights?: string
  content_delivery?: string
  launch?: string
}

/** Dados de ativação do perfil na plataforma (cadastro completo do influenciador). */
export interface ProfileActivation {
  address?: string
  city?: string
  state?: string
  neighborhood?: string
  country?: string
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
  pricing?: PricingData
  activated_at?: string
  updated_at?: string
}

export async function fetchProfileActivation(handle: string): Promise<ProfileActivation> {
  const h = handle.replace(/^@/, '')
  const res = await fetch(`${API_BASE}/profiles/${encodeURIComponent(h)}/activation`)
  if (!res.ok) throw new Error('Falha ao carregar ativação')
  const data = await res.json()
  return data && typeof data === 'object' ? data : {}
}

export async function saveProfileActivation(handle: string, data: Omit<ProfileActivation, 'activated_at' | 'updated_at'>): Promise<ProfileActivation> {
  const h = handle.replace(/^@/, '')
  const res = await fetch(`${API_BASE}/profiles/${encodeURIComponent(h)}/activation`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Falha ao salvar ativação')
  const out = await res.json()
  return out && typeof out === 'object' ? out : {}
}
