/**
 * Sincroniza perfis e posts para SQLite (data/influencer.db) para que a tabela `post` e `profiles` fiquem populadas.
 * Uso: junto com RocksDBStorage, chamar save/savePosts aqui também.
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const DEFAULT_PATH = './data/influencer.db';

export class SqliteSync {
  private db: Database.Database;
  private insertProfile: Database.Statement;
  private insertPost: Database.Statement;

  constructor(dbPath: string = process.env.SQLITE_DB_PATH ?? DEFAULT_PATH) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.ensureSchema();
    this.insertProfile = this.db.prepare(`
      INSERT OR REPLACE INTO profiles (handle, payload, updated_at)
      VALUES (?, ?, ?)
    `);
    this.insertPost = this.db.prepare(`
      INSERT OR REPLACE INTO post (profile_handle, shortcode, payload, collected_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
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
    `);
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

  clearAll(): void {
    this.db.exec('DELETE FROM post; DELETE FROM profiles;');
  }

  close(): void {
    this.db.close();
  }
}
