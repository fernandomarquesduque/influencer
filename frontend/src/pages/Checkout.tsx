/**
 * Página de checkout: compra do relatório com créditos.
 * Recebe via location.state: { query: ProfilesSearchQuery, total: number }.
 * Usa CheckoutContent; em sucesso redireciona para a lista da campanha.
 */
import { useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import CheckoutContent from '../components/CheckoutContent/CheckoutContent'
import type { ProfilesSearchQuery } from '../api'

interface CheckoutState {
  query: ProfilesSearchQuery
  total: number
}

export default function Checkout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, loading: authLoading } = useAuth()
  const state = location.state as CheckoutState | null

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      navigate('/login', { replace: true })
      return
    }
    if (!state?.query || typeof state.total !== 'number') {
      navigate('/app', { replace: true })
    }
  }, [authLoading, user, state, navigate])

  if (authLoading || !user) return null
  if (!state?.query || typeof state.total !== 'number') return null

  return (
    <CheckoutContent
      query={state.query}
      total={state.total}
      onSuccess={(campaignId) => navigate(`/app/campaigns/${campaignId}`, { replace: true })}
      onCancel={() => navigate('/app')}
    />
  )
}
