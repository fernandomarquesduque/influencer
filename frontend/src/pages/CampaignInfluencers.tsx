/**
 * Listagem de influenciadores de uma campanha.
 * Rota: /app/campaigns/:campaignId — filtros baseados nos facets (retorno da API), igual InfluencerList.
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Row, Col, Typography, Button, Spin, Empty, Tooltip, Select, Input, Space, Modal, Tag } from 'antd'
import { AppstoreOutlined, UnorderedListOutlined, UserOutlined, FilterOutlined, ClearOutlined, SearchOutlined, CaretUpOutlined, CaretDownOutlined, EditOutlined, HeartOutlined, HeartFilled } from '@ant-design/icons'
import { useAuth } from '../contexts/AuthContext'
import {
  fetchCampaignProfiles,
  getCampaign,
  updateCampaignName,
  fetchFavorites,
  addFavorite,
  removeFavorite,
  getProfilePicUrl,
  proxyImageUrl,
  type ProfileListItem,
  type ProfilesSearchQuery,
  type ProfilesSearchFacets,
  type ProfilesSort,
  type CampaignInfo,
} from '../api'
import { getCostTier } from '../utils/pricing'
import { filterAndSortCampaignItems, computeFacetsFromItems } from '../utils/campaignFilterClient'
import { CONTENT_TYPE_LABELS } from '../constants/contentTypes'
import { PRICE_BUCKETS, PRICING_FIELD_LABELS, getSuggestedPricingFromFollowers } from '../constants/pricingBuckets'
import type { PricingData } from '../api'
import ProfileSummaryCard from '../components/ProfileSummaryCard'
import { MessageOutlined, VideoCameraOutlined } from '@ant-design/icons'

const PAGE_SIZE = 100
/** Quantidade de itens exibidos inicialmente e a cada rodada de scroll (carregamento progressivo). */
const DISPLAY_PAGE_SIZE = 20

const CAMPAIGN_ID_GUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const PRICING_FILTER_KEYS = ['pricingFeed', 'pricingReels', 'pricingStory', 'pricingDestaque'] as const

const PRICING_FILTER_LABELS: Record<(typeof PRICING_FILTER_KEYS)[number], string> = {
  pricingFeed: 'Valor por Feed',
  pricingReels: 'Valor por Reels',
  pricingStory: 'Valor por story',
  pricingDestaque: 'Valor por Destaque',
}

function campaignQueryToUrlParams(query: Partial<ProfilesSearchQuery>): Record<string, string> {
  const params: Record<string, string> = {}
  if (query.q?.trim()) params.q = query.q.trim()
  if (query.sort) params.sort = query.sort
  if (query.costTierFilter?.length) params.costTierFilter = query.costTierFilter.join(',')
  if (query.contentTypes?.length) params.contentTypes = query.contentTypes.join(',')
  if (query.pricingFeed?.length) params.pricingFeed = query.pricingFeed.join(',')
  if (query.pricingReels?.length) params.pricingReels = query.pricingReels.join(',')
  if (query.pricingStory?.length) params.pricingStory = query.pricingStory.join(',')
  if (query.pricingDestaque?.length) params.pricingDestaque = query.pricingDestaque.join(',')
  if (query.activationFilter?.length) params.activationFilter = query.activationFilter.join(',')
  if (query.cities?.length) params.cities = query.cities.join(',')
  if (query.states?.length) params.states = query.states.join(',')
  if (query.neighborhoods?.length) params.neighborhoods = query.neighborhoods.join(',')
  if (query.socialNetworks?.length) params.socialNetworks = query.socialNetworks.join(',')
  if (query.offset != null && query.offset > 0) params.offset = String(query.offset)
  return params
}

function urlParamsToCampaignQuery(params: URLSearchParams): Partial<ProfilesSearchQuery> {
  const parseNumList = (s: string | null): number[] | undefined => {
    if (!s) return undefined
    const arr = s.split(',').map((x) => Number(x.trim())).filter(Number.isFinite)
    return arr.length ? arr : undefined
  }
  const parseStrList = (s: string | null): string[] | undefined => {
    if (!s) return undefined
    const arr = s.split(',').map((x) => x.trim()).filter(Boolean)
    return arr.length ? arr : undefined
  }
  return {
    q: params.get('q')?.trim() || undefined,
    sort: (params.get('sort') as ProfilesSort) || undefined,
    costTierFilter: parseStrList(params.get('costTierFilter')),
    contentTypes: parseStrList(params.get('contentTypes')),
    pricingFeed: parseNumList(params.get('pricingFeed')),
    pricingReels: parseNumList(params.get('pricingReels')),
    pricingStory: parseNumList(params.get('pricingStory')),
    pricingDestaque: parseNumList(params.get('pricingDestaque')),
    activationFilter: parseStrList(params.get('activationFilter')),
    cities: parseStrList(params.get('cities')),
    states: parseStrList(params.get('states')),
    neighborhoods: parseStrList(params.get('neighborhoods')),
    socialNetworks: parseStrList(params.get('socialNetworks')),
    offset: params.has('offset') ? Number(params.get('offset')) : undefined,
  }
}

function formatShortNum(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`
  return String(n)
}

const LIST_GRID_COLUMNS = '48px minmax(160px, 1fr) 72px 76px 74px 74px 72px 68px 48px'

/** Uma linha compacta (modo lista tipo tabela) com dados de ativação. */
function CampaignListRow({
  item,
  onClick,
  isFavorite,
  onFavoriteToggle,
}: {
  item: ProfileListItem
  onClick: () => void
  isFavorite?: boolean
  onFavoriteToggle?: (handle: string) => void
}) {
  const pic = proxyImageUrl(getProfilePicUrl(item as unknown as Record<string, unknown>))
  const name = (item.full_name || item.handle) as string
  const handle = item.handle ?? item.key
  const eng = item.engagement
  const act = item.activation
  const followers = item.followers_count ?? 0
  const engagementRate = eng?.engagement_rate ?? 0
  const totalLikes = eng?.total_likes ?? 0
  const totalComments = eng?.total_comments ?? 0
  const avgLikes = eng?.avg_likes ?? 0
  const location = act && (act.city || act.state)
    ? [act.city, act.state].filter(Boolean).join(', ')
    : null
  const hasWhatsApp = !!(act?.whatsapp?.trim())
  const hasTiktok = !!(act?.tiktok?.trim())
  const contentTypes = Array.isArray(act?.content_type) ? act.content_type.slice(0, 2).map((c) => CONTENT_TYPE_LABELS[c] ?? c) : []
  const hasPricing =
    act?.pricing &&
    typeof act.pricing === 'object' &&
    Object.values(act.pricing).some((v) => v !== undefined && v !== null && v !== '')
  const costTier = hasPricing
    ? getCostTier(act.pricing as PricingData)
    : Number.isFinite(followers) && followers >= 0
      ? getCostTier(getSuggestedPricingFromFollowers(followers) as unknown as PricingData)
      : null
  const costTierColor =
    costTier?.tier === 'low'
      ? '#d48806'
      : costTier?.tier === 'medium'
        ? '#389e0d'
        : costTier?.tier === 'high' || costTier?.tier === 'very_high'
          ? '#cf1322'
          : undefined

  const priceTooltipTitle =
    costTier && Number.isFinite(followers) && followers >= 0
      ? (() => {
        const suggested = getSuggestedPricingFromFollowers(followers)
        const parts = (['feed', 'reels', 'story', 'destaque'] as const)
          .filter((k) => suggested[k] != null)
          .map((k) => `${PRICING_FIELD_LABELS[k]}: R$ ${suggested[k]!.toLocaleString('pt-BR')}`)
        return parts.length ? `Preço sugerido (por seguidores):\n${parts.join('\n')}` : undefined
      })()
      : costTier
        ? undefined
        : 'Sem preço informado'

  const priceTooltipNode =
    typeof priceTooltipTitle === 'string' && priceTooltipTitle.includes('\n') ? (
      <span style={{ whiteSpace: 'pre-line' }}>{priceTooltipTitle}</span>
    ) : (
      priceTooltipTitle
    )

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      style={{
        display: 'grid',
        gridTemplateColumns: LIST_GRID_COLUMNS,
        gap: '0 8px',
        alignItems: 'center',
        padding: '4px 10px',
        minHeight: 40,
        borderBottom: '1px solid var(--app-border, #f0f0f0)',
        cursor: 'pointer',
        background: 'var(--app-bg)',
        transition: 'background 0.15s',
        minWidth: 900,
      }}
      className="campaign-list-row"
    >
      <div style={{ width: 40, height: 40, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: 'var(--app-placeholder-bg)' }}>
        {pic ? (
          <img src={pic} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--app-text-secondary)' }}>
            <UserOutlined style={{ fontSize: 20 }} />
          </div>
        )}
      </div>
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <Tooltip title={name}>
            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--app-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {name}
            </div>
          </Tooltip>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, fontSize: 14 }}>
            {hasWhatsApp && <Tooltip title="WhatsApp"><MessageOutlined style={{ color: 'var(--app-icon-whatsapp, #25D366)' }} /></Tooltip>}
            {hasTiktok && <Tooltip title="TikTok"><VideoCameraOutlined style={{ color: 'var(--app-text-secondary)' }} /></Tooltip>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flexWrap: 'wrap' }}>
          <Tooltip title={`@${handle}`}>
            <span style={{ fontSize: 12, color: 'var(--app-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              @{handle}
            </span>
          </Tooltip>
          {contentTypes.length > 0 && contentTypes.slice(0, 3).map((ct, i) => {
            const tagColors = ['blue', 'green', 'orange'] as const
            return (
              <Tag key={ct} color={tagColors[i % 3]} style={{ margin: 0, fontSize: 10, padding: '0 5px', lineHeight: '18px' }}>
                {ct}
              </Tag>
            )
          })}
          {contentTypes.length > 3 && (
            <Tag color="default" style={{ margin: 0, fontSize: 10 }}>+{contentTypes.length - 3}</Tag>
          )}
        </div>
        {location && (
          <Tooltip title={location}>
            <div style={{ fontSize: 11, color: 'var(--app-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {location}
            </div>
          </Tooltip>
        )}
      </div>
      <Tooltip title={formatShortNum(followers) !== String(followers) ? String(followers) : undefined}>
        <div className="campaign-list-cell campaign-list-cell-border" style={{ fontSize: 11, color: 'var(--app-text)' }}>
          {formatShortNum(followers)}
        </div>
      </Tooltip>
      <div className="campaign-list-cell campaign-list-cell-border" style={{ fontSize: 11, fontWeight: 600, color: 'var(--app-text)' }}>
        {engagementRate.toFixed(1)}%
      </div>
      <Tooltip title={formatShortNum(totalLikes) !== String(totalLikes) ? String(totalLikes) : undefined}>
        <div className="campaign-list-cell campaign-list-cell-border" style={{ fontSize: 11, color: 'var(--app-text)' }}>
          {formatShortNum(totalLikes)}
        </div>
      </Tooltip>
      <Tooltip title={formatShortNum(totalComments) !== String(totalComments) ? String(totalComments) : undefined}>
        <div className="campaign-list-cell campaign-list-cell-border" style={{ fontSize: 11, color: 'var(--app-text-secondary)' }}>
          {formatShortNum(totalComments)}
        </div>
      </Tooltip>
      <Tooltip title="Média de likes por post">
        <div className="campaign-list-cell campaign-list-cell-border" style={{ fontSize: 11, color: 'var(--app-text-secondary)' }}>
          {formatShortNum(avgLikes)}
        </div>
      </Tooltip>
      <Tooltip title={priceTooltipNode}>
        <div className="campaign-list-cell campaign-list-cell-border" style={{ fontSize: 11, fontWeight: 600, color: costTierColor ?? 'var(--app-text)' }}>
          {costTier
            ? (() => {
              const label = costTier.label.trim()
              return label.charAt(0).toUpperCase() + label.slice(1)
            })()
            : '—'}
        </div>
      </Tooltip>
      {onFavoriteToggle != null ? (
        <div className="campaign-list-cell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={(e) => e.stopPropagation()}>
          <Tooltip title={isFavorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}>
            <Button
              type="text"
              size="small"
              icon={isFavorite ? <HeartFilled style={{ color: 'var(--app-primary)' }} /> : <HeartOutlined style={{ color: 'var(--app-text-secondary)' }} />}
              onClick={(e) => {
                e.stopPropagation()
                onFavoriteToggle(handle)
              }}
              style={{ minWidth: 32, height: 32, padding: 0 }}
              aria-label={isFavorite ? 'Remover dos favoritos' : 'Favoritar'}
            />
          </Tooltip>
        </div>
      ) : (
        <div />
      )}
    </div>
  )
}

export type CampaignViewMode = 'list' | 'grid'

const defaultQuery: Partial<ProfilesSearchQuery> = {
  limit: PAGE_SIZE,
  offset: 0,
  sort: 'engagement_desc',
}

const MOBILE_BREAKPOINT = 768

export default function CampaignInfluencers() {
  const { campaignId: campaignIdParam } = useParams<{ campaignId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const campaignId = campaignIdParam != null && CAMPAIGN_ID_GUID_REGEX.test(campaignIdParam.trim()) ? campaignIdParam.trim() : null
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT)
  const [viewMode, setViewMode] = useState<CampaignViewMode>('list')
  const effectiveViewMode: CampaignViewMode = isMobile ? 'grid' : viewMode
  const [query, setQuery] = useState<Partial<ProfilesSearchQuery>>(() => ({
    ...defaultQuery,
    ...urlParamsToCampaignQuery(searchParams),
  }))
  const [facets, setFacets] = useState<ProfilesSearchFacets | null>(null)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [contextItems, setContextItems] = useState<ProfileListItem[] | null>(null)
  const [campaignCredits, setCampaignCredits] = useState<number | null>(null)
  const [campaignInfo, setCampaignInfo] = useState<CampaignInfo | null>(null)
  const [campaignInfoLoaded, setCampaignInfoLoaded] = useState(false)
  const [campaignNameInput, setCampaignNameInput] = useState('')
  const [savingCampaignName, setSavingCampaignName] = useState(false)
  const [namePromptDismissed, setNamePromptDismissed] = useState(false)
  const [nameModalOpen, setNameModalOpen] = useState(false)
  const hasAutoOpenedNameModalRef = useRef(false)
  const [filteredList, setFilteredList] = useState<ProfileListItem[]>([])
  const [displayedCount, setDisplayedCount] = useState(DISPLAY_PAGE_SIZE)
  const [searchInput, setSearchInput] = useState(() => searchParams.get('q') ?? '')
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null)
  const [favoriteHandles, setFavoriteHandles] = useState<Set<string>>(new Set())
  const addHandleForImageUpdate = useRef<((handle: string) => void) | null>(null)
  const queryRef = useRef(query)
  queryRef.current = query

  useEffect(() => {
    if (!user) {
      setFavoriteHandles(new Set())
      return
    }
    fetchFavorites()
      .then((res) => setFavoriteHandles(new Set((res.handles ?? []).map((h) => h.toLowerCase().replace(/^@/, '')))))
      .catch(() => setFavoriteHandles(new Set()))
  }, [user])

  const handleFavoriteToggle = useCallback(async (handle: string) => {
    const normalized = handle.toLowerCase().replace(/^@/, '').trim()
    if (!normalized) return
    const isFav = favoriteHandles.has(normalized)
    setFavoriteHandles((prev) => {
      const next = new Set(prev)
      if (isFav) next.delete(normalized)
      else next.add(normalized)
      return next
    })
    try {
      if (isFav) await removeFavorite(handle)
      else await addFavorite(handle)
    } catch {
      setFavoriteHandles((prev) => {
        const next = new Set(prev)
        if (isFav) next.add(normalized)
        else next.delete(normalized)
        return next
      })
    }
  }, [favoriteHandles])

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const applyContextFilters = useCallback((requestQuery: Partial<ProfilesSearchQuery>) => {
    if (contextItems == null) return
    if (contextItems.length === 0) {
      setFilteredList([])
      setTotal(0)
      setFacets(computeFacetsFromItems([]))
      setDisplayedCount(DISPLAY_PAGE_SIZE)
      return
    }
    const sorted = filterAndSortCampaignItems(contextItems, requestQuery, { favoriteHandles })
    setFilteredList(sorted)
    setTotal(sorted.length)
    setFacets(computeFacetsFromItems(sorted))
    setDisplayedCount(DISPLAY_PAGE_SIZE)
  }, [contextItems, favoriteHandles])

  const data = filteredList.slice(0, displayedCount)

  const loadContext = useCallback(
    (signal?: AbortSignal) => {
      if (campaignId == null) return
      setLoading(true)
      fetchCampaignProfiles(campaignId, { ...defaultQuery, limit: 10000 }, { signal })
        .then((res) => {
          if (signal?.aborted) return
          setContextItems(res.items ?? [])
        })
        .catch(() => {
          if (!signal?.aborted) {
            setContextItems([])
          }
        })
        .finally(() => {
          if (!signal?.aborted) setLoading(false)
        })
    },
    [campaignId]
  )

  const updateFilter = useCallback(
    (overrides: Partial<ProfilesSearchQuery>) => {
      const newQuery = { ...query, ...overrides, offset: 0 }
      setQuery(newQuery)
      setSearchParams(campaignQueryToUrlParams(newQuery), { replace: true })
      if (contextItems != null) applyContextFilters(newQuery)
    },
    [query, contextItems, applyContextFilters, setSearchParams]
  )

  const clearFilters = useCallback(() => {
    const newQuery = { ...defaultQuery, offset: 0 }
    setQuery(newQuery)
    setSearchParams({}, { replace: true })
    if (contextItems != null) applyContextFilters(newQuery)
  }, [contextItems, applyContextFilters, setSearchParams])

  const loadMore = useCallback(() => {
    setDisplayedCount((prev) => Math.min(prev + DISPLAY_PAGE_SIZE, filteredList.length))
  }, [filteredList.length])

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current
    if (!sentinel || data.length >= total || total === 0) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore()
      },
      { rootMargin: '200px', threshold: 0 }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [data.length, total, loadMore])

  useEffect(() => {
    setSearchInput(searchParams.get('q') ?? '')
  }, [searchParams.get('q')])

  const DEBOUNCE_MS = 1000
  useEffect(() => {
    const trimmed = searchInput.trim() || undefined
    const currentQ = queryRef.current.q?.trim() || undefined
    if (trimmed === currentQ) return
    const t = setTimeout(() => {
      const nowTrimmed = searchInput.trim() || undefined
      const nowQ = queryRef.current.q?.trim() || undefined
      if (nowTrimmed === nowQ) return
      const newQuery = { ...queryRef.current, q: nowTrimmed, offset: 0 }
      setQuery(newQuery)
      setSearchParams(campaignQueryToUrlParams(newQuery), { replace: true })
      if (contextItems != null) applyContextFilters(newQuery)
    }, DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [searchInput, contextItems, applyContextFilters, setSearchParams])

  useEffect(() => {
    if (campaignId == null || !user) return
    const controller = new AbortController()
    loadContext(controller.signal)
    return () => controller.abort()
  }, [campaignId, user, loadContext])

  useEffect(() => {
    if (campaignId == null || !user) return
    setCampaignInfo(null)
    setCampaignInfoLoaded(false)
    setNamePromptDismissed(false)
    setNameModalOpen(false)
    hasAutoOpenedNameModalRef.current = false
    const controller = new AbortController()
    getCampaign(campaignId, { signal: controller.signal })
      .then((info) => {
        setCampaignCredits(info.credits_used)
        setCampaignInfo(info)
        setCampaignInfoLoaded(true)
      })
      .catch(() => {
        setCampaignCredits(null)
        setCampaignInfo(null)
        setCampaignInfoLoaded(true)
      })
    return () => controller.abort()
  }, [campaignId, user])

  useEffect(() => {
    if (contextItems == null) return
    applyContextFilters(query)
  }, [contextItems, query, applyContextFilters])

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/login', { replace: true })
    }
  }, [authLoading, user, navigate])

  const campaignHasName = !!campaignInfo?.name?.trim()
  const showNamePrompt = campaignInfoLoaded && !!campaignInfo && !campaignHasName && !namePromptDismissed

  useEffect(() => {
    if (showNamePrompt && !hasAutoOpenedNameModalRef.current) {
      hasAutoOpenedNameModalRef.current = true
      setNameModalOpen(true)
      setCampaignNameInput('')
    }
  }, [showNamePrompt])

  const handleSaveCampaignName = useCallback(() => {
    if (!campaignId) return
    setSavingCampaignName(true)
    updateCampaignName(campaignId, campaignNameInput)
      .then(() => {
        const name = campaignNameInput.trim()
        setCampaignInfo((prev) => (prev ? { ...prev, name: name || null } : null))
        setNamePromptDismissed(true)
        setNameModalOpen(false)
      })
      .finally(() => setSavingCampaignName(false))
  }, [campaignId, campaignNameInput])

  const openNameModalForEdit = useCallback(() => {
    setCampaignNameInput(campaignInfo?.name ?? '')
    setNameModalOpen(true)
  }, [campaignInfo?.name])

  const openDetail = (handleOrKey: string) => {
    if (!campaignId) return
    const path = `/app/campaigns/${campaignId}/influencer/${encodeURIComponent(handleOrKey)}`
    const url = typeof window !== 'undefined' ? `${window.location.origin}${path}` : path
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const currentSort = query.sort ?? 'engagement_desc'
  type SortColumn = 'name' | 'followers' | 'engagement' | 'total_likes' | 'total_comments' | 'avg_likes' | 'cost_tier' | 'favorite'
  const handleSortColumn = useCallback(
    (column: SortColumn) => {
      const toggle = (desc: ProfilesSort, asc: ProfilesSort): ProfilesSort =>
        currentSort === desc ? asc : desc
      const next: ProfilesSort =
        column === 'name' ? toggle('name_desc', 'name_asc')
          : column === 'followers' ? toggle('followers_desc', 'followers_asc')
            : column === 'engagement' ? toggle('engagement_desc', 'engagement_asc')
              : column === 'total_likes' ? toggle('total_likes_desc', 'total_likes_asc')
                : column === 'total_comments' ? toggle('total_comments_desc', 'total_comments_asc')
                  : column === 'avg_likes' ? toggle('avg_likes_desc', 'avg_likes_asc')
                    : column === 'cost_tier' ? toggle('cost_tier_desc', 'cost_tier_asc')
                      : toggle('favorite_desc', 'favorite_asc')
      updateFilter({ sort: next })
    },
    [currentSort, updateFilter]
  )

  const selectedActivation = (query.activationFilter ?? []) as string[]
  const selectedCities = (query.cities ?? []) as string[]
  const selectedStates = (query.states ?? []) as string[]
  const selectedNeighborhoods = (query.neighborhoods ?? []) as string[]
  const selectedSocial = (query.socialNetworks ?? []) as string[]
  const selectedContentTypes = (query.contentTypes ?? []) as string[]
  const selectedPricingFeed = (query.pricingFeed ?? []) as number[]
  const selectedPricingReels = (query.pricingReels ?? []) as number[]
  const selectedPricingStory = (query.pricingStory ?? []) as number[]
  const selectedPricingDestaque = (query.pricingDestaque ?? []) as number[]
  const costTierFilter = (query.costTierFilter ?? []) as string[]
  const hasPricingFilter =
    selectedPricingFeed.length > 0 ||
    selectedPricingReels.length > 0 ||
    selectedPricingStory.length > 0 ||
    selectedPricingDestaque.length > 0
  const hasCostTierFilter = costTierFilter.length > 0
  const hasActiveFilters =
    (query.q?.trim()?.length ?? 0) > 0 ||
    selectedActivation.length > 0 ||
    selectedCities.length > 0 ||
    selectedStates.length > 0 ||
    selectedNeighborhoods.length > 0 ||
    selectedSocial.length > 0 ||
    selectedContentTypes.length > 0 ||
    hasPricingFilter ||
    hasCostTierFilter
  const selectedCostTierOption: 'low' | 'medium' | 'above' | undefined =
    costTierFilter.length === 0
      ? undefined
      : costTierFilter.includes('low') && costTierFilter.length === 1
        ? 'low'
        : costTierFilter.includes('medium') && costTierFilter.length === 1
          ? 'medium'
          : costTierFilter.some((t) => t === 'high' || t === 'very_high')
            ? 'above'
            : undefined

  if (authLoading || (campaignId != null && !user)) {
    return (
      <div style={{ padding: '48px 24px', textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    )
  }

  if (campaignId == null) {
    return (
      <div style={{ padding: '24px 0' }}>
        <Empty description="Campanha não encontrada." />
        <Button type="primary" onClick={() => navigate('/app/campaigns')} style={{ marginTop: 16 }}>
          Voltar às campanhas
        </Button>
      </div>
    )
  }

  if (!campaignInfoLoaded) {
    return (
      <div style={{ padding: '48px 24px', textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    )
  }

  return (
    <div>
      <Modal
        title={campaignHasName ? 'Editar nome da campanha' : 'Informe o nome da campanha'}
        open={nameModalOpen}
        onCancel={() => setNameModalOpen(false)}
        footer={null}
        destroyOnClose
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
          {campaignHasName ? 'Altere o nome para organizar melhor em Minhas campanhas.' : 'Assim fica mais fácil organizar e encontrar seus relatórios.'}
        </Typography.Paragraph>
        <Space.Compact style={{ width: '100%' }}>
          <Input
            placeholder="Nome da campanha"
            value={campaignNameInput}
            onChange={(e) => setCampaignNameInput(e.target.value)}
            onPressEnter={handleSaveCampaignName}
            disabled={savingCampaignName}
            size="large"
            style={{ flex: 1 }}
          />
          <Button type="primary" onClick={handleSaveCampaignName} loading={savingCampaignName} size="large">
            {campaignHasName ? 'Salvar' : 'Salvar'}
          </Button>
        </Space.Compact>
      </Modal>

      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {campaignInfo?.name?.trim() || 'Sua campanha'}
            {campaignId && (
              <Tooltip title="Editar nome da campanha">
                <Button type="text" size="small" icon={<EditOutlined />} onClick={openNameModalForEdit} style={{ padding: '0 4px' }} />
              </Tooltip>
            )}
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            {contextItems != null && (
              <>
                {contextItems.length.toLocaleString('pt-BR')} perfis no contexto
                {total !== contextItems.length && (
                  <> · {total.toLocaleString('pt-BR')} filtrados</>
                )}
              </>
            )}
            {campaignCredits != null && (
              <> · {campaignCredits.toLocaleString('pt-BR')} créditos</>
            )}
            {contextItems == null && campaignCredits == null && <>— perfis</>}
          </Typography.Text>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Button type="default" onClick={() => navigate('/app/campaigns')}>
            Minhas campanhas
          </Button>
          <Button type="default" onClick={() => navigate('/app')}>
            Nova busca
          </Button>
        </div>
      </div>

      {facets == null && loading ? (
        <div style={{ textAlign: 'center', padding: 16 }}>
          <Spin size="small" />
        </div>
      ) : facets == null && !loading ? (
        <Empty description="Nenhum perfil nesta campanha." />
      ) : (
        <div>
          {facets != null && (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 6,
                padding: '4px 0 8px',
                marginBottom: 8,
                borderBottom: '1px solid var(--app-border-light)',
              }}
            >
              <FilterOutlined style={{ fontSize: 12, color: 'var(--app-text-secondary)', marginRight: 2 }} />
              {facets?.cost_tier && facets.cost_tier.length > 0 && (
                <Select
                  size="small"
                  placeholder="Preço"
                  allowClear
                  value={selectedCostTierOption}
                  options={(() => {
                    const opts: { value: 'low' | 'medium' | 'above'; label: string }[] = []
                    const low = facets.cost_tier!.find((x) => x.tier === 'low')
                    if (low && low.count > 0) opts.push({ value: 'low', label: `Abaixo (${low.count})` })
                    const medium = facets.cost_tier!.find((x) => x.tier === 'medium')
                    if (medium && medium.count > 0) opts.push({ value: 'medium', label: `Normal (${medium.count})` })
                    const high = facets.cost_tier!.find((x) => x.tier === 'high')
                    const veryHigh = facets.cost_tier!.find((x) => x.tier === 'very_high')
                    const aboveCount = (high?.count ?? 0) + (veryHigh?.count ?? 0)
                    if (aboveCount > 0) opts.push({ value: 'above', label: `Acima (${aboveCount})` })
                    return opts
                  })()}
                  style={{ width: 130 }}
                  onChange={(value) => {
                    if (value == null) {
                      updateFilter({ costTierFilter: undefined })
                      return
                    }
                    const costTierFilter =
                      value === 'low' ? ['low'] : value === 'medium' ? ['medium'] : ['high', 'very_high']
                    updateFilter({ costTierFilter })
                  }}
                />
              )}
              {facets?.content_type && facets.content_type.filter((x) => x.count > 0).length > 0 && (
                <Select
                  mode="multiple"
                  size="small"
                  placeholder="Conteúdo"
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  value={selectedContentTypes.length ? selectedContentTypes : undefined}
                  options={facets.content_type
                    .filter((x) => x.count > 0)
                    .map(({ name, count }) => ({
                      value: name,
                      label: `${CONTENT_TYPE_LABELS[name] ?? name} (${count})`,
                    }))}
                  onChange={(vals) => updateFilter({ contentTypes: vals?.length ? vals : undefined })}
                  style={{ width: 140 }}
                  maxTagCount={1}
                />
              )}
              {facets?.pricing && Object.values(facets.pricing).some((arr) => arr && arr.length > 0) &&
                PRICING_FILTER_KEYS.map((key) => {
                  const actKey = key.slice(7).toLowerCase() as 'feed' | 'reels' | 'story' | 'destaque'
                  const buckets = facets.pricing?.[actKey]
                  if (!buckets || buckets.length === 0) return null
                  const value =
                    key === 'pricingFeed' ? selectedPricingFeed
                      : key === 'pricingReels' ? selectedPricingReels
                        : key === 'pricingStory' ? selectedPricingStory
                          : selectedPricingDestaque
                  const options = buckets.map((b) => ({
                    value: b.value,
                    label: `${PRICE_BUCKETS.find((pb) => pb.value === b.value)?.label ?? `R$ ${b.value}`} (${b.count})`,
                  }))
                  return (
                    <Select
                      key={key}
                      mode="multiple"
                      size="small"
                      placeholder={PRICING_FILTER_LABELS[key]}
                      allowClear
                      value={value?.length ? value : undefined}
                      options={options}
                      onChange={(vals) => updateFilter({ [key]: vals?.length ? vals : undefined })}
                      style={{ width: 100 }}
                      maxTagCount={1}
                    />
                  )
                })}
              {facets?.activation && (facets.activation.activated > 0 || facets.activation.not_activated > 0) && (
                <Select
                  mode="multiple"
                  size="small"
                  placeholder="Ativado"
                  allowClear
                  value={selectedActivation.length ? selectedActivation : undefined}
                  options={[
                    facets.activation.activated > 0 && { value: 'activated', label: `Sim (${facets.activation.activated})` },
                    facets.activation.not_activated > 0 && { value: 'not_activated', label: `Não (${facets.activation.not_activated})` },
                  ].filter(Boolean) as { value: string; label: string }[]}
                  onChange={(vals) => updateFilter({ activationFilter: vals?.length && vals.length < 2 ? vals : undefined })}
                  style={{ width: 100 }}
                  maxTagCount={1}
                />
              )}
              {facets?.social && (facets.social.whatsapp > 0 || facets.social.tiktok > 0 || facets.social.facebook > 0 || facets.social.linkedin > 0 || facets.social.twitter > 0) && (
                <Select
                  mode="multiple"
                  size="small"
                  placeholder="Redes"
                  allowClear
                  value={selectedSocial.length ? selectedSocial : undefined}
                  options={[
                    facets.social.whatsapp > 0 && { value: 'whatsapp', label: `WA (${facets.social.whatsapp})` },
                    facets.social.tiktok > 0 && { value: 'tiktok', label: `TikTok (${facets.social.tiktok})` },
                    facets.social.facebook > 0 && { value: 'facebook', label: `FB (${facets.social.facebook})` },
                    facets.social.linkedin > 0 && { value: 'linkedin', label: `LI (${facets.social.linkedin})` },
                    facets.social.twitter > 0 && { value: 'twitter', label: `X (${facets.social.twitter})` },
                  ].filter(Boolean) as { value: string; label: string }[]}
                  onChange={(vals) => updateFilter({ socialNetworks: vals?.length ? vals : undefined })}
                  style={{ width: 110 }}
                  maxTagCount={1}
                />
              )}
              {facets?.cities && facets.cities.length > 0 && (
                <Select
                  mode="multiple"
                  size="small"
                  placeholder="Cidades"
                  allowClear
                  showSearch={false}
                  optionFilterProp="label"
                  value={selectedCities.length ? selectedCities : undefined}
                  options={facets.cities.map(({ name, count }) => ({ value: name, label: `${name} (${count})` }))}
                  onChange={(vals) => updateFilter({ cities: vals?.length ? vals : undefined })}
                  style={{ width: 120 }}
                  maxTagCount={1}
                />
              )}
              {facets?.states && facets.states.length > 0 && (
                <Select
                  mode="multiple"
                  size="small"
                  placeholder="Estados"
                  allowClear
                  showSearch={false}
                  optionFilterProp="label"
                  value={selectedStates.length ? selectedStates : undefined}
                  options={facets.states.map(({ name, count }) => ({ value: name, label: `${name} (${count})` }))}
                  onChange={(vals) => updateFilter({ states: vals?.length ? vals : undefined })}
                  style={{ width: 110 }}
                  maxTagCount={1}
                />
              )}
              {facets?.neighborhoods && facets.neighborhoods.length > 0 && (
                <Select
                  mode="multiple"
                  size="small"
                  placeholder="Bairros"
                  allowClear
                  showSearch={false}
                  optionFilterProp="label"
                  value={selectedNeighborhoods.length ? selectedNeighborhoods : undefined}
                  options={facets.neighborhoods.map(({ name, count }) => ({ value: name, label: `${name} (${count})` }))}
                  onChange={(vals) => updateFilter({ neighborhoods: vals?.length ? vals : undefined })}
                  style={{ width: 110 }}
                  maxTagCount={1}
                />
              )}
              {hasActiveFilters && (
                <Button type="text" size="small" icon={<ClearOutlined />} onClick={clearFilters} style={{ marginLeft: 2, padding: '0 4px', height: 22, fontSize: 11 }}>
                  Limpar
                </Button>
              )}
            </div>
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, width: '100%', minWidth: 0 }}>
              <Typography.Text strong type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
                Busca Palavras
              </Typography.Text>
              <Space.Compact style={{ flex: 1, minWidth: 0 }}>
                <Input
                  placeholder="Nome ou @usuario"
                  prefix={<SearchOutlined style={{ color: 'var(--app-text-tertiary)' }} />}
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onPressEnter={() => updateFilter({ q: searchInput.trim() || undefined })}
                  allowClear
                  size="small"
                  style={{ flex: 1 }}
                />
                <Button
                  type="primary"
                  size="small"
                  icon={<SearchOutlined />}
                  onClick={() => updateFilter({ q: searchInput.trim() || undefined })}
                >
                  Buscar
                </Button>
              </Space.Compact>
              {!isMobile && (
                <Button.Group
                  style={{ flexShrink: 0, borderRadius: 20, overflow: 'hidden' }}
                >
                  <Tooltip title="Lista (um por linha)">
                    <Button
                      type={viewMode === 'list' ? 'primary' : 'default'}
                      icon={<UnorderedListOutlined />}
                      onClick={() => setViewMode('list')}
                      size="small"
                    />
                  </Tooltip>
                  <Tooltip title="Lado a lado (grade)">
                    <Button
                      type={viewMode === 'grid' ? 'primary' : 'default'}
                      icon={<AppstoreOutlined />}
                      onClick={() => setViewMode('grid')}
                      size="small"
                    />
                  </Tooltip>
                </Button.Group>
              )}
            </div>
            {loading && (
              <div
                style={{
                  marginBottom: 8,
                  padding: '6px 10px',
                  fontSize: 13,
                  color: 'var(--colorTextSecondary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <Spin size="small" />
                <span>Filtrando...</span>
              </div>
            )}
            {!loading && data.length === 0 && (
              <Empty description="Nenhum perfil nesta campanha." />
            )}
            {(data.length > 0 || loading) && (effectiveViewMode === 'list' ? (
              <div
                className="campaign-list-table"
                style={{
                  border: '1px solid var(--app-border, #f0f0f0)',
                  borderRadius: 8,
                  overflow: 'auto',
                  background: 'var(--app-bg)',
                  minWidth: 0,
                }}
              >
                <div
                  className="campaign-list-header"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: LIST_GRID_COLUMNS,
                    gap: '0 8px',
                    alignItems: 'center',
                    padding: '4px 10px',
                    minHeight: 28,
                    background: 'var(--app-bg-secondary, #fafafa)',
                    borderBottom: '1px solid var(--app-border, #f0f0f0)',
                    fontSize: 10,
                    fontWeight: 600,
                    color: 'var(--app-text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.02em',
                    minWidth: 900,
                  }}
                >
                  <div />
                  <Tooltip title="Clique para ordenar por nome">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => handleSortColumn('name')}
                      onKeyDown={(e) => e.key === 'Enter' && handleSortColumn('name')}
                      className="campaign-list-cell"
                      style={{ textAlign: 'center', cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                    >
                      Perfil
                      {currentSort === 'name_desc' ? <CaretDownOutlined style={{ fontSize: 9, opacity: 1 }} /> : currentSort === 'name_asc' ? <CaretUpOutlined style={{ fontSize: 9, opacity: 1 }} /> : <CaretDownOutlined style={{ fontSize: 9, opacity: 0.45 }} />}
                    </div>
                  </Tooltip>
                  <Tooltip title="Clique para ordenar por seguidores">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => handleSortColumn('followers')}
                      onKeyDown={(e) => e.key === 'Enter' && handleSortColumn('followers')}
                      className="campaign-list-cell campaign-list-cell-border"
                      style={{ textAlign: 'center', cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                    >
                      Seg.
                      {currentSort === 'followers_desc' ? <CaretDownOutlined style={{ fontSize: 9, opacity: 1 }} /> : currentSort === 'followers_asc' ? <CaretUpOutlined style={{ fontSize: 9, opacity: 1 }} /> : <CaretDownOutlined style={{ fontSize: 9, opacity: 0.45 }} />}
                    </div>
                  </Tooltip>
                  <Tooltip title="Clique para ordenar por engajamento">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => handleSortColumn('engagement')}
                      onKeyDown={(e) => e.key === 'Enter' && handleSortColumn('engagement')}
                      className="campaign-list-cell campaign-list-cell-border"
                      style={{ textAlign: 'center', cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                    >
                      Eng.
                      {currentSort === 'engagement_desc' ? <CaretDownOutlined style={{ fontSize: 9, opacity: 1 }} /> : currentSort === 'engagement_asc' ? <CaretUpOutlined style={{ fontSize: 9, opacity: 1 }} /> : <CaretDownOutlined style={{ fontSize: 9, opacity: 0.45 }} />}
                    </div>
                  </Tooltip>
                  <Tooltip title="Total de curtidas">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => handleSortColumn('total_likes')}
                      onKeyDown={(e) => e.key === 'Enter' && handleSortColumn('total_likes')}
                      className="campaign-list-cell campaign-list-cell-border"
                      style={{ textAlign: 'center', cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                    >
                      Like
                      {currentSort === 'total_likes_desc' ? <CaretDownOutlined style={{ fontSize: 9, opacity: 1 }} /> : currentSort === 'total_likes_asc' ? <CaretUpOutlined style={{ fontSize: 9, opacity: 1 }} /> : <CaretDownOutlined style={{ fontSize: 9, opacity: 0.45 }} />}
                    </div>
                  </Tooltip>
                  <Tooltip title="Ordenar por comentários">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => handleSortColumn('total_comments')}
                      onKeyDown={(e) => e.key === 'Enter' && handleSortColumn('total_comments')}
                      className="campaign-list-cell campaign-list-cell-border"
                      style={{ textAlign: 'center', cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                    >
                      Com.
                      {currentSort === 'total_comments_desc' ? <CaretDownOutlined style={{ fontSize: 9, opacity: 1 }} /> : currentSort === 'total_comments_asc' ? <CaretUpOutlined style={{ fontSize: 9, opacity: 1 }} /> : <CaretDownOutlined style={{ fontSize: 9, opacity: 0.45 }} />}
                    </div>
                  </Tooltip>
                  <Tooltip title="Média de likes por post">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => handleSortColumn('avg_likes')}
                      onKeyDown={(e) => e.key === 'Enter' && handleSortColumn('avg_likes')}
                      className="campaign-list-cell campaign-list-cell-border"
                      style={{ textAlign: 'center', cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                    >
                      Posts
                      {currentSort === 'avg_likes_desc' ? <CaretDownOutlined style={{ fontSize: 9, opacity: 1 }} /> : currentSort === 'avg_likes_asc' ? <CaretUpOutlined style={{ fontSize: 9, opacity: 1 }} /> : <CaretDownOutlined style={{ fontSize: 9, opacity: 0.45 }} />}
                    </div>
                  </Tooltip>
                  <Tooltip title="Clique para ordenar por preço">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => handleSortColumn('cost_tier')}
                      onKeyDown={(e) => e.key === 'Enter' && handleSortColumn('cost_tier')}
                      className="campaign-list-cell campaign-list-cell-border"
                      style={{ textAlign: 'center', cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                    >
                      Preço
                      {currentSort === 'cost_tier_desc' ? <CaretDownOutlined style={{ fontSize: 9, opacity: 1 }} /> : currentSort === 'cost_tier_asc' ? <CaretUpOutlined style={{ fontSize: 9, opacity: 1 }} /> : <CaretDownOutlined style={{ fontSize: 9, opacity: 0.45 }} />}
                    </div>
                  </Tooltip>
                  <Tooltip title="Clique para ordenar por favoritos">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => handleSortColumn('favorite')}
                      onKeyDown={(e) => e.key === 'Enter' && handleSortColumn('favorite')}
                      className="campaign-list-cell"
                      style={{ textAlign: 'center', fontSize: 10, color: 'var(--app-text-secondary)', cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                    >
                      Fav.
                      {currentSort === 'favorite_desc' ? <CaretDownOutlined style={{ fontSize: 9, opacity: 1 }} /> : currentSort === 'favorite_asc' ? <CaretUpOutlined style={{ fontSize: 9, opacity: 1 }} /> : <CaretDownOutlined style={{ fontSize: 9, opacity: 0.45 }} />}
                    </div>
                  </Tooltip>
                </div>
                {data.map((item) => (
                  <CampaignListRow
                    key={item.key}
                    item={item}
                    onClick={() => openDetail(item.handle ?? item.key)}
                    isFavorite={user ? favoriteHandles.has((item.handle ?? item.key).toLowerCase().replace(/^@/, '')) : false}
                    onFavoriteToggle={user ? handleFavoriteToggle : undefined}
                  />
                ))}
              </div>
            ) : (
              <Row gutter={[12, 12]}>
                {data.map((item) => (
                  <Col
                    key={item.key}
                    xs={24}
                    sm={12}
                    md={12}
                    lg={8}
                    style={{ minWidth: 0 }}
                  >
                    <ProfileSummaryCard
                      item={item}
                      variant="list"
                      onClick={() => openDetail(item.handle ?? item.key)}
                      onImageRefreshQueued={(handle) => addHandleForImageUpdate.current?.(handle)}
                      showMetrics={!!user}
                      isFavorite={user ? favoriteHandles.has((item.handle ?? item.key).toLowerCase().replace(/^@/, '')) : false}
                      onFavoriteToggle={user ? handleFavoriteToggle : undefined}
                    />
                  </Col>
                ))}
              </Row>
            ))}
          </div>
        </div>
      )}
      {!loading && data.length > 0 && (
        <>
          {data.length < total && (
            <div
              ref={loadMoreSentinelRef}
              style={{ minHeight: 1, marginTop: 16 }}
              aria-hidden
            />
          )}
          <Typography.Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
            {data.length} de {total} perfis
          </Typography.Text>
        </>
      )}
    </div>
  )
}
