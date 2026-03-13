/**
 * Meus pagamentos: histórico e compra de créditos (PIX/Boleto).
 */
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Table, Button, Typography, Spin, Alert, Modal, Radio, Space, Tag, message } from 'antd'
import { DollarOutlined, CopyOutlined, BankOutlined } from '@ant-design/icons'
import { useAuth } from '../contexts/AuthContext'
import { useCredits } from '../contexts/CreditsContext'
import {
  fetchMyPayments,
  createPaymentForCredits,
  type PaymentItem,
  type CreatePaymentForCreditsResponse,
} from '../api'

const { Title, Text } = Typography

const CREDIT_PACKS = [
  { credits: 10, label: '10 créditos' },
  { credits: 50, label: '50 créditos' },
  { credits: 100, label: '100 créditos' },
  { credits: 200, label: '200 créditos' },
]

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
  const { balance, refreshCredits } = useCredits()
  const [payments, setPayments] = useState<PaymentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [buyModalOpen, setBuyModalOpen] = useState(false)
  const [buyCredits, setBuyCredits] = useState(50)
  const [buyBillingType, setBuyBillingType] = useState<'PIX' | 'BOLETO'>('PIX')
  const [creating, setCreating] = useState(false)
  const [createdPayment, setCreatedPayment] = useState<CreatePaymentForCreditsResponse | null>(null)

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

  const handleOpenBuy = () => {
    setCreatedPayment(null)
    setBuyModalOpen(true)
  }

  const handleCreatePayment = async () => {
    setCreating(true)
    setError(null)
    try {
      const res = await createPaymentForCredits(buyCredits, buyBillingType)
      setCreatedPayment(res)
      await loadPayments()
      await refreshCredits()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  const copyPix = () => {
    if (!createdPayment?.pixCopyPaste) return
    void navigator.clipboard.writeText(createdPayment.pixCopyPaste).then(() => {
      message.success('Código PIX copiado!')
    })
  }

  const closeBuyModal = () => {
    setBuyModalOpen(false)
    setCreatedPayment(null)
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
    <div className="app-page" style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0 }}>
          Meus pagamentos
        </Title>
        <Space>
          <Text strong style={{ color: 'var(--app-primary)' }}>
            Saldo: {balance} créditos
          </Text>
          <Button type="primary" icon={<DollarOutlined />} onClick={handleOpenBuy}>
            Comprar créditos
          </Button>
        </Space>
      </div>

      {error && (
        <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} onClose={() => setError(null)} closable />
      )}

      <Card title="Histórico de pagamentos">
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center' }}>
            <Spin />
          </div>
        ) : payments.length === 0 ? (
          <Text type="secondary">Nenhum pagamento ainda. Compre créditos para usar nos relatórios.</Text>
        ) : (
          <Table
            dataSource={payments}
            rowKey="id"
            pagination={false}
            size="small"
            columns={[
              {
                title: 'Data',
                dataIndex: 'createdAt',
                key: 'createdAt',
                render: (v: string) => formatDate(v),
                width: 140,
              },
              {
                title: 'Valor',
                dataIndex: 'amountCents',
                key: 'amountCents',
                render: (v: number) => formatBrl(v),
                width: 100,
              },
              {
                title: 'Créditos',
                dataIndex: 'creditsGranted',
                key: 'creditsGranted',
                width: 90,
              },
              {
                title: 'Forma',
                dataIndex: 'billingType',
                key: 'billingType',
                render: (v: string) => (v === 'PIX' ? 'PIX' : 'Boleto'),
                width: 80,
              },
              {
                title: 'Status',
                dataIndex: 'status',
                key: 'status',
                render: (v: string) => <StatusTag status={v} />,
                width: 110,
              },
              {
                title: 'Ações',
                key: 'actions',
                render: (_: unknown, row: PaymentItem) => (
                  <Space size="small">
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
                  </Space>
                ),
              },
            ]}
          />
        )}
      </Card>

      <Modal
        title="Comprar créditos"
        open={buyModalOpen}
        onCancel={closeBuyModal}
        footer={null}
        width={480}
        destroyOnClose
      >
        {!createdPayment ? (
          <>
            <div style={{ marginBottom: 16 }}>
              <Text strong>Quantidade de créditos</Text>
              <div style={{ marginTop: 8 }}>
                <Radio.Group
                  optionType="button"
                  value={buyCredits}
                  onChange={(e) => setBuyCredits(e.target.value)}
                  options={CREDIT_PACKS.map((p) => ({ label: p.label, value: p.credits }))}
                />
              </div>
            </div>
            <div style={{ marginBottom: 20 }}>
              <Text strong>Forma de pagamento</Text>
              <div style={{ marginTop: 8 }}>
                <Radio.Group
                  value={buyBillingType}
                  onChange={(e) => setBuyBillingType(e.target.value)}
                  options={[
                    { label: 'PIX (instantâneo)', value: 'PIX' },
                    { label: 'Boleto', value: 'BOLETO' },
                  ]}
                />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button onClick={closeBuyModal}>Cancelar</Button>
              <Button type="primary" loading={creating} onClick={handleCreatePayment} icon={<DollarOutlined />}>
                Gerar pagamento
              </Button>
            </div>
          </>
        ) : (
          <div>
            <Alert
              type="success"
              message="Pagamento gerado"
              description={
                buyBillingType === 'PIX'
                  ? 'Copie o código PIX abaixo e pague no app do seu banco. Os créditos serão creditados em instantes.'
                  : 'Pague o boleto pelo link abaixo. Os créditos serão creditados após a confirmação do pagamento.'
              }
              showIcon
              style={{ marginBottom: 16 }}
            />
            {buyBillingType === 'PIX' && createdPayment.pixCopyPaste && (
              <Card size="small" style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <Text type="secondary" style={{ flex: 1, minWidth: 0, wordBreak: 'break-all' }}>
                    {createdPayment.pixCopyPaste}
                  </Text>
                  <Button type="primary" icon={<CopyOutlined />} onClick={copyPix}>
                    Copiar PIX
                  </Button>
                </div>
              </Card>
            )}
            {buyBillingType === 'BOLETO' && createdPayment.bankSlipUrl && (
              <Button type="primary" href={createdPayment.bankSlipUrl} target="_blank" rel="noopener noreferrer" block icon={<BankOutlined />} style={{ marginBottom: 16 }}>
                Abrir boleto
              </Button>
            )}
            {createdPayment.invoiceUrl && (
              <Button href={createdPayment.invoiceUrl} target="_blank" rel="noopener noreferrer" block style={{ marginBottom: 16 }}>
                Ver fatura
              </Button>
            )}
            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <Button type="primary" onClick={closeBuyModal}>
                Fechar
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
