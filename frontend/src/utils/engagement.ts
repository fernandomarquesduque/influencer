import type { PostItem } from '../api'
import type { EngagementStats } from '../api'

function toNum(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.floor(v)
  if (typeof v === 'string') {
    const n = parseInt(v.replace(/\D/g, ''), 10)
    return Number.isNaN(n) ? 0 : n
  }
  return 0
}

/** Extrai timestamp Unix (segundos) do post para ordenação/intervalo. */
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

const SECONDS_PER_WEEK = 7 * 24 * 3600
/** Período mínimo considerado (1 semana) para não inflar "posts/semana" em janelas muito curtas. */
const MIN_WEEKS_FOR_RATE = 1

/**
 * Calcula engajamento a partir dos posts (mesma fórmula do backend: crawl/src/api/profilesSearch.ts).
 * Campos esperados por post: metrics.likes, metrics.comments, metrics.view_count
 * (fallback: like_count, comment_count, view_count no topo para posts no formato antigo).
 */
export function computeEngagementFromPosts(
  posts: PostItem[],
  followersCount: number
): EngagementStats {
  let totalLikes = 0
  let totalComments = 0
  let totalViews = 0
  const timestamps: number[] = []
  for (const p of posts) {
    const m = p.metrics
    totalLikes += toNum(m?.likes ?? (p as { like_count?: number }).like_count)
    totalComments += toNum(m?.comments ?? (p as { comment_count?: number }).comment_count)
    totalViews += toNum(m?.view_count ?? (p as { view_count?: number }).view_count)
    const ts = getPostTimestamp(p)
    if (ts != null) timestamps.push(ts)
  }
  const n = posts.length
  const totalInteractions = totalLikes + totalComments
  // ER médio = (média de interações por post) / seguidores — pode ser > 100% em perfis virais
  const avgInteractionsPerPost = n > 0 ? totalInteractions / n : 0
  const engagementRate =
    followersCount > 0 && avgInteractionsPerPost >= 0
      ? (avgInteractionsPerPost / followersCount) * 100
      : 0
  // ER do maior viral (um único post): credibilidade para marca
  let engagementRateMaxViral: number | undefined
  if (n > 0 && followersCount > 0) {
    let maxEr = 0
    for (const p of posts) {
      const m = p.metrics
      const likes = toNum(m?.likes ?? (p as { like_count?: number }).like_count)
      const comments = toNum(m?.comments ?? (p as { comment_count?: number }).comment_count)
      const er = ((likes + comments) / followersCount) * 100
      if (er > maxEr) maxEr = er
    }
    engagementRateMaxViral = Math.round(maxEr * 100) / 100
  }
  const engagementRateNote =
    engagementRate > 100
      ? 'ER acima de 100% indica alcance além da base (viralização).'
      : undefined
  // ER por alcance (views): relevante para reels/vídeos com descoberta; (likes+comments)/views × 100
  const engagementRateByViews =
    totalViews > 0 && totalInteractions >= 0
      ? (totalInteractions / totalViews) * 100
      : undefined

  let posts_per_week: number | undefined
  if (timestamps.length >= 2) {
    const minTs = Math.min(...timestamps)
    const maxTs = Math.max(...timestamps)
    const observedWeeks = (maxTs - minTs) / SECONDS_PER_WEEK
    // Evita extrapolar janelas curtas (ex.: 12 posts em 1,5 dia → 53/semana); usa mínimo 1 semana
    const weeks = Math.max(observedWeeks, MIN_WEEKS_FOR_RATE)
    posts_per_week = weeks > 0 ? Math.round((n / weeks) * 100) / 100 : n
  } else if (n > 0) {
    posts_per_week = n
  }

  return {
    posts_count: n,
    total_likes: totalLikes,
    total_comments: totalComments,
    total_views: totalViews,
    avg_likes: n > 0 ? Math.round(totalLikes / n) : 0,
    avg_comments: n > 0 ? Math.round(totalComments / n) : 0,
    avg_views: n > 0 ? Math.round(totalViews / n) : 0,
    engagement_rate: Math.round(engagementRate * 100) / 100,
    ...(engagementRateByViews !== undefined && { engagement_rate_by_views: Math.round(engagementRateByViews * 100) / 100 }),
    ...(posts_per_week !== undefined && { posts_per_week }),
    ...(engagementRateMaxViral !== undefined && { engagement_rate_max_viral: engagementRateMaxViral }),
    ...(engagementRateNote && { engagement_rate_note: engagementRateNote }),
  }
}
