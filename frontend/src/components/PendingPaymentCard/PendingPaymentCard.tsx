import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { Card, Button, Typography, Popconfirm, message } from 'antd'
import {
  CopyOutlined,
  BankOutlined,
  ThunderboltOutlined,
  DeleteOutlined,
  LinkOutlined,
  GiftOutlined,
  CalendarOutlined,
  FormOutlined,
  CreditCardOutlined,
  RightOutlined,
  QrcodeOutlined,
} from '@ant-design/icons'
import {
  deleteMyPendingPayment,
  fetchPaymentIfExists,
  type CreatePaymentForCreditsResponse,
} from '../../api'
import { getBuscaPlanById } from '../../constants/buscaPlans'
import { useRegisterPendingPaymentWatch } from '../../contexts/PendingPaymentCelebrationContext'
import { trackPurchaseComplete, trackSubscribePaymentConfirmed } from '../../utils/metaPixelFunnel'
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

/** Dias até YYYY-MM-DD (0 = hoje); negativo = já passou. */
function daysUntilIsoDate(ymd: string | null | undefined): number | null {
  if (!ymd) return null
  const d = ymd.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null
  const [y, m, day] = d.split('-').map(Number)
  const due = new Date(y, m - 1, day)
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((due.getTime() - startToday.getTime()) / (24 * 60 * 60 * 1000))
}

function formatDueBr(ymd: string): string {
  const [y, m, day] = ymd.slice(0, 10).split('-')
  return `${day}/${m}/${y}`
}

function SummaryLeadIcon({ billingType }: { billingType: 'PIX' | 'BOLETO' | 'CREDIT_CARD' }) {
  if (billingType === 'PIX') {
    return <QrcodeOutlined aria-hidden className="pending-payment-card__summary-lead-icon" />
  }
  if (billingType === 'BOLETO') {
    return <BankOutlined aria-hidden className="pending-payment-card__summary-lead-icon" />
  }
  return <CreditCardOutlined aria-hidden className="pending-payment-card__summary-lead-icon" />
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
  const resolvedTrackedRef = useRef(false)

  const billingType = payment.billingType === 'BOLETO' ? 'BOLETO' : payment.billingType === 'CREDIT_CARD' ? 'CREDIT_CARD' : 'PIX'
  const hasPixPayload = Boolean(payment.pixCopyPaste)
  const hasBoletoLink = Boolean(payment.bankSlipUrl)
  const hasInvoice = Boolean(payment.invoiceUrl)

  const planMeta = payment.planId ? getBuscaPlanById(payment.planId) : null
  const planLabel = planMeta?.name ?? (payment.planId ? `Plano ${payment.planId}` : null)
  const isPlanSubscription = Boolean(payment.planId)
  const trialDaysLeft =
    payment.status === 'PENDING' && payment.planFirstInvoiceDue
      ? daysUntilIsoDate(payment.planFirstInvoiceDue)
      : null
  const isPlanTrialWindow =
    isPlanSubscription &&
    payment.status === 'PENDING' &&
    Boolean(payment.planFirstInvoiceDue) &&
    trialDaysLeft !== null &&
    trialDaysLeft >= 0
  const cancelDescription = isPlanSubscription
    ? 'Cancela a assinatura e a recorrência, remove a parcela pendente e apaga o registro local. Não dá para desfazer.'
    : 'Cancela no gateway e remove a fatura. Não dá para desfazer.'

  const trialBannerText =
    trialDaysLeft !== null && payment.status === 'PENDING'
      ? trialDaysLeft > 0
        ? `Período grátis: faltam ${trialDaysLeft} dia${trialDaysLeft !== 1 ? 's' : ''} para a 1ª cobrança${
            payment.planFirstInvoiceDue ? ` (${formatDueBr(payment.planFirstInvoiceDue)})` : ''
          }.`
        : trialDaysLeft === 0
          ? `Hoje é o vencimento da 1ª cobrança do plano${
              payment.planFirstInvoiceDue ? ` (${formatDueBr(payment.planFirstInvoiceDue)})` : ''
            }.`
          : 'A data da 1ª cobrança já passou — regularize no link abaixo.'
      : null

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
    resolvedTrackedRef.current = false
  }, [payment.paymentId])

  useEffect(() => {
    const id = payment.paymentId
    if (!id) return
    let alive = true
    const tick = async () => {
      try {
        const row = await fetchPaymentIfExists(id)
        if (!alive) return
        if (!row || (row.status !== 'PENDING' && row.status !== 'OVERDUE')) {
          if (!resolvedTrackedRef.current) {
            resolvedTrackedRef.current = true
            const valueBrl = paymentBrlAmount(payment)
            if (payment.planId) {
              trackSubscribePaymentConfirmed(payment.planId, valueBrl, {
                billing_type: billingType,
              })
            } else {
              trackPurchaseComplete('credits', valueBrl, {
                billing_type: billingType,
                credits: payment.credits ?? undefined,
              })
            }
          }
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
      message.success(isPlanSubscription ? 'Assinatura e cobrança canceladas.' : 'Cobrança pendente removida.')
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

  const showTrialBanner = Boolean(isPlanSubscription && trialBannerText)

  const hasExtraActions =
    (billingType === 'PIX' && hasPixPayload) ||
    (billingType === 'BOLETO' && hasBoletoLink) ||
    (hasInvoice && (billingType !== 'CREDIT_CARD' || !isPlanTrialWindow)) ||
    (billingType === 'PIX' && !hasPixPayload && hasInvoice) ||
    (!hasPixPayload && !hasBoletoLink && !hasInvoice)

  return (
    <Card
      className={`pending-payment-card${isPlanSubscription ? ' pending-payment-card--plan' : ' pending-payment-card--generic'}`}
      title={null}
    >
      <div className="pending-payment-card__header-row">
        <div className="pending-payment-card__header-main">
          <div className="pending-payment-card__title-block">
            {isPlanSubscription ? (
              <div className="pending-payment-card__brand-icon" aria-hidden>
                <FormOutlined />
              </div>
            ) : null}
            <div className="pending-payment-card__titles">
              <Text className="pending-payment-card__eyebrow">
                {isPlanSubscription ? (
                  <>
                    Assinatura <span className="pending-payment-card__dot">•</span> primeira parcela
                  </>
                ) : (
                  'Pagamento em aberto'
                )}
              </Text>
              <Title level={4} className="pending-payment-card__title">
                {planLabel ?? 'Conclua sua fatura'}
              </Title>
            </div>
          </div>

          {isPlanSubscription ? (
            <div className="pending-payment-card__meta-lines">
              <p className="pending-payment-card__meta-line">
                Recorrência mensal — esta cobrança é a <strong>1ª parcela</strong> da assinatura (não é avulsa).
              </p>
            </div>
          ) : null}
        </div>

        <div
          role="status"
          className={`pending-payment-card__status${isPlanTrialWindow ? ' pending-payment-card__status--trial' : ' pending-payment-card__status--pending'}`}
        >
          {isPlanTrialWindow ? <GiftOutlined aria-hidden className="pending-payment-card__status-icon" /> : null}
          <span>{isPlanTrialWindow ? 'Teste Grátis' : 'Pendente'}</span>
        </div>
      </div>

      {showTrialBanner && trialBannerText ? (
        <div className="pending-payment-card__banner-stack">
          <div className="pending-payment-card__banner">
            <CalendarOutlined className="pending-payment-card__banner-icon" aria-hidden />
            <span className="pending-payment-card__banner-text">{trialBannerText}</span>
          </div>
        </div>
      ) : null}

      <div className="pending-payment-card__summary-panel">
        <div className="pending-payment-card__summary-icon-ring" aria-hidden>
          <SummaryLeadIcon billingType={billingType} />
        </div>
        <div className="pending-payment-card__summary-price">
          <span className="pending-payment-card__amount-label">Total a pagar</span>
          <span className="pending-payment-card__amount">{formatBrlPayment(payment)}</span>
        </div>
      </div>

      {hasExtraActions ? (
        <div className="pending-payment-card__extra-actions">
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
            <Button type="primary" size="large" icon={<BankOutlined />} onClick={() => openUrl(payment.bankSlipUrl)} block>
              Abrir boleto
            </Button>
          ) : null}

          {hasInvoice && (billingType !== 'CREDIT_CARD' || !isPlanTrialWindow) ? (
            <Button size="large" icon={<LinkOutlined />} onClick={() => openUrl(payment.invoiceUrl)} block>
              Abrir fatura
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
      ) : null}

      <div className="pending-payment-card__footer">
        <Popconfirm
          title={isPlanSubscription ? 'Cancelar assinatura e cobrança?' : 'Remover cobrança pendente?'}
          description={cancelDescription}
          okText="Remover"
          cancelText="Voltar"
          okButtonProps={{ danger: true, loading: deleting }}
          disabled={deleting}
          onConfirm={() => void handleDelete()}
        >
          <button type="button" className="pending-payment-card__cancel-row" disabled={deleting}>
            <span className="pending-payment-card__cancel-icon-wrap" aria-hidden>
              <DeleteOutlined />
            </span>
            <span className="pending-payment-card__cancel-label">
              {isPlanSubscription ? 'Cancelar assinatura' : 'Cancelar cobrança'}
            </span>
            <RightOutlined className="pending-payment-card__cancel-chevron" aria-hidden />
          </button>
        </Popconfirm>
      </div>
    </Card>
  )
}
