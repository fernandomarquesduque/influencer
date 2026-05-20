/** Caminhos públicos de mídia (sem @ do influenciador). Prefixo relativo à API. */

export const PROFILE_MEDIA_PREFIX = '/api/media/p';

export function profileAvatarMediaPath(profileRef: string): string {
  return `${PROFILE_MEDIA_PREFIX}/${encodeURIComponent(profileRef)}/avatar`;
}

export function profileCoverMediaPath(profileRef: string, mediaKey: string): string {
  const key = encodeURIComponent(mediaKey.replace(/[^a-zA-Z0-9._-]/g, '_'));
  return `${PROFILE_MEDIA_PREFIX}/${encodeURIComponent(profileRef)}/covers/${key}`;
}

/** Chave de capa de post/reel para URL de mídia (sem handle). */
export function postMediaKeyFromItem(item: Record<string, unknown>): string | null {
  const post = item.post as Record<string, unknown> | undefined;
  const raw = post?.id ?? post?.media_pk ?? post?.shortcode ?? item.key;
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const parts = s.split(':');
  if (parts.length >= 3) return parts.slice(2).join(':') || parts[parts.length - 1]!;
  if (parts.length === 2) return parts[1]!;
  return s.replace(/[^a-zA-Z0-9._-]/g, '_') || null;
}
