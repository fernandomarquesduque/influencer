/**
 * Galeria estilo Instagram: posts/reels onde o termo de busca aparece (dados atuais do índice).
 */
import { useEffect, useState, useCallback, useRef, useMemo, type CSSProperties } from 'react'
import { Typography, Tooltip } from 'antd'
import OriginSearchEmptyState from './OriginSearchEmptyState'
import './CampaignOriginGallery.css'
import {
  fetchCampaignPostMatches,
  getPostCoverDisplayUrl,
  getPostStablePreviewUrl,
  type PostItem,
  type PostsResponse,
  type MediaKind,
  type ProfilesSearchQuery,
  type ProfileListItem,
} from '../api'
import { resolveMediaUrl } from '../constants/profilePaths'
import { PostPreviewMedia } from './PostPreviewCard'
import ProfileAvatar from './ProfileAvatar'
import { METRIC_TOOLTIPS } from '../constants/metricTooltips'
import { getInfluencerTierShort } from '../utils/influencerTier'
import InfluencerTierPill from './InfluencerTierPill'
import {
  getLlmTripleBadgesFromLlmRoot,
} from '../utils/campaignLlmBadges'
import HighlightedSearchText from './HighlightedSearchText'
import { getCaptionSnippetForSearch } from '../utils/queryRelevance'
import { queueMediaRefreshFromPost } from '../utils/queueMediaRefreshForProfile'
import type { InfluencerConnectSnapshot } from './InfluencerConnectModal/InfluencerConnectModal'
import { getLlmDescriptionLine, getProfilePersonaSummary } from '../utils/mapProfileListToPreviewItems'
import { formatFacetLabel } from '../utils/facetLabels'
import { sortPostsByCampaignFacetBoost, pickCampaignFacetBoostFromQuery, hasCampaignFacetBoost } from '../utils/campaignFilterClient'

const { Text } = Typography

const PAGE = 24

const ORIGIN_LOADER_SLIDES = [
  {
    headline: 'Reunindo o que importa',
    line: 'Cada publicação é um sinal — estamos conectando as peças da sua campanha.',
  },
  {
    headline: 'Radar de conteúdo ligado',
    line: 'Encontrando vozes, formatos e momentos em que sua marca ganha vida.',
  },
  {
    headline: 'Só um instante',
    line: 'O melhor do índice está a caminho; o que aparecer pode abrir novas ideias.',
  },
] as const

export function OriginGalleryLoadingState() {
  const [slide, setSlide] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => {
      setSlide((s) => (s + 1) % ORIGIN_LOADER_SLIDES.length)
    }, 3400)
    return () => window.clearInterval(id)
  }, [])
  const { headline, line } = ORIGIN_LOADER_SLIDES[slide]!
  return (
    <div
      className="campaign-origin-search-loader"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="campaign-origin-search-loader__inner">
        <div className="campaign-origin-search-loader__orbit" aria-hidden>
          <span className="campaign-origin-search-loader__dot" />
          <span className="campaign-origin-search-loader__dot" />
          <span className="campaign-origin-search-loader__dot" />
        </div>
        <div key={slide} className="campaign-origin-search-loader__copy">
          <h3 className="campaign-origin-search-loader__title">{headline}</h3>
          <p className="campaign-origin-search-loader__line">{line}</p>
        </div>
      </div>
    </div>
  )
}

/** Modo lista: largura da coluna só de mídia (legenda e perfil ficam à direita). */

const MEDIA_KIND_SHORT: Record<MediaKind, string> = {
  post: 'Feed',
  reel: 'Reels',
  tagged: 'Marcados',
  highlight: 'Destaques',
}

/** Base do pill de tipo de mídia (topo esquerdo). */
const originMediaOverlayBase: CSSProperties = {
  position: 'absolute',
  top: 8,
  left: 8,
  zIndex: 2,
  fontSize: 10,
  fontWeight: 700,
  lineHeight: 1.25,
  padding: '5px 9px',
  borderRadius: 999,
  maxWidth: 'calc(100% - 16px)',
  boxShadow: '0 1px 6px rgba(0,0,0,0.35)',
  letterSpacing: '0.02em',
  pointerEvents: 'auto',
}

/** Base do pill de categoria no rodapé da mídia. */
const originMediaCategoryFooterBase: CSSProperties = {
  position: 'absolute',
  bottom: 0,
  left: 0,
  right: 0,
  zIndex: 2,
  fontSize: 10,
  fontWeight: 700,
  lineHeight: 1.3,
  padding: '6px 10px',
  borderRadius: 0,
  maxWidth: '100%',
  boxShadow: '0 -1px 8px rgba(0,0,0,0.28)',
  letterSpacing: '0.02em',
  pointerEvents: 'auto',
  textAlign: 'left',
}

/** Pill sobre a mídia (topo esquerdo), leitura em foto clara/escura. */
function originMediaKindOverlayStyle(ct: MediaKind): CSSProperties {
  const base = originMediaOverlayBase
  switch (ct) {
    case 'reel':
      return { ...base, color: '#fff', background: 'linear-gradient(135deg, #c084fc 0%, #7c3aed 100%)' }
    case 'tagged':
      return { ...base, color: '#fff', background: 'linear-gradient(135deg, #fb7185 0%, #db2777 100%)' }
    case 'highlight':
      return { ...base, color: '#fff', background: 'linear-gradient(135deg, #38bdf8 0%, #0284c7 100%)' }
    default:
      return { ...base, color: '#fff', background: 'linear-gradient(135deg, #60a5fa 0%, #2563eb 100%)' }
  }
}

function formatFollowersShort(n: number | undefined | null): string | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M seguidores`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k seguidores`
  return `${n.toLocaleString('pt-BR')} seguidores`
}

function formatPostsPerWeekShort(n: number | undefined | null): string | null {
  if (n == null || !Number.isFinite(n)) return null
  const rounded = Math.round(n * 10) / 10
  return rounded.toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: rounded % 1 === 0 ? 0 : 1 })
}

function getInfluencerPostsPerWeek(post: PostItem): number | null {
  const ppw = post.influencer?.posts_per_week
  return typeof ppw === 'number' && Number.isFinite(ppw) ? ppw : null
}

function influencerLlmDescriptionText(post: PostItem): string | null {
  const llm = post.influencer?.llm
  if (llm == null) return null
  const rec = { llm } as Record<string, unknown>
  const summary = getProfilePersonaSummary(rec)
  if (summary) return summary
  const row = getLlmDescriptionLine({ llm } as unknown as ProfileListItem)
  if (!row) return null
  return row.tooltip ?? row.line
}

function influencerCardHeadline(post: PostItem, bar: ReturnType<typeof influencerBarData>): string {
  const text = influencerLlmDescriptionText(post)
  if (text) return text
  const name = bar.displayName
  return name !== '—' ? name : '—'
}

function influencerBarData(post: PostItem): {
  profileRef: string
  handleKey: string
  /** Nome de exibição: `full_name` do perfil (API) ou fallback no username sem @. */
  displayName: string
  avatarSrc?: string
  avatarStable?: string
} {
  const profileRef = (post.profile_ref ?? '').trim()
  const inf = post.influencer
  const fullNameRaw = typeof inf?.full_name === 'string' ? inf.full_name.trim() : ''
  const avatarPath = typeof post.avatar_url === 'string' ? post.avatar_url.trim() : ''
  const avatarSrc = avatarPath ? resolveMediaUrl(avatarPath) : undefined
  return {
    profileRef,
    handleKey: profileRef ? '·' : '—',
    displayName: fullNameRaw || '—',
    avatarSrc,
    avatarStable: undefined,
  }
}

function postToConnectSnapshot(post: PostItem): InfluencerConnectSnapshot {
  const bar = influencerBarData(post)
  const fc = post.influencer?.followers_count
  const ppw = getInfluencerPostsPerWeek(post)
  const llmText = influencerLlmDescriptionText(post)
  return {
    displayName: bar.displayName,
    profilePicUrl: bar.avatarSrc,
    stableProfilePicUrl: bar.avatarStable,
    followersCount: typeof fc === 'number' && Number.isFinite(fc) ? fc : undefined,
    postsPerWeek: ppw ?? undefined,
    llmDescription: llmText ?? undefined,
  }
}

function getCaptionDisplayText(post: PostItem, searchQuery: string, hasSearch: boolean): string {
  const c = post.content?.caption_text ?? ''
  const t = typeof c === 'string' ? c.trim() : ''
  if (!t) return ''
  if (hasSearch && searchQuery.trim()) {
    return getCaptionSnippetForSearch(t, searchQuery, 220)
  }
  if (t.length <= 140) return t
  return `${t.slice(0, 140)}…`
}

/** Categoria principal — lê `qualification` mesmo sem `status: done` (como o resumo LLM). */
function getOriginInfluencerMainCategory(inf: PostItem['influencer']): string | null {
  const rec =
    inf != null && typeof inf === 'object' ? (inf as unknown as Record<string, unknown>) : undefined
  const strict = getLlmTripleBadgesFromLlmRoot(rec).categoria?.text
  if (strict) return strict
  const llm = rec?.llm
  if (llm == null || typeof llm !== 'object' || Array.isArray(llm)) return null
  const q = (llm as Record<string, unknown>).qualification
  if (q == null || typeof q !== 'object' || Array.isArray(q)) return null
  const mainCategory = String((q as Record<string, unknown>).mainCategory ?? '').trim()
  if (!mainCategory || mainCategory === '-') return null
  return mainCategory
}

function originCategoryMediaPillStyle(label: string): CSSProperties {
  let h = 0
  const key = label.trim().toLowerCase()
  for (let i = 0; i < key.length; i++) h = (Math.imul(31, h) + key.charCodeAt(i)) | 0
  const hue = Math.abs(h) % 360
  return {
    ...originMediaCategoryFooterBase,
    color: '#fff',
    border: 'none',
    background: `linear-gradient(135deg, hsl(${hue}, 52%, 46%) 0%, hsl(${hue}, 52%, 36%) 100%)`,
  }
}

/** Categoria LLM no rodapé da mídia (substitui Reels/Feed no topo quando houver categoria). */
function OriginMediaCategoryPill({ inf, contentType }: { inf: PostItem['influencer']; contentType: MediaKind }) {
  const raw = getOriginInfluencerMainCategory(inf)
  if (raw) {
    const label = formatFacetLabel(raw)
    return (
      <Tooltip title="Categoria principal">
        <span className="campaign-origin-media-pill" style={originCategoryMediaPillStyle(label)}>
          {label}
        </span>
      </Tooltip>
    )
  }
  return <span style={originMediaKindOverlayStyle(contentType)}>{MEDIA_KIND_SHORT[contentType] ?? contentType}</span>
}

export type OriginGalleryViewMode = 'list' | 'grid'

export default function CampaignOriginGallery({
  campaignId,
  textQuery,
  viewMode = 'list',
  mediaKinds,
  onLoadingChange,
  onOriginSearchSettled,
  /** Perfis dos posts já carregados (acumulado na paginação) — pai calcula facets no cliente. */
  onLoadedPostsForFacets,
  /** Base completa com só o logo à esquerda: desloca o loader/empty para o centro da viewport (metade da coluna + gap). */
  /** Mesmos filtros de perfil da URL (LLM, porte, geo, etc.) — backend restringe handles antes de casar legendas. */
  profileFilters,
  /** Prioridade dos facets do painel BI (porte, LLM, etc.) — só reordena posts no cliente. */
  facetBoostQuery,
  /** Se definido, substitui o `window.open` ao abrir o perfil a partir do card (ex.: convidado sem login). */
  onOpenInfluencerDetail,
  captionFilterReady = true,
  onSearchSuggestion,
}: {
  campaignId: string
  /** Termo da URL / busca; vazio = todo conteúdo indexado dos perfis da campanha. */
  textQuery: string
  /** Lista: card horizontal (legenda). Grade: mosaico 3 colunas como feed de perfil no Instagram. */
  viewMode?: OriginGalleryViewMode
  /** Filtro por tipo(s) de mídia (feed, reels, marcados, destaques); vazio = todos. */
  mediaKinds?: MediaKind[]
  /** Primeira página da busca: `true` enquanto carrega, `false` ao terminar (erro ou sucesso). */
  onLoadingChange?: (loading: boolean) => void
  /** Após a primeira página com termo: `empty` se não houver posts (pai pode ocultar o painel lateral). */
  onOriginSearchSettled?: (payload: { empty: boolean }) => void
  onLoadedPostsForFacets?: (posts: PostItem[]) => void
  profileFilters?: Partial<ProfilesSearchQuery>
  facetBoostQuery?: Partial<ProfilesSearchQuery>
  onOpenInfluencerDetail?: (profileRef: string, snapshot?: InfluencerConnectSnapshot) => void
  /**
   * Com termo de busca: só dispara post-matches quando true (ex.: após handlesOnly no pai),
   * para não duplicar a mesma busca pesada no backend.
   */
  captionFilterReady?: boolean
  /** Clique em chip de sugestão no empty state. */
  onSearchSuggestion?: (term: string) => void
}) {
  const [items, setItems] = useState<PostItem[]>([])
  const [total, setTotal] = useState(0)
  const [scanMeta, setScanMeta] = useState<PostsResponse['scanMeta']>()
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  /** Offset da próxima página na ordenação do servidor (não usar `items.length` — a lista é reordenada no cliente). */
  const [serverOffset, setServerOffset] = useState(0)
  const [loadMoreExhausted, setLoadMoreExhausted] = useState(false)
  const [failedPostImages, setFailedPostImages] = useState<Set<string>>(new Set())
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null)
  const profileFiltersRef = useRef(profileFilters)
  profileFiltersRef.current = profileFilters

  const kindsKey = mediaKinds?.length ? [...mediaKinds].sort().join(',') : ''
  const hasSearchTerm = textQuery.trim().length > 0
  const displayItems = useMemo(
    () => sortPostsByCampaignFacetBoost(items, facetBoostQuery ?? {}),
    [items, facetBoostQuery]
  )
  const facetBoostForApi = useMemo(
    () =>
      hasCampaignFacetBoost(facetBoostQuery ?? {})
        ? pickCampaignFacetBoostFromQuery(facetBoostQuery ?? {})
        : undefined,
    [facetBoostQuery]
  )
  const facetBoostSortKey = useMemo(
    () => JSON.stringify(pickCampaignFacetBoostFromQuery(facetBoostQuery ?? {})),
    [facetBoostQuery]
  )

  useEffect(() => {
    if (!hasCampaignFacetBoost(facetBoostQuery ?? {})) return
    setItems((prev) => sortPostsByCampaignFacetBoost(prev, facetBoostQuery ?? {}))
  }, [facetBoostSortKey, facetBoostQuery])

  const runOpenInfluencerDetail = useCallback(
    (profileRef: string, snapshot?: InfluencerConnectSnapshot) => {
      const ref = (profileRef ?? '').trim()
      if (!ref) return
      if (onOpenInfluencerDetail) {
        onOpenInfluencerDetail(ref, snapshot)
        return
      }
      const path = `/app/campaigns/${campaignId}/influencer/${encodeURIComponent(ref)}`
      const url = typeof window !== 'undefined' ? `${window.location.origin}${path}` : path
      window.open(url, '_blank', 'noopener,noreferrer')
    },
    [campaignId, onOpenInfluencerDetail]
  )

  const handlePostImageError = useCallback((post: PostItem) => {
    queueMediaRefreshFromPost(post)
    setFailedPostImages((prev) => new Set(prev).add(post.key))
  }, [])

  const reload = useCallback(
    async (signal?: AbortSignal) => {
      if (!hasSearchTerm) {
        setItems([])
        setTotal(0)
        setScanMeta(undefined)
        setServerOffset(0)
        setLoadMoreExhausted(false)
        setLoading(false)
        setLoadingMore(false)
        return
      }
      if (!captionFilterReady) {
        setLoading(true)
        return
      }
      setFailedPostImages(new Set())
      setLoadMoreExhausted(false)
      setLoading(true)
      try {
        const res = await fetchCampaignPostMatches(
          campaignId,
          {
            q: textQuery.trim() || undefined,
            mediaKinds: mediaKinds?.length ? mediaKinds : undefined,
            limit: PAGE,
            offset: 0,
          },
          { signal, profileFilters: profileFiltersRef.current, facetBoost: facetBoostForApi }
        )
        const sorted = sortPostsByCampaignFacetBoost(res.items, facetBoostQuery ?? {})
        if (signal?.aborted) return
        setItems(sorted)
        setTotal(res.total)
        setServerOffset(res.items.length)
        setScanMeta(res.scanMeta)
        onLoadedPostsForFacetsRef.current?.(sorted)
      } catch (e) {
        if (signal?.aborted || (e as { name?: string }).name === 'AbortError') return
        setItems([])
        setTotal(0)
        setServerOffset(0)
        setScanMeta(undefined)
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [campaignId, textQuery, kindsKey, hasSearchTerm, captionFilterReady, facetBoostForApi, facetBoostQuery]
  )

  const onLoadedPostsForFacetsRef = useRef(onLoadedPostsForFacets)
  onLoadedPostsForFacetsRef.current = onLoadedPostsForFacets
  useEffect(() => {
    if (!hasSearchTerm) {
      onLoadedPostsForFacetsRef.current?.([])
      return
    }
    if (items.length === 0) return
    onLoadedPostsForFacetsRef.current?.(items)
  }, [items, hasSearchTerm])

  useEffect(() => {
    const ac = new AbortController()
    void reload(ac.signal)
    return () => ac.abort()
  }, [reload])

  const loadMore = useCallback(async () => {
    if (!hasSearchTerm || loadMoreExhausted) return
    const partialMore =
      scanMeta?.partial === true && scanMeta.handlesScanned < scanMeta.handlesTotal
    if ((serverOffset >= total && !partialMore) || loadingMore || loading) return
    setLoadingMore(true)
    const offset = serverOffset
    try {
      const res = await fetchCampaignPostMatches(
        campaignId,
        {
          q: textQuery.trim() || undefined,
          mediaKinds: mediaKinds?.length ? mediaKinds : undefined,
          limit: PAGE,
          offset,
        },
        { profileFilters: profileFiltersRef.current, facetBoost: facetBoostForApi }
      )
      let prevLen = 0
      let mergedLen = 0
      setItems((prev) => {
        prevLen = prev.length
        const byKey = new Map(prev.map((p) => [p.key, p]))
        for (const p of res.items) byKey.set(p.key, p)
        const next = sortPostsByCampaignFacetBoost([...byKey.values()], facetBoostQuery ?? {})
        mergedLen = next.length
        return next
      })
      const nextServerOffset = offset + res.items.length
      setServerOffset(nextServerOffset)
      setTotal((t) => Math.max(t, res.total))
      setScanMeta(res.scanMeta)
      const noProgress = res.items.length === 0 || mergedLen <= prevLen
      const caughtUp = nextServerOffset >= res.total && !partialMore
      if (noProgress || caughtUp) setLoadMoreExhausted(true)
    } catch {
      setLoadMoreExhausted(true)
    } finally {
      setLoadingMore(false)
    }
  }, [
    campaignId,
    textQuery,
    kindsKey,
    serverOffset,
    total,
    loadingMore,
    loading,
    hasSearchTerm,
    loadMoreExhausted,
    facetBoostForApi,
    facetBoostQuery,
    scanMeta,
  ])

  const partialScanMore =
    scanMeta?.partial === true && scanMeta.handlesScanned < scanMeta.handlesTotal
  const hasMoreItems =
    !loadMoreExhausted &&
    (serverOffset < total || partialScanMore)

  const onLoadingChangeRef = useRef(onLoadingChange)
  onLoadingChangeRef.current = onLoadingChange
  useEffect(() => {
    onLoadingChangeRef.current?.(loading && items.length === 0)
  }, [loading, items.length])

  const onOriginSearchSettledRef = useRef(onOriginSearchSettled)
  onOriginSearchSettledRef.current = onOriginSearchSettled
  useEffect(() => {
    if (!hasSearchTerm) {
      onOriginSearchSettledRef.current?.({ empty: false })
      return
    }
    if (loading) return
    onOriginSearchSettledRef.current?.({ empty: items.length === 0 })
  }, [loading, hasSearchTerm, items.length])

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current
    if (!sentinel || !hasMoreItems || total === 0 || loading || loadingMore) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore()
      },
      { rootMargin: '200px', threshold: 0 }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [serverOffset, total, hasMoreItems, loadMore, loading, loadingMore])

  return (
    <div style={{ minWidth: 0 }}>
      {loading && displayItems.length === 0 ? (
        <OriginGalleryLoadingState />
      ) : !hasSearchTerm ? (
        <OriginSearchEmptyState variant="prompt" onSuggestionClick={onSearchSuggestion} />
      ) : displayItems.length === 0 ? (
        <OriginSearchEmptyState
          variant="no-results"
          searchQuery={textQuery}
          onSuggestionClick={onSearchSuggestion}
        />
      ) : (
        <>
          {viewMode === 'grid' ? (
            <div
              className="campaign-origin-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 3,
                minWidth: 0,
              }}
            >
              {displayItems.map((post) => {
                const stableBg = getPostStablePreviewUrl(post)
                const displayUrl = getPostCoverDisplayUrl(post)
                const failed = failedPostImages.has(post.key)
                const bar = influencerBarData(post)
                const handle = bar.handleKey
                const headline = influencerCardHeadline(post, bar)
                const ct = (post.content_type || 'post') as MediaKind
                const openInfluencerDetail = () => runOpenInfluencerDetail(bar.profileRef, postToConnectSnapshot(post))
                const followersCount = post.influencer?.followers_count
                const mediaShellStyle: CSSProperties = {
                  position: 'relative',
                  width: '100%',
                  aspectRatio: '1',
                  overflow: 'hidden',
                  flexShrink: 0,
                  display: 'block',
                  color: 'inherit',
                  textDecoration: 'none',
                  outline: 'none',
                }
                return (
                  <div
                    key={post.key}
                    role={handle !== '—' ? 'button' : undefined}
                    tabIndex={handle !== '—' ? 0 : undefined}
                    onClick={openInfluencerDetail}
                    onKeyDown={(e) => e.key === 'Enter' && openInfluencerDetail()}
                    aria-label={handle !== '—' ? `Ver perfil @${handle}` : undefined}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      minWidth: 0,
                      width: '100%',
                      background: 'var(--app-bg-secondary, #fafafa)',
                      borderRadius: 6,
                      overflow: 'hidden',
                      border: '1px solid var(--app-border, #f0f0f0)',
                      cursor: handle !== '—' ? 'pointer' : 'default',
                    }}
                  >
                    <div style={{ ...mediaShellStyle, display: 'block' }}>
                      <PostPreviewMedia
                        fill
                        imageDisplaySrc={failed ? undefined : displayUrl}
                        stableBackgroundUrl={stableBg}
                        imageUnavailable={failed || !displayUrl}
                        onImageError={() => handlePostImageError(post)}
                      />
                      <OriginMediaCategoryPill inf={post.influencer} contentType={ct} />
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 8,
                        padding: '8px 10px',
                        borderTop: '1px solid var(--app-border, #f0f0f0)',
                        background: 'var(--app-bg, #fff)',
                        minHeight: 44,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          flexShrink: 0,
                          width: 32,
                        }}
                      >
                        <ProfileAvatar
                          src={bar.avatarSrc}
                          stableBackgroundUrl={bar.avatarStable}
                          handle={bar.profileRef || undefined}
                          size={32}
                          fallbackIconSize={16}
                        />
                        {getInfluencerTierShort(followersCount) !== '—' ? (
                          <div style={{ marginTop: 6, display: 'flex', justifyContent: 'center', width: '100%' }}>
                            <InfluencerTierPill followers={followersCount} />
                          </div>
                        ) : null}
                      </div>
                      <div style={{ minWidth: 0, flex: 1, paddingTop: 2 }}>
                        <div
                          style={{
                            fontSize: 10,
                            fontWeight: 500,
                            lineHeight: 1.35,
                            color: 'var(--app-text)',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                          }}
                        >
                          {headline}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {displayItems.map((post) => {
                const stableBg = getPostStablePreviewUrl(post)
                const displayUrl = getPostCoverDisplayUrl(post)
                const failed = failedPostImages.has(post.key)
                const bar = influencerBarData(post)
                const handle = bar.handleKey
                const headline = influencerCardHeadline(post, bar)
                const ct = (post.content_type || 'post') as MediaKind
                const postsPerWeek = getInfluencerPostsPerWeek(post)
                const fc = post.influencer?.followers_count
                const followersLabel = formatFollowersShort(fc)
                const postsPerWeekLabel = postsPerWeek != null ? `${formatPostsPerWeekShort(postsPerWeek)} posts/sem` : null
                const openInfluencerDetail = () => runOpenInfluencerDetail(bar.profileRef, postToConnectSnapshot(post))
                return (
                  <div
                    key={post.key}
                    role={bar.profileRef ? 'button' : undefined}
                    tabIndex={bar.profileRef ? 0 : undefined}
                    onClick={openInfluencerDetail}
                    onKeyDown={(e) => e.key === 'Enter' && openInfluencerDetail()}
                    aria-label={bar.profileRef ? 'Ver perfil do criador' : undefined}
                    className="campaign-origin-list-card"
                    style={{
                      borderRadius: 14,
                      overflow: 'hidden',
                      border: '1px solid var(--app-border, #e8e8e8)',
                      background: 'var(--app-bg, #fff)',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                      cursor: handle !== '—' ? 'pointer' : 'default',
                    }}
                  >
                    <div className="campaign-origin-list-card__body">
                      <div className="campaign-origin-list-card__influencer">
                        <div
                          className={`campaign-origin-list-card__media${ct === 'reel' ? ' campaign-origin-list-card__media--reel' : ''}`}
                        >
                          <PostPreviewMedia
                            fill
                            imageDisplaySrc={failed ? undefined : displayUrl}
                            stableBackgroundUrl={stableBg}
                            imageUnavailable={failed || !displayUrl}
                            onImageError={() => handlePostImageError(post)}
                          />
                          <OriginMediaCategoryPill inf={post.influencer} contentType={ct} />
                        </div>
                        <div
                          style={{
                            flexShrink: 0,
                            borderTop: '1px solid var(--app-border-light, #f0f0f0)',
                            padding: '12px 10px 14px',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'flex-start',
                            gap: 8,
                            background: 'var(--app-bg, #fff)',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'row',
                              alignItems: 'flex-start',
                              gap: 10,
                              width: '100%',
                              minWidth: 0,
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                flexShrink: 0,
                                width: 56,
                              }}
                            >
                              <ProfileAvatar
                                src={bar.avatarSrc}
                                stableBackgroundUrl={bar.avatarStable}
                                handle={bar.profileRef || undefined}
                                size={56}
                                fallbackIconSize={24}
                              />
                              {getInfluencerTierShort(fc) !== '—' ? (
                                <div style={{ marginTop: 6, display: 'flex', justifyContent: 'center', width: '100%' }}>
                                  <InfluencerTierPill followers={fc} />
                                </div>
                              ) : null}
                            </div>
                            <div
                              style={{
                                flex: 1,
                                minWidth: 0,
                                paddingTop: 2,
                                textAlign: 'left',
                              }}
                            >
                              <div
                                style={{
                                  fontSize: 11,
                                  fontWeight: 500,
                                  color: 'var(--app-text)',
                                  lineHeight: 1.35,
                                  whiteSpace: 'pre-wrap',
                                  wordBreak: 'break-word',
                                }}
                              >
                                {headline}
                              </div>
                              {postsPerWeekLabel != null || followersLabel ? (
                                <div
                                  style={{
                                    display: 'flex',
                                    flexWrap: 'wrap',
                                    alignItems: 'center',
                                    justifyContent: 'flex-start',
                                    gap: 6,
                                    marginTop: 6,
                                    lineHeight: 1.25,
                                    width: '100%',
                                    minWidth: 0,
                                  }}
                                >
                                  {followersLabel ? (
                                    <span style={{ fontSize: 10, color: 'var(--app-text-secondary)' }}>{followersLabel}</span>
                                  ) : null}
                                  {followersLabel && postsPerWeekLabel ? (
                                    <span style={{ fontSize: 10, color: 'var(--app-text-tertiary, #bfbfbf)' }} aria-hidden>
                                      ·
                                    </span>
                                  ) : null}
                                  {postsPerWeekLabel ? (
                                    <Tooltip title={METRIC_TOOLTIPS.postsPerSemana}>
                                      <span
                                        style={{
                                          fontSize: 10,
                                          fontWeight: 700,
                                          color: 'var(--app-primary, #722ed1)',
                                          cursor: 'help',
                                        }}
                                      >
                                        {postsPerWeekLabel}
                                      </span>
                                    </Tooltip>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="campaign-origin-list-card__caption">
                        <Text style={{ fontSize: 12, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--app-text)' }}>
                          <HighlightedSearchText
                            text={getCaptionDisplayText(post, textQuery, hasSearchTerm) || '—'}
                            query={hasSearchTerm ? textQuery : ''}
                          />
                        </Text>
                        {post.metrics && (post.metrics.likes != null || post.metrics.comments != null) ? (
                          <Text style={{ fontSize: 12, display: 'block', color: 'var(--app-text-secondary)' }}>
                            {post.metrics.likes != null && (
                              <span style={{ fontWeight: 600, color: 'var(--app-text)' }}>
                                {post.metrics.likes.toLocaleString('pt-BR')} curtidas
                              </span>
                            )}
                            {post.metrics.likes != null && post.metrics.comments != null && ' · '}
                            {post.metrics.comments != null && (
                              <span>{post.metrics.comments.toLocaleString('pt-BR')} comentários</span>
                            )}
                          </Text>
                        ) : null}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {hasMoreItems || loadingMore ? (
            <div className="campaign-origin-load-footer">
              {hasMoreItems ? (
                <div ref={loadMoreSentinelRef} className="campaign-origin-load-sentinel" aria-hidden />
              ) : null}
              {loadingMore ? (
                <div
                  className="campaign-origin-load-more"
                  role="status"
                  aria-live="polite"
                  aria-label="Carregando mais publicações"
                >
                  <span className="campaign-origin-load-more__dot" />
                  <span className="campaign-origin-load-more__dot" />
                  <span className="campaign-origin-load-more__dot" />
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
