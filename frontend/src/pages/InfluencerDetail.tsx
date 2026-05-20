import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Spin,
  Button,
  Space,
  Descriptions,
  Tag,
  Card,
  Typography,
  Tooltip,
  message,
  Skeleton,
  Modal,
} from 'antd'
import {
  MessageOutlined,
  SyncOutlined,
  VideoCameraOutlined,
  FacebookOutlined,
  LinkedinOutlined,
  TwitterOutlined,
  LockOutlined,
  HeartOutlined,
  HeartFilled,
  CheckCircleOutlined,
  DeleteOutlined,
  RobotOutlined,
} from '@ant-design/icons'
import { Link } from 'react-router-dom'
import { fetchProfile, fetchCampaignProfile, fetchProfileSummary, fetchPosts, fetchProfileActivation, fetchCampaignProfileActivation, fetchFavorites, addFavorite, removeFavorite, getProfilePicUrl, getStableProfilePicUrl, getPostCoverDisplayUrl, proxyImageUrl, queueRefreshProfile, adminPurgeInfluencer, type ProfileItem, type PostItem, type ProfileActivation, type EngagementStats } from '../api'
import { computeEngagementFromPosts } from '../utils/engagement'
import { getFollowersCountFromProfile } from '../utils/profileMetrics'
import { getInfluencerTierLongLabel, getInfluencerTierShort, getInfluencerTierTooltip } from '../utils/influencerTier'
import { buildReportInsights, getWeekdayName, getPostsByWeekday } from '../utils/reportInsights'
import { CONTENT_TYPE_LABELS } from '../constants/contentTypes'
import { GENDER_LABELS, AUDIENCE_GENDER_LABELS, INFLUENCE_AGE_RANGE_LABELS } from '../constants/activationLabels'
import { getCostTier } from '../utils/pricing'
import { PRICING_FIELD_KEYS, PRICING_FIELD_LABELS, type PricingFieldKey } from '../constants/pricingBuckets'
import { DETAIL_SECTION_ORDER, type DetailSectionId } from '../constants/detailLayout'
import { useAuth } from '../contexts/AuthContext'
import { reportTokens as t } from './reportTokens'
import {
  ReportHero,
  ScoreOverview,
  PatamarCardSection,
  DiagnosticoBISection,
  EngajamentoPorTipoSection,
  MetricasMediakitSection,
  ValorEpublicoSection,
  StickyCTA,
  ReportSkeleton,
} from './InfluencerDetailReport'
import { getProfilePersonaSummary } from '../utils/mapProfileListToPreviewItems'
import { ActivationCtaPanel } from '../components/ActivationCtaPanel'
import { AlcanceSection } from '../components/AlcanceSection'
import { PostAnalysisSection } from '../components/PostAnalysisSection'
import { ReelsAnalysisSection } from '../components/ReelsAnalysisSection'
import { TaggedAnalysisSection } from '../components/TaggedAnalysisSection'
import { PrivateProfileMessage } from '../components/PrivateProfileMessage'
import { ProfileLlmDetailPanel } from '../components/ProfileLlmDetailPanel'
import ProfileLimitedPreviewLock, { engagementByTypeFromProfileRecord } from '../components/ProfileLimitedPreviewLock'
import ProfileLocationCard from '../components/ProfileLocationCard'
import AdminProfileLlmEditModal from '../components/AdminProfileLlmEditModal/AdminProfileLlmEditModal'
import './InfluencerDetailStack.css'

const { Text } = Typography
const { spacing: s, colors: c, radiusLegacy: r, shadowLegacy: sh, typography: typ, layout: lay } = t

/** Base comum + tons pastéis para botões da faixa de ações (perfil). */
const detailActionBtnShell = () => ({
  borderRadius: r,
  minHeight: 44,
  fontWeight: 600 as const,
})

const DETAIL_SUBTLE_ACTION = {
  favorite: {
    ...detailActionBtnShell(),
    background: 'linear-gradient(180deg, #fff5f7 0%, #ffe8f2 100%)',
    border: '1px solid #fbcfe8',
    color: '#9d174d',
    boxShadow: '0 1px 4px rgba(157, 23, 77, 0.06)',
  },
  editProfile: {
    ...detailActionBtnShell(),
    background: 'linear-gradient(180deg, #fffbeb 0%, #fef3c7 100%)',
    border: '1px solid #fde68a',
    color: '#b45309',
    boxShadow: '0 1px 4px rgba(180, 83, 9, 0.07)',
  },
  adminSync: {
    ...detailActionBtnShell(),
    background: 'linear-gradient(180deg, #f8fafc 0%, #e2e8f0 100%)',
    border: '1px solid #cbd5e1',
    color: '#475569',
    boxShadow: '0 1px 4px rgba(71, 85, 105, 0.06)',
  },
  adminActivate: {
    ...detailActionBtnShell(),
    background: 'linear-gradient(180deg, #eef2ff 0%, #e0e7ff 100%)',
    border: '1px solid #c7d2fe',
    color: '#4338ca',
    boxShadow: '0 1px 4px rgba(67, 56, 202, 0.07)',
  },
  adminMessage: {
    ...detailActionBtnShell(),
    background: 'linear-gradient(180deg, #eff6ff 0%, #dbeafe 100%)',
    border: '1px solid #bfdbfe',
    color: '#1d4ed8',
    boxShadow: '0 1px 4px rgba(29, 78, 216, 0.06)',
  },
  adminLlm: {
    ...detailActionBtnShell(),
    background: 'linear-gradient(180deg, #f5f3ff 0%, #ede9fe 100%)',
    border: '1px solid #ddd6fe',
    color: '#5b21b6',
    boxShadow: '0 1px 4px rgba(91, 33, 182, 0.07)',
  },
  adminPurge: {
    ...detailActionBtnShell(),
    background: 'linear-gradient(180deg, #fff1f2 0%, #ffe4e6 100%)',
    border: '1px solid #fecdd3',
    color: '#be123c',
    boxShadow: '0 1px 4px rgba(190, 18, 60, 0.07)',
  },
}

const DETAIL_ACTION_BTN_CLASS = 'detail-action-btn-subtle'

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
  return getPostCoverDisplayUrl(post)
}

function getPostLink(post: PostItem): string {
  const shortcode = post.post?.shortcode ?? post.key?.split(':')[1]
  if (shortcode) return `https://www.instagram.com/p/${shortcode}/`
  return '#'
}

const CAMPAIGN_ID_GUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Engagement embutido na prévia pública (`buildPublicProfilePreview` no backend). */
function engagementFromProfileRecord(profile: ProfileItem | null | undefined): EngagementStats | null {
  if (!profile) return null
  const eng = (profile as Record<string, unknown>).engagement
  if (eng == null || typeof eng !== 'object' || Array.isArray(eng)) return null
  return eng as EngagementStats
}
const sectionGap = (t.spacing.xl as number)
/** Espaçamento uniforme entre blocos no modal de detalhe */
const MODAL_DETAIL_STACK_GAP = 16
interface InfluencerDetailProps {
  overrideHandle?: string
  /** Substitui campaignId da URL (ex.: modal sobre a campanha). */
  overrideCampaignId?: string | null
  /** Quando true, exige campaignId na URL (rota campaigns/:campaignId/influencer/:handle) e redireciona se inválido. */
  requireCampaignId?: boolean
  /** Renderizado dentro de InfluencerDetailModal: fecha o modal em vez de navegar no voltar. */
  embeddedInModal?: boolean
  onModalClose?: () => void
}

export default function InfluencerDetail({
  overrideHandle,
  overrideCampaignId,
  requireCampaignId,
  embeddedInModal = false,
  onModalClose,
}: InfluencerDetailProps = {}) {
  const params = useParams<{ handle?: string; campaignId?: string }>()
  const handle = overrideHandle ?? params.handle
  const rawCampaignParam =
    overrideCampaignId !== undefined ? (overrideCampaignId ?? '') : (params.campaignId?.trim() ?? '')
  const campaignId =
    rawCampaignParam.toLowerCase() === 'all'
      ? 'all'
      : rawCampaignParam.length > 0 && CAMPAIGN_ID_GUID_REGEX.test(rawCampaignParam)
        ? rawCampaignParam
        : null
  const navigate = useNavigate()

  useEffect(() => {
    if (requireCampaignId && campaignId == null && params.campaignId != null) {
      navigate('/app/campaigns', { replace: true })
    }
  }, [requireCampaignId, campaignId, params.campaignId, navigate])

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
  const mediaKitCtaShortLabel = mustCompleteCadastro ? 'Gerar MediaKit' : user ? 'Gerar MediaKit' : 'Entrar'
  const [profileLoading, setProfileLoading] = useState(true)
  const [postsLoading, setPostsLoading] = useState(true)
  const [profile, setProfile] = useState<ProfileItem | null>(null)
  const [activation, setActivation] = useState<ProfileActivation | null>(null)
  const [posts, setPosts] = useState<PostItem[]>([])
  const [, setPostsTotal] = useState(0)
  const [dataRedacted, setDataRedacted] = useState(false)
  const [allBasePreview, setAllBasePreview] = useState(false)
  const [previewEngagement, setPreviewEngagement] = useState<EngagementStats | null>(null)
  const [previewSummaryFollowers, setPreviewSummaryFollowers] = useState<number | null>(null)
  /** Prévia sem dados completos (API: _all_base_preview ou scope public). */
  const isPreviewLocked = allBasePreview || isPublic
  const isRedacted = dataRedacted && !!user && !allBasePreview
  const isProfileLocked = isPreviewLocked || isRedacted
  const isLimitedView = isProfileLocked
  const [failedPostImages, setFailedPostImages] = useState<Set<string>>(new Set())
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768)
  const [showActivationCta, setShowActivationCta] = useState(false)
  const [isFavorite, setIsFavorite] = useState(false)
  const [editLlmOpen, setEditLlmOpen] = useState(false)
  const feedSectionRef = useRef<HTMLDivElement>(null)
  const refreshQueuedRef = useRef(false)
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (!user || !handle || user.scope === 'influencer') {
      setIsFavorite(false)
      return
    }
    const norm = (h: string) => h.toLowerCase().replace(/^@/, '').trim()
    fetchFavorites()
      .then((res) => setIsFavorite((res.handles ?? []).some((h) => norm(h) === norm(handle))))
      .catch(() => setIsFavorite(false))
  }, [user, handle])

  const handleFavoriteToggle = async () => {
    if (!handle) return
    const prev = isFavorite
    setIsFavorite(!prev)
    try {
      if (campaignId === 'all') {
        if (prev) await removeFavorite(handle)
        else await addFavorite(handle)
      } else if (prev) {
        await removeFavorite(handle, campaignId ? { campaignId } : undefined)
      } else {
        await addFavorite(handle, { campaignId: campaignId ?? undefined })
      }
    } catch {
      setIsFavorite(prev)
    }
  }

  const refreshPollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Só busca perfil/ativação/posts depois do auth carregar. Em rota de campanha usa endpoints da campanha (perfil só se estiver na campanha).
  useEffect(() => {
    if (!handle || authLoading) return
    let cancelled = false
    setProfileLoading(true)
    setDataRedacted(false)
    setAllBasePreview(false)
    const loadProfile = campaignId
      ? () => fetchCampaignProfile(campaignId, handle)
      : () => fetchProfile(handle)
    loadProfile()
      .then((p) => {
        if (!cancelled) {
          const pr = p as Record<string, unknown> | null
          if (pr?._redacted === true) setDataRedacted(true)
          const basePreview = pr?._all_base_preview === true
          setAllBasePreview(basePreview)
          setProfile(p ?? null)
          if (basePreview) {
            const embedded = engagementFromProfileRecord(p ?? null)
            if (embedded) setPreviewEngagement(embedded)
          } else {
            setPreviewEngagement(null)
          }
        }
      })
      .finally(() => {
        if (!cancelled) setProfileLoading(false)
      })
    return () => { cancelled = true }
  }, [handle, campaignId, authLoading])

  const reloadProfileAfterLlm = useCallback(async () => {
    if (!handle) return
    const loader = campaignId ? () => fetchCampaignProfile(campaignId, handle) : () => fetchProfile(handle)
    const p = await loader().catch(() => null)
    if (p != null) {
      const pr = p as Record<string, unknown> | null
      if (pr?._redacted === true) setDataRedacted(true)
      const basePreview = pr?._all_base_preview === true
      setAllBasePreview(basePreview)
      setProfile(p)
      if (basePreview) {
        const embedded = engagementFromProfileRecord(p)
        if (embedded) setPreviewEngagement(embedded)
      }
    }
  }, [handle, campaignId])

  useEffect(() => {
    if (!handle || authLoading) return
    let cancelled = false
    const loadActivation = campaignId
      ? () => fetchCampaignProfileActivation(campaignId, handle)
      : () => fetchProfileActivation(handle)
    loadActivation()
      .then((a) => {
        if (!cancelled) {
          const ar = a as Record<string, unknown> | undefined
          if (ar?._redacted === true) {
            setDataRedacted(true)
            if (ar?._all_base_preview === true) setAllBasePreview(true)
            setActivation(null)
          } else {
            setActivation(a && (a.city ?? a.whatsapp ?? a.content_type?.length) ? a : null)
          }
        }
      })
      .catch(() => { if (!cancelled) setActivation(null) })
    return () => { cancelled = true }
  }, [handle, campaignId, authLoading])

  useEffect(() => {
    if (!handle || authLoading) return
    if (!user || isPreviewLocked) {
      setPosts([])
      setPostsTotal(0)
      setPostsLoading(false)
      return
    }
    let cancelled = false
    setPostsLoading(true)
    fetchPosts(handle, 100, 0, undefined, campaignId ? { campaignId } : undefined)
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
  }, [handle, campaignId, authLoading, user, isPreviewLocked])

  useEffect(() => {
    if (!handle || authLoading) return
    const needsPreviewMetrics = allBasePreview || isPublic || (dataRedacted && !!user)
    if (!needsPreviewMetrics) {
      setPreviewEngagement(null)
      setPreviewSummaryFollowers(null)
      return
    }
    let cancelled = false
    fetchProfileSummary(handle, { campaignId: campaignId ?? undefined })
      .then((res) => {
        if (cancelled) return
        setPreviewEngagement(res?.engagement ?? null)
        const fc = res?.profile?.followers_count
        setPreviewSummaryFollowers(typeof fc === 'number' && Number.isFinite(fc) ? fc : null)
      })
      .catch(() => {
        if (!cancelled) {
          setPreviewEngagement(null)
          setPreviewSummaryFollowers(null)
        }
      })
    return () => { cancelled = true }
  }, [handle, campaignId, authLoading, allBasePreview, isPublic, dataRedacted, user])

  const startRefreshPolling = useRef<(h: string) => void>(() => { })
  startRefreshPolling.current = (h: string) => {
    if (refreshPollingRef.current) return
    let count = 0
    const REFETCH_INTERVAL_MS = 20_000
    const REFETCH_MAX = 6
    const loadProfile = campaignId ? () => fetchCampaignProfile(campaignId, h) : () => fetchProfile(h)
    const doRefetch = () => {
      count += 1
      loadProfile().then((p) => {
        const pr = p as Record<string, unknown> | null
        if (pr?._redacted === true) setDataRedacted(true)
        setAllBasePreview(pr?._all_base_preview === true)
        setProfile(p ?? null)
      }).catch(() => { })
      fetchPosts(h, 100, 0, undefined, campaignId ? { campaignId } : undefined).then((res) => {
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

  // Mostrar painel de ativação assim que o scroll chegar na seção Métricas.
  // Esconder só quando o scroll estiver acima de Métricas (seção ficou abaixo da viewport — usuário rolou para cima).
  useEffect(() => {
    if (isLimitedView) return
    let cancelled = false
    let observer: IntersectionObserver | null = null

    const isAboveMetricas = (rect: DOMRect) => rect.top >= window.innerHeight

    const observerCallback: IntersectionObserverCallback = ([entry]) => {
      if (cancelled || !entry) return
      if (entry.isIntersecting) {
        setShowActivationCta(true)
        return
      }
      if (isAboveMetricas(entry.boundingClientRect)) setShowActivationCta(false)
    }

    const onScroll = () => {
      if (cancelled) return
      const target = document.getElementById('secao-metricas-mediakit')
      if (!target) return
      const rect = target.getBoundingClientRect()
      if (isAboveMetricas(rect)) setShowActivationCta(false)
    }

    window.addEventListener('scroll', onScroll, { passive: true })

    const raf = requestAnimationFrame(() => {
      if (cancelled) return
      const el = document.getElementById('secao-metricas-mediakit')
      if (el) {
        observer = new IntersectionObserver(observerCallback, { root: null, rootMargin: '0px', threshold: [0, 0.01, 0.1, 1] })
        observer.observe(el)
      }
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      observer?.disconnect()
      window.removeEventListener('scroll', onScroll)
    }
  }, [isLimitedView, profileLoading, postsLoading])

  const userData = profile?.data?.user as Record<string, unknown> | undefined
  const displayHandle = (profile?.handle ?? profile?.username ?? profile?.key ?? handle ?? '') as string
  const fullName: string | undefined = profile?.full_name ?? (userData?.full_name != null ? String(userData.full_name) : undefined)
  const followersCount = getFollowersCountFromProfile(profile)
  const categories = (Array.isArray(profile?.categories) ? profile.categories : []) as string[]
  const ownPosts = useMemo(() => {
    const ct = (p: PostItem) => (p.content_type || 'post') as string
    return posts.filter((p) => ct(p) !== 'tagged')
  }, [posts])
  const engagement = useMemo(
    () => computeEngagementFromPosts(ownPosts, followersCount),
    [ownPosts, followersCount]
  )

  const embeddedProfileEngagement = useMemo(() => engagementFromProfileRecord(profile), [profile])
  const displayEngagement = isPreviewLocked
    ? (previewEngagement ?? embeddedProfileEngagement ?? engagement)
    : engagement
  const displayFollowersCount =
    isPreviewLocked && previewSummaryFollowers != null && previewSummaryFollowers > 0
      ? previewSummaryFollowers
      : followersCount
  const tierLabel = getInfluencerTierLongLabel(displayFollowersCount)
  const tierShort = getInfluencerTierShort(displayFollowersCount)
  const previewEngagementByType = useMemo(() => engagementByTypeFromProfileRecord(profile), [profile])

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

  /** ER e totais por tipo de conteúdo (posts, reels, marcados) para card de métricas. */
  const engagementByType = useMemo(() => {
    const eng = (list: PostItem[]) => computeEngagementFromPosts(list, followersCount)
    const feed = eng(mediaByType.posts)
    const reels = eng(mediaByType.reels)
    const tagged = eng(mediaByType.tagged)
    return {
      posts: { er: feed.engagement_rate ?? 0, erByViews: undefined as number | undefined, count: feed.posts_count },
      reels: { er: reels.engagement_rate ?? 0, erByViews: reels.engagement_rate_by_views, count: reels.posts_count },
      tagged: { er: tagged.engagement_rate ?? 0, erByViews: tagged.engagement_rate_by_views, count: tagged.posts_count },
    }
  }, [mediaByType.posts, mediaByType.reels, mediaByType.tagged, followersCount])

  /** Quando o usuário informou preços na ativação, sobrescreve o valor estimado por tipo com o valor informado. (Hook antes de qualquer return.) */
  const valorEstimadoPorTipoExibir = useMemo(() => {
    const rocks = reportInsights?.valorEstimadoPorTipo
    if (!rocks) return rocks ?? undefined
    const p = activation?.pricing as Record<string, string | number | undefined> | undefined
    const parseNum = (v: string | number | undefined): number | null => {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v
      if (typeof v === 'string') {
        const n = parseInt(v.replace(/\D/g, ''), 10)
        return Number.isFinite(n) && n > 0 ? n : null
      }
      return null
    }
    const keyMap = { feed: 'post' as const, reels: 'reels' as const, story: 'stories' as const, destaque: 'destaque' as const }
    const out = { ...rocks }
    for (const [actKey, tipoKey] of Object.entries(keyMap)) {
      const val = p ? parseNum(p[actKey]) : null
      if (val != null) {
        const original = (rocks as unknown as Record<string, { min: number; max: number; porque?: string }>)[tipoKey]
          ; (out as unknown as Record<string, { min: number; max: number; porque?: string }>)[tipoKey] = {
            min: val,
            max: val,
            porque: original?.porque ?? '',
          }
      }
    }
    return out
  }, [reportInsights?.valorEstimadoPorTipo, activation?.pricing])

  const showSkeleton = (profileLoading && !profile) || (postsLoading && posts.length === 0)
  if (showSkeleton) {
    return (
      <div style={{ minHeight: '100vh', paddingBottom: 80 }}>
        <ReportSkeleton />
      </div>
    )
  }

  // Perfil privado: lógica e UI encapsuladas em PrivateProfileMessage (is_private + retry + progresso). Exibe quando privado e sem posts.
  if (profile?.is_private && handle && posts.length === 0) {
    return (
      <div style={{ paddingBottom: s.xl, background: c.pageBg, minHeight: '100vh' }}>
        <div style={{ width: '100%', padding: `0 ${isMobile ? s.sm : 0}px` }}>
          <PrivateProfileMessage
            profile={profile}
            handle={handle}
            isAdm={isAdm}
            isMobile={isMobile}
            onProfileUpdate={(p, posts, dataRedacted: boolean | undefined) => {
              setProfile(p)
              setPosts(posts.items)
              setPostsTotal(posts.total)
              if (dataRedacted) setDataRedacted(true)
            }}
          />
        </div>
      </div>
    )
  }

  const profilePic = proxyImageUrl(getProfilePicUrl(profile))
  const stableProfilePic = getStableProfilePicUrl(profile)

  const hasActivationData = activation &&
    (activation.content_type?.length ||
      activation.city || activation.state || activation.neighborhood || activation.address || activation.country ||
      activation.whatsapp?.trim() || activation.tiktok?.trim() || activation.facebook?.trim() ||
      activation.linkedin?.trim() || activation.twitter?.trim() || activation.websites?.trim() ||
      activation.description?.trim() || activation.about_topics?.trim())

  /** Barra fixa “Gerar MediaKit” — só para conta logada como influenciador. */
  const showMediaKitStickyBar = user?.scope === 'influencer' && !isRedacted

  /** Blur das métricas: influenciador vendo outro perfil; ou próprio sem ativação (exceto barra do MediaKit). */
  const isOwnProfileAsInfluencer = user?.scope === 'influencer' && handle && canEditProfile(handle)
  const showMetricsBlurForOtherProfile = Boolean(
    user?.scope === 'influencer' && handle && !canEditProfile(handle)
  )
  const showMetricsBlurUntilActivation = Boolean(isOwnProfileAsInfluencer && !hasActivationData)
  const showMetricsBlur = showMetricsBlurForOtherProfile || showMetricsBlurUntilActivation
  /** Barra de métricas do MediaKit: sempre visível no próprio perfil do influenciador. */
  const showMediakitMetricsBlur = showMetricsBlurForOtherProfile

  const engagementScore = reportInsights?.score.total ?? Math.min(100, Math.round((engagement.engagement_rate / 12) * 100))
  const scoreSelo = reportInsights?.score.selo ?? 'Alto Engajamento'
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
      for (const k of ['feed', 'reels', 'story', 'destaque']) {
        all.push(...parseNums(p[k]))
      }
      if (all.length > 0) return { min: Math.min(...all), max: Math.max(...all), porque: 'baseado no seu cadastro de preços' }
    }
    const rocks = reportInsights?.valorEstimado
    if (rocks) return { min: rocks.min, max: rocks.max, porque: rocks.porque }
    return { min: 80, max: 150, porque: 'estimativa por seguidores e engajamento' }
  }
  const { min: valorEstimadoMin, max: valorEstimadoMax, porque: valorEstimadoPorque } = valorEstimadoFromPricing()

  if (requireCampaignId && campaignId == null) {
    return <ReportSkeleton />
  }

  const cardStyle = {
    borderRadius: r,
    border: 'none',
    boxShadow: sh,
    padding: s.lg,
    background: c.cardBg,
  }

  const hasList = (arr: unknown[] | undefined) => Array.isArray(arr) && arr.length > 0
  const canShowProof =
    !!reportInsights &&
    hasList(reportInsights.topPosts?.byInteractions) &&
    reportInsights.topPosts!.byInteractions.length >= 1
  const layout = {
    showPrice: 'top' as const,
    showMainCta: 'final' as const,
    showScorePills: false,
  }
  const stackGap = embeddedInModal ? MODAL_DETAIL_STACK_GAP : (isMobile ? s.lg : sectionGap)
  const rowGutter: [number, number] = [stackGap, stackGap]
  const detailStackStyle: React.CSSProperties = {
    ['--influencer-detail-gap' as string]: `${stackGap}px`,
    width: '100%',
  }

  const bio = profile?.biography ?? (profile?.data?.user as Record<string, unknown>)?.biography
  const personaSummary = profile ? getProfilePersonaSummary(profile as unknown as Record<string, unknown>) : ''
  const bioHeadline = bio != null && String(bio).trim() ? String(bio).trim() : ''
  const defaultHeadline = personaSummary || bioHeadline || 'Seu perfil tem potencial real de monetização'
  const heroHeadline = (hasActivationData && activation && (activation.content_type?.length || activation.description?.trim()))
    ? (activation.description?.trim() ? <div style={{ marginBottom: 0 }}>{activation.description.trim()}</div> : null)
    : defaultHeadline
  const heroTypesTags = (hasActivationData && activation && activation.content_type && activation.content_type.length > 0)
    ? (
      <Space wrap size={[8, 8]} className="report-hero-types-tags">
        {activation.content_type.map((ct) => (
          <Tag key={ct} color="blue" className="report-hero-type-tag">{CONTENT_TYPE_LABELS[ct] ?? ct}</Tag>
        ))}
      </Space>
    )
    : undefined

  const closeDetailView = () => {
    if (embeddedInModal && onModalClose) {
      onModalClose()
      return
    }
    if (campaignId) navigate(`/app/campaigns/${campaignId}`)
    else navigate(-1)
  }

  const modalCompact = embeddedInModal && isProfileLocked
  const detailContentPadX = isMobile
    ? (lay.contentPaddingMobile ?? s.md)
    : embeddedInModal
      ? (modalCompact ? s.sm : (lay.contentPadding ?? s.lg))
      : 0
  const detailContentPadTop = embeddedInModal ? (modalCompact ? s.sm : detailContentPadX) : 0
  const detailContentPadBottom = embeddedInModal ? (modalCompact ? s.sm : s.md) : showMediaKitStickyBar && isMobile ? 160 : s.xl
  const showDetailActions =
    (user && handle && user.scope !== 'influencer' && !isProfileLocked) ||
    (handle && canEdit) ||
    (isAdm && handle)

  const stickyCta = (
    <StickyCTA
      visible={showMediaKitStickyBar}
      isMobile={isMobile}
      primaryLabel={mediaKitCtaShortLabel}
      onPrimary={goToMediaKitOrLogin}
      embeddedInModal={embeddedInModal}
    />
  )

  return (
    <div
      className={
        embeddedInModal
          ? `influencer-detail--embedded${modalCompact ? ' influencer-detail--embedded-locked' : ''}`
          : undefined
      }
      style={{ paddingBottom: embeddedInModal ? 0 : s.xl, background: c.pageBg, minHeight: embeddedInModal ? 0 : '100vh' }}
    >

      <div
        className={embeddedInModal ? 'influencer-detail__modal-scroll' : undefined}
        style={embeddedInModal ? undefined : { display: 'contents' }}
      >

        {isRedacted && user && (
          <div style={{ width: '100%', padding: s.lg, paddingLeft: isMobile ? lay.contentPaddingMobile ?? s.md : s.lg, paddingRight: isMobile ? lay.contentPaddingMobile ?? s.md : s.lg }}>
            <div style={{ marginBottom: s.lg, padding: s.sm, background: 'var(--app-warning-bg)', border: '1px solid var(--app-warning-border)', borderRadius: r }}>
              <Text>Você atingiu o limite diário de buscas. Os dados sensíveis deste perfil estão ocultos. Volte amanhã ou <Link to="/premium">assine o plano premium</Link> para ver tudo.</Text>
            </div>
          </div>
        )}

        <div style={{ width: '100%', padding: `${detailContentPadTop}px ${detailContentPadX}px ${detailContentPadBottom}px`, position: 'relative', zIndex: 1, background: c.pageBg, boxSizing: 'border-box' }}>
          {!isRedacted && (
            <div
              className={`influencer-detail-stack${embeddedInModal ? ' influencer-detail-stack--modal' : ''}`}
              style={detailStackStyle}
            >
              <ReportHero
                profilePic={profilePic || ''}
                stableProfilePicUrl={stableProfilePic}
                name={fullName}
                handle={displayHandle}
                isMobile={isMobile}
                compact={modalCompact}
                score={reportInsights ? engagementScore : undefined}
                scoreTooltip={reportInsights?.score?.pillars
                  ? `Sua nota é uma mistura de: comunidade (${reportInsights.score.pillars.comunidade}), consistência (${reportInsights.score.pillars.consistencia}), alcance (${reportInsights.score.pillars.alcance}), autoridade (${reportInsights.score.pillars.autoridade}) e conteúdo (${reportInsights.score.pillars.conteudo}). Quanto maior, mais seu perfil está pronto para marcas e parcerias.`
                  : reportInsights ? 'É a nota geral do perfil. Quanto maior, mais pronto você está para fechar parcerias com marcas.' : undefined}
                tierBadgeShort={tierShort !== '—' ? tierShort : undefined}
                headline={heroHeadline}
                typesTags={heroTypesTags}
                tierBadgeTooltip={tierShort !== '—' ? getInfluencerTierTooltip(displayFollowersCount) : undefined}
                blurHighlights={false}
                highlights={[
                  { label: 'Seguidores', value: formatShortNum(displayFollowersCount) },
                  {
                    label: 'Posts/sem', value: displayEngagement.posts_per_week != null
                      ? displayEngagement.posts_per_week.toFixed(1)
                      : (reportInsights?.consistency?.postsPerWeekByWeek?.length
                        ? (reportInsights.consistency.postsPerWeekByWeek.reduce((a, b) => a + b, 0) / reportInsights.consistency.postsPerWeekByWeek.length).toFixed(1)
                        : '0')
                  },
                  { label: 'ER médio', value: `${(displayEngagement.engagement_rate ?? 0).toFixed(1)}%` },
                ]}
                onBack={closeDetailView}
                onAvatarError={() => {
                  if (!refreshQueuedRef.current && handle) {
                    refreshQueuedRef.current = true
                    queueRefreshProfile(handle).catch(() => { })
                    startRefreshPolling.current(handle)
                  }
                }}
                heroAction={
                  handle && canEdit && !hasActivationData && user?.profile_activated !== true ? (
                    <Tooltip title="Completar cadastro, ativação e dados do seu perfil na plataforma">
                      <Button
                        type="primary"
                        size="middle"
                        icon={<CheckCircleOutlined />}
                        onClick={() => navigate(`/activate/${encodeURIComponent(handle)}`)}
                        style={{ borderRadius: r, fontWeight: 600, whiteSpace: 'nowrap' }}
                        aria-label="Ativar cadastro"
                      >
                        Ativar Cadastro
                      </Button>
                    </Tooltip>
                  ) : undefined
                }
                extraContent={
                  <>
                    {!isLimitedView ? (
                      <>
                        {reportInsights ? (
                          <ScoreOverview
                            embedded
                            tierInHero
                            hidePostsPerWeek
                            hideExplanationInEmbedded
                            score={engagementScore}
                            tierLabel={tierLabel}
                            scoreSelo={scoreSelo}
                            percentil={reportInsights.benchmark?.percentil ?? null}
                            explanation="Quanto maior a nota, mais seu perfil está pronto para marcas e parcerias."
                            scoreNarrativaFrase={reportInsights.diagnosticoBI?.scoreNarrativaFrase ?? null}
                            statPills={layout.showScorePills ? [
                              { label: 'Seguidores', value: formatShortNum(followersCount) },
                              { label: 'Posts/sem', value: reportInsights.consistency.postsPerWeekByWeek.length ? (reportInsights.consistency.postsPerWeekByWeek.reduce((a, b) => a + b, 0) / reportInsights.consistency.postsPerWeekByWeek.length).toFixed(1) : '0' },
                              { label: 'ER médio', value: `${(engagement.engagement_rate ?? 0).toFixed(1)}%` },
                            ] : []}
                            postsPerWeekData={reportInsights.consistency.postsPerWeekByWeek}
                            bestDay={getWeekdayName(reportInsights.consistency.bestWeekday)}
                            bestHour={reportInsights.consistency.bestHour}
                          />
                        ) : null}
                      </>
                    ) : null}
                  </>
                }
              />
              {!isLimitedView && !isRedacted && hasActivationData && activation ? (
                <ProfileLocationCard
                  city={activation.city}
                  state={activation.state}
                  neighborhood={activation.neighborhood}
                  country={activation.country}
                  isActive={Boolean(activation.activated_at) || (canEdit && user?.profile_activated === true)}
                  showEdit={Boolean(canEdit && handle)}
                  onEdit={canEdit && handle ? () => navigate(`/activate/${encodeURIComponent(handle)}`) : undefined}
                  details={(
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
                        <Descriptions column={1} bordered size="small">
                          {activation.gender && (
                            <Descriptions.Item label="Gênero">{GENDER_LABELS[activation.gender] ?? activation.gender}</Descriptions.Item>
                          )}
                          {activation.audience_gender && (
                            <Descriptions.Item label="Gênero predominante do público">{AUDIENCE_GENDER_LABELS[activation.audience_gender] ?? activation.audience_gender}</Descriptions.Item>
                          )}
                          {activation.content_type?.length ? (
                            <Descriptions.Item label="Tipos de conteúdo">{activation.content_type.map((ct) => CONTENT_TYPE_LABELS[ct] ?? ct).join(', ')}</Descriptions.Item>
                          ) : null}
                          {activation.influence_audience?.length ? (
                            <Descriptions.Item label="Público que influencia (A, B, C, D)">{activation.influence_audience.join(', ')}</Descriptions.Item>
                          ) : null}
                          {activation.influence_age_range?.length ? (
                            <Descriptions.Item label="Faixa etária que influencia">{activation.influence_age_range.map((fa) => INFLUENCE_AGE_RANGE_LABELS[fa] ?? fa).join(', ')}</Descriptions.Item>
                          ) : null}
                          {activation.description?.trim() && (
                            <Descriptions.Item label="Fala de você (trajetória e proposta)"><Text style={{ whiteSpace: 'pre-wrap' }}>{activation.description.trim()}</Text></Descriptions.Item>
                          )}
                          {activation.brands_worked_with?.trim() && (
                            <Descriptions.Item label="Marcas que já trabalhou"><Text style={{ whiteSpace: 'pre-wrap' }}>{activation.brands_worked_with.trim()}</Text></Descriptions.Item>
                          )}
                          {(activation.city || activation.state || activation.neighborhood || activation.country) && (
                            <Descriptions.Item label="Localização">
                              {[activation.city, activation.state, activation.neighborhood, activation.country].filter(Boolean).join(', ') || '—'}
                            </Descriptions.Item>
                          )}
                          {activation.address && (
                            <Descriptions.Item label="Endereço">
                              {[activation.address, activation.address_number].filter(Boolean).join(', ')}
                            </Descriptions.Item>
                          )}
                          {activation.zip_code && <Descriptions.Item label="CEP">{activation.zip_code}</Descriptions.Item>}
                          {activation.whatsapp?.trim() && <Descriptions.Item label="WhatsApp"><Space><MessageOutlined style={{ color: 'var(--app-icon-whatsapp)' }} />{activation.whatsapp}</Space></Descriptions.Item>}
                          {activation.tiktok?.trim() && <Descriptions.Item label="TikTok"><Space><VideoCameraOutlined />{activation.tiktok}</Space></Descriptions.Item>}
                          {activation.facebook?.trim() && <Descriptions.Item label="Facebook"><Space><FacebookOutlined style={{ color: 'var(--app-icon-facebook)' }} />{activation.facebook}</Space></Descriptions.Item>}
                          {activation.linkedin?.trim() && <Descriptions.Item label="LinkedIn"><Space><LinkedinOutlined style={{ color: 'var(--app-icon-linkedin)' }} />{activation.linkedin}</Space></Descriptions.Item>}
                          {activation.twitter?.trim() && <Descriptions.Item label="X / Twitter"><Space><TwitterOutlined style={{ color: 'var(--app-icon-twitter)' }} />{activation.twitter}</Space></Descriptions.Item>}
                          {activation.websites?.trim() && <Descriptions.Item label="Websites">{activation.websites}</Descriptions.Item>}
                          {activation.about_topics?.trim() && <Descriptions.Item label="Temas">{activation.about_topics}</Descriptions.Item>}
                          {activation.activated_at && <Descriptions.Item label="Ativado em">{formatDate(activation.activated_at)}</Descriptions.Item>}
                          {activation.updated_at && <Descriptions.Item label="Atualizado em">{formatDate(activation.updated_at)}</Descriptions.Item>}
                        </Descriptions>
                      </div>
                    </>
                  )}
                />
              ) : null}
              {showDetailActions && isAdm && handle ? (
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: isMobile ? s.md : s.lg,
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: 0,
                    flexDirection: isMobile ? 'column' : 'row',
                  }}
                >
                  <div
                    role="group"
                    aria-label="Ações de administrador"
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: s.sm,
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: `${s.sm}px ${s.md}px`,
                      borderRadius: r,
                      background: 'color-mix(in srgb, var(--app-primary) 12%, var(--app-card-bg))',
                      border: '1px solid color-mix(in srgb, var(--app-primary) 32%, var(--app-border))',
                      boxShadow: 'inset 0 1px 0 color-mix(in srgb, var(--app-primary) 12%, transparent)',
                    }}
                  >
                    <Text
                      type="secondary"
                      style={{
                        width: '100%',
                        textAlign: 'center',
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: 'color-mix(in srgb, var(--app-primary) 55%, var(--app-text-secondary))',
                      }}
                    >
                      Administrador
                    </Text>
                    <Tooltip title="Força re-extração do perfil no Instagram (prioritária, só admin)">
                      <Button
                        type="default"
                        size="large"
                        className={DETAIL_ACTION_BTN_CLASS}
                        icon={<SyncOutlined />}
                        onClick={async () => {
                          const res = await queueRefreshProfile(handle, { priority: true })
                          if (res.queued) message.success(res.message)
                          else message.warning(res.message)
                        }}
                        style={DETAIL_SUBTLE_ACTION.adminSync}
                        aria-label="Atualizar Instagram"
                      >
                        Atualizar
                      </Button>
                    </Tooltip>
                    <Tooltip title="Abrir fluxo de ativação do cadastro do influenciador">
                      <Button
                        type="default"
                        size="large"
                        className={DETAIL_ACTION_BTN_CLASS}
                        icon={<CheckCircleOutlined />}
                        onClick={() => navigate(`/activate/${encodeURIComponent(handle)}`)}
                        style={DETAIL_SUBTLE_ACTION.adminActivate}
                        aria-label="Ativar influenciador"
                      >
                        Ativar
                      </Button>
                    </Tooltip>
                    <Tooltip title="Enviar mensagem pelo Direct do Instagram (via sistema)">
                      <Button
                        type="default"
                        size="large"
                        className={DETAIL_ACTION_BTN_CLASS}
                        icon={<MessageOutlined />}
                        onClick={() => navigate(`/app/influencer/${encodeURIComponent(handle)}/send-message`)}
                        style={DETAIL_SUBTLE_ACTION.adminMessage}
                        aria-label="Enviar mensagem"
                      >
                        Mensagem
                      </Button>
                    </Tooltip>
                    <Tooltip title="Editar classificação LLM salva na base (tags, texto, público-alvo)">
                      <Button
                        type="default"
                        size="large"
                        className={DETAIL_ACTION_BTN_CLASS}
                        icon={<RobotOutlined />}
                        onClick={() => setEditLlmOpen(true)}
                        style={DETAIL_SUBTLE_ACTION.adminLlm}
                        aria-label="Editar LLM"
                      >
                        Editar LLM
                      </Button>
                    </Tooltip>
                    <Tooltip title="Apaga perfil, posts, cadastro, fila, favoritos, referências em campanhas, arquivos no S3 e conta de usuário (se houver). Irreversível.">
                      <Button
                        type="default"
                        size="large"
                        className={DETAIL_ACTION_BTN_CLASS}
                        icon={<DeleteOutlined />}
                        style={DETAIL_SUBTLE_ACTION.adminPurge}
                        aria-label="Excluir influenciador completamente"
                        onClick={() => {
                          Modal.confirm({
                            title: 'Excluir este influenciador por completo?',
                            content: `Isso remove dados do perfil e mídias, cadastro/ativação, fila de mensagens, favoritos que apontam para @${handle}, o handle nas campanhas, objetos no S3 (avatar e capas) e a conta de usuário vinculada, se existir. Não dá para desfazer.`,
                            okText: 'Excluir tudo',
                            okType: 'danger',
                            cancelText: 'Cancelar',
                            onOk: async () => {
                              try {
                                const out = await adminPurgeInfluencer(handle)
                                const n = out?.s3ObjectsRemoved
                                message.success(
                                  typeof n === 'number' && n > 0
                                    ? `Removido. ${n} arquivo(s) apagados no S3.`
                                    : 'Influenciador removido.',
                                )
                                navigate(campaignId ? `/app/campaigns/${campaignId}` : '/app')
                              } catch (e) {
                                message.error(e instanceof Error ? e.message : 'Falha ao excluir')
                                throw e
                              }
                            },
                          })
                        }}
                      >
                        Excluir completamente
                      </Button>
                    </Tooltip>
                  </div>
                </div>
              ) : null}
              {isProfileLocked && !isRedacted && (
                <ProfileLimitedPreviewLock
                  isMobile={isMobile}
                  engagementByType={previewEngagementByType}
                  rowGutter={rowGutter}
                  user={user}
                  handle={handle}
                />
              )}
              <ProfileLlmDetailPanel
                profile={profile}
                variant="embedded"
                isMobile={isMobile}
                stripDensity={embeddedInModal ? 'compact' : undefined}
              />

              {!isLimitedView && isOwnProfileAsInfluencer && reportInsights?.diagnosticoBI?.insightPatamar && (
              <PatamarCardSection
                benchmarkTier={reportInsights.diagnosticoBI.benchmarkTier}
                proximoPatamar={reportInsights.diagnosticoBI.proximoPatamar}
                faltaParaProximo={reportInsights.diagnosticoBI.faltaParaProximo ?? 0}
                percentualNoPatamar={reportInsights.diagnosticoBI.percentualNoPatamar ?? 0}
                insightPatamar={reportInsights.diagnosticoBI.insightPatamar}
                projecaoProximoPatamar={reportInsights.diagnosticoBI.projecaoProximoPatamar ?? null}
                comparacaoLocal={
                  activation?.city && reportInsights.benchmark?.percentil != null
                    ? `Você está entre os ${Math.max(1, Math.min(99, 100 - reportInsights.benchmark.percentil))}% com maior engajamento em ${activation.city}.`
                    : reportInsights.diagnosticoBI.comparacaoLocal ?? undefined
                }
                proximoPassoConcreto={reportInsights.diagnosticoBI.proximoPassoConcreto ?? null}
                growthProjectionNote={reportInsights?.strategicMetrics?.growthProjectionNote ?? undefined}
              />
              )}

              {!isLimitedView && DETAIL_SECTION_ORDER.map((sectionId) => {
            const renderSection = (id: DetailSectionId) => {
              switch (id) {
                case 'diagnostico': {
                  if (!isOwnProfileAsInfluencer) return null
                  const topPercent = reportInsights?.benchmark?.percentil != null
                    ? Math.max(1, Math.min(99, 100 - reportInsights.benchmark.percentil))
                    : null
                  const comparacaoLocalComCidade = activation?.city && topPercent != null
                    ? `Você está entre os ${topPercent}% com maior engajamento em ${activation.city}.`
                    : reportInsights?.diagnosticoBI?.comparacaoLocal ?? null
                  return (
                    <div key="diagnostico" id="diagnostico-secao">
                      {reportInsights?.diagnosticoBI && (
                        <DiagnosticoBISection
                          erPct={reportInsights.diagnosticoBI.erPct}
                          erMaxViral={reportInsights.diagnosticoBI.erMaxViral}
                          erNote={reportInsights.diagnosticoBI.erNote}
                          benchmarkTier={reportInsights.diagnosticoBI.benchmarkTier}
                          forcas={reportInsights.diagnosticoBI.forcas}
                          ondePerdeAlcance={reportInsights.diagnosticoBI.ondePerdeAlcance}
                          alcancePositivo={reportInsights.diagnosticoBI.alcancePositivo}
                          ondePerdeMonetizacao={reportInsights.diagnosticoBI.ondePerdeMonetizacao}
                          proximoPassoTop3={reportInsights.diagnosticoBI.proximoPassoTop3}
                          nichoLabel={reportInsights.nicho ? [reportInsights.nicho.nichoDominante, ...reportInsights.nicho.subtemas].join(', ') : undefined}
                          conversationLabel={reportInsights.conversation?.label}
                          conversationCard={reportInsights.conversation ? { rate: reportInsights.conversation.rate, label: reportInsights.conversation.label, comparisonLabel: reportInsights.conversation.comparisonLabel, color: reportInsights.conversation.color } : undefined}
                          topHashtags={reportInsights.nicho?.topHashtags}
                          performingHashtags={reportInsights.nicho?.performingHashtags}
                          conversationHashtags={reportInsights.nicho?.conversationHashtags}
                          proximoPatamar={reportInsights.diagnosticoBI.proximoPatamar}
                          faltaParaProximo={reportInsights.diagnosticoBI.faltaParaProximo}
                          percentualNoPatamar={reportInsights.diagnosticoBI.percentualNoPatamar}
                          insightPatamar={reportInsights.diagnosticoBI.insightPatamar}
                          projecaoProximoPatamar={reportInsights.diagnosticoBI.projecaoProximoPatamar}
                          comparacaoLocal={comparacaoLocalComCidade}
                          hashtagsSugeridas={reportInsights.nicho?.hashtagsSugeridas}
                          proximoPassoConcreto={reportInsights.diagnosticoBI.proximoPassoConcreto}
                          growthProjectionNote={reportInsights?.strategicMetrics?.growthProjectionNote}
                          semana1Items={reportInsights.diagnosticoBI.proximoPassoTop3}
                        />
                      )}
                    </div>
                  )
                }
                case 'engajamentoPorTipo':
                  return (
                    <div
                      key="engajamento-alcance-cluster"
                      id="engajamento-alcance-cluster"
                      className="detail-er-alcance-cluster"
                    >
                      <EngajamentoPorTipoSection
                        engagementByType={engagementByType}
                        rowGutter={rowGutter}
                      />
                      {reportInsights?.strategicMetrics?.contentTypeDistribution ? (
                        <AlcanceSection
                          distribution={reportInsights.strategicMetrics.contentTypeDistribution}
                          gutter={rowGutter}
                        />
                      ) : null}
                    </div>
                  )
                case 'alcance':
                  return null
                case 'metricasMediakit':
                  return reportInsights ? (
                    <div key="metricasMediakit" id="secao-metricas-mediakit">
                      {(showMediakitMetricsBlur || isOwnProfileAsInfluencer || showMetricsBlurUntilActivation) && (
                        <h2 className="section-h2" style={{ ...typ.h2, color: c.text, textAlign: 'center', marginBottom: s.sm }}>
                          Métricas
                        </h2>
                      )}
                      <div
                        style={{
                          position: 'relative',
                          overflow: showMediakitMetricsBlur ? 'hidden' : 'visible',
                          ...(showMediakitMetricsBlur && { borderRadius: t.radius.lg, minHeight: 80 }),
                        }}
                      >
                        <div
                          style={{
                            ...(showMediakitMetricsBlur ? { filter: 'blur(6px)', userSelect: 'none', pointerEvents: 'none' } : {}),
                          }}
                        >
                          <MetricasMediakitSection
                            formatShortNum={formatShortNum}
                            followersCount={followersCount}
                            engagement={engagement}
                            conversationRate={reportInsights.conversation?.rate ?? 0}
                            conversationLabel={reportInsights.conversation?.label}
                            bestDay={getWeekdayName(reportInsights.consistency?.bestWeekday ?? 0)}
                            bestHour={reportInsights.consistency?.bestHour}
                            engagementPerWeekday={reportInsights.engagementPerWeekday ?? [0, 0, 0, 0, 0, 0, 0]}
                            maxEr={Math.max(
                              engagement.engagement_rate ?? 0,
                              ...(reportInsights.topPosts?.byInteractions?.map((t) => t.erPost) ?? [])
                            )}
                            cpmCpe={reportInsights.cpmCpe ?? { cpmEstimate: null, cpeEstimate: null }}
                            strategicMetrics={reportInsights.strategicMetrics ?? null}
                            postsByWeekday={getPostsByWeekday(ownPosts)}
                            getPostImageUrl={getPostImageUrl}
                            getPostLink={getPostLink}
                            failedPostImages={failedPostImages}
                            isMobile={isMobile}
                            blurMediakitPreview={showMetricsBlur && !showMediakitMetricsBlur}
                            mediakitLockOverlay={
                              showMetricsBlurUntilActivation ? (
                                handle && canEdit ? (
                                  <>
                                    <Button
                                      type="primary"
                                      size="small"
                                      icon={<LockOutlined />}
                                      onClick={() => navigate(`/activate/${encodeURIComponent(handle)}`)}
                                      style={{
                                        borderRadius: t.radius.md,
                                        fontWeight: 600,
                                        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                                      }}
                                    >
                                      Desbloquear análise completa
                                    </Button>
                                    <Text style={{ fontSize: typ.caption.fontSize, color: 'rgba(255,255,255,0.95)', textAlign: 'center', maxWidth: 320, lineHeight: 1.4 }}>
                                      Veja curtidas, engajamento, CPE e o melhor dia para publicar no seu perfil.
                                    </Text>
                                  </>
                                ) : (
                                  <Text style={{ fontSize: typ.caption.fontSize, color: 'rgba(255,255,255,0.95)', textAlign: 'center', maxWidth: 320, lineHeight: 1.4 }}>
                                    Análise completa disponível apenas para marcas.
                                  </Text>
                                )
                              ) : undefined
                            }
                          />
                        </div>
                        {showMediakitMetricsBlur && (
                          <div
                            style={{
                              position: 'absolute',
                              inset: 0,
                              background: 'rgba(0,0,0,0.4)',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: s.sm,
                              pointerEvents: 'auto',
                              padding: s.lg,
                            }}
                          >
                            <Text style={{ fontSize: typ.caption.fontSize, color: 'rgba(255,255,255,0.95)', textAlign: 'center', maxWidth: 320, lineHeight: 1.4 }}>
                              Análise completa disponível apenas para marcas.
                            </Text>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null
                case 'valorEpublico':
                  return reportInsights ? (
                    <div key="valorEpublico">
                      {showMetricsBlur && (
                        <h2 className="section-h2" style={{ ...typ.h2, color: c.text, textAlign: 'center', marginBottom: s.sm }}>
                          Valor estimado das postagens
                        </h2>
                      )}
                      <div
                        style={{
                          position: 'relative',
                          overflow: 'hidden',
                          ...(showMetricsBlur && { borderRadius: t.radius.lg, minHeight: 80 }),
                        }}
                      >
                        <div
                          style={{
                            ...(showMetricsBlur ? { filter: 'blur(6px)', userSelect: 'none', pointerEvents: 'none' } : {}),
                          }}
                        >
                          <ValorEpublicoSection
                            valorEstimado={{ min: valorEstimadoMin, max: valorEstimadoMax, porque: valorEstimadoPorque }}
                            valorEstimadoPorTipo={valorEstimadoPorTipoExibir ?? reportInsights.valorEstimadoPorTipo}
                            hideCta={layout.showMainCta === 'final'}
                            ctaLabel={mediaKitCtaShortLabel}
                            rowGutter={rowGutter}
                            isMobile={isMobile}
                          />
                        </div>
                        {showMetricsBlur && (
                          <div
                            style={{
                              position: 'absolute',
                              inset: 0,
                              background: 'rgba(0,0,0,0.4)',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: s.sm,
                              pointerEvents: 'auto',
                              padding: s.lg,
                            }}
                          >
                            {handle && canEditProfile(handle) ? (
                              <>
                                <Button
                                  type="primary"
                                  size="small"
                                  icon={<LockOutlined />}
                                  onClick={() => navigate(`/activate/${encodeURIComponent(handle)}`)}
                                  style={{
                                    borderRadius: t.radius.md,
                                    fontWeight: 600,
                                    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                                  }}
                                >
                                  Desbloquear análise completa
                                </Button>
                                <Text style={{ fontSize: typ.caption.fontSize, color: 'rgba(255,255,255,0.95)', textAlign: 'center', maxWidth: 320, lineHeight: 1.4 }}>
                                  Descubra quanto criadores do seu nível estão cobrando na sua cidade.
                                </Text>
                              </>
                            ) : (
                              <Text style={{ fontSize: typ.caption.fontSize, color: 'rgba(255,255,255,0.95)', textAlign: 'center', maxWidth: 320, lineHeight: 1.4 }}>
                                Análise completa disponível apenas para marcas.
                              </Text>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : postsLoading ? (
                    <Card key="valorEpublico" size="small" style={{ ...cardStyle, margin: 0 }}>
                      <div style={{ textAlign: 'center', padding: s.xl }}><Spin /></div>
                    </Card>
                  ) : null
                case 'conteudoPerforma':
                  return (
                    <div
                      key="conteudoPerforma"
                      id="secao-conteudo-performa"
                      ref={feedSectionRef}
                      className={`influencer-detail-stack${embeddedInModal ? ' influencer-detail-stack--modal' : ''}`}
                      style={detailStackStyle}
                    >
                      {!hasActivationData && user?.scope === 'influencer' && canEdit && handle && showActivationCta && (
                        <ActivationCtaPanel handle={handle} isMobile={isMobile} marginBottom={0} scrollAnchorId="secao-metricas-mediakit" />
                      )}
                      {postsLoading ? (
                        <Card size="small" style={{ ...cardStyle, margin: 0 }}>
                          <Skeleton active paragraph={{ rows: 4 }} title={{ width: 200 }} />
                        </Card>
                      ) : (
                        <>
                          {showMetricsBlur && (
                            <h2 className="section-h2" style={{ ...typ.h2, color: c.text, textAlign: 'center', marginBottom: s.sm }}>
                              Análise de Feed
                            </h2>
                          )}
                          <div
                            id="blur-feed-analysis"
                            style={{
                              margin: 0,
                              position: 'relative',
                              overflow: 'hidden',
                              borderRadius: t.radius.lg,
                              minHeight: showMetricsBlur ? 80 : undefined,
                            }}
                          >
                            <div
                              style={{
                                ...(showMetricsBlur ? { filter: 'blur(6px)', userSelect: 'none', pointerEvents: 'none' } : {}),
                              }}
                            >
                              <PostAnalysisSection reportInsights={reportInsights} engagement={engagement} postsCount={ownPosts.length} postsLoading={postsLoading} canShowProof={canShowProof} categories={categories} allHashtags={allHashtags} failedPostImages={failedPostImages} formatShortNum={formatShortNum} getPostImageUrl={getPostImageUrl} getPostLink={getPostLink} gap={stackGap} cardStyle={cardStyle} contentOnly={!hasActivationData} />
                            </div>
                            {showMetricsBlur && (
                              <div
                                style={{
                                  position: 'absolute',
                                  inset: 0,
                                  background: 'rgba(0,0,0,0.4)',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: s.sm,
                                  pointerEvents: 'auto',
                                  padding: s.lg,
                                }}
                              >
                                {handle && canEditProfile(handle) ? (
                                  <>
                                    <Button
                                      type="primary"
                                      size="small"
                                      icon={<LockOutlined />}
                                      onClick={() => navigate(`/activate/${encodeURIComponent(handle)}`)}
                                      style={{
                                        borderRadius: t.radius.md,
                                        fontWeight: 600,
                                        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                                      }}
                                    >
                                      Desbloquear análise completa
                                    </Button>
                                    <Text style={{ fontSize: typ.caption.fontSize, color: 'rgba(255,255,255,0.95)', textAlign: 'center', maxWidth: 320, lineHeight: 1.4 }}>
                                      Descubra o padrão que faz seus posts viralizarem.
                                    </Text>
                                  </>
                                ) : (
                                  <Text style={{ fontSize: typ.caption.fontSize, color: 'rgba(255,255,255,0.95)', textAlign: 'center', maxWidth: 320, lineHeight: 1.4 }}>
                                    Análise completa disponível apenas para marcas.
                                  </Text>
                                )}
                              </div>
                            )}
                          </div>
                          {showMetricsBlur && (
                            <h2 className="section-h2" style={{ ...typ.h2, color: c.text, textAlign: 'center', marginBottom: s.sm }}>
                              Análise de reels
                            </h2>
                          )}
                          <div
                            style={{
                              margin: 0,
                              position: 'relative',
                              overflow: 'hidden',
                              borderRadius: t.radius.lg,
                              minHeight: showMetricsBlur ? 80 : undefined,
                            }}
                          >
                            <div
                              style={{
                                ...(showMetricsBlur ? { filter: 'blur(6px)', userSelect: 'none', pointerEvents: 'none' } : {}),
                              }}
                            >
                              <ReelsAnalysisSection
                                reels={mediaByType.reels}
                                followersCount={followersCount}
                                failedPostImages={failedPostImages}
                                formatShortNum={formatShortNum}
                                getPostImageUrl={getPostImageUrl}
                                getPostLink={getPostLink}
                                gap={stackGap}
                                cardStyle={cardStyle}
                                lastReelAmplificationLabel={reportInsights?.strategicMetrics?.lastReelAmplificationLabel}
                                contentOnly={!hasActivationData}
                              />
                            </div>
                            {showMetricsBlur && (
                              <div
                                style={{
                                  position: 'absolute',
                                  inset: 0,
                                  background: 'rgba(0,0,0,0.4)',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: s.sm,
                                  pointerEvents: 'auto',
                                  padding: s.lg,
                                }}
                              >
                                {handle && canEditProfile(handle) ? (
                                  <>
                                    <Button
                                      type="primary"
                                      size="small"
                                      icon={<LockOutlined />}
                                      onClick={() => navigate(`/activate/${encodeURIComponent(handle)}`)}
                                      style={{
                                        borderRadius: t.radius.md,
                                        fontWeight: 600,
                                        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                                      }}
                                    >
                                      Desbloquear análise completa
                                    </Button>
                                    <Text style={{ fontSize: typ.caption.fontSize, color: 'rgba(255,255,255,0.95)', textAlign: 'center', maxWidth: 320, lineHeight: 1.4 }}>
                                      Veja qual tipo de reel tem maior potencial de descoberta.
                                    </Text>
                                  </>
                                ) : (
                                  <Text style={{ fontSize: typ.caption.fontSize, color: 'rgba(255,255,255,0.95)', textAlign: 'center', maxWidth: 320, lineHeight: 1.4 }}>
                                    Análise completa disponível apenas para marcas.
                                  </Text>
                                )}
                              </div>
                            )}
                          </div>
                          {showMetricsBlur && (
                            <h2 className="section-h2" style={{ ...typ.h2, color: c.text, textAlign: 'center', marginBottom: s.sm }}>
                              Análise de marcados
                            </h2>
                          )}
                          <div
                            style={{
                              position: 'relative',
                              overflow: 'hidden',
                              borderRadius: t.radius.lg,
                              minHeight: showMetricsBlur ? 80 : undefined,
                            }}
                          >
                            <div
                              style={{
                                ...(showMetricsBlur ? { filter: 'blur(6px)', userSelect: 'none', pointerEvents: 'none' } : {}),
                              }}
                            >
                              <TaggedAnalysisSection tagged={mediaByType.tagged} followersCount={followersCount} failedPostImages={failedPostImages} formatShortNum={formatShortNum} getPostImageUrl={getPostImageUrl} getPostLink={getPostLink} gap={stackGap} contentOnly={!hasActivationData} />
                            </div>
                            {showMetricsBlur && (
                              <div
                                style={{
                                  position: 'absolute',
                                  inset: 0,
                                  background: 'rgba(0,0,0,0.4)',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: s.sm,
                                  pointerEvents: 'auto',
                                  padding: s.lg,
                                }}
                              >
                                {handle && canEditProfile(handle) ? (
                                  <>
                                    <Button
                                      type="primary"
                                      size="small"
                                      icon={<LockOutlined />}
                                      onClick={() => navigate(`/activate/${encodeURIComponent(handle)}`)}
                                      style={{
                                        borderRadius: t.radius.md,
                                        fontWeight: 600,
                                        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                                      }}
                                    >
                                      Desbloquear análise completa
                                    </Button>
                                    <Text style={{ fontSize: typ.caption.fontSize, color: 'rgba(255,255,255,0.95)', textAlign: 'center', maxWidth: 320, lineHeight: 1.4 }}>
                                      Veja as marcas que estão buscando criadores na sua região agora.
                                    </Text>
                                  </>
                                ) : (
                                  <Text style={{ fontSize: typ.caption.fontSize, color: 'rgba(255,255,255,0.95)', textAlign: 'center', maxWidth: 320, lineHeight: 1.4 }}>
                                    Análise completa disponível apenas para marcas.
                                  </Text>
                                )}
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )
                default:
                  return null
              }
            }
            return renderSection(sectionId)
          })}
            </div>
          )}

          {!embeddedInModal ? stickyCta : null}

          <style>{`
        .detail-action-btn-subtle.ant-btn {
          transition: transform 0.16s ease, box-shadow 0.16s ease, filter 0.16s ease;
        }
        .detail-action-btn-subtle.ant-btn:hover {
          transform: translateY(-1px);
          filter: brightness(1.03);
        }
        .detail-action-btn-subtle.ant-btn:focus-visible {
          outline: 2px solid color-mix(in srgb, var(--app-primary) 40%, transparent);
          outline-offset: 2px;
        }

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
        .report-sticky-cta__btn.ant-btn-primary {
          background: var(--app-accent) !important;
          border-color: var(--app-accent) !important;
          color: var(--app-text) !important;
        }
        .report-sticky-cta__btn.ant-btn-primary:hover {
          background: var(--app-warning-accent, #b45309) !important;
          border-color: var(--app-warning-accent, #b45309) !important;
          color: var(--app-text) !important;
        }
        .section-h2 { letter-spacing: -0.02em; }
        .stat-pill { display: inline-flex; align-items: center; }
        @media print {
          .no-print { display: none !important; }
        }
      `}</style>
        </div>
      </div>

      {embeddedInModal ? stickyCta : null}

      {handle ? (
        <AdminProfileLlmEditModal
          open={editLlmOpen}
          handle={handle}
          profile={profile}
          onClose={() => setEditLlmOpen(false)}
          onSaved={reloadProfileAfterLlm}
        />
      ) : null}
    </div>
  )
}
