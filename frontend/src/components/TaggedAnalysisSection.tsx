/**
 * Seção "Quando te marcam": métricas de posts em que o influencer foi marcado,
 * Top 4 por interações e visualização em carrossel.
 */
import { useMemo, useState } from 'react'
import { Row, Col, Tooltip, Modal } from 'antd'
import { HeartOutlined, CommentOutlined, RiseOutlined, RocketOutlined, TagOutlined, EyeOutlined } from '@ant-design/icons'
import { reportTokens as t } from '../pages/reportTokens'
import { METRIC_TOOLTIPS } from '../constants/metricTooltips'
import { getTopPosts } from '../utils/reportInsights'
import { computeEngagementFromPosts } from '../utils/engagement'
import { ProofCarousel } from '../pages/InfluencerDetailReport'
import type { PostItem } from '../api'

const { spacing: s, colors: c, radiusLegacy: _r, typography: typ } = t
const typH2 = t.typography.h2 as { fontSize: number; fontWeight: number }
const typH3 = t.typography.h3 as { fontSize: number; fontWeight: number }

export interface TaggedAnalysisSectionProps {
  /** Lista de posts em que o influencer foi marcado (content_type === 'tagged'). */
  tagged: PostItem[]
  /** Número de seguidores para cálculo de ER. */
  followersCount: number
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
  /** Espaçamento inferior da seção. */
  gap?: number
  /** Quando true, não renderiza o título da seção (para exibir o título fora do blur). */
  contentOnly?: boolean
}

export function TaggedAnalysisSection({
  tagged,
  followersCount,
  failedPostImages,
  formatShortNum,
  getPostImageUrl,
  getPostLink,
  proxyImageUrl,
  gap = s.xl,
  contentOnly = false,
}: TaggedAnalysisSectionProps) {
  const engagement = useMemo(
    () => computeEngagementFromPosts(tagged, followersCount),
    [tagged, followersCount]
  )
  const topPostsTagged = useMemo(() => getTopPosts(tagged, followersCount), [tagged, followersCount])
  const topTagged = topPostsTagged.byInteractions
  const allTaggedItems = topPostsTagged.byInteractionsAll
  const conversationRate =
    engagement.total_likes + engagement.total_comments > 0
      ? (engagement.total_comments / (engagement.total_likes + engagement.total_comments)) * 100
      : 0
  const geraConversa = conversationRate >= 8
  const [galleryModalOpen, setGalleryModalOpen] = useState(false)

  if (tagged.length === 0) return null

  return (
    <div style={{ marginBottom: gap }}>
      {!contentOnly && (
        <h2 className="section-h2" style={{ ...typH2, color: c.text, textAlign: 'center', marginBottom: s.sm }}>
          Quando te marcam
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
              <span style={{ color: c.textSecondary, fontSize: 12 }}>ER médio (marcados)</span>
            </span>
          </div>
        </Tooltip>
        {engagement.total_views > 0 && (
          <Tooltip title={METRIC_TOOLTIPS.totalViewsMarcados} placement="top">
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
              <span style={{ color: c.textSecondary, fontSize: 12 }}>média likes/marcado</span>
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
            <TagOutlined style={{ fontSize: 16, color: 'var(--app-icon-image)' }} />
            <span>
              <strong style={{ ...typ.body, fontSize: 13, color: c.text }}>{engagement.posts_count}</strong>{' '}
              <span style={{ color: c.textSecondary, fontSize: 12 }}>marcados</span>
            </span>
          </div>
        </Tooltip>
      </div>

      {topTagged.length > 0 && (
        <Row gutter={[s.lg, s.lg]}>
          <Col xs={24}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: s.sm, marginBottom: s.sm }}>
              <div style={{ ...typH3, color: c.textSecondary, margin: 0 }}>
                Top 4 marcados por interações
              </div>
              {allTaggedItems.length > 4 && (
                <a
                  onClick={() => setGalleryModalOpen(true)}
                  style={{ ...typ.caption, color: c.primary, fontWeight: 600, cursor: 'pointer' }}
                >
                  Ver mais
                </a>
              )}
            </div>
            <ProofCarousel
              items={topTagged.map(({ post, interactions, erPost, oQueFuncionou }, idx) => ({
                post,
                interactions,
                erPost,
                oQueFuncionou,
                isTop: idx === 0,
                geraConversa,
              }))}
              getImageUrl={(p) => getPostImageUrl(p as PostItem)}
              getLink={(p) => getPostLink(p as PostItem)}
              proxyUrl={(url) => proxyImageUrl(url) ?? ''}
              failedImages={failedPostImages}
              formatShortNum={formatShortNum}
              showAuthor
            />
            <Modal
              title="Todos os marcados"
              open={galleryModalOpen}
              onCancel={() => setGalleryModalOpen(false)}
              footer={null}
              width="90%"
              style={{ maxWidth: 900 }}
              bodyStyle={{ maxHeight: '70vh', overflowY: 'auto' }}
            >
              <ProofCarousel
                items={allTaggedItems.map(({ post, interactions, erPost, oQueFuncionou }, idx) => ({
                  post,
                  interactions,
                  erPost,
                  oQueFuncionou,
                  isTop: idx === 0,
                  geraConversa,
                }))}
                getImageUrl={(p) => getPostImageUrl(p as PostItem)}
                getLink={(p) => getPostLink(p as PostItem)}
                proxyUrl={(url) => proxyImageUrl(url) ?? ''}
                failedImages={failedPostImages}
                formatShortNum={formatShortNum}
                showAuthor
              />
            </Modal>
          </Col>
        </Row>
      )}
    </div>
  )
}
