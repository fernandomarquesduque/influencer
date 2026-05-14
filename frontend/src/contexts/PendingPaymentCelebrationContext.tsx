import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useAuth } from './AuthContext'
import { fetchMyPendingPayment } from '../api'

interface PendingPaymentCelebrationContextValue {
  registerPendingPaymentWatch: (paymentId: string) => void
  /** Há cobrança PIX/boleto pendente (para alerta no header). */
  hasPendingInvoice: boolean
}

const PendingPaymentCelebrationContext = createContext<PendingPaymentCelebrationContextValue | null>(null)

export function PendingPaymentCelebrationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id
  const hasPendingInvoiceRef = useRef(false)
  const [hasPendingInvoice, setHasPendingInvoice] = useState(false)

  const setHasPendingInvoiceIfChanged = useCallback((next: boolean) => {
    if (hasPendingInvoiceRef.current === next) return
    hasPendingInvoiceRef.current = next
    setHasPendingInvoice(next)
  }, [])

  const registerPendingPaymentWatch = useCallback(
    (paymentId: string) => {
      const id = String(paymentId ?? '').trim()
      if (id) setHasPendingInvoiceIfChanged(true)
    },
    [setHasPendingInvoiceIfChanged]
  )

  useEffect(() => {
    if (!userId) {
      hasPendingInvoiceRef.current = false
      setHasPendingInvoice(false)
      return
    }
    let alive = true
    void (async () => {
      try {
        const pending = await fetchMyPendingPayment()
        if (!alive) return
        setHasPendingInvoiceIfChanged(Boolean(pending?.paymentId))
      } catch {
        /* ignore */
      }
    })()
    return () => {
      alive = false
    }
  }, [userId, setHasPendingInvoiceIfChanged])

  const ctx = useMemo(
    () => ({ registerPendingPaymentWatch, hasPendingInvoice }),
    [registerPendingPaymentWatch, hasPendingInvoice]
  )

  return (
    <PendingPaymentCelebrationContext.Provider value={ctx}>
      {children}
    </PendingPaymentCelebrationContext.Provider>
  )
}

/** Registra cobrança recém-criada (badge no header). */
export function useRegisterPendingPaymentWatch(): (paymentId: string) => void {
  const ctx = useContext(PendingPaymentCelebrationContext)
  return ctx?.registerPendingPaymentWatch ?? (() => {})
}

/** Indicador no header: cobrança PIX/boleto ainda não quitada. */
export function usePendingInvoiceBadge(): boolean {
  const ctx = useContext(PendingPaymentCelebrationContext)
  return ctx?.hasPendingInvoice ?? false
}
