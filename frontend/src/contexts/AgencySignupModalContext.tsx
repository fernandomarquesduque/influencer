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
import { App } from 'antd'
import { useAuth } from './AuthContext'
import { useFavoritePostsOptional } from './FavoritePostsContext'
import AgencySignupModal from '../components/AgencySignupModal/AgencySignupModal'
import { addFavorite, type PostItem } from '../api'

export type PendingAuthAction =
  | { kind: 'favorite_post'; post: PostItem }
  | { kind: 'favorite_profile'; profileRef: string; campaignId?: string }

export type OpenSignupModalOptions = {
  pendingAction?: PendingAuthAction
}

type AgencySignupModalContextValue = {
  openSignupModal: (options?: OpenSignupModalOptions) => void
  closeSignupModal: () => void
}

const AgencySignupModalContext = createContext<AgencySignupModalContextValue | null>(null)

function AgencySignupModalHost({
  open,
  onClose,
  onAuthSuccess,
}: {
  open: boolean
  onClose: () => void
  onAuthSuccess: () => void
}) {
  return <AgencySignupModal open={open} onClose={onClose} onAuthSuccess={onAuthSuccess} />
}

export function AgencySignupModalProvider({ children }: { children: ReactNode }) {
  const { message } = App.useApp()
  const { user } = useAuth()
  const favoritePosts = useFavoritePostsOptional()
  const [open, setOpen] = useState(false)
  const pendingActionRef = useRef<PendingAuthAction | null>(null)
  const completingRef = useRef(false)

  const openSignupModal = useCallback(
    (options?: OpenSignupModalOptions) => {
      if (user) return
      pendingActionRef.current = options?.pendingAction ?? null
      setOpen(true)
    },
    [user]
  )

  const closeSignupModal = useCallback(() => {
    setOpen(false)
    pendingActionRef.current = null
  }, [])

  const runPendingAction = useCallback(async () => {
    const action = pendingActionRef.current
    if (!action || completingRef.current) return
    if (!user || user.scope === 'influencer') {
      pendingActionRef.current = null
      return
    }
    completingRef.current = true
    try {
      if (action.kind === 'favorite_post') {
        await favoritePosts?.favoritePost(action.post)
      } else if (action.kind === 'favorite_profile') {
        const ref = action.profileRef.trim()
        if (ref) {
          await addFavorite(ref, action.campaignId ? { campaignId: action.campaignId } : undefined)
          window.dispatchEvent(new CustomEvent('influencer-profile-favorited', { detail: { profileRef: ref } }))
        }
      }
    } catch {
      message.error('Não foi possível salvar nos favoritos. Tente novamente.')
    } finally {
      pendingActionRef.current = null
      completingRef.current = false
    }
  }, [user, favoritePosts, message])

  const handleAuthSuccess = useCallback(() => {
    setOpen(false)
    // pendingAction executado no useEffect quando `user` estiver disponível
  }, [])

  useEffect(() => {
    if (!user || !pendingActionRef.current) return
    void runPendingAction()
  }, [user, runPendingAction])

  const value = useMemo(
    () => ({ openSignupModal, closeSignupModal }),
    [openSignupModal, closeSignupModal]
  )

  return (
    <AgencySignupModalContext.Provider value={value}>
      {children}
      <AgencySignupModalHost open={open} onClose={closeSignupModal} onAuthSuccess={handleAuthSuccess} />
    </AgencySignupModalContext.Provider>
  )
}

export function useAgencySignupModal(): AgencySignupModalContextValue {
  const ctx = useContext(AgencySignupModalContext)
  if (!ctx) {
    throw new Error('useAgencySignupModal deve ser usado dentro de AgencySignupModalProvider')
  }
  return ctx
}

export function useAgencySignupModalOptional(): AgencySignupModalContextValue | null {
  return useContext(AgencySignupModalContext)
}
