import { queueRefreshProfile } from '../api'
import { isProfileRef } from '../constants/profilePaths'

/** Evita enfileirar o mesmo perfil várias vezes na mesma sessão do browser. */
const queuedKeys = new Set<string>()

/** Extrai `profile_ref` de URL de mídia da API (`/api/media/p/<uuid>/...`). */
export function profileRefFromMediaUrl(url: string | undefined | null): string | undefined {
  const u = String(url ?? '').trim()
  if (!u) return undefined
  const m = u.match(/\/media\/p\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\//i)
  return m?.[1]
}

/**
 * Enfileira re-extração do perfil (Playwright → S3) quando uma imagem falha no front.
 * Aceita `profile_ref` (UUID) ou @handle.
 */
export function queueMediaRefreshForProfile(
  profileRefOrHandle: string | undefined | null,
  options?: { priority?: boolean }
): void {
  const key = String(profileRefOrHandle ?? '').replace(/^@/, '').trim()
  if (!key || queuedKeys.has(key)) return
  queuedKeys.add(key)
  void queueRefreshProfile(key, options).catch(() => {
    queuedKeys.delete(key)
  })
}

export function queueMediaRefreshFromPost(
  post: { profile_ref?: string; avatar_url?: string } | undefined | null,
  fallbackProfileRef?: string | null
): void {
  if (!post) {
    queueMediaRefreshForProfile(fallbackProfileRef)
    return
  }
  const ref =
    (typeof post.profile_ref === 'string' && post.profile_ref.trim()) ||
    profileRefFromMediaUrl(post.avatar_url) ||
    fallbackProfileRef
  queueMediaRefreshForProfile(ref)
}

export function isQueueableProfileIdentifier(value: string | undefined | null): boolean {
  const v = String(value ?? '').replace(/^@/, '').trim()
  if (!v) return false
  return isProfileRef(v) || /^[a-z0-9._]{2,}$/i.test(v)
}
