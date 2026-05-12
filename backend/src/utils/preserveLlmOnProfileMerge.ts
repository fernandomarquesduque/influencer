/**
 * O campo `llm` (classificação qualify) não deve ser apagado nem trocado por ingestões
 * de perfil “slim” vindas do Instagram ou do collector sem payload LLM explícito.
 */

import type { Entity } from '../types/index.js';

export async function loadExistingProfileRecordForMerge(
  storage: { loadByHandle?: (h: string) => Promise<Entity | null> },
  handle: string
): Promise<Record<string, unknown> | null> {
  if (typeof storage.loadByHandle !== 'function') return null;
  const key = handle.replace(/^@/, '').trim().toLowerCase();
  const e = await storage.loadByHandle(key);
  if (e == null || typeof e !== 'object' || Array.isArray(e)) return null;
  return e as Record<string, unknown>;
}

export function hasPreservableStoredLlm(existing: Record<string, unknown> | null | undefined): boolean {
  if (existing == null) return false;
  const llm = existing.llm;
  return llm != null && typeof llm === 'object' && !Array.isArray(llm);
}

/**
 * Mescla o snapshot novo do perfil com o registro já salvo: se já existir `llm` objeto,
 * mantém o valor do banco (ignora `llm` vindo em `incoming`).
 */
export function mergeProfilePreservingLlm(
  existing: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown>
): Record<string, unknown> {
  const handle = String(incoming.handle ?? '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '');
  const base: Record<string, unknown> = { ...incoming, handle };
  if (hasPreservableStoredLlm(existing)) {
    base.llm = existing!.llm;
  }
  return base;
}
