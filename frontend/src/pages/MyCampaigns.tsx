/**
 * Minhas campanhas: dashboard de relatórios comprados pelo usuário.
 * Cards lado a lado com stats detalhados (engajamento, likes, views, etc.).
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
  EyeOutlined,
  RiseOutlined,
  TeamOutlined,
  FileTextOutlined,
} from '@ant-design/icons'
import { useAuth } from '../contexts/AuthContext'
import { fetchMyCampaigns, fetchFavorites, type MyCampaignItem, type MyCampaignStats } from '../api'
import FavoriteProfilesList, { type FavoriteProfilesListProps } from '../components/FavoriteProfilesList'
import './MyCampaigns.css'

const { Title, Text } = Typography

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
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
  const [error, setError] = useState<string | null>(null)
  const [hasFavorites, setHasFavorites] = useState(false)

  useEffect(() => {
    if (!user) return
    setLoading(true)
    setError(null)
    fetchMyCampaigns()
      .then((res) => setCampaigns(res.campaigns ?? []))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [user])

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/login', { replace: true })
    }
  }, [authLoading, user, navigate])

  useEffect(() => {
    if (!user) return
    fetchFavorites()
      .then((res) => setHasFavorites((res.handles?.length ?? 0) > 0))
      .catch(() => setHasFavorites(false))
  }, [user])

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
          <Button type="primary" onClick={() => navigate('/app')}>
            Fazer uma busca
          </Button>
        </Empty>
      ) : (
        <>
          {(() => {
            const totals = sumStats(campaigns)
            const hasStats = (totals.totalLikes ?? 0) > 0 || (totals.totalViews ?? 0) > 0 || (totals.totalFollowers ?? 0) > 0
            return (
              <div className="my-campaigns-summary">
                <Statistic title="Campanhas" value={campaigns.length} suffix="relatórios" />
                <Statistic
                  title="Perfis"
                  value={campaigns.reduce((s, c) => s + c.handlesCount, 0)}
                  formatter={(v) => formatShortNum(Number(v))}
                />
                {hasStats && (
                  <>
                    <Statistic
                      title={<><HeartOutlined /> Total Likes</>}
                      value={totals.totalLikes ?? 0}
                      formatter={(v) => formatShortNum(Number(v))}
                    />
                    <Statistic
                      title={<><CommentOutlined /> Total Comentários</>}
                      value={totals.totalComments ?? 0}
                      formatter={(v) => formatShortNum(Number(v))}
                    />
                    <Statistic
                      title={<><EyeOutlined /> Total Views</>}
                      value={totals.totalViews ?? 0}
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
            )
          })()}
          <Row gutter={[16, 16]} className="my-campaigns-grid">
            {campaigns.map((c) => (
              <Col xs={24} sm={12} lg={8} key={c.id}>
                <Card
                  className="my-campaign-card"
                  hoverable
                  onClick={() => navigate(`/app/campaigns/${c.id}`)}
                >
                  <div className="my-campaign-card-header">
                    <Title level={5} className="my-campaign-card-name">
                      {c.name || 'Campanha'}
                    </Title>
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
                  <Row gutter={[8, 12]} className="my-campaign-card-stats">
                    <Col span={12}>
                      <span className="my-campaign-card-perfis">
                        <UserOutlined /> {formatShortNum(c.handlesCount)} Perfis
                      </span>
                    </Col>
                    <Col span={12}>
                      <div className="my-campaign-card-date">
                        <CalendarOutlined style={{ marginRight: 4, opacity: 0.7 }} />
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {formatDate(c.created_at)}
                        </Text>
                      </div>
                    </Col>
                  </Row>
                  {c.stats && (c.stats.totalLikes > 0 || c.stats.totalViews > 0 || c.stats.totalFollowers > 0) && (
                    <div className="my-campaign-card-engagement">
                      <Text type="secondary" className="my-campaign-card-engagement-label">
                        Engajamento
                      </Text>
                      <Row gutter={[8, 8]}>
                        <Col span={12}>
                          <Tooltip title="Total de curtidas nos posts">
                            <div className="my-campaign-metric">
                              <HeartOutlined /> {formatShortNum(c.stats.totalLikes)}
                            </div>
                          </Tooltip>
                        </Col>
                        <Col span={12}>
                          <Tooltip title="Total de comentários">
                            <div className="my-campaign-metric">
                              <CommentOutlined /> {formatShortNum(c.stats.totalComments)}
                            </div>
                          </Tooltip>
                        </Col>
                        <Col span={12}>
                          <Tooltip title="Total de visualizações (reels)">
                            <div className="my-campaign-metric">
                              <EyeOutlined /> {formatShortNum(c.stats.totalViews)}
                            </div>
                          </Tooltip>
                        </Col>
                        <Col span={12}>
                          <Tooltip title="Seguidores somados">
                            <div className="my-campaign-metric">
                              <TeamOutlined /> {formatShortNum(c.stats.totalFollowers)}
                            </div>
                          </Tooltip>
                        </Col>
                        <Col span={12}>
                          <Tooltip title="Posts analisados">
                            <div className="my-campaign-metric">
                              <FileTextOutlined /> {formatShortNum(c.stats.postsCount)}
                            </div>
                          </Tooltip>
                        </Col>
                        <Col span={12}>
                          <Tooltip title="Taxa média de engajamento (%)">
                            <div className="my-campaign-metric">
                              <RiseOutlined /> {c.stats.avgEngagementRate.toFixed(2)}%
                            </div>
                          </Tooltip>
                        </Col>
                        {(c.stats.avgLikes > 0 || c.stats.avgComments > 0) && (
                          <Col span={24}>
                            <Text type="secondary" style={{ fontSize: 11 }}>
                              Média por perfil: {formatShortNum(c.stats.avgLikes)} likes · {formatShortNum(c.stats.avgComments)} comentários
                            </Text>
                          </Col>
                        )}
                      </Row>
                    </div>
                  )}
                  <div className={`my-campaign-card-footer${c.topHashtags && c.topHashtags.length > 0 ? ' my-campaign-card-footer-hashtags' : ''}`}>
                    {c.topHashtags && c.topHashtags.length > 0 ? (
                      <Text>
                        {c.topHashtags.map((h) => `#${h}`).join(' ')}
                      </Text>
                    ) : (
                      <Text type="secondary">Clique para ver os influenciadores</Text>
                    )}
                  </div>
                </Card>
              </Col>
            ))}
          </Row>
        </>
      )}
    </>
  )

  return (
    <div className={`my-campaigns-page${hasFavorites ? ' my-campaigns-split' : ''}`}>
      {hasFavorites && (
        <div className="my-campaigns-sidebar" style={{ width: '30%', minWidth: 200, maxWidth: 320, borderRight: '1px solid var(--app-border)', paddingRight: 16, flexShrink: 0 }}>
          <FavoriteProfilesList onEmpty={() => setHasFavorites(false)} />
        </div>
      )}
      <div className="my-campaigns-main" style={{ flex: 1, minWidth: 0 }}>
        {mainContent}
      </div>
    </div>
  )
}
