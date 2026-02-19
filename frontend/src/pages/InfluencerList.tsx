import { useEffect, useState, useRef } from 'react'
import { useNavigate, useSearchParams, useParams, Link, Navigate } from 'react-router-dom'
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

const { Title, Text } = Typography

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

export default function InfluencerList() {
  const navigate = useNavigate()
  const { handle: urlHandle } = useParams<{ handle?: string }>()
  const { user, isPublic } = useAuth()
  const { getCache, saveCache } = useListCache()
  const isLimitedView = !user || isPublic
  const [searchParams, setSearchParams] = useSearchParams()
  const qFromUrl = searchParams.get('q') ?? ''
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [data, setData] = useState<ProfileListItem[]>([])
  const [total, setTotal] = useState(0)
  const [facets, setFacets] = useState<ProfilesSearchFacets | null>(null)
  const [searchInput, setSearchInput] = useState(qFromUrl)
  const [query, setQuery] = useState<ProfilesSearchQuery>({
    q: qFromUrl || undefined,
    limit: PAGE_SIZE,
    offset: 0,
    sort: 'engagement_desc',
  })
  const [limitReachedCode, setLimitReachedCode] = useState<string | null>(null)
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false)
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
    if (!qFromUrl.trim()) {
      setSearchInput('')
      setData([])
      setTotal(0)
      setFacets(null)
      setQuery({ limit: PAGE_SIZE, offset: 0, sort: 'engagement_desc' })
      return
    }
    const cached = getCache()
    if (cached && cached.q === qFromUrl.trim()) {
      setData(cached.data)
      setTotal(cached.total)
      setFacets(cached.facets)
      setQuery(cached.query)
      setSearchInput(cached.searchInput)
      if (cached.scrollPosition != null) scrollToRestoreRef.current = cached.scrollPosition
      return
    }
    setSearchInput(qFromUrl)
    const base = { q: qFromUrl || undefined, offset: 0, limit: PAGE_SIZE }
    setQuery((prev) => (isLimitedView ? { ...base } : { ...prev, ...base }))
    const controller = new AbortController()
    load(
      isLimitedView ? { q: qFromUrl.trim() || undefined, offset: 0 } : { q: qFromUrl.trim() || undefined, offset: 0 },
      controller.signal
    )
    return () => controller.abort()
  }, [qFromUrl, isLimitedView])

  useEffect(() => {
    if (!loading && !loadingMore && qFromUrl.trim() && (data.length > 0 || total > 0 || facets != null)) {
      saveCache({
        q: qFromUrl.trim(),
        data,
        total,
        facets,
        query,
        searchInput,
        scrollPosition: typeof window !== 'undefined' ? window.scrollY : 0,
      })
    }
  }, [loading, loadingMore, qFromUrl, data, total, facets, query, searchInput, saveCache])

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
    setSearchParams(q ? { q } : {})
  }

  const openDetail = (handleOrKey: string) => {
    const path = `/app/influencer/${encodeURIComponent(handleOrKey)}`
    const url = typeof window !== 'undefined' ? `${window.location.origin}${path}` : path
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  /** Categorias e engajamento vêm da sumarização da API (facets), não dos itens da página atual */
  const categoryFacets = facets?.categories ?? []
  const engagementFacets = facets
    ? {
      engagement_rate: facets.engagement_rate,
      avg_likes: facets.avg_likes,
      posts_count: facets.posts_count,
    }
    : { engagement_rate: [], avg_likes: [], posts_count: [] }

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
    load(newQuery)
  }

  const hasActiveFilters =
    selectedCategories.length > 0 ||
    selectedEngagementRate.length > 0 ||
    selectedAvgLikes.length > 0 ||
    selectedPostsCount.length > 0 ||
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

  const hasSearchQuery = qFromUrl.trim().length > 0

  if (!hasSearchQuery) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 'calc(100vh - 120px)',
          padding: 24,
        }}
      >
        <Title level={1} style={{ marginBottom: 32, fontWeight: 300, color: 'var(--app-text)' }}>
          Buscar influenciadores
        </Title>
        <Space.Compact size="large" style={{ width: '100%', maxWidth: 584 }}>
          <Input
            placeholder="Nome, @handle, categoria..."
            allowClear
            prefix={<SearchOutlined style={{ color: 'var(--colorTextPlaceholder)' }} />}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onPressEnter={runSearch}
            style={{ borderRadius: '24px 0 0 24px', fontSize: 16 }}
            onFocus={(e) => e.target.select?.()}
          />
          <Button type="primary" onClick={runSearch} style={{ borderRadius: '0 24px 24px 0' }}>
            <SearchOutlined /> Buscar
          </Button>
        </Space.Compact>
        <Text type="secondary" style={{ marginTop: 16, fontSize: 13 }}>
          Digite e pressione Enter ou clique em Buscar
        </Text>
      </div>
    )
  }

  const showFilters = !!user && (facets != null || total > 0 || selectedCategories.length > 0 || selectedEngagementRate.length > 0 || selectedAvgLikes.length > 0 || selectedPostsCount.length > 0 || selectedActivation.length > 0 || selectedCities.length > 0 || selectedStates.length > 0 || selectedNeighborhoods.length > 0 || selectedSocial.length > 0 || selectedContentTypes.length > 0 || hasPricingFilter)

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
        <aside style={asideStyle}>
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
              <FilterOutlined /> {total === 0 ? 'Nenhum perfil encontrado' : `${total} perfil(is) encontrado(s)`}
            </Typography.Title>
            <div style={{ marginBottom: 0 }}>
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                {total === 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span>Tente outro termo ou remova filtros.</span>
                    {hasActiveFilters && (
                      <Button
                        type="default"
                        size="small"
                        icon={<ClearOutlined />}
                        onClick={clearFilters}
                        style={{ fontSize: 11, padding: '0 6px', color: '#d46b08', borderColor: '#d46b08', flexShrink: 0 }}
                      >
                        Limpar
                      </Button>
                    )}
                  </div>
                )}
                {total > 0 && (
                  <>
                    {hasActiveFilters && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span>Com filtros aplicados</span>
                        <Button
                          type="default"
                          size="small"
                          icon={<ClearOutlined />}
                          onClick={clearFilters}
                          style={{ fontSize: 11, padding: '0 6px', color: '#d46b08', borderColor: '#d46b08', flexShrink: 0 }}
                        >
                          Limpar
                        </Button>
                      </div>
                    )}
                    {!hasActiveFilters && 'Todos os resultados da busca'}
                  </>
                )}
              </Text>
            </div>
          </div>

          {facets != null && (
            <div style={{ marginBottom: 16 }}>
              <Text strong type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
                Ordenar
              </Text>
              <Select
                size="small"
                value={query.sort ?? 'engagement_desc'}
                options={SORT_OPTIONS}
                style={{ width: '100%' }}
                onChange={(value) => {
                  const newQuery = { ...query, sort: value as ProfilesSort, offset: 0 }
                  setQuery(newQuery)
                  load(newQuery)
                }}
              />
            </div>
          )}

          {/* 1. Hashtags (sumarização da API) – autocomplete multiselect, todas sem limite */}
          <Text strong type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
            Hashtags
          </Text>
          {categoryFacets.length > 0 ? (
            <Select
              mode="multiple"
              size="small"
              placeholder="Filtrar por hashtag..."
              allowClear
              showSearch
              optionFilterProp="label"
              value={selectedCategories}
              options={categoryFacets.map(({ name, count }) => ({
                value: name,
                label: `${name} (${count})`,
              }))}
              onChange={(values) => {
                const newQuery = { ...query, categories: values.length ? values : undefined, offset: 0 }
                setQuery(newQuery)
                load(newQuery)
              }}
              style={{ width: '100%', marginBottom: 16 }}
              maxTagCount="responsive"
            />
          ) : (
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 16 }}>
              Nenhuma hashtag nos resultados.
            </Text>
          )}

          {/* Tipo de conteúdo – só aparece quando a sumarização retorna tipos (dados dos perfis ativados) */}
          {facets?.content_type && facets.content_type.length > 0 && (
            <div style={{ marginTop: 0 }}>
              <Text strong type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
                Tipo de conteúdo
              </Text>
              <Select
                mode="multiple"
                size="small"
                placeholder="Filtrar por tipo..."
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
                              placeholder="Filtrar por faixa..."
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

          {/* 2. Engajamento – autocomplete multiselect */}
          {facets && (
            <Collapse
              size="small"
              style={{ marginBottom: 16 }}
              items={[
                {
                  key: 'metricas',
                  label: <Text strong style={{ fontSize: 12 }}>Métricas</Text>,
                  children: (
                    <div style={{ paddingTop: 4 }}>
                      <Text strong type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
                        Taxa engajamento %
                      </Text>
                      <Select
                        mode="multiple"
                        size="small"
                        placeholder="Filtrar por faixa..."
                        allowClear
                        showSearch
                        optionFilterProp="label"
                        value={selectedEngagementRate}
                        options={engagementFacets.engagement_rate.map((b) => ({
                          value: b.min ?? 0,
                          label: `${b.label} (${b.count})`,
                        }))}
                        onChange={(vals) => updateFilter({ engagementRateBuckets: vals.length ? vals : undefined })}
                        style={{ width: '100%', marginBottom: 12 }}
                        maxTagCount="responsive"
                      />
                      <Text strong type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
                        Média curtidas/post
                      </Text>
                      <Select
                        mode="multiple"
                        size="small"
                        placeholder="Filtrar por faixa..."
                        allowClear
                        showSearch
                        optionFilterProp="label"
                        value={selectedAvgLikes}
                        options={engagementFacets.avg_likes.map((b) => ({
                          value: b.min ?? 0,
                          label: `${b.label} (${b.count})`,
                        }))}
                        onChange={(vals) => updateFilter({ avgLikesBuckets: vals.length ? vals : undefined })}
                        style={{ width: '100%', marginBottom: 12 }}
                        maxTagCount="responsive"
                      />
                      <Text strong type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
                        Posts analisados
                      </Text>
                      <Select
                        mode="multiple"
                        size="small"
                        placeholder="Filtrar por faixa..."
                        allowClear
                        showSearch
                        optionFilterProp="label"
                        value={selectedPostsCount}
                        options={engagementFacets.posts_count.map((b) => ({
                          value: b.min ?? 0,
                          label: `${b.label} (${b.count})`,
                        }))}
                        onChange={(vals) => updateFilter({ postsCountBuckets: vals.length ? vals : undefined })}
                        style={{ width: '100%', marginBottom: 0 }}
                        maxTagCount="responsive"
                      />
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
                            Cadastro na plataforma
                          </Text>
                          <Select
                            mode="multiple"
                            size="small"
                            placeholder="Ativados / Não ativados..."
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
                            Redes (ativados)
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
                  label: <Text strong style={{ fontSize: 12 }}>Endereço</Text>,
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
              Digite na busca e pressione Enter para ver a sumarização.
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
          width={Math.min(320, typeof window !== 'undefined' ? window.innerWidth - 24 : 320)}
          styles={{ body: { paddingTop: 8 } }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <Typography.Title level={5} style={{ marginBottom: 8, marginTop: 0 }}>
                <FilterOutlined /> {total === 0 ? 'Nenhum perfil encontrado' : `${total} perfil(is) encontrado(s)`}
              </Typography.Title>
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                {total === 0 && 'Tente outro termo ou remova filtros.'}
                {total > 0 && (hasActiveFilters ? 'Com filtros aplicados' : 'Todos os resultados da busca')}
              </Text>
              {hasActiveFilters && (
                <Button type="default" size="small" icon={<ClearOutlined />} onClick={clearFilters} style={{ marginTop: 8 }}>
                  Limpar filtros
                </Button>
              )}
            </div>
            {facets != null && (
              <div>
                <Text strong type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>Ordenar</Text>
                <Select
                  size="small"
                  value={query.sort ?? 'engagement_desc'}
                  options={SORT_OPTIONS}
                  style={{ width: '100%' }}
                  onChange={(value) => {
                    const newQuery = { ...query, sort: value as ProfilesSort, offset: 0 }
                    setQuery(newQuery)
                    load(newQuery)
                  }}
                />
              </div>
            )}
            <div>
              <Text strong type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>Hashtags</Text>
              {categoryFacets.length > 0 ? (
                <Select
                  mode="multiple"
                  size="small"
                  placeholder="Filtrar por hashtag..."
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  value={selectedCategories}
                  options={categoryFacets.map(({ name, count }) => ({ value: name, label: `${name} (${count})` }))}
                  onChange={(values) => {
                    const newQuery = { ...query, categories: values.length ? values : undefined, offset: 0 }
                    setQuery(newQuery)
                    load(newQuery)
                  }}
                  style={{ width: '100%' }}
                  maxTagCount="responsive"
                />
              ) : (
                <Text type="secondary" style={{ fontSize: 12 }}>Nenhuma hashtag nos resultados.</Text>
              )}
            </div>
            {facets?.content_type && facets.content_type.length > 0 && (
              <div>
                <Text strong type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>Tipo de conteúdo</Text>
                <Select
                  mode="multiple"
                  size="small"
                  placeholder="Filtrar por tipo..."
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
              placeholder="Buscar por nome, @handle, categoria..."
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
                Você alcançou o limite diário de buscas. Volte amanhã ou <Link to="/premium">assine o plano premium</Link> para continuar buscando.
              </span>
            }
          />
        ) : data.length === 0 && (limitReachedCode === 'PUBLIC_PAGE_LIMIT' || limitReachedCode === 'PUBLIC_FILTERS_NOT_ALLOWED') ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <span>
                {limitReachedCode === 'PUBLIC_PAGE_LIMIT' ? 'Mais páginas são para assinantes.' : 'Filtros avançados são para assinantes.'}{' '}
                <Link to="/premium">Assine o plano premium</Link> para acessar.
              </span>
            }
          />
        ) : data.length === 0 ? (
          <Empty description="Nenhum influenciador encontrado. Ajuste os filtros ou execute o crawl." />
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
                  Seja assinante para ver mais resultados
                </Button>
              </div>
            )}
          </>
        )}
        {total > 0 && (
          <Typography.Text type="secondary" style={{ display: 'block', marginTop: 16 }}>
            Exibindo {data.length} de {total} perfil(is)
          </Typography.Text>
        )}
      </main>
    </div>
  )
}
