import {
  Card,
  Row,
  Col,
  Avatar,
  Tag,
  Space,
  Typography,
  Divider,
  Tooltip,
  Progress,
} from 'antd'
import {
  UserOutlined,
  TeamOutlined,
  UserAddOutlined,
  FileImageOutlined,
  HeartOutlined,
  CommentOutlined,
  EyeOutlined,
  RiseOutlined,
  CalendarOutlined,
  EnvironmentOutlined,
  MessageOutlined,
  VideoCameraOutlined,
  FacebookOutlined,
  LinkedinOutlined,
  TwitterOutlined,
  SafetyOutlined,
} from '@ant-design/icons'
import { getProfilePicUrl, proxyImageUrl, type EngagementStats, type ProfileActivation } from '../api'
import { CONTENT_TYPE_LABELS } from '../constants/contentTypes'

const { Text, Paragraph } = Typography

export interface ProfileSummaryCardItem {
  key: string
  handle: string
  full_name?: string
  profile_pic_url?: string
  data?: Record<string, unknown>
  followers_count: number
  following_count?: number
  media_count?: number
  biography?: string
  categories?: string[]
  engagement: EngagementStats
  /** Quando presente, cadastro ativado na plataforma. */
  activation?: ProfileActivation
}

function stripEmojiAndTrim(s: string | undefined, max = 120): string {
  if (!s || typeof s !== 'string') return ''
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max) + '…' : t
}

function formatShortNum(n: number | undefined | null): string {
  if (n == null) return '—'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k'
  return String(n)
}

interface ProfileSummaryCardProps {
  item: ProfileSummaryCardItem
  variant?: 'list' | 'detail'
  onClick?: () => void
}

export default function ProfileSummaryCard({ item, variant = 'list', onClick }: ProfileSummaryCardProps) {
  const pic = proxyImageUrl(getProfilePicUrl(item))
  const name = (item.full_name || item.handle) as string
  const eng = item.engagement
  const bio = variant === 'list' ? stripEmojiAndTrim(item.biography) : (item.biography ?? '')
  // Barra reflete o próprio % de engajamento (0–100%); valores > 100% são limitados
  const engagementPercent = Math.min(100, eng.engagement_rate)
  const categories = (Array.isArray(item.categories) ? item.categories : []) as string[]
  const avatarSize = variant === 'detail' ? 80 : 56

  const cardContent = (
    <Space direction="vertical" size="small" style={{ width: '100%', flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, minWidth: 0 }}>
        <Avatar
          size={avatarSize}
          src={pic}
          icon={<UserOutlined />}
          referrerPolicy="no-referrer"
          style={{ flexShrink: 0 }}
        />
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <Text
              strong
              ellipsis
              style={{
                fontSize: variant === 'detail' ? 16 : undefined,
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                whiteSpace: 'nowrap',
              }}
            >
              @{item.handle}
            </Text>
            {item.activation && (item.activation.whatsapp?.trim() || item.activation.tiktok?.trim() || item.activation.facebook?.trim() || item.activation.linkedin?.trim() || item.activation.twitter?.trim()) && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                {item.activation.whatsapp?.trim() && (
                  <Tooltip title="WhatsApp">
                    <MessageOutlined style={{ color: '#25D366', fontSize: 14 }} />
                  </Tooltip>
                )}
                {item.activation.tiktok?.trim() && (
                  <Tooltip title="TikTok">
                    <VideoCameraOutlined style={{ color: '#000000', fontSize: 14 }} />
                  </Tooltip>
                )}
                {item.activation.facebook?.trim() && (
                  <Tooltip title="Facebook">
                    <FacebookOutlined style={{ color: '#1877F2', fontSize: 14 }} />
                  </Tooltip>
                )}
                {item.activation.linkedin?.trim() && (
                  <Tooltip title="LinkedIn">
                    <LinkedinOutlined style={{ color: '#0A66C2', fontSize: 14 }} />
                  </Tooltip>
                )}
                {item.activation.twitter?.trim() && (
                  <Tooltip title="X / Twitter">
                    <TwitterOutlined style={{ color: '#1DA1F2', fontSize: 14 }} />
                  </Tooltip>
                )}
              </span>
            )}
            {item.activation && (
              <Tooltip title="Ativado">
                <SafetyOutlined style={{ color: '#faad14', fontSize: 16, flexShrink: 0 }} />
              </Tooltip>
            )}
          </div>
          {name && name !== item.handle && (
            <Paragraph ellipsis={{ rows: 1 }} style={{ margin: 0, fontSize: 12, color: 'rgba(0,0,0,.55)' }}>
              {name}
            </Paragraph>
          )}
          {item.activation && (item.activation.city || item.activation.state) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
              <span style={{ fontSize: 11, color: 'rgba(0,0,0,.45)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <EnvironmentOutlined />
                {[item.activation.city, item.activation.state].filter(Boolean).join(', ')}
              </span>
            </div>
          )}
          {item.activation?.content_type && item.activation.content_type.length > 0 && (
            <div style={{ marginTop: 6 }}>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {item.activation.content_type.slice(0, variant === 'list' ? 4 : 12).map((ct) => (
                  <Tag key={ct} color="blue" style={{ margin: 0, fontSize: 10 }}>
                    {CONTENT_TYPE_LABELS[ct] ?? ct}
                  </Tag>
                ))}
                {item.activation.content_type.length > (variant === 'list' ? 4 : 12) && (
                  <Tag style={{ margin: 0, fontSize: 10 }}>+{item.activation.content_type.length - (variant === 'list' ? 4 : 12)}</Tag>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {bio && (
        <Paragraph
          ellipsis={variant === 'list' ? { rows: 2 } : false}
          style={{ margin: 0, fontSize: 12, color: 'rgba(0,0,0,.65)', wordBreak: 'break-word', overflowWrap: 'break-word' }}
        >
          {bio}
        </Paragraph>
      )}

      <Divider style={{ margin: '8px 0' }} />

      <Row gutter={8}>
        <Col span={6}>
          <Tooltip title="Seguidores">
            <div style={{ textAlign: 'center' }}>
              <TeamOutlined style={{ color: 'rgba(0,0,0,.45)' }} />
              <div style={{ fontSize: 11, fontWeight: 600 }}>{formatShortNum(item.followers_count)}</div>
            </div>
          </Tooltip>
        </Col>
        <Col span={6}>
          <Tooltip title="Seguindo">
            <div style={{ textAlign: 'center' }}>
              <UserAddOutlined style={{ color: 'rgba(0,0,0,.45)' }} />
              <div style={{ fontSize: 11, fontWeight: 600 }}>{formatShortNum(item.following_count)}</div>
            </div>
          </Tooltip>
        </Col>
        <Col span={6}>
          <Tooltip title="Posts no perfil">
            <div style={{ textAlign: 'center' }}>
              <FileImageOutlined style={{ color: 'rgba(0,0,0,.45)' }} />
              <div style={{ fontSize: 11, fontWeight: 600 }}>{formatShortNum(item.media_count)}</div>
            </div>
          </Tooltip>
        </Col>
        <Col span={6}>
          <Tooltip title="Média de posts por semana (pelos posts analisados)">
            <div style={{ textAlign: 'center' }}>
              <CalendarOutlined style={{ color: 'rgba(0,0,0,.45)' }} />
              <div style={{ fontSize: 11, fontWeight: 600 }}>
                {typeof eng.posts_per_week === 'number'
                  ? eng.posts_per_week.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
                  : '—'}
              </div>
              <div style={{ fontSize: 10, color: 'rgba(0,0,0,.45)' }}>posts/sem</div>
            </div>
          </Tooltip>
        </Col>
      </Row>

      <div>
        <Tooltip title="(likes + comentários) / seguidores × 100. Baseado nos posts analisados.">
          <Space align="center" size={4}>
            <RiseOutlined style={{ color: '#52c41a' }} />
            <Text strong>Engajamento: {eng.engagement_rate.toFixed(2)}%</Text>
          </Space>
        </Tooltip>
        <Progress percent={engagementPercent} showInfo={false} size="small" style={{ marginTop: 4 }} strokeColor="#52c41a" />
      </div>

      <Space size="large" wrap>
        <Space size={4}>
          <HeartOutlined />
          <Text type="secondary">{eng.total_likes.toLocaleString('pt-BR')}</Text>
        </Space>
        <Space size={4}>
          <CommentOutlined />
          <Text type="secondary">{eng.total_comments.toLocaleString('pt-BR')}</Text>
        </Space>
        {eng.total_views > 0 && (
          <Space size={4}>
            <EyeOutlined />
            <Text type="secondary">{eng.total_views.toLocaleString('pt-BR')}</Text>
          </Space>
        )}
      </Space>
      <Text type="secondary" style={{ fontSize: 11 }}>
        Média: {eng.avg_likes.toLocaleString('pt-BR')} likes / {eng.posts_count} posts
      </Text>

      {variant !== 'list' && categories.length > 0 && (
        <div>
          {categories.slice(0, 10).map((c) => (
            <Tag key={c}>{c}</Tag>
          ))}
        </div>
      )}
    </Space>
  )

  if (variant === 'list' && onClick) {
    return (
      <Card
        hoverable
        onClick={onClick}
        style={{ height: '100%', display: 'flex', flexDirection: 'column', minWidth: 0 }}
        styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' } }}
      >
        {cardContent}
      </Card>
    )
  }

  return (
    <Card style={{ marginBottom: 0 }}>
      {cardContent}
    </Card>
  )
}
