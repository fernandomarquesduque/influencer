/** Rotas e URLs de mídia sem expor @ do influenciador. */

export const PROFILE_ROUTE_PARAM = 'profileRef' as const

const PROFILE_REF_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Identificador opaco (UUID) — não é handle legado. */
export function isProfileRef(value: string | null | undefined): boolean {
  return PROFILE_REF_UUID_RE.test(String(value ?? '').trim())
}

/** Segmento seguro para paths `/api/.../profiles/:profileRef` (só UUID). */
export function profileRefForApiPath(value: string | null | undefined): string {
  return String(value ?? '').trim()
}

export function influencerDetailPath(profileRef: string): string {
  return `/app/influencer/${encodeURIComponent(profileRef)}`
}

export function influencerMediaKitPath(profileRef: string): string {
  return `/app/influencer/${encodeURIComponent(profileRef)}/media-kit`
}

export function influencerSendMessagePath(profileRef: string): string {
  return `/app/influencer/${encodeURIComponent(profileRef)}/send-message`
}

export function campaignInfluencerDetailPath(campaignId: string, profileRef: string): string {
  return `/app/campaigns/${encodeURIComponent(campaignId)}/influencer/${encodeURIComponent(profileRef)}`
}

export function activatePath(profileRef: string): string {
  return `/activate/${encodeURIComponent(profileRef)}`
}

/** URL absoluta de avatar/capa servida pela API (path já inclui /api quando necessário). */
export function resolveMediaUrl(pathOrUrl: string | undefined): string | undefined {
  if (!pathOrUrl || typeof pathOrUrl !== 'string') return undefined
  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) return pathOrUrl
  if (pathOrUrl.startsWith('/api/')) return pathOrUrl
  if (pathOrUrl.startsWith('/')) return `/api${pathOrUrl}`
  return pathOrUrl
}
