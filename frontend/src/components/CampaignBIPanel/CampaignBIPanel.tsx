/**
 * Painel BI: compilado das informações do relatório de campanha.
 * Exibido na coluna esquerda da tela de influenciadores da campanha.
 */
import { useState, useEffect, useMemo } from 'react'
import { FOLLOWERS_SIZE_BUCKETS } from '@repo/followersSizeBuckets'
import { Card, Typography, Input } from 'antd'
import { EnvironmentOutlined, FilterOutlined } from '@ant-design/icons'
import type { ProfilesSearchFacets, ProfilesSearchQuery } from '../../api'
import { buildSingleCampaignFacetBoostPatch, facetBucketFilterMin } from '../../utils/campaignFilterClient'
import { formatFacetLabel } from '../../utils/facetLabels'
import { CONTENT_TYPE_LABELS } from '../../constants/contentTypes'
import { getInfluencerTierSolidHexForBucketKey } from '../../utils/influencerTier'
import './CampaignBIPanel.css'

const { Text } = Typography

function llmPillColor(seed: string): string {
  let h = 0
  const key = seed.trim().toLowerCase()
  for (let i = 0; i < key.length; i++) h = (Math.imul(31, h) + key.charCodeAt(i)) | 0
  const hue = Math.abs(h) % 360
  return `hsl(${hue}, 42%, 40%)`
}

type LlmArrayFilterKey = 'llmMainCategory' | 'llmGender' | 'llmAudienceType'

type LlmNameCountRow = { name: string; count: number }

function filterNamedFacetRows(items: LlmNameCountRow[]): LlmNameCountRow[] {
  return items.filter((x) => String(x.name ?? '').trim().length > 0 && (x.count ?? 0) > 0)
}

function showNamedFacetList(items: LlmNameCountRow[]): boolean {
  return filterNamedFacetRows(items).length > 0
}

export interface CampaignBIPanelProps {
  facets: ProfilesSearchFacets | null
  query?: Partial<ProfilesSearchQuery>
  onFilter?: (overrides: Partial<ProfilesSearchQuery>) => void
  /** Descrição/anotações da campanha (salva no banco). */
  description?: string | null
  onDescriptionSave?: (value: string) => void
}

export default function CampaignBIPanel({
  facets,
  query,
  onFilter,
  description,
  onDescriptionSave,
}: CampaignBIPanelProps) {
  const [descLocal, setDescLocal] = useState(description ?? '')
  useEffect(() => { setDescLocal(description ?? '') }, [description])
  const social = facets?.social
  const cities = facets?.cities ?? []
  const states = facets?.states ?? []
  const contentTypes = facets?.content_type ?? []
  const selectedContent = (query?.contentTypes ?? []) as string[]
  const selectedSocial = (query?.socialNetworks ?? []) as string[]
  const selectedCities = (query?.cities ?? []) as string[]
  const selectedStates = (query?.states ?? []) as string[]
  const selectedSize = (query?.sizeFilter ?? []) as string[]
  const selectedEngagement = (query?.engagementRateBuckets ?? []) as number[]
  const selectedAvgLikes = (query?.avgLikesBuckets ?? []) as number[]
  const engagementBuckets = facets?.engagement_rate ?? []
  const avgLikesFacetBuckets = facets?.avg_likes ?? []
  const sizeBucketsFromFacets =
    facets?.size_buckets ??
    facets?.followers_buckets?.map((b) => ({
      key: b.key === 'medio' ? 'mid' : b.key,
      label: b.label,
      count: b.count,
    })) ??
    []
  const sizeBuckets = useMemo(() => {
    const byKey = new Map(sizeBucketsFromFacets.map((b) => [b.key, b]))
    const normSel = (s: string) => {
      const x = s.toLowerCase().trim()
      if (x === 'mid') return 'medio'
      return x
    }
    for (const sel of selectedSize) {
      const sk = normSel(sel)
      const bucketKey = sk === 'medio' ? 'mid' : sk
      if (!byKey.has(bucketKey)) {
        const def = FOLLOWERS_SIZE_BUCKETS.find((b) => b.key === sk)
        if (def) {
          byKey.set(bucketKey, {
            key: bucketKey,
            label: def.key === 'medio' ? 'Mid' : def.label,
            count: 0,
          })
        }
      }
    }
    return [...byKey.values()]
  }, [sizeBucketsFromFacets, selectedSize])

  const applySingleBoost = (
    key: Parameters<typeof buildSingleCampaignFacetBoostPatch>[0],
    nextValue: string[] | number[] | undefined
  ) => {
    if (!onFilter) return
    onFilter(buildSingleCampaignFacetBoostPatch(key, nextValue))
  }

  const handleSize = (key: string) => {
    const next = selectedSize.includes(key) ? undefined : [key]
    applySingleBoost('sizeFilter', next)
  }

  const handleMetricBucket = (
    selected: number[],
    min: number,
    key: 'engagementRateBuckets' | 'avgLikesBuckets'
  ) => {
    const next = selected.includes(min) ? undefined : [min]
    applySingleBoost(key, next)
  }

  const handleContentType = (name: string) => {
    const next = selectedContent.includes(name) ? undefined : [name]
    applySingleBoost('contentTypes', next)
  }
  const handleSocial = (net: string) => {
    const next = selectedSocial.includes(net) ? undefined : [net]
    applySingleBoost('socialNetworks', next)
  }
  const handleCity = (name: string) => {
    const next = selectedCities.includes(name) ? undefined : [name]
    applySingleBoost('cities', next)
  }
  const handleState = (name: string) => {
    const next = selectedStates.includes(name) ? undefined : [name]
    applySingleBoost('states', next)
  }

  const llm = facets?.llm
  const selectedLlmMainCategory = (query?.llmMainCategory ?? []) as string[]
  const selectedLlmGender = (query?.llmGender ?? []) as string[]
  const selectedLlmAudienceType = (query?.llmAudienceType ?? []) as string[]

  const llmArraySelected = (selected: string[], facetName: string): boolean => {
    const n = facetName.trim().toLowerCase()
    return selected.some((x) => String(x).trim().toLowerCase() === n)
  }

  const showLlmMainCategorySection = !!(
    llm && showNamedFacetList(llm.mainCategory)
  )

  const handleLlmArrayToggle = (key: LlmArrayFilterKey, facetName: string) => {
    const has = llmArraySelected(
      key === 'llmMainCategory'
        ? selectedLlmMainCategory
        : key === 'llmGender'
          ? selectedLlmGender
          : selectedLlmAudienceType,
      facetName
    )
    const next = has ? undefined : [facetName]
    applySingleBoost(key, next)
  }

  return (
    <div className="campaign-bi-panel">
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
            Ordenar relatório
          </span>
        }
      >
        {onFilter &&
          llm &&
          showNamedFacetList(llm.audienceType) && (
            <div className="campaign-bi-section">
              <Text strong className="campaign-bi-section-title">Público-alvo</Text>
              <div className="campaign-bi-content">
                {filterNamedFacetRows(llm.audienceType).map(({ name }) => (
                  <span
                    key={name}
                    className={`campaign-bi-clickable ${llmArraySelected(selectedLlmAudienceType, name) ? 'campaign-bi-selected' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleLlmArrayToggle('llmAudienceType', name)}
                    onKeyDown={(e) => e.key === 'Enter' && handleLlmArrayToggle('llmAudienceType', name)}
                    style={{ color: llmPillColor(`aud-${name}`) }}
                  >
                    {formatFacetLabel(name)}
                  </span>
                ))}
              </div>
            </div>
          )}

        {onFilter &&
          llm &&
          showNamedFacetList(llm.gender) && (
            <div className="campaign-bi-section">
              <Text strong className="campaign-bi-section-title">Gênero do Influencer</Text>
              <div className="campaign-bi-price">
                {filterNamedFacetRows(llm.gender).map(({ name }) => (
                  <span
                    key={name}
                    className={`campaign-bi-clickable ${llmArraySelected(selectedLlmGender, name) ? 'campaign-bi-selected' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleLlmArrayToggle('llmGender', name)}
                    onKeyDown={(e) => e.key === 'Enter' && handleLlmArrayToggle('llmGender', name)}
                    style={{ color: llmPillColor(`g-${name}`) }}
                  >
                    {formatFacetLabel(name)}
                  </span>
                ))}
              </div>
            </div>
          )}

        {onFilter &&
          (sizeBuckets.some((b) => (b.count ?? 0) > 0) || selectedSize.length > 0) && (
          <div className="campaign-bi-section">
            <Text strong className="campaign-bi-section-title">Tamanho</Text>
            <div className="campaign-bi-price">
              {sizeBuckets
                .filter((b) => (b.count ?? 0) > 0 || selectedSize.includes(b.key))
                .map(({ key, label }) => {
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
                    {label}
                  </span>
                )
              })}
            </div>
          </div>
        )}

        {onFilter && engagementBuckets.some((b) => (b.count ?? 0) > 0) && (
          <div className="campaign-bi-section">
            <Text strong className="campaign-bi-section-title">Engajamento</Text>
            <div className="campaign-bi-price">
              {engagementBuckets
                .filter((b) => (b.count ?? 0) > 0)
                .map((bucket) => {
                  const min = facetBucketFilterMin(bucket)
                  const selected = selectedEngagement.includes(min)
                  return (
                    <span
                      key={bucket.key}
                      className={`campaign-bi-clickable ${selected ? 'campaign-bi-selected' : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleMetricBucket(selectedEngagement, min, 'engagementRateBuckets')}
                      onKeyDown={(e) => e.key === 'Enter' && handleMetricBucket(selectedEngagement, min, 'engagementRateBuckets')}
                    >
                      {bucket.label}
                    </span>
                  )
                })}
            </div>
          </div>
        )}

        {onFilter && avgLikesFacetBuckets.some((b) => (b.count ?? 0) > 0) && (
          <div className="campaign-bi-section">
            <Text strong className="campaign-bi-section-title">Média de curtidas</Text>
            <div className="campaign-bi-price">
              {avgLikesFacetBuckets
                .filter((b) => (b.count ?? 0) > 0)
                .map((bucket) => {
                  const min = facetBucketFilterMin(bucket)
                  const selected = selectedAvgLikes.includes(min)
                  return (
                    <span
                      key={bucket.key}
                      className={`campaign-bi-clickable ${selected ? 'campaign-bi-selected' : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleMetricBucket(selectedAvgLikes, min, 'avgLikesBuckets')}
                      onKeyDown={(e) => e.key === 'Enter' && handleMetricBucket(selectedAvgLikes, min, 'avgLikesBuckets')}
                    >
                      {bucket.label}
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
            const showNets = nets.length > 0
            return showNets ? (
              <div className="campaign-bi-section">
                <Text strong className="campaign-bi-section-title">Redes sociais</Text>
                <div className="campaign-bi-social">
                  {nets.map(({ net, label }) => (
                    <span
                      key={net}
                      className={`campaign-bi-clickable ${selectedSocial.includes(net) ? 'campaign-bi-selected' : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleSocial(net)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSocial(net)}
                    >
                      {label}
                    </span>
                  ))}
                </div>
              </div>
            ) : null
          })()}

        {onFilter && contentTypes.some((c) => (c.count ?? 0) > 0) && (
          <div className="campaign-bi-section">
            <Text strong className="campaign-bi-section-title">Tipo de conteúdo</Text>
            <div className="campaign-bi-content">
              {contentTypes
                .filter((c) => (c.count ?? 0) > 0)
                .map((c) => (
                  <span
                    key={c.name}
                    className={`campaign-bi-clickable ${selectedContent.includes(c.name) ? 'campaign-bi-selected' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleContentType(c.name)}
                    onKeyDown={(e) => e.key === 'Enter' && handleContentType(c.name)}
                  >
                    {CONTENT_TYPE_LABELS[c.name] ?? formatFacetLabel(c.name)}
                  </span>
                ))}
            </div>
          </div>
        )}

        {onFilter && llm && (
          <>
            {showLlmMainCategorySection && (
              <div className="campaign-bi-section">
                <Text strong className="campaign-bi-section-title">Categoria principal</Text>
                <div className="campaign-bi-content">
                  {filterNamedFacetRows(llm.mainCategory).map(({ name }) => (
                    <span
                      key={name}
                      className={`campaign-bi-clickable ${llmArraySelected(selectedLlmMainCategory, name) ? 'campaign-bi-selected' : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleLlmArrayToggle('llmMainCategory', name)}
                      onKeyDown={(e) => e.key === 'Enter' && handleLlmArrayToggle('llmMainCategory', name)}
                      style={{ color: llmPillColor(`cat-${name}`) }}
                    >
                      {formatFacetLabel(name)}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {onFilter &&
          (() => {
            const st = states.filter((s) => (s.count ?? 0) > 0)
            const ci = cities.filter((c) => (c.count ?? 0) > 0)
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
                      {formatFacetLabel(s.name)}
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
                      {formatFacetLabel(c.name)}
                    </span>
                  ))}
                </div>
              </div>
            ) : null
          })()}
      </Card>
    </div>
  )
}
