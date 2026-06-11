import { useState } from 'react'
import { Button } from 'antd'
import {
  CalendarOutlined,
  CheckCircleOutlined,
  CreditCardOutlined,
  DollarOutlined,
  FileTextOutlined,
  RightOutlined,
} from '@ant-design/icons'
import type { PaymentItem } from '../../api'
import './PaymentHistoryTimeline.css'

const STATUS_MESSAGES: Record<string, string> = {
  CONFIRMED: 'Sua cobrança foi realizada com sucesso.',
  RECEIVED: 'Pagamento recebido e confirmado.',
  REFUNDED: 'Este pagamento foi estornado.',
  FAILED: 'O pagamento não foi concluído.',
  CANCELLED: 'Esta cobrança foi cancelada.',
}

function formatDateParts(iso: string): { date: string; time: string } {
  try {
    const d = new Date(iso)
    return {
      date: d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
      time: d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    }
  } catch {
    return { date: iso, time: '' }
  }
}

function formatBrl(cents: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100)
}

function paymentMethodChip(payment: PaymentItem): string {
  if (payment.billingType === 'PIX') return 'PIX'
  if (payment.billingType === 'BOLETO') return 'Boleto'
  return 'Cartão'
}

function receiptLabel(payment: PaymentItem): string {
  const code = payment.asaasPaymentId?.replace(/\D/g, '') ?? ''
  const tail = code.slice(-4) || payment.id.slice(0, 4)
  return `#${tail}`
}

export type PaymentHistoryTimelineProps = {
  payments: PaymentItem[]
  loading?: boolean
  onOpenDetail: (payment: PaymentItem) => void
}

const INITIAL_VISIBLE = 3

export default function PaymentHistoryTimeline({
  payments,
  loading,
  onOpenDetail,
}: PaymentHistoryTimelineProps) {
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? payments : payments.slice(0, INITIAL_VISIBLE)

  if (!loading && payments.length === 0) {
    return null
  }

  return (
    <section className="payment-history">
      <div className="payment-history__header">
        <h3 className="payment-history__title">
          <CalendarOutlined aria-hidden />
          Histórico de pagamentos
        </h3>
        {payments.length > INITIAL_VISIBLE ? (
          <Button type="link" className="payment-history__view-all" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Mostrar menos' : 'Ver todas'}
            <RightOutlined aria-hidden />
          </Button>
        ) : null}
      </div>

      <div className="payment-history__timeline">
        {visible.map((payment) => {
          const { date, time } = formatDateParts(payment.createdAt)
          const statusMessage = STATUS_MESSAGES[payment.status] ?? 'Registro de pagamento.'
          const isSuccess = payment.status === 'CONFIRMED' || payment.status === 'RECEIVED'

          return (
            <article key={payment.id} className="payment-history__item">
              <div className="payment-history__date-col">
                <span className="payment-history__date">{date}</span>
                <span className="payment-history__time">{time}</span>
              </div>

              <div className="payment-history__track">
                <span className={`payment-history__dot${isSuccess ? ' payment-history__dot--success' : ''}`} />
              </div>

              <div className="payment-history__card">
                <div className="payment-history__card-head">
                  <div className="payment-history__card-title-wrap">
                    {isSuccess ? (
                      <CheckCircleOutlined className="payment-history__card-icon payment-history__card-icon--success" />
                    ) : (
                      <FileTextOutlined className="payment-history__card-icon" />
                    )}
                    <div className="payment-history__card-copy">
                      <h4 className="payment-history__card-title">
                        {isSuccess ? 'Pagamento confirmado' : `Pagamento ${payment.status.toLowerCase()}`}
                      </h4>
                      <p className="payment-history__card-desc">{statusMessage}</p>
                    </div>
                  </div>
                  <Button size="small" className="payment-history__detail-btn" onClick={() => onOpenDetail(payment)}>
                    Detalhes
                    <RightOutlined aria-hidden />
                  </Button>
                </div>

                <div className="payment-history__card-meta">
                  <span className="payment-history__meta-chip">
                    <CreditCardOutlined aria-hidden />
                    {paymentMethodChip(payment)}
                  </span>
                  <span className="payment-history__meta-chip">
                    <DollarOutlined aria-hidden />
                    {formatBrl(payment.amountCents)}
                  </span>
                  <span className="payment-history__meta-chip">
                    <FileTextOutlined aria-hidden />
                    {receiptLabel(payment)}
                  </span>
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
