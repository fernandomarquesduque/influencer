import {
  Card,
  Avatar,
  Tag,
  Space,
  Typography,
  Tooltip,
} from 'antd'
import {
  UserOutlined,
  HeartOutlined,
  CommentOutlined,
  EnvironmentOutlined,
  MessageOutlined,
  VideoCameraOutlined,
  FacebookOutlined,
  LinkedinOutlined,
  TwitterOutlined,
  SafetyOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons'
import { getProfilePicUrl, proxyImageUrl, type EngagementStats, type ProfileActivation } from '../api'
import { CONTENT_TYPE_LABELS } from '../constants/contentTypes'
import { getCostTier } from '../utils/pricing'

const { Text } = Typography

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

function formatShortNum(n: number | undefined | null): string {
  if (n == null) return '—'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k'
  return String(n)
}

/** Cor do engajamento: >70% verde, >40% amarelo, >0% rosa. */
function engagementColor(rate: number): string {
  if (rate > 70) return '#52c41a'   // verde
  if (rate > 40) return '#faad14'   // amarelo
  return '#eb2f96'                  // rosa
}

interface ProfileSummaryCardProps {
  item: ProfileSummaryCardItem
  variant?: 'list' | 'detail'
  onClick?: () => void
}

export default function ProfileSummaryCard({ item, variant = 'list', onClick }: ProfileSummaryCardProps) {
  const pic = proxyImageUrl(getProfilePicUrl(item as unknown as Record<string, unknown>))
  const name = (item.full_name || item.handle) as string
  const eng = item.engagement
  const categories = (Array.isArray(item.categories) ? item.categories : []) as string[]
  const avatarSize = variant === 'detail' ? 128 : 112
  const location = item.activation && (item.activation.city || item.activation.state)
    ? [item.activation.city, item.activation.state].filter(Boolean).join(', ')
    : null
  const userData = item.data?.user as Record<string, unknown> | undefined
  const isVerified = (item as unknown as Record<string, unknown>).is_verified === true || userData?.is_verified === true

  const cardContent = (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        flex: 1,
        minWidth: 0,
        padding: variant === 'list' ? 0 : undefined,
      }}
    >
      {/* Tipo de conteúdo e custo fixos no topo à esquerda (card lista) */}
      {(variant !== 'list' && item.activation?.content_type && item.activation.content_type.length > 0) && (() => {
        const tagColors = ['blue', 'green', 'orange', 'purple', 'cyan', 'magenta', 'gold', 'lime'] as const
        const list = item.activation.content_type!.slice(0, 8)
        const extra = item.activation.content_type!.length - list.length
        return (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              zIndex: 1,
            }}
          >
            {list.map((ct, i) => (
              <Tag key={ct} color={tagColors[i % tagColors.length]} style={{ margin: 0, fontSize: 10, borderRadius: 4 }}>
                {CONTENT_TYPE_LABELS[ct] ?? ct}
              </Tag>
            ))}
            {extra > 0 && (
              <Tag color="default" style={{ margin: 0, fontSize: 10 }}>+{extra}</Tag>
            )}
          </div>
        )
      })()}
      {variant === 'list' && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            zIndex: 1,
          }}
        >
          {(isVerified || item.activation?.pricing) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {isVerified && (
                <Tooltip title="Verificado">
                  <CheckCircleOutlined style={{ color: '#3897f0', fontSize: 16 }} />
                </Tooltip>
              )}
              {item.activation?.pricing && (() => {
                const cost = getCostTier(item.activation.pricing)
                if (!cost) return null
                return (
                  <Tooltip title={`Custo médio: ${cost.label}`}>
                    <Tag color="gold" style={{ margin: 0, fontSize: 10, fontWeight: 600 }}>
                      {cost.symbol}
                    </Tag>
                  </Tooltip>
                )
              })()}
            </div>
          )}
        </div>
      )}

      {/* Ícones de redes fixos no topo à direita */}
      {item.activation && (item.activation.whatsapp?.trim() || item.activation.tiktok?.trim() || item.activation.facebook?.trim() || item.activation.linkedin?.trim() || item.activation.twitter?.trim()) && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: 8,
            zIndex: 1,
          }}
        >
          {item.activation.whatsapp?.trim() && (
            <Tooltip title="WhatsApp">
              <MessageOutlined style={{ color: '#25D366', fontSize: 18 }} />
            </Tooltip>
          )}
          {item.activation.tiktok?.trim() && (
            <Tooltip title="TikTok">
              <VideoCameraOutlined style={{ color: '#000000', fontSize: 18 }} />
            </Tooltip>
          )}
          {item.activation.facebook?.trim() && (
            <Tooltip title="Facebook">
              <FacebookOutlined style={{ color: '#1877F2', fontSize: 18 }} />
            </Tooltip>
          )}
          {item.activation.linkedin?.trim() && (
            <Tooltip title="LinkedIn">
              <LinkedinOutlined style={{ color: '#0A66C2', fontSize: 18 }} />
            </Tooltip>
          )}
          {item.activation.twitter?.trim() && (
            <Tooltip title="X / Twitter">
              <TwitterOutlined style={{ color: '#1DA1F2', fontSize: 18 }} />
            </Tooltip>
          )}
        </div>
      )}

      {/* Topo: avatar + nome estilo rede social */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 12 }}>
        <Avatar
          size={avatarSize}
          src={pic}
          icon={<UserOutlined />}
          style={{
            flexShrink: 0,
            border: '3px solid #f0f0f0',
            boxShadow: '0 2px 8px rgba(0,0,0,.08)',
          }}
        />
        <div style={{ textAlign: 'center', marginTop: 10, width: '100%', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Text
              strong
              ellipsis
              style={{
                fontSize: variant === 'detail' ? 17 : 15,
                color: '#262626',
                maxWidth: '100%',
              }}
            >
              {name}
            </Text>
            {item.activation && (
              <Tooltip title="Ativado na plataforma">
                <SafetyOutlined style={{ color: '#52c41a', fontSize: 14, flexShrink: 0 }} />
              </Tooltip>
            )}
            {variant !== 'list' && item.activation?.pricing && (() => {
              const cost = getCostTier(item.activation.pricing)
              if (!cost) return null
              return (
                <Tooltip title={`Custo médio: ${cost.label}`}>
                  <Tag color="gold" style={{ margin: 0, fontWeight: 600 }}>
                    {cost.symbol} {cost.label}
                  </Tag>
                </Tooltip>
              )
            })()}
          </div>
          {location && (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                marginTop: 4,
                fontSize: 12,
                color: '#8e8e8e',
              }}
            >
              <EnvironmentOutlined style={{ fontSize: 12 }} />
              {location}
            </div>
          )}
          {((item.activation?.content_type && item.activation.content_type.length > 0) || categories.length > 0) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 4, marginTop: 8 }}>
              {item.activation?.content_type && item.activation.content_type.length > 0
                ? (() => {
                  const list = item.activation!.content_type!.slice(0, variant === 'list' ? 4 : 8)
                  const tagColors = ['blue', 'green', 'orange', 'purple', 'cyan', 'magenta', 'gold', 'lime'] as const
                  return (
                    <>
                      {list.map((ct, i) => (
                        <Tag key={ct} color={tagColors[i % tagColors.length]} style={{ margin: 0, fontSize: 10, borderRadius: 4 }}>
                          {CONTENT_TYPE_LABELS[ct] ?? ct}
                        </Tag>
                      ))}
                      {variant === 'list' && item.activation!.content_type!.length > 4 && (
                        <Tag color="default" style={{ margin: 0, fontSize: 10 }}>+{item.activation!.content_type!.length - 4}</Tag>
                      )}
                      {variant !== 'list' && item.activation!.content_type!.length > 8 && (
                        <Tag color="default" style={{ margin: 0, fontSize: 10 }}>+{item.activation!.content_type!.length - 8}</Tag>
                      )}
                    </>
                  )
                })()
                : categories.slice(0, 3).map((c, i) => {
                  const tagColors = ['blue', 'green', 'orange'] as const
                  return (
                    <Tag key={c} color={tagColors[i % 3]} style={{ margin: 0, fontSize: 10, borderRadius: 4 }}>
                      #{c}
                    </Tag>
                  )
                })}
            </div>
          )}
        </div>
      </div>

      {/* Área flexível: categorias no detail */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {variant !== 'list' && categories.length > 0 && (
          <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {categories.slice(0, 10).map((c) => (
              <Tag key={c}>{c}</Tag>
            ))}
          </div>
        )}
      </div>

      {/* Rodapé fixo: barra de métricas + curtidas/comentários + média */}
      <div
        style={{
          marginTop: 'auto',
          flexShrink: 0,
          paddingTop: 12,
          borderTop: '1px solid #f0f0f0',
        }}
      >
        {/* Barra: seguidores / engajamento / posts */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: 24,
            padding: '10px 0',
            marginBottom: 12,
            borderBottom: '1px solid #f0f0f0',
          }}
        >
          <Tooltip title="Seguidores">
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#262626' }}>
                {formatShortNum(item.followers_count)}
              </div>
              <div style={{ fontSize: 11, color: '#8e8e8e' }}>seguidores</div>
            </div>
          </Tooltip>
          <Tooltip title="Engajamento (likes + comentários / seguidores)">
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: engagementColor(eng.engagement_rate) }}>
                {eng.engagement_rate.toFixed(1)}%
              </div>
              <div style={{ fontSize: 11, color: '#8e8e8e' }}>engajamento</div>
            </div>
          </Tooltip>
          <Tooltip title="Posts analisados">
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#262626' }}>
                {eng.posts_count}
              </div>
              <div style={{ fontSize: 11, color: '#8e8e8e' }}>posts</div>
            </div>
          </Tooltip>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            flexWrap: 'wrap',
            marginBottom: 4,
          }}
        >
          <Space size={6}>
            <HeartOutlined style={{ color: '#eb2f96', fontSize: 14 }} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {formatShortNum(eng.total_likes)} curtidas
            </Text>
          </Space>
          <Space size={6}>
            <CommentOutlined style={{ color: '#1890ff', fontSize: 14 }} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {formatShortNum(eng.total_comments)} comentários
            </Text>
          </Space>
        </div>
        <Text type="secondary" style={{ fontSize: 11, textAlign: 'center', display: 'block' }}>
          Média {eng.avg_likes.toLocaleString('pt-BR')} likes/post
        </Text>
      </div>
    </div>
  )

  const cardStyle: React.CSSProperties = {
    height: variant === 'list' ? '100%' : undefined,
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    borderRadius: 12,
    overflow: 'hidden',
    boxShadow: '0 1px 3px rgba(0,0,0,.06)',
  }

  if (variant === 'list' && onClick) {
    return (
      <Card
        hoverable
        onClick={onClick}
        style={cardStyle}
        styles={{
          body: {
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            overflow: 'hidden',
            padding: '20px 16px',
          },
        }}
      >
        {cardContent}
      </Card>
    )
  }

  return (
    <Card style={{ ...cardStyle, marginBottom: 0 }} styles={{ body: { padding: '20px 16px' } }}>
      {cardContent}
    </Card>
  )
}
