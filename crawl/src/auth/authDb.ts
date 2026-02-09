import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { AuthScope } from './types.js';

const DEFAULT_PATH = './data/influencer.db';

export interface AuthUserRow {
  id: number;
  username: string;
  password_hash: string;
  scope: string;
  profile_handle: string | null;
  created_at: string;
}

export class AuthDb {
  private db: Database.Database;

  constructor(dbPath: string = process.env.SQLITE_DB_PATH ?? DEFAULT_PATH) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.ensureSchema();
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS auth_user (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        scope TEXT NOT NULL,
        profile_handle TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    const authUserCols = this.db.prepare(`PRAGMA table_info(auth_user)`).all() as { name: string }[];
    const hasEmail = authUserCols.some((c) => c.name === 'email');
    if (hasEmail) {
      this.db.exec(`
        CREATE TABLE auth_user_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          scope TEXT NOT NULL,
          profile_handle TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO auth_user_new (id, username, password_hash, scope, profile_handle, created_at)
        SELECT id,
          COALESCE(
            NULLIF(LOWER(TRIM(REPLACE(REPLACE(COALESCE(profile_handle,''), '@', ''), ' ', ''))), ''),
            NULLIF(REPLACE(LOWER(SUBSTR(email, 1, INSTR(email || '@', '@') - 1)), '.', '_'), ''),
            'user_' || id
          ),
          password_hash, scope, profile_handle, created_at
        FROM auth_user;
        DROP TABLE auth_user;
        ALTER TABLE auth_user_new RENAME TO auth_user;
      `);
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS auth_public_request (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        search_date TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES auth_user(id)
      );
      CREATE TABLE IF NOT EXISTS auth_anonymous_request (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip_hash TEXT NOT NULL,
        search_date TEXT NOT NULL
      );
    `);
    const oldPublic = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='auth_public_search'").get();
    if (oldPublic) this.db.exec('DROP TABLE IF EXISTS auth_public_search');
    const oldAnon = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='auth_anonymous_search'").get();
    if (oldAnon) this.db.exec('DROP TABLE IF EXISTS auth_anonymous_search');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS auth_profile_verification (
        handle TEXT NOT NULL,
        code TEXT NOT NULL,
        user_id INTEGER,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (handle)
      );
    `);
    const pvCols = this.db.prepare(`PRAGMA table_info(auth_profile_verification)`).all() as Array<{ name: string; notnull?: number }>;
    const userIdCol = pvCols.find((c) => c.name === 'user_id');
    if (userIdCol?.notnull === 1) {
      this.db.exec(`
        CREATE TABLE auth_profile_verification_new (handle TEXT NOT NULL, code TEXT NOT NULL, user_id INTEGER, expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (handle));
        INSERT INTO auth_profile_verification_new SELECT handle, code, user_id, expires_at, created_at FROM auth_profile_verification;
        DROP TABLE auth_profile_verification;
        ALTER TABLE auth_profile_verification_new RENAME TO auth_profile_verification;
      `);
    }
  }

  getByUsername(username: string): AuthUserRow | undefined {
    const u = username.replace(/^@/, '').trim().toLowerCase();
    if (!u) return undefined;
    const row = this.db.prepare('SELECT id, username, password_hash, scope, profile_handle, created_at FROM auth_user WHERE LOWER(TRIM(REPLACE(username, \'@\', \'\'))) = ?').get(u) as AuthUserRow | undefined;
    return row;
  }

  getById(id: number): AuthUserRow | undefined {
    const row = this.db.prepare('SELECT id, username, password_hash, scope, profile_handle, created_at FROM auth_user WHERE id = ?').get(id) as AuthUserRow | undefined;
    return row;
  }

  createUser(username: string, passwordHash: string, scope: AuthScope, profileHandle: string | null = null): number {
    const u = username.replace(/^@/, '').trim().toLowerCase();
    if (!u) throw new Error('Username inválido');
    const stmt = this.db.prepare(`
      INSERT INTO auth_user (username, password_hash, scope, profile_handle)
      VALUES (?, ?, ?, ?)
    `);
    const info = stmt.run(u, passwordHash, scope, profileHandle ?? null);
    return info.lastInsertRowid as number;
  }

  listUsers(): Omit<AuthUserRow, 'password_hash'>[] {
    const rows = this.db.prepare('SELECT id, username, scope, profile_handle, created_at FROM auth_user ORDER BY id').all() as (Omit<AuthUserRow, 'password_hash'> & { password_hash?: string })[];
    return rows;
  }

  updateUser(id: number, updates: { username?: string; password_hash?: string; scope?: AuthScope; profile_handle?: string | null }): void {
    const user = this.getById(id);
    if (!user) throw new Error('User not found');
    const username = updates.username !== undefined ? updates.username.replace(/^@/, '').trim().toLowerCase() : user.username;
    const password_hash = updates.password_hash !== undefined ? updates.password_hash : user.password_hash;
    const scope = updates.scope !== undefined ? updates.scope : user.scope;
    const profile_handle = updates.profile_handle !== undefined ? updates.profile_handle : user.profile_handle;
    this.db.prepare('UPDATE auth_user SET username = ?, password_hash = ?, scope = ?, profile_handle = ? WHERE id = ?').run(username, password_hash, scope, profile_handle, id);
  }

  deleteUser(id: number): void {
    this.db.prepare('DELETE FROM auth_public_request WHERE user_id = ?').run(id);
    this.db.prepare('DELETE FROM auth_user WHERE id = ?').run(id);
  }

  /** Quantidade de requisições à API de busca feitas pelo usuário hoje (limite/dia definido em server: PUBLIC_MAX_REQUESTS_PER_DAY). */
  countPublicRequestsToday(userId: number): number {
    const today = new Date().toISOString().slice(0, 10);
    const row = this.db.prepare(
      'SELECT COUNT(*) as c FROM auth_public_request WHERE user_id = ? AND search_date = ?'
    ).get(userId, today) as { c: number };
    return row?.c ?? 0;
  }

  addPublicRequest(userId: number): void {
    const today = new Date().toISOString().slice(0, 10);
    this.db.prepare('INSERT INTO auth_public_request (user_id, search_date) VALUES (?, ?)').run(userId, today);
  }

  /** Quantidade de requisições à API de busca por IP hoje (limite/dia definido em server: PUBLIC_MAX_REQUESTS_PER_DAY). */
  countAnonymousRequestsToday(ipHash: string): number {
    const today = new Date().toISOString().slice(0, 10);
    const row = this.db.prepare(
      'SELECT COUNT(*) as c FROM auth_anonymous_request WHERE ip_hash = ? AND search_date = ?'
    ).get(ipHash, today) as { c: number };
    return row?.c ?? 0;
  }

  addAnonymousRequest(ipHash: string): void {
    const today = new Date().toISOString().slice(0, 10);
    this.db.prepare('INSERT INTO auth_anonymous_request (ip_hash, search_date) VALUES (?, ?)').run(ipHash, today);
  }

  /** Salva ou substitui código de verificação (userId null = 2FA como login, sem conta prévia). */
  saveProfileVerification(handle: string, code: string, userId: number | null, expiresAt: string): void {
    const h = handle.replace(/^@/, '').trim().toLowerCase();
    if (!h) throw new Error('Handle inválido');
    this.db.prepare(
      `INSERT OR REPLACE INTO auth_profile_verification (handle, code, user_id, expires_at) VALUES (?, ?, ?, ?)`
    ).run(h, code, userId, expiresAt);
  }

  /** Se handle+code válidos e não expirados, retorna o user_id da linha (null = pedido sem login). Senão null. */
  getProfileVerification(handle: string, code: string): number | null | 'valid_no_user' {
    const h = handle.replace(/^@/, '').trim().toLowerCase();
    const row = this.db.prepare(
      `SELECT user_id FROM auth_profile_verification WHERE handle = ? AND code = ? AND expires_at > datetime('now')`
    ).get(h, code.trim()) as { user_id: number | null } | undefined;
    if (row === undefined) return null;
    if (row.user_id === null) return 'valid_no_user';
    return row.user_id;
  }

  /** Usuário por username ou profile_handle (handle do influencer, normalizado, sem @). */
  getByProfileHandle(handle: string): AuthUserRow | undefined {
    const h = handle.replace(/^@/, '').trim().toLowerCase();
    if (!h) return undefined;
    const row = this.db.prepare(
      `SELECT id, username, password_hash, scope, profile_handle, created_at FROM auth_user
       WHERE LOWER(TRIM(REPLACE(username, '@', ''))) = ? OR (profile_handle IS NOT NULL AND LOWER(TRIM(REPLACE(profile_handle, '@', ''))) = ?)`
    ).get(h, h) as AuthUserRow | undefined;
    return row;
  }

  /** Remove o código de verificação do handle (após uso ou limpeza). */
  clearProfileVerification(handle: string): void {
    const h = handle.replace(/^@/, '').trim().toLowerCase();
    this.db.prepare('DELETE FROM auth_profile_verification WHERE handle = ?').run(h);
  }

  close(): void {
    this.db.close();
  }
}
