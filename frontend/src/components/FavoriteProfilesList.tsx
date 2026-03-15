/**
 * Lista de perfis favoritados pelo usuário.
 * Exibida na lateral da tela Minhas campanhas (proporção 30%).
 * Mostra foto do perfil, nome e principais métricas.
 */
import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Typography, Spin, Empty, List, Avatar, Button, Modal } from 'antd'
import { HeartFilled, UserOutlined, FolderOutlined, StarFilled } from '@ant-design/icons'
import { fetchFavorites, fetchProfile, fetchProfileSummary, removeFavorite, getProfilePicUrl, proxyImageUrl, type ProfileItem } from '../api'

const { Text } = Typography

const MAX_FAVORITES_TO_FETCH = 25

function formatFollowers(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',')}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace('.', ',')}k`
  return n.toLocaleString('pt-BR')
}

function getTierLabel(followers: number | undefined | null): string {
  if (followers == null || !Number.isFinite(followers)) return 'Influencer'
  if (followers < 10_000) return 'Nano Influencer'
  if (followers < 50_000) return 'Micro Influencer'
  if (followers < 500_000) return 'Mid Influencer'
  return 'Macro Influencer'
}

interface CampaignRef {
  campaignId?: string | null
  campaignName?: string
}

interface FavoriteProfileRow {
  key: string
  handle: string
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

  const handleRemoveFavorite = (handle: string, displayName: string, e: React.MouseEvent) => {
    e.stopPropagation()
    Modal.confirm({
      title: 'Remover dos favoritos',
      content: `Tem certeza que deseja remover ${displayName} dos favoritos?`,
      okText: 'Sim, remover',
      cancelText: 'Cancelar',
      okButtonProps: { danger: true },
      onOk: () =>
        removeFavorite(handle).then(() => {
          setRows((prev) => {
            const next = prev.filter((r) => r.handle !== handle)
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
        const uniqueHandles = [...new Set(favorites.map((f) => (f.handle ?? '').toLowerCase().replace(/^@/, '').trim()).filter(Boolean))]
        Promise.all(
          uniqueHandles.map((handle) => {
            return fetchProfileSummary(handle)
              .then((summary) => ({ handle, profile: summary?.profile ?? null, engagement: summary?.engagement }))
              .catch(() =>
                fetchProfile(handle)
                  .then((profile) => ({ handle, profile, engagement: undefined as { engagement_rate?: number; posts_per_week?: number } | undefined }))
                  .catch(() => ({ handle, profile: null as ProfileItem | null, engagement: undefined }))
              )
          })
        ).then((profileResults) => {
          const profileByHandle = new Map<string | undefined, { profile: ProfileItem | null; engagement?: { engagement_rate?: number; posts_per_week?: number } }>()
          profileResults.forEach((r) => profileByHandle.set(r.handle, { profile: r.profile, engagement: r.engagement }))
          const rawRows = favorites.map((f) => {
            const h = (f.handle ?? '').toLowerCase().replace(/^@/, '').trim()
            const { profile, engagement } = profileByHandle.get(h) ?? { profile: null, engagement: undefined }
            return {
              handle: h,
              profile,
              engagement,
              campaignRef: { campaignId: f.campaignId, campaignName: f.campaignName } as CampaignRef,
            }
          })
          const groupedByHandle = new Map<string, Omit<FavoriteProfileRow, 'key'> & { campaigns: CampaignRef[] }>()
          rawRows.forEach((r) => {
            const existing = groupedByHandle.get(r.handle)
            if (existing) {
              existing.campaigns.push(r.campaignRef)
            } else {
              groupedByHandle.set(r.handle, {
                handle: r.handle,
                profile: r.profile,
                engagement: r.engagement,
                campaigns: [r.campaignRef],
              })
            }
          })
          const list: FavoriteProfileRow[] = Array.from(groupedByHandle.values()).map((row) => ({
            ...row,
            key: row.handle,
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
          renderItem={({ handle, profile, engagement, campaigns }) => {
            const name = (profile?.full_name ?? profile?.username ?? handle) as string
            const pic = profile ? proxyImageUrl(getProfilePicUrl(profile as unknown as Record<string, unknown>)) : undefined
            const followers = profile?.followers_count ?? 0
            const engagementRate = engagement?.engagement_rate
            const postsPerWeek = engagement?.posts_per_week
            const tierLabel = getTierLabel(followers)

            return (
              <List.Item
                style={{ padding: 0, alignItems: 'stretch', borderBlockEnd: 'none', marginBottom: 12 }}
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/app/influencer/${encodeURIComponent(handle)}`)}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(`/app/influencer/${encodeURIComponent(handle)}`)}
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
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<HeartFilled />}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleRemoveFavorite(handle, name !== handle ? `${name} (@${handle})` : `@${handle}`, e)
                    }}
                    style={{ position: 'absolute', top: 8, right: 8, padding: '2px 4px', minWidth: 24 }}
                    title="Remover dos favoritos"
                  />
                  {/* Linha superior: (avatar + nano) + nome/handle */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, marginBottom: 6 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      <Avatar
                        size={40}
                        src={pic}
                        icon={!pic ? <UserOutlined /> : undefined}
                        style={{ border: '1px solid var(--app-border)' }}
                      />
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 600,
                          color: '#fff',
                          background: 'linear-gradient(90deg, var(--app-primary), #e85d8a)',
                          padding: '2px 6px',
                          borderRadius: 12,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 2,
                        }}
                      >
                        <StarFilled style={{ fontSize: 9 }} />
                        {tierLabel.replace(/\s*Influencer\s*$/i, '')}
                      </span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Text strong ellipsis style={{ display: 'block', fontSize: 13, lineHeight: 1.25, color: 'var(--app-text)' }}>
                        {name}
                      </Text>
                      <Text type="secondary" style={{ fontSize: 11 }}>@{handle}</Text>
                    </div>
                  </div>
                  <div style={{ marginBottom: 4, fontSize: 10, color: campaigns.some((c) => c.campaignName) ? 'var(--app-primary)' : 'var(--app-text-secondary)', display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                    <FolderOutlined style={{ opacity: 0.9, fontSize: 10, flexShrink: 0 }} />
                    <Text ellipsis style={{ fontSize: 10 }}>
                      {campaigns.length > 0
                        ? campaigns.map((c) => c.campaignName || '—').join(', ')
                        : '—'}
                    </Text>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 10px', fontSize: 11, color: 'var(--app-text)', alignItems: 'center' }}>
                    <span>
                      <Text strong style={{ fontSize: 11 }}>{formatFollowers(followers)}</Text>
                      <Text type="secondary" style={{ fontSize: 10, marginLeft: 2 }}>Seg.</Text>
                    </span>
                    {Number.isFinite(engagementRate) && (
                      <span>
                        <Text strong style={{ fontSize: 11 }}>{engagementRate!.toFixed(1)}%</Text>
                        <Text type="secondary" style={{ fontSize: 10, marginLeft: 2 }}>ER</Text>
                      </span>
                    )}
                    {Number.isFinite(postsPerWeek) && (
                      <span>
                        <Text strong style={{ fontSize: 11 }}>{postsPerWeek!.toFixed(1)}</Text>
                        <Text type="secondary" style={{ fontSize: 10, marginLeft: 2 }}>posts/sem</Text>
                      </span>
                    )}
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
