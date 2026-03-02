/**
 * Seção "Análise de posts": métricas de resumo, Top 4 por interações,
 * posts por semana, conteúdo analisado e hashtags.
 */
import React, { useState } from 'react'
import { Card, Row, Col, Tooltip, Spin, Tag, Space, Typography, Modal } from 'antd'
import { HeartOutlined, CommentOutlined, RiseOutlined, FileImageOutlined } from '@ant-design/icons'
import { reportTokens as t } from '../pages/reportTokens'
import { METRIC_TOOLTIPS } from '../constants/metricTooltips'
import { buildReportInsights, REPORT_POSTS_LIMIT, getWeekdayName } from '../utils/reportInsights'
import { ProofCarousel } from '../pages/InfluencerDetailReport'
import type { EngagementStats } from '../api'
import type { PostItem } from '../api'

const { Text } = Typography
const { spacing: s, colors: c, radiusLegacy: r, typography: typ } = t
const typH2 = t.typography.h2 as { fontSize: number; fontWeight: number }
const typH3 = t.typography.h3 as { fontSize: number; fontWeight: number }

export type ReportInsights = ReturnType<typeof buildReportInsights>

export interface PostAnalysisSectionProps {
  /** Insights do relatório (null quando ainda carregando ou sem dados). */
  reportInsights: ReportInsights | null
  /** Engajamento calculado a partir dos posts. */
  engagement: EngagementStats
  /** Quantidade de posts (para decidir se exibe métricas). */
  postsCount: number
  /** True enquanto posts estão carregando. */
  postsLoading: boolean
  /** True quando há top posts para exibir o carrossel. */
  canShowProof: boolean
  /** Categorias/temas do perfil. */
  categories: string[]
  /** Lista de hashtags dos posts (fallback quando não há nicho). */
  allHashtags: string[]
  /** Set de keys de posts cuja imagem falhou ao carregar. */
  failedPostImages: Set<string>
  /** Formata número curto (ex.: 1,5k). */
  formatShortNum: (n: number) => string
  /** Retorna URL da imagem do post. */
  getPostImageUrl: (post: PostItem) => string | undefined
  /** Retorna link do post (ex.: Instagram). */
  getPostLink: (post: PostItem) => string
  /** Aplica proxy na URL da imagem. */
  proxyImageUrl: (url: string | undefined) => string | undefined
  /** Espaçamento inferior da seção (ex.: gap da página). */
  gap?: number
  /** Estilo do card (bordas, sombra). */
  cardStyle?: React.CSSProperties
}

export function PostAnalysisSection({
  reportInsights,
  engagement,
  postsCount,
  postsLoading,
  canShowProof,
  categories,
  allHashtags,
  failedPostImages,
  formatShortNum,
  getPostImageUrl,
  getPostLink,
  proxyImageUrl,
  gap = s.xl,
  cardStyle = { borderRadius: r, border: 'none', boxShadow: t.shadowLegacy, padding: s.lg, background: c.cardBg },
}: PostAnalysisSectionProps) {
  const [galleryModalOpen, setGalleryModalOpen] = useState(false)
  if (!reportInsights && !postsLoading) return null

  if (postsLoading && reportInsights) {
    return (
      <Card size="small" style={{ ...cardStyle, marginBottom: gap }}>
        <div style={{ textAlign: 'center', padding: s.xl }}><Spin /></div>
      </Card>
    )
  }

  if (!canShowProof && !reportInsights) return null

  const hasWeekData = reportInsights?.consistency && reportInsights.consistency.postsPerWeekByWeek.length > 0
  const hasHashtagData =
    (reportInsights?.nicho &&
      (reportInsights.nicho.topHashtags.length > 0 || reportInsights.nicho.performingHashtags.length > 0)) ||
    categories.length > 0 ||
    allHashtags.length > 0
  const showSecondaryCard = reportInsights && (hasWeekData || hasHashtagData)

  return (
    <>
      {canShowProof && (
        <div style={{ marginBottom: gap }}>
          <h2 className="section-h2" style={{ ...typH2, color: c.text, textAlign: 'center', marginBottom: s.sm }}>
            Análise de posts
          </h2>
          {reportInsights && postsCount > 0 && (
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
              <Tooltip title={METRIC_TOOLTIPS.totalCurtidas} placement="top">
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
                  <HeartOutlined style={{ fontSize: 20, color: 'var(--app-icon-heart)' }} />
                  <span>
                    <strong style={{ ...typ.body, fontSize: 15, color: c.text }}>
                      {formatShortNum(engagement.total_likes)}
                    </strong>{' '}
                    <span style={{ color: c.textSecondary, fontSize: 13 }}>curtidas</span>
                  </span>
                </div>
              </Tooltip>
              <Tooltip title={METRIC_TOOLTIPS.totalComentarios} placement="top">
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
                  <CommentOutlined style={{ fontSize: 20, color: 'var(--app-icon-comment)' }} />
                  <span>
                    <strong style={{ ...typ.body, fontSize: 15, color: c.text }}>
                      {formatShortNum(engagement.total_comments)}
                    </strong>{' '}
                    <span style={{ color: c.textSecondary, fontSize: 13 }}>comentários</span>
                  </span>
                </div>
              </Tooltip>
              <Tooltip title={METRIC_TOOLTIPS.mediaLikesPost} placement="top">
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
                    <strong style={{ ...typ.body, fontSize: 15, color: c.text }}>
                      {engagement.avg_likes.toLocaleString('pt-BR')}
                    </strong>{' '}
                    <span style={{ color: c.textSecondary, fontSize: 13 }}>média likes/post</span>
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
                  <FileImageOutlined style={{ fontSize: 20, color: 'var(--app-icon-image)' }} />
                  <span>
                    <strong style={{ ...typ.body, fontSize: 15, color: c.text }}>{engagement.posts_count}</strong>{' '}
                    <span style={{ color: c.textSecondary, fontSize: 13 }}>posts</span>
                  </span>
                </div>
              </Tooltip>
            </div>
          )}
          <Row gutter={[s.lg, s.lg]}>
            <Col xs={24}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: s.sm, marginBottom: s.sm }}>
                <div style={{ ...typH3, color: c.textSecondary, margin: 0 }}>
                  Top 4 por interações (últimos {REPORT_POSTS_LIMIT} posts)
                </div>
                {reportInsights && reportInsights.topPosts.byInteractionsAll.length > 4 && (
                  <a
                    onClick={() => setGalleryModalOpen(true)}
                    style={{ ...typ.caption, color: c.primary, fontWeight: 600, cursor: 'pointer' }}
                  >
                    Ver mais
                  </a>
                )}
              </div>
              {reportInsights && (
                <>
                  <ProofCarousel
                    items={reportInsights.topPosts.byInteractions.slice(0, 4).map(
                      ({ post, interactions, erPost, oQueFuncionou }, idx) => ({
                        post,
                        interactions,
                        erPost,
                        oQueFuncionou,
                        isTop: idx === 0,
                        geraConversa: reportInsights.conversation.rate >= 8,
                      })
                    )}
                    getImageUrl={(p) => getPostImageUrl(p as PostItem)}
                    getLink={(p) => getPostLink(p as PostItem)}
                    proxyUrl={(url) => proxyImageUrl(url) ?? ''}
                    failedImages={failedPostImages}
                    formatShortNum={formatShortNum}
                  />
                  <Modal
                    title="Todos os posts"
                    open={galleryModalOpen}
                    onCancel={() => setGalleryModalOpen(false)}
                    footer={null}
                    width="90%"
                    style={{ maxWidth: 900 }}
                  >
                    <ProofCarousel
                      items={reportInsights.topPosts.byInteractionsAll.map(
                        ({ post, interactions, erPost, oQueFuncionou }, idx) => ({
                          post,
                          interactions,
                          erPost,
                          oQueFuncionou,
                          isTop: idx === 0,
                          geraConversa: reportInsights.conversation.rate >= 8,
                        })
                      )}
                      getImageUrl={(p) => getPostImageUrl(p as PostItem)}
                      getLink={(p) => getPostLink(p as PostItem)}
                      proxyUrl={(url) => proxyImageUrl(url) ?? ''}
                      failedImages={failedPostImages}
                      formatShortNum={formatShortNum}
                    />
                  </Modal>
                </>
              )}
            </Col>
          </Row>
        </div>
      )}

      {showSecondaryCard && (() => {
        const weekData = reportInsights!.consistency?.postsPerWeekByWeek ?? []
        const maxBar = Math.max(1, ...weekData)
        const bestDay = reportInsights!.consistency ? getWeekdayName(reportInsights.consistency.bestWeekday) : ''
        const bestHour = reportInsights!.consistency?.bestHour ?? 0
        return (
          <div style={{ marginBottom: gap }}>
            <Card size="small" style={cardStyle}>
              {hasWeekData && (
                <>
                  <Tooltip title={METRIC_TOOLTIPS.postsPorSemanaUltimas8} placement="top">
                    <div
                      style={{
                        ...typ.caption,
                        color: c.primary,
                        fontWeight: 600,
                        marginBottom: 8,
                        cursor: 'help',
                        display: 'inline-block',
                      }}
                    >
                      Posts por semana (últimas 8)
                    </div>
                  </Tooltip>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 40, width: '100%' }}>
                    {weekData.map((n, i) => (
                      <div
                        key={i}
                        style={{
                          flex: 1,
                          minWidth: 0,
                          height: Math.max(8, (n / maxBar) * 34),
                          background: 'var(--app-chart-bar-gradient)',
                          borderRadius: 6,
                          boxShadow: 'var(--app-chart-bar-shadow)',
                        }}
                        title={`${n} posts`}
                      />
                    ))}
                  </div>
                  <Tooltip title={METRIC_TOOLTIPS.melhorDiaHora} placement="top">
                    <div
                      style={{
                        ...typ.caption,
                        color: c.textSecondary,
                        marginTop: 10,
                        marginBottom: hasHashtagData ? s.lg : 0,
                        fontWeight: 500,
                        cursor: 'help',
                        display: 'inline-block',
                      }}
                    >
                      🕐 Melhor: {bestDay} às {bestHour}h
                    </div>
                  </Tooltip>
                </>
              )}
              {hasHashtagData && (
                <>
                  {hasWeekData && (
                    <div style={{ borderTop: `1px solid ${c.borderLight}`, paddingTop: s.lg, marginTop: 0 }} />
                  )}
                  <div
                    style={{
                      ...typ.caption,
                      color: c.textMuted,
                      marginBottom: s.md,
                      fontWeight: 600,
                    }}
                  >
                    Conteúdo analisado — assinatura de conteúdo
                  </div>
                  {reportInsights?.nicho &&
                    (reportInsights.nicho.topHashtags.length > 0 ||
                      reportInsights.nicho.performingHashtags.length > 0) &&
                    (() => {
                      const byTag = new Map<string, { count: number; avgEr: number | null }>()
                      for (const { tag, count } of reportInsights.nicho.topHashtags) {
                        byTag.set(tag, { count, avgEr: null })
                      }
                      for (const { tag, avgEr, count: perfCount } of reportInsights.nicho.performingHashtags) {
                        const cur = byTag.get(tag)
                        byTag.set(tag, { count: cur?.count ?? perfCount, avgEr })
                      }
                      const rows = Array.from(byTag.entries())
                        .map(([tag, { count, avgEr }]) => ({ tag, count, avgEr }))
                        .sort((a, b) => b.count - a.count || (b.avgEr ?? 0) - (a.avgEr ?? 0))
                        .slice(0, 15)
                      return (
                        <div style={{ marginBottom: categories.length > 0 ? s.lg : 0 }}>
                          <Tooltip title={METRIC_TOOLTIPS.hashtagsMaisUsadas} placement="top">
                            <div
                              style={{
                                ...typ.caption,
                                color: c.textSecondary,
                                marginBottom: 8,
                                cursor: 'help',
                                display: 'inline-block',
                              }}
                            >
                              Hashtags · últimos {REPORT_POSTS_LIMIT} posts
                            </div>
                          </Tooltip>
                          <div
                            style={{
                              display: 'grid',
                              gap: 6,
                              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                            }}
                          >
                            {rows.map(({ tag, count, avgEr }) => (
                              <div
                                key={tag}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  gap: 8,
                                  padding: '8px 10px',
                                  background: c.cardBgSoft,
                                  borderRadius: 8,
                                  border: `1px solid ${c.borderLight}`,
                                }}
                              >
                                <span style={{ ...typ.bodySmall, fontWeight: 600, color: c.primary }}>#{tag}</span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                                  <Tooltip title={METRIC_TOOLTIPS.hashtagsMaisUsadas} placement="top">
                                    <span style={{ ...typ.caption, color: c.textMuted, cursor: 'help' }}>
                                      {count}×
                                    </span>
                                  </Tooltip>
                                  {avgEr != null ? (
                                    <Tooltip title={METRIC_TOOLTIPS.hashtagsPerformam} placement="top">
                                      <span
                                        style={{
                                          ...typ.caption,
                                          fontWeight: 600,
                                          color: c.success,
                                          cursor: 'help',
                                          whiteSpace: 'nowrap',
                                        }}
                                      >
                                        {avgEr.toFixed(1)}%
                                      </span>
                                    </Tooltip>
                                  ) : (
                                    <span style={{ ...typ.caption, color: c.textMuted }}>—</span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })()}
                  {categories.length > 0 && (
                    <div>
                      <Text strong style={{ ...typ.caption, display: 'block', marginBottom: s.xs, color: c.textSecondary }}>
                        Temas
                      </Text>
                      <Space wrap size={[6, 6]}>
                        {categories.map((cat) => (
                          <Tag key={cat} style={{ borderRadius: 6 }}>
                            {cat}
                          </Tag>
                        ))}
                      </Space>
                    </div>
                  )}
                </>
              )}
            </Card>
          </div>
        )
      })()}
    </>
  )
}
