/**
 * Perfil enxuto para exibição e armazenamento em memória.
 */

import type { Entity } from './entityRules.js';
import { isBusinessFromEntity } from './entityRules.js';

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

function toNum(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.floor(v);
  if (typeof v === 'string') {
    const n = parseInt(v.replace(/\D/g, ''), 10);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}

function sanitize(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, 2000);
}

export interface SlimProfile extends Record<string, unknown> {
  handle: string;
  full_name?: string;
  profile_pic_url?: string;
  followers_count: number;
  media_count?: number;
  biography?: string;
  is_private?: boolean;
  is_business_account?: boolean;
  account_type?: number;
  category?: string;
  _collected_at: string;
  _discovered_by: string;
  _discovered_value: string;
}

export function buildSlimProfile(
  rawProfile: Record<string, unknown>,
  handle: string,
  followersFromDiscovery: number,
  posts: Entity[],
  discoveredBy: string,
  discoveredValue: string
): SlimProfile {
  const key = handle.toLowerCase().replace(/^@/, '');
  const user = getIn(rawProfile, 'data.user') as Record<string, unknown> | undefined;
  const username = (user?.username ?? key) as string;
  const full_name =
    typeof user?.full_name === 'string' ? sanitize(user.full_name as string) : undefined;
  const profile_pic_url = user?.profile_pic_url as string | undefined;
  const is_private = user?.is_private === true;
  const account_type = toNum(user?.account_type);
  const category = user?.category as string | undefined;
  const biography =
    typeof user?.biography === 'string' ? sanitize((user.biography as string).slice(0, 500)) : undefined;

  const followersCount =
    toNum(user?.follower_count) ??
    toNum(getIn(rawProfile, 'followers_count', 'follower_count')) ??
    followersFromDiscovery ??
    0;

  return {
    handle: key,
    username,
    full_name,
    profile_pic_url,
    followers_count: followersCount,
    media_count: toNum(user?.media_count),
    biography,
    is_private: is_private || undefined,
    is_business_account: isBusinessFromEntity(rawProfile) || undefined,
    account_type,
    category,
    _collected_at: String(rawProfile._collected_at ?? new Date().toISOString()),
    _discovered_by: discoveredBy,
    _discovered_value: discoveredValue,
  };
}
