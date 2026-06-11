/**
 * Meus pagamentos: painel de assinatura + histórico em timeline.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Spin, Alert } from 'antd'
import { useAuth } from '../contexts/AuthContext'
import {
  fetchMyPayments,
  fetchMyPendingPayment,
  fetchMySubscription,
  type PaymentItem,
  type CreatePaymentForCreditsResponse,
  type MySubscriptionStatus,
} from '../api'
import PendingPaymentCard from '../components/PendingPaymentCard/PendingPaymentCard'
import PaymentInvoiceModal from '../components/PaymentInvoiceModal/PaymentInvoiceModal'
import SubscriptionStatusCard from '../components/SubscriptionStatusCard/SubscriptionStatusCard'
import BuscaInfluencerPlansPanel, {
  useBuscaPlansSubscriptionAccess,
} from '../components/BuscaInfluencerPlansModal/BuscaInfluencerPlansPanel'
import {
  clearSubscriptionCancelledLocally,
  isSubscriptionCancelledLocally,
  markSubscriptionCancelledLocally,
} from '../utils/subscriptionCancelledLocal'
import './Payments.css'

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
  const [subscription, setSubscription] = useState<MySubscriptionStatus | null>(null)
  const [subscriptionLoading, setSubscriptionLoading] = useState(user?.scope === 'assinante')
  const [forceSubscriptionCancelled, setForceSubscriptionCancelled] = useState(false)
  const pendingCardRef = useRef<HTMLDivElement | null>(null)
  const userId = user?.id

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

  const loadSubscription = useCallback(async () => {
    if (user?.scope !== 'assinante') {
      setSubscription(null)
      setSubscriptionLoading(false)
      return
    }
    setSubscriptionLoading(true)
    try {
      const sub = await fetchMySubscription()
      const uid = user?.id
      const apiKnowsCancelled =
        Boolean(sub.subscriptionCancelled) ||
        Boolean(sub.planId && !sub.active && !sub.subscriptionId)
      if (apiKnowsCancelled && uid != null) {
        clearSubscriptionCancelledLocally(uid)
        setForceSubscriptionCancelled(false)
      }
      setSubscription(sub)
    } catch {
      setSubscription(null)
    } finally {
      setSubscriptionLoading(false)
    }
  }, [user?.scope, user?.id])

  const refreshAll = useCallback(async () => {
    await Promise.all([loadPayments(), loadPendingPayment(), loadSubscription()])
    refreshPlansAccess()
  }, [loadPayments, loadPendingPayment, loadSubscription, refreshPlansAccess])

  useEffect(() => {
    if (user) void refreshAll()
  }, [user, refreshAll])

  useEffect(() => {
    if (userId != null && isSubscriptionCancelledLocally(userId)) {
      setForceSubscriptionCancelled(true)
    }
  }, [userId])

  const handleSubscriptionCancelled = useCallback(() => {
    if (userId == null) return
    markSubscriptionCancelledLocally(userId)
    setForceSubscriptionCancelled(true)
    setSubscription((prev) =>
      prev
        ? { ...prev, active: false, subscriptionId: null, subscriptionCancelled: true }
        : prev
    )
  }, [userId])

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
  const planPayments = completedPayments.filter((p) => Boolean(p.planId || p.asaasSubscriptionId))
  const hasConfirmedPlanPayment = planPayments.some((p) => p.status === 'CONFIRMED' || p.status === 'RECEIVED')
  const latestPlanPayment = planPayments[0] ?? null
  const planSubscriptionEnded = Boolean(
    latestPlanPayment?.planId &&
      !latestPlanPayment.asaasSubscriptionId &&
      (latestPlanPayment.status === 'CONFIRMED' || latestPlanPayment.status === 'RECEIVED')
  )
  const showSubscriptionPanel = user.scope === 'assinante'

  const scrollToPlans = () => {
    document.querySelector('.payments-page__plans')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const goToPlans = () => {
    if (showPlansPanel) scrollToPlans()
    else navigate('/checkout/plan/basic')
  }

  return (
    <div className="app-page payments-page">
      {error ? (
        <Alert type="error" message={error} showIcon className="payments-page__alert" onClose={() => setError(null)} closable />
      ) : null}

      {showPlansPanel ? (
        <div className="payments-page__plans">
          <BuscaInfluencerPlansPanel className="busca-plans-panel--inline-page" checkSubscription />
        </div>
      ) : null}

      {showSubscriptionPanel ? (
        <SubscriptionStatusCard
          subscription={subscription}
          loading={subscriptionLoading}
          paymentsLoading={loading}
          completedPayments={completedPayments}
          hasConfirmedPlanPayment={hasConfirmedPlanPayment}
          planSubscriptionEnded={planSubscriptionEnded}
          fallbackPlanId={latestPlanPayment?.planId ?? null}
          forceCancelled={forceSubscriptionCancelled}
          onCancelled={handleSubscriptionCancelled}
          onChanged={refreshAll}
          onContractPlan={goToPlans}
          onOpenPaymentDetail={setInvoiceModalPayment}
        />
      ) : null}

      {pendingLoading ? (
        <div ref={pendingCardRef} className="payments-page__pending-loader-wrap">
          <div className="payments-page__pending-loader">
            <Spin size="large" tip="Carregando informações do plano…" />
          </div>
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

      <PaymentInvoiceModal
        open={invoiceModalPayment != null}
        payment={invoiceModalPayment}
        onClose={() => setInvoiceModalPayment(null)}
      />
    </div>
  )
}
