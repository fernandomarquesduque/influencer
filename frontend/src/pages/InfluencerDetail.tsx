import { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Spin,
  Typography,
  Empty,
  Button,
  Image,
  Space,
  Descriptions,
  Tag,
  Tabs,
  Avatar,
  Tooltip,
  Card,
  Row,
  Col,
} from 'antd'
import {
  ArrowLeftOutlined,
  FileImageOutlined,
  HeartOutlined,
  CommentOutlined,
  EyeOutlined,
  CalendarOutlined,
  LinkOutlined,
  CheckCircleOutlined,
  SafetyOutlined,
  MessageOutlined,
  VideoCameraOutlined,
  FacebookOutlined,
  LinkedinOutlined,
  TwitterOutlined,
  BarChartOutlined,
  TagOutlined,
  TeamOutlined,
  RiseOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { fetchProfile, fetchPosts, fetchProfileActivation, getProfilePicUrl, proxyImageUrl, type ProfileItem, type PostItem, type ProfileActivation } from '../api'
import { computeEngagementFromPosts } from '../utils/engagement'
import { CONTENT_TYPE_LABELS } from '../constants/contentTypes'

const { Title, Text, Paragraph } = Typography

function formatDate(isoOrTimestamp: string | number | undefined | null): string {
  if (isoOrTimestamp == null) return '—'
  const date = typeof isoOrTimestamp === 'number'
    ? new Date(isoOrTimestamp * 1000)
    : new Date(isoOrTimestamp)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatShortNum(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.', ',') + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace('.', ',') + 'k'
  return n.toLocaleString('pt-BR')
}

function getPostImageUrl(post: PostItem): string | undefined {
  const cover = post.media?.cover_images?.[0]?.url
  if (cover) return cover
  const video = post.media?.video_versions?.[0]?.url
  if (video) return video
  return (post as { image_url?: string }).image_url
}

function getPostLink(post: PostItem): string {
  const shortcode = post.post?.shortcode ?? post.key?.split(':')[1]
  if (shortcode) return `https://www.instagram.com/p/${shortcode}/`
  return '#'
}

/** Cor do engajamento por faixa */
function engagementColor(rate: number): string {
  if (rate >= 5) return '#52c41a'
  if (rate >= 2) return '#faad14'
  return '#eb2f96'
}

export default function InfluencerDetail() {
  const { handle } = useParams<{ handle: string }>()
  const navigate = useNavigate()
  const [profileLoading, setProfileLoading] = useState(true)
  const [postsLoading, setPostsLoading] = useState(true)
  const [profile, setProfile] = useState<ProfileItem | null>(null)
  const [activation, setActivation] = useState<ProfileActivation | null>(null)
  const [posts, setPosts] = useState<PostItem[]>([])
  const [postsTotal, setPostsTotal] = useState(0)

  useEffect(() => {
    if (!handle) return
    let cancelled = false
    setProfileLoading(true)
    fetchProfile(handle)
      .then((p) => {
        if (!cancelled) setProfile(p ?? null)
      })
      .finally(() => {
        if (!cancelled) setProfileLoading(false)
      })
    return () => { cancelled = true }
  }, [handle])

  useEffect(() => {
    if (!handle) return
    let cancelled = false
    fetchProfileActivation(handle)
      .then((a) => { if (!cancelled) setActivation(a && (a.city ?? a.whatsapp ?? a.content_type?.length) ? a : null) })
      .catch(() => { if (!cancelled) setActivation(null) })
    return () => { cancelled = true }
  }, [handle])

  useEffect(() => {
    if (!handle) return
    let cancelled = false
    setPostsLoading(true)
    fetchPosts(handle, 100, 0)
      .then((res) => {
        if (!cancelled) {
          setPosts(res.items)
          setPostsTotal(res.total)
        }
      })
      .catch(() => { if (!cancelled) setPosts([]) })
      .finally(() => { if (!cancelled) setPostsLoading(false) })
    return () => { cancelled = true }
  }, [handle])

  const userData = profile?.data?.user as Record<string, unknown> | undefined
  const displayHandle = (profile?.handle ?? profile?.username ?? profile?.key ?? handle ?? '') as string
  const fullName = (profile?.full_name ?? userData?.full_name) as string | undefined
  const followersCount = typeof profile?.followers_count === 'number'
    ? profile.followers_count
    : (typeof userData?.follower_count === 'number' ? userData.follower_count : 0)
  const followingCount = typeof profile?.following_count === 'number'
    ? profile.following_count
    : (typeof userData?.following_count === 'number' ? userData.following_count : undefined)
  const mediaCount = typeof profile?.media_count === 'number'
    ? profile.media_count
    : (typeof profile?.media_count_visible === 'number' ? profile.media_count_visible : (typeof userData?.media_count === 'number' ? userData.media_count : undefined))
  const categories = (Array.isArray(profile?.categories) ? profile.categories : []) as string[]
  const bio = (profile?.biography ?? userData?.biography) as string | undefined
  const externalUrl = (userData?.external_url ?? profile?.external_url) as string | undefined
  const isVerified = profile?.is_verified ?? userData?.is_verified
  const collectedAt = (profile as Record<string, unknown>)?._collected_at as string | undefined
  const discoveredBy = (profile as Record<string, unknown>)?._discovered_by as string | undefined
  const discoveredValue = (profile as Record<string, unknown>)?._discovered_value as string | undefined

  const engagement = useMemo(
    () => computeEngagementFromPosts(posts, followersCount),
    [posts, followersCount]
  )

  const allHashtags = useMemo(() => {
    const set = new Set<string>()
    for (const post of posts) {
      const hashtags = post.content?.hashtags
      if (Array.isArray(hashtags)) {
        for (const h of hashtags) {
          if (typeof h === 'string' && h.trim()) {
            const normalized = h.replace(/^#/, '').trim().toLowerCase()
            if (normalized) set.add(normalized)
          }
        }
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [posts])

  const loading = profileLoading || postsLoading
  if (loading && !profile && posts.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 48 }}>
        <Spin size="large" />
      </div>
    )
  }

  if (!profile && !profileLoading) {
    return (
      <Empty
        description="Perfil não encontrado"
        extra={<Button type="primary" onClick={() => navigate('/')}>Voltar à lista</Button>}
      />
    )
  }

  const instagramUrl = displayHandle ? `https://www.instagram.com/${displayHandle}/` : '#'
  const profilePic = proxyImageUrl(getProfilePicUrl(profile))

  const totalInteractions = engagement.total_likes + engagement.total_comments

  const hasActivationData = activation &&
    (activation.content_type?.length ||
      activation.city || activation.state || activation.neighborhood || activation.address || activation.country ||
      activation.whatsapp?.trim() || activation.tiktok?.trim() || activation.facebook?.trim() ||
      activation.linkedin?.trim() || activation.twitter?.trim() || activation.websites?.trim() ||
      activation.description?.trim() || activation.about_topics?.trim())

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto', padding: '0 24px 48px' }}>
      {/* 1) Contexto: quem é este relatório + ações imediatas */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/')} style={{ paddingLeft: 0, flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <Title level={4} style={{ margin: 0, fontWeight: 600, color: '#1a1a1a' }}>BI do influenciador</Title>
              <Text type="secondary" style={{ fontSize: 12 }}>Painel de métricas e desempenho</Text>
            </div>
          </div>
        </div>

        <Card size="small" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 20, justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0, flex: 1 }}>
              <Avatar size={136} src={profilePic} style={{ border: '2px solid #f0f0f0', flexShrink: 0 }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Text strong style={{ fontSize: 17 }}>{fullName || displayHandle}</Text>
                  {isVerified && <Tooltip title="Verificado"><span style={{ color: '#3897f0' }}>✓</span></Tooltip>}
                  {hasActivationData && <Tooltip title="Cadastro ativo"><SafetyOutlined style={{ color: '#52c41a' }} /></Tooltip>}
                </div>
                <Text type="secondary" style={{ fontSize: 13 }}>@{displayHandle}</Text>
                {bio && (
                  <Paragraph style={{ margin: '6px 0 0', fontSize: 13, color: '#595959', whiteSpace: 'pre-wrap', maxWidth: 560 }}>
                    {bio}
                  </Paragraph>
                )}

              </div>
            </div>
            <Space wrap size="middle">
              <Button type="primary" icon={<LinkOutlined />} href={instagramUrl} target="_blank" rel="noopener noreferrer">
                Abrir no Instagram
              </Button>
              {handle && (
                <Button icon={<CheckCircleOutlined />} onClick={() => navigate(`/activate/${encodeURIComponent(handle)}`)}>
                  {hasActivationData ? 'Editar cadastro' : 'Finalizar cadastro'}
                </Button>
              )}
            </Space>
          </div>
        </Card>
      </div>

      {/* 2) Métricas de decisão (o que importa primeiro) */}
      <div style={{ marginBottom: 24 }}>
        <Text type="secondary" style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.5px', display: 'block', marginBottom: 10 }}>RESUMO EXECUTIVO</Text>
        <Row gutter={[12, 12]}>
          <Col xs={24} sm={12} lg={8}>
            <Card size="small" style={{ height: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ width: 48, height: 48, borderRadius: 10, background: '#e6f4ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <TeamOutlined style={{ fontSize: 22, color: '#1677ff' }} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>Alcance</Text>
                  <div style={{ fontSize: 22, fontWeight: 700, color: '#1a1a1a', lineHeight: 1.2 }}>{formatShortNum(followersCount)}</div>
                  <Text type="secondary" style={{ fontSize: 11 }}>seguidores</Text>
                </div>
              </div>
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={8}>
            <Card size="small" style={{ height: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ width: 48, height: 48, borderRadius: 10, background: '#f6ffed', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <RiseOutlined style={{ fontSize: 22, color: engagementColor(engagement.engagement_rate) }} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>Engajamento</Text>
                  <div style={{ fontSize: 22, fontWeight: 700, color: engagementColor(engagement.engagement_rate), lineHeight: 1.2 }}>{engagement.engagement_rate.toFixed(2)}%</div>
                  <Text type="secondary" style={{ fontSize: 11 }}>taxa média</Text>
                </div>
              </div>
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={8}>
            <Card size="small" style={{ height: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ width: 48, height: 48, borderRadius: 10, background: '#fff7e6', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <ThunderboltOutlined style={{ fontSize: 22, color: '#fa8c16' }} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>Interações</Text>
                  <div style={{ fontSize: 22, fontWeight: 700, color: '#1a1a1a', lineHeight: 1.2 }}>{totalInteractions.toLocaleString('pt-BR')}</div>
                  <Text type="secondary" style={{ fontSize: 11 }}>likes + comentários</Text>
                </div>
              </div>
            </Card>
          </Col>
        </Row>
        <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
          <Col xs={24} sm={8}>
            <Card size="small">
              <Text type="secondary" style={{ fontSize: 11 }}>Média likes/post</Text>
              <div style={{ fontSize: 18, fontWeight: 600, color: '#1a1a1a', marginTop: 2 }}>{engagement.avg_likes.toLocaleString('pt-BR')}</div>
            </Card>
          </Col>
          <Col xs={24} sm={8}>
            <Card size="small">
              <Text type="secondary" style={{ fontSize: 11 }}>Posts na análise</Text>
              <div style={{ fontSize: 18, fontWeight: 600, color: '#1a1a1a', marginTop: 2 }}>{engagement.posts_count}</div>
            </Card>
          </Col>
          {mediaCount != null && (
            <Col xs={24} sm={8}>
              <Card size="small">
                <Text type="secondary" style={{ fontSize: 11 }}>Publicações no perfil</Text>
                <div style={{ fontSize: 18, fontWeight: 600, color: '#1a1a1a', marginTop: 2 }}>{formatShortNum(mediaCount)}</div>
              </Card>
            </Col>
          )}
        </Row>
      </div>

      {/* 3) Métricas de referência (linha inteira) */}
      <div style={{ marginBottom: 24 }}>
        <Text type="secondary" style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.5px', display: 'block', marginBottom: 10 }}>MÉTRICAS DE REFERÊNCIA</Text>
        <Card size="small" styles={{ body: { padding: '20px 24px' } }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '20px 32px' }}>
            <div><Text type="secondary" style={{ fontSize: 11 }}>Seguidores</Text><div style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>{followersCount.toLocaleString('pt-BR')}</div></div>
            {followingCount != null && (
              <div><Text type="secondary" style={{ fontSize: 11 }}>Seguindo</Text><div style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>{followingCount.toLocaleString('pt-BR')}</div></div>
            )}
            {mediaCount != null && (
              <div><Text type="secondary" style={{ fontSize: 11 }}>Posts no perfil</Text><div style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>{mediaCount.toLocaleString('pt-BR')}</div></div>
            )}
            <div><Text type="secondary" style={{ fontSize: 11 }}>Posts analisados</Text><div style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>{engagement.posts_count}</div></div>
            <div><Text type="secondary" style={{ fontSize: 11 }}>Taxa de engajamento</Text><div style={{ fontSize: 15, fontWeight: 600, marginTop: 2, color: engagementColor(engagement.engagement_rate) }}>{engagement.engagement_rate.toFixed(2)}%</div></div>
            <div><Text type="secondary" style={{ fontSize: 11 }}>Total de likes</Text><div style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>{engagement.total_likes.toLocaleString('pt-BR')}</div></div>
            <div><Text type="secondary" style={{ fontSize: 11 }}>Total de comentários</Text><div style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>{engagement.total_comments.toLocaleString('pt-BR')}</div></div>
            {engagement.total_views > 0 && (
              <div><Text type="secondary" style={{ fontSize: 11 }}>Total de views</Text><div style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>{engagement.total_views.toLocaleString('pt-BR')}</div></div>
            )}
            <div><Text type="secondary" style={{ fontSize: 11 }}>Média likes/post</Text><div style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>{engagement.avg_likes.toLocaleString('pt-BR')}</div></div>
            <div><Text type="secondary" style={{ fontSize: 11 }}>Média comentários/post</Text><div style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>{engagement.avg_comments.toLocaleString('pt-BR')}</div></div>
            {engagement.avg_views > 0 && (
              <div><Text type="secondary" style={{ fontSize: 11 }}>Média views/post</Text><div style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>{engagement.avg_views.toLocaleString('pt-BR')}</div></div>
            )}
            {engagement.posts_per_week != null && (
              <div><Text type="secondary" style={{ fontSize: 11 }}>Média posts/semana</Text><div style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>{engagement.posts_per_week.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</div></div>
            )}
          </div>
          {(collectedAt && formatDate(collectedAt) !== '—') || discoveredBy || discoveredValue ? (
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #f0f0f0', display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'space-between', alignItems: 'flex-start' }}>
              {discoveredValue && (
                <div><Text type="secondary" style={{ fontSize: 11 }}>Descoberto Por</Text><div style={{ fontSize: 13, marginTop: 2 }}>{discoveredValue}</div></div>
              )}
              {collectedAt && formatDate(collectedAt) !== '—' && (
                <div style={{ marginLeft: 'auto', textAlign: 'right' }}><Text type="secondary" style={{ fontSize: 11 }}>Data da coleta</Text><div style={{ fontSize: 13, marginTop: 2 }}><CalendarOutlined style={{ marginRight: 4 }} />{formatDate(collectedAt)}</div></div>
              )}
            </div>
          ) : null}
        </Card>
      </div>

      {/* 4) Contato e cadastro (linha inteira) */}
      <div style={{ marginBottom: 24 }}>
        <Text type="secondary" style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.5px', display: 'block', marginBottom: 10 }}>CONTATO E CADASTRO</Text>
        {hasActivationData ? (
          <Card size="small">
            <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <SafetyOutlined style={{ color: '#52c41a', fontSize: 16 }} />
              <Text strong>Dados da ativação</Text>
            </div>
            <Descriptions column={1} bordered size="small" style={{ marginBottom: 0 }}>
              {(activation!.city || activation!.state || activation!.neighborhood || activation!.country) && (
                <Descriptions.Item label="Localização">
                  {[activation!.city, activation!.state, activation!.neighborhood, activation!.country].filter(Boolean).join(', ') || '—'}
                </Descriptions.Item>
              )}
              {activation!.address && <Descriptions.Item label="Endereço">{activation!.address}</Descriptions.Item>}
              {activation!.content_type && activation!.content_type.length > 0 && (
                <Descriptions.Item label="Tipo de conteúdo">
                  <Space wrap size={[6, 6]}>
                    {activation!.content_type.map((ct) => (
                      <Tag key={ct} color="blue">{CONTENT_TYPE_LABELS[ct] ?? ct}</Tag>
                    ))}
                  </Space>
                </Descriptions.Item>
              )}
              {activation!.whatsapp?.trim() && (
                <Descriptions.Item label="WhatsApp"><Space><MessageOutlined style={{ color: '#25D366' }} />{activation!.whatsapp}</Space></Descriptions.Item>
              )}
              {activation!.tiktok?.trim() && (
                <Descriptions.Item label="TikTok"><Space><VideoCameraOutlined />{activation!.tiktok}</Space></Descriptions.Item>
              )}
              {activation!.facebook?.trim() && (
                <Descriptions.Item label="Facebook"><Space><FacebookOutlined style={{ color: '#1877F2' }} />{activation!.facebook}</Space></Descriptions.Item>
              )}
              {activation!.linkedin?.trim() && (
                <Descriptions.Item label="LinkedIn"><Space><LinkedinOutlined style={{ color: '#0A66C2' }} />{activation!.linkedin}</Space></Descriptions.Item>
              )}
              {activation!.twitter?.trim() && (
                <Descriptions.Item label="X / Twitter"><Space><TwitterOutlined style={{ color: '#1DA1F2' }} />{activation!.twitter}</Space></Descriptions.Item>
              )}
              {activation!.websites?.trim() && <Descriptions.Item label="Websites">{activation!.websites}</Descriptions.Item>}
              {activation!.description?.trim() && <Descriptions.Item label="Descrição">{activation!.description}</Descriptions.Item>}
              {activation!.about_topics?.trim() && <Descriptions.Item label="Temas">{activation!.about_topics}</Descriptions.Item>}
              {activation!.activated_at && <Descriptions.Item label="Ativado em">{formatDate(activation!.activated_at)}</Descriptions.Item>}
              {activation!.updated_at && <Descriptions.Item label="Atualizado em">{formatDate(activation!.updated_at)}</Descriptions.Item>}
            </Descriptions>
          </Card>
        ) : (
          <Card size="small" style={{ background: '#fafafa' }}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
              Nenhum dado de cadastro ainda. O influenciador pode preencher contato e tipo de conteúdo ao finalizar o cadastro.
            </Text>
            {handle && (
              <Button type="primary" ghost icon={<CheckCircleOutlined />} onClick={() => navigate(`/activate/${encodeURIComponent(handle)}`)} block>
                Abrir cadastro
              </Button>
            )}
          </Card>
        )}
      </div>

      {/* Conteúdo analisado (temas e hashtags — base das métricas) — só exibe se houver dados */}
      {(categories.length > 0 || allHashtags.length > 0) && (
        <div style={{ marginBottom: 24 }}>
          <Text type="secondary" style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.5px', display: 'block', marginBottom: 10 }}>CONTEÚDO ANALISADO</Text>
          <Card size="small">
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
              Temas e hashtags extraídos dos posts usados no cálculo das métricas acima.
            </Text>
            {categories.length > 0 && (
              <div style={{ marginBottom: allHashtags.length > 0 ? 12 : 0 }}>
                <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>Categorias</Text>
                <Space wrap size={[6, 6]}>
                  {categories.map((c) => <Tag key={c}>{c}</Tag>)}
                </Space>
              </div>
            )}
            {allHashtags.length > 0 && (
              <div>
                <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                  <TagOutlined style={{ marginRight: 4 }} /> Hashtags ({allHashtags.length})
                </Text>
                <Space wrap size={[6, 6]}>
                  {allHashtags.map((tag) => <Tag key={tag}>#{tag}</Tag>)}
                </Space>
              </div>
            )}
          </Card>
        </div>
      )}



      <Tabs
        defaultActiveKey="posts"
        items={[
          {
            key: 'posts',
            label: (
              <span>
                <FileImageOutlined style={{ marginRight: 6 }} />
                Publicações
                {postsTotal > 0 && (
                  <Text type="secondary" style={{ marginLeft: 6, fontWeight: 'normal' }}>
                    ({postsTotal})
                  </Text>
                )}
              </span>
            ),
            children: (
              <>
                {postsLoading ? (
                  <div style={{ textAlign: 'center', padding: 48 }}>
                    <Spin />
                  </div>
                ) : posts.length === 0 ? (
                  <Empty description="Nenhum post encontrado para este perfil." style={{ padding: 48 }} />
                ) : (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, 1fr)',
                      gap: 4,
                    }}
                  >
                    {posts.map((post) => {
                      const imgUrl = getPostImageUrl(post)
                      const link = getPostLink(post)
                      const likes = post.metrics?.likes ?? 0
                      const comments = post.metrics?.comments ?? 0
                      const views = post.metrics?.view_count
                      return (
                        <a
                          key={post.key}
                          href={link}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            aspectRatio: '1',
                            position: 'relative',
                            display: 'block',
                            overflow: 'hidden',
                            background: '#f0f0f0',
                          }}
                        >
                          {imgUrl ? (
                            <Image
                              alt=""
                              src={proxyImageUrl(imgUrl)}
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              preview={false}
                            />
                          ) : (
                            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <FileImageOutlined style={{ fontSize: 40, color: '#bbb' }} />
                            </div>
                          )}
                          <div
                            style={{
                              position: 'absolute',
                              inset: 0,
                              background: 'rgba(0,0,0,.35)',
                              opacity: 0,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: 20,
                              color: '#fff',
                              fontWeight: 600,
                              transition: 'opacity 0.2s',
                            }}
                            className="post-hover-overlay"
                          >
                            <span><HeartOutlined style={{ marginRight: 6 }} />{formatShortNum(likes)}</span>
                            <span><CommentOutlined style={{ marginRight: 6 }} />{formatShortNum(comments)}</span>
                            {views != null && <span><EyeOutlined style={{ marginRight: 6 }} />{formatShortNum(Number(views))}</span>}
                          </div>
                        </a>
                      )
                    })}
                  </div>
                )}
              </>
            ),
          },
        ]}
      />

      <style>{`
        a:hover .post-hover-overlay { opacity: 1 !important; }
      `}</style>
    </div>
  )
}
