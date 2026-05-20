import type { ProfileItem } from '../api'

/** Extrai seguidores do perfil (slim, data.user, feed_user da timeline). */
export function getFollowersCountFromProfile(profile: ProfileItem | null | undefined): number {
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

  if (typeof direct === 'number' && Number.isFinite(direct) && direct >= 0) return Math.floor(direct)
  return 0
}
