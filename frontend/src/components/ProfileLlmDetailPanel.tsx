/**
 * Painel com a classificação LLM do perfil (qualify) na página de detalhe.
 */
import type { ReactNode } from 'react'
import { Card, Descriptions, Space, Tag, Typography, Alert } from 'antd'
import { BulbOutlined } from '@ant-design/icons'
import type { ProfileItem, ProfileListItem } from '../api'
import { getLlmQualification } from '../utils/mapProfileListToPreviewItems'
import {
  campaignLlmBadgeStyles,
  getLlmContentPillarLabels,
  getLlmGenderBadge,
  getLlmMainCategoryLabel,
  getLlmProfileTypeBadge,
  type LlmQualificationBadge,
} from '../utils/campaignLlmBadges'

const { Text, Paragraph } = Typography

function formatBrandSafety(raw: string): string {
  const s = raw.trim().toLowerCase()
  if (s === 'familia' || s === 'família') return 'Família (adequado para marcas sensíveis)'
  if (s === 'sensivel' || s === 'sensível') return 'Sensível'
  if (s === 'adulto') return 'Adulto'
  return raw.trim() || '—'
}

function formatLanguage(raw: string): string {
  const s = raw.trim().toLowerCase()
  const map: Record<string, string> = {
    'pt-br': 'Português (BR)',
    pt: 'Português',
    en: 'Inglês',
    es: 'Espanhol',
    uk: 'Ucraniano',
    ru: 'Russo',
    desconhecido: 'Desconhecido',
  }
  return (map[s] ?? raw.trim()) || '—'
}

function strList(arr: unknown): string[] {
  if (!Array.isArray(arr)) return []
  const out: string[] = []
  for (const x of arr) {
    if (typeof x !== 'string') continue
    const t = x.trim()
    if (t && t !== '-') out.push(t)
  }
  return out
}

function formatConfidence(n: unknown): string | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null
  const pct = Math.round(Math.max(0, Math.min(1, n)) * 100)
  return `${pct}%`
}

function renderLlmBadge(b: LlmQualificationBadge) {
  const st = campaignLlmBadgeStyles(b.text)
  return (
    <span className="profile-llm-panel-badge" title={b.title} style={{ ...st, borderRadius: 6, padding: '2px 8px', fontSize: 12, fontWeight: 600, display: 'inline-block' }}>
      {b.text}
    </span>
  )
}

export interface ProfileLlmDetailPanelProps {
  profile: ProfileItem | null | undefined
  /** Dentro do card do hero: sem Card próprio, só uma faixa com borda superior. */
  variant?: 'card' | 'embedded'
}

function LlmPanelFrame({ embedded, children }: { embedded: boolean; children: ReactNode }) {
  if (embedded) {
    return (
      <div
        className="profile-llm-detail-panel profile-llm-detail-panel--embedded"
        style={{
          width: '100%',
          marginTop: 8,
        }}
      >
        {children}
      </div>
    )
  }
  return (
    <Card size="small" className="profile-llm-detail-panel" styles={{ body: { padding: 16 } }}>
      {children}
    </Card>
  )
}

export function ProfileLlmDetailPanel({ profile, variant = 'card' }: ProfileLlmDetailPanelProps) {
  const rec = profile as Record<string, unknown> | undefined
  const llmRaw = rec?.llm
  const embedded = variant === 'embedded'

  if (embedded && (llmRaw == null || typeof llmRaw !== 'object' || Array.isArray(llmRaw))) {
    return null
  }

  if (llmRaw == null || typeof llmRaw !== 'object' || Array.isArray(llmRaw)) {
    return (
      <LlmPanelFrame embedded={false}>
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Text strong style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <BulbOutlined style={{ color: 'var(--app-primary, #722ed1)' }} />
            Classificação por IA
          </Text>
          <Text type="secondary">Ainda não há análise automática deste perfil nos nossos dados.</Text>
        </Space>
      </LlmPanelFrame>
    )
  }

  const lo = llmRaw as Record<string, unknown>
  const status = String(lo.status ?? '').trim().toLowerCase()
  const qRaw = lo.qualification
  const q =
    qRaw != null && typeof qRaw === 'object' && !Array.isArray(qRaw) ? (qRaw as Record<string, unknown>) : null

  const qualifiedAt = typeof lo.qualifiedAt === 'string' ? lo.qualifiedAt : null
  const model = typeof lo.model === 'string' ? lo.model.trim() : null
  const confStr = formatConfidence(lo.confidence)

  const itemForBadges =
    profile && q
      ? ({ ...(profile as unknown as ProfileListItem), llm: { ...lo, status: 'done', qualification: q } } as ProfileListItem)
      : null

  const profileTypeBadge = itemForBadges ? getLlmProfileTypeBadge(itemForBadges) : null
  const genderBadge = itemForBadges ? getLlmGenderBadge(itemForBadges) : null
  const mainCatLabel = itemForBadges ? getLlmMainCategoryLabel(itemForBadges) : null
  const pillarLabels = itemForBadges ? getLlmContentPillarLabels(itemForBadges) : []

  const doneQual = getLlmQualification(rec ?? {})
  const personaSummary = q ? String(q.personaSummary ?? '').trim() : ''
  const subCategories = q ? strList(q.subCategories) : []
  const audienceType = q ? strList(q.audienceType) : []
  const toneRaw = q?.toneOfVoice
  const toneOfVoice =
    q == null
      ? []
      : Array.isArray(toneRaw)
        ? strList(toneRaw)
        : typeof toneRaw === 'string' && toneRaw.trim()
          ? [toneRaw.trim()]
          : []
  const language = q ? String(q.language ?? '').trim() : ''
  const brandSafety = q ? String(q.brandSafety ?? '').trim() : ''
  const riskLevel = q ? String((q as Record<string, unknown>).riskLevel ?? '').trim() : ''

  const hasBody =
    Boolean(doneQual || (q && Object.keys(q).length > 0 && (personaSummary || mainCatLabel || subCategories.length)))

  if (!hasBody && (status === 'pending' || status === 'processing' || status === '')) {
    return (
      <LlmPanelFrame embedded={embedded}>
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Text strong style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <BulbOutlined style={{ color: 'var(--app-primary, #722ed1)' }} />
            Classificação por IA
          </Text>
          <Text type="secondary">Análise em andamento ou ainda não disponível para este perfil.</Text>
        </Space>
      </LlmPanelFrame>
    )
  }

  if (!hasBody) {
    return (
      <LlmPanelFrame embedded={embedded}>
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Text strong style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <BulbOutlined style={{ color: 'var(--app-primary, #722ed1)' }} />
            Classificação por IA
          </Text>
          <Text type="secondary">Há registro de análise, mas sem campos legíveis para exibir.</Text>
        </Space>
      </LlmPanelFrame>
    )
  }

  return (
    <LlmPanelFrame embedded={embedded}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>


        {status === 'insufficient_data' && (
          <Alert type="warning" showIcon message="Dados insuficientes" description="A classificação foi feita com pouca informação pública (ex.: bio muito vaga). Use os campos abaixo como orientação, não como veredito final." />
        )}

        {profileTypeBadge || genderBadge || mainCatLabel || pillarLabels.length > 0 ? (
          <Space wrap size={[6, 6]}>
            {profileTypeBadge ? renderLlmBadge(profileTypeBadge) : null}
            {genderBadge ? renderLlmBadge(genderBadge) : null}
            {mainCatLabel ? (
              <span style={{ ...campaignLlmBadgeStyles(mainCatLabel), borderRadius: 6, padding: '2px 8px', fontSize: 12, fontWeight: 600 }} title="Categoria principal">
                {mainCatLabel}
              </span>
            ) : null}
            {pillarLabels.map((p) => (
              <span key={p} style={{ ...campaignLlmBadgeStyles(p), borderRadius: 6, padding: '2px 8px', fontSize: 12, fontWeight: 600 }} title="Pilar de conteúdo">
                {p}
              </span>
            ))}
          </Space>
        ) : null}

        {personaSummary ? (
          <div>

            <Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>{personaSummary}</Paragraph>
          </div>
        ) : null}
        {audienceType.length > 0 ? (
          <Descriptions.Item label="Público-alvo">
            <Text type="secondary" style={{ marginRight: 12 }}>Público-alvo do perfil</Text>
            <Space wrap size={[4, 4]}>{audienceType.map((t) => <Tag key={t}>{t}</Tag>)}</Space>
          </Descriptions.Item>
        ) : null}
      </Space>
    </LlmPanelFrame>
  )
}
