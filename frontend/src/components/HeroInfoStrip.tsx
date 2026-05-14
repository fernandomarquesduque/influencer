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
}: {
  items: HeroInfoStripItem[]
  isMobile?: boolean
  className?: string
  blur?: boolean
  variant?: 'inline' | 'stat'
  density?: HeroInfoStripDensity
}) {
  if (items.length === 0) return null

  const rootClass = [
    'hero-info-strip',
    variant === 'stat' ? 'hero-info-strip--stat' : 'hero-info-strip--inline',
    density === 'compact' ? 'hero-info-strip--compact' : '',
    isMobile ? 'hero-info-strip--mobile' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <MotionDiv className={rootClass} blur={blur} fitContent={density === 'compact'}>
      {variant === 'stat' ? (
        <StatGrid items={items} isMobile={isMobile} density={density} />
      ) : (
        <InlineRow items={items} isMobile={isMobile} density={density} />
      )}
    </MotionDiv>
  )
}

function MotionDiv({
  className,
  blur,
  fitContent,
  children,
}: {
  className: string
  blur: boolean
  fitContent: boolean
  children: ReactNode
}) {
  return (
    <div
      className={className}
      style={{
        position: 'relative',
        marginTop: s.xs,
        marginBottom: s.md,
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
}: {
  items: HeroInfoStripItem[]
  isMobile: boolean
  density: HeroInfoStripDensity
}) {
  const compact = density === 'compact'
  const iconSize = isMobile ? (compact ? 28 : 34) : compact ? 32 : 40
  const iconFont = isMobile ? (compact ? 12 : 15) : compact ? 13 : 17
  const cellStyle: CSSProperties = {
    gap: isMobile ? (compact ? 6 : 8) : compact ? 7 : 10,
    padding: isMobile
      ? compact
        ? '5px 8px'
        : '10px 8px'
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
            <MetricText isMobile={isMobile} compact={compact} value={value} label={label} />
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
  value,
  label,
}: {
  isMobile: boolean
  compact: boolean
  value: string
  label: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0 }}>
      <strong
        style={{
          fontSize: isMobile ? (compact ? 11 : 13) : compact ? 13 : 15,
          fontWeight: 700,
          color: c.text,
          lineHeight: 1.25,
          wordBreak: 'break-word',
        }}
      >
        {value}
      </strong>
      <span
        style={{
          fontSize: isMobile ? (compact ? 9 : 10) : compact ? 10 : 11,
          color: c.textSecondary,
          lineHeight: 1.3,
          marginTop: compact ? 1 : 2,
        }}
      >
        {label}
      </span>
    </div>
  )
}
