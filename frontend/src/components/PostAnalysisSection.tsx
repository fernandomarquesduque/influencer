/**
 * Seção "Análise do feed": métricas de resumo, Top 4 por interações,
 * posts por semana, conteúdo analisado e hashtags.
 */
import React, { useState } from 'react'
import { Card, Row, Col, Tooltip, Spin, Modal } from 'antd'
import { HeartOutlined, CommentOutlined, RiseOutlined, RocketOutlined, FileImageOutlined } from '@ant-design/icons'
import { reportTokens as t } from '../pages/reportTokens'
import { METRIC_TOOLTIPS } from '../constants/metricTooltips'
import { getErBanda } from './ERGaugeChart'
import { buildReportInsights, REPORT_POSTS_LIMIT } from '../utils/reportInsights'
import { ProofCarousel } from '../pages/InfluencerDetailReport'
import type { EngagementStats } from '../api'
import type { PostItem } from '../api'

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
  /** Espaçamento inferior da seção (ex.: gap da página). */
  gap?: number
  /** Estilo do card (bordas, sombra). */
  cardStyle?: React.CSSProperties
  /** Quando true, não renderiza o título da seção (para exibir o título fora do blur). */
  contentOnly?: boolean
  profileRefForRefresh?: string
  onPostImageError?: (postKey: string) => void
}

export function PostAnalysisSection({
  reportInsights,
  engagement,
  postsCount,
  postsLoading,
  canShowProof,
  categories: _categories,
  allHashtags: _allHashtags,
  failedPostImages,
  formatShortNum,
  getPostImageUrl,
  getPostLink,
  gap = s.xl,
  cardStyle = { borderRadius: r, border: 'none', boxShadow: t.shadowLegacy, padding: s.lg, background: c.cardBg },
  contentOnly = false,
  profileRefForRefresh,
  onPostImageError,
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

  return (
    <>
      {canShowProof && (
        <div style={{ marginBottom: gap }}>
          {!contentOnly && (
            <h2 className="section-h2" style={{ ...typH2, color: c.text, textAlign: 'center', marginBottom: s.sm }}>
              Análise do feed
            </h2>
          )}
          {reportInsights && postsCount > 0 && (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: s.sm,
                alignItems: 'stretch',
                justifyContent: 'center',
                marginBottom: s.lg,
              }}
            >
              <Tooltip title={METRIC_TOOLTIPS.totalCurtidas} placement="top">
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    cursor: 'help',
                    padding: '6px 10px',
                    background: c.cardBgSoft,
                    borderRadius: 8,
                    border: `1px solid ${c.borderLight}`,
                    boxShadow: 'var(--app-shadow-sm)',
                  }}
                >
                  <HeartOutlined style={{ fontSize: 16, color: 'var(--app-icon-heart)' }} />
                  <span>
                    <strong style={{ ...typ.body, fontSize: 13, color: c.text }}>
                      {formatShortNum(engagement.total_likes)}
                    </strong>{' '}
                    <span style={{ color: c.textSecondary, fontSize: 12 }}>curtidas</span>
                  </span>
                </div>
              </Tooltip>
              <Tooltip title={METRIC_TOOLTIPS.totalComentarios} placement="top">
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    cursor: 'help',
                    padding: '6px 10px',
                    background: c.cardBgSoft,
                    borderRadius: 8,
                    border: `1px solid ${c.borderLight}`,
                    boxShadow: 'var(--app-shadow-sm)',
                  }}
                >
                  <CommentOutlined style={{ fontSize: 16, color: 'var(--app-icon-comment)' }} />
                  <span>
                    <strong style={{ ...typ.body, fontSize: 13, color: c.text }}>
                      {formatShortNum(engagement.total_comments)}
                    </strong>{' '}
                    <span style={{ color: c.textSecondary, fontSize: 12 }}>comentários</span>
                  </span>
                </div>
              </Tooltip>
              <Tooltip title={METRIC_TOOLTIPS.er} placement="top">
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    cursor: 'help',
                    padding: '6px 10px',
                    background: c.cardBgSoft,
                    borderRadius: 8,
                    border: `1px solid ${c.borderLight}`,
                    boxShadow: 'var(--app-shadow-sm)',
                  }}
                >
                  <RocketOutlined style={{ fontSize: 16, color: c.primary }} />
                  <span>
                    <strong style={{ ...typ.body, fontSize: 13, color: c.primary }}>
                      {(engagement.engagement_rate ?? 0).toFixed(2)}%
                    </strong>{' '}
                    <span style={{ color: c.textSecondary, fontSize: 12 }}>ER Médio</span>
                  </span>
                  {(() => {
                    const er = engagement.engagement_rate ?? 0
                    const banda = getErBanda(er)
                    return (
                      <span
                        style={{
                          marginLeft: 2,
                          fontSize: 9,
                          fontWeight: 600,
                          padding: '1px 4px',
                          borderRadius: 3,
                          background: `${banda.color}22`,
                          color: banda.color,
                          border: `1px solid ${banda.color}44`,
                        }}
                      >
                        {banda.label}
                      </span>
                    )
                  })()}
                </div>
              </Tooltip>
              <Tooltip title={METRIC_TOOLTIPS.mediaLikesPost} placement="top">
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    cursor: 'help',
                    padding: '6px 10px',
                    background: c.cardBgSoft,
                    borderRadius: 8,
                    border: `1px solid ${c.borderLight}`,
                    boxShadow: 'var(--app-shadow-sm)',
                  }}
                >
                  <RiseOutlined style={{ fontSize: 16, color: c.primary }} />
                  <span>
                    <strong style={{ ...typ.body, fontSize: 13, color: c.text }}>
                      {engagement.avg_likes.toLocaleString('pt-BR')}
                    </strong>{' '}
                    <span style={{ color: c.textSecondary, fontSize: 12 }}>média likes (feed)</span>
                  </span>
                </div>
              </Tooltip>
              <Tooltip title={METRIC_TOOLTIPS.totalPosts} placement="top">
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    cursor: 'help',
                    padding: '6px 10px',
                    background: c.cardBgSoft,
                    borderRadius: 8,
                    border: `1px solid ${c.borderLight}`,
                    boxShadow: 'var(--app-shadow-sm)',
                  }}
                >
                  <FileImageOutlined style={{ fontSize: 16, color: 'var(--app-icon-image)' }} />
                  <span>
                    <strong style={{ ...typ.body, fontSize: 13, color: c.text }}>{engagement.posts_count}</strong>{' '}
                    <span style={{ color: c.textSecondary, fontSize: 12 }}>itens (feed)</span>
                  </span>
                </div>
              </Tooltip>
            </div>
          )}
          <Row gutter={[s.lg, s.lg]}>
            <Col xs={24}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: s.sm, marginBottom: s.sm }}>
                <div style={{ ...typH3, color: c.textSecondary, margin: 0 }}>
                  Top 4 por interações (últimos {REPORT_POSTS_LIMIT} do feed)
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
                    failedImages={failedPostImages}
                    formatShortNum={formatShortNum}
                    profileRefForRefresh={profileRefForRefresh}
                    onPostImageError={onPostImageError}
                  />
                  <Modal
                    title="Todo o feed"
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
                      failedImages={failedPostImages}
                      formatShortNum={formatShortNum}
                      profileRefForRefresh={profileRefForRefresh}
                      onPostImageError={onPostImageError}
                    />
                  </Modal>
                </>
              )}
            </Col>
          </Row>
        </div>
      )}

    </>
  )
}
