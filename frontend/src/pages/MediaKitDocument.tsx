/**
 * Media Kit PDF — design premium, estilo Apple + agência.
 * Capa editorial (hero), layout estável em React-PDF (sem % quebrando),
 * header/footer fixos, tratamento de dados faltantes e resolução robusta de imagens.
 */
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
import { buildReportInsights, getWeekdayName } from '../utils/reportInsights'
import { getCostTier } from '../utils/pricing'
import { CONTENT_TYPE_LABELS } from '../constants/contentTypes'
import {
  PRICING_FIELD_KEYS,
  PRICING_FIELD_LABELS,
  type PricingFieldKey,
} from '../constants/pricingBuckets'

type ReportInsights = ReturnType<typeof buildReportInsights>

// -------------------- Tokens
const s = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 }
const pagePadding = 32

// -------------------- Paleta premium (branco + 1 cor)
const c = {
  ink: '#0b1220',
  text: '#111827',
  textSecondary: '#6b7280',
  textMuted: '#9ca3af',

  brand: '#3b5bfd',
  brandDark: '#2447ff',
  brandSoft: '#eef2ff',

  gold: '#b78a1b',
  goldSoft: '#fff7e6',

  border: '#e5e7eb',
  borderLight: '#f1f5f9',

  pageBg: '#ffffff',
  cardBg: '#ffffff',
  cardAlt: '#f8fafc',
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
const headerHeight = 78
const footerHeight = 48

// -------------------- Utils
function sanitizeText(str: string): string {
  if (!str || typeof str !== 'string') return ''
  return str
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2013|\u2014/g, '-')
    .replace(/\u00A0/g, ' ')
    .replace(/\u00B7/g, '-')
    .replace(/\u00D7/g, 'x')
    .replace(/[\uFE0F\u200D]/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
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

function getResumoPositivo(bullets: string[]): string[] {
  const neg =
    /abaixo|ajustes|completar|após|ativar perfil|migre|limita|trava|baixa|poucos|recomenda-se/i
  return (bullets || []).filter((b) => !neg.test(String(b || '')))
}

function getLabelAudienciaPositivo(label: string): string {
  const l = String(label || '')
  if (/passivo|abaixo/i.test(l)) return 'Audiência conectada e engajada'
  if (/médio/i.test(l)) return 'Comunidade ativa'
  return l || 'Comunidade engajada'
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
    backgroundColor: c.pageBg,
  },
  pageContent: {
    paddingLeft: pagePadding,
    paddingRight: pagePadding,
    paddingTop: headerHeight,
    paddingBottom: footerHeight + 14,
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
  return (
    <View style={{ marginTop: first ? 0 : s.xl, marginBottom: s.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View
          style={{
            width: 6,
            height: 18,
            backgroundColor: c.brand,
            borderRadius: 3,
            marginRight: s.sm,
          }}
        />
        <Text style={{ fontSize: typo.h2, fontWeight: 'bold', color: c.text }}>
          {children}
        </Text>
      </View>
      <View style={{ height: 1, backgroundColor: c.borderLight, marginTop: s.sm }} />
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
  const bg = tone === 'gold' ? c.goldSoft : tone === 'neutral' ? c.cardAlt : c.brandSoft
  const fg = tone === 'gold' ? c.gold : tone === 'neutral' ? c.textSecondary : c.brandDark
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
  return (
    <View
      style={{
        backgroundColor: c.cardBg,
        borderRadius: radius,
        borderWidth: 1,
        borderColor: c.border,
        overflow: 'hidden',
        ...style,
      }}
    >
      {title ? (
        <View
          style={{
            paddingVertical: 10,
            paddingHorizontal: 14,
            backgroundColor: c.cardAlt,
            borderBottomWidth: 1,
            borderBottomColor: c.border,
          }}
        >
          <Text
            style={{
              fontSize: typo.caption,
              fontWeight: 'bold',
              color: c.textSecondary,
              letterSpacing: 0.4,
            }}
          >
            {sanitizeText(title).toUpperCase()}
          </Text>
          <View
            style={{
              height: 2,
              width: 36,
              backgroundColor: c.brand,
              marginTop: 8,
              borderRadius: 2,
            }}
          />
        </View>
      ) : null}
      <View style={{ padding: noPadding ? 0 : 14 }}>{children}</View>
    </View>
  )
}

function MetricRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={{ marginBottom: s.sm }}>
      <Text style={{ fontSize: typo.caption, color: c.textMuted, marginBottom: 2 }}>
        {sanitizeText(label)}
      </Text>
      <Text style={{ fontSize: typo.h3, fontWeight: 'bold', color: c.text }}>
        {sanitizeText(value)}
      </Text>
      {sub ? (
        <Text style={{ fontSize: typo.caption, color: c.textSecondary, marginTop: 2 }}>
          {sanitizeText(sub)}
        </Text>
      ) : null}
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
  return (
    <View fixed>
      <View style={{ height: 3, backgroundColor: c.brand }} />
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingHorizontal: pagePadding,
          paddingVertical: 12,
          backgroundColor: c.pageBg,
        }}
      >
        <View>
          <Text style={{ fontSize: typo.body, fontWeight: 'bold', color: c.text }}>
            @{handle}
          </Text>
          {fullName ? (
            <Text style={{ fontSize: typo.caption, color: c.textSecondary }}>
              {truncate(fullName, 38)}
            </Text>
          ) : null}
        </View>

        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ fontSize: typo.caption, fontWeight: 'bold', color: c.brand }}>
            {sanitizeText(tierLabel)}
          </Text>
          <Text style={{ fontSize: typo.caption, color: c.textMuted }}>Media Kit</Text>
        </View>
      </View>
      <View style={{ height: 1, backgroundColor: c.border, marginHorizontal: pagePadding }} />
    </View>
  )
}

function PageFooter({ dateStr }: { dateStr: string }) {
  return (
    <View fixed style={{ position: 'absolute', left: pagePadding, right: pagePadding, bottom: 16 }}>
      <View style={{ height: 1, backgroundColor: c.borderLight, marginBottom: 6 }} />
      <Text style={{ fontSize: typo.caption, color: c.textMuted, textAlign: 'center' }}>
        Media Kit profissional - Gerado em {dateStr}
      </Text>
    </View>
  )
}

// -------------------- Pages
function CoverPage({
  fullName,
  handle,
  tierLabel,
  scoreSelo,
  percentil,
  followersCount,
  er,
  postsPerWeek,
  profilePicDataUrl,
  dateStr,
}: {
  fullName?: string
  handle: string
  tierLabel: string
  scoreSelo: string
  percentil: number
  followersCount: number
  er: number
  postsPerWeek: number
  profilePicDataUrl?: string | null
  dateStr: string
}) {
  const displayName = sanitizeText(fullName || handle || 'Influencer')
  const topLabel = percentil > 0 ? `Top ${percentil}%` : 'Top —'
  const safeHandle = sanitizeText(handle).replace(/^@/, '')

  const metrics = [
    { label: 'Seguidores', value: formatShortNum(followersCount) },
    { label: 'Engajamento', value: `${(er || 0).toFixed(1)}%` },
    { label: 'Posts/sem', value: (postsPerWeek || 0).toFixed(1) },
  ]

  // Cores estilo Instagram (gradiente simplificado no topo)
  const igPurple = '#833AB4'
  const igPink = '#E1306C'
  const igOrange = '#F77737'

  return (
    <Page size="A4" style={styles.page}>
      {/* Fundo branco estilo feed */}
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: '#ffffff' }} />

      {/* Barra gradiente Instagram (faixas) */}
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 6, flexDirection: 'row' }}>
        <View style={{ flex: 1, backgroundColor: igPurple }} />
        <View style={{ flex: 1, backgroundColor: igPink }} />
        <View style={{ flex: 1, backgroundColor: igOrange }} />
      </View>

      <View style={{ padding: pagePadding, paddingTop: 52 }}>
        {/* Cabeçalho tipo app: logo + data */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
          <Text style={{ fontSize: 18, fontWeight: 'bold', color: c.ink }}>Media Kit</Text>
          <Text style={{ fontSize: 9, color: c.textMuted }}>{dateStr}</Text>
        </View>

        {/* Perfil estilo Instagram: foto central + nome e handle */}
        <View style={{ alignItems: 'center', marginBottom: 24 }}>
          {profilePicDataUrl ? (
            <View style={{ marginBottom: 14 }}>
              <View
                style={{
                  width: 100,
                  height: 100,
                  borderRadius: 50,
                  padding: 4,
                  backgroundColor: igPurple,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <View style={{ width: 92, height: 92, borderRadius: 46, overflow: 'hidden', backgroundColor: '#fff' }}>
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
                backgroundColor: '#efefef',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 14,
              }}
            >
              <Text style={{ fontSize: 32, fontWeight: 'bold', color: c.textSecondary }}>
                {getInitials(displayName, handle)}
              </Text>
            </View>
          )}
          <Text style={{ fontSize: 22, fontWeight: 'bold', color: c.ink }}>{truncate(displayName, 26)}</Text>
          <Text style={{ fontSize: 12, color: c.textSecondary, marginTop: 4 }}>@{safeHandle}</Text>
          {/* Selos em linha, estilo badges */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: 12 }}>
            <View style={{ backgroundColor: '#f0f0f0', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12, marginRight: 6, marginBottom: 4 }}>
              <Text style={{ fontSize: 8, color: c.text, fontWeight: 'bold' }}>{sanitizeText(tierLabel)}</Text>
            </View>
            <View style={{ backgroundColor: '#f0f0f0', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12, marginRight: 6, marginBottom: 4 }}>
              <Text style={{ fontSize: 8, color: c.text, fontWeight: 'bold' }}>{sanitizeText(scoreSelo)}</Text>
            </View>
            {percentil > 0 && (
              <View style={{ backgroundColor: '#fff0e6', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12, marginBottom: 4 }}>
                <Text style={{ fontSize: 8, color: c.gold, fontWeight: 'bold' }}>{topLabel}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Linha separadora — fica logo abaixo dos badges */}
        <View style={{ height: 1, backgroundColor: '#efefef', marginTop: 16 }} />

        {/* Métricas no estilo Instagram: número em cima, label embaixo */}
        <View style={{ flexDirection: 'row', paddingTop: 18 }}>
          {metrics.map((k) => (
            <View key={k.label} style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ fontSize: 20, fontWeight: 'bold', color: c.ink }}>{k.value}</Text>
              <Text style={{ fontSize: 9, color: c.textMuted, marginTop: 2 }}>{k.label}</Text>
            </View>
          ))}
        </View>

        {/* Bio curta estilo Instagram */}
        <View style={{ marginTop: 22 }}>
          <Text style={{ fontSize: 11, color: c.text, lineHeight: 1.5, textAlign: 'center', paddingHorizontal: 20 }}>
            Conteúdo autêntico · Comunidade engajada · Pronto para parcerias com marcas
          </Text>
        </View>

        {/* Rodapé no fluxo: fica sempre abaixo do texto, com espaço fixo */}
        <View style={{ marginTop: 48 }}>
          <View style={{ height: 1, backgroundColor: '#efefef', marginBottom: 10 }} />
          <Text style={{ fontSize: 8, color: c.textMuted, textAlign: 'center' }}>
            Documento confidencial · Propostas e parcerias
          </Text>
        </View>
      </View>
    </Page>
  )
}

function OverviewPage({
  bio,
  categories,
  kpis,
  score,
  scoreSelo,
  diagnostico,
  header,
  footer,
}: {
  bio?: string
  categories: string[]
  kpis: { label: string; value: string; sub?: string }[]
  score: number
  scoreSelo: string
  diagnostico: { fazBem: string }
  header: React.ReactNode
  footer: React.ReactNode
}) {
  return (
    <Page size="A4" style={styles.page}>
      {header}
      <View style={styles.pageContent}>
        <SectionTitle first>Sobre o perfil</SectionTitle>

        <Card>
          <Text style={{ fontSize: typo.body, color: c.text, lineHeight: 1.55 }}>
            {sanitizeText(bio?.trim() || 'Conteúdo autêntico com alto potencial de parcerias para marcas.')}
          </Text>

          {categories.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: s.md }}>
              {categories.slice(0, 10).map((cat) => (
                <View key={cat} style={{ marginRight: s.sm, marginBottom: s.xs }}>
                  <Pill tone="neutral">{sanitizeText(cat)}</Pill>
                </View>
              ))}
            </View>
          ) : null}
        </Card>

        <SectionTitle>Métricas principais</SectionTitle>

        <Card title="KPIs (visão rápida)">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
            {kpis.map((k) => (
              <View key={k.label} style={{ width: 160, marginBottom: s.md }}>
                <MetricRow label={k.label} value={k.value} sub={k.sub} />
              </View>
            ))}
          </View>
        </Card>

        <Card title="Score do perfil" style={{ marginTop: s.lg }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1, height: 8, backgroundColor: c.borderLight, borderRadius: 4, overflow: 'hidden', marginRight: s.md }}>
              <View style={{ width: `${Math.min(100, Math.max(0, score || 0))}%`, height: '100%', backgroundColor: c.brand }} />
            </View>
            <Pill tone="gold">{Math.round(score || 0)}/100</Pill>
          </View>
          <Text style={{ fontSize: typo.caption, color: c.textSecondary, marginTop: 8 }}>{sanitizeText(scoreSelo)}</Text>
        </Card>

        <SectionTitle>Meus diferenciais</SectionTitle>

        <View style={{ flexDirection: 'row' }}>
          <View style={{ flex: 1, marginRight: s.lg }}>
            <Card title="Ponto forte">
              <Text style={{ fontSize: typo.body, color: c.text, lineHeight: 1.55 }}>
                {sanitizeText(diagnostico.fazBem || 'Criatividade + consistência com alto potencial de conversão.')}
              </Text>
            </Card>
          </View>
          <View style={{ width: 230 }}>
            <Card title="Compromisso">
              <Text style={{ fontSize: typo.body, color: c.text, lineHeight: 1.55 }}>
                Conteúdo autêntico e entregas alinhadas a objetivos: awareness, tráfego e conversão.
              </Text>
            </Card>
          </View>
        </View>

        {footer}
      </View>
    </Page>
  )
}

function ValuePage({
  valorEstimado,
  conversation,
  resumoPositivo,
  nichoTemas,
  header,
  footer,
}: {
  valorEstimado: { min: number; max: number; porque: string }
  conversation: { rate: number; label: string }
  resumoPositivo: string[]
  nichoTemas: string[]
  header: React.ReactNode
  footer: React.ReactNode
}) {
  const min = Math.max(0, valorEstimado?.min ?? 0)
  const max = Math.max(min, valorEstimado?.max ?? 0)
  const porque = sanitizeText(valorEstimado?.porque || '')

  return (
    <Page size="A4" style={styles.page}>
      {header}
      <View style={styles.pageContent}>
        <SectionTitle first>Valor e audiência</SectionTitle>

        <View style={{ flexDirection: 'row', marginBottom: s.lg }}>
          <View style={{ flex: 1, marginRight: s.lg }}>
            <Card title="Valor por post (estimado)">
              <Text style={{ fontSize: 18, fontWeight: 'bold', color: c.text }}>
                R$ {min.toLocaleString('pt-BR')} - R$ {max.toLocaleString('pt-BR')}
              </Text>
              {porque ? (
                <Text style={{ fontSize: typo.caption, color: c.textSecondary, marginTop: 8, lineHeight: 1.45 }}>
                  {porque}
                </Text>
              ) : (
                <Text style={{ fontSize: typo.caption, color: c.textSecondary, marginTop: 8 }}>
                  Estimativa baseada em engajamento, frequência e posicionamento.
                </Text>
              )}
            </Card>
          </View>

          <View style={{ width: 230 }}>
            <Card title="Qualidade da audiência">
              <Text style={{ fontSize: 12, fontWeight: 'bold', color: c.text }}>
                {sanitizeText(getLabelAudienciaPositivo(conversation.label))}
              </Text>
              <Text style={{ fontSize: typo.caption, color: c.textSecondary, marginTop: 8 }}>
                {Math.max(0, conversation.rate || 0)}% taxa de conversa
              </Text>
            </Card>
          </View>
        </View>

        {resumoPositivo.length > 0 ? (
          <>
            <SectionTitle>Por que trabalhar comigo</SectionTitle>
            <Card>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {resumoPositivo.slice(0, 8).map((bullet, i) => (
                  <View
                    key={i}
                    style={{
                      width: 250,
                      flexDirection: 'row',
                      marginBottom: s.sm,
                      marginRight: i % 2 === 0 ? s.lg : 0,
                    }}
                  >
                    <Text style={{ color: c.brand, marginRight: s.xs, fontWeight: 'bold' }}>+</Text>
                    <Text style={{ fontSize: typo.body, color: c.text, lineHeight: 1.45 }}>
                      {sanitizeText(bullet)}
                    </Text>
                  </View>
                ))}
              </View>
            </Card>
          </>
        ) : null}

        {nichoTemas.length > 0 ? (
          <>
            <SectionTitle>Áreas de atuação</SectionTitle>
            <Card>
              <Text style={{ fontSize: typo.small, color: c.textSecondary, marginBottom: s.md }}>
                Conteúdo consistente com engajamento comprovado — ideal para campanhas segmentadas.
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {nichoTemas.slice(0, 12).map((label) => (
                  <View key={label} style={{ marginRight: s.sm, marginBottom: s.xs }}>
                    <Pill tone="brand">{sanitizeText(label)}</Pill>
                  </View>
                ))}
              </View>
            </Card>
          </>
        ) : null}

        {footer}
      </View>
    </Page>
  )
}

function ContactAndPricingPage({
  activation,
  costTier,
  pricingRows,
  header,
  footer,
}: {
  activation: ProfileActivation | null
  costTier: { symbol: string; label: string } | null
  pricingRows: { label: string; value: string }[]
  header: React.ReactNode
  footer: React.ReactNode
}) {
  const hasPricing = pricingRows.length > 0

  return (
    <Page size="A4" style={styles.page}>
      {header}
      <View style={styles.pageContent}>
        <SectionTitle first>Contato e preços</SectionTitle>

        <View style={{ flexDirection: 'row' }}>
          <View style={{ flex: 1, marginRight: s.lg }}>
            {hasPricing ? (
              <Card title="Tabela de valores">
                {pricingRows.map((row, i) => (
                  <View
                    key={i}
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      paddingVertical: 10,
                      borderTopWidth: i === 0 ? 0 : 1,
                      borderTopColor: c.borderLight,
                    }}
                  >
                    <Text style={{ fontSize: typo.body, color: c.textSecondary }}>
                      {sanitizeText(row.label)}
                    </Text>
                    <Text style={{ fontSize: typo.body, fontWeight: 'bold', color: c.text }}>
                      {sanitizeText(row.value)}
                    </Text>
                  </View>
                ))}
                {costTier ? (
                  <View style={{ marginTop: 10 }}>
                    <Text style={{ fontSize: typo.caption, color: c.textMuted }}>
                      Custo médio:{' '}
                      <Text style={{ fontWeight: 'bold', color: c.textSecondary }}>
                        {costTier.symbol} {costTier.label}
                      </Text>
                    </Text>
                  </View>
                ) : null}
              </Card>
            ) : (
              <Card title="Tabela de valores">
                <Text style={{ fontSize: typo.body, color: c.textSecondary }}>
                  Valores sob consulta — envio tabela completa conforme formato e período da campanha.
                </Text>
              </Card>
            )}
          </View>

          <View style={{ width: 230 }}>
            <Card title="Contato">
              {(activation?.city || activation?.state) ? (
                <Text style={{ fontSize: typo.body, color: c.text, marginBottom: 8 }}>
                  {sanitizeText([activation.city, activation.state].filter(Boolean).join(', '))}
                </Text>
              ) : (
                <Text style={{ fontSize: typo.body, color: c.text, marginBottom: 8 }}>
                  Disponível para campanhas
                </Text>
              )}

              {activation?.whatsapp ? (
                <>
                  <Text style={{ fontSize: typo.caption, color: c.textMuted }}>WhatsApp</Text>
                  <Text style={{ fontSize: typo.body, fontWeight: 'bold', color: c.text }}>
                    {sanitizeText(String(activation.whatsapp))}
                  </Text>
                </>
              ) : (
                <Text style={{ fontSize: typo.body, color: c.textSecondary }}>
                  WhatsApp não informado
                </Text>
              )}

              {activation?.content_type?.length ? (
                <View style={{ marginTop: 12 }}>
                  <Text style={{ fontSize: typo.caption, color: c.textMuted, marginBottom: 6 }}>
                    Entrega
                  </Text>
                  <Text style={{ fontSize: typo.body, color: c.textSecondary, lineHeight: 1.45 }}>
                    {activation.content_type.map((ct) => CONTENT_TYPE_LABELS[ct] ?? ct).join(', ')}
                  </Text>
                </View>
              ) : null}
            </Card>
          </View>
        </View>

        {footer}
      </View>
    </Page>
  )
}

function PostDetailPage({
  topPosts,
  postImageDataUrls,
  postImageDataUrlsOrdered,
  header,
  footer,
}: {
  topPosts: { post: PostItem; erPost: number; oQueFuncionou: string }[]
  postImageDataUrls: Record<string, string>
  postImageDataUrlsOrdered?: string[]
  header: React.ReactNode
  footer: React.ReactNode
}) {
  return (
    <Page size="A4" style={styles.page}>
      {header}
      <View style={styles.pageContent}>
        <SectionTitle first>Destaques do conteúdo</SectionTitle>

        <Text style={{ fontSize: typo.small, color: c.textSecondary, marginBottom: s.md, lineHeight: 1.45 }}>
          Posts com melhor performance — formato, mensagem e gatilhos que mais geram resultado.
        </Text>

        {topPosts.slice(0, 3).map((item, idx) => {
          const p = item.post as any
          const dataUrl = resolvePostImage(p, idx, postImageDataUrls, postImageDataUrlsOrdered)

          const likes = (item.post as any)?.metrics?.likes ?? 0
          const comments = (item.post as any)?.metrics?.comments ?? 0
          const views = (item.post as any)?.metrics?.view_count
          const caption = (item.post as any)?.content?.caption_text ?? ''

          return (
            <Card key={idx} noPadding style={{ marginBottom: s.lg }}>
              <View style={{ flexDirection: 'row' }}>
                <View style={{ width: 230 }}>
                  {dataUrl ? (
                    <Image src={dataUrl} style={{ width: '100%', height: 170, objectFit: 'cover' as const }} />
                  ) : (
                    <View style={{ width: '100%', height: 170, backgroundColor: c.borderLight, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontSize: typo.caption, color: c.textMuted }}>Imagem indisponível</Text>
                    </View>
                  )}
                </View>

                <View style={{ flex: 1, padding: 14 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ fontSize: 9, color: c.textMuted }}>DESTAQUE #{idx + 1}</Text>
                    <Pill tone="gold">ER {Number(item.erPost || 0).toFixed(1)}%</Pill>
                  </View>

                  <View style={{ marginTop: 10, backgroundColor: c.brandSoft, padding: 10, borderRadius: 10 }}>
                    <Text style={{ fontSize: 9, color: c.brandDark, fontWeight: 'bold' }}>O que funcionou</Text>
                    <Text style={{ fontSize: 10, color: c.text, marginTop: 4, lineHeight: 1.45 }}>
                      {sanitizeText(item.oQueFuncionou || 'Mensagem clara + formato consistente + boa retenção.')}
                    </Text>
                  </View>

                  <Text style={{ fontSize: 9, color: c.textSecondary, marginTop: 10 }}>
                    Curtidas {formatShortNum(likes)} - Coment. {formatShortNum(comments)}
                    {views != null ? ` - Views ${formatShortNum(Number(views))}` : ''}
                  </Text>

                  {caption ? (
                    <Text style={{ fontSize: typo.caption, color: c.textMuted, marginTop: 6, lineHeight: 1.45 }}>
                      {truncate(String(caption), 140)}
                    </Text>
                  ) : null}
                </View>
              </View>
            </Card>
          )
        })}

        {footer}
      </View>
    </Page>
  )
}

function ConsistencyPage({
  weekData,
  maxBar,
  bestDay,
  bestHour,
  hashtagRows,
  fullName,
  handle,
  activation,
  header,
  footer,
}: {
  weekData: number[]
  maxBar: number
  bestDay: string
  bestHour: number
  hashtagRows: { tag: string; count: number; avgEr: number | null }[]
  fullName?: string
  handle: string
  activation: ProfileActivation | null
  header: React.ReactNode
  footer: React.ReactNode
}) {
  const hasWeekData = weekData.some((n) => (n || 0) > 0)

  return (
    <Page size="A4" style={styles.page}>
      {header}
      <View style={styles.pageContent}>
        {hasWeekData ? (
          <>
            <SectionTitle first>Consistência</SectionTitle>

            <View style={{ flexDirection: 'row' }}>
              <View style={{ flex: 1, marginRight: s.lg }}>
                <Card title="Posts por semana (últimas 8 semanas)">
                  <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 52 }}>
                    {weekData.map((n, i) => (
                      <View
                        key={i}
                        style={{
                          flex: 1,
                          height: Math.max(10, ((n || 0) / Math.max(1, maxBar)) * 40),
                          backgroundColor: c.brand,
                          borderRadius: 4,
                          marginRight: i < weekData.length - 1 ? 4 : 0,
                        }}
                      />
                    ))}
                  </View>
                  <View style={{ height: 1, backgroundColor: c.borderLight, marginTop: 10 }} />
                  <Text style={{ fontSize: typo.caption, color: c.textSecondary, marginTop: 8 }}>
                    Melhor horário: {sanitizeText(bestDay)} às {bestHour}h
                  </Text>
                </Card>
              </View>

              <View style={{ width: 230 }}>
                <Card title="Recomendação">
                  <Text style={{ fontSize: typo.body, color: c.text, lineHeight: 1.55 }}>
                    Publicar próximo do pico melhora alcance e salva custo de mídia em campanhas.
                  </Text>
                  <View style={{ marginTop: 12 }}>
                    <Pill tone="brand">Pico: {sanitizeText(bestDay)} · {bestHour}h</Pill>
                  </View>
                </Card>
              </View>
            </View>
          </>
        ) : (
          <>
            <SectionTitle first>Consistência</SectionTitle>
            <Card>
              <Text style={{ fontSize: typo.body, color: c.textSecondary }}>
                Sem dados suficientes para consistência nas últimas semanas.
              </Text>
            </Card>
          </>
        )}

        {hashtagRows.length > 0 ? (
          <>
            <SectionTitle>Assinatura de conteúdo</SectionTitle>
            <Card>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {hashtagRows.slice(0, 14).map(({ tag, count, avgEr }) => (
                  <View key={tag} style={{ flexDirection: 'row', alignItems: 'center', marginRight: s.sm, marginBottom: s.xs }}>
                    <Pill tone="neutral">#{sanitizeText(tag)}</Pill>
                    <Text style={{ fontSize: typo.caption, color: c.textMuted, marginLeft: s.xs }}>
                      {count}x{avgEr != null ? ` - ${avgEr.toFixed(0)}%` : ''}
                    </Text>
                  </View>
                ))}
              </View>
            </Card>
          </>
        ) : null}

        <SectionTitle>Vamos trabalhar juntos</SectionTitle>
        <Card title="Contato rápido">
          <Text style={{ fontSize: typo.body, color: c.text, lineHeight: 1.55, marginBottom: s.md }}>
            Comunidade ativa, conteúdo consistente e alto potencial de conversão. Disponível para publis, reels, stories e campanhas integradas.
          </Text>

          <Text style={{ fontSize: typo.h3, fontWeight: 'bold', color: c.text }}>
            {truncate(fullName || `@${handle}`, 42)}
          </Text>
          <Text style={{ fontSize: typo.small, color: c.textSecondary }}>
            @{sanitizeText(handle).replace(/^@/, '')}
          </Text>

          {activation?.whatsapp ? (
            <View style={{ marginTop: 12 }}>
              <Text style={{ fontSize: typo.caption, color: c.textMuted }}>WhatsApp</Text>
              <Text style={{ fontSize: typo.body, fontWeight: 'bold', color: c.text }}>
                {sanitizeText(String(activation.whatsapp))}
              </Text>
            </View>
          ) : null}

          {(activation?.city || activation?.state) ? (
            <Text style={{ fontSize: typo.small, color: c.textSecondary, marginTop: 8 }}>
              {sanitizeText([activation.city, activation.state].filter(Boolean).join(', '))}
            </Text>
          ) : null}

          {activation?.content_type?.length ? (
            <Text style={{ fontSize: typo.caption, color: c.textMuted, marginTop: 10 }}>
              Entrega: {activation.content_type.map((ct) => CONTENT_TYPE_LABELS[ct] ?? ct).join(', ')}
            </Text>
          ) : null}
        </Card>

        {footer}
      </View>
    </Page>
  )
}

// -------------------- Main Document
export interface MediaKitData {
  profile: ProfileItem | null
  posts: PostItem[]
  activation: ProfileActivation | null
  reportInsights: ReportInsights | null
  profilePicDataUrl?: string | null
  postImageDataUrls?: Record<string, string>
  postImageDataUrlsOrdered?: string[]
}

export function MediaKitDocument({
  profile,
  posts,
  activation,
  reportInsights,
  profilePicDataUrl,
  postImageDataUrls = {},
  postImageDataUrlsOrdered,
}: MediaKitData) {
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

  const tierLabel =
    followersCount < 10_000
      ? 'Nano Influencer'
      : followersCount < 50_000
        ? 'Micro Influencer'
        : followersCount < 500_000
          ? 'Mid Influencer'
          : 'Macro Influencer'

  const score = reportInsights?.score?.total ?? 0
  const scoreSelo = reportInsights?.score?.selo ?? 'Alto Engajamento'
  const diagnostico = reportInsights?.diagnostico ?? { headline: '', fazBem: '', trava: '', fazerPrimeiro: '' }
  const topPosts = reportInsights?.topPosts?.byInteractions ?? []
  const resumoExecutivo = reportInsights?.resumoExecutivo ?? []
  const conversation = reportInsights?.conversation ?? { rate: 0, label: '', color: 'warning' }
  const valorEstimado = reportInsights?.valorEstimado ?? { min: 0, max: 0, porque: '' }

  const nicho = reportInsights?.nicho ?? { topHashtags: [], performingHashtags: [], nichoDominante: '', subtemas: [] }
  const consistency = reportInsights?.consistency ?? { postsPerWeekByWeek: [], heatmap: [], bestWeekday: 0, bestHour: 0, maxGapDays: 0 }
  const benchmark = reportInsights?.benchmark ?? { tier: '', percentil: 0, percentilLabel: '', status: 'media' as const, texto: '' }

  const costTier = activation?.pricing ? getCostTier(activation.pricing) : null

  const weekData = consistency.postsPerWeekByWeek.length ? consistency.postsPerWeekByWeek : [0, 0, 0, 0, 0, 0, 0, 0]
  const maxBar = Math.max(1, ...weekData)
  const bestDay = getWeekdayName(consistency.bestWeekday)
  const bestHour = consistency.bestHour ?? 0

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

  const header = <PageHeader handle={handle} fullName={fullName} tierLabel={tierLabel} />
  const footer = <PageFooter dateStr={dateStr} />

  const kpis: { label: string; value: string; sub?: string }[] = [
    { label: 'Seguidores', value: formatShortNum(followersCount) },
    { label: 'Seguindo', value: formatShortNum(followingCount) },
    { label: 'Posts', value: String(mediaCount) },
    { label: 'Engajamento', value: `${(er || 0).toFixed(1)}%` },
    { label: 'Posts/sem', value: (postsPerWeek || 0).toFixed(1) },
  ]
  if ((engagement.total_views ?? 0) > 0) {
    kpis.push({ label: 'Média views', value: formatShortNum(engagement.avg_views ?? 0) })
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
    <Document>
      <CoverPage
        fullName={fullName}
        handle={handle}
        tierLabel={tierLabel}
        scoreSelo={scoreSelo}
        percentil={benchmark.percentil}
        followersCount={followersCount}
        er={er}
        postsPerWeek={postsPerWeek}
        profilePicDataUrl={profilePicDataUrl}
        dateStr={dateStr}
      />

      <OverviewPage
        bio={bio}
        categories={categories}
        kpis={kpis}
        score={score}
        scoreSelo={scoreSelo}
        diagnostico={diagnostico}
        header={header}
        footer={footer}
      />

      <ValuePage
        valorEstimado={valorEstimado}
        conversation={conversation}
        resumoPositivo={getResumoPositivo(resumoExecutivo)}
        nichoTemas={nichoTemas}
        header={header}
        footer={footer}
      />

      {(pricingRows.length > 0 || activation?.whatsapp || activation?.city || activation?.state) && (
        <ContactAndPricingPage
          activation={activation}
          costTier={costTier}
          pricingRows={pricingRows}
          header={header}
          footer={footer}
        />
      )}

      <PostDetailPage
        topPosts={topPosts}
        postImageDataUrls={postImageDataUrls}
        postImageDataUrlsOrdered={postImageDataUrlsOrdered}
        header={header}
        footer={footer}
      />

      <ConsistencyPage
        weekData={weekData}
        maxBar={maxBar}
        bestDay={bestDay}
        bestHour={bestHour}
        hashtagRows={hashtagRows}
        fullName={fullName}
        handle={handle}
        activation={activation}
        header={header}
        footer={footer}
      />
    </Document>
  )
}
