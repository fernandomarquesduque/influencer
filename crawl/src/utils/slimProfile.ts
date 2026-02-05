import type { Entity } from '../types/index.js';
import { isBusinessFromEntity } from './entityAccess.js';
import { inferCategoriesFromHashtags } from './inferCategoriesFromHashtags.js';

/**
 * Perfil enxuto para persistência: só o necessário para UI, busca e filtros.
 * Todos os campos vêm de data.user do response Polaris (ou fallbacks em timeline).
 */
export interface SlimProfile extends Record<string, unknown> {
  handle: string;
  username?: string;           // data.user.username
  full_name?: string;         // data.user.full_name
  profile_pic_url?: string;   // data.user.profile_pic_url
  hd_profile_pic_url?: string; // data.user.hd_profile_pic_url_info.url
  id?: string;                // data.user.id
  pk?: string;                // data.user.pk
  followers_count: number;    // data.user.follower_count (API usa singular)
  media_count?: number;       // data.user.media_count
  following_count?: number;   // data.user.following_count
  is_verified?: boolean;     // data.user.is_verified
  is_private?: boolean;      // data.user.is_private
  is_business_account?: boolean; // inferido + data.user
  is_embeds_disabled?: boolean;  // data.user.is_embeds_disabled
  biography?: string;        // data.user.biography
  external_url?: string;     // data.user.external_url
  categories: string[];      // inferido dos posts (hashtags), não vem no body
  latest_reel_media?: number; // data.user.latest_reel_media
  account_type?: number;     // data.user.account_type (1/2/3)
  category?: string;         // data.user.category (filtro estabelecimento)
  address_street?: string;   // data.user.address_street
  city_name?: string;        // data.user.city_name
  zip?: string;              // data.user.zip
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

/** Extrai user do raw: primeiro tenta data.user (Polaris), depois timeline (edges[0].node.user). */
function extractUserFromRaw(raw: unknown): Record<string, unknown> | null {
  const fromPolaris = getIn(raw, 'data.user');
  if (fromPolaris != null && typeof fromPolaris === 'object') return fromPolaris as Record<string, unknown>;
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
 * Estrutura do body da API (Polaris) que importa para o slim:
 *
 *   { data: { user: { ... } }, extensions?, status? }
 *
 * Campos em data.user que usamos (só isso é necessário no slim):
 *
 *   Identidade:  username, full_name, pk, id
 *   Foto:        profile_pic_url, hd_profile_pic_url_info.url
 *   Métricas:    follower_count (→ followers_count), media_count, following_count
 *   Filtros:     account_type (1=pessoal, 2=criador, 3=empresa), category, is_private, is_verified
 *   Local:       address_street, city_name, zip
 *   Bio:         biography, external_url
 *   Outros:      is_embeds_disabled, latest_reel_media, is_business (via isBusinessFromEntity)
 *
 * O que NÃO guardamos (reduz tamanho): friendship_status, bio_links, viewer, extensions,
 * profile_context_*, gating, badges, etc.
 *
 * buildSlimProfile lê primeiro de data.user (Polaris); se não houver, tenta timeline (edges[0].node.user).
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
  const dataUser = getIn(rawProfile, 'data.user') as Record<string, unknown> | undefined;

  const username = (user?.username ?? dataUser?.username ?? key) as string;
  const full_name = (user?.full_name ?? dataUser?.full_name) as string | undefined;
  const profile_pic_url = (user?.profile_pic_url ?? dataUser?.profile_pic_url) as string | undefined;
  const hdPic = user?.hd_profile_pic_url_info ?? dataUser?.hd_profile_pic_url_info;
  const hd_profile_pic_url =
    hdPic != null && typeof hdPic === 'object' && 'url' in (hdPic as object)
      ? String((hdPic as Record<string, unknown>).url)
      : undefined;
  const id = user?.id != null ? String(user.id) : dataUser?.id != null ? String(dataUser.id) : undefined;
  const pk = user?.pk != null ? String(user.pk) : dataUser?.pk != null ? String(dataUser.pk) : undefined;
  const is_verified = user?.is_verified === true || dataUser?.is_verified === true;
  const is_private = user?.is_private === true || dataUser?.is_private === true;
  const is_embeds_disabled = user?.is_embeds_disabled === true || dataUser?.is_embeds_disabled === true;
  const latest_reel_media = toNum(user?.latest_reel_media ?? dataUser?.latest_reel_media);
  const account_type = toNum(user?.account_type ?? dataUser?.account_type) ?? (user?.account_type ?? dataUser?.account_type) as number | undefined;
  const category = (user?.category ?? dataUser?.category ?? deepFind(rawProfile, ['category'])) as string | undefined;
  const toStr = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
  const address_street = toStr(user?.address_street ?? dataUser?.address_street);
  const city_name = toStr(user?.city_name ?? dataUser?.city_name);
  const zip = toStr(user?.zip ?? dataUser?.zip);

  const biographyRaw = user?.biography ?? dataUser?.biography ?? deepFind(rawProfile, ['biography', 'bio']);
  const biography = typeof biographyRaw === 'string' ? biographyRaw : undefined;
  const externalUrlRaw = user?.external_url ?? dataUser?.external_url ?? deepFind(rawProfile, ['external_url', 'external_link']);
  const external_url = typeof externalUrlRaw === 'string' ? externalUrlRaw : undefined;
  const is_business_account = isBusinessFromEntity(rawProfile);

  const mediaCount =
    toNum(dataUser?.media_count) ??
    toNum(user?.media_count) ??
    toNum(deepFind(rawProfile, ['media_count'])) ??
    deepFindCount(rawProfile, 'edge_owner_to_timeline_media');
  const followingCount =
    toNum(dataUser?.following_count) ??
    toNum(user?.following_count) ??
    toNum(deepFind(rawProfile, ['following_count'])) ??
    deepFindCount(rawProfile, 'edge_follow');

  const { hashtags, captionTexts } = collectHashtagsAndCaptions(posts);
  const categories = inferCategoriesFromHashtags(hashtags, captionTexts);

  const collectedAt = String(
    rawProfile._collected_at ?? rawProfile.collected_at ?? new Date().toISOString()
  );

  const followersCount =
    toNum(dataUser?.follower_count) ??
    toNum(user?.follower_count) ??
    toNum(deepFind(rawProfile, ['followers_count', 'follower_count'])) ??
    followersFromDiscovery ?? 0;

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
    is_verified: is_verified || undefined,
    is_private: is_private || undefined,
    is_business_account: is_business_account || undefined,
    is_embeds_disabled: is_embeds_disabled || undefined,
    biography: biography && biography.length > 0 ? biography.slice(0, 1000) : undefined,
    external_url: external_url && external_url.length > 0 ? external_url : undefined,
    categories,
    latest_reel_media,
    ...(account_type !== undefined && { account_type }),
    ...(category !== undefined && category !== '' && { category }),
    ...(address_street !== undefined && { address_street }),
    ...(city_name !== undefined && { city_name }),
    ...(zip !== undefined && { zip }),
    _collected_at: collectedAt,
    _discovered_by: discoveredBy,
    _discovered_value: discoveredValue,
  };
}
