/**
 * Listagem de influenciadores de uma campanha.
 * Rota: /app/campaigns/:campaignId — filtros baseados nos facets (retorno da API), igual InfluencerList.
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Row, Col, Typography, Button, Spin, Empty, Tooltip, Select, Input, Space, Modal, Tag, Card, Alert } from 'antd'
import { AppstoreOutlined, UnorderedListOutlined, UserOutlined, FilterOutlined, ClearOutlined, SearchOutlined, CaretUpOutlined, CaretDownOutlined, EditOutlined, HeartOutlined, HeartFilled, BankOutlined, CopyOutlined, CommentOutlined, TeamOutlined, FileTextOutlined, RiseOutlined, CalendarOutlined } from '@ant-design/icons'
import { useAuth } from '../contexts/AuthContext'
import {
  fetchCampaignProfiles,
  getCampaign,
  updateCampaignName,
  updateCampaignDescription,
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
import CampaignBIPanel from '../components/CampaignBIPanel/CampaignBIPanel'
import { MessageOutlined, VideoCameraOutlined } from '@ant-design/icons'
import QRCode from 'qrcode'

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
  if (query.sizeFilter?.length) params.sizeFilter = query.sizeFilter.join(',')
  if (query.accountTypeFilter?.length) params.accountTypeFilter = query.accountTypeFilter.map(String).join(',')
  if (query.contentTypes?.length) params.contentTypes = query.contentTypes.join(',')
  if (query.pricingFeed?.length) params.pricingFeed = query.pricingFeed.join(',')
  if (query.pricingReels?.length) params.pricingReels = query.pricingReels.join(',')
  if (query.pricingStory?.length) params.pricingStory = query.pricingStory.join(',')
  if (query.pricingDestaque?.length) params.pricingDestaque = query.pricingDestaque.join(',')
  if (query.activationFilter?.length) params.activationFilter = query.activationFilter.join(',')
  if (query.cities?.length) params.cities = query.cities.join(',')
  if (query.states?.length) params.states = query.states.join(',')
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
    sizeFilter: parseStrList(params.get('sizeFilter')),
    accountTypeFilter: parseNumList(params.get('accountTypeFilter')),
    contentTypes: parseStrList(params.get('contentTypes')),
    pricingFeed: parseNumList(params.get('pricingFeed')),
    pricingReels: parseNumList(params.get('pricingReels')),
    pricingStory: parseNumList(params.get('pricingStory')),
    pricingDestaque: parseNumList(params.get('pricingDestaque')),
    activationFilter: parseStrList(params.get('activationFilter')),
    cities: parseStrList(params.get('cities')),
    states: parseStrList(params.get('states')),
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

function getTierShort(followers: number | undefined | null): string {
  if (followers == null || !Number.isFinite(followers)) return '—'
  if (followers < 10_000) return 'Nano'
  if (followers < 50_000) return 'Micro'
  if (followers < 500_000) return 'Mid'
  return 'Macro'
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return iso
  }
}

function computeReportStats(items: ProfileListItem[] | null): { totalLikes: number; totalComments: number; totalViews: number; totalFollowers: number; postsCount: number; avgEngagementRate: number; count: number } {
  if (!items?.length) return { totalLikes: 0, totalComments: 0, totalViews: 0, totalFollowers: 0, postsCount: 0, avgEngagementRate: 0, count: 0 }
  let totalLikes = 0, totalComments = 0, totalViews = 0, totalFollowers = 0, postsCount = 0, engSum = 0, engCount = 0
  for (const it of items) {
    totalFollowers += it.followers_count ?? 0
    const eng = it.engagement
    if (eng) {
      totalLikes += eng.total_likes ?? 0
      totalComments += eng.total_comments ?? 0
      totalViews += eng.total_views ?? 0
      postsCount += eng.posts_count ?? 0
      if (Number.isFinite(eng.engagement_rate)) {
        engSum += eng.engagement_rate
        engCount++
      }
    }
  }
  return {
    totalLikes,
    totalComments,
    totalViews,
    totalFollowers,
    postsCount,
    avgEngagementRate: engCount > 0 ? Math.round((engSum / engCount) * 100) / 100 : 0,
    count: items.length,
  }
}

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
  const accountTypeValue = (item as { account_type?: number }).account_type
  const accountTypeLabel = accountTypeValue === 1 ? 'Pessoal' : accountTypeValue === 2 ? 'Criador' : accountTypeValue === 3 ? 'Empresa' : null
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
    <tr
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      className="campaign-list-row"
      style={{ cursor: 'pointer', background: 'var(--app-bg)', transition: 'background 0.15s' }}
    >
      <td style={{ verticalAlign: 'middle', padding: '4px 6px', textAlign: 'right', width: '1%' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, justifyContent: 'center', minWidth: 0, alignItems: 'flex-end' }}>
          {accountTypeLabel ? (
            <Tag
              color={accountTypeValue === 1 ? 'default' : accountTypeValue === 2 ? 'blue' : 'purple'}
              style={{ margin: 0, fontSize: 10, padding: '0 5px', lineHeight: '18px', width: 'fit-content' }}
            >
              {accountTypeLabel}
            </Tag>
          ) : (
            <span style={{ fontSize: 10, color: 'var(--app-text-tertiary)' }}>—</span>
          )}
        </div>
      </td>
      <td style={{ verticalAlign: 'middle', padding: '4px 6px', width: 48 }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: 'var(--app-placeholder-bg)' }}>
          {pic ? (
            <img src={pic} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--app-text-secondary)' }}>
              <UserOutlined style={{ fontSize: 20 }} />
            </div>
          )}
        </div>
      </td>
      {onFavoriteToggle != null ? (
        <td className="campaign-list-cell" style={{ textAlign: 'center', width: 36, verticalAlign: 'middle', padding: '2px 0', paddingLeft: 0, paddingRight: 0 }} onClick={(e) => e.stopPropagation()}>
          <Tooltip title={isFavorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}>
            <Button
              type="text"
              size="small"
              icon={isFavorite ? <HeartFilled style={{ color: 'var(--app-primary)', fontSize: 14 }} /> : <HeartOutlined style={{ color: 'var(--app-text-secondary)', fontSize: 14 }} />}
              onClick={(e) => {
                e.stopPropagation()
                onFavoriteToggle(handle)
              }}
              style={{ minWidth: 24, height: 24, padding: 0 }}
              aria-label={isFavorite ? 'Remover dos favoritos' : 'Favoritar'}
            />
          </Tooltip>
        </td>
      ) : (
        <td style={{ width: 36, padding: '2px 0', paddingLeft: 0, paddingRight: 0 }} />
      )}
      <td style={{ verticalAlign: 'middle', padding: '4px 4px', width: '100%', maxWidth: 300, minWidth: 0, overflow: 'hidden', textAlign: 'left' }}>
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0 }}>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <Tooltip title={Number.isFinite(followers) && followers >= 0 ? (followers < 10_000 ? 'Nano (até 10k seg.)' : followers < 50_000 ? 'Micro (10k–50k)' : followers < 500_000 ? 'Mid (50k–500k)' : 'Macro (500k+)') : undefined}>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  color: '#fff',
                  padding: '1px 5px',
                  borderRadius: 8,
                  flexShrink: 0,
                  background: (() => {
                    const t = getTierShort(followers)
                    if (t === 'Nano') return 'linear-gradient(90deg, #722ed1, #9254de)'
                    if (t === 'Micro') return 'linear-gradient(90deg, #1890ff, #40a9ff)'
                    if (t === 'Mid') return 'linear-gradient(90deg, #13c2c2, #36cfc9)'
                    if (t === 'Macro') return 'linear-gradient(90deg, #eb2f96, #f759ab)'
                    return 'rgba(0,0,0,0.25)'
                  })(),
                }}
              >
                {getTierShort(followers)}
              </span>
            </Tooltip>
            <Tooltip title={`@${handle}`}>
              <span style={{ fontSize: 12, color: 'var(--app-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                @{handle}
              </span>
            </Tooltip>
          </div>
          {location && (
            <Tooltip title={location}>
              <div style={{ fontSize: 11, color: 'var(--app-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {location}
              </div>
            </Tooltip>
          )}
        </div>
      </td>
      <td className="campaign-list-cell campaign-list-cell-border" style={{ fontSize: 11, color: 'var(--app-text)', textAlign: 'center', width: 72 }}>
        <Tooltip title={formatShortNum(followers) !== String(followers) ? String(followers) : undefined}>
          <span>
            {formatShortNum(followers)}
          </span>
        </Tooltip>
      </td>
      <td className="campaign-list-cell campaign-list-cell-border" style={{ fontSize: 11, fontWeight: 600, color: 'var(--app-text)', textAlign: 'center', width: 76 }}>
        {engagementRate.toFixed(1)}%
      </td>
      <td className="campaign-list-cell campaign-list-cell-border" style={{ fontSize: 11, color: 'var(--app-text)', textAlign: 'center', width: 74 }}>
        <Tooltip title={formatShortNum(totalLikes) !== String(totalLikes) ? String(totalLikes) : undefined}>
          <span>{formatShortNum(totalLikes)}</span>
        </Tooltip>
      </td>
      <td className="campaign-list-cell campaign-list-cell-border" style={{ fontSize: 11, color: 'var(--app-text-secondary)', textAlign: 'center', width: 74 }}>
        <Tooltip title={formatShortNum(totalComments) !== String(totalComments) ? String(totalComments) : undefined}>
          <span>{formatShortNum(totalComments)}</span>
        </Tooltip>
      </td>
      <td className="campaign-list-cell campaign-list-cell-border" style={{ fontSize: 11, color: 'var(--app-text-secondary)', textAlign: 'center', width: 72 }}>
        <Tooltip title="Média de likes por post">
          <span>{formatShortNum(avgLikes)}</span>
        </Tooltip>
      </td>
      <td className="campaign-list-cell campaign-list-cell-border" style={{ fontSize: 11, fontWeight: 600, color: costTierColor ?? 'var(--app-text)', textAlign: 'center', width: 68 }}>
        <Tooltip title={priceTooltipNode}>
          <span>
            {costTier
              ? (() => {
                const label = costTier.label.trim()
                return label.charAt(0).toUpperCase() + label.slice(1)
              })()
              : '—'}
          </span>
        </Tooltip>
      </td>
    </tr>
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
  const [pendingPaymentPixQr, setPendingPaymentPixQr] = useState<string | null>(null)

  useEffect(() => {
    const pix = campaignInfo?.pendingPayment?.pixCopyPaste
    if (!pix) {
      setPendingPaymentPixQr(null)
      return
    }
    let cancelled = false
    QRCode.toDataURL(pix, { width: 220, margin: 2 })
      .then((url) => { if (!cancelled) setPendingPaymentPixQr(url) })
      .catch(() => { if (!cancelled) setPendingPaymentPixQr(null) })
    return () => { cancelled = true }
  }, [campaignInfo?.pendingPayment?.pixCopyPaste])

  useEffect(() => {
    if (!user) {
      setFavoriteHandles(new Set())
      return
    }
    const norm = (h: string) => (h ?? '').toLowerCase().replace(/^@/, '').trim()
    fetchFavorites()
      .then((res) => {
        // Na tela de campanha, considerar só favoritos desta campanha para o estado "selecionado"
        if (campaignId && (res.favorites?.length ?? 0) > 0) {
          const forCampaign = (res.favorites ?? []).filter((f) => f.campaignId === campaignId).map((f) => norm(f.handle))
          setFavoriteHandles(new Set(forCampaign))
        } else {
          setFavoriteHandles(new Set((res.handles ?? []).map(norm)))
        }
      })
      .catch(() => setFavoriteHandles(new Set()))
  }, [user, campaignId])

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
      if (isFav) await removeFavorite(handle, campaignId ? { campaignId } : undefined)
      else await addFavorite(handle, { campaignId: campaignId ?? undefined })
    } catch {
      setFavoriteHandles((prev) => {
        const next = new Set(prev)
        if (isFav) next.add(normalized)
        else next.delete(normalized)
        return next
      })
    }
  }, [campaignId, favoriteHandles])

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

  const handleDescriptionSave = useCallback(
    (value: string) => {
      if (!campaignId) return
      updateCampaignDescription(campaignId, value).then(() => {
        setCampaignInfo((prev) => (prev ? { ...prev, description: value || null } : null))
      })
    },
    [campaignId]
  )

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
  const selectedSocial = (query.socialNetworks ?? []) as string[]
  const selectedContentTypes = (query.contentTypes ?? []) as string[]
  const selectedPricingFeed = (query.pricingFeed ?? []) as number[]
  const selectedPricingReels = (query.pricingReels ?? []) as number[]
  const selectedPricingStory = (query.pricingStory ?? []) as number[]
  const selectedPricingDestaque = (query.pricingDestaque ?? []) as number[]
  const costTierFilter = (query.costTierFilter ?? []) as string[]
  const selectedSizeFilter = (query.sizeFilter ?? []) as string[]
  const selectedAccountTypeFilter = (query.accountTypeFilter ?? []) as number[]
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
    selectedSocial.length > 0 ||
    selectedContentTypes.length > 0 ||
    selectedSizeFilter.length > 0 ||
    selectedAccountTypeFilter.length > 0 ||
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
    <div style={{ overflowX: 'hidden' }}>
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
          <Button
            type="primary"
            onClick={() => navigate('/app/campaigns')}
            style={{
              background: 'linear-gradient(135deg, var(--app-primary) 0%, var(--app-primary-dark, #6b21a8) 100%)',
              border: 'none',
              boxShadow: 'var(--app-shadow-cta, 0 2px 8px rgba(124, 58, 237, 0.35))',
            }}
          >
            Minhas campanhas
          </Button>
          <Button
            type="primary"
            onClick={() => navigate('/search')}
            style={{
              background: 'linear-gradient(135deg, #0891b2 0%, #0e7490 100%)',
              border: 'none',
              boxShadow: '0 2px 8px rgba(8, 145, 178, 0.35)',
            }}
          >
            Nova busca
          </Button>
        </div>
      </div>

      {campaignInfo?.pendingPayment ? (
        <div style={{ margin: '24px auto', overflowX: 'hidden', maxWidth: '100%' }}>
          <Alert
            type="warning"
            message="Pagamento pendente — pague o boleto ou PIX para liberar os resultados."
            showIcon
            style={{ marginBottom: 12, width: '100%' }}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, overflowX: 'hidden', minWidth: 0, maxWidth: '100%' }}>
            <Card style={{ flex: 1, minWidth: 0, maxWidth: '100%', overflow: 'hidden' }}>

              {campaignInfo.pendingPayment.billingType === 'BOLETO' && campaignInfo.pendingPayment.bankSlipUrl ? (
                <div style={{ overflow: 'hidden', width: '100%', maxWidth: '100%' }}>
                  <iframe
                    src={campaignInfo.pendingPayment.bankSlipUrl}
                    title="Preview do boleto"
                    style={{ zoom: 0.8, width: '100%', height: 'calc(100vh - 250px)', minHeight: 400, border: '1px solid var(--app-border)', borderRadius: 8, display: 'block' }}
                  />
                </div>
              ) : campaignInfo.pendingPayment.billingType === 'PIX' && pendingPaymentPixQr ? (
                <div style={{ textAlign: 'center', padding: '16px 0' }}>
                  <img src={pendingPaymentPixQr} alt="QR Code PIX" style={{ width: 220, height: 220 }} />
                  <Typography.Text strong style={{ display: 'block', marginTop: 12 }}>Escaneie para pagar</Typography.Text>
                </div>
              ) : (
                <Typography.Text type="secondary">Aguardando dados de pagamento.</Typography.Text>
              )}
            </Card>
            <Card
              style={{
                flex: 1,
                minWidth: 0,
                maxWidth: '100%',
                background: 'linear-gradient(135deg, var(--app-card-bg) 0%, var(--app-card-bg-soft) 100%)',
                border: '1px solid var(--app-border)',
                boxShadow: 'var(--app-shadow-md)',
              }}
            >
              <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <Typography.Title level={4} style={{ margin: '0 0 4px 0', color: 'var(--app-text)', fontWeight: 700 }}>
                    {campaignInfo.name?.trim() || 'Seu relatório'}
                  </Typography.Title>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {campaignInfo.created_at ? <><CalendarOutlined style={{ marginRight: 4, opacity: 0.7 }} />{formatDate(campaignInfo.created_at)}</> : 'Seus influenciadores estão prontos'}
                  </Typography.Text>
                </div>
                <Tag color="success" style={{ borderRadius: 6, flexShrink: 0 }}>Quase lá!</Tag>
              </div>

              <div
                style={{
                  background: 'var(--app-primary-muted)',
                  padding: '12px 16px',
                  borderRadius: 12,
                  marginBottom: 16,
                  border: '1px solid var(--app-border-light)',
                }}
              >
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>Valor total</Typography.Text>
                <Typography.Title level={3} style={{ margin: '4px 0 0 0', color: 'var(--app-primary)', fontWeight: 700 }}>
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(campaignInfo.pendingPayment.valueBrl)}
                </Typography.Title>
              </div>

              <div style={{ marginBottom: 16 }}>
                <Typography.Text strong style={{ marginBottom: 8, display: 'block', fontSize: 13, color: 'var(--app-text)' }}>
                  O que você vai receber
                </Typography.Text>
                {loading && !contextItems?.length ? (
                  <Spin size="small" />
                ) : (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(2, 1fr)',
                      gap: '8px 16px',
                      padding: '12px 0',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: 'var(--app-primary)', fontSize: 16 }}><UserOutlined /></span>
                      <span><strong>{contextItems?.length ?? campaignInfo.handlesCount ?? 0}</strong> perfis</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: 'var(--app-primary)', fontSize: 16 }}><TeamOutlined /></span>
                      <span><strong>{formatShortNum(computeReportStats(contextItems ?? []).totalFollowers)}</strong> seguidores</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: 'var(--app-primary)', fontSize: 16 }}><HeartOutlined /></span>
                      <span><strong>{formatShortNum(computeReportStats(contextItems ?? []).totalLikes)}</strong> likes</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: 'var(--app-primary)', fontSize: 16 }}><CommentOutlined /></span>
                      <span><strong>{formatShortNum(computeReportStats(contextItems ?? []).totalComments)}</strong> comentários</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: 'var(--app-primary)', fontSize: 16 }}><FileTextOutlined /></span>
                      <span><strong>{formatShortNum(computeReportStats(contextItems ?? []).postsCount)}</strong> posts</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: 'var(--app-primary)', fontSize: 16 }}><RiseOutlined /></span>
                      <span><strong>{computeReportStats(contextItems ?? []).avgEngagementRate?.toFixed(2) ?? '0'}%</strong> engajamento</span>
                    </div>
                  </div>
                )}
              </div>

              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                {campaignInfo.pendingPayment.billingType === 'BOLETO' && campaignInfo.pendingPayment.bankSlipUrl && (
                  <Button
                    type="primary"
                    href={campaignInfo.pendingPayment.bankSlipUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    block
                    icon={<BankOutlined />}
                    size="large"
                    style={{
                      height: 44,
                      fontWeight: 600,
                      boxShadow: 'var(--app-shadow-cta)',
                      background: 'linear-gradient(135deg, var(--app-primary) 0%, var(--app-primary-dark) 100%)',
                      border: 'none',
                    }}
                  >
                    Pagar boleto agora
                  </Button>
                )}
                {campaignInfo.pendingPayment.billingType === 'PIX' && campaignInfo.pendingPayment.pixCopyPaste && (
                  <>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>Código PIX (copie e cole no app do banco):</Typography.Text>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <Typography.Text
                        copyable={{ text: campaignInfo.pendingPayment.pixCopyPaste }}
                        style={{ flex: 1, minWidth: 0, wordBreak: 'break-all', fontSize: 12 }}
                        ellipsis
                      />
                      <Button
                        type="primary"
                        icon={<CopyOutlined />}
                        onClick={() => campaignInfo.pendingPayment?.pixCopyPaste && void navigator.clipboard.writeText(campaignInfo.pendingPayment.pixCopyPaste)}
                        style={{
                          fontWeight: 600,
                          background: 'linear-gradient(135deg, var(--app-primary) 0%, var(--app-primary-dark) 100%)',
                          border: 'none',
                        }}
                      >
                        Copiar e pagar
                      </Button>
                    </div>
                  </>
                )}
                {campaignInfo.pendingPayment.invoiceUrl && (
                  <Button href={campaignInfo.pendingPayment.invoiceUrl} target="_blank" rel="noopener noreferrer" block size="middle" style={{ marginTop: 4 }}>
                    Ver fatura
                  </Button>
                )}
              </Space>
            </Card>
          </div>
        </div>
      ) : facets == null && loading ? (
        <div style={{ textAlign: 'center', padding: 16 }}>
          <Spin size="small" />
        </div>
      ) : facets == null && !loading ? (
        <Empty description="Nenhum perfil nesta campanha." />
      ) : (
        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', minWidth: 0 }}>
          {!isMobile && (
            <div style={{ flexShrink: 0, width: 240, minWidth: 0 }}>
              <CampaignBIPanel
                items={filteredList}
                facets={facets}
                loading={loading}
                query={query}
                onFilter={updateFilter}
                description={campaignInfo?.description ?? null}
                onDescriptionSave={handleDescriptionSave}
                expiresAt={campaignInfo?.expires_at ?? null}
                createdAt={campaignInfo?.created_at ?? null}
              />
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            {isMobile && facets != null && (
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
                {facets?.size_buckets && facets.size_buckets.length > 0 && (
                  <Select
                    mode="multiple"
                    size="small"
                    placeholder="Tamanho"
                    allowClear
                    value={selectedSizeFilter.length ? selectedSizeFilter : undefined}
                    options={facets.size_buckets.map(({ key, label, count }) => ({
                      value: key,
                      label: `${label} (${count})`,
                    }))}
                    onChange={(vals) => updateFilter({ sizeFilter: vals?.length ? vals : undefined })}
                    style={{ width: 120 }}
                    maxTagCount={1}
                  />
                )}
                {facets?.account_type && facets.account_type.length > 0 && (
                  <Select
                    mode="multiple"
                    size="small"
                    placeholder="Tipo conta"
                    allowClear
                    value={selectedAccountTypeFilter.length ? selectedAccountTypeFilter : undefined}
                    options={facets.account_type.map(({ value, label, count }) => ({
                      value,
                      label: `${label} (${count})`,
                    }))}
                    onChange={(vals) => updateFilter({ accountTypeFilter: vals?.length ? vals : undefined })}
                    style={{ width: 120 }}
                    maxTagCount={1}
                  />
                )}
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
                    placeholder="Digite uma palavra"
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
                <div style={{ overflow: 'auto', border: '1px solid var(--app-border, #f0f0f0)', borderRadius: 8, minWidth: 0 }}>
                  <table className="campaign-list-table" style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--app-bg)' }}>
                    <thead>
                      <tr style={{ background: 'var(--app-bg-secondary, #fafafa)', borderBottom: '1px solid var(--app-border, #f0f0f0)', fontSize: 10, fontWeight: 600, color: 'var(--app-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.02em' }}>
                        <th style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '1px solid var(--app-border)', width: '1%', whiteSpace: 'nowrap' }} />
                        <th style={{ padding: '6px 8px', width: 48 }} />
                        <th style={{ padding: '4px 0', paddingLeft: 0, paddingRight: 0, textAlign: 'center', width: 36, cursor: 'pointer', userSelect: 'none' }} role="button" tabIndex={0} onClick={() => handleSortColumn('favorite')} onKeyDown={(e) => e.key === 'Enter' && handleSortColumn('favorite')} title="Ordenar por favoritos">
                          {currentSort === 'favorite_desc'
                            ? <HeartFilled style={{ color: 'var(--app-primary)', fontSize: 12 }} />
                            : <HeartOutlined style={{ color: 'var(--app-text-tertiary)', fontSize: 12, opacity: 0.5 }} />}
                        </th>
                        <th style={{ padding: '4px 4px', textAlign: 'center', borderLeft: '1px solid var(--app-border)', cursor: 'pointer', userSelect: 'none', width: '100%', maxWidth: 300 }} role="button" tabIndex={0} onClick={() => handleSortColumn('name')} onKeyDown={(e) => e.key === 'Enter' && handleSortColumn('name')}>
                          Perfil {currentSort === 'name_desc' ? <CaretDownOutlined style={{ fontSize: 9, opacity: 1 }} /> : currentSort === 'name_asc' ? <CaretUpOutlined style={{ fontSize: 9, opacity: 1 }} /> : <CaretDownOutlined style={{ fontSize: 9, opacity: 0.45 }} />}
                        </th>
                        <th style={{ padding: '6px 8px', textAlign: 'center', borderLeft: '1px solid var(--app-border)', cursor: 'pointer', userSelect: 'none', width: 72 }} role="button" tabIndex={0} onClick={() => handleSortColumn('followers')} onKeyDown={(e) => e.key === 'Enter' && handleSortColumn('followers')}>
                          Seg. {currentSort === 'followers_desc' ? <CaretDownOutlined style={{ fontSize: 9, opacity: 1 }} /> : currentSort === 'followers_asc' ? <CaretUpOutlined style={{ fontSize: 9, opacity: 1 }} /> : <CaretDownOutlined style={{ fontSize: 9, opacity: 0.45 }} />}
                        </th>
                        <th style={{ padding: '6px 8px', textAlign: 'center', borderLeft: '1px solid var(--app-border)', cursor: 'pointer', userSelect: 'none', width: 76 }} role="button" tabIndex={0} onClick={() => handleSortColumn('engagement')} onKeyDown={(e) => e.key === 'Enter' && handleSortColumn('engagement')}>
                          Eng. {currentSort === 'engagement_desc' ? <CaretDownOutlined style={{ fontSize: 9, opacity: 1 }} /> : currentSort === 'engagement_asc' ? <CaretUpOutlined style={{ fontSize: 9, opacity: 1 }} /> : <CaretDownOutlined style={{ fontSize: 9, opacity: 0.45 }} />}
                        </th>
                        <th style={{ padding: '6px 8px', textAlign: 'center', borderLeft: '1px solid var(--app-border)', cursor: 'pointer', userSelect: 'none', width: 74 }} role="button" tabIndex={0} onClick={() => handleSortColumn('total_likes')} onKeyDown={(e) => e.key === 'Enter' && handleSortColumn('total_likes')}>
                          Like {currentSort === 'total_likes_desc' ? <CaretDownOutlined style={{ fontSize: 9, opacity: 1 }} /> : currentSort === 'total_likes_asc' ? <CaretUpOutlined style={{ fontSize: 9, opacity: 1 }} /> : <CaretDownOutlined style={{ fontSize: 9, opacity: 0.45 }} />}
                        </th>
                        <th style={{ padding: '6px 8px', textAlign: 'center', borderLeft: '1px solid var(--app-border)', cursor: 'pointer', userSelect: 'none', width: 74 }} role="button" tabIndex={0} onClick={() => handleSortColumn('total_comments')} onKeyDown={(e) => e.key === 'Enter' && handleSortColumn('total_comments')}>
                          Com. {currentSort === 'total_comments_desc' ? <CaretDownOutlined style={{ fontSize: 9, opacity: 1 }} /> : currentSort === 'total_comments_asc' ? <CaretUpOutlined style={{ fontSize: 9, opacity: 1 }} /> : <CaretDownOutlined style={{ fontSize: 9, opacity: 0.45 }} />}
                        </th>
                        <th style={{ padding: '6px 8px', textAlign: 'center', borderLeft: '1px solid var(--app-border)', cursor: 'pointer', userSelect: 'none', width: 72 }} role="button" tabIndex={0} onClick={() => handleSortColumn('avg_likes')} onKeyDown={(e) => e.key === 'Enter' && handleSortColumn('avg_likes')}>
                          Posts {currentSort === 'avg_likes_desc' ? <CaretDownOutlined style={{ fontSize: 9, opacity: 1 }} /> : currentSort === 'avg_likes_asc' ? <CaretUpOutlined style={{ fontSize: 9, opacity: 1 }} /> : <CaretDownOutlined style={{ fontSize: 9, opacity: 0.45 }} />}
                        </th>
                        <th style={{ padding: '6px 8px', textAlign: 'center', borderLeft: '1px solid var(--app-border)', cursor: 'pointer', userSelect: 'none', width: 68 }} role="button" tabIndex={0} onClick={() => handleSortColumn('cost_tier')} onKeyDown={(e) => e.key === 'Enter' && handleSortColumn('cost_tier')}>
                          Preço {currentSort === 'cost_tier_desc' ? <CaretDownOutlined style={{ fontSize: 9, opacity: 1 }} /> : currentSort === 'cost_tier_asc' ? <CaretUpOutlined style={{ fontSize: 9, opacity: 1 }} /> : <CaretDownOutlined style={{ fontSize: 9, opacity: 0.45 }} />}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.map((item) => (
                        <CampaignListRow
                          key={item.key}
                          item={item}
                          onClick={() => openDetail(item.handle ?? item.key)}
                          isFavorite={user ? favoriteHandles.has((item.handle ?? item.key).toLowerCase().replace(/^@/, '')) : false}
                          onFavoriteToggle={user ? handleFavoriteToggle : undefined}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Row gutter={[8, 8]}>
                  {data.map((item) => (
                    <Col
                      key={item.key}
                      xs={24}
                      sm={12}
                      md={8}
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
          </div>
        </div>
      )}
    </div>
  )
}
