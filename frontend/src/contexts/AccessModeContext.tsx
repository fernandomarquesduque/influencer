import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { fetchAppConfig, type AppAccessMode } from '../api'

export type AccessMode = AppAccessMode

type AccessModeState = {
  accessMode: AccessMode
  openAccess: boolean
  loading: boolean
}

type AccessModeContextValue = AccessModeState & {
  refresh: () => Promise<void>
}

const AccessModeContext = createContext<AccessModeContextValue | null>(null)

export function AccessModeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AccessModeState>({
    accessMode: 'open',
    openAccess: true,
    loading: true,
  })

  const refresh = useCallback(async () => {
    try {
      const cfg = await fetchAppConfig()
      setState({ ...cfg, loading: false })
    } catch {
      setState({ accessMode: 'open', openAccess: true, loading: false })
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void fetchAppConfig({ signal: controller.signal })
      .then((cfg) => {
        if (!controller.signal.aborted) setState({ ...cfg, loading: false })
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setState({ accessMode: 'open', openAccess: true, loading: false })
        }
      })
    return () => controller.abort()
  }, [])

  const value = useMemo<AccessModeContextValue>(
    () => ({ ...state, refresh }),
    [state, refresh]
  )

  return <AccessModeContext.Provider value={value}>{children}</AccessModeContext.Provider>
}

export function useAccessMode(): AccessModeContextValue {
  const ctx = useContext(AccessModeContext)
  if (!ctx) {
    return {
      accessMode: 'open',
      openAccess: true,
      loading: false,
      refresh: async () => undefined,
    }
  }
  return ctx
}
