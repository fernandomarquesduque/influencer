/**
 * Documento PDF do Media Kit profissional (melhores práticas para influencer).
 * Usado por @react-pdf/renderer para gerar o PDF.
 */
import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
} from '@react-pdf/renderer'
import type { ProfileItem, PostItem, ProfileActivation } from '../api'
import { buildReportInsights } from '../utils/reportInsights'

type ReportInsights = ReturnType<typeof buildReportInsights>
import { CONTENT_TYPE_LABELS } from '../constants/contentTypes'
import { PRICING_FIELD_KEYS, PRICING_FIELD_LABELS, type PricingFieldKey } from '../constants/pricingBuckets'

// Estilos do Media Kit — visual premium e limpo
const colors = {
  primary: '#6366f1',
  primaryDark: '#4f46e5',
  text: '#1e293b',
  textSecondary: '#64748b',
  textMuted: '#94a3b8',
  gold: '#d4a853',
  success: '#10b981',
  border: '#e2e8f0',
  pageBg: '#ffffff',
  cardBg: '#f8fafc',
  heroBg: '#eef2ff',
}

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    fontFamily: 'Helvetica',
    backgroundColor: colors.pageBg,
  },
  coverPage: {
    padding: 40,
    fontSize: 10,
    fontFamily: 'Helvetica',
    backgroundColor: colors.heroBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: colors.primaryDark,
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  coverSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 32,
  },
  coverName: {
    fontSize: 22,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 4,
  },
  coverHandle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 24,
  },
  coverAvatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    marginBottom: 16,
  },
  coverTagline: {
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'center',
    maxWidth: 320,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.primaryDark,
    marginBottom: 10,
    marginTop: 16,
    borderBottomWidth: 2,
    borderBottomColor: colors.primary,
    paddingBottom: 4,
  },
  bodyText: {
    fontSize: 10,
    color: colors.text,
    lineHeight: 1.5,
    marginBottom: 6,
  },
  bodySecondary: {
    fontSize: 9,
    color: colors.textSecondary,
    lineHeight: 1.4,
    marginBottom: 4,
  },
  statRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 12,
  },
  statBox: {
    backgroundColor: colors.cardBg,
    padding: 10,
    borderRadius: 6,
    minWidth: 80,
  },
  statValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.primary,
  },
  statLabel: {
    fontSize: 8,
    color: colors.textSecondary,
    marginTop: 2,
  },
  tag: {
    backgroundColor: colors.primary,
    color: '#fff',
    padding: '4 8',
    borderRadius: 4,
    fontSize: 8,
    marginRight: 4,
    marginBottom: 4,
  },
  table: {
    width: '100%',
    marginBottom: 12,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 6,
  },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 2,
    borderBottomColor: colors.primary,
    paddingVertical: 6,
    backgroundColor: colors.cardBg,
  },
  tableCol1: { width: '50%', paddingRight: 8 },
  tableCol2: { width: '50%', paddingLeft: 8 },
  contactLine: {
    flexDirection: 'row',
    marginBottom: 4,
    alignItems: 'center',
  },
  contactLabel: {
    width: 90,
    fontSize: 9,
    color: colors.textSecondary,
  },
  contactValue: {
    fontSize: 10,
    color: colors.text,
  },
  postCard: {
    backgroundColor: colors.cardBg,
    padding: 10,
    borderRadius: 6,
    marginBottom: 10,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  bulletList: {
    marginLeft: 12,
    marginBottom: 6,
  },
  bulletItem: {
    fontSize: 9,
    color: colors.text,
    lineHeight: 1.4,
    marginBottom: 2,
  },
  footerText: {
    fontSize: 8,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 20,
  },
  scoreBadge: {
    backgroundColor: colors.gold,
    color: '#1a1a1a',
    padding: '6 12',
    borderRadius: 20,
    fontSize: 10,
    fontWeight: 'bold',
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
})

function formatShortNum(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.', ',') + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace('.', ',') + 'k'
  return n.toLocaleString('pt-BR')
}

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

export interface MediaKitData {
  profile: ProfileItem | null
  posts: PostItem[]
  activation: ProfileActivation | null
  reportInsights: ReportInsights | null
  /** Data URL da foto do perfil (para evitar CORS no PDF) */
  profilePicDataUrl?: string | null
}

export function MediaKitDocument({ profile, posts, activation, reportInsights, profilePicDataUrl }: MediaKitData) {
  const userData = profile?.data?.user as Record<string, unknown> | undefined
  const displayHandle = (profile?.handle ?? profile?.username ?? profile?.key ?? '') as string
  const fullName = (profile?.full_name ?? (userData?.full_name != null ? String(userData.full_name) : undefined)) as string | undefined
  const followersCount = typeof profile?.followers_count === 'number'
    ? profile.followers_count
    : (typeof userData?.follower_count === 'number' ? userData.follower_count : 0)
  const followingCount = typeof profile?.following_count === 'number' ? profile.following_count : 0
  const mediaCount = typeof profile?.media_count === 'number' ? profile.media_count : posts.length
  const bio = (profile?.biography ?? userData?.biography) as string | undefined
  const categories = (Array.isArray(profile?.categories) ? profile.categories : []) as string[]

  const engagement = reportInsights?.engagement ?? {
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
  const tierLabel = followersCount < 10_000 ? 'Nano Influencer' : followersCount < 50_000 ? 'Micro Influencer' : followersCount < 500_000 ? 'Mid Influencer' : 'Macro Influencer'
  const score = reportInsights?.score?.total ?? 0
  const scoreSelo = reportInsights?.score?.selo ?? 'Alto Engajamento'
  const topPosts = reportInsights?.topPosts?.byInteractions ?? []
  const resumoExecutivo = reportInsights?.resumoExecutivo ?? []

  return (
    <Document>
      {/* ——— Capa ——— */}
      <Page size="A4" style={styles.coverPage}>
        <Text style={styles.coverTitle}>MEDIA KIT</Text>
        <Text style={styles.coverSubtitle}>Perfil profissional para marcas e parcerias</Text>
        {profilePicDataUrl && (
          <Image src={profilePicDataUrl} style={styles.coverAvatar} />
        )}
        <Text style={styles.coverName}>{fullName || displayHandle || 'Influencer'}</Text>
        <Text style={styles.coverHandle}>@{String(displayHandle).replace(/^@/, '')}</Text>
        <Text style={styles.coverTagline}>
          {tierLabel} • {scoreSelo} • Engajamento {er.toFixed(1)}%
        </Text>
      </Page>

      {/* ——— Sobre e métricas ——— */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.sectionTitle}>Sobre mim</Text>
        {bio && bio.trim() ? (
          <Text style={styles.bodyText}>{bio.trim()}</Text>
        ) : (
          <Text style={styles.bodySecondary}>Perfil no Instagram com foco em conteúdo autêntico e parcerias com marcas.</Text>
        )}
        {categories.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>
            {categories.slice(0, 8).map((cat) => (
              <Text key={cat} style={styles.tag}>{cat}</Text>
            ))}
          </View>
        )}

        <Text style={styles.sectionTitle}>Métricas do perfil</Text>
        <View style={styles.statRow}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{formatShortNum(followersCount)}</Text>
            <Text style={styles.statLabel}>Seguidores</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{formatShortNum(followingCount)}</Text>
            <Text style={styles.statLabel}>Seguindo</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{mediaCount}</Text>
            <Text style={styles.statLabel}>Posts</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{er.toFixed(1)}%</Text>
            <Text style={styles.statLabel}>Taxa de engajamento</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{postsPerWeek.toFixed(1)}</Text>
            <Text style={styles.statLabel}>Posts / semana</Text>
          </View>
          {(engagement.total_views ?? 0) > 0 && (
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{formatShortNum(engagement.avg_views ?? 0)}</Text>
              <Text style={styles.statLabel}>Média de views</Text>
            </View>
          )}
        </View>

        <View style={styles.scoreBadge}>
          ⭐ {tierLabel} — Score {score}/100 · {scoreSelo}
        </View>

        {resumoExecutivo.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Resumo executivo</Text>
            {resumoExecutivo.map((bullet, i) => (
              <Text key={i} style={styles.bulletItem}>• {bullet}</Text>
            ))}
          </>
        )}

        <Text style={styles.footerText}>
          Documento gerado automaticamente · Media Kit profissional
        </Text>
      </Page>

      {/* ——— Preços e contato (se ativação) ——— */}
      {(activation?.pricing || activation?.whatsapp || activation?.city) && (
        <Page size="A4" style={styles.page}>
          {activation?.pricing && (() => {
            const p = activation.pricing as Record<string, string | number | undefined>
            const hasAny = PRICING_FIELD_KEYS.some((k) => {
              const v = p[k as keyof typeof p]
              return v !== undefined && v !== null && String(v).trim() !== ''
            })
            if (!hasAny) return null
            return (
              <>
                <Text style={styles.sectionTitle}>Tabela de preços</Text>
                <View style={styles.table}>
                  <View style={styles.tableHeader}>
                    <Text style={[styles.tableCol1, { fontWeight: 'bold', fontSize: 9 }]}>Formato</Text>
                    <Text style={[styles.tableCol2, { fontWeight: 'bold', fontSize: 9 }]}>Valor</Text>
                  </View>
                  {PRICING_FIELD_KEYS.map((key) => {
                    const val = p[key as keyof typeof p]
                    if (val === undefined || val === null || String(val).trim() === '') return null
                    const label = (PRICING_FIELD_LABELS[key as PricingFieldKey] ?? key).replace(/^[\d\s️⃣]+\s*/, '').trim()
                    return (
                      <View key={key} style={styles.tableRow}>
                        <Text style={[styles.tableCol1, styles.bodyText]}>{label}</Text>
                        <Text style={[styles.tableCol2, styles.bodyText]}>{formatPricingValue(val)}</Text>
                      </View>
                    )
                  })}
                </View>
              </>
            )
          })()}

          <Text style={styles.sectionTitle}>Contato e localização</Text>
          {(activation.city || activation.state || activation.neighborhood || activation.country) && (
            <View style={styles.contactLine}>
              <Text style={styles.contactLabel}>Localização</Text>
              <Text style={styles.contactValue}>
                {[activation.city, activation.state, activation.neighborhood, activation.country].filter(Boolean).join(', ')}
              </Text>
            </View>
          )}
          {activation.address && (
            <View style={styles.contactLine}>
              <Text style={styles.contactLabel}>Endereço</Text>
              <Text style={styles.contactValue}>{activation.address}</Text>
            </View>
          )}
          {activation.whatsapp?.trim() && (
            <View style={styles.contactLine}>
              <Text style={styles.contactLabel}>WhatsApp</Text>
              <Text style={styles.contactValue}>{activation.whatsapp}</Text>
            </View>
          )}
          {activation.content_type?.length ? (
            <View style={{ marginTop: 8 }}>
              <Text style={styles.bodySecondary}>Tipos de conteúdo: </Text>
              <Text style={styles.bodyText}>
                {activation.content_type.map((ct) => CONTENT_TYPE_LABELS[ct] ?? ct).join(', ')}
              </Text>
            </View>
          ) : null}
          {(activation.tiktok || activation.facebook || activation.linkedin || activation.twitter || activation.websites) && (
            <View style={{ marginTop: 10 }}>
              <Text style={styles.bodySecondary}>Outras redes / sites:</Text>
              <Text style={styles.bodyText}>
                {[activation.tiktok, activation.facebook, activation.linkedin, activation.twitter, activation.websites].filter(Boolean).join(' · ')}
              </Text>
            </View>
          )}
          {activation.description?.trim() && (
            <View style={{ marginTop: 10 }}>
              <Text style={styles.bodySecondary}>Sobre parcerias:</Text>
              <Text style={styles.bodyText}>{activation.description}</Text>
            </View>
          )}
          <Text style={styles.footerText}>Documento gerado automaticamente · Media Kit profissional</Text>
        </Page>
      )}

      {/* ——— Destaques do feed ——— */}
      {topPosts.length > 0 && (
        <Page size="A4" style={styles.page}>
          <Text style={styles.sectionTitle}>Destaques do feed</Text>
          <Text style={styles.bodySecondary}>Posts com melhor desempenho (alcance e engajamento).</Text>
          {topPosts.slice(0, 6).map((item, idx) => {
            const likes = item.post.metrics?.likes ?? 0
            const comments = item.post.metrics?.comments ?? 0
            const views = item.post.metrics?.view_count
            const interactions = likes + comments
            return (
              <View key={idx} style={styles.postCard}>
                <Text style={[styles.bodyText, { fontWeight: 'bold' }]}>
                  Post #{idx + 1} — {formatShortNum(interactions)} interações
                  {views != null ? ` · ${formatShortNum(Number(views))} views` : ''}
                </Text>
                <Text style={styles.bodySecondary}>{item.oQueFuncionou}</Text>
              </View>
            )
          })}
          <Text style={styles.footerText}>Documento gerado automaticamente · Media Kit profissional</Text>
        </Page>
      )}

      {/* ——— Última página: CTA ——— */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.sectionTitle}>Vamos trabalhar juntos?</Text>
        <Text style={styles.bodyText}>
          Este Media Kit resume meu perfil, métricas e condições para parcerias. Estou aberto(a) a propostas de marcas que combinem com meu conteúdo e audiência.
        </Text>
        <View style={{ marginTop: 20 }}>
          <Text style={[styles.bodyText, { fontWeight: 'bold' }]}>{fullName || `@${displayHandle}`}</Text>
          <Text style={styles.bodySecondary}>@{String(displayHandle).replace(/^@/, '')}</Text>
          {activation?.whatsapp?.trim() && (
            <Text style={[styles.bodyText, { marginTop: 8 }]}>Contato: {activation.whatsapp}</Text>
          )}
        </View>
        <Text style={[styles.footerText, { marginTop: 40 }]}>
          Documento gerado automaticamente · Media Kit profissional · {new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
        </Text>
      </Page>
    </Document>
  )
}
