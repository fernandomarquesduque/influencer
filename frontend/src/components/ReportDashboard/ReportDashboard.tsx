import { Card, Typography, Button, Progress } from 'antd'
import { RocketOutlined, ArrowLeftOutlined } from '@ant-design/icons'
import type { ProfilesSearchQuery, ProfilesSearchFacets } from '../../api'
import InfluencerPreviewTable from '../InfluencerPreviewTable/InfluencerPreviewTable'
import { formatFacetLabel } from '../../utils/facetLabels'
import './ReportDashboard.css'

const { Title, Text } = Typography

export interface ReportDashboardProps {
  query: ProfilesSearchQuery
  total: number
  facets: ProfilesSearchFacets | null
  onViewList: () => void
  onBack?: () => void
  loading?: boolean
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toLocaleString('pt-BR')
}

function topItems(arr: { name: string; count: number }[] | undefined, n = 6): { name: string; count: number }[] {
  if (!arr?.length) return []
  return [...arr]
    .filter((x) => (x.count ?? 0) > 0 && x.name?.trim())
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
    .slice(0, n)
}

function asPercent(count: number, total: number): number {
  if (total <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((count / total) * 100)))
}

function levelCount(items: { name: string; count: number }[], level: 'familia' | 'sensivel' | 'adulto'): number {
  return items.find((x) => x.name.trim().toLowerCase() === level)?.count ?? 0
}

const AUDIENCE_RING_STROKES: Array<string | { '0%': string; '100%': string }> = [
  { '0%': '#8b82ff', '100%': '#5b4dff' },
  { '0%': '#6ba3f5', '100%': '#3d6fd4' },
  { '0%': '#d27ee8', '100%': '#9d4fbf' },
  { '0%': '#4ed4b3', '100%': '#2aa88a' },
]

export default function ReportDashboard({
  query,
  total,
  facets,
  onViewList,
  onBack,
  loading = false,
}: ReportDashboardProps) {
  const llm = facets?.llm
  const mainCategory = topItems(llm?.mainCategory, 4)
  const showMainCategories = mainCategory.length > 0
  const audiences = topItems(llm?.audienceType, 4)
  const brandSafety = topItems(llm?.brandSafety?.level, 3)
  const familyCount = levelCount(brandSafety, 'familia')
  const sensitiveCount = levelCount(brandSafety, 'sensivel')
  const adultCount = levelCount(brandSafety, 'adulto')

  return (
    <div className="rdv2">
      <div className="rdv2-content">
        <div className="rdv2-left-col">
          {onBack && (
            <div className="rdv2-top-actions">
              <Button onClick={onBack} icon={<ArrowLeftOutlined />}>
                Ajustar filtros
              </Button>
            </div>
          )}

          <section className="rdv2-hero">
            <div className="rdv2-head">
              <div>
                <Text className="rdv2-kicker">Relatorio de Influencers</Text>
                <Title level={1} className="rdv2-head-title">
                  <span className="rdv2-head-count">{formatNumber(total)}</span>
                  <span className="rdv2-head-label"> perfis</span>
                </Title>
                <div className="rdv2-safety-strip rdv2-safety-strip--compact">
                  <div className="rdv2-safety-item safe">
                    <span>Familia</span>
                    <strong>{asPercent(familyCount, total)}%</strong>
                  </div>
                  <div className="rdv2-safety-item warning">
                    <span>Sensivel</span>
                    <strong>{asPercent(sensitiveCount, total)}%</strong>
                  </div>
                  <div className="rdv2-safety-item danger">
                    <span>Adulto</span>
                    <strong>{asPercent(adultCount, total)}%</strong>
                  </div>
                </div>
                <div className="rdv2-cta-row">
                  <Button
                    type="primary"
                    size="large"
                    block
                    onClick={onViewList}
                    loading={loading}
                    icon={<RocketOutlined />}
                    className="rdv2-primary"
                  >
                    Abrir lista completa
                  </Button>
                </div>
              </div>
            </div>
          </section>

          <section className="rdv2-grid rdv2-grid-top">
            <div className="rdv2-audience-section">
              <Text className="rdv2-audience-section-title">Público alvo</Text>
              {audiences.length === 0 ? (
                <Text type="secondary">Sem dados de público neste recorte.</Text>
              ) : (
                <div className="rdv2-audience-cards">
                  {audiences.map((item, index) => {
                    const pct = asPercent(item.count, total)
                    const stroke = AUDIENCE_RING_STROKES[index % AUDIENCE_RING_STROKES.length]
                    return (
                      <div key={`aud-${item.name}`} className="rdv2-audience-card">
                        <div className="rdv2-audience-card-chart">
                          <Progress
                            type="circle"
                            percent={pct}
                            width={64}
                            strokeWidth={7}
                            strokeColor={stroke}
                            trailColor="#eeeffa"
                            format={(p) => `${p ?? 0}%`}
                          />
                        </div>
                        <div className="rdv2-audience-card-label">
                          <span>{formatFacetLabel(item.name)}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

                        <Card className="rdv2-card rdv2-card--categories" title="Categorias">
              {!showMainCategories && (
                <Text type="secondary">Sem dados de categorias neste recorte.</Text>
              )}
              {showMainCategories && (
                <div className="rdv2-facet-block">
                  <Text className="rdv2-facet-section-title">Categoria principal</Text>
                  {mainCategory.map((item) => {
                    const pct = asPercent(item.count, total)
                    return (
                      <div key={`main-cat-${item.name}`} className="rdv2-row">
                        <div className="rdv2-row-label">
                          <span>{formatFacetLabel(item.name)}</span>
                          <b>{pct}%</b>
                        </div>
                        <div className="rdv2-bar">
                          <i style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </Card>
          </section>
        </div>

        <aside className="rdv2-right-col">
          <InfluencerPreviewTable query={query} loading={loading} limit={5} onViewMore={onViewList} />
        </aside>
      </div>

    </div>
  )
}
