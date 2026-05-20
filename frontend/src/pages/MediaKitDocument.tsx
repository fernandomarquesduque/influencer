/**
 * Mídia Kit PDF — design premium, estilo Apple + agência.
 * Capa editorial (hero), layout estável em React-PDF (sem % quebrando),
 * header/footer fixos, tratamento de dados faltantes e resolução robusta de imagens.
 * Cores de marca (brand/gold) seguem o tema selecionado na aplicação.
 */
import { createContext, useContext, useMemo } from 'react'
import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
} from '@react-pdf/renderer'
import type React from 'react'
import type { ProfileItem, PostItem, ProfileActivation } from '../api'
import { buildReportInsights, getWeekdayName, getTopPosts, getEngagementPerWeekdayAllTime, type TopPostInfo } from '../utils/reportInsights'
import { getCostTier } from '../utils/pricing'
import { CONTENT_TYPE_LABELS } from '../constants/contentTypes'
import { GENDER_LABELS, AUDIENCE_GENDER_LABELS, INFLUENCE_AGE_RANGE_LABELS } from '../constants/activationLabels'
import {
  PRICING_FIELD_KEYS,
  PRICING_FIELD_LABELS,
  type PricingFieldKey,
} from '../constants/pricingBuckets'
import { getPdfPaletteFromTheme, type PdfPalette as PdfPaletteType, type ThemeMode } from '../utils/getPdfPaletteFromCss'
import { getInfluencerTierLongLabel } from '../utils/influencerTier'

type ReportInsights = ReturnType<typeof buildReportInsights>

// -------------------- Tokens
const s = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 }
const pagePadding = 32

/** Re-export do tipo para quem importa de MediaKitDocument */
export type { ThemeMode }

/** Contexto de cores do PDF — valores vêm somente de theme.css (getPdfPaletteFromTheme) */
const PdfPaletteContext = createContext<PdfPaletteType | null>(null)
function usePdfPalette(): PdfPaletteType {
  const pal = useContext(PdfPaletteContext)
  if (!pal) throw new Error('usePdfPalette must be used inside MediaKitDocument')
  return pal
}

const typo = {
  h1: 30,
  h2: 16,
  h3: 13,
  body: 10,
  small: 9,
  caption: 8,
}

const radius = 14

// Header/Footer reservados (pra não sobrepor conteúdo)
const headerHeight = 24
const footerHeight = 48

// -------------------- Utils
/** Converte letras matemáticas/Unicode (ex.: 𝐀 𝐁 𝐚 𝐛) para A-Z a-z para o PDF renderizar o nome corretamente. */
function normalizeFancyUnicode(input: string): string {
  if (!input) return ''
  return input.replace(/[\u{1D400}-\u{1D419}\u{1D41A}-\u{1D433}\u{1D434}-\u{1D44D}\u{1D44E}-\u{1D467}\u{1D468}-\u{1D481}\u{1D482}-\u{1D49B}]/gu, (ch) => {
    const cp = ch.codePointAt(0) ?? 0
    if (cp >= 0x1D400 && cp <= 0x1D419) return String.fromCharCode(65 + (cp - 0x1D400))
    if (cp >= 0x1D41A && cp <= 0x1D433) return String.fromCharCode(97 + (cp - 0x1D41A))
    if (cp >= 0x1D434 && cp <= 0x1D44D) return String.fromCharCode(65 + (cp - 0x1D434))
    if (cp >= 0x1D44E && cp <= 0x1D467) return String.fromCharCode(97 + (cp - 0x1D44E))
    if (cp >= 0x1D468 && cp <= 0x1D481) return String.fromCharCode(65 + (cp - 0x1D468))
    if (cp >= 0x1D482 && cp <= 0x1D49B) return String.fromCharCode(97 + (cp - 0x1D482))
    return ch
  })
}

/** Remove emojis, modificadores (tom de pele etc.) e variation selectors que viram lixo no PDF. */
function removeEmojiAndModifiers(input: string): string {
  if (!input) return ''
  let s = input
  // Emojis e pictográficos
  try {
    s = s.replace(/\p{Extended_Pictographic}/gu, '')
  } catch {
    s = s
      .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
      .replace(/[\u{2600}-\u{26FF}]/gu, '')
      .replace(/[\u{2700}-\u{27BF}]/gu, '')
      .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '')
  }
  // Modificadores de tom de pele (👧🏽 → sobra 🏽) e variation selectors (deixam <ýç<÷ no PDF)
  s = s
    .replace(/[\u{1F3FB}-\u{1F3FF}]/gu, '')
    .replace(/[\uFE00-\uFE0F]/g, '')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
  return s
}

/** Mantém só caracteres que o PDF renderiza bem: letras, números, espaços e pontuação comum. */
function onlyPdfSafeChars(input: string): string {
  if (!input) return ''
  // Permite: letras (\p{L}), números (\p{N}), espaços (\s), pontuação de bio/email: . , ; @ - ' " : / ( ) ! ? # & + = % * [ ] ~ \n
  const safe =
    /[\p{L}\p{N}\s.,;@\-'"():/!?#&+=%*[\]~\n\r\u00A0]/u
  return Array.from(input)
    .map((ch) => (safe.test(ch) ? ch : ''))
    .join('')
}

function sanitizeText(str: string): string {
  if (!str || typeof str !== 'string') return ''
  const normalized = normalizeFancyUnicode(str)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2013|\u2014/g, '-')
    .replace(/\u00A0/g, ' ')
    .replace(/\u00B7/g, '-')
    .replace(/\u00D7/g, 'x')
  const withoutEmoji = removeEmojiAndModifiers(normalized)
  const safe = onlyPdfSafeChars(withoutEmoji)
  return safe.replace(/\s{2,}/g, ' ').trim()
}

function formatShortNum(n: number): string {
  if (!Number.isFinite(n)) return '0'
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.', ',') + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace('.', ',') + 'k'
  return n.toLocaleString('pt-BR')
}

function formatPricingValue(val: string | number | undefined | null): string {
  if (val === undefined || val === null || val === '') return '—'
  const str = String(val).trim()
  if (!str) return '—'
  const nums = str
    .split(/[\s,;-]+/)
    .map((p) => parseInt(p.replace(/\D/g, ''), 10))
    .filter((n) => Number.isFinite(n))
  if (nums.length === 0) return str
  const fmt = (n: number) =>
    `R$ ${n.toLocaleString('pt-BR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })}`
  return nums.length > 1 ? nums.map(fmt).join(' - ') : fmt(nums[0]!)
}

function truncate(str: string, max: number): string {
  const t = sanitizeText(str || '')
  if (!t || t.length <= max) return t
  return t.slice(0, max).trim() + '...'
}

function getInitials(name: string, handle: string): string {
  const n = sanitizeText(name || '')
  if (n.trim()) {
    const parts = n.trim().split(/\s+/)
    if (parts.length >= 2)
      return (parts[0]![0] + parts[parts.length - 1]![0]).toUpperCase()
    return n.slice(0, 2).toUpperCase()
  }
  const h = sanitizeText(handle || '').replace(/^@/, '').slice(0, 2)
  return h ? h.toUpperCase() : '??'
}

/** Extrai número de seguidores do perfil (top-level, data.user.follower_count ou data.user.edge_followed_by.count). */
function getFollowersFromProfile(profile: ProfileItem | null | undefined, userData: Record<string, unknown> | undefined): number {
  if (typeof profile?.followers_count === 'number' && profile.followers_count >= 0) return profile.followers_count
  if (userData && typeof (userData as { follower_count?: number }).follower_count === 'number')
    return (userData as { follower_count: number }).follower_count
  const edge = userData?.edge_followed_by as { count?: number } | undefined
  if (edge != null && typeof edge.count === 'number') return edge.count
  return 0
}

/** Extrai seguindo e quantidade de mídia do perfil (top-level ou data.user). */
function getFollowingFromProfile(profile: ProfileItem | null | undefined, userData: Record<string, unknown> | undefined): number {
  if (typeof profile?.following_count === 'number' && profile.following_count >= 0) return profile.following_count
  if (userData && typeof (userData as { following_count?: number }).following_count === 'number')
    return (userData as { following_count: number }).following_count
  return 0
}

function getMediaCountFromProfile(profile: ProfileItem | null | undefined, userData: Record<string, unknown> | undefined, postsLength: number): number {
  if (typeof profile?.media_count === 'number' && profile.media_count >= 0) return profile.media_count
  if (typeof (profile as { media_count_visible?: number })?.media_count_visible === 'number')
    return (profile as { media_count_visible: number }).media_count_visible
  if (userData && typeof (userData as { media_count?: number }).media_count === 'number')
    return (userData as { media_count: number }).media_count
  return postsLength
}

/** Calcula ER médio e médias para uma lista de posts (mesma lógica de engagement.ts). */
function computeErForPosts(
  items: { metrics?: { likes?: number; comments?: number; view_count?: number }; like_count?: number; comment_count?: number; view_count?: number }[],
  followersCount: number
): { er: number; erByViews?: number; count: number; avgLikes: number; avgComments: number; avgViews: number; totalLikes: number; totalComments: number; totalViews: number } {
  const toNum = (v: unknown): number => {
    if (typeof v === 'number' && Number.isFinite(v)) return Math.floor(v)
    if (typeof v === 'string') {
      const n = parseInt(String(v).replace(/\D/g, ''), 10)
      return Number.isNaN(n) ? 0 : n
    }
    return 0
  }
  let totalLikes = 0
  let totalComments = 0
  let totalViews = 0
  for (const p of items) {
    const m = (p as { metrics?: { likes?: number; comments?: number; view_count?: number } }).metrics
    totalLikes += toNum(m?.likes ?? (p as { like_count?: number }).like_count)
    totalComments += toNum(m?.comments ?? (p as { comment_count?: number }).comment_count)
    totalViews += toNum(m?.view_count ?? (p as { view_count?: number }).view_count)
  }
  const n = items.length
  const totalInt = totalLikes + totalComments
  const avgInt = n > 0 ? totalInt / n : 0
  const er = followersCount > 0 && avgInt >= 0 ? (avgInt / followersCount) * 100 : 0
  const erByViews = totalViews > 0 && totalInt >= 0 ? (totalInt / totalViews) * 100 : undefined
  return {
    er,
    erByViews,
    count: n,
    avgLikes: n > 0 ? totalLikes / n : 0,
    avgComments: n > 0 ? totalComments / n : 0,
    avgViews: n > 0 ? totalViews / n : 0,
    totalLikes,
    totalComments,
    totalViews: totalViews,
  }
}

/**
 * Resolve imagem do post por múltiplas chaves + fallback por índice + fallback por URL.
 * Preferência: dataURL (mais confiável no PDF).
 * Chaves alinhadas com MediaKit.tsx (setPostImageDataUrl/getPostImageByKeys) para garantir match.
 */
function resolvePostImage(
  p: any,
  idx: number,
  map: Record<string, string>,
  ordered?: string[]
): string | null {
  if (!p) return ordered?.[idx] ?? null

  const postNode = p?.post && typeof p.post === 'object' ? p.post : undefined
  const contentNode = p?.content && typeof p.content === 'object' ? p.content : undefined

  const candidates = [
    p?.key,
    p?.id,
    p?.pk,
    postNode?.shortcode,
    postNode?.code,
    postNode?.id,
    postNode?.pk,
    p?.code,
    p?.shortcode,
    p?.media_id,
    contentNode?.code,
    contentNode?.shortcode,
    contentNode?.id,
    contentNode?.pk,
  ]
    .filter(Boolean)
    .map(String)

  for (const k of candidates) {
    const hit = map[k]
    if (hit && String(hit).trim()) return hit
  }

  const orderedHit = ordered?.[idx]
  if (orderedHit && String(orderedHit).trim()) return orderedHit

  const url =
    p?.content?.image_url ||
    p?.content?.thumbnail_url ||
    p?.content?.display_url ||
    p?.media_url ||
    (p?.media?.cover_images?.[0] as { url?: string } | undefined)?.url ||
    (p?.media?.video_versions?.[0] as { url?: string } | undefined)?.url

  if (url && String(url).trim()) return String(url)

  return null
}

// -------------------- Styles
const styles = StyleSheet.create({
  page: {
    padding: 0,
    fontSize: typo.body,
    fontFamily: 'Helvetica',
    backgroundColor: 'transparent',
  },
  pageContent: {
    paddingLeft: pagePadding,
    paddingRight: pagePadding,
    paddingTop: headerHeight,
    paddingBottom: footerHeight + 6,
  },
})

// -------------------- Components
function SectionTitle({
  children,
  first = false,
}: {
  children: React.ReactNode
  first?: boolean
}) {
  const pal = usePdfPalette()
  return (
    <View style={{ marginTop: first ? 0 : s.xl, marginBottom: s.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View
          style={{
            width: 6,
            height: 18,
            backgroundColor: pal.brand,
            borderRadius: 3,
            marginRight: s.sm,
          }}
        />
        <Text style={{ fontSize: typo.h2, fontWeight: 'bold', color: pal.text }}>
          {children}
        </Text>
      </View>
      <View style={{ height: 1, backgroundColor: pal.borderLight, marginTop: s.sm }} />
    </View>
  )
}

function Pill({
  children,
  tone = 'brand',
}: {
  children: React.ReactNode
  tone?: 'brand' | 'gold' | 'neutral'
}) {
  const pal = usePdfPalette()
  const bg = tone === 'gold' ? pal.goldSoft : tone === 'neutral' ? pal.cardAlt : pal.brandSoft
  const fg = tone === 'gold' ? pal.gold : tone === 'neutral' ? pal.textSecondary : pal.brandDark
  return (
    <Text
      style={{
        backgroundColor: bg,
        color: fg,
        paddingVertical: s.xs,
        paddingHorizontal: s.md,
        borderRadius: 999,
        fontSize: typo.caption,
        fontWeight: 'bold',
      }}
    >
      {children}
    </Text>
  )
}

function Card({
  title,
  children,
  style = {},
  noPadding,
}: {
  title?: string
  children: React.ReactNode
  style?: object
  noPadding?: boolean
}) {
  const pal = usePdfPalette()
  const borderWidth = 1
  const innerRadius = Math.max(0, radius - 2)
  return (
    <View
      style={{
        borderRadius: radius,
        backgroundColor: pal.border,
        ...style,
      }}
    >
      <View
        style={{
          margin: borderWidth,
          borderRadius: innerRadius,
          backgroundColor: pal.cardBg,
          overflow: 'hidden',
        }}
      >
        {title ? (
          <View
            style={{
              paddingVertical: 10,
              paddingHorizontal: 14,
              backgroundColor: pal.cardAlt,
              borderBottomWidth: 1,
              borderBottomColor: pal.border,
            }}
          >
            <Text
              style={{
                fontSize: typo.caption,
                fontWeight: 'bold',
                color: pal.textSecondary,
                letterSpacing: 0.4,
              }}
            >
              {sanitizeText(title).toUpperCase()}
            </Text>
            <View
              style={{
                height: 2,
                width: 36,
                backgroundColor: pal.brand,
                marginTop: 8,
                borderRadius: 2,
              }}
            />
          </View>
        ) : null}
        <View style={{ padding: noPadding ? 0 : 14 }}>{children}</View>
      </View>
    </View>
  )
}

// -------------------- Header/Footer (fixos)
function PageHeader({
  handle,
  fullName,
  tierLabel,
}: {
  handle: string
  fullName?: string
  tierLabel: string
}) {
  const pal = usePdfPalette()
  return (
    <View fixed>
      <View style={{ height: 3, backgroundColor: pal.brand }} />
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingHorizontal: pagePadding,
          paddingVertical: 8,
          backgroundColor: pal.pageBg,
        }}
      >
        <View>
          <Text style={{ fontSize: typo.body, fontWeight: 'bold', color: pal.text }}>
            @{handle}
          </Text>
          {fullName ? (
            <Text style={{ fontSize: typo.caption, color: pal.textSecondary }}>
              {sanitizeText(fullName)}
            </Text>
          ) : null}
        </View>

        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ fontSize: typo.caption, fontWeight: 'bold', color: pal.brand }}>
            {sanitizeText(tierLabel)}
          </Text>
          <Text style={{ fontSize: typo.caption, color: pal.textMuted }}>Mídia Kit</Text>
        </View>
      </View>
      <View style={{ height: 1, backgroundColor: pal.border, marginHorizontal: pagePadding }} />
    </View>
  )
}

function PageFooter(_props: { dateStr: string }) {
  return null
}

// -------------------- CoverPage (Métricas) — dados relevantes para marcas contratarem
interface CoverPageProps {
  fullName?: string
  handle: string
  tierLabel: string
  tierDescription?: string
  scoreSelo: string
  percentil: number
  followersCount: number
  er: number
  postsPerWeekFormatted: string
  profilePicDataUrl?: string | null
  dateStr: string
  conversationRate?: number
  conversationLabel?: string
  bestDay?: string
  bestHour?: number
  /** Posts por dia da semana (0=Dom .. 6=Sáb) para o gráfico de barras */
  /** Engajamento (curtidas + comentários) por dia da semana (0=Dom .. 6=Sáb) */
  engagementPerWeekday: number[]
  maxEr?: number
  totalLikes: number
  totalComments: number
  totalViews: number
  cpmCpe: { cpmEstimate: number | null; cpeEstimate: number | null; costPer1000Interactions: number | null }
  strategicMetrics: {
    reachMultiplier: { avg: number | null; max: number | null; label: string | null }
    reelsAmplification: number | null
    reelsAmplificationLabel: string | null
    contentTypeDistribution: { pctReels: number; pctCarousel: number; pctPhoto: number }
  } | null
  executiveSummary: { strengths: string[]; recommendation: string; creatorType: string }
  header: React.ReactNode
  footer: React.ReactNode
}

function CoverPage(props: CoverPageProps) {
  const {
    er,
    conversationRate = 0,
    conversationLabel,
    bestDay,
    bestHour,
    engagementPerWeekday = [0, 0, 0, 0, 0, 0, 0],
    followersCount = 1,
    maxEr = 0,
    totalLikes,
    totalComments,
    totalViews,
    cpmCpe,
    strategicMetrics,
    executiveSummary,
    header,
    footer,
  } = props
  const pal = usePdfPalette()

  const cpeValue = cpmCpe.cpeEstimate != null && cpmCpe.cpeEstimate > 0 ? `R$ ${cpmCpe.cpeEstimate.toFixed(2)}` : '—'
  const cpmValue = cpmCpe.cpmEstimate != null && cpmCpe.cpmEstimate > 0 ? `R$ ${cpmCpe.cpmEstimate.toFixed(1)}` : null
  // Views só em reels/vídeos; curtidas e comentários de todos os posts (evita confusão "likes > views").
  const metricsBase = [
    { label: 'Curtidas', value: formatShortNum(totalLikes), desc: 'Total de curtidas (feed + reels)' },
    { label: 'Comentários', value: formatShortNum(totalComments), desc: 'Total de comentários (feed + reels)' },
    ...(totalViews > 0 ? [{ label: 'Views (reels)', value: formatShortNum(totalViews), desc: 'Visualizações apenas em reels/vídeos' }] : []),
  ]
  const metrics = metricsBase
  const metricCardWidth = metrics.length === 2 ? '50%' : '33.33%'
  const showViewsNote = totalViews > 0 && totalViews < totalLikes

  const converteQuadrants = [
    { value: `${(er || 0).toFixed(1)}%`, label: 'Engajamento' },
    { value: `${Math.round(conversationRate)}%`, label: conversationLabel ?? 'Taxa comentários' },
    { value: maxEr > 0 ? `${maxEr.toFixed(1)}%` : '—', label: 'Pico de ER' },
  ]
  const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
  const erPerWeekday = engagementPerWeekday.map((sum) => (sum / Math.max(1, followersCount)) * 100)
  const maxErDay = Math.max(0.01, ...erPerWeekday)
  const bestDayByErIndex = maxErDay > 0 ? erPerWeekday.findIndex((v) => v >= maxErDay - 1e-6) : -1
  const picoDayLabel = bestDayByErIndex >= 0 ? WEEKDAY_LABELS[bestDayByErIndex] : bestDay

  const reachMax = strategicMetrics?.reachMultiplier?.max
  const reelsAmp = strategicMetrics?.reelsAmplification
  const dist = strategicMetrics?.contentTypeDistribution

  return (
    <Page size="A4" style={[styles.page, { backgroundColor: pal.pageBg }]}>
      {header}
      <View style={styles.pageContent}>
        <SectionTitle first>Métricas</SectionTitle>
        <Text style={{ fontSize: typo.caption, color: pal.textSecondary, marginTop: -4, marginBottom: 7 }}>
          Dados e resultados para sua marca contratar
        </Text>

        {/* O que é ER — explicação para o leitor */}
        <View style={{ marginBottom: 9, backgroundColor: pal.brandSoft, borderRadius: radius, borderWidth: 1, borderColor: pal.brand, padding: 9 }}>
          <Text style={{ fontSize: 9, fontWeight: 'bold', color: pal.brandDark, marginBottom: 3 }}>O que é ER?</Text>
          <Text style={{ fontSize: 8, color: pal.text, lineHeight: 1.35 }}>
            ER (Engagement Rate) é a taxa de engajamento: o percentual de interações (curtidas + comentários) em relação aos seguidores. Quanto maior o ER, mais a audiência reage ao conteúdo — um indicador importante para marcas avaliarem o potencial de alcance e conexão.
          </Text>
        </View>

        {/* KPIs — Curtidas | Comentários | Views (reels); descrição deixa claro que views = só reels */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10 }}>
          {metrics.map((k, i) => {
            const cardBg = i === 0 ? pal.brandSoft : pal.cardAlt
            const titleColor = i === 0 ? pal.brandDark : pal.text
            const isLastInRow = i === metrics.length - 1
            const isFirstInRow = i === 0
            return (
              <View
                key={k.label}
                style={{
                  width: metricCardWidth,
                  paddingRight: !isLastInRow ? 4 : 0,
                  paddingLeft: !isFirstInRow ? 4 : 0,
                  paddingBottom: 5,
                }}
              >
                <View style={{ backgroundColor: cardBg, borderRadius: radius, borderWidth: 1, borderColor: pal.borderLight, paddingVertical: 9, paddingHorizontal: 8, alignItems: 'center' }}>
                  <Text style={{ fontSize: 15, fontWeight: 'bold', color: titleColor }}>{k.value}</Text>
                  <Text style={{ fontSize: 9, fontWeight: 'bold', color: pal.textSecondary, marginTop: 3 }}>{k.label}</Text>
                  <Text style={{ fontSize: 7, color: pal.textMuted, marginTop: 2, textAlign: 'center' }}>{k.desc}</Text>
                </View>
              </View>
            )
          })}
        </View>

        {/* CPE e CPM — CPM omitido quando não há views (API não fornece) */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 13 }}>
          <View style={{ width: cpmValue && totalViews > 0 ? '50%' : '100%', paddingRight: cpmValue && totalViews > 0 ? 4 : 0, paddingBottom: 5 }}>
            <View style={{ backgroundColor: pal.cardAlt, borderRadius: radius, borderWidth: 1, borderColor: pal.brand, paddingVertical: 9, paddingHorizontal: 8, alignItems: 'center' }}>
              <Text style={{ fontSize: 16, fontWeight: 'bold', color: pal.brandDark }}>{cpeValue}</Text>
              <Text style={{ fontSize: 9, fontWeight: 'bold', color: pal.textSecondary, marginTop: 3 }}>CPE</Text>
              <Text style={{ fontSize: 7, color: pal.textMuted, marginTop: 2, textAlign: 'center' }}>Valor estimado por curtida ou comentário.</Text>
            </View>
          </View>
          {cpmValue && totalViews > 0 && (
            <View style={{ width: '50%', paddingLeft: 4, paddingBottom: 5 }}>
              <View style={{ backgroundColor: pal.brandSoft, borderRadius: radius, borderWidth: 1, borderColor: pal.brand, paddingVertical: 9, paddingHorizontal: 8, alignItems: 'center' }}>
                <Text style={{ fontSize: 16, fontWeight: 'bold', color: pal.brandDark }}>{cpmValue}</Text>
                <Text style={{ fontSize: 9, fontWeight: 'bold', color: pal.textSecondary, marginTop: 3 }}>CPM</Text>
                <Text style={{ fontSize: 7, color: pal.textMuted, marginTop: 2, textAlign: 'center' }}>Custo por mil impressões (views); valor para alcançar 1.000 visualizações.</Text>
              </View>
            </View>
          )}
        </View>

        {/* Por que minha audiência converte — 3 quadrantes com descrição */}
        <View style={{ marginBottom: 13 }}>
          <Text style={{ fontSize: 10, fontWeight: 'bold', color: pal.text, marginBottom: 5 }}>Por que minha audiência converte</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {converteQuadrants.map((q, i) => {
              const quadDesc = [
                'Interações (curtidas + comentários) em % dos seguidores.',
                '% de comentários no total de interações; mais comentários costumam indicar maior conexão.',
                'Maior ER em um único post; indica potencial de alcance quando o conteúdo viraliza.',
              ][i]
              return (
                <View key={q.label} style={{ width: '33.33%', paddingRight: i < 2 ? 4 : 0, paddingLeft: i > 0 ? 4 : 0, paddingBottom: 5 }}>
                  <View style={{ backgroundColor: i === 0 ? pal.brandSoft : i === 1 ? pal.goldSoft : pal.brandSoft, borderRadius: radius, borderWidth: 1, borderColor: pal.border, paddingVertical: 9, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center', minHeight: 49 }}>
                    <Text style={{ fontSize: 13, fontWeight: 'bold', color: pal.brandDark }}>{q.value}</Text>
                    <Text style={{ fontSize: 9, fontWeight: 'bold', color: pal.text, marginTop: 2 }}>{q.label}</Text>
                    <Text style={{ fontSize: 7, color: pal.textMuted, marginTop: 2, textAlign: 'center' }}>{quadDesc}</Text>
                  </View>
                </View>
              )
            })}
          </View>
        </View>

        {/* Melhor horário — linha inteira com todos os dias da semana em barras */}
        <View style={{ marginBottom: 13, width: '100%' }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', marginBottom: 5 }}>
            <Text style={{ fontSize: 10, fontWeight: 'bold', color: pal.text }}>Melhor horário</Text>
            {(picoDayLabel || (bestHour ?? 0) > 0) ? (
              <Text style={{ fontSize: 8, color: pal.textMuted, marginLeft: 8 }}>
                Pico: {[picoDayLabel, (bestHour ?? 0) > 0 ? `às ${bestHour}h` : ''].filter(Boolean).join(' ')}
              </Text>
            ) : null}
          </View>
          <Text style={{ fontSize: 8, color: pal.textMuted, marginBottom: 5 }}>ER por dia da semana: (curtidas + comentários) ÷ seguidores × 100 em cada dia. Dia em que o conteúdo mais engajou.</Text>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', width: '100%', height: 59 }}>
            {WEEKDAY_LABELS.map((label, d) => {
              const erDay = erPerWeekday[d] ?? 0
              const pct = maxErDay > 0 ? (erDay / maxErDay) * 100 : 0
              const isBestEng = maxErDay > 0 && erDay === maxErDay
              return (
                <View key={`eng-${label}`} style={{ flex: 1, alignItems: 'center', paddingHorizontal: 2 }}>
                  <View style={{ width: '100%', height: 41, justifyContent: 'flex-end', alignItems: 'center' }}>
                    <View
                      style={{
                        width: '80%',
                        height: Math.max(2, (pct / 100) * 37),
                        backgroundColor: isBestEng ? pal.gold : pal.goldSoft,
                        borderRadius: 4,
                        ...(isBestEng ? { borderWidth: 1, borderColor: pal.border } : {}),
                      }}
                    />
                  </View>
                  <Text style={{ fontSize: 7, fontWeight: isBestEng ? 'bold' : 'normal', color: isBestEng ? pal.text : pal.textMuted, marginTop: 3 }}>{label}</Text>
                  {erDay > 0 ? <Text style={{ fontSize: 6, color: pal.textMuted }}>ER {erDay.toFixed(1).replace('.', ',')}%</Text> : null}
                </View>
              )
            })}
          </View>
        </View>

        {/* Alcance — distribuição por formato em 3 cards */}
        {((dist?.pctReels ?? 0) > 0 || (dist?.pctCarousel ?? 0) > 0 || (dist?.pctPhoto ?? 0) > 0 || (reachMax != null && reachMax >= 1) || (reelsAmp != null && reelsAmp >= 1)) ? (
          <View style={{ marginBottom: 13 }}>
            <Text style={{ fontSize: 10, fontWeight: 'bold', color: pal.text, marginBottom: 3 }}>Alcance</Text>
            <Text style={{ fontSize: 8, color: pal.textMuted, marginBottom: 5 }}>O que a % significa: percentual dos seus posts que são de cada formato (Reels, Carrossel, Foto). A soma é 100%.</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {dist && dist.pctReels > 0 ? (
                <View style={{ width: '33.33%', paddingRight: 4, paddingBottom: 5 }}>
                  <View style={{ backgroundColor: pal.brandSoft, borderRadius: radius, borderWidth: 1, borderColor: pal.brand, paddingVertical: 11, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 17, fontWeight: 'bold', color: pal.brandDark }}>{(dist?.pctReels ?? 0)}%</Text>
                    <Text style={{ fontSize: 10, fontWeight: 'bold', color: pal.text, marginTop: 3 }}>Reels</Text>
                    <Text style={{ fontSize: 8, color: pal.textMuted, marginTop: 2, textAlign: 'center' }}>{(dist?.pctReels ?? 0)}% dos posts são reels. Vídeos curtos; alto alcance na descoberta.</Text>
                  </View>
                </View>
              ) : null}
              {dist && dist.pctCarousel > 0 ? (
                <View style={{ width: '33.33%', paddingHorizontal: 4, paddingBottom: 5 }}>
                  <View style={{ backgroundColor: pal.goldSoft, borderRadius: radius, borderWidth: 1, borderColor: pal.border, paddingVertical: 11, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 17, fontWeight: 'bold', color: pal.brandDark }}>{(dist?.pctCarousel ?? 0)}%</Text>
                    <Text style={{ fontSize: 10, fontWeight: 'bold', color: pal.text, marginTop: 3 }}>Carrossel</Text>
                    <Text style={{ fontSize: 8, color: pal.textMuted, marginTop: 2, textAlign: 'center' }}>{(dist?.pctCarousel ?? 0)}% dos posts são carrossel. Múltiplas imagens; mantêm o usuário mais tempo.</Text>
                  </View>
                </View>
              ) : null}
              {dist && dist.pctPhoto > 0 ? (
                <View style={{ width: '33.33%', paddingLeft: 4, paddingBottom: 5 }}>
                  <View style={{ backgroundColor: pal.cardAlt, borderRadius: radius, borderWidth: 1, borderColor: pal.border, paddingVertical: 11, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 17, fontWeight: 'bold', color: pal.ink }}>{(dist?.pctPhoto ?? 0)}%</Text>
                    <Text style={{ fontSize: 10, fontWeight: 'bold', color: pal.text, marginTop: 3 }}>Foto</Text>
                    <Text style={{ fontSize: 8, color: pal.textMuted, marginTop: 2, textAlign: 'center' }}>{(dist?.pctPhoto ?? 0)}% dos posts são foto. Imagem única; formato clássico do feed.</Text>
                  </View>
                </View>
              ) : null}
            </View>
            {(reachMax != null && reachMax >= 1) || (reelsAmp != null && reelsAmp >= 1) ? (
              <View style={{ marginTop: 3 }}>
                {reachMax != null && reachMax >= 1 ? (
                  <Text style={{ fontSize: 8, color: pal.textMuted }}>Reach até {reachMax.toFixed(1).replace('.', ',')}× seguidores</Text>
                ) : null}
                {reelsAmp != null && reelsAmp >= 1 ? (
                  <Text style={{ fontSize: 8, color: pal.textMuted, marginTop: 2 }}>Reels: {reelsAmp.toFixed(1).replace('.', ',')}× base em média</Text>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Executive summary para marcas */}
        {(executiveSummary.strengths.length > 0 || executiveSummary.recommendation) ? (
          <View style={{ marginBottom: 0, backgroundColor: pal.goldSoft, borderRadius: radius, borderWidth: 1, borderColor: pal.border, padding: 11 }}>
            <Text style={{ fontSize: 9, fontWeight: 'bold', color: pal.text, marginBottom: 3 }}>Resumo para marcas · {executiveSummary.creatorType}</Text>
            <Text style={{ fontSize: 7, color: pal.textMuted, marginBottom: 4 }}>Síntese dos pontos fortes e indicação de uso para campanhas.</Text>
            {executiveSummary.strengths.length > 0 ? (
              <View style={{ marginBottom: 3 }}>
                {executiveSummary.strengths.slice(0, 3).map((s, i) => (
                  <Text key={i} style={{ fontSize: 8, color: pal.text, marginTop: 2 }}>• {sanitizeText(s)}</Text>
                ))}
              </View>
            ) : null}
            {executiveSummary.recommendation ? (
              <Text style={{ fontSize: 9, fontWeight: 'bold', color: pal.brand, marginTop: 2 }}>{sanitizeText(executiveSummary.recommendation)}</Text>
            ) : null}
          </View>
        ) : null}

        {footer}
      </View>
    </Page>
  )
}

function OverviewPage({
  bio,
  categories,
  kpis,
  diagnostico,
  contentTypesLabel,
  fullName,
  handle,
  profilePicDataUrl,
  tierLabel,
  tierDescription: _tierDescription,
  scoreSelo: _scoreSelo,
  percentil,
  header,
  footer,
}: {
  bio?: string
  categories: string[]
  kpis: { label: string; value: string; sub?: string }[]
  diagnostico: { fazBem: string }
  contentTypesLabel?: string
  fullName?: string
  handle: string
  profilePicDataUrl?: string | null
  tierLabel: string
  tierDescription?: string
  scoreSelo: string
  percentil: number
  header: React.ReactNode
  footer: React.ReactNode
}) {
  const pal = usePdfPalette()
  const displayName = sanitizeText(fullName || handle || 'Influencer')
  const safeHandle = sanitizeText(handle).replace(/^@/, '')
  const tierShort = tierLabel.replace(/\s*Influencer\s*/i, '').trim() || 'Nano'
  const topLabel = percentil > 0 ? `Top ${percentil}% ${tierShort} influenciadores` : ''

  return (
    <Page size="A4" style={[styles.page, { backgroundColor: pal.pageBg }]}>
      {header}
      <View style={styles.pageContent}>
        {/* Cabeçalho perfil: foto, nome, @handle, badges, faixa sugerida */}
        <View style={{ alignItems: 'center', marginBottom: s.xl }}>
          {profilePicDataUrl ? (
            <View style={{ marginBottom: 14 }}>
              <View
                style={{
                  width: 100,
                  height: 100,
                  borderRadius: 50,
                  padding: 4,
                  backgroundColor: pal.brand,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <View style={{ width: 92, height: 92, borderRadius: 46, overflow: 'hidden', backgroundColor: pal.cardBg }}>
                  <Image src={profilePicDataUrl} style={{ width: 92, height: 92, borderRadius: 46 }} />
                </View>
              </View>
            </View>
          ) : (
            <View
              style={{
                width: 100,
                height: 100,
                borderRadius: 50,
                backgroundColor: pal.cardAlt,
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 14,
              }}
            >
              <Text style={{ fontSize: 32, fontWeight: 'bold', color: pal.textSecondary }}>
                {getInitials(displayName, handle)}
              </Text>
            </View>
          )}
          <Text style={{ fontSize: 22, fontWeight: 'bold', color: pal.ink }}>{displayName}</Text>
          <Text style={{ fontSize: 12, color: pal.textSecondary, marginTop: 4 }}>@{safeHandle}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: 12 }}>
            {percentil > 0 && topLabel ? (
              <View style={{ backgroundColor: pal.goldSoft, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12, marginBottom: 4 }}>
                <Text style={{ fontSize: 8, color: pal.brandDark, fontWeight: 'bold' }}>{topLabel}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <Card title="Bio" style={{ marginBottom: s.lg }}>
          <Text style={{ fontSize: typo.body, color: pal.text, lineHeight: 1.55, marginBottom: s.md }}>
            {truncate(sanitizeText(bio?.trim() || 'Criador de conteúdo com audiência engajada e métricas comprovadas para campanhas.'), 200)}
          </Text>
          {categories.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {categories.slice(0, 8).map((cat) => (
                <View key={cat} style={{ marginRight: s.sm, marginBottom: s.xs }}>
                  <Pill tone="neutral">{sanitizeText(cat)}</Pill>
                </View>
              ))}
            </View>
          ) : null}
        </Card>

        <View style={{ flexDirection: 'row' }}>
          <View style={{ flex: 1, marginRight: s.lg }}>
            {contentTypesLabel ? (
              <Card title="Tipo de conteúdo" style={{ marginTop: s.lg }}>
                <Text style={{ fontSize: typo.body, fontWeight: 'bold', color: pal.text }}>{contentTypesLabel}</Text>
              </Card>
            ) : null}
            <Card title="Diferenciais" style={{ marginTop: s.lg }}>
              <Text style={{ fontSize: typo.body, color: pal.text, lineHeight: 1.55, marginBottom: s.sm }}>
                {sanitizeText(diagnostico.fazBem || 'Criatividade e consistência com métricas que convertem.')}
              </Text>
              <Text style={{ fontSize: typo.small, color: pal.textSecondary, lineHeight: 1.45 }}>
                Entregas no prazo e alinhadas aos objetivos da marca.
              </Text>
            </Card>
          </View>
          <View style={{ width: 220 }}>
            <Card title="Números principais">
              {kpis.map((k) => (
                <View key={k.label} style={{ marginBottom: s.sm }}>
                  <Text style={{ fontSize: typo.caption, color: pal.textMuted }}>{k.label}</Text>
                  <Text style={{ fontSize: typo.h3, fontWeight: 'bold', color: pal.text }}>{k.value}</Text>
                </View>
              ))}
            </Card>
          </View>
        </View>

        {footer}
      </View>
    </Page>
  )
}

/** Card grande por formato (Performance). */
function PerformanceCard({
  title,
  stats,
  bgTone,
}: {
  title: string
  stats: { count: number; er: number; avgLikes: number; avgComments: number; avgViews: number; totalLikes?: number; totalComments?: number }
  bgTone: 'brand' | 'gold' | 'neutral'
}) {
  const pal = usePdfPalette()
  const bg = bgTone === 'brand' ? pal.brandSoft : bgTone === 'gold' ? pal.goldSoft : pal.cardAlt
  if (stats.count === 0) return null
  return (
    <View
      style={{
        marginBottom: s.lg,
        backgroundColor: bg,
        borderRadius: radius,
        borderWidth: 1,
        borderColor: pal.border,
        padding: 16,
      }}
    >
      <Text style={{ fontSize: typo.h3, fontWeight: 'bold', color: pal.text, marginBottom: 12 }}>{title}</Text>
      <Text style={{ fontSize: 20, fontWeight: 'bold', color: pal.brand, marginBottom: 8 }}>ER {stats.er.toFixed(2)}%</Text>
      {(stats.totalLikes != null || stats.totalComments != null) && (
        <Text style={{ fontSize: typo.small, color: pal.text, marginBottom: 4 }}>
          {formatShortNum(stats.totalLikes ?? 0)} curtidas · {formatShortNum(stats.totalComments ?? 0)} comentários
        </Text>
      )}
      <Text style={{ fontSize: typo.caption, color: pal.textSecondary }}>
        Média: {formatShortNum(Math.round(stats.avgLikes))} curtidas · {formatShortNum(Math.round(stats.avgComments))} comentários
        {stats.avgViews > 0 ? ` · ${formatShortNum(Math.round(stats.avgViews))} views` : ''}
      </Text>
    </View>
  )
}

/** Card de destaque: imagem vertical + métricas em duas linhas (post ou reel que mais se destacou). */
function HighlightPostCard({
  title,
  item,
  postImageDataUrls,
  imageIndex,
}: {
  title: string
  item: TopPostInfo
  postImageDataUrls: Record<string, string>
  imageIndex: number
}) {
  const pal = usePdfPalette()
  const p = item.post as any
  const dataUrl = resolvePostImage(p, imageIndex, postImageDataUrls, undefined)
  const likes = p?.metrics?.likes ?? 0
  const comments = p?.metrics?.comments ?? 0
  const views = p?.metrics?.view_count
  const imgW = 160
  const imgH = 170
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: pal.cardAlt,
        borderRadius: radius,
        borderWidth: 1,
        borderColor: pal.border,
        overflow: 'hidden',
        marginBottom: s.md,
      }}
    >
      <View style={{ width: imgW, height: imgH }}>
        {dataUrl ? (
          <Image src={dataUrl} style={{ width: imgW, height: imgH, objectFit: 'cover' as const }} />
        ) : (
          <View style={{ width: imgW, height: imgH, backgroundColor: pal.borderLight, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: typo.caption, color: pal.textMuted }}>—</Text>
          </View>
        )}
      </View>
      <View style={{ flex: 1, padding: 10, justifyContent: 'center' }}>
        <Text style={{ fontSize: typo.caption, color: pal.textMuted, marginBottom: 2 }}>{title}</Text>
        <Text style={{ fontSize: 13, fontWeight: 'bold', color: pal.brand }}>ER {item.erPost.toFixed(1)}%</Text>
        <Text style={{ fontSize: typo.small, color: pal.textSecondary, marginTop: 4, lineHeight: 1.3 }}>
          {formatShortNum(likes)} curtidas · {formatShortNum(comments)} comentários
          {views != null ? ` · ${formatShortNum(Number(views))} views` : ''}
        </Text>
        {(() => {
          const caption = (p?.content?.caption_text ?? p?.content?.caption ?? (p?.content as any)?.caption ?? '') as string
          const hashtags = (p?.content?.hashtags ?? (p?.content as any)?.hashtags ?? []) as string[]
          const takenAt = p?.post?.taken_at ?? p?.post?.collected_at
          const dateStr = takenAt
            ? (typeof takenAt === 'number'
              ? new Date(takenAt * 1000).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
              : typeof takenAt === 'string'
                ? new Date(takenAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
                : '')
            : ''
          return (
            <>
              {caption.trim() ? (
                <Text style={{ fontSize: typo.small, color: pal.text, marginTop: 6, lineHeight: 1.35 }}>
                  {truncate(sanitizeText(caption.trim()), 120)}
                </Text>
              ) : null}
              {item.oQueFuncionou ? (
                <Text style={{ fontSize: typo.caption, color: pal.textMuted, marginTop: 4, lineHeight: 1.25 }}>
                  {truncate(sanitizeText(item.oQueFuncionou), 80)}
                </Text>
              ) : null}
              {(hashtags.length > 0 || dateStr) ? (
                <Text style={{ fontSize: 7, color: pal.textMuted, marginTop: 4 }}>
                  {[dateStr ? `Publicado em ${dateStr}` : '', hashtags.length > 0 ? hashtags.slice(0, 5).join(' ') : ''].filter(Boolean).join(' · ')}
                </Text>
              ) : null}
            </>
          )
        })()}
      </View>
    </View>
  )
}

function ContentAnalysisPage({
  feedStats,
  reelsStats,
  topFeedPost,
  topReelPost,
  postImageDataUrls,
  header,
  footer,
}: {
  feedStats: { count: number; er: number; erByViews?: number; avgLikes: number; avgComments: number; avgViews: number; totalLikes?: number; totalComments?: number }
  reelsStats: { count: number; er: number; erByViews?: number; avgLikes: number; avgComments: number; avgViews: number; totalLikes?: number; totalComments?: number }
  topFeedPost: TopPostInfo | null
  topReelPost: TopPostInfo | null
  postImageDataUrls: Record<string, string>
  header: React.ReactNode
  footer: React.ReactNode
}) {
  const pal = usePdfPalette()
  const hasAny = feedStats.count > 0 || reelsStats.count > 0
  if (!hasAny) return null
  return (
    <Page size="A4" style={[styles.page, { backgroundColor: pal.pageBg }]}>
      {header}
      <View style={styles.pageContent}>
        <SectionTitle first>Performance por formato</SectionTitle>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {feedStats.count > 0 ? (
            <View style={{ width: '50%', paddingRight: s.sm, paddingBottom: s.sm }}>
              <PerformanceCard
                title={`Feed (${feedStats.count} ${feedStats.count === 1 ? 'post' : 'posts'})`}
                stats={feedStats}
                bgTone="brand"
              />
            </View>
          ) : null}
          {reelsStats.count > 0 ? (
            <View style={{ width: '50%', paddingRight: s.sm, paddingBottom: s.sm }}>
              <PerformanceCard
                title={`Reels (${reelsStats.count})`}
                stats={reelsStats}
                bgTone="gold"
              />
            </View>
          ) : null}
        </View>

        {(feedStats.count > 0 || reelsStats.count > 0) ? (
          <View style={{ marginTop: s.sm, width: '100%' }}>
            <Card title="ER por tipo">
              {(() => {
                const items = [
                  { label: 'Feed', er: feedStats.er },
                  { label: 'Reels', er: reelsStats.er },
                ]
                const maxEr = Math.max(0.1, ...items.map((x) => x.er))
                return items.map((x) => (
                  <View key={x.label} style={{ marginBottom: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}>
                      <Text style={{ fontSize: typo.caption, color: pal.textMuted, width: 60 }}>{x.label}</Text>
                      <View style={{ flex: 1, height: 8, backgroundColor: pal.borderLight, borderRadius: 4, overflow: 'hidden', marginRight: 8 }}>
                        <View style={{ width: `${Math.min(100, (x.er / maxEr) * 100)}%`, height: '100%', backgroundColor: pal.brand, borderRadius: 4 }} />
                      </View>
                      <Text style={{ fontSize: 10, fontWeight: 'bold', color: pal.text }}>{x.er.toFixed(2)}%</Text>
                    </View>
                  </View>
                ))
              })()}
            </Card>
          </View>
        ) : null}

        {(topFeedPost || topReelPost) ? (
          <>
            <SectionTitle>Destaques</SectionTitle>
            <View style={{ flexDirection: 'column' }}>
              {topFeedPost ? (
                <HighlightPostCard
                  title="Post (Feed) que mais se destacou"
                  item={topFeedPost}
                  postImageDataUrls={postImageDataUrls}
                  imageIndex={0}
                />
              ) : null}
              {topReelPost ? (
                <HighlightPostCard
                  title="Reel que mais se destacou"
                  item={topReelPost}
                  postImageDataUrls={postImageDataUrls}
                  imageIndex={1}
                />
              ) : null}
            </View>
          </>
        ) : null}

        {footer}
      </View>
    </Page>
  )
}

function CtaPage({
  fullName,
  handle,
  cityState,
  nichoLine: _nichoLine,
  profilePicDataUrl,
  activation,
  costTier,
  pricingRows,
  valorEstimado,
  valorEstimadoPorTipo,
  nichoLabel: _nichoLabel,
  qrCodeDataUrl,
  header,
  footer,
}: {
  fullName?: string
  handle: string
  cityState: string
  nichoLine: string
  profilePicDataUrl?: string | null
  activation: ProfileActivation | null
  costTier: { symbol: string; label: string } | null
  pricingRows: { label: string; value: string }[]
  valorEstimado: { min: number; max: number; porque: string }
  valorEstimadoPorTipo?: {
    post: { min: number; max: number; porque: string }
    reels: { min: number; max: number; porque: string }
    stories: { min: number; max: number; porque: string }
    destaque: { min: number; max: number; porque: string }
  }
  nichoLabel?: string
  qrCodeDataUrl?: string | null
  header: React.ReactNode
  footer: React.ReactNode
}) {
  const pal = usePdfPalette()
  const safeHandle = sanitizeText(handle).replace(/^@/, '')
  const displayName = fullName ? sanitizeText(fullName) : safeHandle
  const fullAddress = [
    activation?.address,
    activation?.address_number,
    activation?.neighborhood,
    activation?.city,
    activation?.state,
    activation?.zip_code,
    activation?.country,
  ]
    .filter(Boolean)
    .map((s) => String(s).trim())
    .join(', ')
  const hasPricing = pricingRows.length > 0
  const hasValorEstimado = valorEstimadoPorTipo != null || (valorEstimado != null && (valorEstimado.min > 0 || valorEstimado.max > 0))
  const valorRows = valorEstimadoPorTipo
    ? [
      { label: 'Feed', min: valorEstimadoPorTipo.post.min, max: valorEstimadoPorTipo.post.max },
      { label: 'Reels', min: valorEstimadoPorTipo.reels.min, max: valorEstimadoPorTipo.reels.max },
      { label: 'Stories (24h)', min: valorEstimadoPorTipo.stories.min, max: valorEstimadoPorTipo.stories.max },
      { label: 'Destaque (30d)', min: valorEstimadoPorTipo.destaque.min, max: valorEstimadoPorTipo.destaque.max },
    ]
    : valorEstimado != null && (valorEstimado.min > 0 || valorEstimado.max > 0)
      ? [{ label: 'Feed (post patrocinado)', min: valorEstimado.min, max: valorEstimado.max }]
      : []

  return (
    <Page size="A4" style={[styles.page, { backgroundColor: pal.pageBg }]}>
      {header}
      <View style={styles.pageContent}>
        <SectionTitle first>Vamos criar sua campanha</SectionTitle>
        <Text style={{ fontSize: typo.small, color: pal.textMuted, marginBottom: 8, lineHeight: 1.35 }}>
          Entre em contato para proposta personalizada. Escaneie o QR code ou acesse o perfil no Instagram.
        </Text>

        {/* Identidade + Contato + QR em um único bloco */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: pal.brandSoft,
            borderRadius: radius,
            borderWidth: 1,
            borderColor: pal.brand,
            padding: 12,
            marginBottom: 10,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
            {profilePicDataUrl ? (
              <View style={{ width: 44, height: 44, borderRadius: 22, overflow: 'hidden', marginRight: 10, backgroundColor: pal.cardBg }}>
                <Image src={profilePicDataUrl} style={{ width: 44, height: 44, borderRadius: 22 }} />
              </View>
            ) : (
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  backgroundColor: pal.cardAlt,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: 10,
                }}
              >
                <Text style={{ fontSize: 16, fontWeight: 'bold', color: pal.textSecondary }}>{displayName.slice(0, 2).toUpperCase()}</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontWeight: 'bold', color: pal.text }}>{displayName}</Text>
              <Text style={{ fontSize: 12, fontWeight: 'bold', color: pal.brand, marginTop: 2 }}>@{safeHandle}</Text>
              {activation?.whatsapp ? (
                <View style={{ marginTop: 6, backgroundColor: pal.brand, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, alignSelf: 'flex-start' }}>
                  <Text style={{ fontSize: 13, fontWeight: 'bold', color: '#fff' }}>
                    WhatsApp: {sanitizeText(String(activation.whatsapp))}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
          {qrCodeDataUrl ? (
            <View style={{ alignItems: 'center', marginLeft: 8 }}>
              <Image src={qrCodeDataUrl} style={{ width: 56, height: 56 }} />
            </View>
          ) : null}
        </View>

        {/* Perfil, público e proposta */}
        {(activation?.gender || activation?.audience_gender || activation?.content_type?.length || activation?.influence_audience?.length || activation?.influence_age_range?.length || activation?.description?.trim() || activation?.brands_worked_with?.trim()) ? (
          <View style={{ marginBottom: 10 }}>
            <Card title="Perfil e público" style={{ marginBottom: 0 }}>
              {activation?.gender ? (
                <Text style={{ fontSize: typo.body, color: pal.text, lineHeight: 1.35 }}>
                  Gênero: {GENDER_LABELS[activation.gender] ?? activation.gender}
                </Text>
              ) : null}
              {activation?.audience_gender ? (
                <Text style={{ fontSize: typo.body, color: pal.text, lineHeight: 1.35, marginTop: activation?.gender ? 4 : 0 }}>
                  Gênero predominante do público: {AUDIENCE_GENDER_LABELS[activation.audience_gender] ?? activation.audience_gender}
                </Text>
              ) : null}
              {activation?.content_type?.length ? (
                <Text style={{ fontSize: typo.body, color: pal.text, lineHeight: 1.35, marginTop: (activation?.gender || activation?.audience_gender) ? 4 : 0 }}>
                  Tipos de conteúdo: {activation.content_type.map((ct) => CONTENT_TYPE_LABELS[ct] ?? ct).join(', ')}
                </Text>
              ) : null}
              {activation?.influence_audience?.length ? (
                <Text style={{ fontSize: typo.body, color: pal.text, lineHeight: 1.35, marginTop: (activation?.gender || activation?.audience_gender || activation?.content_type?.length) ? 4 : 0 }}>
                  Público que influencia (A, B, C, D): {activation.influence_audience.join(', ')}
                </Text>
              ) : null}
              {activation?.influence_age_range?.length ? (
                <Text style={{ fontSize: typo.body, color: pal.text, lineHeight: 1.35, marginTop: (activation?.gender || activation?.audience_gender || activation?.content_type?.length || activation?.influence_audience?.length) ? 4 : 0 }}>
                  Faixa etária que influencia: {activation.influence_age_range.map((fa) => INFLUENCE_AGE_RANGE_LABELS[fa] ?? fa).join(', ')}
                </Text>
              ) : null}

              {activation?.brands_worked_with?.trim() ? (
                <Text style={{ fontSize: typo.body, color: pal.text, lineHeight: 1.35, marginTop: (activation?.gender || activation?.audience_gender || activation?.content_type?.length || activation?.influence_audience?.length || activation?.influence_age_range?.length || activation?.description?.trim()) ? 4 : 0 }}>
                  Marcas que já trabalhou: {sanitizeText(activation.brands_worked_with.trim())}
                </Text>
              ) : null}
            </Card>
          </View>
        ) : null}

        {/* Endereço, brindes, Tipo de conteúdo */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10 }}>
          {(fullAddress || cityState || activation?.allow_gifts != null) ? (
            <View style={{ flex: 1, minWidth: 200, marginRight: 10, marginBottom: 8 }}>
              <Card title="Endereço" style={{ marginBottom: 0 }}>
                {(fullAddress || cityState) ? (
                  <Text style={{ fontSize: typo.body, color: pal.text, lineHeight: 1.35 }}>
                    {sanitizeText(fullAddress || cityState)}
                  </Text>
                ) : null}

              </Card>
            </View>
          ) : null}
          {activation?.content_type?.length ? (
            <View style={{ flex: 1, minWidth: 200, marginBottom: 8 }}>
              <Card title="Tipo de conteúdo" style={{ marginBottom: 0 }}>
                <Text style={{ fontSize: typo.body, color: pal.text, lineHeight: 1.35 }}>
                  {activation.content_type.map((ct) => CONTENT_TYPE_LABELS[ct] ?? ct).join(', ')}
                </Text>
              </Card>
            </View>
          ) : null}
        </View>

        {/* Redes sociais e contato */}
        {(activation?.tiktok || activation?.facebook || activation?.linkedin || activation?.twitter || activation?.websites) ? (
          <View style={{ marginBottom: 10 }}>
            <Card title="Redes e contato" style={{ marginBottom: 0 }}>
              {activation?.tiktok ? (
                <Text style={{ fontSize: typo.body, color: pal.text, lineHeight: 1.4 }}>TikTok: {sanitizeText(activation.tiktok)}</Text>
              ) : null}
              {activation?.facebook ? (
                <Text style={{ fontSize: typo.body, color: pal.text, lineHeight: 1.4, marginTop: activation?.tiktok ? 4 : 0 }}>Facebook: {sanitizeText(activation.facebook)}</Text>
              ) : null}
              {activation?.linkedin ? (
                <Text style={{ fontSize: typo.body, color: pal.text, lineHeight: 1.4, marginTop: (activation?.tiktok || activation?.facebook) ? 4 : 0 }}>LinkedIn: {sanitizeText(activation.linkedin)}</Text>
              ) : null}
              {activation?.twitter ? (
                <Text style={{ fontSize: typo.body, color: pal.text, lineHeight: 1.4, marginTop: (activation?.tiktok || activation?.facebook || activation?.linkedin) ? 4 : 0 }}>Twitter/X: {sanitizeText(activation.twitter)}</Text>
              ) : null}
              {activation?.websites ? (
                <Text style={{ fontSize: typo.body, color: pal.text, lineHeight: 1.4, marginTop: (activation?.tiktok || activation?.facebook || activation?.linkedin || activation?.twitter) ? 4 : 0 }}>Sites: {sanitizeText(activation.websites)}</Text>
              ) : null}
            </Card>
          </View>
        ) : null}

        {/* Tabela de valores */}
        {hasPricing ? (
          <Card title="Tabela de valores" style={{ marginBottom: 8 }}>
            {pricingRows.map((row, i) => (
              <View
                key={i}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  paddingVertical: 5,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: pal.borderLight,
                }}
              >
                <Text style={{ fontSize: typo.body, color: pal.textSecondary }}>{sanitizeText(row.label)}</Text>
                <Text style={{ fontSize: typo.body, fontWeight: 'bold', color: pal.text }}>{sanitizeText(row.value)}</Text>
              </View>
            ))}
            {costTier ? (
              <View style={{ marginTop: 4 }}>
                <Text style={{ fontSize: typo.caption, color: pal.textMuted }}>
                  Custo médio: <Text style={{ fontWeight: 'bold', color: pal.textSecondary }}>{costTier.symbol} {costTier.label}</Text>
                </Text>
              </View>
            ) : null}
          </Card>
        ) : hasValorEstimado && valorRows.length > 0 ? (
          <Card title="Tabela de valores (a partir de)" style={{ marginBottom: 8 }}>
            {valorRows.map((row, i) => (
              <View
                key={row.label}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingVertical: 6,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: pal.borderLight,
                }}
              >
                <Text style={{ fontSize: 12, color: pal.text }}>{row.label}</Text>
                <Text style={{ fontSize: 13, fontWeight: 'bold', color: pal.brand }}>
                  {row.min === 0 && row.max === 0 ? 'Incluído' : `R$ ${row.min.toLocaleString('pt-BR')}–${row.max.toLocaleString('pt-BR')}`}
                </Text>
              </View>
            ))}
            {valorEstimadoPorTipo != null ? (
              <View style={{ marginTop: 8, paddingTop: 6, borderTopWidth: 1, borderTopColor: pal.borderLight }}>
                <Text style={{ fontSize: 8, color: pal.textMuted, marginBottom: 4 }}>Sugestão automática (média da faixa, com base em seguidores, engajamento e alcance):</Text>
                <Text style={{ fontSize: 10, fontWeight: '600', color: pal.text }}>
                  Feed R$ {Math.round((valorEstimadoPorTipo.post.min + valorEstimadoPorTipo.post.max) / 2).toLocaleString('pt-BR')} · Reels R$ {Math.round((valorEstimadoPorTipo.reels.min + valorEstimadoPorTipo.reels.max) / 2).toLocaleString('pt-BR')} · Stories R$ {Math.round((valorEstimadoPorTipo.stories.min + valorEstimadoPorTipo.stories.max) / 2).toLocaleString('pt-BR')}
                </Text>
              </View>
            ) : null}
          </Card>
        ) : (
          <Card title="Tabela de valores" style={{ marginBottom: 8 }}>
            <Text style={{ fontSize: typo.body, color: pal.textSecondary, lineHeight: 1.4 }}>
              Valores sob consulta — envio tabela completa conforme formato e período da campanha.
            </Text>
          </Card>
        )}

        <View
          style={{
            alignItems: 'center',
            paddingVertical: 8,
            backgroundColor: pal.goldSoft,
            borderRadius: radius,
            borderWidth: 1,
            borderColor: pal.border,
          }}
        >
          <Text style={{ fontSize: 11, fontWeight: 'bold', color: pal.text, textAlign: 'center' }}>
            Vamos criar sua campanha? Chame no Instagram para proposta personalizada.
          </Text>
        </View>

        {footer}
      </View>
    </Page>
  )
}

// -------------------- Main Document
export interface MediaKitData {
  profile: ProfileItem | null
  posts: PostItem[]
  reels?: PostItem[]
  highlights?: PostItem[]
  activation: ProfileActivation | null
  reportInsights: ReportInsights | null
  profilePicDataUrl?: string | null
  postImageDataUrls?: Record<string, string>
  postImageDataUrlsOrdered?: string[]
  /** Data URL do QR code que abre o perfil Instagram do influenciador (página 4) */
  qrCodeDataUrl?: string | null
  /** Tema selecionado na aplicação — cor do PDF segue a paleta do tema */
  theme?: ThemeMode
}

export function MediaKitDocument({
  profile,
  posts,
  reels = [],
  highlights = [],
  activation,
  reportInsights,
  profilePicDataUrl,
  postImageDataUrls = {},
  postImageDataUrlsOrdered: _postImageDataUrlsOrdered,
  qrCodeDataUrl,
  theme,
}: MediaKitData) {
  const palette = useMemo(
    () => getPdfPaletteFromTheme(theme ?? 'light'),
    [theme]
  )
  const userData = profile?.data?.user as Record<string, unknown> | undefined
  const displayHandle = (profile?.handle ?? profile?.username ?? (profile as any)?.key ?? '') as string
  const handle = sanitizeText(displayHandle).replace(/^@/, '')

  const fullName =
    (profile?.full_name ??
      (userData?.full_name != null ? String(userData.full_name) : undefined)) as string | undefined

  const followersCount = getFollowersFromProfile(profile, userData)
  const followingCount = getFollowingFromProfile(profile, userData)
  const mediaCount = getMediaCountFromProfile(profile, userData, posts.length)

  const bio = (profile?.biography ?? (userData as any)?.biography) as string | undefined
  const categories = (Array.isArray((profile as any)?.categories) ? ((profile as any).categories as string[]) : []) as string[]

  const engagement =
    reportInsights?.engagement ?? {
      posts_count: posts.length,
      total_likes: 0,
      total_comments: 0,
      total_views: 0,
      avg_likes: 0,
      avg_comments: 0,
      avg_views: 0,
      engagement_rate: 0,
      posts_per_week: 0,
    }

  const er = engagement.engagement_rate ?? 0
  const postsPerWeek = engagement.posts_per_week ?? 0

  const tierLabel = getInfluencerTierLongLabel(followersCount)

  const scoreSelo = reportInsights?.score?.selo ?? 'Alto Engajamento'
  const diagnostico = reportInsights?.diagnostico ?? { headline: '', fazBem: '', trava: '', fazerPrimeiro: '' }
  const conversation = reportInsights?.conversation ?? { rate: 0, label: '', color: 'warning' }
  const valorEstimado = reportInsights?.valorEstimado ?? { min: 0, max: 0, porque: '' }

  const nicho = reportInsights?.nicho ?? { topHashtags: [], performingHashtags: [], nichoDominante: '', subtemas: [] }
  const consistency = reportInsights?.consistency ?? { postsPerWeekByWeek: [], heatmap: [], bestWeekday: 0, bestHour: 0, maxGapDays: 0 }
  const benchmark = reportInsights?.benchmark ?? { tier: '', percentil: 0, percentilLabel: '', status: 'media' as const, texto: '' }

  const costTier = activation?.pricing ? getCostTier(activation.pricing) : null

  const weekData = consistency.postsPerWeekByWeek.length ? consistency.postsPerWeekByWeek : [0, 0, 0, 0, 0, 0, 0, 0]
  const bestDay = getWeekdayName(consistency.bestWeekday)
  const bestHour = consistency.bestHour ?? 0
  const allPostsForWeekday = useMemo(() => [...posts, ...reels], [posts, reels])
  const engagementPerWeekday = useMemo(() => getEngagementPerWeekdayAllTime(allPostsForWeekday), [allPostsForWeekday])
  // Frequência: alinhar com dashboard (média das últimas 8 semanas quando disponível)
  const postsPerWeekDisplay =
    weekData.length > 0 && weekData.some((w) => w > 0)
      ? weekData.reduce((a, b) => a + b, 0) / weekData.length
      : postsPerWeek
  const postsPerWeekFormatted =
    postsPerWeekDisplay === 0 ? '0' : Number(postsPerWeekDisplay.toFixed(1)).toString().replace('.', ',')

  const nichoTemas =
    [nicho.nichoDominante, ...(nicho.subtemas || [])].filter(Boolean).length > 0
      ? ([nicho.nichoDominante, ...(nicho.subtemas || [])].filter(Boolean) as string[])
      : activation?.content_type?.slice(0, 8).map((ct) => CONTENT_TYPE_LABELS[ct] ?? ct) ?? []

  const hashtagRows = (() => {
    const byTag = new Map<string, { count: number; avgEr: number | null }>()
    for (const it of nicho.topHashtags || []) byTag.set(it.tag, { count: it.count, avgEr: null })
    for (const it of nicho.performingHashtags || []) {
      const cur = byTag.get(it.tag)
      byTag.set(it.tag, { count: cur?.count ?? it.count, avgEr: it.avgEr })
    }
    return Array.from(byTag.entries())
      .map(([tag, v]) => ({ tag, count: v.count, avgEr: v.avgEr }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 16)
  })()

  const dateStr = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })

  const engagementByType = useMemo(() => {
    const postsEr = computeErForPosts(posts, followersCount)
    const reelsEr = computeErForPosts(reels, followersCount)
    return { posts: postsEr, reels: reelsEr }
  }, [posts, reels, followersCount])

  const topFeed = useMemo(() => getTopPosts(posts, followersCount).byInteractions.slice(0, 2), [posts, followersCount])
  const topReels = useMemo(() => getTopPosts(reels, followersCount).byInteractions.slice(0, 2), [reels, followersCount])

  const valorEstimadoPorTipo = reportInsights?.valorEstimadoPorTipo ?? null

  const contentTypesLabelCapa =
    activation?.content_type?.length
      ? activation.content_type.map((ct) => CONTENT_TYPE_LABELS[ct] ?? ct).join(' · ')
      : ''

  const tierDescription = (() => {
    if (valorEstimado?.min != null && valorEstimado?.max != null && valorEstimado.min > 0) {
      return `Faixa sugerida: R$ ${valorEstimado.min.toLocaleString('pt-BR')} - R$ ${valorEstimado.max.toLocaleString('pt-BR')}`
    }
    if (tierLabel === 'Nano Influencer') return '0-2.5K seguidores · Alto engajamento orgânico'
    if (tierLabel === 'Micro Influencer') return '2.5K-10K seguidores'
    if (tierLabel === 'Mid Influencer') return '10K-500K seguidores'
    if (tierLabel === 'Macro Influencer') return '500K+ seguidores'
    return ''
  })()

  const header = <PageHeader handle={handle} fullName={fullName} tierLabel={tierLabel} />
  const footer = <PageFooter dateStr={dateStr} />

  const contentBreakdown: string[] = []
  if (reels.length > 0) contentBreakdown.push(`Reels: ${reels.length}`)
  if (highlights.length > 0) contentBreakdown.push(`Destaques: ${highlights.length}`)
  const postsSub = contentBreakdown.length > 0 ? contentBreakdown.join(' · ') : undefined

  const kpis: { label: string; value: string; sub?: string }[] = [
    { label: 'Seguidores', value: formatShortNum(followersCount) },
    { label: 'Seguindo', value: formatShortNum(followingCount) },
    { label: 'Posts', value: String(mediaCount), ...(postsSub && { sub: postsSub }) },
    { label: 'Engajamento', value: `${(er || 0).toFixed(1)}%` },
    { label: 'posts/semana', value: `${postsPerWeekFormatted}` },
  ]
  if (engagementByType.posts.count > 0 && engagementByType.posts.avgViews > 0) {
    kpis.push({ label: 'Média de views (feed)', value: formatShortNum(Math.round(engagementByType.posts.avgViews)) })
  }

  const pricingRows: { label: string; value: string }[] = []
  if (activation?.pricing) {
    const p = activation.pricing as Record<string, string | number | undefined>
    for (const key of PRICING_FIELD_KEYS) {
      const val = p[key as keyof typeof p]
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        const label = (PRICING_FIELD_LABELS[key as PricingFieldKey] ?? key)
          .replace(/^[\d\s️⃣]+\s*/, '')
          .trim()
        pricingRows.push({ label, value: formatPricingValue(val) })
      }
    }
  }

  return (
    <PdfPaletteContext.Provider value={palette}>
      <Document>
        <OverviewPage
          bio={bio}
          categories={categories}
          kpis={kpis}
          diagnostico={diagnostico}
          contentTypesLabel={contentTypesLabelCapa}
          fullName={fullName}
          handle={handle}
          profilePicDataUrl={profilePicDataUrl}
          tierLabel={tierLabel}
          tierDescription={tierDescription}
          scoreSelo={scoreSelo}
          percentil={benchmark.percentil}
          header={header}
          footer={footer}
        />

        <CoverPage
          fullName={fullName}
          handle={handle}
          tierLabel={tierLabel}
          tierDescription={tierDescription}
          scoreSelo={scoreSelo}
          percentil={benchmark.percentil}
          followersCount={followersCount}
          er={er}
          postsPerWeekFormatted={postsPerWeekFormatted}
          profilePicDataUrl={profilePicDataUrl}
          dateStr={dateStr}
          conversationRate={conversation.rate ?? 0}
          conversationLabel={conversation.label}
          bestDay={bestDay}
          bestHour={bestHour}
          engagementPerWeekday={engagementPerWeekday}
          maxEr={Math.max(0, ...topFeed.map((t) => t.erPost), ...topReels.map((t) => t.erPost), er)}
          totalLikes={engagement.total_likes ?? 0}
          totalComments={engagement.total_comments ?? 0}
          totalViews={engagement.total_views ?? 0}
          cpmCpe={reportInsights?.cpmCpe ?? { cpmEstimate: null, cpeEstimate: null, costPer1000Interactions: null }}
          strategicMetrics={reportInsights?.strategicMetrics ?? null}
          executiveSummary={{
            strengths: reportInsights?.executiveSummaryForBrands?.strengths ?? [],
            recommendation: reportInsights?.executiveSummaryForBrands?.recommendation ?? '',
            creatorType: reportInsights?.executiveSummaryForBrands?.creatorType?.fullLabel ?? reportInsights?.creatorType?.fullLabel ?? 'Creator',
          }}
          header={header}
          footer={footer}
        />

        <ContentAnalysisPage
          feedStats={engagementByType.posts}
          reelsStats={engagementByType.reels}
          topFeedPost={topFeed[0] ?? null}
          topReelPost={topReels[0] ?? null}
          postImageDataUrls={postImageDataUrls}
          header={header}
          footer={footer}
        />

        <CtaPage
          fullName={fullName}
          handle={handle}
          cityState={[activation?.city, activation?.state].filter(Boolean).join(', ') || ''}
          nichoLine={[hashtagRows[0]?.tag, nichoTemas[0]].filter(Boolean).join(' / ') || ''}
          profilePicDataUrl={profilePicDataUrl}
          activation={activation}
          costTier={costTier}
          pricingRows={pricingRows}
          valorEstimado={valorEstimado}
          valorEstimadoPorTipo={valorEstimadoPorTipo ?? undefined}
          nichoLabel={nichoTemas[0]}
          qrCodeDataUrl={qrCodeDataUrl}
          header={header}
          footer={footer}
        />
      </Document>
    </PdfPaletteContext.Provider>
  )
}
