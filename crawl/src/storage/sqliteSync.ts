/**
 * SQLite (data/influencer.db): apenas profile_activation (cadastro do influenciador).
 * Perfis e posts ficam somente no RocksDB; não há mais tabelas profiles/post aqui.
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const DEFAULT_PATH = './data/influencer.db';

/** Valores por tipo de conteúdo (4 tipos). */
export interface PricingData {
  feed?: string;
  reels?: string;
  story?: string;
  destaque?: string;
}

/** Dados de ativação do perfil na plataforma (cadastro completo do influenciador). */
export interface ProfileActivationData {
  address?: string;
  /** Número e complemento do endereço (obrigatório quando allow_gifts). */
  address_number?: string;
  /** CEP (apenas números ou formatado). */
  zip_code?: string;
  city?: string;
  state?: string;
  neighborhood?: string;
  country?: string;
  /** Autorização para marcas enviarem brindes ao endereço informado. */
  allow_gifts?: boolean;
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
  /** Público que influencia: classes socioeconômicas (A, B, C, D). */
  influence_audience?: string[];
  /** Faixa etária que influencia (ex.: 18-24, 25-34). */
  influence_age_range?: string[];
  /** Gênero predominante do público (majoritariamente_feminino, majoritariamente_masculino, publico_equilibrado, prefiro_nao_definir). */
  audience_gender?: string;
  /** Marcas com as quais já trabalhou (texto livre, opcional). */
  brands_worked_with?: string;
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
        profile_handle, address, address_number, zip_code, city, state, neighborhood, country, allow_gifts,
        whatsapp, tiktok, facebook, linkedin, twitter, websites,
        gender, description, about_topics, pricing, content_type, influence_audience, influence_age_range,
        audience_gender, brands_worked_with,
        activated_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(profile_handle) DO UPDATE SET
        address = excluded.address, address_number = excluded.address_number, zip_code = excluded.zip_code, city = excluded.city, state = excluded.state,
        neighborhood = excluded.neighborhood, country = excluded.country, allow_gifts = excluded.allow_gifts,
        whatsapp = excluded.whatsapp, tiktok = excluded.tiktok, facebook = excluded.facebook,
        linkedin = excluded.linkedin, twitter = excluded.twitter, websites = excluded.websites,
        gender = excluded.gender, description = excluded.description,
        about_topics = excluded.about_topics, pricing = excluded.pricing,
        content_type = excluded.content_type, influence_audience = excluded.influence_audience, influence_age_range = excluded.influence_age_range,
        audience_gender = excluded.audience_gender, brands_worked_with = excluded.brands_worked_with,
        activated_at = COALESCE(excluded.activated_at, activated_at), updated_at = excluded.updated_at
    `);
    this.getActivationStmt = this.db.prepare(`
      SELECT address, address_number, zip_code, city, state, neighborhood, country, allow_gifts,
             whatsapp, tiktok, facebook, linkedin, twitter, websites,
             gender, description, about_topics, pricing, content_type, influence_audience, influence_age_range,
             audience_gender, brands_worked_with,
             activated_at, updated_at
      FROM profile_activation WHERE profile_handle = ?
    `);
  }

  private ensureSchema(): void {
    this.db.exec('PRAGMA foreign_keys = OFF; DROP TABLE IF EXISTS post; DROP TABLE IF EXISTS profiles; PRAGMA foreign_keys = ON;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS project (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        client_name TEXT,
        budget_min REAL,
        budget_max REAL,
        category TEXT,
        requirements TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS project_application (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES project(id),
        profile_handle TEXT NOT NULL,
        message TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(project_id, profile_handle)
      );
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS profile_activation (
        profile_handle TEXT PRIMARY KEY,
        address TEXT,
        zip_code TEXT,
        city TEXT,
        state TEXT,
        neighborhood TEXT,
        country TEXT,
        allow_gifts TEXT,
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
      CREATE TABLE IF NOT EXISTS message_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hash TEXT NOT NULL UNIQUE,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS direct_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_handle TEXT NOT NULL,
        message_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        sent_at TEXT,
        error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        /** Momento a partir do qual o worker pode enviar (ISO). */
        scheduled_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_direct_queue_status ON direct_queue(status);
      CREATE TABLE IF NOT EXISTS user_favorite (
        user_id INTEGER NOT NULL,
        profile_handle TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, profile_handle)
      );
      CREATE INDEX IF NOT EXISTS idx_user_favorite_user ON user_favorite(user_id);
    `);
    this.migrateActivationColumns();
    this.migrateMessageTemplatesRejectHashes();
    this.migrateMessageTemplatesSendDelay();
    this.migrateDirectQueueColumns();
    this.migrateUserFavoriteCampaignId();
  }

  private migrateUserFavoriteCampaignId(): void {
    try {
      this.db.exec('ALTER TABLE user_favorite ADD COLUMN campaign_id TEXT');
    } catch (_) {
      // Coluna já existe
    }
    this.migrateUserFavoriteMultipleCampaigns();
  }

  /** Permite o mesmo influencer em mais de uma campanha: PK (user_id, profile_handle, campaign_id). */
  private migrateUserFavoriteMultipleCampaigns(): void {
    const tableInfo = this.db.prepare("PRAGMA table_info(user_favorite)").all() as { name: string }[];
    const hasCampaignId = tableInfo.some((c) => c.name === 'campaign_id');
    const pkInfo = this.db.prepare("PRAGMA table_info(user_favorite)").all() as { name: string; pk: number }[];
    const pkCols = pkInfo.filter((c) => c.pk > 0).map((c) => c.name).sort();
    if (pkCols.length === 3 && pkCols.includes('campaign_id')) return;
    if (!hasCampaignId) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_favorite_new (
        user_id INTEGER NOT NULL,
        profile_handle TEXT NOT NULL,
        campaign_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, profile_handle, campaign_id)
      );
      INSERT OR IGNORE INTO user_favorite_new (user_id, profile_handle, campaign_id, created_at)
      SELECT user_id, profile_handle, COALESCE(NULLIF(trim(campaign_id), ''), ''), created_at FROM user_favorite;
      DROP TABLE user_favorite;
      ALTER TABLE user_favorite_new RENAME TO user_favorite;
      CREATE INDEX IF NOT EXISTS idx_user_favorite_user ON user_favorite(user_id);
    `);
  }

  private migrateMessageTemplatesRejectHashes(): void {
    try {
      this.db.exec('ALTER TABLE message_templates ADD COLUMN reject_hashes TEXT DEFAULT \'[]\'');
    } catch (_) {
      // Coluna já existe
    }
  }

  private migrateMessageTemplatesSendDelay(): void {
    try {
      this.db.exec('ALTER TABLE message_templates ADD COLUMN send_delay_minutes INTEGER DEFAULT 1');
    } catch (_) {
      // Coluna já existe
    }
  }

  /** Migrações específicas da fila direct_queue (novas colunas). */
  private migrateDirectQueueColumns(): void {
    try {
      this.db.exec('ALTER TABLE direct_queue ADD COLUMN scheduled_at TEXT');
    } catch (_) {
      // Coluna já existe
    }
  }

  private migrateActivationColumns(): void {
    const columns = ['gender', 'description', 'about_topics', 'pricing', 'content_type', 'zip_code', 'allow_gifts', 'address_number', 'influence_audience', 'influence_age_range', 'audience_gender', 'brands_worked_with'] as const;
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
    let influence_audience: string[] | undefined;
    const audRaw = row.influence_audience;
    if (typeof audRaw === 'string' && audRaw) {
      try {
        const arr = JSON.parse(audRaw);
        influence_audience = Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : undefined;
      } catch (_) {
        influence_audience = undefined;
      }
    }
    let influence_age_range: string[] | undefined;
    const ageRaw = row.influence_age_range;
    if (typeof ageRaw === 'string' && ageRaw) {
      try {
        const arr = JSON.parse(ageRaw);
        influence_age_range = Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : undefined;
      } catch (_) {
        influence_age_range = undefined;
      }
    }
    return {
      address: row.address as string | undefined,
      address_number: row.address_number as string | undefined,
      zip_code: row.zip_code as string | undefined,
      city: row.city as string | undefined,
      state: row.state as string | undefined,
      neighborhood: row.neighborhood as string | undefined,
      country: row.country as string | undefined,
      allow_gifts: row.allow_gifts === '1' || row.allow_gifts === 'true',
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
      influence_audience,
      influence_age_range,
      audience_gender: row.audience_gender as string | undefined,
      brands_worked_with: row.brands_worked_with as string | undefined,
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

  /** Remove os dados de ativação do perfil (LGPD: exclusão de conta). */
  deleteActivation(profileHandle: string): void {
    const handle = profileHandle.toLowerCase().replace(/^@/, '');
    this.db.prepare('DELETE FROM profile_activation WHERE profile_handle = ?').run(handle);
  }

  /** Lista handles favoritados pelo usuário (distintos; um handle pode estar em várias campanhas). */
  getFavoriteHandles(userId: number): string[] {
    const rows = this.db.prepare(
      'SELECT DISTINCT profile_handle FROM user_favorite WHERE user_id = ?'
    ).all(userId) as { profile_handle: string }[];
    return rows.map((r) => r.profile_handle);
  }

  /** Lista favoritos: um mesmo handle pode aparecer várias vezes (uma por campanha). */
  getFavorites(userId: number): { profile_handle: string; campaign_id: string | null }[] {
    const rows = this.db.prepare(
      'SELECT profile_handle, campaign_id FROM user_favorite WHERE user_id = ? ORDER BY created_at DESC'
    ).all(userId) as { profile_handle: string; campaign_id: string }[];
    return rows.map((r) => ({
      profile_handle: r.profile_handle,
      campaign_id: r.campaign_id && r.campaign_id.trim() !== '' ? r.campaign_id : null,
    }));
  }

  /** Adiciona favorito (idempotente por user+handle+campaign). O mesmo influencer pode estar em várias campanhas. */
  addFavorite(userId: number, profileHandle: string, campaignId?: string | null): void {
    const handle = profileHandle.toLowerCase().replace(/^@/, '').trim();
    if (!handle) return;
    const cid = campaignId?.trim() ? campaignId.trim() : '';
    this.db.prepare(
      `INSERT INTO user_favorite (user_id, profile_handle, campaign_id) VALUES (?, ?, ?)
       ON CONFLICT(user_id, profile_handle, campaign_id) DO NOTHING`
    ).run(userId, handle, cid);
  }

  /** Remove favorito. Se campaignId for informado, remove só essa (handle, campanha); senão remove todas as entradas do handle. */
  removeFavorite(userId: number, profileHandle: string, campaignId?: string | null): void {
    const handle = profileHandle.toLowerCase().replace(/^@/, '').trim();
    if (!handle) return;
    const cid = campaignId?.trim() ? campaignId.trim() : null;
    if (cid !== null) {
      this.db.prepare('DELETE FROM user_favorite WHERE user_id = ? AND profile_handle = ? AND campaign_id = ?').run(userId, handle, cid);
    } else {
      this.db.prepare('DELETE FROM user_favorite WHERE user_id = ? AND profile_handle = ?').run(userId, handle);
    }
  }

  /** Verifica se o usuário favoritou o handle (em qualquer campanha). */
  isFavorite(userId: number, profileHandle: string): boolean {
    const handle = profileHandle.toLowerCase().replace(/^@/, '').trim();
    const row = this.db.prepare(
      'SELECT 1 FROM user_favorite WHERE user_id = ? AND profile_handle = ? LIMIT 1'
    ).get(userId, handle);
    return !!row;
  }

  /** LGPD: remove todos os favoritos do usuário antes de excluir auth_user. */
  deleteAllFavoritesByUserId(userId: number): void {
    this.db.prepare('DELETE FROM user_favorite WHERE user_id = ?').run(userId);
  }

  /** Admin: remove o perfil das listas de favoritos de todos os usuários. */
  deleteAllFavoritesByProfileHandle(profileHandle: string): void {
    const handle = profileHandle.toLowerCase().replace(/^@/, '').trim();
    if (!handle) return;
    this.db.prepare('DELETE FROM user_favorite WHERE profile_handle = ?').run(handle);
  }

  /** Remove candidaturas do perfil em projetos (LGPD: exclusão de conta). */
  deleteProjectApplicationsByHandle(profileHandle: string): void {
    const handle = profileHandle.toLowerCase().replace(/^@/, '');
    this.db.prepare('DELETE FROM project_application WHERE profile_handle = ?').run(handle);
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
        SELECT profile_handle, address, address_number, zip_code, city, state, neighborhood, country, allow_gifts,
               whatsapp, tiktok, facebook, linkedin, twitter, websites,
               gender, description, about_topics, pricing, content_type, influence_audience, influence_age_range,
               audience_gender, brands_worked_with,
               activated_at, updated_at
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
    const influenceAudienceStr = data.influence_audience?.length ? JSON.stringify(data.influence_audience) : null;
    const influenceAgeRangeStr = data.influence_age_range?.length ? JSON.stringify(data.influence_age_range) : null;
    this.upsertActivation.run(
      handle,
      data.address ?? null,
      data.address_number ?? null,
      data.zip_code ?? null,
      data.city ?? null,
      data.state ?? null,
      data.neighborhood ?? null,
      data.country ?? null,
      data.allow_gifts === true ? '1' : (data.allow_gifts === false ? '0' : null),
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
      influenceAudienceStr,
      influenceAgeRangeStr,
      data.audience_gender ?? null,
      data.brands_worked_with ?? null,
      activated_at ?? null,
      updated_at
    );
  }

  clearAll(): void {
    this.db.exec('DELETE FROM profile_activation;');
    this.db.exec('DELETE FROM project_application;');
    this.db.exec('DELETE FROM project;');
  }

  /** Projetos para influenciadores (estilo Workana). */
  listProjects(opts?: { status?: string; category?: string; limit?: number; offset?: number }): { total: number; items: ProjectRow[] } {
    const status = opts?.status ?? 'open';
    const category = opts?.category?.trim();
    const limit = Math.min(Math.max(1, opts?.limit ?? 50), 100);
    const offset = Math.max(0, opts?.offset ?? 0);
    let where = 'WHERE status = ?';
    const params: (string | number)[] = [status];
    if (category) {
      where += ' AND (category = ? OR category LIKE ?)';
      params.push(category, `%${category}%`);
    }
    const countRow = this.db.prepare(`SELECT COUNT(*) as c FROM project ${where}`).get(...params) as { c: number };
    const total = countRow?.c ?? 0;
    const rows = this.db.prepare(
      `SELECT id, title, description, client_name, budget_min, budget_max, category, requirements, status, created_at, updated_at
       FROM project ${where}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset) as ProjectRow[];
    return { total, items: rows };
  }

  getProjectById(id: number): ProjectRow | null {
    const row = this.db.prepare(
      'SELECT id, title, description, client_name, budget_min, budget_max, category, requirements, status, created_at, updated_at FROM project WHERE id = ?'
    ).get(id) as ProjectRow | undefined;
    return row ?? null;
  }

  createProject(data: Omit<ProjectRow, 'id' | 'created_at' | 'updated_at'>): number {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO project (title, description, client_name, budget_min, budget_max, category, requirements, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      data.title,
      data.description,
      data.client_name ?? null,
      data.budget_min ?? null,
      data.budget_max ?? null,
      data.category ?? null,
      data.requirements ?? null,
      data.status ?? 'open',
      now,
      now
    );
    return info.lastInsertRowid as number;
  }

  applyToProject(projectId: number, profileHandle: string, message?: string): boolean {
    const handle = profileHandle.toLowerCase().replace(/^@/, '');
    const now = new Date().toISOString();
    try {
      this.db.prepare(
        'INSERT INTO project_application (project_id, profile_handle, message, created_at) VALUES (?, ?, ?, ?)'
      ).run(projectId, handle, message ?? null, now);
      return true;
    } catch (e) {
      return false; // duplicate or FK
    }
  }

  getProjectApplicationsCount(projectId: number): number {
    const row = this.db.prepare('SELECT COUNT(*) as c FROM project_application WHERE project_id = ?').get(projectId) as { c: number };
    return row?.c ?? 0;
  }

  hasApplied(projectId: number, profileHandle: string): boolean {
    const handle = profileHandle.toLowerCase().replace(/^@/, '');
    const row = this.db.prepare('SELECT 1 FROM project_application WHERE project_id = ? AND profile_handle = ?').get(projectId, handle);
    return !!row;
  }

  // ——— Direct em massa: templates e fila ———
  listMessageTemplates(): { id: number; hash: string; body: string; reject_hashes: string[]; created_at: string; send_delay_minutes: number }[] {
    const rows = this.db.prepare(
      'SELECT id, hash, body, COALESCE(reject_hashes, \'[]\') as reject_hashes, created_at, COALESCE(send_delay_minutes, 1) as send_delay_minutes FROM message_templates ORDER BY created_at DESC'
    ).all() as { id: number; hash: string; body: string; reject_hashes: string; created_at: string; send_delay_minutes: number }[];
    return rows.map((r) => {
      let arr: string[] = [];
      try {
        arr = JSON.parse(r.reject_hashes || '[]');
        if (!Array.isArray(arr)) arr = [];
      } catch {
        arr = [];
      }
      return { ...r, reject_hashes: arr, send_delay_minutes: r.send_delay_minutes ?? 1 };
    });
  }

  getMessageTemplateByHash(hash: string): { id: number; hash: string; body: string; reject_hashes: string[]; send_delay_minutes: number } | null {
    const row = this.db.prepare('SELECT id, hash, body, COALESCE(reject_hashes, \'[]\') as reject_hashes, COALESCE(send_delay_minutes, 1) as send_delay_minutes FROM message_templates WHERE hash = ?').get(hash.trim()) as { id: number; hash: string; body: string; reject_hashes: string; send_delay_minutes: number } | undefined;
    if (!row) return null;
    let arr: string[] = [];
    try {
      arr = JSON.parse(row.reject_hashes || '[]');
      if (!Array.isArray(arr)) arr = [];
    } catch {
      arr = [];
    }
    return { ...row, reject_hashes: arr, send_delay_minutes: row.send_delay_minutes ?? 1 };
  }

  getMessageTemplateById(id: number): { id: number; hash: string; body: string; reject_hashes: string[]; send_delay_minutes: number } | null {
    const row = this.db.prepare('SELECT id, hash, body, COALESCE(reject_hashes, \'[]\') as reject_hashes, COALESCE(send_delay_minutes, 1) as send_delay_minutes FROM message_templates WHERE id = ?').get(id) as { id: number; hash: string; body: string; reject_hashes: string; send_delay_minutes: number } | undefined;
    if (!row) return null;
    let arr: string[] = [];
    try {
      arr = JSON.parse(row.reject_hashes || '[]');
      if (!Array.isArray(arr)) arr = [];
    } catch {
      arr = [];
    }
    return { ...row, reject_hashes: arr, send_delay_minutes: row.send_delay_minutes ?? 1 };
  }

  createMessageTemplate(hash: string, body: string, rejectHashes: string[] = [], sendDelayMinutes: number = 1): number {
    const now = new Date().toISOString();
    const rejectJson = JSON.stringify(rejectHashes.filter(Boolean).map((h) => h.trim()).filter(Boolean));
    const delay = Math.max(1, Math.min(999, Math.floor(sendDelayMinutes)));
    const info = this.db.prepare(
      'INSERT INTO message_templates (hash, body, reject_hashes, created_at, send_delay_minutes) VALUES (?, ?, ?, ?, ?)'
    ).run(hash.trim(), body.trim(), rejectJson, now, delay);
    return info.lastInsertRowid as number;
  }

  updateMessageTemplate(id: number, opts: { body?: string; rejectHashes?: string[]; send_delay_minutes?: number }): boolean {
    const current = this.getMessageTemplateById(id);
    if (!current) return false;
    const body = opts.body !== undefined ? opts.body.trim() : current.body;
    const rejectHashes = opts.rejectHashes !== undefined ? opts.rejectHashes.filter(Boolean).map((h) => h.trim()).filter(Boolean) : current.reject_hashes;
    const rejectJson = JSON.stringify(rejectHashes);
    const delay = opts.send_delay_minutes !== undefined ? Math.max(1, Math.min(999, Math.floor(opts.send_delay_minutes))) : (current.send_delay_minutes ?? 1);
    const info = this.db.prepare('UPDATE message_templates SET body = ?, reject_hashes = ?, send_delay_minutes = ? WHERE id = ?').run(body, rejectJson, delay, id);
    return info.changes > 0;
  }

  /** True se este perfil já recebeu a mensagem com esse hash (status = sent). Não adicionar de novo. */
  hasAlreadyReceivedMessage(profileHandle: string, messageHash: string): boolean {
    const handle = profileHandle.toLowerCase().replace(/^@/, '');
    const row = this.db.prepare(
      'SELECT 1 FROM direct_queue WHERE profile_handle = ? AND message_hash = ? AND status = ? LIMIT 1'
    ).get(handle, messageHash.trim(), 'sent');
    return !!row;
  }

  /** True se já existe QUALQUER item pendente para este perfil (independente do template). */
  private hasPendingForHandle(profileHandle: string): boolean {
    const handle = profileHandle.toLowerCase().replace(/^@/, '');
    const row = this.db.prepare(
      'SELECT 1 FROM direct_queue WHERE profile_handle = ? AND status = ? LIMIT 1'
    ).get(handle, 'pending');
    return !!row;
  }

  /** True se já existe item pendente para este perfil E este hash (evita duplicar o mesmo template). */
  private hasPendingForHandleAndHash(profileHandle: string, messageHash: string): boolean {
    const handle = profileHandle.toLowerCase().replace(/^@/, '');
    const row = this.db.prepare(
      'SELECT 1 FROM direct_queue WHERE profile_handle = ? AND message_hash = ? AND status = ? LIMIT 1'
    ).get(handle, messageHash.trim(), 'pending');
    return !!row;
  }

  addToDirectQueue(profileHandle: string, messageHash: string, scheduledAt?: string): number {
    const handle = profileHandle.toLowerCase().replace(/^@/, '');
    // Já recebeu esse hash com sucesso? Não adicionar de novo.
    if (this.hasAlreadyReceivedMessage(handle, messageHash.trim())) return 0;
    // Já existe item pendente para este perfil com ESTE hash? Não duplicar.
    if (this.hasPendingForHandleAndHash(handle, messageHash.trim())) return 0;
    const now = new Date().toISOString();
    const scheduled =
      scheduledAt && typeof scheduledAt === 'string'
        ? new Date(scheduledAt).toISOString()
        : null;
    const info = this.db.prepare(
      'INSERT INTO direct_queue (profile_handle, message_hash, status, created_at, scheduled_at) VALUES (?, ?, ?, ?, ?)'
    ).run(handle, messageHash.trim(), 'pending', now, scheduled);
    return info.lastInsertRowid as number;
  }

  getDirectQueueItemById(id: number): { id: number; profile_handle: string; message_hash: string; status: string; scheduled_at: string | null } | null {
    const row = this.db.prepare(
      'SELECT id, profile_handle, message_hash, status, scheduled_at FROM direct_queue WHERE id = ?'
    ).get(id) as { id: number; profile_handle: string; message_hash: string; status: string; scheduled_at: string | null } | undefined;
    return row ?? null;
  }

  getNextPendingDirectQueueItem(): { id: number; profile_handle: string; message_hash: string; scheduled_at: string | null } | null {
    const nowIso = new Date().toISOString();
    const row = this.db.prepare(
      `SELECT id, profile_handle, message_hash, scheduled_at
       FROM direct_queue
       WHERE status = ?
         AND (scheduled_at IS NULL OR scheduled_at <= ?)
       ORDER BY
         CASE WHEN scheduled_at IS NULL THEN 1 ELSE 0 END,
         scheduled_at ASC,
         id ASC
       LIMIT 1`
    ).get('pending', nowIso) as { id: number; profile_handle: string; message_hash: string; scheduled_at: string | null } | undefined;
    return row ?? null;
  }

  updateDirectQueueItem(id: number, status: 'sent' | 'failed', error?: string): void {
    const sent_at = new Date().toISOString();
    this.db.prepare(
      'UPDATE direct_queue SET status = ?, sent_at = ?, error = ? WHERE id = ?'
    ).run(status, sent_at, error ?? null, id);
  }

  /** Atualiza um item da fila (message_hash, scheduled_at e/ou status). Se status for enviado, permite editar qualquer item; senão apenas pendentes. Retorna true se atualizou. */
  updatePendingDirectQueueItem(
    id: number,
    opts: { message_hash?: string; scheduled_at?: string | null; status?: 'pending' | 'sent' | 'failed' }
  ): boolean {
    const item = this.getDirectQueueItemById(id);
    if (!item) return false;
    const onlyPending = opts.status === undefined;
    if (onlyPending && item.status !== 'pending') return false;
    const updates: string[] = [];
    const values: unknown[] = [];
    if (opts.message_hash !== undefined && opts.message_hash.trim()) {
      updates.push('message_hash = ?');
      values.push(opts.message_hash.trim());
    }
    if (opts.scheduled_at !== undefined) {
      updates.push('scheduled_at = ?');
      values.push(
        opts.scheduled_at && opts.scheduled_at.trim()
          ? new Date(opts.scheduled_at.trim()).toISOString()
          : null
      );
    }
    if (opts.status !== undefined) {
      updates.push('status = ?');
      values.push(opts.status);
      if (opts.status === 'pending') {
        updates.push('sent_at = ?', 'error = ?');
        values.push(null, null);
      } else if (opts.status === 'sent') {
        updates.push('sent_at = COALESCE(sent_at, ?)', 'error = ?');
        values.push(new Date().toISOString(), null);
      } else if (opts.status === 'failed') {
        updates.push('sent_at = COALESCE(sent_at, ?)');
        values.push(new Date().toISOString());
      }
    }
    if (updates.length === 0) return true;
    values.push(id);
    const whereClause = onlyPending ? ' WHERE id = ? AND status = \'pending\'' : ' WHERE id = ?';
    this.db.prepare(
      `UPDATE direct_queue SET ${updates.join(', ')}${whereClause}`
    ).run(...values);
    return true;
  }

  /** Handles que já receberam a mensagem com o hash (status = sent). Para filtro incluir/excluir no disparo. */
  getHandlesByMessageHash(messageHash: string): string[] {
    const rows = this.db.prepare(
      'SELECT DISTINCT profile_handle FROM direct_queue WHERE message_hash = ? AND status = ? ORDER BY profile_handle'
    ).all(messageHash.trim(), 'sent') as { profile_handle: string }[];
    return rows.map((r) => r.profile_handle);
  }

  listDirectQueue(opts?: { status?: string; limit?: number; offset?: number }): { total: number; items: DirectQueueRow[] } {
    const status = opts?.status?.trim();
    const limit = Math.min(Math.max(1, opts?.limit ?? 200), 500);
    const offset = Math.max(0, opts?.offset ?? 0);
    const where = status ? 'WHERE status = ?' : '';
    const params = status ? [status] : [];
    const countRow = this.db.prepare(`SELECT COUNT(*) as c FROM direct_queue ${where}`).get(...params) as { c: number };
    const total = countRow?.c ?? 0;
    const items = this.db.prepare(
      `SELECT id, profile_handle, message_hash, status, sent_at, error, created_at, scheduled_at
       FROM direct_queue ${where}
       ORDER BY
         CASE status WHEN 'pending' THEN 0 WHEN 'sent' THEN 1 ELSE 2 END,
         CASE WHEN scheduled_at IS NULL THEN 1 ELSE 0 END,
         scheduled_at ASC,
         id ASC
       LIMIT ? OFFSET ?`
    ).all(...params, limit, offset) as DirectQueueRow[];
    return { total, items };
  }

  /** Remove todos os itens da fila de disparo. Retorna quantidade removida. */
  deleteAllDirectQueue(): number {
    const info = this.db.prepare('DELETE FROM direct_queue').run();
    return info.changes;
  }

  /** LGPD: remove todas as entradas da fila de DM associadas ao handle (exclusão de conta). */
  deleteDirectQueueByHandle(profileHandle: string): void {
    const handle = profileHandle.toLowerCase().replace(/^@/, '');
    if (!handle) return;
    this.db.prepare('DELETE FROM direct_queue WHERE profile_handle = ?').run(handle);
  }

  /** Remove um item da fila por id. Retorna true se removeu. */
  deleteDirectQueueItem(id: number): boolean {
    const info = this.db.prepare('DELETE FROM direct_queue WHERE id = ?').run(id);
    return info.changes > 0;
  }

  close(): void {
    this.db.close();
  }
}

export interface DirectQueueRow {
  id: number;
  profile_handle: string;
  message_hash: string;
  status: string;
  sent_at: string | null;
  error: string | null;
  created_at: string;
  scheduled_at: string | null;
}

export interface ProjectRow {
  id: number;
  title: string;
  description: string;
  client_name: string | null;
  budget_min: number | null;
  budget_max: number | null;
  category: string | null;
  requirements: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}
