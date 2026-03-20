/**
 * Galeria estilo Instagram: posts/reels onde o termo de busca aparece (dados atuais do índice).
 */
import { useEffect, useState, useCallback, useRef, type CSSProperties, type ReactNode } from 'react'
import { Typography, Spin, Empty, Tooltip } from 'antd'
import {
  fetchCampaignPostMatches,
  getPostCoverDisplayUrl,
  getPostStablePreviewUrl,
  proxyImageUrl,
  proxyImageUrlForDisplay,
  type PostItem,
  type MediaKind,
} from '../api'
import { PostPreviewMedia } from './PostPreviewCard'
import ProfileAvatar from './ProfileAvatar'
import { METRIC_TOOLTIPS } from '../constants/metricTooltips'
import {
  getInfluencerTierGradientCss,
  getInfluencerTierShort,
  getInfluencerTierTooltip,
} from '../utils/influencerTier'

const { Text } = Typography

/** Selo Nano/Micro/Mid/Macro — mesmo padrão da tabela de influenciadores da campanha. */
function InfluencerTierPill({ followers }: { followers: number | undefined | null }) {
  const short = getInfluencerTierShort(followers)
  if (short === '—') return null
  return (
    <Tooltip title={getInfluencerTierTooltip(followers)}>
      <span
        style={{
          fontSize: 9,
          fontWeight: 600,
          color: '#fff',
          padding: '1px 5px',
          borderRadius: 8,
          flexShrink: 0,
          background: getInfluencerTierGradientCss(short),
          lineHeight: 1.2,
          display: 'inline-block',
        }}
      >
        {short}
      </span>
    </Tooltip>
  )
}

const PAGE = 24

/** Modo lista: mesma largura para coluna mídia + perfil (feed, marcados, reels). */
const LIST_ORIGIN_MEDIA_COLUMN_PX = 256

const MEDIA_KIND_SHORT: Record<MediaKind, string> = {
  post: 'Feed',
  reel: 'Reels',
  tagged: 'Marcados',
  highlight: 'Destaques',
}

/** Pill sobre a mídia (topo esquerdo), leitura em foto clara/escura. */
function originMediaKindOverlayStyle(ct: MediaKind): CSSProperties {
  const base: CSSProperties = {
    position: 'absolute',
    top: 8,
    left: 8,
    zIndex: 2,
    fontSize: 10,
    fontWeight: 700,
    lineHeight: 1.25,
    padding: '5px 9px',
    borderRadius: 999,
    color: '#fff',
    pointerEvents: 'none',
    boxShadow: '0 1px 6px rgba(0,0,0,0.35)',
    letterSpacing: '0.02em',
  }
  switch (ct) {
    case 'reel':
      return { ...base, background: 'linear-gradient(135deg, #c084fc 0%, #7c3aed 100%)' }
    case 'tagged':
      return { ...base, background: 'linear-gradient(135deg, #fb7185 0%, #db2777 100%)' }
    case 'highlight':
      return { ...base, background: 'linear-gradient(135deg, #38bdf8 0%, #0284c7 100%)' }
    default:
      return { ...base, background: 'linear-gradient(135deg, #60a5fa 0%, #2563eb 100%)' }
  }
}

function formatFollowersShort(n: number | undefined | null): string | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M seguidores`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k seguidores`
  return `${n.toLocaleString('pt-BR')} seguidores`
}

/** ER do post: (curtidas + comentários) / seguidores. */
function getPostEngagementRatePercent(post: PostItem): number | null {
  const fc = post.influencer?.followers_count
  if (typeof fc !== 'number' || !Number.isFinite(fc) || fc <= 0) return null
  const likes = typeof post.metrics?.likes === 'number' && Number.isFinite(post.metrics.likes) ? post.metrics.likes : 0
  const comments =
    typeof post.metrics?.comments === 'number' && Number.isFinite(post.metrics.comments) ? post.metrics.comments : 0
  return Math.round(((likes + comments) / fc) * 10000) / 100
}

function getInstagramPostUrl(post: PostItem): string | null {
  const raw = post.post?.shortcode ?? (typeof post.key === 'string' ? post.key.split(':')[1] : undefined)
  const shortcode = typeof raw === 'string' ? raw.trim() : ''
  if (!shortcode) return null
  const safe = encodeURIComponent(shortcode)
  const ct = (post.content_type || 'post') as MediaKind
  if (ct === 'reel') return `https://www.instagram.com/reel/${safe}/`
  return `https://www.instagram.com/p/${safe}/`
}

function influencerBarData(post: PostItem): {
  handleKey: string
  /** Nome de exibição: `full_name` do perfil (API) ou fallback no username sem @. */
  displayName: string
  atLine: string
  avatarSrc?: string
  avatarStable?: string
} {
  const raw = post.profile_handle ?? post.influencer?.username ?? ''
  const h = raw.replace(/^@/, '').trim()
  const inf = post.influencer
  const fullNameRaw = typeof inf?.full_name === 'string' ? inf.full_name.trim() : ''
  const picRaw = inf?.profile_pic_url
  const stable =
    typeof inf?.stable_profile_pic_url === 'string' && inf.stable_profile_pic_url.startsWith('http')
      ? inf.stable_profile_pic_url
      : undefined
  let avatarSrc: string | undefined
  if (picRaw) {
    avatarSrc = (proxyImageUrlForDisplay(picRaw) ?? proxyImageUrl(picRaw)) || undefined
  } else if (stable) {
    avatarSrc = (proxyImageUrlForDisplay(stable) ?? proxyImageUrl(stable)) || undefined
  }
  return {
    handleKey: h || '—',
    displayName: fullNameRaw || h || '—',
    atLine: h ? `@${h}` : '—',
    avatarSrc,
    avatarStable: stable,
  }
}

function getCaptionSnippet(post: PostItem, max = 140): string {
  const c = post.content?.caption_text ?? ''
  const t = typeof c === 'string' ? c.trim() : ''
  if (!t) return ''
  if (t.length <= max) return t
  return `${t.slice(0, max)}…`
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Destaca ocorrências da palavra/frase (case insensitive), inclusive dentro de hashtags (#modafeminina). */
function highlightKeywordInText(text: string, keyword: string): ReactNode {
  const q = keyword.trim()
  if (!q || !text) return text
  try {
    const re = new RegExp(`(${escapeRegExp(q)})`, 'gi')
    const parts = text.split(re)
    return parts.map((part, i) => {
      if (part.toLowerCase() === q.toLowerCase()) {
        return (
          <mark
            key={i}
            style={{
              backgroundColor: 'rgba(250, 204, 21, 0.48)',
              color: 'inherit',
              padding: '0 2px',
              borderRadius: 3,
              fontWeight: 600,
            }}
          >
            {part}
          </mark>
        )
      }
      return <span key={i}>{part}</span>
    })
  } catch {
    return text
  }
}

export type OriginGalleryViewMode = 'list' | 'grid'

export default function CampaignOriginGallery({
  campaignId,
  textQuery,
  viewMode = 'list',
  mediaKinds,
}: {
  campaignId: string
  /** Termo da URL / busca; vazio = todo conteúdo indexado dos perfis da campanha. */
  textQuery: string
  /** Lista: card horizontal (legenda). Grade: mosaico 3 colunas como feed de perfil no Instagram. */
  viewMode?: OriginGalleryViewMode
  /** Filtro por tipo(s) de mídia (feed, reels, marcados, destaques); vazio = todos. */
  mediaKinds?: MediaKind[]
}) {
  const [items, setItems] = useState<PostItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [failedPostImages, setFailedPostImages] = useState<Set<string>>(new Set())
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null)

  const kindsKey = mediaKinds?.length ? [...mediaKinds].sort().join(',') : ''

  const reload = useCallback(async () => {
    setFailedPostImages(new Set())
    setLoading(true)
    try {
      const res = await fetchCampaignPostMatches(campaignId, {
        q: textQuery.trim() || undefined,
        mediaKinds: mediaKinds?.length ? mediaKinds : undefined,
        limit: PAGE,
        offset: 0,
      })
      setItems(res.items)
      setTotal(res.total)
    } catch {
      setItems([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [campaignId, textQuery, kindsKey])

  useEffect(() => {
    void reload()
  }, [reload])

  const loadMore = useCallback(async () => {
    if (items.length >= total || loadingMore || loading) return
    setLoadingMore(true)
    try {
      const res = await fetchCampaignPostMatches(campaignId, {
        q: textQuery.trim() || undefined,
        mediaKinds: mediaKinds?.length ? mediaKinds : undefined,
        limit: PAGE,
        offset: items.length,
      })
      setItems((prev) => [...prev, ...res.items])
    } catch {
      /* ignore */
    } finally {
      setLoadingMore(false)
    }
  }, [campaignId, textQuery, kindsKey, items.length, total, loadingMore, loading])

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current
    if (!sentinel || items.length >= total || total === 0 || loading || loadingMore) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore()
      },
      { rootMargin: '200px', threshold: 0 }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [items.length, total, loadMore, loading, loadingMore])

  return (
    <div style={{ minWidth: 0 }}>
      {loading && items.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin size="large" />
        </div>
      ) : items.length === 0 ? (
        <Empty description={textQuery.trim() ? 'Nenhum post encontrado com esse termo.' : 'Nenhum post indexado para estes perfis.'} />
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
              {items.map((post) => {
                const stableBg = getPostStablePreviewUrl(post)
                const displayUrl = getPostCoverDisplayUrl(post)
                const failed = failedPostImages.has(post.key)
                const bar = influencerBarData(post)
                const handle = bar.handleKey
                const ct = (post.content_type || 'post') as MediaKind
                const openInfluencerDetail = () => {
                  if (handle !== '—') {
                    const path = `/app/campaigns/${campaignId}/influencer/${encodeURIComponent(handle)}`
                    const url = typeof window !== 'undefined' ? `${window.location.origin}${path}` : path
                    window.open(url, '_blank', 'noopener,noreferrer')
                  }
                }
                const igUrl = getInstagramPostUrl(post)
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
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      minWidth: 0,
                      width: '100%',
                      background: 'var(--app-bg-secondary, #fafafa)',
                      borderRadius: 6,
                      overflow: 'hidden',
                      border: '1px solid var(--app-border, #f0f0f0)',
                    }}
                  >
                    {igUrl ? (
                      <a
                        href={igUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Abrir publicação no Instagram"
                        style={mediaShellStyle}
                      >
                        <PostPreviewMedia
                          fill
                          imageDisplaySrc={failed ? undefined : displayUrl}
                          stableBackgroundUrl={stableBg}
                          imageUnavailable={failed || !displayUrl}
                          onImageError={() => setFailedPostImages((prev) => new Set(prev).add(post.key))}
                        />
                        <span style={originMediaKindOverlayStyle(ct)}>{MEDIA_KIND_SHORT[ct] ?? ct}</span>
                      </a>
                    ) : (
                      <div style={{ ...mediaShellStyle, display: 'block', cursor: 'default' }}>
                        <PostPreviewMedia
                          fill
                          imageDisplaySrc={failed ? undefined : displayUrl}
                          stableBackgroundUrl={stableBg}
                          imageUnavailable={failed || !displayUrl}
                          onImageError={() => setFailedPostImages((prev) => new Set(prev).add(post.key))}
                        />
                        <span style={originMediaKindOverlayStyle(ct)}>{MEDIA_KIND_SHORT[ct] ?? ct}</span>
                      </div>
                    )}
                    <div
                      role={handle !== '—' ? 'button' : undefined}
                      tabIndex={handle !== '—' ? 0 : undefined}
                      onClick={openInfluencerDetail}
                      onKeyDown={(e) => e.key === 'Enter' && openInfluencerDetail()}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 8,
                        padding: '8px 10px',
                        borderTop: '1px solid var(--app-border, #f0f0f0)',
                        background: 'var(--app-bg, #fff)',
                        minHeight: 44,
                        cursor: handle !== '—' ? 'pointer' : 'default',
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
                          handle={handle !== '—' ? handle : undefined}
                          size={32}
                          fallbackIconSize={16}
                          queueOnError={false}
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
                            fontSize: 12,
                            fontWeight: 600,
                            lineHeight: 1.25,
                            color: 'var(--app-text)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {bar.displayName}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            lineHeight: 1.25,
                            color: 'var(--app-primary, #722ed1)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            marginTop: 2,
                          }}
                        >
                          {bar.atLine}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {items.map((post) => {
                const stableBg = getPostStablePreviewUrl(post)
                const displayUrl = getPostCoverDisplayUrl(post)
                const failed = failedPostImages.has(post.key)
                const bar = influencerBarData(post)
                const handle = bar.handleKey
                const ct = (post.content_type || 'post') as MediaKind
                const er = getPostEngagementRatePercent(post)
                const fc = post.influencer?.followers_count
                const followersLabel = formatFollowersShort(fc)
                const openInfluencerDetail = () => {
                  if (handle !== '—') {
                    const path = `/app/campaigns/${campaignId}/influencer/${encodeURIComponent(handle)}`
                    const url = typeof window !== 'undefined' ? `${window.location.origin}${path}` : path
                    window.open(url, '_blank', 'noopener,noreferrer')
                  }
                }
                const igUrl = getInstagramPostUrl(post)
                const listMediaShellStyle: CSSProperties = {
                  position: 'relative',
                  width: '100%',
                  flexShrink: 0,
                  overflow: 'hidden',
                  display: 'block',
                  color: 'inherit',
                  textDecoration: 'none',
                  outline: 'none',
                  ...(ct === 'reel' ? { aspectRatio: '1' } : { height: 320 }),
                }
                return (
                  <div
                    key={post.key}
                    style={{
                      borderRadius: 14,
                      overflow: 'hidden',
                      border: '1px solid var(--app-border, #e8e8e8)',
                      background: 'var(--app-bg, #fff)',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'row',
                        alignItems: 'stretch',
                        minHeight: 0,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          width: LIST_ORIGIN_MEDIA_COLUMN_PX,
                          minWidth: LIST_ORIGIN_MEDIA_COLUMN_PX,
                          flexShrink: 0,
                          textAlign: 'left',
                          overflow: 'hidden',
                          borderRight: '1px solid var(--app-border-light, #f0f0f0)',
                          background: 'var(--app-bg-secondary, #fafafa)',
                        }}
                      >
                        {igUrl ? (
                          <a
                            href={igUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="Abrir publicação no Instagram"
                            style={listMediaShellStyle}
                          >
                            <PostPreviewMedia
                              fill
                              imageDisplaySrc={failed ? undefined : displayUrl}
                              stableBackgroundUrl={stableBg}
                              imageUnavailable={failed || !displayUrl}
                              onImageError={() => setFailedPostImages((prev) => new Set(prev).add(post.key))}
                            />
                            <span style={originMediaKindOverlayStyle(ct)}>{MEDIA_KIND_SHORT[ct] ?? ct}</span>
                          </a>
                        ) : (
                          <div style={{ ...listMediaShellStyle, cursor: 'default' }}>
                            <PostPreviewMedia
                              fill
                              imageDisplaySrc={failed ? undefined : displayUrl}
                              stableBackgroundUrl={stableBg}
                              imageUnavailable={failed || !displayUrl}
                              onImageError={() => setFailedPostImages((prev) => new Set(prev).add(post.key))}
                            />
                            <span style={originMediaKindOverlayStyle(ct)}>{MEDIA_KIND_SHORT[ct] ?? ct}</span>
                          </div>
                        )}
                        <div
                          role={handle !== '—' ? 'button' : undefined}
                          tabIndex={handle !== '—' ? 0 : undefined}
                          onClick={openInfluencerDetail}
                          onKeyDown={(e) => e.key === 'Enter' && openInfluencerDetail()}
                          style={{
                            padding: '10px 10px 12px',
                            borderTop: '1px solid var(--app-border-light, #f0f0f0)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 8,
                            flex: 1,
                            minHeight: 0,
                            cursor: handle !== '—' ? 'pointer' : 'default',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                            <div
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                flexShrink: 0,
                                width: 36,
                              }}
                            >
                              <ProfileAvatar
                                src={bar.avatarSrc}
                                stableBackgroundUrl={bar.avatarStable}
                                handle={handle !== '—' ? handle : undefined}
                                size={36}
                                fallbackIconSize={16}
                                queueOnError={false}
                              />
                              {getInfluencerTierShort(fc) !== '—' ? (
                                <div style={{ marginTop: 6, display: 'flex', justifyContent: 'center', width: '100%' }}>
                                  <InfluencerTierPill followers={fc} />
                                </div>
                              ) : null}
                            </div>
                            <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
                              <div
                                style={{
                                  fontSize: 13,
                                  fontWeight: 700,
                                  color: 'var(--app-text)',
                                  lineHeight: 1.3,
                                  overflow: 'hidden',
                                  display: '-webkit-box',
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: 'vertical',
                                }}
                              >
                                {bar.displayName}
                              </div>
                              <div
                                style={{
                                  fontSize: 12,
                                  color: 'var(--app-primary, #722ed1)',
                                  fontWeight: 600,
                                  marginTop: 2,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {bar.atLine}
                              </div>
                              {er != null || followersLabel ? (
                                <div
                                  style={{
                                    display: 'flex',
                                    flexWrap: 'wrap',
                                    alignItems: 'center',
                                    gap: 6,
                                    marginTop: 4,
                                    lineHeight: 1.25,
                                  }}
                                >
                                  {followersLabel ? (
                                    <span style={{ fontSize: 10, color: 'var(--app-text-secondary)' }}>{followersLabel}</span>
                                  ) : null}
                                  {followersLabel && er != null ? (
                                    <span style={{ fontSize: 10, color: 'var(--app-text-tertiary, #bfbfbf)' }} aria-hidden>
                                      ·
                                    </span>
                                  ) : null}
                                  {er != null ? (
                                    <Tooltip title={METRIC_TOOLTIPS.erPost}>
                                      <span
                                        style={{
                                          fontSize: 10,
                                          fontWeight: 700,
                                          color: 'var(--app-primary, #722ed1)',
                                          cursor: 'help',
                                        }}
                                      >
                                        {er.toFixed(1)}% eng.
                                      </span>
                                    </Tooltip>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div
                        style={{
                          flex: 1,
                          minWidth: 0,
                          padding: '14px 18px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 12,
                          background: 'var(--app-bg, #fff)',
                        }}
                      >
                        <Text style={{ fontSize: 12, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--app-text)' }}>
                          {highlightKeywordInText(getCaptionSnippet(post, 99999) || '—', textQuery)}
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
          {items.length < total && (
            <div
              ref={loadMoreSentinelRef}
              style={{ minHeight: 1, marginTop: 16 }}
              aria-hidden
            />
          )}
          {loadingMore && (
            <div style={{ textAlign: 'center', marginTop: 12 }}>
              <Spin size="small" />
            </div>
          )}
          <Text style={{ display: 'block', marginTop: 12, fontSize: 12, color: 'var(--app-text-secondary)' }}>
            {items.length} de {total} {total === 1 ? 'item' : 'itens'}
          </Text>
        </>
      )}
    </div>
  )
}
