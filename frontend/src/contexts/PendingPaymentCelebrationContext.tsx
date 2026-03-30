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
import { Modal, Button, Typography } from 'antd'
import { CheckCircleFilled } from '@ant-design/icons'
import confetti from 'canvas-confetti'
import { useAuth } from './AuthContext'
import { useCredits } from './CreditsContext'
import { fetchMyPendingPayment, fetchPaymentIfExists } from '../api'

const { Title, Paragraph, Text } = Typography

const POLL_MS = 12_000

function isPaidStatus(status: string): boolean {
  const u = status.trim().toUpperCase()
  return u === 'CONFIRMED' || u === 'RECEIVED' || u === 'DONE' || u === 'RECEIVED_IN_CASH'
}

function fireCelebrationConfetti() {
  const base = { origin: { y: 0.62 } as const, zIndex: 3000 }
  void confetti({ ...base, particleCount: 110, spread: 64, startVelocity: 40 })
  window.setTimeout(() => {
    void confetti({ ...base, particleCount: 70, spread: 95, scalar: 0.88, startVelocity: 32 })
  }, 160)
}

interface CelebratePayload {
  creditsGranted: number
}

interface PendingPaymentCelebrationContextValue {
  registerPendingPaymentWatch: (paymentId: string) => void
  /** Há cobrança PIX/boleto pendente (para alerta no header). */
  hasPendingInvoice: boolean
}

const PendingPaymentCelebrationContext = createContext<PendingPaymentCelebrationContextValue | null>(null)

export function PendingPaymentCelebrationProvider({ children }: { children: ReactNode }) {
  const { user, refreshUser } = useAuth()
  const { refreshCredits } = useCredits()
  const refreshCreditsRef = useRef(refreshCredits)
  const refreshUserRef = useRef(refreshUser)
  refreshCreditsRef.current = refreshCredits
  refreshUserRef.current = refreshUser

  const watchedIdRef = useRef<string | null>(null)
  const celebratedIdsRef = useRef<Set<string>>(new Set())
  const pollLockRef = useRef(false)

  const [celebrateOpen, setCelebrateOpen] = useState<CelebratePayload | null>(null)
  const [hasPendingInvoice, setHasPendingInvoice] = useState(false)

  const registerPendingPaymentWatch = useCallback((paymentId: string) => {
    const id = String(paymentId ?? '').trim()
    if (id) {
      watchedIdRef.current = id
      setHasPendingInvoice(true)
    }
  }, [])

  const runPoll = useCallback(async () => {
    if (!user || pollLockRef.current) return
    pollLockRef.current = true
    try {
      const pending = await fetchMyPendingPayment()
      if (pending?.paymentId) {
        watchedIdRef.current = pending.paymentId
        setHasPendingInvoice(true)
        return
      }
      setHasPendingInvoice(false)
      const wid = watchedIdRef.current
      if (!wid) return
      if (celebratedIdsRef.current.has(wid)) {
        watchedIdRef.current = null
        return
      }
      const detail = await fetchPaymentIfExists(wid)
      if (detail === null) {
        watchedIdRef.current = null
        return
      }
      if (!isPaidStatus(detail.status)) return
      if (celebratedIdsRef.current.has(wid)) return
      celebratedIdsRef.current.add(wid)
      watchedIdRef.current = null
      try {
        await refreshCreditsRef.current()
        await refreshUserRef.current()
      } catch {
        /* best effort */
      }
      fireCelebrationConfetti()
      setCelebrateOpen({ creditsGranted: detail.creditsGranted })
    } catch {
      /* rede — tenta de novo no próximo intervalo */
    } finally {
      pollLockRef.current = false
    }
  }, [user])

  useEffect(() => {
    if (!user) {
      watchedIdRef.current = null
      setHasPendingInvoice(false)
      return
    }
    let alive = true
    void (async () => {
      try {
        const p = await fetchMyPendingPayment()
        if (!alive) return
        if (p?.paymentId) {
          watchedIdRef.current = p.paymentId
          setHasPendingInvoice(true)
        } else {
          setHasPendingInvoice(false)
        }
      } catch {
        /* ignore */
      }
    })()
    return () => {
      alive = false
    }
  }, [user?.id])

  useEffect(() => {
    if (!user) return
    const id = window.setInterval(() => {
      void runPoll()
    }, POLL_MS)
    void runPoll()
    return () => window.clearInterval(id)
  }, [user?.id, runPoll])

  useEffect(() => {
    if (!user) return
    const onVis = () => {
      if (document.visibilityState === 'visible') void runPoll()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [user?.id, runPoll])

  const ctx = useMemo(
    () => ({ registerPendingPaymentWatch, hasPendingInvoice }),
    [registerPendingPaymentWatch, hasPendingInvoice]
  )

  const creditsGranted = celebrateOpen?.creditsGranted ?? 0

  return (
    <PendingPaymentCelebrationContext.Provider value={ctx}>
      {children}
      <Modal
        open={celebrateOpen != null}
        onCancel={() => setCelebrateOpen(null)}
        footer={
          <Button type="primary" size="large" block onClick={() => setCelebrateOpen(null)}>
            Continuar
          </Button>
        }
        centered
        closable
        zIndex={2000}
        maskClosable
        className="payment-celebration-modal"
        title={null}
        destroyOnHidden
      >
        <div className="payment-celebration-modal-body">
          <CheckCircleFilled className="payment-celebration-modal-icon" aria-hidden />
          <Title level={3} className="payment-celebration-modal-title">
            Pagamento recebido!
          </Title>
          <Paragraph className="payment-celebration-modal-lead">
            Obrigado — tudo certo com o seu pagamento.
          </Paragraph>
          {creditsGranted > 0 ? (
            <Text className="payment-celebration-modal-credits">
              <strong>{creditsGranted}</strong> {creditsGranted === 1 ? 'crédito já está' : 'créditos já estão'}{' '}
              disponíveis na sua conta.
            </Text>
          ) : (
            <Text className="payment-celebration-modal-credits">
              A compra foi confirmada e já está disponível para você usar.
            </Text>
          )}
        </div>
      </Modal>
    </PendingPaymentCelebrationContext.Provider>
  )
}

/** Registra o ID da cobrança recém-criada para o polling detectar quando sair de pendente. */
export function useRegisterPendingPaymentWatch(): (paymentId: string) => void {
  const ctx = useContext(PendingPaymentCelebrationContext)
  return ctx?.registerPendingPaymentWatch ?? (() => {})
}

/** Indicador no header: cobrança PIX/boleto ainda não quitada. */
export function usePendingInvoiceBadge(): boolean {
  const ctx = useContext(PendingPaymentCelebrationContext)
  return ctx?.hasPendingInvoice ?? false
}
