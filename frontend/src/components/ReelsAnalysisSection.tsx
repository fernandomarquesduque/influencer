/**
 * Seção "Análise de reels": métricas de reels, Top 4 por interações
 * e visualização em grid/carrossel.
 */
import React, { useMemo, useState } from 'react'
import { Row, Col, Tooltip, Modal } from 'antd'
import { HeartOutlined, CommentOutlined, RiseOutlined, RocketOutlined, VideoCameraOutlined, EyeOutlined } from '@ant-design/icons'
import { reportTokens as t } from '../pages/reportTokens'
import { METRIC_TOOLTIPS } from '../constants/metricTooltips'
import { getErBanda } from './ERGaugeChart'
import { getTopPosts } from '../utils/reportInsights'
import { computeEngagementFromPosts } from '../utils/engagement'
import { ProofCarousel } from '../pages/InfluencerDetailReport'
import type { PostItem } from '../api'

const { spacing: s, colors: c, radiusLegacy: r, typography: typ } = t
const typH2 = t.typography.h2 as { fontSize: number; fontWeight: number }
const typH3 = t.typography.h3 as { fontSize: number; fontWeight: number }

export interface ReelsAnalysisSectionProps {
  /** Lista de reels (posts com content_type === 'reel'). */
  reels: PostItem[]
  /** Número de seguidores para cálculo de ER. */
  followersCount: number
  /** Set de keys de reels cuja imagem falhou ao carregar. */
  failedPostImages: Set<string>
  /** Formata número curto (ex.: 1,5k). */
  formatShortNum: (n: number) => string
  /** Retorna URL da imagem do post/reel. */
  getPostImageUrl: (post: PostItem) => string | undefined
  /** Retorna link do post (ex.: Instagram). */
  getPostLink: (post: PostItem) => string
  /** Espaçamento inferior da seção. */
  gap?: number
  /** Estilo do card. */
  cardStyle?: React.CSSProperties
  /** Ex.: "Seu último reel atingiu 3,2× sua base de seguidores." (Reel Views ÷ Followers) */
  lastReelAmplificationLabel?: string | null
  /** Quando true, não renderiza o título da seção (para exibir o título fora do blur). */
  contentOnly?: boolean
  profileRefForRefresh?: string
  onPostImageError?: (postKey: string) => void
}

export function ReelsAnalysisSection({
  reels,
  followersCount,
  failedPostImages,
  formatShortNum,
  getPostImageUrl,
  getPostLink,
  gap = s.xl,
  cardStyle: _cardStyle = { borderRadius: r, border: 'none', boxShadow: t.shadowLegacy, padding: s.lg, background: c.cardBg },
  lastReelAmplificationLabel,
  contentOnly = false,
  profileRefForRefresh,
  onPostImageError,
}: ReelsAnalysisSectionProps) {
  const engagement = useMemo(
    () => computeEngagementFromPosts(reels, followersCount),
    [reels, followersCount]
  )
  const topPostsReels = useMemo(() => getTopPosts(reels, followersCount), [reels, followersCount])
  const topReels = topPostsReels.byInteractions
  const allReelsItems = topPostsReels.byInteractionsAll
  const conversationRate =
    engagement.total_likes + engagement.total_comments > 0
      ? (engagement.total_comments / (engagement.total_likes + engagement.total_comments)) * 100
      : 0
  const geraConversa = conversationRate >= 8
  const [galleryModalOpen, setGalleryModalOpen] = useState(false)

  if (reels.length === 0) {
    return (
      <div style={{ marginBottom: gap }}>
        {!contentOnly && (
          <h2 className="section-h2" style={{ ...typH2, color: c.text, textAlign: 'center', marginBottom: s.sm }}>
            Análise de reels
          </h2>
        )}
        <div style={{ textAlign: 'center', padding: s.xl, background: c.cardBgSoft, borderRadius: 12, border: `1px solid ${c.borderLight}` }}>
          <span style={{ ...typ.body, color: c.textSecondary }}>Nenhum reel nesse perfil.</span>
        </div>
      </div>
    )
  }

  return (
    <div style={{ marginBottom: gap }}>
      {!contentOnly && (
        <h2 className="section-h2" style={{ ...typH2, color: c.text, textAlign: 'center', marginBottom: s.sm }}>
          Análise de reels
        </h2>
      )}

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
              <span style={{ color: c.textSecondary, fontSize: 12 }}>ER médio</span>
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
        {lastReelAmplificationLabel && (
          <Tooltip title={METRIC_TOOLTIPS.viralizacaoReel} placement="top">
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 10px',
                background: c.cardBgHighlight ?? `${c.primary}15`,
                borderRadius: 8,
                border: `1px solid ${c.primary}40`,
                width: '100%',
                maxWidth: 360,
                justifyContent: 'center',
                cursor: 'help',
              }}
            >
              <RiseOutlined style={{ fontSize: 14, color: c.primary }} />
              <span style={{ ...typ.body, fontSize: 12, color: c.text, fontWeight: 600 }}>
                {lastReelAmplificationLabel}
              </span>
            </div>
          </Tooltip>
        )}
        {engagement.total_views > 0 && (
          <>
            <Tooltip title={METRIC_TOOLTIPS.totalViewsReels} placement="top">
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
                <EyeOutlined style={{ fontSize: 16, color: c.primary }} />
                <span>
                  <strong style={{ ...typ.body, fontSize: 13, color: c.text }}>
                    {formatShortNum(engagement.total_views)}
                  </strong>{' '}
                  <span style={{ color: c.textSecondary, fontSize: 12 }}>visualizações</span>
                </span>
              </div>
            </Tooltip>
            {(engagement.avg_views ?? 0) > 0 && (
              <Tooltip title={METRIC_TOOLTIPS.mediaViewsReel} placement="top">
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
                  <EyeOutlined style={{ fontSize: 16, color: c.primary }} />
                  <span>
                    <strong style={{ ...typ.body, fontSize: 13, color: c.text }}>
                      {formatShortNum(engagement.avg_views ?? 0)}
                    </strong>{' '}
                    <span style={{ color: c.textSecondary, fontSize: 12 }}>média views/reel</span>
                  </span>
                </div>
              </Tooltip>
            )}
            {(engagement.engagement_rate_by_views ?? 0) > 0 && (
              <Tooltip title={METRIC_TOOLTIPS.erPorViews} placement="top">
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
                      {(engagement.engagement_rate_by_views ?? 0).toFixed(2)}%
                    </strong>{' '}
                    <span style={{ color: c.textSecondary, fontSize: 12 }}>ER por views</span>
                  </span>
                  {(() => {
                    const erViews = engagement.engagement_rate_by_views ?? 0
                    const banda = getErBanda(erViews)
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
            )}
          </>
        )}
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
              <span style={{ color: c.textSecondary, fontSize: 12 }}>média likes/reel</span>
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
            <VideoCameraOutlined style={{ fontSize: 16, color: 'var(--app-icon-image)' }} />
            <span>
              <strong style={{ ...typ.body, fontSize: 13, color: c.text }}>{engagement.posts_count}</strong>{' '}
              <span style={{ color: c.textSecondary, fontSize: 12 }}>reels</span>
            </span>
          </div>
        </Tooltip>
      </div>

      {topReels.length > 0 && (
        <Row gutter={[s.lg, s.lg]}>
          <Col xs={24}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: s.sm, marginBottom: s.sm }}>
              <div style={{ ...typH3, color: c.textSecondary, margin: 0 }}>
                Top 4 reels por interações
              </div>
              {allReelsItems.length > 4 && (
                <a
                  onClick={() => setGalleryModalOpen(true)}
                  style={{ ...typ.caption, color: c.primary, fontWeight: 600, cursor: 'pointer' }}
                >
                  Ver mais
                </a>
              )}
            </div>
            <ProofCarousel
              items={topReels.map(({ post, interactions, erPost, oQueFuncionou }, idx) => ({
                post,
                interactions,
                erPost,
                oQueFuncionou,
                isTop: idx === 0,
                geraConversa,
              }))}
              getImageUrl={(p) => getPostImageUrl(p as PostItem)}
              getLink={(p) => getPostLink(p as PostItem)}
              failedImages={failedPostImages}
              formatShortNum={formatShortNum}
              profileRefForRefresh={profileRefForRefresh}
              onPostImageError={onPostImageError}
            />
            <Modal
              title="Todos os reels"
              open={galleryModalOpen}
              onCancel={() => setGalleryModalOpen(false)}
              footer={null}
              width="90%"
              style={{ maxWidth: 900 }}
              bodyStyle={{ maxHeight: '70vh', overflowY: 'auto' }}
            >
              <ProofCarousel
                items={allReelsItems.map(({ post, interactions, erPost, oQueFuncionou }, idx) => ({
                  post,
                  interactions,
                  erPost,
                  oQueFuncionou,
                  isTop: idx === 0,
                  geraConversa,
                }))}
                getImageUrl={(p) => getPostImageUrl(p as PostItem)}
                getLink={(p) => getPostLink(p as PostItem)}
                failedImages={failedPostImages}
                formatShortNum={formatShortNum}
                profileRefForRefresh={profileRefForRefresh}
                onPostImageError={onPostImageError}
              />
            </Modal>
          </Col>
        </Row>
      )}
    </div>
  )
}
