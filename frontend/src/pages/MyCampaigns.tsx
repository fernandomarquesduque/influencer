/**
 * Minhas campanhas: dashboard de relatórios comprados pelo usuário.
 * Cards em lista com resumo LLM (gêneros, tipos de perfil) e categorias no rodapé.
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Typography, Button, Spin, Empty, Statistic, Row, Col, Tooltip } from 'antd'
import {
  FolderOpenOutlined,
  PlusOutlined,
  UserOutlined,
  CalendarOutlined,
  ArrowRightOutlined,
  HeartOutlined,
  CommentOutlined,
  TeamOutlined,
  FileTextOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons'
import { useAuth } from '../contexts/AuthContext'
import { fetchMyCampaigns, fetchFavorites, type MyCampaignItem, type MyCampaignStats } from '../api'
import FavoriteProfilesList from '../components/FavoriteProfilesList'
import { campaignLlmBadgeStyles } from '../utils/campaignLlmBadges'
import './MyCampaigns.css'

const { Title, Text } = Typography

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch {
    return iso
  }
}

function formatShortNum(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toLocaleString('pt-BR')
}

function sumStats(campaigns: MyCampaignItem[]): Partial<MyCampaignStats> {
  let totalLikes = 0
  let totalComments = 0
  let totalViews = 0
  let totalFollowers = 0
  let postsCount = 0
  for (const c of campaigns) {
    const s = c.stats
    if (s) {
      totalLikes += s.totalLikes
      totalComments += s.totalComments
      totalViews += s.totalViews
      totalFollowers += s.totalFollowers
      postsCount += s.postsCount
    }
  }
  return { totalLikes, totalComments, totalViews, totalFollowers, postsCount }
}

export default function MyCampaigns() {
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const [campaigns, setCampaigns] = useState<MyCampaignItem[]>([])
  const [loading, setLoading] = useState(true)
  const [statsLoading, setStatsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasFavorites, setHasFavorites] = useState(false)

  useEffect(() => {
    if (!user) return
    let active = true
    setLoading(true)
    setError(null)
    setStatsLoading(false)
    const ac = new AbortController()
    Promise.all([
      fetchMyCampaigns({ signal: ac.signal, light: true }),
      fetchFavorites({ signal: ac.signal })
        .then((res) => (res.handles?.length ?? 0) > 0)
        .catch(() => false),
    ])
      .then(([campaignsRes, fav]) => {
        if (!active) return
        setCampaigns(campaignsRes.campaigns ?? [])
        setHasFavorites(fav)
        if ((campaignsRes.campaigns?.length ?? 0) > 0) {
          setStatsLoading(true)
          fetchMyCampaigns({ signal: ac.signal })
            .then((full) => {
              if (active) setCampaigns(full.campaigns ?? [])
            })
            .catch(() => { })
            .finally(() => {
              if (active) setStatsLoading(false)
            })
        }
      })
      .catch((e) => {
        // Não exibir erro quando o request foi cancelado (navegação/cleanup)
        const err = e as Error & { name?: string }
        if (err?.name === 'AbortError' || err?.message?.toLowerCase().includes('abort')) return
        if (active) setError(err?.message ?? 'Erro ao carregar campanhas')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
      ac.abort()
    }
  }, [user])

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/login', { replace: true })
    }
  }, [authLoading, user, navigate])

  if (authLoading || !user) {
    return (
      <div style={{ padding: '48px 24px', textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    )
  }

  const mainContent = (
    <>
      <div className="my-campaigns-header">
        <Title level={3} className="my-campaigns-title">
          <FolderOpenOutlined /> Minhas campanhas
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/app/campaigns/create')}>
          Nova Campanha
        </Button>
      </div>

      {error && (
        <Typography.Text type="danger" className="my-campaigns-error">
          {error}
        </Typography.Text>
      )}

      {loading ? (
        <div className="my-campaigns-loading">
          <Spin size="large" />
        </div>
      ) : campaigns.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="Você ainda não tem campanhas. Faça uma busca e compre um relatório para ver a lista aqui."
        >
          <Button type="primary" onClick={() => navigate('/search')}>
            Fazer uma busca
          </Button>
        </Empty>
      ) : (
        <>
          <Row gutter={[16, 16]} className="my-campaigns-grid">
            {campaigns.map((c) => (
              <Col xs={24} key={c.id}>
                <Card
                  className="my-campaign-card"
                  hoverable
                  onClick={() => navigate(`/app/campaigns/${c.id}`)}
                >
                  <div className="my-campaign-card-body">
                    <div className="my-campaign-card-row">
                      <div className="my-campaign-card-leading">
                        <div className="my-campaign-card-header">
                          <span className="my-campaign-card-perfis my-campaign-card-perfis--hero">
                            <UserOutlined aria-hidden />
                            <span className="my-campaign-card-perfis-count">
                              {formatShortNum(c.handlesCount)}
                            </span>
                            <span className="my-campaign-card-perfis-suffix">
                              {c.handlesCount === 1 ? 'perfil' : 'perfis'}
                            </span>
                          </span>
                          <Button
                            type="text"
                            size="small"
                            icon={<ArrowRightOutlined />}
                            onClick={(e) => {
                              e.stopPropagation()
                              navigate(`/app/campaigns/${c.id}`)
                            }}
                          />
                        </div>
                        <Text
                          type="secondary"
                          className="my-campaign-card-subtitle"
                          ellipsis={{ tooltip: c.name || 'Campanha' }}
                        >
                          {c.name || 'Campanha'}
                        </Text>
                        <div className="my-campaign-card-meta-row">
                          <div
                            className="my-campaign-card-date"
                            title={c.expires_at ? 'Data de término da vigência do relatório' : undefined}
                          >
                            <CalendarOutlined style={{ marginRight: 4, opacity: 0.7 }} />
                            <Text type="secondary" className="my-campaign-card-date-text">
                              Até {c.expires_at ? formatDate(c.expires_at) : '—'}
                            </Text>
                          </div>
                          {c.pendingPayment && (
                            <>
                              <span className="my-campaign-card-meta-sep" aria-hidden>
                                ·
                              </span>
                              <span className="my-campaign-card-pending-payment my-campaign-card-pending-payment--inline">
                                <ClockCircleOutlined /> Aguardando pagamento
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      {(() => {
                        const llmRows: Array<{
                          key: string
                          sectionLabel: string
                          entries: Array<{ label: string; count: number }>
                          tooltipLabel: string
                        }> = []
                        if (c.topLlmGenders?.length) {
                          llmRows.push({
                            key: 'genders',
                            sectionLabel: 'Gêneros',
                            entries: c.topLlmGenders,
                            tooltipLabel: 'Gênero dos influencers nesta campanha',
                          })
                        }
                        if (c.topLlmProfileTypes?.length) {
                          llmRows.push({
                            key: 'profileTypes',
                            sectionLabel: 'Tipos de perfil',
                            entries: c.topLlmProfileTypes,
                            tooltipLabel: 'Tipo de perfil dos influencers nesta campanha',
                          })
                        }
                        if (llmRows.length === 0) return null
                        return (
                          <div className="my-campaign-card-llm-dimensions">
                            {llmRows.map((row) => (
                              <div key={row.key} className="my-campaign-card-llm-dimensions-row">
                                <Text type="secondary" className="my-campaign-card-llm-dimensions-label">
                                  {row.sectionLabel}
                                </Text>
                                <div className="my-campaign-card-llm-dimensions-chips">
                                  {row.entries.map((entry) => {
                                    const st = campaignLlmBadgeStyles(entry.label)
                                    const n = entry.count
                                    const perfis = n === 1 ? 'perfil' : 'perfis'
                                    return (
                                      <Tooltip
                                        key={`${row.key}-${entry.label}`}
                                        title={`${entry.label}: ${n} ${perfis} com este ${row.tooltipLabel}`}
                                      >
                                        <span
                                          className="my-campaign-card-llm-chip my-campaign-card-llm-chip--compact"
                                          style={{
                                            border: st.border,
                                            color: st.color,
                                            background: st.background,
                                          }}
                                        >
                                          <span className="my-campaign-card-llm-chip-text">{entry.label}</span>
                                          <span className="my-campaign-card-llm-chip-count">{n}</span>
                                        </span>
                                      </Tooltip>
                                    )
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        )
                      })()}
                    </div>

                    <div className="my-campaign-card-footer">
                      {c.topLlmCategories && c.topLlmCategories.length > 0 ? (
                        <div className="my-campaign-card-llm-categories">

                          <div className="my-campaign-card-llm-categories-chips">
                            {c.topLlmCategories.map((entry) => {
                              const st = campaignLlmBadgeStyles(entry.label)
                              const n = entry.count
                              const perfis = n === 1 ? 'perfil' : 'perfis'
                              return (
                                <Tooltip
                                  key={entry.label}
                                  title={`${entry.label}: ${n} ${perfis} com esta categoria principal`}
                                >
                                  <span
                                    className="my-campaign-card-llm-chip"
                                    style={{
                                      border: st.border,
                                      color: st.color,
                                      background: st.background,
                                    }}
                                  >
                                    <span className="my-campaign-card-llm-chip-text">{entry.label}</span>
                                    <span className="my-campaign-card-llm-chip-count">{n}</span>
                                  </span>
                                </Tooltip>
                              )
                            })}
                          </div>
                        </div>
                      ) : (
                        <Text type="secondary">Clique para ver os influenciadores</Text>
                      )}
                    </div>
                  </div>
                </Card>
              </Col>
            ))}
          </Row>
        </>
      )}
    </>
  )

  const showSidebar = hasFavorites || (campaigns.length > 0 && !loading)
  const totals = campaigns.length > 0 ? sumStats(campaigns) : {}
  const hasStats = (totals.totalLikes ?? 0) > 0 || (totals.totalViews ?? 0) > 0 || (totals.totalFollowers ?? 0) > 0

  return (
    <div className={`my-campaigns-page${showSidebar ? ' my-campaigns-split' : ''}`}>
      {showSidebar && (
        <div className="my-campaigns-sidebar" style={{ width: '22%', minWidth: 180, maxWidth: 260, borderRight: '1px solid var(--app-border)', paddingRight: 16, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {campaigns.length > 0 && (
            <div>
              <Text strong style={{ fontSize: 14, color: 'var(--app-primary)', marginBottom: 8, display: 'block' }}>Resumo</Text>
              {statsLoading && (
                <div style={{ marginBottom: 8 }}>
                  <Spin size="small" /> <Text type="secondary" style={{ fontSize: 12 }}>Carregando engajamento...</Text>
                </div>
              )}
              <div className="my-campaigns-summary my-campaigns-summary-sidebar">
                <Statistic title={<><FolderOpenOutlined /> Campanhas</>} value={campaigns.length} suffix="relatórios" />
                <Statistic
                  title={<><UserOutlined /> Influencers</>}
                  value={campaigns.reduce((s, c) => s + c.handlesCount, 0)}
                  formatter={(v) => formatShortNum(Number(v))}
                />
                {hasStats && (
                  <>
                    <Statistic
                      title={<><HeartOutlined /> Likes</>}
                      value={totals.totalLikes ?? 0}
                      formatter={(v) => formatShortNum(Number(v))}
                    />
                    <Statistic
                      title={<><CommentOutlined /> Comentários</>}
                      value={totals.totalComments ?? 0}
                      formatter={(v) => formatShortNum(Number(v))}
                    />
                    <Statistic
                      title={<><TeamOutlined /> Seguidores</>}
                      value={totals.totalFollowers ?? 0}
                      formatter={(v) => formatShortNum(Number(v))}
                    />
                    <Statistic
                      title={<><FileTextOutlined /> Posts</>}
                      value={totals.postsCount ?? 0}
                      formatter={(v) => formatShortNum(Number(v))}
                    />
                  </>
                )}
              </div>
            </div>
          )}
          {hasFavorites && (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <FavoriteProfilesList onEmpty={() => setHasFavorites(false)} />
            </div>
          )}
        </div>
      )}
      <div className="my-campaigns-main" style={{ flex: 1, minWidth: 0 }}>
        {mainContent}
      </div>
    </div>
  )
}
