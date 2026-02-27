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

/** Usa proxy da API para carregar imagem (evita CORS/CORP do CDN do Instagram). Em caso de 403, o backend tenta fallback via proxy público. */
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
  | 'relevance_desc'
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

export async function fetchProfilesSearch(
  query: ProfilesSearchQuery,
  options?: { signal?: AbortSignal }
): Promise<ProfilesSearchResponse> {
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
  const res = await fetch(`${API_BASE}/profiles/search?${params.toString()}`, {
    headers: { ...authHeaders() },
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
  const res = await fetch(`${API_BASE}/profiles?${params.toString()}`, {
    headers: { ...authHeaders() },
  })
  if (res.status === 401) throw new Error('Faça login para acessar a lista de perfis')
  if (!res.ok) throw new Error('Falha ao carregar perfis')
  return res.json()
}

export async function fetchProfile(handle: string): Promise<ProfileItem | null> {
  const h = handle.replace(/^@/, '')
  const res = await fetch(`${API_BASE}/profiles/${encodeURIComponent(h)}`, {
    headers: { ...authHeaders() },
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

/** Valida com o código recebido no Instagram. Sem login: retorna token+user (2FA como login). */
export async function verifyProfile(
  nickname: string,
  code: string
): Promise<{
  verified: boolean
  profile_handle: string
  token?: string
  user?: { id: number; username: string; scope: AuthScope; profile_handle: string | null }
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

export async function fetchPosts(profileHandle: string, limit = 50, offset = 0): Promise<PostsResponse> {
  const h = profileHandle.replace(/^@/, '')
  const res = await fetch(`${API_BASE}/posts?profile=${encodeURIComponent(h)}&limit=${limit}&offset=${offset}`, {
    headers: { ...authHeaders() },
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
  const res = await fetch(`${API_BASE}/profiles/${encodeURIComponent(h)}/activation`, {
    headers: { ...authHeaders() },
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

/** Admin: tipos de usuário (scope). */
export type AuthScope = 'adm' | 'assinante' | 'influencer' | 'public'

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
