/**
 * APIs de consulta read-only para as tabelas do SQLite.
 * Usado em /api/admin/db/* (requer scope adm).
 */

import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

const DEFAULT_PATH = './data/influencer.db';

/** Tabelas permitidas para consulta. */
const ALLOWED_TABLES = [
  'auth_user',
  'auth_public_request',
  'auth_anonymous_request',
  'auth_profile_verification',
  'profiles',
  'post',
  'profile_activation',
] as const;

/** Colunas a ocultar por segurança (nunca retornar em JSON). */
const HIDDEN_COLUMNS: Record<string, string[]> = {
  auth_user: ['password_hash'],
};

export type AllowedTable = (typeof ALLOWED_TABLES)[number];

export function isAllowedTable(name: string): name is AllowedTable {
  return (ALLOWED_TABLES as readonly string[]).includes(name);
}

export interface TableRow {
  [key: string]: unknown;
}

export interface QueryResult {
  table: string;
  rows: TableRow[];
  total: number;
  limit: number;
  offset: number;
}

export function listTables(dbPath: string): string[] {
  const path = (dbPath || process.env.SQLITE_DB_PATH) ?? DEFAULT_PATH;
  const dir = dirname(path);
  if (!existsSync(dir)) return [];
  const db = new Database(path, { readonly: true });
  try {
    const rows = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    ).all() as { name: string }[];
    return rows.map((r) => r.name).filter(isAllowedTable);
  } finally {
    db.close();
  }
}

export function queryTable(
  dbPath: string,
  table: string,
  limit = 100,
  offset = 0
): QueryResult {
  if (!isAllowedTable(table)) {
    throw new Error(`Tabela não permitida: ${table}. Permitidas: ${ALLOWED_TABLES.join(', ')}`);
  }
  const path = (dbPath || process.env.SQLITE_DB_PATH) ?? DEFAULT_PATH;
  const dir = dirname(path);
  if (!existsSync(dir)) {
    throw new Error('Banco de dados não encontrado');
  }
  const db = new Database(path, { readonly: true });
  try {
    const safeLimit = Math.min(Math.max(1, limit), 1000);
    const safeOffset = Math.max(0, offset);
    const totalRow = db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number };
    const total = totalRow?.c ?? 0;
    const rows = db.prepare(
      `SELECT * FROM ${table} LIMIT ? OFFSET ?`
    ).all(safeLimit, safeOffset) as TableRow[];
    const hidden = HIDDEN_COLUMNS[table];
    const sanitized = hidden
      ? rows.map((r) => {
        const out = { ...r };
        for (const col of hidden) delete out[col];
        return out;
      })
      : rows;
    return {
      table,
      rows: sanitized,
      total,
      limit: safeLimit,
      offset: safeOffset,
    };
  } finally {
    db.close();
  }
}
