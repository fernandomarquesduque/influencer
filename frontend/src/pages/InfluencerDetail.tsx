import { useEffect, useState, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Spin,
  Button,
  Space,
  Descriptions,
  Tag,
  Card,
  Row,
  Col,
  Typography,
  Tooltip,
  Collapse,
  message,
} from 'antd'
import {
  EditOutlined,
  FileImageOutlined,
  FileTextOutlined,
  HeartOutlined,
  CommentOutlined,
  RiseOutlined,
  SafetyOutlined,
  MessageOutlined,
  VideoCameraOutlined,
  FacebookOutlined,
  LinkedinOutlined,
  TwitterOutlined,
  CheckCircleFilled,
} from '@ant-design/icons'
import { Link } from 'react-router-dom'
import { fetchProfile, fetchPosts, fetchProfileActivation, getProfilePicUrl, proxyImageUrl, queueRefreshProfile, type ProfileItem, type PostItem, type ProfileActivation } from '../api'
import { computeEngagementFromPosts } from '../utils/engagement'
import { buildReportInsights, getWeekdayName } from '../utils/reportInsights'
import { CONTENT_TYPE_LABELS } from '../constants/contentTypes'
import { getCostTier } from '../utils/pricing'
import { PRICING_FIELD_KEYS, PRICING_FIELD_LABELS, type PricingFieldKey } from '../constants/pricingBuckets'
import { METRIC_TOOLTIPS } from '../constants/metricTooltips'
import { useAuth } from '../contexts/AuthContext'
import { reportTokens as t } from './reportTokens'
import {
  ReportHero,
  ScoreOverview,
  InsightCardsGrid,
  AudienceQualityCard,
  PricingHighlight,
  StickyCTA,
  ReportSkeleton,
} from './InfluencerDetailReport'
import { ActivationCtaPanel } from '../components/ActivationCtaPanel'
import { PostAnalysisSection } from '../components/PostAnalysisSection'
import { ReelsAnalysisSection } from '../components/ReelsAnalysisSection'
import { TaggedAnalysisSection } from '../components/TaggedAnalysisSection'
import { HighlightsAnalysisSection } from '../components/HighlightsAnalysisSection'

const { Text } = Typography
const { spacing: s, colors: c, radiusLegacy: r, shadowLegacy: sh, typography: typ, layout: lay } = t

function formatPricingValue(val: string | number | undefined | null): string {
  if (val === undefined || val === null || val === '') return '—'
  const s = String(val).trim()
  if (!s) return '—'
  const parts = s.split(/[\s,;-]+/).map((p) => p.replace(/\D/g, '')).filter(Boolean)
  const nums = parts.map((p) => parseInt(p, 10)).filter((n) => Number.isFinite(n))
  if (nums.length === 0) return s
  const fmt = (n: number) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
  return nums.length > 1 ? nums.map(fmt).join(' – ') : fmt(nums[0]!)
}

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

const sectionGap = (t.spacing.xl as number)
const cardBgStrategic = t.colors.cardBgStrategic as string
const cardBgAnalytical = t.colors.cardBgAnalytical as string
const cardBgHighlight = t.colors.cardBgHighlight as string
const shadowStrong = t.shadowStrong as string
const radiusLarge = t.radiusLarge as number
const gold = t.colors.gold as string
const typH2 = t.typography.h2 as { fontSize: number; fontWeight: number }
const typH3 = t.typography.h3 as { fontSize: number; fontWeight: number }

// ——— Componentes internos do relatório ———
function ReportSection({
  title,
  children,
  className,
  sectionTitle = true,
  variant = 'strategic',
  style: styleProp,
}: {
  title?: React.ReactNode
  children: React.ReactNode
  className?: string
  sectionTitle?: boolean
  variant?: 'strategic' | 'analytical' | 'highlight'
  style?: React.CSSProperties
}) {
  const bg =
    variant === 'highlight' ? cardBgHighlight : variant === 'analytical' ? cardBgAnalytical : cardBgStrategic
  const useBorder = variant === 'analytical'
  return (
    <Card
      size="small"
      className={`report-card report-card--hover ${className ?? ''}`}
      style={{
        borderRadius: r,
        border: useBorder ? `1px solid ${c.border}` : 'none',
        boxShadow: variant === 'highlight' ? shadowStrong : sh,
        padding: variant === 'highlight' ? s.xl : s.lg,
        background: bg,
        transition: 'box-shadow 0.2s ease, transform 0.2s ease',
        ...styleProp,
      }}
    >
      {title && (
        <div style={{ marginBottom: s.md, ...(sectionTitle ? typ.h3 : {}), ...(sectionTitle ? { color: c.text } : {}) }}>
          {title}
        </div>
      )}
      {children}
    </Card>
  )
}

interface InfluencerDetailProps {
  overrideHandle?: string
}

export default function InfluencerDetail({ overrideHandle }: InfluencerDetailProps = {}) {
  const { handle: paramHandle } = useParams<{ handle: string }>()
  const handle = overrideHandle ?? paramHandle
  const navigate = useNavigate()
  const { user, isPublic, canEditProfile, isAdm, loading: authLoading } = useAuth()

  const mediaKitPath = handle ? `/app/influencer/${encodeURIComponent(handle)}/media-kit` : '/app'
  const canEdit = handle ? canEditProfile(handle) : false
  const mustCompleteCadastro = user?.scope === 'influencer' && canEdit && user?.profile_activated !== true

  const goToMediaKitOrLogin = () => {
    if (mustCompleteCadastro && handle) {
      navigate(`/activate/${encodeURIComponent(handle)}`)
      return
    }
    if (user) {
      if (handle) navigate(mediaKitPath)
      else document.getElementById('cta-final')?.scrollIntoView({ behavior: 'smooth' })
    } else {
      navigate('/login', { state: { from: { pathname: mediaKitPath } } })
    }
  }
  const mediaKitCtaLabel = mustCompleteCadastro
    ? 'Finalize seu cadastro para gerar Media Kit'
    : user
      ? 'Gerar Media Kit Profissional'
      : 'Faça login para gerar Media Kit'
  const isLimitedView = !user || isPublic
  const [profileLoading, setProfileLoading] = useState(true)
  const [postsLoading, setPostsLoading] = useState(true)
  const [profile, setProfile] = useState<ProfileItem | null>(null)
  const [activation, setActivation] = useState<ProfileActivation | null>(null)
  const [posts, setPosts] = useState<PostItem[]>([])
  const [postsTotal, setPostsTotal] = useState(0)
  const [dataRedacted, setDataRedacted] = useState(false)
  const [failedPostImages, setFailedPostImages] = useState<Set<string>>(new Set())
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768)
  const refreshQueuedRef = useRef(false)
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const refreshPollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Só busca perfil/ativação/posts depois do auth carregar, para o token já estar em api.ts na primeira carga (evita dados zerados no primeiro acesso).
  useEffect(() => {
    if (!handle || authLoading) return
    let cancelled = false
    setProfileLoading(true)
    setDataRedacted(false)
    fetchProfile(handle)
      .then((p) => {
        if (!cancelled) {
          const pr = p as Record<string, unknown> | null
          if (pr?._redacted === true) setDataRedacted(true)
          setProfile(p ?? null)
        }
      })
      .finally(() => {
        if (!cancelled) setProfileLoading(false)
      })
    return () => { cancelled = true }
  }, [handle, authLoading])

  useEffect(() => {
    if (!handle || authLoading) return
    let cancelled = false
    fetchProfileActivation(handle)
      .then((a) => {
        if (!cancelled) {
          const ar = a as Record<string, unknown> | undefined
          if (ar?._redacted === true) {
            setDataRedacted(true)
            setActivation(null)
          } else {
            setActivation(a && (a.city ?? a.whatsapp ?? a.content_type?.length) ? a : null)
          }
        }
      })
      .catch(() => { if (!cancelled) setActivation(null) })
    return () => { cancelled = true }
  }, [handle, authLoading])

  useEffect(() => {
    if (!handle || authLoading) return
    let cancelled = false
    setPostsLoading(true)
    fetchPosts(handle, 100, 0)
      .then((res) => {
        if (!cancelled) {
          const r = res as { items: PostItem[]; total: number; _redacted?: boolean }
          if (r._redacted === true) setDataRedacted(true)
          setPosts(r.items ?? [])
          setPostsTotal(r.total ?? 0)
        }
      })
      .catch(() => { if (!cancelled) setPosts([]) })
      .finally(() => { if (!cancelled) setPostsLoading(false) })
    return () => { cancelled = true }
  }, [handle, authLoading])

  const startRefreshPolling = useRef<(h: string) => void>(() => { })
  startRefreshPolling.current = (h: string) => {
    if (refreshPollingRef.current) return
    let count = 0
    const REFETCH_INTERVAL_MS = 20_000
    const REFETCH_MAX = 6
    const doRefetch = () => {
      count += 1
      fetchProfile(h).then((p) => {
        const pr = p as Record<string, unknown> | null
        if (pr?._redacted === true) setDataRedacted(true)
        setProfile(p ?? null)
      }).catch(() => { })
      fetchPosts(h, 100, 0).then((res) => {
        const r = res as { items: PostItem[]; total: number; _redacted?: boolean }
        if (r._redacted === true) setDataRedacted(true)
        setPosts(r.items ?? [])
        setPostsTotal(r.total ?? 0)
        setFailedPostImages(new Set())
      }).catch(() => { })
      if (count >= REFETCH_MAX && refreshPollingRef.current) {
        clearInterval(refreshPollingRef.current)
        refreshPollingRef.current = null
      }
    }
    doRefetch()
    refreshPollingRef.current = setInterval(doRefetch, REFETCH_INTERVAL_MS)
  }
  useEffect(() => {
    return () => {
      if (refreshPollingRef.current) {
        clearInterval(refreshPollingRef.current)
        refreshPollingRef.current = null
      }
    }
  }, [])

  const userData = profile?.data?.user as Record<string, unknown> | undefined
  const displayHandle = (profile?.handle ?? profile?.username ?? profile?.key ?? handle ?? '') as string
  const fullName: string | undefined = profile?.full_name ?? (userData?.full_name != null ? String(userData.full_name) : undefined)
  const followersCount = typeof profile?.followers_count === 'number'
    ? profile.followers_count
    : (typeof userData?.follower_count === 'number' ? userData.follower_count : 0)
  const categories = (Array.isArray(profile?.categories) ? profile.categories : []) as string[]
  const engagement = useMemo(
    () => computeEngagementFromPosts(posts, followersCount),
    [posts, followersCount]
  )

  const reportInsights = useMemo(
    () => (profile && posts.length > 0 ? buildReportInsights(profile, posts) : null),
    [profile, posts]
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

  const mediaByType = useMemo(() => {
    const ct = (p: PostItem) => (p.content_type || 'post') as string
    return {
      posts: posts.filter((p) => ct(p) === 'post'),
      reels: posts.filter((p) => ct(p) === 'reel'),
      tagged: posts.filter((p) => ct(p) === 'tagged'),
      highlights: posts.filter((p) => ct(p) === 'highlight'),
    }
  }, [posts])

  const loading = profileLoading || postsLoading
  if (loading && !profile && posts.length === 0) {
    return (
      <div style={{ background: (t.colors as { pageBg?: string }).pageBg ?? 'var(--app-page-bg)', minHeight: '100vh', paddingBottom: 80 }}>
        <ReportSkeleton />
      </div>
    )
  }



  const profilePic = proxyImageUrl(getProfilePicUrl(profile))

  const hasActivationData = activation &&
    (activation.content_type?.length ||
      activation.city || activation.state || activation.neighborhood || activation.address || activation.country ||
      activation.whatsapp?.trim() || activation.tiktok?.trim() || activation.facebook?.trim() ||
      activation.linkedin?.trim() || activation.twitter?.trim() || activation.websites?.trim() ||
      activation.description?.trim() || activation.about_topics?.trim())

  const isRedacted = dataRedacted && isLimitedView

  const tierLabel = followersCount < 10_000 ? 'Nano Influencer' : followersCount < 50_000 ? 'Micro Influencer' : followersCount < 500_000 ? 'Mid Influencer' : 'Macro Influencer'

  const postsPerWeek = engagement.posts_per_week ?? 0
  const engagementScore = reportInsights?.score.total ?? Math.min(100, Math.round((engagement.engagement_rate / 12) * 100))
  const scoreSelo = reportInsights?.score.selo ?? 'Alto Engajamento'
  const diagnosticoFazBem = reportInsights?.diagnostico.fazBem ?? `Seu perfil tem um engajamento de ${engagement.engagement_rate.toFixed(2)}%, que indica conexão com a audiência.`
  const diagnosticoTrava = reportInsights?.diagnostico.trava ?? (postsPerWeek < 1 ? `Você posta pouco (${postsPerWeek.toFixed(1)} posts/semana).` : 'Há espaço para crescer a frequência.')
  const diagnosticoFazerPrimeiro = reportInsights?.diagnostico.fazerPrimeiro ?? 'Defina uma meta de 2–3 posts por semana.'
  const valorEstimadoFromPricing = (): { min: number; max: number; porque?: string } => {
    const p = activation?.pricing as Record<string, string | number | undefined> | undefined
    if (p) {
      const parseNums = (v: string | number | undefined): number[] => {
        if (typeof v === 'number' && v > 0) return [v]
        if (typeof v === 'string') {
          const nums = v.split(/\D+/).map((s) => parseInt(s, 10)).filter((n) => !Number.isNaN(n) && n > 0)
          return nums.length ? nums : []
        }
        return []
      }
      const all: number[] = []
      for (const k of ['post_unique', 'stories', 'package_monthly']) {
        all.push(...parseNums(p[k]))
      }
      if (all.length > 0) return { min: Math.min(...all), max: Math.max(...all), porque: 'baseado no seu cadastro de preços' }
    }
    const rocks = reportInsights?.valorEstimado
    if (rocks) return { min: rocks.min, max: rocks.max, porque: rocks.porque }
    return { min: 80, max: 150, porque: 'estimativa por seguidores e engajamento' }
  }
  const { min: valorEstimadoMin, max: valorEstimadoMax, porque: valorEstimadoPorque } = valorEstimadoFromPricing()

  const cardStyle = {
    borderRadius: r,
    border: 'none',
    boxShadow: sh,
    padding: s.lg,
    background: c.cardBg,
  }

  const hasList = (arr: unknown[] | undefined) => Array.isArray(arr) && arr.length > 0
  const hasGrowthChips = !!reportInsights?.nicho || !!activation?.content_type?.length
  const canShowProof =
    !!reportInsights &&
    hasList(reportInsights.topPosts?.byInteractions) &&
    reportInsights.topPosts!.byInteractions.length >= 1
  const showInlineCtas = !isMobile
  const layout = {
    showPrice: 'top' as const,
    showMainCta: 'final' as const,
    showScorePills: false,
  }
  const gap = isMobile ? s.lg : sectionGap
  const rowGutter: [number, number] = isMobile ? [s.md, s.md] : [s.lg, s.lg]

  return (
    <div style={{ paddingBottom: s.xl, background: c.pageBg, minHeight: '100vh' }}>


      {isRedacted && (
        <div style={{ width: '100%', padding: s.lg, paddingLeft: isMobile ? lay.contentPaddingMobile ?? s.md : s.lg, paddingRight: isMobile ? lay.contentPaddingMobile ?? s.md : s.lg }}>
          <div style={{ marginBottom: s.lg, padding: s.sm, background: 'var(--app-warning-bg)', border: '1px solid var(--app-warning-border)', borderRadius: r }}>
            {user ? (
              <Text>Você atingiu o limite diário de buscas. Os dados sensíveis deste perfil estão ocultos. Volte amanhã ou <Link to="/premium">assine o plano premium</Link> para ver tudo.</Text>
            ) : (
              <>
                <Text>Faça login para ver as métricas e os dados completos deste perfil.</Text>
                <div style={{ marginTop: s.xs }}><Link to="/login"><Button type="primary" size="small">Entrar</Button></Link></div>
              </>
            )}
          </div>
        </div>
      )}

      {isLimitedView && !isRedacted && (
        <div style={{ width: '100%', padding: s.lg, paddingLeft: isMobile ? lay.contentPaddingMobile ?? s.md : s.lg, paddingRight: isMobile ? lay.contentPaddingMobile ?? s.md : s.lg }}>
          <div style={{ marginBottom: s.md, padding: s.sm, background: 'var(--app-warning-bg)', border: '1px solid var(--app-warning-border)', borderRadius: r }}>
            <Text>Você está vendo uma prévia limitada. <Link to="/premium">Seja assinante</Link> para ver métricas completas e filtros avançados.</Text>
          </div>
        </div>
      )}

      <div style={{ width: '100%', padding: `0 ${isMobile ? (lay.contentPaddingMobile ?? s.md) : 0}px ${isMobile ? 160 : s.xl}px`, position: 'relative', zIndex: 1, background: c.pageBg }}>
        {!isRedacted && (
          <ReportHero
            profilePic={profilePic || ''}
            name={fullName}
            handle={displayHandle}
            isMobile={isMobile}
            score={reportInsights ? engagementScore : undefined}
            scoreTooltip={reportInsights ? 'Quanto maior o score, mais seu perfil está pronto para parcerias.' : undefined}
            tierLabel={reportInsights ? tierLabel : undefined}
            percentil={reportInsights?.benchmark?.percentil ?? undefined}
            scoreSelo={reportInsights ? scoreSelo : undefined}
            headline="Seu perfil tem potencial real de monetização"
            badgeLabel={!reportInsights ? tierLabel : undefined}
            highlights={[
              { label: 'Seguidores', value: formatShortNum(followersCount) },
              { label: 'ER', value: `${(engagement.engagement_rate ?? 0).toFixed(1)}%` },
              { label: 'Posts/sem', value: reportInsights?.consistency?.postsPerWeekByWeek?.length ? (reportInsights.consistency.postsPerWeekByWeek.reduce((a, b) => a + b, 0) / reportInsights.consistency.postsPerWeekByWeek.length).toFixed(1) : '0' },
            ]}
            onBack={() => navigate(-1)}
            onSendMessage={user && (isAdm || user.scope === 'assinante') && handle ? () => navigate(`/app/influencer/${encodeURIComponent(handle)}/send-message`) : undefined}
            onUpdateInstagram={isAdm && handle ? async () => {
              const r = await queueRefreshProfile(handle, { priority: true })
              if (r.queued) message.success(r.message)
              else message.warning(r.message)
            } : undefined}
            onCta={goToMediaKitOrLogin}
            onAvatarError={() => {
              if (!refreshQueuedRef.current && handle) {
                refreshQueuedRef.current = true
                queueRefreshProfile(handle).catch(() => { })
                startRefreshPolling.current(handle)
              }
            }}
            extraContent={!isLimitedView && reportInsights ? (
              <ScoreOverview
                embedded
                tierInHero
                hidePostsPerWeek
                hideExplanationInEmbedded
                score={engagementScore}
                tierLabel={tierLabel}
                scoreSelo={scoreSelo}
                percentil={reportInsights.benchmark?.percentil ?? null}
                explanation="Quanto maior o score, mais seu perfil está pronto para parcerias."
                statPills={layout.showScorePills ? [
                  { label: 'Seguidores', value: formatShortNum(followersCount) },
                  { label: 'ER', value: `${(engagement.engagement_rate ?? 0).toFixed(1)}%` },
                  { label: 'Posts/sem', value: reportInsights.consistency.postsPerWeekByWeek.length ? (reportInsights.consistency.postsPerWeekByWeek.reduce((a, b) => a + b, 0) / reportInsights.consistency.postsPerWeekByWeek.length).toFixed(1) : '0' },
                ] : []}
                postsPerWeekData={reportInsights.consistency.postsPerWeekByWeek}
                bestDay={getWeekdayName(reportInsights.consistency.bestWeekday)}
                bestHour={reportInsights.consistency.bestHour}
              />
            ) : null}
          />
        )}

        {!hasActivationData && canEdit && handle && (
          <ActivationCtaPanel
            handle={handle}
            isMobile={isMobile}
            marginBottom={gap}
          />
        )}

        {!isLimitedView && !isRedacted && hasActivationData && activation && (
          <div style={{ marginBottom: gap }}>
            {user?.scope === 'influencer' ? (
              <Collapse
                defaultActiveKey={[]}
                items={[{
                  key: 'contato',
                  label: (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingRight: canEdit && handle ? 8 : 0 }}>
                      <span><SafetyOutlined style={{ color: c.primary, marginRight: s.xs }} />Contato e dados da ativação</span>
                      {canEdit && handle && (
                        <Button type="default" size="small" icon={<EditOutlined />} onClick={(e) => { e.stopPropagation(); navigate(`/activate/${encodeURIComponent(handle)}`); }} style={{ borderRadius: r }}>
                          Editar
                        </Button>
                      )}
                    </div>
                  ),
                  children: (
                    <>
                      {activation.pricing && (() => {
                        const costTier = getCostTier(activation.pricing)
                        const hasAnyPricing = costTier || PRICING_FIELD_KEYS.some((key) => {
                          const val = activation.pricing![key as keyof typeof activation.pricing]
                          return val !== undefined && val !== null && String(val).trim() !== ''
                        })
                        if (!hasAnyPricing) return null
                        return (
                          <>
                            <div style={{ ...typ.caption, fontWeight: 600, color: c.text, marginBottom: s.sm }}>Custos</div>
                            <Descriptions column={1} bordered size="small" style={{ marginBottom: s.lg }}>
                              {costTier ? <Descriptions.Item label="Custo médio"><Text strong style={{ color: c.warning }}>{costTier.symbol} {costTier.label}</Text></Descriptions.Item> : null}
                              {PRICING_FIELD_KEYS.map((key) => {
                                const val = activation.pricing![key as keyof typeof activation.pricing]
                                if (val === undefined || val === null || String(val).trim() === '') return null
                                const label = PRICING_FIELD_LABELS[key as PricingFieldKey].replace(/^[\d\s️⃣]+\s*/, '').trim() || key
                                return <Descriptions.Item key={key} label={label}>{formatPricingValue(val)}</Descriptions.Item>
                              })}
                            </Descriptions>
                          </>
                        )
                      })()}
                      <div style={activation.pricing ? { borderTop: `1px solid ${c.borderLight}`, paddingTop: s.lg } : undefined}>
                        <div style={{ ...typ.caption, fontWeight: 600, color: c.text, marginBottom: s.sm }}>Contato e informações</div>
                        <Descriptions column={1} bordered size="small">
                          {(activation.city || activation.state || activation.neighborhood || activation.country) && (
                            <Descriptions.Item label="Localização">
                              {[activation.city, activation.state, activation.neighborhood, activation.country].filter(Boolean).join(', ') || '—'}
                            </Descriptions.Item>
                          )}
                          {activation.address && <Descriptions.Item label="Endereço">{activation.address}</Descriptions.Item>}
                          {activation.zip_code && <Descriptions.Item label="CEP">{activation.zip_code}</Descriptions.Item>}
                          {activation.content_type && activation.content_type.length > 0 && (
                            <Descriptions.Item label="Tipo de conteúdo">
                              <Space wrap size={[6, 6]}>{activation.content_type.map((ct) => <Tag key={ct} color="blue">{CONTENT_TYPE_LABELS[ct] ?? ct}</Tag>)}</Space>
                            </Descriptions.Item>
                          )}
                          {activation.whatsapp?.trim() && <Descriptions.Item label="WhatsApp"><Space><MessageOutlined style={{ color: 'var(--app-icon-whatsapp)' }} />{activation.whatsapp}</Space></Descriptions.Item>}
                          {activation.tiktok?.trim() && <Descriptions.Item label="TikTok"><Space><VideoCameraOutlined />{activation.tiktok}</Space></Descriptions.Item>}
                          {activation.facebook?.trim() && <Descriptions.Item label="Facebook"><Space><FacebookOutlined style={{ color: 'var(--app-icon-facebook)' }} />{activation.facebook}</Space></Descriptions.Item>}
                          {activation.linkedin?.trim() && <Descriptions.Item label="LinkedIn"><Space><LinkedinOutlined style={{ color: 'var(--app-icon-linkedin)' }} />{activation.linkedin}</Space></Descriptions.Item>}
                          {activation.twitter?.trim() && <Descriptions.Item label="X / Twitter"><Space><TwitterOutlined style={{ color: 'var(--app-icon-twitter)' }} />{activation.twitter}</Space></Descriptions.Item>}
                          {activation.websites?.trim() && <Descriptions.Item label="Websites">{activation.websites}</Descriptions.Item>}
                          {activation.description?.trim() && <Descriptions.Item label="Descrição">{activation.description}</Descriptions.Item>}
                          {activation.about_topics?.trim() && <Descriptions.Item label="Temas">{activation.about_topics}</Descriptions.Item>}
                          {activation.activated_at && <Descriptions.Item label="Ativado em">{formatDate(activation.activated_at)}</Descriptions.Item>}
                          {activation.updated_at && <Descriptions.Item label="Atualizado em">{formatDate(activation.updated_at)}</Descriptions.Item>}
                        </Descriptions>
                      </div>
                    </>
                  ),
                }]}
                style={{ borderRadius: r, overflow: 'hidden', border: 'none', boxShadow: sh }}
              />
            ) : (
              <ReportSection
                variant="analytical"
                sectionTitle={false}
                title={
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <span><SafetyOutlined style={{ color: c.primary, marginRight: s.xs }} />Contato e dados da ativação</span>
                    {canEdit && handle && (
                      <Button type="default" size="small" icon={<EditOutlined />} onClick={() => navigate(`/activate/${encodeURIComponent(handle)}`)} style={{ borderRadius: r }}>
                        Editar
                      </Button>
                    )}
                  </div>
                }
              >
                {activation.pricing && (() => {
                  const costTier = getCostTier(activation.pricing)
                  const hasAnyPricing = costTier || PRICING_FIELD_KEYS.some((key) => {
                    const val = activation.pricing![key as keyof typeof activation.pricing]
                    return val !== undefined && val !== null && String(val).trim() !== ''
                  })
                  if (!hasAnyPricing) return null
                  return (
                    <>
                      <div style={{ ...typ.caption, fontWeight: 600, color: c.text, marginBottom: s.sm }}>Custos</div>
                      <Descriptions column={1} bordered size="small" style={{ marginBottom: s.lg }}>
                        {costTier ? <Descriptions.Item label="Custo médio"><Text strong style={{ color: c.warning }}>{costTier.symbol} {costTier.label}</Text></Descriptions.Item> : null}
                        {PRICING_FIELD_KEYS.map((key) => {
                          const val = activation.pricing![key as keyof typeof activation.pricing]
                          if (val === undefined || val === null || String(val).trim() === '') return null
                          const label = PRICING_FIELD_LABELS[key as PricingFieldKey].replace(/^[\d\s️⃣]+\s*/, '').trim() || key
                          return <Descriptions.Item key={key} label={label}>{formatPricingValue(val)}</Descriptions.Item>
                        })}
                      </Descriptions>
                    </>
                  )
                })()}
                <div style={activation.pricing ? { borderTop: `1px solid ${c.borderLight}`, paddingTop: s.lg } : undefined}>
                  <div style={{ ...typ.caption, fontWeight: 600, color: c.text, marginBottom: s.sm }}>Contato e informações</div>
                  <Descriptions column={1} bordered size="small">
                    {(activation.city || activation.state || activation.neighborhood || activation.country) && (
                      <Descriptions.Item label="Localização">
                        {[activation.city, activation.state, activation.neighborhood, activation.country].filter(Boolean).join(', ') || '—'}
                      </Descriptions.Item>
                    )}
                    {activation.address && <Descriptions.Item label="Endereço">{activation.address}</Descriptions.Item>}
                    {activation.zip_code && <Descriptions.Item label="CEP">{activation.zip_code}</Descriptions.Item>}
                    {activation.content_type && activation.content_type.length > 0 && (
                      <Descriptions.Item label="Tipo de conteúdo">
                        <Space wrap size={[6, 6]}>{activation.content_type.map((ct) => <Tag key={ct} color="blue">{CONTENT_TYPE_LABELS[ct] ?? ct}</Tag>)}</Space>
                      </Descriptions.Item>
                    )}
                    {activation.whatsapp?.trim() && <Descriptions.Item label="WhatsApp"><Space><MessageOutlined style={{ color: 'var(--app-icon-whatsapp)' }} />{activation.whatsapp}</Space></Descriptions.Item>}
                    {activation.tiktok?.trim() && <Descriptions.Item label="TikTok"><Space><VideoCameraOutlined />{activation.tiktok}</Space></Descriptions.Item>}
                    {activation.facebook?.trim() && <Descriptions.Item label="Facebook"><Space><FacebookOutlined style={{ color: 'var(--app-icon-facebook)' }} />{activation.facebook}</Space></Descriptions.Item>}
                    {activation.linkedin?.trim() && <Descriptions.Item label="LinkedIn"><Space><LinkedinOutlined style={{ color: 'var(--app-icon-linkedin)' }} />{activation.linkedin}</Space></Descriptions.Item>}
                    {activation.twitter?.trim() && <Descriptions.Item label="X / Twitter"><Space><TwitterOutlined style={{ color: 'var(--app-icon-twitter)' }} />{activation.twitter}</Space></Descriptions.Item>}
                    {activation.websites?.trim() && <Descriptions.Item label="Websites">{activation.websites}</Descriptions.Item>}
                    {activation.description?.trim() && <Descriptions.Item label="Descrição">{activation.description}</Descriptions.Item>}
                    {activation.about_topics?.trim() && <Descriptions.Item label="Temas">{activation.about_topics}</Descriptions.Item>}
                    {activation.activated_at && <Descriptions.Item label="Ativado em">{formatDate(activation.activated_at)}</Descriptions.Item>}
                    {activation.updated_at && <Descriptions.Item label="Atualizado em">{formatDate(activation.updated_at)}</Descriptions.Item>}
                  </Descriptions>
                </div>
              </ReportSection>
            )}
          </div>
        )}

        {!isLimitedView && !isRedacted && (
          <div id="diagnostico-secao" style={{ marginBottom: gap }}>
            <InsightCardsGrid fazBem={diagnosticoFazBem} trava={diagnosticoTrava} fazerPrimeiro={diagnosticoFazerPrimeiro} />
          </div>
        )}
        {!isLimitedView && !isRedacted && (reportInsights ? (
          <div style={{ marginBottom: gap }}>
            <Row gutter={rowGutter}>
              <Col xs={24}>
                <Row gutter={rowGutter} align="stretch">
                  <Col xs={24} md={12} style={{ display: 'flex' }}>
                    <PricingHighlight
                      min={valorEstimadoMin}
                      max={valorEstimadoMax}
                      porque={valorEstimadoPorque ?? ''}
                      onCta={() => document.getElementById('cta-final')?.scrollIntoView({ behavior: 'smooth' })}
                      hideCta={isMobile || layout.showMainCta === 'final'}
                      tooltip={METRIC_TOOLTIPS.valorEstimado}
                      style={{ flex: 1, minHeight: '100%' }}
                    />
                  </Col>
                  <Col xs={24} md={12} style={{ display: 'flex' }}>
                    <AudienceQualityCard rate={reportInsights.conversation.rate} label={reportInsights.conversation.label} color={reportInsights.conversation.color} tooltip={METRIC_TOOLTIPS.conversacao} style={{ flex: 1, minHeight: '100%' }} />
                  </Col>
                </Row>
              </Col>
            </Row>
          </div>
        ) : postsLoading ? (
          <Card size="small" style={{ ...cardStyle, marginBottom: gap }}>
            <div style={{ textAlign: 'center', padding: s.xl }}><Spin /></div>
          </Card>
        ) : null)}

        {!isLimitedView && !isRedacted && ((reportInsights?.resumoExecutivo?.length ?? 0) > 0 || hasGrowthChips) && (() => {
          const hasResumo = (reportInsights?.resumoExecutivo?.length ?? 0) > 0
          const hasGrowth = hasGrowthChips
          const sideBySide = hasResumo && hasGrowth
          return (
            <Row gutter={rowGutter} align="stretch" style={{ marginBottom: gap }}>
              {hasResumo && (
                <Col xs={24} md={sideBySide ? 12 : 24} style={sideBySide ? { display: 'flex' } : undefined}>
                  <Card size="small" className="report-card report-card--hover" style={{ ...cardStyle, flex: 1, minHeight: sideBySide ? '100%' : undefined, background: c.cardBgSoft, border: `1px solid ${c.borderLight}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: s.sm, marginBottom: s.md }}>
                      <div style={{ width: 34, height: 34, borderRadius: '50%', background: c.primaryMuted, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <FileTextOutlined style={{ fontSize: 16, color: c.primary }} />
                      </div>
                      <div style={{ ...typH3, color: c.text, margin: 0 }}>Resumo Executivo</div>
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 20, listStyle: 'none' }}>
                      {(reportInsights?.resumoExecutivo ?? []).map((bullet, i) => (
                        <li key={i} style={{ marginBottom: s.sm, display: 'flex', gap: s.sm, alignItems: 'flex-start' }}>
                          <span style={{ color: c.textMuted, fontWeight: 500, fontSize: 8 }}>•</span>
                          <span style={{ ...typ.body, color: c.text }}>{bullet}</span>
                        </li>
                      ))}
                    </ul>
                  </Card>
                </Col>
              )}
              {hasGrowth && (
                <Col xs={24} md={sideBySide ? 12 : 24} style={sideBySide ? { display: 'flex' } : undefined}>
                  <ReportSection variant="analytical" title={<div style={{ display: 'flex', alignItems: 'center', gap: s.sm }}><div style={{ width: 34, height: 34, borderRadius: '50%', background: c.successBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><RiseOutlined style={{ fontSize: 16, color: c.success }} /></div>Potencial de Crescimento</div>} style={sideBySide ? { flex: 1, minHeight: '100%', background: c.cardBgSoft, border: `1px solid ${c.borderLight}` } : { background: c.cardBgSoft, border: `1px solid ${c.borderLight}` }}>
                    <Text style={{ ...typ.bodySmall, color: c.text, display: 'block', marginBottom: s.sm }}>
                      Se você aumentar sua frequência de postagem mantendo o mesmo engajamento, seu perfil pode dobrar em 6 a 9 meses.
                    </Text>
                    <Space size={s.xs} wrap>
                      {(reportInsights?.nicho ? [reportInsights.nicho.nichoDominante, ...reportInsights.nicho.subtemas] : activation?.content_type?.length ? activation.content_type.slice(0, 3).map((ct) => CONTENT_TYPE_LABELS[ct] ?? ct) : CONTENT_TYPE_OPTIONS.slice(0, 3).map((ct) => ct.label)).map((label) => (
                        <Tag key={label} style={{ borderRadius: r, background: 'var(--app-border-light)', border: 'none', color: c.text }}>{label}</Tag>
                      ))}
                    </Space>
                  </ReportSection>
                </Col>
              )}
            </Row>
          )
        })()}

        {!isLimitedView && !isRedacted && (
          <PostAnalysisSection
            reportInsights={reportInsights}
            engagement={engagement}
            postsCount={posts.length}
            postsLoading={postsLoading}
            canShowProof={canShowProof}
            categories={categories}
            allHashtags={allHashtags}
            failedPostImages={failedPostImages}
            formatShortNum={formatShortNum}
            getPostImageUrl={getPostImageUrl}
            getPostLink={getPostLink}
            proxyImageUrl={proxyImageUrl}
            gap={gap}
            cardStyle={cardStyle}
          />
        )}

        {!isLimitedView && !isRedacted && (
          <ReelsAnalysisSection
            reels={mediaByType.reels}
            followersCount={followersCount}
            failedPostImages={failedPostImages}
            formatShortNum={formatShortNum}
            getPostImageUrl={getPostImageUrl}
            getPostLink={getPostLink}
            proxyImageUrl={proxyImageUrl}
            gap={gap}
            cardStyle={cardStyle}
          />
        )}

        {!isLimitedView && !isRedacted && (
          <TaggedAnalysisSection
            tagged={mediaByType.tagged}
            followersCount={followersCount}
            failedPostImages={failedPostImages}
            formatShortNum={formatShortNum}
            getPostImageUrl={getPostImageUrl}
            getPostLink={getPostLink}
            proxyImageUrl={proxyImageUrl}
            gap={gap}
          />
        )}

        {!isLimitedView && !isRedacted && (
          <HighlightsAnalysisSection
            highlights={mediaByType.highlights}
            failedPostImages={failedPostImages}
            getPostImageUrl={getPostImageUrl}
            getPostLink={getPostLink}
            proxyImageUrl={proxyImageUrl}
            gap={gap}
          />
        )}

        <div id="cta-final" className="report-cta-final" style={{ textAlign: 'center', marginBottom: s.section, paddingTop: s.xl }}>
          <h2 style={{ ...typH2, color: c.text, marginBottom: s.sm }}>Feche parcerias locais mais rápido</h2>
          <ul style={{ listStyle: 'none', margin: `0 auto ${s.lg}px`, padding: 0, maxWidth: 400, textAlign: 'left' }}>
            <li style={{ display: 'flex', gap: s.sm, alignItems: 'center' }}><CheckCircleFilled style={{ color: c.success, flexShrink: 0 }} /><span style={{ ...typ.body, color: c.text }}>PDF profissional para enviar às marcas</span></li>
          </ul>
          {showInlineCtas && (
            <>
              <Button
                type="primary"
                size="large"
                style={{ borderRadius: radiusLarge, paddingLeft: s.xl, paddingRight: s.xl, height: 52, background: gold, borderColor: gold, color: 'var(--brand-white)', marginBottom: s.sm }}
                onClick={goToMediaKitOrLogin}
              >
                {mediaKitCtaLabel}
              </Button>
              <div style={{ ...typ.caption, color: c.textMuted, marginBottom: s.sm }}>Pronto em 30s · PDF bonito · Envie para marcas</div>
            </>
          )}
        </div>
      </div>

      <StickyCTA
        visible={isMobile && !isRedacted}
        primaryLabel={mediaKitCtaLabel}
        primarySubtext="Pronto em 30s · PDF bonito · Envie para marcas"
        onPrimary={goToMediaKitOrLogin}
        secondaryLabel={user && (isAdm || user.scope === 'assinante') && handle ? 'Enviar mensagem' : undefined}
        onSecondary={user && (isAdm || user.scope === 'assinante') && handle ? () => navigate(`/app/influencer/${encodeURIComponent(handle!)}/send-message`) : undefined}
      />

      <style>{`
        .report-card {
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .report-card--hover:hover {
          transform: translateY(-2px);
          box-shadow: var(--app-shadow-xl) !important;
        }

        .report-proof-thumb {
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .report-proof-thumb:hover {
          transform: translateY(-2px) scale(1.02);
          box-shadow: var(--app-shadow-lg);
        }

        .report-hero { max-width: 100%; }
        .report-hero-inner { position: relative; }
        .proof-thumb:hover .proof-overlay { opacity: 1 !important; }
        .report-sticky-cta { safe-area-inset-bottom: env(safe-area-inset-bottom, 0); }
        .report-cta-final ul { margin-left: auto; margin-right: auto; }
        .section-h2 { letter-spacing: -0.02em; }
        .stat-pill { display: inline-flex; align-items: center; }
      `}</style>
    </div>
  )
}
