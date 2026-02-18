/**
 * Subcomponentes do relatório premium (ReportHero, ScoreOverview, InsightCardsGrid, etc.)
 */
import React, { useState } from 'react'
import { Button, Card, Tag, Avatar, Progress, Skeleton, Tabs, Tooltip } from 'antd'
import {
  ArrowLeftOutlined,
  EditOutlined,
  UserOutlined,
  CheckCircleFilled,
  WarningFilled,
  RocketOutlined,
  FileImageOutlined,
} from '@ant-design/icons'
import { reportTokens as t } from './reportTokens'
import { METRIC_TOOLTIPS } from '../constants/metricTooltips'

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
  headline: string
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
  onCta: () => void
  onAvatarError: () => void
  ctaLabel?: string
  /** Em mobile: avatar e espaçamentos menores */
  isMobile?: boolean
  /** Conteúdo extra dentro do mesmo painel (ex.: ScoreOverview) */
  extraContent?: React.ReactNode
  /** Score 0–100: renderiza barra de progresso logo abaixo dos highlights */
  score?: number
  /** Tooltip da barra de progresso (ex.: explicação do score) */
  scoreTooltip?: string
  /** Botão para o dono do perfil editar (leva à página de ativação/cadastro) */
  onEditProfile?: () => void
  editProfileLabel?: string
}

const AVATAR_SIZE = 160
const AVATAR_SIZE_MOBILE = 112

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
  onBack,
  onCta,
  onAvatarError,
  ctaLabel = 'Gerar Media Kit Profissional',
  isMobile = false,
  extraContent,
  score: scoreValue,
  scoreTooltip,
  onEditProfile,
  editProfileLabel = 'Editar perfil',
}: ReportHeroProps) {
  const atHandle = handleProp ? `@${handleProp.replace(/^@/, '')}` : ''
  const avatarSize = isMobile ? AVATAR_SIZE_MOBILE : AVATAR_SIZE
  const pad = isMobile ? s.md : s.xl
  const gap = isMobile ? s.md : s.xl
  const progressGradient = scoreValue != null
    ? (scoreValue >= 70 ? `linear-gradient(90deg, ${c.success} 0%, #34d399 100%)` : scoreValue >= 40 ? `linear-gradient(90deg, ${c.primary} 0%, #818cf8 100%)` : `linear-gradient(90deg, ${c.warning} 0%, #fbbf24 100%)`)
    : undefined
  const hasRightBadge = tierLabelProp != null && (percentil != null || scoreSelo)
  return (
    <section className="report-hero" style={{ position: 'relative', width: '100%', padding: `${pad}px 0`, boxSizing: 'border-box' }} aria-label="Cabeçalho do relatório">
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
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={onBack}
          className="report-hero-back"
          style={{ color: c.textSecondary, position: 'absolute', top: isMobile ? s.md : s.lg, left: isMobile ? s.md : s.lg, zIndex: 1 }}
          aria-label="Voltar"
        />
        <div style={{ display: 'flex', alignItems: 'center', gap, flexWrap: 'wrap', position: 'relative', zIndex: 0 }}>
          <Avatar
            size={avatarSize}
            src={profilePic}
            icon={<UserOutlined />}
            alt={name || atHandle || 'Foto do perfil'}
            style={{ border: '3px solid #fff', boxShadow: sh.md, flexShrink: 0 }}
            onError={() => { onAvatarError(); return false }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            {(name || atHandle || hasRightBadge) && (
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: s.sm, marginBottom: s.xs }}>
                <div style={{ minWidth: 0 }}>
                  {name && <h1 style={{ ...typ.hero, color: c.text, margin: 0, marginBottom: 2, lineHeight: 1.2, fontSize: isMobile ? 22 : typ.hero.fontSize }}>{name}</h1>}
                  {atHandle && <div style={{ ...typ.body, color: c.textSecondary, fontWeight: 500, fontSize: isMobile ? 13 : typ.body.fontSize }}>{atHandle}</div>}
                </div>
                {hasRightBadge && (
                  <div style={{ flexShrink: 0 }}>
                    <Tag
                      style={{
                        background: `linear-gradient(135deg, ${c.goldLight} 0%, rgba(212, 168, 83, 0.25) 100%)`,
                        color: '#92400e',
                        border: `1px solid ${c.goldBorder}`,
                        borderRadius: r.full,
                        padding: isMobile ? '2px 10px' : '4px 12px',
                        fontWeight: 700,
                        fontSize: isMobile ? 11 : 12,
                        margin: 0,
                        boxShadow: '0 2px 8px rgba(212, 168, 83, 0.2)',
                      }}
                    >
                      ⭐ {tierLabelProp}
                    </Tag>
                  </div>
                )}
              </div>
            )}
            {hasRightBadge && (percentil != null || scoreSelo) && (
              <div style={{ ...typ.caption, color: c.textSecondary, marginBottom: s.xs, textAlign: 'right' }}>
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
            <p style={{ ...typ.body, color: c.textSecondary, margin: 0, marginBottom: s.sm, fontSize: isMobile ? 13 : undefined }}>{headline}</p>
            {!hasRightBadge && badgeLabel != null && (
              <Tag style={{ background: c.primary, color: '#fff', border: 'none', borderRadius: r.full, padding: isMobile ? '2px 10px' : '4px 12px', marginBottom: s.sm, fontSize: typ.caption.fontSize }}>{badgeLabel}</Tag>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: isMobile ? s.sm : s.lg, marginBottom: secondaryMetrics ? s.xs : scoreValue != null ? s.sm : s.md }}>
              {highlights.map(({ label, value }) => {
                const tooltipKey = label === 'Seguidores' ? 'seguidores' : label === 'ER' ? 'er' : label === 'Posts/sem' ? 'postsPerSemana' : null
                const tip = tooltipKey ? METRIC_TOOLTIPS[tooltipKey as keyof typeof METRIC_TOOLTIPS] : null
                const content = <><strong style={{ color: c.text }}>{value}</strong> {label}</>
                const span = <span style={{ ...typ.bodySmall, color: c.textSecondary, cursor: tip ? 'help' : undefined }}>{content}</span>
                return <span key={label}>{tip ? <Tooltip title={tip} placement="top">{span}</Tooltip> : span}</span>
              })}
            </div>
            {secondaryMetrics && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: isMobile ? s.sm : s.lg, alignItems: 'center', ...typ.bodySmall, color: c.textSecondary, marginBottom: scoreValue != null ? s.sm : s.md }}>
                {secondaryMetrics}
              </div>
            )}
            {scoreValue != null && progressGradient && (() => {
              const bar = (
                <div style={{ display: 'flex', alignItems: 'center', gap: s.sm, marginBottom: s.md, width: '100%', maxWidth: 320, cursor: scoreTooltip ? 'help' : undefined }}>
                  <Progress
                    percent={scoreValue}
                    showInfo={false}
                    strokeColor={progressGradient}
                    trailColor={c.borderLight}
                    strokeWidth={isMobile ? 8 : 10}
                    style={{ flex: 1, marginBottom: 0 }}
                  />
                  <span style={{ ...typ.caption, fontWeight: 700, color: c.text, flexShrink: 0 }}>{scoreValue}/100</span>
                </div>
              )
              return scoreTooltip ? <Tooltip title={scoreTooltip} placement="top">{bar}</Tooltip> : bar
            })()}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: s.sm, alignItems: 'center' }}>
              <Button
                type="primary"
                size={isMobile ? 'small' : 'middle'}
                onClick={onCta}
                style={{ borderRadius: r.md, background: c.gold, borderColor: c.gold, color: '#1a1a1a', fontWeight: 600 }}
              >
                {ctaLabel}
              </Button>
              {onEditProfile && (
                <Button
                  type="default"
                  size={isMobile ? 'small' : 'middle'}
                  icon={<EditOutlined />}
                  onClick={onEditProfile}
                  className="report-hero-edit"
                  style={{ borderRadius: r.md }}
                  aria-label={editProfileLabel}
                >
                  {editProfileLabel}
                </Button>
              )}
            </div>
          </div>
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
}: ScoreOverviewProps) {
  const maxBar = Math.max(1, ...postsPerWeekData)
  const scoreColor = score >= 70 ? c.success : score >= 40 ? c.primary : c.warning
  const progressGradient = score >= 70
    ? `linear-gradient(90deg, ${c.success} 0%, #34d399 100%)`
    : score >= 40
      ? `linear-gradient(90deg, ${c.primary} 0%, #818cf8 100%)`
      : `linear-gradient(90deg, ${c.warning} 0%, #fbbf24 100%)`
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
              <span style={{ fontSize: 28, fontWeight: 800, color: '#fff' }}>{score}</span>
            </div>
            <div>
              <div style={{ ...typ.overline, color: c.textMuted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Seu score</div>
              <div style={{ ...typ.body, color: c.textSecondary }}>{score}/100</div>
            </div>
          </div>
          <Tag
            style={{
              background: `linear-gradient(135deg, ${c.goldLight} 0%, rgba(212, 168, 83, 0.25) 100%)`,
              color: '#92400e',
              border: `1px solid ${c.goldBorder}`,
              borderRadius: r.full,
              padding: '8px 16px',
              fontWeight: 700,
              fontSize: 13,
              boxShadow: '0 2px 8px rgba(212, 168, 83, 0.2)',
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
            trailColor={c.borderLight}
            strokeWidth={12}
            style={{ marginBottom: 0 }}
          />
        </div>
      )}
      {embedded && !tierInHero && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: s.sm, marginBottom: compact ? s.sm : s.md }}>
          <Tag
            style={{
              background: `linear-gradient(135deg, ${c.goldLight} 0%, rgba(212, 168, 83, 0.25) 100%)`,
              color: '#92400e',
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
      {showPostsPerWeek && (
        <div
          style={{
            padding: compact ? s.md : s.lg,
            background: embedded ? 'rgba(255,255,255,0.4)' : 'linear-gradient(180deg, rgba(99, 102, 241, 0.06) 0%, rgba(99, 102, 241, 0.02) 100%)',
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
                  background: `linear-gradient(180deg, ${c.primary} 0%, #818cf8 100%)`,
                  borderRadius: 6,
                  boxShadow: '0 2px 6px rgba(99, 102, 241, 0.25)',
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
      <div aria-label="Resumo do score">
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
        background: 'linear-gradient(145deg, #ffffff 0%, #f8fafc 50%, #eef2ff 100%)',
        borderLeft: `4px solid ${scoreColor}`,
      }}
      aria-label="Resumo do score"
    >
      <div style={{ padding: s.xl }}>{inner}</div>
    </Card>
  )
}

// ——— InsightCardsGrid (3 cards: faz bem, trava, fazer primeiro) ———
export function InsightCardsGrid({
  fazBem,
  trava,
  fazerPrimeiro,
}: {
  fazBem: string
  trava: string
  fazerPrimeiro: string
}) {
  const items: { icon: React.ReactNode; title: string; text: string }[] = [
    { icon: <CheckCircleFilled style={{ color: c.success, fontSize: 18 }} />, title: 'O que você faz bem', text: fazBem },
    { icon: <WarningFilled style={{ color: c.warning, fontSize: 18 }} />, title: 'O que te trava', text: trava },
    { icon: <RocketOutlined style={{ color: c.primary, fontSize: 18 }} />, title: 'O que fazer primeiro', text: fazerPrimeiro },
  ]
  const hoverStyle: React.CSSProperties = {
    ...cardBaseStyle,
    padding: s.lg,
    cursor: 'default',
  }
  return (
    <div className="insight-cards-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: s.md }} role="list">
      {items.map(({ icon, title, text }) => (
        <Card
          key={title}
          size="small"
          className="report-card report-card--hover"
          style={hoverStyle}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = sh.md }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = sh.sm }}
          role="listitem"
        >
          <div style={{ display: 'flex', gap: s.sm, alignItems: 'flex-start' }}>
            <span style={{ flexShrink: 0, marginTop: 2 }} aria-hidden>{icon}</span>
            <div>
              <div style={{ ...typ.h3, color: c.text, marginBottom: 4 }}>{title}</div>
              <p style={{ ...typ.bodySmall, color: c.textSecondary, margin: 0 }}>{text}</p>
            </div>
          </div>
        </Card>
      ))}
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
}: {
  items: ProofItem[]
  getImageUrl: (post: unknown) => string | undefined
  getLink: (post: unknown) => string
  proxyUrl: (url: string) => string
  failedImages: Set<string>
  formatShortNum: (n: number) => string
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
                  {isTop && <Tag style={{ margin: 0, background: c.primary, color: '#fff', border: 'none', fontSize: 10 }}>#1</Tag>}
                  {geraConversa && <Tag style={{ margin: 0, background: c.success, color: '#fff', border: 'none', fontSize: 10 }}>Gera conversa</Tag>}
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
                  background: 'linear-gradient(to top, rgba(0,0,0,0.5) 0%, transparent 50%)',
                  opacity: isHovered ? 1 : 0,
                  transition: 'opacity 0.2s ease',
                  pointerEvents: 'none',
                }}
                aria-hidden
              />
            </div>
            <div style={{ padding: s.sm }}>
              <Tooltip title={METRIC_TOOLTIPS.interacoesPost} placement="top">
                <div style={{ ...typ.bodySmall, fontWeight: 600, color: c.text, cursor: 'help', display: 'inline-block' }}>{formatShortNum(interactions)} interações</div>
              </Tooltip>
              <Tooltip title={METRIC_TOOLTIPS.erPost} placement="top">
                <div style={{ ...typ.caption, color: c.textMuted, cursor: 'help', display: 'inline-block' }}>ER {erPost.toFixed(1)}%</div>
              </Tooltip>
              <div style={{ ...typ.caption, color: c.primary, marginTop: 4 }}>{oQueFuncionou}</div>
            </div>
          </a>
        )
      })}
    </div>
  )
}

// ——— AudienceQualityCard ———
export function AudienceQualityCard({ rate, label, tooltip, style: styleProp }: { rate: number; label: string; tooltip?: string; style?: React.CSSProperties }) {
  const card = (
    <Card size="small" className="report-card" style={{ borderRadius: r.lg, border: 'none', boxShadow: sh.sm, padding: s.lg, background: c.successBg, cursor: tooltip ? 'help' : undefined, ...styleProp }}>
      <div style={{ ...typ.caption, color: c.textSecondary, marginBottom: 4 }}>Seu público conversa?</div>
      <div style={{ fontSize: 28, fontWeight: 800, color: c.text }}>{rate}%</div>
      <div style={{ ...typ.bodySmall, color: c.text }}>{label}</div>
    </Card>
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
          <div key={i} style={{ flex: 1, minWidth: 0, height: Math.max(6, (n / max) * 30), background: c.primary, borderRadius: 4, opacity: 0.85 }} />
        ))}
      </div>
      <div style={{ ...typ.caption, color: c.textSecondary, marginTop: 8 }}>Melhor: {bestDay} às {bestHour}h</div>
    </div>
  )
}

// ——— PricingHighlight ———
export function PricingHighlight({ min, max, porque, onCta, hideCta, tooltip, style: styleProp }: { min: number; max: number; porque: string; onCta: () => void; hideCta?: boolean; tooltip?: string; style?: React.CSSProperties }) {
  const titleEl = <div style={{ ...typ.overline, color: c.textSecondary, marginBottom: 4, cursor: tooltip ? 'help' : undefined, display: 'inline-block' }}>Valor estimado por post</div>
  const card = (
    <Card size="small" className="report-card pricing-highlight" style={{ borderRadius: r.xl, border: 'none', boxShadow: sh.lg, padding: s.lg, background: c.goldLight, ...styleProp }}>
      {tooltip ? <Tooltip title={tooltip} placement="top">{titleEl}</Tooltip> : titleEl}
      <div style={{ fontSize: 28, fontWeight: 800, color: c.text, marginBottom: 4 }}>R$ {min} – R$ {max}</div>
      <p style={{ ...typ.bodySmall, color: c.textSecondary, margin: 0, marginBottom: hideCta ? 0 : s.lg }}>{porque}</p>
      {!hideCta && <Button type="primary" size="large" block style={{ borderRadius: r.md, background: c.gold, borderColor: c.gold, color: '#1a1a1a' }} onClick={onCta}>Gerar Media Kit Profissional</Button>}
    </Card>
  )
  return card
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

// ——— StickyCTA (mobile) ———
export function StickyCTA({
  primaryLabel,
  primarySubtext,
  onPrimary,
  secondaryLabel,
  onSecondary,
  visible,
}: {
  primaryLabel: string
  primarySubtext: string
  onPrimary: () => void
  secondaryLabel: string
  onSecondary: () => void
  visible: boolean
}) {
  if (!visible) return null
  return (
    <div className="report-sticky-cta" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, padding: s.md, background: c.glassBg, backdropFilter: 'blur(12px)', borderTop: `1px solid ${c.borderLight}`, zIndex: 100, boxShadow: '0 -4px 20px rgba(0,0,0,0.06)' }}>
      <div style={{ width: '100%', maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: s.sm }}>
        <Button type="primary" size="large" block style={{ borderRadius: r.md, background: c.gold, borderColor: c.gold, color: '#1a1a1a', height: 48 }} onClick={onPrimary}>{primaryLabel}</Button>
        <div style={{ ...typ.caption, color: c.textMuted, textAlign: 'center' }}>{primarySubtext}</div>
        <Button type="default" size="middle" block style={{ borderRadius: r.md }} onClick={onSecondary}>{secondaryLabel}</Button>
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
