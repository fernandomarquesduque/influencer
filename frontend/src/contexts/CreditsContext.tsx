import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useAuth } from './AuthContext'
import { fetchCredits } from '../api'

interface CreditsState {
  balance: number
  loading: boolean
}

interface CreditsContextValue extends CreditsState {
  refreshCredits: () => Promise<void>
}

const CreditsContext = createContext<CreditsContextValue | null>(null)

export function CreditsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [state, setState] = useState<CreditsState>({ balance: 0, loading: false })

  const loadCredits = useCallback(async () => {
    if (!user) {
      setState({ balance: 0, loading: false })
      return
    }
    setState((s) => ({ ...s, loading: true }))
    try {
      const res = await fetchCredits()
      setState({ balance: res.balance, loading: false })
    } catch {
      setState((s) => ({ ...s, loading: false }))
    }
  }, [user])

  useEffect(() => {
    void loadCredits()
  }, [loadCredits])

  const value = useMemo<CreditsContextValue>(
    () => ({
      balance: state.balance,
      loading: state.loading,
      refreshCredits: loadCredits,
    }),
    [state.balance, state.loading, loadCredits]
  )

  return <CreditsContext.Provider value={value}>{children}</CreditsContext.Provider>
}

export function useCredits(): CreditsContextValue {
  const ctx = useContext(CreditsContext)
  if (!ctx) throw new Error('useCredits deve ser usado dentro de CreditsProvider')
  return ctx
}

/** Retorna null se CreditsProvider não estiver montado (evita quebrar páginas públicas). */
export function useCreditsOptional(): CreditsContextValue | null {
  return useContext(CreditsContext)
}
