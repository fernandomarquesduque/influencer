/** Rota principal da busca pública de influenciadores. */
export const SEARCH_ROUTE_PATH = '/' as const

/** `/search` redireciona para `/` — mantido para links antigos. */
export const SEARCH_LEGACY_PATH = '/search' as const

export function isSearchRoute(pathname: string): boolean {
  if (pathname === SEARCH_ROUTE_PATH) return true
  return pathname === SEARCH_LEGACY_PATH || pathname.startsWith(`${SEARCH_LEGACY_PATH}/`)
}

function getMergedSearchParams(search: string, hash: string): URLSearchParams {
  const merged = new URLSearchParams()
  const qs = search?.replace(/^\?/, '').trim()
  if (qs) new URLSearchParams(qs).forEach((v, k) => merged.set(k, v))
  const h = hash?.replace(/^#/, '').trim()
  if (h) new URLSearchParams(h).forEach((v, k) => merged.set(k, v))
  return merged
}

/** Hero inicial em `/` — sem termo de busca e aba Posts (padrão). */
export function isSearchLandingHome(pathname: string, search = '', hash = ''): boolean {
  if (!isSearchRoute(pathname)) return false
  const params = getMergedSearchParams(search, hash)
  if (params.get('q')?.trim()) return false
  return params.get('tab') !== 'influencers'
}
