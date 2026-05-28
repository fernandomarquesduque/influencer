/**
 * Padrão visual global para preview de post (capa + métricas), alinhado ao design system do relatório.
 * Use `getPostCoverDisplayUrl(post)` na `<img>` e `getPostStablePreviewUrl(post)` no fundo (mesma mídia do post; perfil só se não houver capa).
 */
import { useState, type CSSProperties, type ReactNode } from 'react'
import { FileImageOutlined } from '@ant-design/icons'
import { Tooltip } from 'antd'
import type { PostItem } from '../api'
import { profileRefFromMediaUrl, queueMediaRefreshForProfile } from '../utils/queueMediaRefreshForProfile'
import { METRIC_TOOLTIPS } from '../constants/metricTooltips'
import { getErBanda } from './ERGaugeChart'
import { reportTokens as t } from '../pages/reportTokens'

const s = t.spacing
const c = t.colors
const r = t.radius
const sh = t.shadow
const typ = t.typography

/** Proporção vertical dos Reels no Instagram (9:16). */
export const INSTAGRAM_REEL_ASPECT_RATIO = '9 / 16' as const

/** Trechos da legenda em caixa alta para overlay no canto da imagem (estilo “3 DICAS…”). */
export function getPostCaptionOverlayLines(post: PostItem, maxLines = 2, maxCharsPerLine = 44): string[] {
  const cap = post.content?.caption_text?.trim()
  if (!cap) return []
  const parts = cap.split(/\s+/)
  const out: string[] = []
  let line = ''
  for (const p of parts) {
    const next = line ? `${line} ${p}` : p
    if (next.length > maxCharsPerLine && line) {
      out.push(line.toUpperCase())
      line = p
      if (out.length >= maxLines) return out
    } else {
      line = next
    }
  }
  if (line && out.length < maxLines) out.push(line.toUpperCase())
  return out.slice(0, maxLines)
}

export interface PostPreviewMediaProps {
  /** `src` final do `<img>` (ex.: `getPostCoverDisplayUrl(post)`). */
  imageDisplaySrc?: string
  stableBackgroundUrl?: string
  imageUnavailable?: boolean
  onImageError?: () => void
  /** Re-extração + S3 quando a capa falhar (`profile_ref` ou handle). */
  profileRefForRefresh?: string
  /** Ex.: `4 / 5` (feed), `1` (quadrado), {@link INSTAGRAM_REEL_ASPECT_RATIO} (Reels). Ignorado se `fill`. */
  aspectRatio?: string
  /** Ocupa 100% do pai com posicionamento absoluto na imagem. */
  fill?: boolean
  overlayLines?: string[]
  topBadges?: ReactNode
  topRight?: ReactNode
  bottomRight?: ReactNode
  showHoverGradient?: boolean
  isHovered?: boolean
  className?: string
  style?: CSSProperties
}

/** Área só da mídia (reutilizável em layouts horizontais, ex. galeria da campanha). */
export function PostPreviewMedia({
  imageDisplaySrc,
  stableBackgroundUrl,
  imageUnavailable,
  onImageError,
  profileRefForRefresh,
  aspectRatio = '4 / 5',
  fill,
  overlayLines,
  topBadges,
  topRight,
  bottomRight,
  showHoverGradient = false,
  isHovered = false,
  className,
  style,
}: PostPreviewMediaProps) {
  const showPlaceholder = imageUnavailable || !imageDisplaySrc
  /** Fundo e frente no mesmo retângulo (absolute + cover + center) para o enquadramento coincidir. */
  const mediaBox: CSSProperties = fill
    ? { position: 'relative', width: '100%', height: '100%', minHeight: 0, overflow: 'hidden', background: c.borderLight, ...style }
    : {
      position: 'relative',
      width: '100%',
      aspectRatio,
      overflow: 'hidden',
      background: c.borderLight,
      ...style,
    }

  const mediaLayerFill: CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    objectPosition: 'center center',
  }

  return (
    <div className={className} style={mediaBox}>
      {stableBackgroundUrl ? (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 0,
            backgroundImage: `url(${stableBackgroundUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center center',
            backgroundRepeat: 'no-repeat',
          }}
        />
      ) : null}
      {topBadges ? (
        <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 2, display: 'flex', flexWrap: 'wrap', gap: 4 }}>{topBadges}</div>
      ) : null}
      {topRight ? (
        <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 4, display: 'flex', pointerEvents: 'auto' }}>{topRight}</div>
      ) : null}
      {overlayLines && overlayLines.length > 0 ? (
        <div
          style={{
            position: 'absolute',
            top: topBadges ? 40 : 8,
            left: 8,
            right: 8,
            zIndex: 2,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 4,
            pointerEvents: 'none',
          }}
        >
          {overlayLines.map((line, i) => (
            <span
              key={i}
              style={{
                display: 'inline-block',
                maxWidth: '100%',
                padding: '3px 8px',
                borderRadius: 4,
                background: 'rgba(0,0,0,0.55)',
                color: '#fff',
                fontWeight: 700,
                fontSize: 10,
                lineHeight: 1.25,
                letterSpacing: '0.02em',
                textTransform: 'uppercase',
                wordBreak: 'break-word',
              }}
            >
              {line}
            </span>
          ))}
        </div>
      ) : null}
      {!showPlaceholder ? (
        <img
          src={imageDisplaySrc}
          alt=""
          loading="lazy"
          onError={() => {
            const ref =
              profileRefForRefresh ||
              profileRefFromMediaUrl(imageDisplaySrc) ||
              profileRefFromMediaUrl(stableBackgroundUrl)
            queueMediaRefreshForProfile(ref)
            onImageError?.()
          }}
          style={{
            ...mediaLayerFill,
            zIndex: 1,
          }}
        />
      ) : (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1,
          }}
        >
          <FileImageOutlined style={{ fontSize: 32, color: c.textMuted }} aria-hidden />
        </div>
      )}
      {bottomRight ? <div style={{ position: 'absolute', bottom: 8, right: 8, zIndex: 3 }}>{bottomRight}</div> : null}
      {showHoverGradient ? (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 2,
            background: 'linear-gradient(to top, var(--app-overlay) 0%, transparent 50%)',
            opacity: isHovered ? 1 : 0,
            transition: 'opacity 0.2s ease',
            pointerEvents: 'none',
          }}
        />
      ) : null}
    </div>
  )
}

export interface PostPreviewCardProps {
  href?: string
  target?: string
  rel?: string
  imageDisplaySrc?: string
  stableBackgroundUrl?: string
  imageUnavailable?: boolean
  onImageError?: () => void
  profileRefForRefresh?: string
  /** Padrão visual: 4/5 (feed). Use `1` para grade quadrada compacta. */
  mediaAspectRatio?: string
  overlayLines?: string[]
  imageTopBadges?: ReactNode
  imageBottomRight?: ReactNode
  showCaptionOverlay?: boolean
  interactionsLabel?: string
  erPercent?: number
  showErBand?: boolean
  footerHint?: string
  authorLine?: string
  /** Só mídia (sem rodapé de métricas) — ex.: vitrine Top 4 sem texto sobre a imagem. */
  hideFooter?: boolean
  showHoverGradient?: boolean
  'aria-label'?: string
  className?: string
  cardStyle?: CSSProperties
}

/**
 * Card completo: mídia + rodapé com interações, ER e faixa de qualidade + dica (roxo).
 */
export default function PostPreviewCard({
  href,
  target = '_blank',
  rel = 'noopener noreferrer',
  imageDisplaySrc,
  stableBackgroundUrl,
  imageUnavailable,
  onImageError,
  profileRefForRefresh,
  mediaAspectRatio = '4 / 5',
  overlayLines,
  imageTopBadges,
  imageBottomRight,
  interactionsLabel,
  erPercent,
  showErBand = true,
  footerHint,
  authorLine,
  hideFooter = false,
  showHoverGradient = true,
  'aria-label': ariaLabel,
  className,
  cardStyle,
}: PostPreviewCardProps) {
  const [hovered, setHovered] = useState(false)
  const er = erPercent ?? 0
  const banda = getErBanda(er)

  const body = (
    <>
      <PostPreviewMedia
        imageDisplaySrc={imageUnavailable ? undefined : imageDisplaySrc}
        stableBackgroundUrl={stableBackgroundUrl}
        imageUnavailable={imageUnavailable}
        onImageError={onImageError}
        profileRefForRefresh={profileRefForRefresh}
        aspectRatio={mediaAspectRatio}
        overlayLines={overlayLines}
        topBadges={imageTopBadges}
        bottomRight={imageBottomRight}
        showHoverGradient={showHoverGradient}
        isHovered={hovered}
      />
      {!hideFooter ? (
        <div style={{ padding: s.md }}>
          {authorLine ? (
            <div style={{ ...typ.caption, color: c.textMuted, marginBottom: 4 }}>{authorLine}</div>
          ) : null}
          {interactionsLabel ? (
            <Tooltip title={METRIC_TOOLTIPS.interacoesPost} placement="top">
              <div style={{ ...typ.bodySmall, fontWeight: 600, color: c.text, cursor: 'help', display: 'inline-block' }}>{interactionsLabel}</div>
            </Tooltip>
          ) : null}
          {showErBand && erPercent !== undefined ? (
            <Tooltip title={METRIC_TOOLTIPS.erPost} placement="top">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                <span style={{ ...typ.caption, color: c.textMuted, cursor: 'help' }}>ER {er.toFixed(1)}%</span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    padding: '2px 6px',
                    borderRadius: r.sm,
                    background: `${banda.color}22`,
                    color: banda.color,
                    border: `1px solid ${banda.color}44`,
                  }}
                >
                  {banda.label}
                </span>
              </div>
            </Tooltip>
          ) : null}
          {footerHint ? (
            <div style={{ ...typ.caption, color: c.primary, marginTop: 8, lineHeight: 1.35 }}>{footerHint}</div>
          ) : null}
        </div>
      ) : null}
    </>
  )

  const shellStyle: CSSProperties = {
    display: 'block',
    borderRadius: r.lg,
    overflow: 'hidden',
    boxShadow: sh.md,
    background: c.cardBg,
    minWidth: 0,
    transition: t.animation.hoverTransition,
    ...cardStyle,
  }

  if (href) {
    return (
      <a
        href={href}
        target={target}
        rel={rel}
        className={`post-preview-card report-card--hover ${className ?? ''}`.trim()}
        style={shellStyle}
        aria-label={ariaLabel}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {body}
      </a>
    )
  }

  return (
    <div
      className={`post-preview-card ${className ?? ''}`.trim()}
      style={shellStyle}
      aria-label={ariaLabel}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {body}
    </div>
  )
}

