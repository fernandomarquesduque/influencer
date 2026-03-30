/**
 * Insights do relatório "versão que vende" — só com dados do RocksDB (perfil + posts).
 * Fórmulas e textos PT-BR para Score, Diagnóstico, Provas, Crescimento, Nicho, Oportunidades, Benchmark, Valor, Profissionalismo.
 */

import type { PostItem, ProfileItem } from '../api'
import type { EngagementStats } from '../api'
import { computeEngagementFromPosts } from './engagement'

export const REPORT_POSTS_LIMIT = 25

function toNum(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.floor(v)
  if (typeof v === 'string') {
    const n = parseInt(v.replace(/\D/g, ''), 10)
    return Number.isNaN(n) ? 0 : n
  }
  return 0
}

/** Extrai número de seguidores do perfil (top-level, data.user.follower_count ou data.user.edge_followed_by.count). */
function getFollowersCount(profile: ProfileItem | null | undefined): number {
  if (!profile) return 0
  if (typeof profile.followers_count === 'number' && profile.followers_count >= 0) return profile.followers_count
  const user = profile.data?.user as Record<string, unknown> | undefined
  if (user && typeof (user as { follower_count?: number }).follower_count === 'number')
    return (user as { follower_count: number }).follower_count
  const edge = user?.edge_followed_by as { count?: number } | undefined
  if (edge != null && typeof edge.count === 'number') return edge.count
  return 0
}

export function getPostTimestamp(p: PostItem): number | null {
  const takenAt = p.post?.taken_at
  if (takenAt != null && typeof takenAt === 'number') return takenAt
  const captionAt = p.content?.caption_created_at
  if (captionAt != null && typeof captionAt === 'number') return captionAt
  const collected = p.post?.collected_at
  if (collected != null && typeof collected === 'string') {
    const d = new Date(collected)
    return Number.isNaN(d.getTime()) ? null : Math.floor(d.getTime() / 1000)
  }
  return null
}

/** Conta posts por dia da semana (0=Dom .. 6=Sáb) usando TODOS os posts, sem filtrar por período. */
export function getPostsPerWeekdayAllTime(posts: PostItem[]): number[] {
  const counts = [0, 0, 0, 0, 0, 0, 0]
  for (const p of posts) {
    const ts = getPostTimestamp(p)
    if (ts != null) {
      const day = new Date(ts * 1000).getDay()
      counts[day] = (counts[day] ?? 0) + 1
    }
  }
  return counts
}

/** Soma engajamento (curtidas + comentários) por dia da semana (0=Dom .. 6=Sáb) usando TODOS os posts. */
export function getEngagementPerWeekdayAllTime(posts: PostItem[]): number[] {
  const totals = [0, 0, 0, 0, 0, 0, 0]
  for (const p of posts) {
    const ts = getPostTimestamp(p)
    if (ts != null) {
      const day = new Date(ts * 1000).getDay()
      const likes = toNum(p.metrics?.likes ?? (p as { like_count?: number }).like_count)
      const comments = toNum(p.metrics?.comments ?? (p as { comment_count?: number }).comment_count)
      totals[day] = (totals[day] ?? 0) + likes + comments
    }
  }
  return totals
}

/** Agrupa posts por dia da semana (0=Dom .. 6=Sáb). Retorna array de 7 arrays de PostItem. */
export function getPostsByWeekday(posts: PostItem[]): PostItem[][] {
  const byDay: PostItem[][] = [[], [], [], [], [], [], []]
  for (const p of posts) {
    const ts = getPostTimestamp(p)
    if (ts != null) {
      const day = new Date(ts * 1000).getDay()
      byDay[day].push(p)
    }
  }
  return byDay
}

/** Pilares do Score 0–100 (cada um 0–100, média ponderada). */
export interface ScorePillars {
  comunidade: number      // qualidade do engajamento: % comentários
  consistencia: number    // cadência posts/semana
  alcance: number         // views quando tem, senão proxy por interações
  autoridade: number      // is_verified, bio, external_url, business/creator
  conteudo: number        // % posts acima de um mínimo de performance
}

export interface InfluencerScore {
  total: number
  pillars: ScorePillars
  selo: string  // ex: "Comunidade Forte", "Alta Consistência"
}

/** Score 0–100 composto por 5 pilares (só RocksDB). */
export function computeInfluencerScore(
  profile: ProfileItem | null,
  posts: PostItem[],
  engagement: EngagementStats
): InfluencerScore {
  const followersCount = getFollowersCount(profile)
  const userData = profile?.data?.user as Record<string, unknown> | undefined

  const totalInteractions = engagement.total_likes + engagement.total_comments
  const conversationRatio = totalInteractions > 0
    ? engagement.total_comments / totalInteractions
    : 0
  const comunidade = Math.min(100, Math.round(conversationRatio * 250)) // 40%+ comentários = 100

  const postsPerWeek = engagement.posts_per_week ?? 0
  let consistencia = postsPerWeek >= 3 ? 100 : postsPerWeek >= 1 ? 60 : postsPerWeek >= 0.5 ? 30 : Math.min(30, Math.round(postsPerWeek * 60))
  // Penaliza quando há lacunas longas (ex.: postou 5x em 1 semana e nada por 2 meses)
  const timestamps = posts.map(getPostTimestamp).filter((t): t is number => t != null).sort((a, b) => a - b)
  let maxGapDays = 0
  for (let i = 1; i < timestamps.length; i++) {
    const gap = (timestamps[i] - timestamps[i - 1]) / (24 * 3600)
    if (gap > maxGapDays) maxGapDays = Math.round(gap)
  }
  if (maxGapDays > 14) consistencia = Math.max(0, Math.round(consistencia * 0.7))
  else if (maxGapDays > 7) consistencia = Math.max(0, Math.round(consistencia * 0.9))

  const hasViews = engagement.total_views > 0
  const avgViews = engagement.avg_views ?? 0
  const erByViews = engagement.engagement_rate_by_views ?? 0
  const alcance = hasViews && followersCount > 0
    ? Math.min(100, Math.round((avgViews / followersCount) * 400 + erByViews * 3))
    : Math.min(100, Math.round((engagement.engagement_rate ?? 0) * 8))

  let autoridade = 0
  if (profile?.is_verified ?? userData?.is_verified) autoridade += 30
  if ((profile?.biography ?? userData?.biography) && String(profile?.biography ?? userData?.biography).trim().length >= 20) autoridade += 25
  if ((profile as Record<string, unknown>)?.external_url ?? userData?.external_url) autoridade += 25
  const accountType = (userData?.account_type ?? (profile as Record<string, unknown>)?.account_type) as number | undefined
  if (accountType === 2 || accountType === 3) autoridade += 20
  autoridade = Math.min(100, autoridade)

  const minPerformance = followersCount > 0 ? (followersCount * 0.01) : 10
  const VIEW_TO_ENGAGE_MIN = 0.01 // 1% view-to-engage para reels/vídeos com views
  let aboveMin = 0
  for (const p of posts) {
    const likes = toNum(p.metrics?.likes)
    const comments = toNum(p.metrics?.comments)
    const views = toNum(p.metrics?.view_count ?? (p as { view_count?: number }).view_count)
    const interactions = likes + comments
    const byFollowers = interactions >= minPerformance
    const byViews = views > 0 && interactions / views >= VIEW_TO_ENGAGE_MIN
    if (byFollowers || byViews) aboveMin++
  }
  const conteudo = posts.length > 0 ? Math.min(100, Math.round((aboveMin / posts.length) * 100)) : 50

  const total = Math.round(
    comunidade * 0.25 +
    consistencia * 0.20 +
    alcance * 0.25 +
    autoridade * 0.15 +
    conteudo * 0.15
  )
  const clampedTotal = Math.max(0, Math.min(100, total))

  let selo = 'Em crescimento'
  if (clampedTotal >= 75) selo = 'Comunidade Forte'
  else if (clampedTotal >= 60) selo = 'Alta Consistência'
  else if (clampedTotal >= 45) selo = 'Potencial Alto'
  else if (conversationRatio >= 0.15) selo = 'Audiência Envolvida'

  return {
    total: clampedTotal,
    pillars: { comunidade, consistencia, alcance, autoridade, conteudo },
    selo,
  }
}

/** Headline + 3 bullets (o que faz bem, o que trava, o que fazer primeiro). */
export interface DiagnosticoIA {
  headline: string
  fazBem: string
  trava: string
  fazerPrimeiro: string
}

export function getDiagnosticoIA(
  _profile: ProfileItem | null,
  posts: PostItem[],
  engagement: EngagementStats,
  _score: InfluencerScore
): DiagnosticoIA {
  const postsPerWeek = engagement.posts_per_week ?? 0
  const totalInteractions = engagement.total_likes + engagement.total_comments
  const conversationRatio = posts.length > 0 && totalInteractions > 0
    ? engagement.total_comments / totalInteractions
    : 0
  const er = engagement.engagement_rate ?? 0

  let headline: string
  if (er >= 5 && postsPerWeek < 1) {
    headline = 'Perfil com comunidade forte, mas crescimento travado por baixa frequência.'
  } else if (er >= 5 && conversationRatio >= 0.12) {
    headline = 'Perfil com engajamento acima da média e audiência que conversa.'
  } else if (postsPerWeek < 0.5) {
    headline = 'Potencial alto de engajamento; a frequência de posts limita o alcance.'
  } else if (er < 2 && postsPerWeek >= 2) {
    headline = 'Boa consistência; aumentar a conexão com a audiência pode multiplicar resultados.'
  } else if (er >= 5) {
    headline = 'Perfil com engajamento forte e conexão real com a audiência.'
  } else {
    headline = 'Perfil em evolução: pequenos ajustes podem elevar bastante seu desempenho.'
  }

  const fazBem = er >= 4
    ? `O engajamento de ${er.toFixed(2)}% está acima da média e mostra conexão com a audiência.`
    : `Você mantém presença no feed; há espaço para crescer o engajamento.`
  const trava = postsPerWeek < 1
    ? `A baixa frequência (${postsPerWeek.toFixed(1)} posts/semana) limita alcance e oportunidades.`
    : conversationRatio < 0.08
      ? 'Poucos comentários em relação às curtidas; a audiência poderia participar mais.'
      : 'Alguns ajustes de conteúdo e CTA podem aumentar ainda mais o engajamento.'
  const fazerPrimeiro = postsPerWeek < 1
    ? 'Defina uma meta de pelo menos 2–3 posts por semana e cumpra nos próximos 30 dias.'
    : conversationRatio < 0.1
      ? 'Inclua perguntas ou pedidos de opinião no final das legendas para aumentar comentários.'
      : 'Mantenha a consistência e teste 8–12 hashtags por post para ampliar descoberta.'
  return { headline, fazBem, trava, fazerPrimeiro }
}

/** Média de taxa de conversa para nanos (comentários / interações). */
const CONVERSATION_AVG_NANO = 6

/** Conversation Rate = comments / (likes + comments). Classificação. */
export interface ConversationInsight {
  rate: number
  label: string
  color: 'success' | 'warning' | 'danger'
  /** Comparação aspiracional quando acima da média (ex.: "2x mais que a média dos nanos") */
  comparisonLabel?: string
}

export function getConversationRate(engagement: EngagementStats): ConversationInsight {
  const total = engagement.total_likes + engagement.total_comments
  const rate = total > 0 ? engagement.total_comments / total : 0
  const pct = Math.round(rate * 100)
  if (pct >= 12) {
    const mult = CONVERSATION_AVG_NANO > 0 ? (pct / CONVERSATION_AVG_NANO).toFixed(1).replace('.0', '') : '2'
    return {
      rate: pct,
      label: 'Comunidade conversadora',
      color: 'success',
      comparisonLabel: `${mult}× mais que a média dos nanos — marcas pagam mais por isso.`,
    }
  }
  if (pct >= 6) {
    return { rate: pct, label: 'Médio', color: 'warning' }
  }
  return { rate: pct, label: 'Público passivo', color: 'danger' }
}

/** Post com métricas e "o que funcionou" inferido. */
export interface TopPostInfo {
  post: PostItem
  interactions: number
  erPost: number
  conversationRatio: number
  oQueFuncionou: string
}

function inferOQueFuncionou(post: PostItem, followersCount: number): string {
  const likes = toNum(post.metrics?.likes)
  const comments = toNum(post.metrics?.comments)
  const views = toNum(post.metrics?.view_count)
  const hashtags = post.content?.hashtags?.length ?? 0
  const captionLen = (post.content?.caption_text ?? '').length
  const isVideo = (post.post?.media_type ?? 0) === 2 || (post.media?.video_versions?.length ?? 0) > 0
  const parts: string[] = []
  if (comments >= 5 && likes > 0 && comments / (likes + comments) >= 0.1) parts.push('conversa nos comentários')
  if (hashtags >= 5) parts.push('hashtags segmentadas')
  if (captionLen >= 80) parts.push('legenda que engaja')
  if (isVideo && views > 0) parts.push('vídeo com alcance')
  if (likes > followersCount * 0.05) parts.push('alto alcance orgânico')
  if (parts.length === 0) {
    if (isVideo) parts.push('conteúdo em vídeo')
    else if (hashtags > 0) parts.push('uso de hashtags')
    else parts.push('conteúdo visual')
  }
  return parts.slice(0, 2).join(' • ') || 'Conteúdo relevante'
}

export function getTopPosts(
  posts: PostItem[],
  followersCount: number
): { byInteractions: TopPostInfo[]; byInteractionsAll: TopPostInfo[]; byConversation: TopPostInfo[]; byViews: TopPostInfo[] } {
  const withMeta: TopPostInfo[] = posts.map((post) => {
    const likes = toNum(post.metrics?.likes)
    const comments = toNum(post.metrics?.comments)
    // Interações = só curtidas + comentários (nunca view_count para posts/reels/marcados)
    let interactions = likes + comments
    // Destaques costumam ter só view_count; usa como "interações" para ordenar e exibir ER
    if (interactions === 0 && post.content_type === 'highlight') {
      const views = toNum(post.metrics?.view_count)
      if (views > 0) interactions = views
    }
    const erPost = followersCount > 0 ? (interactions / followersCount) * 100 : 0
    const conversationRatio = interactions > 0 ? comments / interactions : 0
    return {
      post,
      interactions,
      erPost,
      conversationRatio,
      oQueFuncionou: inferOQueFuncionou(post, followersCount),
    }
  })

  const byInteractionsSorted = [...withMeta].sort((a, b) => b.interactions - a.interactions)
  const byInteractions = byInteractionsSorted.slice(0, 4)
  const byInteractionsAll = byInteractionsSorted
  const byConversation = [...withMeta].filter((a) => a.interactions >= 5).sort((a, b) => b.conversationRatio - a.conversationRatio).slice(0, 3)
  const byViews = [...withMeta].filter((a) => (a.post.metrics?.view_count ?? 0) > 0).sort((a, b) => toNum(b.post.metrics?.view_count) - toNum(a.post.metrics?.view_count)).slice(0, 3)

  return { byInteractions, byInteractionsAll, byConversation, byViews }
}

/** Consistência: posts por semana (últimas 8 semanas), heatmap (dia x semana), melhor dia/hora. */
const SECONDS_PER_WEEK = 7 * 24 * 3600

export interface ConsistencyInsight {
  postsPerWeekByWeek: number[]
  heatmap: number[][]  // [weekIndex 0..7][weekday 0..6]
  bestWeekday: number  // 0 dom, 6 sáb
  bestHour: number
  maxGapDays: number
}

const WEEKDAY_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
export function getWeekdayName(d: number): string {
  return WEEKDAY_NAMES[d] ?? ''
}

export function getConsistency(posts: PostItem[]): ConsistencyInsight {
  const timestamps = posts.map(getPostTimestamp).filter((t): t is number => t != null).sort((a, b) => a - b)
  const now = Math.floor(Date.now() / 1000)
  const eightWeeksAgo = now - 8 * SECONDS_PER_WEEK
  const inRange = timestamps.filter((t) => t >= eightWeeksAgo)

  const postsPerWeekByWeek: number[] = []
  for (let w = 0; w < 8; w++) {
    const start = eightWeeksAgo + w * SECONDS_PER_WEEK
    const end = start + SECONDS_PER_WEEK
    postsPerWeekByWeek.push(inRange.filter((t) => t >= start && t < end).length)
  }

  const heatmap: number[][] = Array.from({ length: 8 }, () => Array(7).fill(0))
  for (const t of inRange) {
    const d = new Date(t * 1000)
    const weekIndex = Math.min(7, Math.floor((t - eightWeeksAgo) / SECONDS_PER_WEEK))
    const weekday = d.getDay()
    heatmap[weekIndex][weekday]++
  }

  const weekdayCounts = [0, 0, 0, 0, 0, 0, 0]
  const hourCounts = Array(24).fill(0)
  for (const t of inRange) {
    const d = new Date(t * 1000)
    weekdayCounts[d.getDay()]++
    hourCounts[d.getHours()]++
  }
  const bestWeekday = weekdayCounts.indexOf(Math.max(...weekdayCounts))
  const bestHour = hourCounts.indexOf(Math.max(...hourCounts))

  let maxGapDays = 0
  for (let i = 1; i < timestamps.length; i++) {
    const gap = (timestamps[i] - timestamps[i - 1]) / (24 * 3600)
    if (gap > maxGapDays) maxGapDays = Math.round(gap)
  }

  return {
    postsPerWeekByWeek,
    heatmap,
    bestWeekday,
    bestHour,
    maxGapDays,
  }
}

/** Série temporal: agregado por semana (últimas 8) — curtidas, comentários, ER. */
export interface TimeSeriesWeek {
  weekIndex: number
  weekLabel: string
  likes: number
  comments: number
  count: number
  er: number
}

export function getTimeSeriesByWeek(posts: PostItem[], followersCount: number): TimeSeriesWeek[] {
  const now = Math.floor(Date.now() / 1000)
  const eightWeeksAgo = now - 8 * SECONDS_PER_WEEK
  const out: TimeSeriesWeek[] = []
  for (let w = 0; w < 8; w++) {
    const start = eightWeeksAgo + w * SECONDS_PER_WEEK
    const end = start + SECONDS_PER_WEEK
    const weekPosts = posts.filter((p) => {
      const ts = getPostTimestamp(p)
      return ts != null && ts >= start && ts < end
    })
    let likes = 0
    let comments = 0
    for (const p of weekPosts) {
      likes += toNum(p.metrics?.likes ?? (p as { like_count?: number }).like_count)
      comments += toNum(p.metrics?.comments ?? (p as { comment_count?: number }).comment_count)
    }
    const interactions = likes + comments
    const er = followersCount > 0 && weekPosts.length > 0 ? (interactions / weekPosts.length / followersCount) * 100 : 0
    const d = new Date((start + end) / 2 * 1000)
    const month = d.getMonth() + 1
    const day = d.getDate()
    const weekLabel = `${day}/${month}`
    out.push({ weekIndex: w, weekLabel, likes, comments, count: weekPosts.length, er })
  }
  return out
}

/** Sugestões de hashtags por nicho (5 por nicho). Nicho em minúsculo. */
const SUGESTOES_HASHTAG_POR_NICHO: Record<string, string[]> = {
  lifestyle: ['lifestyle', 'diaadadia', 'rotina', 'vida', 'momentos'],
  moda: ['moda', 'estilo', 'look', 'fashion', 'ootd'],
  fitness: ['fitness', 'treino', 'academia', 'saude', 'vidasaudavel'],
  beleza: ['beleza', 'skincare', 'maquiagem', 'autocuidado', 'dicas'],
  comida: ['gastronomia', 'receitas', 'comida', 'food', 'culinaria'],
  viagem: ['viagem', 'turismo', 'lugares', 'explorar', 'turismo'],
  tecnologia: ['tech', 'tecnologia', 'dicas', 'inovacao', 'digital'],
  corridamaluca: ['corrida', 'corridamaluca', 'esportes', 'prova', 'treino'],
  maternidade: ['maternidade', 'mae', 'bebe', 'familia', 'gravidez'],
  humor: ['humor', 'memes', 'comedia', 'risos', 'entretenimento'],
}

function getHashtagsSugeridasPorNicho(nicho: string): string[] {
  const key = nicho.toLowerCase().replace(/\s+/g, '')
  return SUGESTOES_HASHTAG_POR_NICHO[key] ?? SUGESTOES_HASHTAG_POR_NICHO.lifestyle
}

/** Nicho: top hashtags, hashtags que performam, hashtags que geram conversa, sugestões, nicho dominante + subtemas. */
export interface NichoInsight {
  topHashtags: { tag: string; count: number }[]
  performingHashtags: { tag: string; avgEr: number; count: number }[]
  conversationHashtags: { tag: string; avgConversation: number }[]
  /** 5 hashtags sugeridas baseadas no nicho */
  hashtagsSugeridas: string[]
  nichoDominante: string
  subtemas: string[]
}

export function getNichoInsight(posts: PostItem[], followersCount: number): NichoInsight {
  const tagCount: Record<string, number> = {}
  const tagInteractions: Record<string, number[]> = {}
  const tagConversation: Record<string, number[]> = {}
  for (const p of posts) {
    const tags = (p.content?.hashtags ?? []).filter((h): h is string => typeof h === 'string').map((h) => h.replace(/^#/, '').trim().toLowerCase()).filter(Boolean)
    const likes = toNum(p.metrics?.likes)
    const comments = toNum(p.metrics?.comments)
    const interactions = likes + comments
    const er = followersCount > 0 ? (interactions / followersCount) * 100 : 0
    const conv = interactions > 0 ? (comments / interactions) * 100 : 0
    for (const tag of tags) {
      tagCount[tag] = (tagCount[tag] ?? 0) + 1
      if (!tagInteractions[tag]) tagInteractions[tag] = []
      tagInteractions[tag].push(er)
      if (interactions >= 5) {
        if (!tagConversation[tag]) tagConversation[tag] = []
        tagConversation[tag].push(conv)
      }
    }
  }
  const topHashtags = Object.entries(tagCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag, count]) => ({ tag, count }))
  const performingHashtags = Object.entries(tagInteractions)
    .filter(([, ers]) => ers.length >= 2)
    .map(([tag, ers]) => ({
      tag,
      avgEr: ers.reduce((a, b) => a + b, 0) / ers.length,
      count: ers.length,
    }))
    .sort((a, b) => b.avgEr - a.avgEr)
    .slice(0, 5)
  const conversationHashtags = Object.entries(tagConversation)
    .filter(([, convs]) => convs.length >= 2)
    .map(([tag, convs]) => ({
      tag,
      avgConversation: convs.reduce((a, b) => a + b, 0) / convs.length,
    }))
    .filter((a) => a.avgConversation >= 8)
    .sort((a, b) => b.avgConversation - a.avgConversation)
    .slice(0, 5)

  const topTags = topHashtags.slice(0, 3).map((t) => t.tag)
  const nichoDominante = topTags.length >= 1 ? topTags[0] : 'Lifestyle'
  const subtemas = topTags.slice(1)
  const hashtagsSugeridas = getHashtagsSugeridasPorNicho(nichoDominante)

  return {
    topHashtags,
    performingHashtags,
    conversationHashtags,
    hashtagsSugeridas,
    nichoDominante,
    subtemas,
  }
}

/** Match para marca (ex.: pizzaria): por que este perfil serve. Heurístico com hashtags, local, consistência, top post. */
export function getMatchMarca(
  locationString: string,
  nicho: NichoInsight,
  consistency: ConsistencyInsight,
  topPosts: { byInteractions: TopPostInfo[] },
  brandExample: string = 'marcas locais (ex.: pizzaria)'
): { titulo: string; bullets: string[] } {
  const titulo = `Por que este perfil é bom para: ${brandExample}`
  const bullets: string[] = []
  if (locationString && locationString !== '—') {
    bullets.push(`Audiência local: ${locationString}.`)
  }
  const temas = [nicho.nichoDominante, ...nicho.subtemas.slice(0, 2)].join(', ').toLowerCase()
  bullets.push(`Conteúdo de ${temas}.`)
  bullets.push(`Melhor dia/hora para postar: ${getWeekdayName(consistency.bestWeekday)} às ${consistency.bestHour}h.`)
  const top = topPosts.byInteractions[0]
  if (top) {
    bullets.push(`Exemplo de post que performa: ${top.oQueFuncionou}.`)
  }
  return { titulo, bullets }
}

/** Oportunidades (gaps) só com RocksDB. */
export interface Oportunidade {
  id: string
  titulo: string
  sugestao: string
}

export function getOportunidades(profile: ProfileItem | null, posts: PostItem[]): Oportunidade[] {
  const userData = profile?.data?.user as Record<string, unknown> | undefined
  const out: Oportunidade[] = []
  const allHashtags = new Set<string>()
  for (const p of posts) {
    for (const h of (p.content?.hashtags ?? [])) {
      if (typeof h === 'string') allHashtags.add(h.replace(/^#/, '').trim().toLowerCase())
    }
  }
  if (allHashtags.size < 5) {
    out.push({
      id: 'hashtags',
      titulo: 'Você usa poucas hashtags',
      sugestao: 'Use 8–12 hashtags por post para aumentar a descoberta do seu conteúdo.',
    })
  }
  const externalUrl = (profile as Record<string, unknown>)?.external_url ?? userData?.external_url
  if (!externalUrl || String(externalUrl).trim() === '') {
    out.push({
      id: 'link',
      titulo: 'Sem link na bio',
      sugestao: 'Adicione um link (site, loja ou linktree) para marcas e parcerias.',
    })
  }
  const bio = (profile?.biography ?? userData?.biography) as string | undefined
  if (!bio || bio.trim().length < 30) {
    out.push({
      id: 'bio',
      titulo: 'Bio curta ou vazia',
      sugestao: 'Complete sua bio com quem você é e que tipo de parcerias busca.',
    })
  }
  const accountType = (userData?.account_type ?? (profile as Record<string, unknown>)?.account_type) as number | undefined
  if (accountType === 1) {
    out.push({
      id: 'conta',
      titulo: 'Conta pessoal',
      sugestao: 'Migre para Criador ou Empresa para acessar métricas e ferramentas profissionais.',
    })
  }
  if (profile?.is_private) {
    out.push({
      id: 'privado',
      titulo: 'Perfil privado',
      sugestao: 'Marcas precisam ver seu conteúdo. Considere tornar o perfil público para parcerias.',
    })
  }
  return out
}

/**
 * Benchmark por faixa de seguidores — alinhado a `crawl/src/api/followersSizeBuckets.ts`
 * (macro até 1M; celebridade 1M+). Percentil estimado.
 */
const BENCHMARKS: { min: number; max: number; label: string; erMin: number; erMid: number; erMax: number }[] = [
  { min: 0, max: 10_000, label: 'Nano', erMin: 2, erMid: 5, erMax: 10 },
  { min: 10_000, max: 50_000, label: 'Micro', erMin: 1.5, erMid: 4, erMax: 7 },
  { min: 50_000, max: 200_000, label: 'Mid', erMin: 1, erMid: 3, erMax: 5 },
  { min: 200_000, max: 1_000_000, label: 'Macro', erMin: 0.5, erMid: 1.5, erMax: 3 },
  { min: 1_000_000, max: Infinity, label: 'Celebridade', erMin: 0.2, erMid: 0.8, erMax: 2 },
]

/** Retorna info sobre próximo patamar e progresso no atual. */
export function getPatamarProximo(followersCount: number, er?: number): {
  patamarAtual: string
  proximoPatamar: string | null
  faltaSeguidores: number
  percentualNoPatamar: number
  insightPatamar: string
  insightErProximo: string | null
  limiarProximo: number
} {
  const tierIdx = BENCHMARKS.findIndex((r) => followersCount >= r.min && followersCount < r.max)
  const tierRow = tierIdx >= 0 ? BENCHMARKS[tierIdx] : BENCHMARKS[0]
  const proximoRow = tierIdx >= 0 && tierIdx < BENCHMARKS.length - 1 ? BENCHMARKS[tierIdx + 1] : null
  const rangeTier = tierRow.max === Infinity ? 10_000_000 - tierRow.min : tierRow.max - tierRow.min
  const percentualNoPatamar = rangeTier > 0
    ? Math.min(100, Math.round(((followersCount - tierRow.min) / rangeTier) * 100))
    : 0
  const faltaSeguidores = proximoRow ? Math.max(0, proximoRow.min - followersCount) : 0
  const limiarProximo = proximoRow?.min ?? tierRow.max

  let insightPatamar: string
  if (!proximoRow) {
    insightPatamar =
      tierRow.label === 'Celebridade'
        ? 'Você está no patamar Celebridade — foco em marca pessoal, mídia e parcerias premium.'
        : 'Você está no último patamar — foco em consolidação e monetização.'
  } else {
    const falta = faltaSeguidores.toLocaleString('pt-BR')
    const proximo = proximoRow.label
    if (percentualNoPatamar >= 80) {
      insightPatamar = `Você está a ${falta} seguidores de dobrar seu valor comercial. O patamar ${proximo} multiplica o que você pode cobrar.`
    } else if (percentualNoPatamar >= 50) {
      insightPatamar = `Você está a ${falta} seguidores de dobrar seu valor comercial. O patamar ${proximo} transforma sua proposta.`
    } else if (percentualNoPatamar >= 20) {
      insightPatamar = `Você está a ${falta} seguidores do patamar ${proximo} — e de multiplicar seu valor por post.`
    } else {
      insightPatamar = `Faltam ${falta} seguidores para ${proximo}. Cada patamar acima aumenta o que marcas pagam por você.`
    }
  }

  let insightErProximo: string | null = null
  if (er != null && proximoRow && er >= proximoRow.erMid) {
    insightErProximo = `O engajamento já bateria a maioria dos criadores no patamar ${proximoRow.label}. Você só precisa de alcance.`
  }

  return {
    patamarAtual: tierRow.label,
    proximoPatamar: proximoRow?.label ?? null,
    faltaSeguidores,
    percentualNoPatamar,
    insightPatamar,
    insightErProximo,
    limiarProximo,
  }
}

/** Estima faixa de valor por post se o criador subir ao próximo patamar mantendo o ER atual. */
export function getProjecaoValorProximoPatamar(
  followersCount: number,
  er: number,
  conversationRatio: number
): { min: number; max: number; label: string } | null {
  const tierIdx = BENCHMARKS.findIndex((r) => followersCount >= r.min && followersCount < r.max)
  const proximoRow = tierIdx >= 0 && tierIdx < BENCHMARKS.length - 1 ? BENCHMARKS[tierIdx + 1] : null
  if (!proximoRow) return null
  const proximoMin = proximoRow.min
  let base = (proximoMin / 1000) * (er / 2)
  if (base < 20) base = 20
  if (conversationRatio >= 0.12) base *= 1.15
  const min = Math.max(50, Math.round(base * 0.7))
  const max = Math.max(min + 50, Math.round(base * 1.5))
  return { min, max, label: proximoRow.label }
}

export interface BenchmarkInsight {
  tier: string
  percentil: number
  percentilLabel: string
  status: 'acima' | 'media' | 'abaixo'
  texto: string
  /** ER médio da faixa (ex.: 4.2 para Micro) — prova social para marca */
  tierErAvg: number
  /** Faixa típica da faixa (ex.: "1,5%–7%") */
  tierErRange: string
}

export function getBenchmark(engagement: EngagementStats, followersCount: number): BenchmarkInsight {
  const er = engagement.engagement_rate ?? 0
  const tierRow = BENCHMARKS.find((r) => followersCount >= r.min && followersCount < r.max) ?? BENCHMARKS[0]
  const { erMin, erMid, erMax, label } = tierRow
  let percentil: number
  if (er >= erMax) percentil = 90
  else if (er >= erMid) percentil = 50 + ((er - erMid) / (erMax - erMid)) * 40
  else if (er >= erMin) percentil = 20 + ((er - erMin) / (erMid - erMin)) * 30
  else percentil = Math.max(0, (er / erMin) * 20)
  const percentilLabel = percentil >= 70 ? 'Acima da média' : percentil >= 40 ? 'Na média' : 'Abaixo da média'
  const status: 'acima' | 'media' | 'abaixo' = percentil >= 60 ? 'acima' : percentil >= 35 ? 'media' : 'abaixo'
  const texto = status === 'acima'
    ? `O engajamento (${er.toFixed(2)}%) está no topo da faixa ${label}. Parabéns!`
    : status === 'media'
      ? `O engajamento está na média para ${label}. Há espaço para subir.`
      : `Para a faixa ${label}, o típico é ${erMin}%–${erMax}%. Você está em ${er.toFixed(2)}%.`
  const tierErRange = `${erMin.toFixed(1).replace('.', ',')}%–${erMax}%`
  return { tier: label, percentil: Math.round(percentil), percentilLabel, status, texto, tierErAvg: erMid, tierErRange }
}

/** CPM/CPE estimados a partir do valor por post e engajamento (para marcas). */
export interface CpmCpeInsight {
  /** Custo por 1.000 impressões (views) — R$ */
  cpmEstimate: number | null
  /** Custo por engajamento (like+comment) — R$ */
  cpeEstimate: number | null
  /** Custo por 1.000 interações — R$ */
  costPer1000Interactions: number | null
}

export function getCpmCpe(
  valorEstimado: ValorEstimadoInsight,
  engagement: EngagementStats
): CpmCpeInsight {
  const avgValor = (valorEstimado.min + valorEstimado.max) / 2
  const n = engagement.posts_count || 1
  const totalViews = engagement.total_views ?? 0
  const totalInteractions = (engagement.total_likes ?? 0) + (engagement.total_comments ?? 0)
  // CPM = (valor_post / alcance_post) × 1000 — usar só posts que têm views (reels/vídeos) no denominador,
  // senão mistura feed (sem views) com reels e o CPM explode (ex.: 401 views / 20 posts = 20 avg → CPM absurdamente alto).
  const nWithViews = (engagement.posts_with_views_count != null && engagement.posts_with_views_count > 0)
    ? engagement.posts_with_views_count
    : n
  const avgViews = nWithViews > 0 ? totalViews / nWithViews : 0
  const avgInteractions = totalInteractions / n

  const rawCpm = avgViews > 0 ? (avgValor / avgViews) * 1000 : null
  // CPM de influenciador no BR: nano/micro R$15–R$120, macro até ~R$400; acima de 1500 indica base de views pequena/incorreta.
  const CPM_MAX_PLAUSIBLE = 1500
  const cpmEstimate = rawCpm != null && rawCpm <= CPM_MAX_PLAUSIBLE ? Math.round(rawCpm * 100) / 100 : null
  const cpeEstimate = avgInteractions > 0 ? avgValor / avgInteractions : null
  const costPer1000Interactions = avgInteractions > 0 ? (avgValor / avgInteractions) * 1000 : null

  return {
    cpmEstimate,
    cpeEstimate: cpeEstimate != null ? Math.round(cpeEstimate * 100) / 100 : null,
    costPer1000Interactions: costPer1000Interactions != null ? Math.round(costPer1000Interactions * 100) / 100 : null,
  }
}

/** Valor estimado por post (só RocksDB: followers, ER, views, verified, business). */
export interface ValorEstimadoInsight {
  min: number
  max: number
  porque: string
}

/** Valor estimado por tipo de conteúdo: post (feed), reels, stories, destaque (highlights). */
export interface ValorEstimadoPorTipo {
  post: ValorEstimadoInsight
  reels: ValorEstimadoInsight
  stories: ValorEstimadoInsight
  /** Upgrade 30 dias: +10% a +25% do valor do story (não é formato primário; prova social permanente no perfil). */
  destaque: ValorEstimadoInsight
}

function computeBaseValor(
  profile: ProfileItem | null,
  engagement: EngagementStats
): { base: number; porqueParts: string[] } {
  const userData = profile?.data?.user as Record<string, unknown> | undefined
  const followers = getFollowersCount(profile)
  const isVerified = Boolean(profile?.is_verified ?? userData?.is_verified)
  const accountType = (userData?.account_type ?? (profile as Record<string, unknown>)?.account_type) as number | undefined
  const isPro = accountType === 2 || accountType === 3

  // Mercado BR: base por seguidores (R$ 0,015 por seguidor → ~R$ 2.800 para 187k). Sem usar ER no valor para evitar distorção.
  let base = followers * 0.015
  if (base < 50) base = 50
  if (isVerified) base *= 1.1
  if (isPro) base *= 1.05
  const conversationRatio = (engagement.total_likes + engagement.total_comments) > 0
    ? engagement.total_comments / (engagement.total_likes + engagement.total_comments)
    : 0
  if (conversationRatio >= 0.12) base *= 1.05
  const porqueParts = [
    'baseado em seguidores (referência de mercado)',
    isVerified ? 'bônus por perfil verificado' : '',
    conversationRatio >= 0.12 ? 'bônus por audiência que comenta' : '',
  ].filter(Boolean)
  return { base, porqueParts }
}

export function getValorEstimadoRocksDB(
  profile: ProfileItem | null,
  engagement: EngagementStats
): ValorEstimadoInsight {
  const { base, porqueParts } = computeBaseValor(profile, engagement)
  const min = Math.round(base * 0.7)
  const max = Math.round(base * 1.5)
  const porque = porqueParts.join(', ')
  return { min: Math.max(50, min), max: Math.max(min + 50, max), porque }
}

/** Valores estimados por tipo: post (feed), reels e stories. Reels tendem a valer mais (alcance); stories menos (efêmero). */
export function getValorEstimadoPorTipoRocksDB(
  profile: ProfileItem | null,
  engagement: EngagementStats
): ValorEstimadoPorTipo {
  const { base, porqueParts } = computeBaseValor(profile, engagement)
  const basePorque = porqueParts.join(', ')

  const postMin = Math.round(base * 0.8)
  const postMax = Math.round(base * 1.15)
  const post = {
    min: Math.max(50, postMin),
    max: Math.max(postMin + 50, postMax),
    porque: basePorque,
  }

  // Reels costumam pagar mais que feed (alcance/descoberta); range um pouco acima do feed.
  const reelsMultiplier = 1.35
  const reelsBase = base * reelsMultiplier
  const reelsMin = Math.round(reelsBase * 0.82)
  const reelsMax = Math.round(reelsBase * 1.55)
  const reels = {
    min: Math.max(50, reelsMin),
    max: Math.max(reelsMin + 50, reelsMax),
    porque: [basePorque, 'reels com maior alcance (descoberta)'].filter(Boolean).join(', '),
  }

  // Story no mercado BR costuma ser 30–50% do valor do feed (formato efêmero 24h).
  const storyMin = Math.max(15, Math.round(post.min * 0.3))
  const storyMax = Math.max(storyMin + 20, Math.round(post.max * 0.5))
  const stories = {
    min: storyMin,
    max: storyMax,
    porque: [basePorque, 'story 24h (formato efêmero, ~30–50% do feed)'].filter(Boolean).join(', '),
  }

  // Destaque: adicional de 10% a 25% sobre o valor de Reels contratado (upgrade de permanência 30 dias).
  const destaqueMin = Math.round(reels.min * 0.1)
  const destaqueMax = Math.round(reels.max * 0.25)
  const destaque = {
    min: Math.max(1, destaqueMin),
    max: Math.max(destaqueMin + 1, destaqueMax),
    porque: 'Adicional de 10% a 25% sobre o valor de Reels contratado (permanência 30 dias no perfil).',
  }

  return { post, reels, stories, destaque }
}

/** Checklist profissionalismo / risco (só RocksDB). */
export interface ProfissionalismoInsight {
  pronto: string[]
  ajustes: string[]
}

/** Resumo executivo: 4 bullets para leitura rápida (marca/investidor). */
export function getResumoExecutivo(
  score: InfluencerScore,
  benchmark: BenchmarkInsight,
  conversation: ConversationInsight,
  profissionalismo: ProfissionalismoInsight
): string[] {
  const bullets: string[] = []
  if (score.total >= 60) bullets.push('Perfil com comunidade ativa e engajamento acima da média.')
  else bullets.push('Perfil com potencial de crescimento com ajustes de consistência e conteúdo.')
  if (benchmark.status === 'acima') bullets.push('Performance acima da média da faixa de alcance.')
  else if (benchmark.status === 'media') bullets.push('Performance na média; há espaço para subir no ranking.')
  else bullets.push('Performance abaixo da média da faixa; foco em frequência e engajamento.')
  if (conversation.label === 'Comunidade conversadora') bullets.push('Alto potencial de monetização (audiência que conversa).')
  else if (profissionalismo.pronto.length >= 3) bullets.push('Potencial de monetização alto; perfil preparado para marcas.')
  else bullets.push('Potencial de monetização médio; recomenda-se completar perfil profissional.')
  if (profissionalismo.ajustes.length === 0 && profissionalismo.pronto.length >= 2) bullets.push('Recomendado para marcas locais e parcerias.')
  else if (profissionalismo.pronto.length >= 1) bullets.push('Recomendado para marcas após pequenos ajustes.')
  else bullets.push('Recomendado para marcas após ativar perfil e métricas.')
  return bullets.slice(0, 4)
}

/** Tipo de criador para classificação enterprise (marca). */
export type CreatorTypeId = 'awareness' | 'conversion' | 'community' | 'viral'

export interface CreatorTypeInsight {
  id: CreatorTypeId
  label: string
  /** Ex.: "Creator de Alcance (Awareness)" */
  fullLabel: string
}

export function getCreatorType(
  conversation: ConversationInsight,
  strategicMetrics: { viralDependenceIndex: number; conversionPotentialScore: number; reachMultiplier: { max: number | null } },
  _engagement: EngagementStats
): CreatorTypeInsight {
  const convRate = conversation.rate ?? 0
  const viralDep = strategicMetrics.viralDependenceIndex
  const conversionPot = strategicMetrics.conversionPotentialScore
  const reachHigh = (strategicMetrics.reachMultiplier.max ?? 0) >= 5

  if (convRate >= 10 && conversionPot >= 50) {
    return { id: 'community', label: 'Comunidade', fullLabel: 'Creator de Comunidade' }
  }
  if (convRate >= 8 && conversionPot >= 40) {
    return { id: 'conversion', label: 'Conversão', fullLabel: 'Creator de Conversão' }
  }
  if (viralDep >= 60 && reachHigh) {
    return { id: 'viral', label: 'Viral', fullLabel: 'Creator de Viral' }
  }
  return { id: 'awareness', label: 'Alcance', fullLabel: 'Creator de Alcance (Awareness)' }
}

/** Executive Summary para marcas (B2B): diagnóstico rápido no topo. */
export interface ExecutiveSummaryForBrands {
  strengths: string[]
  warnings: string[]
  recommendation: string
  creatorType: CreatorTypeInsight
}

export function getExecutiveSummaryForBrands(
  benchmark: BenchmarkInsight,
  conversation: ConversationInsight,
  strategicMetrics: StrategicMetrics,
  nicheAuthorityScore: number,
  creatorType: CreatorTypeInsight,
  profile: ProfileItem | null
): ExecutiveSummaryForBrands {
  const strengths: string[] = []
  const warnings: string[] = []

  if (benchmark.status === 'acima' || (strategicMetrics.reachMultiplier.max ?? 0) >= 3) {
    strengths.push('Alto potencial de alcance orgânico')
  }
  if (nicheAuthorityScore >= 50) {
    strengths.push('Forte autoridade de nicho')
  }
  if (strategicMetrics.commercialRisk === 'Baixo') {
    strengths.push('Baixo risco de perda de parceria')
  }
  if (strategicMetrics.conversionPotentialScore >= 40) {
    strengths.push('Bom potencial de conversão')
  }
  if (strengths.length === 0) strengths.push('Perfil com dados para campanhas segmentadas')

  const convRate = conversation.rate ?? 0
  if (convRate < 5) {
    warnings.push(`Conversação baixa (${convRate.toFixed(1)}%)`)
  }
  if (strategicMetrics.viralDependenceIndex >= 50 && strategicMetrics.viralDependenceIndex < 70) {
    warnings.push('Dependência moderada de virais')
  } else if (strategicMetrics.viralDependenceIndex >= 70) {
    warnings.push('Alta dependência de poucos posts virais')
  }
  if (profile?.is_private) {
    warnings.push('Perfil privado')
  }
  if (strategicMetrics.audienceStabilityScore !== undefined && strategicMetrics.audienceStabilityScore < 40) {
    warnings.push('Estabilidade da audiência abaixo da média')
  }

  let recommendation: string
  switch (creatorType.id) {
    case 'community':
      recommendation = 'Indicado para campanhas de comunidade e conversão'
      break
    case 'conversion':
      recommendation = 'Indicado para campanhas de conversão e consideração'
      break
    case 'viral':
      recommendation = 'Indicado para campanhas de awareness e alcance viral'
      break
    default:
      recommendation = 'Indicado para campanhas de awareness'
  }

  return { strengths, warnings, recommendation, creatorType }
}

export function getProfissionalismoChecklist(profile: ProfileItem | null, posts: PostItem[]): ProfissionalismoInsight {
  const userData = profile?.data?.user as Record<string, unknown> | undefined
  const pronto: string[] = []
  const ajustes: string[] = []

  if (!profile?.is_private) pronto.push('Perfil público (marcas podem ver o conteúdo)')
  else ajustes.push('Perfil privado — marcas não conseguem avaliar seu conteúdo')

  const hasCountsDisabled = posts.some((p) => (p.metrics as { like_and_view_counts_disabled?: boolean } | undefined)?.like_and_view_counts_disabled)
  if (!hasCountsDisabled) pronto.push('Métricas visíveis (likes/views)')
  else ajustes.push('Alguns posts com métricas ocultas — considere exibir para transparência')

  const hasPaidPartnership = posts.some((p) => (p as { flags?: { is_paid_partnership?: boolean } }).flags?.is_paid_partnership === true)
  if (hasPaidPartnership) pronto.push('Já faz publicidade paga (sinal de experiência)')

  if (profile?.is_verified ?? userData?.is_verified) pronto.push('Conta verificada')
  if ((profile?.biography ?? userData?.biography) && String(profile?.biography ?? userData?.biography).trim().length >= 30) pronto.push('Bio preenchida')
  if ((profile as Record<string, unknown>)?.external_url ?? userData?.external_url) pronto.push('Link na bio')

  const accountType = (userData?.account_type ?? (profile as Record<string, unknown>)?.account_type) as number | undefined
  if (accountType === 2 || accountType === 3) pronto.push('Conta Criador ou Empresa')
  else if (accountType === 1) ajustes.push('Conta pessoal — migre para Criador para ferramentas profissionais')

  if (pronto.length === 0 && ajustes.length > 0) pronto.push('Alguns itens já estão ok')
  return { pronto, ajustes }
}

/** Modelo BI estratégico: Diagnóstico → Impacto → Prioridade (sem repetição). */
export interface DiagnosticoBI {
  /** Resumo em 1 linha */
  resumoExecutivo: string
  /** ER médio (últimos 25 posts) para destaque visual */
  erPct: number
  /** ER do post com maior engajamento (maior viral) — credibilidade para marca */
  erMaxViral: number | null
  /** Nota quando ER médio > 100% (viralização) */
  erNote: string | null
  /** Faixa de benchmark (Nano, Micro, etc.) */
  benchmarkTier: string
  /** Próximo patamar (ex.: Micro); null se Macro */
  proximoPatamar: string | null
  /** Seguidores que faltam para o próximo patamar */
  faltaParaProximo: number
  /** % de progresso dentro do patamar atual (0–100) */
  percentualNoPatamar: number
  /** Frase surpreendente: quanto falta, próximo patamar (+ comparação ER quando aplicável) */
  insightPatamar: string
  /** 3 eixos (sem listas): engajamento, descoberta, estrutura */
  eixos: {
    engajamento: 'Forte' | 'Médio' | 'Limitado'
    descoberta: 'Limitada' | 'Moderada' | 'Ampla'
    estrutura: 'Incompleta' | 'Parcial' | 'Completa'
  }
  /** Onde perde: apenas impacto (alcance) — sem sugestões */
  ondePerdeAlcance: string[]
  /** Insight positivo de alcance (ex.: feed engaja mais que reels) — exibido em "O que está bom" */
  alcancePositivo?: string
  /** Onde perde: apenas impacto (monetização) — sem sugestões */
  ondePerdeMonetizacao: string[]
  /** Forças do perfil (benchmark + itens positivos + potencial comercial) */
  forcas: { titulo: string; descricao?: string }[]
  /** Top 3 ações — foco em impacto imediato, sem repetir o resto */
  proximoPassoTop3: string[]
  /** Potencial comercial (para forças) */
  potencialComercial: { titulo: string; bullets: string[] } | null
  /** Projeção: valor por post se subir ao próximo patamar mantendo ER */
  projecaoProximoPatamar: { min: number; max: number; label: string; texto: string } | null
  /** Comparação local: "entre os X% com maior engajamento [em cidade]" */
  comparacaoLocal: string | null
  /** Score quebrado em 3 eixos narrativos (0–100) */
  scoreNarrativo: { engajamento: number; alcance: number; estruturaComercial: number }
  /** Frase que explica o score (ex.: acima em engajamento, abaixo em estrutura comercial) */
  scoreNarrativaFrase: string | null
  /** Próximo passo concreto: ritmo atual (X posts/sem) vs. 3 posts/semana */
  proximoPassoConcreto: string | null
}

export function getDiagnosticoBI(
  profile: ProfileItem | null,
  _posts: PostItem[],
  engagement: EngagementStats,
  benchmark: BenchmarkInsight,
  score: InfluencerScore,
  profissionalismo: ProfissionalismoInsight,
  oportunidades: Oportunidade[],
  _consistency: ConsistencyInsight,
  diagnostico: DiagnosticoIA,
  matchMarca: { titulo: string; bullets: string[] } | null
): DiagnosticoBI {
  const postsPerWeek = engagement.posts_per_week ?? 0
  const er = engagement.engagement_rate ?? 0

  // Resumo executivo (1 linha)
  let resumoExecutivo: string
  if (er >= 5 && postsPerWeek < 1) {
    resumoExecutivo = 'Perfil com alto engajamento, mas baixa alavancagem de crescimento.'
  } else if (er >= 5 && postsPerWeek >= 1) {
    resumoExecutivo = 'Perfil com engajamento acima da média e espaço para ampliar alcance.'
  } else if (postsPerWeek < 0.5) {
    resumoExecutivo = 'Potencial de engajamento limitado por baixa frequência e estrutura.'
  } else if (er < 2 && postsPerWeek >= 2) {
    resumoExecutivo = 'Boa consistência; aumentar conexão e profissionalizar perfil pode multiplicar resultados.'
  } else {
    resumoExecutivo = diagnostico.headline
  }

  // 3 eixos (sem listas)
  const engajamento: 'Forte' | 'Médio' | 'Limitado' = er >= 5 ? 'Forte' : er >= 3 ? 'Médio' : 'Limitado'
  const opHashtags = oportunidades.find((o) => o.id === 'hashtags')
  const descoberta: 'Limitada' | 'Moderada' | 'Ampla' =
    postsPerWeek >= 1 && !opHashtags ? 'Ampla'
      : postsPerWeek >= 0.5 && !opHashtags ? 'Moderada'
        : 'Limitada'
  const temLink = !oportunidades.find((o) => o.id === 'link')
  const temContaPro = !oportunidades.find((o) => o.id === 'conta')
  const perfilPublico = !profile?.is_private
  const estruturaOk = temLink && temContaPro && perfilPublico
  const estrutura: 'Incompleta' | 'Parcial' | 'Completa' = estruturaOk ? 'Completa' : (temLink || temContaPro ? 'Parcial' : 'Incompleta')
  const followersCount = getFollowersCount(profile)

  // Onde perde — impacto com urgência
  const ondePerdeAlcance: string[] = []
  if (opHashtags) ondePerdeAlcance.push('Você está perdendo alcance por não usar hashtags segmentadas')
  if (postsPerWeek < 1) ondePerdeAlcance.push('Sua frequência irregular limita o alcance orgânico')
  // Feed vs reels: se o feed engaja mais que reels → insight positivo em "O que está bom"
  let alcancePositivo: string | undefined
  const feedPosts = _posts.filter((p) => ct(p) === 'post')
  const reelsPosts = _posts.filter((p) => ct(p) === 'reel')
  if (feedPosts.length >= 1 && reelsPosts.length >= 1) {
    const feedEng = computeEngagementFromPosts(feedPosts, followersCount)
    const reelsEng = computeEngagementFromPosts(reelsPosts, followersCount)
    const erFeed = feedEng.engagement_rate ?? 0
    const erReel = reelsEng.engagement_rate ?? 0
    if (erReel > 0 && erFeed > 0) {
      const ratio = erReel / erFeed
      if (ratio <= 0.6) {
        alcancePositivo = `Seu feed engaja mais que reels (${(erFeed / erReel).toFixed(1).replace('.', ',')}×). Invista em fotos/carrossel.`
      }
    }
  }

  const ondePerdeMonetizacao: string[] = []
  if (!temLink) ondePerdeMonetizacao.push('Sem link na bio, marcas não conseguem fechar parcerias')
  if (!temContaPro) ondePerdeMonetizacao.push('Conta pessoal limita ferramentas de monetização')
  if (!perfilPublico) ondePerdeMonetizacao.push('Perfil privado reduz em até 70% o potencial de descoberta')

  // Forças do perfil
  const forcas: { titulo: string; descricao?: string }[] = []
  if (er >= 4) {
    forcas.push({
      titulo: `Engajamento acima da média (${er.toFixed(2).replace('.', ',')}%)`,
      descricao: `Topo da faixa ${benchmark.tier} — comunidade ativa.`,
    })
  }
  for (const p of profissionalismo.pronto) {
    if (p === 'Alguns itens já estão ok') continue
    forcas.push({ titulo: p })
  }
  if (forcas.length === 0) {
    forcas.push({ titulo: 'Presença no feed', descricao: 'Há espaço para crescer.' })
  }

  // Próximo passo — ações urgentes e concretas
  const proximoPassoTop3: string[] = []
  if (!perfilPublico) proximoPassoTop3.push('Tornar perfil público — marcas precisam ver seu\u00A0conteúdo')
  if (!temContaPro) proximoPassoTop3.push('Migrar para Criador — desbloqueia métricas e ofertas')
  if (!temLink) proximoPassoTop3.push('Adicionar link na bio — primeiro passo para fechar parcerias')
  // Limita a 3
  const top3 = proximoPassoTop3.slice(0, 3)

  const patamar = getPatamarProximo(followersCount, er)
  const insightPatamarFull = patamar.insightErProximo
    ? `${patamar.insightPatamar} ${patamar.insightErProximo}`
    : patamar.insightPatamar

  const totalInt = (engagement.total_likes ?? 0) + (engagement.total_comments ?? 0)
  const conversationRatio = totalInt > 0 ? (engagement.total_comments ?? 0) / totalInt : 0
  const projecao = getProjecaoValorProximoPatamar(followersCount, er, conversationRatio)
  const projecaoProximoPatamar = projecao
    ? {
      ...projecao,
      texto: `Se você virar ${projecao.label} mantendo ${er.toFixed(1).replace('.', ',')}% de ER, seu valor médio por post pode subir para R$ ${projecao.min}–${projecao.max}.`,
    }
    : null

  const topPercent = Math.max(1, Math.min(99, 100 - benchmark.percentil))
  const city = (profile as { city_name?: string })?.city_name ?? (profile?.data?.user as { city_name?: string })?.city_name
  const comparacaoLocal = city
    ? `Você está entre os ${topPercent}% com maior engajamento em ${city}.`
    : `Você está entre os ${topPercent}% com maior engajamento no seu patamar.`

  const { pillars } = score
  const scoreNarrativo = {
    engajamento: Math.round((pillars.comunidade + pillars.conteudo) / 2),
    alcance: pillars.alcance,
    estruturaComercial: Math.round((pillars.autoridade + pillars.consistencia) / 2),
  }
  const scoreNarrativaFrase = null

  // Projeção de meses: ritmo atual (causa explícita: posts/semana) vs. 3 posts/semana
  const falta = patamar.faltaSeguidores
  const ritmoAtualPorMes = postsPerWeek >= 2 ? 250 : postsPerWeek >= 1 ? 180 : 150
  const mesesRitmoAtual =
    patamar.proximoPatamar && falta > 0 ? Math.max(1, Math.ceil(falta / ritmoAtualPorMes)) : null
  const mesesOtimistaMin =
    patamar.proximoPatamar && falta > 0 ? Math.max(1, Math.ceil(falta / 500)) : null
  const mesesOtimistaMax =
    patamar.proximoPatamar && falta > 0 ? Math.max(1, Math.ceil(falta / 350)) : null
  const postsSemanaLabel = postsPerWeek === 0 ? '0' : String(postsPerWeek).replace('.', ',')
  const proximoPassoConcreto =
    patamar.proximoPatamar && mesesRitmoAtual != null && mesesOtimistaMin != null && mesesOtimistaMax != null
      ? `Para atingir ${patamar.proximoPatamar}: no ritmo atual (${postsSemanaLabel} posts/semana) ~${mesesRitmoAtual} ${mesesRitmoAtual === 1 ? 'mês' : 'meses'}. Com 3 posts/semana: ${mesesOtimistaMin}–${mesesOtimistaMax} meses.`
      : null

  return {
    resumoExecutivo,
    erPct: er,
    erMaxViral: engagement.engagement_rate_max_viral ?? null,
    erNote: engagement.engagement_rate_note ?? null,
    benchmarkTier: benchmark.tier,
    proximoPatamar: patamar.proximoPatamar,
    faltaParaProximo: patamar.faltaSeguidores,
    percentualNoPatamar: patamar.percentualNoPatamar,
    insightPatamar: insightPatamarFull,
    eixos: { engajamento, descoberta, estrutura },
    ondePerdeAlcance,
    alcancePositivo,
    ondePerdeMonetizacao,
    forcas,
    proximoPassoTop3: top3,
    potencialComercial: matchMarca,
    projecaoProximoPatamar,
    comparacaoLocal,
    scoreNarrativo,
    scoreNarrativaFrase,
    proximoPassoConcreto,
  }
}

// ——— Métricas estratégicas (dados já disponíveis, insights de agência) ———
function ct(p: PostItem): string {
  return ((p.content_type as string) || 'post') as string
}

export interface StrategicMetrics {
  /** Narrativa ER por tipo */
  erByTypeNarrative: string | null
  commentRatePct: number
  likeCommentRatio: number
  likeCommentAlert: boolean
  /** Reels: views/followers média */
  reelsAmplification: number | null
  reelsAmplificationLabel: string | null
  /** Último reel (mais recente): views ÷ seguidores — "Seu último reel atingiu 3,2× sua base" */
  lastReelAmplification: number | null
  lastReelAmplificationLabel: string | null
  postsPerMonth: number
  avgIntervalDays: number | null
  contentTypeDistribution: { pctReels: number; pctCarousel: number; pctPhoto: number; countReels: number; countCarousel: number; countPhoto: number }
  hashtagDensity: { avgPerPost: number; postsWithout: number; pctWithHashtag: number }
  commercialMaturityIndex: number
  taggedDependency: { erOwn: number; erTagged: number; ratio: number; insight: string | null }
  captionDepthInsight: { avgCommentsLong: number; avgCommentsShort: number; longCaptionThreshold: number; insight: string | null }
  /** Desvio padrão do ER por post (consistência): baixo = consistente, alto = 1 viral */
  engagementStdDev: number | null
  engagementConsistencyLabel: string | null
  /** (comments×3) + (likes×1) + (views×0.2) normalizado por seguidores → 0–100 */
  weightedEngagementScore: number
  /** Comentários/likes, comentários/seguidores, média comentários por post */
  conversationDetail: { commentToLikeRatio: number; commentsPerFollowerPct: number; avgCommentsPerPost: number }
  /** Risco de perda de parceria: Alto / Médio / Baixo */
  commercialRisk: 'Alto' | 'Médio' | 'Baixo'
  commercialRiskReasons: string[]
  /** Hashtag + perfil público + % reels + frequência → 0–100 */
  discoverabilityScore: number
  /** Nota sobre projeção de crescimento (sem histórico de seguidores) */
  growthProjectionNote: string
  /** Reach Multiplier: média e máximo de views/seguidores (ex.: 70× base) */
  reachMultiplier: { avg: number | null; max: number | null; label: string | null }
  /** % das interações vindas de feed, reels, marcado — autonomia da audiência */
  interactionDistribution: { pctFromFeed: number; pctFromReels: number; pctFromTagged: number }
  /** Viral Dependence Index 0–100: alto = muita interação em poucos posts (risco) */
  viralDependenceIndex: number
  viralDependenceLabel: string
  /** Estimated Conversion Potential: comment_rate × frequência × consistência → 0–100 */
  conversionPotentialScore: number
  /** Audience Stability Score 0–100: consistência + baixa concentração viral + frequência */
  audienceStabilityScore: number
}

/** posts = apenas post+reel (para todas as regras). allPosts = opcional, usado só para taggedDependency informativo. */
export function getStrategicMetrics(
  profile: ProfileItem | null,
  posts: PostItem[],
  engagement: EngagementStats,
  allPosts?: PostItem[]
): StrategicMetrics {
  const followersCount = getFollowersCount(profile)
  const feedPosts = posts.filter((p) => ct(p) === 'post')
  const reelsPosts = posts.filter((p) => ct(p) === 'reel')
  const taggedPosts = (allPosts ?? []).filter((p) => ct(p) === 'tagged')

  const feedEng = computeEngagementFromPosts(feedPosts, followersCount)
  const reelsEng = computeEngagementFromPosts(reelsPosts, followersCount)
  const taggedEng = computeEngagementFromPosts(taggedPosts, followersCount)

  const erFeed = feedEng.engagement_rate ?? 0
  const erReel = reelsEng.engagement_rate ?? 0
  const erTagged = taggedEng.engagement_rate ?? 0

  let erByTypeNarrative: string | null = null
  if (erReel > 0 && erFeed > 0 && reelsPosts.length >= 1 && feedPosts.length >= 1) {
    const ratio = erReel / erFeed
    if (ratio >= 1.5) erByTypeNarrative = `O engajamento em reels é ${ratio.toFixed(1).replace('.', ',')}× maior que no feed. Reels valem mais para marcas.`
    else if (ratio <= 0.6) erByTypeNarrative = `Seu feed engaja mais que reels (${(erFeed / erReel).toFixed(1)}×). Invista em fotos/carrossel.`
  } else if (erTagged > 0 && (erFeed > 0 || erReel > 0)) {
    const erOwn = (feedEng.total_likes + feedEng.total_comments + reelsEng.total_likes + reelsEng.total_comments) /
      (feedPosts.length + reelsPosts.length) / Math.max(1, followersCount) * 100
    if (erTagged > erOwn * 1.3) erByTypeNarrative = 'Quando marcam você, o engajamento sobe. Ótimo sinal de influência indireta.'
  }

  const totalLikes = engagement.total_likes ?? 0
  const totalComments = engagement.total_comments ?? 0
  const commentRatePct = followersCount > 0 ? (totalComments / followersCount) * 100 : 0
  const likeCommentRatio = totalComments > 0 ? totalLikes / totalComments : (totalLikes > 0 ? 999 : 0)
  const likeCommentAlert = likeCommentRatio >= 50 && totalComments < 10

  let reelsAmplification: number | null = null
  let reelsAmplificationLabel: string | null = null
  if (reelsPosts.length > 0 && followersCount > 0) {
    const totalViews = reelsEng.total_views ?? 0
    if (totalViews > 0) {
      reelsAmplification = totalViews / reelsPosts.length / followersCount
      reelsAmplificationLabel = `${reelsAmplification.toFixed(1).replace('.', ',')}× a base de seguidores por reel em média.`
    }
  }

  let lastReelAmplification: number | null = null
  let lastReelAmplificationLabel: string | null = null
  if (reelsPosts.length > 0 && followersCount > 0) {
    const sortedByDate = [...reelsPosts].sort((a, b) => (getPostTimestamp(b) ?? 0) - (getPostTimestamp(a) ?? 0))
    const lastReel = sortedByDate[0]
    const lastViews = toNum(lastReel?.metrics?.view_count ?? (lastReel as { view_count?: number })?.view_count)
    if (lastViews > 0) {
      lastReelAmplification = lastViews / followersCount
      lastReelAmplificationLabel = `Seu último reel atingiu ${lastReelAmplification.toFixed(1).replace('.', ',')}× sua base de seguidores.`
    }
  }

  const postsPerWeek = engagement.posts_per_week ?? 0
  const postsPerMonth = Math.round(postsPerWeek * 4.33 * 100) / 100
  const timestamps = posts.map(getPostTimestamp).filter((t): t is number => t != null).sort((a, b) => a - b)
  let avgIntervalDays: number | null = null
  if (timestamps.length >= 2) {
    let sumGap = 0
    for (let i = 1; i < timestamps.length; i++) sumGap += (timestamps[i] - timestamps[i - 1]) / (24 * 3600)
    avgIntervalDays = Math.round((sumGap / (timestamps.length - 1)) * 10) / 10
  }

  const mediaType = (p: PostItem) => (p.post?.media_type ?? (p as { media_type?: number }).media_type ?? 1) as number
  // Usar lista completa (allPosts) para distribuição de formato, para bater com o Mídia Kit e não depender da ordem dos primeiros 25
  const listForDistribution = allPosts && allPosts.length > 0 ? allPosts : posts
  let countReels = 0
  let countCarousel = 0
  let countPhoto = 0
  for (const p of listForDistribution) {
    const mt = mediaType(p)
    const isReel = ct(p) === 'reel' || (p as { product_type?: string }).product_type === 'clips'
    if (isReel || mt === 2) countReels++
    else if (mt === 8) countCarousel++
    else countPhoto++
  }
  const n = listForDistribution.length
  let pctReels = n > 0 ? Math.round((countReels / n) * 100) : 0
  let pctCarousel = n > 0 ? Math.round((countCarousel / n) * 100) : 0
  let pctPhoto = n > 0 ? Math.round((countPhoto / n) * 100) : 0
  // Garantir que a soma seja exatamente 100% (arredondamentos podem dar 99% ou 101%)
  if (n > 0) {
    const sum = pctReels + pctCarousel + pctPhoto
    const diff = 100 - sum
    if (diff !== 0) {
      const byCount = [{ pct: pctReels, count: countReels }, { pct: pctCarousel, count: countCarousel }, { pct: pctPhoto, count: countPhoto }]
      const idx = byCount.reduce((best, cur, i) => (cur.count > byCount[best].count ? i : best), 0)
      if (idx === 0) pctReels = Math.max(0, pctReels + diff)
      else if (idx === 1) pctCarousel = Math.max(0, pctCarousel + diff)
      else pctPhoto = Math.max(0, pctPhoto + diff)
    }
  }
  const contentTypeDistribution = {
    pctReels,
    pctCarousel,
    pctPhoto,
    countReels,
    countCarousel,
    countPhoto,
  }

  let totalHashtags = 0
  let postsWithHashtag = 0
  for (const p of posts) {
    const tags = (p.content?.hashtags ?? []).filter((h): h is string => typeof h === 'string')
    if (tags.length > 0) {
      totalHashtags += tags.length
      postsWithHashtag++
    }
  }
  const hashtagDensity = {
    avgPerPost: n > 0 ? Math.round((totalHashtags / n) * 10) / 10 : 0,
    postsWithout: n - postsWithHashtag,
    pctWithHashtag: n > 0 ? Math.round((postsWithHashtag / n) * 100) : 0,
  }

  const getCaption = (p: PostItem) => (p.content?.caption_text ?? (p.content as { caption?: string })?.caption ?? (p as { caption?: string }).caption) as string | undefined
  const captionHasCommercial = (cap: string | undefined) => {
    if (!cap) return false
    const lower = cap.toLowerCase()
    return /\@[\w.]+/.test(cap) || /#ad\b|#publi|#parceria|#patrocinado|#propaganda/.test(lower)
  }
  let commercialCount = 0
  for (const p of posts) {
    if (captionHasCommercial(getCaption(p))) commercialCount++
  }
  const pctCommercial = n > 0 ? (commercialCount / n) * 100 : 0
  const erNorm = Math.min(100, (engagement.engagement_rate ?? 0) * 10)
  const commentNorm = Math.min(100, commentRatePct * 20)
  const ampNorm = reelsAmplification != null ? Math.min(100, reelsAmplification * 15) : 50
  const freqNorm = Math.min(100, postsPerWeek * 25)
  const commercialNorm = Math.min(100, pctCommercial * 2)
  const commercialMaturityIndex = Math.round(
    erNorm * 0.25 + commentNorm * 0.25 + ampNorm * 0.2 + freqNorm * 0.15 + commercialNorm * 0.15
  )

  const erOwn = feedPosts.length + reelsPosts.length > 0
    ? (feedEng.engagement_rate ?? 0) * (feedPosts.length / (feedPosts.length + reelsPosts.length)) +
    (reelsEng.engagement_rate ?? 0) * (reelsPosts.length / (feedPosts.length + reelsPosts.length))
    : 0
  const erTaggedVal = taggedEng.engagement_rate ?? 0
  const ratio = erOwn > 0 ? erTaggedVal / erOwn : 0
  let taggedInsight: string | null = null
  if (taggedPosts.length >= 1 && ratio > 1.2) taggedInsight = 'Quando marcam você, o engajamento sobe. Influência indireta forte.'
  else if (taggedPosts.length >= 1 && ratio < 0.7) taggedInsight = 'Seu conteúdo próprio engaja mais que quando é marcado. Audiência é sua.'

  const LONG_CAPTION_THRESHOLD = 150
  let commentsLong = 0
  let commentsShort = 0
  let countLong = 0
  let countShort = 0
  for (const p of posts) {
    const cap = getCaption(p) ?? ''
    const comments = toNum(p.metrics?.comments)
    if (cap.length >= LONG_CAPTION_THRESHOLD) {
      commentsLong += comments
      countLong++
    } else {
      commentsShort += comments
      countShort++
    }
  }
  const avgCommentsLong = countLong > 0 ? Math.round(commentsLong / countLong * 10) / 10 : 0
  const avgCommentsShort = countShort > 0 ? Math.round(commentsShort / countShort * 10) / 10 : 0
  let captionInsight: string | null = null
  if (countLong >= 2 && countShort >= 2 && avgCommentsLong > avgCommentsShort * 1.2) {
    captionInsight = 'Legendas longas geram mais comentários. Conteúdo que conta história engaja mais.'
  } else if (countLong >= 2 && countShort >= 2 && avgCommentsShort > avgCommentsLong * 1.2) {
    captionInsight = 'Seus posts com legenda curta comentam mais. Menos pode ser mais para sua audiência.'
  }

  const ownPosts = feedPosts.length + reelsPosts.length > 0 ? [...feedPosts, ...reelsPosts] : []
  let engagementStdDev: number | null = null
  let engagementConsistencyLabel: string | null = null
  if (ownPosts.length >= 2 && followersCount > 0) {
    const ers = ownPosts.map((p) => {
      const likes = toNum(p.metrics?.likes)
      const comments = toNum(p.metrics?.comments)
      return ((likes + comments) / followersCount) * 100
    })
    const mean = ers.reduce((a, b) => a + b, 0) / ers.length
    const variance = ers.reduce((s, v) => s + (v - mean) ** 2, 0) / ers.length
    engagementStdDev = Math.round(Math.sqrt(variance) * 100) / 100
    if (engagementStdDev >= 3 || (mean > 0 && engagementStdDev / mean > 1.2)) {
      engagementConsistencyLabel = 'Variação alta: 1 ou poucos virais. Agência olha consistência.'
    } else {
      engagementConsistencyLabel = 'Engajamento consistente entre os posts.'
    }
  }

  const totalViews = engagement.total_views ?? reelsEng.total_views ?? 0
  const weightedRaw = (totalComments * 3 + totalLikes * 1 + totalViews * 0.2) / Math.max(1, followersCount)
  const weightedEngagementScore = Math.max(0, Math.min(100, Math.round(weightedRaw * 20)))

  const commentToLikeRatio = totalLikes > 0 ? Math.round((totalComments / totalLikes) * 1000) / 1000 : 0
  const commentsPerFollowerPct = followersCount > 0 ? (totalComments / followersCount) * 100 : 0
  const avgCommentsPerPost = n > 0 ? Math.round((totalComments / n) * 10) / 10 : 0
  const conversationDetail = {
    commentToLikeRatio,
    commentsPerFollowerPct: Math.round(commentsPerFollowerPct * 100) / 100,
    avgCommentsPerPost,
  }

  const riskReasons: string[] = []
  if (profile?.is_private) riskReasons.push('Perfil privado')
  const extUrl = (profile as Record<string, unknown>)?.external_url ?? (profile?.data?.user as Record<string, unknown>)?.external_url
  if (!extUrl) riskReasons.push('Sem link na bio')
  const accountType = (profile?.data?.user as Record<string, unknown>)?.account_type ?? (profile as Record<string, unknown>)?.account_type
  if (accountType === 0 || accountType === 1) riskReasons.push('Conta pessoal (não profissional)')
  if (postsPerWeek < 0.3 || (timestamps.length >= 2 && (timestamps[timestamps.length - 1] - timestamps[0]) / (24 * 3600) / Math.max(1, timestamps.length - 1) > 14)) {
    riskReasons.push('Frequência irregular')
  }
  let commercialRisk: 'Alto' | 'Médio' | 'Baixo' = riskReasons.length >= 2 ? 'Alto' : riskReasons.length === 1 ? 'Médio' : 'Baixo'

  const hashScore = Math.min(25, hashtagDensity.pctWithHashtag * 0.25)
  const publicScore = profile?.is_private ? 0 : 25
  const reelsScore = Math.min(25, (contentTypeDistribution.pctReels / 100) * 25)
  const freqScore = Math.min(25, postsPerWeek * 8.33)
  const discoverabilityScore = Math.round(hashScore + publicScore + reelsScore + freqScore)

  const growthProjectionNote = 'Projeção baseada em frequência de posts.'

  let reachMultiplierAvg: number | null = null
  let reachMultiplierMax: number | null = null
  let reachMultiplierLabel: string | null = null
  if (followersCount > 0 && reelsPosts.length > 0) {
    const totalViews = reelsEng.total_views ?? 0
    if (totalViews > 0) {
      reachMultiplierAvg = totalViews / reelsPosts.length / followersCount
      const viewsPerReel = reelsPosts.map((p) => toNum(p.metrics?.view_count ?? (p as { view_count?: number }).view_count))
      const maxViews = Math.max(...viewsPerReel, 0)
      reachMultiplierMax = maxViews > 0 ? maxViews / followersCount : null
      const maxStr = reachMultiplierMax != null ? reachMultiplierMax.toFixed(0) : ''
      reachMultiplierLabel = reachMultiplierMax != null && reachMultiplierMax >= 2
        ? `Reach Multiplier: até ${maxStr}× a base (média ${reachMultiplierAvg.toFixed(1).replace('.', ',')}×)`
        : `Reach Multiplier: média ${reachMultiplierAvg.toFixed(1).replace('.', ',')}× a base`
    }
  }

  const totalInteractions = totalLikes + totalComments
  const interactionsFeed = feedEng.total_likes + feedEng.total_comments
  const interactionsReels = reelsEng.total_likes + reelsEng.total_comments
  const interactionsTagged = taggedEng.total_likes + taggedEng.total_comments
  const totalComTudo = totalInteractions + interactionsTagged
  const interactionDistribution = {
    pctFromFeed: totalInteractions > 0 ? Math.round((interactionsFeed / totalInteractions) * 1000) / 10 : 0,
    pctFromReels: totalInteractions > 0 ? Math.round((interactionsReels / totalInteractions) * 1000) / 10 : 0,
    pctFromTagged: totalComTudo > 0 ? Math.round((interactionsTagged / totalComTudo) * 1000) / 10 : 0,
  }

  let viralDependencePct = 0
  if (ownPosts.length >= 2 && totalInteractions > 0) {
    const byInteractions = ownPosts
      .map((p) => toNum(p.metrics?.likes) + toNum(p.metrics?.comments))
      .sort((a, b) => b - a)
    const top2 = (byInteractions[0] ?? 0) + (byInteractions[1] ?? 0)
    viralDependencePct = (top2 / totalInteractions) * 100
  }
  const viralDependenceIndex = Math.round(Math.min(100, viralDependencePct))
  const viralDependenceLabel =
    viralDependenceIndex >= 70 ? 'Alto risco: grande parte das interações vem de poucos posts.'
      : viralDependenceIndex >= 50 ? 'Médio: concentração em poucos virais. Agências olham isso.'
        : viralDependenceIndex >= 25 ? 'Moderado: distribuição razoável.'
          : 'Baixo: engajamento distribuído entre os posts.'

  const consistencyNorm = engagementStdDev != null && engagementStdDev < 2 ? 100 : engagementStdDev != null && engagementStdDev < 4 ? 60 : 30
  const conversionPotentialScore = Math.round(Math.min(100,
    (Math.min(100, commentRatePct * 20) * 0.4) +
    (Math.min(100, postsPerWeek * 25) * 0.35) +
    (consistencyNorm * 0.25)
  ))

  const stabilityFromConsistency = engagementStdDev != null && engagementStdDev < 2 ? 100 : engagementStdDev != null && engagementStdDev < 4 ? 60 : 30
  const stabilityFromConcentration = 100 - viralDependenceIndex
  const stabilityFromFreq = Math.min(100, postsPerWeek * 25)
  const audienceStabilityScore = Math.round(
    (stabilityFromConsistency * 0.35) + (stabilityFromConcentration * 0.4) + (stabilityFromFreq * 0.25)
  )

  return {
    erByTypeNarrative,
    commentRatePct: Math.round(commentRatePct * 100) / 100,
    likeCommentRatio: Math.round(likeCommentRatio * 10) / 10,
    likeCommentAlert,
    reelsAmplification,
    reelsAmplificationLabel,
    lastReelAmplification,
    lastReelAmplificationLabel,
    postsPerMonth,
    avgIntervalDays,
    contentTypeDistribution,
    hashtagDensity,
    commercialMaturityIndex: Math.max(0, Math.min(100, commercialMaturityIndex)),
    taggedDependency: { erOwn, erTagged: erTaggedVal, ratio: Math.round(ratio * 100) / 100, insight: taggedInsight },
    captionDepthInsight: { avgCommentsLong, avgCommentsShort, longCaptionThreshold: LONG_CAPTION_THRESHOLD, insight: captionInsight },
    engagementStdDev,
    engagementConsistencyLabel,
    weightedEngagementScore,
    conversationDetail,
    commercialRisk,
    commercialRiskReasons: riskReasons,
    discoverabilityScore: Math.max(0, Math.min(100, discoverabilityScore)),
    growthProjectionNote,
    reachMultiplier: { avg: reachMultiplierAvg, max: reachMultiplierMax, label: reachMultiplierLabel },
    interactionDistribution,
    viralDependenceIndex,
    viralDependenceLabel,
    conversionPotentialScore: Math.max(0, Math.min(100, conversionPotentialScore)),
    audienceStabilityScore: Math.max(0, Math.min(100, audienceStabilityScore)),
  }
}

/** Monta todos os insights do relatório (usar com posts já limitados a REPORT_POSTS_LIMIT). Marcados não entram em nenhum cálculo, só em exibição informativa. */
export function buildReportInsights(
  profile: ProfileItem | null,
  posts: PostItem[]
) {
  const ownPosts = posts.filter((p) => ct(p) !== 'tagged')
  const limited = ownPosts.slice(0, REPORT_POSTS_LIMIT)
  const followersCount = getFollowersCount(profile)
  const engagement = computeEngagementFromPosts(limited, followersCount)
  const score = computeInfluencerScore(profile, limited, engagement)
  const diagnostico = getDiagnosticoIA(profile, limited, engagement, score)
  const conversation = getConversationRate(engagement)
  const topPosts = getTopPosts(limited, followersCount)
  const consistency = getConsistency(limited)
  const nicho = getNichoInsight(limited, followersCount)
  const oportunidades = getOportunidades(profile, limited)
  const benchmark = getBenchmark(engagement, followersCount)
  const valorEstimado = getValorEstimadoRocksDB(profile, engagement)
  const valorEstimadoPorTipo = getValorEstimadoPorTipoRocksDB(profile, engagement)
  const profissionalismo = getProfissionalismoChecklist(profile, limited)
  const resumoExecutivo = getResumoExecutivo(score, benchmark, conversation, profissionalismo)
  const locParts = [profile?.address_street, profile?.city_name, (profile as Record<string, unknown>)?.zip].filter(Boolean).map(String)
  const locationString = locParts.length > 0 ? locParts.join(', ') : '—'
  const matchMarca = getMatchMarca(locationString, nicho, consistency, topPosts)
  const diagnosticoBI = getDiagnosticoBI(profile, limited, engagement, benchmark, score, profissionalismo, oportunidades, consistency, diagnostico, matchMarca)
  const strategicMetrics = getStrategicMetrics(profile, limited, engagement, posts)
  const freqNorm = Math.min(100, (engagement.posts_per_week ?? 0) * 25)
  const monetizationReadinessScore = Math.round(
    (score.pillars.autoridade + score.pillars.consistencia + score.pillars.comunidade + freqNorm) / 4
  )

  const nicheTags = new Set(nicho.topHashtags.slice(0, 5).map((t) => t.tag.toLowerCase().replace(/#/g, '')))
  let postsInNicho = 0
  for (const p of limited) {
    const tags = (p.content?.hashtags ?? []).filter((h): h is string => typeof h === 'string').map((h) => h.replace(/^#/, '').trim().toLowerCase())
    if (tags.some((t) => nicheTags.has(t))) postsInNicho++
  }
  const pctPostsInNicho = limited.length > 0 ? (postsInNicho / limited.length) * 100 : 0
  const avgHashtagEr = nicho.performingHashtags.length > 0
    ? nicho.performingHashtags.reduce((a, b) => a + b.avgEr, 0) / nicho.performingHashtags.length
    : 0
  const hashtagPerfNorm = Math.min(100, avgHashtagEr * 10)
  const erNormNicho = Math.min(100, (engagement.engagement_rate ?? 0) * 10)
  const nicheAuthorityScore = Math.max(0, Math.min(100, Math.round(
    (Math.min(100, pctPostsInNicho * 2) * 0.4) + (hashtagPerfNorm * 0.4) + (erNormNicho * 0.2)
  )))

  const creatorType = getCreatorType(conversation, strategicMetrics, engagement)
  const executiveSummaryForBrands = getExecutiveSummaryForBrands(
    benchmark,
    conversation,
    strategicMetrics,
    nicheAuthorityScore,
    creatorType,
    profile
  )
  const cpmCpe = getCpmCpe(valorEstimado, engagement)
  const engagementPerWeekday = getEngagementPerWeekdayAllTime(ownPosts)

  return {
    engagement,
    score,
    diagnostico,
    diagnosticoBI,
    conversation,
    topPosts,
    consistency,
    nicho,
    oportunidades,
    benchmark,
    valorEstimado,
    valorEstimadoPorTipo,
    profissionalismo,
    resumoExecutivo,
    strategicMetrics,
    monetizationReadinessScore: Math.max(0, Math.min(100, monetizationReadinessScore)),
    nicheAuthorityScore,
    executiveSummaryForBrands,
    creatorType,
    cpmCpe,
    postsForReport: limited,
    engagementPerWeekday,
    followersCount,
  }
}
