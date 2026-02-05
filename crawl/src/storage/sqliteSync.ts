/**
 * Sincroniza perfis e posts para SQLite (data/influencer.db) para que a tabela `post` e `profiles` fiquem populadas.
 * Uso: junto com RocksDBStorage, chamar save/savePosts aqui também.
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const DEFAULT_PATH = './data/influencer.db';

/** Valores/tarifas (8 tipos de entrega). */
export interface PricingData {
  post_unique?: string;
  stories?: string;
  package_monthly?: string;
  commission?: string;
  permuta?: string;
  image_rights?: string;
  content_delivery?: string;
  launch?: string;
}

/** Dados de ativação do perfil na plataforma (cadastro completo do influenciador). */
export interface ProfileActivationData {
  address?: string;
  city?: string;
  state?: string;
  neighborhood?: string;
  country?: string;
  whatsapp?: string;
  tiktok?: string;
  facebook?: string;
  linkedin?: string;
  twitter?: string;
  websites?: string;
  gender?: string;
  description?: string;
  about_topics?: string;
  pricing?: PricingData;
  /** Tipos de conteúdo (ex.: fitness, moda, adulto). */
  content_type?: string[];
  activated_at?: string;
  updated_at: string;
}

export class SqliteSync {
  private db: Database.Database;
  private insertProfile: Database.Statement;
  private insertPost: Database.Statement;
  private upsertActivation: Database.Statement;
  private getActivationStmt: Database.Statement;

  constructor(dbPath: string = process.env.SQLITE_DB_PATH ?? DEFAULT_PATH) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.ensureSchema();
    try {
      this.insertProfile = this.db.prepare(`
        INSERT OR REPLACE INTO profiles (handle, payload, updated_at)
        VALUES (?, ?, ?)
      `);
      this.insertPost = this.db.prepare(`
        INSERT OR REPLACE INTO post (profile_handle, shortcode, payload, collected_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      this.upsertActivation = this.db.prepare(`
        INSERT INTO profile_activation (
          profile_handle, address, city, state, neighborhood, country,
          whatsapp, tiktok, facebook, linkedin, twitter, websites,
          gender, description, about_topics, pricing, content_type,
          activated_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(profile_handle) DO UPDATE SET
          address = excluded.address, city = excluded.city, state = excluded.state,
          neighborhood = excluded.neighborhood, country = excluded.country,
          whatsapp = excluded.whatsapp, tiktok = excluded.tiktok, facebook = excluded.facebook,
          linkedin = excluded.linkedin, twitter = excluded.twitter, websites = excluded.websites,
          gender = excluded.gender, description = excluded.description,
          about_topics = excluded.about_topics, pricing = excluded.pricing,
          content_type = excluded.content_type,
          activated_at = COALESCE(excluded.activated_at, activated_at), updated_at = excluded.updated_at
      `);
      this.getActivationStmt = this.db.prepare(`
        SELECT address, city, state, neighborhood, country,
               whatsapp, tiktok, facebook, linkedin, twitter, websites,
               gender, description, about_topics, pricing, content_type,
               activated_at, updated_at
        FROM profile_activation WHERE profile_handle = ?
      `);
    } catch (e) {
      if (e instanceof Error && e.message.includes('no column named payload')) {
        this.db.exec('PRAGMA foreign_keys = OFF; DROP TABLE IF EXISTS post; DROP TABLE IF EXISTS profiles; PRAGMA foreign_keys = ON;');
        this.ensureSchema();
        this.insertProfile = this.db.prepare(`
          INSERT OR REPLACE INTO profiles (handle, payload, updated_at)
          VALUES (?, ?, ?)
        `);
        this.insertPost = this.db.prepare(`
          INSERT OR REPLACE INTO post (profile_handle, shortcode, payload, collected_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `);
        this.upsertActivation = this.db.prepare(`
          INSERT INTO profile_activation (
            profile_handle, address, city, state, neighborhood, country,
            whatsapp, tiktok, facebook, linkedin, twitter, websites,
            gender, description, about_topics, pricing, content_type, activated_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(profile_handle) DO UPDATE SET
            address = excluded.address, city = excluded.city, state = excluded.state,
            neighborhood = excluded.neighborhood, country = excluded.country,
            whatsapp = excluded.whatsapp, tiktok = excluded.tiktok, facebook = excluded.facebook,
            linkedin = excluded.linkedin, twitter = excluded.twitter, websites = excluded.websites,
            gender = excluded.gender, description = excluded.description,
            about_topics = excluded.about_topics, pricing = excluded.pricing,
            content_type = excluded.content_type,
            activated_at = COALESCE(excluded.activated_at, activated_at), updated_at = excluded.updated_at
        `);
        this.getActivationStmt = this.db.prepare(`
          SELECT address, city, state, neighborhood, country,
                 whatsapp, tiktok, facebook, linkedin, twitter, websites,
                 gender, description, about_topics, pricing, content_type, activated_at, updated_at
          FROM profile_activation WHERE profile_handle = ?
        `);
      } else {
        throw e;
      }
    }
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        handle TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS post (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_handle TEXT NOT NULL,
        shortcode TEXT NOT NULL,
        payload TEXT NOT NULL,
        collected_at TEXT,
        updated_at TEXT NOT NULL,
        UNIQUE(profile_handle, shortcode)
      );
      CREATE INDEX IF NOT EXISTS idx_post_profile ON post(profile_handle);
      CREATE INDEX IF NOT EXISTS idx_post_shortcode ON post(shortcode);
      CREATE TABLE IF NOT EXISTS profile_activation (
        profile_handle TEXT PRIMARY KEY,
        address TEXT,
        city TEXT,
        state TEXT,
        neighborhood TEXT,
        country TEXT,
        whatsapp TEXT,
        tiktok TEXT,
        facebook TEXT,
        linkedin TEXT,
        twitter TEXT,
        websites TEXT,
        gender TEXT,
        description TEXT,
        about_topics TEXT,
        pricing TEXT,
        content_type TEXT,
        activated_at TEXT,
        updated_at TEXT NOT NULL
      );
    `);
    this.migrateActivationColumns();
  }

  private migrateActivationColumns(): void {
    const columns = ['gender', 'description', 'about_topics', 'pricing', 'content_type'] as const;
    for (const col of columns) {
      try {
        this.db.exec(`ALTER TABLE profile_activation ADD COLUMN ${col} TEXT`);
      } catch (_) {
        // Coluna já existe
      }
    }
  }

  saveProfile(entity: Record<string, unknown>): void {
    const handle = String(entity.handle ?? '').toLowerCase().replace(/^@/, '');
    if (!handle) return;
    const payload = JSON.stringify(entity);
    const updated_at = new Date().toISOString();
    this.insertProfile.run(handle, payload, updated_at);
  }

  savePosts(profileHandle: string, posts: unknown[], _collectedAt: string): void {
    const handle = profileHandle.toLowerCase().replace(/^@/, '');
    const updated_at = new Date().toISOString();
    for (const p of posts) {
      const po = p as Record<string, unknown>;
      const postBlock = po.post as Record<string, unknown> | undefined;
      const shortcode =
        (postBlock?.shortcode != null ? String(postBlock.shortcode) : null) ??
        (po.shortcode != null ? String(po.shortcode) : null) ??
        (po.post_url != null ? String(po.post_url) : null);
      if (!shortcode) continue;
      const payload = JSON.stringify({ ...po, profile_handle: handle });
      const collected_at = postBlock?.collected_at != null ? String(postBlock.collected_at) : _collectedAt;
      this.insertPost.run(handle, shortcode, payload, collected_at, updated_at);
    }
  }

  getActivation(profileHandle: string): ProfileActivationData | null {
    const handle = profileHandle.toLowerCase().replace(/^@/, '');
    const row = this.getActivationStmt.get(handle) as Record<string, unknown> | undefined;
    if (!row) return null;
    const updated_at = row.updated_at as string;
    let pricing: PricingData | undefined;
    const pricingRaw = row.pricing;
    if (typeof pricingRaw === 'string' && pricingRaw) {
      try {
        pricing = JSON.parse(pricingRaw) as PricingData;
      } catch (_) {
        pricing = undefined;
      }
    }
    let content_type: string[] | undefined;
    const ctRaw = row.content_type;
    if (typeof ctRaw === 'string' && ctRaw) {
      try {
        const arr = JSON.parse(ctRaw);
        content_type = Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : undefined;
      } catch (_) {
        content_type = undefined;
      }
    }
    return {
      address: row.address as string | undefined,
      city: row.city as string | undefined,
      state: row.state as string | undefined,
      neighborhood: row.neighborhood as string | undefined,
      country: row.country as string | undefined,
      whatsapp: row.whatsapp as string | undefined,
      tiktok: row.tiktok as string | undefined,
      facebook: row.facebook as string | undefined,
      linkedin: row.linkedin as string | undefined,
      twitter: row.twitter as string | undefined,
      websites: row.websites as string | undefined,
      gender: row.gender as string | undefined,
      description: row.description as string | undefined,
      about_topics: row.about_topics as string | undefined,
      pricing,
      content_type,
      activated_at: row.activated_at as string | undefined,
      updated_at: typeof updated_at === 'string' ? updated_at : new Date().toISOString(),
    };
  }

  saveActivation(profileHandle: string, data: Omit<ProfileActivationData, 'updated_at' | 'activated_at'> & { activated_at?: string }): void {
    const handle = profileHandle.toLowerCase().replace(/^@/, '');
    const updated_at = new Date().toISOString();
    const existing = this.getActivation(handle);
    const activated_at = existing ? (data.activated_at ?? existing.activated_at) : (data.activated_at ?? updated_at);
    const pricingStr = data.pricing != null ? JSON.stringify(data.pricing) : null;
    const contentTypeStr = data.content_type?.length ? JSON.stringify(data.content_type) : null;
    this.upsertActivation.run(
      handle,
      data.address ?? null,
      data.city ?? null,
      data.state ?? null,
      data.neighborhood ?? null,
      data.country ?? null,
      data.whatsapp ?? null,
      data.tiktok ?? null,
      data.facebook ?? null,
      data.linkedin ?? null,
      data.twitter ?? null,
      data.websites ?? null,
      data.gender ?? null,
      data.description ?? null,
      data.about_topics ?? null,
      pricingStr,
      contentTypeStr,
      activated_at ?? null,
      updated_at
    );
  }

  clearAll(): void {
    this.db.exec('PRAGMA foreign_keys = OFF; DELETE FROM post; DELETE FROM profiles; DELETE FROM profile_activation; PRAGMA foreign_keys = ON;');
  }

  close(): void {
    this.db.close();
  }
}
