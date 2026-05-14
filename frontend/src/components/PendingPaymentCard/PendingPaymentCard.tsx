import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Card, Button, Typography, Tag, Popconfirm, message } from 'antd'
import {
  CopyOutlined,
  BankOutlined,
  CreditCardOutlined,
  ThunderboltOutlined,
  DeleteOutlined,
  LinkOutlined,
} from '@ant-design/icons'
import {
  deleteMyPendingPayment,
  fetchPaymentIfExists,
  type CreatePaymentForCreditsResponse,
} from '../../api'
import { useRegisterPendingPaymentWatch } from '../../contexts/PendingPaymentCelebrationContext'
import './PendingPaymentCard.css'

const { Text, Title } = Typography

function paymentBrlAmount(p: CreatePaymentForCreditsResponse): number {
  const brl =
    typeof p.valueBrl === 'number' && Number.isFinite(p.valueBrl)
      ? p.valueBrl
      : Number.isFinite(p.amountCents)
        ? p.amountCents / 100
        : 0
  return brl
}

function formatBrlPayment(p: CreatePaymentForCreditsResponse): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(paymentBrlAmount(p))
}

function billingLabel(type: string): string {
  if (type === 'PIX') return 'PIX'
  if (type === 'CREDIT_CARD') return 'Cartão'
  return 'Boleto'
}

export type PendingPaymentCardProps = {
  payment: CreatePaymentForCreditsResponse
  onRemoved: () => void | Promise<void>
  onResolved?: () => void | Promise<void>
}

export default function PendingPaymentCard({ payment, onRemoved, onResolved }: PendingPaymentCardProps) {
  const registerPendingPaymentWatch = useRegisterPendingPaymentWatch()
  const [pixQrDataUrl, setPixQrDataUrl] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const billingType = payment.billingType === 'BOLETO' ? 'BOLETO' : payment.billingType === 'CREDIT_CARD' ? 'CREDIT_CARD' : 'PIX'
  const hasPixPayload = Boolean(payment.pixCopyPaste)
  const hasBoletoLink = Boolean(payment.bankSlipUrl)
  const hasInvoice = Boolean(payment.invoiceUrl)

  useEffect(() => {
    const id = payment.paymentId
    if (id) registerPendingPaymentWatch(id)
  }, [payment.paymentId, registerPendingPaymentWatch])

  useEffect(() => {
    const payload = payment.pixCopyPaste
    if (!payload) {
      setPixQrDataUrl(null)
      return
    }
    let cancelled = false
    QRCode.toDataURL(payload, { width: 220, margin: 2 })
      .then((url) => {
        if (!cancelled) setPixQrDataUrl(url)
      })
      .catch(() => {
        if (!cancelled) setPixQrDataUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [payment.pixCopyPaste])

  useEffect(() => {
    const id = payment.paymentId
    if (!id) return
    let alive = true
    const tick = async () => {
      try {
        const row = await fetchPaymentIfExists(id)
        if (!alive) return
        if (!row || (row.status !== 'PENDING' && row.status !== 'OVERDUE')) {
          await Promise.resolve(onResolved?.())
        }
      } catch {
        /* ignore */
      }
    }
    const interval = window.setInterval(() => void tick(), 5000)
    void tick()
    return () => {
      alive = false
      window.clearInterval(interval)
    }
  }, [payment.paymentId, onResolved])

  const copyPix = () => {
    if (!payment.pixCopyPaste) return
    void navigator.clipboard.writeText(payment.pixCopyPaste).then(() => {
      message.success('Código PIX copiado!')
    })
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await deleteMyPendingPayment(payment.paymentId)
      message.success('Cobrança pendente removida.')
      await Promise.resolve(onRemoved())
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setDeleting(false)
    }
  }

  const openUrl = (url: string | null | undefined) => {
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <Card className="pending-payment-card" title={null}>
      <div className="pending-payment-card__header">
        <div>
          <Text className="pending-payment-card__eyebrow">Pagamento em aberto</Text>
          <Title level={4} className="pending-payment-card__title">
            Conclua sua fatura
          </Title>
        </div>
        <Tag color="orange" className="pending-payment-card__status">
          Pendente
        </Tag>
      </div>

      <div className="pending-payment-card__summary">
        <div className="pending-payment-card__amount-block">
          <Text type="secondary" className="pending-payment-card__amount-label">
            Total a pagar
          </Text>
          <div className="pending-payment-card__amount">{formatBrlPayment(payment)}</div>
          <Text type="secondary">
            {payment.credits} créditos · {billingLabel(billingType)}
          </Text>
        </div>

        <div className="pending-payment-card__actions-col">
          {billingType === 'CREDIT_CARD' && hasInvoice ? (
            <Button
              type="primary"
              size="large"
              icon={<CreditCardOutlined />}
              onClick={() => openUrl(payment.invoiceUrl)}
              block
            >
              Cadastrar cartão na fatura Asaas
            </Button>
          ) : null}

          {billingType === 'PIX' && hasPixPayload ? (
            <>
              {pixQrDataUrl ? (
                <img src={pixQrDataUrl} alt="QR Code PIX" className="pending-payment-card__qr" />
              ) : null}
              <Button type="primary" size="large" icon={<CopyOutlined />} onClick={copyPix} block>
                Copiar código PIX
              </Button>
            </>
          ) : null}

          {billingType === 'BOLETO' && hasBoletoLink ? (
            <Button
              type="primary"
              size="large"
              icon={<BankOutlined />}
              onClick={() => openUrl(payment.bankSlipUrl)}
              block
            >
              Abrir boleto
            </Button>
          ) : null}

          {hasInvoice && billingType !== 'CREDIT_CARD' ? (
            <Button size="large" icon={<LinkOutlined />} onClick={() => openUrl(payment.invoiceUrl)} block>
              Abrir fatura no Asaas
            </Button>
          ) : null}

          {billingType === 'PIX' && !hasPixPayload && hasInvoice ? (
            <Button type="primary" size="large" icon={<ThunderboltOutlined />} onClick={() => openUrl(payment.invoiceUrl)} block>
              Abrir página de pagamento
            </Button>
          ) : null}

          {!hasPixPayload && !hasBoletoLink && !hasInvoice ? (
            <Text type="warning">Aguardando link de pagamento. Atualize a página em instantes.</Text>
          ) : null}
        </div>
      </div>

      <div className="pending-payment-card__footer">
        <Popconfirm
          title="Remover cobrança pendente?"
          description="Cancela no gateway e remove a fatura. Não dá para desfazer."
          okText="Remover"
          cancelText="Cancelar"
          okButtonProps={{ danger: true, loading: deleting }}
          disabled={deleting}
          onConfirm={() => void handleDelete()}
        >
          <Button danger type="text" icon={<DeleteOutlined />} loading={deleting} disabled={deleting}>
            Cancelar cobrança
          </Button>
        </Popconfirm>
      </div>
    </Card>
  )
}
