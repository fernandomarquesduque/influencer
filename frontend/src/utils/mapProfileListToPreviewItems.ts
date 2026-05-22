/**
 * Converte `ProfileListItem` (listagem/campanha) para o formato de `ProfilePreviewItem`
 * usado pelo mesmo layout do dashboard — campo `size` via `followersCountToSizeKey` (mesmo módulo que o crawl).
 */
import type { ProfileListItem, ProfilePreviewItem } from '../api'
import { formatFacetLabel } from './facetLabels'
import { followersCountToSizeKey } from '@repo/followersSizeBuckets'
import { getProfilePicUrl, getStableProfilePicUrl, proxyImageUrl } from '../api'

export function getLlmQualification(record: Record<string, unknown>): Record<string, unknown> | null {
  const llm = record.llm
  if (llm == null || typeof llm !== 'object' || Array.isArray(llm)) return null
  const lo = llm as Record<string, unknown>
  const status = String(lo.status ?? '').trim().toLowerCase()
  if (status !== 'done') return null
  const q = lo.qualification
  if (q == null || typeof q !== 'object' || Array.isArray(q)) return null
  return q as Record<string, unknown>
}

/** Resumo do perfil gerado pela LLM (`personaSummary`), quando disponível. */
export function getProfilePersonaSummary(record: Record<string, unknown> | null | undefined): string {
  if (!record) return ''
  const llm = record.llm
  if (llm == null || typeof llm !== 'object' || Array.isArray(llm)) return ''
  const q = (llm as Record<string, unknown>).qualification
  if (q == null || typeof q !== 'object' || Array.isArray(q)) return ''
  return String((q as Record<string, unknown>).personaSummary ?? '').trim()
}

/** Texto curto da qualificação LLM (personaSummary ou fallback) para listagem — ex.: abaixo do @. */
export function getLlmDescriptionLine(item: ProfileListItem): { line: string; tooltip?: string } | null {
  const q = getLlmQualification(item as unknown as Record<string, unknown>)
  if (!q) return null
  const summary = String(q.personaSummary ?? '').trim()
  if (summary) {
    const max = 140
    if (summary.length > max) return { line: `${summary.slice(0, max)}…`, tooltip: summary }
    return { line: summary }
  }
  const cat = String(q.mainCategory ?? '').trim()
  const pillars = Array.isArray(q.contentPillars)
    ? (q.contentPillars as unknown[])
        .filter((x): x is string => typeof x === 'string')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 2)
    : []
  const aud = Array.isArray(q.audienceType)
    ? (q.audienceType as unknown[])
        .filter((x): x is string => typeof x === 'string')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 1)
    : []
  const parts = [cat, ...pillars, ...aud].filter(Boolean)
  if (parts.length === 0) return null
  return { line: parts.join(' · ') }
}

function varyPreviewPersonaDescription(raw: string, item: ProfileListItem, previewIndex: number): string {
  const q = getLlmQualification(item as unknown as Record<string, unknown>)
  const cat = String(q?.mainCategory ?? '').trim()
  const aud0 =
    Array.isArray(q?.audienceType) && q?.audienceType[0] && typeof q.audienceType[0] === 'string'
      ? q.audienceType[0].trim()
      : ''

  const base = String(raw ?? '').trim()
  if (!base) {
    if (cat || aud0) {
      const one = [cat && `Conteúdo em ${cat}.`, aud0 && `Público ${aud0}.`].filter(Boolean)
      if (previewIndex % 2 === 0) return one[0] ?? 'Sem descrição LLM disponível.'
      return one.join(' ') || 'Sem descrição LLM disponível.'
    }
    return 'Sem descrição LLM disponível.'
  }

  const mode = previewIndex % 5
  const firstSentence = (() => {
    const m = base.match(/^.{1,200}?[.!?](?:\s|$)/)
    return m ? m[0].trim() : base.slice(0, Math.min(95, base.length))
  })()

  if (mode === 0) {
    return firstSentence.length > 100 ? `${firstSentence.slice(0, 97)}…` : firstSentence
  }
  if (mode === 1) {
    const cut = base.length > 145 ? `${base.slice(0, 142)}…` : base
    return cut
  }
  if (mode === 2) {
    return base.length > 260 ? `${base.slice(0, 257)}…` : base
  }
  if (mode === 3) {
    return base
  }
  const tail = [cat && `Categoria: ${cat}.`, aud0 && `Público-alvo: ${aud0}.`].filter(Boolean).join(' ')
  return tail ? `${base} ${tail}` : base
}

function previewPicUrl(item: ProfileListItem, stablePicOnly: boolean): string {
  const rec = item as unknown as Record<string, unknown>
  const stable = String(getStableProfilePicUrl(rec) ?? '').trim()
  if (stablePicOnly) return stable
  const proxied = proxyImageUrl(getProfilePicUrl(rec))
  return stable || proxied || ''
}

export type MapProfileListToPreviewOptions = { stablePicOnly?: boolean }

export function mapProfileListItemToPreviewItem(
  item: ProfileListItem,
  previewIndex: number,
  options?: MapProfileListToPreviewOptions
): ProfilePreviewItem {
  const stablePicOnly = Boolean(options?.stablePicOnly)
  const fullName = String(item.full_name ?? '').trim()
  const firstName = (() => {
    const chooseFromParts = (parts: string[]): string | null => {
      const clean = parts.map((p) => p.trim()).filter(Boolean)
      const long = clean.find((p) => p.length > 4)
      if (long) return long
      return clean[0] ?? null
    }
    if (fullName) {
      const fromName = chooseFromParts(fullName.split(/\s+/))
      if (fromName) return fromName
    }
    const handleBase = String(item.handle ?? '').replace(/^@/, '').trim()
    if (!handleBase) return 'Influenciador'
    const handleParts = handleBase
      .split(/[._-]+/)
      .map((x) => x.replace(/\d+/g, '').trim())
      .filter(Boolean)
    return chooseFromParts(handleParts) ?? handleBase
  })()

  const q = getLlmQualification(item as unknown as Record<string, unknown>)
  const personaRaw = String(q?.personaSummary ?? '').trim()
  const llmDescription = varyPreviewPersonaDescription(personaRaw, item, previewIndex)
  const category = String(q?.mainCategory ?? '').trim() || '-'
  const audienceArr = Array.isArray(q?.audienceType)
    ? (q!.audienceType as unknown[])
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .slice(0, 6)
    : []
  const audience = audienceArr.map((a) => formatFacetLabel(a)).join(' / ') || '-'

  const followers = Number(item.followers_count ?? 0)
  const size: ProfilePreviewItem['size'] = followersCountToSizeKey(followers)

  const collectedAtRaw = (item as Record<string, unknown>)._collected_at
  const collectedAt = typeof collectedAtRaw === 'string' && collectedAtRaw.trim() ? collectedAtRaw : null

  const eng = item.engagement
  const engagementRate = Number(eng?.engagement_rate ?? 0)
  const totalLikes = Number(eng?.total_likes ?? 0)
  const totalComments = Number(eng?.total_comments ?? 0)
  const postsCount = Number(eng?.posts_count ?? 0)
  const avgLikes = Number(eng?.avg_likes ?? 0)
  const avgComments = Number(eng?.avg_comments ?? 0)

  return {
    firstName,
    profilePicUrl: previewPicUrl(item, stablePicOnly),
    llmDescription,
    size,
    category,
    audience,
    collectedAt,
    followersCount: followers,
    engagementRate: Number.isFinite(engagementRate) ? engagementRate : 0,
    totalLikes: Number.isFinite(totalLikes) ? totalLikes : 0,
    totalComments: Number.isFinite(totalComments) ? totalComments : 0,
    postsCount: Number.isFinite(postsCount) ? postsCount : 0,
    avgLikes: Number.isFinite(avgLikes) ? avgLikes : 0,
    avgComments: Number.isFinite(avgComments) ? avgComments : 0,
  }
}

export function mapProfileListToPreviewItems(
  items: ProfileListItem[],
  options?: MapProfileListToPreviewOptions
): ProfilePreviewItem[] {
  return items.map((it, i) => mapProfileListItemToPreviewItem(it, i, options))
}
