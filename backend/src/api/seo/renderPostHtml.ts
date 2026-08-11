import { getFollowersFromProfile } from '../../utils/suggestedPricing.js';
import { redactContactInfoInText } from '../../utils/redactContactInfo.js';
import { profileCoverMediaPath, postMediaKeyFromItem } from '../../utils/profileMediaUrls.js';
import { getLlmQualification } from '../profilesSearch.js';
import { escapeAttr, escapeHtml, stripControlChars, truncateText } from './htmlEscape.js';
import {
  getPublicSiteOrigin,
  seoInfluencerAbsoluteUrl,
  seoInfluencerPath,
  seoPostAbsoluteUrl,
} from './publicSiteUrl.js';
import { extractPostCaption } from './renderInfluencerHtml.js';

export type SeoPostPageData = {
  handle: string;
  shortcode: string;
  contentType: string;
  caption: string;
  likes: number;
  comments: number;
  coverUrl: string;
  takenAt?: number | null;
  profile: Record<string, unknown>;
  authorName: string;
  authorAvatarUrl: string;
  followersLabel: string;
  niche: string;
};

function formatMetricCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')} mil`;
  return String(Math.round(n));
}

function formatFollowers(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')} mil`;
  return String(Math.round(n));
}

function formatTakenAt(ts: number | null | undefined): string {
  if (ts == null || !Number.isFinite(ts) || ts <= 0) return '';
  const ms = ts > 1e12 ? ts : ts * 1000;
  try {
    return new Date(ms).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

function toFiniteNumber(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function postMetrics(post: Record<string, unknown>): { likes: number; comments: number } {
  const metrics = post.metrics;
  if (metrics && typeof metrics === 'object' && !Array.isArray(metrics)) {
    const m = metrics as Record<string, unknown>;
    return {
      likes: toFiniteNumber(m.likes ?? m.like_count),
      comments: toFiniteNumber(m.comments ?? m.comment_count),
    };
  }
  return {
    likes: toFiniteNumber(post.like_count),
    comments: toFiniteNumber(post.comment_count),
  };
}

function postContentType(key: string, post: Record<string, unknown>): string {
  const ct = post.content_type;
  if (typeof ct === 'string' && ct.trim()) return ct.trim().toLowerCase();
  const parts = key.split(':');
  if (parts.length >= 3) return parts[1]!.toLowerCase();
  return 'post';
}

function postShortcode(key: string, post: Record<string, unknown>): string {
  const p = post.post;
  if (p && typeof p === 'object' && !Array.isArray(p)) {
    const sc = (p as { shortcode?: unknown }).shortcode;
    if (typeof sc === 'string' && sc.trim()) return sc.trim();
  }
  if (typeof post.shortcode === 'string' && post.shortcode.trim()) return post.shortcode.trim();
  const parts = key.split(':');
  return (parts[parts.length - 1] || '').trim();
}

function postTakenAt(post: Record<string, unknown>): number | null {
  const p = post.post;
  if (p && typeof p === 'object' && !Array.isArray(p)) {
    const t = (p as { taken_at?: unknown }).taken_at;
    if (typeof t === 'number' && Number.isFinite(t)) return t;
    if (typeof t === 'string' && t.trim()) {
      const n = Number(t);
      if (Number.isFinite(n)) return n;
    }
  }
  const top = post.taken_at;
  if (typeof top === 'number' && Number.isFinite(top)) return top;
  return null;
}

function pickFullName(profile: Record<string, unknown>, handle: string): string {
  const top = typeof profile.full_name === 'string' ? profile.full_name.trim() : '';
  if (top) return top;
  const data = profile.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const user = (data as { user?: unknown }).user;
    if (user && typeof user === 'object' && !Array.isArray(user)) {
      const n = (user as { full_name?: unknown }).full_name;
      if (typeof n === 'string' && n.trim()) return n.trim();
    }
  }
  return handle;
}

function pickAvatarUrl(profile: Record<string, unknown>, profileRef: string, siteOrigin: string): string {
  const stable = profile.stable_profile_pic_url;
  if (typeof stable === 'string' && stable.startsWith('http')) return stable;
  const pic = profile.profile_pic_url ?? profile.hd_profile_pic_url;
  if (typeof pic === 'string' && pic.startsWith('http')) return pic;
  if (profileRef) return `${siteOrigin}/api/media/p/${encodeURIComponent(profileRef)}/avatar`;
  return '';
}

function pickNiche(profile: Record<string, unknown>): string {
  const q = getLlmQualification(profile);
  if (q && typeof q.mainCategory === 'string' && q.mainCategory.trim() && q.mainCategory !== '-') {
    return q.mainCategory.trim();
  }
  const cats = profile.categories;
  if (Array.isArray(cats)) {
    for (const c of cats) {
      if (typeof c === 'string' && c.trim()) return c.trim();
    }
  }
  return '';
}

/**
 * Localiza um post próprio (feed/reel) pelo shortcode dentro do prefixo do handle.
 */
export function findSeoPostItem(
  posts: Array<{ key: string; value: Record<string, unknown> }>,
  shortcode: string
): { key: string; value: Record<string, unknown>; contentType: string; shortcode: string } | null {
  const want = shortcode.trim();
  if (!want) return null;
  for (const { key, value } of posts) {
    const type = postContentType(key, value);
    if (type === 'tagged' || type === 'highlight') continue;
    const sc = postShortcode(key, value);
    if (sc === want) {
      return { key, value, contentType: type === 'reel' ? 'Reel' : 'Feed', shortcode: sc };
    }
  }
  return null;
}

export function buildSeoPostPageData(opts: {
  handle: string;
  profile: Record<string, unknown>;
  profileRef: string;
  postKey: string;
  postValue: Record<string, unknown>;
  contentType: string;
  shortcode: string;
}): SeoPostPageData {
  const site = getPublicSiteOrigin();
  const { likes, comments } = postMetrics(opts.postValue);
  const caption = stripControlChars(
    redactContactInfoInText(extractPostCaption(opts.postValue))
  );
  const mediaKey = postMediaKeyFromItem({ ...opts.postValue, key: opts.postKey }) || opts.shortcode;
  const followers = getFollowersFromProfile(opts.profile);
  return {
    handle: opts.handle,
    shortcode: opts.shortcode,
    contentType: opts.contentType,
    caption,
    likes,
    comments,
    coverUrl: profileCoverMediaPath(opts.profileRef, mediaKey),
    takenAt: postTakenAt(opts.postValue),
    profile: opts.profile,
    authorName: pickFullName(opts.profile, opts.handle),
    authorAvatarUrl: pickAvatarUrl(opts.profile, opts.profileRef, site),
    followersLabel: formatFollowers(followers),
    niche: pickNiche(opts.profile),
  };
}

export function renderPostSeoHtml(
  data: SeoPostPageData,
  opts: { profileRef: string }
): string {
  const site = getPublicSiteOrigin();
  const handle = data.handle.replace(/^@/, '').trim().toLowerCase();
  const fullName = data.authorName;
  const typeLabel = data.contentType;
  const dateLabel = formatTakenAt(data.takenAt);
  const caption = truncateText(data.caption || `${typeLabel} de ${fullName} no Instagram`, 600);
  const title = truncateText(
    `${fullName} — ${typeLabel}: análise e métricas | Busca Influencer`,
    70
  );
  const description = truncateText(
    [
      `Encontre ${fullName} na Busca Influencer`,
      `${typeLabel} com métricas`,
      data.likes > 0 ? `${formatMetricCount(data.likes)} curtidas` : '',
      data.followersLabel ? `${data.followersLabel} seguidores` : '',
      data.niche || 'Ferramenta de busca de influenciadores',
    ]
      .filter(Boolean)
      .join('. '),
    160
  );
  const creatorAvatarHtml = data.authorAvatarUrl
    ? `<img class="creator__avatar" src="${escapeAttr(data.authorAvatarUrl)}" alt="${escapeAttr(fullName)}" width="88" height="88" loading="lazy" />`
    : `<div class="creator__avatar creator__avatar--fallback" aria-hidden="true">${escapeHtml(fullName.slice(0, 1).toUpperCase())}</div>`;
  const creatorSub = [data.niche, data.followersLabel ? `${data.followersLabel} seguidores` : '']
    .filter(Boolean)
    .join(' · ');
  const canonical = seoPostAbsoluteUrl(handle, data.shortcode);
  const profileUrl = seoInfluencerPath(handle);
  const profileAbsolute = seoInfluencerAbsoluteUrl(handle);
  const appUrl = `/app/influencer/${encodeURIComponent(opts.profileRef)}`;
  const searchUrl = `/`;
  const directoryHref = `/influenciadores`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SocialMediaPosting',
    headline: title,
    url: canonical,
    datePublished: data.takenAt
      ? new Date(data.takenAt > 1e12 ? data.takenAt : data.takenAt * 1000).toISOString()
      : undefined,
    articleBody: caption || undefined,
    image: data.coverUrl.startsWith('http') ? data.coverUrl : `${site}${data.coverUrl}`,
    author: {
      '@type': 'Person',
      name: fullName,
      url: profileAbsolute,
      alternateName: `@${handle}`,
      ...(data.authorAvatarUrl ? { image: data.authorAvatarUrl } : {}),
    },
    interactionStatistic: [
      {
        '@type': 'InteractionCounter',
        interactionType: 'https://schema.org/LikeAction',
        userInteractionCount: data.likes,
      },
      {
        '@type': 'InteractionCounter',
        interactionType: 'https://schema.org/CommentAction',
        userInteractionCount: data.comments,
      },
    ],
  };

  const avatarHtml = data.authorAvatarUrl
    ? `<img class="author__avatar" src="${escapeAttr(data.authorAvatarUrl)}" alt="" width="56" height="56" loading="eager" />`
    : `<div class="author__avatar author__avatar--fallback" aria-hidden="true">${escapeHtml(fullName.slice(0, 1).toUpperCase())}</div>`;

  const metricsHtml = `<dl class="metrics">
      <div class="metric"><dt class="metric__value">${escapeHtml(formatMetricCount(data.likes))}</dt><dd class="metric__label">curtidas</dd></div>
      <div class="metric"><dt class="metric__value">${escapeHtml(formatMetricCount(data.comments))}</dt><dd class="metric__label">comentários</dd></div>
      ${
        data.followersLabel
          ? `<div class="metric"><dt class="metric__value">${escapeHtml(data.followersLabel)}</dt><dd class="metric__label">seguidores</dd></div>`
          : ''
      }
    </dl>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeAttr(description)}" />
  <meta name="robots" content="index,follow,max-image-preview:large" />
  <link rel="canonical" href="${escapeAttr(canonical)}" />
  <meta property="og:type" content="article" />
  <meta property="og:locale" content="pt_BR" />
  <meta property="og:site_name" content="Busca Influencer" />
  <meta property="og:title" content="${escapeAttr(title)}" />
  <meta property="og:description" content="${escapeAttr(description)}" />
  <meta property="og:url" content="${escapeAttr(canonical)}" />
  <meta property="og:image" content="${escapeAttr(data.coverUrl.startsWith('http') ? data.coverUrl : `${site}${data.coverUrl}`)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeAttr(title)}" />
  <meta name="twitter:description" content="${escapeAttr(description)}" />
  <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@500;600;700;800&display=swap" rel="stylesheet" />
  <style>
    :root {
      color-scheme: light;
      --text: #262626;
      --muted: #8e8e8e;
      --line: #dbdbdb;
      --bg: #fafafa;
      --panel: #ffffff;
      --ig: linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%);
      --ig-solid: #e1306c;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; }
    body {
      font-family: Montserrat, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--text);
      background: var(--bg);
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }
    a { color: var(--ig-solid); }
    .page {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      background:
        radial-gradient(900px 420px at 12% -10%, rgba(240,148,51,0.12), transparent 60%),
        radial-gradient(700px 380px at 100% 8%, rgba(188,24,136,0.1), transparent 55%),
        var(--bg);
    }
    @keyframes rise {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .top {
      position: sticky; top: 0; z-index: 5;
      backdrop-filter: blur(10px);
      background: rgba(250,250,250,0.88);
      border-bottom: 1px solid var(--line);
      display: flex; align-items: center; justify-content: space-between; gap: 16px;
      padding: 12px 18px; max-width: 980px; width: 100%; margin: 0 auto;
    }
    .brand {
      font-weight: 800; font-size: 1rem; letter-spacing: -0.02em;
      text-decoration: none; color: var(--text);
    }
    .brand span {
      background: var(--ig); -webkit-background-clip: text; background-clip: text; color: transparent;
    }
    .top-link {
      font-size: 0.85rem; font-weight: 700; text-decoration: none; color: var(--text);
      padding: 8px 12px; border-radius: 8px;
    }
    .main {
      flex: 1; width: 100%; max-width: 980px; margin: 0 auto;
      padding: 20px 16px 56px; display: flex; flex-direction: column; gap: 18px;
    }
    .badge {
      align-self: center; display: inline-flex; align-items: center; gap: 8px;
      padding: 7px 14px; border-radius: 999px; background: #fff; border: 1px solid var(--line);
      font-size: 0.72rem; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase;
      animation: rise 0.45s ease-out both;
    }
    .badge__dot {
      width: 8px; height: 8px; border-radius: 50%; background: var(--ig);
      box-shadow: 0 0 0 3px rgba(225,48,108,0.15);
    }
    .card {
      background: var(--panel); border: 1px solid var(--line); border-radius: 4px;
      overflow: hidden; animation: rise 0.5s ease-out 0.05s both;
    }
    .layout {
      display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
    }
    .cover {
      position: relative; background: #efefef; min-height: 320px;
    }
    .cover img {
      width: 100%; height: 100%; object-fit: cover; display: block; min-height: 420px;
    }
    .cover__type {
      position: absolute; top: 12px; left: 12px;
      padding: 5px 10px; border-radius: 4px; background: rgba(0,0,0,0.6); color: #fff;
      font-size: 0.7rem; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase;
    }
    .side { padding: 22px 20px 24px; display: flex; flex-direction: column; gap: 16px; }
    .author {
      display: flex; align-items: center; gap: 12px; text-decoration: none; color: inherit;
    }
    .author__avatar, .author__avatar--fallback {
      width: 56px; height: 56px; border-radius: 50%; object-fit: cover;
      display: grid; place-items: center; background: #efefef; border: 2px solid #fff;
      box-shadow: 0 0 0 2px transparent; background-image: var(--ig); background-origin: border-box;
    }
    .author__avatar--fallback {
      font-weight: 800; color: #fff; font-size: 1.2rem;
      background: var(--ig);
    }
    .author__meta { min-width: 0; text-align: left; }
    .author__name {
      margin: 0; font-size: 1rem; font-weight: 800; letter-spacing: -0.02em;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .author__sub { margin: 2px 0 0; font-size: 0.78rem; color: var(--muted); font-weight: 600; }
    h1 {
      margin: 0; font-size: clamp(1.15rem, 2.8vw, 1.45rem); font-weight: 800;
      letter-spacing: -0.02em; line-height: 1.25;
    }
    .meta-line {
      margin: 0; font-size: 0.8rem; color: var(--muted); font-weight: 600;
    }
    .caption {
      margin: 0; font-size: 0.92rem; white-space: pre-wrap; color: var(--text);
    }
    .metrics {
      margin: 0; padding: 14px 0 0; border-top: 1px solid var(--line);
      display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px;
    }
    .metric { margin: 0; text-align: center; }
    .metric__value { margin: 0; font-size: 1.15rem; font-weight: 800; letter-spacing: -0.02em; }
    .metric__label {
      margin: 4px 0 0; font-size: 0.65rem; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted);
    }
    .actions { display: flex; flex-direction: column; align-items: stretch; gap: 8px; margin-top: auto; }
    .btn {
      display: inline-flex; align-items: center; justify-content: center;
      min-height: 48px; padding: 0 20px; border-radius: 8px; text-decoration: none;
      font-weight: 800; font-size: 0.92rem;
    }
    .btn-primary { background: var(--ig); color: #fff; box-shadow: 0 8px 22px rgba(225,48,108,0.28); }
    .btn-ghost {
      background: #fff; color: var(--text); border: 1px solid var(--line); font-weight: 700;
    }
    .btn-hint { margin: 0; text-align: center; font-size: 0.75rem; color: var(--muted); font-weight: 600; }
    .creator {
      width: 100%;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 4px;
      padding: 22px 20px;
      animation: rise 0.5s ease-out 0.1s both;
    }
    .creator__inner {
      display: flex;
      align-items: center;
      gap: 18px;
      flex-wrap: wrap;
    }
    .creator__avatar, .creator__avatar--fallback {
      width: 88px; height: 88px; border-radius: 50%; object-fit: cover; flex-shrink: 0;
      display: grid; place-items: center;
      border: 3px solid #fff;
      box-shadow: 0 0 0 2px #e1306c55;
    }
    .creator__avatar--fallback {
      font-size: 1.8rem; font-weight: 800; color: #fff; background: var(--ig);
    }
    .creator__body { flex: 1; min-width: 200px; }
    .creator__label {
      margin: 0 0 4px; font-size: 0.7rem; font-weight: 800; letter-spacing: 0.06em;
      text-transform: uppercase; color: var(--muted);
    }
    .creator__name {
      margin: 0 0 4px; font-size: 1.25rem; font-weight: 800; letter-spacing: -0.02em;
    }
    .creator__name a { color: inherit; text-decoration: none; }
    .creator__name a:hover { color: var(--ig-solid); }
    .creator__meta { margin: 0 0 8px; font-size: 0.88rem; color: var(--muted); font-weight: 600; }
    .creator__pitch {
      margin: 0; font-size: 0.92rem; color: var(--text); max-width: 54ch; line-height: 1.45;
    }
    .creator__actions {
      display: flex; flex-direction: column; gap: 8px; flex-shrink: 0;
      min-width: min(220px, 100%);
    }
    .platform {
      background: var(--panel); border: 1px solid var(--line); border-radius: 4px;
      padding: 20px; animation: rise 0.5s ease-out 0.14s both; text-align: center;
    }
    .platform h2 { margin: 0 0 6px; font-size: 1.05rem; font-weight: 800; }
    .platform > p { margin: 0 0 14px; font-size: 0.9rem; color: var(--muted); font-weight: 600; }
    .platform ul {
      list-style: none; margin: 0 0 16px; padding: 0;
      display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px;
      text-align: left;
    }
    .platform li {
      padding: 12px; background: var(--bg); border: 1px solid var(--line); border-radius: 4px;
    }
    .platform strong { display: block; font-size: 0.82rem; font-weight: 800; margin-bottom: 2px; }
    .platform li span { display: block; font-size: 0.75rem; color: var(--muted); font-weight: 500; }
    .platform__actions {
      display: flex; flex-wrap: wrap; justify-content: center; gap: 10px;
    }
    .cta-band {
      background: #fff; border: 1px solid var(--line); border-radius: 4px;
      padding: 22px 18px; text-align: center; animation: rise 0.5s ease-out 0.18s both;
    }
    .cta-band p { margin: 0 0 14px; font-weight: 700; }
    .foot {
      padding: 16px 18px 28px; display: flex; flex-wrap: wrap; justify-content: center;
      gap: 8px 18px; font-size: 0.82rem; font-weight: 600; color: var(--muted);
      border-top: 1px solid var(--line); max-width: 980px; width: 100%; margin: 0 auto;
    }
    .foot a { color: var(--muted); text-decoration: none; }
    .foot a:hover { color: var(--ig-solid); }
    @media (max-width: 820px) {
      .layout { grid-template-columns: 1fr; }
      .cover img { min-height: 280px; max-height: 70vh; }
      .platform ul { grid-template-columns: 1fr; }
      .creator__inner { flex-direction: column; align-items: flex-start; }
      .creator__actions { width: 100%; }
    }
    @media (prefers-reduced-motion: reduce) {
      .badge, .card, .creator, .platform, .cta-band { animation: none !important; }
    }
  </style>
</head>
<body>
  <div class="page">
    <header class="top">
      <a class="brand" href="${escapeAttr(searchUrl)}">Busca <span>Influencer</span></a>
      <a class="top-link" href="${escapeAttr(searchUrl)}">Buscar influenciadores</a>
    </header>
    <main class="main">
      <div class="badge"><span class="badge__dot" aria-hidden="true"></span> Busca de influenciadores</div>
      <article class="card">
        <div class="layout">
          <div class="cover">
            <img src="${escapeAttr(data.coverUrl)}" alt="" width="640" height="640" loading="eager" />
            <span class="cover__type">${escapeHtml(typeLabel)}</span>
          </div>
          <div class="side">
            <a class="author" href="${escapeAttr(profileUrl)}">
              ${avatarHtml}
              <div class="author__meta">
                <p class="author__name">${escapeHtml(fullName)}</p>
                <p class="author__sub">${escapeHtml(creatorSub || 'Influenciador no Instagram')}</p>
              </div>
            </a>
            <h1>${escapeHtml(truncateText(caption || `${typeLabel} analisado`, 120))}</h1>
            ${dateLabel ? `<p class="meta-line">Publicado em ${escapeHtml(dateLabel)}</p>` : ''}
            ${caption && caption.length > 120 ? `<p class="caption">${escapeHtml(caption)}</p>` : ''}
            ${metricsHtml}
            <div class="actions">
              <a class="btn btn-primary" href="${escapeAttr(appUrl)}">Ver análise gráfica</a>
              <a class="btn btn-ghost" href="${escapeAttr(profileUrl)}">Ver influenciador</a>
              <p class="btn-hint">Encontre perfis · compare métricas · feche campanhas</p>
            </div>
          </div>
        </div>
      </article>
      <section class="creator" aria-label="Sobre o influenciador">
        <div class="creator__inner">
          <a href="${escapeAttr(profileUrl)}">${creatorAvatarHtml}</a>
          <div class="creator__body">
            <p class="creator__label">Influenciador</p>
            <h2 class="creator__name"><a href="${escapeAttr(profileUrl)}">${escapeHtml(fullName)}</a></h2>
            ${creatorSub ? `<p class="creator__meta">${escapeHtml(creatorSub)}</p>` : ''}
            <p class="creator__pitch">
              Este perfil está na Busca Influencer — a ferramenta para encontrar influenciadores no Instagram,
              ver métricas reais e escolher quem faz sentido para a sua campanha.
            </p>
          </div>
          <div class="creator__actions">
            <a class="btn btn-primary" href="${escapeAttr(profileUrl)}">Abrir perfil completo</a>
            <a class="btn btn-ghost" href="${escapeAttr(searchUrl)}">Buscar outros influenciadores</a>
          </div>
        </div>
      </section>
      <section class="platform">
        <h2>Busca Influencer</h2>
        <p>Ferramenta de busca de influenciadores com relatório de engajamento</p>
        <ul>
          <li><strong>Encontre por nicho</strong><span>Filtre perfis pelo que importa para a marca</span></li>
          <li><strong>Veja métricas reais</strong><span>Curtidas, comentários e taxa de engajamento</span></li>
          <li><strong>Compare e decida</strong><span>Escolha o influenciador certo com dados</span></li>
        </ul>
        <div class="platform__actions">
          <a class="btn btn-primary" href="${escapeAttr(searchUrl)}">Começar a buscar</a>
          <a class="btn btn-ghost" href="${escapeAttr(directoryHref)}">Ver todos os influenciadores</a>
        </div>
      </section>
      <section class="cta-band">
        <p>Pronto para achar o próximo influenciador da sua campanha?</p>
        <a class="btn btn-primary" href="${escapeAttr(searchUrl)}">Buscar influenciadores</a>
      </section>
    </main>
    <footer class="foot">
      <a href="${escapeAttr(profileUrl)}">Perfil de ${escapeHtml(fullName)}</a>
      <a href="${escapeAttr(directoryHref)}">Todos os influenciadores</a>
      <a href="${escapeAttr(searchUrl)}">Buscar influenciadores</a>
    </footer>
  </div>
</body>
</html>`;
}
