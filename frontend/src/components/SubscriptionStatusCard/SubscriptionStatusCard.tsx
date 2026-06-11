import { useState } from 'react'
import { Button, Popconfirm, Spin, Tag, message } from 'antd'
import {
  CalendarOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  CreditCardOutlined,
  DeleteOutlined,
  DollarOutlined,
  FileTextOutlined,
  StarFilled,
  SyncOutlined,
} from '@ant-design/icons'
import type { MySubscriptionStatus, PaymentItem } from '../../api'
import { cancelMySubscription } from '../../api'
import { getBuscaPlanById } from '../../constants/buscaPlans'
import PaymentHistoryTimeline from './PaymentHistoryTimeline'
import './SubscriptionStatusCard.css'
import './PaymentHistoryTimeline.css'

export type SubscriptionDisplayState = 'loading' | 'none' | 'pending' | 'trial' | 'active' | 'cancelled'

export function resolveSubscriptionDisplayState(
  subscription: MySubscriptionStatus | null,
  loading: boolean,
  hasConfirmedPlanPayment: boolean,
  planSubscriptionEnded = false,
  forceCancelled = false
): SubscriptionDisplayState {
  if (loading) return 'loading'
  if (forceCancelled) return 'cancelled'
  if (!subscription) return planSubscriptionEnded || hasConfirmedPlanPayment ? 'cancelled' : 'none'
  if (subscription.subscriptionCancelled || planSubscriptionEnded) return 'cancelled'
  if (subscription.hasPendingPlanPayment && !subscription.active) return 'pending'
  if (subscription.inTrial && subscription.active) return 'trial'
  if (subscription.active && subscription.subscriptionId) return 'active'
  if (subscription.planId && !subscription.active) return 'cancelled'
  if (hasConfirmedPlanPayment && !subscription.active) return 'cancelled'
  return 'none'
}

const STATE_LABELS: Record<Exclude<SubscriptionDisplayState, 'loading' | 'none'>, string> = {
  pending: 'Aguardando pagamento',
  trial: 'Ativa',
  active: 'Ativa',
  cancelled: 'Cancelada',
}

const PLAN_BADGE: Record<Exclude<SubscriptionDisplayState, 'loading' | 'none'>, string> = {
  pending: 'Aguardando pagamento',
  trial: 'Período de teste',
  active: 'Assinatura ativa',
  cancelled: 'Assinatura cancelada',
}

function formatLongDate(input: string): string {
  try {
    const normalized = input.includes('T') ? input : `${input.slice(0, 10)}T12:00:00`
    return new Date(normalized).toLocaleDateString('pt-BR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  } catch {
    return input
  }
}

function formatShortDate(input: string): string {
  try {
    const normalized = input.includes('T') ? input : `${input.slice(0, 10)}T12:00:00`
    return new Date(normalized).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  } catch {
    return input
  }
}

function formatBrl(cents: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100)
}

function getNextBillingDate(
  subscription: MySubscriptionStatus | null,
  latestPayment: PaymentItem | null
): Date | null {
  if (subscription?.planFirstInvoiceDue) {
    const normalized = `${subscription.planFirstInvoiceDue.slice(0, 10)}T12:00:00`
    const d = new Date(normalized)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (!latestPayment?.createdAt) return null
  try {
    const d = new Date(latestPayment.createdAt)
    d.setMonth(d.getMonth() + 1)
    return Number.isNaN(d.getTime()) ? null : d
  } catch {
    return null
  }
}

function daysUntil(date: Date | null): number | null {
  if (!date) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(date)
  target.setHours(0, 0, 0, 0)
  const diff = Math.round((target.getTime() - today.getTime()) / 86_400_000)
  return diff
}

function memberSince(payments: PaymentItem[]): string | null {
  const confirmed = payments.filter((p) => p.status === 'CONFIRMED' || p.status === 'RECEIVED')
  const oldest = confirmed[confirmed.length - 1]
  if (!oldest?.createdAt) return null
  return formatLongDate(oldest.createdAt)
}

function StatusBadge({ state }: { state: Exclude<SubscriptionDisplayState, 'loading' | 'none'> }) {
  const label = STATE_LABELS[state]
  if (state === 'active' || state === 'trial') {
    return (
      <Tag icon={<CheckCircleOutlined />} color="success" className="sub-dash__badge">
        {label}
      </Tag>
    )
  }
  if (state === 'pending') {
    return (
      <Tag icon={<ClockCircleOutlined />} color="warning" className="sub-dash__badge">
        {label}
      </Tag>
    )
  }
  return (
    <Tag icon={<CloseCircleOutlined />} color="default" className="sub-dash__badge">
      {label}
    </Tag>
  )
}

export type SubscriptionStatusCardProps = {
  subscription: MySubscriptionStatus | null
  loading: boolean
  paymentsLoading?: boolean
  completedPayments?: PaymentItem[]
  hasConfirmedPlanPayment: boolean
  planSubscriptionEnded?: boolean
  fallbackPlanId?: string | null
  forceCancelled?: boolean
  onChanged?: () => void | Promise<void>
  onCancelled?: () => void | Promise<void>
  onContractPlan?: () => void
  onOpenPaymentDetail?: (payment: PaymentItem) => void
}

export default function SubscriptionStatusCard({
  subscription,
  loading,
  paymentsLoading = false,
  completedPayments = [],
  hasConfirmedPlanPayment,
  planSubscriptionEnded = false,
  fallbackPlanId = null,
  forceCancelled = false,
  onChanged,
  onCancelled,
  onContractPlan,
  onOpenPaymentDetail,
}: SubscriptionStatusCardProps) {
  const [cancelling, setCancelling] = useState(false)
  const state = resolveSubscriptionDisplayState(
    subscription,
    loading,
    hasConfirmedPlanPayment,
    planSubscriptionEnded,
    forceCancelled
  )
  const resolvedPlanId = subscription?.planId ?? fallbackPlanId
  const planMeta = resolvedPlanId ? getBuscaPlanById(resolvedPlanId) : null
  const planName = planMeta?.name ?? (resolvedPlanId ? `Plano ${resolvedPlanId}` : null)
  const latestPayment = completedPayments[0] ?? null
  const confirmedPayments = completedPayments.filter((p) => p.status === 'CONFIRMED' || p.status === 'RECEIVED')
  const totalPaidCents = confirmedPayments.reduce((sum, p) => sum + p.amountCents, 0)
  const nextBillingDate = getNextBillingDate(subscription, latestPayment)
  const nextBillingLong =
    state === 'cancelled' ? null : nextBillingDate ? formatLongDate(nextBillingDate.toISOString()) : null
  const nextBillingShort =
    state === 'cancelled' ? null : nextBillingDate ? formatShortDate(nextBillingDate.toISOString()) : null
  const daysToNext = state === 'cancelled' ? null : daysUntil(nextBillingDate)
  const sinceDate = memberSince(completedPayments)

  const handleCancel = async () => {
    setCancelling(true)
    try {
      await cancelMySubscription()
      message.success('Assinatura cancelada.')
      await Promise.resolve(onCancelled?.())
      await Promise.resolve(onChanged?.())
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setCancelling(false)
    }
  }

  if (state === 'loading') {
    return (
      <div className="sub-dash">
        <div className="sub-dash__loading">
          <Spin size="large" />
        </div>
      </div>
    )
  }

  if (state === 'none') {
    return (
      <div className="sub-dash">
        <header className="sub-dash__header">
          <h2 className="sub-dash__heading">
            <FileTextOutlined aria-hidden />
            Minha assinatura
          </h2>
        </header>
        <div className="sub-dash__empty">
          <p>Você ainda não tem um plano ativo. Contrate para liberar a busca completa e a contratação de criadores.</p>
          {onContractPlan ? (
            <Button type="primary" size="large" onClick={onContractPlan}>
              Ver planos
            </Button>
          ) : null}
        </div>
      </div>
    )
  }

  const showCancel = state === 'active' || state === 'trial'

  return (
    <div className="sub-dash">
      <header className="sub-dash__header">
        <h2 className="sub-dash__heading">
          <FileTextOutlined aria-hidden />
          Minha assinatura
        </h2>
        <StatusBadge state={state} />
      </header>

      <div className="sub-dash__hero">
        <div className="sub-dash__hero-main">
          <div className="sub-dash__hero-left">
            <div className="sub-dash__plan-block">
              <div className="sub-dash__plan-icon" aria-hidden>
                <StarFilled />
              </div>
              <div className="sub-dash__plan-copy">
                <span className="sub-dash__plan-eyebrow">Plano atual</span>
                <h3 className="sub-dash__plan-name">{planName ?? 'Plano Busca Influencer'}</h3>
                {planMeta ? (
                  <p className="sub-dash__plan-price">{formatBrl(planMeta.priceBrl * 100)}<span>/mês</span></p>
                ) : null}
                <Tag
                  className="sub-dash__plan-status"
                  color={state === 'active' || state === 'trial' ? 'success' : state === 'pending' ? 'warning' : 'default'}
                  icon={state === 'active' || state === 'trial' ? <CheckCircleOutlined /> : undefined}
                >
                  {PLAN_BADGE[state]}
                </Tag>

                <div className="sub-dash__plan-actions">
                  {showCancel ? (
                    <Popconfirm
                      title="Cancelar assinatura?"
                      description="Cancela a recorrência. Cobranças futuras não serão geradas. Não dá para desfazer."
                      okText="Sim, cancelar"
                      cancelText="Voltar"
                      okButtonProps={{ danger: true, loading: cancelling }}
                      disabled={cancelling}
                      onConfirm={() => void handleCancel()}
                    >
                      <Button
                        size="small"
                        className="sub-dash__cancel-btn"
                        icon={<DeleteOutlined />}
                        disabled={cancelling}
                      >
                        Cancelar assinatura
                      </Button>
                    </Popconfirm>
                  ) : null}
                  {state === 'cancelled' && onContractPlan ? (
                    <Button type="primary" onClick={onContractPlan}>
                      Contratar novamente
                    </Button>
                  ) : null}
                  {state === 'pending' && onContractPlan ? (
                    <Button type="primary" onClick={onContractPlan}>
                      Concluir pagamento
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <div className="sub-dash__hero-meta">
            <div className="sub-dash__meta-row">
              <CalendarOutlined aria-hidden />
              <div>
                <span>Próxima cobrança</span>
                <strong>{nextBillingLong ?? '—'}</strong>
              </div>
            </div>
            <div className="sub-dash__meta-row">
              <SyncOutlined aria-hidden />
              <div>
                <span>Recorrência</span>
                <strong>{state === 'cancelled' ? 'Encerrada' : 'Mensal'}</strong>
              </div>
            </div>
            <div className="sub-dash__meta-row">
              <CalendarOutlined aria-hidden />
              <div>
                <span>Desde</span>
                <strong>{sinceDate ?? '—'}</strong>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="sub-dash__stats-bar">
        <article className="sub-dash__stats-col sub-dash__stats-col--purple">
          <div className="sub-dash__stats-head">
            <span className="sub-dash__stats-icon-wrap sub-dash__stats-icon-wrap--purple">
              <CreditCardOutlined aria-hidden />
            </span>
            <span className="sub-dash__stats-label">Pagamentos realizados</span>
          </div>
          <strong className="sub-dash__stats-value">{confirmedPayments.length}</strong>
          <small>Últimos 12 meses</small>
        </article>

        <article className="sub-dash__stats-col sub-dash__stats-col--blue">
          <div className="sub-dash__stats-head">
            <span className="sub-dash__stats-icon-wrap sub-dash__stats-icon-wrap--blue">
              <DollarOutlined aria-hidden />
            </span>
            <span className="sub-dash__stats-label">Total pago</span>
          </div>
          <strong className="sub-dash__stats-value">{formatBrl(totalPaidCents)}</strong>
          <small>Valor total pago</small>
        </article>

        <article className="sub-dash__stats-col sub-dash__stats-col--green">
          <div className="sub-dash__stats-head">
            <span className="sub-dash__stats-icon-wrap sub-dash__stats-icon-wrap--green">
              <CalendarOutlined aria-hidden />
            </span>
            <span className="sub-dash__stats-label">Próximo pagamento</span>
          </div>
          <strong className="sub-dash__stats-value">{nextBillingShort ?? '—'}</strong>
          <small>
            {daysToNext == null
              ? 'Sem cobrança agendada'
              : daysToNext === 0
                ? 'Hoje'
                : daysToNext === 1
                  ? 'Em 1 dia'
                  : daysToNext > 0
                    ? `Em ${daysToNext} dias`
                    : 'Vencido'}
          </small>
        </article>
      </div>

      {onOpenPaymentDetail ? (
        <PaymentHistoryTimeline
          payments={completedPayments}
          loading={paymentsLoading}
          onOpenDetail={onOpenPaymentDetail}
        />
      ) : null}
    </div>
  )
}
