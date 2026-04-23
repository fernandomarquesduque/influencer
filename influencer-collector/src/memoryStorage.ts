/**
 * Ledger em 3 faixas: coletado (aguardando ou sem API), problemas (só erros — duplicados não entram), integrado (API OK).
 */

import { randomUUID } from 'node:crypto';
import { appendFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import type { Entity } from './entityRules.js';
import {
  countIssueRows,
  deleteAllIntegrationOkRows,
  deleteAllIssueRows,
  deleteIntegrationOkByHandleKey,
  deleteIssueRowById,
  distinctIssueHandleKeys,
  insertIssueRow,
  hasIssueRowForHandleKey,
  migrateLegacyJsonIfNeeded,
  openIssuesDb,
  hasIntegrationOkByHandleKey,
  selectIssuesOrderByAtDescLimit,
  selectRecentIntegrationOkOrderByIntegratedAtDesc,
  upsertIntegrationOkRow,
  type SqlIntegrationOkRow,
  type SqlIssueRow,
} from './issuesSqlite.js';

export type IssueKind = 'duplicado' | 'extracao' | 'regra' | 'erro_api';

export interface PendingRow {
  handle: string;
  handleKey: string;
  profile: Entity & { handle: string };
  collectedAt: string;
}

export type RocksDbVerifyStatus = 'confirmed' | 'unavailable' | 'skipped';

export interface IntegratedRow extends PendingRow {
  integratedAt: string;
  /** Host da API usada no ingest (ex.: buscainfluencer.com.br). */
  apiHost?: string;
  /** Resultado do GET collector-verify-profile após o ingest. */
  rocksDbVerified?: RocksDbVerifyStatus;
}

export interface IssueRow {
  /** Identificador único (persistência + remoção na UI). */
  id: string;
  handle: string;
  handleKey: string;
  kind: IssueKind;
  detail?: string;
  at: string;
  full_name?: string;
  followers_count?: number;
  /** Em erro_api: endpoint que foi chamado. */
  attemptedEndpoint?: string;
}

export interface IntegrationPushResult {
  ok: boolean;
  /** true = API não configurada — perfil fica só em coletados */
  skipped: boolean;
  error?: string;
  /** URL completa do POST (sempre que houve tentativa com base+key). */
  endpoint?: string;
  /** Após ingest OK: consulta GET verify ao RocksDB. */
  verifyStatus?: RocksDbVerifyStatus;
  apiHost?: string;
}

const MAX_GOOGLE_QUEUE = 5000;

/** Fatia de integrados lidos do SQLite para `/api/list` (ordenados; cache invalidado ao integrar/remover). */
const INTEGRADOS_LEDGER_FETCH_LIMIT = 450;

/** Problemas mantidos em RAM para a UI — o restante permanece só no SQLite. */
const ISSUES_WORKING_SET_LIMIT = 3000;

/** Novos registros em Problemas desde o start do processo (sempre incrementa). */
let problemasEventosSessao = 0;

export function getProblemasEventosSessao(): number {
  return problemasEventosSessao;
}

/** Total de linhas de Problemas no SQLite (pode ser maior que a fatia em memória). */
export function getProblemasDbCount(): number {
  return countIssueRows();
}

/** true se o @ já tem linha na lista de erros (SQLite; fallback para fatia em memória). */
export function hasOpenIssueForHandle(rawHandle: string): boolean {
  const k = norm(rawHandle);
  if (!k) return false;
  try {
    return hasIssueRowForHandleKey(k);
  } catch {
    return issues.some((r) => norm(r.handleKey || r.handle) === k);
  }
}

const pending = new Map<string, PendingRow>();
/** Janela curta de integrados recentes só para dedupe local rápido sem crescer sem limite. */
const integratedRecentHandleKeys = new Set<string>();
const integratedRecentOrder: string[] = [];
const INTEGRATED_RECENT_MAX = (() => {
  const raw = Number.parseInt(process.env.COLLECTOR_INTEGRATED_RECENT_MAX ?? '', 10);
  if (Number.isFinite(raw) && raw > 0) return Math.min(200_000, Math.max(5_000, raw));
  return 30_000;
})();
const issues: IssueRow[] = [];

let integradosLedgerCache: IntegratedRow[] | null = null;

function invalidateIntegradosLedgerCache(): void {
  integradosLedgerCache = null;
}

function issuesFilePath(): string {
  const raw = process.env.COLLECTOR_ISSUES_PATH?.trim();
  if (raw) return raw;
  return join(process.cwd(), 'data', 'collector-issues.json');
}

function issuesAppendDisabled(): boolean {
  const v = process.env.COLLECTOR_ISSUES_APPEND?.trim().toLowerCase();
  return v === '0' || v === 'false' || v === 'off';
}

function issuesAppendLogPathResolved(): string | null {
  if (issuesAppendDisabled()) return null;
  const raw = process.env.COLLECTOR_ISSUES_APPEND_PATH?.trim();
  if (raw) return raw;
  return join(dirname(issuesFilePath()), 'collector-issues-append.jsonl');
}

let warnedAppendFailure = false;

function appendIssueToJsonlLine(row: IssueRow): void {
  const path = issuesAppendLogPathResolved();
  if (!path) return;
  const line = JSON.stringify(row) + '\n';
  void (async () => {
    try {
      await mkdir(dirname(path), { recursive: true });
      await appendFile(path, line, 'utf-8');
    } catch (e) {
      if (!warnedAppendFailure) {
        warnedAppendFailure = true;
        console.warn(
          '[ledger] Append de problemas (JSONL) falhou:',
          e instanceof Error ? e.message : e
        );
      }
    }
  })();
}

function reloadIssuesWorkingSetFromDb(): void {
  openIssuesDb();
  const rows = selectIssuesOrderByAtDescLimit(ISSUES_WORKING_SET_LIMIT);
  issues.length = 0;
  for (const r of rows) {
    issues.push(r as IssueRow);
  }
}

function rememberIntegratedHandleKey(handleKey: string): void {
  const k = norm(handleKey);
  if (!k || integratedRecentHandleKeys.has(k)) return;
  integratedRecentHandleKeys.add(k);
  integratedRecentOrder.push(k);
  while (integratedRecentOrder.length > INTEGRATED_RECENT_MAX) {
    const oldest = integratedRecentOrder.shift();
    if (oldest) integratedRecentHandleKeys.delete(oldest);
  }
}

function sqlIntegrationRowToIntegratedRow(r: SqlIntegrationOkRow): IntegratedRow | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(r.profileJson) as Record<string, unknown>;
  } catch {
    return null;
  }
  const hk = norm(r.handleKey);
  if (!hk) return null;
  const rv = r.rocksVerified;
  const rocksDbVerified =
    rv === 'confirmed' || rv === 'unavailable' || rv === 'skipped' ? rv : undefined;
  return {
    handle: hk,
    handleKey: hk,
    profile: slimProfileForIntegratedLedger(parsed, hk),
    collectedAt: r.collectedAt,
    integratedAt: r.integratedAt,
    apiHost: r.apiHost || undefined,
    rocksDbVerified,
  };
}

function loadIntegradosLedgerFromDb(): IntegratedRow[] {
  const rows = selectRecentIntegrationOkOrderByIntegratedAtDesc(INTEGRADOS_LEDGER_FETCH_LIMIT);
  const out: IntegratedRow[] = [];
  for (const r of rows) {
    const row = sqlIntegrationRowToIntegratedRow(r);
    if (row) out.push(row);
  }
  return out;
}

/**
 * Abre SQLite, migra JSON legado se preciso, carrega problemas e integrados com sucesso para a UI.
 */
export function loadPersistedIssuesSync(): void {
  try {
    openIssuesDb();
    migrateLegacyJsonIfNeeded();
    reloadIssuesWorkingSetFromDb();
    const total = countIssueRows();
    if (total > 0) {
      console.log(`[ledger] Problemas: ${total} registro(s) no SQLite (lista completa na UI)`);
    }
  } catch (e) {
    console.warn(
      '[ledger] Falha ao abrir SQLite de problemas:',
      e instanceof Error ? e.message : e
    );
  }
}

/** Fila de handles descobertos pelo Google — processamento no Instagram é assíncrono, 1 por vez. */
export interface GoogleQueueItem {
  handle: string;
  addedAt: string;
  /** Trecho/descrição do resultado Google onde o handle foi encontrado (palavra-chave em contexto). */
  snippet?: string;
}
const googleQueue: GoogleQueueItem[] = [];

/** Evita spam de “duplicado” para o mesmo @ na mesma sessão. */
const duplicateLogged = new Set<string>();
const DUPLICATE_LOGGED_MAX = (() => {
  const raw = Number.parseInt(process.env.COLLECTOR_DUPLICATE_LOGGED_MAX ?? '', 10);
  if (Number.isFinite(raw) && raw > 0) return Math.min(500_000, Math.max(10_000, raw));
  return 80_000;
})();

function norm(h: string): string {
  return String(h ?? '')
    .replace(/^@/, '')
    .trim()
    .toLowerCase();
}

/**
 * Mantém só o necessário para `/api/list` e contagens. O payload completo permanece em `profile_json` no SQLite.
 * Sem isso, dezenas de milhares de integrações retêm cópias enormes do GraphQL no heap do Node (OOM ~4 GB).
 */
function slimProfileForIntegratedLedger(
  full: Record<string, unknown>,
  handleKey: string
): Entity & { handle: string } {
  const bio = full.biography;
  const biography =
    typeof bio === 'string' && bio.length > 800 ? `${bio.slice(0, 800)}…` : bio;
  return {
    handle: handleKey,
    username: String(full.username ?? full.handle ?? handleKey),
    full_name: full.full_name,
    followers_count: full.followers_count,
    account_type: full.account_type,
    biography,
    _collected_at: full._collected_at,
  } as Entity & { handle: string };
}

function pushIssue(row: Omit<IssueRow, 'id'> & { id?: string }): void {
  const id = row.id?.trim() ? row.id.trim() : randomUUID();
  const full: IssueRow = { ...row, id };
  if (full.kind !== 'extracao' && full.kind !== 'regra' && full.kind !== 'erro_api') return;
  try {
    insertIssueRow(full as SqlIssueRow);
  } catch (e) {
    console.warn('[ledger] Falha ao gravar problema no SQLite:', e instanceof Error ? e.message : e);
    return;
  }
  problemasEventosSessao += 1;
  issues.unshift(full);
  while (issues.length > ISSUES_WORKING_SET_LIMIT) {
    issues.pop();
  }
  appendIssueToJsonlLine(full);
}

/** Remove um registro específico de Problemas (libera o @ em issueHandleKeysSet se não houver outro erro para o mesmo handle). */
export function removeIssueById(id: string): boolean {
  const want = String(id ?? '').trim();
  if (!want) return false;
  const ok = deleteIssueRowById(want);
  const idx = issues.findIndex((x) => x.id === want);
  if (idx !== -1) issues.splice(idx, 1);
  return ok || idx !== -1;
}

/** Handles já coletados ou integrados (evita reprocessar). */
export function listHandles(): Set<string> {
  return new Set([...pending.keys(), ...integratedRecentHandleKeys]);
}

/** Dedupe completo de integrados sem carregar histórico inteiro na RAM. */
export function hasIntegratedHandle(rawHandle: string): boolean {
  const k = norm(rawHandle);
  if (!k) return false;
  if (pending.has(k) || integratedRecentHandleKeys.has(k)) return true;
  try {
    const exists = hasIntegrationOkByHandleKey(k);
    if (exists) rememberIntegratedHandleKey(k);
    return exists;
  } catch {
    return false;
  }
}

/** Adiciona handle à fila Google (evita duplicata por handle normalizado). snippet = trecho/descrição do resultado Google. */
export function addToGoogleQueue(handle: string, snippet?: string): boolean {
  const k = norm(handle);
  if (!k) return false;
  if (googleQueue.some((x) => norm(x.handle) === k)) return false;
  if (googleQueue.length >= MAX_GOOGLE_QUEUE) return false;
  googleQueue.push({ handle: k, addedAt: new Date().toISOString(), snippet: snippet?.trim() || undefined });
  return true;
}

/** Lista completa da fila Google (para exibir na UI). */
export function getGoogleQueue(): GoogleQueueItem[] {
  return [...googleQueue];
}

/** Remove e retorna o próximo da fila (para processamento 1 a 1). */
export function takeNextFromGoogleQueue(): GoogleQueueItem | null {
  return googleQueue.shift() ?? null;
}

/** Remove um handle específico da fila Google (por exemplo, para excluir da UI). */
export function removeFromGoogleQueue(handle: string): boolean {
  const k = norm(handle);
  if (!k) return false;
  const idx = googleQueue.findIndex((x) => norm(x.handle) === k);
  if (idx === -1) return false;
  googleQueue.splice(idx, 1);
  return true;
}

/** Quantidade de itens na fila Google. */
export function googleQueueLength(): number {
  return googleQueue.length;
}

/** Esvazia a fila Google (só a fila; coletados/integrados/problemas não são alterados). Retorna quantos itens foram removidos. */
export function clearGoogleQueue(): number {
  const n = googleQueue.length;
  googleQueue.length = 0;
  return n;
}

/** Última extração SERP (atualizada a cada página) — para a UI mostrar links extraídos em tempo real. */
export interface LastSerpExtraction {
  page: number;
  handles: string[];
  at: string;
}
let lastSerpExtraction: LastSerpExtraction = { page: 0, handles: [], at: '' };

export function setLastGoogleSerpExtraction(page: number, handles: string[]): void {
  lastSerpExtraction = { page, handles: [...handles], at: new Date().toISOString() };
}

export function getLastGoogleSerpExtraction(): LastSerpExtraction {
  return { ...lastSerpExtraction };
}

/** Handles que já constam em Problemas (regra/extração/erro) — o conjunto completo no SQLite. */
export function issueHandleKeysSet(): Set<string> {
  try {
    return distinctIssueHandleKeys();
  } catch {
    const s = new Set<string>();
    for (const row of issues) {
      const k = norm(row.handleKey || row.handle);
      if (k) s.add(k);
    }
    return s;
  }
}

/** Duplicados não aparecem na tabela de problemas (só log no console). */
export function recordDuplicate(handle: string): void {
  const k = norm(handle);
  if (!k || duplicateLogged.has(k)) return;
  if (duplicateLogged.size >= DUPLICATE_LOGGED_MAX) {
    duplicateLogged.clear();
    console.warn(
      `[ledger] duplicateLogged atingiu ${DUPLICATE_LOGGED_MAX} entradas — conjunto limpo para evitar estouro de memória em listas muito longas.`
    );
  }
  duplicateLogged.add(k);
}

export function recordIssue(
  handle: string,
  kind: IssueKind,
  detail?: string,
  meta?: { full_name?: string; followers_count?: number }
): void {
  const k = norm(handle);
  if (!k) return;
  pushIssue({
    handle: k,
    handleKey: k,
    kind,
    detail,
    at: new Date().toISOString(),
    ...meta,
  });
}

export interface CollectorMediaPayload {
  feed: Record<string, unknown>[];
  reel: Record<string, unknown>[];
  tagged: Record<string, unknown>[];
}

/**
 * Coloca em “coletado”, chama API; sucesso → integrado; falha → problemas; sem API → permanece coletado.
 * Com mídia (feed/reel/tagged) usa ingest-full no servidor.
 */
export async function registerCollectedWithIntegration(
  entity: Entity & { handle: string },
  media: CollectorMediaPayload | null,
  pushFull: (
    e: Entity & { handle: string },
    m: CollectorMediaPayload
  ) => Promise<IntegrationPushResult>,
  pushSlim: (e: Entity & { handle: string }) => Promise<IntegrationPushResult>
): Promise<IntegrationPushResult> {
  const key = norm(String(entity.handle));
  const collectedAt = String(
    (entity as Record<string, unknown>)._collected_at ?? new Date().toISOString()
  );
  const row: PendingRow = {
    handle: key,
    handleKey: key,
    profile: { ...entity, handle: key } as Entity & { handle: string },
    collectedAt,
  };
  pending.set(key, row);

  const hasMedia =
    media != null &&
    media.feed.length + media.reel.length + media.tagged.length > 0;
  const result = hasMedia ? await pushFull(entity, media!) : await pushSlim(entity);

  if (result.skipped) {
    return result;
  }
  if (result.ok) {
    pending.delete(key);
    const integratedAt = new Date().toISOString();
    const rocksDbVerified = result.verifyStatus ?? 'skipped';
    try {
      upsertIntegrationOkRow({
        handleKey: key,
        handle: key,
        collectedAt,
        integratedAt,
        apiHost: result.apiHost ?? '',
        rocksVerified: rocksDbVerified,
        profileJson: JSON.stringify(row.profile),
      });
      rememberIntegratedHandleKey(key);
      invalidateIntegradosLedgerCache();
    } catch (e) {
      console.warn(
        '[ledger] Falha ao gravar integrado no SQLite:',
        e instanceof Error ? e.message : e
      );
    }
    return result;
  }
  pending.delete(key);
  pushIssue({
    handle: key,
    handleKey: key,
    kind: 'erro_api',
    detail: result.error ?? 'Erro desconhecido',
    at: new Date().toISOString(),
    full_name: entity.full_name as string | undefined,
    followers_count:
      typeof entity.followers_count === 'number' ? entity.followers_count : undefined,
    attemptedEndpoint: result.endpoint,
  });
  return result;
}

export interface LedgerResponse {
  coletados: PendingRow[];
  problemas: IssueRow[];
  integrados: IntegratedRow[];
}

export function getLedger(): LedgerResponse {
  const coletados = [...pending.values()].sort((a, b) => b.collectedAt.localeCompare(a.collectedAt));
  if (integradosLedgerCache === null) {
    try {
      integradosLedgerCache = loadIntegradosLedgerFromDb();
    } catch {
      integradosLedgerCache = [];
    }
  }
  const integrados = integradosLedgerCache;
  const problemas = issues.filter((i) => i.kind !== 'duplicado');
  return { coletados, problemas, integrados };
}

/** Compat: perfis em coletados + integrados (lista única). */
export function getProfiles(): { handle: string; profile: Entity & { handle: string }; collectedAt: string }[] {
  const L = getLedger();
  return [
    ...L.coletados.map((p) => ({
      handle: p.handle,
      profile: p.profile,
      collectedAt: p.collectedAt,
    })),
    ...L.integrados.map((p) => ({
      handle: p.handle,
      profile: p.profile,
      collectedAt: p.collectedAt,
    })),
  ];
}

export function removeProfile(handle: string): boolean {
  const k = norm(handle);
  let removed = pending.delete(k) || integratedRecentHandleKeys.delete(k);
  try {
    if (deleteIntegrationOkByHandleKey(k)) {
      removed = true;
      integratedRecentHandleKeys.delete(k);
    }
  } catch {
    /* */
  }
  if (removed) invalidateIntegradosLedgerCache();
  return removed;
}

export function clearAll(): void {
  pending.clear();
  integratedRecentHandleKeys.clear();
  integratedRecentOrder.length = 0;
  invalidateIntegradosLedgerCache();
  try {
    deleteAllIntegrationOkRows();
  } catch {
    /* */
  }
  try {
    deleteAllIssueRows();
  } catch {
    /* */
  }
  issues.length = 0;
  googleQueue.length = 0;
  duplicateLogged.clear();
  problemasEventosSessao = 0;
}
