/**
 * Seção "Análise de destaques": nome e quantidade de itens (stories) em cada destaque.
 * Destaques não têm métricas de engajamento; exibimos total/média de itens e lista com nome + quantidade.
 */
import { useMemo, useState } from 'react'
import { Row, Col, Tooltip, Modal } from 'antd'
import { UnorderedListOutlined, StarOutlined, RiseOutlined } from '@ant-design/icons'
import { reportTokens as t } from '../pages/reportTokens'
import { METRIC_TOOLTIPS } from '../constants/metricTooltips'
import type { PostItem } from '../api'

const { spacing: s, colors: c, typography: typ, shadow: sh, radius: rad } = t
const typH2 = t.typography.h2 as { fontSize: number; fontWeight: number }
const typH3 = t.typography.h3 as { fontSize: number; fontWeight: number }

/** Extrai quantidade de itens do destaque (post.highlight_item_count). */
function getHighlightItemCount(post: PostItem): number {
  const p = post.post as { highlight_item_count?: number } | undefined
  return typeof p?.highlight_item_count === 'number' && p.highlight_item_count >= 0 ? p.highlight_item_count : 0
}

/** Nome do destaque (título). */
function getHighlightName(post: PostItem): string {
  const name = post.content?.caption_text?.trim()
  return name || 'Destaque'
}

/** Data do destaque (ISO YYYY-MM-DD) ou "há X sem" quando só temos semanas. */
function getHighlightDateLabel(post: PostItem): string | null {
  const p = post.post as { highlight_date_iso?: string; highlight_weeks_ago?: number } | undefined
  if (p?.highlight_date_iso) {
    const [y, m] = p.highlight_date_iso.split('-')
    const months = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
    const month = months[parseInt(m ?? '1', 10) - 1] ?? m
    return `${month}/${y}`
  }
  if (typeof p?.highlight_weeks_ago === 'number' && p.highlight_weeks_ago >= 0) {
    return `há ${p.highlight_weeks_ago} sem`
  }
  return null
}

export interface HighlightsAnalysisSectionProps {
  /** Lista de destaques (content_type === 'highlight'). */
  highlights: PostItem[]
  /** Set de keys de posts cuja imagem falhou ao carregar. */
  failedPostImages: Set<string>
  /** Retorna URL da imagem do post. */
  getPostImageUrl: (post: PostItem) => string | undefined
  /** Retorna link do post (ex.: Instagram). */
  getPostLink: (post: PostItem) => string
  /** Aplica proxy na URL da imagem. */
  proxyImageUrl: (url: string | undefined) => string | undefined
  /** Espaçamento inferior da seção. */
  gap?: number
}

export function HighlightsAnalysisSection({
  highlights,
  failedPostImages,
  getPostImageUrl,
  getPostLink,
  proxyImageUrl,
  gap = s.xl,
}: HighlightsAnalysisSectionProps) {
  const { totalItems, avgItems, byItemCount } = useMemo(() => {
    const withCount = highlights.map((post) => ({
      post,
      itemCount: getHighlightItemCount(post),
      name: getHighlightName(post),
    }))
    const total = withCount.reduce((acc, { itemCount }) => acc + itemCount, 0)
    const avg = highlights.length > 0 ? Math.round(total / highlights.length) : 0
    const sorted = [...withCount].sort((a, b) => b.itemCount - a.itemCount)
    return { totalItems: total, avgItems: avg, byItemCount: sorted }
  }, [highlights])

  const topHighlights = byItemCount.slice(0, 4)
  const allHighlights = byItemCount
  const [galleryModalOpen, setGalleryModalOpen] = useState(false)

  if (highlights.length === 0) return null

  return (
    <div style={{ marginBottom: gap }}>
      <h2 className="section-h2" style={{ ...typH2, color: c.text, textAlign: 'center', marginBottom: s.sm }}>
        Análise de destaques
      </h2>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: s.md,
          alignItems: 'stretch',
          justifyContent: 'center',
          marginBottom: s.xl,
        }}
      >
        <Tooltip title="Soma dos itens (stories) em todos os destaques." placement="top">
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              cursor: 'help',
              padding: `${s.sm}px ${s.lg}px`,
              background: c.cardBgSoft,
              borderRadius: 12,
              border: `1px solid ${c.borderLight}`,
              boxShadow: 'var(--app-shadow-lg)',
            }}
          >
            <UnorderedListOutlined style={{ fontSize: 20, color: c.primary }} />
            <span>
              <strong style={{ ...typ.body, fontSize: 15, color: c.text }}>{totalItems.toLocaleString('pt-BR')}</strong>{' '}
              <span style={{ color: c.textSecondary, fontSize: 13 }}>itens no total</span>
            </span>
          </div>
        </Tooltip>
        <Tooltip title="Média de itens por destaque." placement="top">
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              cursor: 'help',
              padding: `${s.sm}px ${s.lg}px`,
              background: c.cardBgSoft,
              borderRadius: 12,
              border: `1px solid ${c.borderLight}`,
              boxShadow: 'var(--app-shadow-lg)',
            }}
          >
            <RiseOutlined style={{ fontSize: 20, color: c.primary }} />
            <span>
              <strong style={{ ...typ.body, fontSize: 15, color: c.text }}>{avgItems.toLocaleString('pt-BR')}</strong>{' '}
              <span style={{ color: c.textSecondary, fontSize: 13 }}>média itens/destaque</span>
            </span>
          </div>
        </Tooltip>
        <Tooltip title={METRIC_TOOLTIPS.totalPosts} placement="top">
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              cursor: 'help',
              padding: `${s.sm}px ${s.lg}px`,
              background: c.cardBgSoft,
              borderRadius: 12,
              border: `1px solid ${c.borderLight}`,
              boxShadow: 'var(--app-shadow-lg)',
            }}
          >
            <StarOutlined style={{ fontSize: 20, color: 'var(--app-icon-image)' }} />
            <span>
              <strong style={{ ...typ.body, fontSize: 15, color: c.text }}>{highlights.length}</strong>{' '}
              <span style={{ color: c.textSecondary, fontSize: 13 }}>destaques</span>
            </span>
          </div>
        </Tooltip>
      </div>

      {topHighlights.length > 0 && (
        <Row gutter={[s.lg, s.lg]}>
          <Col xs={24}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: s.sm, marginBottom: s.sm }}>
              <div style={{ ...typH3, color: c.textSecondary, margin: 0 }}>
                Destaques por quantidade de itens
              </div>
              {allHighlights.length > 4 && (
                <a
                  onClick={() => setGalleryModalOpen(true)}
                  style={{ ...typ.caption, color: c.primary, fontWeight: 600, cursor: 'pointer' }}
                >
                  Ver mais
                </a>
              )}
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                gap: s.lg,
                width: '100%',
              }}
              role="list"
            >
              {topHighlights.map(({ post, itemCount, name }, idx) => {
                const key = post.key ?? (post.post as { shortcode?: string })?.shortcode ?? String(idx)
                const imgUrl = getPostImageUrl(post)
                const link = getPostLink(post)
                const failed = failedPostImages.has(key)
                return (
                  <a
                    key={key}
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="report-card--hover"
                    style={{
                      display: 'block',
                      borderRadius: rad.lg,
                      overflow: 'hidden',
                      boxShadow: sh.md,
                      background: c.cardBg,
                      minWidth: 0,
                      transition: t.animation.hoverTransition,
                    }}
                    aria-label={`Destaque ${name}, ${itemCount} itens`}
                  >
                    <div style={{ position: 'relative', aspectRatio: '1', background: c.borderLight }}>
                      {idx === 0 && (
                        <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 1 }}>
                          <span
                            style={{
                              padding: '2px 6px',
                              borderRadius: 6,
                              background: c.primary,
                              color: 'var(--brand-white)',
                              fontSize: 10,
                              fontWeight: 600,
                            }}
                          >
                            #1
                          </span>
                        </div>
                      )}
                      {imgUrl && !failed ? (
                        <img
                          src={proxyImageUrl(imgUrl) ?? imgUrl}
                          alt=""
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          loading="lazy"
                        />
                      ) : (
                        <div
                          style={{
                            width: '100%',
                            height: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <StarOutlined style={{ fontSize: 32, color: c.textMuted }} aria-hidden />
                        </div>
                      )}
                    </div>
                    <div style={{ padding: s.sm }}>
                      <div style={{ ...typ.bodySmall, fontWeight: 600, color: c.text, marginBottom: 2 }}>
                        {name}
                      </div>
                      <div style={{ ...typ.caption, color: c.textMuted }}>
                        {itemCount} {itemCount === 1 ? 'item' : 'itens'}
                        {getHighlightDateLabel(post) && (
                          <span style={{ display: 'block', marginTop: 2 }}>{getHighlightDateLabel(post)}</span>
                        )}
                      </div>
                    </div>
                  </a>
                )
              })}
            </div>
            <Modal
              title="Todos os destaques"
              open={galleryModalOpen}
              onCancel={() => setGalleryModalOpen(false)}
              footer={null}
              width="90%"
              style={{ maxWidth: 900 }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                  gap: s.lg,
                }}
                role="list"
              >
                {allHighlights.map(({ post, itemCount, name }, idx) => {
                  const key = post.key ?? (post.post as { shortcode?: string })?.shortcode ?? String(idx)
                  const imgUrl = getPostImageUrl(post)
                  const link = getPostLink(post)
                  const failed = failedPostImages.has(key)
                  return (
                    <a
                      key={key}
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="report-card--hover"
                      style={{
                        display: 'block',
                        borderRadius: rad.lg,
                        overflow: 'hidden',
                        boxShadow: sh.md,
                        background: c.cardBg,
                        minWidth: 0,
                      }}
                      aria-label={`Destaque ${name}, ${itemCount} itens`}
                    >
                      <div style={{ aspectRatio: '1', background: c.borderLight }}>
                        {imgUrl && !failed ? (
                          <img
                            src={proxyImageUrl(imgUrl) ?? imgUrl}
                            alt=""
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            loading="lazy"
                          />
                        ) : (
                          <div
                            style={{
                              width: '100%',
                              height: '100%',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <StarOutlined style={{ fontSize: 28, color: c.textMuted }} />
                          </div>
                        )}
                      </div>
                      <div style={{ padding: s.sm }}>
                        <div style={{ ...typ.caption, fontWeight: 600, color: c.text, marginBottom: 2 }}>{name}</div>
                        <div style={{ ...typ.caption, color: c.textMuted, fontSize: 11 }}>
                          {itemCount} {itemCount === 1 ? 'item' : 'itens'}
                          {getHighlightDateLabel(post) && (
                            <span style={{ display: 'block', marginTop: 2 }}>{getHighlightDateLabel(post)}</span>
                          )}
                        </div>
                      </div>
                    </a>
                  )
                })}
              </div>
            </Modal>
          </Col>
        </Row>
      )}
    </div>
  )
}
