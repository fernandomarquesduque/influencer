import {
  Card,
  Tag,
  Space,
  Typography,
  Tooltip,
  Button,
} from 'antd'
import {
  HeartOutlined,
  HeartFilled,
  CommentOutlined,
  EnvironmentOutlined,
  MessageOutlined,
  VideoCameraOutlined,
  FacebookOutlined,
  LinkedinOutlined,
  TwitterOutlined,
  SafetyOutlined,
} from '@ant-design/icons'
import { getProfilePicUrl, getStableProfilePicUrl, proxyImageUrl, type EngagementStats, type ProfileActivation, type ProfileListItem } from '../api'
import { getLlmDescriptionLine } from '../utils/mapProfileListToPreviewItems'
import { campaignLlmBadgeStyles, getLlmContentPillarLabels, getLlmGenderBadge, getLlmMainCategoryLabel, getLlmProfileTypeBadge } from '../utils/campaignLlmBadges'
import { CONTENT_TYPE_LABELS } from '../constants/contentTypes'
import { getCostTier } from '../utils/pricing'
import { getSuggestedPricingFromFollowers } from '../constants/pricingBuckets'
import type { PricingData } from '../api'
import ProfileAvatar from './ProfileAvatar'
import { getInfluencerTierGradientCss, getInfluencerTierShort } from '../utils/influencerTier'

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
  if (rate > 70) return 'var(--app-rate-high)'
  if (rate > 40) return 'var(--app-rate-mid)'
  return 'var(--app-rate-low)'
}

interface ProfileSummaryCardProps {
  item: ProfileSummaryCardItem
  variant?: 'list' | 'detail'
  onClick?: () => void
  /** Chamado quando a foto falha e um refresh é enfileirado; recebe o handle para a listagem atualizar só esse item. */
  onImageRefreshQueued?: (handle: string) => void
  /** Se false, não exibe métricas (usuário não logado). */
  showMetrics?: boolean
  /** Se true, exibe o coração preenchido; se false, outline. Só usado quando onFavoriteToggle está definido. */
  isFavorite?: boolean
  /** Quando definido, exibe botão de coração para favoritar/desfavoritar. */
  onFavoriteToggle?: (handle: string) => void
}

export default function ProfileSummaryCard({ item, variant = 'list', onClick, onImageRefreshQueued, showMetrics = true, isFavorite = false, onFavoriteToggle }: ProfileSummaryCardProps) {
  const pic = proxyImageUrl(getProfilePicUrl(item as unknown as Record<string, unknown>))
  const stablePic = getStableProfilePicUrl(item as unknown as Record<string, unknown>)
  const name = (item.full_name || item.handle) as string
  const eng = item.engagement
  const categories = (Array.isArray(item.categories) ? item.categories : []) as string[]
  const avatarSize = variant === 'detail' ? 128 : 56

  const location = item.activation && (item.activation.city || item.activation.state)
    ? [item.activation.city, item.activation.state].filter(Boolean).join(', ')
    : null
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

      {/* Tipo + gênero LLM: canto superior esquerdo, empilhados (lista / grade campanha) */}
      {variant === 'list' && (() => {
        const tipo = getLlmProfileTypeBadge(item as unknown as ProfileListItem)
        const gen = getLlmGenderBadge(item as unknown as ProfileListItem)
        if (!tipo && !gen) return null
        const pill = (st: ReturnType<typeof campaignLlmBadgeStyles>) => ({
          display: 'inline-block' as const,
          maxWidth: '100%',
          fontSize: 9,
          fontWeight: 600,
          lineHeight: 1.35,
          padding: '2px 6px',
          borderRadius: 999,
          whiteSpace: 'normal' as const,
          wordBreak: 'break-word' as const,
          textAlign: 'left' as const,
          border: st.border,
          color: st.color,
          background: st.background,
        })
        return (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              zIndex: 2,
              maxWidth: 'min(52%, calc(100% - 44px))',
              pointerEvents: 'auto',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 4,
            }}
          >
            {tipo ? (
              <Tooltip title={tipo.title}>
                <span style={pill(campaignLlmBadgeStyles(tipo.text))}>{tipo.text}</span>
              </Tooltip>
            ) : null}
            {gen ? (
              <Tooltip title={gen.title}>
                <span style={pill(campaignLlmBadgeStyles(gen.text))}>{gen.text}</span>
              </Tooltip>
            ) : null}
          </div>
        )
      })()}

      {/* Topo à direita: ícones de redes (tabela tem só WhatsApp/TikTok) + botão favoritar */}
      {(onFavoriteToggle && variant === 'list' && (item.handle ?? item.key)) || (item.activation && (variant === 'list' ? (item.activation.whatsapp?.trim() || item.activation.tiktok?.trim()) : (item.activation.whatsapp?.trim() || item.activation.tiktok?.trim() || item.activation.facebook?.trim() || item.activation.linkedin?.trim() || item.activation.twitter?.trim()))) ? (
        <div
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            flexWrap: 'wrap',
            justifyContent: 'flex-end',
            zIndex: 1,
          }}
        >
          {item.activation?.whatsapp?.trim() && (
            <Tooltip title="WhatsApp">
              <MessageOutlined style={{ color: 'var(--app-icon-whatsapp)', fontSize: variant === 'list' ? 14 : 18 }} />
            </Tooltip>
          )}
          {item.activation?.tiktok?.trim() && (
            <Tooltip title="TikTok">
              <VideoCameraOutlined style={{ color: 'var(--app-icon-instagram)', fontSize: variant === 'list' ? 14 : 18 }} />
            </Tooltip>
          )}
          {variant !== 'list' && item.activation?.facebook?.trim() && (
            <Tooltip title="Facebook">
              <FacebookOutlined style={{ color: 'var(--app-icon-facebook)', fontSize: 18 }} />
            </Tooltip>
          )}
          {variant !== 'list' && item.activation?.linkedin?.trim() && (
            <Tooltip title="LinkedIn">
              <LinkedinOutlined style={{ color: 'var(--app-icon-linkedin)', fontSize: 18 }} />
            </Tooltip>
          )}
          {variant !== 'list' && item.activation?.twitter?.trim() && (
            <Tooltip title="X / Twitter">
              <TwitterOutlined style={{ color: 'var(--app-icon-twitter)', fontSize: 18 }} />
            </Tooltip>
          )}
          {onFavoriteToggle && variant === 'list' && (item.handle ?? item.key) && (
            <Tooltip title={isFavorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}>
              <Button
                type="text"
                size="small"
                icon={isFavorite ? <HeartFilled style={{ color: 'var(--app-primary)' }} /> : <HeartOutlined style={{ color: 'var(--app-text-secondary)', fontSize: 18 }} />}
                onClick={(e) => {
                  e.stopPropagation()
                  onFavoriteToggle(item.handle ?? item.key)
                }}
                style={{ minWidth: 32, height: 32, padding: 0 }}
              />
            </Tooltip>
          )}
        </div>
      ) : null}

      {/* Topo: avatar + nome estilo rede social — loader até a imagem ser resolvida (onLoad) */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: variant === 'list' ? 6 : 12 }}>
        <ProfileAvatar
          src={pic}
          stableBackgroundUrl={stablePic}
          handle={item.handle ?? item.key}
          size={avatarSize}
          border={variant === 'list' ? '2px solid var(--app-placeholder-bg)' : '3px solid var(--app-placeholder-bg)'}
          shadow="var(--app-shadow-xl)"
          onRefreshQueued={onImageRefreshQueued}
        />
        {variant === 'list' && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: '-5px', position: 'relative', zIndex: 2 }}>
            <span
              style={{
                fontSize: 9,
                fontWeight: 600,
                color: '#fff',
                padding: '1px 5px',
                borderRadius: 8,
                background: getInfluencerTierGradientCss(getInfluencerTierShort(item.followers_count)),
              }}
            >
              {getInfluencerTierShort(item.followers_count)}
            </span>
          </div>
        )}
        <div style={{ textAlign: 'center', marginTop: variant === 'list' ? 4 : 10, width: '100%', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Text
              strong
              ellipsis
              style={{
                fontSize: variant === 'detail' ? 17 : variant === 'list' ? 13 : 15,
                color: 'var(--app-text)',
                maxWidth: '100%',
              }}
            >
              {name}
            </Text>
            {variant !== 'list' && item.activation && (
              <Tooltip title="Ativado na plataforma">
                <SafetyOutlined style={{ color: 'var(--app-icon-success)', fontSize: 14, flexShrink: 0 }} />
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
          {variant === 'list' && (() => {
            const catLabel = getLlmMainCategoryLabel(item as unknown as ProfileListItem)
            const pillarLabels = getLlmContentPillarLabels(item as unknown as ProfileListItem)
            if (!catLabel && pillarLabels.length === 0) return null
            const badgeBase = {
              display: 'inline-block' as const,
              maxWidth: '100%',
              fontSize: 10,
              fontWeight: 600,
              lineHeight: 1.35,
              padding: '2px 7px',
              borderRadius: 999,
              whiteSpace: 'normal' as const,
              wordBreak: 'break-word' as const,
              textAlign: 'center' as const,
            }
            return (
              <div
                style={{
                  marginTop: 4,
                  display: 'flex',
                  flexWrap: 'wrap',
                  justifyContent: 'center',
                  alignItems: 'center',
                  gap: '5px 6px',
                  maxWidth: '100%',
                }}
              >
                {catLabel ? (
                  <Tooltip title="Categoria principal">
                    <span style={{ ...badgeBase, ...campaignLlmBadgeStyles(catLabel) }}>{catLabel}</span>
                  </Tooltip>
                ) : null}
                {pillarLabels.map((pillar) => (
                  <Tooltip key={pillar} title="Pilar de conteúdo">
                    <span style={{ ...badgeBase, ...campaignLlmBadgeStyles(pillar) }}>{pillar}</span>
                  </Tooltip>
                ))}
              </div>
            )
          })()}
          {variant === 'list' && (() => {
            const llm = getLlmDescriptionLine(item as unknown as ProfileListItem)
            if (!llm) return null
            return (
              <Tooltip title={llm.tooltip ?? llm.line}>
                <div
                  style={{
                    marginTop: 4,
                    fontSize: 10,
                    lineHeight: 1.45,
                    color: 'var(--app-text-tertiary, #6b7280)',
                    wordBreak: 'break-word',
                    overflowWrap: 'anywhere',
                    maxWidth: '100%',
                    textAlign: 'center',
                  }}
                >
                  {llm.line}
                </div>
              </Tooltip>
            )
          })()}
          {location && (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                marginTop: variant === 'list' ? 2 : 4,
                fontSize: variant === 'list' ? 10 : 12,
                color: 'var(--app-text-tertiary)',
              }}
            >
              <EnvironmentOutlined style={{ fontSize: 12 }} />
              {location}
            </div>
          )}
          {variant !== 'list' && ((item.activation?.content_type && item.activation.content_type.length > 0) || (categories?.length ?? 0) > 0) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 4, marginTop: 8 }}>
              {item.activation?.content_type && item.activation.content_type.length > 0
                ? (() => {
                  const list = item.activation!.content_type!.slice(0, 8)
                  const tagColors = ['blue', 'green', 'orange', 'purple', 'cyan', 'magenta', 'gold', 'lime'] as const
                  return (
                    <>
                      {list.map((ct, i) => (
                        <Tag key={ct} color={tagColors[i % tagColors.length]} style={{ margin: 0, fontSize: 10, borderRadius: 4 }}>
                          {CONTENT_TYPE_LABELS[ct] ?? ct}
                        </Tag>
                      ))}
                      {item.activation!.content_type!.length > 8 && (
                        <Tag color="default" style={{ margin: 0, fontSize: 10 }}>+{item.activation!.content_type!.length - 8}</Tag>
                      )}
                    </>
                  )
                })()
                : (categories ?? []).slice(0, 3).map((c, i) => {
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

      {/* Rodapé fixo: barra de métricas + curtidas/comentários + média (ou placeholder se não logado) */}
      <div
        style={{
          marginTop: 'auto',
          flexShrink: 0,
          paddingTop: variant === 'list' ? 8 : 12,
          borderTop: '1px solid var(--app-border)',
        }}
      >
        {showMetrics ? (
          <>
            {/* Barra de métricas: mesma ordem da tabela — Seg, Eng, Like, Com, Posts (avg), Preço */}
            {variant === 'list' ? (
              (() => {
                const fc = item.followers_count ?? 0
                const hasPricing = item.activation?.pricing && typeof item.activation.pricing === 'object' && Object.values(item.activation.pricing).some((v) => v !== undefined && v !== null && v !== '')
                const costTier = hasPricing ? getCostTier(item.activation!.pricing as PricingData) : Number.isFinite(fc) && fc >= 0 ? getCostTier(getSuggestedPricingFromFollowers(fc) as unknown as PricingData) : null
                const costTierColor = costTier?.tier === 'low' ? '#d48806' : costTier?.tier === 'medium' ? '#389e0d' : costTier?.tier === 'high' || costTier?.tier === 'very_high' ? '#cf1322' : undefined
                const priceLabel = costTier ? (() => { const t = costTier.label.trim(); return t.charAt(0).toUpperCase() + t.slice(1); })() : '—'
                const metrics = [
                  { val: formatShortNum(item.followers_count), label: 'Seguidores', title: 'Seguidores' },
                  { val: `${eng.engagement_rate.toFixed(1)}%`, label: 'Engajamento', title: 'Engajamento', color: engagementColor(eng.engagement_rate) },
                  { val: formatShortNum(eng.total_likes), label: 'Likes', title: 'Total curtidas' },
                  { val: formatShortNum(eng.total_comments), label: 'Comentários', title: 'Total comentários' },
                  { val: formatShortNum(eng.avg_likes), label: 'Posts', title: 'Média likes/post' },
                  { val: priceLabel, label: 'Preço', title: 'Faixa de preço', color: costTierColor },
                ]
                const h = item.handle ?? item.key
                return (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, fontSize: 10, textAlign: 'center' }}>
                      {metrics.map((m, i) => (
                        <Tooltip key={i} title={m.title}>
                          <div>
                            <div style={{ fontWeight: 700, color: m.color ?? 'var(--app-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.val}</div>
                            <div style={{ fontSize: 9, color: 'var(--app-text-tertiary)' }}>{m.label}</div>
                          </div>
                        </Tooltip>
                      ))}
                    </div>
                    {h ? (
                      <div style={{ marginTop: 8, textAlign: 'center', minWidth: 0 }}>
                        <Tooltip title={`@${h}`}>
                          <span
                            style={{
                              fontSize: 11,
                              color: 'var(--app-text-secondary)',
                              display: 'inline-block',
                              maxWidth: '100%',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            @{h}
                          </span>
                        </Tooltip>
                      </div>
                    ) : null}
                  </>
                )
              })()
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, padding: '10px 0', marginBottom: 12, borderBottom: '1px solid var(--app-border)' }}>
                  <Tooltip title="Seguidores">
                    <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--app-text)' }}>{formatShortNum(item.followers_count)}</div>
                      <div style={{ fontSize: 10, color: 'var(--app-text-tertiary)' }}>seg.</div>
                    </div>
                  </Tooltip>
                  <Tooltip title="Engajamento">
                    <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: engagementColor(eng.engagement_rate) }}>{eng.engagement_rate.toFixed(1)}%</div>
                      <div style={{ fontSize: 10, color: 'var(--app-text-tertiary)' }}>eng.</div>
                    </div>
                  </Tooltip>
                  <Tooltip title="Posts analisados">
                    <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--app-text)' }}>{eng.posts_count}</div>
                      <div style={{ fontSize: 10, color: 'var(--app-text-tertiary)' }}>posts</div>
                    </div>
                  </Tooltip>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 4 }}>
                  <Space size={6}>
                    <HeartOutlined style={{ color: 'var(--app-icon-heart)', fontSize: 14 }} />
                    <Text type="secondary" style={{ fontSize: 12 }}>{formatShortNum(eng.total_likes)} curtidas</Text>
                  </Space>
                  <Space size={6}>
                    <CommentOutlined style={{ color: 'var(--app-icon-comment)', fontSize: 14 }} />
                    <Text type="secondary" style={{ fontSize: 12 }}>{formatShortNum(eng.total_comments)} comentários</Text>
                  </Space>
                </div>
                <Text type="secondary" style={{ fontSize: 11, textAlign: 'center', display: 'block' }}>
                  Média {eng.avg_likes.toLocaleString('pt-BR')} likes/post
                </Text>
              </>
            )}
          </>
        ) : (
          <>
            <Text type="secondary" style={{ fontSize: 12, textAlign: 'center', display: 'block', padding: '8px 0' }}>
              Faça login para ver as métricas
            </Text>
            {variant === 'list' && (item.handle || item.key) && (
              <div style={{ marginTop: 4, textAlign: 'center', minWidth: 0 }}>
                <Tooltip title={`@${item.handle ?? item.key}`}>
                  <span
                    style={{
                      fontSize: 11,
                      color: 'var(--app-text-secondary)',
                      display: 'inline-block',
                      maxWidth: '100%',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    @{item.handle ?? item.key}
                  </span>
                </Tooltip>
              </div>
            )}
          </>
        )}
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
    boxShadow: 'var(--app-shadow-lg)',
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
            padding: '12px 10px',
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
