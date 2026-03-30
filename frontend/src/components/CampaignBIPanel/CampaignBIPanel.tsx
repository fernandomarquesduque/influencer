/**
 * Painel BI: compilado das informações do relatório de campanha.
 * Exibido na coluna esquerda da tela de influenciadores da campanha.
 */
import { useState, useEffect } from 'react'
import { Card, Typography, Input } from 'antd'
import {
  UserOutlined,
  TeamOutlined,
  HeartOutlined,
  CommentOutlined,
  RiseOutlined,
  FileTextOutlined,
  EnvironmentOutlined,
  FilterOutlined,
} from '@ant-design/icons'
import type { ProfileListItem, ProfilesSearchFacets, ProfilesSearchQuery, MediaKind } from '../../api'
import { CONTENT_TYPE_LABELS } from '../../constants/contentTypes'
import { getInfluencerTierSolidHexForBucketKey } from '../../utils/influencerTier'
import './CampaignBIPanel.css'

const { Text } = Typography

const ORIGIN_MEDIA_KIND_ORDER: MediaKind[] = ['post', 'reel', 'tagged', 'highlight']
const ORIGIN_MEDIA_KIND_LABELS: Record<MediaKind, string> = {
  post: 'Feed',
  reel: 'Reels',
  tagged: 'Marcados',
  highlight: 'Destaques',
}
const ORIGIN_MEDIA_KIND_COLORS: Record<MediaKind, string> = {
  post: '#2563eb',
  reel: '#7c3aed',
  tagged: '#db2777',
  highlight: '#0284c7',
}

function formatShortNum(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`
  return String(n)
}

/** Rótulo legível para chips de facet LLM (chaves em minúsculas). */
function formatLlmFacetLabel(raw: string): string {
  const s = raw.replace(/[_-]+/g, ' ').trim()
  if (!s) return raw
  return s
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function llmPillColor(seed: string): string {
  let h = 0
  const key = seed.trim().toLowerCase()
  for (let i = 0; i < key.length; i++) h = (Math.imul(31, h) + key.charCodeAt(i)) | 0
  const hue = Math.abs(h) % 360
  return `hsl(${hue}, 42%, 40%)`
}

type LlmArrayFilterKey =
  | 'llmProfileType'
  | 'llmMainCategory'
  | 'llmGender'
  | 'llmSubCategories'
  | 'llmContentPillars'
  | 'llmAudienceType'

type LlmNameCountRow = { name: string; count: number }

/** Sem itens com contagem zero na lista. */
function filterPositiveLlmCounts(items: LlmNameCountRow[]): LlmNameCountRow[] {
  return items.filter((x) => (x.count ?? 0) > 0)
}

/**
 * Só exibe a seção se houver 2+ opções com contagem > 0, ou 1 opção que esteja selecionada
 * (para o usuário poder ver e limpar o filtro ativo).
 */
function showLlmFacetMulti(items: LlmNameCountRow[], selected: string[], isSelected: (sel: string[], name: string) => boolean): boolean {
  const pos = filterPositiveLlmCounts(items)
  if (pos.length > 1) return true
  if (pos.length === 1) return isSelected(selected, pos[0]!.name)
  return false
}

function filterPositiveFacetCounts<T extends { count?: number }>(items: T[]): T[] {
  return items.filter((x) => (x.count ?? 0) > 0)
}

function showFacetMulti<T extends { count?: number }>(items: T[], isItemSelected: (item: T) => boolean): boolean {
  const pos = filterPositiveFacetCounts(items)
  if (pos.length > 1) return true
  if (pos.length === 1) return isItemSelected(pos[0]!)
  return false
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
  query?: Partial<ProfilesSearchQuery>
  onFilter?: (overrides: Partial<ProfilesSearchQuery>) => void
  /** Contagens por tipo de mídia (post-matches), para filtros da galeria Origem. */
  originMediaKindCounts?: Partial<Record<MediaKind, number>> | null
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

function toggleMediaKindInArray(arr: MediaKind[] | undefined, value: MediaKind): MediaKind[] | undefined {
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

export default function CampaignBIPanel({
  items,
  facets,
  query,
  onFilter,
  description,
  onDescriptionSave,
  expiresAt,
  createdAt,
  statsOverride,
  originMediaKindCounts,
}: CampaignBIPanelProps) {
  const [descLocal, setDescLocal] = useState(description ?? '')
  useEffect(() => { setDescLocal(description ?? '') }, [description])
  const stats = statsOverride ?? computeStats(items)
  const social = facets?.social
  const cities = facets?.cities ?? []
  const states = facets?.states ?? []
  const contentTypes = facets?.content_type ?? []
  const selectedContent = (query?.contentTypes ?? []) as string[]
  const selectedSocial = (query?.socialNetworks ?? []) as string[]
  const selectedCities = (query?.cities ?? []) as string[]
  const selectedStates = (query?.states ?? []) as string[]
  const selectedSize = (query?.sizeFilter ?? []) as string[]
  const selectedOriginMediaKinds = (query?.originMediaKinds ?? []) as MediaKind[]
  const sizeBuckets = facets?.size_buckets ?? []

  const handleSize = (key: string) => {
    if (!onFilter) return
    const next = selectedSize.includes(key) ? selectedSize.filter((s) => s !== key) : [...selectedSize, key]
    onFilter({ sizeFilter: next.length ? next : undefined })
  }

  const handleContentType = (name: string) => {
    if (!onFilter) return
    onFilter({ contentTypes: toggleInArray(selectedContent, name) })
  }
  const handleOriginMediaKind = (kind: MediaKind) => {
    if (!onFilter) return
    onFilter({ originMediaKinds: toggleMediaKindInArray(selectedOriginMediaKinds, kind) })
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

  const llm = facets?.llm
  const selectedLlmProfileType = (query?.llmProfileType ?? []) as string[]
  const selectedLlmMainCategory = (query?.llmMainCategory ?? []) as string[]
  const selectedLlmGender = (query?.llmGender ?? []) as string[]
  const selectedLlmSubCategories = (query?.llmSubCategories ?? []) as string[]
  const selectedLlmContentPillars = (query?.llmContentPillars ?? []) as string[]
  const selectedLlmAudienceType = (query?.llmAudienceType ?? []) as string[]

  const llmArraySelected = (selected: string[], facetName: string): boolean => {
    const n = facetName.trim().toLowerCase()
    return selected.some((x) => String(x).trim().toLowerCase() === n)
  }

  const showLlmMainCategorySection = !!(
    llm && showLlmFacetMulti(llm.mainCategory, selectedLlmMainCategory, llmArraySelected)
  )
  const showLlmSubCategoriesSection = !!(
    llm && showLlmFacetMulti(llm.subCategories, selectedLlmSubCategories, llmArraySelected)
  )

  const handleLlmArrayToggle = (key: LlmArrayFilterKey, facetName: string) => {
    if (!onFilter) return
    const cur = ((query?.[key] as string[] | undefined) ?? []) as string[]
    const n = facetName.trim().toLowerCase()
    const has = cur.some((x) => String(x).trim().toLowerCase() === n)
    const next = has ? cur.filter((x) => String(x).trim().toLowerCase() !== n) : [...cur, facetName]
    onFilter({ [key]: next.length ? next : undefined } as Partial<ProfilesSearchQuery>)
  }

  const totalProfiles = stats.count

  return (
    <div className="campaign-bi-panel">
      <div className="campaign-bi-stats campaign-bi-stats-above">
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
      {onDescriptionSave && (
        <div className="campaign-bi-description campaign-bi-description-above">
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
      <Card
        size="small"
        className="campaign-bi-card"
        title={
          <span className="campaign-bi-card-title-row">
            <FilterOutlined className="campaign-bi-card-title-icon" aria-hidden />
            Filtrar relatório
          </span>
        }
      >
        {onFilter &&
          originMediaKindCounts &&
          (() => {
            const originKindsPos = ORIGIN_MEDIA_KIND_ORDER.filter((k) => (originMediaKindCounts[k] ?? 0) > 0)
            const showOriginKinds =
              originKindsPos.length > 1 ||
              (originKindsPos.length === 1 && selectedOriginMediaKinds.includes(originKindsPos[0]!))
            return showOriginKinds ? (
              <div className="campaign-bi-section">
                <Text strong className="campaign-bi-section-title">Tipo de post</Text>
                <div className="campaign-bi-price">
                  {originKindsPos.map((kind) => {
                    const count = originMediaKindCounts[kind] ?? 0
                    const selected = selectedOriginMediaKinds.includes(kind)
                    return (
                      <span
                        key={kind}
                        className={`campaign-bi-clickable ${selected ? 'campaign-bi-selected' : ''}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleOriginMediaKind(kind)}
                        onKeyDown={(e) => e.key === 'Enter' && handleOriginMediaKind(kind)}
                        style={{ color: ORIGIN_MEDIA_KIND_COLORS[kind] }}
                      >
                        <Text type="secondary">{ORIGIN_MEDIA_KIND_LABELS[kind]}</Text> <strong>{count}</strong>
                      </span>
                    )
                  })}
                </div>
              </div>
            ) : null
          })()}

        {onFilter && showFacetMulti(sizeBuckets, (b) => selectedSize.includes(b.key)) && (
          <div className="campaign-bi-section">
            <Text strong className="campaign-bi-section-title">Tamanho</Text>
            <div className="campaign-bi-price">
              {filterPositiveFacetCounts(sizeBuckets).map(({ key, label, count }) => {
                const selected = selectedSize.includes(key)
                return (
                  <span
                    key={key}
                    className={`campaign-bi-clickable ${selected ? 'campaign-bi-selected' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSize(key)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSize(key)}
                    style={{ color: getInfluencerTierSolidHexForBucketKey(key) }}
                  >
                    <Text type="secondary">{label}</Text> <strong>{count}</strong>
                  </span>
                )
              })}
            </div>
          </div>
        )}

        {social &&
          onFilter &&
          (() => {
            const nets: { net: string; label: string; count: number }[] = []
            if ((social.whatsapp ?? 0) > 0) nets.push({ net: 'whatsapp', label: 'WhatsApp', count: social.whatsapp })
            if ((social.tiktok ?? 0) > 0) nets.push({ net: 'tiktok', label: 'TikTok', count: social.tiktok })
            if ((social.facebook ?? 0) > 0) nets.push({ net: 'facebook', label: 'Facebook', count: social.facebook })
            if ((social.linkedin ?? 0) > 0) nets.push({ net: 'linkedin', label: 'LinkedIn', count: social.linkedin })
            if ((social.twitter ?? 0) > 0) nets.push({ net: 'twitter', label: 'X/Twitter', count: social.twitter })
            const showNets =
              nets.length > 1 || (nets.length === 1 && selectedSocial.includes(nets[0]!.net))
            return showNets ? (
              <div className="campaign-bi-section">
                <Text strong className="campaign-bi-section-title">Redes sociais</Text>
                <div className="campaign-bi-social">
                  {nets.map(({ net, label, count }) => (
                    <span
                      key={net}
                      className={`campaign-bi-clickable ${selectedSocial.includes(net) ? 'campaign-bi-selected' : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleSocial(net)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSocial(net)}
                    >
                      <Text type="secondary">{label}</Text> <strong>{count}</strong>
                    </span>
                  ))}
                </div>
              </div>
            ) : null
          })()}

        {onFilter && showFacetMulti(contentTypes, (c) => selectedContent.includes(c.name)) && (
          <div className="campaign-bi-section">
            <Text strong className="campaign-bi-section-title">Tipo de conteúdo</Text>
            <div className="campaign-bi-content">
              {filterPositiveFacetCounts(contentTypes)
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

        {onFilter && llm && (
          <>
            {showLlmFacetMulti(llm.profileType, selectedLlmProfileType, llmArraySelected) && (
              <div className="campaign-bi-section">
                <Text strong className="campaign-bi-section-title">Tipo de perfil</Text>
                <div className="campaign-bi-content">
                  {filterPositiveLlmCounts(llm.profileType).map(({ name, count }) => (
                    <span
                      key={name}
                      className={`campaign-bi-clickable ${llmArraySelected(selectedLlmProfileType, name) ? 'campaign-bi-selected' : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleLlmArrayToggle('llmProfileType', name)}
                      onKeyDown={(e) => e.key === 'Enter' && handleLlmArrayToggle('llmProfileType', name)}
                      style={{ color: llmPillColor(name) }}
                    >
                      <Text type="secondary">{formatLlmFacetLabel(name)}</Text> <strong>{count}</strong>
                    </span>
                  ))}
                </div>
              </div>
            )}
            {showLlmMainCategorySection && showLlmSubCategoriesSection && (
              <div className="campaign-bi-section campaign-bi-category-sub-pair">
                <div className="campaign-bi-category-sub-pair-grid">
                  <div className="campaign-bi-category-sub-col">
                    <Text strong className="campaign-bi-section-title">Categoria principal</Text>
                    <div className="campaign-bi-content">
                      {filterPositiveLlmCounts(llm.mainCategory).map(({ name, count }) => (
                        <span
                          key={name}
                          className={`campaign-bi-clickable ${llmArraySelected(selectedLlmMainCategory, name) ? 'campaign-bi-selected' : ''}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => handleLlmArrayToggle('llmMainCategory', name)}
                          onKeyDown={(e) => e.key === 'Enter' && handleLlmArrayToggle('llmMainCategory', name)}
                          style={{ color: llmPillColor(`cat-${name}`) }}
                        >
                          <Text type="secondary">{formatLlmFacetLabel(name)}</Text> <strong>{count}</strong>
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="campaign-bi-category-sub-col">
                    <Text strong className="campaign-bi-section-title">Subcategorias</Text>
                    <div className="campaign-bi-content">
                      {filterPositiveLlmCounts(llm.subCategories).map(({ name, count }) => (
                        <span
                          key={name}
                          className={`campaign-bi-clickable ${llmArraySelected(selectedLlmSubCategories, name) ? 'campaign-bi-selected' : ''}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => handleLlmArrayToggle('llmSubCategories', name)}
                          onKeyDown={(e) => e.key === 'Enter' && handleLlmArrayToggle('llmSubCategories', name)}
                          style={{ color: llmPillColor(`sub-${name}`) }}
                        >
                          <Text type="secondary">{formatLlmFacetLabel(name)}</Text> <strong>{count}</strong>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
            {showLlmMainCategorySection && !showLlmSubCategoriesSection && (
              <div className="campaign-bi-section">
                <Text strong className="campaign-bi-section-title">Categoria principal</Text>
                <div className="campaign-bi-content">
                  {filterPositiveLlmCounts(llm.mainCategory).map(({ name, count }) => (
                    <span
                      key={name}
                      className={`campaign-bi-clickable ${llmArraySelected(selectedLlmMainCategory, name) ? 'campaign-bi-selected' : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleLlmArrayToggle('llmMainCategory', name)}
                      onKeyDown={(e) => e.key === 'Enter' && handleLlmArrayToggle('llmMainCategory', name)}
                      style={{ color: llmPillColor(`cat-${name}`) }}
                    >
                      <Text type="secondary">{formatLlmFacetLabel(name)}</Text> <strong>{count}</strong>
                    </span>
                  ))}
                </div>
              </div>
            )}
            {showLlmFacetMulti(llm.gender, selectedLlmGender, llmArraySelected) && (
              <div className="campaign-bi-section">
                <Text strong className="campaign-bi-section-title">Gênero do Influencer</Text>
                <div className="campaign-bi-price">
                  {filterPositiveLlmCounts(llm.gender).map(({ name, count }) => (
                    <span
                      key={name}
                      className={`campaign-bi-clickable ${llmArraySelected(selectedLlmGender, name) ? 'campaign-bi-selected' : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleLlmArrayToggle('llmGender', name)}
                      onKeyDown={(e) => e.key === 'Enter' && handleLlmArrayToggle('llmGender', name)}
                      style={{ color: llmPillColor(`g-${name}`) }}
                    >
                      <Text type="secondary">{formatLlmFacetLabel(name)}</Text> <strong>{count}</strong>
                    </span>
                  ))}
                </div>
              </div>
            )}
            {!showLlmMainCategorySection && showLlmSubCategoriesSection && (
              <div className="campaign-bi-section">
                <Text strong className="campaign-bi-section-title">Subcategorias</Text>
                <div className="campaign-bi-content">
                  {filterPositiveLlmCounts(llm.subCategories).map(({ name, count }) => (
                    <span
                      key={name}
                      className={`campaign-bi-clickable ${llmArraySelected(selectedLlmSubCategories, name) ? 'campaign-bi-selected' : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleLlmArrayToggle('llmSubCategories', name)}
                      onKeyDown={(e) => e.key === 'Enter' && handleLlmArrayToggle('llmSubCategories', name)}
                      style={{ color: llmPillColor(`sub-${name}`) }}
                    >
                      <Text type="secondary">{formatLlmFacetLabel(name)}</Text> <strong>{count}</strong>
                    </span>
                  ))}
                </div>
              </div>
            )}
            {showLlmFacetMulti(llm.contentPillars, selectedLlmContentPillars, llmArraySelected) && (
              <div className="campaign-bi-section">
                <Text strong className="campaign-bi-section-title">Pilares de conteúdo</Text>
                <div className="campaign-bi-content">
                  {filterPositiveLlmCounts(llm.contentPillars).map(({ name, count }) => (
                    <span
                      key={name}
                      className={`campaign-bi-clickable ${llmArraySelected(selectedLlmContentPillars, name) ? 'campaign-bi-selected' : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleLlmArrayToggle('llmContentPillars', name)}
                      onKeyDown={(e) => e.key === 'Enter' && handleLlmArrayToggle('llmContentPillars', name)}
                      style={{ color: llmPillColor(`pillar-${name}`) }}
                    >
                      <Text type="secondary">{formatLlmFacetLabel(name)}</Text> <strong>{count}</strong>
                    </span>
                  ))}
                </div>
              </div>
            )}
            {showLlmFacetMulti(llm.audienceType, selectedLlmAudienceType, llmArraySelected) && (
              <div className="campaign-bi-section">
                <Text strong className="campaign-bi-section-title">Público-alvo</Text>
                <div className="campaign-bi-content">
                  {filterPositiveLlmCounts(llm.audienceType).map(({ name, count }) => (
                    <span
                      key={name}
                      className={`campaign-bi-clickable ${llmArraySelected(selectedLlmAudienceType, name) ? 'campaign-bi-selected' : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleLlmArrayToggle('llmAudienceType', name)}
                      onKeyDown={(e) => e.key === 'Enter' && handleLlmArrayToggle('llmAudienceType', name)}
                      style={{ color: llmPillColor(`aud-${name}`) }}
                    >
                      <Text type="secondary">{formatLlmFacetLabel(name)}</Text> <strong>{count}</strong>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {onFilter &&
          (() => {
            const st = filterPositiveFacetCounts(states)
            const ci = filterPositiveFacetCounts(cities)
            const locTotal = st.length + ci.length
            const showLoc =
              locTotal > 1 ||
              (locTotal === 1 &&
                (st.length === 1 ? selectedStates.includes(st[0]!.name) : selectedCities.includes(ci[0]!.name)))
            return showLoc ? (
              <div className="campaign-bi-section">
                <Text strong className="campaign-bi-section-title">
                  <EnvironmentOutlined style={{ marginRight: 4 }} /> Localização
                </Text>
                <div className="campaign-bi-location">
                  {st.slice(0, 5).map((s) => (
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
                  {ci.slice(0, 5).map((c) => (
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
            ) : null
          })()}
      </Card>
      {(formatDate(createdAt) || formatDate(expiresAt)) && (
        <div className="campaign-bi-report-dates">
          {formatDate(createdAt) && <span>Criação {formatDate(createdAt)}</span>}
          {formatDate(createdAt) && formatDate(expiresAt) && <span className="campaign-bi-report-dates-sep">·</span>}
          {formatDate(expiresAt) && <span>Término {formatDate(expiresAt)}</span>}
        </div>
      )}
    </div>
  )
}
