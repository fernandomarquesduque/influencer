/**
 * Listagem de influenciadores de uma campanha.
 * Rota: /app/campaigns/:campaignId — filtros baseados nos facets (retorno da API), igual InfluencerList.
 */
import { useEffect, useState, useCallback, useRef, useMemo, type CSSProperties } from 'react'
import { useNavigate, useParams, useSearchParams, useLocation } from 'react-router-dom'
import { Row, Col, Typography, Button, Spin, Empty, Tooltip, Select, Input, Space, Modal, message, Segmented, Dropdown } from 'antd'
import type { MenuProps } from 'antd'
import { AppstoreOutlined, UnorderedListOutlined, FilterOutlined, ClearOutlined, SearchOutlined, CaretUpOutlined, CaretDownOutlined, EditOutlined, HeartOutlined, HeartFilled, DownOutlined, ArrowLeftOutlined } from '@ant-design/icons'
import { useAuth } from '../contexts/AuthContext'
import { isSearchRoute as checkIsSearchRoute, isSearchLandingHome } from '../constants/searchRoute'
import {
  fetchCampaignProfiles,
  fetchProfile,
  getCampaign,
  updateCampaignName,
  updateCampaignDescription,
  deleteCampaign,
  payCampaignWithCredits,
  fetchMyPendingPayment,
  fetchCampaignPostSearchHandles,
  isPublicSearchLimitError,
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
  type CreatePaymentForCreditsResponse,
  type MediaKind,
  type PostItem,
  profileFiltersForCampaignPostApis,
} from '../api'
import { useCreditsOptional } from '../contexts/CreditsContext'
import {
  filterAndSortCampaignItems,
  computeFacetsFromItems,
  filterFacetsForDisplay,
  profileListItemsFromOriginPosts,
  campaignContextFetchQueryKey,
  isCampaignFacetBoostOnlyPatch,
  isCampaignGalleryUiOnlyPatch,
  hasCampaignFacetBoost,
  pickCampaignFacetBoostFromQuery,
  normalizeSingleSelectFacetBoost,
  isOriginPostSort,
  stripCampaignFacetBoostFromQuery,
  buildSingleCampaignFacetBoostPatch,
} from '../utils/campaignFilterClient'
import { getLlmDescriptionLine } from '../utils/mapProfileListToPreviewItems'
import { campaignLlmBadgeStyles, getLlmContentPillarLabels, getLlmGenderBadge, getLlmMainCategoryLabel, getLlmProfileTypeBadge } from '../utils/campaignLlmBadges'
import InfluencerTierPill from '../components/InfluencerTierPill'
import { CONTENT_TYPE_LABELS } from '../constants/contentTypes'
import ProfileSummaryCard from '../components/ProfileSummaryCard'
import ProfileAvatar from '../components/ProfileAvatar'
import CampaignBIPanel from '../components/CampaignBIPanel/CampaignBIPanel'
import CampaignPaymentCart from '../components/CampaignPaymentCart/CampaignPaymentCart'
import BuyCreditsModal from '../components/BuyCreditsModal/BuyCreditsModal'
import CampaignOriginGallery, { OriginGalleryLoadingState } from '../components/CampaignOriginGallery'
import InfluencerConnectModal, {
  type InfluencerConnectSnapshot,
} from '../components/InfluencerConnectModal/InfluencerConnectModal'
import InfluencerDetailModal from '../components/InfluencerDetailModal/InfluencerDetailModal'
import { DiscoveryHomeHero } from '../components/DiscoveryHomeHero'
import './CampaignInfluencers.css'
import { MessageOutlined, VideoCameraOutlined } from '@ant-design/icons'

const PAGE_SIZE = 100
/** Quantidade de itens exibidos inicialmente e a cada rodada de scroll (carregamento progressivo). */
const DISPLAY_PAGE_SIZE = 20
const CAMPAIGN_BI_PANEL_WIDTH_PX = 240
const CAMPAIGN_MAIN_COLUMN_GAP_PX = 24

const CAMPAIGN_ID_GUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const ORIGIN_MEDIA_KIND_SET = new Set<string>(['post', 'reel', 'tagged', 'highlight'])

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
  if (query.originPostSort) params.originPostSort = query.originPostSort
  if (query.cities?.length) params.cities = query.cities.join(',')
  if (query.states?.length) params.states = query.states.join(',')
  if (query.socialNetworks?.length) params.socialNetworks = query.socialNetworks.join(',')
  if (query.llmProfileType?.length) params.llmProfileType = query.llmProfileType.join(',')
  if (query.llmMainCategory?.length) params.llmMainCategory = query.llmMainCategory.join(',')
  if (query.llmGender?.length) params.llmGender = query.llmGender.join(',')
  if (query.llmSubCategories?.length) params.llmSubCategories = query.llmSubCategories.join(',')
  if (query.llmContentPillars?.length) params.llmContentPillars = query.llmContentPillars.join(',')
  if (query.llmAudienceType?.length) params.llmAudienceType = query.llmAudienceType.join(',')
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
  const parseSingleStr = (s: string | null): string[] | undefined => {
    const arr = parseStrList(s)
    return arr?.length ? [arr[0]!] : undefined
  }
  const parseSingleNum = (s: string | null): number[] | undefined => {
    const arr = parseNumList(s)
    return arr?.length ? [arr[0]!] : undefined
  }
  return {
    q: params.get('q')?.trim() || undefined,
    sort:
      (params.get('sort') as ProfilesSort) ||
      (params.get('q')?.trim() ? ('relevance_desc' as ProfilesSort) : undefined),
    sizeFilter: parseSingleStr(params.get('sizeFilter')),
    accountTypeFilter: parseSingleNum(params.get('accountTypeFilter')),
    contentTypes: parseSingleStr(params.get('contentTypes')),
    originMediaKinds: parseOriginMediaKindsParam(params.get('originMediaKinds')),
    originPostSort: (() => {
      const raw = params.get('originPostSort')
      return isOriginPostSort(raw) ? raw : undefined
    })(),
    cities: parseSingleStr(params.get('cities')),
    states: parseSingleStr(params.get('states')),
    socialNetworks: parseSingleStr(params.get('socialNetworks')),
    llmProfileType: parseSingleStr(params.get('llmProfileType')),
    llmMainCategory: parseSingleStr(params.get('llmMainCategory')),
    llmGender: parseSingleStr(params.get('llmGender')),
    llmSubCategories: parseStrList(params.get('llmSubCategories')),
    llmContentPillars: parseStrList(params.get('llmContentPillars')),
    llmAudienceType: parseSingleStr(params.get('llmAudienceType')),
    offset: params.has('offset') ? Number(params.get('offset')) : undefined,
  }
}

/** Busca por legenda: só `q` na URL (sem filtros/ordenação legados no hash). */
function wordSearchUrlLocation(q: string, options?: { tab?: string }): { search: string; hash: string } {
  const params = new URLSearchParams()
  const trimmed = q.trim()
  if (trimmed) params.set('q', trimmed)
  if (options?.tab) params.set('tab', options.tab)
  const qs = params.toString()
  return { search: qs ? `?${qs}` : '', hash: '' }
}

/** Query + hash (#q=...) — hash sobrescreve query na mesma chave. */
function getMergedUrlParams(location: { search: string; hash: string }): URLSearchParams {
  const merged = new URLSearchParams()
  const qs = location.search?.replace(/^\?/, '').trim()
  if (qs) {
    new URLSearchParams(qs).forEach((v, k) => merged.set(k, v))
  }
  const hash = location.hash?.trim().replace(/^#/, '') || ''
  if (hash) {
    new URLSearchParams(hash).forEach((v, k) => merged.set(k, v))
  }
  return merged
}

/** Números inteiros completos na coluna de métricas da lista (sem k/M). */
function formatCampaignListMetricInt(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return '0'
  return Math.round(n).toLocaleString('pt-BR')
}

/** Média de likes/post com separador pt-BR, sem abreviar. */
function formatCampaignListAvgLikes(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return '0'
  const x = Math.round(n * 100) / 100
  return x.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

function normalizeCampaignListHandle(raw: string): string {
  return (raw ?? '').replace(/^@/, '').trim().toLowerCase()
}

function profileItemToConnectSnapshot(item: ProfileListItem): InfluencerConnectSnapshot {
  const h = (item.profile_ref ?? '').trim()
  const er = item.engagement?.engagement_rate
  return {
    displayName: item.full_name?.trim() || h,
    profilePicUrl: getProfilePicUrl(item as Record<string, unknown>),
    stableProfilePicUrl: getStableProfilePicUrl(item as Record<string, unknown>),
    followersCount: item.followers_count,
    engagementRatePercent: typeof er === 'number' && Number.isFinite(er) ? er : undefined,
  }
}

const CAMPAIGN_LIST_METRIC_SORT_KEYS = new Set<ProfilesSort>([
  'followers_desc',
  'followers_asc',
  'engagement_desc',
  'engagement_asc',
  'total_likes_desc',
  'total_likes_asc',
  'total_comments_desc',
  'total_comments_asc',
  'avg_likes_desc',
  'avg_likes_asc',
])

function isCampaignListMetricSort(s: ProfilesSort): boolean {
  return CAMPAIGN_LIST_METRIC_SORT_KEYS.has(s)
}

/** Menu suspenso: escolher critério e direção da ordenação das métricas na lista. */
const CAMPAIGN_LIST_METRICS_SORT_MENU_ITEMS: MenuProps['items'] = [
  {
    key: 'grp-seg',
    label: 'Seguidores',
    type: 'group',
    children: [
      { key: 'followers_desc', label: 'Maior primeiro' },
      { key: 'followers_asc', label: 'Menor primeiro' },
    ],
  },
  {
    key: 'grp-eng',
    label: 'Engajamento',
    type: 'group',
    children: [
      { key: 'engagement_desc', label: 'Maior primeiro' },
      { key: 'engagement_asc', label: 'Menor primeiro' },
    ],
  },
  {
    key: 'grp-like',
    label: 'Curtidas',
    type: 'group',
    children: [
      { key: 'total_likes_desc', label: 'Maior primeiro' },
      { key: 'total_likes_asc', label: 'Menor primeiro' },
    ],
  },
  {
    key: 'grp-com',
    label: 'Comentários',
    type: 'group',
    children: [
      { key: 'total_comments_desc', label: 'Maior primeiro' },
      { key: 'total_comments_asc', label: 'Menor primeiro' },
    ],
  },
  {
    key: 'grp-post',
    label: 'Média likes / post',
    type: 'group',
    children: [
      { key: 'avg_likes_desc', label: 'Maior primeiro' },
      { key: 'avg_likes_asc', label: 'Menor primeiro' },
    ],
  },
]

function campaignListMetricSortSummary(sort: ProfilesSort): string {
  const map: Partial<Record<ProfilesSort, string>> = {
    followers_desc: 'Seguidores, maior primeiro',
    followers_asc: 'Seguidores, menor primeiro',
    engagement_desc: 'Engajamento, maior primeiro',
    engagement_asc: 'Engajamento, menor primeiro',
    total_likes_desc: 'Curtidas, maior primeiro',
    total_likes_asc: 'Curtidas, menor primeiro',
    total_comments_desc: 'Comentários, maior primeiro',
    total_comments_asc: 'Comentários, menor primeiro',
    avg_likes_desc: 'Média likes por post, maior primeiro',
    avg_likes_asc: 'Média likes por post, menor primeiro',
  }
  return map[sort] ?? 'Escolher ordenação'
}

function campaignListEngagementColor(rate: number): string {
  if (rate > 70) return 'var(--app-rate-high)'
  if (rate > 40) return 'var(--app-rate-mid)'
  return 'var(--app-rate-low)'
}

/** Uma linha compacta (modo lista tipo tabela) com dados de ativação. */
function CampaignListRow({
  item,
  onClick,
  isFavorite,
  onFavoriteToggle,
  onImageRefreshQueued,
  showFavoriteColumn = true,
}: {
  item: ProfileListItem
  onClick: () => void
  isFavorite?: boolean
  onFavoriteToggle?: (handle: string) => void
  onImageRefreshQueued?: (handle: string) => void
  showFavoriteColumn?: boolean
}) {
  const pic = proxyImageUrl(getProfilePicUrl(item as unknown as Record<string, unknown>))
  const stablePic = getStableProfilePicUrl(item as unknown as Record<string, unknown>)
  const name = (item.full_name || 'Influenciador') as string
  const profileRef = (item.profile_ref ?? '').trim()
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
  const llmRow = getLlmDescriptionLine(item)
  const profileTypeBadge = getLlmProfileTypeBadge(item)
  const genderBadge = getLlmGenderBadge(item)
  return (
    <tr
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      className="campaign-list-row"
      style={{ cursor: 'pointer', background: 'var(--app-bg)', transition: 'background 0.15s' }}
    >
      <td
        className="campaign-list-cell campaign-list-fav-avatar-td"
        style={{
          verticalAlign: 'top',
          textAlign: 'center',
          width: 92,
          minWidth: 92,
          padding: '6px 6px 4px',
        }}
      >
        <div className="campaign-list-fav-col-stack" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 0, marginTop: 8 }}>
          <div
            style={{
              position: 'relative',
              width: 40,
              height: 40,
              flexShrink: 0,
            }}
          >
            <ProfileAvatar
              src={pic}
              stableBackgroundUrl={stablePic}
              handle={profileRef}
              size={40}
              fallbackIconSize={20}
              onRefreshQueued={onImageRefreshQueued}
            />
            {showFavoriteColumn && onFavoriteToggle != null ? (
              <Tooltip title={isFavorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}>
                <div
                  className="campaign-list-fav-on-avatar"
                  role="button"
                  tabIndex={0}
                  aria-label={isFavorite ? 'Remover dos favoritos' : 'Favoritar'}
                  style={{
                    position: 'absolute',
                    top: -14,
                    left: -10,
                    zIndex: 3,
                    lineHeight: 0,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'flex-start',
                    justifyContent: 'flex-start',
                    padding: '4px 18px 18px 4px',
                    minWidth: 40,
                    minHeight: 40,
                    boxSizing: 'content-box',
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    onFavoriteToggle(profileRef)
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      e.stopPropagation()
                      onFavoriteToggle(profileRef)
                    }
                  }}
                >
                  {isFavorite ? (
                    <HeartFilled style={{ color: 'var(--app-primary)', fontSize: 15 }} />
                  ) : (
                    <HeartOutlined style={{ color: 'var(--app-text-secondary)', fontSize: 15 }} />
                  )}
                </div>
              </Tooltip>
            ) : null}
          </div>
          <InfluencerTierPill followers={followers} />
          {(profileTypeBadge || genderBadge) ? (
            <div
              className="campaign-list-fav-col-llm-badges"
            >
              {profileTypeBadge ? (() => {
                const st = campaignLlmBadgeStyles(profileTypeBadge.text)
                return (
                  <Tooltip key="tipo" title={profileTypeBadge.title}>
                    <span
                      className="campaign-list-llm-badge"
                      style={{ border: st.border, color: st.color, background: st.background }}
                    >
                      {profileTypeBadge.text}
                    </span>
                  </Tooltip>
                )
              })() : null}
              {genderBadge ? (() => {
                const st = campaignLlmBadgeStyles(genderBadge.text)
                return (
                  <Tooltip key="gender" title={genderBadge.title}>
                    <span
                      className="campaign-list-llm-badge"
                      style={{ border: st.border, color: st.color, background: st.background }}
                    >
                      {genderBadge.text}
                    </span>
                  </Tooltip>
                )
              })() : null}
            </div>
          ) : null}
        </div>
      </td>
      <td className="campaign-list-profile-cell" style={{ verticalAlign: 'top', padding: '6px 8px 6px 4px', width: '100%', minWidth: 0, textAlign: 'left' }}>
        <div style={{ position: 'relative', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              minWidth: 0,
              flexWrap: 'wrap',
              width: '100%',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'baseline',
                gap: 8,
                minWidth: 0,
                flex: '1 1 160px',
                flexWrap: 'wrap',
              }}
            >
              <Tooltip title={name}>
                <div
                  className="campaign-list-profile-name"
                  style={{ fontWeight: 600, fontSize: 14, color: 'var(--app-text)', lineHeight: 1.35, wordBreak: 'break-word', minWidth: 0 }}
                >
                  {name}
                </div>
              </Tooltip>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, fontSize: 14, paddingTop: 2 }}>
              {hasWhatsApp && <Tooltip title="WhatsApp"><MessageOutlined style={{ color: 'var(--app-icon-whatsapp, #25D366)' }} /></Tooltip>}
              {hasTiktok && <Tooltip title="TikTok"><VideoCameraOutlined style={{ color: 'var(--app-text-secondary)' }} /></Tooltip>}
            </div>
          </div>
          {(() => {
            const catLabel = getLlmMainCategoryLabel(item)
            const pillarLabels = getLlmContentPillarLabels(item)
            if (!catLabel && pillarLabels.length === 0) return null
            return (
              <div className="campaign-list-llm-badges" style={{ marginTop: 2 }}>
                {catLabel ? (
                  <Tooltip title="Categoria principal">
                    <span
                      className="campaign-list-llm-badge"
                      style={campaignLlmBadgeStyles(catLabel)}
                    >
                      {catLabel}
                    </span>
                  </Tooltip>
                ) : null}
                {pillarLabels.map((pillar) => (
                  <Tooltip key={pillar} title="Pilar de conteúdo">
                    <span className="campaign-list-llm-badge" style={campaignLlmBadgeStyles(pillar)}>
                      {pillar}
                    </span>
                  </Tooltip>
                ))}
              </div>
            )
          })()}
          {llmRow ? (
            <Tooltip title={llmRow.tooltip ?? llmRow.line}>
              <div className="campaign-list-llm-line">{llmRow.line}</div>
            </Tooltip>
          ) : null}
          {location && (
            <Tooltip title={location}>
              <div className="campaign-list-profile-location" style={{ fontSize: 11, color: 'var(--app-text-secondary)', lineHeight: 1.4, wordBreak: 'break-word' }}>
                {location}
              </div>
            </Tooltip>
          )}
        </div>
      </td>
      <td
        className="campaign-list-cell campaign-list-cell-border campaign-list-metrics-cell"
        style={{ textAlign: 'right', padding: '4px 6px', verticalAlign: 'top', whiteSpace: 'nowrap', minWidth: 'max-content' }}
      >
        <div className="campaign-list-metrics-panel">
          <div className="campaign-list-metrics-stack">
            <div
              className="campaign-list-metrics-row campaign-list-metrics-row--engagement"
              style={{ '--campaign-list-eng-accent': campaignListEngagementColor(engagementRate) } as CSSProperties}
            >
              <span className="campaign-list-metrics-label">Engajamento</span>
              <span className="campaign-list-metrics-value campaign-list-metrics-value--engagement" style={{ color: campaignListEngagementColor(engagementRate) }}>
                {engagementRate.toFixed(1)}%
              </span>
            </div>
            <div className="campaign-list-metrics-row">
              <span className="campaign-list-metrics-label">Seguidores</span>
              <span className="campaign-list-metrics-value">{formatCampaignListMetricInt(followers)}</span>
            </div>
            <div className="campaign-list-metrics-row">
              <span className="campaign-list-metrics-label">Curtidas</span>
              <span className="campaign-list-metrics-value">{formatCampaignListMetricInt(totalLikes)}</span>
            </div>
            <div className="campaign-list-metrics-row">
              <span className="campaign-list-metrics-label">Comentários</span>
              <span className="campaign-list-metrics-value campaign-list-metrics-value--muted">{formatCampaignListMetricInt(totalComments)}</span>
            </div>
            <div className="campaign-list-metrics-row">
              <span className="campaign-list-metrics-label">Likes por post</span>
              <span className="campaign-list-metrics-value campaign-list-metrics-value--muted">{formatCampaignListAvgLikes(avgLikes)}</span>
            </div>
          </div>
        </div>
      </td>
    </tr>
  )
}

export type CampaignViewMode = 'list' | 'grid'

const defaultQuery: Partial<ProfilesSearchQuery> = {
  limit: PAGE_SIZE,
  offset: 0,
}

const MOBILE_BREAKPOINT = 768

const ALL_CAMPAIGNS_SLUG = 'all'

/** Evita rajada de post-matches/handlesOnly ao mudar URL ou filtros; ainda alinha com a galeria Origem. */
const POST_CAPTION_SEARCH_DEBOUNCE_MS = 280

export default function CampaignInfluencers() {
  const { campaignId: campaignIdParam } = useParams<{ campaignId: string }>()
  const location = useLocation()
  const [, setSearchParams] = useSearchParams()
  const urlParams = useMemo(() => getMergedUrlParams(location), [location.search, location.hash])
  const isSearchRoute = checkIsSearchRoute(location.pathname)
  const isSearchLanding = isSearchLandingHome(location.pathname, location.search, location.hash)
  const isAllCampaignsView =
    isSearchRoute ||
    (campaignIdParam != null && campaignIdParam.trim().toLowerCase() === ALL_CAMPAIGNS_SLUG)
  const campaignId = isAllCampaignsView
    ? ALL_CAMPAIGNS_SLUG
    : campaignIdParam != null && CAMPAIGN_ID_GUID_REGEX.test(campaignIdParam.trim())
      ? campaignIdParam.trim()
      : null
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const showFavoriteColumn = !!user && user.scope !== 'influencer'
  const creditsContext = useCreditsOptional()
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT)
  const [viewMode, setViewMode] = useState<CampaignViewMode>('list')
  const effectiveViewMode: CampaignViewMode = isMobile ? 'list' : viewMode
  const [originViewMode, setOriginViewMode] = useState<CampaignViewMode>('list')
  const effectiveOriginViewMode: CampaignViewMode = isMobile ? 'list' : originViewMode
  const [query, setQuery] = useState<Partial<ProfilesSearchQuery>>(() => ({
    ...defaultQuery,
    ...urlParamsToCampaignQuery(urlParams),
  }))
  /** Filtros de perfil estáveis (sem prioridade de facet na URL) — legenda não estreita por porte/LLM. */
  const postMatchProfileFiltersKey = useMemo(() => {
    const stripped = stripCampaignFacetBoostFromQuery({
      ...defaultQuery,
      ...urlParamsToCampaignQuery(urlParams),
    })
    return JSON.stringify(profileFiltersForCampaignPostApis(stripped))
  }, [urlParams.toString()])
  const postMatchProfileFilters = useMemo(
    () => JSON.parse(postMatchProfileFiltersKey) as Partial<ProfilesSearchQuery>,
    [postMatchProfileFiltersKey]
  )
  const postMatchFacetBoostKey = useMemo(() => {
    if (!hasCampaignFacetBoost(query)) return ''
    return JSON.stringify(pickCampaignFacetBoostFromQuery(query))
  }, [
    query.sizeFilter,
    query.llmMainCategory,
    query.llmGender,
    query.llmAudienceType,
    query.llmProfileType,
    query.engagementRateBuckets,
    query.avgLikesBuckets,
    query.postsCountBuckets,
  ])
  const [facets, setFacets] = useState<ProfilesSearchFacets | null>(null)
  /** Facets só dos posts carregados na busca por legenda (aba Origem). */
  const [searchFacets, setSearchFacets] = useState<ProfilesSearchFacets | null>(null)
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
  const [buyCreditsModalOpen, setBuyCreditsModalOpen] = useState(false)
  const [buyCreditsResume, setBuyCreditsResume] = useState<CreatePaymentForCreditsResponse | null>(null)
  const [signupGateModalOpen, setSignupGateModalOpen] = useState(false)
  const [connectModal, setConnectModal] = useState<{
    handle: string
    snapshot?: InfluencerConnectSnapshot
  } | null>(null)
  const [profileDetailRef, setProfileDetailRef] = useState<string | null>(null)
  const [payingWithCredits, setPayingWithCredits] = useState(false)
  const [deletingCampaign, setDeletingCampaign] = useState(false)
  const [filteredList, setFilteredList] = useState<ProfileListItem[]>([])
  /** Com `q` preenchido: handles com post que casa com o termo (API post-matches), alinhado à aba Origem. */
  const [postCaptionSearch, setPostCaptionSearch] = useState<{
    qKey: string
    handles: Set<string>
    totalPosts: number
  } | null>(null)
  const [postCaptionSearchLoading, setPostCaptionSearchLoading] = useState(false)
  const [displayedCount, setDisplayedCount] = useState(DISPLAY_PAGE_SIZE)
  const [loadingMore, setLoadingMore] = useState(false)
  const [campaignMainTab, setCampaignMainTab] = useState<'influencers' | 'origin'>(() => {
    const tab = urlParams.get('tab')
    if (isAllCampaignsView) {
      return tab === 'influencers' ? 'influencers' : 'origin'
    }
    return tab === 'origin' ? 'origin' : 'influencers'
  })
  /** Aba Posts com termo: esconder coluna de filtros enquanto a galeria carrega a primeira página. */
  const [originGallerySearchLoading, setOriginGallerySearchLoading] = useState(false)
  /** Aba Posts com termo: após carregar, sem posts — esconder painel BI à esquerda. */
  const [originSearchSettledEmpty, setOriginSearchSettledEmpty] = useState(false)
  /** Aba Posts: cota horária ou 429 — esconder lateral e centralizar empty state. */
  const [originSearchLimited, setOriginSearchLimited] = useState(false)
  const [searchInput, setSearchInput] = useState(() => urlParams.get('q') ?? '')
  /** Incrementado quando a top bar reenvia a mesma busca (URL igual). */
  const [searchRefreshToken, setSearchRefreshToken] = useState(0)
  const lastTopBarSearchSubmitRef = useRef<number | null>(null)
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
  const campaignMainTabRef = useRef(campaignMainTab)
  campaignMainTabRef.current = campaignMainTab
  const pendingLoadFromFilterRef = useRef(false)
  const contextFetchQueryKey = useMemo(
    () =>
      campaignContextFetchQueryKey({
        ...defaultQuery,
        ...urlParamsToCampaignQuery(urlParams),
      }),
    [urlParams.toString()]
  )
  const captionSearchQ = urlParams.get('q')?.trim() ?? ''
  const hasActiveSearchQ = captionSearchQ.length > 0
  /** Na busca por legenda: só facets dos posts carregados — nunca os da campanha inteira. */
  const displayFacets = useMemo(() => {
    if (hasActiveSearchQ) return searchFacets
    return facets
  }, [hasActiveSearchQ, searchFacets, facets])
  const buildCampaignUrlParams = useCallback(
    (nextQuery: Partial<ProfilesSearchQuery>, tab: 'influencers' | 'origin' = campaignMainTab) => {
      const params = campaignQueryToUrlParams(nextQuery)
      if (isAllCampaignsView) {
        if (tab === 'influencers') params.tab = 'influencers'
      } else if (tab === 'origin') {
        params.tab = 'origin'
      }
      return params
    },
    [campaignMainTab, isAllCampaignsView]
  )
  useEffect(() => {
    const tab = urlParams.get('tab')
    const nextTab = isAllCampaignsView
      ? tab === 'influencers'
        ? 'influencers'
        : 'origin'
      : tab === 'origin'
        ? 'origin'
        : 'influencers'
    setCampaignMainTab((prev) => (prev === nextTab ? prev : nextTab))
  }, [urlParams, isAllCampaignsView])
  useEffect(() => {
    if (campaignMainTab !== 'origin' || !query.q?.trim()) {
      setOriginGallerySearchLoading(false)
    }
  }, [campaignMainTab, query.q])
  useEffect(() => {
    if (!user || user.scope === 'influencer') {
      setFavoriteHandles(new Set())
      return
    }
    fetchFavorites()
      .then((res) => {
        if (campaignId === ALL_CAMPAIGNS_SLUG) {
          setFavoriteHandles(new Set((res.profile_refs ?? res.favorites?.map((f) => f.profile_ref) ?? []).map((r) => r.trim()).filter(Boolean)))
          return
        }
        // Na tela de campanha, considerar só favoritos desta campanha para o estado "selecionado"
        if (campaignId && (res.favorites?.length ?? 0) > 0) {
          const forCampaign = (res.favorites ?? []).filter((f) => f.campaignId === campaignId).map((f) => f.profile_ref.trim())
          setFavoriteHandles(new Set(forCampaign))
        } else {
          setFavoriteHandles(new Set((res.profile_refs ?? res.favorites?.map((f) => f.profile_ref) ?? []).map((r) => r.trim()).filter(Boolean)))
        }
      })
      .catch(() => setFavoriteHandles(new Set()))
  }, [user?.id, user?.scope, campaignId])

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
      if (campaignId === ALL_CAMPAIGNS_SLUG) {
        if (isFav) await removeFavorite(handle)
        else await addFavorite(handle)
      } else if (isFav) {
        await removeFavorite(handle, campaignId ? { campaignId } : undefined)
      } else {
        await addFavorite(handle, { campaignId: campaignId ?? undefined })
      }
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

  const applySearchFacets = useCallback((next: ProfilesSearchFacets | null) => {
    setSearchFacets(next)
  }, [])

  const handleOriginPostsForFacets = useCallback(
    (posts: PostItem[]) => {
      if (!urlParams.get('q')?.trim()) return
      if (posts.length === 0) return
      const items = profileListItemsFromOriginPosts(posts)
      applySearchFacets(filterFacetsForDisplay(computeFacetsFromItems(items)))
    },
    [applySearchFacets, urlParams]
  )

  /** Aba Perfis + busca por legenda: facetas só dos perfis listados (não da campanha inteira). */
  useEffect(() => {
    if (!hasActiveSearchQ || campaignMainTab !== 'influencers') return
    if (postCaptionSearchLoading) return
    const captionQ = captionSearchQ
    if (!postCaptionSearch || postCaptionSearch.qKey !== captionQ) return
    if (filteredList.length === 0) return
    applySearchFacets(filterFacetsForDisplay(computeFacetsFromItems(filteredList)))
  }, [
    hasActiveSearchQ,
    campaignMainTab,
    filteredList,
    postCaptionSearchLoading,
    postCaptionSearch,
    captionSearchQ,
    applySearchFacets,
  ])

  const applyContextFilters = useCallback((requestQuery: Partial<ProfilesSearchQuery>) => {
    if (contextItems == null) return
    const sortQuery = stripCampaignFacetBoostFromQuery(requestQuery)
    const skipCampaignFacets =
      !!(requestQuery.q ?? '').trim() && campaignMainTabRef.current === 'origin'
    if (contextItems.length === 0) {
      setFilteredList([])
      setTotal(0)
      if (!skipCampaignFacets) setFacets(computeFacetsFromItems([]))
      setDisplayedCount(DISPLAY_PAGE_SIZE)
      return
    }
    const qTrim = (requestQuery.q ?? '').trim()
    if (qTrim.length > 0) {
      const captionAligned =
        postCaptionSearch != null && postCaptionSearch.qKey === qTrim && !postCaptionSearchLoading
      if (!captionAligned) {
        const queryWithoutProfileQ = { ...sortQuery, q: undefined }
        const sortedForFacets = filterAndSortCampaignItems(contextItems, queryWithoutProfileQ, { favoriteHandles })
        if (!skipCampaignFacets) setFacets(computeFacetsFromItems(sortedForFacets))
        setFilteredList([])
        setTotal(0)
        setDisplayedCount(DISPLAY_PAGE_SIZE)
        return
      }
      const sortInput = { ...requestQuery, q: undefined }
      const sorted = filterAndSortCampaignItems(contextItems, sortInput, {
        favoriteHandles,
        postCaptionMatchHandles: postCaptionSearch.handles,
      })
      setFilteredList(sorted)
      setTotal(sorted.length)
      if (!skipCampaignFacets) setFacets(computeFacetsFromItems(sorted))
      setDisplayedCount(DISPLAY_PAGE_SIZE)
      return
    }
    const sorted = filterAndSortCampaignItems(contextItems, sortQuery, { favoriteHandles })
    setFilteredList(sorted)
    setTotal(sorted.length)
    setFacets(computeFacetsFromItems(sorted))
    setDisplayedCount(DISPLAY_PAGE_SIZE)
  }, [contextItems, favoriteHandles, postCaptionSearch, postCaptionSearchLoading])

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
  const mapFacetsFromApi = (facetsFromApi: ProfilesSearchFacets | null): ProfilesSearchFacets | null => {
    if (facetsFromApi == null) return null
    if (facetsFromApi.followers_buckets && !('size_buckets' in facetsFromApi)) {
      return {
        ...facetsFromApi,
        size_buckets: facetsFromApi.followers_buckets.map((b: { key: string; label: string; count: number }) => ({
          key: b.key === 'medio' ? 'mid' : b.key,
          label: b.label,
          count: b.count,
        })),
      }
    }
    return facetsFromApi
  }
  const loadContext = useCallback(
    (signal?: AbortSignal, queryOverride?: Partial<ProfilesSearchQuery>) => {
      if (campaignId == null) return
      setLoading(true)
      const baseQuery = queryOverride ?? query
      const hasWordSearch = !!(baseQuery.q?.trim())
      /** `q` aqui é só busca em legendas/posts (post-matches + cliente); não enviar para /profiles — senão o backend filtra nome/bio e zera a lista (ex.: "marcado" só em posts marcados). */
      const { q: _wordSearchOmit, ...baseWithoutWordSearch } = baseQuery
      if (!pendingPayment && isAllCampaignsView && !hasWordSearch) {
        const quickQuery = stripCampaignFacetBoostFromQuery({
          ...defaultQuery,
          ...baseWithoutWordSearch,
          limit: 1,
          offset: 0,
        })
        const quickFacetBoost = hasCampaignFacetBoost(baseQuery)
          ? pickCampaignFacetBoostFromQuery(baseQuery)
          : undefined
        fetchCampaignProfiles(campaignId, quickQuery, { signal, facetBoost: quickFacetBoost })
          .then((res) => {
            if (signal?.aborted) return
            setFacets(mapFacetsFromApi(res.facets ?? null))
            setTotal(res.total ?? 0)
          })
          .catch(() => { })
      }
      const filterQuery = stripCampaignFacetBoostFromQuery({
        ...(pendingPayment ? baseWithoutWordSearch : { ...defaultQuery, ...baseWithoutWordSearch }),
        limit: 10000,
      })
      const facetBoost = hasCampaignFacetBoost(baseQuery)
        ? pickCampaignFacetBoostFromQuery(baseQuery)
        : undefined
      fetchCampaignProfiles(campaignId, filterQuery, {
        signal,
        includeFacets: pendingPayment ? true : false,
        facetBoost,
      })
        .then((res) => {
          if (signal?.aborted) return
          if (pendingPayment) {
            setFacets(mapFacetsFromApi(res.facets ?? null))
            setPricePreview(res.pricePreview ?? null)
            setContextItems(res.items ?? [])
          } else {
            if (!hasWordSearch) setFacets(mapFacetsFromApi(res.facets ?? null))
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
    [campaignId, pendingPayment, query, isAllCampaignsView]
  )

  const updateFilter = useCallback(
    (overrides: Partial<ProfilesSearchQuery>) => {
      if (isCampaignFacetBoostOnlyPatch(overrides) || isCampaignGalleryUiOnlyPatch(overrides)) {
        if (
          isCampaignFacetBoostOnlyPatch(overrides) &&
          campaignMainTabRef.current === 'origin' &&
          (query.q ?? '').trim()
        ) {
          setOriginGallerySearchLoading(true)
        }
        const newQuery = normalizeSingleSelectFacetBoost({ ...query, ...overrides, offset: 0 })
        setQuery(newQuery)
        setDisplayedCount(DISPLAY_PAGE_SIZE)
        setSearchParams(buildCampaignUrlParams(newQuery, campaignMainTab), { replace: true })
        if (pendingPayment) {
          pendingLoadFromFilterRef.current = true
          loadContext(undefined, newQuery)
        } else if (contextItems != null) {
          applyContextFilters(newQuery)
        }
        return
      }
      const qFromOverride = overrides.q
      const explicitQ = 'q' in overrides
      const qTrim = typeof qFromOverride === 'string' ? qFromOverride.trim() : ''
      const wordSearchApplied = explicitQ && qTrim.length > 0
      /** Buscar por legenda: URL só com `q` (remove LLM, geo, tipo de mídia na origem, etc.). */
      let newQuery: Partial<ProfilesSearchQuery> = wordSearchApplied
        ? { ...defaultQuery, q: qTrim, offset: 0 }
        : { ...query, ...overrides, offset: 0 }
      /** Nova busca ou reenvio do mesmo termo: volta à ordenação padrão (relevância). */
      if (explicitQ) {
        newQuery = { ...newQuery, sort: undefined, originPostSort: undefined }
      }
      if (wordSearchApplied) {
        setSearchFacets(null)
        setCampaignMainTab('origin')
      }
      const tab: 'influencers' | 'origin' = wordSearchApplied ? 'origin' : campaignMainTab
      setQuery(newQuery)
      if (explicitQ) {
        setSearchRefreshToken((t) => t + 1)
      }
      if (wordSearchApplied) {
        const { search, hash } = wordSearchUrlLocation(
          qTrim,
          !isAllCampaignsView ? { tab: 'origin' } : undefined
        )
        navigate(
          { pathname: location.pathname, search, hash },
          { replace: true, state: { searchSubmitAt: Date.now() } }
        )
      } else if (explicitQ && !qTrim) {
        navigate({ pathname: location.pathname, search: '', hash: '' }, { replace: true })
      } else {
        setSearchParams(buildCampaignUrlParams(newQuery, tab), { replace: true })
      }
      if (pendingPayment) {
        pendingLoadFromFilterRef.current = true
        loadContext(undefined, newQuery)
      } else if (contextItems != null) {
        applyContextFilters(newQuery)
      }
    },
    [
      query,
      contextItems,
      applyContextFilters,
      setSearchParams,
      navigate,
      location.pathname,
      pendingPayment,
      loadContext,
      buildCampaignUrlParams,
      campaignMainTab,
      isAllCampaignsView,
      hasActiveSearchQ,
    ]
  )

  const clearFilters = useCallback(() => {
    const newQuery = { ...defaultQuery, offset: 0 }
    setQuery(newQuery)
    setSearchFacets(null)
    navigate({ pathname: location.pathname, search: '', hash: '' }, { replace: true })
    if (!pendingPayment && contextItems != null) applyContextFilters(newQuery)
  }, [contextItems, applyContextFilters, navigate, location.pathname, pendingPayment])

  const loadMore = useCallback(() => {
    if (loadingMore) return
    if (displayedCount >= filteredList.length) return
    setLoadingMore(true)
    setDisplayedCount((prev) => Math.min(prev + DISPLAY_PAGE_SIZE, filteredList.length))
  }, [displayedCount, filteredList.length, loadingMore])

  useEffect(() => {
    if (!loadingMore) return
    if (data.length >= displayedCount || data.length >= total) {
      setLoadingMore(false)
    }
  }, [loadingMore, data.length, displayedCount, total])

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current
    if (!sentinel || data.length >= total || total === 0) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loadingMore) loadMore()
      },
      { rootMargin: '200px', threshold: 0 }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [pendingPayment, data.length, total, loadMore, loadingMore])

  useEffect(() => {
    setSearchInput(urlParams.get('q') ?? '')
  }, [urlParams.get('q')])

  useEffect(() => {
    if (!isAllCampaignsView) return
    const submitAt = (location.state as { searchSubmitAt?: number } | null)?.searchSubmitAt
    if (submitAt == null || submitAt === lastTopBarSearchSubmitRef.current) return
    lastTopBarSearchSubmitRef.current = submitAt

    const q = urlParams.get('q')?.trim()
    if (q) setCampaignMainTab('origin')
    const { sort: _dropSort, ...parsedWithoutSort } = urlParamsToCampaignQuery(urlParams)
    setQuery({ ...defaultQuery, ...parsedWithoutSort, offset: 0 })
    setSearchFacets(null)
    setSearchRefreshToken((t) => t + 1)
  }, [isAllCampaignsView, location.state, urlParams])

  useEffect(() => {
    if (campaignId == null) return
    if (!user && !isAllCampaignsView) return
    if (isSearchLanding) return
    if (campaignMainTab === 'origin' && query.q?.trim()) return
    if (pendingPayment && pendingLoadFromFilterRef.current) {
      pendingLoadFromFilterRef.current = false
      return
    }
    const controller = new AbortController()
    loadContext(controller.signal)
    return () => controller.abort()
  }, [campaignId, user?.id, loadContext, pendingPayment, isAllCampaignsView, isSearchLanding, campaignMainTab, contextFetchQueryKey, query.q])

  const originMediaKindsKey =
    query.originMediaKinds?.length ? [...query.originMediaKinds].sort().join(',') : ''

  useEffect(() => {
    if (campaignMainTab !== 'origin' || !query.q?.trim()) {
      setOriginSearchSettledEmpty(false)
      setOriginSearchLimited(false)
    }
  }, [campaignMainTab, query.q, originMediaKindsKey])

  useEffect(() => {
    setOriginSearchSettledEmpty(false)
    setOriginSearchLimited(false)
  }, [campaignId])

  useEffect(() => {
    if (campaignId == null) {
      setPostCaptionSearch(null)
      setPostCaptionSearchLoading(false)
      return
    }
    const q = query.q?.trim()
    if (!q) {
      setPostCaptionSearch(null)
      setPostCaptionSearchLoading(false)
      return
    }
    /** handlesOnly só na aba Perfis; na aba Posts a galeria usa post-matches e não deve ficar em loading. */
    if (campaignMainTab !== 'influencers') {
      setPostCaptionSearchLoading(false)
      return
    }
    const kinds = query.originMediaKinds
    const ac = new AbortController()
    setPostCaptionSearchLoading(true)
    setPostCaptionSearch(null)
    const facetBoost = hasCampaignFacetBoost(query)
      ? pickCampaignFacetBoostFromQuery(query)
      : undefined
    const tid = window.setTimeout(() => {
      if (ac.signal.aborted) return
      void fetchCampaignPostSearchHandles(
        campaignId,
        { q, mediaKinds: kinds?.length ? kinds : undefined },
        { signal: ac.signal, facetBoost }
      )
        .then((res) => {
          if (ac.signal.aborted) return
          const handles = new Set(
            res.handles.map((h) => h.toLowerCase().replace(/^@/, '').trim()).filter(Boolean)
          )
          setPostCaptionSearch({ qKey: q, handles, totalPosts: res.totalPosts })
        })
        .catch((e) => {
          if (ac.signal.aborted) return
          if (isPublicSearchLimitError(e)) {
            return
          }
          setPostCaptionSearch((prev) =>
            prev?.qKey === q ? prev : { qKey: q, handles: new Set(), totalPosts: 0 }
          )
        })
        .finally(() => {
          if (!ac.signal.aborted) setPostCaptionSearchLoading(false)
        })
    }, POST_CAPTION_SEARCH_DEBOUNCE_MS)
    return () => {
      ac.abort()
      window.clearTimeout(tid)
    }
  }, [
    campaignId,
    campaignMainTab,
    query.q,
    originMediaKindsKey,
    postMatchProfileFiltersKey,
    postMatchFacetBoostKey,
    searchRefreshToken,
  ])

  useEffect(() => {
    if (campaignId == null) return
    if (!user && !isAllCampaignsView) return
    setCampaignInfo(null)
    setNamePromptDismissed(false)
    setNameModalOpen(false)
    hasAutoOpenedNameModalRef.current = false
    if (isSearchLanding) {
      setCampaignCredits(null)
      setCampaignInfo(null)
      setCampaignInfoLoaded(true)
      return
    }
    setCampaignInfoLoaded(false)
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
  }, [campaignId, user?.id, isAllCampaignsView, isSearchLanding])

  useEffect(() => {
    if (contextItems == null) return
    applyContextFilters(query)
  }, [contextItems, query, applyContextFilters])

  useEffect(() => {
    if (data.length >= total || total === 0) {
      setLoadingMore(false)
    }
  }, [data.length, total])

  const maxQuantity = pendingPayment
    ? Math.max(1, total > 0 ? total : (campaignInfo?.handlesCount ?? 1))
    : 1
  const creditsPaid = campaignInfo?.creditsPaid ?? campaignInfo?.credits_used ?? 0
  const billableProfileCount = pricePreview?.billableProfileCount ?? maxQuantity
  const unpaidBillable = Math.max(0, billableProfileCount - creditsPaid)
  const balance = creditsContext?.balance ?? 0
  const creditsToApply =
    pendingPayment && unpaidBillable > 0 && balance > 0 ? Math.min(balance, unpaidBillable) : 0
  const amountCentsAfterDiscount = pricePreview?.amountCents
  const canPayWithCredits = !!(
    pendingPayment &&
    ((unpaidBillable > 0 && balance > 0) || (amountCentsAfterDiscount === 0 && maxQuantity > 0))
  )

  useEffect(() => {
    if (!authLoading && !user && !isAllCampaignsView) {
      navigate('/login', { replace: true })
    }
  }, [authLoading, user, navigate, isAllCampaignsView])

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
    if (!campaignId || campaignId === ALL_CAMPAIGNS_SLUG) return
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
      if (!campaignId || campaignId === ALL_CAMPAIGNS_SLUG) return
      updateCampaignDescription(campaignId, value).then(() => {
        setCampaignInfo((prev) => (prev ? { ...prev, description: value || null } : null))
      })
    },
    [campaignId]
  )

  const refreshCampaign = useCallback(() => {
    if (!campaignId || campaignId === ALL_CAMPAIGNS_SLUG) return
    getCampaign(campaignId).then((info) => {
      setCampaignInfo(info)
    }).catch(() => { })
  }, [campaignId])

  const handleDeleteCampaign = useCallback((): Promise<void> => {
    if (!campaignId || campaignId === ALL_CAMPAIGNS_SLUG) return Promise.resolve()
    setDeletingCampaign(true)
    return deleteCampaign(campaignId)
      .then(() => {
        message.success('Campanha excluída.')
        navigate('/app/campaigns', { replace: true })
      })
      .catch((err) => {
        message.error(err instanceof Error ? err.message : 'Falha ao excluir')
        throw err
      })
      .finally(() => setDeletingCampaign(false))
  }, [campaignId, navigate])

  const handleOpenBuyCredits = useCallback(async () => {
    try {
      const p = await fetchMyPendingPayment()
      setBuyCreditsResume(p)
    } catch {
      setBuyCreditsResume(null)
    }
    setBuyCreditsModalOpen(true)
  }, [])

  const handlePayWithCredits = useCallback(async () => {
    if (!campaignId || campaignId === ALL_CAMPAIGNS_SLUG) return
    const freeUnlock =
      !!pendingPayment && pricePreview?.amountCents === 0 && maxQuantity > 0
    if (!freeUnlock && creditsToApply <= 0) return
    setPayingWithCredits(true)
    try {
      const payFullCampaignBillable =
        !freeUnlock &&
        creditsToApply > 0 &&
        creditsToApply === billableProfileCount
      await payCampaignWithCredits(
        campaignId,
        freeUnlock || payFullCampaignBillable ? undefined : creditsToApply > 0 ? creditsToApply : undefined
      )
      message.success('Pagamento com créditos concluído. Relatório liberado!')
      refreshCampaign()
      void creditsContext?.refreshCredits()
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Falha ao pagar com créditos')
    } finally {
      setPayingWithCredits(false)
    }
  }, [
    campaignId,
    creditsToApply,
    billableProfileCount,
    refreshCampaign,
    creditsContext,
    pendingPayment,
    pricePreview?.amountCents,
    maxQuantity,
  ])

  const openInfluencerConnect = useCallback(
    (handleOrKey: string, snapshot?: InfluencerConnectSnapshot) => {
      if (!campaignId) return
      const h = normalizeCampaignListHandle(handleOrKey)
      if (!h) return
      setConnectModal({ handle: h, snapshot })
    },
    [campaignId]
  )

  const openInfluencerProfileDetail = useCallback((profileRef: string) => {
    const ref = (profileRef ?? '').trim()
    if (!ref) return
    setProfileDetailRef(ref)
  }, [])

  /** Busca pública (/search): perfil no modal. Campanha paga: fluxo de contratação via WhatsApp. */
  const openInfluencerFromCard = useCallback(
    (handleOrKey: string, snapshot?: InfluencerConnectSnapshot) => {
      if (isAllCampaignsView) {
        openInfluencerProfileDetail(handleOrKey)
        return
      }
      openInfluencerConnect(handleOrKey, snapshot)
    },
    [isAllCampaignsView, openInfluencerProfileDetail, openInfluencerConnect]
  )

  const currentSort = query.sort ?? (query.q?.trim() ? 'relevance_desc' : 'engagement_desc')
  type SortColumn = 'name' | 'favorite'
  const handleSortColumn = useCallback(
    (column: SortColumn) => {
      const toggle = (desc: ProfilesSort, asc: ProfilesSort): ProfilesSort =>
        currentSort === desc ? asc : desc
      const next: ProfilesSort =
        column === 'name' ? toggle('name_desc', 'name_asc') : toggle('favorite_desc', 'favorite_asc')
      updateFilter({ sort: next })
    },
    [currentSort, updateFilter]
  )

  const handleMetricSortMenuClick = useCallback(
    (info: { key: string }) => {
      const k = info.key as ProfilesSort
      if (CAMPAIGN_LIST_METRIC_SORT_KEYS.has(k)) updateFilter({ sort: k })
    },
    [updateFilter]
  )

  const selectedCities = (query.cities ?? []) as string[]
  const selectedStates = (query.states ?? []) as string[]
  const selectedSocial = (query.socialNetworks ?? []) as string[]
  const selectedContentTypes = (query.contentTypes ?? []) as string[]
  const selectedOriginMediaKinds = (query.originMediaKinds ?? []) as MediaKind[]
  const hasOriginSearchTerm = (query.q?.trim().length ?? 0) > 0
  const captionQNormalized = query.q?.trim() ?? ''
  /** Aba Posts: galeria chama post-matches direto; não espera handlesOnly (fila de refresh não trava a UI). */
  const originCaptionPostMatchesReady = true
  const showOriginSearchOnly = campaignMainTab === 'origin' && !hasOriginSearchTerm
  /** Base completa: logo + busca fixos no topo ao rolar (aba com termo ou Perfis). */
  const showAllCampaignsFixedChrome = isAllCampaignsView && !pendingPayment && !showOriginSearchOnly
  const showCampaignSearchToolbar =
    !pendingPayment && !(campaignMainTab === 'origin' && !hasOriginSearchTerm)
  /** Na aba Posts com termo: esconde abas + BI (base completa mantém só o logo). Mesmo padrão na aba Perfis enquanto busca handles por legenda ou quando a API não devolve nenhum. */
  const originCaptionSearchHidesBIPanel =
    campaignMainTab === 'origin' &&
    !!query.q?.trim() &&
    (originGallerySearchLoading || originSearchSettledEmpty || originSearchLimited)
  const influencersCaptionSearchHidesBIPanel =
    campaignMainTab === 'influencers' &&
    !!query.q?.trim() &&
    (postCaptionSearchLoading ||
      (!postCaptionSearchLoading &&
        postCaptionSearch != null &&
        postCaptionSearch.qKey === captionQNormalized &&
        postCaptionSearch.handles.size === 0))
  const influencersListRefetching =
    campaignMainTab === 'influencers' &&
    (loading || (!!query.q?.trim() && postCaptionSearchLoading))
  const campaignHidesBIPanel = originCaptionSearchHidesBIPanel || influencersCaptionSearchHidesBIPanel
  const showCampaignLeftColumn =
    !isMobile && !campaignHidesBIPanel && (isAllCampaignsView ? !pendingPayment : true)
  const selectedSizeFilter = (query.sizeFilter ?? []) as string[]
  const hasActiveFilters =
    (query.q?.trim()?.length ?? 0) > 0 ||
    selectedCities.length > 0 ||
    selectedStates.length > 0 ||
    selectedSocial.length > 0 ||
    selectedContentTypes.length > 0 ||
    selectedOriginMediaKinds.length > 0 ||
    selectedSizeFilter.length > 0 ||
    (query.accountTypeFilter?.length ?? 0) > 0

  const renderCampaignViewToggle = (fullWidth = false) => {
    if (isMobile) return null
    if (campaignMainTab !== 'influencers' && campaignMainTab !== 'origin') return null
    const activeMode = campaignMainTab === 'influencers' ? viewMode : originViewMode
    return (
      <div
        className={`campaign-instagram-view-toggle${fullWidth ? ' campaign-instagram-view-toggle--full' : ''}`}
        role="group"
        aria-label="Lista ou foto"
      >
        <button
          type="button"
          className={`campaign-instagram-view-toggle-btn${activeMode === 'list' ? ' is-active' : ''}`}
          onClick={() =>
            campaignMainTab === 'influencers' ? setViewMode('list') : setOriginViewMode('list')
          }
        >
          <UnorderedListOutlined />
          <span>lista</span>
        </button>
        <button
          type="button"
          className={`campaign-instagram-view-toggle-btn${activeMode === 'grid' ? ' is-active' : ''}`}
          onClick={() =>
            campaignMainTab === 'influencers' ? setViewMode('grid') : setOriginViewMode('grid')
          }
        >
          <AppstoreOutlined />
          <span>foto</span>
        </button>
      </div>
    )
  }

  const renderCampaignSearchToolbar = (options?: { withViewToggle?: boolean }) => {
    const withViewToggle = options?.withViewToggle ?? !showAllCampaignsFixedChrome
    return (
      <>
        <Space.Compact style={{ flex: 1, minWidth: 0 }}>
          <Input
            placeholder="Digite uma palavra"
            prefix={<SearchOutlined style={{ color: 'var(--app-text-tertiary)', fontSize: 16 }} />}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            allowClear
            size="large"
            style={{ flex: 1 }}
          />
          <Button
            type="primary"
            size="large"
            icon={<SearchOutlined />}
            onClick={() => updateFilter({ q: searchInput.trim() || undefined })}
          >
            Buscar
          </Button>
        </Space.Compact>
        {withViewToggle ? renderCampaignViewToggle() : null}
      </>
    )
  }

  const renderCampaignMainTabs = () =>
    !pendingPayment && !isAllCampaignsView ? (
      <Segmented
        className="campaign-main-tabs campaign-main-tabs--full-width"
        value={campaignMainTab}
        onChange={(v) => {
          const nextTab = v as 'influencers' | 'origin'
          setCampaignMainTab(nextTab)
          setSearchParams(buildCampaignUrlParams(queryRef.current, nextTab), { replace: true })
        }}
        options={[
          { label: 'Posts', value: 'origin' },
          { label: 'Perfis', value: 'influencers' },
        ]}
        style={{ marginTop: 8, width: '100%', maxWidth: '100%' }}
      />
    ) : null

  const renderCampaignPageBranding = () => (
    <>
      <Typography.Title level={4} style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        {campaignInfo?.name?.trim() || 'Sua campanha'}
        {campaignId && !isAllCampaignsView && (
          <Tooltip title="Editar nome da campanha">
            <Button type="text" size="small" icon={<EditOutlined />} onClick={openNameModalForEdit} style={{ padding: '0 4px' }} />
          </Tooltip>
        )}
      </Typography.Title>
      {renderCampaignMainTabs()}
      {!isAllCampaignsView && campaignCredits != null ? (
        <Typography.Text type="secondary" style={{ fontSize: 13, display: 'block', marginTop: 6 }}>
          {campaignCredits.toLocaleString('pt-BR')} créditos
        </Typography.Text>
      ) : null}
    </>
  )

  if (
    !isSearchLanding &&
    (authLoading || (campaignId != null && !user && !isAllCampaignsView))
  ) {
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

  if (!isSearchLanding && !campaignInfoLoaded) {
    return (
      <div style={{ padding: '48px 24px', textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    )
  }

  return (
    <div
      className={
        showAllCampaignsFixedChrome
          ? 'campaign-page campaign-page--all'
          : undefined
      }
      style={{ overflowX: 'hidden' }}
    >
      <Modal
        title={campaignHasName ? 'Editar nome da campanha' : 'Informe o nome da campanha'}
        open={nameModalOpen}
        onCancel={() => setNameModalOpen(false)}
        footer={null}
        destroyOnHidden
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
        {campaignId && !isAllCampaignsView ? (
          <div className="campaign-name-modal-remove">
            <button
              type="button"
              className="campaign-name-modal-remove__btn"
              aria-label="Remover campanha da lista"
              onClick={() => {
                Modal.confirm({
                  title: 'Excluir esta campanha?',
                  content: 'Ela sai da sua lista. Não dá pra desfazer.',
                  okText: 'Excluir',
                  okType: 'danger',
                  cancelText: 'Cancelar',
                  onOk: () => handleDeleteCampaign(),
                })
              }}
              disabled={deletingCampaign}
            >
              Excluir esta campanha
            </button>
          </div>
        ) : null}
      </Modal>

      <BuyCreditsModal
        open={buyCreditsModalOpen}
        onClose={() => {
          setBuyCreditsModalOpen(false)
          setBuyCreditsResume(null)
        }}
        suggestedCredits={unpaidBillable}
        resumePayment={buyCreditsResume}
      />

      <InfluencerConnectModal
        open={connectModal != null}
        onClose={() => setConnectModal(null)}
        handle={connectModal?.handle ?? ''}
        snapshot={connectModal?.snapshot}
        campaignId={campaignId !== ALL_CAMPAIGNS_SLUG ? campaignId : null}
      />

      <InfluencerDetailModal
        open={profileDetailRef != null}
        onClose={() => setProfileDetailRef(null)}
        profileRef={profileDetailRef ?? ''}
        campaignId={isAllCampaignsView ? ALL_CAMPAIGNS_SLUG : campaignId}
      />

      <Modal
        title="Cadastro necessário"
        open={signupGateModalOpen}
        onCancel={() => setSignupGateModalOpen(false)}
        footer={null}
        destroyOnHidden
      >
        <Typography.Paragraph style={{ marginBottom: 16 }}>
          Para ver os dados completos do influenciador neste relatório, acesse a área da agência: faça login ou cadastro na mesma página.
        </Typography.Paragraph>
        <Button
          type="primary"
          size="large"
          block
          onClick={() => {
            setSignupGateModalOpen(false)
            navigate('/login')
          }}
        >
          Entrar ou cadastrar
        </Button>
      </Modal>

      {!showOriginSearchOnly && !isAllCampaignsView && (
        <div
          style={{
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            alignItems: isMobile ? 'stretch' : 'flex-start',
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
              display: 'flex',
              flexDirection: 'column',
              alignItems: isMobile ? 'stretch' : 'flex-start',
              gap: 0,
              minWidth: 0,
            }}
          >
            {renderCampaignPageBranding()}
          </div>
          {!isAllCampaignsView && !pendingPayment ? (
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
                    alignItems: 'flex-start',
                    justifyContent: 'flex-end',
                    gap: 8,
                    flexWrap: 'wrap',
                  }),
              }}
            >
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
                  type="default"
                  className="campaign-toolbar-quiet-btn"
                  onClick={() => navigate('/app/campaigns')}
                  style={isMobile ? { width: '100%' } : undefined}
                >
                  <ArrowLeftOutlined /> Voltar
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {showOriginSearchOnly ? (
        <DiscoveryHomeHero
          variant="full"
          searchValue={searchInput}
          onSearchValueChange={setSearchInput}
          onSearch={(term) => {
            const q = (term ?? searchInput).trim()
            updateFilter({ q: q || undefined })
          }}
          showScrollHint={false}
        />
      ) : !hasActiveSearchQ && facets == null && loading ? (
        <OriginGalleryLoadingState />
      ) : !hasActiveSearchQ && facets == null && !loading && !campaignInfo?.pendingPayment ? (
        <div className="campaign-origin-search-loader">
          <div className="campaign-origin-search-loader__inner">
            <Empty description="Nenhum perfil nesta campanha." />
          </div>
        </div>
      ) : !hasActiveSearchQ && facets == null && !loading && campaignInfo?.pendingPayment ? (
        <div className="campaign-origin-search-loader">
          <div className="campaign-origin-search-loader__inner" style={{ textAlign: 'center' }}>
            <Spin size="small" />
            <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8 }}>Carregando filtros e valor...</Typography.Text>
          </div>
        </div>
      ) : (
        <div
          className={showAllCampaignsFixedChrome ? 'campaign-split-layout' : undefined}
          style={{
            display: 'flex',
            gap: showAllCampaignsFixedChrome ? 0 : CAMPAIGN_MAIN_COLUMN_GAP_PX,
            alignItems: 'flex-start',
            minWidth: 0,
          }}
        >
          {showAllCampaignsFixedChrome && !campaignHidesBIPanel ? (
            <div className="campaign-split-layout__rail-spacer" aria-hidden />
          ) : null}
          {showCampaignLeftColumn ? (
            <div
              className={showAllCampaignsFixedChrome ? 'campaign-split-layout__rail' : undefined}
              style={
                showAllCampaignsFixedChrome
                  ? { minWidth: 0 }
                  : { flexShrink: 0, width: CAMPAIGN_BI_PANEL_WIDTH_PX, minWidth: 0 }
              }
            >
              {!isAllCampaignsView && !pendingPayment && !campaignHidesBIPanel ? (
                <div style={{ marginBottom: 10 }}>{renderCampaignMainTabs()}</div>
              ) : null}
              {showAllCampaignsFixedChrome && !campaignHidesBIPanel ? (
                <div className="campaign-rail-view-toggle" style={{ marginBottom: 10 }}>
                  {renderCampaignViewToggle(true)}
                </div>
              ) : null}
              {!campaignHidesBIPanel ? (
                <CampaignBIPanel
                  facets={displayFacets}
                  query={query}
                  onFilter={updateFilter}
                  description={campaignInfo?.description ?? null}
                  onDescriptionSave={pendingPayment || isAllCampaignsView ? undefined : handleDescriptionSave}
                  showOriginPostSort={campaignMainTab === 'origin' && hasOriginSearchTerm}
                />
              ) : null}
            </div>
          ) : null}
          <div style={{ flex: 1, minWidth: 0 }}>
            {pendingPayment ? (
              <CampaignPaymentCart
                query={query}
                facets={displayFacets}
                onFilter={updateFilter}
                valueTotal={(() => {
                  const baseValue = (pricePreview?.valueBrl ?? campaignInfo?.pendingPayment?.valueBrl) ?? 0
                  const totalFiltered = Math.max(1, total)
                  return totalFiltered > 0 ? Math.floor((baseValue / totalFiltered) * maxQuantity) : 0
                })()}
                maxQuantity={maxQuantity}
                canPayWithCredits={canPayWithCredits}
                creditsToApply={creditsToApply}
                payingWithCredits={payingWithCredits}
                onPayWithCredits={handlePayWithCredits}
                onBuyCredits={() => void handleOpenBuyCredits()}
                amountCentsAfterDiscount={pricePreview?.amountCents}
                ownershipDiscount={
                  pricePreview &&
                    (pricePreview.alreadyOwnedCount ?? 0) > 0 &&
                    pricePreview.originalValueBrl != null
                    ? {
                      alreadyOwnedCount: pricePreview.alreadyOwnedCount!,
                      originalValueBrl: pricePreview.originalValueBrl,
                      billableProfileCount:
                        pricePreview.billableProfileCount ??
                        Math.max(0, maxQuantity - (pricePreview.alreadyOwnedCount ?? 0)),
                    }
                    : undefined
                }
                previewItems={filteredList}
                previewLoading={loading}
                campaignExpiresAt={campaignInfo?.expires_at ?? null}
              />
            ) : (
              <>
                {showCampaignSearchToolbar && !showAllCampaignsFixedChrome ? (
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, width: '100%', minWidth: 0 }}>
                      {renderCampaignSearchToolbar()}
                    </div>
                  </div>
                ) : null}
                {campaignMainTab === 'origin' && campaignId ? (
                  hasOriginSearchTerm ? (
                    <CampaignOriginGallery
                      key={`origin-${query.q?.trim() ?? ''}-${searchRefreshToken}`}
                      campaignId={campaignId}
                      viewMode={effectiveOriginViewMode}
                      textQuery={query.q?.trim() || ''}
                      mediaKinds={selectedOriginMediaKinds.length ? selectedOriginMediaKinds : undefined}
                      onLoadingChange={setOriginGallerySearchLoading}
                      onOriginSearchSettled={({ empty, rateLimited }) => {
                        setOriginSearchLimited(!!rateLimited)
                        setOriginSearchSettledEmpty(rateLimited ? false : empty)
                      }}
                      facetBoostQuery={query}
                      originPostSort={query.originPostSort}
                      profileFilters={postMatchProfileFilters}
                      onLoadedPostsForFacets={handleOriginPostsForFacets}
                      onOpenInfluencerDetail={openInfluencerFromCard}
                      captionFilterReady={originCaptionPostMatchesReady}
                      onSearchSuggestion={(term) => {
                        const t = term.trim()
                        setSearchInput(t)
                        updateFilter({ q: t || undefined })
                      }}
                    />
                  ) : null
                ) : (
                  <>
                    {isMobile && displayFacets != null && (
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
                        {displayFacets?.size_buckets && displayFacets.size_buckets.length > 0 && (
                          <Select
                            size="small"
                            placeholder="Tamanho"
                            allowClear
                            value={selectedSizeFilter[0]}
                            options={displayFacets.size_buckets.map(({ key, label, count }) => ({
                              value: key,
                              label: `${label} (${count})`,
                            }))}
                            onChange={(val) =>
                              updateFilter(buildSingleCampaignFacetBoostPatch('sizeFilter', val ? [val] : undefined))
                            }
                            style={{ width: 120 }}
                          />
                        )}
                        {displayFacets?.content_type && displayFacets.content_type.filter((x) => x.count > 0).length > 0 && (
                          <Select
                            size="small"
                            placeholder="Conteúdo"
                            allowClear
                            showSearch
                            optionFilterProp="label"
                            value={selectedContentTypes[0]}
                            options={displayFacets.content_type
                              .filter((x) => x.count > 0)
                              .map(({ name, count }) => ({
                                value: name,
                                label: `${CONTENT_TYPE_LABELS[name] ?? name} (${count})`,
                              }))}
                            onChange={(val) =>
                              updateFilter(buildSingleCampaignFacetBoostPatch('contentTypes', val ? [val] : undefined))
                            }
                            style={{ width: 140 }}
                          />
                        )}
                        {displayFacets?.social && (displayFacets.social.whatsapp > 0 || displayFacets.social.tiktok > 0 || displayFacets.social.facebook > 0 || displayFacets.social.linkedin > 0 || displayFacets.social.twitter > 0) && (
                          <Select
                            size="small"
                            placeholder="Redes"
                            allowClear
                            value={selectedSocial[0]}
                            options={[
                              displayFacets.social.whatsapp > 0 && { value: 'whatsapp', label: `WA (${displayFacets.social.whatsapp})` },
                              displayFacets.social.tiktok > 0 && { value: 'tiktok', label: `TikTok (${displayFacets.social.tiktok})` },
                              displayFacets.social.facebook > 0 && { value: 'facebook', label: `FB (${displayFacets.social.facebook})` },
                              displayFacets.social.linkedin > 0 && { value: 'linkedin', label: `LI (${displayFacets.social.linkedin})` },
                              displayFacets.social.twitter > 0 && { value: 'twitter', label: `X (${displayFacets.social.twitter})` },
                            ].filter(Boolean) as { value: string; label: string }[]}
                            onChange={(val) =>
                              updateFilter(buildSingleCampaignFacetBoostPatch('socialNetworks', val ? [val] : undefined))
                            }
                            style={{ width: 110 }}
                          />
                        )}
                        {displayFacets?.cities && displayFacets.cities.length > 0 && (
                          <Select
                            size="small"
                            placeholder="Cidades"
                            allowClear
                            showSearch={false}
                            optionFilterProp="label"
                            value={selectedCities[0]}
                            options={displayFacets.cities.map(({ name, count }) => ({ value: name, label: `${name} (${count})` }))}
                            onChange={(val) =>
                              updateFilter(buildSingleCampaignFacetBoostPatch('cities', val ? [val] : undefined))
                            }
                            style={{ width: 120 }}
                          />
                        )}
                        {displayFacets?.states && displayFacets.states.length > 0 && (
                          <Select
                            size="small"
                            placeholder="Estados"
                            allowClear
                            showSearch={false}
                            optionFilterProp="label"
                            value={selectedStates[0]}
                            options={displayFacets.states.map(({ name, count }) => ({ value: name, label: `${name} (${count})` }))}
                            onChange={(val) =>
                              updateFilter(buildSingleCampaignFacetBoostPatch('states', val ? [val] : undefined))
                            }
                            style={{ width: 110 }}
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
                      {influencersListRefetching ? (
                        <OriginGalleryLoadingState />
                      ) : data.length === 0 && query.q?.trim() && postCaptionSearchLoading ? (
                        <OriginGalleryLoadingState />
                      ) : data.length === 0 ? (
                        <div className="campaign-origin-search-loader">
                          <div className="campaign-origin-search-loader__inner">
                            <Empty description="Nenhum perfil nesta campanha." />
                          </div>
                        </div>
                      ) : null}
                      {!influencersListRefetching && data.length > 0 && (effectiveViewMode === 'list' ? (
                        <div style={{ overflow: 'auto', border: '1px solid var(--app-border, #f0f0f0)', borderRadius: 8, minWidth: 0 }}>
                          <table className="campaign-list-table" style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--app-bg)' }}>
                            <thead>
                              <tr style={{ background: 'var(--app-bg-secondary, #fafafa)', borderBottom: '1px solid var(--app-border, #f0f0f0)', fontSize: 10, fontWeight: 600, color: 'var(--app-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.02em' }}>
                                <th
                                  style={{
                                    padding: '6px 6px',
                                    textAlign: 'center',
                                    width: 92,
                                    minWidth: 92,
                                    verticalAlign: 'middle',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {showFavoriteColumn ? (
                                    <div
                                      role="button"
                                      tabIndex={0}
                                      onClick={() => handleSortColumn('favorite')}
                                      onKeyDown={(e) => e.key === 'Enter' && handleSortColumn('favorite')}
                                      title="Ordenar por favoritos"
                                      style={{
                                        cursor: 'pointer',
                                        userSelect: 'none',
                                        display: 'inline-flex',
                                        flexDirection: 'row',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: 4,
                                        whiteSpace: 'nowrap',
                                      }}
                                    >
                                      <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--app-text-tertiary)', lineHeight: 1.2 }}>Favorito</span>
                                      <span aria-hidden style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
                                        {currentSort === 'favorite_desc'
                                          ? <CaretDownOutlined style={{ fontSize: 9, opacity: 1 }} />
                                          : currentSort === 'favorite_asc'
                                            ? <CaretUpOutlined style={{ fontSize: 9, opacity: 1 }} />
                                            : <CaretDownOutlined style={{ fontSize: 9, opacity: 0.45 }} />}
                                      </span>
                                    </div>
                                  ) : null}
                                </th>
                                <th style={{ padding: '4px 8px 4px 4px', textAlign: 'left', borderLeft: '1px solid var(--app-border)', cursor: 'pointer', userSelect: 'none', width: '100%', minWidth: 0 }} role="button" tabIndex={0} onClick={() => handleSortColumn('name')} onKeyDown={(e) => e.key === 'Enter' && handleSortColumn('name')}>
                                  Perfil {currentSort === 'name_desc' ? <CaretDownOutlined style={{ fontSize: 9, opacity: 1 }} /> : currentSort === 'name_asc' ? <CaretUpOutlined style={{ fontSize: 9, opacity: 1 }} /> : <CaretDownOutlined style={{ fontSize: 9, opacity: 0.45 }} />}
                                </th>
                                <th
                                  style={{
                                    padding: 0,
                                    textAlign: 'center',
                                    borderLeft: '1px solid var(--app-border)',
                                    verticalAlign: 'middle',
                                    fontSize: 10,
                                    fontWeight: 600,
                                    color: 'var(--app-text-secondary)',
                                    letterSpacing: '0.02em',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  <Dropdown
                                    menu={{
                                      items: CAMPAIGN_LIST_METRICS_SORT_MENU_ITEMS,
                                      onClick: handleMetricSortMenuClick,
                                      selectable: true,
                                      selectedKeys: isCampaignListMetricSort(currentSort) ? [currentSort] : [],
                                    }}
                                    trigger={['click']}
                                    placement="bottomRight"
                                  >
                                    <button type="button" className="campaign-list-metrics-sort-btn" aria-label="Ordenar por métrica">
                                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                                        Métricas
                                        <DownOutlined style={{ fontSize: 9, opacity: 0.85 }} />
                                      </span>
                                      <span style={{ fontSize: 9, fontWeight: 500, opacity: 0.8, lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                                        {isCampaignListMetricSort(currentSort) ? campaignListMetricSortSummary(currentSort) : 'Escolher ordenação'}
                                      </span>
                                    </button>
                                  </Dropdown>
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {data.map((item) => (
                                <CampaignListRow
                                  key={item.key}
                                  item={item}
                                  onClick={() =>
                                    openInfluencerFromCard(item.profile_ref, profileItemToConnectSnapshot(item))
                                  }
                                  isFavorite={user ? favoriteHandles.has((item.profile_ref ?? '').trim()) : false}
                                  onFavoriteToggle={user && user.scope !== 'influencer' ? handleFavoriteToggle : undefined}
                                  showFavoriteColumn={showFavoriteColumn}
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
                                onClick={() =>
                                  openInfluencerFromCard(item.profile_ref ?? item.key, profileItemToConnectSnapshot(item))
                                }
                                onImageRefreshQueued={(handle) => addHandleForImageUpdate.current?.(handle)}
                                showMetrics={!!user}
                                isFavorite={user ? favoriteHandles.has((item.profile_ref ?? '').trim()) : false}
                                onFavoriteToggle={user && user.scope !== 'influencer' ? handleFavoriteToggle : undefined}
                              />
                            </Col>
                          ))}
                        </Row>
                      ))}
                      {data.length > 0 && (
                        <>
                          {data.length < total && (
                            <div
                              ref={loadMoreSentinelRef}
                              style={{ minHeight: 1, marginTop: 16 }}
                              aria-hidden
                            />
                          )}
                          {loadingMore && data.length < total && (
                            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
                              <Spin size="small" />
                              <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
                                Carregando mais perfis...
                              </Typography.Text>
                            </div>
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
