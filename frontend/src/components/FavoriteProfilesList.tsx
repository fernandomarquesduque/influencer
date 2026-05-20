/**
 * Lista de perfis favoritados pelo usuário.
 * Exibida na lateral da tela Minhas campanhas (proporção 30%).
 * Mostra foto do perfil, nome e principais métricas.
 */
import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Typography, Spin, Empty, List, Modal, Tooltip, Button } from 'antd'
import { HeartFilled, FolderOutlined, DeleteOutlined } from '@ant-design/icons'
import { fetchFavorites, fetchProfile, fetchProfileSummary, removeFavorite, getProfilePicUrl, proxyImageUrl, type ProfileItem } from '../api'
import ProfileAvatar from './ProfileAvatar'
import InfluencerTierPill from './InfluencerTierPill'
import { campaignLlmBadgeStyles, getLlmContentPillarLabels, getLlmMainCategoryLabel } from '../utils/campaignLlmBadges'
import type { ProfileListItem } from '../api'

const { Text } = Typography

const MAX_FAVORITES_TO_FETCH = 25

function formatFollowers(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',')}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace('.', ',')}k`
  return n.toLocaleString('pt-BR')
}

function formatPtDecimal(n: number, fractionDigits = 1): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits })
}

interface CampaignRef {
  campaignId?: string | null
  campaignName?: string
}

interface FavoriteProfileRow {
  key: string
  profileRef: string
  profile: ProfileItem | null
  engagement?: { engagement_rate?: number; posts_per_week?: number }
  campaigns: CampaignRef[]
}

export interface FavoriteProfilesListProps {
  /** Chamado quando o usuário remove o último favorito e a lista fica vazia. */
  onEmpty?: () => void
}

const FavoriteProfilesList: React.FC<FavoriteProfilesListProps> = ({ onEmpty }) => {
  const navigate = useNavigate()
  const [rows, setRows] = useState<FavoriteProfileRow[]>([])
  const [loading, setLoading] = useState(true)

  const handleRemoveFavorite = (profileRef: string, displayName: string, e?: React.SyntheticEvent) => {
    e?.stopPropagation()
    Modal.confirm({
      title: 'Remover dos favoritos',
      content: `Tem certeza que deseja remover ${displayName} dos favoritos?`,
      okText: 'Sim, remover',
      cancelText: 'Cancelar',
      okButtonProps: { danger: true },
      onOk: () =>
        removeFavorite(profileRef).then(() => {
          setRows((prev) => {
            const next = prev.filter((r) => r.profileRef !== profileRef)
            if (next.length === 0) onEmpty?.()
            return next
          })
        }),
    })
  }

  useEffect(() => {
    fetchFavorites()
      .then((res) => {
        const favorites = (res.favorites ?? []).slice(0, MAX_FAVORITES_TO_FETCH)
        if (favorites.length === 0) {
          setRows([])
          setLoading(false)
          return
        }
        const uniqueRefs = [...new Set(favorites.map((f) => (f.profile_ref ?? '').trim()).filter(Boolean))]
        Promise.all(
          uniqueRefs.map((profileRef) => {
            return fetchProfileSummary(profileRef)
              .then((summary) => ({ profileRef, profile: summary?.profile ?? null, engagement: summary?.engagement }))
              .catch(() =>
                fetchProfile(profileRef)
                  .then((profile) => ({ profileRef, profile, engagement: undefined as { engagement_rate?: number; posts_per_week?: number } | undefined }))
                  .catch(() => ({ profileRef, profile: null as ProfileItem | null, engagement: undefined }))
              )
          })
        ).then((profileResults) => {
          const profileByRef = new Map<string | undefined, { profile: ProfileItem | null; engagement?: { engagement_rate?: number; posts_per_week?: number } }>()
          profileResults.forEach((r) => profileByRef.set(r.profileRef, { profile: r.profile, engagement: r.engagement }))
          const rawRows = favorites.map((f) => {
            const ref = (f.profile_ref ?? '').trim()
            const { profile, engagement } = profileByRef.get(ref) ?? { profile: null, engagement: undefined }
            return {
              profileRef: ref,
              profile,
              engagement,
              campaignRef: { campaignId: f.campaignId, campaignName: f.campaignName } as CampaignRef,
            }
          })
          const groupedByRef = new Map<string, Omit<FavoriteProfileRow, 'key'> & { campaigns: CampaignRef[] }>()
          rawRows.forEach((r) => {
            const existing = groupedByRef.get(r.profileRef)
            if (existing) {
              existing.campaigns.push(r.campaignRef)
            } else {
              groupedByRef.set(r.profileRef, {
                profileRef: r.profileRef,
                profile: r.profile,
                engagement: r.engagement,
                campaigns: [r.campaignRef],
              })
            }
          })
          const list: FavoriteProfileRow[] = Array.from(groupedByRef.values()).map((row) => ({
            ...row,
            key: row.profileRef,
          }))
          setRows(list)
          setLoading(false)
        })
      })
      .catch(() => {
        setRows([])
        setLoading(false)
      })
  }, [])

  if (loading) {
    return (
      <div className="favorite-profiles-list" style={{ padding: 16, textAlign: 'center' }}>
        <Spin size="small" />
      </div>
    )
  }

  return (
    <div className="favorite-profiles-list" style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, flexShrink: 0 }}>
        <HeartFilled style={{ color: 'var(--app-primary)', fontSize: 16 }} />
        <Text strong style={{ fontSize: 14 }}>Perfis favoritos</Text>
        {rows.length > 0 && (
          <Text type="secondary" style={{ fontSize: 12 }}>({rows.length})</Text>
        )}
      </div>
      {rows.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="Nenhum perfil favoritado"
          style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}
        />
      ) : (
        <List
          size="small"
          dataSource={rows}
          rowKey={(r) => r.key}
          style={{ flex: 1, overflow: 'auto', minHeight: 0 }}
          renderItem={({ profileRef, profile, engagement, campaigns }) => {
            const name = (profile?.full_name ?? 'Influenciador') as string
            const pic = profile ? proxyImageUrl(getProfilePicUrl(profile as unknown as Record<string, unknown>)) : undefined
            const followers = profile?.followers_count ?? 0
            const engagementRate = engagement?.engagement_rate
            const postsPerWeek = engagement?.posts_per_week
            const llmCategory = profile ? getLlmMainCategoryLabel(profile as unknown as ProfileListItem) : null
            const llmPillars = profile ? getLlmContentPillarLabels(profile as unknown as ProfileListItem) : []
            return (
              <List.Item
                style={{ padding: 0, alignItems: 'stretch', borderBlockEnd: 'none', marginBottom: 12 }}
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/app/influencer/${encodeURIComponent(profileRef)}`)}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(`/app/influencer/${encodeURIComponent(profileRef)}`)}
                  style={{
                    cursor: 'pointer',
                    width: '100%',
                    minWidth: 0,
                    padding: '10px 10px 8px',
                    borderRadius: 12,
                    background: 'linear-gradient(135deg, rgba(104, 39, 143, 0.06) 0%, rgba(232, 186, 0, 0.04) 50%, rgba(238, 130, 238, 0.05) 100%)',
                    border: '1px solid var(--app-border-light, #f0f0f0)',
                    position: 'relative',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'stretch',
                  }}
                >
                  {/* Linha superior: foto + nome/categoria/handle */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, marginBottom: 6 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      <ProfileAvatar
                        size={40}
                        src={pic || undefined}
                        handle={profileRef}
                        border="1px solid var(--app-border)"
                      />
                      <InfluencerTierPill followers={followers} variant="gradient" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Text strong ellipsis style={{ display: 'block', fontSize: 13, lineHeight: 1.25, color: 'var(--app-text)' }}>
                        {name}
                      </Text>
                      {llmCategory || llmPillars.length > 0 ? (
                        <div
                          style={{
                            marginTop: 3,
                            marginBottom: 2,
                            minWidth: 0,
                            display: 'flex',
                            flexWrap: 'wrap',
                            alignItems: 'center',
                            gap: '5px 6px',
                          }}
                        >
                          {llmCategory ? (
                            <Tooltip title="Categoria principal">
                              <span
                                style={{
                                  display: 'inline-block',
                                  maxWidth: '100%',
                                  fontSize: 10,
                                  fontWeight: 600,
                                  lineHeight: 1.35,
                                  padding: '2px 7px',
                                  borderRadius: 999,
                                  whiteSpace: 'normal',
                                  wordBreak: 'break-word',
                                  ...campaignLlmBadgeStyles(llmCategory),
                                }}
                              >
                                {llmCategory}
                              </span>
                            </Tooltip>
                          ) : null}
                          {llmPillars.map((pillar) => (
                            <Tooltip key={pillar} title="Pilar de conteúdo">
                              <span
                                style={{
                                  display: 'inline-block',
                                  maxWidth: '100%',
                                  fontSize: 10,
                                  fontWeight: 600,
                                  lineHeight: 1.35,
                                  padding: '2px 7px',
                                  borderRadius: 999,
                                  whiteSpace: 'normal',
                                  wordBreak: 'break-word',
                                  ...campaignLlmBadgeStyles(pillar),
                                }}
                              >
                                {pillar}
                              </span>
                            </Tooltip>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div
                    style={{
                      marginTop: 6,
                      paddingTop: 8,
                      borderTop: '1px solid var(--app-border-light, #f0f0f0)',
                      flexShrink: 0,
                    }}
                  >
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 10px', fontSize: 11, color: 'var(--app-text)', alignItems: 'center', marginBottom: 6 }}>
                      <span>
                        <Text strong style={{ fontSize: 11 }}>{formatFollowers(followers)}</Text>
                        <Text type="secondary" style={{ fontSize: 10, marginLeft: 2 }}>Seg.</Text>
                      </span>
                      {Number.isFinite(engagementRate) && (
                        <span>
                          <Text strong style={{ fontSize: 11 }}>{formatPtDecimal(engagementRate!)}%</Text>
                          <Text type="secondary" style={{ fontSize: 10, marginLeft: 2 }}>ER</Text>
                        </span>
                      )}
                      {Number.isFinite(postsPerWeek) && (
                        <span>
                          <Text strong style={{ fontSize: 11 }}>{formatPtDecimal(postsPerWeek!)}</Text>
                          <Text type="secondary" style={{ fontSize: 10, marginLeft: 2 }}>posts/sem</Text>
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        minWidth: 0,
                      }}
                    >
                      <div
                        style={{
                          flex: 1,
                          minWidth: 0,
                          color: campaigns.some((c) => c.campaignName) ? 'var(--app-primary)' : 'var(--app-text-secondary)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          flexWrap: 'wrap',
                        }}
                      >
                        <FolderOutlined style={{ opacity: 0.9, fontSize: 10, flexShrink: 0 }} />
                        <Text ellipsis style={{ fontSize: 10 }}>
                          {campaigns.length > 0
                            ? campaigns.map((c) => c.campaignName || '—').join(', ')
                            : '—'}
                        </Text>
                      </div>
                      <Tooltip title="Remover dos favoritos">
                        <Button
                          type="text"
                          danger
                          size="small"
                          icon={<DeleteOutlined style={{ fontSize: 12 }} />}
                          style={{ flexShrink: 0, minWidth: 22, height: 22, padding: '0 2px', lineHeight: 1 }}
                          aria-label="Remover dos favoritos"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleRemoveFavorite(profileRef, name, e)
                          }}
                        />
                      </Tooltip>
                    </div>
                  </div>
                </div>
              </List.Item>
            )
          }}
        />
      )}
    </div>
  )
}

export default FavoriteProfilesList
