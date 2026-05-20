import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import type { ReactNode } from 'react'

interface RequireAuthProps {
  children: ReactNode
  /** Se true, redireciona para /login quando não autenticado. */
  requireLogin?: boolean
  /** Se true, apenas adm pode acessar; caso contrário 403 ou redirect. */
  requireAdm?: boolean
}

export function RequireAuth({ children, requireLogin = true, requireAdm = false }: RequireAuthProps) {
  const { token, user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        Carregando…
      </div>
    )
  }

  if (requireLogin && !token) {
    return <Navigate to="/" state={{ from: location }} replace />
  }

  /** Área admin: só `scope === 'adm'`; demais perfis vão para /app (logado) ou /login (sem sessão). */
  if (requireAdm && user?.scope !== 'adm') {
    return (
      <Navigate
        to={token ? '/' : '/'}
        state={!token ? { from: location } : undefined}
        replace
      />
    )
  }

  return <>{children}</>
}
