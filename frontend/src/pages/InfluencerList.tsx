import { useEffect, useState, useRef, useMemo, useCallback } from 'react'
import { useNavigate, useLocation, useParams, Link, Navigate } from 'react-router-dom'
import {
  Row,
  Col,
  Spin,
  Typography,
  Empty,
  Input,
  Select,
  Button,
  Space,
  Collapse,
  Drawer,
  Grid,
} from 'antd'
import { SearchOutlined, FilterOutlined, ClearOutlined } from '@ant-design/icons'

const { useBreakpoint } = Grid
import { fetchProfilesSearch, fetchProfile, type ProfileListItem, type ProfilesSearchQuery, type ProfilesSort, type ProfilesSearchFacets } from '../api'
import ProfileSummaryCard from '../components/ProfileSummaryCard'
import { CONTENT_TYPE_LABELS } from '../constants/contentTypes'
import { PRICE_BUCKETS } from '../constants/pricingBuckets'
import { useAuth } from '../contexts/AuthContext'
import { useListCache } from '../contexts/ListCacheContext'
import SearchWizard from '../components/SearchWizard/SearchWizard'
import ReportDashboard from '../components/ReportDashboard/ReportDashboard'

const { Text } = Typography

const LIST_VIEW_PARAM = 'view'

/** Serializa query para URL (filtros iniciais + avançados). */
function queryToUrlParams(query: ProfilesSearchQuery): Record<string, string> {
  const params: Record<string, string> = {}
  if (query.q) params.q = query.q
  if (query.categories != null) {
    params.categories = Array.isArray(query.categories) ? query.categories.join(',') : String(query.categories)
  }
  if (query.minFollowers != null) params.minFollowers = String(query.minFollowers)
  if (query.maxFollowers != null) params.maxFollowers = String(query.maxFollowers)
  if (query.engagementRateBuckets?.length) params.engagement = query.engagementRateBuckets.join(',')
  if (query.excludePrivate) params.excludePrivate = '1'
  if (query.accountTypeFilter?.length) params.accountType = query.accountTypeFilter.join(',')
  if (query.avgLikesBuckets?.length) params.avgLikes = query.avgLikesBuckets.join(',')
  if (query.postsCountBuckets?.length) params.postsCount = query.postsCountBuckets.join(',')
  if (query.activationFilter?.length) params.activation = query.activationFilter.join(',')
  if (query.cities?.length) params.cities = query.cities.join(',')
  if (query.states?.length) params.states = query.states.join(',')
  if (query.neighborhoods?.length) params.neighborhoods = query.neighborhoods.join(',')
  if (query.socialNetworks?.length) params.social = query.socialNetworks.join(',')
  if (query.contentTypes?.length) params.contentTypes = query.contentTypes.join(',')
  if (query.pricingPostUnique?.length) params.pricingPostUnique = query.pricingPostUnique.join(',')
  if (query.pricingStories?.length) params.pricingStories = query.pricingStories.join(',')
  if (query.pricingPackageMonthly?.length) params.pricingPackageMonthly = query.pricingPackageMonthly.join(',')
  if (query.pricingCommission?.length) params.pricingCommission = query.pricingCommission.join(',')
  if (query.pricingPermuta?.length) params.pricingPermuta = query.pricingPermuta.join(',')
  if (query.pricingImageRights?.length) params.pricingImageRights = query.pricingImageRights.join(',')
  if (query.pricingContentDelivery?.length) params.pricingContentDelivery = query.pricingContentDelivery.join(',')
  if (query.pricingLaunch?.length) params.pricingLaunch = query.pricingLaunch.join(',')
  if (query.sort) params.sort = query.sort
  if (query.offset != null && query.offset > 0) params.offset = String(query.offset)
  return params
}

const WIZARD_DONE_PARAM = 'done'

/** Deserializa URL para query. Listagem só aparece se tiver q e done=1 (wizard completo). Categories é opcional (busca só por termo). */
function urlParamsToQuery(params: URLSearchParams): Partial<ProfilesSearchQuery> & { hasMandatory: boolean } {
  const q = params.get('q')?.trim()
  const categoriesRaw = params.get('categories')
  const categories = categoriesRaw
    ? categoriesRaw.split(',').map((c) => c.trim()).filter(Boolean)
    : undefined
  const done = params.get(WIZARD_DONE_PARAM) === '1'
  const hasMandatory = !!(q && q.length >= 3 && done)
  const parseNumList = (s: string | null): number[] | undefined => {
    if (!s) return undefined
    const arr = s.split(',').map((x) => Number(x.trim())).filter(Number.isFinite)
    return arr.length ? arr : undefined
  }
  return {
    hasMandatory,
    q: q || undefined,
    categories,
    minFollowers: params.has('minFollowers') ? Number(params.get('minFollowers')) : undefined,
    maxFollowers: params.has('maxFollowers') ? Number(params.get('maxFollowers')) : undefined,
    engagementRateBuckets: parseNumList(params.get('engagement')),
    excludePrivate: params.get('excludePrivate') === '1',
    accountTypeFilter: parseNumList(params.get('accountType')),
    avgLikesBuckets: parseNumList(params.get('avgLikes')),
    postsCountBuckets: parseNumList(params.get('postsCount')),
    activationFilter: params.get('activation')?.split(',').map((x) => x.trim()).filter(Boolean),
    cities: params.get('cities')?.split(',').map((x) => x.trim()).filter(Boolean),
    states: params.get('states')?.split(',').map((x) => x.trim()).filter(Boolean),
    neighborhoods: params.get('neighborhoods')?.split(',').map((x) => x.trim()).filter(Boolean),
    socialNetworks: params.get('social')?.split(',').map((x) => x.trim()).filter(Boolean),
    contentTypes: params.get('contentTypes')?.split(',').map((x) => x.trim()).filter(Boolean),
    pricingPostUnique: parseNumList(params.get('pricingPostUnique')),
    pricingStories: parseNumList(params.get('pricingStories')),
    pricingPackageMonthly: parseNumList(params.get('pricingPackageMonthly')),
    pricingCommission: parseNumList(params.get('pricingCommission')),
    pricingPermuta: parseNumList(params.get('pricingPermuta')),
    pricingImageRights: parseNumList(params.get('pricingImageRights')),
    pricingContentDelivery: parseNumList(params.get('pricingContentDelivery')),
    pricingLaunch: parseNumList(params.get('pricingLaunch')),
    sort: (params.get('sort') as ProfilesSort) || undefined,
    offset: params.has('offset') ? Number(params.get('offset')) : undefined,
  }
}

const PRICING_FILTER_KEYS = [
  'pricingPostUnique',
  'pricingStories',
  'pricingPackageMonthly',
  'pricingCommission',
  'pricingPermuta',
  'pricingImageRights',
  'pricingContentDelivery',
  'pricingLaunch',
] as const

const PRICING_FILTER_LABELS: Record<(typeof PRICING_FILTER_KEYS)[number], string> = {
  pricingPostUnique: 'Preço por Post único',
  pricingStories: 'Preço por Stories',
  pricingPackageMonthly: 'Preço por Pacote mensal',
  pricingCommission: 'Preço por Comissão',
  pricingPermuta: 'Preço por Permuta',
  pricingImageRights: 'Preço por Uso de imagem',
  pricingContentDelivery: 'Preço por Entrega de conteúdo',
  pricingLaunch: 'Preço por Lançamento',
}

const SORT_OPTIONS: { value: ProfilesSort; label: string }[] = [
  { value: 'relevance_desc', label: 'Mais relevante' },
  { value: 'engagement_desc', label: 'Maior engajamento %' },
  { value: 'engagement_asc', label: 'Menor engajamento %' },
  { value: 'avg_likes_desc', label: 'Mais likes/post' },
  { value: 'avg_likes_asc', label: 'Menos likes/post' },
  { value: 'total_likes_desc', label: 'Mais likes total' },
  { value: 'total_likes_asc', label: 'Menos likes total' },
  { value: 'followers_desc', label: 'Mais seguidores' },
  { value: 'followers_asc', label: 'Menos seguidores' },
]

const PAGE_SIZE = 12

const PUBLIC_LIMIT_CODES = ['PUBLIC_PAGE_LIMIT', 'PUBLIC_FILTERS_NOT_ALLOWED', 'PUBLIC_SEARCH_LIMIT']

/** Lê params da hash (#q=moda&categories=...) e retorna URLSearchParams. */
function getParamsFromHash(location: { hash: string }): URLSearchParams {
  const hash = location.hash?.trim().replace(/^#/, '') || ''
  if (!hash) return new URLSearchParams()
  return new URLSearchParams(hash)
}

export default function InfluencerList() {
  const navigate = useNavigate()
  const location = useLocation()
  const { handle: urlHandle } = useParams<{ handle?: string }>()
  const { user, isPublic } = useAuth()
  const { getCache, saveCache } = useListCache()
  const isLimitedView = !user || isPublic
  const hashParams = useMemo(() => getParamsFromHash(location), [location.hash])
  const parsedUrl = useMemo(() => urlParamsToQuery(hashParams), [hashParams])
  const hasMandatoryFilters = parsedUrl.hasMandatory

  const setFilterParams = useCallback(
    (params: Record<string, string> | URLSearchParams) => {
      const str = params instanceof URLSearchParams ? params.toString() : new URLSearchParams(params).toString()
      const newHash = str ? `#${str}` : ''
      navigate({ pathname: location.pathname, search: location.search, hash: newHash }, { replace: true })
    },
    [navigate, location.pathname, location.search]
  )

  const handleWizardFiltersChange = useCallback(
    (query: Partial<ProfilesSearchQuery>) => {
      const params = queryToUrlParams({ ...query, limit: PAGE_SIZE, offset: 0, sort: 'relevance_desc' })
      setFilterParams(new URLSearchParams(params))
    },
    [setFilterParams]
  )

  const handleWizardEstimate = useCallback(async (query: Partial<ProfilesSearchQuery>) => {
    const res = await fetchProfilesSearch({
      ...query,
      limit: 1,
      offset: 0,
      sort: 'relevance_desc',
    })
    return { total: res.total, facets: res.facets ?? null }
  }, [])

  const handleWizardComplete = useCallback(
    (payload: Partial<ProfilesSearchQuery>) => {
      const q = payload.q?.trim() || (payload.categories?.[0] ?? 'criadores')
      const categories = payload.categories?.length ? payload.categories : undefined
      const fullPayload = {
        ...payload,
        q,
        categories,
        limit: PAGE_SIZE,
        offset: 0,
        sort: 'relevance_desc' as const,
      }
      const params = queryToUrlParams(fullPayload)
      params[WIZARD_DONE_PARAM] = '1'
      params[LIST_VIEW_PARAM] = 'dashboard'
      setFilterParams(new URLSearchParams(params))
    },
    [setFilterParams]
  )

  const handleWizardSearchTermChange = useCallback(
    (q: string) => {
      if (q.length >= 3) {
        setFilterParams({ q })
      } else if (!q) {
        setFilterParams({})
      }
    },
    [setFilterParams]
  )

  const fullQueryFromUrl = hasMandatoryFilters
    ? (() => {
        const { hasMandatory: _hm, ...rest } = parsedUrl
        return { ...rest, limit: PAGE_SIZE, offset: rest.offset ?? 0, sort: (rest.sort as ProfilesSort) ?? 'relevance_desc' }
      })()
    : null
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [data, setData] = useState<ProfileListItem[]>([])
  const [total, setTotal] = useState(0)
  const [facets, setFacets] = useState<ProfilesSearchFacets | null>(null)
  const [searchInput, setSearchInput] = useState(parsedUrl.q ?? '')
  const [query, setQuery] = useState<ProfilesSearchQuery>({
    limit: PAGE_SIZE,
    offset: 0,
    sort: 'engagement_desc' as ProfilesSort,
  })
  const [limitReachedCode, setLimitReachedCode] = useState<string | null>(null)
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false)
  const filterDrawerRef = useRef<HTMLDivElement>(null)
  const scrollToRestoreRef = useRef<number | null>(null)
  const screens = useBreakpoint()
  const showFiltersSidebar = screens.lg

  /** Handles cuja foto falhou e foi enfileirado refresh; atualizamos só esse item na lista quando o perfil voltar com URL nova. */
  const handlesPendingImageRef = useRef<Set<string>>(new Set())
  const imagePollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const dataRef = useRef<ProfileListItem[]>([])
  useEffect(() => {
    dataRef.current = data
  }, [data])

  const updateOneProfileInList = useRef<(handle: string, profile: Record<string, unknown>) => void>(() => { })
  updateOneProfileInList.current = (handle: string, profile: Record<string, unknown>) => {
    const h = String(handle).toLowerCase().replace(/^@/, '')
    setData((prev) =>
      prev.map((item) => {
        const itemKey = String(item.key ?? item.handle ?? '').toLowerCase().replace(/^@/, '')
        if (itemKey !== h) return item
        const picUrl = profile.profile_pic_url != null && typeof profile.profile_pic_url === 'string' ? profile.profile_pic_url : item.profile_pic_url
        const hdPicUrl = profile.hd_profile_pic_url != null && typeof profile.hd_profile_pic_url === 'string' ? profile.hd_profile_pic_url : item.hd_profile_pic_url
        return {
          ...item,
          profile_pic_url: picUrl,
          hd_profile_pic_url: hdPicUrl,
          data: (profile.data ?? item.data) as Record<string, unknown> | undefined,
        }
      })
    )
  }

  /** Quando uma foto falha, enfileiramos o handle e passamos a buscar só esse perfil (GET /profiles/:handle) a cada 15s; só removemos da fila quando a API devolver URL de foto nova (refresh concluído) ou após max tentativas. */
  const addHandleForImageUpdate = useRef<(handle: string) => void>(() => { })
  addHandleForImageUpdate.current = (handle: string) => {
    const h = String(handle).toLowerCase().replace(/^@/, '')
    if (!h) return
    handlesPendingImageRef.current.add(h)
    if (imagePollingIntervalRef.current) return
    const REFETCH_INTERVAL_MS = 15_000
    const REFETCH_MAX_PER_HANDLE = 12
    const counts = new Map<string, number>()
    imagePollingIntervalRef.current = setInterval(() => {
      const set = handlesPendingImageRef.current
      if (set.size === 0) {
        if (imagePollingIntervalRef.current) {
          clearInterval(imagePollingIntervalRef.current)
          imagePollingIntervalRef.current = null
        }
        return
      }
      set.forEach((h) => {
        const n = (counts.get(h) ?? 0) + 1
        counts.set(h, n)
        if (n > REFETCH_MAX_PER_HANDLE) {
          set.delete(h)
          counts.delete(h)
          return
        }
        fetchProfile(h)
          .then((p) => {
            if (!p || typeof p !== 'object') return
            const prof = p as Record<string, unknown>
            const newPic = (prof.profile_pic_url ?? prof.hd_profile_pic_url) as string | undefined
            const dataUser = prof.data as Record<string, unknown> | undefined
            const newPicFromData = (dataUser?.user as Record<string, unknown> | undefined)?.profile_pic_url as string | undefined
            const newUrl = newPic ?? newPicFromData
            const current = dataRef.current.find((item) => String(item.key ?? item.handle ?? '').toLowerCase().replace(/^@/, '') === h)
            const currentUser = (current?.data as Record<string, unknown> | undefined)?.user as Record<string, unknown> | undefined
            const currentUrl = (current?.profile_pic_url ?? current?.hd_profile_pic_url ?? currentUser?.profile_pic_url) as string | undefined
            updateOneProfileInList.current(h, prof)
            if (typeof newUrl === 'string' && newUrl !== currentUrl) {
              set.delete(h)
              counts.delete(h)
            }
          })
          .catch(() => { })
      })
    }, REFETCH_INTERVAL_MS)
  }
  useEffect(() => {
    return () => {
      if (imagePollingIntervalRef.current) {
        clearInterval(imagePollingIntervalRef.current)
        imagePollingIntervalRef.current = null
      }
    }
  }, [])

  const load = (overrides?: Partial<ProfilesSearchQuery>, signal?: AbortSignal) => {
    setLimitReachedCode(null)
    let q: ProfilesSearchQuery = { ...query, ...overrides, limit: overrides?.limit ?? PAGE_SIZE }
    if (isLimitedView) {
      q = { ...q, limit: 12, offset: 0 }
    }
    const isLoadMore = (q.offset ?? 0) > 0
    if (isLoadMore) setLoadingMore(true)
    else setLoading(true)
    fetchProfilesSearch(q, { signal })
      .then((res) => {
        if (signal?.aborted) return
        if (isLoadMore) {
          setData((prev) => [...prev, ...res.items])
        } else {
          setData(res.items)
        }
        setTotal(res.total)
        if (res.facets) setFacets(res.facets)
      })
      .catch((e) => {
        if (signal?.aborted || (e as Error).name === 'AbortError') return
        const code = (e as Error & { code?: string }).code
        if (code && PUBLIC_LIMIT_CODES.includes(code)) {
          setLimitReachedCode(code)
          if (!isLoadMore) {
            setData([])
            setTotal(0)
            setFacets(null)
          }
          return
        }
        if (!isLoadMore) {
          setData([])
          setTotal(0)
          setFacets(null)
        }
      })
      .finally(() => {
        if (signal?.aborted) return
        setLoading(false)
        setLoadingMore(false)
      })
  }

  useEffect(() => {
    if (!hasMandatoryFilters) {
      setSearchInput(parsedUrl.q ?? '')
      setData([])
      setTotal(0)
      setFacets(null)
      setQuery({ limit: PAGE_SIZE, offset: 0, sort: 'engagement_desc' as ProfilesSort })
      return
    }
    const fullQuery = fullQueryFromUrl!
    const cached = getCache()
    if (cached && cached.q === fullQuery.q?.trim()) {
      setData(cached.data)
      setTotal(cached.total)
      setFacets(cached.facets)
      setQuery(cached.query)
      setSearchInput(cached.searchInput)
      if (cached.scrollPosition != null) scrollToRestoreRef.current = cached.scrollPosition
      return
    }
    setSearchInput(fullQuery.q ?? '')
    setQuery(fullQuery)
    const controller = new AbortController()
    load(fullQuery, controller.signal)
    return () => controller.abort()
  }, [hasMandatoryFilters, location.hash, setFilterParams])

  useEffect(() => {
    if (!loading && !loadingMore && hasMandatoryFilters && query.q?.trim() && (data.length > 0 || total > 0 || facets != null)) {
      saveCache({
        q: query.q.trim(),
        data,
        total,
        facets,
        query,
        searchInput,
        scrollPosition: typeof window !== 'undefined' ? window.scrollY : 0,
      })
    }
  }, [loading, loadingMore, hasMandatoryFilters, query, data, total, facets, searchInput, saveCache])

  useEffect(() => {
    if (scrollToRestoreRef.current != null) {
      const y = scrollToRestoreRef.current
      scrollToRestoreRef.current = null
      requestAnimationFrame(() => {
        window.scrollTo({ top: y, behavior: 'auto' })
      })
    }
  })

  const myHandle = user?.profile_handle?.replace(/^@/, '').toLowerCase()
  const isViewingOwnProfile = user?.scope === 'influencer' && myHandle && urlHandle
    ? decodeURIComponent(urlHandle).toLowerCase() === myHandle
    : false
  if (user?.scope === 'influencer' && user.profile_handle && !isViewingOwnProfile) {
    return <Navigate to={myHandle ? `/app/influencer/${encodeURIComponent(myHandle)}` : '/app'} replace />
  }

  const runSearch = () => {
    const q = searchInput.trim()
    if (!q) {
      setFilterParams({})
      return
    }
    const newQuery = { ...query, q, offset: 0 }
    setQuery(newQuery)
    const params = queryToUrlParams(newQuery)
    params[WIZARD_DONE_PARAM] = '1'
    setFilterParams(new URLSearchParams(params))
    load(newQuery)
  }

  const openDetail = (handleOrKey: string) => {
    const path = `/app/influencer/${encodeURIComponent(handleOrKey)}`
    const url = typeof window !== 'undefined' ? `${window.location.origin}${path}` : path
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const selectedCategories = (query.categories ?? []) as string[]
  const selectedEngagementRate = (query.engagementRateBuckets ?? []) as number[]
  const selectedAvgLikes = (query.avgLikesBuckets ?? []) as number[]
  const selectedPostsCount = (query.postsCountBuckets ?? []) as number[]
  const selectedActivation = (query.activationFilter ?? []) as string[]
  const selectedCities = (query.cities ?? []) as string[]
  const selectedStates = (query.states ?? []) as string[]
  const selectedNeighborhoods = (query.neighborhoods ?? []) as string[]
  const selectedSocial = (query.socialNetworks ?? []) as string[]
  const selectedContentTypes = (query.contentTypes ?? []) as string[]
  const selectedExcludePrivate = query.excludePrivate === true
  const selectedAccountType = (query.accountTypeFilter ?? []) as number[]
  const selectedPricingPostUnique = (query.pricingPostUnique ?? []) as number[]
  const selectedPricingStories = (query.pricingStories ?? []) as number[]
  const selectedPricingPackageMonthly = (query.pricingPackageMonthly ?? []) as number[]
  const selectedPricingCommission = (query.pricingCommission ?? []) as number[]
  const selectedPricingPermuta = (query.pricingPermuta ?? []) as number[]
  const selectedPricingImageRights = (query.pricingImageRights ?? []) as number[]
  const selectedPricingContentDelivery = (query.pricingContentDelivery ?? []) as number[]
  const selectedPricingLaunch = (query.pricingLaunch ?? []) as number[]

  const hasPricingFilter =
    selectedPricingPostUnique.length > 0 ||
    selectedPricingStories.length > 0 ||
    selectedPricingPackageMonthly.length > 0 ||
    selectedPricingCommission.length > 0 ||
    selectedPricingPermuta.length > 0 ||
    selectedPricingImageRights.length > 0 ||
    selectedPricingContentDelivery.length > 0 ||
    selectedPricingLaunch.length > 0

  const updateFilter = (overrides: Partial<ProfilesSearchQuery>) => {
    const newQuery = { ...query, ...overrides, offset: 0 }
    setQuery(newQuery)
    const params = queryToUrlParams(newQuery)
    params[WIZARD_DONE_PARAM] = '1'
    setFilterParams(new URLSearchParams(params))
    load(newQuery)
  }

  const hasActiveFilters =
    selectedCategories.length > 0 ||
    selectedEngagementRate.length > 0 ||
    selectedAvgLikes.length > 0 ||
    selectedPostsCount.length > 0 ||
    selectedExcludePrivate ||
    selectedAccountType.length > 0 ||
    selectedActivation.length > 0 ||
    selectedCities.length > 0 ||
    selectedStates.length > 0 ||
    selectedNeighborhoods.length > 0 ||
    selectedSocial.length > 0 ||
    selectedContentTypes.length > 0 ||
    hasPricingFilter

  const clearFilters = () => {
    updateFilter({
      categories: undefined,
      excludePrivate: undefined,
      accountTypeFilter: undefined,
      engagementRateBuckets: undefined,
      avgLikesBuckets: undefined,
      postsCountBuckets: undefined,
      activationFilter: undefined,
      cities: undefined,
      states: undefined,
      neighborhoods: undefined,
      socialNetworks: undefined,
      contentTypes: undefined,
      pricingPostUnique: undefined,
      pricingStories: undefined,
      pricingPackageMonthly: undefined,
      pricingCommission: undefined,
      pricingPermuta: undefined,
      pricingImageRights: undefined,
      pricingContentDelivery: undefined,
      pricingLaunch: undefined,
    })
  }

  const hasSearchQuery = hasMandatoryFilters

  const [wizardInitialFacets, setWizardInitialFacets] = useState<ProfilesSearchFacets | null>(null)
  useEffect(() => {
    if (!hasSearchQuery) {
      fetchProfilesSearch({ limit: 1, offset: 0, sort: 'engagement_desc' })
        .then((res) => setWizardInitialFacets(res.facets ?? null))
        .catch(() => setWizardInitialFacets(null))
    } else {
      setWizardInitialFacets(null)
    }
  }, [hasSearchQuery])

  if (!hasSearchQuery) {
    return (
      <div style={{ padding: '24px 0' }}>
        <SearchWizard
          initialFacets={wizardInitialFacets}
          initialSearchTerm={parsedUrl.q ?? ''}
          initialFilters={
            (parsedUrl.q || parsedUrl.categories?.length)
              ? {
                  q: parsedUrl.q ?? undefined,
                  categories: parsedUrl.categories?.length ? (Array.isArray(parsedUrl.categories) ? parsedUrl.categories : [parsedUrl.categories]) : undefined,
                  minFollowers: parsedUrl.minFollowers,
                  maxFollowers: parsedUrl.maxFollowers,
                  engagementRateBuckets: parsedUrl.engagementRateBuckets,
                  excludePrivate: parsedUrl.excludePrivate,
                  accountTypeFilter: parsedUrl.accountTypeFilter,
                  activationFilter: parsedUrl.activationFilter?.length ? parsedUrl.activationFilter : undefined,
                }
              : undefined
          }
          onSearchTermChange={handleWizardSearchTermChange}
          onFiltersChange={handleWizardFiltersChange}
          onEstimate={handleWizardEstimate}
          onComplete={handleWizardComplete}
        />
      </div>
    )
  }

  const listView = hashParams.get(LIST_VIEW_PARAM)
  const showDashboard = hasMandatoryFilters && listView === 'dashboard'

  if (showDashboard) {
    return (
      <div style={{ padding: '24px 0' }}>
        <ReportDashboard
          query={query}
          total={total}
          facets={facets}
          sampleItems={data.slice(0, 6)}
          onViewList={() => {
            const next = new URLSearchParams(hashParams)
            next.set(LIST_VIEW_PARAM, 'list')
            setFilterParams(next)
          }}
          loading={loading}
        />
      </div>
    )
  }

  const showFilters = !!user && (facets != null || total > 0 || selectedCategories.length > 0 || selectedEngagementRate.length > 0 || selectedAvgLikes.length > 0 || selectedPostsCount.length > 0 || selectedExcludePrivate || selectedAccountType.length > 0 || selectedActivation.length > 0 || selectedCities.length > 0 || selectedStates.length > 0 || selectedNeighborhoods.length > 0 || selectedSocial.length > 0 || selectedContentTypes.length > 0 || hasPricingFilter)

  const asideStyle: React.CSSProperties = {
    flexShrink: 0,
    width: 260,
    padding: 16,
    background: 'var(--aside-bg, #fafafa)',
    borderRadius: 8,
    border: '1px solid var(--aside-border, #f0f0f0)',
    position: 'sticky',
    top: 24,
    alignSelf: 'flex-start',
    maxHeight: 'calc(100vh - 48px)',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
  }

  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', width: '100%' }}>
      {showFilters && showFiltersSidebar && (
        <aside className="app-filters-aside" style={asideStyle}>
          <div
            style={{
              position: 'sticky',
              top: 0,
              zIndex: 1,
              background: 'var(--aside-bg, #fafafa)',
              paddingBottom: 12,
              marginBottom: 4,
              flexShrink: 0,
            }}
          >
            <Typography.Title level={5} style={{ marginBottom: 8, marginTop: 0 }}>
              <FilterOutlined /> {total === 0 ? 'Nenhum criador encontrado' : `${total} criadores`}
            </Typography.Title>
            <div style={{ marginBottom: 0 }}>
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                {total === 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span>Muda o termo ou limpa os filtros.</span>
                    {hasActiveFilters && (
                      <Button
                        type="default"
                        size="small"
                        icon={<ClearOutlined />}
                        onClick={clearFilters}
                        style={{ fontSize: 11, padding: '0 6px', color: '#d46b08', borderColor: '#d46b08', flexShrink: 0 }}
                      >
                        Limpar filtros
                      </Button>
                    )}
                  </div>
                )}
                {total > 0 && (
                  <>
                    {hasActiveFilters && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span>Com filtros</span>
                        <Button
                          type="default"
                          size="small"
                          icon={<ClearOutlined />}
                          onClick={clearFilters}
                          style={{ fontSize: 11, padding: '0 6px', color: '#d46b08', borderColor: '#d46b08', flexShrink: 0 }}
                        >
                          Limpar filtros
                        </Button>
                      </div>
                    )}
                    {!hasActiveFilters && 'Todos os resultados'}
                  </>
                )}
              </Text>
            </div>
          </div>

          {facets != null && (
            <div style={{ marginBottom: 16 }}>
              <Text strong type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
                Ordenar por
              </Text>
              <Select
                size="small"
                value={query.sort ?? 'engagement_desc'}
                options={SORT_OPTIONS}
                style={{ width: '100%' }}
                onChange={(value) => updateFilter({ sort: value as ProfilesSort })}
              />
            </div>
          )}

          {/* Filtros do módulo de ativação */}
          {/* Tipo de conteúdo – só aparece quando a sumarização retorna tipos (dados dos perfis ativados) */}
          {facets?.content_type && facets.content_type.length > 0 && (
            <div style={{ marginTop: 0 }}>
              <Text strong type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
                Tipo de conteúdo
              </Text>
              <Select
                mode="multiple"
                size="small"
                placeholder="Filtrar por tipo"
                allowClear
                showSearch
                optionFilterProp="label"
                value={selectedContentTypes}
                options={facets.content_type.map(({ name, count }) => ({
                  value: name,
                  label: `${CONTENT_TYPE_LABELS[name] ?? name} (${count})`,
                }))}
                onChange={(vals) => updateFilter({ contentTypes: vals.length ? vals : undefined })}
                style={{ width: '100%', marginBottom: 16 }}
                maxTagCount="responsive"
              />
            </div>
          )}

          {/* Preço por formato (sumarização do resultado da busca) */}
          {facets?.pricing && Object.values(facets.pricing).some((arr) => arr && arr.length > 0) && (
            <Collapse
              size="small"
              style={{ marginBottom: 16 }}
              items={[
                {
                  key: 'pricing',
                  label: <Text strong style={{ fontSize: 12 }}>Preço</Text>,
                  children: (
                    <div style={{ paddingTop: 4 }}>
                      {PRICING_FILTER_KEYS.map((key) => {
                        const actKey =
                          key === 'pricingPostUnique'
                            ? 'post_unique'
                            : key === 'pricingStories'
                              ? 'stories'
                              : key === 'pricingPackageMonthly'
                                ? 'package_monthly'
                                : key === 'pricingCommission'
                                  ? 'commission'
                                  : key === 'pricingPermuta'
                                    ? 'permuta'
                                    : key === 'pricingImageRights'
                                      ? 'image_rights'
                                      : key === 'pricingContentDelivery'
                                        ? 'content_delivery'
                                        : 'launch'
                        const buckets = facets.pricing?.[actKey]
                        if (!buckets || buckets.length === 0) return null
                        const value =
                          key === 'pricingPostUnique'
                            ? selectedPricingPostUnique
                            : key === 'pricingStories'
                              ? selectedPricingStories
                              : key === 'pricingPackageMonthly'
                                ? selectedPricingPackageMonthly
                                : key === 'pricingCommission'
                                  ? selectedPricingCommission
                                  : key === 'pricingPermuta'
                                    ? selectedPricingPermuta
                                    : key === 'pricingImageRights'
                                      ? selectedPricingImageRights
                                      : key === 'pricingContentDelivery'
                                        ? selectedPricingContentDelivery
                                        : selectedPricingLaunch
                        const options = buckets.map((b) => ({
                          value: b.value,
                          label: `${PRICE_BUCKETS.find((pb) => pb.value === b.value)?.label ?? `R$ ${b.value}`} (${b.count})`,
                        }))
                        return (
                          <div key={key} style={{ marginBottom: 10 }}>
                            <Text type="secondary" strong style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
                              {PRICING_FILTER_LABELS[key]}
                            </Text>
                            <Select
                              mode="multiple"
                              size="small"
                              placeholder="Escolher faixa"
                              allowClear
                              value={value}
                              options={options}
                              onChange={(vals) => updateFilter({ [key]: vals?.length ? vals : undefined })}
                              style={{ width: '100%' }}
                              maxTagCount={2}
                            />
                          </div>
                        )
                      })}
                    </div>
                  ),
                },
              ]}
            />
          )}

          {(facets?.activation && (facets.activation.activated > 0 || facets.activation.not_activated > 0)) ||
            (facets?.social && (facets.social.whatsapp > 0 || facets.social.tiktok > 0 || facets.social.facebook > 0 || facets.social.linkedin > 0 || facets.social.twitter > 0)) ? (
            <Collapse
              size="small"
              style={{ marginBottom: 16 }}
              items={[
                {
                  key: 'avancado',
                  label: <Text strong style={{ fontSize: 12 }}>Avançado</Text>,
                  children: (
                    <div style={{ paddingTop: 4 }}>
                      {facets?.activation && (facets.activation.activated > 0 || facets.activation.not_activated > 0) && (
                        <div style={{ marginBottom: 12 }}>
                          <Text strong type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
                            Cadastro ativado
                          </Text>
                          <Select
                            mode="multiple"
                            size="small"
                            placeholder="Ativado ou não"
                            allowClear
                            showSearch={false}
                            value={selectedActivation}
                            options={[
                              { value: 'activated', label: `Ativados (${facets.activation.activated})` },
                              { value: 'not_activated', label: `Não ativados (${facets.activation.not_activated})` },
                            ]}
                            onChange={(vals) => updateFilter({ activationFilter: vals.length && vals.length < 2 ? vals : undefined })}
                            style={{ width: '100%' }}
                            maxTagCount="responsive"
                          />
                        </div>
                      )}
                      {facets?.social && (facets.social.whatsapp > 0 || facets.social.tiktok > 0 || facets.social.facebook > 0 || facets.social.linkedin > 0 || facets.social.twitter > 0) && (
                        <div style={{ marginBottom: 0 }}>
                          <Text strong type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
                            Redes (quem tem cadastro)
                          </Text>
                          <Select
                            mode="multiple"
                            size="small"
                            placeholder="WhatsApp, TikTok..."
                            allowClear
                            showSearch={false}
                            value={selectedSocial}
                            options={[
                              facets.social.whatsapp > 0 && { value: 'whatsapp', label: `WhatsApp (${facets.social.whatsapp})` },
                              facets.social.tiktok > 0 && { value: 'tiktok', label: `TikTok (${facets.social.tiktok})` },
                              facets.social.facebook > 0 && { value: 'facebook', label: `Facebook (${facets.social.facebook})` },
                              facets.social.linkedin > 0 && { value: 'linkedin', label: `LinkedIn (${facets.social.linkedin})` },
                              facets.social.twitter > 0 && { value: 'twitter', label: `X/Twitter (${facets.social.twitter})` },
                            ].filter(Boolean) as { value: string; label: string }[]}
                            onChange={(vals) => updateFilter({ socialNetworks: vals.length ? vals : undefined })}
                            style={{ width: '100%' }}
                            maxTagCount="responsive"
                          />
                        </div>
                      )}
                    </div>
                  ),
                },
              ]}
            />
          ) : null}

          {facets && (facets.cities?.length ?? 0) > 0 || (facets?.states?.length ?? 0) > 0 || (facets?.neighborhoods?.length ?? 0) > 0 ? (
            <Collapse
              size="small"
              style={{ marginBottom: 16 }}
              items={[
                {
                  key: 'endereco',
                  label: <Text strong style={{ fontSize: 12 }}>Local</Text>,
                  children: (
                    <div style={{ paddingTop: 4 }}>
                      {facets?.cities && facets.cities.length > 0 && (
                        <div style={{ marginBottom: 12 }}>
                          <Text strong type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
                            Cidades
                          </Text>
                          <Select
                            mode="multiple"
                            size="small"
                            placeholder="Filtrar por cidade..."
                            allowClear
                            showSearch
                            optionFilterProp="label"
                            value={selectedCities}
                            options={facets.cities.map(({ name, count }) => ({ value: name, label: `${name} (${count})` }))}
                            onChange={(vals) => updateFilter({ cities: vals.length ? vals : undefined })}
                            style={{ width: '100%' }}
                            maxTagCount="responsive"
                          />
                        </div>
                      )}
                      {facets?.states && facets.states.length > 0 && (
                        <div style={{ marginBottom: 12 }}>
                          <Text strong type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
                            Estados
                          </Text>
                          <Select
                            mode="multiple"
                            size="small"
                            placeholder="Filtrar por estado..."
                            allowClear
                            showSearch
                            optionFilterProp="label"
                            value={selectedStates}
                            options={facets.states.map(({ name, count }) => ({ value: name, label: `${name} (${count})` }))}
                            onChange={(vals) => updateFilter({ states: vals.length ? vals : undefined })}
                            style={{ width: '100%' }}
                            maxTagCount="responsive"
                          />
                        </div>
                      )}
                      {facets?.neighborhoods && facets.neighborhoods.length > 0 && (
                        <div style={{ marginBottom: 0 }}>
                          <Text strong type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
                            Bairros
                          </Text>
                          <Select
                            mode="multiple"
                            size="small"
                            placeholder="Filtrar por bairro..."
                            allowClear
                            showSearch
                            optionFilterProp="label"
                            value={selectedNeighborhoods}
                            options={facets.neighborhoods.map(({ name, count }) => ({ value: name, label: `${name} (${count})` }))}
                            onChange={(vals) => updateFilter({ neighborhoods: vals.length ? vals : undefined })}
                            style={{ width: '100%' }}
                            maxTagCount="responsive"
                          />
                        </div>
                      )}
                    </div>
                  ),
                },
              ]}
            />
          ) : null}

          {facets == null && !loading && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              Busque algo e dá Enter pra ver filtros e resultados.
            </Text>
          )}
        </aside>
      )}

      {showFilters && !showFiltersSidebar && (
        <Drawer
          title={<><FilterOutlined /> Filtros</>}
          placement="right"
          open={filterDrawerOpen}
          onClose={() => setFilterDrawerOpen(false)}
          afterOpenChange={(open) => {
            if (open && filterDrawerRef.current) {
              const focusable = filterDrawerRef.current.querySelector<HTMLElement>('input, .ant-select-selector, [role="combobox"]')
              if (focusable && typeof focusable.focus === 'function') focusable.focus()
            }
          }}
          width={Math.min(320, typeof window !== 'undefined' ? window.innerWidth - 24 : 320)}
          styles={{ body: { paddingTop: 8 } }}
        >
          <div ref={filterDrawerRef} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <Typography.Title level={5} style={{ marginBottom: 8, marginTop: 0 }}>
                <FilterOutlined /> {total === 0 ? 'Nenhum perfil encontrado' : `${total} perfil(is)`}
              </Typography.Title>
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                {total === 0 && 'Muda o termo ou limpa os filtros.'}
                {total > 0 && (hasActiveFilters ? 'Com filtros' : 'Todos os resultados')}
              </Text>
              {hasActiveFilters && (
                <Button type="default" size="small" icon={<ClearOutlined />} onClick={clearFilters} style={{ marginTop: 8 }}>
                  Limpar filtros
                </Button>
              )}
            </div>
            {facets != null && (
              <div>
                <Text strong type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>Ordenar por</Text>
                <Select
                  size="small"
                  value={query.sort ?? 'engagement_desc'}
                  options={SORT_OPTIONS}
                  style={{ width: '100%' }}
                  onChange={(value) => updateFilter({ sort: value as ProfilesSort })}
                />
              </div>
            )}
            {facets?.content_type && facets.content_type.length > 0 && (
              <div>
                <Text strong type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>Tipo de conteúdo</Text>
                <Select
                  mode="multiple"
                  size="small"
                  placeholder="Filtrar por tipo"
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  value={selectedContentTypes}
                  options={facets.content_type.map(({ name, count }) => ({ value: name, label: `${CONTENT_TYPE_LABELS[name] ?? name} (${count})` }))}
                  onChange={(vals) => updateFilter({ contentTypes: vals.length ? vals : undefined })}
                  style={{ width: '100%' }}
                  maxTagCount="responsive"
                />
              </div>
            )}
          </div>
        </Drawer>
      )}

      <main style={{ flex: 1, minWidth: 0 }}>
        {showFilters && !showFiltersSidebar && (
          <Button
            type="default"
            icon={<FilterOutlined />}
            onClick={() => setFilterDrawerOpen(true)}
            style={{ marginBottom: 16 }}
          >
            Filtros {total > 0 ? `(${total})` : ''}
          </Button>
        )}
        <div style={{ marginBottom: 24, width: '100%' }}>
          <Space.Compact size="large" style={{ width: '100%', maxWidth: '100%' }}>
            <Input
              placeholder="Nome, @handle ou categoria"
              allowClear
              prefix={<SearchOutlined style={{ color: 'var(--colorTextPlaceholder)' }} />}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onPressEnter={runSearch}
              style={{ borderRadius: '24px 0 0 24px' }}
            />
            <Button type="primary" onClick={runSearch} style={{ borderRadius: '0 24px 24px 0' }}>
              <SearchOutlined /> Buscar
            </Button>
          </Space.Compact>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 48 }}>
            <Spin size="large" />
          </div>
        ) : data.length === 0 && limitReachedCode === 'PUBLIC_SEARCH_LIMIT' ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <span>
                Você chegou no limite de buscas de hoje. Volta amanhã ou <Link to="/premium">assina o Premium</Link>.
              </span>
            }
          />
        ) : data.length === 0 && (limitReachedCode === 'PUBLIC_PAGE_LIMIT' || limitReachedCode === 'PUBLIC_FILTERS_NOT_ALLOWED') ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <span>
                {limitReachedCode === 'PUBLIC_PAGE_LIMIT' ? 'Ver mais páginas é só pra assinante.' : 'Filtros avançados são só pra assinante.'}{' '}
                <Link to="/premium">Assina o Premium</Link> pra acessar.
              </span>
            }
          />
        ) : data.length === 0 ? (
          <Empty description="Nenhum criador encontrado. Ajusta os filtros ou tenta outro termo." />
        ) : (
          <>
            <Row gutter={[16, 16]}>
              {data.map((item) => (
                <Col key={item.key} xs={24} sm={12} style={{ minWidth: 0 }}>
                  <ProfileSummaryCard
                    item={item}
                    variant="list"
                    onClick={() => openDetail(item.handle ?? item.key)}
                    onImageRefreshQueued={(handle) => addHandleForImageUpdate.current(handle)}
                    showMetrics={!!user}
                  />
                </Col>
              ))}
            </Row>
            {data.length < total && !isLimitedView && (
              <div style={{ textAlign: 'center', marginTop: 24 }}>
                <Button
                  type="primary"
                  onClick={() => load({ offset: data.length })}
                  loading={loadingMore}
                  size="large"
                >
                  Ver mais
                </Button>
              </div>
            )}
            {data.length < total && isLimitedView && (
              <div style={{ textAlign: 'center', marginTop: 24 }}>
                <Button type="primary" onClick={() => navigate('/premium')} size="large">
                  Assine pra ver mais resultados
                </Button>
              </div>
            )}
          </>
        )}
        {total > 0 && (
          <Typography.Text type="secondary" style={{ display: 'block', marginTop: 16 }}>
            {data.length} de {total} perfis
          </Typography.Text>
        )}
      </main>
    </div>
  )
}
