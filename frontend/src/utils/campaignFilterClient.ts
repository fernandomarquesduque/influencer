/**
 * Filtro, ordenação e facets no cliente para a listagem de campanha.
 * Usado quando temos o contexto completo em cache para evitar chamadas à API a cada mudança de filtro.
 */
import type { ProfileListItem, ProfilesSearchQuery, ProfilesSearchFacets, LlmSearchFacets, PostItem } from '../api'
import type { ProfilesSort } from '../api'
import { FOLLOWERS_SIZE_BUCKETS, followersCountToSizeKey } from '@repo/followersSizeBuckets'
import { getCostTier } from './pricing'
import { getSuggestedPricingFromFollowers } from '../constants/pricingBuckets'
import type { PricingData } from '../api'
import { snapMainCategoryToTaxonomy } from '@repo/llmMainCategoryTaxonomy'
import { foldSearchText, matchesQuery } from './queryRelevance'

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

function bumpFacetMainCategory(map: Map<string, number>, raw: string): void {
  const c = snapMainCategoryToTaxonomy(String(raw ?? '').trim())
  if (!c) return
  map.set(c, (map.get(c) ?? 0) + 1)
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
  audienceType: Map<string, number>
  postSentiment: Map<string, number>
}

function createEmptyLlmFacetMaps(): LlmFacetMaps {
  return {
    profileType: new Map(),
    mainCategory: new Map(),
    gender: new Map(),
    audienceType: new Map(),
    postSentiment: new Map(),
  }
}

function accumulateLlmFacetsFromItem(item: ProfileListItem, maps: LlmFacetMaps): void {
  const q = getLlmQualification(item as unknown as Record<string, unknown>)
  if (q) {
    bumpFacetString(maps.profileType, String(q.profileType ?? ''))
    bumpFacetMainCategory(maps.mainCategory, String(q.mainCategory ?? ''))
    bumpFacetString(maps.gender, String(q.gender ?? ''))
    bumpFacetStringArray(maps.audienceType, q.audienceType)
  }
  const ps = String((item as Record<string, unknown>).llm_post_sentiment ?? '').trim().toLowerCase()
  if (ps === 'positivo' || ps === 'negativo' || ps === 'misto') {
    bumpFacetString(maps.postSentiment, ps)
  }
}

function mapsToLlmSearchFacets(maps: LlmFacetMaps): LlmSearchFacets {
  return {
    profileType: mapToNameCountDesc(maps.profileType),
    mainCategory: mapToNameCountDesc(maps.mainCategory),
    gender: mapToNameCountDesc(maps.gender),
    language: [],
    audienceType: mapToNameCountDesc(maps.audienceType),
    toneOfVoice: [],
    brandSafety: {
      level: [],
    },
    postSentiment: mapToNameCountDesc(maps.postSentiment),
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

/** Campos do painel BI: priorizam na ordenação, não reduzem o conjunto de resultados. */
export const CAMPAIGN_FACET_BOOST_KEYS = [
  'sizeFilter',
  'accountTypeFilter',
  'contentTypes',
  'cities',
  'states',
  'neighborhoods',
  'socialNetworks',
  'engagementRateBuckets',
  'avgLikesBuckets',
  'postsCountBuckets',
  'llmProfileType',
  'llmMainCategory',
  'llmGender',
  'llmAudienceType',
] as const satisfies readonly (keyof ProfilesSearchQuery)[]

export function stripCampaignFacetBoostFromQuery(
  query: Partial<ProfilesSearchQuery>
): Partial<ProfilesSearchQuery> {
  const out = { ...query }
  for (const k of CAMPAIGN_FACET_BOOST_KEYS) {
    delete out[k]
  }
  return out
}

export function pickCampaignFacetBoostFromQuery(
  query: Partial<ProfilesSearchQuery>
): Partial<ProfilesSearchQuery> {
  const out: Partial<ProfilesSearchQuery> = {}
  for (const k of CAMPAIGN_FACET_BOOST_KEYS) {
    const v = query[k]
    if (Array.isArray(v) && v.length > 0) {
      ; (out as Record<string, unknown>)[k] = [...v]
    }
  }
  return out
}

/** Atualiza uma dimensão do painel BI; outras dimensões (tipos diferentes) permanecem ativas. */
export function buildSingleCampaignFacetBoostPatch(
  activeKey: (typeof CAMPAIGN_FACET_BOOST_KEYS)[number],
  nextValue: string[] | number[] | undefined
): Partial<ProfilesSearchQuery> {
  const patch: Partial<ProfilesSearchQuery> = {}
  if (Array.isArray(nextValue) && nextValue.length > 0) {
    ; (patch as Record<string, unknown>)[activeKey] = [...nextValue]
  } else {
    ; (patch as Record<string, unknown>)[activeKey] = undefined
  }
  return patch
}

/** Chave estável para não refazer fetch de contexto quando só muda prioridade de facet. */
export function campaignContextFetchQueryKey(query: Partial<ProfilesSearchQuery>): string {
  return JSON.stringify(stripCampaignFacetBoostFromQuery(query))
}

export function isCampaignFacetBoostOnlyPatch(patch: Partial<ProfilesSearchQuery>): boolean {
  const keys = Object.keys(patch).filter((k) => k !== 'offset')
  if (keys.length === 0) return false
  return keys.every((k) => (CAMPAIGN_FACET_BOOST_KEYS as readonly string[]).includes(k))
}

export function hasCampaignFacetBoost(query: Partial<ProfilesSearchQuery>): boolean {
  return CAMPAIGN_FACET_BOOST_KEYS.some((k) => {
    const v = query[k]
    if (Array.isArray(v)) return v.length > 0
    return false
  })
}

/** Só opções com contagem > 0 (facets estritamente dos resultados atuais). */
export function filterFacetsForDisplay(facets: ProfilesSearchFacets): ProfilesSearchFacets {
  const nameCountPositive = (rows: { name: string; count: number }[]) =>
    rows.filter((r) => (r.count ?? 0) > 0)
  const llm = facets.llm
  return {
    ...facets,
    categories: nameCountPositive(facets.categories ?? []),
    content_type: nameCountPositive(facets.content_type ?? []),
    cities: nameCountPositive(facets.cities ?? []),
    states: nameCountPositive(facets.states ?? []),
    neighborhoods: nameCountPositive(facets.neighborhoods ?? []),
    engagement_rate: (facets.engagement_rate ?? []).filter((b) => (b.count ?? 0) > 0),
    avg_likes: (facets.avg_likes ?? []).filter((b) => (b.count ?? 0) > 0),
    posts_count: (facets.posts_count ?? []).filter((b) => (b.count ?? 0) > 0),
    size_buckets: (facets.size_buckets ?? []).filter((b) => (b.count ?? 0) > 0),
    account_type: (facets.account_type ?? []).filter((b) => (b.count ?? 0) > 0),
    llm: llm
      ? {
        profileType: nameCountPositive(llm.profileType ?? []),
        mainCategory: nameCountPositive(llm.mainCategory ?? []),
        gender: nameCountPositive(llm.gender ?? []),
        language: nameCountPositive(llm.language ?? []),
        audienceType: nameCountPositive(llm.audienceType ?? []),
        toneOfVoice: nameCountPositive(llm.toneOfVoice ?? []),
        brandSafety: { level: nameCountPositive(llm.brandSafety?.level ?? []) },
        postSentiment: nameCountPositive(llm.postSentiment ?? []),
      }
      : facets.llm,
  }
}

function facetAllowsSizeKey(facets: ProfilesSearchFacets, filterKey: string): boolean {
  const norm = normalizeSizeFilterQueryKey(filterKey)
  return (facets.size_buckets ?? []).some((b) => {
    if ((b.count ?? 0) <= 0) return false
    const bk = normalizeSizeFilterQueryKey(b.key)
    return bk === norm || b.key === filterKey
  })
}

function facetAllowsLlmName(facets: ProfilesSearchFacets, field: keyof LlmSearchFacets, raw: string): boolean {
  const llm = facets.llm
  if (!llm) return false
  const list = llm[field]
  if (!Array.isArray(list)) return false
  const n = raw.trim().toLowerCase()
  return list.some((x) => (x.count ?? 0) > 0 && String(x.name ?? '').trim().toLowerCase() === n)
}

/** Facetas já refletem resultados na tela (evita podar seleção durante reload com lista vazia). */
export function campaignSearchFacetsArePopulated(facets: ProfilesSearchFacets): boolean {
  if ((facets.size_buckets ?? []).some((b) => (b.count ?? 0) > 0)) return true
  if ((facets.engagement_rate ?? []).some((b) => (b.count ?? 0) > 0)) return true
  if ((facets.avg_likes ?? []).some((b) => (b.count ?? 0) > 0)) return true
  if ((facets.content_type ?? []).some((b) => (b.count ?? 0) > 0)) return true
  if ((facets.cities ?? []).some((b) => (b.count ?? 0) > 0)) return true
  if ((facets.states ?? []).some((b) => (b.count ?? 0) > 0)) return true
  const llm = facets.llm
  if (llm) {
    for (const field of ['profileType', 'mainCategory', 'gender', 'audienceType'] as const) {
      if ((llm[field] ?? []).some((r) => (r.count ?? 0) > 0)) return true
    }
  }
  return false
}

/** Remove prioridades de facet que não existem no conjunto atual de resultados. */
export function pruneInvalidCampaignFacetBoost(
  query: Partial<ProfilesSearchQuery>,
  facets: ProfilesSearchFacets | null
): Partial<ProfilesSearchQuery> | null {
  if (!facets || !hasCampaignFacetBoost(query) || !campaignSearchFacetsArePopulated(facets)) return null
  const next: Partial<ProfilesSearchQuery> = { ...query }
  let changed = false

  if (next.sizeFilter?.length) {
    const valid = next.sizeFilter.filter((k) => facetAllowsSizeKey(facets, k))
    const single = valid.length ? [valid[0]] : undefined
    if (
      next.sizeFilter.length !== 1 ||
      valid.length !== next.sizeFilter.length ||
      (single && single[0] !== next.sizeFilter[0])
    ) {
      next.sizeFilter = single
      changed = true
    }
  }
  const pruneLlmArr = (key: 'llmProfileType' | 'llmMainCategory' | 'llmGender' | 'llmAudienceType', facetKey: keyof LlmSearchFacets) => {
    const arr = next[key] as string[] | undefined
    if (!arr?.length) return
    const valid = arr.filter((v) => facetAllowsLlmName(facets, facetKey, v))
    if (valid.length !== arr.length) {
      ; (next as Record<string, unknown>)[key] = valid.length ? valid : undefined
      changed = true
    }
  }
  pruneLlmArr('llmProfileType', 'profileType')
  pruneLlmArr('llmMainCategory', 'mainCategory')
  pruneLlmArr('llmGender', 'gender')
  pruneLlmArr('llmAudienceType', 'audienceType')

  const pruneMetric = (key: 'engagementRateBuckets' | 'avgLikesBuckets', facetList: { min?: number; count: number }[]) => {
    const arr = next[key] as number[] | undefined
    if (!arr?.length) return
    const allowed = new Set(
      facetList.filter((b) => (b.count ?? 0) > 0).map((b) => b.min ?? 0)
    )
    const valid = arr.filter((n) => allowed.has(n))
    if (valid.length !== arr.length) {
      ; (next as Record<string, unknown>)[key] = valid.length ? valid : undefined
      changed = true
    }
  }
  pruneMetric('engagementRateBuckets', facets.engagement_rate ?? [])
  pruneMetric('avgLikesBuckets', facets.avg_likes ?? [])

  return changed ? next : null
}

function activeFacetBoostDimensions(query: Partial<ProfilesSearchQuery>): (keyof ProfilesSearchQuery)[] {
  return CAMPAIGN_FACET_BOOST_KEYS.filter((k) => {
    const v = query[k]
    return Array.isArray(v) && v.length > 0
  })
}

function itemMatchesFacetBoostDimension(
  item: ProfileListItem,
  query: Partial<ProfilesSearchQuery>,
  dimension: keyof ProfilesSearchQuery
): boolean {
  switch (dimension) {
    case 'sizeFilter': {
      const sizeFilter = (query.sizeFilter ?? []).map((s) => normalizeSizeFilterQueryKey(String(s)))
      if (sizeFilter.length === 0) return false
      const size = getSizeFromItem(item)
      return size != null && sizeFilter.includes(normalizeSizeFilterQueryKey(size))
    }
    case 'accountTypeFilter': {
      const sel = query.accountTypeFilter ?? []
      if (sel.length === 0) return false
      const at = (item as { account_type?: number }).account_type
      return at != null && sel.includes(at)
    }
    case 'contentTypes': {
      const sel = (query.contentTypes ?? []).map((s) => String(s).trim().toLowerCase()).filter(Boolean)
      if (sel.length === 0) return false
      const ct = item.activation?.content_type
      if (!Array.isArray(ct)) return false
      const ctLower = ct.map((c) => String(c).trim().toLowerCase()).filter(Boolean)
      return sel.some((fc) => ctLower.includes(fc))
    }
    case 'cities': {
      const sel = (query.cities ?? []).map((s) => s.toLowerCase())
      if (sel.length === 0) return false
      const city = item.activation?.city?.trim().toLowerCase()
      return !!city && sel.includes(city)
    }
    case 'states': {
      const sel = (query.states ?? []).map((s) => s.toLowerCase())
      if (sel.length === 0) return false
      const state = item.activation?.state?.trim().toLowerCase()
      return !!state && sel.includes(state)
    }
    case 'neighborhoods': {
      const sel = (query.neighborhoods ?? []).map((s) => s.toLowerCase())
      if (sel.length === 0) return false
      const raw = item.activation?.neighborhood?.trim()
      if (!raw) return false
      const parts = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
      return parts.some((p) => sel.includes(p))
    }
    case 'socialNetworks': {
      const sel = (query.socialNetworks ?? []).map((s) => s.toLowerCase())
      if (sel.length === 0 || !item.activation) return false
      return sel.some((net) => hasSocial(item.activation!, net))
    }
    case 'engagementRateBuckets': {
      const sel = (query.engagementRateBuckets ?? []).filter((n) => Number.isFinite(n))
      if (sel.length === 0) return false
      return matchesEngagementRateBuckets(item.engagement?.engagement_rate ?? 0, sel)
    }
    case 'avgLikesBuckets': {
      const sel = (query.avgLikesBuckets ?? []).filter((n) => Number.isFinite(n))
      if (sel.length === 0) return false
      return matchesAvgLikesBuckets(item.engagement?.avg_likes ?? 0, sel)
    }
    case 'postsCountBuckets':
      return false
    case 'llmProfileType':
    case 'llmMainCategory':
    case 'llmGender':
    case 'llmAudienceType': {
      const record = item as unknown as Record<string, unknown>
      const qual = getLlmQualification(record)
      if (!qual) return false
      if (dimension === 'llmProfileType') {
        const sel = parseStringArrayForLlm(query.llmProfileType)
        if (sel.length === 0) return false
        const set = new Set(sel.map((s) => s.trim().toLowerCase()))
        return set.has(String(qual.profileType ?? '').trim().toLowerCase())
      }
      if (dimension === 'llmGender') {
        const sel = parseStringArrayForLlm(query.llmGender)
        if (sel.length === 0) return false
        const set = new Set(sel.map((s) => s.trim().toLowerCase()))
        return set.has(String(qual.gender ?? '').trim().toLowerCase())
      }
      if (dimension === 'llmMainCategory') {
        const sel = parseStringArrayForLlm(query.llmMainCategory)
        if (sel.length === 0) return false
        const set = new Set(
          sel
            .map((s) => snapMainCategoryToTaxonomy(s.trim())?.toLowerCase())
            .filter((x): x is string => Boolean(x))
        )
        const stored = snapMainCategoryToTaxonomy(String(qual.mainCategory ?? '').trim())?.toLowerCase()
        return !!stored && set.has(stored)
      }
      return qualificationArrayMatchesOr(qual, 'audienceType', parseStringArrayForLlm(query.llmAudienceType))
    }
    default:
      return false
  }
}

/** Prioridade lexicográfica: cada dimensão selecionada no painel, em ordem, depois o sort padrão. */
function computeFacetBoostPriority(item: ProfileListItem, query: Partial<ProfilesSearchQuery>): number {
  const dims = activeFacetBoostDimensions(query)
  let priority = 0
  for (const dim of dims) {
    priority <<= 1
    if (itemMatchesFacetBoostDimension(item, query, dim)) priority |= 1
  }
  return priority
}

function compareFacetBoostPriority(a: number, b: number): number {
  if (b !== a) return b - a
  return 0
}

function postToProfileListItemForBoost(post: PostItem): ProfileListItem {
  const inf = post.influencer
  const profileRef = (post.profile_ref ?? '').trim()
  const handle = String(post.profile_handle ?? inf?.username ?? profileRef)
    .replace(/^@/, '')
    .trim()
  const key = profileRef || handle
  const fc = inf?.followers_count
  return {
    key,
    profile_ref: key,
    handle: handle || undefined,
    followers_count: typeof fc === 'number' && Number.isFinite(fc) ? fc : 0,
    llm: inf?.llm as ProfileListItem['llm'],
    engagement: {
      posts_count: 0,
      total_likes: 0,
      total_comments: 0,
      total_views: 0,
      avg_likes: typeof post.metrics?.likes === 'number' ? post.metrics.likes : 0,
      avg_comments: 0,
      avg_views: 0,
      engagement_rate: 0,
    },
    categories: [],
  } as ProfileListItem
}

type PostDiversityMeta = {
  sizeKey: string
  gender: string
  mainCategory: string
  audience: string
  profileType: string
}

function normalizeGenderForDiversity(raw: string): string {
  const x = raw.trim().toLowerCase()
  if (!x || x === '_' || x === 'unknown' || x === 'n/a') return '_'
  if (x === 'm' || x === 'male' || x === 'masculino' || x === 'homem' || x === 'man') return 'masculino'
  if (x === 'f' || x === 'female' || x === 'feminino' || x === 'mulher' || x === 'woman') return 'feminino'
  return x
}

function buildPostDiversityMeta(post: PostItem): PostDiversityMeta {
  const inf = post.influencer
  const fc = inf?.followers_count
  const sizeKey =
    typeof fc === 'number' && Number.isFinite(fc) ? followersCountToSizeKey(fc) : 'unknown'
  const qual = getLlmQualification((inf ?? {}) as unknown as Record<string, unknown>)
  let gender = '_'
  let mainCategory = '_'
  let audience = '_'
  let profileType = '_'
  if (qual) {
    gender = normalizeGenderForDiversity(String(qual.gender ?? ''))
    const mc = snapMainCategoryToTaxonomy(String(qual.mainCategory ?? '').trim())
    mainCategory = mc ? mc.toLowerCase() : '_'
    profileType = String(qual.profileType ?? '').trim().toLowerCase() || '_'
    const aud = qual.audienceType
    if (Array.isArray(aud) && aud.length > 0) {
      audience = String(aud[0] ?? '').trim().toLowerCase() || '_'
    }
  }
  return { sizeKey, gender, mainCategory, audience, profileType }
}

const DIVERSITY_NEW_BUCKET_BONUS = 110

function postDiversityDimensionKeys(m: PostDiversityMeta): string[] {
  return [
    `size:${m.sizeKey}`,
    `gender:${m.gender}`,
    `main:${m.mainCategory}`,
    `aud:${m.audience}`,
    `ptype:${m.profileType}`,
  ]
}

function postDiversityPenaltyForKey(dimKey: string): number {
  if (dimKey.startsWith('gender:')) return 85
  if (dimKey.startsWith('size:')) return 72
  return 12
}

function postDiversityScoreForPick(
  baseScore: number,
  m: PostDiversityMeta,
  dimCounts: Map<string, number>
): number {
  let score = baseScore
  for (const dk of postDiversityDimensionKeys(m)) {
    const seen = dimCounts.get(dk) ?? 0
    score -= seen * postDiversityPenaltyForKey(dk)
    if (seen === 0 && !dk.endsWith(':_') && !dk.endsWith(':unknown')) {
      score += DIVERSITY_NEW_BUCKET_BONUS
    }
  }
  return score
}

function getPostCaptionSearchText(post: PostItem): string {
  const parts: string[] = []
  const cap = post.content?.caption_text
  if (typeof cap === 'string' && cap.trim()) parts.push(cap.trim())
  const hashtags = post.content?.hashtags
  if (Array.isArray(hashtags)) {
    for (const h of hashtags) {
      if (typeof h === 'string' && h.trim()) parts.push(h.trim().replace(/^#/, ''))
    }
  }
  return foldSearchText(parts.join(' '))
}

/** Ordena posts da galeria Origem por relevância textual (frase exata primeiro). */
export function sortPostsBySearchRelevance(posts: PostItem[], q: string): PostItem[] {
  const qTrim = q.trim()
  if (!qTrim || posts.length < 2) return posts
  const scored = posts.map((post, idx) => ({
    post,
    relevance: matchesQuery(getPostCaptionSearchText(post), qTrim).relevance,
    idx,
  }))
  scored.sort((a, b) => {
    if (b.relevance !== a.relevance) return b.relevance - a.relevance
    const engDiff = postEngagementScore(b.post) - postEngagementScore(a.post)
    if (engDiff !== 0) return engDiff
    const tsDiff = postTimestamp(b.post) - postTimestamp(a.post)
    if (tsDiff !== 0) return tsDiff
    return a.idx - b.idx
  })
  return scored.map((s) => s.post)
}

/**
 * Sem filtro do painel BI: intercala porte, gênero, categoria etc. para facetas mais ricas.
 */
export function sortPostsByFacetDiversity(posts: PostItem[]): PostItem[] {
  if (posts.length < 2) return posts
  const remaining = [...posts]
  const result: PostItem[] = []
  const dimCounts = new Map<string, number>()
  while (remaining.length > 0) {
    let bestI = 0
    let bestScore = -Infinity
    for (let i = 0; i < remaining.length; i++) {
      const post = remaining[i]!
      const ref = (post.profile_ref ?? '').trim()
      const m = buildPostDiversityMeta(post)
      let baseScore = 1000 - i
      const seenRefs = new Set(result.map((p) => (p.profile_ref ?? '').trim()))
      if (ref && seenRefs.has(ref)) baseScore -= 500
      const score = postDiversityScoreForPick(baseScore, m, dimCounts)
      if (score > bestScore) {
        bestScore = score
        bestI = i
      }
    }
    const picked = remaining.splice(bestI, 1)[0]!
    for (const dk of postDiversityDimensionKeys(buildPostDiversityMeta(picked))) {
      dimCounts.set(dk, (dimCounts.get(dk) ?? 0) + 1)
    }
    result.push(picked)
  }
  return result
}

function postEngagementScore(post: PostItem): number {
  const likes = typeof post.metrics?.likes === 'number' && Number.isFinite(post.metrics.likes) ? post.metrics.likes : 0
  const comments =
    typeof post.metrics?.comments === 'number' && Number.isFinite(post.metrics.comments)
      ? post.metrics.comments
      : 0
  return likes + comments * 2
}

function postTimestamp(post: PostItem): number {
  const taken = post.post?.taken_at
  if (typeof taken === 'number' && Number.isFinite(taken)) return taken
  const created = (post.content as { caption_created_at?: number } | undefined)?.caption_created_at
  return typeof created === 'number' && Number.isFinite(created) ? created : 0
}

/** Dentro do mesmo nível de boost: relevância da busca ou engajamento/data. */
function sortPostsWithinBoostPriority(posts: PostItem[], searchQ?: string): PostItem[] {
  const qTrim = searchQ?.trim() ?? ''
  if (qTrim) return sortPostsBySearchRelevance(posts, qTrim)
  if (posts.length < 2) return posts
  return [...posts].sort((a, b) => {
    const engDiff = postEngagementScore(b) - postEngagementScore(a)
    if (engDiff !== 0) return engDiff
    const tsDiff = postTimestamp(b) - postTimestamp(a)
    if (tsDiff !== 0) return tsDiff
    return a.key.localeCompare(b.key)
  })
}

/** Com filtro BI: prioridade do boost; dentro do mesmo nível, engajamento/data (não diversidade por porte). */
export function sortPostsByBoostThenDiversity(
  posts: PostItem[],
  query: Partial<ProfilesSearchQuery>,
  searchQ?: string
): PostItem[] {
  if (!hasCampaignFacetBoost(query) || posts.length < 2) return posts
  const byPriority = new Map<number, PostItem[]>()
  for (const post of posts) {
    const p = computeFacetBoostPriority(postToProfileListItemForBoost(post), query)
    if (!byPriority.has(p)) byPriority.set(p, [])
    byPriority.get(p)!.push(post)
  }
  const priorities = [...byPriority.keys()].sort((a, b) => b - a)
  const out: PostItem[] = []
  for (const pr of priorities) {
    out.push(...sortPostsWithinBoostPriority(byPriority.get(pr)!, searchQ))
  }
  return out
}

/** Busca textual + painel BI: porte/facet que casa primeiro; dentro do grupo, relevância da legenda. */
export function sortPostsByBoostThenSearchRelevance(
  posts: PostItem[],
  query: Partial<ProfilesSearchQuery>,
  searchQ: string
): PostItem[] {
  const qTrim = searchQ.trim()
  if (!qTrim) return sortPostsByCampaignFacetBoost(posts, query)
  if (!hasCampaignFacetBoost(query) || posts.length < 2) return sortPostsBySearchRelevance(posts, searchQ)
  return sortPostsByBoostThenDiversity(posts, query, searchQ)
}

/** Ordena posts da galeria Origem: quem casa com os facets selecionados sobe (sem remover itens). */
export function sortPostsByCampaignFacetBoost(
  posts: PostItem[],
  query: Partial<ProfilesSearchQuery>,
  searchQ?: string
): PostItem[] {
  if (!hasCampaignFacetBoost(query)) return posts
  return sortPostsByBoostThenDiversity(posts, query, searchQ)
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

/** Normaliza chaves de filtro da URL/UI (`mid` → `medio`; `subnano` legado → `nano`). */
function normalizeSizeFilterQueryKey(s: string): string {
  const x = s.toLowerCase().trim()
  if (x === 'mid') return 'medio'
  if (x === 'subnano') return 'nano'
  return x
}

function getSizeFromItem(item: ProfileListItem): string | null {
  const fc = item.followers_count
  if (fc == null || !Number.isFinite(fc)) return null
  return followersCountToSizeKey(fc)
}

/** Posts da galeria Origem vêm sem métricas de engajamento do perfil — não inflar facetas. */
function itemHasProfileEngagementMetrics(item: ProfileListItem): boolean {
  const eng = item.engagement
  if (!eng) return false
  return (
    (eng.posts_count ?? 0) > 0 ||
    (eng.engagement_rate ?? 0) > 0 ||
    (eng.avg_likes ?? 0) > 0 ||
    (eng.total_likes ?? 0) > 0
  )
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

function matchesAvgLikesBuckets(avgLikes: number, selected: number[]): boolean {
  if (selected.length === 0) return true
  if (selected.includes(0) && avgLikes < 500) return true
  if (selected.includes(500) && avgLikes >= 500 && avgLikes < 5000) return true
  if (selected.includes(5000) && avgLikes >= 5000) return true
  return false
}

function matchesEngagementRateBuckets(rate: number, selected: number[]): boolean {
  if (selected.length === 0) return true
  if (selected.includes(0) && rate < 1) return true
  if (selected.includes(1) && rate >= 1 && rate < 5) return true
  if (selected.includes(5) && rate >= 5) return true
  return false
}

export function facetBucketFilterMin(bucket: { min?: number }): number {
  return bucket.min ?? 0
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
  const postHandles = options?.postCaptionMatchHandles
  if (postHandles != null) {
    list = list.filter((i) => {
      const ref = (i.profile_ref ?? i.key ?? '').toString().trim()
      return !!ref && postHandles.has(ref)
    })
  } else if (q) {
    list = list.filter((i) => {
      const text = getSearchableTextFromItem(i)
      const { match, relevance } = matchesQuery(text, q)
      if (match) {
        ; (i as ProfileListItem & { search_relevance?: number }).search_relevance = relevance
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
  const order = (query.sort ?? (q ? 'relevance_desc' : 'relevance_desc')) as ProfilesSort
  const sortFn = (a: ProfileListItem, b: ProfileListItem): number => {
    if (q) {
      const relA = (a as ProfileListItem & { search_relevance?: number }).search_relevance ?? 0
      const relB = (b as ProfileListItem & { search_relevance?: number }).search_relevance ?? 0
      if (relB !== relA) return relB - relA
    }
    const boostCmp = compareFacetBoostPriority(
      computeFacetBoostPriority(a, query),
      computeFacetBoostPriority(b, query)
    )
    if (boostCmp !== 0) return boostCmp
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

/** Um perfil por `profile_ref` a partir dos posts da galeria Origem (facets da busca por legenda). */
export function profileListItemsFromOriginPosts(posts: PostItem[]): ProfileListItem[] {
  const byRef = new Map<string, ProfileListItem>()
  for (const post of posts) {
    const ref = (post.profile_ref ?? '').trim()
    if (!ref || byRef.has(ref)) continue
    const inf = post.influencer
    byRef.set(ref, {
      key: ref,
      profile_ref: ref,
      avatar_url: typeof post.avatar_url === 'string' ? post.avatar_url : undefined,
      full_name: inf?.full_name,
      followers_count: inf?.followers_count ?? 0,
      llm: inf?.llm as ProfileListItem['llm'],
      engagement: {
        posts_count: 0,
        total_likes: 0,
        total_comments: 0,
        total_views: 0,
        avg_likes: 0,
        avg_comments: 0,
        avg_views: 0,
        engagement_rate: 0,
      },
    })
  }
  return [...byRef.values()]
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
    if (!itemHasProfileEngagementMetrics(item)) continue
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
    engagement_rate: engagementRateBuckets.filter((b) => (b.count ?? 0) > 0),
    avg_likes: avgLikesBuckets.filter((b) => (b.count ?? 0) > 0),
    posts_count: postsCountBuckets.filter((b) => (b.count ?? 0) > 0),
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
