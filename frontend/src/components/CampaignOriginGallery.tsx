/**
 * Galeria estilo Instagram: posts/reels onde o termo de busca aparece (dados atuais do índice).
 */
import { useEffect, useState, useCallback, useRef, type ReactNode } from 'react'
import { Row, Col, Typography, Spin, Empty, Tag } from 'antd'
import { PlayCircleOutlined } from '@ant-design/icons'
import { fetchCampaignPostMatches, proxyImageUrl, type PostItem, type MediaKind } from '../api'

const MEDIA_KIND_LABELS: Record<MediaKind, string> = {
  post: 'Feed',
  reel: 'Reels',
  tagged: 'Marcados',
  highlight: 'Destaques',
}

const { Text } = Typography

const PAGE = 24

function getPostImageUrl(post: PostItem): string | undefined {
  const cover = post.media?.cover_images?.[0]?.url
  if (cover) return cover
  return post.image_url
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

function getPostLink(post: PostItem): string | null {
  const sc = post.post?.shortcode
  const h = post.profile_handle ?? post.influencer?.username
  if (!sc || !h) return null
  const ct = post.content_type || 'post'
  if (ct === 'reel') return `https://www.instagram.com/reel/${sc}/`
  return `https://www.instagram.com/p/${sc}/`
}

export default function CampaignOriginGallery({
  campaignId,
  textQuery,
}: {
  campaignId: string
  /** Termo da URL / busca; vazio = todo conteúdo indexado dos perfis da campanha. */
  textQuery: string
}) {
  const [items, setItems] = useState<PostItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchCampaignPostMatches(campaignId, {
        q: textQuery.trim() || undefined,
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
  }, [campaignId, textQuery])

  useEffect(() => {
    void reload()
  }, [reload])

  const loadMore = useCallback(async () => {
    if (items.length >= total || loadingMore || loading) return
    setLoadingMore(true)
    try {
      const res = await fetchCampaignPostMatches(campaignId, {
        q: textQuery.trim() || undefined,
        limit: PAGE,
        offset: items.length,
      })
      setItems((prev) => [...prev, ...res.items])
    } catch {
      /* ignore */
    } finally {
      setLoadingMore(false)
    }
  }, [campaignId, textQuery, items.length, total, loadingMore, loading])

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
          <Row gutter={[10, 10]}>
            {items.map((post) => {
              const img = proxyImageUrl(getPostImageUrl(post) ?? '')
              const handle = post.profile_handle ?? post.influencer?.username ?? '—'
              const ct = (post.content_type || 'post') as MediaKind
              const isReel = ct === 'reel'
              const openInfluencerDetail = () => {
                if (handle !== '—') {
                  const path = `/app/campaigns/${campaignId}/influencer/${encodeURIComponent(handle)}`
                  const url = typeof window !== 'undefined' ? `${window.location.origin}${path}` : path
                  window.open(url, '_blank', 'noopener,noreferrer')
                }
              }
              return (
                <Col key={post.key} xs={12} sm={12} style={{ minWidth: 0 }}>
                  <div
                    role={handle !== '—' ? 'button' : undefined}
                    tabIndex={handle !== '—' ? 0 : undefined}
                    onClick={openInfluencerDetail}
                    onKeyDown={(e) => e.key === 'Enter' && openInfluencerDetail()}
                    style={{
                      borderRadius: 12,
                      overflow: 'hidden',
                      border: '1px solid var(--app-border, #f0f0f0)',
                      background: 'var(--app-bg-secondary, #fafafa)',
                      cursor: handle !== '—' ? 'pointer' : 'default',
                      display: 'flex',
                      flexDirection: 'row',
                      minHeight: 220,
                    }}
                  >
                    <div
                      style={{
                        position: 'relative',
                        width: 130,
                        minWidth: 130,
                        flexShrink: 0,
                        background: 'var(--app-placeholder-bg, #eee)',
                        height: 220,
                      }}
                    >
                      {img ? (
                        <img
                          src={img}
                          alt=""
                          style={{
                            position: 'absolute',
                            inset: 0,
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            position: 'absolute',
                            inset: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'var(--app-text-tertiary)',
                            fontSize: 12,
                          }}
                        >
                          Sem imagem
                        </div>
                      )}
                      {isReel && (
                        <PlayCircleOutlined
                          style={{
                            position: 'absolute',
                            bottom: 8,
                            right: 8,
                            fontSize: 24,
                            color: 'rgba(255,255,255,0.92)',
                            filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))',
                          }}
                        />
                      )}
                      <div style={{ position: 'absolute', top: 6, left: 6 }}>
                        <Tag style={{ margin: 0, fontSize: 10 }}>{MEDIA_KIND_LABELS[ct] ?? ct}</Tag>
                      </div>
                    </div>
                    <div style={{ padding: '12px 14px', flex: 1, minWidth: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', justifyContent: 'flex-start' }}>
                      <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 4, color: 'var(--app-primary, #722ed1)' }}>
                        @{handle}
                      </Text>
                      <Text type="secondary" style={{ fontSize: 11, lineHeight: 1.35, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {highlightKeywordInText(getCaptionSnippet(post, 99999) || '—', textQuery)}
                      </Text>
                      {post.metrics && (
                        <Text type="secondary" style={{ fontSize: 10, marginTop: 6, display: 'block' }}>
                          {post.metrics.likes != null && `${post.metrics.likes.toLocaleString('pt-BR')} curtidas`}
                          {post.metrics.comments != null && ` · ${post.metrics.comments.toLocaleString('pt-BR')} com.`}
                        </Text>
                      )}
                    </div>
                  </div>
                </Col>
              )
            })}
          </Row>
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
          <Text type="secondary" style={{ display: 'block', marginTop: 12, fontSize: 12 }}>
            {items.length} de {total} {total === 1 ? 'item' : 'itens'}
          </Text>
        </>
      )}
    </div>
  )
}
