/**
 * Painel com a classificação LLM do perfil (qualify) na página de detalhe.
 */
import type { ReactNode } from 'react'
import { Card, Space, Typography, Alert } from 'antd'
import { BulbOutlined, UserOutlined, TagOutlined, TeamOutlined } from '@ant-design/icons'
import type { ProfileItem, ProfileListItem } from '../api'
import { getLlmQualification } from '../utils/mapProfileListToPreviewItems'
import {
  campaignLlmBadgeStyles,
  getLlmGenderBadge,
  getLlmMainCategoryLabel,
  getLlmProfileTypeBadge,
  type LlmQualificationBadge,
} from '../utils/campaignLlmBadges'
import { HeroInfoStrip, type HeroInfoStripItem } from './HeroInfoStrip'

const { Text, Paragraph } = Typography

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

function llmStripItem(
  key: string,
  value: string,
  label: string,
  icon: ReactNode,
  tooltip?: string,
): HeroInfoStripItem {
  const st = campaignLlmBadgeStyles(value)
  return {
    key,
    value,
    label,
    icon,
    iconBg: st.background,
    iconFg: st.color,
    tooltip,
  }
}

function buildLlmHeroStripItems(
  profileTypeBadge: LlmQualificationBadge | null,
  genderBadge: LlmQualificationBadge | null,
  mainCatLabel: string | null,
  audienceType: string[],
): HeroInfoStripItem[] {
  const items: HeroInfoStripItem[] = []
  if (profileTypeBadge) {
    items.push(llmStripItem('profileType', profileTypeBadge.text, 'Tipo de perfil', <UserOutlined />, profileTypeBadge.title))
  }
  if (genderBadge) {
    items.push(llmStripItem('gender', genderBadge.text, 'Gênero', <UserOutlined />, genderBadge.title))
  }
  if (mainCatLabel) {
    items.push(llmStripItem('mainCategory', mainCatLabel, 'Categoria', <TagOutlined />, 'Categoria principal'))
  }
  if (audienceType.length > 0) {
    items.push(
      llmStripItem(
        'audience',
        audienceType.join(', '),
        'Público-alvo',
        <TeamOutlined />,
        'Público-alvo do perfil',
      ),
    )
  }
  return items
}

export interface ProfileLlmDetailPanelProps {
  profile: ProfileItem | null | undefined
  /** Faixa sem Card próprio (ex.: abaixo do hero do perfil). */
  variant?: 'card' | 'embedded'
  isMobile?: boolean
  /** Quando a categoria já aparece no hero, omitir o cartão duplicado na faixa. */
  hideMainCategoryInStrip?: boolean
  /** Densidade da faixa de badges (ex.: modal compacto). */
  stripDensity?: 'default' | 'compact'
}

function LlmPanelFrame({ embedded, children }: { embedded: boolean; children: ReactNode }) {
  if (embedded) {
    return (
      <div
        className="profile-llm-detail-panel profile-llm-detail-panel--embedded"
        style={{
          width: '100%',
          marginTop: 0,
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

export function ProfileLlmDetailPanel({
  profile,
  variant = 'card',
  isMobile = false,
  hideMainCategoryInStrip = false,
  stripDensity,
}: ProfileLlmDetailPanelProps) {
  const stripDensityResolved = stripDensity ?? (isMobile ? 'compact' : 'default')
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

  const itemForBadges =
    profile && q
      ? ({ ...(profile as unknown as ProfileListItem), llm: { ...lo, status: 'done', qualification: q } } as ProfileListItem)
      : null

  const profileTypeBadge = itemForBadges ? getLlmProfileTypeBadge(itemForBadges) : null
  const genderBadge = itemForBadges ? getLlmGenderBadge(itemForBadges) : null
  const mainCatLabel = itemForBadges ? getLlmMainCategoryLabel(itemForBadges) : null

  const doneQual = getLlmQualification(rec ?? {})
  const personaSummary = q ? String(q.personaSummary ?? '').trim() : ''
  const subCategories = q ? strList(q.subCategories) : []
  const audienceType = q ? strList(q.audienceType) : []

  const stripItems = buildLlmHeroStripItems(
    profileTypeBadge,
    genderBadge,
    hideMainCategoryInStrip ? null : mainCatLabel,
    audienceType,
  )

  const hasBody = Boolean(
    doneQual ||
      stripItems.length > 0 ||
      (q && Object.keys(q).length > 0 && (personaSummary || mainCatLabel || subCategories.length)),
  )

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

  if (embedded) {
    return (
      <LlmPanelFrame embedded>
        {status === 'insufficient_data' ? (
          <Alert
            type="warning"
            showIcon
            message="Dados insuficientes"
            description="A classificação foi feita com pouca informação pública (ex.: bio muito vaga). Use os campos abaixo como orientação, não como veredito final."
            style={{ marginBottom: 8 }}
          />
        ) : null}
        <HeroInfoStrip
          className="profile-llm-hero-strip"
          items={stripItems}
          isMobile={isMobile}
          stackOnMobile
          fullWidth
          density={stripDensityResolved}
          marginTop={0}
          marginBottom={0}
        />
      </LlmPanelFrame>
    )
  }

  return (
    <LlmPanelFrame embedded={false}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        {status === 'insufficient_data' && (
          <Alert type="warning" showIcon message="Dados insuficientes" description="A classificação foi feita com pouca informação pública (ex.: bio muito vaga). Use os campos abaixo como orientação, não como veredito final." />
        )}

        {stripItems.length > 0 ? (
          <HeroInfoStrip
            className="profile-llm-hero-strip"
            items={stripItems}
            isMobile={isMobile}
            stackOnMobile
            density={stripDensityResolved}
          />
        ) : null}

        {personaSummary ? (
          <div>
            <Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>{personaSummary}</Paragraph>
          </div>
        ) : null}
      </Space>
    </LlmPanelFrame>
  )
}
