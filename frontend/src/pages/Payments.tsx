/**
 * Meus pagamentos: fatura pendente em card na página; histórico só com pagamentos concluídos.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Card, Table, Button, Spin, Alert, Tag } from 'antd'
import { useAuth } from '../contexts/AuthContext'
import {
  fetchMyPayments,
  fetchMyPendingPayment,
  type PaymentItem,
  type CreatePaymentForCreditsResponse,
} from '../api'
import PendingPaymentCard from '../components/PendingPaymentCard/PendingPaymentCard'
import PaymentInvoiceModal from '../components/PaymentInvoiceModal/PaymentInvoiceModal'
import BuscaInfluencerPlansPanel, {
  useBuscaPlansSubscriptionAccess,
} from '../components/BuscaInfluencerPlansModal/BuscaInfluencerPlansPanel'
import './Payments.css'

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pendente',
  RECEIVED: 'Recebido',
  CONFIRMED: 'Confirmado',
  OVERDUE: 'Vencido',
  REFUNDED: 'Estornado',
  FAILED: 'Falhou',
  CANCELLED: 'Cancelado',
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function formatBrl(cents: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100)
}

function StatusTag({ status }: { status: string }) {
  const label = STATUS_LABELS[status] ?? status
  const color =
    status === 'CONFIRMED' || status === 'RECEIVED'
      ? 'green'
      : status === 'PENDING' || status === 'OVERDUE'
        ? 'orange'
        : status === 'FAILED' || status === 'CANCELLED'
          ? 'red'
          : 'default'
  return <Tag color={color}>{label}</Tag>
}

export default function Payments() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, loading: authLoading } = useAuth()
  const {
    loading: plansAccessLoading,
    active: plansAccessActive,
    refresh: refreshPlansAccess,
  } = useBuscaPlansSubscriptionAccess(user?.scope === 'assinante')
  const [payments, setPayments] = useState<PaymentItem[]>([])
  const [pendingPayment, setPendingPayment] = useState<CreatePaymentForCreditsResponse | null>(null)
  const [pendingLoading, setPendingLoading] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [invoiceModalPayment, setInvoiceModalPayment] = useState<PaymentItem | null>(null)
  const pendingCardRef = useRef<HTMLDivElement | null>(null)

  const loadPendingPayment = useCallback(async () => {
    setPendingLoading(true)
    try {
      const p = await fetchMyPendingPayment()
      setPendingPayment(p)
    } catch {
      setPendingPayment(null)
    } finally {
      setPendingLoading(false)
    }
  }, [])

  const loadPayments = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetchMyPayments({ limit: 50 })
      setPayments(res.payments ?? [])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshAll = useCallback(async () => {
    await Promise.all([loadPayments(), loadPendingPayment()])
    refreshPlansAccess()
  }, [loadPayments, loadPendingPayment, refreshPlansAccess])

  useEffect(() => {
    if (user) void refreshAll()
  }, [user, refreshAll])

  useEffect(() => {
    const openPending = (location.state as { openPendingPayment?: boolean } | null)?.openPendingPayment
    if (!openPending || !user) return
    navigate(location.pathname, { replace: true, state: {} })
    window.setTimeout(() => {
      pendingCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 200)
  }, [location.state, location.pathname, user, navigate])

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/login', { replace: true })
    }
  }, [authLoading, user, navigate])

  if (authLoading || !user) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    )
  }

  const completedPayments = payments.filter((p) => p.status !== 'PENDING' && p.status !== 'OVERDUE')
  const showPlansWhenNoPending =
    user.scope === 'assinante' && !pendingPayment && !pendingLoading
  const showPlansPanel =
    showPlansWhenNoPending && (plansAccessLoading || !plansAccessActive)

  return (
    <div className="app-page payments-page" style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
      {error && (
        <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} onClose={() => setError(null)} closable />
      )}

      {showPlansPanel ? (
        <div className="payments-page__plans">
          <BuscaInfluencerPlansPanel className="busca-plans-panel--inline-page" checkSubscription />
        </div>
      ) : null}

      {pendingLoading ? (
        <div ref={pendingCardRef} className="payments-page__pending-loader-wrap">
          <Card className="payments-page__pending-loader" bordered>
            <Spin size="large" tip="Carregando informações do plano…" />
          </Card>
        </div>
      ) : pendingPayment ? (
        <div ref={pendingCardRef}>
          <PendingPaymentCard
            payment={pendingPayment}
            onRemoved={() => void refreshAll()}
            onResolved={() => void refreshAll()}
          />
        </div>
      ) : null}

      {completedPayments.length > 0 ? (
        <Card title="Histórico de pagamentos" className="payments-history-card">
          <Table
            className="payments-history-table"
            dataSource={completedPayments}
            rowKey="id"
            pagination={false}
            size="middle"
            bordered
            tableLayout="fixed"
            scroll={{ x: 'max-content' }}
            loading={loading}
            columns={[
              {
                title: 'Data',
                dataIndex: 'createdAt',
                key: 'createdAt',
                align: 'left',
                ellipsis: true,
                width: '26%',
                render: (v: string) => formatDate(v),
              },
              {
                title: 'Valor',
                dataIndex: 'amountCents',
                key: 'amountCents',
                align: 'right',
                width: '14%',
                render: (v: number) => <span className="payments-cell-num">{formatBrl(v)}</span>,
              },
              {
                title: 'Créditos',
                dataIndex: 'creditsGranted',
                key: 'creditsGranted',
                align: 'right',
                width: '11%',
                render: (v: number) => <span className="payments-cell-num">{v}</span>,
              },
              {
                title: 'Forma',
                dataIndex: 'billingType',
                key: 'billingType',
                align: 'center',
                width: '12%',
                render: (v: string) => (v === 'PIX' ? 'PIX' : v === 'CREDIT_CARD' ? 'Cartão' : 'Boleto'),
              },
              {
                title: 'Status',
                dataIndex: 'status',
                key: 'status',
                align: 'center',
                width: '17%',
                render: (v: string) => <StatusTag status={v} />,
              },
              {
                title: 'Ações',
                key: 'actions',
                align: 'right',
                width: '20%',
                render: (_: unknown, row: PaymentItem) => (
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'flex-end',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: 4,
                    }}
                  >
                    {row.bankSlipUrl ? (
                      <Button type="link" size="small" href={row.bankSlipUrl} target="_blank" rel="noopener noreferrer">
                        Ver boleto
                      </Button>
                    ) : null}
                    {row.invoiceUrl ? (
                      <Button type="link" size="small" onClick={() => setInvoiceModalPayment(row)}>
                        Fatura
                      </Button>
                    ) : null}
                  </div>
                ),
              },
            ]}
          />
        </Card>
      ) : null}

      <PaymentInvoiceModal
        open={invoiceModalPayment != null}
        payment={invoiceModalPayment}
        onClose={() => setInvoiceModalPayment(null)}
        onSubscriptionCancelled={refreshAll}
      />
    </div>
  )
}
