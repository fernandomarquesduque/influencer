/**
 * Ledger em 3 faixas: coletado (aguardando ou sem API), problemas (só erros — duplicados não entram), integrado (API OK).
 */

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

const pending = new Map<string, PendingRow>();
const integrated = new Map<string, IntegratedRow>();
const issues: IssueRow[] = [];

/** Evita spam de “duplicado” para o mesmo @ na mesma sessão. */
const duplicateLogged = new Set<string>();

function norm(h: string): string {
  return String(h ?? '')
    .replace(/^@/, '')
    .trim()
    .toLowerCase();
}

function pushIssue(row: IssueRow): void {
  issues.unshift(row);
  if (issues.length > MAX_ISSUES) issues.length = MAX_ISSUES;
}

/** Handles já coletados ou integrados (evita reprocessar). */
export function listHandles(): Set<string> {
  return new Set([...pending.keys(), ...integrated.keys()]);
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
  duplicateLogged.clear();
}
