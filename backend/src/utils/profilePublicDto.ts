import type { RequestWithAuth } from '../auth/middleware.js';
import type { ProfileRefDb } from '../storage/profileRefDb.js';
import type { ProfileListItem } from '../api/profilesSearch.js';
import { profileAvatarMediaPath, profileCoverMediaPath, postMediaKeyFromItem } from './profileMediaUrls.js';
import { redactContactInfoInProfile, redactContactInfoInPostItems, redactContactInfoInProfileListItem } from './redactContactInfo.js';
import { shouldIncludeHandleInApi } from './influencerIdentityAccess.js';

const HANDLE_FIELDS = ['handle', 'username', 'key'] as const;

function stripHandleFields(obj: Record<string, unknown>): void {
  for (const k of HANDLE_FIELDS) {
    delete obj[k];
  }
  if (obj.data != null && typeof obj.data === 'object' && !Array.isArray(obj.data)) {
    const data = { ...(obj.data as Record<string, unknown>) };
    const user = data.user;
    if (user != null && typeof user === 'object' && !Array.isArray(user)) {
      const u = { ...(user as Record<string, unknown>) };
      delete u.username;
      data.user = u;
    }
    obj.data = data;
  }
}

function stripRawImageUrls(obj: Record<string, unknown>): void {
  delete obj.profile_pic_url;
  delete obj.hd_profile_pic_url;
  delete obj.stable_profile_pic_url;
}

export type SanitizeProfileOptions = {
  profileRef: string;
  /** Admin: mantém handle no JSON (ferramentas internas). */
  includeHandleForAdmin?: boolean;
  handle?: string;
  avatarPath?: string;
};

export function sanitizeProfileForClient(
  profile: Record<string, unknown>,
  opts: SanitizeProfileOptions
): Record<string, unknown> {
  const out = redactContactInfoInProfile({ ...profile }) as Record<string, unknown>;
  const avatarPath = opts.avatarPath ?? profileAvatarMediaPath(opts.profileRef);
  out.profile_ref = opts.profileRef;
  out.avatar_url = avatarPath;
  if (opts.handle) {
    const h = opts.handle.replace(/^@/, '').trim();
    if (h) {
      out.instagram_profile_url = `https://www.instagram.com/${encodeURIComponent(h)}/`;
    }
  }
  if (opts.includeHandleForAdmin && opts.handle) {
    out.handle = opts.handle;
    out.username = opts.handle;
    out.key = opts.handle;
  } else {
    stripHandleFields(out);
    stripRawImageUrls(out);
  }
  return out;
}

export function buildPublicProfilePreviewDto(
  profileRef: string,
  profile: Record<string, unknown>,
  engagement: Record<string, unknown>,
  engagementByType: unknown,
  pickDisplayFields: (p: Record<string, unknown>) => Record<string, unknown>
): Record<string, unknown> {
  const followers =
    typeof profile.followers_count === 'number'
      ? profile.followers_count
      : 0;
  const out: Record<string, unknown> = {
    profile_ref: profileRef,
    avatar_url: profileAvatarMediaPath(profileRef),
    followers_count: followers > 0 ? followers : null,
    _redacted: true,
    _all_base_preview: true,
    engagement,
    engagementByType,
    ...pickDisplayFields(profile),
  };
  const llm = profile.llm;
  if (llm != null && typeof llm === 'object' && !Array.isArray(llm)) {
    out.llm = llm;
  }
  return out;
}

export function sanitizeProfileListItemForClient(
  item: ProfileListItem,
  profileRef: string,
  includeHandleForAdmin?: boolean
): ProfileListItem {
  const base = redactContactInfoInProfileListItem(item as Record<string, unknown>) as ProfileListItem;
  const out = { ...base } as ProfileListItem & { profile_ref: string; avatar_url: string };
  out.profile_ref = profileRef;
  out.avatar_url = profileAvatarMediaPath(profileRef);
  out.key = profileRef;
  if (!includeHandleForAdmin) {
    delete (out as Record<string, unknown>).handle;
    delete out.profile_pic_url;
    delete out.hd_profile_pic_url;
    delete out.stable_profile_pic_url;
  } else {
    out.handle = item.handle;
  }
  return out;
}

export function sanitizePostItemsForClient(
  items: Array<{ key: string; [k: string]: unknown }>,
  profileRef: string,
  includeHandleForAdmin?: boolean
): Array<Record<string, unknown>> {
  return redactContactInfoInPostItems(items).map((item) => {
    const out = { ...item } as Record<string, unknown>;
    const mediaKey = postMediaKeyFromItem(out);
    if (mediaKey) {
      (out as { cover_url?: string }).cover_url = profileCoverMediaPath(profileRef, mediaKey);
    }
    if (out.media && typeof out.media === 'object' && !Array.isArray(out.media)) {
      const media = { ...(out.media as Record<string, unknown>) };
      delete media.stable_cover_url;
      const covers = media.cover_images;
      if (Array.isArray(covers)) {
        media.cover_images = covers.map((c) => {
          if (c == null || typeof c !== 'object') return c;
          const copy = { ...(c as Record<string, unknown>) };
          delete copy.url;
          return copy;
        });
      }
      const videos = media.video_versions;
      if (Array.isArray(videos)) {
        media.video_versions = videos.map((v) => {
          if (v == null || typeof v !== 'object') return v;
          const copy = { ...(v as Record<string, unknown>) };
          delete copy.url;
          return copy;
        });
      }
      out.media = media;
    }
    delete out.image_url;
    if (out.influencer && typeof out.influencer === 'object' && !Array.isArray(out.influencer)) {
      const inf = { ...(out.influencer as Record<string, unknown>) };
      delete inf.stable_profile_pic_url;
      delete inf.profile_pic_url;
      if (!includeHandleForAdmin) {
        delete inf.username;
        delete inf.handle;
      }
      out.influencer = inf;
    }
    if (!includeHandleForAdmin) {
      if (typeof out.key === 'string' && out.key.includes(':')) {
        const parts = out.key.split(':');
        out.key = parts.length >= 3 ? `${parts[1]}:${parts.slice(2).join(':')}` : out.key;
      }
    }
    return out;
  });
}

export { shouldIncludeHandleInApi };

export function enrichListItemsWithRefs(
  items: ProfileListItem[],
  profileRefDb: ProfileRefDb,
  req?: RequestWithAuth,
  identityCtx?: { campaignId?: string }
): ProfileListItem[] {
  const includeHandle = shouldIncludeHandleInApi(req, identityCtx);
  return items.map((item) => {
    const handle = (item.handle ?? item.key ?? '').toLowerCase().replace(/^@/, '');
    const ref = handle ? profileRefDb.getOrCreateRef(handle) : '';
    if (!ref) return item;
    return sanitizeProfileListItemForClient(item, ref, includeHandle);
  });
}

/** Posts em post-matches: `profile_ref` opaco por item (sem @ na URL do cliente). */
export function enrichPostItemsWithRefs(
  items: Array<{ key: string; [k: string]: unknown }>,
  profileRefDb: ProfileRefDb,
  req?: RequestWithAuth,
  identityCtx?: { campaignId?: string }
): Array<Record<string, unknown>> {
  const includeHandle = shouldIncludeHandleInApi(req, identityCtx);
  return items.map((item) => {
    const ph = typeof item.profile_handle === 'string' ? item.profile_handle : '';
    const handle = ph.replace(/^@/, '').trim().toLowerCase();
    if (!handle) {
      return redactContactInfoInPostItems([item])[0] as Record<string, unknown>;
    }
    const ref = profileRefDb.getOrCreateRef(handle);
    const redacted = redactContactInfoInPostItems([item])[0] as Record<string, unknown>;
    const postKey = typeof item.key === 'string' && item.key.trim() ? item.key : handle;
    const out =
      sanitizePostItemsForClient([{ ...redacted, key: postKey }], ref, includeHandle)[0] ?? redacted;
    out.profile_ref = ref;
    out.avatar_url = profileAvatarMediaPath(ref);
    if (!includeHandle) {
      delete out.profile_handle;
    }
    return out;
  });
}
