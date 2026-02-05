import { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Card,
  Row,
  Col,
  Spin,
  Typography,
  Empty,
  Button,
  Image,
  Space,
  Descriptions,
  Divider,
  Tag,
} from 'antd'
import {
  ArrowLeftOutlined,
  FileImageOutlined,
  HeartOutlined,
  CommentOutlined,
  EyeOutlined,
  CalendarOutlined,
  TagOutlined,
  LinkOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons'
import { fetchProfile, fetchPosts, getProfilePicUrl, proxyImageUrl, type ProfileItem, type PostItem } from '../api'
import ProfileSummaryCard, { type ProfileSummaryCardItem } from '../components/ProfileSummaryCard'
import { computeEngagementFromPosts } from '../utils/engagement'

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

export default function InfluencerDetail() {
  const { handle } = useParams<{ handle: string }>()
  const navigate = useNavigate()
  const [profileLoading, setProfileLoading] = useState(true)
  const [postsLoading, setPostsLoading] = useState(true)
  const [profile, setProfile] = useState<ProfileItem | null>(null)
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
    return () => {
      cancelled = true
    }
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
      .catch(() => {
        if (!cancelled) setPosts([])
      })
      .finally(() => {
        if (!cancelled) setPostsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [handle])

  const userData = profile?.data?.user as Record<string, unknown> | undefined
  const displayHandle = (profile?.handle ?? profile?.username ?? profile?.key ?? handle ?? '') as string
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

  const summaryCardItem: ProfileSummaryCardItem | null = profile
    ? {
      key: profile.key ?? displayHandle,
      handle: displayHandle,
      full_name: (profile.full_name ?? userData?.full_name) as string | undefined,
      profile_pic_url: getProfilePicUrl(profile) ?? undefined,
      data: profile.data,
      followers_count: followersCount,
      following_count: followingCount,
      media_count: mediaCount,
      biography: bio,
      categories,
      engagement,
    }
    : null

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

  return (
    <>
      <Space style={{ marginBottom: 24 }} wrap>
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/')}
        >
          Voltar
        </Button>
        <Button
          type="primary"
          icon={<LinkOutlined />}
          href={instagramUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Abrir perfil no Instagram
        </Button>
        {handle && (
          <Button
            icon={<CheckCircleOutlined />}
            onClick={() => navigate(`/activate/${encodeURIComponent(handle)}`)}
          >
            Finalizar cadastro / Ativar
          </Button>
        )}
      </Space>

      {summaryCardItem && (
        <div style={{ marginBottom: 24 }}>
          <ProfileSummaryCard item={summaryCardItem} variant="detail" />
        </div>
      )}

      <Card
        title={
          <Space>
            <TagOutlined />
            Hashtags capturadas
            {allHashtags.length > 0 && (
              <Text type="secondary" style={{ fontWeight: 'normal', fontSize: 14 }}>
                ({allHashtags.length})
              </Text>
            )}
          </Space>
        }
        style={{ marginBottom: 24 }}
      >
        {allHashtags.length === 0 ? (
          <Text type="secondary">Nenhuma hashtag encontrada nos posts analisados.</Text>
        ) : (
          <Space wrap size={[8, 8]}>
            {allHashtags.map((tag) => (
              <Tag key={tag}>#{tag}</Tag>
            ))}
          </Space>
        )}
      </Card>

      <Card title="Métricas completas" style={{ marginBottom: 24 }}>
        <Descriptions column={{ xs: 1, sm: 1, md: 2 }} bordered size="small">
          <Descriptions.Item label="Seguidores">{followersCount.toLocaleString('pt-BR')}</Descriptions.Item>
          <Descriptions.Item label="Seguindo">{followingCount != null ? followingCount.toLocaleString('pt-BR') : '—'}</Descriptions.Item>
          <Descriptions.Item label="Posts no perfil">{mediaCount != null ? mediaCount.toLocaleString('pt-BR') : '—'}</Descriptions.Item>
          <Descriptions.Item label="Posts analisados">{engagement.posts_count}</Descriptions.Item>
          <Descriptions.Item label="Taxa de engajamento">{engagement.engagement_rate.toFixed(2)}%</Descriptions.Item>
          <Descriptions.Item label="Total de likes">{engagement.total_likes.toLocaleString('pt-BR')}</Descriptions.Item>
          <Descriptions.Item label="Total de comentários">{engagement.total_comments.toLocaleString('pt-BR')}</Descriptions.Item>
          <Descriptions.Item label="Total de views">{engagement.total_views > 0 ? engagement.total_views.toLocaleString('pt-BR') : '—'}</Descriptions.Item>
          <Descriptions.Item label="Média likes/post">{engagement.avg_likes.toLocaleString('pt-BR')}</Descriptions.Item>
          <Descriptions.Item label="Média comentários/post">{engagement.avg_comments.toLocaleString('pt-BR')}</Descriptions.Item>
          <Descriptions.Item label="Média views/post">{engagement.avg_views > 0 ? engagement.avg_views.toLocaleString('pt-BR') : '—'}</Descriptions.Item>
          <Descriptions.Item label="Média posts/semana">
            {engagement.posts_per_week != null
              ? engagement.posts_per_week.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
              : '—'}
          </Descriptions.Item>
          <Descriptions.Item label="Interações (likes+coment.)">{(engagement.total_likes + engagement.total_comments).toLocaleString('pt-BR')}</Descriptions.Item>
          <Descriptions.Item label={<Space><CalendarOutlined /> Data da coleta</Space>}>
            {formatDate(collectedAt)}
          </Descriptions.Item>
          <Descriptions.Item label="Descoberto por">{discoveredBy ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="Valor (hashtag/local)">{discoveredValue ?? '—'}</Descriptions.Item>
        </Descriptions>
        {bio && (
          <>
            <Divider orientation="left">Biografia</Divider>
            <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>{bio}</Paragraph>
          </>
        )}
        {categories.length > 0 && (
          <>
            <Divider orientation="left"><TagOutlined /> Categorias</Divider>
            <Space wrap>
              {categories.map((c) => (
                <Typography.Text key={c}>{c}</Typography.Text>
              ))}
            </Space>
          </>
        )}
      </Card>

      <Title level={5} style={{ marginBottom: 16 }}>
        Posts ({postsTotal})
      </Title>
      {postsLoading ? (
        <div style={{ textAlign: 'center', padding: 32 }}>
          <Spin />
        </div>
      ) : posts.length === 0 ? (
        <Empty description="Nenhum post encontrado para este perfil." />
      ) : (
        <Row gutter={[16, 16]}>
          {posts.map((post) => {
            const imgUrl = getPostImageUrl(post)
            const link = getPostLink(post)
            const likes = post.metrics?.likes ?? 0
            const comments = post.metrics?.comments ?? 0
            const views = post.metrics?.view_count
            // Data de publicação (taken_at); fallback para caption_created_at ou collected_at em dados antigos
            const takenAt =
              post.post?.taken_at != null
                ? post.post.taken_at
                : post.content?.caption_created_at != null
                  ? post.content.caption_created_at
                  : post.post?.collected_at != null
                    ? (() => {
                      const d = new Date(post.post!.collected_at as string)
                      return Number.isNaN(d.getTime()) ? null : Math.floor(d.getTime() / 1000)
                    })()
                    : null

            return (
              <Col key={post.key} xs={24} sm={12} md={8} lg={6}>
                <Card
                  hoverable
                  size="small"
                  cover={
                    imgUrl ? (
                      <a href={link} target="_blank" rel="noopener noreferrer">
                        <Image
                          alt=""
                          src={imgUrl}
                          height={240}
                          style={{ objectFit: 'cover' }}
                          preview={false}
                        />
                      </a>
                    ) : (
                      <div style={{ height: 240, background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <FileImageOutlined style={{ fontSize: 48, color: '#bbb' }} />
                      </div>
                    )
                  }
                >
                  <Space>
                    <HeartOutlined />
                    <Text type="secondary">{likes.toLocaleString('pt-BR')}</Text>
                    <CommentOutlined />
                    <Text type="secondary">{comments.toLocaleString('pt-BR')}</Text>
                    {views != null && (
                      <>
                        <EyeOutlined />
                        <Text type="secondary">{Number(views).toLocaleString('pt-BR')}</Text>
                      </>
                    )}
                  </Space>
                  {takenAt != null && (
                    <div style={{ marginTop: 6, fontSize: 11, color: 'rgba(0,0,0,.45)' }}>
                      <CalendarOutlined /> {formatDate(takenAt)}
                    </div>
                  )}
                  {post.content?.caption_text && (
                    <Paragraph ellipsis={{ rows: 2 }} style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>
                      {post.content.caption_text}
                    </Paragraph>
                  )}
                </Card>
              </Col>
            )
          })}
        </Row>
      )}
    </>
  )
}
