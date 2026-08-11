import { getFollowersFromProfile } from '../../utils/suggestedPricing.js';
import { redactContactInfoInText } from '../../utils/redactContactInfo.js';
import { profileCoverMediaPath, postMediaKeyFromItem } from '../../utils/profileMediaUrls.js';
import { getLlmQualification } from '../profilesSearch.js';
import { escapeAttr, escapeHtml, stripControlChars, truncateText } from './htmlEscape.js';
import {
  getPublicSiteOrigin,
  seoDirectoryAbsoluteUrl,
  seoInfluencerAbsoluteUrl,
  seoPostPath,
} from './publicSiteUrl.js';

export type SeoTopPost = {
  shortcode: string;
  caption: string;
  likes: number;
  comments: number;
  contentType: string;
  coverUrl: string;
};

export type SeoProfilePageData = {
  handle: string;
  profile: Record<string, unknown>;
  engagement?: {
    engagement_rate?: number;
    posts_count?: number;
    avg_likes?: number;
    total_likes?: number;
  } | null;
  /** Texto de apresentação já resolvido (LLM / bio / legenda). */
  aboutText?: string;
  /** Categorias/hashtags de fallback para nicho. */
  categoryLabels?: string[];
  /** Principais posts (capa + métricas). */
  topPosts?: SeoTopPost[];
};

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

function pickStringField(obj: Record<string, unknown> | null | undefined, keys: string[]): string {
  if (!obj) return '';
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function pickBiography(profile: Record<string, unknown>): string {
  const top = pickStringField(profile, ['biography', 'bio', 'description']);
  if (top) return redactContactInfoInText(top);
  const data = profile.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const user = (data as { user?: unknown }).user;
    if (user && typeof user === 'object' && !Array.isArray(user)) {
      const bio = pickStringField(user as Record<string, unknown>, ['biography', 'bio', 'description']);
      if (bio) return redactContactInfoInText(bio);
    }
  }
  return '';
}

function pickAvatarUrl(profile: Record<string, unknown>, profileRef: string, siteOrigin: string): string {
  const stable = profile.stable_profile_pic_url;
  if (typeof stable === 'string' && stable.startsWith('http')) return stable;
  const pic = profile.profile_pic_url ?? profile.hd_profile_pic_url;
  if (typeof pic === 'string' && pic.startsWith('http')) return pic;
  if (profileRef) return `${siteOrigin}/api/media/p/${encodeURIComponent(profileRef)}/avatar`;
  return '';
}

function formatFollowers(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')} mil`;
  return String(Math.round(n));
}

function formatMetricCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')} mil`;
  return String(Math.round(n));
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

/**
 * Top N posts próprios (exclui tagged) por engajamento (likes + 3× comments),
 * com capa pública e link do Instagram.
 */
export function pickTopSeoPosts(
  posts: Array<{ key: string; value: Record<string, unknown> }>,
  opts: { profileRef: string; siteOrigin?: string; limit?: number }
): SeoTopPost[] {
  const limit = opts.limit ?? 3;
  const scored = posts
    .map(({ key, value }) => {
      const type = postContentType(key, value);
      if (type === 'tagged' || type === 'highlight') return null;
      const shortcode = postShortcode(key, value);
      if (!shortcode) return null;
      const { likes, comments } = postMetrics(value);
      const caption = stripControlChars(redactContactInfoInText(extractPostCaption(value)));
      const mediaKey = postMediaKeyFromItem({ ...value, key }) || shortcode;
      const coverPath = profileCoverMediaPath(opts.profileRef, mediaKey);
      return {
        shortcode,
        caption,
        likes,
        comments,
        contentType: type === 'reel' ? 'Reel' : 'Feed',
        // Relativo à origem da página (Vite/IIS proxy) — evita apontar capa ao domínio de prod no dev.
        coverUrl: coverPath,
        score: likes + comments * 3,
      };
    })
    .filter(Boolean) as Array<SeoTopPost & { score: number }>;

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ score: _s, ...rest }) => rest);
}

function readLlmQualification(profile: Record<string, unknown>): Record<string, unknown> | null {
  const strict = getLlmQualification(profile);
  if (strict) return strict;
  const llm = profile.llm;
  if (llm == null || typeof llm !== 'object' || Array.isArray(llm)) return null;
  const q = (llm as { qualification?: unknown }).qualification;
  if (q == null || typeof q !== 'object' || Array.isArray(q)) return null;
  return q as Record<string, unknown>;
}

function llmBits(profile: Record<string, unknown>): { category: string; description: string; profileType: string } {
  const q = readLlmQualification(profile);
  if (!q) return { category: '', description: '', profileType: '' };
  const category = typeof q.mainCategory === 'string' ? q.mainCategory.trim() : '';
  const description =
    typeof q.personaSummary === 'string'
      ? q.personaSummary.trim()
      : typeof q.personaDescription === 'string'
        ? q.personaDescription.trim()
        : typeof q.description === 'string'
          ? q.description.trim()
          : '';
  const profileType = typeof q.profileType === 'string' ? q.profileType.trim() : '';
  return {
    category: category === '-' ? '' : category,
    description: stripControlChars(description),
    profileType: profileType === '-' ? '' : profileType,
  };
}

function pickCategoryLabels(profile: Record<string, unknown>, extra?: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const t = raw.replace(/^#/, '').trim();
    if (!t) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };
  for (const x of extra ?? []) push(String(x));
  const cats = profile.categories;
  if (Array.isArray(cats)) {
    for (const c of cats) {
      if (typeof c === 'string') push(c);
    }
  }
  return out.slice(0, 4);
}

/** Extrai caption de um item de post do RocksDB. */
export function extractPostCaption(post: Record<string, unknown>): string {
  const content = post.content;
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    const ct = content as Record<string, unknown>;
    const t = pickStringField(ct, ['caption_text', 'text']);
    if (t) return t;
    const cap = ct.caption;
    if (cap && typeof cap === 'object' && !Array.isArray(cap)) {
      const nested = pickStringField(cap as Record<string, unknown>, ['text', 'caption_text']);
      if (nested) return nested;
    }
  }
  const direct = pickStringField(post, ['caption_text', 'caption']);
  if (direct) return direct;
  const p = post.post;
  if (p && typeof p === 'object' && !Array.isArray(p)) {
    return pickStringField(p as Record<string, unknown>, ['caption_text', 'caption']);
  }
  return '';
}

/** Escolhe a melhor legenda entre posts recentes (texto útil, sem ser só emoji/#). */
export function pickBestPostCaption(posts: Record<string, unknown>[]): string {
  let best = '';
  for (const post of posts) {
    const raw = extractPostCaption(post);
    const cleaned = stripControlChars(redactContactInfoInText(raw));
    if (cleaned.length < 40) continue;
    const letters = cleaned.replace(/[^a-zA-ZÀ-ÿ0-9]/g, '');
    if (letters.length < 24) continue;
    if (cleaned.length > best.length) best = cleaned;
    if (best.length >= 180) break;
  }
  return best;
}

export function renderInfluencerSeoHtml(
  data: SeoProfilePageData,
  opts: { profileRef: string }
): string {
  const site = getPublicSiteOrigin();
  const handle = data.handle.replace(/^@/, '').trim().toLowerCase();
  const fullName = pickFullName(data.profile, handle);
  const bio = pickBiography(data.profile);
  const llm = llmBits(data.profile);
  const categories = pickCategoryLabels(data.profile, data.categoryLabels);
  const about = stripControlChars(
    data.aboutText?.trim() ||
      llm.description ||
      bio ||
      (categories.length ? `${fullName} — conteúdo sobre ${categories.join(', ')}.` : '') ||
      `Prévia das métricas deste perfil no Instagram — engajamento, posts e desempenho.`
  );
  const followers = getFollowersFromProfile(data.profile);
  const followersLabel = formatFollowers(followers);
  const er =
    data.engagement && typeof data.engagement.engagement_rate === 'number'
      ? data.engagement.engagement_rate
      : null;
  const postsCount =
    data.engagement && typeof data.engagement.posts_count === 'number'
      ? data.engagement.posts_count
      : null;

  const niche = llm.category || categories[0] || '';
  const title = truncateText(`${fullName} — relatório e métricas | Busca Influencer`, 70);
  const descParts = [
    `Relatório de ${fullName}: engajamento, seguidores e posts analisados`,
    followersLabel ? `${followersLabel} seguidores` : '',
    er != null && Number.isFinite(er) ? `ER ${Math.round(er * 100) / 100}%` : '',
    niche ? niche : '',
  ].filter(Boolean);
  const description = truncateText(descParts.join('. '), 160);
  const canonical = seoInfluencerAbsoluteUrl(handle);
  const avatar = pickAvatarUrl(data.profile, opts.profileRef, site);
  const igUrl = `https://www.instagram.com/${encodeURIComponent(handle)}/`;
  /** Caminhos relativos na UI: localhost e produção no mesmo host. */
  const appUrl = `/app/influencer/${encodeURIComponent(opts.profileRef)}`;
  const searchUrl = `/`;
  const directoryHref = `/influenciadores`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    name: title,
    url: canonical,
    mainEntity: {
      '@type': 'Person',
      name: fullName,
      alternateName: `@${handle}`,
      url: canonical,
      sameAs: [igUrl],
      ...(avatar ? { image: avatar } : {}),
      ...(description ? { description } : {}),
      ...(niche ? { knowsAbout: niche } : {}),
    },
  };

  const erLabel =
    er != null && Number.isFinite(er) ? `${Math.round(er * 100) / 100}%` : '';
  const avgLikes =
    data.engagement && typeof data.engagement.avg_likes === 'number'
      ? data.engagement.avg_likes
      : null;
  const avgLikesLabel =
    avgLikes != null && Number.isFinite(avgLikes) && avgLikes > 0
      ? formatMetricCount(avgLikes)
      : '';

  const metricItems = [
    postsCount != null && postsCount > 0
      ? { value: String(postsCount), label: 'posts' }
      : null,
    followersLabel ? { value: followersLabel, label: 'seguidores' } : null,
    erLabel ? { value: erLabel, label: 'engajamento' } : null,
    avgLikesLabel ? { value: avgLikesLabel, label: 'média likes' } : null,
  ].filter(Boolean) as { value: string; label: string }[];

  const metricsHtml = metricItems.length
    ? `<dl class="metrics">${metricItems
        .map(
          (m) =>
            `<div class="metric"><dt class="metric__value">${escapeHtml(m.value)}</dt><dd class="metric__label">${escapeHtml(m.label)}</dd></div>`
        )
        .join('')}</dl>`
    : '';

  const reportTeaserHtml = `<section class="teaser" aria-label="O que inclui o relatório">
      <h2 class="teaser__title">Prévia do relatório</h2>
      <p class="teaser__sub">Métricas reais deste perfil — abra a análise gráfica completa</p>
      <ul class="teaser__list">
        <li>
          <span class="teaser__icon" aria-hidden="true">01</span>
          <div>
            <strong>Engajamento em gráfico</strong>
            <span>Taxa de interação feed × reels, visual e comparável</span>
          </div>
        </li>
        <li>
          <span class="teaser__icon" aria-hidden="true">02</span>
          <div>
            <strong>Desempenho por publicação</strong>
            <span>Curtidas, comentários e ranking dos melhores posts</span>
          </div>
        </li>
        <li>
          <span class="teaser__icon" aria-hidden="true">03</span>
          <div>
            <strong>Perfil decodificado</strong>
            <span>Seguidores, volume de conteúdo e leitura de nicho</span>
          </div>
        </li>
      </ul>
    </section>`;

  const chips = [
    niche ? `<span class="chip">${escapeHtml(niche)}</span>` : '',
    llm.profileType ? `<span class="chip chip--soft">${escapeHtml(llm.profileType)}</span>` : '',
    ...categories
      .filter((c) => c.toLowerCase() !== niche.toLowerCase())
      .slice(0, 2)
      .map((c) => `<span class="chip chip--soft">${escapeHtml(c)}</span>`),
  ]
    .filter(Boolean)
    .join('');

  const bodyText = escapeHtml(truncateText(about, 600));
  const avatarHtml = avatar
    ? `<img class="avatar" src="${escapeAttr(avatar)}" alt="${escapeAttr(fullName)}" width="128" height="128" loading="eager" />`
    : `<div class="avatar avatar--fallback" aria-hidden="true">${escapeHtml(fullName.slice(0, 1).toUpperCase())}</div>`;

  const topPosts = data.topPosts ?? [];
  const postsHtml = topPosts.length
    ? `<section class="posts" aria-label="Conteúdos analisados">
        <div class="posts__head">
          <h2 class="posts__title">Conteúdos analisados</h2>
          <p class="posts__sub">Amostra do que entra no relatório gráfico</p>
        </div>
        <ul class="posts__grid">
          ${topPosts
            .map((p) => {
              const caption = escapeHtml(truncateText(p.caption || 'Publicação analisada', 90));
              const typeLabel = escapeHtml(p.contentType);
              return `<li class="post-card">
                <a class="post-card__link" href="${escapeAttr(seoPostPath(handle, p.shortcode))}">
                  <div class="post-card__media">
                    <img src="${escapeAttr(p.coverUrl)}" alt="" width="320" height="320" loading="lazy" />
                    <span class="post-card__type">${typeLabel}</span>
                    <div class="post-card__overlay">
                      <span>${escapeHtml(formatMetricCount(p.likes))} likes</span>
                      <span>${escapeHtml(formatMetricCount(p.comments))} com.</span>
                    </div>
                  </div>
                  <p class="post-card__caption">${caption}</p>
                </a>
              </li>`;
            })
            .join('')}
        </ul>
      </section>`
    : '';

  const jsonLdPosts =
    topPosts.length > 0
      ? {
          '@type': 'ItemList',
          name: `Publicações de ${fullName}`,
          itemListElement: topPosts.map((p, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            url: `${site}${seoPostPath(handle, p.shortcode)}`,
            name: truncateText(p.caption || `${fullName} no Instagram`, 80),
          })),
        }
      : null;

  const jsonLdFull = {
    ...jsonLd,
    ...(jsonLdPosts ? { hasPart: jsonLdPosts } : {}),
  };

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeAttr(description)}" />
  <meta name="robots" content="index,follow,max-image-preview:large" />
  <link rel="canonical" href="${escapeAttr(canonical)}" />
  <meta property="og:type" content="profile" />
  <meta property="og:locale" content="pt_BR" />
  <meta property="og:site_name" content="Busca Influencer" />
  <meta property="og:title" content="${escapeAttr(title)}" />
  <meta property="og:description" content="${escapeAttr(description)}" />
  <meta property="og:url" content="${escapeAttr(canonical)}" />
  ${avatar ? `<meta property="og:image" content="${escapeAttr(avatar)}" />` : ''}
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${escapeAttr(title)}" />
  <meta name="twitter:description" content="${escapeAttr(description)}" />
  ${avatar ? `<meta name="twitter:image" content="${escapeAttr(avatar)}" />` : ''}
  <script type="application/ld+json">${JSON.stringify(jsonLdFull).replace(/</g, '\\u003c')}</script>
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
      --brand: #262626;
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
        radial-gradient(900px 420px at 12% -10%, rgba(240,148,51,0.14), transparent 60%),
        radial-gradient(700px 380px at 100% 8%, rgba(188,24,136,0.12), transparent 55%),
        radial-gradient(600px 320px at 50% 100%, rgba(220,39,67,0.08), transparent 50%),
        var(--bg);
    }
    @keyframes rise {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .top {
      position: sticky;
      top: 0;
      z-index: 5;
      backdrop-filter: blur(10px);
      background: rgba(250,250,250,0.88);
      border-bottom: 1px solid var(--line);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 12px 18px;
      max-width: 980px;
      width: 100%;
      margin: 0 auto;
    }
    .brand {
      font-weight: 800;
      font-size: 1rem;
      letter-spacing: -0.02em;
      text-decoration: none;
      color: var(--brand);
    }
    .brand span {
      background: var(--ig);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }
    .top-link {
      font-size: 0.85rem;
      font-weight: 700;
      text-decoration: none;
      color: var(--text);
      padding: 8px 12px;
      border-radius: 8px;
    }
    .top-link:hover { background: #fff; }
    .main {
      flex: 1;
      width: 100%;
      max-width: 980px;
      margin: 0 auto;
      padding: 20px 16px 56px;
      display: flex;
      flex-direction: column;
      gap: 22px;
    }
    .report-badge {
      align-self: center;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 7px 14px;
      border-radius: 999px;
      background: #fff;
      border: 1px solid var(--line);
      font-size: 0.72rem;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--text);
      animation: rise 0.45s ease-out both;
    }
    .report-badge__dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: var(--ig);
      box-shadow: 0 0 0 3px rgba(225,48,108,0.15);
    }
    .profile {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 4px;
      padding: 28px 22px 24px;
      text-align: center;
      animation: rise 0.5s ease-out 0.05s both;
    }
    .profile-hit {
      display: block;
      text-decoration: none;
      color: inherit;
    }
    .profile-hit:focus-visible {
      outline: 2px solid var(--ig-solid);
      outline-offset: 4px;
    }
    .avatar-wrap {
      display: inline-block;
      position: relative;
      margin-bottom: 18px;
      transition: transform 0.18s ease;
    }
    .profile-hit:hover .avatar-wrap { transform: scale(1.03); }
    .avatar-ring {
      position: absolute;
      inset: -5px;
      border-radius: 50%;
      background: var(--ig);
      animation: spin 10s linear infinite;
    }
    .avatar-ring::after {
      content: "";
      position: absolute;
      inset: 3px;
      border-radius: 50%;
      background: #fff;
    }
    .avatar, .avatar--fallback {
      position: relative;
      z-index: 1;
      width: 118px;
      height: 118px;
      border-radius: 50%;
      object-fit: cover;
      display: grid;
      place-items: center;
      background: #efefef;
      border: 3px solid #fff;
    }
    .avatar--fallback {
      font-size: 2.2rem;
      font-weight: 800;
      color: var(--ig-solid);
    }
    h1 {
      margin: 0 0 10px;
      font-size: clamp(1.55rem, 4vw, 2rem);
      font-weight: 800;
      letter-spacing: -0.03em;
      line-height: 1.15;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 6px;
      margin: 0 0 14px;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      padding: 5px 10px;
      border-radius: 4px;
      font-size: 0.72rem;
      font-weight: 700;
      background: #fafafa;
      border: 1px solid var(--line);
      color: var(--text);
    }
    .chip--soft {
      color: var(--muted);
      font-weight: 600;
    }
    .bio {
      margin: 0 auto 20px;
      max-width: 48ch;
      font-size: 0.95rem;
      color: var(--text);
      white-space: pre-wrap;
    }
    .metrics {
      margin: 0 auto 8px;
      padding: 16px 8px 4px;
      border-top: 1px solid var(--line);
      display: grid;
      grid-template-columns: repeat(${Math.max(metricItems.length, 1)}, minmax(0, 1fr));
      gap: 4px;
      max-width: 520px;
    }
    .metric { margin: 0; padding: 8px 4px; }
    .metric__value {
      margin: 0;
      font-size: 1.2rem;
      font-weight: 800;
      letter-spacing: -0.02em;
      line-height: 1.1;
    }
    .metric__label {
      margin: 4px 0 0;
      font-size: 0.68rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--muted);
    }
    .actions {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      margin-top: 18px;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 48px;
      padding: 0 28px;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 800;
      font-size: 0.95rem;
      letter-spacing: -0.01em;
      transition: transform 0.15s ease, filter 0.15s ease;
    }
    .btn:hover { transform: translateY(-1px); filter: brightness(1.05); }
    .btn-primary {
      background: var(--ig);
      color: #fff;
      box-shadow: 0 8px 22px rgba(225, 48, 108, 0.28);
      width: min(360px, 100%);
    }
    .btn-hint {
      margin: 0;
      font-size: 0.78rem;
      font-weight: 600;
      color: var(--muted);
    }
    .teaser {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 4px;
      padding: 22px 20px;
      animation: rise 0.5s ease-out 0.12s both;
    }
    .teaser__title {
      margin: 0 0 4px;
      font-size: 1.05rem;
      font-weight: 800;
      letter-spacing: -0.02em;
      text-align: center;
    }
    .teaser__sub {
      margin: 0 0 18px;
      text-align: center;
      font-size: 0.88rem;
      color: var(--muted);
      font-weight: 600;
    }
    .teaser__list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }
    .teaser__list li {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      padding: 14px 12px;
      background: var(--bg);
      border: 1px solid var(--line);
      border-radius: 4px;
      text-align: left;
    }
    .teaser__icon {
      flex-shrink: 0;
      width: 28px;
      height: 28px;
      display: grid;
      place-items: center;
      font-size: 0.68rem;
      font-weight: 800;
      letter-spacing: -0.02em;
      border-radius: 50%;
      background: var(--ig);
      color: #fff;
      border: none;
    }
    .teaser__list strong {
      display: block;
      font-size: 0.82rem;
      font-weight: 800;
      margin-bottom: 2px;
    }
    .teaser__list span:last-child {
      display: block;
      font-size: 0.75rem;
      color: var(--muted);
      font-weight: 500;
      line-height: 1.35;
    }
    .posts {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 4px;
      padding: 20px 16px 16px;
      animation: rise 0.5s ease-out 0.18s both;
    }
    .posts__head { text-align: center; margin-bottom: 14px; }
    .posts__title {
      margin: 0 0 4px;
      font-size: 1.05rem;
      font-weight: 800;
      letter-spacing: -0.02em;
    }
    .posts__sub {
      margin: 0;
      font-size: 0.85rem;
      color: var(--muted);
      font-weight: 600;
    }
    .posts__grid {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 3px;
    }
    .post-card { margin: 0; min-width: 0; }
    .post-card__link {
      display: block;
      text-decoration: none;
      color: inherit;
    }
    .post-card__media {
      position: relative;
      aspect-ratio: 1 / 1;
      background: #efefef;
      overflow: hidden;
    }
    .post-card__media img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
      transition: transform 0.25s ease;
    }
    .post-card__link:hover .post-card__media img { transform: scale(1.04); }
    .post-card__type {
      position: absolute;
      top: 8px;
      right: 8px;
      z-index: 2;
      padding: 3px 7px;
      border-radius: 4px;
      background: rgba(0,0,0,0.55);
      color: #fff;
      font-size: 0.62rem;
      font-weight: 800;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .post-card__overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 16px;
      background: rgba(0,0,0,0.45);
      color: #fff;
      font-size: 0.9rem;
      font-weight: 800;
      opacity: 0;
      transition: opacity 0.2s ease;
    }
    .post-card__link:hover .post-card__overlay,
    .post-card__link:focus-visible .post-card__overlay { opacity: 1; }
    .post-card__caption {
      margin: 8px 4px 4px;
      font-size: 0.78rem;
      line-height: 1.35;
      color: var(--muted);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .cta-band {
      background: #fff;
      border: 1px solid var(--line);
      border-radius: 4px;
      padding: 22px 18px;
      text-align: center;
      animation: rise 0.5s ease-out 0.22s both;
    }
    .cta-band p {
      margin: 0 0 14px;
      font-size: 0.95rem;
      font-weight: 700;
      color: var(--text);
    }
    .foot {
      padding: 16px 18px 28px;
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 8px 18px;
      font-size: 0.82rem;
      font-weight: 600;
      color: var(--muted);
      border-top: 1px solid var(--line);
      max-width: 980px;
      width: 100%;
      margin: 0 auto;
    }
    .foot a {
      color: var(--muted);
      text-decoration: none;
    }
    .foot a:hover { color: var(--ig-solid); }
    @media (max-width: 720px) {
      .teaser__list { grid-template-columns: 1fr; }
      .post-card__caption { display: none; }
      .post-card__overlay { opacity: 1; background: linear-gradient(transparent 50%, rgba(0,0,0,0.55)); align-items: flex-end; padding-bottom: 10px; font-size: 0.75rem; gap: 12px; }
    }
    @media (max-width: 520px) {
      .metrics { gap: 0; }
      .metric__value { font-size: 1.05rem; }
      .avatar, .avatar--fallback { width: 96px; height: 96px; }
      .profile { padding: 22px 14px 18px; }
      .btn { width: 100%; }
    }
    @media (prefers-reduced-motion: reduce) {
      .avatar-ring, .profile, .teaser, .posts, .cta-band, .report-badge {
        animation: none !important;
      }
    }
  </style>
</head>
<body>
  <div class="page">
    <header class="top">
      <a class="brand" href="${escapeAttr(searchUrl)}">Busca <span>Influencer</span></a>
      <a class="top-link" href="${escapeAttr(searchUrl)}">Buscar perfis</a>
    </header>
    <main class="main">
      <div class="report-badge"><span class="report-badge__dot" aria-hidden="true"></span> Relatório de influenciador</div>
      <article class="profile">
        <a class="profile-hit" href="${escapeAttr(appUrl)}">
          <div class="avatar-wrap">
            <span class="avatar-ring" aria-hidden="true"></span>
            ${avatarHtml}
          </div>
          <h1>${escapeHtml(fullName)}</h1>
          ${chips ? `<div class="chips">${chips}</div>` : ''}
          ${bodyText ? `<p class="bio">${bodyText}</p>` : ''}
          ${metricsHtml}
        </a>
        <div class="actions">
          <a class="btn btn-primary" href="${escapeAttr(appUrl)}">Ver análise gráfica</a>
          <p class="btn-hint">Relatório completo · engajamento · posts</p>
        </div>
      </article>
      ${reportTeaserHtml}
      ${postsHtml}
      <section class="cta-band">
        <p>Quer o relatório completo deste perfil?</p>
        <a class="btn btn-primary" href="${escapeAttr(appUrl)}">Visualizar resultado</a>
      </section>
    </main>
    <footer class="foot">
      <a href="${escapeAttr(directoryHref)}">Todos os influenciadores</a>
      <a href="${escapeAttr(searchUrl)}">Buscar influenciadores</a>
    </footer>
  </div>
</body>
</html>`;
}

export type DirectoryEntry = {
  handle: string;
  href: string;
};

export function renderInfluencersDirectoryHtml(opts: {
  page: number;
  pageSize: number;
  total: number;
  entries: DirectoryEntry[];
}): string {
  const site = getPublicSiteOrigin();
  const totalPages = Math.max(1, Math.ceil(opts.total / opts.pageSize));
  const page = Math.min(Math.max(1, opts.page), totalPages);
  const title =
    page <= 1
      ? 'Influenciadores no Instagram | Busca Influencer'
      : `Influenciadores — página ${page} | Busca Influencer`;
  const description = truncateText(
    `Diretório com ${opts.total.toLocaleString('pt-BR')} influenciadores da base Busca Influencer. Página ${page} de ${totalPages}.`,
    160
  );
  const canonical = seoDirectoryAbsoluteUrl(page);

  const list = opts.entries
    .map(
      (e) =>
        `<li><a href="${escapeAttr(e.href)}">@${escapeHtml(e.handle)}</a></li>`
    )
    .join('\n');

  const prev =
    page > 1
      ? `<a href="${escapeAttr(seoDirectoryAbsoluteUrl(page - 1))}">Anterior</a>`
      : '';
  const next =
    page < totalPages
      ? `<a href="${escapeAttr(seoDirectoryAbsoluteUrl(page + 1))}">Próxima</a>`
      : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeAttr(description)}" />
  <meta name="robots" content="index,follow" />
  <link rel="canonical" href="${escapeAttr(canonical)}" />
  ${page > 1 ? `<link rel="prev" href="${escapeAttr(seoDirectoryAbsoluteUrl(page - 1))}" />` : ''}
  ${page < totalPages ? `<link rel="next" href="${escapeAttr(seoDirectoryAbsoluteUrl(page + 1))}" />` : ''}
  <style>
    body { margin:0; font-family: system-ui, sans-serif; background:#f7f4fb; color:#1a1226; }
    .wrap { max-width: 800px; margin:0 auto; padding:28px 18px 64px; }
    a { color:#68278f; }
    h1 { font-family: Georgia, serif; font-size:1.8rem; }
    ul { columns: 2; gap: 24px; padding-left: 18px; }
    @media (max-width:640px) { ul { columns: 1; } }
    .nav { display:flex; gap:16px; margin: 20px 0; }
    .muted { color:#5b5266; }
  </style>
</head>
<body>
  <div class="wrap">
    <p><a href="${escapeAttr(site)}/">Busca Influencer</a></p>
    <h1>Influenciadores</h1>
    <p class="muted">${escapeHtml(opts.total.toLocaleString('pt-BR'))} perfis · página ${page} de ${totalPages}</p>
    <div class="nav">${prev} ${next}</div>
    <ul>
      ${list}
    </ul>
    <div class="nav">${prev} ${next}</div>
  </div>
</body>
</html>`;
}
