/**
 * Seção "Alcance": 3 cards com percentual dos posts por formato (Reels, Carrossel, Foto).
 * A soma é 100%. Estilo: Reels (lavanda/roxo), Carrossel (rosa), Foto (cinza).
 */
import React from 'react'
import { Row, Col, Typography } from 'antd'
import { reportTokens as t } from '../pages/reportTokens'

const { Text } = Typography
const { spacing: s, radiusLegacy: r } = t

export interface ContentTypeDistribution {
  pctReels: number
  pctCarousel: number
  pctPhoto: number
  countReels?: number
  countCarousel?: number
  countPhoto?: number
}

/** Cores dos cards vêm do tema (theme.css: --app-alcance-*). */
const CARD_STYLES = {
  reels: {
    bg: 'var(--app-alcance-reels-bg)',
    border: 'var(--app-alcance-reels-border)',
    titleColor: 'var(--app-alcance-reels)',
    descColor: 'var(--app-text-secondary)',
  },
  carousel: {
    bg: 'var(--app-alcance-carousel-bg)',
    border: 'var(--app-alcance-carousel-border)',
    titleColor: 'var(--app-alcance-carousel)',
    descColor: 'var(--app-text-secondary)',
  },
  photo: {
    bg: 'var(--app-alcance-photo-bg)',
    border: 'var(--app-alcance-photo-border)',
    titleColor: 'var(--app-alcance-photo)',
    descColor: 'var(--app-text-secondary)',
  },
} as const

export interface AlcanceSectionProps {
  /** Distribuição de conteúdo (pctReels, pctCarousel, pctPhoto). */
  distribution: ContentTypeDistribution | null | undefined
  /** Espaçamento entre cards (gutter). */
  gutter?: number | [number, number]
  /** Estilo do container da linha. */
  style?: React.CSSProperties
}

export function AlcanceSection({
  distribution,
  gutter = [s.lg, s.lg],
  style,
}: AlcanceSectionProps) {
  if (!distribution) return null
  const { pctReels, pctCarousel, pctPhoto } = distribution
  const hasAny = pctReels > 0 || pctCarousel > 0 || pctPhoto > 0
  if (!hasAny) return null

  /** Altura fixa para os três cartões ficarem iguais. */
  const CARD_HEIGHT = 140
  const cardBase = {
    borderRadius: r,
    padding: s.md,
    height: CARD_HEIGHT,
    minHeight: CARD_HEIGHT,
    display: 'flex',
    flexDirection: 'column' as const,
    justifyContent: 'center',
    boxShadow: 'none',
  }

  return (
    <div style={style}>
      <Row gutter={Array.isArray(gutter) ? gutter : [gutter, gutter]}>
        {pctReels >= 0 && (
          <Col xs={24} sm={8} style={{ display: 'flex' }}>
            <div
              style={{
                ...cardBase,
                flex: 1,
                backgroundColor: CARD_STYLES.reels.bg,
                border: `1px solid ${CARD_STYLES.reels.border}`,
              }}
            >
              <Text style={{ fontSize: 20, fontWeight: 600, color: CARD_STYLES.reels.titleColor, display: 'block' }}>
                {pctReels}%
              </Text>
              <Text style={{ fontSize: 13, fontWeight: 600, color: CARD_STYLES.reels.titleColor, display: 'block', marginTop: 4 }}>
                Reels
              </Text>
              <Text
                style={{
                  fontSize: 12,
                  color: CARD_STYLES.reels.descColor,
                  marginTop: 4,
                  lineHeight: 1.35,
                }}
              >
                {pctReels}% dos posts são reels. Vídeos curtos; alto alcance na descoberta.
              </Text>
            </div>
          </Col>
        )}
        {pctCarousel >= 0 && (
          <Col xs={24} sm={8} style={{ display: 'flex' }}>
            <div
              style={{
                ...cardBase,
                flex: 1,
                backgroundColor: CARD_STYLES.carousel.bg,
                border: `1px solid ${CARD_STYLES.carousel.border}`,
              }}
            >
              <Text style={{ fontSize: 20, fontWeight: 600, color: CARD_STYLES.carousel.titleColor, display: 'block' }}>
                {pctCarousel}%
              </Text>
              <Text style={{ fontSize: 13, fontWeight: 600, color: CARD_STYLES.carousel.titleColor, display: 'block', marginTop: 4 }}>
                Carrossel
              </Text>
              <Text
                style={{
                  fontSize: 12,
                  color: CARD_STYLES.carousel.descColor,
                  marginTop: 4,
                  lineHeight: 1.35,
                }}
              >
                {pctCarousel}% dos posts são carrossel. Múltiplas imagens; mantêm o usuário mais tempo.
              </Text>
            </div>
          </Col>
        )}
        {pctPhoto >= 0 && (
          <Col xs={24} sm={8} style={{ display: 'flex' }}>
            <div
              style={{
                ...cardBase,
                flex: 1,
                backgroundColor: CARD_STYLES.photo.bg,
                border: `1px solid ${CARD_STYLES.photo.border}`,
              }}
            >
              <Text style={{ fontSize: 20, fontWeight: 600, color: CARD_STYLES.photo.titleColor, display: 'block' }}>
                {pctPhoto}%
              </Text>
              <Text style={{ fontSize: 13, fontWeight: 600, color: CARD_STYLES.photo.titleColor, display: 'block', marginTop: 4 }}>
                Foto
              </Text>
              <Text
                style={{
                  fontSize: 12,
                  color: CARD_STYLES.photo.descColor,
                  marginTop: 4,
                  lineHeight: 1.35,
                }}
              >
                {pctPhoto}% dos posts são foto. Imagem única; formato clássico do feed.
              </Text>
            </div>
          </Col>
        )}
      </Row>
    </div>
  )
}
