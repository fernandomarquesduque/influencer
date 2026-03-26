/**
 * Ledger em 3 faixas: coletado (aguardando ou sem API), problemas (só erros — duplicados não entram), integrado (API OK).
 */

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import type { Entity } from './entityRules.js';

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

const MAX_ISSUES = 2000;
const MAX_GOOGLE_QUEUE = 5000;

const pending = new Map<string, PendingRow>();
const integrated = new Map<string, IntegratedRow>();
const issues: IssueRow[] = [];

function issuesFilePath(): string {
  const raw = process.env.COLLECTOR_ISSUES_PATH?.trim();
  if (raw) return raw;
  return join(process.cwd(), 'data', 'collector-issues.json');
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

async function flushIssuesToDisk(): Promise<void> {
  const path = issuesFilePath();
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(issues, null, 2), 'utf-8');
  } catch (e) {
    console.warn(
      '[ledger] Não foi possível gravar collector-issues.json:',
      e instanceof Error ? e.message : e
    );
  }
}

function schedulePersistIssues(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void flushIssuesToDisk();
  }, 400);
}

/**
 * Carrega a lista de problemas do disco (chame após dotenv, antes de iniciar coleta).
 * Caminho: COLLECTOR_ISSUES_PATH ou data/collector-issues.json na raiz do projeto.
 */
export function loadPersistedIssuesSync(): void {
  const path = issuesFilePath();
  try {
    if (!existsSync(path)) return;
    const raw = readFileSync(path, 'utf-8');
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return;
    const loaded: IssueRow[] = [];
    for (const item of arr) {
      if (item == null || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      const k = norm(String(o.handle ?? ''));
      if (!k) continue;
      const kind = o.kind as IssueKind;
      if (kind !== 'extracao' && kind !== 'regra' && kind !== 'erro_api') continue;
      const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : randomUUID();
      loaded.push({
        id,
        handle: k,
        handleKey: k,
        kind,
        detail: typeof o.detail === 'string' ? o.detail : undefined,
        at: typeof o.at === 'string' ? o.at : new Date().toISOString(),
        full_name: typeof o.full_name === 'string' ? o.full_name : undefined,
        followers_count: typeof o.followers_count === 'number' ? o.followers_count : undefined,
        attemptedEndpoint: typeof o.attemptedEndpoint === 'string' ? o.attemptedEndpoint : undefined,
      });
    }
    loaded.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    issues.length = 0;
    for (const row of loaded.slice(0, MAX_ISSUES)) {
      issues.push(row);
    }
    if (loaded.length > 0) {
      console.log(
        `[ledger] ${issues.length} registro(s) em “Problemas” carregado(s) de ${path}`
      );
    }
  } catch (e) {
    console.warn(
      '[ledger] Falha ao carregar problemas persistidos:',
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

function norm(h: string): string {
  return String(h ?? '')
    .replace(/^@/, '')
    .trim()
    .toLowerCase();
}

function pushIssue(row: Omit<IssueRow, 'id'> & { id?: string }): void {
  const id = row.id?.trim() ? row.id.trim() : randomUUID();
  issues.unshift({ ...row, id });
  if (issues.length > MAX_ISSUES) issues.length = MAX_ISSUES;
  schedulePersistIssues();
}

/** Remove um registro específico de Problemas (libera o @ em issueHandleKeysSet se não houver outro erro para o mesmo handle). */
export function removeIssueById(id: string): boolean {
  const want = String(id ?? '').trim();
  if (!want) return false;
  const idx = issues.findIndex((x) => x.id === want);
  if (idx === -1) return false;
  issues.splice(idx, 1);
  schedulePersistIssues();
  return true;
}

/** Handles já coletados ou integrados (evita reprocessar). */
export function listHandles(): Set<string> {
  return new Set([...pending.keys(), ...integrated.keys()]);
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

/** Handles que já constam em Problemas (regra/extração/erro) — não reabrir na grade na mesma coleta. */
export function issueHandleKeysSet(): Set<string> {
  const s = new Set<string>();
  for (const row of issues) {
    const k = norm(row.handleKey || row.handle);
    if (k) s.add(k);
  }
  return s;
}

/** Duplicados não aparecem na tabela de problemas (só log no console). */
export function recordDuplicate(handle: string): void {
  const k = norm(handle);
  if (!k || duplicateLogged.has(k)) return;
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
    integrated.set(key, {
      ...row,
      integratedAt: new Date().toISOString(),
      apiHost: result.apiHost,
      rocksDbVerified: result.verifyStatus ?? 'skipped',
    });
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
  const integrados = [...integrated.values()].sort((a, b) =>
    b.integratedAt.localeCompare(a.integratedAt)
  );
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
  return pending.delete(k) || integrated.delete(k);
}

export function clearAll(): void {
  pending.clear();
  integrated.clear();
  issues.length = 0;
  googleQueue.length = 0;
  duplicateLogged.clear();
  schedulePersistIssues();
}
