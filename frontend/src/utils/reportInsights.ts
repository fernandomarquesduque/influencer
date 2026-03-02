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

function getPostTimestamp(p: PostItem): number | null {
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
  const consistencia = postsPerWeek >= 3 ? 100 : postsPerWeek >= 1 ? 60 : postsPerWeek >= 0.5 ? 30 : Math.min(30, Math.round(postsPerWeek * 60))

  const hasViews = engagement.total_views > 0
  const avgViews = engagement.avg_views ?? 0
  const alcance = hasViews && followersCount > 0
    ? Math.min(100, Math.round((avgViews / followersCount) * 500))
    : Math.min(100, Math.round((engagement.engagement_rate ?? 0) * 8))

  let autoridade = 0
  if (profile?.is_verified ?? userData?.is_verified) autoridade += 30
  if ((profile?.biography ?? userData?.biography) && String(profile?.biography ?? userData?.biography).trim().length >= 20) autoridade += 25
  if ((profile as Record<string, unknown>)?.external_url ?? userData?.external_url) autoridade += 25
  const accountType = (userData?.account_type ?? (profile as Record<string, unknown>)?.account_type) as number | undefined
  if (accountType === 2 || accountType === 3) autoridade += 20
  autoridade = Math.min(100, autoridade)

  const minPerformance = followersCount > 0 ? (followersCount * 0.01) : 10
  let aboveMin = 0
  for (const p of posts) {
    const likes = toNum(p.metrics?.likes)
    const comments = toNum(p.metrics?.comments)
    if (likes + comments >= minPerformance) aboveMin++
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
    ? `Seu engajamento de ${er.toFixed(2)}% está acima da média e mostra conexão com a audiência.`
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

/** Conversation Rate = comments / (likes + comments). Classificação. */
export interface ConversationInsight {
  rate: number
  label: string
  color: 'success' | 'warning' | 'danger'
}

export function getConversationRate(engagement: EngagementStats): ConversationInsight {
  const total = engagement.total_likes + engagement.total_comments
  const rate = total > 0 ? engagement.total_comments / total : 0
  const pct = Math.round(rate * 100)
  if (pct >= 12) return { rate: pct, label: 'Comunidade conversadora', color: 'success' }
  if (pct >= 6) return { rate: pct, label: 'Médio', color: 'warning' }
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

/** Nicho: top hashtags, hashtags que performam, nicho dominante + subtemas. */
export interface NichoInsight {
  topHashtags: { tag: string; count: number }[]
  performingHashtags: { tag: string; avgEr: number; count: number }[]
  nichoDominante: string
  subtemas: string[]
}

export function getNichoInsight(posts: PostItem[], followersCount: number): NichoInsight {
  const tagCount: Record<string, number> = {}
  const tagInteractions: Record<string, number[]> = {}
  for (const p of posts) {
    const tags = (p.content?.hashtags ?? []).filter((h): h is string => typeof h === 'string').map((h) => h.replace(/^#/, '').trim().toLowerCase()).filter(Boolean)
    const likes = toNum(p.metrics?.likes)
    const comments = toNum(p.metrics?.comments)
    const interactions = likes + comments
    const er = followersCount > 0 ? (interactions / followersCount) * 100 : 0
    for (const tag of tags) {
      tagCount[tag] = (tagCount[tag] ?? 0) + 1
      if (!tagInteractions[tag]) tagInteractions[tag] = []
      tagInteractions[tag].push(er)
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

  const topTags = topHashtags.slice(0, 3).map((t) => t.tag)
  const nichoDominante = topTags.length >= 1 ? topTags[0] : 'Lifestyle'
  const subtemas = topTags.slice(1)

  return {
    topHashtags,
    performingHashtags,
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

/** Benchmark por faixa de seguidores (Nano/Micro/Mid). Percentil estimado. */
const BENCHMARKS: { min: number; max: number; label: string; erMin: number; erMid: number; erMax: number }[] = [
  { min: 0, max: 10_000, label: 'Nano', erMin: 2, erMid: 5, erMax: 10 },
  { min: 10_000, max: 50_000, label: 'Micro', erMin: 1.5, erMid: 4, erMax: 7 },
  { min: 50_000, max: 500_000, label: 'Mid', erMin: 1, erMid: 3, erMax: 5 },
  { min: 500_000, max: Infinity, label: 'Macro', erMin: 0.5, erMid: 1.5, erMax: 3 },
]

export interface BenchmarkInsight {
  tier: string
  percentil: number
  percentilLabel: string
  status: 'acima' | 'media' | 'abaixo'
  texto: string
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
    ? `Seu engajamento (${er.toFixed(2)}%) está no topo da faixa ${label}. Parabéns!`
    : status === 'media'
      ? `Seu engajamento está na média para ${label}. Há espaço para subir.`
      : `Para a faixa ${label}, o típico é ${erMin}%–${erMax}%. Você está em ${er.toFixed(2)}%.`
  return { tier: label, percentil: Math.round(percentil), percentilLabel, status, texto }
}

/** Valor estimado por post (só RocksDB: followers, ER, views, verified, business). */
export interface ValorEstimadoInsight {
  min: number
  max: number
  porque: string
}

export function getValorEstimadoRocksDB(
  profile: ProfileItem | null,
  engagement: EngagementStats
): ValorEstimadoInsight {
  const userData = profile?.data?.user as Record<string, unknown> | undefined
  const followers = getFollowersCount(profile)
  const er = engagement.engagement_rate ?? 0
  const hasViews = (engagement.total_views ?? 0) > 0
  const avgViews = engagement.avg_views ?? 0
  const isVerified = Boolean(profile?.is_verified ?? userData?.is_verified)
  const accountType = (userData?.account_type ?? (profile as Record<string, unknown>)?.account_type) as number | undefined
  const isPro = accountType === 2 || accountType === 3

  let base = (followers / 1000) * (er / 2)
  if (base < 20) base = 20
  if (hasViews && avgViews > 0) base *= 1 + Math.min(0.5, avgViews / (followers * 2))
  if (isVerified) base *= 1.2
  if (isPro) base *= 1.1
  const conversationRatio = (engagement.total_likes + engagement.total_comments) > 0
    ? engagement.total_comments / (engagement.total_likes + engagement.total_comments)
    : 0
  if (conversationRatio >= 0.12) base *= 1.15
  const min = Math.round(base * 0.7)
  const max = Math.round(base * 1.5)
  const porque = [
    'baseado em seguidores e taxa de engajamento',
    hasViews ? 'ajustado por alcance (views)' : '',
    isVerified ? 'bônus por perfil verificado' : '',
    conversationRatio >= 0.12 ? 'bônus por audiência que comenta' : '',
  ].filter(Boolean).join(', ')
  return { min: Math.max(50, min), max: Math.max(min + 50, max), porque }
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

/** Monta todos os insights do relatório (usar com posts já limitados a REPORT_POSTS_LIMIT). */
export function buildReportInsights(
  profile: ProfileItem | null,
  posts: PostItem[]
) {
  const limited = posts.slice(0, REPORT_POSTS_LIMIT)
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
  const profissionalismo = getProfissionalismoChecklist(profile, limited)
  const resumoExecutivo = getResumoExecutivo(score, benchmark, conversation, profissionalismo)

  return {
    engagement,
    score,
    diagnostico,
    conversation,
    topPosts,
    consistency,
    nicho,
    oportunidades,
    benchmark,
    valorEstimado,
    profissionalismo,
    resumoExecutivo,
    postsForReport: limited,
  }
}
