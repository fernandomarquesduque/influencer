/**
 * Seção "Alcance": 3 cards com percentual dos posts por formato (Reels, Carrossel, Foto).
 * A soma é 100%. Estilo: Reels (lavanda/roxo), Carrossel (rosa), Foto (cinza).
 */
import React from 'react'
import { Typography } from 'antd'
import { VideoCameraOutlined, AppstoreOutlined, CameraOutlined } from '@ant-design/icons'
import { reportTokens as t } from '../pages/reportTokens'
import '../pages/InfluencerDetailStack.css'

const { Text } = Typography
const { radius } = t

/** Espaço entre os 3 cards de formato (horizontal + vertical no mobile) */
const ALCANCE_GUTTER: [number, number] = [12, 12]

const ALCANCE_CARD_RADIUS = Math.max(radius.lg, 16)
const ALCANCE_ICON_BOX = 36
const ALCANCE_ICON_INNER_RADIUS = 9

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
    iconBg: 'color-mix(in srgb, var(--app-alcance-reels-border) 24%, var(--app-alcance-reels-bg))',
    lineMuted: 'color-mix(in srgb, var(--app-alcance-reels) 42%, var(--app-text-secondary))',
  },
  carousel: {
    bg: 'var(--app-alcance-carousel-bg)',
    border: 'var(--app-alcance-carousel-border)',
    titleColor: 'var(--app-alcance-carousel)',
    iconBg: 'color-mix(in srgb, var(--app-alcance-carousel-border) 26%, var(--app-alcance-carousel-bg))',
    lineMuted: 'color-mix(in srgb, var(--app-alcance-carousel) 42%, var(--app-text-secondary))',
  },
  photo: {
    bg: 'var(--app-alcance-photo-bg)',
    border: 'var(--app-alcance-photo-border)',
    titleColor: 'var(--app-alcance-photo)',
    iconBg: 'color-mix(in srgb, var(--app-alcance-photo-border) 35%, var(--app-alcance-photo-bg))',
    lineMuted: 'color-mix(in srgb, var(--app-alcance-photo) 32%, var(--app-text-secondary))',
  },
} as const

type AlcanceKind = keyof typeof CARD_STYLES

const ICON_BY_KIND: Record<AlcanceKind, React.ReactNode> = {
  reels: <VideoCameraOutlined aria-hidden />,
  carousel: <AppstoreOutlined aria-hidden />,
  photo: <CameraOutlined aria-hidden />,
}

function AlcanceCard({
  kind,
  pct,
  label,
  description,
}: {
  kind: AlcanceKind
  pct: number
  label: string
  description: string
}) {
  const st = CARD_STYLES[kind]
  const iconColor = st.titleColor

  return (
    <div
      style={{
        flex: 1,
        width: '100%',
        borderRadius: ALCANCE_CARD_RADIUS,
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        boxShadow: '0 1px 3px rgba(15, 23, 42, 0.05)',
        backgroundColor: st.bg,
        border: `1px solid ${st.border}`,
        minHeight: 0,
        boxSizing: 'border-box',
      }}
    >
      <span
        style={{
          fontSize: 18,
          color: iconColor,
          lineHeight: 1,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: ALCANCE_ICON_BOX,
          height: ALCANCE_ICON_BOX,
          borderRadius: ALCANCE_ICON_INNER_RADIUS,
          background: st.iconBg,
        }}
        aria-hidden
      >
        {ICON_BY_KIND[kind]}
      </span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2 }}>
        <Text style={{ fontSize: 15, fontWeight: 700, color: st.titleColor, display: 'block', lineHeight: 1.25, margin: 0 }}>
          {pct}% · {label}
        </Text>
        <Text
          style={{
            fontSize: 12,
            fontWeight: 400,
            color: st.lineMuted,
            lineHeight: 1.4,
            display: 'block',
            margin: 0,
          }}
        >
          {description}
        </Text>
      </div>
    </div>
  )
}

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
  gutter = ALCANCE_GUTTER,
  style,
}: AlcanceSectionProps) {
  if (!distribution) return null
  const { pctReels, pctCarousel, pctPhoto } = distribution
  const hasAny = pctReels > 0 || pctCarousel > 0 || pctPhoto > 0
  if (!hasAny) return null

  const gridGap = Array.isArray(gutter) ? gutter[0] : gutter
  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    columnGap: gridGap,
    rowGap: gridGap,
    width: '100%',
  }

  return (
    <div style={style}>
      <div className="detail-alcance-grid" style={gridStyle}>
        {pctReels >= 0 && (
          <div className="detail-alcance-cell">
            <AlcanceCard
              kind="reels"
              pct={pctReels}
              label="Reels"
              description="Vídeos curtos; forte na descoberta."
            />
          </div>
        )}
        {pctCarousel >= 0 && (
          <div className="detail-alcance-cell">
            <AlcanceCard
              kind="carousel"
              pct={pctCarousel}
              label="Carrossel"
              description="Várias imagens; prende mais atenção."
            />
          </div>
        )}
        {pctPhoto >= 0 && (
          <div className="detail-alcance-cell">
            <AlcanceCard
              kind="photo"
              pct={pctPhoto}
              label="Foto"
              description="Imagem única; formato clássico do feed."
            />
          </div>
        )}
      </div>
    </div>
  )
}
