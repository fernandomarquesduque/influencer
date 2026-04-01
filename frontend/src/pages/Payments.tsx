/**
 * Meus pagamentos: histórico e atalho para compra de créditos (modal centralizado).
 */
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Table, Button, Typography, Spin, Alert, Space, Tag, Popconfirm, message } from 'antd'
import { DollarOutlined, DeleteOutlined, AppstoreOutlined } from '@ant-design/icons'
import { useAuth } from '../contexts/AuthContext'
import { useCredits } from '../contexts/CreditsContext'
import {
  fetchMyPayments,
  fetchMyPendingPayment,
  deleteMyPendingPayment,
  type PaymentItem,
  type CreatePaymentForCreditsResponse,
} from '../api'
import BuyCreditsModal from '../components/BuyCreditsModal/BuyCreditsModal'
import './Payments.css'

const { Text } = Typography

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
  const { user, loading: authLoading } = useAuth()
  const { balance } = useCredits()
  const [payments, setPayments] = useState<PaymentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [buyModalOpen, setBuyModalOpen] = useState(false)
  const [buyCreditsResume, setBuyCreditsResume] = useState<CreatePaymentForCreditsResponse | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

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

  useEffect(() => {
    if (user) void loadPayments()
  }, [user, loadPayments])

  const handleOpenBuy = async () => {
    try {
      const p = await fetchMyPendingPayment()
      setBuyCreditsResume(p)
    } catch {
      setBuyCreditsResume(null)
    }
    setBuyModalOpen(true)
  }

  const handleDeletePending = async (paymentId: string) => {
    setDeletingId(paymentId)
    try {
      await deleteMyPendingPayment(paymentId)
      message.success('Cobrança pendente removida.')
      await loadPayments()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setDeletingId(null)
    }
  }

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

  return (
    <div className="app-page" style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
        <Space wrap size="middle">
          <Text strong style={{ color: 'var(--app-primary)' }}>
            Saldo: {balance} créditos
          </Text>
          <Button type="primary" icon={<DollarOutlined />} onClick={() => void handleOpenBuy()}>
            Comprar créditos
          </Button>
          <Button type="default" icon={<AppstoreOutlined />} onClick={() => navigate('/app/campaigns')}>
            Minhas campanhas
          </Button>
        </Space>
      </div>

      {error && (
        <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} onClose={() => setError(null)} closable />
      )}

      <Card title="Histórico de pagamentos" className="payments-history-card">
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center' }}>
            <Spin />
          </div>
        ) : payments.length === 0 ? (
          <div style={{ padding: '24px 20px' }}>
            <Text type="secondary">Nenhum pagamento ainda. Compre créditos para usar nos relatórios.</Text>
          </div>
        ) : (
          <Table
            className="payments-history-table"
            dataSource={payments}
            rowKey="id"
            pagination={false}
            size="middle"
            bordered
            tableLayout="fixed"
            scroll={{ x: 'max-content' }}
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
                render: (v: string) => (v === 'PIX' ? 'PIX' : 'Boleto'),
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
                    {row.bankSlipUrl && row.status === 'PENDING' && (
                      <Button type="link" size="small" href={row.bankSlipUrl} target="_blank" rel="noopener noreferrer">
                        Ver boleto
                      </Button>
                    )}
                    {row.invoiceUrl && (
                      <Button type="link" size="small" href={row.invoiceUrl} target="_blank" rel="noopener noreferrer">
                        Fatura
                      </Button>
                    )}
                    {row.status === 'PENDING' && (
                      <Popconfirm
                        title="Remover cobrança pendente?"
                        description="Cancela no gateway e some do histórico. Não dá para desfazer."
                        okText="Remover"
                        cancelText="Cancelar"
                        okButtonProps={{ danger: true, loading: deletingId === row.id }}
                        disabled={deletingId != null}
                        onConfirm={() => void handleDeletePending(row.id)}
                      >
                        <Button
                          type="link"
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          disabled={deletingId != null}
                          aria-label="Remover cobrança pendente"
                        />
                      </Popconfirm>
                    )}
                  </div>
                ),
              },
            ]}
          />
        )}
      </Card>

      <BuyCreditsModal
        open={buyModalOpen}
        onClose={() => {
          setBuyModalOpen(false)
          setBuyCreditsResume(null)
        }}
        resumePayment={buyCreditsResume}
        onAfterPaymentCreated={loadPayments}
      />
    </div>
  )
}
