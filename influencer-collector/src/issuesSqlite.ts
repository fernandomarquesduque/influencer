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
  const rows = d.prepare('SELECT DISTINCT handle_key FROM issues').all() as { handle_key: string }[];
  const s = new Set<string>();
  for (const r of rows) {
    const k = String(r.handle_key || '')
      .replace(/^@/, '')
      .trim()
      .toLowerCase();
    if (k) s.add(k);
  }
  return s;
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
