/**
 * Registros de pagamentos (comprar créditos via Asaas).
 * Tabela: payment (id, user_id, asaas_payment_id, asaas_customer_id, amount_cents, credits_granted, status, billing_type, invoice_url, bank_slip_url, pix_copy_paste, created_at, updated_at).
 * Quando o webhook confirma, atualizamos status e chamamos addCredits no CreditsCampaignsDb.
 */

import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const DEFAULT_PATH = './data/influencer.db';

export type PaymentStatus =
  | 'PENDING'
  | 'RECEIVED'
  | 'CONFIRMED'
  | 'OVERDUE'
  | 'REFUNDED'
  | 'FAILED'
  | 'CANCELLED';

export type PaymentBillingType = 'PIX' | 'BOLETO' | 'CREDIT_CARD';

export interface PaymentRow {
  id: string;
  user_id: number;
  asaas_payment_id: string | null;
  asaas_customer_id: string | null;
  amount_cents: number;
  credits_granted: number;
  status: PaymentStatus;
  billing_type: PaymentBillingType;
  invoice_url: string | null;
  bank_slip_url: string | null;
  pix_copy_paste: string | null;
  created_at: string;
  updated_at: string;
  /** Pagamento de relatório: query da busca (JSON). */
  report_query?: string | null;
  /** Pagamento de relatório: quantidade de influenciadores. */
  report_desired_count?: number | null;
  /** ID da campanha criada no checkout (status pendente até confirmação). */
  campaign_id?: string | null;
  /** Assinatura de plano Busca Influencer (Asaas). */
  plan_id?: string | null;
  asaas_subscription_id?: string | null;
  /** YYYY-MM-DD: vencimento da 1ª cobrança (trial até esta data, inclusive). */
  plan_first_due_date?: string | null;
}

export class PaymentsDb {
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
      CREATE TABLE IF NOT EXISTS payment (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        asaas_payment_id TEXT,
        asaas_customer_id TEXT,
        amount_cents INTEGER NOT NULL,
        credits_granted INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        billing_type TEXT NOT NULL,
        invoice_url TEXT,
        bank_slip_url TEXT,
        pix_copy_paste TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES auth_user(id)
      );
      CREATE INDEX IF NOT EXISTS idx_payment_user ON payment(user_id);
      CREATE INDEX IF NOT EXISTS idx_payment_asaas_id ON payment(asaas_payment_id);
    `);
    const cols = this.db.prepare('PRAGMA table_info(payment)').all() as { name: string }[];
    if (cols.length > 0 && !cols.some((c) => c.name === 'report_query')) {
      this.db.exec('ALTER TABLE payment ADD COLUMN report_query TEXT');
    }
    if (cols.length > 0 && !cols.some((c) => c.name === 'report_desired_count')) {
      this.db.exec('ALTER TABLE payment ADD COLUMN report_desired_count INTEGER');
    }
    if (cols.length > 0 && !cols.some((c) => c.name === 'campaign_id')) {
      this.db.exec('ALTER TABLE payment ADD COLUMN campaign_id TEXT');
    }
    if (cols.length > 0 && !cols.some((c) => c.name === 'plan_id')) {
      this.db.exec('ALTER TABLE payment ADD COLUMN plan_id TEXT');
    }
    if (cols.length > 0 && !cols.some((c) => c.name === 'asaas_subscription_id')) {
      this.db.exec('ALTER TABLE payment ADD COLUMN asaas_subscription_id TEXT');
    }
    if (cols.length > 0 && !cols.some((c) => c.name === 'plan_first_due_date')) {
      this.db.exec('ALTER TABLE payment ADD COLUMN plan_first_due_date TEXT');
    }
    try {
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_payment_campaign_id ON payment(campaign_id)');
    } catch {
      /* ignore if exists */
    }
  }

  /** LGPD: remove todos os pagamentos do usuário antes de excluir auth_user. */
  deleteAllByUserId(userId: number): void {
    this.db.prepare('DELETE FROM payment WHERE user_id = ?').run(userId);
  }

  createPayment(params: {
    userId: number;
    asaasPaymentId: string | null;
    asaasCustomerId: string | null;
    amountCents: number;
    creditsGranted: number;
    status: PaymentStatus;
    billingType: PaymentBillingType;
    invoiceUrl?: string | null;
    bankSlipUrl?: string | null;
    pixCopyPaste?: string | null;
    reportQuery?: string | null;
    reportDesiredCount?: number | null;
    campaignId?: string | null;
    planId?: string | null;
    asaasSubscriptionId?: string | null;
    planFirstDueDate?: string | null;
  }): string {
    const id = crypto.randomUUID();
    const hasReport = params.reportDesiredCount != null && params.reportDesiredCount > 0;
    this.db
      .prepare(
        `INSERT INTO payment (
          id, user_id, asaas_payment_id, asaas_customer_id, amount_cents, credits_granted,
          status, billing_type, invoice_url, bank_slip_url, pix_copy_paste, created_at, updated_at,
          report_query, report_desired_count, campaign_id, plan_id, asaas_subscription_id, plan_first_due_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        params.userId,
        params.asaasPaymentId ?? null,
        params.asaasCustomerId ?? null,
        params.amountCents,
        params.creditsGranted,
        params.status,
        params.billingType,
        params.invoiceUrl ?? null,
        params.bankSlipUrl ?? null,
        params.pixCopyPaste ?? null,
        hasReport ? (params.reportQuery ?? null) : null,
        hasReport ? params.reportDesiredCount : null,
        params.campaignId ?? null,
        params.planId ?? null,
        params.asaasSubscriptionId ?? null,
        params.planFirstDueDate ?? null
      );
    return id;
  }

  getById(id: string, userId?: number): PaymentRow | null {
    const row = this.db
      .prepare(
        `SELECT id, user_id, asaas_payment_id, asaas_customer_id, amount_cents, credits_granted,
                status, billing_type, invoice_url, bank_slip_url, pix_copy_paste, created_at, updated_at,
                report_query, report_desired_count, campaign_id, plan_id, asaas_subscription_id, plan_first_due_date
         FROM payment WHERE id = ?`
      )
      .get(id) as PaymentRow | undefined;
    if (!row) return null;
    if (userId != null && row.user_id !== userId) return null;
    return row;
  }

  getByCampaignId(campaignId: string, userId: number): PaymentRow | null {
    const row = this.db
      .prepare(
        `SELECT id, user_id, asaas_payment_id, asaas_customer_id, amount_cents, credits_granted,
                status, billing_type, invoice_url, bank_slip_url, pix_copy_paste, created_at, updated_at,
                report_query, report_desired_count, campaign_id
         FROM payment WHERE campaign_id = ? AND user_id = ?`
      )
      .get(campaignId, userId) as PaymentRow | undefined;
    return row ?? null;
  }

  getByAsaasPaymentId(asaasPaymentId: string): PaymentRow | null {
    const row = this.db
      .prepare(
        `SELECT id, user_id, asaas_payment_id, asaas_customer_id, amount_cents, credits_granted,
                status, billing_type, invoice_url, bank_slip_url, pix_copy_paste, created_at, updated_at,
                report_query, report_desired_count, campaign_id
         FROM payment WHERE asaas_payment_id = ?`
      )
      .get(asaasPaymentId) as PaymentRow | undefined;
    return row ?? null;
  }

  listByUser(userId: number, limit = 50, offset = 0): PaymentRow[] {
    return this.db
      .prepare(
        `SELECT id, user_id, asaas_payment_id, asaas_customer_id, amount_cents, credits_granted,
                status, billing_type, invoice_url, bank_slip_url, pix_copy_paste, created_at, updated_at,
                plan_id, asaas_subscription_id, plan_first_due_date
         FROM payment WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`
      )
      .all(userId, limit, offset) as PaymentRow[];
  }

  /**
   * Assinante ativo: cobrança de plano confirmada, ou período de trial (1ª fatura pendente,
   * dentro de plan_first_due_date — cartão já cadastrado no Asaas na criação).
   */
  hasActivePlanSubscription(userId: number): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 AS ok FROM payment
         WHERE user_id = ? AND plan_id IS NOT NULL AND plan_id != ''
           AND (
             status IN ('CONFIRMED', 'RECEIVED')
             OR (
               status = 'PENDING'
               AND plan_first_due_date IS NOT NULL
               AND plan_first_due_date != ''
               AND date(plan_first_due_date) >= date('now', 'localtime')
             )
           )
         LIMIT 1`
      )
      .get(userId) as { ok?: number } | undefined;
    return Boolean(row?.ok);
  }

  /** Última assinatura de plano do usuário (confirmada ou pendente). */
  getLatestPlanPayment(userId: number): PaymentRow | null {
    const row = this.db
      .prepare(
        `SELECT id, user_id, asaas_payment_id, asaas_customer_id, amount_cents, credits_granted,
                status, billing_type, invoice_url, bank_slip_url, pix_copy_paste, created_at, updated_at,
                report_query, report_desired_count, campaign_id, plan_id, asaas_subscription_id, plan_first_due_date
         FROM payment
         WHERE user_id = ? AND plan_id IS NOT NULL AND plan_id != ''
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(userId) as PaymentRow | undefined;
    return row ?? null;
  }

  /** No máximo uma cobrança pendente por usuário — retorna a mais recente, se houver. */
  getFirstPendingForUser(userId: number): PaymentRow | null {
    const row = this.db
      .prepare(
        `SELECT id, user_id, asaas_payment_id, asaas_customer_id, amount_cents, credits_granted,
                status, billing_type, invoice_url, bank_slip_url, pix_copy_paste, created_at, updated_at,
                report_query, report_desired_count, campaign_id, plan_id, asaas_subscription_id, plan_first_due_date
         FROM payment WHERE user_id = ? AND status = 'PENDING' ORDER BY created_at DESC LIMIT 1`
      )
      .get(userId) as PaymentRow | undefined;
    return row ?? null;
  }

  updateStatus(
    id: string,
    status: PaymentStatus,
    userId?: number
  ): boolean {
    const row = this.getById(id, userId);
    if (!row) return false;
    this.db
      .prepare(
        `UPDATE payment SET status = ?, updated_at = datetime('now') WHERE id = ?`
      )
      .run(status, id);
    return true;
  }

  updateStatusByAsaasId(asaasPaymentId: string, status: PaymentStatus): PaymentRow | null {
    const row = this.getByAsaasPaymentId(asaasPaymentId);
    if (!row) return null;
    this.db
      .prepare(
        `UPDATE payment SET status = ?, updated_at = datetime('now') WHERE asaas_payment_id = ?`
      )
      .run(status, asaasPaymentId);
    return { ...row, status };
  }

  /**
   * Só atualiza se ainda estiver PENDING — evita efeitos duplicados (webhook + sync ou duas requests).
   * Retorna a linha atualizada ou null se já estava confirmada / não existe.
   */
  confirmPendingByAsaasIdIfStillPending(asaasPaymentId: string): PaymentRow | null {
    const run = this.db
      .prepare(
        `UPDATE payment SET status = 'CONFIRMED', updated_at = datetime('now')
         WHERE asaas_payment_id = ? AND status = 'PENDING'`
      )
      .run(asaasPaymentId);
    if (run.changes === 0) return null;
    return this.getByAsaasPaymentId(asaasPaymentId);
  }

  /** Remove registro local (após cancelar no gateway, se houver). */
  deleteByIdForUser(id: string, userId: number): boolean {
    const r = this.db.prepare('DELETE FROM payment WHERE id = ? AND user_id = ?').run(id, userId);
    return r.changes > 0;
  }
}
