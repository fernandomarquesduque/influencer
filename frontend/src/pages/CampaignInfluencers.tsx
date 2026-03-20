/**
 * Listagem de influenciadores de uma campanha.
 * Rota: /app/campaigns/:campaignId — filtros baseados nos facets (retorno da API), igual InfluencerList.
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Row, Col, Typography, Button, Spin, Empty, Tooltip, Select, Input, Space, Modal, Tag, Alert, message, Popconfirm, Segmented, Divider } from 'antd'
import { AppstoreOutlined, UnorderedListOutlined, FilterOutlined, ClearOutlined, SearchOutlined, CaretUpOutlined, CaretDownOutlined, EditOutlined, HeartOutlined, HeartFilled, BankOutlined, DeleteOutlined } from '@ant-design/icons'
import { useAuth } from '../contexts/AuthContext'
import {
  fetchCampaignProfiles,
  fetchProfile,
  getCampaign,
  updateCampaignName,
  updateCampaignDescription,
  deleteCampaign,
  createCampaignPayment,
  payCampaignWithCredits,
  fetchFavorites,
  addFavorite,
  removeFavorite,
  getProfilePicUrl,
  getStableProfilePicUrl,
  proxyImageUrl,
  type ProfileListItem,
  type ProfilesSearchQuery,
  type ProfilesSearchFacets,
  type ProfilesSearchResponse,
  type ProfilesSort,
  type CampaignInfo,
  type MediaKind,
  fetchCampaignPostMatches,
} from '../api'
import { useCreditsOptional } from '../contexts/CreditsContext'
import { filterAndSortCampaignItems, computeFacetsFromItems } from '../utils/campaignFilterClient'
import {
  getInfluencerTierGradientCss,
  getInfluencerTierShort,
  getInfluencerTierTooltip,
} from '../utils/influencerTier'
import { CONTENT_TYPE_LABELS } from '../constants/contentTypes'
import ProfileSummaryCard from '../components/ProfileSummaryCard'
import ProfileAvatar from '../components/ProfileAvatar'
import CampaignBIPanel from '../components/CampaignBIPanel/CampaignBIPanel'
import CampaignPaymentCart from '../components/CampaignPaymentCart/CampaignPaymentCart'
import CampaignOriginGallery from '../components/CampaignOriginGallery'
import './CampaignInfluencers.css'
import { MessageOutlined, VideoCameraOutlined } from '@ant-design/icons'

const PAGE_SIZE = 100
/** Quantidade de itens exibidos inicialmente e a cada rodada de scroll (carregamento progressivo). */
const DISPLAY_PAGE_SIZE = 20
const CAMPAIGN_BI_PANEL_WIDTH_PX = 240
const CAMPAIGN_MAIN_COLUMN_GAP_PX = 24

const CAMPAIGN_ID_GUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const ORIGIN_MEDIA_KIND_ORDER: MediaKind[] = ['post', 'reel', 'tagged', 'highlight']
const ORIGIN_MEDIA_KIND_LABELS: Record<MediaKind, string> = {
  post: 'Feed',
  reel: 'Reels',
  tagged: 'Marcados',
  highlight: 'Destaques',
}
const ORIGIN_MEDIA_KIND_SET = new Set<string>(ORIGIN_MEDIA_KIND_ORDER)

function parseOriginMediaKindsParam(s: string | null): MediaKind[] | undefined {
  if (!s?.trim()) return undefined
  const arr = s
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter((x): x is MediaKind => ORIGIN_MEDIA_KIND_SET.has(x))
  return arr.length ? arr : undefined
}

function campaignQueryToUrlParams(query: Partial<ProfilesSearchQuery>): Record<string, string> {
  const params: Record<string, string> = {}
  if (query.q?.trim()) params.q = query.q.trim()
  if (query.sort) params.sort = query.sort
  if (query.sizeFilter?.length) params.sizeFilter = query.sizeFilter.join(',')
  if (query.accountTypeFilter?.length) params.accountTypeFilter = query.accountTypeFilter.map(String).join(',')
  if (query.contentTypes?.length) params.contentTypes = query.contentTypes.join(',')
  if (query.originMediaKinds?.length) params.originMediaKinds = query.originMediaKinds.join(',')
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
    sizeFilter: parseStrList(params.get('sizeFilter')),
    accountTypeFilter: parseNumList(params.get('accountTypeFilter')),
    contentTypes: parseStrList(params.get('contentTypes')),
    originMediaKinds: parseOriginMediaKindsParam(params.get('originMediaKinds')),
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

/** Uma linha compacta (modo lista tipo tabela) com dados de ativação. */
function CampaignListRow({
  item,
  onClick,
  isFavorite,
  onFavoriteToggle,
  onImageRefreshQueued,
}: {
  item: ProfileListItem
  onClick: () => void
  isFavorite?: boolean
  onFavoriteToggle?: (handle: string) => void
  onImageRefreshQueued?: (handle: string) => void
}) {
  const pic = proxyImageUrl(getProfilePicUrl(item as unknown as Record<string, unknown>))
  const stablePic = getStableProfilePicUrl(item as unknown as Record<string, unknown>)
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
        <ProfileAvatar
          src={pic}
          stableBackgroundUrl={stablePic}
          handle={handle}
          size={40}
          fallbackIconSize={20}
          onRefreshQueued={onImageRefreshQueued}
        />
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
            <Tooltip title={getInfluencerTierTooltip(followers)}>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  color: '#fff',
                  padding: '1px 5px',
                  borderRadius: 8,
                  flexShrink: 0,
                  background: getInfluencerTierGradientCss(getInfluencerTierShort(followers)),
                }}
              >
                {getInfluencerTierShort(followers)}
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
  const creditsContext = useCreditsOptional()
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT)
  const [viewMode, setViewMode] = useState<CampaignViewMode>('list')
  const effectiveViewMode: CampaignViewMode = isMobile ? 'grid' : viewMode
  const [originViewMode, setOriginViewMode] = useState<CampaignViewMode>('list')
  const effectiveOriginViewMode: CampaignViewMode = isMobile ? 'grid' : originViewMode
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
  const [pricePreview, setPricePreview] = useState<ProfilesSearchResponse['pricePreview'] | null>(null)
  const [campaignNameInput, setCampaignNameInput] = useState('')
  const [savingCampaignName, setSavingCampaignName] = useState(false)
  const [namePromptDismissed, setNamePromptDismissed] = useState(false)
  const [nameModalOpen, setNameModalOpen] = useState(false)
  const hasAutoOpenedNameModalRef = useRef(false)
  const [creatingPayment, setCreatingPayment] = useState<'pix' | 'boleto' | null>(null)
  const [boletoModalOpen, setBoletoModalOpen] = useState(false)
  const [boletoCpfValue, setBoletoCpfValue] = useState('')
  const [payingWithCredits, setPayingWithCredits] = useState(false)
  const [deletingCampaign, setDeletingCampaign] = useState(false)
  const [filteredList, setFilteredList] = useState<ProfileListItem[]>([])
  const [displayedCount, setDisplayedCount] = useState(DISPLAY_PAGE_SIZE)
  const [campaignMainTab, setCampaignMainTab] = useState<'influencers' | 'origin'>(() =>
    searchParams.get('tab') === 'influencers' ? 'influencers' : 'origin'
  )
  const [originPostKindCounts, setOriginPostKindCounts] = useState<Partial<Record<MediaKind, number>> | null>(null)
  const [searchInput, setSearchInput] = useState(() => searchParams.get('q') ?? '')
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null)
  const [favoriteHandles, setFavoriteHandles] = useState<Set<string>>(new Set())
  const [data, setData] = useState<ProfileListItem[]>([])
  const addHandleForImageUpdate = useRef<((handle: string) => void) | null>(null)
  const handlesPendingImageRef = useRef<Set<string>>(new Set())
  const imagePollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const dataRef = useRef<ProfileListItem[]>([])
  useEffect(() => {
    dataRef.current = data
  }, [data])
  const queryRef = useRef(query)
  queryRef.current = query
  const pendingLoadFromFilterRef = useRef(false)
  const buildCampaignUrlParams = useCallback(
    (nextQuery: Partial<ProfilesSearchQuery>, tab: 'influencers' | 'origin' = campaignMainTab) => {
      const params = campaignQueryToUrlParams(nextQuery)
      if (tab === 'influencers') params.tab = 'influencers'
      return params
    },
    [campaignMainTab]
  )
  useEffect(() => {
    const nextTab = searchParams.get('tab') === 'influencers' ? 'influencers' : 'origin'
    setCampaignMainTab((prev) => (prev === nextTab ? prev : nextTab))
  }, [searchParams])
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

  useEffect(() => {
    setData(filteredList.slice(0, displayedCount))
  }, [filteredList, displayedCount])

  const updateOneProfileInContext = useRef<(handle: string, profile: Record<string, unknown>) => void>(() => { })
  updateOneProfileInContext.current = (handle: string, profile: Record<string, unknown>) => {
    const h = String(handle).toLowerCase().replace(/^@/, '')
    const mergeItem = (item: ProfileListItem): ProfileListItem => {
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
    }
    setContextItems((prev) => (prev ? prev.map(mergeItem) : prev))
    setFilteredList((prev) => prev.map(mergeItem))
    setData((prev) => prev.map(mergeItem))
  }

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
      set.forEach((pendingHandle) => {
        const n = (counts.get(pendingHandle) ?? 0) + 1
        counts.set(pendingHandle, n)
        if (n > REFETCH_MAX_PER_HANDLE) {
          set.delete(pendingHandle)
          counts.delete(pendingHandle)
          return
        }
        fetchProfile(pendingHandle)
          .then((p) => {
            if (!p || typeof p !== 'object') return
            const prof = p as Record<string, unknown>
            const newPic = (prof.profile_pic_url ?? prof.hd_profile_pic_url) as string | undefined
            const dataUser = prof.data as Record<string, unknown> | undefined
            const newPicFromData = (dataUser?.user as Record<string, unknown> | undefined)?.profile_pic_url as string | undefined
            const newUrl = newPic ?? newPicFromData
            const current = dataRef.current.find((item) => String(item.key ?? item.handle ?? '').toLowerCase().replace(/^@/, '') === pendingHandle)
            const currentUser = (current?.data as Record<string, unknown> | undefined)?.user as Record<string, unknown> | undefined
            const currentUrl = (current?.profile_pic_url ?? current?.hd_profile_pic_url ?? currentUser?.profile_pic_url) as string | undefined
            updateOneProfileInContext.current(pendingHandle, prof)
            if (typeof newUrl === 'string' && newUrl !== currentUrl) {
              set.delete(pendingHandle)
              counts.delete(pendingHandle)
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

  const pendingPayment = !!campaignInfo?.pendingPayment
  const loadContext = useCallback(
    (signal?: AbortSignal, queryOverride?: Partial<ProfilesSearchQuery>) => {
      if (campaignId == null) return
      setLoading(true)
      const baseQuery = queryOverride ?? query
      const q = pendingPayment ? { ...baseQuery, limit: 10000 } : { ...defaultQuery, ...baseQuery, limit: 10000 }
      fetchCampaignProfiles(campaignId, q, { signal })
        .then((res) => {
          if (signal?.aborted) return
          if (pendingPayment) {
            const facetsFromApi = res.facets ?? null
            setFacets(facetsFromApi != null && facetsFromApi.followers_buckets && !('size_buckets' in facetsFromApi)
              ? { ...facetsFromApi, size_buckets: facetsFromApi.followers_buckets.map((b: { key: string; label: string; count: number }) => ({ key: b.key === 'medio' ? 'mid' : b.key, label: b.label, count: b.count })) }
              : facetsFromApi)
            setTotal(res.total ?? 0)
            setPricePreview(res.pricePreview ?? null)
            setContextItems([])
            setFilteredList([])
          } else {
            const facetsFromApi = res.facets ?? null
            setFacets(facetsFromApi != null && facetsFromApi.followers_buckets && !('size_buckets' in facetsFromApi)
              ? { ...facetsFromApi, size_buckets: facetsFromApi.followers_buckets.map((b: { key: string; label: string; count: number }) => ({ key: b.key === 'medio' ? 'mid' : b.key, label: b.label, count: b.count })) }
              : facetsFromApi)
            setTotal(res.total ?? 0)
            setContextItems(res.items ?? [])
            setPricePreview(null)
          }
        })
        .catch(() => {
          if (!signal?.aborted) {
            setContextItems([])
            if (pendingPayment) setFacets(null)
          }
        })
        .finally(() => {
          if (!signal?.aborted) setLoading(false)
        })
    },
    [campaignId, pendingPayment, query]
  )

  useEffect(() => {
    if (!campaignId || !user || pendingPayment) {
      setOriginPostKindCounts(null)
      return
    }
    const ac = new AbortController()
    fetchCampaignPostMatches(
      campaignId,
      { q: query.q?.trim() || undefined, limit: 0, offset: 0 },
      { signal: ac.signal }
    )
      .then((r) => {
        if (!ac.signal.aborted) setOriginPostKindCounts(r.mediaKindCounts ?? null)
      })
      .catch(() => {
        if (!ac.signal.aborted) setOriginPostKindCounts(null)
      })
    return () => ac.abort()
  }, [campaignId, user, pendingPayment, query.q])

  const updateFilter = useCallback(
    (overrides: Partial<ProfilesSearchQuery>) => {
      const newQuery = { ...query, ...overrides, offset: 0 }
      const qFromOverride = overrides.q
      const explicitQ = 'q' in overrides
      const qTrim = typeof qFromOverride === 'string' ? qFromOverride.trim() : ''
      const wordSearchApplied = explicitQ && qTrim.length > 0
      if (wordSearchApplied) setCampaignMainTab('origin')
      const tab: 'influencers' | 'origin' = wordSearchApplied ? 'origin' : campaignMainTab
      setQuery(newQuery)
      setSearchParams(buildCampaignUrlParams(newQuery, tab), { replace: true })
      if (pendingPayment) {
        pendingLoadFromFilterRef.current = true
        loadContext(undefined, newQuery)
      } else if (contextItems != null) {
        applyContextFilters(newQuery)
      }
    },
    [query, contextItems, applyContextFilters, setSearchParams, pendingPayment, loadContext, buildCampaignUrlParams, campaignMainTab]
  )

  const clearFilters = useCallback(() => {
    const newQuery = { ...defaultQuery, offset: 0 }
    setQuery(newQuery)
    setSearchParams(buildCampaignUrlParams(newQuery), { replace: true })
    if (!pendingPayment && contextItems != null) applyContextFilters(newQuery)
  }, [contextItems, applyContextFilters, setSearchParams, pendingPayment, buildCampaignUrlParams])

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
      const wordSearchApplied = (nowTrimmed?.length ?? 0) > 0
      if (wordSearchApplied) setCampaignMainTab('origin')
      const tab: 'influencers' | 'origin' = wordSearchApplied ? 'origin' : campaignMainTab
      setQuery(newQuery)
      setSearchParams(buildCampaignUrlParams(newQuery, tab), { replace: true })
      if (!pendingPayment && contextItems != null) applyContextFilters(newQuery)
    }, DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [searchInput, contextItems, applyContextFilters, setSearchParams, pendingPayment, buildCampaignUrlParams, campaignMainTab])

  useEffect(() => {
    if (campaignId == null || !user) return
    if (pendingPayment && pendingLoadFromFilterRef.current) {
      pendingLoadFromFilterRef.current = false
      return
    }
    const controller = new AbortController()
    loadContext(controller.signal)
    return () => controller.abort()
  }, [campaignId, user, loadContext, pendingPayment])

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
    if (contextItems == null || pendingPayment) return
    applyContextFilters(query)
  }, [contextItems, query, applyContextFilters, pendingPayment])

  const maxQuantity = pendingPayment
    ? Math.max(1, total > 0 ? total : (campaignInfo?.handlesCount ?? 1))
    : 1
  const creditsPaid = campaignInfo?.creditsPaid ?? campaignInfo?.credits_used ?? 0
  const unpaidQuantity = Math.max(0, maxQuantity - creditsPaid)
  const balance = creditsContext?.balance ?? 0
  const creditsToApply = pendingPayment && unpaidQuantity > 0 && balance > 0
    ? Math.min(balance, unpaidQuantity)
    : 0

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

  const refreshCampaign = useCallback(() => {
    if (!campaignId) return
    getCampaign(campaignId).then((info) => {
      setCampaignInfo(info)
    }).catch(() => { })
  }, [campaignId])

  const handleDeleteCampaign = useCallback(() => {
    if (!campaignId) return
    setDeletingCampaign(true)
    deleteCampaign(campaignId)
      .then(() => {
        message.success('Campanha excluída.')
        navigate('/app/campaigns', { replace: true })
      })
      .catch((err) => message.error(err instanceof Error ? err.message : 'Falha ao excluir'))
      .finally(() => setDeletingCampaign(false))
  }, [campaignId, navigate])

  const needsGeneratePayment = !!(
    campaignInfo?.pendingPayment &&
    (campaignInfo.pendingPayment.paymentMissing ||
      (!campaignInfo.pendingPayment.bankSlipUrl && !campaignInfo.pendingPayment.pixCopyPaste))
  )

  const handleGeneratePix = useCallback(() => {
    if (!campaignId) return
    setCreatingPayment('pix')
    createCampaignPayment(campaignId, { billingType: 'PIX', quantity: unpaidQuantity })
      .then(() => refreshCampaign())
      .catch((err) => message.error(err instanceof Error ? err.message : 'Falha ao gerar PIX'))
      .finally(() => setCreatingPayment(null))
  }, [campaignId, unpaidQuantity, refreshCampaign])

  const handleGenerateBoleto = useCallback(() => {
    if (!campaignId) return
    const cpfCnpj = boletoCpfValue.replace(/\D/g, '')
    if (cpfCnpj.length !== 11 && cpfCnpj.length !== 14) {
      message.warning('Informe CPF (11 dígitos) ou CNPJ (14 dígitos).')
      return
    }
    setCreatingPayment('boleto')
    createCampaignPayment(campaignId, { billingType: 'BOLETO', cpfCnpj, quantity: unpaidQuantity })
      .then(() => {
        setBoletoModalOpen(false)
        setBoletoCpfValue('')
        refreshCampaign()
      })
      .catch((err) => message.error(err instanceof Error ? err.message : 'Falha ao gerar boleto'))
      .finally(() => setCreatingPayment(null))
  }, [campaignId, boletoCpfValue, unpaidQuantity, refreshCampaign])

  const canPayWithCredits = !!(pendingPayment && creditsToApply > 0)

  const handlePayWithCredits = useCallback(() => {
    if (!campaignId || creditsToApply <= 0) return
    setPayingWithCredits(true)
    payCampaignWithCredits(campaignId, creditsToApply)
      .then(() => {
        message.success('Pagamento com créditos concluído. Relatório liberado!')
        refreshCampaign()
        creditsContext?.refreshCredits()
      })
      .catch((err) => message.error(err instanceof Error ? err.message : 'Falha ao pagar com créditos'))
      .finally(() => setPayingWithCredits(false))
  }, [campaignId, creditsToApply, unpaidQuantity, refreshCampaign, creditsContext])

  const openDetail = (handleOrKey: string) => {
    if (!campaignId) return
    const path = `/app/campaigns/${campaignId}/influencer/${encodeURIComponent(handleOrKey)}`
    const url = typeof window !== 'undefined' ? `${window.location.origin}${path}` : path
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const currentSort = query.sort ?? 'engagement_desc'
  type SortColumn = 'name' | 'followers' | 'engagement' | 'total_likes' | 'total_comments' | 'avg_likes' | 'favorite'
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
  const selectedOriginMediaKinds = (query.originMediaKinds ?? []) as MediaKind[]
  const selectedSizeFilter = (query.sizeFilter ?? []) as string[]
  const selectedAccountTypeFilter = (query.accountTypeFilter ?? []) as number[]
  const hasActiveFilters =
    (query.q?.trim()?.length ?? 0) > 0 ||
    selectedActivation.length > 0 ||
    selectedCities.length > 0 ||
    selectedStates.length > 0 ||
    selectedSocial.length > 0 ||
    selectedContentTypes.length > 0 ||
    selectedOriginMediaKinds.length > 0 ||
    selectedSizeFilter.length > 0 ||
    selectedAccountTypeFilter.length > 0

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
        {campaignId ? (
          <>
            <Divider style={{ margin: '20px 0 12px' }} />
            <Popconfirm
              title="Excluir campanha"
              description="Tem certeza? Esta ação não pode ser desfeita."
              onConfirm={handleDeleteCampaign}
              okText="Excluir"
              cancelText="Cancelar"
              okButtonProps={{ danger: true }}
            >
              <Button danger block icon={<DeleteOutlined />} loading={deletingCampaign}>
                Excluir campanha
              </Button>
            </Popconfirm>
          </>
        ) : null}
      </Modal>

      <Modal
        title="Gerar boleto"
        open={boletoModalOpen}
        onCancel={() => { setBoletoModalOpen(false); setBoletoCpfValue(''); }}
        footer={null}
        destroyOnClose
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
          Para gerar o boleto é necessário informar CPF ou CNPJ.
        </Typography.Paragraph>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Input
            placeholder="CPF ou CNPJ (apenas números)"
            value={boletoCpfValue}
            onChange={(e) => setBoletoCpfValue(e.target.value.replace(/\D/g, ''))}
            maxLength={14}
            size="large"
          />
          <Button
            type="primary"
            block
            size="large"
            icon={<BankOutlined />}
            loading={creatingPayment === 'boleto'}
            disabled={creatingPayment !== null || boletoCpfValue.replace(/\D/g, '').length < 11}
            onClick={handleGenerateBoleto}
          >
            Gerar boleto
          </Button>
        </Space>
      </Modal>

      <div
        style={{
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          alignItems: isMobile ? 'stretch' : 'center',
          gap: CAMPAIGN_MAIN_COLUMN_GAP_PX,
          marginBottom: 12,
          minWidth: 0,
          flexWrap: isMobile ? 'nowrap' : 'wrap',
        }}
      >
        <div
          style={{
            ...(isMobile
              ? { width: '100%', minWidth: 0 }
              : { width: CAMPAIGN_BI_PANEL_WIDTH_PX, flexShrink: 0 }),
          }}
        >
          <Typography.Title level={4} style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {campaignInfo?.name?.trim() || 'Sua campanha'}
            {campaignId && (
              <Tooltip title="Editar nome da campanha">
                <Button type="text" size="small" icon={<EditOutlined />} onClick={openNameModalForEdit} style={{ padding: '0 4px' }} />
              </Tooltip>
            )}
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 13, display: 'block' }}>
            {campaignCredits != null && <>{campaignCredits.toLocaleString('pt-BR')} créditos</>}
          </Typography.Text>
        </div>
        <div
          style={{
            ...(isMobile
              ? {
                  width: '100%',
                  minWidth: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'stretch',
                  gap: 10,
                }
              : {
                  flex: 1,
                  minWidth: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  flexWrap: 'wrap',
                }),
          }}
        >
          {!pendingPayment ? (
            <Segmented
              className={`campaign-main-tabs${isMobile ? ' campaign-main-tabs--full-width' : ''}`}
              value={campaignMainTab}
              onChange={(v) => {
                const nextTab = v as 'influencers' | 'origin'
                setCampaignMainTab(nextTab)
                setSearchParams(buildCampaignUrlParams(queryRef.current, nextTab), { replace: true })
              }}
              options={[
                { label: 'Origem (posts)', value: 'origin' },
                { label: 'Influenciadores', value: 'influencers' },
              ]}
            />
          ) : (
            <span aria-hidden style={{ width: 0, overflow: 'hidden' }} />
          )}
          <div
            style={{
              display: 'flex',
              flexDirection: isMobile ? 'column' : 'row',
              alignItems: isMobile ? 'stretch' : 'center',
              gap: 8,
              flexWrap: isMobile ? 'nowrap' : 'wrap',
              width: isMobile ? '100%' : undefined,
              minWidth: 0,
            }}
          >
            <Button
              type="primary"
              onClick={() => navigate('/app/campaigns')}
              style={{
                ...(isMobile ? { width: '100%' } : {}),
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
                ...(isMobile ? { width: '100%' } : {}),
                background: 'linear-gradient(135deg, #0891b2 0%, #0e7490 100%)',
                border: 'none',
                boxShadow: '0 2px 8px rgba(8, 145, 178, 0.35)',
              }}
            >
              Nova busca
            </Button>
          </div>
        </div>
      </div>

      {facets == null && loading ? (
        <div style={{ textAlign: 'center', padding: 16 }}>
          <Spin size="small" />
        </div>
      ) : facets == null && !loading && !campaignInfo?.pendingPayment ? (
        <Empty description="Nenhum perfil nesta campanha." />
      ) : facets == null && !loading && campaignInfo?.pendingPayment ? (
        <div style={{ textAlign: 'center', padding: 16 }}>
          <Spin size="small" />
          <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8 }}>Carregando filtros e valor...</Typography.Text>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: CAMPAIGN_MAIN_COLUMN_GAP_PX, alignItems: 'flex-start', minWidth: 0 }}>
          {!isMobile && (
            <div style={{ flexShrink: 0, width: CAMPAIGN_BI_PANEL_WIDTH_PX, minWidth: 0 }}>
              <CampaignBIPanel
                items={filteredList}
                facets={facets}
                loading={loading}
                query={query}
                onFilter={updateFilter}
                description={campaignInfo?.description ?? null}
                onDescriptionSave={pendingPayment ? undefined : handleDescriptionSave}
                expiresAt={campaignInfo?.expires_at ?? null}
                createdAt={campaignInfo?.created_at ?? null}
                statsOverride={pendingPayment && pricePreview && typeof pricePreview.totalLikes === 'number' ? {
                  totalLikes: pricePreview.totalLikes ?? 0,
                  totalComments: pricePreview.totalComments ?? 0,
                  totalViews: pricePreview.totalViews ?? 0,
                  totalFollowers: pricePreview.totalFollowers ?? 0,
                  postsCount: pricePreview.postsCount ?? 0,
                  avgEngagementRate: pricePreview.avgEngagementRate ?? 0,
                  count: total > 0 ? total : (campaignInfo?.handlesCount ?? 0),
                } : undefined}
                originMediaKindCounts={originPostKindCounts}
              />
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            {pendingPayment ? (
              <>
                <Alert
                  type="warning"
                  message="Pagamento pendente"
                  showIcon
                  style={{ marginBottom: 10, width: '100%', fontSize: 12 }}
                />
                <CampaignPaymentCart
                  query={query}
                  facets={facets}
                  onFilter={updateFilter}
                  valueTotal={(() => {
                    const baseValue = (pricePreview?.valueBrl ?? campaignInfo?.pendingPayment?.valueBrl) ?? 0
                    const totalFiltered = Math.max(1, total)
                    return totalFiltered > 0 ? Math.floor((baseValue / totalFiltered) * maxQuantity) : 0
                  })()}
                  maxQuantity={maxQuantity}
                  canPayWithCredits={canPayWithCredits}
                  creditsToApply={creditsToApply}
                  pendingPayment={campaignInfo?.pendingPayment ?? null}
                  needsGeneratePayment={needsGeneratePayment}
                  payingWithCredits={payingWithCredits}
                  creatingPayment={creatingPayment}
                  onPayWithCredits={handlePayWithCredits}
                  onGeneratePix={handleGeneratePix}
                  onOpenBoletoModal={() => setBoletoModalOpen(true)}
                />
              </>
            ) : (
              <>
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
                    {!isMobile && (campaignMainTab === 'influencers' || campaignMainTab === 'origin') && (
                      <div
                        className="campaign-instagram-view-toggle"
                        role="group"
                        aria-label="Lista ou grade"
                      >
                        <Tooltip title="Lista">
                          <button
                            type="button"
                            className={`campaign-instagram-view-toggle-btn${(campaignMainTab === 'influencers' ? viewMode : originViewMode) === 'list' ? ' is-active' : ''}`}
                            onClick={() =>
                              campaignMainTab === 'influencers' ? setViewMode('list') : setOriginViewMode('list')
                            }
                          >
                            <UnorderedListOutlined />
                          </button>
                        </Tooltip>
                        <Tooltip title="Grade (como no Instagram)">
                          <button
                            type="button"
                            className={`campaign-instagram-view-toggle-btn${(campaignMainTab === 'influencers' ? viewMode : originViewMode) === 'grid' ? ' is-active' : ''}`}
                            onClick={() =>
                              campaignMainTab === 'influencers' ? setViewMode('grid') : setOriginViewMode('grid')
                            }
                          >
                            <AppstoreOutlined />
                          </button>
                        </Tooltip>
                      </div>
                    )}
                  </div>
                </div>
                {campaignMainTab === 'origin' && campaignId ? (
                  <CampaignOriginGallery
                    campaignId={campaignId}
                    viewMode={effectiveOriginViewMode}
                    textQuery={
                      query.q?.trim() ||
                      (typeof campaignInfo?.savedQuery?.q === 'string' ? campaignInfo.savedQuery.q.trim() : '')
                    }
                    mediaKinds={selectedOriginMediaKinds.length ? selectedOriginMediaKinds : undefined}
                  />
                ) : (
                  <>
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
                        {campaignMainTab === 'origin' &&
                          originPostKindCounts &&
                          ORIGIN_MEDIA_KIND_ORDER.some((k) => (originPostKindCounts[k] ?? 0) > 0) && (
                            <Select
                              mode="multiple"
                              size="small"
                              placeholder="Tipo post"
                              allowClear
                              value={selectedOriginMediaKinds.length ? selectedOriginMediaKinds : undefined}
                              options={ORIGIN_MEDIA_KIND_ORDER.filter((k) => (originPostKindCounts[k] ?? 0) > 0).map(
                                (k) => ({
                                  value: k,
                                  label: `${ORIGIN_MEDIA_KIND_LABELS[k]} (${originPostKindCounts[k]})`,
                                })
                              )}
                              onChange={(vals) =>
                                updateFilter({ originMediaKinds: vals?.length ? (vals as MediaKind[]) : undefined })
                              }
                              style={{ width: 150 }}
                              maxTagCount={1}
                            />
                          )}
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
                                  onImageRefreshQueued={(handle) => addHandleForImageUpdate.current?.(handle)}
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
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
