import type { ProfileListItem } from '../api'
import { getLlmQualification } from './mapProfileListToPreviewItems'

export type LlmQualificationBadge = { key: string; text: string; title: string }

/** Categoria principal LLM para exibir ao lado do gênero (abaixo do nome). */
export function getLlmMainCategoryLabel(item: ProfileListItem): string | null {
  const q = getLlmQualification(item as unknown as Record<string, unknown>)
  if (!q) return null
  const mainCategory = String(q.mainCategory ?? '').trim()
  if (!mainCategory || mainCategory === '-') return null
  return mainCategory
}

/** Pilares de conteúdo (LLM) para exibir ao lado da categoria principal. */
export function getLlmContentPillarLabels(item: ProfileListItem): string[] {
  const q = getLlmQualification(item as unknown as Record<string, unknown>)
  if (!q) return []
  const mainNorm = String(q.mainCategory ?? '').trim().toLowerCase()
  const arr = q.contentPillars
  if (!Array.isArray(arr)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const x of arr) {
    if (typeof x !== 'string') continue
    const s = x.trim()
    if (!s || s === '-') continue
    const k = s.toLowerCase()
    if (mainNorm && k === mainNorm) continue
    if (seen.has(k)) continue
    seen.add(k)
    out.push(s)
  }
  return out
}

/** Tipo de perfil / influenciador (LLM) — canto superior esquerdo flutuante no card. */
export function getLlmProfileTypeBadge(item: ProfileListItem): LlmQualificationBadge | null {
  const q = getLlmQualification(item as unknown as Record<string, unknown>)
  if (!q) return null
  const profileType = String(q.profileType ?? '').trim()
  if (!profileType || profileType.toLowerCase() === 'unknown') return null
  return {
    key: 'profileType',
    text: profileType.charAt(0).toUpperCase() + profileType.slice(1).toLowerCase(),
    title: 'Tipo de perfil (LLM)',
  }
}

/** Gênero inferido (LLM) — ao lado da categoria, abaixo do nome. */
export function getLlmGenderBadge(item: ProfileListItem): LlmQualificationBadge | null {
  const q = getLlmQualification(item as unknown as Record<string, unknown>)
  if (!q) return null
  const gender = String(q.gender ?? '').trim()
  if (!gender || gender.toLowerCase() === 'unknown') return null
  return {
    key: 'gender',
    text: gender.charAt(0).toUpperCase() + gender.slice(1).toLowerCase(),
    title: 'Gênero inferido (LLM)',
  }
}

/** Tipo, gênero e categoria a partir de um objeto com `llm` no topo (ex.: `post.influencer`). */
export function getLlmTripleBadgesFromLlmRoot(record: Record<string, unknown> | null | undefined): {
  tipo: LlmQualificationBadge | null
  genero: LlmQualificationBadge | null
  categoria: LlmQualificationBadge | null
} {
  if (record == null || typeof record !== 'object') {
    return { tipo: null, genero: null, categoria: null }
  }
  const item = record as unknown as ProfileListItem
  const catLabel = getLlmMainCategoryLabel(item)
  const categoria =
    catLabel != null
      ? ({ key: 'mainCategory', text: catLabel, title: 'Categoria principal (LLM)' } satisfies LlmQualificationBadge)
      : null
  return {
    tipo: getLlmProfileTypeBadge(item),
    genero: getLlmGenderBadge(item),
    categoria,
  }
}

/** Cor estável por texto (alinhado ao painel BI / facetas LLM). */
export function campaignLlmBadgeStyles(seed: string): { border: string; color: string; background: string } {
  let h = 0
  const key = seed.trim().toLowerCase()
  for (let i = 0; i < key.length; i++) h = (Math.imul(31, h) + key.charCodeAt(i)) | 0
  const hue = Math.abs(h) % 360
  return {
    border: `1px solid hsl(${hue}, 38%, 42%)`,
    color: `hsl(${hue}, 38%, 32%)`,
    background: `hsla(${hue}, 38%, 42%, 0.11)`,
  }
}
