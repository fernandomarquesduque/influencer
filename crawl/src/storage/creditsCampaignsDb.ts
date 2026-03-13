/**
 * Créditos do usuário e campanhas (relatórios comprados).
 * Usa o mesmo SQLite (influencer.db); tabelas: user_credits, credit_transaction, campaign.
 * ID da campanha é GUID (UUID v4).
 */

import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const DEFAULT_PATH = './data/influencer.db';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isCampaignIdGuid(id: string): boolean {
  return typeof id === 'string' && UUID_REGEX.test(id);
}

export interface CampaignRow {
  id: string;
  user_id: number;
  name: string | null;
  handles_json: string;
  handles_count: number;
  credits_used: number;
  created_at: string;
}

export class CreditsCampaignsDb {
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
      CREATE TABLE IF NOT EXISTS user_credits (
        user_id INTEGER PRIMARY KEY,
        balance INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS credit_transaction (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        amount INTEGER NOT NULL,
        reason TEXT NOT NULL,
        ref_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES auth_user(id)
      );
      CREATE TABLE IF NOT EXISTS campaign (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        name TEXT,
        handles_json TEXT NOT NULL,
        handles_count INTEGER NOT NULL,
        credits_used INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES auth_user(id)
      );
      CREATE INDEX IF NOT EXISTS idx_campaign_user ON campaign(user_id);
    `);
    this.migrateCampaignIdToGuid();
  }

  /** Migra tabela campaign de id INTEGER para id TEXT (GUID) se necessário. */
  private migrateCampaignIdToGuid(): void {
    const info = this.db.prepare("PRAGMA table_info(campaign)").all() as { name: string; type: string }[];
    const idCol = info.find((c) => c.name === 'id');
    if (!idCol || idCol.type.toUpperCase() === 'TEXT') return;
    const rows = this.db.prepare("SELECT id, user_id, name, handles_json, handles_count, credits_used, created_at FROM campaign").all() as { id: number; user_id: number; name: string | null; handles_json: string; handles_count: number; credits_used: number; created_at: string }[];
    this.db.exec(`
      CREATE TABLE campaign_new (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        name TEXT,
        handles_json TEXT NOT NULL,
        handles_count INTEGER NOT NULL,
        credits_used INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES auth_user(id)
      );
      CREATE INDEX idx_campaign_new_user ON campaign_new(user_id);
    `);
    const insert = this.db.prepare(`
      INSERT INTO campaign_new (id, user_id, name, handles_json, handles_count, credits_used, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of rows) {
      insert.run(crypto.randomUUID(), row.user_id, row.name, row.handles_json, row.handles_count, row.credits_used, row.created_at);
    }
    this.db.exec(`DROP TABLE campaign; ALTER TABLE campaign_new RENAME TO campaign;`);
  }

  getBalance(userId: number): number {
    const row = this.db.prepare('SELECT balance FROM user_credits WHERE user_id = ?').get(userId) as { balance: number } | undefined;
    return row ? row.balance : 0;
  }

  setBalance(userId: number, balance: number): void {
    this.db.prepare(`
      INSERT INTO user_credits (user_id, balance, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET balance = excluded.balance, updated_at = datetime('now')
    `).run(userId, Math.max(0, balance));
  }

  addCredits(userId: number, amount: number, reason: string, refId?: string): void {
    const balance = this.getBalance(userId);
    this.setBalance(userId, balance + amount);
    this.db.prepare(`
      INSERT INTO credit_transaction (user_id, amount, reason, ref_id) VALUES (?, ?, ?, ?)
    `).run(userId, amount, reason, refId ?? null);
  }

  spendCredits(userId: number, amount: number, reason: string, refId?: string): boolean {
    const balance = this.getBalance(userId);
    if (balance < amount) return false;
    this.setBalance(userId, balance - amount);
    this.db.prepare(`
      INSERT INTO credit_transaction (user_id, amount, reason, ref_id) VALUES (?, ?, ?, ?)
    `).run(userId, -amount, reason, refId ?? null);
    return true;
  }

  createCampaign(userId: number, handles: string[], creditsUsed: number, name?: string): string {
    const id = crypto.randomUUID();
    const handlesJson = JSON.stringify(handles);
    this.db.prepare(`
      INSERT INTO campaign (id, user_id, name, handles_json, handles_count, credits_used, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(id, userId, name ?? null, handlesJson, handles.length, creditsUsed);
    return id;
  }

  getCampaign(campaignId: string, userId: number): CampaignRow | null {
    const row = this.db.prepare(`
      SELECT id, user_id, name, handles_json, handles_count, credits_used, created_at
      FROM campaign WHERE id = ? AND user_id = ?
    `).get(campaignId, userId) as CampaignRow | undefined;
    return row ?? null;
  }

  /** Atualiza o nome da campanha. Retorna true se atualizou. */
  updateCampaignName(campaignId: string, userId: number, name: string): boolean {
    const trimmed = name.trim();
    const result = this.db.prepare(`
      UPDATE campaign SET name = ? WHERE id = ? AND user_id = ?
    `).run(trimmed || null, campaignId, userId);
    return result.changes > 0;
  }

  getCampaignHandles(campaignId: string, userId: number): string[] | null {
    const camp = this.getCampaign(campaignId, userId);
    if (!camp) return null;
    try {
      const arr = JSON.parse(camp.handles_json) as string[];
      return Array.isArray(arr) ? arr : null;
    } catch {
      return null;
    }
  }

  listCampaigns(userId: number): CampaignRow[] {
    return this.db.prepare(`
      SELECT id, user_id, name, handles_json, handles_count, credits_used, created_at
      FROM campaign WHERE user_id = ? ORDER BY created_at DESC
    `).all(userId) as CampaignRow[];
  }
}
