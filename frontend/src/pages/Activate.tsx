import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Card,
  Form,
  Input,
  Button,
  Row,
  Col,
  Spin,
  Typography,
  message,
  Select,
  Modal,
  Steps,
  Space,
  Divider,
  Radio,
  Segmented,
} from 'antd'
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  MessageOutlined,
  LinkOutlined,
  GlobalOutlined,
} from '@ant-design/icons'
import {
  fetchProfile,
  fetchProfileActivation,
  saveProfileActivation,
  deleteAccount,
  getProfilePicUrl,
  proxyImageUrl,
  type ProfileActivation,
  type PricingData,
} from '../api'
import { fetchAddressByCep } from '../utils/viaCep'
import { CONTENT_TYPE_OPTIONS } from '../constants/contentTypes'
import { PRICING_FIELD_KEYS, PRICING_FIELD_LABELS, getPricingRangeFromFollowers, FORMAT_MULTIPLIER } from '../constants/pricingBuckets'
import { getValorEstimadoPorTipoRocksDB } from '../utils/reportInsights'
import type { ProfileItem, EngagementStats } from '../api'
import { useAuth } from '../contexts/AuthContext'
import ProfileAvatar from '../components/ProfileAvatar'
import './Activate.css'
import { trackMetaPixel } from '../utils/metaPixel'

const { Title, Text } = Typography

const GENDER_OPTIONS = [
  { value: 'feminino', label: 'Feminino' },
  { value: 'masculino', label: 'Masculino' },
  { value: 'mulher_trans', label: 'Mulher trans' },
  { value: 'homem_trans', label: 'Homem trans' },
  { value: 'nao_binario', label: 'Não binário' },
  { value: 'agenero', label: 'Agênero' },
  { value: 'genero_fluido', label: 'Gênero fluido' },
  { value: 'outro', label: 'Outro' },
  { value: 'prefiro_nao_dizer', label: 'Prefiro não dizer' },
]

const INFLUENCE_AUDIENCE_OPTIONS = [
  { value: 'A', label: 'A' },
  { value: 'B', label: 'B' },
  { value: 'C', label: 'C' },
  { value: 'D', label: 'D' },
]

const INFLUENCE_AGE_RANGE_OPTIONS = [
  { value: '13-17', label: '13 a 17 anos' },
  { value: '18-24', label: '18 a 24 anos' },
  { value: '25-34', label: '25 a 34 anos' },
  { value: '35-44', label: '35 a 44 anos' },
  { value: '45-54', label: '45 a 54 anos' },
  { value: '55+', label: '55 anos ou mais' },
]

const AUDIENCE_GENDER_OPTIONS = [
  { value: 'majoritariamente_feminino', label: 'Majoritariamente feminino' },
  { value: 'majoritariamente_masculino', label: 'Majoritariamente masculino' },
  { value: 'publico_equilibrado', label: 'Público equilibrado' },
  { value: 'prefiro_nao_definir', label: 'Prefiro não definir' },
]

const ACTIVATE_DRAFT_KEY = (h: string) => `activate_draft_${h}`

const MAX_STEP = 3

function parseStepFromHash(): number {
  const m = window.location.hash.match(/^#step-(\d)$/)
  const n = m ? parseInt(m[1], 10) : 0
  return Number.isFinite(n) && n >= 0 && n <= MAX_STEP ? n : 0
}

function normalizeUrl(value: string | undefined): string {
  if (!value || typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

/** Para o campo: mostrar só @usuario quando já salvou URL completa. */
function parseTikTokHandleForForm(stored: string | undefined): string {
  if (!stored || typeof stored !== 'string') return ''
  const t = stored.trim()
  if (!t) return ''
  if (!/^https?:\/\//i.test(t)) {
    return t.startsWith('@') ? t : t ? `@${t.replace(/^@+/, '')}` : ''
  }
  try {
    const u = new URL(t)
    const path = u.pathname.replace(/\/$/, '')
    const m = path.match(/@([^/?#]+)/)
    if (m?.[1]) return `@${m[1]}`
    const parts = path.split('/').filter(Boolean)
    const last = parts[parts.length - 1]
    if (last && /^@?[a-zA-Z0-9._]+$/.test(last)) return last.startsWith('@') ? last : `@${last}`
  } catch {
    /* ignore */
  }
  return t
}

/** Salvar: usuário digita só o nome do perfil (com ou sem @) ou cola URL completa. */
function normalizeTikTokUrl(value: string | undefined): string {
  if (!value || typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  const h = trimmed.replace(/^@+/, '').split(/[/?#\s]/)[0]?.trim() ?? ''
  if (!h) return ''
  return `https://www.tiktok.com/@${h}`
}

function parseFacebookHandleForForm(stored: string | undefined): string {
  if (!stored || typeof stored !== 'string') return ''
  const t = stored.trim()
  if (!t) return ''
  if (!/^https?:\/\//i.test(t)) return t.replace(/^@+/, '')
  try {
    const u = new URL(t)
    const host = u.hostname.replace(/^www\./, '')
    if (!/facebook\.com$/i.test(host) && !/fb\.com$/i.test(host)) return t
    if (u.pathname.includes('profile.php')) return t
    const parts = u.pathname.split('/').filter(Boolean)
    if (parts.length === 0) return t
    const last = parts[parts.length - 1]
    if (last && /\.php$/i.test(last)) return t
    return last || t
  } catch {
    return t
  }
}

function normalizeFacebookUrl(value: string | undefined): string {
  if (!value || typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (/facebook\.com|fb\.com|profile\.php/i.test(trimmed)) return normalizeUrl(trimmed)
  const slug = trimmed.replace(/^@+/, '').split(/[/?#\s]/)[0]?.trim() ?? ''
  if (!slug) return ''
  return `https://www.facebook.com/${slug}`
}

function parseLinkedInHandleForForm(stored: string | undefined): string {
  if (!stored || typeof stored !== 'string') return ''
  const t = stored.trim()
  if (!t) return ''
  if (!/^https?:\/\//i.test(t)) return t
  try {
    const u = new URL(t)
    if (!/linkedin\.com$/i.test(u.hostname.replace(/^www\./, ''))) return t
    const parts = u.pathname.split('/').filter(Boolean)
    if (parts[0] === 'in' && parts[1]) return parts[1]
    if (parts[0] === 'company' && parts[1]) return `company/${parts[1]}`
  } catch {
    /* ignore */
  }
  return t
}

function normalizeLinkedInUrl(value: string | undefined): string {
  if (!value || typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  const company = trimmed.match(/^company\/([^/?#\s]+)/i)
  if (company?.[1]) return `https://www.linkedin.com/company/${company[1]}`
  const slug = trimmed.split(/[/?#\s]/)[0]?.trim() ?? ''
  if (!slug) return ''
  return `https://www.linkedin.com/in/${slug}`
}

function parseTwitterHandleForForm(stored: string | undefined): string {
  if (!stored || typeof stored !== 'string') return ''
  const t = stored.trim()
  if (!t) return ''
  if (!/^https?:\/\//i.test(t)) {
    return t.startsWith('@') ? t : `@${t.replace(/^@+/, '')}`
  }
  try {
    const u = new URL(t)
    const host = u.hostname.replace(/^www\./, '')
    if (!/^(x|twitter)\.com$/i.test(host)) return t
    const parts = u.pathname.split('/').filter(Boolean)
    if (parts[0] === 'i' && parts[1] === 'status') return t
    const h = parts[parts.length - 1]
    if (h && /^[a-zA-Z0-9_]+$/.test(h)) return `@${h}`
  } catch {
    /* ignore */
  }
  return t
}

function normalizeTwitterUrl(value: string | undefined): string {
  if (!value || typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  const h = trimmed.replace(/^@+/, '').split(/[/?#\s]/)[0]?.trim() ?? ''
  if (!h) return ''
  return `https://x.com/${h}`
}

function stripUrlSchemeForDisplay(s: string): string {
  const t = s.trim()
  if (!t) return ''
  if (!/^https?:\/\//i.test(t)) return t
  try {
    const u = new URL(t)
    const path = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '')
    const tail = `${path}${u.search}`.replace(/\/$/, '')
    return tail ? `${u.host}${tail}` : u.host
  } catch {
    return t.replace(/^https?:\/\//i, '')
  }
}

function parseWebsitesForForm(stored: string | undefined): string {
  if (!stored || typeof stored !== 'string') return ''
  const parts = stored.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean)
  if (parts.length === 0) return ''
  return parts.map(stripUrlSchemeForDisplay).join('\n')
}

function normalizeWebsites(value: string | undefined): string {
  if (!value || typeof value !== 'string') return ''
  const tokens = value.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean)
  if (tokens.length === 0) return ''
  return tokens
    .map((p) => {
      if (/^https?:\/\//i.test(p)) return p
      if (p.startsWith('//')) return `https:${p}`
      return normalizeUrl(p)
    })
    .join(', ')
}

function formatWhatsApp(value: string | undefined): string {
  if (!value || typeof value !== 'string') return ''
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 2) return digits ? `+${digits}` : ''
  if (digits.length <= 4) return `+${digits.slice(0, 2)} (${digits.slice(2)}`
  if (digits.length <= 9) return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4)}`
  return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9, 13)}`
}

function parseWhatsAppDigits(value: string | undefined): string {
  if (!value || typeof value !== 'string') return ''
  return value.replace(/\D/g, '')
}

/** Alto = valor máximo da faixa + 30%. */
function getAltoValue(max: number): number {
  return Math.round(max * 1.3)
}

/** Converte valor em reais no nível 0=Baixo, 1=Ideal, 2=Alto. Baixo=min da faixa, Ideal=max da faixa, Alto=max+30%. */
function valueToLevel(val: number | undefined, min: number, _suggested: number, max: number): 0 | 1 | 2 {
  const v = Number(val)
  if (!Number.isFinite(v)) return 1
  const high = getAltoValue(max)
  if (v <= min) return 0
  if (v >= high) return 2
  if (v <= max) return (v - min) <= (max - v) ? 0 : 1
  return (v - max) <= (high - v) ? 1 : 2
}

/** Converte nível 0/1/2 no valor em reais: Baixo=min, Ideal=max (valor máximo sugerido), Alto=max+30%. */
function levelToValue(level: number, min: number, _suggested: number, max: number): number {
  if (level <= 0) return min
  if (level >= 2) return getAltoValue(max)
  return max
}

/** Engagement vazio para calcular valor estimado só com perfil (seguidores, verificado). Na ativação não temos posts. */
const EMPTY_ENGAGEMENT: EngagementStats = {
  posts_count: 0,
  total_likes: 0,
  total_comments: 0,
  total_views: 0,
  avg_likes: 0,
  avg_comments: 0,
  avg_views: 0,
  engagement_rate: 0,
}

/** Mapeia campo de preço da ativação para chave do valor estimado por tipo. */
const PRICING_KEY_TO_VALOR_TIPO = { feed: 'post' as const, reels: 'reels' as const, story: 'stories' as const, destaque: 'destaque' as const }

const PRICING_LEVEL_OPTIONS: { label: string; value: 0 | 1 | 2 }[] = [
  { label: 'Baixo', value: 0 },
  { label: 'Ideal', value: 1 },
  { label: 'Alto', value: 2 },
]

/** Seleção discreta Baixo / Médio / Alto: armazena valor em reais no form. */
function PricingLevelSegmented({
  value,
  onChange,
  min,
  suggested,
  max,
}: {
  value?: number
  onChange?: (n: number) => void
  min: number
  suggested: number
  max: number
}) {
  const level = valueToLevel(value, min, suggested, max)
  return (
    <Segmented
      options={PRICING_LEVEL_OPTIONS}
      value={level}
      onChange={(v) => {
        const l = v as 0 | 1 | 2
        onChange?.(levelToValue(l, min, suggested, max))
      }}
      block
      className="activate-pricing-segmented"
    />
  )
}

export default function Activate() {
  const { handle } = useParams<{ handle: string }>()
  const navigate = useNavigate()
  const { canEditProfile, logout, refreshUser, isAdm, loading: authLoading } = useAuth()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [step, setStep] = useState(parseStepFromHash)
  const saveDraftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const firstFieldStep0Ref = useRef<HTMLDivElement>(null)
  const firstFieldStep1Ref = useRef<HTMLDivElement>(null)
  const firstFieldStep2Ref = useRef<HTMLDivElement>(null)
  const firstFieldStep3Ref = useRef<HTMLDivElement>(null)
  const [profileName, setProfileName] = useState<string | null>(null)
  const [profilePic, setProfilePic] = useState<string | undefined>(undefined)
  const [cepLoading, setCepLoading] = useState(false)
  const [followersCount, setFollowersCount] = useState<number>(0)
  const [profile, setProfile] = useState<ProfileItem | null>(null)

  useEffect(() => {
    if (!handle) return
    if (authLoading) return
    if (!canEditProfile(handle)) {
      navigate('/app', { replace: true })
      return
    }
    let cancelled = false
    setLoading(true)
    Promise.all([
      fetchProfile(handle).catch(() => null),
      fetchProfileActivation(handle).catch(() => ({})),
    ]).then(([profile, activation]) => {
      if (cancelled) return
      if (profile) {
        setProfile(profile)
        setProfileName((profile.full_name as string) || (profile.username as string) || handle)
        setFollowersCount((profile as ProfileItem).followers_count ?? 0)
        const pic = getProfilePicUrl(profile)
        const picUrl = pic ? proxyImageUrl(pic) : undefined
        setProfilePic(picUrl)
      }
      const act = (activation || {}) as ProfileActivation
      const followers = (profile as ProfileItem | null)?.followers_count ?? 0
      const range = getPricingRangeFromFollowers(followers)
      const valorPorTipo = profile
        ? getValorEstimadoPorTipoRocksDB(profile as ProfileItem, EMPTY_ENGAGEMENT)
        : followers > 0
          ? getValorEstimadoPorTipoRocksDB({ key: '', followers_count: followers } as ProfileItem, EMPTY_ENGAGEMENT)
          : null
      const pricingForm: Record<string, number | undefined> = {}
      if (act.pricing && typeof act.pricing === 'object') {
        for (const k of PRICING_FIELD_KEYS) {
          const v = act.pricing[k as keyof PricingData]
          if (v !== undefined && v !== null && v !== '') {
            const n = Number(v)
            if (Number.isFinite(n)) pricingForm[k] = n
          }
        }
      }
      const hasNoPricing =
        Object.keys(pricingForm).length === 0 ||
        PRICING_FIELD_KEYS.every((k) => (Number(pricingForm[k]) || 0) === 0)
      if (hasNoPricing) {
        if (valorPorTipo) {
          pricingForm.feed = valorPorTipo.post.max
          pricingForm.reels = valorPorTipo.reels.max
          pricingForm.story = valorPorTipo.stories.max
          pricingForm.destaque = valorPorTipo.destaque.max
        } else {
          pricingForm.feed = Math.max(10, range.suggestedFeed)
          pricingForm.reels = Math.max(10, Math.round(range.suggestedFeed * 1.2))
          pricingForm.story = Math.max(10, Math.round(range.suggestedFeed * 0.25))
          pricingForm.destaque = Math.max(10, Math.round(range.suggestedFeed * 0.5))
        }
      }
      // Preço sugerido (quando usuário não informou) já vem como default na API (GET activation).
      const neighborhoodsList =
        act.neighborhood?.split(',').map((s) => s.trim()).filter(Boolean) ?? []
      const profileBio =
        (profile as ProfileItem)?.biography ??
        (profile?.data?.user as { biography?: string } | undefined)?.biography
      const suggestedBio =
        typeof profileBio === 'string' && profileBio.trim() ? profileBio.trim() : ''
      const formValuesFromAct = {
        address: act.address ?? '',
        address_number: act.address_number ?? '',
        zip_code: act.zip_code ?? '',
        city: act.city ?? '',
        state: act.state ?? '',
        neighborhoods: neighborhoodsList,
        informar_endereco_completo: act.allow_gifts,
        whatsapp: act.whatsapp ?? '',
        tiktok: parseTikTokHandleForForm(act.tiktok),
        facebook: parseFacebookHandleForForm(act.facebook),
        linkedin: parseLinkedInHandleForForm(act.linkedin),
        twitter: parseTwitterHandleForForm(act.twitter),
        websites: parseWebsitesForForm(act.websites),
        gender: act.gender ?? undefined,
        description: act.description?.trim() || suggestedBio,
        content_type: act.content_type ?? [],
        influence_audience: act.influence_audience ?? [],
        influence_age_range: act.influence_age_range ?? [],
        audience_gender: act.audience_gender ?? undefined,
        brands_worked_with: act.brands_worked_with ?? '',
        pricing: pricingForm,
      }
      let valuesToSet = formValuesFromAct
      try {
        const raw = localStorage.getItem(ACTIVATE_DRAFT_KEY(handle))
        if (raw) {
          const parsed = JSON.parse(raw) as Record<string, unknown> | null
          if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
            valuesToSet = { ...formValuesFromAct, ...parsed }
          }
        }
      } catch {
        // ignora rascunho inválido
      }
      // Garantir que pricing nunca fique vazio/zerado: usar sugestão da plataforma como fallback
      const draftPricing = valuesToSet.pricing as Record<string, unknown> | undefined
      const pricingEmptyOrZero =
        !draftPricing ||
        typeof draftPricing !== 'object' ||
        PRICING_FIELD_KEYS.every(
          (k) => draftPricing[k] === undefined || draftPricing[k] === null || draftPricing[k] === '' || Number(draftPricing[k]) === 0
        )
      if (pricingEmptyOrZero) {
        valuesToSet = { ...valuesToSet, pricing: { ...pricingForm } }
      }
      // Se a descrição ficou vazia (ex.: rascunho com ""), preenche com a bio do perfil como sugestão
      const desc = valuesToSet.description
      if ((!desc || typeof desc !== 'string' || !desc.trim()) && suggestedBio) {
        valuesToSet = { ...valuesToSet, description: suggestedBio }
      }
      form.setFieldsValue(valuesToSet)
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [handle, form, canEditProfile, navigate, authLoading])

  useEffect(() => {
    window.location.hash = `#step-${step}`
  }, [step])

  useEffect(() => {
    const onHashChange = () => setStep(parseStepFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    return () => {
      if (saveDraftTimerRef.current) {
        clearTimeout(saveDraftTimerRef.current)
        saveDraftTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const refs = [firstFieldStep0Ref, firstFieldStep1Ref, firstFieldStep2Ref, firstFieldStep3Ref]
    const el = refs[step]?.current
    if (!el) return
    const focusable = el.querySelector<HTMLElement>('input:not([type="hidden"]), textarea, .ant-select-selector, [role="combobox"]')
    if (focusable && typeof focusable.focus === 'function') focusable.focus()
  }, [step])

  const buildPayload = (values: Record<string, unknown>) => {
    const pricing = values.pricing as Record<string, number | string> | undefined
    const pricingData: PricingData = {}
    if (pricing && typeof pricing === 'object') {
      for (const key of PRICING_FIELD_KEYS) {
        const v = pricing[key]
        if (typeof v === 'number' && Number.isFinite(v)) pricingData[key] = String(v)
        if (typeof v === 'string' && v.trim()) pricingData[key] = v.trim()
      }
    }
    const neighborhoodsArr = Array.isArray(values.neighborhoods)
      ? (values.neighborhoods as string[]).map((s) => String(s).trim()).filter(Boolean)
      : []
    const neighborhoodStr =
      neighborhoodsArr.length > 0 ? neighborhoodsArr.join(', ') : undefined
    return {
      address: values.informar_endereco_completo === true && typeof values.address === 'string' ? values.address?.trim() || undefined : undefined,
      address_number: values.informar_endereco_completo === true && typeof values.address_number === 'string' ? values.address_number?.trim() || undefined : undefined,
      zip_code: typeof values.zip_code === 'string' ? values.zip_code?.trim() || undefined : undefined,
      city: typeof values.city === 'string' ? values.city?.trim() || undefined : undefined,
      state: typeof values.state === 'string' ? values.state?.trim() || undefined : undefined,
      neighborhood: neighborhoodStr,
      country: undefined,
      allow_gifts: values.informar_endereco_completo === true,
      whatsapp: typeof values.whatsapp === 'string' ? values.whatsapp?.trim() || undefined : undefined,
      tiktok: typeof values.tiktok === 'string' ? normalizeTikTokUrl(values.tiktok).trim() || undefined : undefined,
      facebook: typeof values.facebook === 'string' ? normalizeFacebookUrl(values.facebook).trim() || undefined : undefined,
      linkedin: typeof values.linkedin === 'string' ? normalizeLinkedInUrl(values.linkedin).trim() || undefined : undefined,
      twitter: typeof values.twitter === 'string' ? normalizeTwitterUrl(values.twitter).trim() || undefined : undefined,
      websites: typeof values.websites === 'string' ? normalizeWebsites(values.websites).trim() || undefined : undefined,
      gender: typeof values.gender === 'string' ? values.gender || undefined : undefined,
      description: typeof values.description === 'string' ? values.description?.trim() || undefined : undefined,
      content_type: Array.isArray(values.content_type) && values.content_type.length
        ? values.content_type.filter((x): x is string => typeof x === 'string')
        : undefined,
      influence_audience: Array.isArray(values.influence_audience) && values.influence_audience.length
        ? values.influence_audience.filter((x): x is string => typeof x === 'string')
        : undefined,
      influence_age_range: Array.isArray(values.influence_age_range) && values.influence_age_range.length
        ? values.influence_age_range.filter((x): x is string => typeof x === 'string')
        : undefined,
      audience_gender: typeof values.audience_gender === 'string' ? values.audience_gender || undefined : undefined,
      brands_worked_with: typeof values.brands_worked_with === 'string' ? values.brands_worked_with?.trim() || undefined : undefined,
      pricing: Object.keys(pricingData).length ? pricingData : undefined,
    }
  }

  const informarEnderecoCompleto = Form.useWatch('informar_endereco_completo', form)
  const pricingValues = Form.useWatch('pricing', form) as Record<string, number> | undefined
  const pricingRange = useMemo(
    () => getPricingRangeFromFollowers(followersCount),
    [followersCount]
  )
  /** Ranges por formato (feed, reels, story, destaque) iguais ao valor estimado do detalhe do influenciador. Usa perfil completo ou perfil sintético (só seguidores) quando perfil ainda não carregou. */
  const valorEstimadoPorTipo = useMemo(() => {
    if (profile) return getValorEstimadoPorTipoRocksDB(profile, EMPTY_ENGAGEMENT)
    if (followersCount > 0) {
      const synthetic: ProfileItem = { key: '', followers_count: followersCount }
      return getValorEstimadoPorTipoRocksDB(synthetic, EMPTY_ENGAGEMENT)
    }
    return null
  }, [profile, followersCount])

  const scrollToFirstError = () => {
    setTimeout(() => {
      const firstError = document.querySelector('.ant-form-item-has-error')
      if (!firstError) return
      const target = firstError.previousElementSibling ?? firstError
      target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
    }, 100)
  }

  const goToNextStep = () => {
    const onError = () => {
      scrollToFirstError()
    }
    if (step === 0) {
      form.validateFields(['gender', 'audience_gender', 'content_type', 'influence_audience', 'influence_age_range', 'description']).then(() => {
        trackMetaPixel('Lead', { source: 'activate_step_0_complete' })
        setStep((s) => s + 1)
      }).catch(onError)
    } else if (step === 1) {
      const informar = form.getFieldValue('informar_endereco_completo')
      const address = form.getFieldValue('address')
      const addressNumber = form.getFieldValue('address_number')
      if (informar === true && (!address || !String(address).trim())) {
        form.setFields([{ name: 'address', errors: ['Coloca o endereço completo.'] }])
        scrollToFirstError()
        return
      }
      if (informar === true && (!addressNumber || !String(addressNumber).trim())) {
        form.setFields([{ name: 'address_number', errors: ['Coloca o número e complemento.'] }])
        scrollToFirstError()
        return
      }
      form.validateFields(['zip_code', 'informar_endereco_completo', 'address', 'address_number']).then(() => {
        trackMetaPixel('Lead', { source: 'activate_step_1_complete' })
        setStep((s) => s + 1)
      }).catch(onError)
    } else if (step === 2) {
      // Preços: opcional, pode seguir sem validar
      trackMetaPixel('Lead', { source: 'activate_step_2_complete' })
      setStep((s) => s + 1)
    } else if (step === 3) {
      form.validateFields(['whatsapp']).then(() => {
        form.submit()
      }).catch(onError)
    }
  }

  const onFinish = async (values: Record<string, unknown>) => {
    if (!handle) return
    setSaving(true)
    try {
      await saveProfileActivation(handle, buildPayload(values))
      trackMetaPixel('CompleteRegistration', { source: 'activate_submit_success' })
      await refreshUser()
      try {
        localStorage.removeItem(ACTIVATE_DRAFT_KEY(handle))
      } catch {
        // ignora falha ao limpar rascunho
      }
      message.success('Cadastro ativado.')
      navigate(`/app/influencer/${encodeURIComponent(handle)}/media-kit`, { replace: true })
    } catch {
      message.error('Não deu pra salvar. Tenta de novo.')
    } finally {
      setSaving(false)
    }
  }

  if (!handle) {
    return (
      <div style={{ padding: 24 }}>
        <Button type="link" icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>
          Voltar
        </Button>
        <Title level={4}>Perfil não informado.</Title>
      </div>
    )
  }

  if (authLoading || loading) {
    return (
      <div style={{ textAlign: 'center', padding: 48 }}>
        <Spin size="large" />
      </div>
    )
  }

  if (!profile) {
    return (
      <div style={{ padding: 24 }}>
        <Button type="link" icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>
          Voltar
        </Button>
        <Title level={4}>Não foi possível carregar o perfil.</Title>
        <Text type="secondary">Verifique o usuário e tente novamente.</Text>
      </div>
    )
  }

  const steps = [
    { title: 'Essencial', description: '' },
    { title: 'Local', description: '' },
    { title: 'Preços', description: '' },
    { title: 'Contato', description: '' },
  ]

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div>
        <Button
          type="link"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate(`/app/influencer/${encodeURIComponent(handle)}`)}
          style={{ marginBottom: 16 }}
        >
          Voltar ao perfil
        </Button>

        <Card
          style={{
            boxShadow: 'var(--app-shadow-lg)',
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          {/* Cabeçalho premium */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 24 }}>
            <ProfileAvatar
              src={profilePic}
              handle={handle}
              size={72}
              border="3px solid var(--app-placeholder-bg)"
              fallbackIconSize={32}
            />
            <div style={{ flex: 1 }}>
              <Title level={4} style={{ margin: 0, fontWeight: 600 }}>
                Perfil do influencer
              </Title>
              <Text type="secondary" style={{ fontSize: 14 }}>
                @{handle}
                {profileName ? ` · ${profileName}` : ''}
              </Text>

            </div>
          </div>

          <Steps current={step} size="small" style={{ marginBottom: 28 }}>
            {steps.map((s, i) => (
              <Steps.Step key={i} title={s.title} description={s.description} />
            ))}
          </Steps>

          <Form
            form={form}
            layout="vertical"
            onValuesChange={() => {
              if (!handle) return
              if (saveDraftTimerRef.current) clearTimeout(saveDraftTimerRef.current)
              saveDraftTimerRef.current = setTimeout(() => {
                try {
                  const values = form.getFieldsValue()
                  localStorage.setItem(ACTIVATE_DRAFT_KEY(handle), JSON.stringify(values))
                } catch {
                  // ignora falha ao salvar rascunho
                }
                saveDraftTimerRef.current = null
              }, 500)
            }}
            onFinish={onFinish}
            onFinishFailed={() => {
              setTimeout(() => {
                window.scrollBy(0, -100)
              }, 100)
            }}
            scrollToFirstError
          >
            {/* Passo 0: Essencial */}
            <div ref={firstFieldStep0Ref} style={{ display: step === 0 ? 'block' : 'none' }}>
              <>
                <Form.Item
                  name="gender"
                  label="1. Qual o seu gênero?"
                  rules={[{ required: true, message: 'Informe o gênero' }]}
                >
                  <Select placeholder="Selecione" allowClear options={GENDER_OPTIONS} />
                </Form.Item>
                <Form.Item
                  name="audience_gender"
                  label="2. Gênero predominante do seu público"
                  rules={[{ required: true, message: 'Selecione uma opção' }]}
                >
                  <Radio.Group options={AUDIENCE_GENDER_OPTIONS} />
                </Form.Item>
                <Form.Item
                  name="content_type"
                  label="Quais os tipos de conteúdo que você cria?"
                  required
                  rules={[{ type: 'array' as const, min: 1, message: 'Selecione pelo menos um tipo de conteúdo' }]}
                >
                  <Select
                    mode="multiple"
                    placeholder="Ex.: fitness, moda, viagens"
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    options={CONTENT_TYPE_OPTIONS}
                    maxTagCount="responsive"
                  />
                </Form.Item>
                <Form.Item
                  name="influence_audience"
                  label="Público que influencia (A, B, C, D)?"
                  required
                  extra="Classes socioeconômicas do público que você atinge."
                  rules={[{ type: 'array' as const, min: 1, message: 'Selecione pelo menos uma classe (A, B, C ou D)' }]}
                >
                  <Select
                    mode="multiple"
                    placeholder="Selecione as classes"
                    allowClear
                    options={INFLUENCE_AUDIENCE_OPTIONS}
                    maxTagCount="responsive"
                  />
                </Form.Item>
                <Form.Item
                  name="influence_age_range"
                  label="Faixa etária que influencia?"
                  required
                  extra="Idade do público que você mais atinge."
                  rules={[{ type: 'array' as const, min: 1, message: 'Selecione pelo menos uma faixa etária' }]}
                >
                  <Select
                    mode="multiple"
                    placeholder="Selecione as faixas"
                    allowClear
                    options={INFLUENCE_AGE_RANGE_OPTIONS}
                    maxTagCount="responsive"
                  />
                </Form.Item>
                <Form.Item
                  name="description"
                  label="Fala de você (trajetória e proposta)"
                  required
                  extra="Em poucas linhas: quem você é e o que oferece. Mín. 50 caracteres."
                  rules={[
                    { required: true, message: 'Preenche com pelo menos 50 caracteres.' },
                    {
                      validator: (_, v) => {
                        if (!v || typeof v !== 'string') return Promise.reject(new Error('Preenche com pelo menos 50 caracteres.'))
                        if (v.trim().length < 50) return Promise.reject(new Error('Preenche com pelo menos 50 caracteres.'))
                        return Promise.resolve()
                      },
                    },
                  ]}
                >
                  <Input.TextArea
                    placeholder="Conta um pouco de você e o que você oferece"
                    rows={4}
                    showCount
                    maxLength={2000}
                  />
                </Form.Item>
                <Form.Item
                  name="brands_worked_with"
                  label="Cite marcas que você já trabalhou"
                  extra="Opcional. Ex.: Nike, Natura, Magazine Luiza..."
                >
                  <Input.TextArea
                    placeholder="Marcas com as quais já fez parcerias"
                    rows={2}
                    showCount
                    maxLength={1000}
                  />
                </Form.Item>

              </>
            </div>

            {/* Passo 1: Localização */}
            <div ref={firstFieldStep1Ref} style={{ display: step === 1 ? 'block' : 'none' }}>
              <>
                <Text type="secondary" style={{ display: 'block', marginBottom: 16, fontSize: 13 }}>
                  Preenche pra marcas da sua região te encontrarem.
                </Text>
                <Row gutter={16}>
                  <Col xs={24} sm={12}>
                    <Form.Item
                      name="zip_code"
                      label="CEP"
                      rules={[
                        { required: true, message: 'Informe o CEP' },
                        {
                          validator: (_, v) => {
                            if (!v || !String(v).trim()) return Promise.resolve()
                            const digits = String(v).replace(/\D/g, '')
                            if (digits.length !== 8) {
                              return Promise.reject(new Error('CEP tem 8 números.'))
                            }
                            return Promise.resolve()
                          },
                        },
                      ]}
                    >
                      <Input
                        placeholder="Ex.: 01310-100"
                        maxLength={9}
                        onChange={(e) => {
                          const cep = e.target.value?.trim()
                          if (!cep || cep.replace(/\D/g, '').length !== 8) return
                          setCepLoading(true)
                          fetchAddressByCep(cep).then((data) => {
                            if (!data) return
                            form.setFieldsValue({
                              address: data.logradouro ?? form.getFieldValue('address'),
                              city: data.localidade ?? form.getFieldValue('city'),
                              state: data.uf ?? form.getFieldValue('state'),
                            })
                            const bairro = data.bairro?.trim()
                            if (bairro) {
                              const current = (form.getFieldValue('neighborhoods') as string[]) ?? []
                              const lower = bairro.toLowerCase()
                              if (!current.some((n) => n.trim().toLowerCase() === lower)) {
                                form.setFieldsValue({ neighborhoods: [...current, bairro] })
                              }
                            }
                          }).finally(() => setCepLoading(false))
                        }}
                        suffix={cepLoading ? <Spin size="small" /> : undefined}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Form.Item name="city" label="Cidade">
                      <Input placeholder="Preenchido pelo CEP" readOnly />
                    </Form.Item>
                  </Col>
                </Row>
                <Row gutter={16}>
                  <Col xs={24} sm={12}>
                    <Form.Item name="state" label="Estado (UF)">
                      <Input placeholder="Preenchido pelo CEP" maxLength={2} readOnly />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Form.Item name="neighborhoods" label="Bairro">
                      <Select
                        mode="tags"
                        placeholder="Preenchido pelo CEP"
                        disabled
                        maxTagCount="responsive"
                        style={{ width: '100%' }}
                        options={[]}
                      />
                    </Form.Item>
                  </Col>
                </Row>
                <Row gutter={16} align="middle">
                  <Col flex="0 0 auto" style={{ fontSize: 45, marginTop: -30, lineHeight: 1 }}>
                    🎁
                  </Col>
                  <Col flex="1" style={{ minWidth: 0 }}>
                    <Form.Item
                      name="informar_endereco_completo"
                      label="Quer receber brindes/amostras em casa?"
                      rules={[{ required: true, message: 'Responde se quer receber brindes em casa.' }]}
                    >
                      <Radio.Group>
                        <Radio value={true}>Sim</Radio>
                        <Radio value={false}>Não</Radio>
                      </Radio.Group>
                    </Form.Item>
                  </Col>
                </Row>
                {informarEnderecoCompleto === true && (
                  <Row gutter={[16, 0]}>
                    <Col xs={24} md={14}>
                      <Form.Item
                        name="address"
                        label="Endereço completo"
                        required={informarEnderecoCompleto === true}
                        rules={[
                          {
                            validator: (_, v) => {
                              if (form.getFieldValue('informar_endereco_completo') !== true) return Promise.resolve()
                              if (!v || !String(v).trim()) return Promise.reject(new Error('Coloca o endereço completo.'))
                              return Promise.resolve()
                            },
                          },
                        ]}
                      >
                        <Input placeholder="Rua Doutor Miguel Vieira Ferreira" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={10}>
                      <Form.Item
                        name="address_number"
                        label="Número (complemento)"
                        required={informarEnderecoCompleto === true}
                        rules={[
                          {
                            required: informarEnderecoCompleto === true,
                            message: 'Coloca o número e complemento.',
                          },
                          {
                            validator: (_, v) => {
                              if (form.getFieldValue('informar_endereco_completo') !== true) return Promise.resolve()
                              if (!v || !String(v).trim()) return Promise.reject(new Error('Coloca o número e complemento.'))
                              return Promise.resolve()
                            },
                          },
                        ]}
                      >
                        <Input placeholder="Ex.: 123, apto 45" />
                      </Form.Item>
                    </Col>
                  </Row>
                )}
              </>
            </div>

            {/* Passo 2: Preços — seleção Baixo / Médio / Alto por formato */}
            <div ref={firstFieldStep2Ref} className="activate-pricing-step" style={{ display: step === 2 ? 'block' : 'none' }}>
              <div className="activate-pricing-intro">
                <p>Marcas e agências usam esse valor para encontrar criadores nas buscas da plataforma.</p>
                <p>Influenciadores que posicionam bem seu preço recebem mais convites para campanhas e parcerias.</p>
              </div>
              <Row gutter={[16, 0]}>
                {PRICING_FIELD_KEYS.map((key) => {
                  const tipoKey = PRICING_KEY_TO_VALOR_TIPO[key]
                  const useValorEstimado = valorEstimadoPorTipo != null && tipoKey
                  const min = useValorEstimado
                    ? valorEstimadoPorTipo[tipoKey].min
                    : Math.max(10, Math.round(key === 'feed' ? pricingRange.min : pricingRange.min * FORMAT_MULTIPLIER[key]))
                  const max = useValorEstimado
                    ? valorEstimadoPorTipo[tipoKey].max
                    : Math.round(key === 'feed' ? pricingRange.max : pricingRange.max * FORMAT_MULTIPLIER[key])
                  const suggested = useValorEstimado
                    ? Math.round((valorEstimadoPorTipo[tipoKey].min + valorEstimadoPorTipo[tipoKey].max) / 2)
                    : key === 'feed' ? pricingRange.suggestedFeed : Math.round(pricingRange.suggestedFeed * FORMAT_MULTIPLIER[key])
                  const suggestedClamped = Math.max(min, Math.min(max, Math.max(10, suggested)))
                  const currentVal = Number(pricingValues?.[key]) || max
                  return (
                    <Col xs={24} sm={12} key={key}>
                      <div className="activate-pricing-bar">
                        <div className="activate-pricing-bar-header">
                          <span className="activate-pricing-bar-title">{PRICING_FIELD_LABELS[key]}</span>
                          <span className="activate-pricing-bar-value">R$ {currentVal.toLocaleString('pt-BR')}</span>
                        </div>
                        <Form.Item name={['pricing', key]} style={{ marginBottom: 0 }} noStyle>
                          <PricingLevelSegmented
                            value={currentVal}
                            min={min}
                            suggested={suggestedClamped}
                            max={max}
                          />
                        </Form.Item>
                      </div>
                    </Col>
                  )
                })}
              </Row>
            </div>

            {/* Passo 3: Redes & Contato */}
            <div ref={firstFieldStep3Ref} style={{ display: step === 3 ? 'block' : 'none' }}>
              <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
                Coloca redes e contato pra marca falar com você
              </Text>
              <Row gutter={[16, 0]}>
                <Col xs={24} md={12}>
                  <Form.Item
                    name="whatsapp"
                    label={
                      <Space>
                        <MessageOutlined />
                        WhatsApp
                      </Space>
                    }
                    extra="Ex.: +55 (11) 99999-9999. Use 10 a 13 dígitos (com DDI)."
                    rules={[
                      {
                        validator: (_, v) => {
                          if (!v || !String(v).trim()) return Promise.resolve()
                          const digits = parseWhatsAppDigits(v)
                          if (digits.length < 10 || digits.length > 13) {
                            return Promise.reject(new Error('WhatsApp: 10 a 13 números com DDI.'))
                          }
                          return Promise.resolve()
                        },
                      },
                    ]}
                    normalize={(v) => (v ? formatWhatsApp(v) : v)}
                  >
                    <Input placeholder="+55 (11) 99999-9999" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item
                    name="tiktok"
                    label={<Space><LinkOutlined /> TikTok</Space>}
                    extra={
                      <span className="activate-social-url-hint">
                        <code>tiktok.com/@<strong>seuuser</strong></code>
                      </span>
                    }
                  >
                    <Input placeholder="@seuuser" autoComplete="off" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item
                    name="facebook"
                    label={<Space><LinkOutlined /> Facebook</Space>}
                    extra={
                      <span className="activate-social-url-hint">
                        <code>facebook.com/<strong>seuperfil</strong></code>
                      </span>
                    }
                  >
                    <Input placeholder="seuperfil" autoComplete="off" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item
                    name="linkedin"
                    label={<Space><LinkOutlined /> LinkedIn</Space>}
                    extra={
                      <span className="activate-social-url-hint">
                        <code>linkedin.com/in/<strong>seuperfil</strong></code>
                      </span>
                    }
                  >
                    <Input placeholder="seuperfil" autoComplete="off" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item
                    name="twitter"
                    label={<Space><LinkOutlined /> X (Twitter)</Space>}
                    extra={
                      <span className="activate-social-url-hint">
                        <code>x.com/<strong>seuuser</strong></code>
                      </span>
                    }
                  >
                    <Input placeholder="@seuuser" autoComplete="off" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item
                    name="websites"
                    label={<Space><GlobalOutlined /> Websites</Space>}
                    extra={
                      <span className="activate-social-url-hint">
                        <code>
                          https://<strong>meusite.com</strong>/sobre
                        </code>
                      </span>
                    }
                  >
                    <Input.TextArea placeholder="meusite.com" rows={2} autoComplete="off" />
                  </Form.Item>
                </Col>
              </Row>
            </div>

            {/* Navegação e ações */}
            <Divider style={{ margin: '24px 0 16px' }} />
            <Space wrap size="middle">
              {step > 0 && (
                <Button onClick={() => setStep((s) => s - 1)}>
                  Voltar
                </Button>
              )}
              {step < MAX_STEP && (
                <Button type="primary" onClick={goToNextStep}>
                  Próximo
                </Button>
              )}
              {step === MAX_STEP && (
                <Button
                  type="primary"
                  htmlType="button"
                  icon={<CheckCircleOutlined />}
                  loading={saving}
                  size="large"
                  onClick={() => {
                    form.validateFields(['whatsapp']).then(() => form.submit()).catch(() => scrollToFirstError())
                  }}
                >
                  Ativar cadastro
                </Button>
              )}
            </Space>
          </Form>
        </Card>

        {/* Excluir conta: fora do wizard, o mais sutil possível */}
        <div style={{ textAlign: 'center', marginTop: 32, paddingBottom: 24 }}>
          <button
            type="button"
            onClick={() => {
              Modal.confirm({
                title: isAdm && handle ? 'Excluir conta desse influenciador?' : 'Excluir sua conta pra valer?',
                content:
                  isAdm && handle
                    ? `Tudo do @${handle} some (perfil, cadastro, posts). Não dá pra desfazer.`
                    : 'Tudo seu some (perfil, cadastro, posts). Não dá pra desfazer.',
                okText: 'Sim, excluir',
                okType: 'danger',
                cancelText: 'Cancelar',
                onOk: async () => {
                  setDeleting(true)
                  try {
                    await deleteAccount(isAdm && handle ? handle : undefined)
                    message.success('Conta excluída.')
                    if (isAdm && handle) {
                      navigate('/', { replace: true })
                    } else {
                      logout()
                      navigate('/influencer/login', { replace: true })
                    }
                  } catch (e) {
                    message.error(e instanceof Error ? e.message : 'Não deu pra excluir. Tenta de novo.')
                  } finally {
                    setDeleting(false)
                  }
                },
              })
            }}
            disabled={deleting}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              fontSize: 12,
              color: 'var(--app-text-tertiary)',
              textDecoration: 'none',
            }}
          >
            {isAdm && handle ? 'Excluir conta do influenciador' : 'Excluir minha conta'}
          </button>
        </div>
      </div>
    </div >
  )
}
