/**
 * Resolve contagem de seguidores quando o documento do perfil não traz follower_count
 * (ex.: coleta só da timeline). Usa aux SQLite, engagement indexado e posts como fallback.
 */

export type EngagementLike = {
  engagement_rate?: number
  posts_count?: number
  total_likes?: number
  total_comments?: number
}

function toNum(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.floor(v))
  if (typeof v === 'string') {
    const n = parseInt(v.replace(/\D/g, ''), 10)
    return Number.isNaN(n) ? 0 : Math.max(0, n)
  }
  return 0
}

function postInteractions(post: Record<string, unknown>): number {
  const metrics = post.metrics as Record<string, unknown> | undefined
  const postObj = post.post as Record<string, unknown> | undefined
  const likes = toNum(metrics?.likes ?? post.like_count ?? postObj?.like_count)
  const comments = toNum(metrics?.comments ?? post.comment_count ?? postObj?.comment_count)
  return likes + comments
}

/** Estima seguidores a partir de ER e totais de interação (inverso da fórmula de ER). */
export function inferFollowersFromEngagementStats(eng: EngagementLike): number {
  const er = eng.engagement_rate ?? 0
  const n = eng.posts_count ?? 0
  if (er <= 0 || n <= 0) return 0
  const total = (eng.total_likes ?? 0) + (eng.total_comments ?? 0)
  if (total <= 0) return 0
  const avg = total / n
  return Math.max(1, Math.round((avg * 100) / er))
}

/**
 * Estima seguidores pelo post de maior engajamento, assumindo ~5% de ER no pico.
 * Útil quando a API do Instagram não devolveu follower_count na coleta.
 */
export function estimateFollowersFromPosts(posts: Record<string, unknown>[]): number {
  let peak = 0
  for (const p of posts) {
    peak = Math.max(peak, postInteractions(p))
  }
  if (peak <= 0) return 0
  return Math.max(1, Math.round(peak / 0.05))
}

export function resolveFollowersCountForProfile(
  profile: Record<string, unknown>,
  getFollowers: (p: Record<string, unknown>) => number,
  aux?: { followers_count?: number; engagement_json?: string },
  posts?: Record<string, unknown>[]
): number {
  let fc = getFollowers(profile)
  if (fc > 0) return fc

  const auxFc = aux?.followers_count ?? 0
  if (auxFc > 0) return auxFc

  const embedded = profile.engagement
  if (embedded != null && typeof embedded === 'object' && !Array.isArray(embedded)) {
    const inferred = inferFollowersFromEngagementStats(embedded as EngagementLike)
    if (inferred > 0) return inferred
  }

  const rawJson = aux?.engagement_json
  if (rawJson) {
    try {
      const stored = JSON.parse(rawJson) as EngagementLike
      const inferred = inferFollowersFromEngagementStats(stored)
      if (inferred > 0) return inferred
    } catch {
      // ignora JSON inválido
    }
  }

  if (posts && posts.length > 0) {
    const estimated = estimateFollowersFromPosts(posts)
    if (estimated > 0) return estimated
  }

  return fc
}
