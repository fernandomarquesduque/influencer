/**
 * Filtro, ordenação e facets no cliente para a listagem de campanha.
 * Usado quando temos o contexto completo em cache para evitar chamadas à API a cada mudança de filtro.
 */
import type { ProfileListItem, ProfilesSearchQuery, ProfilesSearchFacets } from '../api'
import type { ProfilesSort } from '../api'
import { getCostTier } from './pricing'
import { getSuggestedPricingFromFollowers } from '../constants/pricingBuckets'
import type { PricingData } from '../api'

type CostTier = 'low' | 'medium' | 'high' | 'very_high'

function getSearchableTextFromItem(item: ProfileListItem): string {
  const precomputed = (item as Record<string, unknown>)._searchable_text
  if (typeof precomputed === 'string' && precomputed.trim()) {
    return precomputed.trim().toLowerCase().replace(/\s+/g, ' ')
  }
  const handle = (item.handle ?? item.key ?? '').toLowerCase().replace(/^@/, '')
  const fullName = (item.full_name ?? '').trim()
  const bio = (item.biography ?? '').trim()
  const categories = (item.categories ?? []).map((c) => String(c).trim().toLowerCase()).filter(Boolean)
  const parts = [handle, fullName, bio, ...categories]
  return parts.filter(Boolean).join(' ').toLowerCase().replace(/\s+/g, ' ')
}

function matchesQuery(searchableText: string, q: string): { match: boolean; relevance: number } {
  const qTrim = q.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!qTrim) return { match: true, relevance: 0 }
  const search = searchableText
  if (qTrim.includes(' ')) {
    if (search.includes(qTrim)) return { match: true, relevance: 2 }
    const words = qTrim.split(' ').filter((w) => w.length > 0)
    const allWordsMatch = words.every((word) => search.includes(word))
    return { match: allWordsMatch, relevance: allWordsMatch ? 1 : 0 }
  }
  if (search.includes(qTrim)) return { match: true, relevance: 2 }
  return { match: false, relevance: 0 }
}

function getCostTierFromItem(item: ProfileListItem): CostTier | null {
  const fromAct = getCostTier(item.activation?.pricing as PricingData | undefined)
  if (fromAct) return fromAct.tier as CostTier
  if (Number.isFinite(item.followers_count)) {
    const suggested = getSuggestedPricingFromFollowers(item.followers_count ?? 0)
    const fromSuggested = getCostTier(suggested as unknown as PricingData)
    if (fromSuggested) return fromSuggested.tier as CostTier
  }
  return null
}

function hasSocial(act: { whatsapp?: string; tiktok?: string; facebook?: string; linkedin?: string; twitter?: string }, net: string): boolean {
  const n = net.toLowerCase()
  if (n === 'whatsapp') return !!(act.whatsapp?.trim())
  if (n === 'tiktok') return !!(act.tiktok?.trim())
  if (n === 'facebook') return !!(act.facebook?.trim())
  if (n === 'linkedin') return !!(act.linkedin?.trim())
  if (n === 'twitter') return !!(act.twitter?.trim())
  return false
}

export interface FilterAndSortOptions {
  /** Handles favoritados pelo usuário (para ordenação por favorito). */
  favoriteHandles?: Set<string>
}

export function filterAndSortCampaignItems(
  items: ProfileListItem[],
  query: Partial<ProfilesSearchQuery>,
  options?: FilterAndSortOptions
): ProfileListItem[] {
  let list = [...items]
  const q = (query.q ?? '').trim().toLowerCase()
  const costTierFilter = (query.costTierFilter ?? []).map((s) => s.toLowerCase())
  const contentTypesFilter = (query.contentTypes ?? []).map((s) => String(s).trim().toLowerCase()).filter(Boolean)
  const activationFilter = (query.activationFilter ?? []).map((s) => s.toLowerCase())
  const citiesFilter = (query.cities ?? []).map((s) => s.toLowerCase())
  const statesFilter = (query.states ?? []).map((s) => s.toLowerCase())
  const neighborhoodsFilter = (query.neighborhoods ?? []).map((s) => s.toLowerCase())
  const socialFilter = (query.socialNetworks ?? []).map((s) => s.toLowerCase())

  if (activationFilter.length === 1) {
    const wantActivated = activationFilter[0] === 'activated'
    list = list.filter((i) => (wantActivated ? !!i.activation : !i.activation))
  }
  if (citiesFilter.length > 0) {
    list = list.filter(
      (i) => i.activation?.city?.trim() && citiesFilter.includes(i.activation.city.trim().toLowerCase())
    )
  }
  if (statesFilter.length > 0) {
    list = list.filter(
      (i) => i.activation?.state?.trim() && statesFilter.includes(i.activation.state.trim().toLowerCase())
    )
  }
  if (neighborhoodsFilter.length > 0) {
    list = list.filter((i) => {
      const raw = i.activation?.neighborhood?.trim()
      if (!raw) return false
      const parts = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
      return parts.some((p) => neighborhoodsFilter.includes(p))
    })
  }
  if (socialFilter.length > 0) {
    list = list.filter(
      (i) => i.activation && socialFilter.some((net) => hasSocial(i.activation!, net))
    )
  }
  if (contentTypesFilter.length > 0) {
    list = list.filter((i) => {
      const ct = i.activation?.content_type
      if (!ct || !Array.isArray(ct)) return false
      const ctLower = ct.map((c) => String(c).trim().toLowerCase()).filter(Boolean)
      return contentTypesFilter.some((fc) => ctLower.includes(fc))
    })
  }
  if (costTierFilter.length > 0) {
    const tierSet = new Set(costTierFilter)
    list = list.filter((i) => {
      const tier = getCostTierFromItem(i)
      return tier != null && tierSet.has(tier)
    })
  }
  if (q) {
    list = list.filter((i) => {
      const text = getSearchableTextFromItem(i)
      const { match, relevance } = matchesQuery(text, q)
      if (match) {
        ;(i as ProfileListItem & { search_relevance?: number }).search_relevance = relevance
        return true
      }
      return false
    })
  }

  const tierOrder = (t: CostTier | null): number => {
    if (!t) return 0
    if (t === 'low') return 1
    if (t === 'medium') return 2
    if (t === 'high') return 3
    if (t === 'very_high') return 4
    return 0
  }
  const favoriteHandles = options?.favoriteHandles
  const isFavorite = (item: ProfileListItem): boolean => {
    if (!favoriteHandles?.size) return false
    const h = (item.handle ?? item.key ?? '').toString().toLowerCase().replace(/^@/, '').trim()
    return h ? favoriteHandles.has(h) : false
  }
  const order = (query.sort ?? 'engagement_desc') as ProfilesSort
  const sortFn = (a: ProfileListItem, b: ProfileListItem): number => {
    if (order === 'relevance_desc' && q) {
      const relA = (a as ProfileListItem & { search_relevance?: number }).search_relevance ?? 0
      const relB = (b as ProfileListItem & { search_relevance?: number }).search_relevance ?? 0
      if (relB !== relA) return relB - relA
    }
    if (order === 'favorite_desc') {
      const favA = isFavorite(a) ? 1 : 0
      const favB = isFavorite(b) ? 1 : 0
      if (favB !== favA) return favB - favA
    }
    if (order === 'favorite_asc') {
      const favA = isFavorite(a) ? 1 : 0
      const favB = isFavorite(b) ? 1 : 0
      if (favA !== favB) return favA - favB
    }
    if (order === 'engagement_desc') return (b.engagement?.engagement_rate ?? 0) - (a.engagement?.engagement_rate ?? 0)
    if (order === 'engagement_asc') return (a.engagement?.engagement_rate ?? 0) - (b.engagement?.engagement_rate ?? 0)
    if (order === 'followers_desc') return (b.followers_count ?? 0) - (a.followers_count ?? 0)
    if (order === 'followers_asc') return (a.followers_count ?? 0) - (b.followers_count ?? 0)
    if (order === 'posts_count_desc') return (b.engagement?.posts_count ?? 0) - (a.engagement?.posts_count ?? 0)
    if (order === 'posts_count_asc') return (a.engagement?.posts_count ?? 0) - (b.engagement?.posts_count ?? 0)
    if (order === 'avg_likes_desc') return (b.engagement?.avg_likes ?? 0) - (a.engagement?.avg_likes ?? 0)
    if (order === 'avg_likes_asc') return (a.engagement?.avg_likes ?? 0) - (b.engagement?.avg_likes ?? 0)
    if (order === 'total_likes_desc') return (b.engagement?.total_likes ?? 0) - (a.engagement?.total_likes ?? 0)
    if (order === 'total_likes_asc') return (a.engagement?.total_likes ?? 0) - (b.engagement?.total_likes ?? 0)
    if (order === 'total_comments_desc') return (b.engagement?.total_comments ?? 0) - (a.engagement?.total_comments ?? 0)
    if (order === 'total_comments_asc') return (a.engagement?.total_comments ?? 0) - (b.engagement?.total_comments ?? 0)
    if (order === 'cost_tier_desc') return tierOrder(getCostTierFromItem(b)) - tierOrder(getCostTierFromItem(a))
    if (order === 'cost_tier_asc') return tierOrder(getCostTierFromItem(a)) - tierOrder(getCostTierFromItem(b))
    const nameA = ((a.full_name ?? a.handle ?? a.key) ?? '').toLowerCase()
    const nameB = ((b.full_name ?? b.handle ?? b.key) ?? '').toLowerCase()
    if (order === 'name_asc') return nameA.localeCompare(nameB)
    if (order === 'name_desc') return nameB.localeCompare(nameA)
    return 0
  }
  list.sort(sortFn)
  return list
}

export function computeFacetsFromItems(items: ProfileListItem[]): ProfilesSearchFacets {
  const total = items.length
  let activatedCount = 0
  const contentTypeCount = new Map<string, number>()
  const cityCount = new Map<string, number>()
  const stateCount = new Map<string, number>()
  const neighborhoodCount = new Map<string, number>()
  const socialCount = { whatsapp: 0, tiktok: 0, facebook: 0, linkedin: 0, twitter: 0 }
  const costTierCount = new Map<string, number>()

  for (const item of items) {
    if (item.activation) {
      activatedCount++
      const act = item.activation
      if (act.city?.trim()) cityCount.set(act.city.trim().toLowerCase(), (cityCount.get(act.city.trim().toLowerCase()) ?? 0) + 1)
      if (act.state?.trim()) stateCount.set(act.state.trim().toLowerCase(), (stateCount.get(act.state.trim().toLowerCase()) ?? 0) + 1)
      if (act.neighborhood?.trim()) {
        const parts = act.neighborhood.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
        for (const p of parts) neighborhoodCount.set(p, (neighborhoodCount.get(p) ?? 0) + 1)
      }
      if (act.whatsapp?.trim()) socialCount.whatsapp++
      if (act.tiktok?.trim()) socialCount.tiktok++
      if (act.facebook?.trim()) socialCount.facebook++
      if (act.linkedin?.trim()) socialCount.linkedin++
      if (act.twitter?.trim()) socialCount.twitter++
      const ct = act.content_type
      if (Array.isArray(ct)) {
        for (const v of ct) {
          if (v && typeof v === 'string') {
            const k = v.trim().toLowerCase()
            if (k) contentTypeCount.set(k, (contentTypeCount.get(k) ?? 0) + 1)
          }
        }
      }
    }
    const tier = getCostTierFromItem(item)
    if (tier) costTierCount.set(tier, (costTierCount.get(tier) ?? 0) + 1)
  }

  const engagementRateBuckets = [
    { key: 'baixa', label: 'Baixa', min: undefined as number | undefined, count: 0 },
    { key: 'media', label: 'Média', min: 1, count: 0 },
    { key: 'alta', label: 'Alta', min: 5, count: 0 },
  ]
  const avgLikesBuckets = [
    { key: 'baixa', label: 'Baixa', min: undefined as number | undefined, count: 0 },
    { key: 'media', label: 'Média', min: 500, count: 0 },
    { key: 'alta', label: 'Alta', min: 5000, count: 0 },
  ]
  const postsCountBuckets = [
    { key: 'baixa', label: 'Baixa', min: undefined as number | undefined, count: 0 },
    { key: 'media', label: 'Média', min: 25, count: 0 },
    { key: 'alta', label: 'Alta', min: 50, count: 0 },
  ]
  for (const item of items) {
    const rate = item.engagement?.engagement_rate ?? 0
    const avgLikes = item.engagement?.avg_likes ?? 0
    const postsCount = item.engagement?.posts_count ?? 0
    if (rate < 1) engagementRateBuckets[0]!.count++
    else if (rate < 5) engagementRateBuckets[1]!.count++
    else engagementRateBuckets[2]!.count++
    if (avgLikes < 500) avgLikesBuckets[0]!.count++
    else if (avgLikes < 5000) avgLikesBuckets[1]!.count++
    else avgLikesBuckets[2]!.count++
    if (postsCount < 25) postsCountBuckets[0]!.count++
    else if (postsCount < 50) postsCountBuckets[1]!.count++
    else postsCountBuckets[2]!.count++
  }

  const categoryCount = new Map<string, number>()
  for (const item of items) {
    for (const c of item.categories ?? []) {
      if (c && typeof c === 'string') {
        const key = c.trim().toLowerCase()
        if (key) categoryCount.set(key, (categoryCount.get(key) ?? 0) + 1)
      }
    }
  }

  return {
    categories: [...categoryCount.entries()].filter(([, count]) => count > 0).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    engagement_rate: engagementRateBuckets,
    avg_likes: avgLikesBuckets,
    posts_count: postsCountBuckets,
    activation: { activated: activatedCount, not_activated: total - activatedCount },
    content_type: [...contentTypeCount.entries()].filter(([, count]) => count > 0).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    cities: [...cityCount.entries()].filter(([, count]) => count > 0).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    states: [...stateCount.entries()].filter(([, count]) => count > 0).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    neighborhoods: [...neighborhoodCount.entries()].filter(([, count]) => count > 0).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    social: socialCount,
    cost_tier: [...costTierCount.entries()].filter(([, count]) => count > 0).map(([tier, count]) => ({ tier, count })).sort((a, b) => b.count - a.count),
  }
}
