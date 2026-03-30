import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { Typography, Button } from 'antd'
import type { ProfileListItem, ProfilesSearchQuery, ProfilePreviewItem } from '../../api'
import { fetchProfilesPreview } from '../../api'
import { mapProfileListToPreviewItems } from '../../utils/mapProfileListToPreviewItems'
import ProfileAvatar from '../ProfileAvatar'
import InfluencerTierPill from '../InfluencerTierPill'
import { sizeBucketKeyToTierLabel } from '../../utils/influencerTier'
import './InfluencerPreviewTable.css'

const { Title, Text } = Typography

interface InfluencerPreviewTableProps {
  /** Obrigatório quando `campaignProfiles` não é passado (fluxo dashboard / busca). */
  query?: ProfilesSearchQuery
  /**
   * Perfis já carregados (ex.: campanha em checkout). Usa o mesmo layout dos cards do preview,
   * sem chamar `POST /profiles/preview`.
   */
  campaignProfiles?: ProfileListItem[]
  /** Total na seleção (para rodapé “+N perfis” quando `campaignProfiles` é usado). */
  selectionTotalCount?: number
  /** Se true, não mostra “N perfis” ao lado do título (mantém `selectionTotalCount` para o rodapé). */
  hideSelectionCountInTitle?: boolean
  loading?: boolean
  /** Máximo de cards exibidos (default 5). */
  limit?: number
  title?: string
  /** Mesma ação que “Ver lista completa” no dashboard. */
  onViewMore?: () => void
  /** Classe extra no `<section>` (ex.: painel de pagamento). */
  className?: string
  /**
   * Checkout pendente: só `stable_profile_pic_url` (S3), sem fallback para foto do Instagram.
   */
  previewStablePicOnly?: boolean
  /**
   * No fluxo campanha/checkout: abre o aviso (ex. modal “finalize a compra”) ao clicar no rodapé
   * “+N perfis na lista completa” e em cada card de influenciador do preview.
   */
  onSelectionOverflowClick?: () => void
}

function toCamelCaseLabel(raw: string): string {
  const normalized = raw.replace(/[_-]+/g, ' ').trim().toLowerCase()
  if (!normalized) return raw
  return normalized
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

const BADGE_TONE_COUNT = 10

/** Preferência de tom por texto (hash estável). */
function badgeToneFromLabel(label: string): number {
  const key = label.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!key || key === '-') return 0
  let h = 0
  for (let i = 0; i < key.length; i++) {
    h = (Math.imul(31, h) + key.charCodeAt(i)) | 0
  }
  return Math.abs(h) % BADGE_TONE_COUNT
}

/**
 * No mesmo card, cada rótulo distinto recebe um tom diferente (sem repetir cor
 * entre badges de texto; Nano continua no InfluencerTierPill).
 */
function buildUniqueToneMap(labels: string[]): Map<string, number> {
  const used = new Set<number>()
  const map = new Map<string, number>()
  for (const raw of labels) {
    const k = raw.trim().toLowerCase().replace(/\s+/g, ' ')
    if (!k || k === '-') continue
    if (map.has(k)) continue
    let t = badgeToneFromLabel(raw) % BADGE_TONE_COUNT
    let tries = 0
    while (used.has(t) && tries < BADGE_TONE_COUNT) {
      t = (t + 1) % BADGE_TONE_COUNT
      tries++
    }
    if (used.has(t)) {
      for (let i = 0; i < BADGE_TONE_COUNT; i++) {
        if (!used.has(i)) {
          t = i
          break
        }
      }
    }
    used.add(t)
    map.set(k, t)
  }
  return map
}

function formatCompact(n: number): string {
  if (n == null || !Number.isFinite(n)) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return Math.round(n).toLocaleString('pt-BR')
}

export default function InfluencerPreviewTable({
  query,
  campaignProfiles,
  selectionTotalCount,
  loading = false,
  limit = 5,
  title = 'Preview de perfis',
  onViewMore,
  className,
  previewStablePicOnly = false,
  hideSelectionCountInTitle = false,
  onSelectionOverflowClick,
}: InfluencerPreviewTableProps) {
  const avatarSize = 52
  const fromCampaign = campaignProfiles != null
  const [items, setItems] = useState<ProfilePreviewItem[]>([])
  const [previewLoading, setPreviewLoading] = useState(false)

  const previewQuery = useMemo<ProfilesSearchQuery | null>(() => {
    if (fromCampaign || !query) return null
    return { ...query, offset: 0 }
  }, [query, fromCampaign])

  const staticItems = useMemo(() => {
    if (!fromCampaign) return []
    return mapProfileListToPreviewItems(campaignProfiles!, {
      stablePicOnly: previewStablePicOnly,
    }).slice(0, limit)
  }, [fromCampaign, campaignProfiles, limit, previewStablePicOnly])

  useEffect(() => {
    if (fromCampaign || previewQuery == null) return
    const controller = new AbortController()
    setPreviewLoading(true)
    fetchProfilesPreview(previewQuery, { signal: controller.signal, limit })
      .then((res) => {
        if (!controller.signal.aborted) setItems(res.items ?? [])
      })
      .catch(() => {
        if (!controller.signal.aborted) setItems([])
      })
      .finally(() => {
        if (!controller.signal.aborted) setPreviewLoading(false)
      })
    return () => controller.abort()
  }, [previewQuery, limit, fromCampaign])

  const displayItems = fromCampaign ? staticItems : items
  const listLoading = fromCampaign ? loading : previewLoading
  const checkoutPreviewClick =
    fromCampaign && onSelectionOverflowClick ? onSelectionOverflowClick : undefined
  const moreInSelection =
    fromCampaign &&
    selectionTotalCount != null &&
    selectionTotalCount > displayItems.length &&
    displayItems.length > 0
      ? selectionTotalCount - displayItems.length
      : 0

  const emptyWithExpectedProfiles =
    fromCampaign && !listLoading && displayItems.length === 0 && (selectionTotalCount ?? 0) > 0

  return (
    <section className={`iprv-preview${className ? ` ${className}` : ''}`}>
      {selectionTotalCount != null && !hideSelectionCountInTitle ? (
        <div className="iprv-preview-head-row">
          <Title level={4} className="iprv-preview-head-title">
            {title}
          </Title>
          <span className="iprv-preview-count-pill">
            {selectionTotalCount} perfil{selectionTotalCount !== 1 ? 's' : ''}
          </span>
        </div>
      ) : (
        <Title
          level={4}
          className={
            selectionTotalCount != null && hideSelectionCountInTitle ? 'iprv-preview-head-title' : undefined
          }
        >
          {title}
        </Title>
      )}
      {displayItems.length > 0 ? (
        <div className="iprv-cards">
          {displayItems.map((item, idx) => {
            const categoryBadge = toCamelCaseLabel(item.category || '-')
            const sizeBadge = toCamelCaseLabel(item.size || '-')
            const sizeTierOk = sizeBucketKeyToTierLabel(item.size) !== '—'
            const audienceBadges = (item.audience ?? '')
              .split('/')
              .map((x) => toCamelCaseLabel(x.trim()))
              .filter((x) => x && x !== '-')
            const cardKey = `${idx}-${item.firstName}-${item.collectedAt ?? ''}`
            const toneLabels: string[] = []
            if (!sizeTierOk && sizeBadge && sizeBadge !== '-') toneLabels.push(sizeBadge)
            if (categoryBadge && categoryBadge !== '-') toneLabels.push(categoryBadge)
            toneLabels.push(...audienceBadges)
            const toneMap = buildUniqueToneMap(toneLabels)
            const toneClass = (label: string) =>
              `iprv-badge--tone-${toneMap.get(label.trim().toLowerCase().replace(/\s+/g, ' ')) ?? 0}`
            return (
              <article
                key={cardKey}
                className={`iprv-card${checkoutPreviewClick ? ' iprv-card--checkout-clickable' : ''}`}
                {...(checkoutPreviewClick
                  ? {
                      role: 'button' as const,
                      tabIndex: 0,
                      'aria-label': 'Saiba como liberar o relatório completo',
                      onClick: () => checkoutPreviewClick(),
                      onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          checkoutPreviewClick()
                        }
                      },
                    }
                  : {})}
              >
                <div className="iprv-profile-cell">
                  <div className="iprv-avatar-wrap">
                    <ProfileAvatar
                      src={item.profilePicUrl || undefined}
                      handle={null}
                      size={avatarSize}
                      border="2px solid #ece9ff"
                      shadow="none"
                      queueOnError={false}
                    />
                  </div>
                  <div>
                    <b>{item.firstName || 'Influenciador'}</b>
                    <small>{item.llmDescription || 'Sem descrição LLM disponível.'}</small>
                    <div className="iprv-metrics" aria-label="Métricas do perfil">
                      <span title="Seguidores">
                        <strong>{formatCompact(item.followersCount ?? 0)}</strong> seg.
                      </span>
                      <span title="Taxa de engajamento">
                        <strong>{(item.engagementRate ?? 0).toFixed(1)}%</strong> ER
                      </span>
                      <span title="Curtidas (total no período analisado)">
                        <strong>{formatCompact(item.totalLikes ?? 0)}</strong> likes
                      </span>
                      <span title="Comentários (total)">
                        <strong>{formatCompact(item.totalComments ?? 0)}</strong> com.
                      </span>
                      <span title="Posts analisados">
                        <strong>{Math.round(item.postsCount ?? 0)}</strong> posts
                      </span>
                    </div>
                  </div>
                </div>
                <div className="iprv-card-meta">
                  {sizeTierOk ? (
                    <InfluencerTierPill sizeKey={item.size} variant="chip" />
                  ) : (
                    sizeBadge && sizeBadge !== '-' ? (
                      <span className={`iprv-mini-badge ${toneClass(sizeBadge)}`}>{sizeBadge}</span>
                    ) : (
                      <span className="iprv-mini-badge iprv-badge--muted">{sizeBadge}</span>
                    )
                  )}
                  <span
                    className={
                      !categoryBadge || categoryBadge === '-'
                        ? 'iprv-mini-badge iprv-badge--muted'
                        : `iprv-mini-badge ${toneClass(categoryBadge)}`
                    }
                  >
                    {categoryBadge || '-'}
                  </span>
                  <div className="iprv-mini-badges">
                    {audienceBadges.length > 0 ? (
                      audienceBadges.map((badge) => (
                        <span key={`${cardKey}-${badge}`} className={`iprv-mini-badge ${toneClass(badge)}`}>
                          {badge}
                        </span>
                      ))
                    ) : (
                      <span className="iprv-mini-badge iprv-badge--muted">-</span>
                    )}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      ) : null}
      {moreInSelection > 0 ? (
        onSelectionOverflowClick ? (
          <button
            type="button"
            className="iprv-selection-more iprv-selection-more--cta"
            onClick={onSelectionOverflowClick}
          >
            +{moreInSelection} {moreInSelection === 1 ? 'perfil' : 'perfis'} na lista completa
          </button>
        ) : (
          <div className="iprv-selection-more">
            +{moreInSelection} {moreInSelection === 1 ? 'perfil' : 'perfis'} na lista completa
          </div>
        )
      ) : null}
      {onViewMore && displayItems.length > 0 && !fromCampaign ? (
        <div className="iprv-view-more">
          <Button type="primary" block className="iprv-view-more-btn" onClick={onViewMore} loading={loading}>
            Ver mais
          </Button>
        </div>
      ) : null}
      {displayItems.length === 0 ? (
        <Text type="secondary">
          {listLoading
            ? 'Carregando preview dos influenciadores...'
            : emptyWithExpectedProfiles
              ? 'Não foi possível exibir a lista (resposta sem perfis). Atualize a página ou tente de novo em instantes.'
              : 'Sem amostra de influenciadores para exibir neste recorte.'}
        </Text>
      ) : null}
    </section>
  )
}
