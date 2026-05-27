/** Lê parâmetro de URL com fallback ao nome legado (`llm*`). */
export function firstUrlParam(
  params: URLSearchParams,
  key: string,
  legacyKey?: string
): string | null {
  const v = params.get(key)
  if (v != null && v.trim() !== '') return v
  if (legacyKey) {
    const legacy = params.get(legacyKey)
    if (legacy != null && legacy.trim() !== '') return legacy
  }
  return null
}

export function parseUrlStrList(
  params: URLSearchParams,
  key: string,
  legacyKey?: string
): string[] | undefined {
  const raw = firstUrlParam(params, key, legacyKey)
  if (!raw) return undefined
  const arr = raw.split(',').map((x) => x.trim()).filter(Boolean)
  return arr.length ? arr : undefined
}

export function parseUrlBool01(
  params: URLSearchParams,
  key: string,
  legacyKey?: string
): boolean | undefined {
  const raw = firstUrlParam(params, key, legacyKey)
  if (raw === '1' || raw === 'true') return true
  if (raw === '0' || raw === 'false') return false
  return undefined
}
