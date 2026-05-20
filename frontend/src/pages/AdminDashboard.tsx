import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Space, Table, Typography, message } from 'antd'
import {
  ReloadOutlined,
  PrinterOutlined,
  DatabaseOutlined,
  TeamOutlined,
  ClockCircleOutlined,
  SafetyCertificateOutlined,
  ShopOutlined,
  ApiOutlined,
} from '@ant-design/icons'
import { useAuth } from '../contexts/AuthContext'
import { fetchAdminDashboardStats, type AdminDashboardStats } from '../api'
import './AdminDashboard.css'

const TABLE_LABELS: Record<string, string> = {
  auth_user: 'Contas de acesso',
  auth_profile_verification: 'Verificações de perfil pendentes',
  profile_activation: 'Cadastros / ativações de influenciador',
  campaign: 'Campanhas (relatórios)',
  user_credits: 'Registros de saldo de créditos',
  credit_transaction: 'Movimentações de crédito',
  payment: 'Pagamentos',
  direct_queue: 'Fila de Direct',
  user_favorite: 'Favoritos',
  message_templates: 'Templates de mensagem',
  project: 'Projetos (anúncios)',
  project_application: 'Candidaturas a projetos',
}

const SQLITE_GROUPS: {
  id: string
  title: string
  subtitle: string
  dot: string
  keys: readonly string[]
}[] = [
    {
      id: 'access',
      title: 'Contas e verificação',
      subtitle: 'Login, escopos e códigos pendentes',
      dot: '#6366f1',
      keys: ['auth_user', 'auth_profile_verification'],
    },
    {
      id: 'influencer',
      title: 'Cadastro na plataforma',
      subtitle: 'Perfis com formulário de ativação',
      dot: '#8b5cf6',
      keys: ['profile_activation'],
    },
    {
      id: 'commerce',
      title: 'Campanhas, créditos e pagamentos',
      subtitle: 'Relatórios comprados e fluxo financeiro',
      dot: '#ec4899',
      keys: ['campaign', 'user_credits', 'credit_transaction', 'payment'],
    },
    {
      id: 'ops',
      title: 'Operação e projetos',
      subtitle: 'Fila, favoritos, templates e anúncios',
      dot: '#14b8a6',
      keys: ['direct_queue', 'user_favorite', 'message_templates', 'project', 'project_application'],
    },
  ]

const SCOPE_STYLES: Record<string, { label: string; bg: string; border: string; color: string }> = {
  adm: {
    label: 'Administrador',
    bg: 'rgba(244, 63, 94, 0.12)',
    border: 'rgba(244, 63, 94, 0.35)',
    color: '#e11d48',
  },
  assinante: {
    label: 'Assinante',
    bg: 'rgba(99, 102, 241, 0.12)',
    border: 'rgba(99, 102, 241, 0.35)',
    color: '#4f46e5',
  },
  influencer: {
    label: 'Influenciador',
    bg: 'rgba(16, 185, 129, 0.12)',
    border: 'rgba(16, 185, 129, 0.35)',
    color: '#059669',
  },
  public: {
    label: 'Público',
    bg: 'rgba(245, 158, 11, 0.14)',
    border: 'rgba(245, 158, 11, 0.4)',
    color: '#d97706',
  },
}

const PAYMENT_STATUS_STYLE: Record<string, { bg: string; border: string; color: string }> = {
  paid: { bg: 'rgba(34, 197, 94, 0.12)', border: 'rgba(34, 197, 94, 0.4)', color: '#16a34a' },
  pending: { bg: 'rgba(245, 158, 11, 0.14)', border: 'rgba(245, 158, 11, 0.45)', color: '#d97706' },
}

const ASAAS_STATUS_STYLE: Record<string, { bg: string; border: string; color: string }> = {
  PENDING: { bg: 'rgba(245, 158, 11, 0.14)', border: 'rgba(245, 158, 11, 0.45)', color: '#d97706' },
  RECEIVED: { bg: 'rgba(34, 197, 94, 0.12)', border: 'rgba(34, 197, 94, 0.4)', color: '#16a34a' },
  CONFIRMED: { bg: 'rgba(34, 197, 94, 0.12)', border: 'rgba(34, 197, 94, 0.4)', color: '#15803d' },
  OVERDUE: { bg: 'rgba(239, 68, 68, 0.12)', border: 'rgba(239, 68, 68, 0.4)', color: '#dc2626' },
  REFUNDED: { bg: 'rgba(100, 116, 139, 0.12)', border: 'rgba(100, 116, 139, 0.35)', color: '#64748b' },
  FAILED: { bg: 'rgba(239, 68, 68, 0.12)', border: 'rgba(239, 68, 68, 0.4)', color: '#b91c1c' },
  CANCELLED: { bg: 'rgba(100, 116, 139, 0.12)', border: 'rgba(100, 116, 139, 0.35)', color: '#475569' },
}

function formatInt(n: number): string {
  return n.toLocaleString('pt-BR')
}

function defaultChipStyle() {
  return { bg: 'var(--app-primary-muted)', border: 'var(--app-border)', color: 'var(--app-primary)' }
}

export default function AdminDashboard() {
  const navigate = useNavigate()
  const { isAdm } = useAuth()
  const [stats, setStats] = useState<AdminDashboardStats | null>(null)
  const [loading, setLoading] = useState(true)

  const handlePrint = useCallback(() => {
    document.documentElement.classList.add('print-admin-dashboard')
    let fallbackTimer: number | undefined
    const done = () => {
      document.documentElement.classList.remove('print-admin-dashboard')
      window.removeEventListener('afterprint', done)
      if (fallbackTimer != null) clearTimeout(fallbackTimer)
    }
    window.addEventListener('afterprint', done)
    fallbackTimer = window.setTimeout(done, 4000)
    window.print()
  }, [])

  const load = useCallback(async (fresh?: boolean) => {
    setLoading(true)
    try {
      const data = await fetchAdminDashboardStats(fresh ? { fresh: true } : undefined)
      setStats(data)
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Erro ao carregar painel')
      setStats(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isAdm) return
    let cancelled = false
    setLoading(true)
      ; (async () => {
        try {
          const data = await fetchAdminDashboardStats()
          if (!cancelled) setStats(data)
        } catch (e) {
          if (!cancelled) {
            message.error(e instanceof Error ? e.message : 'Erro ao carregar painel')
            setStats(null)
          }
        } finally {
          if (!cancelled) setLoading(false)
        }
      })()
    return () => {
      cancelled = true
    }
  }, [isAdm])

  const tableRowsByKey = useMemo(() => {
    if (!stats) return new Map<string, { key: string; name: string; count: number }>()
    const m = new Map<string, { key: string; name: string; count: number }>()
    for (const [k, count] of Object.entries(stats.sqlite.tables)) {
      m.set(k, { key: k, name: TABLE_LABELS[k] ?? k, count })
    }
    return m
  }, [stats])

  if (!isAdm) {
    return (
      <div className="admin-dashboard">
        <div className="admin-dashboard__panel">
          <div className="admin-dashboard__panel-body" style={{ padding: '10px 12px' }}>
            <Typography.Text type="danger">Acesso negado. Apenas administradores.</Typography.Text>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="admin-dashboard">
      <div className="admin-dashboard__top">
        <div className="admin-dashboard__title-block">
          <h1>Painel administrativo</h1>
          <p>Visão da base — RocksDB e SQLite.</p>
        </div>
        <Space className="admin-dashboard__no-print" wrap size="small">
          <Button type="primary" icon={<ReloadOutlined />} onClick={() => load(true)} loading={loading}>
            Atualizar
          </Button>
          <Button icon={<PrinterOutlined />} onClick={handlePrint}>
            Imprimir
          </Button>
          <Button onClick={() => navigate('/app/admin/reports/unregistered-mentions')}>
            Relatório @ não cadastrados
          </Button>
        </Space>
      </div>

      {!stats?.sqlite.available && !loading && (
        <div className="admin-dashboard__warn">
          SQLite não encontrado neste ambiente — só os totais do RocksDB abaixo são confiáveis aqui.
        </div>
      )}

      {/* RocksDB */}
      <section className="admin-dashboard__section" aria-labelledby="adm-section-rocksdb">

        <div className="admin-dashboard__stat-row">
          <div className="admin-dashboard__stat-tile admin-dashboard__stat-tile--profiles">
            <TeamOutlined className="admin-dashboard__stat-icon" />
            <div className="admin-dashboard__stat-label">Perfis na base</div>
            <div className="admin-dashboard__stat-value">
              {loading ? '…' : formatInt(stats?.rocksdb.profiles ?? 0)}
            </div>
          </div>
          <div className="admin-dashboard__stat-tile admin-dashboard__stat-tile--posts">
            <DatabaseOutlined className="admin-dashboard__stat-icon" />
            <div className="admin-dashboard__stat-label">Posts armazenados</div>
            <div className="admin-dashboard__stat-value">
              {loading ? '…' : formatInt(stats?.rocksdb.posts ?? 0)}
            </div>
          </div>
          <div className="admin-dashboard__stat-tile admin-dashboard__stat-tile--meta">
            <ClockCircleOutlined className="admin-dashboard__stat-icon" />
            <div className="admin-dashboard__stat-label">Snapshot</div>
            <div className="admin-dashboard__stat-value" style={{ fontSize: '1.05rem', fontWeight: 700 }}>
              {stats ? new Date(stats.generatedAt).toLocaleString('pt-BR') : loading ? '…' : '—'}
            </div>
          </div>
        </div>
      </section>

      {/* Resumos negócio + usuários */}
      {(stats?.sqlite.usersByScope?.length ||
        stats?.sqlite.campaignsByPayment?.length ||
        stats?.sqlite.paymentsByStatus?.length) ? (
        <section className="admin-dashboard__section" aria-labelledby="adm-section-summaries">
          <div className="admin-dashboard__section-head">
            <span className="admin-dashboard__section-accent" style={{ background: 'linear-gradient(180deg, #ec4899, #f97316)' }} />
            <div className="admin-dashboard__section-head-text">
              <h2 id="adm-section-summaries">Resumo rápido</h2>
              <span className="admin-dashboard__section-muted">Usuários, campanhas e cobranças</span>
            </div>
          </div>
          <div className="admin-dashboard__summary-cols">
            {stats?.sqlite.usersByScope != null && stats.sqlite.usersByScope.length > 0 && (
              <div className="admin-dashboard__panel">
                <div className="admin-dashboard__panel-head">
                  <SafetyCertificateOutlined style={{ color: '#6366f1' }} />
                  Usuários por perfil de acesso
                </div>
                <div className="admin-dashboard__chips">
                  {stats.sqlite.usersByScope.map((row) => {
                    const st = SCOPE_STYLES[row.scope] ?? {
                      label: row.scope,
                      ...defaultChipStyle(),
                    }
                    return (
                      <div
                        key={row.scope}
                        className="admin-dashboard__chip"
                        style={{
                          background: st.bg,
                          borderColor: st.border,
                          color: st.color,
                          border: `1px solid ${st.border}`,
                        }}
                      >
                        <span>{st.label}</span>
                        <span className="admin-dashboard__chip-count">{formatInt(row.count)}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            {stats?.sqlite.campaignsByPayment != null && stats.sqlite.campaignsByPayment.length > 0 && (
              <div className="admin-dashboard__panel">
                <div className="admin-dashboard__panel-head">
                  <span className="admin-dashboard__panel-dot" style={{ background: '#ec4899' }} />
                  Campanhas por pagamento
                </div>
                <div className="admin-dashboard__chips">
                  {stats.sqlite.campaignsByPayment.map((row) => {
                    const key = row.payment_status.toLowerCase()
                    const st = PAYMENT_STATUS_STYLE[key] ?? defaultChipStyle()
                    return (
                      <div
                        key={row.payment_status}
                        className="admin-dashboard__chip"
                        style={{
                          background: st.bg,
                          border: `1px solid ${st.border}`,
                          color: st.color,
                        }}
                      >
                        <span>{row.payment_status}</span>
                        <span className="admin-dashboard__chip-count">{formatInt(row.count)}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            {stats?.sqlite.paymentsByStatus != null && stats.sqlite.paymentsByStatus.length > 0 && (
              <div className="admin-dashboard__panel">
                <div className="admin-dashboard__panel-head">
                  <ShopOutlined style={{ color: '#0d9488' }} />
                  Pagamentos por status
                </div>
                <div className="admin-dashboard__chips">
                  {stats.sqlite.paymentsByStatus.map((row) => {
                    const st = ASAAS_STATUS_STYLE[row.status] ?? defaultChipStyle()
                    return (
                      <div
                        key={row.status}
                        className="admin-dashboard__chip"
                        style={{
                          background: st.bg,
                          border: `1px solid ${st.border}`,
                          color: st.color,
                        }}
                      >
                        <span>{row.status}</span>
                        <span className="admin-dashboard__chip-count">{formatInt(row.count)}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </section>
      ) : null}

      {/* SQLite agrupado */}
      <section className="admin-dashboard__section" aria-labelledby="adm-section-sqlite">
        <div className="admin-dashboard__section-head">
          <span className="admin-dashboard__section-accent" style={{ background: 'linear-gradient(180deg, #8b5cf6, #6366f1)' }} />
          <div className="admin-dashboard__section-head-text">
            <h2 id="adm-section-sqlite">Banco SQLite</h2>
            <span className="admin-dashboard__section-muted">Por área do produto</span>
          </div>
        </div>
        <div className="admin-dashboard__sqlite-stack">
          {SQLITE_GROUPS.map((group) => {
            const rows = group.keys
              .map((k) => tableRowsByKey.get(k))
              .filter((r): r is NonNullable<typeof r> => r != null)
            if (rows.length === 0) return null
            return (
              <div key={group.id} className="admin-dashboard__panel">
                <div className="admin-dashboard__panel-head">
                  <span className="admin-dashboard__panel-dot" style={{ background: group.dot }} />
                  <div className="admin-dashboard__panel-head-stack">
                    <span>{group.title}</span>
                    <span className="admin-dashboard__panel-sub">{group.subtitle}</span>
                  </div>
                </div>
                <div className="admin-dashboard__panel-body">
                  <Table
                    size="small"
                    loading={loading}
                    pagination={false}
                    dataSource={rows}
                    rowKey="key"
                    columns={[
                      {
                        title: 'Métrica',
                        dataIndex: 'name',
                        key: 'name',
                        render: (text: string) => (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <ApiOutlined style={{ color: group.dot, opacity: 0.85, fontSize: 13 }} />
                            {text}
                          </span>
                        ),
                      },
                      {
                        title: 'Total',
                        dataIndex: 'count',
                        key: 'count',
                        align: 'right',
                        width: 120,
                        render: (n: number) => (
                          <strong style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--app-primary)' }}>
                            {formatInt(n)}
                          </strong>
                        ),
                      },
                    ]}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
