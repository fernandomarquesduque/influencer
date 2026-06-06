import { useEffect, useState } from 'react'
import { Modal, Descriptions, Button, Tag, Popconfirm, message } from 'antd'
import { LinkOutlined } from '@ant-design/icons'
import type { PaymentItem } from '../../api'
import { cancelMySubscription, fetchMySubscription } from '../../api'
import { getBuscaPlanById } from '../../constants/buscaPlans'
import './PaymentInvoiceModal.css'

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

function billingTypeLabel(billingType: string): string {
  if (billingType === 'PIX') return 'PIX'
  if (billingType === 'CREDIT_CARD') return 'Cartão'
  return 'Boleto'
}

function formatDueDate(ymd: string): string {
  const [y, m, day] = ymd.slice(0, 10).split('-')
  return `${day}/${m}/${y}`
}

function paymentTypeLabel(payment: PaymentItem): string {
  return payment.planId ? 'Assinatura' : 'Compra de créditos'
}

function isSubscriptionPayment(payment: PaymentItem | null): boolean {
  return Boolean(payment?.planId || payment?.asaasSubscriptionId)
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

export type PaymentInvoiceModalProps = {
  open: boolean
  payment: PaymentItem | null
  onClose: () => void
  onSubscriptionCancelled?: () => void | Promise<void>
}

export default function PaymentInvoiceModal({
  open,
  payment,
  onClose,
  onSubscriptionCancelled,
}: PaymentInvoiceModalProps) {
  const [cancelling, setCancelling] = useState(false)
  const [hasActiveSubscription, setHasActiveSubscription] = useState(false)
  const planMeta = payment?.planId ? getBuscaPlanById(payment.planId) : null
  const planLabel = planMeta?.name ?? (payment?.planId ? `Plano ${payment.planId}` : null)
  const showCancelSubscription = isSubscriptionPayment(payment) || hasActiveSubscription

  useEffect(() => {
    if (!open) {
      setHasActiveSubscription(false)
      return
    }
    let alive = true
    void fetchMySubscription()
      .then((sub) => {
        if (alive) setHasActiveSubscription(Boolean(sub.active && sub.subscriptionId))
      })
      .catch(() => {
        if (alive) setHasActiveSubscription(false)
      })
    return () => {
      alive = false
    }
  }, [open, payment?.id])

  const handleOpen = () => {
    if (payment?.invoiceUrl) {
      window.open(payment.invoiceUrl, '_blank', 'noopener,noreferrer')
    }
    onClose()
  }

  const handleCancelSubscription = async () => {
    setCancelling(true)
    try {
      await cancelMySubscription()
      message.success('Assinatura cancelada.')
      onClose()
      await Promise.resolve(onSubscriptionCancelled?.())
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setCancelling(false)
    }
  }

  return (
    <Modal
      className="payment-invoice-modal"
      title="Detalhes da fatura"
      open={open}
      closable={false}
      keyboard={false}
      destroyOnHidden
      centered
      width={520}
      maskClosable={false}
      footer={
        <div
          className={`payment-invoice-modal__footer${showCancelSubscription ? ' payment-invoice-modal__footer--split' : ''}`}
        >
          {showCancelSubscription ? (
            <Popconfirm
              title="Cancelar assinatura?"
              description="Cancela a recorrência. Cobranças futuras não serão geradas. Não dá para desfazer."
              okText="Sim, cancelar"
              cancelText="Voltar"
              okButtonProps={{ danger: true, loading: cancelling }}
              disabled={cancelling}
              onConfirm={() => void handleCancelSubscription()}
            >
              <Button danger disabled={cancelling}>
                Cancelar assinatura
              </Button>
            </Popconfirm>
          ) : null}
          <Button type="primary" icon={<LinkOutlined />} onClick={handleOpen} disabled={!payment?.invoiceUrl}>
            Abrir
          </Button>
        </div>
      }
    >
      {payment ? (
        <Descriptions bordered column={1} size="small" className="payment-invoice-modal__descriptions">
          <Descriptions.Item label="Identificador">
            <span className="payment-invoice-modal__mono">{payment.id}</span>
          </Descriptions.Item>
          {payment.asaasPaymentId ? (
            <Descriptions.Item label="Código">
              <span className="payment-invoice-modal__mono">{payment.asaasPaymentId}</span>
            </Descriptions.Item>
          ) : null}
          <Descriptions.Item label="Tipo">{paymentTypeLabel(payment)}</Descriptions.Item>
          {planLabel ? <Descriptions.Item label="Plano">{planLabel}</Descriptions.Item> : null}
          {payment.planFirstInvoiceDue ? (
            <Descriptions.Item label="1ª cobrança em">{formatDueDate(payment.planFirstInvoiceDue)}</Descriptions.Item>
          ) : null}
          <Descriptions.Item label="Data">{formatDate(payment.createdAt)}</Descriptions.Item>
          <Descriptions.Item label="Atualizado em">{formatDate(payment.updatedAt)}</Descriptions.Item>
          <Descriptions.Item label="Valor">{formatBrl(payment.amountCents)}</Descriptions.Item>
          <Descriptions.Item label="Créditos">{payment.creditsGranted}</Descriptions.Item>
          <Descriptions.Item label="Forma de pagamento">{billingTypeLabel(payment.billingType)}</Descriptions.Item>
          <Descriptions.Item label="Status">
            <StatusTag status={payment.status} />
          </Descriptions.Item>
        </Descriptions>
      ) : null}
    </Modal>
  )
}
