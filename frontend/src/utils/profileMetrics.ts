import type { EngagementStats, PostItem, ProfileEngagementByType, ProfileItem } from '../api'
import { getProfilePreviewEngagement, getProfilePreviewEngagementByType } from '../api'
import { computeEngagementFromPosts } from './engagement'

function toFollowerNum(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return Math.floor(v)
  if (typeof v === 'string') {
    const n = parseInt(v.replace(/\D/g, ''), 10)
    return Number.isNaN(n) || n < 0 ? 0 : n
  }
  return 0
}

function postInteractions(post: PostItem): number {
  const m = post.metrics
  const p = post.post as Record<string, unknown> | undefined
  const likes = toFollowerNum(m?.likes ?? (post as { like_count?: number }).like_count ?? p?.like_count)
  const comments = toFollowerNum(m?.comments ?? (post as { comment_count?: number }).comment_count ?? p?.comment_count)
  return likes + comments
}

/** Busca profunda: `edge_followed_by.count` em qualquer nível do JSON do perfil. */
function deepFindEdgeFollowedByCount(obj: unknown, seen = new Set<unknown>()): number {
  if (obj == null || seen.has(obj)) return 0
  if (typeof obj !== 'object') return 0
  seen.add(obj)
  const o = obj as Record<string, unknown>
  if ('edge_followed_by' in o && o.edge_followed_by != null && typeof o.edge_followed_by === 'object') {
    const count = toFollowerNum((o.edge_followed_by as Record<string, unknown>).count)
    if (count > 0) return count
  }
  for (const key of Object.keys(o)) {
    const found = deepFindEdgeFollowedByCount(o[key], seen)
    if (found > 0) return found
  }
  return 0
}

/** Estima seguidores a partir de ER e interações (inverso da fórmula de ER). */
function inferFollowersFromEngagementStats(eng: EngagementStats): number {
  const er = eng.engagement_rate ?? 0
  const n = eng.posts_count ?? 0
  if (er <= 0 || n <= 0) return 0
  const total = (eng.total_likes ?? 0) + (eng.total_comments ?? 0)
  if (total <= 0) return 0
  const avg = total / n
  return Math.max(1, Math.round((avg * 100) / er))
}

/**
 * Estima seguidores pelo post de maior engajamento (~5% ER no pico).
 * Alinhado ao backend (`followersResolve.estimateFollowersFromPosts`).
 */
export function estimateFollowersFromPosts(posts: PostItem[]): number {
  let peak = 0
  for (const p of posts) {
    peak = Math.max(peak, postInteractions(p))
  }
  if (peak <= 0) return 0
  return Math.max(1, Math.round(peak / 0.05))
}

/** Extrai seguidores do perfil (documento, busca profunda, engagement da API, posts). */
export function getFollowersCountFromProfile(
  profile: ProfileItem | null | undefined,
  posts?: PostItem[]
): number {
  if (!profile || typeof profile !== 'object') return 0
  const p = profile as Record<string, unknown>
  const direct = p.followers_count
  if (typeof direct === 'number' && Number.isFinite(direct) && direct > 0) return Math.floor(direct)

  const user = (p.data as { user?: Record<string, unknown> } | undefined)?.user
  if (user) {
    if (typeof user.follower_count === 'number' && user.follower_count > 0) return Math.floor(user.follower_count)
    const edge = user.edge_followed_by as { count?: number } | undefined
    if (edge != null && typeof edge.count === 'number' && edge.count > 0) return Math.floor(edge.count)
  }

  const feedUser = (p.data as Record<string, unknown> | undefined)?.[
    'xdt_api__v1__feed__user_timeline_graphql_connection'
  ] as { feed_user?: Record<string, unknown> } | undefined
  const fu = feedUser?.feed_user
  if (fu) {
    if (typeof fu.follower_count === 'number' && fu.follower_count > 0) return Math.floor(fu.follower_count)
    const edge = fu.edge_followed_by as { count?: number } | undefined
    if (edge != null && typeof edge.count === 'number' && edge.count > 0) return Math.floor(edge.count)
  }

  const deep = deepFindEdgeFollowedByCount(p)
  if (deep > 0) return deep

  const apiEng = getProfilePreviewEngagement(profile)
  if (apiEng) {
    const inferred = inferFollowersFromEngagementStats(apiEng)
    if (inferred > 0) return inferred
  }

  if (posts && posts.length > 0) {
    const estimated = estimateFollowersFromPosts(posts)
    if (estimated > 0) return estimated
  }

  if (typeof direct === 'number' && Number.isFinite(direct) && direct >= 0) return Math.floor(direct)
  return 0
}

/** Engajamento: recalcula com posts quando há seguidores; senão usa `engagement` embutido na resposta da API. */
export function resolveEngagementForProfile(
  profile: ProfileItem | null | undefined,
  posts: PostItem[],
  followersCount: number
): EngagementStats {
  const fromPosts = computeEngagementFromPosts(posts, followersCount)
  if (followersCount > 0) return fromPosts
  const api = getProfilePreviewEngagement(profile)
  if (!api) return fromPosts
  const hasRate = (api.engagement_rate ?? 0) > 0
  const hasInteractions = (api.total_likes ?? 0) + (api.total_comments ?? 0) > 0
  if (hasRate || hasInteractions) return api
  return fromPosts
}

/** ER por tipo: preferir `engagementByType` da API quando seguidores não estão no documento. */
export function resolveEngagementByTypeForProfile(
  profile: ProfileItem | null | undefined,
  computed: ProfileEngagementByType,
  followersCount: number
): ProfileEngagementByType {
  if (followersCount > 0) return computed
  const api = getProfilePreviewEngagementByType(profile)
  if (!api) return computed
  const hasSignal =
    (api.posts.er ?? 0) > 0 ||
    (api.reels.er ?? 0) > 0 ||
    (api.reels.erByViews ?? 0) > 0 ||
    (api.tagged.er ?? 0) > 0
  return hasSignal ? api : computed
}
