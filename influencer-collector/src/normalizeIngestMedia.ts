/**
 * Espelho de `backend/src/utils/slimPost.ts` (buildNormalizedPost) — mantenha alinhado ao alterar ingest.
 * Usado no coletor para reduzir heap antes do POST `collector-ingest-full` (nós GraphQL brutos são enormes).
 */

const MAX_COVER_IMAGES = 2;
const MAX_VIDEO_VERSIONS = 1;
const MAX_CAPTION_LENGTH = 2000;

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

function str(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === 'string' && v.length > 0) return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return undefined;
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.floor(v);
  if (typeof v === 'string') {
    const n = parseInt(v.replace(/\D/g, ''), 10);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}

export interface NormalizedPostInfluencer {
  id?: string;
  username?: string;
  full_name?: string;
  is_verified: boolean;
  is_private: boolean;
  profile_pic_url?: string;
  hd_profile_pic_url?: string;
  stable_profile_pic_url?: string;
}

export interface NormalizedPostIdentity {
  id?: string;
  media_pk?: string;
  shortcode: string;
  product_type?: string;
  media_type?: number;
  taken_at?: number;
  collected_at: string;
}

function extractHashtags(text: string | undefined): string[] {
  if (text == null || text.length === 0) return [];
  const matches = text.match(/#[\w\u00C0-\u024F]+/g);
  if (!matches) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of matches) {
    const tag = m.slice(1).toLowerCase();
    if (!seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  }
  return out;
}

export interface NormalizedPostLocation {
  name?: string;
  id?: string;
  pk?: string;
  short_name?: string;
  address_json?: string;
}

export interface NormalizedPostContent {
  caption_text?: string;
  caption_created_at?: number;
  hashtags?: string[];
  has_audio?: boolean;
  accessibility_caption?: string;
  location?: NormalizedPostLocation;
  audio?: {
    audio_type?: string;
    original_audio_title?: string;
    is_explicit?: boolean;
    audio_asset_id?: string;
    ig_artist_username?: string;
  };
}

export interface NormalizedPostMedia {
  original_width?: number;
  original_height?: number;
  cover_images: Array<{ width: number; height: number; url: string }>;
  video_versions: Array<{ width: number; height: number; type?: number; url: string }>;
  stable_cover_url?: string;
}

export interface NormalizedPostMetrics {
  likes?: number;
  comments?: number;
  fb_like_count?: number;
  like_and_view_counts_disabled?: boolean;
  view_count?: number | null;
  video_duration?: number | null;
}

export interface NormalizedPostFlags {
  is_paid_partnership?: boolean;
  can_viewer_reshare?: boolean;
  ig_media_sharing_disabled?: boolean;
  tagged_user_count?: number;
}

export interface NormalizedPost extends Record<string, unknown> {
  influencer: NormalizedPostInfluencer;
  post: NormalizedPostIdentity;
  content: NormalizedPostContent;
  media: NormalizedPostMedia;
  metrics: NormalizedPostMetrics;
  flags: NormalizedPostFlags;
}

export function buildNormalizedPost(media: Record<string, unknown>, collectedAt: string): NormalizedPost {
  const userRaw = media.user ?? media.owner;
  const influencer: NormalizedPostInfluencer = {
    is_verified: false,
    is_private: false,
  };
  if (userRaw != null && typeof userRaw === 'object') {
    const u = userRaw as Record<string, unknown>;
    const hd = u.hd_profile_pic_url_info;
    influencer.id = str(u.id ?? u.pk);
    influencer.username = str(u.username);
    influencer.full_name = str(u.full_name);
    influencer.is_verified = u.is_verified === true;
    influencer.is_private = u.is_private === true;
    influencer.profile_pic_url = str(u.profile_pic_url);
    if (hd != null && typeof hd === 'object' && 'url' in (hd as object)) {
      influencer.hd_profile_pic_url = str((hd as Record<string, unknown>).url);
    }
  }

  const shortcode = str(media.code ?? media.shortcode) ?? '';
  const taken_at =
    num(media.taken_at) ??
    num(media.taken_at_timestamp) ??
    num(getIn(media, 'taken_at')) ??
    num(getIn(media, 'media.taken_at')) ??
    num(getIn(media, 'media.taken_at_timestamp')) ??
    (() => {
      const cap = media.caption;
      if (cap != null && typeof cap === 'object' && 'created_at' in (cap as object))
        return num((cap as Record<string, unknown>).created_at);
      return undefined;
    })();
  const post: NormalizedPostIdentity = {
    id: str(media.id ?? getIn(media, 'id')),
    media_pk: media.pk != null ? str(media.pk) : undefined,
    shortcode,
    product_type: str(media.product_type),
    media_type: num(media.media_type),
    ...(taken_at !== undefined && { taken_at }),
    collected_at: collectedAt,
  };

  const captionObj = media.caption;
  let caption_text: string | undefined;
  let caption_created_at: number | undefined;
  if (captionObj != null && typeof captionObj === 'object') {
    const cap = captionObj as Record<string, unknown>;
    const raw = str(cap.text);
    caption_text =
      raw != null && raw.length > MAX_CAPTION_LENGTH ? raw.slice(0, MAX_CAPTION_LENGTH) + '…' : raw;
    caption_created_at = num(cap.created_at);
  }
  const rawCaptionForHashtags =
    captionObj != null && typeof captionObj === 'object'
      ? str((captionObj as Record<string, unknown>).text)
      : caption_text;
  const hashtags = extractHashtags(rawCaptionForHashtags ?? undefined);

  const accessibility_caption = str(media.accessibility_caption ?? getIn(media, 'accessibility_caption'));
  let location: NormalizedPostLocation | undefined;
  const locRaw = media.location ?? getIn(media, 'location');
  if (locRaw != null && typeof locRaw === 'object') {
    const loc = locRaw as Record<string, unknown>;
    const name = str(loc.name ?? loc.title);
    if (name || loc.id != null || loc.pk != null) {
      location = {
        name,
        id: str(loc.id),
        pk: str(loc.pk),
        short_name: str(loc.short_name),
        address_json: typeof loc.address_json === 'string' ? loc.address_json : undefined,
      };
    }
  }

  const content: NormalizedPostContent = {
    caption_text,
    caption_created_at,
    ...(hashtags.length > 0 && { hashtags }),
    has_audio: media.has_audio === true,
    ...(accessibility_caption && { accessibility_caption }),
    ...(location && (location.name || location.id) && { location }),
  };
  const clipsMeta = media.clips_metadata;
  if (clipsMeta != null && typeof clipsMeta === 'object') {
    const cm = clipsMeta as Record<string, unknown>;
    const origSound = cm.original_sound_info;
    if (origSound != null && typeof origSound === 'object') {
      const os = origSound as Record<string, unknown>;
      const igArtist = os.ig_artist;
      content.audio = {
        audio_type: str(cm.audio_type),
        original_audio_title: str(os.original_audio_title),
        is_explicit: os.is_explicit === true,
        audio_asset_id: str(os.audio_asset_id),
        ig_artist_username:
          igArtist != null && typeof igArtist === 'object' && 'username' in igArtist
            ? str((igArtist as Record<string, unknown>).username)
            : undefined,
      };
    } else {
      content.audio = {
        audio_type: str(cm.audio_type),
      };
    }
  }

  const cover_images: Array<{ width: number; height: number; url: string }> = [];
  const iv2 = media.image_versions2;
  if (iv2 != null && typeof iv2 === 'object' && Array.isArray((iv2 as Record<string, unknown>).candidates)) {
    const candidates = (iv2 as Record<string, unknown>).candidates as unknown[];
    for (const c of candidates) {
      if (cover_images.length >= MAX_COVER_IMAGES) break;
      if (c != null && typeof c === 'object' && 'url' in (c as object)) {
        const co = c as Record<string, unknown>;
        const url = str(co.url);
        const w = num(co.width);
        const h = num(co.height);
        if (url && w != null && h != null) cover_images.push({ width: w, height: h, url });
      }
    }
  }
  const video_versions: Array<{ width: number; height: number; type?: number; url: string }> = [];
  const vv = media.video_versions;
  const seenUrls = new Set<string>();
  if (Array.isArray(vv)) {
    for (const v of vv) {
      if (video_versions.length >= MAX_VIDEO_VERSIONS) break;
      if (v == null || typeof v !== 'object' || !('url' in (v as object))) continue;
      const vo = v as Record<string, unknown>;
      const url = str(vo.url);
      if (!url || seenUrls.has(url)) continue;
      seenUrls.add(url);
      const w = num(vo.width);
      const h = num(vo.height);
      if (w != null && h != null) {
        video_versions.push({
          width: w,
          height: h,
          type: num(vo.type),
          url,
        });
      }
    }
  }
  const mediaSection: NormalizedPostMedia = {
    original_width: num(media.original_width),
    original_height: num(media.original_height),
    cover_images,
    video_versions,
  };

  const likeCount =
    num(media.like_count) ??
    num((media.edge_liked_by as { count?: number } | undefined)?.count) ??
    num(getIn(media, 'edge_media_preview_like.count')) ??
    num((media.edge_media_preview_like as { count?: number } | undefined)?.count);
  const commentCount =
    num(media.comment_count) ??
    num(getIn(media, 'edge_media_to_comment.count')) ??
    num((media.edge_media_to_comment as { count?: number } | undefined)?.count);
  const viewCountRaw =
    media.view_count != null || media.video_view_count != null
      ? num(media.video_view_count ?? media.view_count) ?? null
      : null;
  const video_duration = num(media.video_duration ?? getIn(media, 'video_duration'));

  const metrics: NormalizedPostMetrics = {
    likes: likeCount,
    comments: commentCount,
    fb_like_count: num(media.fb_like_count),
    like_and_view_counts_disabled: media.like_and_view_counts_disabled === true,
    view_count: viewCountRaw,
    ...(video_duration != null && video_duration > 0 && { video_duration }),
  };

  const taggedEdge = media.edge_media_to_tagged_user as { count?: number; edges?: unknown[] } | undefined;
  const tagged_user_count =
    num(taggedEdge?.count) ?? (Array.isArray(taggedEdge?.edges) ? taggedEdge.edges.length : undefined);

  const flags: NormalizedPostFlags = {
    is_paid_partnership: media.is_paid_partnership === true,
    can_viewer_reshare: media.can_viewer_reshare === true,
    ig_media_sharing_disabled: media.ig_media_sharing_disabled === true,
    ...(tagged_user_count !== undefined && tagged_user_count > 0 && { tagged_user_count }),
  };

  return {
    influencer,
    post,
    content,
    media: mediaSection,
    metrics,
    flags,
  };
}
