/**
 * Filtro, ordenação e facets no cliente para a listagem de campanha.
 * Usado quando temos o contexto completo em cache para evitar chamadas à API a cada mudança de filtro.
 */
import type { ProfileListItem, ProfilesSearchQuery, ProfilesSearchFacets, LlmSearchFacets } from '../api'
import type { ProfilesSort } from '../api'
import { FOLLOWERS_SIZE_BUCKETS, followersCountToSizeKey } from '@repo/followersSizeBuckets'
import { getCostTier } from './pricing'
import { getSuggestedPricingFromFollowers } from '../constants/pricingBuckets'
import type { PricingData } from '../api'

type CostTier = 'low' | 'medium' | 'high' | 'very_high'

function getLlmQualification(record: Record<string, unknown>): Record<string, unknown> | null {
  const llm = record.llm
  if (llm == null || typeof llm !== 'object' || Array.isArray(llm)) return null
  const lo = llm as Record<string, unknown>
  const status = String(lo.status ?? '').trim().toLowerCase()
  if (status !== 'done') return null
  const q = lo.qualification
  if (q == null || typeof q !== 'object' || Array.isArray(q)) return null
  return q as Record<string, unknown>
}

function bumpFacetString(map: Map<string, number>, raw: string): void {
  const k = raw.trim().toLowerCase()
  if (!k) return
  map.set(k, (map.get(k) ?? 0) + 1)
}

function bumpFacetStringArray(map: Map<string, number>, arr: unknown): void {
  if (!Array.isArray(arr)) return
  for (const x of arr) {
    if (typeof x === 'string' && x.trim()) bumpFacetString(map, x)
  }
}

function mapToNameCountDesc(m: Map<string, number>): { name: string; count: number }[] {
  return [...m.entries()]
    .filter(([, count]) => count > 0)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
}

interface LlmFacetMaps {
  profileType: Map<string, number>
  mainCategory: Map<string, number>
  gender: Map<string, number>
  subCategories: Map<string, number>
  contentPillars: Map<string, number>
  audienceType: Map<string, number>
}

function createEmptyLlmFacetMaps(): LlmFacetMaps {
  return {
    profileType: new Map(),
    mainCategory: new Map(),
    gender: new Map(),
    subCategories: new Map(),
    contentPillars: new Map(),
    audienceType: new Map(),
  }
}

function accumulateLlmFacetsFromItem(item: ProfileListItem, maps: LlmFacetMaps): void {
  const q = getLlmQualification(item as unknown as Record<string, unknown>)
  if (!q) return
  bumpFacetString(maps.profileType, String(q.profileType ?? ''))
  bumpFacetString(maps.mainCategory, String(q.mainCategory ?? ''))
  bumpFacetString(maps.gender, String(q.gender ?? ''))
  bumpFacetStringArray(maps.subCategories, q.subCategories)
  bumpFacetStringArray(maps.contentPillars, q.contentPillars)
  bumpFacetStringArray(maps.audienceType, q.audienceType)
}

function mapsToLlmSearchFacets(maps: LlmFacetMaps): LlmSearchFacets {
  return {
    profileType: mapToNameCountDesc(maps.profileType),
    mainCategory: mapToNameCountDesc(maps.mainCategory),
    gender: mapToNameCountDesc(maps.gender),
    language: [],
    subCategories: mapToNameCountDesc(maps.subCategories),
    contentPillars: mapToNameCountDesc(maps.contentPillars),
    audienceType: mapToNameCountDesc(maps.audienceType),
    toneOfVoice: [],
    brandSafety: {
      level: [],
    },
  }
}

function parseStringArrayForLlm(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean)
  if (typeof v === 'string') return v.split(',').map((x) => x.trim()).filter(Boolean)
  return []
}

function qualificationArrayMatchesOr(q: Record<string, unknown>, key: string, selected: string[]): boolean {
  if (selected.length === 0) return true
  const set = new Set(selected.map((s) => s.trim().toLowerCase()).filter(Boolean))
  const arr = q[key]
  if (!Array.isArray(arr)) return false
  return arr.some((x) => typeof x === 'string' && set.has(x.trim().toLowerCase()))
}

function matchesLlmQualificationFilters(record: Record<string, unknown>, query: Partial<ProfilesSearchQuery>): boolean {
  const qual = getLlmQualification(record)
  if (!qual) return false

  const orScalar = (field: string, selected: string[]): boolean => {
    if (selected.length === 0) return true
    const set = new Set(selected.map((s) => s.trim().toLowerCase()).filter(Boolean))
    const v = String(qual[field] ?? '').trim().toLowerCase()
    return set.has(v)
  }

  if (!orScalar('profileType', parseStringArrayForLlm(query.llmProfileType))) return false
  if (!orScalar('mainCategory', parseStringArrayForLlm(query.llmMainCategory))) return false
  if (!orScalar('gender', parseStringArrayForLlm(query.llmGender))) return false

  if (!qualificationArrayMatchesOr(qual, 'subCategories', parseStringArrayForLlm(query.llmSubCategories))) return false
  if (!qualificationArrayMatchesOr(qual, 'contentPillars', parseStringArrayForLlm(query.llmContentPillars))) return false
  if (!qualificationArrayMatchesOr(qual, 'audienceType', parseStringArrayForLlm(query.llmAudienceType))) return false

  return true
}

function hasAnyLlmFilter(query: Partial<ProfilesSearchQuery>): boolean {
  return (
    (query.llmProfileType?.length ?? 0) > 0 ||
    (query.llmMainCategory?.length ?? 0) > 0 ||
    (query.llmGender?.length ?? 0) > 0 ||
    (query.llmSubCategories?.length ?? 0) > 0 ||
    (query.llmContentPillars?.length ?? 0) > 0 ||
    (query.llmAudienceType?.length ?? 0) > 0
  )
}

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

/** Normaliza chaves de filtro da URL/UI (`mid` legado → `medio`, mesma base do crawl). */
function normalizeSizeFilterQueryKey(s: string): string {
  const x = s.toLowerCase().trim()
  return x === 'mid' ? 'medio' : x
}

function getSizeFromItem(item: ProfileListItem): string | null {
  const fc = item.followers_count
  if (fc == null || !Number.isFinite(fc)) return null
  return followersCountToSizeKey(fc)
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
  /**
   * Restringe a estes handles (busca por legenda/conteúdo dos posts na campanha).
   * Quando definido, `q` no query não é aplicado em nome/bio (evita zerar a lista quando o termo só aparece em posts).
   */
  postCaptionMatchHandles?: Set<string>
}

export function filterAndSortCampaignItems(
  items: ProfileListItem[],
  query: Partial<ProfilesSearchQuery>,
  options?: FilterAndSortOptions
): ProfileListItem[] {
  let list = [...items]
  const q = (query.q ?? '').trim().toLowerCase()
  const sizeFilter = (query.sizeFilter ?? []).map((s) => normalizeSizeFilterQueryKey(String(s)))
  const accountTypeFilter = (query.accountTypeFilter ?? [])
  const contentTypesFilter = (query.contentTypes ?? []).map((s) => String(s).trim().toLowerCase()).filter(Boolean)
  const citiesFilter = (query.cities ?? []).map((s) => s.toLowerCase())
  const statesFilter = (query.states ?? []).map((s) => s.toLowerCase())
  const neighborhoodsFilter = (query.neighborhoods ?? []).map((s) => s.toLowerCase())
  const socialFilter = (query.socialNetworks ?? []).map((s) => s.toLowerCase())

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
  if (sizeFilter.length > 0) {
    const sizeSet = new Set(sizeFilter)
    list = list.filter((i) => {
      const size = getSizeFromItem(i)
      return size != null && sizeSet.has(size)
    })
  }
  if (accountTypeFilter.length > 0) {
    const typeSet = new Set(accountTypeFilter)
    list = list.filter((i) => {
      const at = (i as { account_type?: number }).account_type
      return at != null && typeSet.has(at)
    })
  }
  if (hasAnyLlmFilter(query)) {
    list = list.filter((i) => matchesLlmQualificationFilters(i as unknown as Record<string, unknown>, query))
  }
  const postHandles = options?.postCaptionMatchHandles
  if (postHandles != null) {
    list = list.filter((i) => {
      const h = (i.handle ?? i.key ?? '').toString().toLowerCase().replace(/^@/, '').trim()
      return !!h && postHandles.has(h)
    })
  } else if (q) {
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
  const llmFacetMaps = createEmptyLlmFacetMaps()
  let activatedCount = 0
  const contentTypeCount = new Map<string, number>()
  const cityCount = new Map<string, number>()
  const stateCount = new Map<string, number>()
  const neighborhoodCount = new Map<string, number>()
  const socialCount = { whatsapp: 0, tiktok: 0, facebook: 0, linkedin: 0, twitter: 0 }
  const sizeCount = new Map<string, number>()
  const accountTypeCount = new Map<number, number>()

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
    const size = getSizeFromItem(item)
    if (size) sizeCount.set(size, (sizeCount.get(size) ?? 0) + 1)
    const at = (item as { account_type?: number }).account_type
    if (at != null && (at === 1 || at === 2 || at === 3)) {
      accountTypeCount.set(at, (accountTypeCount.get(at) ?? 0) + 1)
    }
    accumulateLlmFacetsFromItem(item, llmFacetMaps)
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
    cost_tier: [],
    size_buckets: FOLLOWERS_SIZE_BUCKETS.map((b) => ({
      key: b.key === 'medio' ? 'mid' : b.key,
      label: b.key === 'medio' ? 'Mid' : b.label,
      count: sizeCount.get(b.key) ?? 0,
    })).filter((x) => x.count > 0),
    account_type: [
      { value: 1, label: 'Pessoal', count: accountTypeCount.get(1) ?? 0 },
      { value: 2, label: 'Criador', count: accountTypeCount.get(2) ?? 0 },
      { value: 3, label: 'Empresa', count: accountTypeCount.get(3) ?? 0 },
    ].filter((x) => x.count > 0),
    llm: mapsToLlmSearchFacets(llmFacetMaps),
  }
}
