/**
 * Problemas (erros da coleta) em SQLite — um arquivo local, sem limite prático de linhas.
 */

import Database from 'better-sqlite3';
import { existsSync, readFileSync, renameSync } from 'fs';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { randomUUID } from 'node:crypto';

let db: Database.Database | null = null;

export function issuesDbPath(): string {
  const raw = process.env.COLLECTOR_ISSUES_DB_PATH?.trim();
  if (raw) return raw;
  return join(process.cwd(), 'data', 'collector-issues.sqlite');
}

function legacyJsonPath(): string {
  const raw = process.env.COLLECTOR_ISSUES_PATH?.trim();
  if (raw) return raw;
  return join(process.cwd(), 'data', 'collector-issues.json');
}

export function openIssuesDb(): Database.Database {
  if (db) return db;
  const path = issuesDbPath();
  mkdirSync(dirname(path), { recursive: true });
  db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS issues (
      id TEXT PRIMARY KEY,
      handle_key TEXT NOT NULL,
      handle TEXT NOT NULL,
      kind TEXT NOT NULL,
      detail TEXT,
      at TEXT NOT NULL,
      full_name TEXT,
      followers_count INTEGER,
      attempted_endpoint TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_issues_at ON issues(at);
    CREATE INDEX IF NOT EXISTS idx_issues_handle_key ON issues(handle_key);
    CREATE TABLE IF NOT EXISTS integration_ok (
      handle_key TEXT PRIMARY KEY,
      handle TEXT NOT NULL,
      collected_at TEXT NOT NULL,
      integrated_at TEXT NOT NULL,
      api_host TEXT,
      rocks_verified TEXT,
      profile_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_integration_ok_at ON integration_ok(integrated_at);
  `);
  return db;
}

export type SqlIssueRow = {
  id: string;
  handle: string;
  handleKey: string;
  kind: 'extracao' | 'regra' | 'erro_api';
  detail?: string;
  at: string;
  full_name?: string;
  followers_count?: number;
  attemptedEndpoint?: string;
};

function rowFromStmt(r: {
  id: string;
  handle_key: string;
  handle: string;
  kind: string;
  detail: string | null;
  at: string;
  full_name: string | null;
  followers_count: number | null;
  attempted_endpoint: string | null;
}): SqlIssueRow {
  return {
    id: r.id,
    handleKey: r.handle_key,
    handle: r.handle,
    kind: r.kind as SqlIssueRow['kind'],
    detail: r.detail ?? undefined,
    at: r.at,
    full_name: r.full_name ?? undefined,
    followers_count: r.followers_count ?? undefined,
    attemptedEndpoint: r.attempted_endpoint ?? undefined,
  };
}

export function insertIssueRow(row: SqlIssueRow): void {
  const d = openIssuesDb();
  d.prepare(
    `INSERT INTO issues (id, handle_key, handle, kind, detail, at, full_name, followers_count, attempted_endpoint)
     VALUES (@id, @handle_key, @handle, @kind, @detail, @at, @full_name, @followers_count, @attempted_endpoint)`
  ).run({
    id: row.id,
    handle_key: row.handleKey,
    handle: row.handle,
    kind: row.kind,
    detail: row.detail ?? null,
    at: row.at,
    full_name: row.full_name ?? null,
    followers_count: row.followers_count ?? null,
    attempted_endpoint: row.attemptedEndpoint ?? null,
  });
}

export function deleteIssueRowById(id: string): boolean {
  const d = openIssuesDb();
  const r = d.prepare('DELETE FROM issues WHERE id = ?').run(id);
  return r.changes > 0;
}

export function deleteAllIssueRows(): void {
  const d = openIssuesDb();
  d.exec('DELETE FROM issues');
}

export function countIssueRows(): number {
  const d = openIssuesDb();
  const n = d.prepare('SELECT COUNT(*) AS c FROM issues').get() as { c: number };
  return Number(n.c) || 0;
}

export type SqlIntegrationOkRow = {
  handleKey: string;
  handle: string;
  collectedAt: string;
  integratedAt: string;
  apiHost: string;
  rocksVerified: string;
  profileJson: string;
};

export function upsertIntegrationOkRow(row: SqlIntegrationOkRow): void {
  const d = openIssuesDb();
  d.prepare(
    `INSERT INTO integration_ok (handle_key, handle, collected_at, integrated_at, api_host, rocks_verified, profile_json)
     VALUES (@handle_key, @handle, @collected_at, @integrated_at, @api_host, @rocks_verified, @profile_json)
     ON CONFLICT(handle_key) DO UPDATE SET
       handle = excluded.handle,
       collected_at = excluded.collected_at,
       integrated_at = excluded.integrated_at,
       api_host = excluded.api_host,
       rocks_verified = excluded.rocks_verified,
       profile_json = excluded.profile_json`
  ).run({
    handle_key: row.handleKey,
    handle: row.handle,
    collected_at: row.collectedAt,
    integrated_at: row.integratedAt,
    api_host: row.apiHost || null,
    rocks_verified: row.rocksVerified || null,
    profile_json: row.profileJson,
  });
}

export function deleteIntegrationOkByHandleKey(handleKey: string): boolean {
  const k = String(handleKey ?? '')
    .replace(/^@/, '')
    .trim()
    .toLowerCase();
  if (!k) return false;
  const d = openIssuesDb();
  const r = d.prepare('DELETE FROM integration_ok WHERE handle_key = ?').run(k);
  return r.changes > 0;
}

export function hasIntegrationOkByHandleKey(handleKey: string): boolean {
  const k = String(handleKey ?? '')
    .replace(/^@/, '')
    .trim()
    .toLowerCase();
  if (!k) return false;
  const d = openIssuesDb();
  const row = d.prepare('SELECT 1 AS x FROM integration_ok WHERE handle_key = ? LIMIT 1').get(k) as
    | { x: number }
    | undefined;
  return row != null;
}

export function deleteAllIntegrationOkRows(): void {
  const d = openIssuesDb();
  d.exec('DELETE FROM integration_ok');
}

export function countIntegrationOkRows(): number {
  const d = openIssuesDb();
  const n = d.prepare('SELECT COUNT(*) AS c FROM integration_ok').get() as { c: number };
  return Number(n.c) || 0;
}

export function selectAllIntegrationOkOrderByIntegratedAtDesc(): SqlIntegrationOkRow[] {
  const d = openIssuesDb();
  const rows = d
    .prepare(
      `SELECT handle_key, handle, collected_at, integrated_at, api_host, rocks_verified, profile_json
       FROM integration_ok ORDER BY integrated_at DESC`
    )
    .all() as {
      handle_key: string;
      handle: string;
      collected_at: string;
      integrated_at: string;
      api_host: string | null;
      rocks_verified: string | null;
      profile_json: string;
    }[];
  return rows.map((r) => ({
    handleKey: r.handle_key,
    handle: r.handle,
    collectedAt: r.collected_at,
    integratedAt: r.integrated_at,
    apiHost: r.api_host ?? '',
    rocksVerified: r.rocks_verified ?? '',
    profileJson: r.profile_json,
  }));
}

/** Há registro em Problemas para este handle (consulta direta ao SQLite). */
export function hasIssueRowForHandleKey(handleKey: string): boolean {
  const k = String(handleKey ?? '')
    .replace(/^@/, '')
    .trim()
    .toLowerCase();
  if (!k) return false;
  const d = openIssuesDb();
  const row = d.prepare('SELECT 1 AS x FROM issues WHERE handle_key = ? LIMIT 1').get(k) as
    | { x: number }
    | undefined;
  return row != null;
}

export function distinctIssueHandleKeys(): Set<string> {
  const d = openIssuesDb();
  const s = new Set<string>();
  const stmt = d.prepare('SELECT DISTINCT handle_key FROM issues');
  for (const r of stmt.iterate() as Iterable<{ handle_key: string }>) {
    const k = String(r.handle_key || '')
      .replace(/^@/, '')
      .trim()
      .toLowerCase();
    if (k) s.add(k);
  }
  return s;
}

/** Só `handle_key` — para dedupe sem carregar `profile_json` (evita OOM com centenas de milhares de linhas). */
export function forEachIntegrationHandleKey(fn: (handleKey: string) => void): void {
  const d = openIssuesDb();
  const stmt = d.prepare('SELECT handle_key FROM integration_ok');
  for (const r of stmt.iterate() as Iterable<{ handle_key: string }>) {
    const k = String(r.handle_key || '')
      .replace(/^@/, '')
      .trim()
      .toLowerCase();
    if (k) fn(k);
  }
}

/** Integrados mais recentes para UI/ledger (LIMIT). */
export function selectRecentIntegrationOkOrderByIntegratedAtDesc(limit: number): SqlIntegrationOkRow[] {
  const lim = Math.max(1, Math.min(2000, Math.floor(Number(limit)) || 1));
  const d = openIssuesDb();
  const rows = d
    .prepare(
      `SELECT handle_key, handle, collected_at, integrated_at, api_host, rocks_verified, profile_json
       FROM integration_ok ORDER BY integrated_at DESC LIMIT ?`
    )
    .all(lim) as {
      handle_key: string;
      handle: string;
      collected_at: string;
      integrated_at: string;
      api_host: string | null;
      rocks_verified: string | null;
      profile_json: string;
    }[];
  return rows.map((r) => ({
    handleKey: r.handle_key,
    handle: r.handle,
    collectedAt: r.collected_at,
    integratedAt: r.integrated_at,
    apiHost: r.api_host ?? '',
    rocksVerified: r.rocks_verified ?? '',
    profileJson: r.profile_json,
  }));
}

/** Problemas mais recentes (fatia em memória; total completo via COUNT no SQLite). */
export function selectIssuesOrderByAtDescLimit(limit: number): SqlIssueRow[] {
  const lim = Math.max(1, Math.min(8000, Math.floor(Number(limit)) || 1));
  const d = openIssuesDb();
  const rows = d
    .prepare(
      `SELECT id, handle_key, handle, kind, detail, at, full_name, followers_count, attempted_endpoint
       FROM issues ORDER BY at DESC LIMIT ?`
    )
    .all(lim) as {
      id: string;
      handle_key: string;
      handle: string;
      kind: string;
      detail: string | null;
      at: string;
      full_name: string | null;
      followers_count: number | null;
      attempted_endpoint: string | null;
    }[];
  return rows.map(rowFromStmt);
}

/** Todas as linhas de Problemas, mais recentes primeiro (sem limite na query). */
export function selectAllIssuesOrderByAtDesc(): SqlIssueRow[] {
  const d = openIssuesDb();
  const rows = d
    .prepare(
      `SELECT id, handle_key, handle, kind, detail, at, full_name, followers_count, attempted_endpoint
       FROM issues ORDER BY at DESC`
    )
    .all() as {
      id: string;
      handle_key: string;
      handle: string;
      kind: string;
      detail: string | null;
      at: string;
      full_name: string | null;
      followers_count: number | null;
      attempted_endpoint: string | null;
    }[];
  return rows.map(rowFromStmt);
}

/** Migra collector-issues.json → SQLite uma vez (só se a tabela estiver vazia). */
export function migrateLegacyJsonIfNeeded(): void {
  const d = openIssuesDb();
  const n = countIssueRows();
  if (n > 0) return;
  const jsonPath = legacyJsonPath();
  if (!existsSync(jsonPath)) return;
  try {
    const raw = readFileSync(jsonPath, 'utf-8');
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr) || arr.length === 0) return;
    const ins = d.prepare(
      `INSERT OR IGNORE INTO issues (id, handle_key, handle, kind, detail, at, full_name, followers_count, attempted_endpoint)
       VALUES (@id, @handle_key, @handle, @kind, @detail, @at, @full_name, @followers_count, @attempted_endpoint)`
    );
    const tx = d.transaction((items: unknown[]) => {
      for (const item of items) {
        if (item == null || typeof item !== 'object') continue;
        const o = item as Record<string, unknown>;
        const k = String(o.handle ?? '')
          .replace(/^@/, '')
          .trim()
          .toLowerCase();
        if (!k) continue;
        const kind = String(o.kind ?? '');
        if (kind !== 'extracao' && kind !== 'regra' && kind !== 'erro_api') continue;
        const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : randomUUID();
        ins.run({
          id,
          handle_key: k,
          handle: k,
          kind,
          detail: typeof o.detail === 'string' ? o.detail : null,
          at: typeof o.at === 'string' ? o.at : new Date().toISOString(),
          full_name: typeof o.full_name === 'string' ? o.full_name : null,
          followers_count: typeof o.followers_count === 'number' ? o.followers_count : null,
          attempted_endpoint: typeof o.attemptedEndpoint === 'string' ? o.attemptedEndpoint : null,
        });
      }
    });
    tx(arr);
    const migrated = countIssueRows();
    if (migrated > 0) {
      try {
        renameSync(jsonPath, jsonPath + '.migrated-to-sqlite.bak');
      } catch {
        /* backup opcional */
      }
      console.log(
        `[ledger] Migrados ${migrated} registro(s) de Problemas de ${jsonPath} → ${issuesDbPath()} (JSON renomeado com sufixo .bak)`
      );
    }
  } catch (e) {
    console.warn(
      '[ledger] Migração JSON → SQLite falhou (use o .json manualmente se precisar):',
      e instanceof Error ? e.message : e
    );
  }
}
