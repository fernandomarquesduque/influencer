import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import type { ProfileListItem, ProfilesSearchQuery, ProfilesSearchFacets } from '../api'

export interface ListCacheState {
  q: string
  data: ProfileListItem[]
  total: number
  facets: ProfilesSearchFacets | null
  query: ProfilesSearchQuery
  searchInput: string
  /** Posição do scroll da janela ao sair da lista (para restaurar ao voltar). */
  scrollPosition?: number
}

interface ListCacheContextValue {
  getCache: () => ListCacheState | null
  saveCache: (state: ListCacheState) => void
  clearCache: () => void
}

const ListCacheContext = createContext<ListCacheContextValue | null>(null)

export function ListCacheProvider({ children }: { children: ReactNode }) {
  const [cache, setCache] = useState<ListCacheState | null>(null)

  const getCache = useCallback(() => cache, [cache])
  const saveCache = useCallback((state: ListCacheState) => setCache(state), [])
  const clearCache = useCallback(() => setCache(null), [])

  return (
    <ListCacheContext.Provider value={{ getCache, saveCache, clearCache }}>
      {children}
    </ListCacheContext.Provider>
  )
}

export function useListCache() {
  const ctx = useContext(ListCacheContext)
  if (!ctx) return { getCache: () => null, saveCache: () => {}, clearCache: () => {} }
  return ctx
}
