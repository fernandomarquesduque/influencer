import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Spin } from 'antd'
import { useAuth } from '../contexts/AuthContext'
import { fetchMySubscription } from '../api'

const PAYMENTS_PATH = '/app/payments'
const SEARCH_PATH = '/search'

type RequireActiveSubscriptionProps = {
  children: ReactNode
}

/** Assinantes só acessam o app com plano pago; demais perfis passam direto. */
export function RequireActiveSubscription({ children }: RequireActiveSubscriptionProps) {
  const { user, loading: authLoading, isAdm } = useAuth()
  const location = useLocation()
  const [checking, setChecking] = useState(true)
  const [active, setActive] = useState(false)

  const isPaymentsPage =
    location.pathname === PAYMENTS_PATH || location.pathname.startsWith(`${PAYMENTS_PATH}/`)
  const isSearchPage =
    location.pathname === SEARCH_PATH || location.pathname.startsWith(`${SEARCH_PATH}/`)
  const exempt = isAdm || user?.scope !== 'assinante' || isPaymentsPage || isSearchPage

  useEffect(() => {
    if (authLoading) return
    if (!user || exempt) {
      setActive(true)
      setChecking(false)
      return
    }

    let cancelled = false
    setChecking(true)
    void fetchMySubscription()
      .then((sub) => {
        if (cancelled) return
        setActive(sub.active)
      })
      .catch(() => {
        if (cancelled) return
        setActive(false)
      })
      .finally(() => {
        if (!cancelled) setChecking(false)
      })

    return () => {
      cancelled = true
    }
  }, [authLoading, user, exempt])

  if (authLoading || (!exempt && checking)) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    )
  }

  if (!exempt && !active) {
    return <Navigate to={PAYMENTS_PATH} replace state={{ from: location }} />
  }

  return <>{children}</>
}
