/**
 * Mapeamento opaco profile_ref (UUID) ↔ handle Instagram (uso interno no servidor).
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isProfileRef(value: string): boolean {
  return UUID_RE.test(String(value || '').trim());
}

export function normalizeHandleForRef(handle: string): string {
  return String(handle || '')
    .replace(/^@+/, '')
    .trim()
    .toLowerCase();
}

export class ProfileRefDb {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.ensureSchema();
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS profile_ref (
        profile_ref TEXT PRIMARY KEY,
        profile_handle TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_profile_ref_handle ON profile_ref(profile_handle);
    `);
  }

  getOrCreateRef(handle: string): string {
    const h = normalizeHandleForRef(handle);
    if (!h) throw new Error('Handle inválido para profile_ref');
    const existing = this.db
      .prepare('SELECT profile_ref FROM profile_ref WHERE profile_handle = ?')
      .get(h) as { profile_ref: string } | undefined;
    if (existing?.profile_ref) return existing.profile_ref;
    const ref = randomUUID();
    this.db
      .prepare('INSERT INTO profile_ref (profile_ref, profile_handle) VALUES (?, ?)')
      .run(ref, h);
    return ref;
  }

  getHandleByRef(ref: string): string | null {
    const r = String(ref || '').trim();
    if (!isProfileRef(r)) return null;
    const row = this.db
      .prepare('SELECT profile_handle FROM profile_ref WHERE profile_ref = ?')
      .get(r) as { profile_handle: string } | undefined;
    return row?.profile_handle ?? null;
  }

  getRefByHandle(handle: string): string | null {
    const h = normalizeHandleForRef(handle);
    if (!h) return null;
    const row = this.db
      .prepare('SELECT profile_ref FROM profile_ref WHERE profile_handle = ?')
      .get(h) as { profile_ref: string } | undefined;
    return row?.profile_ref ?? null;
  }

  /** Resolve identificador da URL/API: UUID → handle; senão trata como handle legado. */
  resolveToHandle(identifier: string): string | null {
    const raw = String(identifier || '').trim();
    if (!raw) return null;
    if (isProfileRef(raw)) {
      return this.getHandleByRef(raw);
    }
    const h = normalizeHandleForRef(raw);
    return h || null;
  }

  backfillAllHandles(handles: Iterable<string>): { created: number; existing: number } {
    let created = 0;
    let existing = 0;
    for (const handle of handles) {
      const h = normalizeHandleForRef(handle);
      if (!h) continue;
      const before = this.getRefByHandle(h);
      if (before) {
        existing += 1;
        continue;
      }
      this.getOrCreateRef(h);
      created += 1;
    }
    return { created, existing };
  }
}
