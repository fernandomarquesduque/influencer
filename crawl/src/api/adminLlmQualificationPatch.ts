import type { Entity } from '../types/index.js';

function normalizeStringArray(v: unknown, maxItems: number, maxItemLen: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of v) {
    const s = String(x ?? '')
      .trim()
      .slice(0, maxItemLen);
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

/**
 * Extrai do body apenas campos editáveis de `llm.qualification` (admin).
 */
export function pickAdminQualificationPatch(
  body: unknown
): { ok: true; patch: Record<string, unknown> } | { ok: false; error: string } {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Body deve ser um objeto JSON' };
  }
  const b = body as Record<string, unknown>;
  const patch: Record<string, unknown> = {};

  const setStr = (key: string, max: number) => {
    if (!(key in b)) return;
    const v = b[key];
    if (typeof v !== 'string') return;
    patch[key] = v.trim().slice(0, max);
  };

  setStr('personaSummary', 8000);
  setStr('profileType', 200);
  setStr('gender', 200);
  setStr('mainCategory', 500);
  setStr('language', 80);

  if ('subCategories' in b) patch.subCategories = normalizeStringArray(b.subCategories, 80, 240);
  if ('contentPillars' in b) patch.contentPillars = normalizeStringArray(b.contentPillars, 80, 240);
  if ('audienceType' in b) patch.audienceType = normalizeStringArray(b.audienceType, 80, 240);
  if ('toneOfVoice' in b) patch.toneOfVoice = normalizeStringArray(b.toneOfVoice, 80, 240);

  if ('brandSafety' in b) {
    const v = b.brandSafety;
    if (v == null) {
      patch.brandSafety = null;
    } else if (typeof v === 'string') {
      patch.brandSafety = v.trim().slice(0, 120);
    } else if (typeof v === 'object' && !Array.isArray(v)) {
      patch.brandSafety = v;
    }
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: 'Nenhum campo válido para atualizar' };
  }
  return { ok: true, patch };
}

/**
 * Mescla `patch` em `llm.qualification`, mantém demais chaves do perfil e marca edição admin.
 */
export function applyQualificationPatchToProfileRecord(
  existing: Record<string, unknown>,
  handle: string,
  patch: Record<string, unknown>
): Entity & { handle: string } {
  const prevLlm =
    existing.llm != null && typeof existing.llm === 'object' && !Array.isArray(existing.llm)
      ? { ...(existing.llm as Record<string, unknown>) }
      : {};
  const prevQ =
    prevLlm.qualification != null &&
      typeof prevLlm.qualification === 'object' &&
      !Array.isArray(prevLlm.qualification)
      ? { ...(prevLlm.qualification as Record<string, unknown>) }
      : {};

  const nextQ = { ...prevQ, ...patch };
  if (patch.brandSafety === null) {
    delete nextQ.brandSafety;
  }

  const adminEditedAt = new Date().toISOString();
  const nextLlm: Record<string, unknown> = {
    ...prevLlm,
    status: 'done',
    qualification: nextQ,
    adminEditedAt,
  };

  if (nextLlm.model == null || nextLlm.model === '') nextLlm.model = String(prevLlm.model ?? 'admin');
  if (nextLlm.version == null || typeof nextLlm.version !== 'number') {
    nextLlm.version = typeof prevLlm.version === 'number' ? prevLlm.version : 1;
  }
  if (nextLlm.qualifiedAt == null || nextLlm.qualifiedAt === '') {
    nextLlm.qualifiedAt = adminEditedAt;
  }
  if (nextLlm.confidence == null || typeof nextLlm.confidence !== 'number') {
    nextLlm.confidence = typeof prevLlm.confidence === 'number' ? prevLlm.confidence : 0.5;
  }

  const merged = { ...existing, handle, llm: nextLlm };
  return merged as Entity & { handle: string };
}
