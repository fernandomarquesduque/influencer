/**
 * Agrega contagens para o painel administrativo (RocksDB + SQLite).
 */

import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CompositeStorage } from '../storage/compositeStorage.js';

const SQLITE_TABLES = [
  'auth_user',
  'auth_profile_verification',
  'profile_activation',
  'campaign',
  'user_credits',
  'credit_transaction',
  'payment',
  'direct_queue',
  'user_favorite',
  'message_templates',
  'project',
  'project_application',
] as const;

export interface AdminStatsResponse {
  generatedAt: string;
  rocksdb: {
    profiles: number;
    posts: number;
  };
  sqlite: {
    available: boolean;
    tables: Record<string, number>;
    usersByScope?: { scope: string; count: number }[];
    campaignsByPayment?: { payment_status: string; count: number }[];
    paymentsByStatus?: { status: string; count: number }[];
  };
}

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`)
    .get(name) as { 1: number } | undefined;
  return row != null;
}

function safeCount(db: Database.Database, table: (typeof SQLITE_TABLES)[number]): number | null {
  if (!tableExists(db, table)) return null;
  const row = db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number };
  return row?.c ?? 0;
}

/** Contagem RocksDB é O(n) — cache em memória + uma única computação concorrente. */
let adminStatsCache: { data: AdminStatsResponse; expiresAt: number } | null = null;
let adminStatsPending: Promise<AdminStatsResponse> | null = null;

function adminStatsTtlMs(): number {
  const n = Number(process.env.ADMIN_STATS_CACHE_TTL_MS);
  if (Number.isFinite(n) && n >= 3000) return n;
  return 60_000;
}

/**
 * Snapshot para o painel. Usa cache (TTL) e reutiliza a mesma Promise quando várias requisições
 * chegam durante o cálculo. `bypassCache` força novo scan (botão Atualizar).
 */
export async function getAdminStatsSnapshot(
  sqlitePath: string,
  storage: CompositeStorage,
  opts: { bypassCache?: boolean } = {}
): Promise<AdminStatsResponse> {
  if (opts.bypassCache) {
    return buildAdminStats(sqlitePath, storage);
  }

  const now = Date.now();
  if (adminStatsCache && now < adminStatsCache.expiresAt) {
    return adminStatsCache.data;
  }

  if (adminStatsPending) {
    return adminStatsPending;
  }

  adminStatsPending = (async () => {
    try {
      const data = await buildAdminStats(sqlitePath, storage);
      adminStatsCache = { data, expiresAt: Date.now() + adminStatsTtlMs() };
      return data;
    } finally {
      adminStatsPending = null;
    }
  })();

  return adminStatsPending;
}

export async function buildAdminStats(
  sqlitePath: string,
  storage: CompositeStorage
): Promise<AdminStatsResponse> {
  const [profiles, posts] = await Promise.all([
    storage.countKeysInBucket('profile'),
    storage.countKeysInBucket('post'),
  ]);

  const tables: Record<string, number> = {};
  let usersByScope: { scope: string; count: number }[] | undefined;
  let campaignsByPayment: { payment_status: string; count: number }[] | undefined;
  let paymentsByStatus: { status: string; count: number }[] | undefined;
  let sqliteAvailable = false;

  const dir = dirname(sqlitePath);
  if (existsSync(dir) && existsSync(sqlitePath)) {
    sqliteAvailable = true;
    const db = new Database(sqlitePath, { readonly: true });
    try {
      for (const t of SQLITE_TABLES) {
        const c = safeCount(db, t);
        if (c != null) tables[t] = c;
      }
      if (tableExists(db, 'auth_user')) {
        const rows = db
          .prepare(`SELECT scope, COUNT(*) as c FROM auth_user GROUP BY scope ORDER BY c DESC`)
          .all() as { scope: string; c: number }[];
        usersByScope = rows.map((r) => ({ scope: r.scope, count: r.c }));
      }
      if (tableExists(db, 'campaign')) {
        const campCols = (db.prepare(`PRAGMA table_info(campaign)`).all() as { name: string }[]).map((c) => c.name);
        if (campCols.includes('payment_status')) {
          const rows = db
            .prepare(`SELECT payment_status, COUNT(*) as c FROM campaign GROUP BY payment_status`)
            .all() as { payment_status: string | null; c: number }[];
          campaignsByPayment = rows.map((r) => ({
            payment_status: r.payment_status ?? '(null)',
            count: r.c,
          }));
        }
      }
      if (tableExists(db, 'payment')) {
        const rows = db
          .prepare(`SELECT status, COUNT(*) as c FROM payment GROUP BY status ORDER BY c DESC`)
          .all() as { status: string; c: number }[];
        paymentsByStatus = rows.map((r) => ({ status: r.status, count: r.c }));
      }
    } finally {
      db.close();
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    rocksdb: { profiles, posts },
    sqlite: {
      available: sqliteAvailable,
      tables,
      usersByScope,
      campaignsByPayment,
      paymentsByStatus,
    },
  };
}
