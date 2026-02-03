/** Perfil normalizado — armazenado em node/documento ≤1MB */

export interface Address {
  street: string | null;
  number: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  raw_text: string | null;
}

export type DiscoveredBy = 'hashtag' | 'location' | 'seed';

export interface ExtractedProfile {
  platform: 'instagram';
  handle: string;
  profile_url: string;
  display_name: string | null;
  bio: string | null;
  website: string | null;
  followers: number | null;
  following: number | null;
  posts_count: number | null;
  is_verified: boolean;
  is_business: boolean;
  category: string | null;
  address: Address;
  public_email: string | null;
  public_phone: string | null;
  discovered_by: DiscoveredBy;
  discovered_value: string;
  collected_at: string; // ISO date
}

export interface CrawlConfig {
  maxPostsPerTag: number;
  maxProfiles: number;
  headless: boolean;
  authStatePath: string;
  randomDelayMinMs: number;
  randomDelayMaxMs: number;
  maxRetries: number;
  nodeMaxBytes: number;
  bioMaxChars: number;
  addressRawTextMaxChars: number;
}

export const DEFAULT_CRAWL_CONFIG: CrawlConfig = {
  maxPostsPerTag: 30,
  maxProfiles: 100,
  headless: true,
  authStatePath: '.auth/instagram.json',
  randomDelayMinMs: 2000,
  randomDelayMaxMs: 6000,
  maxRetries: 2,
  nodeMaxBytes: 1024 * 1024, // 1MB
  bioMaxChars: 500,
  addressRawTextMaxChars: 300,
};
