/**
 * Créditos do usuário e campanhas (relatórios comprados).
 * Usa o mesmo SQLite (influencer.db); tabelas: user_credits, credit_transaction, campaign.
 * ID da campanha é GUID (UUID v4).
 */

import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { defaultCampaignExpiresAtIso } from '../config/campaignAccess.js';

const DEFAULT_PATH = './data/influencer.db';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isCampaignIdGuid(id: string): boolean {
  return typeof id === 'string' && UUID_REGEX.test(id);
}

export type CampaignPaymentStatus = 'pending' | 'paid';

export interface CampaignRow {
  id: string;
  user_id: number;
  name: string | null;
  description: string | null;
  /** JSON da busca original (inclui `q`, categorias, filtros). */
  query_json: string | null;
  handles_json: string;
  handles_count: number;
  credits_used: number;
  created_at: string;
  expires_at: string;
  payment_status: CampaignPaymentStatus;
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
    this.migrateCampaignDescription();
    this.migrateCampaignExpiresAt();
    this.migrateCampaignPaymentStatus();
    this.migrateCampaignQueryJson();
  }

  /** Persiste a query usada na compra (para reexecutar busca textual em posts). */
  private migrateCampaignQueryJson(): void {
    const info = this.db.prepare('PRAGMA table_info(campaign)').all() as { name: string }[];
    if (info.some((c) => c.name === 'query_json')) return;
    this.db.exec('ALTER TABLE campaign ADD COLUMN query_json TEXT');
  }

  /** Adiciona payment_status: 'pending' (nova campanha) | 'paid'. Campanhas existentes = 'paid'. */
  private migrateCampaignPaymentStatus(): void {
    const info = this.db.prepare('PRAGMA table_info(campaign)').all() as { name: string }[];
    if (info.some((c) => c.name === 'payment_status')) return;
    this.db.exec('ALTER TABLE campaign ADD COLUMN payment_status TEXT NOT NULL DEFAULT \'paid\'');
  }

  /** Adiciona coluna expires_at se não existir; backfill com 1 ano após created_at. */
  private migrateCampaignExpiresAt(): void {
    const info = this.db.prepare('PRAGMA table_info(campaign)').all() as { name: string }[];
    if (info.some((c) => c.name === 'expires_at')) return;
    this.db.exec('ALTER TABLE campaign ADD COLUMN expires_at TEXT');
    this.db.exec(`UPDATE campaign SET expires_at = date(created_at, '+1 year') WHERE expires_at IS NULL`);
  }

  /** Adiciona coluna description se não existir. */
  private migrateCampaignDescription(): void {
    const info = this.db.prepare('PRAGMA table_info(campaign)').all() as { name: string }[];
    if (info.some((c) => c.name === 'description')) return;
    this.db.exec('ALTER TABLE campaign ADD COLUMN description TEXT');
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

  createCampaign(
    userId: number,
    handles: string[],
    creditsUsed: number,
    name?: string,
    expiresAt: string = this.defaultExpiresAt(),
    queryJson?: string | null
  ): string {
    const id = crypto.randomUUID();
    const handlesJson = JSON.stringify(handles);
    const expires = expiresAt && /^\d{4}-\d{2}-\d{2}$/.test(expiresAt) ? expiresAt : this.defaultExpiresAt();
    this.db.prepare(`
      INSERT INTO campaign (id, user_id, name, description, query_json, handles_json, handles_count, credits_used, created_at, expires_at, payment_status)
      VALUES (?, ?, ?, NULL, ?, ?, ?, ?, datetime('now'), ?, 'pending')
    `).run(id, userId, name ?? null, queryJson ?? null, handlesJson, handles.length, creditsUsed, expires);
    return id;
  }

  setCampaignPaymentStatus(campaignId: string, userId: number, status: CampaignPaymentStatus): boolean {
    const result = this.db.prepare(`
      UPDATE campaign SET payment_status = ? WHERE id = ? AND user_id = ?
    `).run(status, campaignId, userId);
    return result.changes > 0;
  }

  private defaultExpiresAt(): string {
    return defaultCampaignExpiresAtIso();
  }

  getCampaign(campaignId: string, userId: number): CampaignRow | null {
    const row = this.db.prepare(`
      SELECT id, user_id, name, description, query_json, handles_json, handles_count, credits_used, created_at, COALESCE(expires_at, date(created_at, '+1 year')) AS expires_at, COALESCE(payment_status, 'paid') AS payment_status
      FROM campaign WHERE id = ? AND user_id = ?
    `).get(campaignId, userId) as CampaignRow | undefined;
    return row ?? null;
  }

  /** Retorna a campanha apenas se ainda estiver ativa (não expirada). Inclui pendentes de pagamento. */
  getCampaignIfActive(campaignId: string, userId: number): CampaignRow | null {
    const row = this.db.prepare(`
      SELECT id, user_id, name, description, query_json, handles_json, handles_count, credits_used, created_at, COALESCE(expires_at, date(created_at, '+1 year')) AS expires_at, COALESCE(payment_status, 'paid') AS payment_status
      FROM campaign
      WHERE id = ? AND user_id = ? AND (expires_at IS NULL OR expires_at >= date('now'))
    `).get(campaignId, userId) as CampaignRow | undefined;
    return row ?? null;
  }

  /** Retorna a campanha apenas se ativa e paga. Usado para autorizar acesso a relatório (perfis, BI). */
  getCampaignIfActiveAndPaid(campaignId: string, userId: number): CampaignRow | null {
    const row = this.db.prepare(`
      SELECT id, user_id, name, description, query_json, handles_json, handles_count, credits_used, created_at, COALESCE(expires_at, date(created_at, '+1 year')) AS expires_at, COALESCE(payment_status, 'paid') AS payment_status
      FROM campaign
      WHERE id = ? AND user_id = ? AND (expires_at IS NULL OR expires_at >= date('now')) AND (payment_status IS NULL OR payment_status = 'paid')
    `).get(campaignId, userId) as CampaignRow | undefined;
    return row ?? null;
  }

  /** Atualiza a descrição (anotações) da campanha. Retorna true se atualizou. */
  updateCampaignDescription(campaignId: string, userId: number, description: string): boolean {
    const val = description.trim() || null;
    const result = this.db.prepare(`
      UPDATE campaign SET description = ? WHERE id = ? AND user_id = ?
    `).run(val, campaignId, userId);
    return result.changes > 0;
  }

  /** Atualiza o nome da campanha. Retorna true se atualizou. */
  updateCampaignName(campaignId: string, userId: number, name: string): boolean {
    const trimmed = name.trim();
    const result = this.db.prepare(`
      UPDATE campaign SET name = ? WHERE id = ? AND user_id = ?
    `).run(trimmed || null, campaignId, userId);
    return result.changes > 0;
  }

  /** Atualiza credits_used da campanha (ex.: pagamento com créditos). Retorna true se atualizou. */
  setCampaignCreditsUsed(campaignId: string, userId: number, creditsUsed: number): boolean {
    const result = this.db.prepare(`
      UPDATE campaign SET credits_used = ? WHERE id = ? AND user_id = ?
    `).run(creditsUsed, campaignId, userId);
    return result.changes > 0;
  }

  /** Reduz a campanha aos primeiros N handles (só quando pagamento pendente). Retorna true se atualizou. */
  setCampaignQuantity(campaignId: string, userId: number, quantity: number): boolean {
    const handles = this.getCampaignHandles(campaignId, userId);
    if (!handles || quantity < 1 || quantity >= handles.length) return false;
    const trimmed = handles.slice(0, quantity);
    const result = this.db.prepare(`
      UPDATE campaign SET handles_json = ?, handles_count = ? WHERE id = ? AND user_id = ?
    `).run(JSON.stringify(trimmed), trimmed.length, campaignId, userId);
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

  /** Retorna os handles apenas se a campanha estiver ativa (não expirada). Usado para checkout e listagem. */
  getCampaignHandlesIfActive(campaignId: string, userId: number): string[] | null {
    const camp = this.getCampaignIfActive(campaignId, userId);
    if (!camp) return null;
    try {
      const arr = JSON.parse(camp.handles_json) as string[];
      return Array.isArray(arr) ? arr : null;
    } catch {
      return null;
    }
  }

  /** Retorna os handles apenas se a campanha estiver ativa e paga. Usado para acesso ao relatório. */
  getCampaignHandlesIfActiveAndPaid(campaignId: string, userId: number): string[] | null {
    const camp = this.getCampaignIfActiveAndPaid(campaignId, userId);
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
      SELECT id, user_id, name, description, query_json, handles_json, handles_count, credits_used, created_at, COALESCE(expires_at, date(created_at, '+1 year')) AS expires_at, COALESCE(payment_status, 'paid') AS payment_status
      FROM campaign WHERE user_id = ? AND (expires_at IS NULL OR expires_at >= date('now')) ORDER BY created_at DESC
    `).all(userId) as CampaignRow[];
  }

  /** Handles distintos de todas as campanhas ativas e pagas (para visão "Todos"). */
  getAllPaidHandlesUnion(userId: number): string[] {
    const set = new Set<string>();
    for (const row of this.listCampaigns(userId)) {
      const handles = this.getCampaignHandlesIfActiveAndPaid(row.id, userId);
      if (!handles) continue;
      for (const x of handles) {
        const h = String(x).toLowerCase().replace(/^@/, '').trim();
        if (h) set.add(h);
      }
    }
    return Array.from(set);
  }

  /** Exclui a campanha (apenas se pertencer ao usuário). Retorna true se excluiu. */
  deleteCampaign(campaignId: string, userId: number): boolean {
    const result = this.db.prepare('DELETE FROM campaign WHERE id = ? AND user_id = ?').run(campaignId, userId);
    return result.changes > 0;
  }

  /** LGPD: remove todos os dados do usuário (transações, campanhas, saldo) antes de excluir auth_user. */
  deleteAllByUserId(userId: number): void {
    this.db.prepare('DELETE FROM credit_transaction WHERE user_id = ?').run(userId);
    this.db.prepare('DELETE FROM campaign WHERE user_id = ?').run(userId);
    this.db.prepare('DELETE FROM user_credits WHERE user_id = ?').run(userId);
  }

  /** Admin: retira o handle de todas as campanhas (JSON), atualizando handles_count. */
  removeHandleFromAllCampaigns(normalizedHandle: string): number {
    const h = normalizedHandle.toLowerCase().replace(/^@/, '').trim();
    if (!h) return 0;
    const rows = this.db
      .prepare('SELECT id, user_id, handles_json FROM campaign')
      .all() as { id: string; user_id: number; handles_json: string }[];
    let updated = 0;
    for (const row of rows) {
      try {
        const arr = JSON.parse(row.handles_json) as unknown;
        if (!Array.isArray(arr)) continue;
        const next = arr.filter((x) => String(x).toLowerCase().replace(/^@/, '').trim() !== h);
        if (next.length === arr.length) continue;
        this.db
          .prepare('UPDATE campaign SET handles_json = ?, handles_count = ? WHERE id = ? AND user_id = ?')
          .run(JSON.stringify(next), next.length, row.id, row.user_id);
        updated += 1;
      } catch {
        continue;
      }
    }
    return updated;
  }
}
