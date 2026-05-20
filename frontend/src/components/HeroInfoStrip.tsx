import { Fragment, type CSSProperties, type ReactNode } from 'react'
import { Tooltip } from 'antd'
import { reportTokens as t } from '../pages/reportTokens'
import './HeroInfoStrip.css'

const s = t.spacing
const c = t.colors

export interface HeroInfoStripItem {
  key: string
  value: string
  label: string
  icon: ReactNode
  iconBg: string
  iconFg: string
  tooltip?: string
}

type HeroInfoStripDensity = 'default' | 'compact'

export function HeroInfoStrip({
  items,
  isMobile = false,
  className,
  blur = false,
  variant = 'inline',
  density = 'default',
  /** Só na faixa LLM: em mobile empilha ícone acima do texto e reduz fontes (mais largura por célula). */
  stackOnMobile = false,
  /** Ocupa 100% da largura com células distribuídas (ex.: badges LLM no modal). */
  fullWidth = false,
  marginTop,
  marginBottom,
}: {
  items: HeroInfoStripItem[]
  isMobile?: boolean
  className?: string
  blur?: boolean
  variant?: 'inline' | 'stat'
  density?: HeroInfoStripDensity
  stackOnMobile?: boolean
  fullWidth?: boolean
  marginTop?: number
  marginBottom?: number
}) {
  if (items.length === 0) return null

  const rootClass = [
    'hero-info-strip',
    variant === 'stat' ? 'hero-info-strip--stat' : 'hero-info-strip--inline',
    density === 'compact' ? 'hero-info-strip--compact' : '',
    isMobile ? 'hero-info-strip--mobile' : '',
    isMobile && stackOnMobile ? 'hero-info-strip--stack-mobile' : '',
    fullWidth ? 'hero-info-strip--full-width' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <MotionDiv
      className={rootClass}
      blur={blur}
      fitContent={density === 'compact' && !(isMobile && stackOnMobile) && !fullWidth}
      marginTop={marginTop}
      marginBottom={marginBottom}
    >
      {variant === 'stat' ? (
        <StatGrid items={items} isMobile={isMobile} density={density} />
      ) : (
        <InlineRow items={items} isMobile={isMobile} density={density} stackOnMobile={stackOnMobile} fullWidth={fullWidth} />
      )}
    </MotionDiv>
  )
}

function MotionDiv({
  className,
  blur,
  fitContent,
  marginTop,
  marginBottom,
  children,
}: {
  className: string
  blur: boolean
  fitContent: boolean
  marginTop?: number
  marginBottom?: number
  children: ReactNode
}) {
  return (
    <div
      className={className}
      style={{
        position: 'relative',
        marginTop: marginTop ?? s.xs,
        marginBottom: marginBottom ?? s.md,
        width: fitContent ? 'fit-content' : '100%',
        maxWidth: fitContent ? '100%' : undefined,
        ...(blur ? { filter: 'blur(6px)', userSelect: 'none', pointerEvents: 'none' } : {}),
      }}
    >
      {children}
    </div>
  )
}

function StripIcon({
  icon,
  iconBg,
  iconFg,
  iconSize,
  iconFont,
  className,
}: {
  icon: ReactNode
  iconBg: string
  iconFg: string
  iconSize: number
  iconFont: number
  className?: string
}) {
  return (
    <div
      className={className}
      style={{
        width: iconSize,
        height: iconSize,
        borderRadius: className ? undefined : '50%',
        background: iconBg,
        color: iconFg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        fontSize: iconFont,
      }}
      aria-hidden
    >
      {icon}
    </div>
  )
}

function StatGrid({
  items,
  isMobile,
  density,
}: {
  items: HeroInfoStripItem[]
  isMobile: boolean
  density: HeroInfoStripDensity
}) {
  const compact = density === 'compact'
  const iconSize = isMobile ? (compact ? 24 : 30) : compact ? 28 : 34
  const iconFont = isMobile ? (compact ? 12 : 14) : compact ? 13 : 15
  return (
    <div
      className="hero-info-strip-grid"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {items.map(({ key, value, label, icon, iconBg, iconFg, tooltip }) => {
        const card = (
          <div className="hero-info-strip-stat">
              <StripIcon
                className="hero-info-strip-stat-icon"
                icon={icon}
                iconBg={iconBg}
                iconFg={iconFg}
                iconSize={iconSize}
                iconFont={iconFont}
              />
              <strong
                className="hero-info-strip-stat-value"
                style={{ fontSize: isMobile ? (compact ? 13 : 15) : compact ? 14 : 17 }}
              >
                {value}
              </strong>
              <span
                className="hero-info-strip-stat-label"
                style={{ fontSize: isMobile ? (compact ? 9 : 10) : compact ? 10 : 11 }}
              >
                {label}
              </span>
          </div>
        )
        return tooltip ? (
          <Tooltip key={key} title={tooltip}>
            {card}
          </Tooltip>
        ) : (
          <Fragment key={key}>{card}</Fragment>
        )
      })}
    </div>
  )
}

function InlineRow({
  items,
  isMobile,
  density,
  stackOnMobile,
  fullWidth = false,
}: {
  items: HeroInfoStripItem[]
  isMobile: boolean
  density: HeroInfoStripDensity
  stackOnMobile: boolean
  fullWidth?: boolean
}) {
  const compact = density === 'compact'
  const stacked = isMobile && stackOnMobile
  const iconSize = stacked
    ? compact ? 22 : 24
    : isMobile
      ? compact ? 28 : 32
      : compact ? 32 : 40
  const iconFont = stacked
    ? compact ? 11 : 12
    : isMobile
      ? compact ? 12 : 14
      : compact ? 13 : 17
  const cellStyle: CSSProperties = {
    flexDirection: stacked ? 'column' : 'row',
    alignItems: 'center',
    justifyContent: stacked ? 'flex-start' : undefined,
    gap: stacked ? (compact ? 4 : 5) : isMobile ? (compact ? 6 : 8) : compact ? 7 : 10,
    padding: fullWidth
      ? stacked
        ? compact
          ? '10px 8px'
          : '12px 10px'
        : compact
          ? '12px 10px'
          : '14px 12px'
      : stacked
        ? compact
          ? '6px 5px'
          : '7px 6px'
        : isMobile
          ? compact
            ? '5px 8px'
            : '8px 6px'
          : compact
            ? '6px 10px'
            : '12px 14px',
  }

  return (
    <div className="hero-info-strip-row">
      {items.map(({ key, value, label, icon, iconBg, iconFg, tooltip }, index) => {
        const cell = (
          <div className="hero-info-strip-cell" style={cellStyle}>
            <StripIcon icon={icon} iconBg={iconBg} iconFg={iconFg} iconSize={iconSize} iconFont={iconFont} />
            <MetricText isMobile={isMobile} compact={compact} stacked={stacked} value={value} label={label} />
          </div>
        )
        return (
          <Fragment key={key}>
            {index > 0 ? <div className="hero-info-strip-divider" aria-hidden /> : null}
            {tooltip ? <Tooltip title={tooltip}>{cell}</Tooltip> : cell}
          </Fragment>
        )
      })}
    </div>
  )
}

function MetricText({
  isMobile,
  compact,
  stacked,
  value,
  label,
}: {
  isMobile: boolean
  compact: boolean
  stacked: boolean
  value: string
  label: string
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: stacked ? 'center' : 'flex-start',
        textAlign: stacked ? 'center' : 'left',
        minWidth: 0,
        width: stacked ? '100%' : undefined,
      }}
    >
      <strong
        style={{
          fontSize: stacked
            ? compact ? 10 : 11
            : isMobile
              ? compact ? 11 : 12
              : compact ? 13 : 15,
          fontWeight: 700,
          color: c.text,
          lineHeight: 1.2,
          wordBreak: 'break-word',
          hyphens: stacked ? ('auto' as const) : undefined,
        }}
      >
        {value}
      </strong>
      <span
        style={{
          fontSize: stacked
            ? compact ? 8 : 9
            : isMobile
              ? compact ? 9 : 10
              : compact ? 10 : 11,
          color: c.textSecondary,
          lineHeight: 1.25,
          marginTop: compact ? 1 : isMobile ? 2 : 2,
        }}
      >
        {label}
      </span>
    </div>
  )
}
