/**
 * URL pública do site (canonical, sitemap, links HTML SEO).
 */
export function getPublicSiteOrigin(): string {
  const raw =
    process.env.FRONTEND_BASE_URL?.trim() ||
    process.env.VITE_APP_URL?.trim() ||
    'https://buscainfluencer.com.br';
  return raw.replace(/\/+$/, '');
}

/** Path canônico do perfil indexável: /p/{handle} */
export function seoInfluencerPath(handle: string): string {
  const h = handle.replace(/^@/, '').trim().toLowerCase();
  return `/p/${encodeURIComponent(h)}`;
}

export function seoInfluencerAbsoluteUrl(handle: string): string {
  return `${getPublicSiteOrigin()}${seoInfluencerPath(handle)}`;
}

/** Path canônico do post indexável: /p/{handle}/{shortcode} */
export function seoPostPath(handle: string, shortcode: string): string {
  const h = handle.replace(/^@/, '').trim().toLowerCase();
  const sc = shortcode.trim();
  return `/p/${encodeURIComponent(h)}/${encodeURIComponent(sc)}`;
}

export function seoPostAbsoluteUrl(handle: string, shortcode: string): string {
  return `${getPublicSiteOrigin()}${seoPostPath(handle, shortcode)}`;
}

export function seoDirectoryPath(page = 1): string {
  if (page <= 1) return '/influenciadores';
  return `/influenciadores?page=${page}`;
}

export function seoDirectoryAbsoluteUrl(page = 1): string {
  return `${getPublicSiteOrigin()}${seoDirectoryPath(page)}`;
}
