/**
 * Painel BI: compilado das informações do relatório de campanha.
 * Exibido na coluna esquerda da tela de influenciadores da campanha.
 */
import { useState, useEffect } from 'react'
import { Card, Typography, Spin, Input } from 'antd'
import {
  UserOutlined,
  TeamOutlined,
  HeartOutlined,
  CommentOutlined,
  RiseOutlined,
  FileTextOutlined,
  EnvironmentOutlined,
  CheckCircleOutlined,
  MinusCircleOutlined,
} from '@ant-design/icons'
import type { ProfileListItem, ProfilesSearchFacets } from '../../api'
import { CONTENT_TYPE_LABELS } from '../../constants/contentTypes'
import './CampaignBIPanel.css'

const { Text } = Typography

function formatShortNum(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`
  return String(n)
}

function computeStats(items: ProfileListItem[] | null) {
  if (!items?.length) return { totalLikes: 0, totalComments: 0, totalViews: 0, totalFollowers: 0, postsCount: 0, avgEngagementRate: 0, count: 0 }
  let totalLikes = 0, totalComments = 0, totalViews = 0, totalFollowers = 0, postsCount = 0, engSum = 0, engCount = 0
  for (const it of items) {
    totalFollowers += it.followers_count ?? 0
    const eng = it.engagement
    if (eng) {
      totalLikes += eng.total_likes ?? 0
      totalComments += eng.total_comments ?? 0
      totalViews += eng.total_views ?? 0
      postsCount += eng.posts_count ?? 0
      if (Number.isFinite(eng.engagement_rate)) {
        engSum += eng.engagement_rate
        engCount++
      }
    }
  }
  return {
    totalLikes,
    totalComments,
    totalViews,
    totalFollowers,
    postsCount,
    avgEngagementRate: engCount > 0 ? Math.round((engSum / engCount) * 100) / 100 : 0,
    count: items.length,
  }
}

export interface CampaignBIPanelProps {
  items: ProfileListItem[]
  facets: ProfilesSearchFacets | null
  loading?: boolean
  query?: Partial<{ activationFilter?: string[]; contentTypes?: string[]; socialNetworks?: string[]; cities?: string[]; states?: string[]; costTierFilter?: string[]; sizeFilter?: string[]; accountTypeFilter?: number[] }>
  onFilter?: (overrides: { activationFilter?: string[]; contentTypes?: string[]; socialNetworks?: string[]; cities?: string[]; states?: string[]; costTierFilter?: string[]; sizeFilter?: string[]; accountTypeFilter?: number[] }) => void
  /** Descrição/anotações da campanha (salva no banco). */
  description?: string | null
  onDescriptionSave?: (value: string) => void
  /** Data de expiração do relatório (YYYY-MM-DD). */
  expiresAt?: string | null
  /** Data de criação do relatório (ISO string). */
  createdAt?: string | null
  /** Quando há pagamento pendente, a API envia stats agregados; use em vez de computeStats(items). */
  statsOverride?: { totalLikes: number; totalComments: number; totalViews: number; totalFollowers: number; postsCount: number; avgEngagementRate: number; count: number }
}

function toggleInArray(arr: string[] | undefined, value: string): string[] | undefined {
  const list = arr ?? []
  const idx = list.indexOf(value)
  if (idx >= 0) {
    const next = list.filter((_, i) => i !== idx)
    return next.length ? next : undefined
  }
  return [...list, value]
}

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  try {
    const d = new Date(iso)
    const day = String(d.getDate()).padStart(2, '0')
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const year = d.getFullYear()
    return `${day}/${month}/${year}`
  } catch { return null }
}

export default function CampaignBIPanel({ items, facets, loading = false, query, onFilter, description, onDescriptionSave, expiresAt, createdAt, statsOverride }: CampaignBIPanelProps) {
  const [descLocal, setDescLocal] = useState(description ?? '')
  useEffect(() => { setDescLocal(description ?? '') }, [description])
  const stats = statsOverride ?? computeStats(items)
  const activation = facets?.activation
  const activatedCount = activation?.activated ?? 0
  const notActivatedCount = activation?.not_activated ?? 0
  const social = facets?.social
  const cities = facets?.cities ?? []
  const states = facets?.states ?? []
  const contentTypes = facets?.content_type ?? []
  const selectedActivation = (query?.activationFilter ?? []) as string[]
  const selectedContent = (query?.contentTypes ?? []) as string[]
  const selectedSocial = (query?.socialNetworks ?? []) as string[]
  const selectedCities = (query?.cities ?? []) as string[]
  const selectedStates = (query?.states ?? []) as string[]
  const selectedCostTier = (query?.costTierFilter ?? []) as string[]
  const selectedSize = (query?.sizeFilter ?? []) as string[]
  const selectedAccountType = (query?.accountTypeFilter ?? []) as number[]
  const costTiers = facets?.cost_tier ?? []
  const sizeBuckets = facets?.size_buckets ?? []
  const accountTypes = facets?.account_type ?? []

  const handleSize = (key: string) => {
    if (!onFilter) return
    const next = selectedSize.includes(key) ? selectedSize.filter((s) => s !== key) : [...selectedSize, key]
    onFilter({ sizeFilter: next.length ? next : undefined })
  }
  const handleAccountType = (value: number) => {
    if (!onFilter) return
    const next = selectedAccountType.includes(value) ? selectedAccountType.filter((v) => v !== value) : [...selectedAccountType, value]
    onFilter({ accountTypeFilter: next.length ? next : undefined })
  }

  const handleCostTier = (val: 'low' | 'medium' | 'above') => {
    if (!onFilter) return
    const current = selectedCostTier
    const isLow = current.includes('low')
    const isMedium = current.includes('medium')
    const isAbove = current.some((t) => t === 'high' || t === 'very_high')
    const next =
      val === 'low' ? (isLow ? undefined : ['low'])
        : val === 'medium' ? (isMedium ? undefined : ['medium'])
          : (isAbove ? undefined : ['high', 'very_high'])
    onFilter({ costTierFilter: next })
  }

  const handleActivation = (val: 'activated' | 'not_activated') => {
    if (!onFilter) return
    onFilter({ activationFilter: toggleInArray(selectedActivation, val) })
  }
  const handleContentType = (name: string) => {
    if (!onFilter) return
    onFilter({ contentTypes: toggleInArray(selectedContent, name) })
  }
  const handleSocial = (net: string) => {
    if (!onFilter) return
    onFilter({ socialNetworks: toggleInArray(selectedSocial, net) })
  }
  const handleCity = (name: string) => {
    if (!onFilter) return
    onFilter({ cities: toggleInArray(selectedCities, name) })
  }
  const handleState = (name: string) => {
    if (!onFilter) return
    onFilter({ states: toggleInArray(selectedStates, name) })
  }

  const totalProfiles = stats.count

  return (
    <div className="campaign-bi-panel">
      <div className={loading ? 'campaign-bi-panel-loading-wrap' : ''}>
        {loading && (
          <div className="campaign-bi-panel-loading-indicator" aria-hidden>
            <Spin size="small" />
          </div>
        )}
      <Card size="small" className="campaign-bi-card" title="&nbsp;&nbsp;Resumo do relatório">
        {onDescriptionSave && (
          <div className="campaign-bi-description">
            <Input.TextArea
              placeholder="Descrição / anotações"
              value={descLocal}
              onChange={(e) => setDescLocal(e.target.value)}
              onBlur={() => onDescriptionSave(descLocal)}
              autoSize={{ minRows: 4, maxRows: 8 }}
              className="campaign-bi-description-input"
            />
          </div>
        )}

        <div className="campaign-bi-stats">
          <div className="campaign-bi-stat">
            <UserOutlined className="campaign-bi-stat-icon" />
            <div>
              <Text strong className="campaign-bi-stat-value">{formatShortNum(totalProfiles)}</Text>
              <Text type="secondary" className="campaign-bi-stat-label">perfis</Text>
            </div>
          </div>
          <div className="campaign-bi-stat">
            <TeamOutlined className="campaign-bi-stat-icon" />
            <div>
              <Text strong className="campaign-bi-stat-value">{formatShortNum(stats.totalFollowers)}</Text>
              <Text type="secondary" className="campaign-bi-stat-label">seg.</Text>
            </div>
          </div>
          <div className="campaign-bi-stat">
            <HeartOutlined className="campaign-bi-stat-icon" />
            <div>
              <Text strong className="campaign-bi-stat-value">{formatShortNum(stats.totalLikes)}</Text>
              <Text type="secondary" className="campaign-bi-stat-label">likes</Text>
            </div>
          </div>
          <div className="campaign-bi-stat">
            <CommentOutlined className="campaign-bi-stat-icon" />
            <div>
              <Text strong className="campaign-bi-stat-value">{formatShortNum(stats.totalComments)}</Text>
              <Text type="secondary" className="campaign-bi-stat-label">com.</Text>
            </div>
          </div>
          <div className="campaign-bi-stat">
            <FileTextOutlined className="campaign-bi-stat-icon" />
            <div>
              <Text strong className="campaign-bi-stat-value">{formatShortNum(stats.postsCount)}</Text>
              <Text type="secondary" className="campaign-bi-stat-label">posts</Text>
            </div>
          </div>
          <div className="campaign-bi-stat">
            <RiseOutlined className="campaign-bi-stat-icon" />
            <div>
              <Text strong className="campaign-bi-stat-value">{stats.avgEngagementRate.toFixed(2)}%</Text>
              <Text type="secondary" className="campaign-bi-stat-label">eng.</Text>
            </div>
          </div>
        </div>
        {(formatDate(createdAt) || formatDate(expiresAt)) && (
          <div style={{ flexWrap: 'nowrap', textAlign: 'center', gap: 2, marginBottom: -2, marginTop: -2, fontSize: 10, color: 'var(--app-text-tertiary)', opacity: 0.8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {formatDate(createdAt) && <span>Criação {formatDate(createdAt)}</span>}
            {formatDate(createdAt) && formatDate(expiresAt) && <span>·</span>}
            {formatDate(expiresAt) && <span>Término {formatDate(expiresAt)}</span>}
          </div>
        )}
        {sizeBuckets.length > 0 && onFilter && (
          <div className="campaign-bi-section">
            <Text strong className="campaign-bi-section-title">Tamanho</Text>
            <div className="campaign-bi-price">
              {sizeBuckets.map(({ key, label, count }) => {
                const selected = selectedSize.includes(key)
                const colors: Record<string, string> = { nano: '#722ed1', micro: '#1890ff', mid: '#13c2c2', macro: '#eb2f96' }
                return (
                  <span
                    key={key}
                    className={`campaign-bi-clickable ${selected ? 'campaign-bi-selected' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSize(key)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSize(key)}
                    style={{ color: colors[key] ?? undefined }}
                  >
                    <Text type="secondary">{label}</Text> <strong>{count}</strong>
                  </span>
                )
              })}
            </div>
          </div>
        )}

        {accountTypes.length > 0 && onFilter && (
          <div className="campaign-bi-section">
            <Text strong className="campaign-bi-section-title">Tipo de conta</Text>
            <div className="campaign-bi-price">
              {accountTypes.map(({ value, label, count }) => {
                const selected = selectedAccountType.includes(value)
                const colors: Record<number, string> = { 1: '#8c8c8c', 2: '#1890ff', 3: '#722ed1' }
                return (
                  <span
                    key={value}
                    className={`campaign-bi-clickable ${selected ? 'campaign-bi-selected' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleAccountType(value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAccountType(value)}
                    style={{ color: colors[value] ?? undefined }}
                  >
                    <Text type="secondary">{label}</Text> <strong>{count}</strong>
                  </span>
                )
              })}
            </div>
          </div>
        )}

        {(activatedCount > 0 || notActivatedCount > 0) && onFilter && (
          <div className="campaign-bi-section">
            <Text strong className="campaign-bi-section-title">Ativação</Text>
            <div className="campaign-bi-activation">
              {activatedCount > 0 && (
                <span
                  className={`campaign-bi-activation-item campaign-bi-clickable ${selectedActivation.includes('activated') ? 'campaign-bi-selected' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleActivation('activated')}
                  onKeyDown={(e) => e.key === 'Enter' && handleActivation('activated')}
                >
                  <CheckCircleOutlined style={{ color: 'var(--app-success)', marginRight: 3, fontSize: 10 }} />
                  <Text>Ativados: <strong>{activatedCount}</strong></Text>
                </span>
              )}
              {notActivatedCount > 0 && (
                <span
                  className={`campaign-bi-activation-item campaign-bi-clickable ${selectedActivation.includes('not_activated') ? 'campaign-bi-selected' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleActivation('not_activated')}
                  onKeyDown={(e) => e.key === 'Enter' && handleActivation('not_activated')}
                >
                  <MinusCircleOutlined style={{ color: 'var(--app-text-tertiary)', marginRight: 3, fontSize: 10 }} />
                  <Text>Não ativados: <strong>{notActivatedCount}</strong></Text>
                </span>
              )}
            </div>
          </div>
        )}

        {costTiers.length > 0 && onFilter && (() => {
          const low = costTiers.find((c) => c.tier === 'low')
          const medium = costTiers.find((c) => c.tier === 'medium')
          const aboveCount = costTiers.filter((c) => c.tier === 'high' || c.tier === 'very_high').reduce((s, c) => s + (c.count ?? 0), 0)
          const priceItems: { val: 'low' | 'medium' | 'above'; label: string; count: number }[] = []
          if (low && low.count > 0) priceItems.push({ val: 'low', label: 'Baixo', count: low.count })
          if (medium && medium.count > 0) priceItems.push({ val: 'medium', label: 'Normal', count: medium.count })
          if (aboveCount > 0) priceItems.push({ val: 'above', label: 'Acima', count: aboveCount })
          if (priceItems.length === 0) return null
          return (
            <div className="campaign-bi-section">
              <Text strong className="campaign-bi-section-title">Preço</Text>
              <div className="campaign-bi-price">
                {priceItems.map(({ val, label, count }) => {
                  const selected = val === 'low' ? selectedCostTier.includes('low') : val === 'medium' ? selectedCostTier.includes('medium') : selectedCostTier.some((t) => t === 'high' || t === 'very_high')
                  return (
                    <span
                      key={val}
                      className={`campaign-bi-clickable ${selected ? 'campaign-bi-selected' : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleCostTier(val)}
                      onKeyDown={(e) => e.key === 'Enter' && handleCostTier(val)}
                    >
                      <Text type="secondary">{label}</Text> <strong>{count}</strong>
                    </span>
                  )
                })}
              </div>
            </div>
          )
        })()}

        {social && (social.whatsapp > 0 || social.tiktok > 0 || social.facebook > 0 || social.linkedin > 0 || social.twitter > 0) && onFilter && (
          <div className="campaign-bi-section">
            <Text strong className="campaign-bi-section-title">Redes sociais</Text>
            <div className="campaign-bi-social">
              {social.whatsapp > 0 && (
                <span className={`campaign-bi-clickable ${selectedSocial.includes('whatsapp') ? 'campaign-bi-selected' : ''}`} role="button" tabIndex={0} onClick={() => handleSocial('whatsapp')} onKeyDown={(e) => e.key === 'Enter' && handleSocial('whatsapp')}>
                  <Text type="secondary">WhatsApp</Text> <strong>{social.whatsapp}</strong>
                </span>
              )}
              {social.tiktok > 0 && (
                <span className={`campaign-bi-clickable ${selectedSocial.includes('tiktok') ? 'campaign-bi-selected' : ''}`} role="button" tabIndex={0} onClick={() => handleSocial('tiktok')} onKeyDown={(e) => e.key === 'Enter' && handleSocial('tiktok')}>
                  <Text type="secondary">TikTok</Text> <strong>{social.tiktok}</strong>
                </span>
              )}
              {social.facebook > 0 && (
                <span className={`campaign-bi-clickable ${selectedSocial.includes('facebook') ? 'campaign-bi-selected' : ''}`} role="button" tabIndex={0} onClick={() => handleSocial('facebook')} onKeyDown={(e) => e.key === 'Enter' && handleSocial('facebook')}>
                  <Text type="secondary">Facebook</Text> <strong>{social.facebook}</strong>
                </span>
              )}
              {social.linkedin > 0 && (
                <span className={`campaign-bi-clickable ${selectedSocial.includes('linkedin') ? 'campaign-bi-selected' : ''}`} role="button" tabIndex={0} onClick={() => handleSocial('linkedin')} onKeyDown={(e) => e.key === 'Enter' && handleSocial('linkedin')}>
                  <Text type="secondary">LinkedIn</Text> <strong>{social.linkedin}</strong>
                </span>
              )}
              {social.twitter > 0 && (
                <span className={`campaign-bi-clickable ${selectedSocial.includes('twitter') ? 'campaign-bi-selected' : ''}`} role="button" tabIndex={0} onClick={() => handleSocial('twitter')} onKeyDown={(e) => e.key === 'Enter' && handleSocial('twitter')}>
                  <Text type="secondary">X/Twitter</Text> <strong>{social.twitter}</strong>
                </span>
              )}
            </div>
          </div>
        )}

        {contentTypes.filter((c) => (c.count ?? 0) > 0).length > 0 && onFilter && (
          <div className="campaign-bi-section">
            <Text strong className="campaign-bi-section-title">Tipo de conteúdo</Text>
            <div className="campaign-bi-content">
              {contentTypes
                .filter((c) => (c.count ?? 0) > 0)
                .slice(0, 6)
                .map((c) => (
                  <span
                    key={c.name}
                    className={`campaign-bi-clickable ${selectedContent.includes(c.name) ? 'campaign-bi-selected' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleContentType(c.name)}
                    onKeyDown={(e) => e.key === 'Enter' && handleContentType(c.name)}
                  >
                    <Text type="secondary">{CONTENT_TYPE_LABELS[c.name] ?? c.name}</Text> <strong>{c.count}</strong>
                  </span>
                ))}
            </div>
          </div>
        )}

        {(cities.length > 0 || states.length > 0) && onFilter && (
          <div className="campaign-bi-section">
            <Text strong className="campaign-bi-section-title">
              <EnvironmentOutlined style={{ marginRight: 4 }} /> Localização
            </Text>
            <div className="campaign-bi-location">
              {states.slice(0, 5).map((s) => (
                <span
                  key={`st-${s.name}`}
                  className={`campaign-bi-clickable ${selectedStates.includes(s.name) ? 'campaign-bi-selected' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleState(s.name)}
                  onKeyDown={(e) => e.key === 'Enter' && handleState(s.name)}
                >
                  <Text type="secondary">{s.name}</Text> <strong>{s.count}</strong>
                </span>
              ))}
              {cities.slice(0, 5).map((c) => (
                <span
                  key={`ci-${c.name}`}
                  className={`campaign-bi-clickable ${selectedCities.includes(c.name) ? 'campaign-bi-selected' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleCity(c.name)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCity(c.name)}
                >
                  <Text type="secondary">{c.name}</Text> <strong>{c.count}</strong>
                </span>
              ))}
            </div>
          </div>
        )}
      </Card>
      </div>
    </div>
  )
}
