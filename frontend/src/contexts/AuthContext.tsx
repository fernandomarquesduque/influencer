import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { setAuthToken, type AuthScope } from '../api'

const AUTH_TOKEN_KEY = 'auth_token'

export type { AuthScope }

export interface AuthUser {
  id: number
  username: string
  scope: AuthScope
  profile_handle: string | null
}

interface AuthState {
  token: string | null
  user: AuthUser | null
  loading: boolean
}

interface AuthContextValue extends AuthState {
  login: (username: string, password: string) => Promise<void>
  loginWithToken: (token: string, user: AuthUser) => void
  logout: () => void
  refreshUser: () => Promise<void>
  isAdm: boolean
  isPublic: boolean
  canEditProfile: (handle: string) => boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    token: localStorage.getItem(AUTH_TOKEN_KEY),
    user: null,
    loading: true,
  })

  const loadUser = useCallback(async (token: string) => {
    setAuthToken(token)
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data?.user) {
        setState((s) => ({ ...s, user: data.user, loading: false }))
        return
      }
    } catch {
      // ignore
    }
    setAuthToken(null)
    localStorage.removeItem(AUTH_TOKEN_KEY)
    setState((s) => ({ ...s, token: null, user: null, loading: false }))
  }, [])

  useEffect(() => {
    const token = state.token
    if (!token) {
      setAuthToken(null)
      setState((s) => ({ ...s, loading: false }))
      return
    }
    loadUser(token)
  }, [state.token, loadUser])

  const login = useCallback(async (loginId: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: loginId.trim(), password }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data?.error || 'Falha no login')
    }
    const token = data?.token
    if (!token) throw new Error('Resposta inválida do servidor')
    localStorage.setItem(AUTH_TOKEN_KEY, token)
    setAuthToken(token)
    setState({
      token,
      user: data?.user
        ? {
          id: data.user.id,
          username: data.user.username,
          scope: data.user.scope,
          profile_handle: data.user.profile_handle ?? null,
        }
        : null,
      loading: false,
    })
  }, [])

  const loginWithToken = useCallback((token: string, user: AuthUser) => {
    setAuthToken(token)
    localStorage.setItem(AUTH_TOKEN_KEY, token)
    setState({
      token,
      user: {
        id: user.id,
        username: user.username,
        scope: user.scope,
        profile_handle: user.profile_handle ?? null,
      },
      loading: false,
    })
  }, [])

  const logout = useCallback(() => {
    setAuthToken(null)
    localStorage.removeItem(AUTH_TOKEN_KEY)
    setState({ token: null, user: null, loading: false })
  }, [])

  const refreshUser = useCallback(async () => {
    const token = state.token
    if (!token) return
    setAuthToken(token)
    try {
      const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data?.user) {
        setState((s) => ({ ...s, user: data.user }))
      }
    } catch {
      // ignore
    }
  }, [state.token])

  const isAdm = state.user?.scope === 'adm'
  const isPublic = state.user?.scope === 'public'

  const canEditProfile = useCallback(
    (handle: string) => {
      if (!state.user) return false
      if (state.user.scope === 'adm') return true
      if (state.user.scope === 'influencer') {
        const h = (handle || '').replace(/^@/, '').toLowerCase()
        const ph = (state.user.profile_handle || '').replace(/^@/, '').toLowerCase()
        return ph === h
      }
      return false
    },
    [state.user]
  )

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      login,
      loginWithToken,
      logout,
      refreshUser,
      isAdm,
      isPublic,
      canEditProfile,
    }),
    [state, login, loginWithToken, logout, refreshUser, isAdm, isPublic, canEditProfile]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider')
  return ctx
}
