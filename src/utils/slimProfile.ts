import type { Entity } from '../types/index.js';
import { isBusinessFromEntity } from './entityAccess.js';
import { inferCategoriesFromHashtags } from './inferCategoriesFromHashtags.js';

/**
 * Perfil avançado do influenciador: dados relevantes para categorização e análise.
 * Inclui métricas (seguidores, seguindo, posts), identidade, bio e categorias inferidas.
 */
export interface SlimProfile extends Record<string, unknown> {
  handle: string;
  username?: string;
  full_name?: string;
  profile_pic_url?: string;
  hd_profile_pic_url?: string;
  id?: string;
  pk?: string;
  /** Seguidores (ex.: 553447). */
  followers_count: number;
  /** Total de posts/mídia do perfil (ex.: 1876). */
  media_count?: number;
  /** Quantas contas o perfil segue (ex.: 1216). */
  following_count?: number;
  /** Quantidade de posts efetivamente extraídos nesta coleta (mínimo visível). */
  media_count_visible: number;
  is_verified?: boolean;
  is_private?: boolean;
  is_business_account?: boolean;
  is_embeds_disabled?: boolean;
  biography?: string;
  external_url?: string;
  categories: string[];
  /** Timestamp do último reel (engagement). */
  latest_reel_media?: number;
  _collected_at: string;
  _discovered_by: string;
  _discovered_value: string;
}

function getIn(obj: unknown, ...paths: string[]): unknown {
  if (obj == null) return undefined;
  for (const path of paths) {
    const parts = path.split('.');
    let current: unknown = obj;
    for (const p of parts) {
      if (current == null || typeof current !== 'object') break;
      current = (current as Record<string, unknown>)[p];
    }
    if (current !== undefined && current !== null) return current;
  }
  return undefined;
}

function deepFind(obj: unknown, keys: string[], seen = new Set<unknown>()): unknown {
  if (obj == null || seen.has(obj)) return undefined;
  if (typeof obj !== 'object') return undefined;
  seen.add(obj);
  const o = obj as Record<string, unknown>;
  for (const k of keys) {
    if (k in o && o[k] !== undefined) return o[k];
  }
  for (const key of Object.keys(o)) {
    const found = deepFind(o[key], keys, seen);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Busca um objeto que tenha uma chave (ex: edge_follow) e dentro dele uma subchave (ex: count). */
function deepFindCount(obj: unknown, edgeKey: string, seen = new Set<unknown>()): number | undefined {
  if (obj == null || seen.has(obj)) return undefined;
  if (typeof obj !== 'object') return undefined;
  seen.add(obj);
  const o = obj as Record<string, unknown>;
  if (edgeKey in o && o[edgeKey] != null && typeof o[edgeKey] === 'object') {
    const count = (o[edgeKey] as Record<string, unknown>).count;
    if (typeof count === 'number' && Number.isFinite(count)) return Math.floor(count);
    if (typeof count === 'string') {
      const n = parseInt(count.replace(/\D/g, ''), 10);
      return Number.isNaN(n) ? undefined : n;
    }
  }
  for (const key of Object.keys(o)) {
    const found = deepFindCount(o[key], edgeKey, seen);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Extrai user do primeiro post da timeline (edges[0].node.user). */
function extractUserFromRaw(raw: unknown): Record<string, unknown> | null {
  const edges = getIn(
    raw,
    'data.xdt_api__v1__feed__user_timeline_graphql_connection.edges'
  );
  if (!Array.isArray(edges) || edges.length === 0) return null;
  const first = edges[0];
  if (first == null || typeof first !== 'object') return null;
  const node = (first as Record<string, unknown>).node;
  if (node == null || typeof node !== 'object') return null;
  const user = (node as Record<string, unknown>).user;
  if (user == null || typeof user !== 'object') return null;
  return user as Record<string, unknown>;
}

/** Coleta hashtags e textos de legenda dos posts para inferir categorias. */
function collectHashtagsAndCaptions(posts: Entity[]): { hashtags: string[]; captionTexts: string[] } {
  const hashtags: string[] = [];
  const captionTexts: string[] = [];
  const seenTags = new Set<string>();

  for (const p of posts) {
    const o = p as Record<string, unknown>;
    const caption = o.caption;
    if (caption != null && typeof caption === 'object') {
      const text = (caption as Record<string, unknown>).text;
      if (typeof text === 'string' && text.length > 0) {
        captionTexts.push(text);
        const matches = text.match(/#[\w\u00C0-\u024F]+/g);
        if (matches) {
          for (const m of matches) {
            const tag = m.slice(1).toLowerCase();
            if (!seenTags.has(tag)) {
              seenTags.add(tag);
              hashtags.push(tag);
            }
          }
        }
      }
    }
  }
  return { hashtags, captionTexts };
}

function toNum(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.floor(v);
  if (typeof v === 'string') {
    const n = parseInt(v.replace(/\D/g, ''), 10);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}

/**
 * Constrói um perfil avançado a partir do response bruto e dos posts:
 * seguidores, seguindo, total de posts, identidade, bio, categorias e metadados.
 */
export function buildSlimProfile(
  rawProfile: Record<string, unknown>,
  handle: string,
  followersFromDiscovery: number,
  posts: Entity[],
  discoveredBy: string,
  discoveredValue: string
): SlimProfile {
  const key = handle.toLowerCase().replace(/^@/, '');
  const user = extractUserFromRaw(rawProfile);

  const username = (user?.username ?? key) as string;
  const full_name = user?.full_name as string | undefined;
  const profile_pic_url = user?.profile_pic_url as string | undefined;
  const hdPic = user?.hd_profile_pic_url_info;
  const hd_profile_pic_url =
    hdPic != null && typeof hdPic === 'object' && 'url' in (hdPic as object)
      ? String((hdPic as Record<string, unknown>).url)
      : undefined;
  const id = user?.id != null ? String(user.id) : undefined;
  const pk = user?.pk != null ? String(user.pk) : undefined;
  const is_verified = user?.is_verified === true;
  const is_private = user?.is_private === true;
  const is_embeds_disabled = user?.is_embeds_disabled === true;
  const latest_reel_media = toNum(user?.latest_reel_media);

  const biography = (deepFind(rawProfile, ['biography', 'bio']) as string | undefined) ?? undefined;
  const external_url = (deepFind(rawProfile, ['external_url', 'external_link']) as string | undefined) ?? undefined;
  const is_business_account = isBusinessFromEntity(rawProfile);

  const mediaCount =
    toNum(deepFind(rawProfile, ['media_count'])) ??
    deepFindCount(rawProfile, 'edge_owner_to_timeline_media');
  const followingCount =
    toNum(deepFind(rawProfile, ['following_count'])) ??
    deepFindCount(rawProfile, 'edge_follow');

  const { hashtags, captionTexts } = collectHashtagsAndCaptions(posts);
  const categories = inferCategoriesFromHashtags(hashtags, captionTexts);

  const collectedAt = String(
    rawProfile._collected_at ?? rawProfile.collected_at ?? new Date().toISOString()
  );

  const followersCount =
    toNum(deepFind(rawProfile, ['followers_count'])) ?? followersFromDiscovery;

  return {
    handle: key,
    username,
    full_name,
    profile_pic_url,
    hd_profile_pic_url,
    id,
    pk,
    followers_count: followersCount,
    ...(mediaCount !== undefined && { media_count: mediaCount }),
    ...(followingCount !== undefined && { following_count: followingCount }),
    media_count_visible: posts.length,
    is_verified: is_verified || undefined,
    is_private: is_private || undefined,
    is_business_account: is_business_account || undefined,
    is_embeds_disabled: is_embeds_disabled || undefined,
    biography: biography && biography.length > 0 ? biography.slice(0, 1000) : undefined,
    external_url: external_url && external_url.length > 0 ? external_url : undefined,
    categories,
    latest_reel_media,
    _collected_at: collectedAt,
    _discovered_by: discoveredBy,
    _discovered_value: discoveredValue,
  };
}
