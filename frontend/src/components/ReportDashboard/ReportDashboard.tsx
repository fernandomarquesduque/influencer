/**
 * Dashboard do resultado da busca: agregações e visão que gera desejo pelo relatório.
 * Exibido após o wizard de filtros; o usuário decide aqui se quer comprar/ver a lista completa.
 */
import { Card, Typography, Button, Statistic, Space } from 'antd'
import { RocketOutlined, UnlockOutlined, CheckCircleOutlined, MinusCircleOutlined, EnvironmentOutlined, UserOutlined, DollarOutlined, ContactsOutlined } from '@ant-design/icons'
import type { ProfilesSearchQuery, ProfilesSearchFacets, ProfileListItem } from '../../api'
import { getProfilePicUrl, proxyImageUrl } from '../../api'
import './ReportDashboard.css'

const { Title, Text } = Typography

export interface ReportDashboardProps {
  /** Query aplicada (termo + filtros). */
  query: ProfilesSearchQuery
  /** Total de perfis no resultado. */
  total: number
  /** Facets da busca (categorias, engajamento, ativação, etc.). */
  facets: ProfilesSearchFacets | null
  /** Amostra de itens para preview (ex.: primeiros 6). */
  sampleItems?: ProfileListItem[]
  /** Chamado quando o usuário clica para ver a lista completa / comprar relatório. */
  onViewList: () => void
  /** Carregando dados do dashboard. */
  loading?: boolean
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toLocaleString('pt-BR')
}

/** Primeiro nome para exibição: usa full_name quando existir, senão handle sem @ com inicial maiúscula. */
function getDisplayFirstName(item: { full_name?: string; handle: string }): string {
  const name = (item.full_name ?? '').trim()
  if (name) {
    const first = name.split(/\s+/)[0]
    if (first) return first
  }
  const handle = (item.handle ?? '').replace(/^@/, '').trim()
  if (!handle) return ''
  return handle.charAt(0).toUpperCase() + handle.slice(1).toLowerCase()
}

export default function ReportDashboard({
  query,
  total,
  facets,
  sampleItems = [],
  onViewList,
  loading = false,
}: ReportDashboardProps) {
  const engagementRate = facets?.engagement_rate ?? []
  const activation = facets?.activation

  const cities = facets?.cities ?? []
  const states = facets?.states ?? []
  const neighborhoods = facets?.neighborhoods ?? []
  const countWithLocation = cities.reduce((s, c) => s + c.count, 0) || states.reduce((s, c) => s + c.count, 0) || neighborhoods.reduce((s, c) => s + c.count, 0)
  const hasLocation = countWithLocation > 0
  const hasActivation = (activation?.activated ?? 0) > 0
  const activatedCount = activation?.activated ?? 0
  const social = facets?.social
  const countWithSocial = social ? Math.max(social.whatsapp, social.tiktok, social.facebook, social.linkedin, social.twitter) : 0
  const hasSocial = countWithSocial > 0
  const pricing = facets?.pricing
  const hasPricing = pricing && Object.values(pricing).some((arr) => Array.isArray(arr) && arr.length > 0)
  const countWithPricing = hasPricing ? activatedCount : 0

  const reportIncludes = [
    { icon: <EnvironmentOutlined />, label: 'Localização (cidade, estado, bairro) quando preenchida', count: countWithLocation, has: hasLocation },
    { icon: <UserOutlined />, label: 'Tipo de perfil (pessoal, criador, empresa)', count: total, has: true },
    { icon: <UnlockOutlined />, label: 'Dados de ativação salvos (preços, tipo de conteúdo)', count: activatedCount, has: hasActivation },
    { icon: <DollarOutlined />, label: 'Faixas de preço (Feed, Reels, story, Destaque)', count: countWithPricing, has: !!hasPricing },
    { icon: <ContactsOutlined />, label: 'Contatos e redes (WhatsApp, TikTok, Facebook, etc.)', count: countWithSocial, has: !!hasSocial },
  ]

  return (
    <div className="report-dashboard">
      <div className="report-dashboard-hero">
        <Title level={1} className="report-dashboard-title">
          Seu relatório está pronto
        </Title>
        <Text type="secondary" className="report-dashboard-subtitle">
          {query.q ? `Busca: "${query.q}"` : 'Filtros aplicados'} · Resumo do que encontramos
        </Text>
        <Statistic
          title="Total de perfis no resultado"
          value={total}
          formatter={(v) => formatNumber(Number(v))}
          className="report-dashboard-total"
        />
        {engagementRate.some((b) => (b.count ?? 0) > 0) && (
          <div className="report-dashboard-hero-engagement">
            <Text type="secondary" className="report-dashboard-hero-engagement-title">
              Por nível de engajamento
            </Text>
            <div className="report-dashboard-hero-engagement-list">
              {engagementRate
                .filter((bucket) => (bucket.count ?? 0) > 0)
                .map((bucket, i) => (
                  <span key={bucket.key ?? bucket.label} className="report-dashboard-hero-engagement-item">
                    {i > 0 && <span className="report-dashboard-hero-engagement-sep"> · </span>}
                    <Text>{bucket.label ?? bucket.key}</Text>
                    <Text strong>{formatNumber(bucket.count)}</Text>
                  </span>
                ))}
            </div>
          </div>
        )}
        <Button
          type="primary"
          size="large"
          onClick={onViewList}
          loading={loading}
          className="report-dashboard-cta"
          icon={<RocketOutlined />}
        >
          Ver lista completa e acessar relatório
        </Button>
      </div>

      <Card title="O que o relatório contém" className="report-dashboard-card report-dashboard-includes">
        <p style={{ marginBottom: 16, color: 'var(--colorTextSecondary)' }}>
          As informações abaixo estão disponíveis nos perfis deste resultado (quando preenchidas na ativação ou no perfil):
        </p>
        <ul className="report-dashboard-includes-list">
          {reportIncludes.map((item) => (
            <li key={item.label} className={item.has ? 'report-dashboard-includes-item' : 'report-dashboard-includes-item muted'}>
              {item.has ? (
                <CheckCircleOutlined className="report-dashboard-includes-icon" />
              ) : (
                <MinusCircleOutlined className="report-dashboard-includes-icon" />
              )}
              <div className="report-dashboard-includes-content">
                <Space size="small">
                  {item.icon}
                  <Text>{item.label}</Text>
                  {!item.has && <Text type="secondary">(não disponível neste resultado)</Text>}
                </Space>
                {item.has && item.count > 0 && (
                  <Text strong className="report-dashboard-includes-count">
                    {item.count.toLocaleString('pt-BR')} perfil{item.count !== 1 ? 's' : ''}
                  </Text>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {sampleItems.length > 0 && (
        <div className="report-dashboard-preview">
          <Title level={4}>Prévia de alguns perfis</Title>
          <div className="report-dashboard-preview-grid">
            {sampleItems.slice(0, 6).map((item) => (
              <div key={item.key} className="report-dashboard-preview-card">
                <div
                  className="report-dashboard-preview-avatar"
                  style={{
                    backgroundImage: `url(${proxyImageUrl(getProfilePicUrl(item)) || ''})`,
                  }}
                />
                <Text strong className="report-dashboard-preview-handle">
                  {getDisplayFirstName(item)}
                </Text>
                {item.followers_count != null && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {formatNumber(item.followers_count)} seguidores
                  </Text>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="report-dashboard-cta-bottom">
        <Button
          type="primary"
          size="large"
          onClick={onViewList}
          loading={loading}
          icon={<RocketOutlined />}
        >
          Ver lista completa e acessar relatório
        </Button>
      </div>
    </div>
  )
}
