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
  email_verified?: number;
  email_verification_token?: string | null;
  email_verification_expires_at?: string | null;
  mission_instagram_claimed?: number;
  /** Nome escolhido no cadastro (ex.: assinante). */
  display_name?: string | null;
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
    const oldPublic = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='auth_public_search'").get();
    if (oldPublic) this.db.exec('DROP TABLE IF EXISTS auth_public_search');
    const oldAnon = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='auth_anonymous_search'").get();
    if (oldAnon) this.db.exec('DROP TABLE IF EXISTS auth_anonymous_search');
    this.db.exec('DROP TABLE IF EXISTS auth_public_request');
    this.db.exec('DROP TABLE IF EXISTS auth_anonymous_request');
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
    // Colunas para verificação de e-mail e missão Instagram (assinante)
    const addColIfMissing = (col: string, sql: string) => {
      const cols = this.db.prepare(`PRAGMA table_info(auth_user)`).all() as { name: string }[];
      if (!cols.some((c) => c.name === col)) this.db.exec(sql);
    };
    addColIfMissing('email_verified', 'ALTER TABLE auth_user ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1');
    addColIfMissing('email_verification_token', 'ALTER TABLE auth_user ADD COLUMN email_verification_token TEXT');
    addColIfMissing('email_verification_expires_at', 'ALTER TABLE auth_user ADD COLUMN email_verification_expires_at TEXT');
    addColIfMissing('mission_instagram_claimed', 'ALTER TABLE auth_user ADD COLUMN mission_instagram_claimed INTEGER NOT NULL DEFAULT 0');
    addColIfMissing('display_name', 'ALTER TABLE auth_user ADD COLUMN display_name TEXT');
  }

  private authUserSelect = 'id, username, password_hash, scope, profile_handle, created_at, COALESCE(email_verified, 1) AS email_verified, email_verification_token, email_verification_expires_at, COALESCE(mission_instagram_claimed, 0) AS mission_instagram_claimed, display_name';

  getByUsername(username: string): AuthUserRow | undefined {
    const u = username.trim().toLowerCase().replace(/@/g, '');
    if (!u) return undefined;
    const row = this.db.prepare(`SELECT ${this.authUserSelect} FROM auth_user WHERE LOWER(TRIM(REPLACE(username, '@', ''))) = ?`).get(u) as AuthUserRow | undefined;
    return row;
  }

  getById(id: number): AuthUserRow | undefined {
    const row = this.db.prepare(`SELECT ${this.authUserSelect} FROM auth_user WHERE id = ?`).get(id) as AuthUserRow | undefined;
    return row;
  }

  createUser(username: string, passwordHash: string, scope: AuthScope, profileHandle: string | null = null, displayName?: string | null): number {
    const u = username.replace(/^@/, '').trim().toLowerCase();
    if (!u) throw new Error('Username inválido');
    const stmt = this.db.prepare(`
      INSERT INTO auth_user (username, password_hash, scope, profile_handle, display_name)
      VALUES (?, ?, ?, ?, ?)
    `);
    const info = stmt.run(u, passwordHash, scope, profileHandle ?? null, displayName != null && displayName !== '' ? displayName.trim() : null);
    return info.lastInsertRowid as number;
  }

  setEmailVerification(userId: number, token: string, expiresAt: string): void {
    this.db.prepare(
      'UPDATE auth_user SET email_verified = 0, email_verification_token = ?, email_verification_expires_at = ? WHERE id = ?'
    ).run(token, expiresAt, userId);
  }

  getUserIdByEmailVerificationToken(token: string): number | null {
    const row = this.db.prepare(
      'SELECT id FROM auth_user WHERE email_verification_token = ? AND (email_verification_expires_at IS NULL OR email_verification_expires_at > datetime(\'now\'))'
    ).get(token.trim()) as { id: number } | undefined;
    return row ? row.id : null;
  }

  setEmailVerified(userId: number): void {
    this.db.prepare(
      'UPDATE auth_user SET email_verified = 1 WHERE id = ?'
    ).run(userId);
  }

  isMissionInstagramClaimed(userId: number): boolean {
    const row = this.db.prepare('SELECT COALESCE(mission_instagram_claimed, 0) AS v FROM auth_user WHERE id = ?').get(userId) as { v: number } | undefined;
    return row ? row.v === 1 : false;
  }

  setMissionInstagramClaimed(userId: number): void {
    this.db.prepare('UPDATE auth_user SET mission_instagram_claimed = 1 WHERE id = ?').run(userId);
  }

  listUsers(): Omit<AuthUserRow, 'password_hash'>[] {
    const rows = this.db.prepare(`SELECT id, username, scope, profile_handle, created_at, COALESCE(email_verified, 1) AS email_verified, COALESCE(mission_instagram_claimed, 0) AS mission_instagram_claimed FROM auth_user ORDER BY id`).all() as (Omit<AuthUserRow, 'password_hash'> & { password_hash?: string })[];
    return rows;
  }

  updateUser(id: number, updates: { username?: string; password_hash?: string; scope?: AuthScope; profile_handle?: string | null; display_name?: string | null }): void {
    const user = this.getById(id);
    if (!user) throw new Error('User not found');
    const username = updates.username !== undefined ? updates.username.replace(/^@/, '').trim().toLowerCase() : user.username;
    const password_hash = updates.password_hash !== undefined ? updates.password_hash : user.password_hash;
    const scope = updates.scope !== undefined ? updates.scope : user.scope;
    const profile_handle = updates.profile_handle !== undefined ? updates.profile_handle : user.profile_handle;
    const display_name = updates.display_name !== undefined ? (updates.display_name == null || String(updates.display_name).trim() === '' ? null : String(updates.display_name).trim()) : (user as AuthUserRow).display_name ?? null;
    this.db.prepare('UPDATE auth_user SET username = ?, password_hash = ?, scope = ?, profile_handle = ?, display_name = ? WHERE id = ?').run(username, password_hash, scope, profile_handle, display_name, id);
  }

  deleteUser(id: number): void {
    if (!Number.isInteger(id) || id < 1) {
      throw new Error('deleteUser: id inválido');
    }
    const result = this.db.prepare('DELETE FROM auth_user WHERE id = ?').run(id) as { changes: number };
    if (result.changes === 0) {
      throw new Error('Usuário não encontrado');
    }
    if (result.changes > 1) {
      throw new Error('deleteUser: esperado 1 linha removida, removidas ' + result.changes);
    }
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
      `SELECT ${this.authUserSelect} FROM auth_user
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
