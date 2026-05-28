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
import {
  addFavoritePost,
  fetchFavoritePosts,
  removeFavoritePost,
  type FavoritePostItem,
  type PostItem,
} from '../api'

type FavoritePostsContextValue = {
  count: number
  favoritePostKeys: Set<string>
  countByProfileRef: Map<string, number>
  loading: boolean
  isFavorite: (postKey: string) => boolean
  profileFavoriteCount: (profileRef: string) => number
  toggleFavorite: (post: PostItem) => Promise<boolean>
  /** Adiciona aos favoritos (idempotente). Usado após login com ação pendente. */
  favoritePost: (post: PostItem) => Promise<boolean>
  refresh: () => void
  /** Favoritos ainda não vistos no menu (some ao clicar em Favoritos). */
  unreadFavoritesCount: number
  showFavoritesNotificationBadge: boolean
  acknowledgeFavoritesMenu: () => void
}

const FavoritePostsContext = createContext<FavoritePostsContextValue | null>(null)

const FAVORITES_MENU_ACK_STORAGE = 'favorites_menu_ack_count'

function readMenuAckCount(userId: number): number {
  try {
    const raw = localStorage.getItem(`${FAVORITES_MENU_ACK_STORAGE}_${userId}`)
    const n = raw != null ? Number(raw) : 0
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
  } catch {
    return 0
  }
}

function writeMenuAckCount(userId: number, ackCount: number) {
  try {
    localStorage.setItem(`${FAVORITES_MENU_ACK_STORAGE}_${userId}`, String(Math.max(0, ackCount)))
  } catch {
    /* ignore */
  }
}

function buildCountByProfileRef(items: FavoritePostItem[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const item of items) {
    const ref = (item.profile_ref ?? '').trim()
    if (!ref) continue
    map.set(ref, (map.get(ref) ?? 0) + 1)
  }
  return map
}

export function FavoritePostsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [favoritePostKeys, setFavoritePostKeys] = useState<Set<string>>(new Set())
  const [countByProfileRef, setCountByProfileRef] = useState<Map<string, number>>(new Map())
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [menuAckCount, setMenuAckCount] = useState(0)

  useEffect(() => {
    if (!user || user.scope === 'influencer') {
      setMenuAckCount(0)
      return
    }
    setMenuAckCount(readMenuAckCount(user.id))
  }, [user?.id, user?.scope])

  const applyList = useCallback((items: FavoritePostItem[]) => {
    setFavoritePostKeys(new Set(items.map((i) => i.post_key.trim()).filter(Boolean)))
    setCountByProfileRef(buildCountByProfileRef(items))
    setCount(items.length)
  }, [])

  const refresh = useCallback(() => {
    if (!user || user.scope === 'influencer') {
      setFavoritePostKeys(new Set())
      setCountByProfileRef(new Map())
      setCount(0)
      return
    }
    setLoading(true)
    fetchFavoritePosts()
      .then((res) => applyList(res.items ?? []))
      .catch(() => {
        setFavoritePostKeys(new Set())
        setCountByProfileRef(new Map())
        setCount(0)
      })
      .finally(() => setLoading(false))
  }, [user, applyList])

  useEffect(() => {
    refresh()
  }, [refresh])

  const isFavorite = useCallback((postKey: string) => favoritePostKeys.has(postKey.trim()), [favoritePostKeys])

  const profileFavoriteCount = useCallback(
    (profileRef: string) => countByProfileRef.get((profileRef ?? '').trim()) ?? 0,
    [countByProfileRef]
  )

  const favoritePost = useCallback(
    async (post: PostItem): Promise<boolean> => {
      if (!user || user.scope === 'influencer') return false
      const postKey = (post.key ?? '').trim()
      if (!postKey) return false
      if (favoritePostKeys.has(postKey)) return true
      const profileRef = (post.profile_ref ?? '').trim()
      setFavoritePostKeys((prev) => new Set(prev).add(postKey))
      if (profileRef) {
        setCountByProfileRef((prev) => {
          const next = new Map(prev)
          next.set(profileRef, (next.get(profileRef) ?? 0) + 1)
          return next
        })
      }
      setCount((c) => c + 1)
      try {
        const res = await addFavoritePost(postKey, { profileRef: profileRef || undefined })
        setCount(res.count)
        return true
      } catch {
        setFavoritePostKeys((prev) => {
          const next = new Set(prev)
          next.delete(postKey)
          return next
        })
        if (profileRef) {
          setCountByProfileRef((prev) => {
            const next = new Map(prev)
            const n = (next.get(profileRef) ?? 1) - 1
            if (n <= 0) next.delete(profileRef)
            else next.set(profileRef, n)
            return next
          })
        }
        setCount((c) => Math.max(0, c - 1))
        return false
      }
    },
    [user, favoritePostKeys]
  )

  const toggleFavorite = useCallback(
    async (post: PostItem): Promise<boolean> => {
      if (!user || user.scope === 'influencer') return false
      const postKey = (post.key ?? '').trim()
      if (!postKey) return false
      const profileRef = (post.profile_ref ?? '').trim()
      const wasFav = favoritePostKeys.has(postKey)
      setFavoritePostKeys((prev) => {
        const next = new Set(prev)
        if (wasFav) next.delete(postKey)
        else next.add(postKey)
        return next
      })
      if (profileRef) {
        setCountByProfileRef((prev) => {
          const next = new Map(prev)
          const n = (next.get(profileRef) ?? 0) + (wasFav ? -1 : 1)
          if (n <= 0) next.delete(profileRef)
          else next.set(profileRef, n)
          return next
        })
      }
      setCount((c) => Math.max(0, c + (wasFav ? -1 : 1)))
      try {
        if (wasFav) {
          const res = await removeFavoritePost(postKey)
          setCount(res.count)
        } else {
          const res = await addFavoritePost(postKey, { profileRef: profileRef || undefined })
          setCount(res.count)
        }
        return !wasFav
      } catch {
        setFavoritePostKeys((prev) => {
          const next = new Set(prev)
          if (wasFav) next.add(postKey)
          else next.delete(postKey)
          return next
        })
        if (profileRef) {
          setCountByProfileRef((prev) => {
            const next = new Map(prev)
            const n = (next.get(profileRef) ?? 0) + (wasFav ? 1 : -1)
            if (n <= 0) next.delete(profileRef)
            else next.set(profileRef, n)
            return next
          })
        }
        setCount((c) => Math.max(0, c + (wasFav ? 1 : -1)))
        return wasFav
      }
    },
    [user, favoritePostKeys]
  )

  const unreadFavoritesCount = useMemo(() => {
    if (!user || user.scope === 'influencer') return 0
    return Math.max(0, count - menuAckCount)
  }, [user, count, menuAckCount])

  const showFavoritesNotificationBadge = unreadFavoritesCount > 0

  const acknowledgeFavoritesMenu = useCallback(() => {
    if (!user || user.scope === 'influencer') return
    setMenuAckCount(count)
    writeMenuAckCount(user.id, count)
  }, [user, count])

  const value = useMemo(
    (): FavoritePostsContextValue => ({
      count,
      favoritePostKeys,
      countByProfileRef,
      loading,
      isFavorite,
      profileFavoriteCount,
      toggleFavorite,
      favoritePost,
      refresh,
      unreadFavoritesCount,
      showFavoritesNotificationBadge,
      acknowledgeFavoritesMenu,
    }),
    [
      count,
      favoritePostKeys,
      countByProfileRef,
      loading,
      isFavorite,
      profileFavoriteCount,
      toggleFavorite,
      favoritePost,
      refresh,
      unreadFavoritesCount,
      showFavoritesNotificationBadge,
      acknowledgeFavoritesMenu,
    ]
  )

  return <FavoritePostsContext.Provider value={value}>{children}</FavoritePostsContext.Provider>
}

export function useFavoritePosts(): FavoritePostsContextValue {
  const ctx = useContext(FavoritePostsContext)
  if (!ctx) {
    throw new Error('useFavoritePosts deve ser usado dentro de FavoritePostsProvider')
  }
  return ctx
}

export function useFavoritePostsOptional(): FavoritePostsContextValue | null {
  return useContext(FavoritePostsContext)
}
