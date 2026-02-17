/**
 * SQLite (data/influencer.db): apenas profile_activation (cadastro do influenciador).
 * Perfis e posts ficam somente no RocksDB; não há mais tabelas profiles/post aqui.
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
  }

  private ensureSchema(): void {
    this.db.exec('PRAGMA foreign_keys = OFF; DROP TABLE IF EXISTS post; DROP TABLE IF EXISTS profiles; PRAGMA foreign_keys = ON;');
    this.db.exec(`
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

  private rowToActivation(row: Record<string, unknown>): ProfileActivationData {
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

  getActivation(profileHandle: string): ProfileActivationData | null {
    const handle = profileHandle.toLowerCase().replace(/^@/, '');
    const row = this.getActivationStmt.get(handle) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToActivation(row);
  }

  /** Tamanho máximo do IN () por query (evita statement gigante e lentidão no SQLite). */
  private static readonly BATCH_SIZE = 500;

  /** Retorna ativações para vários handles em uma única query (bem mais rápido que N×getActivation). Em lotes para não sobrecarregar o SQLite. */
  getActivationsBatch(handles: string[]): Map<string, ProfileActivationData> {
    const out = new Map<string, ProfileActivationData>();
    if (handles.length === 0) return out;
    const normalized = [...new Set(handles.map((h) => h.toLowerCase().replace(/^@/, '')))];
    for (let i = 0; i < normalized.length; i += SqliteSync.BATCH_SIZE) {
      const chunk = normalized.slice(i, i + SqliteSync.BATCH_SIZE);
      const placeholders = chunk.map(() => '?').join(',');
      const stmt = this.db.prepare(`
        SELECT profile_handle, address, city, state, neighborhood, country,
               whatsapp, tiktok, facebook, linkedin, twitter, websites,
               gender, description, about_topics, pricing, content_type, activated_at, updated_at
        FROM profile_activation WHERE profile_handle IN (${placeholders})
      `);
      const rows = stmt.all(...chunk) as Array<Record<string, unknown> & { profile_handle: string }>;
      for (const row of rows) {
        const handle = String(row.profile_handle ?? '').toLowerCase().replace(/^@/, '');
        if (handle) out.set(handle, this.rowToActivation(row));
      }
    }
    return out;
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
    this.db.exec('DELETE FROM profile_activation;');
  }

  close(): void {
    this.db.close();
  }
}
