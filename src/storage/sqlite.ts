import Database from 'better-sqlite3';
import { dirname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import type { ExtractedProfile, Address, PostInsights, ExtractedPost } from '../types/index.js';
import { estimatePayloadSize, ensureWithinLimit } from '../utils/estimatePayloadSize.js';
import type { CrawlConfig } from '../types/index.js';

const NODE_MAX_BYTES_DEFAULT = 1024 * 1024; // 1MB
const CAPTION_MAX_LENGTH = 2000;

export interface SqliteStorageAdapterOptions {
  dbPath?: string;
  nodeMaxBytes?: number;
  config?: CrawlConfig;
}

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS profiles (
  handle TEXT PRIMARY KEY,
  platform TEXT NOT NULL DEFAULT 'instagram',
  profile_url TEXT NOT NULL,
  profile_image_url TEXT,
  display_name TEXT,
  bio TEXT,
  website TEXT,
  followers INTEGER,
  following INTEGER,
  posts_count INTEGER,
  is_verified INTEGER NOT NULL DEFAULT 0,
  is_business INTEGER NOT NULL DEFAULT 0,
  category TEXT,
  address_json TEXT,
  public_email TEXT,
  public_phone TEXT,
  post_insights_json TEXT,
  discovered_by TEXT NOT NULL,
  discovered_value TEXT NOT NULL,
  collected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
`;

const CREATE_HASHTAGS_TABLE = `
CREATE TABLE IF NOT EXISTS hashtags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL
)
`;

const CREATE_POSTS_TABLE = `
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_handle TEXT NOT NULL,
  post_url TEXT NOT NULL UNIQUE,
  shortcode TEXT NOT NULL,
  media_url TEXT,
  media_type TEXT,
  likes_count INTEGER,
  comments_count INTEGER,
  caption TEXT,
  collected_at TEXT NOT NULL,
  FOREIGN KEY (profile_handle) REFERENCES profiles(handle)
)
`;

const CREATE_POST_HASHTAGS_TABLE = `
CREATE TABLE IF NOT EXISTS post_hashtags (
  post_id INTEGER NOT NULL,
  hashtag_id INTEGER NOT NULL,
  PRIMARY KEY (post_id, hashtag_id),
  FOREIGN KEY (post_id) REFERENCES posts(id),
  FOREIGN KEY (hashtag_id) REFERENCES hashtags(id)
)
`;

function ensurePostInsightsColumn(db: Database.Database): void {
  const info = db.prepare('PRAGMA table_info(profiles)').all() as { name: string }[];
  if (info.some((c) => c.name === 'post_insights_json')) return;
  db.exec('ALTER TABLE profiles ADD COLUMN post_insights_json TEXT');
}

function ensureProfileImageUrlColumn(db: Database.Database): void {
  const info = db.prepare('PRAGMA table_info(profiles)').all() as { name: string }[];
  if (info.some((c) => c.name === 'profile_image_url')) return;
  db.exec('ALTER TABLE profiles ADD COLUMN profile_image_url TEXT');
}

function addressToJson(addr: Address): string {
  return JSON.stringify(addr);
}

function jsonToAddress(json: string | null): Address {
  if (!json) {
    return {
      street: null,
      number: null,
      neighborhood: null,
      city: null,
      state: null,
      postal_code: null,
      country: null,
      raw_text: null,
    };
  }
  try {
    return JSON.parse(json) as Address;
  } catch {
    return {
      street: null,
      number: null,
      neighborhood: null,
      city: null,
      state: null,
      postal_code: null,
      country: null,
      raw_text: null,
    };
  }
}

function jsonToPostInsights(json: string | null): PostInsights | null {
  if (!json) return null;
  try {
    const o = JSON.parse(json) as PostInsights;
    if (Array.isArray(o.hashtags) && Array.isArray(o.locations_mentioned)) {
      return {
        ...o,
        inferred_categories: Array.isArray(o.inferred_categories) ? o.inferred_categories : [],
      };
    }
  } catch {
    // ignore
  }
  return null;
}

function rowToProfile(row: Record<string, unknown>): ExtractedProfile {
  return {
    platform: 'instagram',
    handle: String(row.handle),
    profile_url: String(row.profile_url),
    profile_image_url: row.profile_image_url != null ? String(row.profile_image_url) : null,
    display_name: row.display_name != null ? String(row.display_name) : null,
    bio: row.bio != null ? String(row.bio) : null,
    website: row.website != null ? String(row.website) : null,
    followers: row.followers != null ? Number(row.followers) : null,
    following: row.following != null ? Number(row.following) : null,
    posts_count: row.posts_count != null ? Number(row.posts_count) : null,
    is_verified: Number(row.is_verified) === 1,
    is_business: Number(row.is_business) === 1,
    category: row.category != null ? String(row.category) : null,
    address: jsonToAddress(row.address_json as string | null),
    public_email: row.public_email != null ? String(row.public_email) : null,
    public_phone: row.public_phone != null ? String(row.public_phone) : null,
    post_insights: jsonToPostInsights(row.post_insights_json as string | null),
    discovered_by: row.discovered_by as ExtractedProfile['discovered_by'],
    discovered_value: String(row.discovered_value),
    collected_at: String(row.collected_at),
  };
}

export class SqliteStorageAdapter {
  private readonly dbPath: string;
  private readonly nodeMaxBytes: number;
  private readonly config: CrawlConfig | undefined;
  private db: Database.Database | null = null;

  constructor(options: SqliteStorageAdapterOptions = {}) {
    this.dbPath = options.dbPath ?? './data/influencer.db';
    this.nodeMaxBytes = options.nodeMaxBytes ?? options.config?.nodeMaxBytes ?? NODE_MAX_BYTES_DEFAULT;
    this.config = options.config;
    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private getDb(): Database.Database {
    if (!this.db) {
      this.db = new Database(this.dbPath);
      this.db.exec(CREATE_TABLE);
      this.db.exec(CREATE_HASHTAGS_TABLE);
      this.db.exec(CREATE_POSTS_TABLE);
      this.db.exec(CREATE_POST_HASHTAGS_TABLE);
      ensurePostInsightsColumn(this.db);
      ensureProfileImageUrlColumn(this.db);
    }
    return this.db;
  }

  /** Remove todos os dados: post_hashtags, posts, hashtags, profiles (ordem por FKs). */
  async clearAll(): Promise<void> {
    const db = this.getDb();
    db.exec('DELETE FROM post_hashtags');
    db.exec('DELETE FROM posts');
    db.exec('DELETE FROM hashtags');
    db.exec('DELETE FROM profiles');
  }

  /**
   * Salva posts do influenciador e suas hashtags (tabelas normalizadas).
   * Hashtags são inseridas na tabela hashtags (UNIQUE) e vinculadas em post_hashtags.
   */
  async savePosts(profileHandle: string, posts: ExtractedPost[], collectedAt: string): Promise<number> {
    if (posts.length === 0) return 0;
    const db = this.getDb();
    const insertPost = db.prepare(`
      INSERT INTO posts (profile_handle, post_url, shortcode, media_url, media_type, likes_count, comments_count, caption, collected_at)
      VALUES (@profile_handle, @post_url, @shortcode, @media_url, @media_type, @likes_count, @comments_count, @caption, @collected_at)
      ON CONFLICT(post_url) DO UPDATE SET
        likes_count = excluded.likes_count,
        comments_count = excluded.comments_count,
        caption = excluded.caption,
        media_url = excluded.media_url,
        media_type = excluded.media_type
    `);
    const getPostId = db.prepare('SELECT id FROM posts WHERE post_url = ?').pluck();
    const insertHashtag = db.prepare('INSERT INTO hashtags (name) VALUES (?) ON CONFLICT(name) DO NOTHING');
    const getHashtagId = db.prepare('SELECT id FROM hashtags WHERE name = ?').pluck();
    const insertPostHashtag = db.prepare(`
      INSERT OR IGNORE INTO post_hashtags (post_id, hashtag_id) VALUES (?, ?)
    `);
    const handle = profileHandle.toLowerCase().replace(/^@/, '');
    let saved = 0;
    for (const p of posts) {
      const caption = p.caption != null && p.caption.length > CAPTION_MAX_LENGTH
        ? p.caption.slice(0, CAPTION_MAX_LENGTH)
        : p.caption;
      insertPost.run({
        profile_handle: handle,
        post_url: p.post_url,
        shortcode: p.shortcode,
        media_url: p.media_url,
        media_type: p.media_type,
        likes_count: p.likes_count,
        comments_count: p.comments_count,
        caption,
        collected_at: collectedAt,
      });
      const postId = getPostId.get(p.post_url) as number | undefined;
      if (postId == null) continue;
      saved++;
      for (const tag of p.hashtags) {
        const name = tag.toLowerCase().trim();
        if (!name) continue;
        insertHashtag.run(name);
        const hashtagId = getHashtagId.get(name) as number;
        if (hashtagId != null) insertPostHashtag.run(postId, hashtagId);
      }
    }
    return saved;
  }

  estimatePayloadSize(obj: unknown): number {
    return estimatePayloadSize(obj);
  }

  prepareForSave(profile: ExtractedProfile): ExtractedProfile {
    const bioMax = this.config?.bioMaxChars ?? 500;
    const rawMax = this.config?.addressRawTextMaxChars ?? 300;
    return ensureWithinLimit(profile, this.nodeMaxBytes, bioMax, rawMax) as ExtractedProfile;
  }

  async save(profile: ExtractedProfile): Promise<{ path: string; bytes: number }> {
    const prepared = this.prepareForSave(profile);
    const size = estimatePayloadSize(prepared);
    if (size > this.nodeMaxBytes) {
      throw new Error(
        `Payload ainda excede limite (${this.nodeMaxBytes} bytes) após truncar. Size: ${size}`
      );
    }
    const db = this.getDb();
    const now = new Date().toISOString();
    const postInsightsJson = prepared.post_insights ? JSON.stringify(prepared.post_insights) : null;
    const addressJson = addressToJson(prepared.address);

    const stmt = db.prepare(`
      INSERT INTO profiles (
        handle, platform, profile_url, profile_image_url, display_name, bio, website,
        followers, following, posts_count, is_verified, is_business, category,
        address_json, public_email, public_phone, post_insights_json,
        discovered_by, discovered_value, collected_at, updated_at
      ) VALUES (
        @handle, @platform, @profile_url, @profile_image_url, @display_name, @bio, @website,
        @followers, @following, @posts_count, @is_verified, @is_business, @category,
        @address_json, @public_email, @public_phone, @post_insights_json,
        @discovered_by, @discovered_value, @collected_at, @updated_at
      )
      ON CONFLICT(handle) DO UPDATE SET
        profile_url = excluded.profile_url,
        profile_image_url = excluded.profile_image_url,
        display_name = excluded.display_name,
        bio = excluded.bio,
        website = excluded.website,
        followers = excluded.followers,
        following = excluded.following,
        posts_count = excluded.posts_count,
        is_verified = excluded.is_verified,
        is_business = excluded.is_business,
        category = excluded.category,
        address_json = excluded.address_json,
        public_email = excluded.public_email,
        public_phone = excluded.public_phone,
        post_insights_json = excluded.post_insights_json,
        updated_at = excluded.updated_at
    `);

    stmt.run({
      handle: prepared.handle,
      platform: prepared.platform,
      profile_url: prepared.profile_url,
      profile_image_url: prepared.profile_image_url,
      display_name: prepared.display_name,
      bio: prepared.bio,
      website: prepared.website,
      followers: prepared.followers,
      following: prepared.following,
      posts_count: prepared.posts_count,
      is_verified: prepared.is_verified ? 1 : 0,
      is_business: prepared.is_business ? 1 : 0,
      category: prepared.category,
      address_json: addressJson,
      public_email: prepared.public_email,
      public_phone: prepared.public_phone,
      post_insights_json: postInsightsJson,
      discovered_by: prepared.discovered_by,
      discovered_value: prepared.discovered_value,
      collected_at: prepared.collected_at,
      updated_at: now,
    });

    return { path: `sqlite:${this.dbPath}:${prepared.handle}`, bytes: size };
  }

  async listHandles(): Promise<Set<string>> {
    const db = this.getDb();
    const rows = db.prepare('SELECT handle FROM profiles').all() as { handle: string }[];
    return new Set(rows.map((r) => r.handle.toLowerCase()));
  }

  async loadByHandle(handle: string): Promise<ExtractedProfile | null> {
    const db = this.getDb();
    const row = db.prepare('SELECT * FROM profiles WHERE LOWER(handle) = LOWER(?)').get(handle) as Record<string, unknown> | undefined;
    if (!row) return null;
    return rowToProfile(row);
  }
}
