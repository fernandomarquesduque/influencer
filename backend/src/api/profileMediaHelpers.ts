/** Extrai URL de foto do perfil (somente servidor — não enviar ao cliente). */

export function getProfilePicUrlFromRecord(profile: Record<string, unknown>): string | undefined {
  const stable = profile.stable_profile_pic_url;
  if (typeof stable === 'string' && stable.startsWith('http')) return stable;
  const top = (profile.profile_pic_url ?? profile.hd_profile_pic_url) as string | undefined;
  if (top && typeof top === 'string' && top.startsWith('http')) return top;
  const data = profile.data;
  if (data != null && typeof data === 'object' && !Array.isArray(data)) {
    const user = (data as { user?: Record<string, unknown> }).user;
    if (user != null && typeof user === 'object') {
      const uStable = user.stable_profile_pic_url;
      if (typeof uStable === 'string' && uStable.startsWith('http')) return uStable;
      const fromUser = (user.profile_pic_url ?? user.hd_profile_pic_url) as string | undefined;
      if (fromUser && typeof fromUser === 'string') return fromUser;
      const hd = user.hd_profile_pic_url_info;
      if (hd != null && typeof hd === 'object' && 'url' in hd) {
        const url = (hd as { url?: string }).url;
        if (url && typeof url === 'string') return url;
      }
    }
  }
  return undefined;
}
