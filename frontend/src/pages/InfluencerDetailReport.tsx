/**
 * Subcomponentes do relatório premium (ReportHero, ScoreOverview, DiagnosticoBISection, etc.)
 */
import React, { useState, useEffect } from 'react'
import { Button, Card, Tag, Avatar, Progress, Skeleton, Tabs, Tooltip, Spin, Row, Col } from 'antd'
import {
  UserOutlined,
  CheckCircleFilled,
  WarningFilled,
  RocketOutlined,
  FileImageOutlined,
  DollarOutlined,
  CommentOutlined,
  MessageOutlined,
} from '@ant-design/icons'
import { reportTokens as t } from './reportTokens'
import { METRIC_TOOLTIPS } from '../constants/metricTooltips'
import { ERGaugeChart, ER_QUALIDADE_BANDAS, erBandaRangeLabel, getErBanda } from '../components/ERGaugeChart'
import { TierProgressGameBar } from '../components/TierProgressGameBar'
import type { StrategicMetrics, ExecutiveSummaryForBrands, BenchmarkInsight } from '../utils/reportInsights'

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
  /** Nome de exibição do perfil */
  name?: string
  /** Handle/username para exibir como @handle */
  handle?: string
  /** Texto ou conteúdo (ex.: tags + descrição) exibido no lugar da BIO no card */
  headline: React.ReactNode
  /** Badge principal (ex.: "Top 90%") quando não há tier à direita */
  badgeLabel?: string
  /** Tier + selo à direita na mesma linha do nome (ex.: "Nano Influencer" + "Top 90% · Em crescimento") */
  tierLabel?: string
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
}

const AVATAR_SIZE = 120
const AVATAR_SIZE_MOBILE = 64

export function ReportHero({
  profilePic,
  name,
  handle: handleProp,
  headline,
  badgeLabel,
  tierLabel: tierLabelProp,
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
}: ReportHeroProps) {
  const atHandle = handleProp ? `@${handleProp.replace(/^@/, '')}` : ''
  const avatarSize = isMobile ? AVATAR_SIZE_MOBILE : AVATAR_SIZE
  const pad = isMobile ? s.sm : s.md
  const gap = isMobile ? s.xs : s.sm
  const showRightColumn = !isMobile && (tierLabelProp != null && (percentil != null || scoreSelo) || typesTags != null)

  const [imageLoading, setImageLoading] = useState(!!profilePic)
  const [imageError, setImageError] = useState(false)
  useEffect(() => {
    if (profilePic) {
      setImageLoading(true)
      setImageError(false)
    } else {
      setImageLoading(false)
      setImageError(false)
    }
  }, [profilePic])

  const hasRightBadge = tierLabelProp != null && (percentil != null || scoreSelo)
  return (
    <section className="report-hero" style={{ position: 'relative', width: '100%', boxSizing: 'border-box', paddingBottom: isMobile ? s.md : s.xl }} aria-label="Cabeçalho do relatório">
      <div
        className="report-hero-inner"
        style={{
          borderRadius: isMobile ? r.lg : r.xl,
          background: c.heroGradient,
          position: 'relative',
          overflow: 'hidden',
          padding: pad,
          boxShadow: sh.md,
        }}
      >
        <div style={{ position: 'absolute', inset: 0, background: c.heroBlob, pointerEvents: 'none' }} />

        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'center' : showRightColumn ? 'flex-start' : 'center', justifyContent: isMobile ? 'center' : undefined, gap: showRightColumn ? s.md : gap, flexWrap: 'wrap', position: 'relative', zIndex: 0, textAlign: isMobile ? 'center' : undefined }}>
          {/* Coluna esquerda: avatar + conteúdo principal */}
          <div style={{ display: 'flex', flex: showRightColumn ? 1 : undefined, flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'center' : 'center', gap, flexWrap: 'wrap', minWidth: 0 }}>
            <div style={{ position: 'relative', flexShrink: 0, width: avatarSize, height: avatarSize }}>
              {profilePic ? (
                <>
                  <img
                    src={profilePic}
                    alt={name || atHandle || 'Foto do perfil'}
                    style={{
                      width: avatarSize,
                      height: avatarSize,
                      borderRadius: '50%',
                      border: '3px solid var(--brand-white)',
                      boxShadow: sh.md,
                      objectFit: 'cover',
                      visibility: imageLoading || imageError ? 'hidden' : 'visible',
                      position: imageLoading ? 'absolute' : 'relative',
                    }}
                    onLoad={() => setImageLoading(false)}
                    onError={() => {
                      setImageLoading(false)
                      setImageError(true)
                      onAvatarError()
                    }}
                  />
                  {imageLoading && (
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        width: avatarSize,
                        height: avatarSize,
                        borderRadius: '50%',
                        background: 'var(--app-placeholder-bg)',
                        border: '3px solid var(--brand-white)',
                        boxShadow: sh.md,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 1,
                      }}
                    >
                      <Spin size="default" />
                    </div>
                  )}
                  {imageError && (
                    <Avatar
                      size={avatarSize}
                      icon={<UserOutlined />}
                      alt={name || atHandle || 'Foto do perfil'}
                      style={{
                        position: 'absolute',
                        inset: 0,
                        zIndex: 1,
                        border: '3px solid var(--brand-white)',
                        boxShadow: sh.md,
                      }}
                    />
                  )}
                </>
              ) : (
                <Avatar
                  size={avatarSize}
                  icon={<UserOutlined />}
                  alt={name || atHandle || 'Foto do perfil'}
                  style={{ border: '3px solid var(--brand-white)', boxShadow: sh.md }}
                />
              )}
            </div>
            <div style={{ flex: isMobile ? undefined : 1, minWidth: 0, width: isMobile ? '100%' : undefined, textAlign: isMobile ? 'center' : undefined }}>
              {(name || atHandle || (hasRightBadge && !showRightColumn)) && (
                <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: isMobile ? 'center' : showRightColumn ? 'flex-start' : 'space-between', gap: s.xs, marginBottom: 0 }}>
                  <div style={{ minWidth: 0, textAlign: isMobile ? 'center' : undefined, lineHeight: 1.25 }}>
                    {name && <h1 style={{ ...typ.hero, color: c.text, margin: 0, marginBottom: 0, lineHeight: 1.2, fontSize: isMobile ? 18 : 20 }}>{name}</h1>}
                    {atHandle && <div style={{ ...typ.body, color: c.textSecondary, fontWeight: 500, fontSize: isMobile ? 12 : 13, marginTop: 0 }}>{atHandle}</div>}
                  </div>
                  {hasRightBadge && !showRightColumn && (
                    <div style={{ flexShrink: 0 }}>
                      <Tag
                        style={{
                          background: `linear-gradient(135deg, ${c.goldLight} 0%, var(--app-gold-border) 100%)`,
                          color: 'var(--app-text)',
                          border: `1px solid ${c.goldBorder}`,
                          borderRadius: r.full,
                          padding: isMobile ? '2px 8px' : '2px 10px',
                          fontWeight: 700,
                          fontSize: isMobile ? 10 : 11,
                          margin: 0,
                          boxShadow: 'var(--app-gold-shadow)',
                        }}
                      >
                        ⭐ {tierLabelProp}
                      </Tag>
                    </div>
                  )}
                </div>
              )}
              {hasRightBadge && !showRightColumn && (percentil != null || scoreSelo) && (
                <div style={{ ...typ.caption, color: c.textSecondary, marginBottom: 0, marginTop: 0, fontSize: 11, textAlign: isMobile ? 'center' : 'right' }}>
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
              {headline != null && (
                <div style={{ ...typ.body, color: c.textSecondary, margin: 0, marginTop: s.xs, marginBottom: 4, fontSize: isMobile ? 12 : 13, lineHeight: 1.35, display: '-webkit-box', overflow: 'hidden', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }}>
                  {typeof headline === 'string' ? <p style={{ margin: 0 }}>{headline}</p> : headline}
                </div>
              )}
              {!hasRightBadge && badgeLabel != null && (
                <Tag style={{ background: c.primary, color: 'var(--brand-white)', border: 'none', borderRadius: r.full, padding: isMobile ? '2px 8px' : '2px 10px', marginBottom: 4, fontSize: 11 }}>{badgeLabel}</Tag>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: isMobile ? s.xs : s.sm, marginBottom: secondaryMetrics ? 2 : scoreValue != null ? 4 : 6, justifyContent: isMobile ? 'center' : undefined }}>
                {highlights.map(({ label, value }) => {
                  const tooltipKey = label === 'Seguidores' ? 'seguidores' : label === 'ER' ? 'er' : label === 'Posts/sem' ? 'postsPerSemana' : null
                  const tip = tooltipKey ? METRIC_TOOLTIPS[tooltipKey as keyof typeof METRIC_TOOLTIPS] : null
                  const content = <><strong style={{ color: c.text }}>{value}</strong> {label}</>
                  const span = <span style={{ ...typ.bodySmall, color: c.textSecondary, cursor: tip ? 'help' : undefined }}>{content}</span>
                  return <span key={label}>{tip ? <Tooltip title={tip} placement="top">{span}</Tooltip> : span}</span>
                })}
              </div>
              {secondaryMetrics && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: isMobile ? s.xs : s.sm, alignItems: 'center', justifyContent: isMobile ? 'center' : undefined, ...typ.bodySmall, color: c.textSecondary, marginBottom: scoreValue != null ? 4 : 6, fontSize: 12 }}>
                  {secondaryMetrics}
                </div>
              )}
            </div>
          </div>
          {/* Coluna direita: badge + percentil + tipos */}
          {showRightColumn && (
            <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, minWidth: 120 }}>
              {hasRightBadge && (
                <>
                  <Tag
                    style={{
                      background: `linear-gradient(135deg, ${c.goldLight} 0%, var(--app-gold-border) 100%)`,
                      color: 'var(--app-text)',
                      border: `1px solid ${c.goldBorder}`,
                      borderRadius: r.full,
                      padding: '2px 10px',
                      fontWeight: 700,
                      fontSize: 11,
                      margin: 0,
                      boxShadow: 'var(--app-gold-shadow)',
                    }}
                  >
                    ⭐ {tierLabelProp}
                  </Tag>
                  {(percentil != null || scoreSelo) && (
                    <div style={{ ...typ.caption, color: c.textSecondary, margin: 0, fontSize: 11, textAlign: 'right' }}>
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
                </>
              )}
              {typesTags != null && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'flex-end' }}>
                  {typesTags}
                </div>
              )}
            </div>
          )}
        </div>
        {extraContent != null && extraContent}
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
        <div style={{ marginBottom: s.md }}>
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
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: s.sm, marginBottom: compact ? s.sm : s.md }}>
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
        <p style={{ ...typ.bodySmall, color: c.textSecondary, margin: 0, marginBottom: compact ? s.sm : s.lg, lineHeight: 1.45, fontSize: compact ? 12 : undefined }}>{explanation}</p>
      )}
      {embedded && scoreNarrativaFrase && (
        <p style={{ ...typ.bodySmall, color: c.text, margin: 0, marginTop: compact ? 4 : 6, marginBottom: compact ? s.sm : 0, lineHeight: 1.45, fontSize: compact ? 12 : undefined, fontWeight: 500 }}>{scoreNarrativaFrase}</p>
      )}
      {showPostsPerWeek && (
        <div
          style={{
            padding: compact ? s.md : s.lg,
            background: embedded ? 'var(--app-glass-bg)' : 'var(--app-primary-muted)',
            borderRadius: r.lg,
            border: embedded ? 'none' : `1px solid ${c.primaryMuted}`,
            width: '100%',
            marginBottom: compact ? s.sm : s.lg,
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
    <Row gutter={[s.lg, s.lg]} style={{ marginBottom: s.lg }}>
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
  proxyUrl,
  failedImages,
  formatShortNum,
  /** Quando true, exibe "Postado por @username" (ex.: na seção de marcados). */
  showAuthor = false,
}: {
  items: ProofItem[]
  getImageUrl: (post: unknown) => string | undefined
  getLink: (post: unknown) => string
  proxyUrl: (url: string) => string
  failedImages: Set<string>
  formatShortNum: (n: number) => string
  showAuthor?: boolean
}) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)
  return (
    <div className="proof-carousel" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: s.lg, width: '100%' }} role="list">
      {items.map(({ post, interactions, erPost, oQueFuncionou, isTop, geraConversa }) => {
        const key = (post as { key: string }).key
        const imgUrl = getImageUrl(post)
        const link = getLink(post)
        const failed = failedImages.has(key)
        const isHovered = hoveredKey === key
        return (
          <a
            key={key}
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="proof-thumb report-card--hover"
            style={{ display: 'block', borderRadius: r.lg, overflow: 'hidden', boxShadow: sh.md, background: c.cardBg, minWidth: 0, transition: t.animation.hoverTransition }}
            onMouseEnter={() => setHoveredKey(key)}
            onMouseLeave={() => setHoveredKey(null)}
            aria-label={`Post com ${formatShortNum(interactions)} interações, ER ${erPost.toFixed(1)}%. ${oQueFuncionou}`}
          >
            <div style={{ position: 'relative', aspectRatio: '1', background: c.borderLight }}>
              {(isTop || geraConversa) && (
                <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 1, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {isTop && <Tag style={{ margin: 0, background: c.primary, color: 'var(--brand-white)', border: 'none', fontSize: 10 }}>#1</Tag>}
                  {geraConversa && <Tag style={{ margin: 0, background: c.success, color: 'var(--brand-white)', border: 'none', fontSize: 10 }}>Gera conversa</Tag>}
                </div>
              )}
              {imgUrl && !failed ? (
                <img src={proxyUrl(imgUrl)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><FileImageOutlined style={{ fontSize: 32, color: c.textMuted }} aria-hidden /></div>
              )}
              <div
                className="proof-overlay"
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'linear-gradient(to top, var(--app-overlay) 0%, transparent 50%)',
                  opacity: isHovered ? 1 : 0,
                  transition: 'opacity 0.2s ease',
                  pointerEvents: 'none',
                }}
                aria-hidden
              />
            </div>
            <div style={{ padding: s.sm }}>
              {showAuthor && (post as { influencer?: { username?: string } })?.influencer?.username && (
                <div style={{ ...typ.caption, color: c.textMuted, marginBottom: 2 }}>
                  Postado por @{(post as { influencer?: { username?: string } }).influencer!.username}
                </div>
              )}
              <Tooltip title={METRIC_TOOLTIPS.interacoesPost} placement="top">
                <div style={{ ...typ.bodySmall, fontWeight: 600, color: c.text, cursor: 'help', display: 'inline-block' }}>{formatShortNum(interactions)} interações&nbsp;</div>
              </Tooltip>
              <Tooltip title={METRIC_TOOLTIPS.erPost} placement="top">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ ...typ.caption, color: c.textMuted, cursor: 'help' }}>ER {erPost.toFixed(1)}%</span>
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 600,
                      padding: '1px 4px',
                      borderRadius: 3,
                      background: `${getErBanda(erPost).color}22`,
                      color: getErBanda(erPost).color,
                      border: `1px solid ${getErBanda(erPost).color}44`,
                    }}
                  >
                    {getErBanda(erPost).label}
                  </span>
                </div>
              </Tooltip>
              <div style={{ ...typ.caption, color: c.primary, marginTop: 4 }}>{oQueFuncionou}</div>
            </div>
          </a>
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
  /** Narrativa: "Seu engajamento em reels é 2.3× maior que no feed" */
  erByTypeNarrative?: string | null
}

const ER_EXPLICACAO =
  'ER (Engagement Rate) é a taxa de engajamento: o percentual de seus seguidores que interagem com o conteúdo. A conta é: (curtidas + comentários) ÷ número de seguidores × 100. Assim, um ER de 5% significa que, em média, 5% da sua audiência reage a cada post. Quanto maior o ER, mais a audiência está envolvida — e mais atrativo o perfil para marcas, que usam essa métrica para avaliar alcance real e conexão com o público.'

const ER_ESCALA_EXPLICACAO =
  'Usamos uma escala de 0% a 6%+ para classificar a qualidade do engajamento em quatro faixas. Abaixo de 2% o engajamento é considerado baixo; entre 2% e 4% é bom; entre 4% e 6% é excelente; acima de 6% entramos na faixa viral, em que a audiência reage muito ao conteúdo.'

export function EngajamentoPorTipoSection({ engagementByType, rowGutter = [s.lg, s.lg], erByTypeNarrative }: EngajamentoPorTipoSectionProps) {
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
  const cardOQueEr = {
    padding: s.sm,
    background: c.cardBgSoft,
    borderRadius: r.md,
    border: `1px solid ${c.borderLight}`,
    borderLeft: `2px solid ${c.primary}`,
    boxShadow: 'none',
  }
  return (
    <div>
      <Row gutter={rowGutter} style={{ marginBottom: rowGutter[1] ?? s.lg }}>
        <Col xs={24}>
          <div style={cardOQueEr}>
            <div style={{ ...typ.caption, fontWeight: 600, color: c.textSecondary, marginBottom: 6 }}>O que é ER?</div>
            <div style={{ ...typ.caption, fontSize: 11, color: c.textMuted, lineHeight: 1.5, marginBottom: 10 }}>{ER_EXPLICACAO}</div>
            <div style={{ ...typ.caption, fontSize: 11, color: c.textMuted, lineHeight: 1.5, marginBottom: 8 }}>{ER_ESCALA_EXPLICACAO}</div>
          </div>
        </Col>
      </Row>
      <Row gutter={rowGutter}>
        <Col xs={24} sm={12}>
          <Tooltip title={`${METRIC_TOOLTIPS.er} Qualidade: ${ER_QUALIDADE_BANDAS.map((b) => `${erBandaRangeLabel(b)} ${b.label}`).join(' · ')}`} placement="top">
            <div style={{ ...cardStyleByEr(engagementByType.posts.er), padding: `${s.sm}px ${s.lg}px` }}>
              <ERGaugeChart
                value={engagementByType.posts.er}
                count={engagementByType.posts.count}
                title="ER médio por Feed"
              />
            </div>
          </Tooltip>
        </Col>
        <Col xs={24} sm={12}>
          <Tooltip title={engagementByType.reels.erByViews != null ? METRIC_TOOLTIPS.erPorSeguidoresEViews : `${METRIC_TOOLTIPS.er} Qualidade: ${ER_QUALIDADE_BANDAS.map((b) => `${erBandaRangeLabel(b)} ${b.label}`).join(' · ')}`} placement="top">
            <div style={{ ...cardStyleByEr(engagementByType.reels.er), padding: `${s.sm}px ${s.lg}px` }}>
              <ERGaugeChart
                value={engagementByType.reels.er}
                count={engagementByType.reels.count}
                title="ER médio por Reel"
              />
            </div>
          </Tooltip>
        </Col>
      </Row>
      {erByTypeNarrative && !/Seu feed engaja mais que reels/.test(erByTypeNarrative) && (
        <div style={{ ...typ.bodySmall, color: c.primary, fontWeight: 600, marginTop: s.md, padding: s.sm, background: c.primaryMuted ?? `${c.primary}12`, borderRadius: r.md }}>
          {erByTypeNarrative}
        </div>
      )}
    </div>
  )
}

// ——— MetricasMediakitSection (espelho da página 2 do Media Kit: Métricas) ———
const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

const metricasCardBase = { padding: s.md, borderRadius: r.md, border: 'none', boxShadow: sh.sm, height: '100%' as const }

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
  rowGutter?: [number, number]
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
  rowGutter = [s.lg, s.lg],
}: MetricasMediakitSectionProps) {
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
  // Primeira linha: Curtidas | Comentários | Views — Views só em reels/vídeos; curtidas/comentários de todos os posts (evita confusão "likes > views").
  const metricsBase = [
    { label: 'Curtidas', value: formatShortNum(totalLikes), desc: 'Total de curtidas (feed + reels)', bg: c.cardBgSoft, border: `1px solid ${c.borderLight}`, accent: c.primary },
    { label: 'Comentários', value: formatShortNum(totalComments), desc: 'Total de comentários (feed + reels)', bg: c.cardBgSoft, border: `1px solid ${c.borderLight}`, accent: c.success },
    ...(totalViews > 0 ? [{ label: 'Views (reels)', value: formatShortNum(totalViews), desc: 'Visualizações apenas em reels/vídeos. Curtidas e comentários acima são de todos os posts.', bg: c.cardBgSoft, border: `1px solid ${c.borderLight}`, accent: c.primary }] : []),
  ]
  const metrics = metricsBase
  const showViewsNote = totalViews > 0 && totalViews < totalLikes
  const metricsColSpan = metrics.length === 2 ? 12 : 8 // 2 cards em uma linha (12+12), 3 cards (8+8+8)
  const picoErBanda = maxEr > 0 ? (ER_QUALIDADE_BANDAS.find((b) => maxEr >= b.min && maxEr < b.max) ?? ER_QUALIDADE_BANDAS[ER_QUALIDADE_BANDAS.length - 1]) : null
  const converteQuadrants = [
    { value: `${er.toFixed(1)}%`, label: 'Engajamento', desc: 'Interações (curtidas + comentários) em % dos seguidores.', bg: c.cardBgStrategic ?? c.primary + '18', accent: c.primary },
    { value: `${Math.round(conversationRate)}%`, label: conversationLabel ?? 'Taxa comentários', desc: '% de comentários no total de interações; mais comentários costumam indicar maior conexão.', bg: c.successBg ?? c.success + '20', accent: c.success },
    { value: maxEr > 0 ? `${maxEr.toFixed(1)}%` : '—', label: 'Pico Viral', desc: 'Maior ER em um único post; indica potencial de alcance quando o conteúdo viraliza.', bg: picoErBanda ? `${picoErBanda.color}14` : (c.warningBg ?? c.warning + '25'), accent: picoErBanda?.color ?? c.warning, qualityLabel: picoErBanda?.label },
  ]

  return (
    <div>



      {/* KPIs: Curtidas | Comentários | Views (reels) — descrição deixa claro que views = só reels, curtidas = todos os posts */}
      <Row gutter={rowGutter} style={{ marginBottom: s.lg }}>
        {metrics.map((k) => (
          <Col xs={24} sm={metricsColSpan} key={k.label}>
            <div style={{ ...metricasCardBase, padding: s.sm, background: k.bg, border: k.border, textAlign: 'center', boxShadow: 'none' }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: k.accent }}>{k.value}</div>
              <div style={{ ...typ.caption, fontWeight: 600, color: c.textSecondary, marginTop: 4 }}>{k.label}</div>
              <div style={{ ...typ.caption, fontSize: 11, color: c.textMuted, marginTop: 2 }}>{k.desc}</div>
            </div>
          </Col>
        ))}
      </Row>
      {showViewsNote && (
        <div style={{ ...typ.caption, color: c.textMuted, marginBottom: s.lg, fontStyle: 'italic' }}>
          Nota: views só em reels/vídeos; curtidas e comentários incluem feed e reels — por isso curtidas podem ser maiores que views.
        </div>
      )}

      {/* CPE e CPM — CPM omitido quando não há views (API não fornece) */}
      <Row gutter={rowGutter} style={{ marginBottom: s.lg }}>
        <Col xs={24} sm={cpmValue && totalViews > 0 ? 12 : 24}>
          <div style={{ ...metricasCardBase, padding: s.sm, background: c.successBg, border: `1px solid ${c.successBorder ?? c.success}`, textAlign: 'center', boxShadow: sh.sm }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: c.success }}>{cpeValue}</div>
            <div style={{ ...typ.caption, fontWeight: 600, color: c.textSecondary, marginTop: 4 }}>CPE</div>
            <div style={{ ...typ.caption, fontSize: 11, color: c.textMuted, marginTop: 2 }}>Valor estimado por curtida ou comentário.</div>
          </div>
        </Col>
        {cpmValue && totalViews > 0 && (
          <Col xs={24} sm={12}>
            <div style={{ ...metricasCardBase, padding: s.sm, background: c.cardBgStrategic, border: `1px solid ${c.primaryMuted ?? c.primary}`, textAlign: 'center', boxShadow: sh.sm }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: c.primary }}>{cpmValue}</div>
              <div style={{ ...typ.caption, fontWeight: 600, color: c.textSecondary, marginTop: 4 }}>CPM</div>
              <div style={{ ...typ.caption, fontSize: 11, color: c.textMuted, marginTop: 2 }}>Custo por mil impressões (views); valor para alcançar 1.000 visualizações.</div>
            </div>
          </Col>
        )}
      </Row>

      {/* Por que minha audiência converte — 3 quadrantes coloridos */}
      <div style={{ marginBottom: s.lg }}>

        <Row gutter={rowGutter}>
          {converteQuadrants.map((q) => (
            <Col xs={24} sm={8} key={q.label}>
              <div style={{ ...metricasCardBase, background: q.bg, border: 'none', textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: q.accent }}>{q.value}</div>
                {'qualityLabel' in q && q.qualityLabel ? (
                  <div style={{ ...typ.bodySmall, fontWeight: 600, color: q.accent, marginTop: 6 }}>Pico {q.qualityLabel}</div>
                ) : (
                  <div style={{ ...typ.bodySmall, fontWeight: 600, color: c.text, marginTop: 6 }}>{q.label}</div>
                )}
                <div style={{ ...typ.caption, color: c.textMuted, marginTop: 6 }}>{q.desc}</div>
              </div>
            </Col>
          ))}
        </Row>
      </div>

      {/* Melhor horário — gráfico em card */}
      <Card size="small" style={{ marginBottom: s.lg, borderRadius: r.lg, overflow: 'hidden', border: `1px solid ${c.borderLight}`, boxShadow: sh.sm }}>
        <div style={{ padding: s.md, borderBottom: `1px solid ${c.borderLight}` }}>
          <div style={{ ...typ.bodySmall, fontWeight: 700, color: c.text }}>Melhor horário</div>
          {(picoDayLabel || (bestHour ?? 0) > 0) && (
            <div style={{ ...typ.caption, color: c.primary, fontWeight: 600, marginTop: 4 }}>
              Pico: {[picoDayLabel, (bestHour ?? 0) > 0 ? `às ${bestHour}h` : ''].filter(Boolean).join(' · ')}
            </div>
          )}
          <div style={{ ...typ.caption, color: c.textMuted, marginTop: 2 }}>
            ER por dia da semana: (curtidas + comentários) ÷ seguidores × 100
          </div>
        </div>
        <div style={{ padding: s.md, display: 'flex', alignItems: 'flex-end', gap: 8, minHeight: 100 }}>
          {WEEKDAY_LABELS.map((label, d) => {
            const erDay = erPerWeekday[d] ?? 0
            const pct = maxErDay > 0 ? (erDay / maxErDay) * 100 : 0
            const isBestEng = maxErDay > 0 && erDay >= maxErDay - 1e-6
            const barHeight = erDay > 0 ? Math.max(14, Math.round((pct / 100) * 52)) : 0
            return (
              <div key={label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 0 }}>
                <div style={{ width: '100%', height: 56, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
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
                <div style={{ ...typ.caption, fontWeight: isBestEng ? 700 : 500, color: isBestEng ? (c.gold ?? '#b8860b') : c.text, marginTop: 8 }}>{label}</div>
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
              </div>
            )
          })}
        </div>
      </Card>

      {/* Reach / Reels — card com bordas coloridas */}
      {(strategicMetrics?.reachMultiplier?.max != null && strategicMetrics.reachMultiplier.max >= 1) || (strategicMetrics?.reelsAmplification != null && strategicMetrics.reelsAmplification >= 1) ? (
        <Card size="small" style={{ marginBottom: s.lg, borderRadius: r.md, borderLeft: `4px solid ${c.primary}`, background: c.cardBgSoft, boxShadow: sh.sm }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: s.sm }}>
            {strategicMetrics?.reachMultiplier?.max != null && strategicMetrics.reachMultiplier.max >= 1 && (
              <span style={{ ...typ.bodySmall, padding: '6px 10px', background: c.primary + '20', color: c.primary, borderRadius: r.sm, fontWeight: 600 }}>Reach até {strategicMetrics.reachMultiplier.max.toFixed(1)}× seguidores</span>
            )}
            {strategicMetrics?.reelsAmplification != null && strategicMetrics.reelsAmplification >= 1 && (
              <span style={{ ...typ.bodySmall, padding: '6px 10px', background: c.gold + '25', color: c.gold, borderRadius: r.sm, fontWeight: 600 }}>Reels: {strategicMetrics.reelsAmplification.toFixed(1)}× base em média</span>
            )}
          </div>
        </Card>
      ) : null}

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
      <Col xs={24} sm={12} md={6}>
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
          style={{ height: '100%' }}
        />
      </Col>
      <Col xs={24} sm={12} md={6}>
        <PricingHighlight
          variant="reels"
          title="Valor estimado · Reels"
          min={valorEstimadoPorTipo.reels.min}
          max={valorEstimadoPorTipo.reels.max}
          porque={valorEstimadoPorTipo.reels.porque ?? ''}
          hideCta
          tooltip={METRIC_TOOLTIPS.valorEstimado}
          style={{ height: '100%' }}
        />
      </Col>
      <Col xs={24} sm={12} md={6}>
        <PricingHighlight
          variant="story"
          title="Valor estimado · Story"
          min={valorEstimadoPorTipo.stories.min}
          max={valorEstimadoPorTipo.stories.max}
          porque={valorEstimadoPorTipo.stories.porque ?? ''}
          hideCta
          tooltip={METRIC_TOOLTIPS.valorEstimado}
          style={{ height: '100%' }}
        />
      </Col>
      <Col xs={24} sm={12} md={6}>
        <PricingHighlight
          variant="destaque"
          title="Upgrade · Destaque (30 dias)"
          min={valorEstimadoPorTipo.destaque.min}
          max={valorEstimadoPorTipo.destaque.max}
          porque={valorEstimadoPorTipo.destaque.porque ?? ''}
          hideCta
          tooltip={METRIC_TOOLTIPS.valorEstimadoDestaque}
          style={{ height: '100%' }}
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
      style={{ flex: 1, minHeight: 0 }}
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
        minHeight: '100%',
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
        {min === 0 && max === 0 ? 'Incluído' : `R$ ${min.toLocaleString('pt-BR')} – R$ ${max.toLocaleString('pt-BR')}`}
      </div>
      <p style={{ ...typ.bodySmall, color: c.textSecondary, margin: 0, marginBottom: hideCta ? 0 : s.md, lineHeight: 1.35, fontSize: 12 }}>{porque}</p>
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

// ——— Métricas estratégicas (nível agência) ———
export interface StrategicMetricsSectionProps {
  metrics: StrategicMetrics
  /** Índice único: Estrutura + Consistência + Conversação + Frequência (0–100). */
  monetizationReadinessScore?: number
  /** Score de autoridade no nicho (0–100): % posts no nicho + performance hashtags + engajamento. */
  nicheAuthorityScore?: number
}

export function StrategicMetricsSection({ metrics, monetizationReadinessScore, nicheAuthorityScore }: StrategicMetricsSectionProps) {
  const dist = metrics.contentTypeDistribution
  const hash = metrics.hashtagDensity
  const tag = metrics.taggedDependency
  const cap = metrics.captionDepthInsight
  const conv = metrics.conversationDetail
  const idist = metrics.interactionDistribution
  const riskColor = metrics.commercialRisk === 'Alto' ? (c.danger ?? c.warning) : metrics.commercialRisk === 'Médio' ? c.warning : c.success
  return (
    <Card size="small" className="report-card strategic-metrics" style={{ borderRadius: r.xl, border: `1px solid ${c.borderLight}`, boxShadow: sh.md, overflow: 'hidden' }}>
      <div style={{ padding: s.lg }}>
        <div style={{ ...typ.caption, color: c.textMuted, marginBottom: s.md, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Métricas que marcas olham
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: s.md }}>
          {typeof monetizationReadinessScore === 'number' && (
            <div style={{ ...typ.bodySmall, fontWeight: 700, color: c.primary }}>
              Monetization Readiness: {monetizationReadinessScore}/100 — Estrutura + Consistência + Conversação + Frequência
            </div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: s.sm }}>
            <span style={{ ...typ.bodySmall, padding: '4px 8px', background: c.cardBgSoft, borderRadius: 6 }}>Comment rate: {(metrics.commentRatePct).toFixed(2)}%</span>
            <span style={{ ...typ.bodySmall, padding: '4px 8px', background: c.cardBgSoft, borderRadius: 6 }}>Like/Comment: {metrics.likeCommentRatio}×</span>
            <span style={{ ...typ.bodySmall, padding: '4px 8px', background: c.cardBgSoft, borderRadius: 6 }}>Comentários/likes: {(conv.commentToLikeRatio * 100).toFixed(2)}%</span>
            <span style={{ ...typ.bodySmall, padding: '4px 8px', background: c.cardBgSoft, borderRadius: 6 }}>Comentários/seguidores: {conv.commentsPerFollowerPct.toFixed(2)}%</span>
            <span style={{ ...typ.bodySmall, padding: '4px 8px', background: c.cardBgSoft, borderRadius: 6 }}>Média comentários/post: {conv.avgCommentsPerPost}</span>
            {metrics.likeCommentAlert && (
              <span style={{ ...typ.bodySmall, padding: '4px 8px', background: c.warning + '20', color: c.warning, borderRadius: 6, fontWeight: 600 }}>Proporção alta — audiência passiva</span>
            )}
          </div>
          <div style={{ ...typ.bodySmall, color: c.textSecondary }}>
            Engajamento ponderado (comentários×3 + likes×1 + views×0,2): <strong style={{ color: c.primary }}>{metrics.weightedEngagementScore}/100</strong>
          </div>
          {metrics.engagementConsistencyLabel && (
            <div style={{ ...typ.bodySmall, color: c.text }}>
              Consistência: {metrics.engagementConsistencyLabel}
            </div>
          )}
          {metrics.reachMultiplier.label && (
            <div style={{ ...typ.bodySmall, color: c.primary, fontWeight: 600 }}>Amplificação real de alcance: {metrics.reachMultiplier.label}</div>
          )}
          {metrics.reelsAmplificationLabel && (
            <div style={{ ...typ.bodySmall, color: c.textSecondary }}>Reels (média): {metrics.reelsAmplificationLabel}</div>
          )}
          <div style={{ ...typ.bodySmall, color: c.text }}>
            <strong>Distribuição de alcance:</strong> {idist.pctFromFeed}% feed · {idist.pctFromReels}% reels · {idist.pctFromTagged}% marcado (autonomia da audiência)
          </div>
          <div style={{ ...typ.bodySmall, color: c.text }}>
            <strong>Viral Dependence Index:</strong> {metrics.viralDependenceIndex}/100 — {metrics.viralDependenceLabel}
          </div>
          <div style={{ ...typ.bodySmall, color: c.text }}>
            <strong>Estimated Conversion Potential:</strong> <span style={{ color: c.primary, fontWeight: 600 }}>{metrics.conversionPotentialScore}/100</span> (comment_rate × frequência × consistência)
          </div>
          {typeof nicheAuthorityScore === 'number' && (
            <div style={{ ...typ.bodySmall, color: c.primary, fontWeight: 600 }}>
              Niche Authority Score: {nicheAuthorityScore}/100 — % posts no nicho + performance hashtags + engajamento
            </div>
          )}
          <div style={{ ...typ.bodySmall, color: c.textSecondary }}>
            Conteúdo: {dist.pctReels}% reels · {dist.pctCarousel}% carrossel · {dist.pctPhoto}% foto · {metrics.postsPerMonth} posts/mês
            {metrics.avgIntervalDays != null && ` · ~${metrics.avgIntervalDays} dias entre posts`}
          </div>
          <div style={{ ...typ.bodySmall, color: c.textSecondary }}>
            Hashtags: média {hash.avgPerPost} por post · {hash.pctWithHashtag}% dos posts com hashtag {hash.postsWithout > 0 && ` · ${hash.postsWithout} sem hashtag`}
          </div>
          <div style={{ ...typ.bodySmall, color: c.text }}>
            <strong>ER próprio vs quando marcado:</strong> {tag.erOwn.toFixed(2)}% próprio · {tag.erTagged.toFixed(2)}% quando marcado {tag.ratio > 1 ? `(${(tag.ratio * 100).toFixed(0)}% do próprio)` : ''}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: s.sm, flexWrap: 'wrap' }}>
            <span style={{ ...typ.bodySmall, fontWeight: 600, color: c.primary }}>Maturidade comercial: {metrics.commercialMaturityIndex}/100</span>
            <span style={{ ...typ.bodySmall, fontWeight: 600, color: c.primary }}>Discoverability: {metrics.discoverabilityScore}/100</span>
            <span style={{ ...typ.bodySmall, fontWeight: 600, color: c.primary }}>Audience Stability: {metrics.audienceStabilityScore}/100</span>
          </div>
          <div style={{ ...typ.bodySmall }}>
            <span style={{ fontWeight: 600, color: riskColor }}>Risco de perda de parceria: {metrics.commercialRisk}</span>
            {metrics.commercialRiskReasons.length > 0 && (
              <span style={{ color: c.textSecondary }}> — {metrics.commercialRiskReasons.join('; ')}</span>
            )}
          </div>
          {metrics.growthProjectionNote && (
            <div style={{ ...typ.caption, color: c.textMuted }}>{metrics.growthProjectionNote}</div>
          )}
          {tag.insight && <div style={{ ...typ.bodySmall, color: c.text }}>{tag.insight}</div>}
          {cap.insight && <div style={{ ...typ.bodySmall, color: c.text }}>{cap.insight}</div>}
        </div>
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
              <li style={{ marginBottom: 0 }}>Abordar marcas locais com Media Kit</li>
            </ul>
          </div>
        </div>
      </div>
    </Card>
  )
}

// ——— StickyCTA: barra branca fixa com explicação do Media Kit e botão ———
export function StickyCTA({
  primaryLabel,
  primarySubtext,
  explanation,
  onPrimary,
  secondaryLabel,
  onSecondary,
  visible,
  isMobile,
}: {
  primaryLabel: string
  primarySubtext?: string
  /** Texto explicando o que é um Media Kit */
  explanation?: string
  onPrimary: () => void
  secondaryLabel?: string
  onSecondary?: () => void
  visible: boolean
  /** Em mobile: esconde a descrição e mostra só o botão */
  isMobile?: boolean
}) {
  if (!visible) return null
  const defaultExplanation = 'Seu Media Kit organiza seus dados, comprova sua performance e aumenta sua credibilidade na hora de negociar com marcas'
  const text = explanation ?? defaultExplanation
  const layout = t.layout as { maxWidth: number; contentPadding: number; contentPaddingMobile: number }
  const paddingH = isMobile ? layout.contentPaddingMobile : layout.contentPadding
  return (
    <div
      className="report-sticky-cta"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        background: 'var(--app-primary)',
        borderTop: '2px solid rgba(255,255,255,0.2)',
        boxShadow: '0 -4px 24px rgba(0,0,0,0.2), 0 -1px 0 rgba(255,255,255,0.08)',
        zIndex: 10000,
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
            icon={<RocketOutlined />}
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
