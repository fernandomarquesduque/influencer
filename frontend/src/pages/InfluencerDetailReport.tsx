/**
 * Subcomponentes do relatório premium (ReportHero, ScoreOverview, DiagnosticoBISection, etc.)
 */
import React, { useState } from 'react'
import { Button, Card, Tag, Progress, Skeleton, Tabs, Tooltip, Row, Col, Modal } from 'antd'
import {
  CheckCircleFilled,
  WarningFilled,
  RocketOutlined,
  DollarOutlined,
  CommentOutlined,
  MessageOutlined,
  TeamOutlined,
  FileTextOutlined,
  CalendarOutlined,
  HeartOutlined,
  EyeOutlined,
  LineChartOutlined,
  ThunderboltOutlined,
  PieChartOutlined,
  ClockCircleOutlined,
  RiseOutlined,
  PlayCircleOutlined,
} from '@ant-design/icons'
import { reportTokens as t } from './reportTokens'
import { METRIC_TOOLTIPS } from '../constants/metricTooltips'
import { ERGaugeChart, ER_QUALIDADE_BANDAS, erBandaRangeLabel, getErBanda } from '../components/ERGaugeChart'
import { TierProgressGameBar } from '../components/TierProgressGameBar'
import type { StrategicMetrics, ExecutiveSummaryForBrands, BenchmarkInsight } from '../utils/reportInsights'
import { getPostStablePreviewUrl, type PostItem } from '../api'
import ProfileAvatar from '../components/ProfileAvatar'
import PostPreviewCard, { getPostCaptionOverlayLines } from '../components/PostPreviewCard'
import { HeroInfoStrip, type HeroInfoStripItem } from '../components/HeroInfoStrip'
import './ReportHeroCompact.css'
import './InfluencerDetailStack.css'

const s = t.spacing
const c = t.colors
const r = t.radius
const sh = t.shadow
const typ = t.typography

/** Estilo base de card do relatório (bordas, sombra, transição) */
const cardBaseStyle: React.CSSProperties = {
  borderRadius: r.lg,
  border: 'none',
  boxShadow: sh.sm,
  transition: t.animation.hoverTransition,
}

// ——— ReportHero ———
export interface ReportHeroProps {
  profilePic: string
  /** Foto estável (S3) como fundo quando a URL do Instagram falha. */
  stableProfilePicUrl?: string
  /** Nome de exibição do perfil */
  name?: string
  /** Categoria principal (LLM) — linha fina acima do nome */
  categoryEyebrow?: string | null
  /** Handle/username para exibir como @handle */
  handle?: string
  /** Texto ou conteúdo (ex.: tags + descrição) exibido no lugar da BIO no card */
  headline: React.ReactNode
  /** Badge principal (ex.: "Top 90%") quando não há tier à direita */
  badgeLabel?: string
  /** Tier + selo à direita na mesma linha do nome (legado; preferir tierBadgeShort abaixo do avatar). */
  tierLabel?: string
  /** Patamar curto abaixo da foto (ex.: "Nano"), fundo sólido sem degradê. */
  tierBadgeShort?: string
  percentil?: number | null
  scoreSelo?: string
  highlights: { label: string; value: string }[]
  /** Segunda linha de métricas (ex.: curtidas, comentários, média likes/post, total posts) — agrupada com highlights */
  secondaryMetrics?: React.ReactNode
  onBack: () => void
  onAvatarError: () => void
  /** Em mobile: avatar e espaçamentos menores */
  isMobile?: boolean
  /** Conteúdo extra dentro do mesmo painel (ex.: ScoreOverview) */
  extraContent?: React.ReactNode
  /** Score 0–100: renderiza barra de progresso logo abaixo dos highlights */
  score?: number
  /** Tooltip da barra de progresso (ex.: explicação do score) */
  scoreTooltip?: string
  /** Tags de tipo/conteúdo exibidas na coluna direita (ex.: Moda, Beleza) */
  typesTags?: React.ReactNode
  /** Prévia limitada: desfoca os números do hero (seguidores, ER, posts/sem). */
  blurHighlights?: boolean
  /** Modal / prévia bloqueada: menos padding e bio em uma linha. */
  compact?: boolean
  /** Tooltip do selo de patamar (ex.: faixa de seguidores). */
  tierBadgeTooltip?: string
  /** Ação primária alinhada à faixa de métricas (ex.: Ativar Cadastro). */
  heroAction?: React.ReactNode
  /** Menos espaço abaixo do hero (ex.: card de localização logo em seguida). */
  tightBottomSpacing?: boolean
}

const AVATAR_SIZE = 80
const AVATAR_SIZE_MOBILE = 48

function heroMetricMeta(label: string): { icon: React.ReactNode; bg: string; fg: string } {
  if (label === 'Seguidores') {
    return { icon: <TeamOutlined />, bg: 'rgba(104, 39, 143, 0.14)', fg: '#68278f' }
  }
  if (label === 'Posts/sem') {
    return { icon: <CalendarOutlined />, bg: 'rgba(14, 165, 233, 0.14)', fg: '#0ea5e9' }
  }
  if (label === 'ER médio' || label === 'ER') {
    return {
      icon: <span style={{ fontSize: '1em', fontWeight: 700, lineHeight: 1 }}>%</span>,
      bg: 'rgba(219, 39, 119, 0.14)',
      fg: '#db2777',
    }
  }
  return { icon: <FileTextOutlined />, bg: 'rgba(104, 39, 143, 0.14)', fg: '#68278f' }
}

function ReportHeroMetricsStrip({
  highlights,
  blurHighlights,
  isMobile,
  compact = false,
}: {
  highlights: { label: string; value: string }[]
  blurHighlights: boolean
  isMobile: boolean
  compact?: boolean
}) {
  const items: HeroInfoStripItem[] = highlights.map(({ label, value }) => {
    const meta = heroMetricMeta(label)
    const tooltipKey =
      label === 'Seguidores' ? 'seguidores' : label === 'ER' || label === 'ER médio' ? 'er' : label === 'Posts/sem' ? 'postsPerSemana' : null
    const tip = tooltipKey ? METRIC_TOOLTIPS[tooltipKey as keyof typeof METRIC_TOOLTIPS] : undefined
    return {
      key: label,
      value,
      label,
      icon: meta.icon,
      iconBg: meta.bg,
      iconFg: meta.fg,
      tooltip: tip,
    }
  })
  return (
    <HeroInfoStrip
      className="report-hero-metrics"
      items={items}
      isMobile={isMobile}
      blur={blurHighlights}
      density="compact"
      fullWidth={compact}
      marginBottom={compact ? 0 : undefined}
    />
  )
}

export function ReportHero({
  profilePic,
  stableProfilePicUrl,
  name,
  categoryEyebrow,
  handle: handleProp,
  headline,
  badgeLabel,
  tierLabel: tierLabelProp,
  tierBadgeShort,
  percentil,
  scoreSelo,
  highlights,
  secondaryMetrics,
  onBack: _onBack,
  onAvatarError,
  isMobile = false,
  extraContent,
  score: scoreValue,
  scoreTooltip: _scoreTooltip,
  typesTags,
  blurHighlights = false,
  compact = false,
  tierBadgeTooltip,
  heroAction,
  tightBottomSpacing = false,
}: ReportHeroProps) {
  const atHandle = handleProp ? `@${handleProp.replace(/^@/, '')}` : ''
  const avatarSize = isMobile ? AVATAR_SIZE_MOBILE : compact ? 96 : AVATAR_SIZE
  const avatarRenderSize = compact ? 96 : avatarSize
  const pad = compact ? s.sm : isMobile ? s.sm : s.md
  const gap = isMobile ? s.xs : s.sm
  const showTypesColumn = !isMobile && typesTags != null
  const tierUnderAvatarLabel = tierBadgeShort ?? badgeLabel ?? null
  const showTierUnderAvatar = tierUnderAvatarLabel != null && tierUnderAvatarLabel !== '—'

  const tierUnderAvatarTag = showTierUnderAvatar ? (
    <Tag
      className="report-hero-tier-badge"
      style={{
        background: c.primary,
        color: 'var(--brand-white)',
        border: 'none',
        borderRadius: r.full,
        padding: isMobile ? '2px 8px' : '3px 10px',
        margin: 0,
        marginTop: 6,
        fontSize: isMobile ? 10 : 11,
        fontWeight: 700,
        lineHeight: 1.35,
        maxWidth: '100%',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        boxShadow: 'none',
      }}
    >
      {tierUnderAvatarLabel}
    </Tag>
  ) : null

  return (
    <section
      className={`report-hero${compact ? ' report-hero--compact' : ''}`}
      style={{
        position: 'relative',
        width: '100%',
        boxSizing: 'border-box',
        paddingBottom: 0,
      }}
      aria-label="Cabeçalho do relatório"
    >
      <div
        className="report-hero-inner"
        style={{
          borderRadius: compact ? 0 : isMobile ? r.lg : r.xl,
          background: compact ? 'transparent' : c.heroGradient,
          position: 'relative',
          overflow: 'hidden',
          padding: pad,
          boxShadow: compact ? 'none' : sh.md,
        }}
      >
        {!compact && <div style={{ position: 'absolute', inset: 0, background: c.heroBlob, pointerEvents: 'none' }} />}

        <div
          className="report-hero-main-row"
          style={{
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            alignItems: isMobile ? 'center' : 'center',
            justifyContent: isMobile ? 'center' : undefined,
            gap: isMobile ? s.sm : s.lg,
            flexWrap: 'nowrap',
            position: 'relative',
            zIndex: 0,
            textAlign: isMobile ? 'center' : undefined,
            width: '100%',
          }}
        >
          {/* Avatar + nome + métricas */}
          <div
            style={{
              display: 'flex',
              flex: 1,
              flexDirection: isMobile ? 'column' : 'row',
              alignItems: isMobile ? 'center' : showTierUnderAvatar ? 'flex-start' : 'center',
              gap,
              flexWrap: 'wrap',
              minWidth: 0,
            }}
          >
            <div
              className={[
                'report-hero-avatar-col',
                compact ? 'report-hero-avatar-col--compact' : undefined,
                showTierUnderAvatar ? 'report-hero-tier-under-avatar' : undefined,
              ]
                .filter(Boolean)
                .join(' ')}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                flexShrink: 0,
                width: compact ? undefined : avatarSize,
                marginRight: compact ? undefined : isMobile ? 0 : s.md,
                marginBottom: isMobile ? s.sm : 0,
              }}
            >
              <div className={compact ? 'report-hero-avatar-wrap' : undefined}>
                <ProfileAvatar
                  src={profilePic}
                  stableBackgroundUrl={stableProfilePicUrl}
                  handle={handleProp}
                  alt={name || atHandle || 'Foto do perfil'}
                  size={avatarRenderSize}
                  border="3px solid var(--brand-white)"
                  shadow={sh.md}
                  onImageError={onAvatarError}
                />
              </div>
              {showTierUnderAvatar
                ? tierBadgeTooltip
                  ? <Tooltip title={tierBadgeTooltip}>{tierUnderAvatarTag}</Tooltip>
                  : tierUnderAvatarTag
                : null}
            </div>
            <div
              className={compact ? 'report-hero-content' : undefined}
              style={{ flex: isMobile ? undefined : 1, minWidth: 0, width: isMobile ? '100%' : undefined, textAlign: isMobile ? 'center' : undefined }}
            >
              {(name || categoryEyebrow?.trim()) && (
                <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: isMobile ? 'center' : 'flex-start', gap: s.xs, marginBottom: 0 }}>
                  <div style={{ minWidth: 0, textAlign: isMobile ? 'center' : undefined, lineHeight: 1.25 }}>
                    {categoryEyebrow?.trim() ? (
                      <div
                        style={{
                          ...typ.caption,
                          color: c.primary,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                          marginBottom: 6,
                          fontSize: isMobile ? 10 : 11,
                        }}
                      >
                        {categoryEyebrow.trim()}
                      </div>
                    ) : null}
                    {name && <h1 style={{ ...typ.hero, color: c.text, margin: 0, marginBottom: 0, lineHeight: 1.2, fontSize: isMobile ? 18 : 20 }}>{name}</h1>}
                  </div>
                </div>
              )}
              {headline != null && (
                <div
                  className={compact ? 'report-hero-headline' : undefined}
                  style={{
                    ...typ.body,
                    color: c.textSecondary,
                    margin: 0,
                    marginTop: compact ? undefined : s.xs,
                    marginBottom: compact ? undefined : 4,
                    fontSize: compact ? undefined : isMobile ? 12 : 13,
                    lineHeight: compact ? undefined : 1.35,
                    ...(compact
                      ? {}
                      : {
                        display: '-webkit-box',
                        overflow: 'hidden',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical' as const,
                      }),
                  }}
                >
                  {typeof headline === 'string' ? <p style={{ margin: 0 }}>{headline}</p> : headline}
                </div>
              )}
              <div className="report-hero-metrics-row" style={{ marginTop: compact ? undefined : s.xs, width: '100%' }}>
                <ReportHeroMetricsStrip highlights={highlights} blurHighlights={blurHighlights} isMobile={isMobile} compact={compact} />
                {secondaryMetrics && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: isMobile ? s.xs : s.sm, alignItems: 'center', justifyContent: isMobile ? 'center' : undefined, ...typ.bodySmall, color: c.textSecondary, marginTop: 4, marginBottom: scoreValue != null ? 4 : 6, fontSize: 12 }}>
                    {secondaryMetrics}
                  </div>
                )}
                {typesTags != null && isMobile && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'center', marginTop: s.sm }}>
                    {typesTags}
                  </div>
                )}
                {heroAction != null && isMobile && (
                  <div className="report-hero-action" style={{ display: 'flex', justifyContent: 'center', marginTop: s.sm, width: '100%' }}>
                    {heroAction}
                  </div>
                )}
              </div>
            </div>
          </div>
          {heroAction != null && !isMobile && (
            <div
              className="report-hero-action-col"
              style={{
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                paddingLeft: s.sm,
              }}
            >
              {heroAction}
            </div>
          )}
          {showTypesColumn && (
            <div className="report-hero-types-col" style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, minWidth: 120, alignSelf: 'flex-start' }}>
              {typesTags}
            </div>
          )}
        </div>
        {extraContent != null ? <div className="report-hero-extra">{extraContent}</div> : null}
      </div>
    </section>
  )
}

// ——— ScoreOverview ———
export interface ScoreOverviewProps {
  score: number
  tierLabel: string
  scoreSelo: string
  percentil: number | null
  explanation: string
  statPills: { label: string; value: string }[]
  postsPerWeekData?: number[]
  bestDay?: string
  bestHour?: number
  /** Dentro do hero: sem Card, visual unificado */
  embedded?: boolean
  /** Tier/percentil já mostrados no hero: não repetir a linha */
  tierInHero?: boolean
  /** Não exibir o bloco Posts por semana (ex.: quando está em card separado) */
  hidePostsPerWeek?: boolean
  /** No modo embedded: não exibir o parágrafo de explicação (ex.: já está no tooltip da barra) */
  hideExplanationInEmbedded?: boolean
  /** Frase narrativa do score (ex.: acima em engajamento, abaixo em estrutura comercial) */
  scoreNarrativaFrase?: string | null
}

export function ScoreOverview({
  score,
  tierLabel,
  scoreSelo,
  percentil,
  explanation,
  statPills,
  postsPerWeekData = [],
  bestDay,
  bestHour,
  embedded = false,
  tierInHero = false,
  hidePostsPerWeek = false,
  hideExplanationInEmbedded = false,
  scoreNarrativaFrase,
}: ScoreOverviewProps) {
  const maxBar = Math.max(1, ...postsPerWeekData)
  const scoreColor = score >= 70 ? c.success : score >= 40 ? c.primary : c.warning
  const progressGradient = score >= 70
    ? `linear-gradient(90deg, ${c.success} 0%, var(--app-success-accent) 100%)`
    : score >= 40
      ? `linear-gradient(90deg, ${c.primary} 0%, var(--app-primary-dark) 100%)`
      : `linear-gradient(90deg, ${c.warning} 0%, var(--app-warning-accent) 100%)`
  const pillColors = [c.primaryMuted, c.goldLight, c.successBg]

  const compact = embedded
  const showCircleAndBar = !embedded
  const showStatPills = !embedded && statPills.length > 0
  const showPostsPerWeek = postsPerWeekData.length > 0 && !hidePostsPerWeek

  const inner = (
    <>
      {showCircleAndBar && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: s.lg, marginBottom: s.lg }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: s.lg, flexWrap: 'wrap' }}>
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: '50%',
                background: `linear-gradient(135deg, ${scoreColor} 0%, ${scoreColor}99 100%)`,
                boxShadow: `0 4px 14px ${scoreColor}40`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              aria-hidden
            >
              <span style={{ fontSize: 28, fontWeight: 800, color: 'var(--brand-white)' }}>{score}</span>
            </div>
            <div>
              <div style={{ ...typ.overline, color: c.textMuted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Sua nota</div>
              <div style={{ ...typ.body, color: c.textSecondary }}>{score}/100</div>
            </div>
          </div>
          <Tag
            style={{
              background: `linear-gradient(135deg, ${c.goldLight} 0%, var(--app-gold-border) 100%)`,
              color: 'var(--app-text)',
              border: `1px solid ${c.goldBorder}`,
              borderRadius: r.full,
              padding: '8px 16px',
              fontWeight: 700,
              fontSize: 13,
              boxShadow: 'var(--app-gold-shadow)',
            }}
          >
            ⭐ {tierLabel}
          </Tag>
        </div>
      )}
      {showCircleAndBar && (
        <div style={{ marginBottom: embedded ? 0 : s.md }}>
          <Progress
            percent={score}
            showInfo={false}
            strokeColor={progressGradient}
            trailColor={c.progressTrail}
            size={12}
            style={{ marginBottom: 0 }}
          />
        </div>
      )}
      {embedded && !tierInHero && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: s.sm, marginBottom: 0 }}>
          <Tag
            style={{
              background: `linear-gradient(135deg, ${c.goldLight} 0%, var(--app-gold-border) 100%)`,
              color: 'var(--app-text)',
              border: `1px solid ${c.goldBorder}`,
              borderRadius: r.full,
              padding: '4px 12px',
              fontWeight: 700,
              fontSize: 12,
              margin: 0,
            }}
          >
            ⭐ {tierLabel}
          </Tag>
          {(percentil != null || scoreSelo) && (
            <span style={{ ...typ.caption, color: c.textSecondary }}>
              {percentil != null && (
                <Tooltip title={METRIC_TOOLTIPS.topPercentil} placement="top">
                  <span style={{ fontWeight: 600, color: c.primary, cursor: 'help' }}>Top {percentil}%</span>
                </Tooltip>
              )}
              {percentil != null && scoreSelo && ' · '}
              {scoreSelo && (
                <Tooltip title={METRIC_TOOLTIPS.selo} placement="top">
                  <span style={{ cursor: 'help' }}>{scoreSelo}</span>
                </Tooltip>
              )}
            </span>
          )}
        </div>
      )}
      {!embedded && (percentil != null || scoreSelo) && (
        <div
          style={{
            ...typ.caption,
            color: c.textSecondary,
            marginBottom: s.md,
            padding: `${s.sm}px ${s.md}px`,
            background: c.primaryMuted,
            borderRadius: r.md,
            display: 'inline-flex',
            flexWrap: 'wrap',
            gap: 4,
            alignItems: 'center',
          }}
        >
          {percentil != null && (
            <Tooltip title={METRIC_TOOLTIPS.topPercentil} placement="top">
              <span style={{ fontWeight: 600, color: c.primary, cursor: 'help' }}>Top {percentil}%</span>
            </Tooltip>
          )}
          {percentil != null && scoreSelo && ' · '}
          {scoreSelo && (
            <Tooltip title={METRIC_TOOLTIPS.selo} placement="top">
              <span style={{ cursor: 'help' }}>{scoreSelo}</span>
            </Tooltip>
          )}
        </div>
      )}
      {explanation && !(embedded && hideExplanationInEmbedded) && (
        <p style={{ ...typ.bodySmall, color: c.textSecondary, margin: 0, marginBottom: embedded ? 0 : (compact ? s.sm : s.lg), lineHeight: 1.45, fontSize: compact ? 12 : undefined }}>{explanation}</p>
      )}
      {embedded && scoreNarrativaFrase && (
        <p style={{ ...typ.bodySmall, color: c.text, margin: 0, marginTop: embedded ? 0 : (compact ? 4 : 6), marginBottom: 0, lineHeight: 1.45, fontSize: compact ? 12 : undefined, fontWeight: 500 }}>{scoreNarrativaFrase}</p>
      )}
      {showPostsPerWeek && (
        <div
          style={{
            padding: compact ? s.md : s.lg,
            background: embedded ? 'var(--app-glass-bg)' : 'var(--app-primary-muted)',
            borderRadius: r.lg,
            border: embedded ? 'none' : `1px solid ${c.primaryMuted}`,
            width: '100%',
            marginBottom: embedded ? 0 : (compact ? s.sm : s.lg),
          }}
        >
          <Tooltip title={METRIC_TOOLTIPS.postsPorSemanaUltimas8} placement="top">
            <div style={{ ...typ.caption, color: c.primary, fontWeight: 600, marginBottom: compact ? 6 : 8, cursor: 'help', display: 'inline-block' }}>Posts por semana (últimas 8)</div>
          </Tooltip>
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: compact ? 32 : 40, width: '100%' }}>
            {postsPerWeekData.map((n, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  minWidth: 0,
                  height: Math.max(6, (n / maxBar) * (compact ? 26 : 34)),
                  background: 'var(--app-chart-bar-gradient)',
                  borderRadius: 6,
                  boxShadow: 'var(--app-chart-bar-shadow)',
                }}
                title={`${n} posts`}
              />
            ))}
          </div>
          {(bestDay != null && bestHour != null) && (
            <Tooltip title={METRIC_TOOLTIPS.melhorDiaHora} placement="top">
              <div style={{ ...typ.caption, color: c.textSecondary, marginTop: compact ? 6 : 10, fontWeight: 500, cursor: 'help', display: 'inline-block' }}>
                🕐 Melhor: {bestDay} às {bestHour}h
              </div>
            </Tooltip>
          )}
        </div>
      )}
      {showStatPills && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: s.sm }}>
          {statPills.map(({ label, value }, i) => {
            const tooltipKey = label === 'Seguidores' ? 'seguidores' : label === 'ER' ? 'er' : label === 'Posts/sem' ? 'postsPerSemana' : null
            const tip = tooltipKey ? METRIC_TOOLTIPS[tooltipKey as keyof typeof METRIC_TOOLTIPS] : null
            const pill = (
              <div
                className="stat-pill"
                style={{
                  padding: `${s.sm}px ${s.lg}px`,
                  background: pillColors[i % pillColors.length] ?? c.cardBgSoft,
                  border: `1px solid ${c.borderLight}`,
                  borderRadius: r.lg,
                  ...typ.bodySmall,
                  fontWeight: 600,
                  color: c.text,
                  boxShadow: sh.sm,
                  cursor: tip ? 'help' : undefined,
                }}
              >
                <span style={{ color: c.textMuted, fontWeight: 500 }}>{label}</span>
                <span style={{ marginLeft: 8, color: c.primary }}>{value}</span>
              </div>
            )
            return <React.Fragment key={label}>{tip ? <Tooltip title={tip} placement="top">{pill}</Tooltip> : pill}</React.Fragment>
          })}
        </div>
      )}
    </>
  )

  if (embedded) {
    return (
      <div aria-label="Resumo da nota do perfil">
        {inner}
      </div>
    )
  }

  return (
    <Card
      size="small"
      className="report-card score-overview"
      style={{
        borderRadius: r.xl,
        border: 'none',
        boxShadow: sh.xl,
        padding: 0,
        overflow: 'hidden',
        background: 'var(--app-hero-gradient)',
        borderLeft: `4px solid ${scoreColor}`,
      }}
      aria-label="Resumo da nota do perfil"
    >
      <div style={{ padding: s.xl }}>{inner}</div>
    </Card>
  )
}

// ——— PatamarCardSection (card "% do patamar atual" em linha inteira; exibir acima do endereço) ———
export interface PatamarCardSectionProps {
  benchmarkTier: string
  proximoPatamar?: string | null
  faltaParaProximo?: number
  percentualNoPatamar?: number
  insightPatamar: string
  projecaoProximoPatamar?: { min: number; max: number; label: string; texto: string } | null
  comparacaoLocal?: string | null
  proximoPassoConcreto?: string | null
  growthProjectionNote?: string | null
}

export function PatamarCardSection({
  benchmarkTier,
  proximoPatamar,
  faltaParaProximo = 0,
  percentualNoPatamar = 0,
  insightPatamar: _insightPatamar,
  projecaoProximoPatamar: _projecaoProximoPatamar,
  comparacaoLocal: _comparacaoLocal,
  proximoPassoConcreto: _proximoPassoConcreto,
  growthProjectionNote: _growthProjectionNote,
}: PatamarCardSectionProps) {
  return (
    <Row gutter={[s.lg, s.lg]} style={{ marginBottom: 0 }}>
      <Col xs={24}>
        <div style={{ ...typ.bodySmall, color: c.textSecondary }}>
          {proximoPatamar && faltaParaProximo > 0 ? (
            <TierProgressGameBar
              currentTier={benchmarkTier}
              nextTier={proximoPatamar}
              remainingFollowers={faltaParaProximo}
              progress={percentualNoPatamar / 100}
            />
          ) : (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: s.sm, flexWrap: 'wrap', marginBottom: 8 }}>
              <span style={{ fontSize: 28, fontWeight: 800, color: c.primary, letterSpacing: '-0.02em' }}>{benchmarkTier}</span>
              {proximoPatamar && (
                <span style={{ fontSize: 13, color: c.textSecondary }}>
                  → <strong style={{ color: c.primary }}>{proximoPatamar}</strong>
                </span>
              )}
            </div>
          )}
        </div>
      </Col>
    </Row>
  )
}

// ——— DiagnosticoBISection (2 colunas: O que está bom | O que melhorar) ———
export interface DiagnosticoBIProps {
  erPct: number
  /** ER do post com maior engajamento (maior viral) */
  erMaxViral?: number | null
  /** Nota quando ER médio > 100% */
  erNote?: string | null
  benchmarkTier: string
  forcas: { titulo: string; descricao?: string }[]
  ondePerdeAlcance: string[]
  /** Insight positivo de alcance (ex.: feed engaja mais que reels) — exibido em "O que está bom" */
  alcancePositivo?: string
  ondePerdeMonetizacao?: string[]
  proximoPassoTop3: string[]
  /** Nicho dominante + subtemas */
  nichoLabel?: string
  /** Ex: Comunidade conversadora, Médio */
  conversationLabel?: string
  /** Top hashtags mais usadas */
  topHashtags?: { tag: string; count: number }[]
  /** Top hashtags com maior ER */
  performingHashtags?: { tag: string; avgEr: number; count: number }[]
  /** Hashtags que geram conversa (≥8% comentários) */
  conversationHashtags?: { tag: string; avgConversation: number }[]
  scoreInfo?: React.ReactNode
  /** Próximo patamar (Micro, Mid, Macro); null se já Macro */
  proximoPatamar?: string | null
  /** Seguidores que faltam para o próximo patamar */
  faltaParaProximo?: number
  /** % de progresso no patamar atual (0–100) */
  percentualNoPatamar?: number
  /** Frase surpreendente: quanto falta, próximo patamar */
  insightPatamar?: string
  /** Projeção: valor por post se virar próximo patamar */
  projecaoProximoPatamar?: { min: number; max: number; label: string; texto: string } | null
  /** Comparação local (X% com maior engajamento em cidade) */
  comparacaoLocal?: string | null
  /** 5 hashtags sugeridas pelo nicho */
  hashtagsSugeridas?: string[]
  /** Próximo passo concreto: "Se postar 3x/sem com hashtags, atinge Micro em ~X meses" */
  proximoPassoConcreto?: string | null
  /** Nota sobre projeção (ex.: baseada em frequência, sem histórico de seguidores) */
  growthProjectionNote?: string | null
  /** Itens Semana 1 para o painel Plano de Evolução (exibido ao lado de "O que melhorar") */
  semana1Items?: string[]
  /** Card "Seu público conversa?" — quando presente, exibido em "O que está bom" (positivo) ou "O que melhorar" (negativo) */
  conversationCard?: { rate: number; label: string; comparisonLabel?: string; color: 'success' | 'warning' | 'danger' }
}

export function DiagnosticoBISection({
  erPct,
  erMaxViral,
  erNote,
  benchmarkTier,
  forcas,
  ondePerdeAlcance,
  alcancePositivo,
  ondePerdeMonetizacao = [],
  proximoPassoTop3,
  nichoLabel,
  conversationLabel,
  topHashtags: _topHashtags = [],
  performingHashtags: _performingHashtags = [],
  conversationHashtags = [],
  scoreInfo,
  proximoPatamar: _proximoPatamar,
  faltaParaProximo: _faltaParaProximo = 0,
  percentualNoPatamar: _percentualNoPatamar = 0,
  insightPatamar: _insightPatamar,
  projecaoProximoPatamar: _projecaoProximoPatamar,
  comparacaoLocal: _comparacaoLocal,
  hashtagsSugeridas: _hashtagsSugeridas = [],
  proximoPassoConcreto: _proximoPassoConcreto,
  growthProjectionNote: _growthProjectionNote,
  semana1Items = [],
  conversationCard,
}: DiagnosticoBIProps) {
  const cardStyle: React.CSSProperties = {
    ...cardBaseStyle,
    padding: s.xl,
    cursor: 'default',
    height: '100%',
    minHeight: 280,
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
  }
  const erStr = erPct.toFixed(2).replace('.', ',')
  const temMelhorar = ondePerdeAlcance.length > 0 || ondePerdeMonetizacao.length > 0 || proximoPassoTop3.length > 0

  return (
    <div className="diagnostico-bi-section">
      {scoreInfo && <div style={{ marginBottom: s.xl }}>{scoreInfo}</div>}
      {/* O que está bom (esquerda) | O que melhorar (meio) | Plano de Ação (direita) */}
      <Row gutter={[s.lg, s.lg]} align="stretch">
        <Col xs={24} md={7} style={{ display: 'flex', flexDirection: 'column' }}>
          <Card size="small" className="report-card report-card--hover" style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: s.sm, marginBottom: 16 }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: c.successBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CheckCircleFilled style={{ fontSize: 16, color: c.success }} />
              </div>
              <div style={{ ...typ.h3, color: c.text, margin: 0 }}>O que está bom</div>
            </div>
            <div style={{ ...typ.bodySmall, color: c.textSecondary }}>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: c.textMuted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Engajamento</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: c.text, marginBottom: 2 }}>ER médio: {erStr}%</div>
                {erMaxViral != null && (
                  <div style={{ fontSize: 14, color: c.textSecondary, marginBottom: 4 }}>ER do maior viral: {erMaxViral.toFixed(2).replace('.', ',')}%</div>
                )}
                {erNote && (
                  <div style={{ fontSize: 12, color: c.textMuted, fontStyle: 'italic', marginTop: 4 }}>{erNote}</div>
                )}
                <div style={{ fontSize: 12, color: c.textMuted, marginTop: 4 }}>Topo da faixa {benchmarkTier}</div>
              </div>
              {forcas.filter((f) => f.titulo !== 'Alguns itens já estão ok' && !f.titulo.startsWith('Engajamento acima')).map((f, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: s.xs, marginBottom: 6 }}>
                  <span style={{ color: c.success }}>✓</span>
                  <span>{f.titulo}{f.descricao ? ` — ${f.descricao}` : ''}</span>
                </div>
              ))}
              {conversationCard && conversationCard.color === 'success' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: s.xs, marginBottom: 6 }}>
                  <span style={{ color: c.success }}>✓</span>
                  <span>{conversationCard.label} ({conversationCard.rate}%){conversationCard.comparisonLabel ? ` — ${conversationCard.comparisonLabel}` : ''}</span>
                </div>
              )}
              {alcancePositivo && (
                <div style={{ display: 'flex', alignItems: 'center', gap: s.xs, marginBottom: 6 }}>
                  <span style={{ color: c.success }}>✓</span>
                  <span>{alcancePositivo}</span>
                </div>
              )}
              {conversationLabel && conversationLabel !== 'Público passivo' && !conversationCard && (
                <div style={{ marginTop: 8 }}>{conversationLabel}</div>
              )}
              {nichoLabel && (
                <div style={{ marginTop: 8 }}>Nicho: {nichoLabel}</div>
              )}
              {conversationHashtags.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div>
                    <div style={{ ...typ.caption, color: c.textMuted, marginBottom: 4 }}>Hashtags que geram conversa</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {conversationHashtags.slice(0, 5).map(({ tag, avgConversation }) => (
                        <span key={tag} style={{ fontSize: 12, padding: '2px 8px', background: c.cardBgSoft, borderRadius: 4 }}>#{tag} ({avgConversation.toFixed(0)}% comentários)</span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Card>
        </Col>
        <Col xs={24} md={10} style={{ display: 'flex', flexDirection: 'column' }}>
          <Card size="small" className="report-card report-card--hover" style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: s.sm, marginBottom: 16 }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: c.warningBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <WarningFilled style={{ fontSize: 16, color: c.warning }} />
              </div>
              <div style={{ ...typ.h3, color: c.text, margin: 0 }}>O que melhorar</div>
            </div>
            <div style={{ ...typ.bodySmall, color: c.textSecondary }}>
              {conversationCard && conversationCard.color !== 'success' && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ ...typ.caption, color: c.textMuted, marginBottom: 4 }}>Conversa</div>
                  <div style={{ marginBottom: 4 }}>⚠ {conversationCard.label} ({conversationCard.rate}% comentários){conversationCard.comparisonLabel ? ` — ${conversationCard.comparisonLabel}` : ' — incentive comentários para marcas valorizarem mais.'}</div>
                </div>
              )}
              {temMelhorar ? (
                <>
                  {ondePerdeAlcance.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ ...typ.caption, color: c.textMuted, marginBottom: 4 }}>Alcance</div>
                      {ondePerdeAlcance.map((item, i) => (
                        <div key={i} style={{ marginBottom: 4 }}>⚠ {item}</div>
                      ))}
                    </div>
                  )}
                  {ondePerdeMonetizacao.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ ...typ.caption, color: c.textMuted, marginBottom: 4 }}>Potencial</div>
                      {ondePerdeMonetizacao.map((item, i) => (
                        <div key={i} style={{ marginBottom: 4 }}>⚠ {item}</div>
                      ))}
                    </div>
                  )}
                  {proximoPassoTop3.length > 0 && (
                    <div>
                      <div style={{ ...typ.caption, color: c.primary, marginBottom: 6, fontWeight: 600 }}>Ajustes prioritários</div>
                      {proximoPassoTop3.map((a, i) => (
                        <div key={i}>• {a}</div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <span>Perfil estruturado.</span>
              )}
            </div>
          </Card>
        </Col>
        <Col xs={24} md={7} style={{ display: 'flex', flexDirection: 'column' }}>
          <PlanoAcao90DiasSection semana1Items={semana1Items} style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }} />
        </Col>
      </Row>
    </div>
  )
}

// ——— ProofCarousel (mini vitrine top posts) ———
export interface ProofItem {
  post: { key: string }
  interactions: number
  erPost: number
  oQueFuncionou: string
  isTop?: boolean
  geraConversa?: boolean
}

export function ProofCarousel({
  items,
  getImageUrl,
  getLink,
  failedImages,
  formatShortNum,
  /** Quando true, exibe "Postado por @username" (ex.: na seção de marcados). */
  showAuthor = false,
  /** Interações, ER e dicas abaixo da mídia. Default false: só a capa, sem texto sobre a imagem. */
  showCardFooter = false,
}: {
  items: ProofItem[]
  /** URL já pronta para `<img src>` (ex.: `getPostCoverDisplayUrl`). */
  getImageUrl: (post: unknown) => string | undefined
  getLink: (post: unknown) => string
  failedImages: Set<string>
  formatShortNum: (n: number) => string
  showAuthor?: boolean
  showCardFooter?: boolean
}) {
  return (
    <div
      className="proof-carousel"
      style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(176px, 1fr))', gap: s.lg, width: '100%' }}
      role="list"
    >
      {items.map(({ post, interactions, erPost, oQueFuncionou }) => {
        const key = (post as { key: string }).key
        const displaySrc = failedImages.has(key) ? undefined : getImageUrl(post)
        const stableBg = getPostStablePreviewUrl(post)
        const link = getLink(post)
        const failed = failedImages.has(key)
        const authorLine =
          showAuthor && (post as { influencer?: { username?: string } })?.influencer?.username
            ? `Postado por @${(post as { influencer?: { username?: string } }).influencer!.username}`
            : undefined
        return (
          <PostPreviewCard
            key={key}
            href={link}
            aria-label={`Post com ${formatShortNum(interactions)} interações, ER ${erPost.toFixed(1)}%. ${oQueFuncionou}`}
            imageDisplaySrc={displaySrc}
            stableBackgroundUrl={stableBg}
            imageUnavailable={failed || !displaySrc}
            mediaAspectRatio="4 / 5"
            hideFooter={!showCardFooter}
            interactionsLabel={showCardFooter ? `${formatShortNum(interactions)} interações` : undefined}
            erPercent={showCardFooter ? erPost : undefined}
            footerHint={showCardFooter ? oQueFuncionou : undefined}
            authorLine={authorLine}
            showHoverGradient
            className="proof-thumb"
          />
        )
      })}
    </div>
  )
}

// Tons por tema — folha central (index.css)
const THEME_MAP = {
  success: { bg: 'var(--app-success-bg)', border: 'var(--app-success-border)', accent: 'var(--app-success-accent)', iconBg: 'var(--app-success-icon-bg)' },
  warning: { bg: 'var(--app-warning-bg)', border: 'var(--app-warning-border)', accent: 'var(--app-warning-accent)', iconBg: 'var(--app-warning-icon-bg)' },
  danger: { bg: 'var(--app-danger-bg)', border: 'var(--app-danger-border)', accent: 'var(--app-danger-accent)', iconBg: 'var(--app-danger-icon-bg)' },
} as const

// ——— EngajamentoPorTipoSection (ER por Feed, Reel, Marcado em um único componente) ———
export interface EngajamentoPorTipoSectionProps {
  engagementByType: {
    posts: { er: number; count: number }
    reels: { er: number; erByViews?: number; count: number }
    tagged: { er: number; count: number }
  }
  rowGutter?: [number, number]
}

const ER_EXPLICACAO =
  'ER (Engagement Rate) é a taxa de engajamento: o percentual de seus seguidores que interagem com o conteúdo. A conta é: (curtidas + comentários) ÷ número de seguidores × 100. Assim, um ER de 5% significa que, em média, 5% da sua audiência reage a cada post. Quanto maior o ER, mais a audiência está envolvida — e mais atrativo o perfil para marcas, que usam essa métrica para avaliar alcance real e conexão com o público.'

const ER_ESCALA_EXPLICACAO =
  'Usamos uma escala de 0% a 6%+ para classificar a qualidade do engajamento em quatro faixas. Abaixo de 2% o engajamento é considerado baixo; entre 2% e 4% é bom; entre 4% e 6% é excelente; acima de 6% entramos na faixa viral, em que a audiência reage muito ao conteúdo.'

/** Painel explicativo de ER — costuma ser o último bloco do relatório na página. */
export function ErExplicacaoPanel({ rowGutter = [s.lg, s.lg] }: { rowGutter?: [number, number] }) {
  const cardOQueEr = {
    padding: s.sm,
    background: c.cardBgSoft,
    borderRadius: r.md,
    border: `1px solid ${c.borderLight}`,
    borderLeft: `2px solid ${c.primary}`,
    boxShadow: 'none',
  }
  return (
    <Row gutter={rowGutter}>
      <Col xs={24}>
        <div style={cardOQueEr}>
          <div style={{ ...typ.caption, fontWeight: 600, color: c.textSecondary, marginBottom: 6 }}>O que é ER?</div>
          <div style={{ ...typ.caption, fontSize: 11, color: c.textMuted, lineHeight: 1.5, marginBottom: 10 }}>{ER_EXPLICACAO}</div>
          <div style={{ ...typ.caption, fontSize: 11, color: c.textMuted, lineHeight: 1.5, marginBottom: 8 }}>{ER_ESCALA_EXPLICACAO}</div>
        </div>
      </Col>
    </Row>
  )
}

export function EngajamentoPorTipoSection({ engagementByType, rowGutter = [s.lg, s.lg] }: EngajamentoPorTipoSectionProps) {
  const gridGap = Array.isArray(rowGutter) ? rowGutter[0] : rowGutter
  const getErBandaColor = (value: number) =>
    ER_QUALIDADE_BANDAS.find((b) => value >= b.min && value < b.max)?.color ?? ER_QUALIDADE_BANDAS[0].color

  const cardStyleByEr = (erValue: number) => ({
    padding: s.sm,
    background: `${getErBandaColor(erValue)}14`,
    borderRadius: r.md,
    border: `1px solid ${getErBandaColor(erValue)}40`,
    boxShadow: 'none',
    height: '100%',
    cursor: 'help' as const,
  })
  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    columnGap: gridGap,
    rowGap: gridGap,
    width: '100%',
  }

  return (
    <div className="detail-er-by-type-grid" style={gridStyle}>
      <div className="detail-er-by-type-cell">
        <Tooltip title={`${METRIC_TOOLTIPS.er} Qualidade: ${ER_QUALIDADE_BANDAS.map((b) => `${erBandaRangeLabel(b)} ${b.label}`).join(' · ')}`} placement="top">
          <div className="detail-er-by-type-card" style={{ ...cardStyleByEr(engagementByType.posts.er), padding: `${s.sm}px ${s.lg}px` }}>
            <ERGaugeChart
              value={engagementByType.posts.er}
              count={engagementByType.posts.count}
              title="ER médio por Feed"
            />
          </div>
        </Tooltip>
      </div>
      <div className="detail-er-by-type-cell">
        <Tooltip
          title={
            engagementByType.reels.erByViews != null
              ? METRIC_TOOLTIPS.erPorSeguidoresEViews
              : `${METRIC_TOOLTIPS.er} Qualidade: ${ER_QUALIDADE_BANDAS.map((b) => `${erBandaRangeLabel(b)} ${b.label}`).join(' · ')}`
          }
          placement="top"
        >
          <div className="detail-er-by-type-card" style={{ ...cardStyleByEr(engagementByType.reels.er), padding: `${s.sm}px ${s.lg}px` }}>
            <ERGaugeChart
              value={engagementByType.reels.er}
              count={engagementByType.reels.count}
              title="ER médio por Reel"
            />
          </div>
        </Tooltip>
      </div>
    </div>
  )
}

// ——— MetricasMediakitSection (espelho da página 2 do Mídia Kit: Métricas) ———
const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

const METRICAS_DASH_PURPLE = '#7b2cbf'
const METRICAS_DASH_GREEN = '#00b894'
const METRICAS_DASH_PURPLE_SOFT = 'rgba(123, 44, 191, 0.14)'
const METRICAS_DASH_GREEN_SOFT = 'rgba(0, 184, 148, 0.14)'
const METRICAS_DASH_CARD_SHADOW = '0 2px 12px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04)'

type MetricasDashTheme = 'purple' | 'green'

function metricasDashboardIconCircle(theme: MetricasDashTheme, children: React.ReactNode) {
  const purple = theme === 'purple'
  return (
    <span
      style={{
        flexShrink: 0,
        width: 48,
        height: 48,
        borderRadius: '50%',
        background: purple ? METRICAS_DASH_PURPLE_SOFT : METRICAS_DASH_GREEN_SOFT,
        color: purple ? METRICAS_DASH_PURPLE : METRICAS_DASH_GREEN,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 22,
      }}
      aria-hidden
    >
      {children}
    </span>
  )
}

function MetricasDashboardKpiCard({
  theme,
  icon,
  value,
  label,
  desc,
  isMobile,
  valueColor,
  extraBelowValue,
}: {
  theme: MetricasDashTheme
  icon: React.ReactNode
  value: React.ReactNode
  label: string
  desc: string
  isMobile?: boolean
  valueColor?: string
  extraBelowValue?: React.ReactNode
}) {
  const valColor = valueColor ?? (theme === 'purple' ? METRICAS_DASH_PURPLE : METRICAS_DASH_GREEN)
  return (
    <div
      style={{
        background: c.cardBg,
        borderRadius: 14,
        boxShadow: METRICAS_DASH_CARD_SHADOW,
        border: `1px solid color-mix(in srgb, ${c.borderLight} 70%, transparent)`,
        padding: isMobile ? '16px 18px' : '20px 22px',
        display: 'flex',
        alignItems: 'center',
        gap: isMobile ? 14 : 16,
        minHeight: isMobile ? 0 : 92,
        boxSizing: 'border-box',
      }}
    >
      {metricasDashboardIconCircle(theme, icon)}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: isMobile ? 22 : 26,
            fontWeight: 700,
            color: valColor,
            lineHeight: 1.15,
            letterSpacing: '-0.02em',
          }}
        >
          {value}
        </div>
        <div style={{ fontSize: isMobile ? 14 : 15, fontWeight: 600, color: c.text, marginTop: 6 }}>{label}</div>
        {extraBelowValue}
        <div style={{ fontSize: 12, color: c.textMuted, marginTop: 4, lineHeight: 1.4 }}>{desc}</div>
      </div>
    </div>
  )
}

function metricasIconWrap(accentColor: string, children: React.ReactNode) {
  return (
    <span
      style={{
        fontSize: 14,
        color: accentColor,
        lineHeight: 1,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 26,
        height: 26,
        borderRadius: 7,
        background: 'color-mix(in srgb, currentColor 12%, transparent)',
      }}
      aria-hidden
    >
      {children}
    </span>
  )
}

export interface MetricasMediakitSectionProps {
  formatShortNum: (n: number) => string
  followersCount: number
  engagement: { total_likes?: number; total_comments?: number; total_views?: number; engagement_rate?: number }
  conversationRate: number
  conversationLabel?: string
  bestDay?: string
  bestHour?: number
  engagementPerWeekday: number[]
  maxEr: number
  cpmCpe: { cpmEstimate: number | null; cpeEstimate: number | null }
  strategicMetrics: StrategicMetrics | null
  /** Quando informado, os dias da semana ficam clicáveis e abrem modal com os posts do dia. */
  postsByWeekday?: PostItem[][]
  getPostImageUrl?: (post: PostItem) => string | undefined
  getPostLink?: (post: PostItem) => string
  failedPostImages?: Set<string>
  /** Layout responsivo da grade de KPIs (3 colunas no desktop). */
  isMobile?: boolean
  /** Blur na grade de métricas + melhor horário (mesmo padrão do valor estimado). */
  blurMediakitPreview?: boolean
  mediakitLockOverlay?: React.ReactNode
}

function postInteractions(p: PostItem): number {
  const likes = typeof (p.metrics?.likes ?? (p as { like_count?: number }).like_count) === 'number'
    ? (p.metrics?.likes ?? (p as { like_count?: number }).like_count)!
    : 0
  const comments = typeof (p.metrics?.comments ?? (p as { comment_count?: number }).comment_count) === 'number'
    ? (p.metrics?.comments ?? (p as { comment_count?: number }).comment_count)!
    : 0
  return likes + comments
}

function postEr(p: PostItem, followersCount: number): number {
  if (followersCount <= 0) return 0
  return (postInteractions(p) / followersCount) * 100
}

export function MetricasMediakitSection({
  formatShortNum,
  followersCount,
  engagement,
  conversationRate = 0,
  conversationLabel,
  bestDay,
  bestHour,
  engagementPerWeekday = [0, 0, 0, 0, 0, 0, 0],
  maxEr = 0,
  cpmCpe,
  strategicMetrics,
  postsByWeekday,
  getPostImageUrl,
  getPostLink,
  failedPostImages = new Set(),
  isMobile = false,
  blurMediakitPreview = false,
  mediakitLockOverlay,
}: MetricasMediakitSectionProps) {
  const [selectedWeekday, setSelectedWeekday] = useState<number | null>(null)
  const canOpenModal = Boolean(postsByWeekday && getPostImageUrl && getPostLink)
  const postsForModal = selectedWeekday != null && postsByWeekday
    ? postsByWeekday[selectedWeekday] ?? []
    : []
  const totalLikes = engagement.total_likes ?? 0
  const totalComments = engagement.total_comments ?? 0
  const totalViews = engagement.total_views ?? 0
  const er = engagement.engagement_rate ?? 0
  const erPerWeekday = followersCount > 0
    ? engagementPerWeekday.map((sum) => (sum / followersCount) * 100)
    : [0, 0, 0, 0, 0, 0, 0]
  const maxErDay = Math.max(0.01, ...erPerWeekday)
  const bestDayByErIndex = maxErDay > 0 ? erPerWeekday.findIndex((v) => v >= maxErDay - 1e-6) : -1
  const picoDayLabel = bestDayByErIndex >= 0 ? WEEKDAY_LABELS[bestDayByErIndex] : bestDay
  const cpeValue = cpmCpe.cpeEstimate != null && cpmCpe.cpeEstimate > 0 ? `R$ ${cpmCpe.cpeEstimate.toFixed(2)}` : '—'
  const cpmValue = cpmCpe.cpmEstimate != null && cpmCpe.cpmEstimate > 0 ? `R$ ${cpmCpe.cpmEstimate.toFixed(1)}` : null
  const showViewsNote = totalViews > 0 && totalViews < totalLikes
  const showCpmCol = Boolean(cpmValue && totalViews > 0)
  const picoErBanda = maxEr > 0 ? (ER_QUALIDADE_BANDAS.find((b) => maxEr >= b.min && maxEr < b.max) ?? ER_QUALIDADE_BANDAS[ER_QUALIDADE_BANDAS.length - 1]) : null
  const conversationCardLabel = conversationLabel ?? 'Taxa comentários'
  const picoQualityLine = picoErBanda ? (
    <div style={{ fontSize: 12, fontWeight: 600, color: picoErBanda.color, marginTop: 4 }}>{picoErBanda.label}</div>
  ) : undefined

  const dashboardShell: React.CSSProperties = {
    background: c.cardBgSoft,
    borderRadius: r.lg,
    padding: isMobile ? s.md : s.lg,
    marginBottom: 0,
    boxSizing: 'border-box',
  }
  const dashGrid3: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'repeat(3, minmax(0, 1fr))',
  }
  const hasSecondaryKpis = totalViews > 0 || showCpmCol
  const dashGridSecondary: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns:
      !isMobile && totalViews > 0 && showCpmCol ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)',
  }

  const metricsDashboard = (
    <div className="metricas-dashboard-shell" style={dashboardShell}>
      <div className="metricas-dash-grid" style={dashGrid3}>
        <MetricasDashboardKpiCard
          theme="purple"
          icon={<HeartOutlined aria-hidden />}
          value={formatShortNum(totalLikes)}
          label="Curtidas"
          desc="Soma feed + reels"
          isMobile={isMobile}
        />
        <MetricasDashboardKpiCard
          theme="green"
          icon={<CommentOutlined aria-hidden />}
          value={formatShortNum(totalComments)}
          label="Comentários"
          desc="Soma feed + reels"
          isMobile={isMobile}
        />
        <MetricasDashboardKpiCard
          theme="green"
          icon={<DollarOutlined aria-hidden />}
          value={cpeValue}
          label="CPE"
          desc="Por curtida ou comentário."
          isMobile={isMobile}
        />
        <MetricasDashboardKpiCard
          theme="purple"
          icon={<ThunderboltOutlined aria-hidden />}
          value={`${er.toFixed(1)}%`}
          label="Engajamento"
          desc="Curtidas + comentários vs. seguidores."
          isMobile={isMobile}
        />
        <MetricasDashboardKpiCard
          theme="green"
          icon={<PieChartOutlined aria-hidden />}
          value={`${Math.round(conversationRate)}%`}
          label={conversationCardLabel}
          desc="Comentários sobre todas as interações."
          isMobile={isMobile}
        />
        <MetricasDashboardKpiCard
          theme="green"
          icon={<RocketOutlined aria-hidden />}
          value={maxEr > 0 ? `${maxEr.toFixed(1)}%` : '—'}
          label="Pico Viral"
          desc="Maior ER em um único post."
          isMobile={isMobile}
          extraBelowValue={picoQualityLine}
        />
      </div>
      {hasSecondaryKpis ? (
        <div className="metricas-dash-grid-secondary" style={dashGridSecondary}>
          {totalViews > 0 ? (
            <MetricasDashboardKpiCard
              theme="purple"
              icon={<EyeOutlined aria-hidden />}
              value={formatShortNum(totalViews)}
              label="Views (reels)"
              desc="Só vídeos/reels; curtidas acima incluem feed."
              isMobile={isMobile}
            />
          ) : null}
          {showCpmCol && cpmValue ? (
            <MetricasDashboardKpiCard
              theme="purple"
              icon={<LineChartOutlined aria-hidden />}
              value={cpmValue}
              label="CPM"
              desc="Custo por mil views (reels)."
              isMobile={isMobile}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  )

  const bestTimeCard = (
    <Card
      size="small"
      style={{
        marginBottom: s.sm,
        borderRadius: r.lg,
        overflow: 'hidden',
        border: `1px solid ${c.borderLight}`,
        boxShadow: 'none',
      }}
    >
      <div
        style={{
          padding: `${s.xs + 2}px ${s.sm}px`,
          borderBottom: `1px solid ${c.borderLight}`,
          display: 'flex',
          alignItems: 'flex-start',
          gap: s.xs + 2,
        }}
      >
        {metricasIconWrap(c.primary, <ClockCircleOutlined aria-hidden />)}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, color: c.text, fontSize: 12 }}>Melhor horário</div>
          {(picoDayLabel || (bestHour ?? 0) > 0) && (
            <div style={{ color: c.primary, fontWeight: 600, marginTop: 2, fontSize: 10 }}>
              Pico: {[picoDayLabel, (bestHour ?? 0) > 0 ? `às ${bestHour}h` : ''].filter(Boolean).join(' · ')}
            </div>
          )}
          <div style={{ color: c.textMuted, marginTop: 2, fontSize: 9, lineHeight: 1.3 }}>
            ER por dia: (curtidas + comentários) ÷ seguidores × 100
          </div>
        </div>
      </div>
      <div style={{ padding: `${s.xs}px ${s.sm}px`, display: 'flex', alignItems: 'flex-end', gap: 6, minHeight: 72 }}>
        {WEEKDAY_LABELS.map((label, d) => {
          const erDay = erPerWeekday[d] ?? 0
          const pct = maxErDay > 0 ? (erDay / maxErDay) * 100 : 0
          const isBestEng = maxErDay > 0 && erDay >= maxErDay - 1e-6
          const barHeight = erDay > 0 ? Math.max(12, Math.round((pct / 100) * 40)) : 0
          const dayPosts = postsByWeekday?.[d] ?? []
          const isClickable = canOpenModal
          const content = (
            <>
              <div style={{ width: '100%', height: 44, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                {barHeight > 0 && (
                  <div
                    style={{
                      width: '78%',
                      minWidth: 20,
                      height: barHeight,
                      backgroundColor: isBestEng ? (c.gold ?? '#d4a574') : (c.primary ?? '#6366f1'),
                      borderRadius: 6,
                      border: isBestEng ? `2px solid ${c.gold ?? '#b8860b'}` : `1px solid ${c.borderLight}`,
                      boxShadow: isBestEng ? '0 2px 8px rgba(212,165,116,0.5)' : '0 1px 4px rgba(0,0,0,0.12)',
                      opacity: isBestEng ? 1 : 0.85,
                    }}
                  />
                )}
              </div>
              <div style={{ ...typ.caption, fontSize: 10, fontWeight: isBestEng ? 700 : 500, color: isBestEng ? (c.gold ?? '#b8860b') : c.text, marginTop: 4 }}>{label}</div>
              {erDay > 0 && (
                <>
                  <div style={{ ...typ.caption, fontSize: 11, color: c.textSecondary, marginTop: 2 }}>ER {erDay.toFixed(1)}%</div>
                  {(() => {
                    const banda = getErBanda(erDay)
                    return (
                      <span
                        style={{
                          display: 'inline-block',
                          marginTop: 4,
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
                </>
              )}
            </>
          )
          return (
            <div
              key={label}
              role={isClickable ? 'button' : undefined}
              tabIndex={isClickable ? 0 : undefined}
              onClick={isClickable ? () => setSelectedWeekday(d) : undefined}
              onKeyDown={isClickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedWeekday(d) } } : undefined}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                minWidth: 0,
                cursor: isClickable ? 'pointer' : undefined,
                borderRadius: r.md,
                padding: isClickable ? 4 : 0,
                margin: isClickable ? -4 : 0,
                transition: 'background 0.15s ease',
              }}
              aria-label={isClickable ? `Posts de ${label} (${dayPosts.length} post${dayPosts.length !== 1 ? 's' : ''})` : undefined}
            >
              {content}
            </div>
          )
        })}
      </div>
    </Card>
  )

  const reachReelsCard =
    (strategicMetrics?.reachMultiplier?.max != null && strategicMetrics.reachMultiplier.max >= 1) ||
      (strategicMetrics?.reelsAmplification != null && strategicMetrics.reelsAmplification >= 1) ? (
      <Card
        size="small"
        style={{
          marginBottom: s.sm,
          borderRadius: r.md,
          borderLeft: `4px solid ${c.primary}`,
          background: c.cardBgSoft,
          boxShadow: 'none',
          borderTop: `1px solid ${c.borderLight}`,
          borderRight: `1px solid ${c.borderLight}`,
          borderBottom: `1px solid ${c.borderLight}`,
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: s.sm, alignItems: 'stretch' }}>
          {strategicMetrics?.reachMultiplier?.max != null && strategicMetrics.reachMultiplier.max >= 1 && (
            <span
              style={{
                ...typ.bodySmall,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: `${s.xs}px ${s.sm}px`,
                background: c.primary + '20',
                color: c.primary,
                borderRadius: r.sm,
                fontWeight: 600,
                fontSize: 11,
              }}
            >
              <RiseOutlined aria-hidden style={{ fontSize: 14 }} />
              Reach até {strategicMetrics.reachMultiplier.max.toFixed(1)}× seguidores
            </span>
          )}
          {strategicMetrics?.reelsAmplification != null && strategicMetrics.reelsAmplification >= 1 && (
            <span
              style={{
                ...typ.bodySmall,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: `${s.xs}px ${s.sm}px`,
                background: c.gold + '25',
                color: c.gold,
                borderRadius: r.sm,
                fontWeight: 600,
                fontSize: 11,
              }}
            >
              <PlayCircleOutlined aria-hidden style={{ fontSize: 14 }} />
              Reels: {strategicMetrics.reelsAmplification.toFixed(1)}× base em média
            </span>
          )}
        </div>
      </Card>
    ) : null

  const mediakitPreview = (
    <>
      {metricsDashboard}
      {bestTimeCard}
      {reachReelsCard}
    </>
  )

  return (
    <div>
      {blurMediakitPreview ? (
        <div
          style={{
            position: 'relative',
            overflow: 'hidden',
            borderRadius: r.lg,
            minHeight: 80,
            marginBottom: s.sm,
          }}
        >
          <div style={{ filter: 'blur(6px)', userSelect: 'none', pointerEvents: 'none' }}>{mediakitPreview}</div>
          {mediakitLockOverlay ? (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'rgba(0,0,0,0.4)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: s.sm,
                pointerEvents: 'auto',
                padding: s.lg,
              }}
            >
              {mediakitLockOverlay}
            </div>
          ) : null}
        </div>
      ) : (
        mediakitPreview
      )}

      {/* Modal: posts do dia da semana */}
      {canOpenModal && (
        <Modal
          title={selectedWeekday != null ? `Posts — ${WEEKDAY_LABELS[selectedWeekday]}` : ''}
          open={selectedWeekday != null}
          onCancel={() => setSelectedWeekday(null)}
          footer={null}
          width={640}
          styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
        >
          {postsForModal.length === 0 ? (
            <div style={{ ...typ.bodySmall, color: c.textMuted, padding: s.lg, textAlign: 'center' }}>
              Nenhum post neste dia da semana.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(156px, 1fr))', gap: s.md }}>
              {postsForModal.map((post) => {
                const key = post.key ?? ((post.post?.id ?? post.post?.shortcode ?? '') || String(Math.random()))
                const displaySrc = failedPostImages.has(key) ? undefined : getPostImageUrl!(post)
                const stableBg = getPostStablePreviewUrl(post)
                const link = getPostLink!(post)
                const failed = failedPostImages.has(key)
                const interactions = postInteractions(post)
                const er = postEr(post, followersCount)
                const overlayLines = getPostCaptionOverlayLines(post)
                return (
                  <PostPreviewCard
                    key={key}
                    href={link}
                    aria-label={`${formatShortNum(interactions)} interações, ER ${er.toFixed(1)}%`}
                    imageDisplaySrc={displaySrc}
                    stableBackgroundUrl={stableBg}
                    imageUnavailable={failed || !displaySrc}
                    mediaAspectRatio="4 / 5"
                    overlayLines={overlayLines.length > 0 ? overlayLines : undefined}
                    interactionsLabel={`${formatShortNum(interactions)} interações`}
                    erPercent={er}
                    showHoverGradient={false}
                    className="proof-thumb"
                  />
                )
              })}
            </div>
          )}
        </Modal>
      )}

    </div>
  )
}

// ——— ValorEpublicoSection (Valor estimado + Seu público conversa em um único componente) ———
export interface ValorEstimadoPorTipoUI {
  post: { min: number; max: number; porque?: string }
  reels: { min: number; max: number; porque?: string }
  stories: { min: number; max: number; porque?: string }
  destaque: { min: number; max: number; porque?: string }
}

export interface ValorEpublicoSectionProps {
  valorEstimado: { min: number; max: number; porque?: string }
  /** Quando informado, exibe três blocos: Post, Reels e Story. Caso contrário, exibe só o valor por post. */
  valorEstimadoPorTipo?: ValorEstimadoPorTipoUI
  onCta?: () => void
  hideCta?: boolean
  ctaLabel?: string
  rowGutter?: [number, number]
  isMobile?: boolean
}

export function ValorEpublicoSection({
  valorEstimado,
  valorEstimadoPorTipo,
  onCta,
  hideCta = false,
  ctaLabel,
  rowGutter = [s.lg, s.lg],
  isMobile = false,
}: ValorEpublicoSectionProps) {
  const { min, max } = valorEstimado
  const showPorTipo = valorEstimadoPorTipo != null

  const valorBlock = showPorTipo ? (
    <Row gutter={[s.lg, s.lg]} align="stretch">
      <Col xs={24} sm={12} md={6} style={{ display: 'flex' }}>
        <PricingHighlight
          variant="post"
          title="Valor estimado · Feed"
          min={valorEstimadoPorTipo.post.min}
          max={valorEstimadoPorTipo.post.max}
          porque={valorEstimadoPorTipo.post.porque ?? ''}
          onCta={onCta ?? (() => document.getElementById('cta-final')?.scrollIntoView({ behavior: 'smooth' }))}
          hideCta={isMobile || hideCta}
          ctaLabel={ctaLabel}
          tooltip={METRIC_TOOLTIPS.valorEstimado}
          style={{ width: '100%', flex: 1, minWidth: 0 }}
        />
      </Col>
      <Col xs={24} sm={12} md={6} style={{ display: 'flex' }}>
        <PricingHighlight
          variant="reels"
          title="Valor estimado · Reels"
          min={valorEstimadoPorTipo.reels.min}
          max={valorEstimadoPorTipo.reels.max}
          porque={valorEstimadoPorTipo.reels.porque ?? ''}
          hideCta
          tooltip={METRIC_TOOLTIPS.valorEstimado}
          style={{ width: '100%', flex: 1, minWidth: 0 }}
        />
      </Col>
      <Col xs={24} sm={12} md={6} style={{ display: 'flex' }}>
        <PricingHighlight
          variant="story"
          title="Valor estimado · Story"
          min={valorEstimadoPorTipo.stories.min}
          max={valorEstimadoPorTipo.stories.max}
          porque={valorEstimadoPorTipo.stories.porque ?? ''}
          hideCta
          tooltip={METRIC_TOOLTIPS.valorEstimado}
          style={{ width: '100%', flex: 1, minWidth: 0 }}
        />
      </Col>
      <Col xs={24} sm={12} md={6} style={{ display: 'flex' }}>
        <PricingHighlight
          variant="destaque"
          title="Upgrade · Destaque (30 dias)"
          min={valorEstimadoPorTipo.destaque.min}
          max={valorEstimadoPorTipo.destaque.max}
          porque={valorEstimadoPorTipo.destaque.porque ?? ''}
          hideCta
          tooltip={METRIC_TOOLTIPS.valorEstimadoDestaque}
          style={{ width: '100%', flex: 1, minWidth: 0 }}
        />
      </Col>
    </Row>
  ) : (
    <PricingHighlight
      min={min}
      max={max}
      porque={valorEstimado.porque ?? ''}
      onCta={onCta ?? (() => document.getElementById('cta-final')?.scrollIntoView({ behavior: 'smooth' }))}
      hideCta={isMobile || hideCta}
      ctaLabel={ctaLabel}
      tooltip={METRIC_TOOLTIPS.valorEstimado}
      style={{ flex: 1, minWidth: 0 }}
    />
  )

  return (
    <Row gutter={rowGutter} align="stretch">
      <Col xs={24} style={{ display: 'flex', flexDirection: 'column', gap: s.lg }}>
        {valorBlock}
      </Col>
    </Row>
  )
}

// ——— AudienceQualityCard ———
export function AudienceQualityCard({ rate, label, comparisonLabel, tooltip, color = 'success', style: styleProp }: { rate: number; label: string; comparisonLabel?: string; tooltip?: string; color?: 'success' | 'warning' | 'danger'; style?: React.CSSProperties }) {
  const theme = THEME_MAP[color]
  const card = (
    <div
      className="report-card"
      style={{
        borderRadius: r.lg,
        border: `1px solid ${theme.border}`,
        boxShadow: sh.sm,
        padding: s.lg,
        background: theme.bg,
        cursor: tooltip ? 'help' : undefined,
        minHeight: '100%',
        ...styleProp,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: s.sm, marginBottom: 8 }}>
        <div style={{ width: 34, height: 34, borderRadius: '50%', background: theme.iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <CommentOutlined style={{ fontSize: 16, color: theme.accent }} />
        </div>
        <div style={{ ...typ.overline, color: c.textSecondary, letterSpacing: '0.04em', textTransform: 'uppercase', fontSize: 11, fontWeight: 600 }}>Seu público conversa?</div>
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: c.text, marginBottom: 4 }}>{rate}%</div>
      <div style={{ ...typ.bodySmall, color: c.textSecondary, marginBottom: comparisonLabel ? 6 : 0 }}>{label}</div>
      {comparisonLabel && (
        <div style={{ ...typ.bodySmall, color: theme.accent, fontWeight: 600, lineHeight: 1.35 }}>{comparisonLabel}</div>
      )}
    </div>
  )
  return tooltip ? <Tooltip title={tooltip} placement="top">{card}</Tooltip> : card
}

// ——— ConsistencyMiniChart ———
export function ConsistencyMiniChart({ data, bestDay, bestHour }: { data: number[]; bestDay: string; bestHour: number }) {
  const max = Math.max(1, ...data)
  return (
    <div className="consistency-mini-chart" style={{ padding: s.md, background: c.cardBgSoft, borderRadius: r.lg, border: `1px solid ${c.borderLight}`, width: '100%' }}>
      <div style={{ ...typ.caption, color: c.textMuted, marginBottom: 8 }}>Posts por semana (últimas 8)</div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 36, width: '100%' }}>
        {data.map((n, i) => (
          <div key={i} style={{ flex: 1, minWidth: 0, height: Math.max(6, (n / max) * 30), background: 'var(--app-chart-bar-gradient)', borderRadius: 4, boxShadow: 'var(--app-chart-bar-shadow)' }} />
        ))}
      </div>
      <div style={{ ...typ.caption, color: c.textSecondary, marginTop: 8 }}>Melhor: {bestDay} às {bestHour}h</div>
    </div>
  )
}

// ——— Temas por tipo de conteúdo: só variáveis já existentes no tema (Feed=warning, Reels=primary, Story=gold, Destaque=success) ———
const PRICING_VARIANT_STYLES: Record<'post' | 'reels' | 'story' | 'destaque', { bg: string; border: string; iconBg: string; accent: string; valueColor: string }> = {
  post: {
    bg: 'var(--app-warning-bg)',
    border: 'var(--app-warning-border)',
    iconBg: 'var(--app-warning-icon-bg)',
    accent: 'var(--app-warning-accent)',
    valueColor: 'var(--app-warning-accent)',
  },
  reels: {
    bg: 'var(--app-primary-muted)',
    border: 'var(--app-primary)',
    iconBg: 'var(--app-primary-muted)',
    accent: 'var(--app-primary)',
    valueColor: 'var(--app-primary-dark)',
  },
  story: {
    bg: 'var(--app-gold-light)',
    border: 'var(--app-gold-border)',
    iconBg: 'var(--app-gold-light)',
    accent: 'var(--app-gold)',
    valueColor: 'var(--app-text)',
  },
  destaque: {
    bg: 'var(--app-success-bg)',
    border: 'var(--app-success-border)',
    iconBg: 'var(--app-success-icon-bg)',
    accent: 'var(--app-success-accent)',
    valueColor: 'var(--app-success-accent)',
  },
}

// ——— PricingHighlight ———
export function PricingHighlight({ variant, title = 'Valor estimado por feed', min, max, porque, onCta, hideCta, ctaLabel = 'Proposta', tooltip, style: styleProp }: { variant?: 'post' | 'reels' | 'story' | 'destaque'; title?: string; min: number; max: number; porque: string; onCta?: () => void; hideCta?: boolean; ctaLabel?: string; tooltip?: string; style?: React.CSSProperties }) {
  const theme = variant ? PRICING_VARIANT_STYLES[variant] : { bg: 'var(--app-warning-bg)', border: 'var(--app-warning-border)', iconBg: 'var(--app-warning-icon-bg)', accent: 'var(--app-warning-accent)', valueColor: c.text }
  const titleEl = <div style={{ ...typ.overline, color: theme.valueColor, letterSpacing: '0.04em', cursor: tooltip ? 'help' : undefined, display: 'inline-block', textTransform: 'uppercase', fontSize: 11, fontWeight: 600 }}>{title}</div>
  return (
    <div
      className="report-card pricing-highlight"
      style={{
        borderRadius: r.lg,
        border: `2px solid ${theme.border}`,
        boxShadow: variant ? 'var(--app-shadow-md)' : sh.sm,
        padding: s.md,
        background: theme.bg,
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        transition: 'transform 0.2s ease, box-shadow 0.2s ease',
        ...styleProp,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', background: theme.iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <DollarOutlined style={{ fontSize: 14, color: theme.accent }} />
        </div>
        {tooltip ? <Tooltip title={tooltip} placement="top">{titleEl}</Tooltip> : titleEl}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: theme.valueColor, marginBottom: 4, lineHeight: 1.2 }}>
        {min === 0 && max === 0 ? 'Incluído' : min === max ? `R$ ${min.toLocaleString('pt-BR')}` : `R$ ${min.toLocaleString('pt-BR')} – R$ ${max.toLocaleString('pt-BR')}`}
      </div>
      <p style={{ ...typ.bodySmall, color: c.textSecondary, margin: 0, marginBottom: hideCta ? 0 : s.md, lineHeight: 1.35, fontSize: 12, flex: 1 }}>{porque}</p>
      {!hideCta && onCta && <Button type="primary" size="large" icon={<RocketOutlined />} block style={{ borderRadius: r.md, background: theme.accent, borderColor: theme.accent, color: '#fff', minHeight: 44 }} onClick={onCta}>{ctaLabel}</Button>}
    </div>
  )
}

// ——— BrandMatchCard ———
export function BrandMatchCard({
  titulo,
  bullets,
  selector,
}: {
  titulo: string
  bullets: string[]
  selector?: React.ReactNode
}) {
  return (
    <Card size="small" className="report-card brand-match-card" style={{ borderRadius: r.xl, border: 'none', boxShadow: sh.lg, padding: s.lg }}>
      <div style={{ ...typ.h2, color: c.text, marginBottom: s.sm }}>{titulo}</div>
      {selector && <div style={{ marginBottom: s.md }} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>{selector}</div>}
      <ul style={{ margin: 0, paddingLeft: 20 }}>
        {bullets.map((b, i) => (
          <li key={i} style={{ marginBottom: 6, ...typ.body, color: c.text }}>{b}</li>
        ))}
      </ul>
    </Card>
  )
}

// ——— TabsSection (wrapper com nav clean) ———
export function TabsSection({ items, defaultActiveKey }: { items: { key: string; label: React.ReactNode; children: React.ReactNode }[]; defaultActiveKey?: string }) {
  return (
    <Card size="small" className="report-tabs-section" style={{ borderRadius: r.xl, border: 'none', boxShadow: sh.md, overflow: 'hidden' }}>
      <Tabs defaultActiveKey={defaultActiveKey ?? items[0]?.key} items={items} className="report-tabs" />
    </Card>
  )
}

// ——— Executive Summary para marcas (B2B) ———
export interface ExecutiveSummaryForBrandsSectionProps {
  data: ExecutiveSummaryForBrands
  /** Para linha "Média Micro: X% ER · Seu ER: Y%" */
  benchmark?: BenchmarkInsight
  erAtual?: number
}

export function ExecutiveSummaryForBrandsSection({ data, benchmark, erAtual }: ExecutiveSummaryForBrandsSectionProps) {
  return (
    <Card
      size="small"
      className="report-card executive-summary-brands"
      style={{
        borderRadius: r.xl,
        border: `1px solid ${c.primary + '40'}`,
        boxShadow: sh.md,
        overflow: 'hidden',
        background: c.cardBg,
      }}
    >
      <div style={{ padding: s.lg }}>
        <div style={{ ...typ.caption, color: c.textMuted, marginBottom: s.md, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Recomendação para marcas
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: s.sm, marginBottom: s.md }}>
          {data.strengths.map((item, i) => (
            <div key={i} style={{ ...typ.bodySmall, color: c.text, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <span style={{ color: c.success, flexShrink: 0 }}>✔</span>
              <span>{item}</span>
            </div>
          ))}
          {data.warnings.map((item, i) => (
            <div key={i} style={{ ...typ.bodySmall, color: c.text, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <span style={{ color: c.warning, flexShrink: 0 }}>⚠</span>
              <span>{item}</span>
            </div>
          ))}
        </div>
        <div style={{ ...typ.bodySmall, color: c.primary, fontWeight: 700, marginBottom: s.sm }}>
          → {data.recommendation}
        </div>
        <div style={{ ...typ.bodySmall, color: c.textSecondary, marginBottom: 4 }}>
          Perfil classificado como: <strong style={{ color: c.text }}>{data.creatorType.fullLabel}</strong>
        </div>
        {benchmark != null && typeof erAtual === 'number' && (
          <div style={{ ...typ.caption, color: c.textMuted, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${c.borderLight}` }}>
            Média {benchmark.tier}: {benchmark.tierErAvg.toFixed(1).replace('.', ',')}% ER · Seu ER: {erAtual.toFixed(2).replace('.', ',')}%
          </div>
        )}
      </div>
    </Card>
  )
}

// ——— Plano de Ação 90 dias ———
export interface PlanoAcao90DiasSectionProps {
  /** Itens para Semana 1 (ex.: Migrar para Criador, Tornar perfil público, Adicionar link) */
  semana1Items: string[]
  /** Estilos para o card (ex.: flex: 1 para igualar altura na linha) */
  style?: React.CSSProperties
}

export function PlanoAcao90DiasSection({ semana1Items, style: styleProp }: PlanoAcao90DiasSectionProps) {
  return (
    <Card
      size="small"
      className="report-card plano-90-dias"
      style={{
        borderRadius: r.xl,
        border: `1px solid ${c.primaryMuted ?? c.primary + '30'}`,
        boxShadow: sh.md,
        overflow: 'hidden',
        background: c.cardBg,
        ...styleProp,
      }}
    >
      <div style={{ padding: s.md }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: s.sm, marginBottom: s.md }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: c.cardBgHighlight ?? `${c.primary}20`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <RocketOutlined style={{ fontSize: 16, color: c.primary }} />
          </div>
          <div style={{ ...typ.h3, color: c.text, margin: 0, fontSize: typ.h3?.fontSize ?? 16 }}>Plano de Ação</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: s.sm }}>
          <div>
            <div style={{ ...typ.caption, color: c.primary, fontWeight: 700, marginBottom: 4, fontSize: 11 }}>Semana 1</div>
            <ul style={{ margin: 0, paddingLeft: 18, ...typ.bodySmall, color: c.text, lineHeight: 1.4 }}>
              {semana1Items.length > 0 ? semana1Items.map((item, i) => <li key={i} style={{ marginBottom: 2 }}>{item}</li>) : <li style={{ marginBottom: 2 }}>Completar perfil (link, bio, conta Criador)</li>}
            </ul>
          </div>
          <div>
            <div style={{ ...typ.caption, color: c.primary, fontWeight: 700, marginBottom: 4, fontSize: 11 }}>Semanas 2–4</div>
            <ul style={{ margin: 0, paddingLeft: 18, ...typ.bodySmall, color: c.text, lineHeight: 1.4 }}>
              <li style={{ marginBottom: 2 }}>Postar 3x por semana</li>
              <li style={{ marginBottom: 2 }}>Usar hashtags segmentadas</li>
            </ul>
          </div>
          <div>
            <div style={{ ...typ.caption, color: c.primary, fontWeight: 700, marginBottom: 4, fontSize: 11 }}>Mês 2</div>
            <ul style={{ margin: 0, paddingLeft: 18, ...typ.bodySmall, color: c.text, lineHeight: 1.4 }}>
              <li style={{ marginBottom: 2 }}>Focar em reels com legenda que gera conversa</li>
            </ul>
          </div>
          <div>
            <div style={{ ...typ.caption, color: c.primary, fontWeight: 700, marginBottom: 4, fontSize: 11 }}>Mês 3</div>
            <ul style={{ margin: 0, paddingLeft: 18, ...typ.bodySmall, color: c.text, lineHeight: 1.4 }}>
              <li style={{ marginBottom: 0 }}>Abordar marcas locais com Mídia Kit</li>
            </ul>
          </div>
        </div>
      </div>
    </Card>
  )
}

// ——— StickyCTA: barra branca fixa com explicação do Mídia Kit e botão ———
export function StickyCTA({
  primaryLabel,
  primarySubtext,
  explanation,
  primaryIcon,
  onPrimary,
  secondaryLabel,
  onSecondary,
  visible,
  isMobile,
  embeddedInModal = false,
}: {
  primaryLabel: string
  primarySubtext?: string
  /** Texto explicando o que é um Mídia Kit */
  explanation?: string
  primaryIcon?: React.ReactNode
  onPrimary: () => void
  secondaryLabel?: string
  onSecondary?: () => void
  visible: boolean
  /** Em mobile: esconde a descrição e mostra só o botão */
  isMobile?: boolean
  /** Dentro do modal de detalhe: gruda no rodapé do painel rolável (evita sobrepor o conteúdo por `fixed` na viewport). */
  embeddedInModal?: boolean
}) {
  if (!visible) return null
  const defaultExplanation = 'Seu Mídia Kit organiza seus dados, comprova sua performance e aumenta sua credibilidade na hora de negociar com marcas'
  const text = explanation ?? defaultExplanation
  const layout = t.layout as { maxWidth: number; contentPadding: number; contentPaddingMobile: number }
  const paddingH = isMobile ? layout.contentPaddingMobile : layout.contentPadding
  return (
    <div
      className={`report-sticky-cta${embeddedInModal ? ' report-sticky-cta--in-modal' : ''}`}
      style={{
        position: embeddedInModal ? 'relative' : 'fixed',
        bottom: embeddedInModal ? undefined : 0,
        left: embeddedInModal ? undefined : 0,
        right: embeddedInModal ? undefined : 0,
        width: embeddedInModal ? '100%' : undefined,
        flexShrink: embeddedInModal ? 0 : undefined,
        background: 'var(--app-primary)',
        borderTop: '2px solid rgba(255,255,255,0.2)',
        boxShadow: '0 -4px 24px rgba(0,0,0,0.2), 0 -1px 0 rgba(255,255,255,0.08)',
        zIndex: embeddedInModal ? 6 : 10000,
        display: 'flex',
        justifyContent: 'center',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: layout.maxWidth,
          minHeight: isMobile ? 56 : 72,
          padding: `${isMobile ? s.md : s.lg}px ${paddingH}px calc(${isMobile ? s.md : s.lg}px + env(safe-area-inset-bottom, 0px))`,
          display: 'flex',
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: isMobile ? 'center' : 'space-between',
          gap: s.md,
          boxSizing: 'border-box',
        }}
      >
        {!isMobile && (
          <div style={{ flex: '1 1 200px', minWidth: 0, ...typ.caption, fontSize: 14, color: 'rgba(255,255,255,0.95)', lineHeight: 1.35 }}>
            {text}
          </div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: s.sm, alignItems: 'center', flexShrink: 0 }}>
          <Button
            type="primary"
            className="report-sticky-cta__btn"
            size="large"
            icon={primaryIcon ?? <RocketOutlined />}
            style={{
              borderRadius: r.md,
              background: 'var(--app-accent)',
              borderColor: 'var(--app-accent)',
              color: 'var(--app-text)',
              minHeight: 44,
              paddingLeft: s.md,
              paddingRight: s.md,
              fontWeight: 600,
            }}
            onClick={onPrimary}
          >
            {primaryLabel}
          </Button>
          {secondaryLabel && onSecondary ? (
            <Button type="default" size="large" icon={<MessageOutlined />} style={{ borderRadius: r.md, minHeight: 44, borderColor: 'rgba(255,255,255,0.5)', color: '#fff' }} onClick={onSecondary}>{secondaryLabel}</Button>
          ) : null}
        </div>
        {!isMobile && primarySubtext ? (
          <span style={{ ...typ.caption, fontSize: 11, color: c.textMuted ?? '#999', flex: '1 1 100%', textAlign: 'center' }}>{primarySubtext}</span>
        ) : null}
      </div>
    </div>
  )
}

// ——— ReportSkeleton ———
export function ReportSkeleton() {
  return (
    <div style={{ width: '100%', padding: s.lg, boxSizing: 'border-box' }}>
      {/* Hero: avatar + título + highlights */}
      <div style={{ marginBottom: s.xl, borderRadius: r.xl, overflow: 'hidden', boxShadow: sh.md, padding: s.xl, background: c.cardBg }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: s.lg, flexWrap: 'wrap' }}>
          <Skeleton.Avatar active size={80} shape="circle" />
          <div style={{ flex: 1, minWidth: 200 }}>
            <Skeleton active title={{ width: 220 }} paragraph={{ rows: 0 }} style={{ marginBottom: 8 }} />
            <Skeleton active title={false} paragraph={{ rows: 1, width: [120] }} style={{ marginBottom: 8 }} />
            <Skeleton active title={false} paragraph={{ rows: 1, width: ['60%', '40%'] }} />
          </div>
        </div>
      </div>
      {/* Score card */}
      <Skeleton active paragraph={{ rows: 3 }} style={{ marginBottom: s.xl, borderRadius: r.lg, padding: s.lg }} />
      {/* Insight cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: s.md, marginBottom: s.xl }}>
        <Skeleton active paragraph={{ rows: 2 }} style={{ borderRadius: r.lg, padding: s.lg }} />
        <Skeleton active paragraph={{ rows: 2 }} style={{ borderRadius: r.lg, padding: s.lg }} />
        <Skeleton active paragraph={{ rows: 2 }} style={{ borderRadius: r.lg, padding: s.lg }} />
      </div>
      <Skeleton active paragraph={{ rows: 2 }} />
    </div>
  )
}
