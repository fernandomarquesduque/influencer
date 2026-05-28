/**
 * Espelho do backend (`queryRelevance.ts`): busca parcial por relevância.
 */

const MIN_TOKEN_LEN = 2
const PROXIMITY_SPAN_MAX = 80

const STOPWORDS = new Set([
  'de',
  'da',
  'do',
  'dos',
  'das',
  'e',
  'a',
  'o',
  'os',
  'as',
  'em',
  'no',
  'na',
  'nos',
  'nas',
  'um',
  'uma',
  'uns',
  'umas',
  'por',
  'para',
  'com',
  'sem',
])

export function foldSearchText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

export function tokenizeQueryWords(q: string): string[] {
  const t = foldSearchText(q.trim())
  if (!t) return []
  return t.split(' ').filter((w) => w.length >= MIN_TOKEN_LEN && !STOPWORDS.has(w))
}

function tokenizeExactPhraseWords(q: string): string[] {
  const t = foldSearchText(q.trim())
  if (!t) return []
  return t.split(' ').filter((w) => w.length >= MIN_TOKEN_LEN)
}

export type ParsedSearchQuery = { exactPhrases: string[]; remainder: string }

const QUOTED_SEGMENT_RE = /"([^"]*)"|'([^']*)'|\u201c([^\u201d]*)\u201d/g

/** Extrai cada `"frase"` da query; o restante é busca livre. */
export function parseSearchQuery(q: string): ParsedSearchQuery {
  const trimmed = q.trim()
  const exactPhrases: string[] = []
  const re = new RegExp(QUOTED_SEGMENT_RE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(trimmed)) !== null) {
    const inner = (m[1] ?? m[2] ?? m[3] ?? '').trim()
    if (inner.length > 0) exactPhrases.push(inner)
  }
  const remainder = trimmed.replace(re, ' ').replace(/\s+/g, ' ').trim()
  return { exactPhrases, remainder }
}

export function isExactPhraseSearchQuery(q: string): boolean {
  return parseSearchQuery(q).exactPhrases.length > 0
}

function scoreExactPhraseQuery(qTrim: string, search: string): { match: boolean; relevance: number } {
  const words = tokenizeExactPhraseWords(qTrim)
  if (words.length >= 2) {
    if (textContainsAdjacentPhrase(words, search)) return { match: true, relevance: 1000 }
    return { match: false, relevance: 0 }
  }
  if (words.length === 1) {
    if (isWholeTokenMatch(words[0]!, search)) return { match: true, relevance: 1000 }
    return { match: false, relevance: 0 }
  }
  if (qTrim.length >= MIN_TOKEN_LEN && isWholeTokenMatch(qTrim, search)) {
    return { match: true, relevance: 1000 }
  }
  return { match: false, relevance: 0 }
}

function maxEditDistanceForWord(word: string): number {
  if (word.length >= 8) return 2
  if (word.length >= 5) return 1
  return word.length >= 4 ? 1 : 0
}

function editDistanceAtMostOne(a: string, b: string): boolean {
  if (a === b) return true
  const la = a.length
  const lb = b.length
  if (Math.abs(la - lb) > 1) return false
  if (la === 0 || lb === 0) return true
  if (la > lb) return editDistanceAtMostOne(b, a)
  let i = 0
  let j = 0
  let edits = 0
  while (i < la && j < lb) {
    if (a[i] === b[j]) {
      i++
      j++
      continue
    }
    edits++
    if (edits > 1) return false
    if (la === lb) {
      i++
      j++
    } else {
      j++
    }
  }
  if (i < la || j < lb) edits++
  return edits <= 1
}

function editDistanceAtMost(a: string, b: string, maxDist: number): boolean {
  if (a === b) return true
  const la = a.length
  const lb = b.length
  if (Math.abs(la - lb) > maxDist) return false
  if (maxDist === 0) return false
  if (maxDist === 1) return editDistanceAtMostOne(a, b)
  const dp = Array.from({ length: la + 1 }, (_, i) =>
    Array.from({ length: lb + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= la; i++) {
    let rowMin = maxDist + 1
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost)
      rowMin = Math.min(rowMin, dp[i]![j]!)
    }
    if (rowMin > maxDist) return false
  }
  return (dp[la]![lb] ?? maxDist + 1) <= maxDist
}

type WordHit = 'exact' | 'fuzzy' | 'none'

function isWholeTokenMatch(word: string, search: string): boolean {
  if (!word) return false
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[^a-z0-9_])${esc}(?=[^a-z0-9_]|$)`).test(search)
}

function textContainsPhraseAsTokens(qTrim: string, search: string): boolean {
  const words = tokenizeQueryWords(qTrim)
  if (words.length === 0) return qTrim.length >= MIN_TOKEN_LEN && isWholeTokenMatch(foldSearchText(qTrim), search)
  if (words.length === 1) return isWholeTokenMatch(words[0]!, search)
  return matchPositionsInOrder(words, search).length === words.length
}

function textContainsAdjacentPhrase(words: string[], search: string): boolean {
  if (words.length < 2) return false
  const phrasePat = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')
  return new RegExp(`(?:^|[^a-z0-9_])${phrasePat}(?=[^a-z0-9_]|$)`).test(search)
}

function findWordTokenPosition(word: string, search: string, from: number): number {
  const re = /[a-z0-9_]+/g
  re.lastIndex = from
  let m: RegExpExecArray | null
  while ((m = re.exec(search)) !== null) {
    const tok = m[0]
    if (tok === word) return m.index
    const maxDist = maxEditDistanceForWord(word)
    if (maxDist > 0 && tok.length >= word.length - maxDist && tok.length <= word.length + maxDist) {
      if (editDistanceAtMost(word, tok, maxDist)) return m.index
    }
  }
  return -1
}

function classifyWordInText(word: string, search: string): WordHit {
  if (isWholeTokenMatch(word, search)) return 'exact'
  const maxDist = maxEditDistanceForWord(word)
  if (maxDist === 0) return 'none'
  const re = /[a-z0-9_]+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(search)) !== null) {
    const tok = m[0]
    if (tok.length < word.length - maxDist || tok.length > word.length + maxDist) continue
    if (editDistanceAtMost(word, tok, maxDist)) return 'fuzzy'
  }
  return 'none'
}

function matchPositionsInOrder(words: string[], search: string): number[] {
  const positions: number[] = []
  let from = 0
  for (const word of words) {
    const found = findWordTokenPosition(word, search, from)
    if (found === -1) return []
    positions.push(found)
    from = found + word.length
  }
  return positions
}

function wordMatchWeight(word: string): number {
  if (word.length >= 8) return 1.5
  if (word.length >= 5) return 1.25
  return 1
}

function countExactTokenHits(word: string, search: string): number {
  if (!word) return 0
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(?:^|[^a-z0-9_])${esc}(?=[^a-z0-9_]|$)`, 'g')
  let n = 0
  while (re.exec(search)) n++
  return n
}

function usernameExactBonus(words: string[], search: string): number {
  if (words.length !== 1) return 0
  const w = words[0]!
  const firstTok = search.match(/^[a-z0-9_.]+/)?.[0]
  return firstTok === w ? 85 : 0
}

function proximityBonus(words: string[], search: string): number {
  if (words.length < 2) return 0
  const positions = matchPositionsInOrder(words, search)
  if (positions.length !== words.length) return 0
  const span = positions[positions.length - 1]! - positions[0]!
  if (span > PROXIMITY_SPAN_MAX) return Math.max(8, 35 - Math.floor((span - PROXIMITY_SPAN_MAX) / 12))
  return Math.round(200 - (span / PROXIMITY_SPAN_MAX) * 165)
}

function scoreMultiWordQuery(words: string[], search: string): { match: boolean; relevance: number } {
  let exact = 0
  let fuzzy = 0
  let hitSum = 0
  let totalWeight = 0
  let densityBonus = 0
  for (const word of words) {
    const w = wordMatchWeight(word)
    totalWeight += w
    const hit = classifyWordInText(word, search)
    if (hit === 'exact') {
      exact++
      hitSum += w
      densityBonus += Math.min(35, countExactTokenHits(word, search) * 10)
    } else if (hit === 'fuzzy') {
      fuzzy++
      hitSum += w * 0.55
    }
  }
  const total = words.length
  if (hitSum <= 0) return { match: false, relevance: 0 }
  if (exact + fuzzy < total) return { match: false, relevance: 0 }

  const coverage = totalWeight > 0 ? hitSum / totalWeight : 0
  const exactRatio = exact / total
  const missing = total - exact - fuzzy

  let relevance: number
  if (exact === total) {
    relevance = 780
  } else if (exact + fuzzy === total) {
    relevance = 655
  } else {
    const missPenalty = missing * 130
    relevance = Math.round(70 + coverage * 420 + exactRatio * 140 - missPenalty)
    relevance = Math.max(35, Math.min(620, relevance))
  }

  relevance += proximityBonus(words, search)
  relevance += Math.min(55, densityBonus)
  relevance += usernameExactBonus(words, search)
  return { match: true, relevance: Math.min(relevance, 990) }
}

function scoreFreeTextQuery(search: string, q: string): { match: boolean; relevance: number } {
  const qTrim = foldSearchText(q.trim())
  if (!qTrim) return { match: true, relevance: 0 }

  const words = tokenizeQueryWords(qTrim)
  if (words.length >= 2 && textContainsAdjacentPhrase(words, search)) {
    return { match: true, relevance: 1000 }
  }
  if (words.length >= 2 && textContainsPhraseAsTokens(qTrim, search)) {
    return scoreMultiWordQuery(words, search)
  }
  if (words.length === 1 && textContainsPhraseAsTokens(qTrim, search)) {
    return { match: true, relevance: 1000 }
  }

  if (words.length === 0) {
    if (qTrim.length >= MIN_TOKEN_LEN && isWholeTokenMatch(qTrim, search)) return { match: true, relevance: 500 }
    return { match: false, relevance: 0 }
  }

  if (words.length === 1) {
    const w = words[0]!
    const hit = classifyWordInText(w, search)
    if (hit === 'exact') {
      const reps = Math.min(4, countExactTokenHits(w, search))
      const rel = 470 + reps * 14 + usernameExactBonus(words, search)
      return { match: true, relevance: Math.min(540, rel) }
    }
    if (hit === 'fuzzy') return { match: true, relevance: 395 }
    return { match: false, relevance: 0 }
  }

  return scoreMultiWordQuery(words, search)
}

/**
 * WHERE da busca: trechos `"..."` obrigam frase exata no texto; o restante é busca livre (também obrigatório).
 * `match === false` → resultado excluído (não é critério de ordenação).
 */
export function scoreQueryMatch(searchableText: string, q: string): { match: boolean; relevance: number } {
  const parsed = parseSearchQuery(q)
  const search = foldSearchText(searchableText.trim())
  if (!search && (parsed.exactPhrases.length > 0 || parsed.remainder.trim())) {
    return { match: false, relevance: 0 }
  }
  if (!parsed.exactPhrases.length && !parsed.remainder.trim()) return { match: true, relevance: 0 }

  let relevance = 0
  for (const phrase of parsed.exactPhrases) {
    const r = scoreExactPhraseQuery(foldSearchText(phrase.trim()), search)
    if (!r.match) return { match: false, relevance: 0 }
    relevance += r.relevance
  }

  const rem = parsed.remainder.trim()
  if (!rem) {
    if (parsed.exactPhrases.length === 0) return { match: true, relevance: 0 }
    return { match: true, relevance: Math.round(relevance / parsed.exactPhrases.length) }
  }

  const free = scoreFreeTextQuery(search, rem)
  if (!free.match) return { match: false, relevance: 0 }
  return { match: true, relevance: relevance + free.relevance }
}

export function passesSearchWhere(searchableText: string, q: string): boolean {
  return scoreQueryMatch(searchableText, q).match
}

/** Query parece nome de pessoa (2–5 palavras), não @ de handle. */
export function looksLikeInfluencerNameQuery(q: string): boolean {
  const raw = q.trim()
  if (!raw || raw.length > 80 || /[#@/]/.test(raw)) return false
  if (/^[a-z0-9._]+$/i.test(raw.replace(/^@/, '')) && !raw.includes(' ')) return false
  const words = tokenizeQueryWords(foldSearchText(raw.replace(/\./g, ' ')))
  if (words.length < 2 || words.length > 5) return false
  return words.every((w) => /^[a-z0-9_]+$/.test(w))
}

/** Nome, @ ou bio do perfil (não legenda do post). Tolerante a iniciais e prefixo (Esfeck ~ Esfeckm). */
export function passesProfileIdentityWhere(identityText: string, q: string): boolean {
  const blob = identityText.trim()
  const trimmed = q.trim()
  if (!blob || !trimmed) return false
  if (passesSearchWhere(blob, trimmed)) return true

  const qNorm = foldSearchText(trimmed)
    .replace(/\./g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (qNorm && qNorm !== foldSearchText(trimmed) && passesSearchWhere(blob, qNorm)) return true

  const words = tokenizeQueryWords(qNorm || foldSearchText(trimmed))
  if (words.length < 2) return false
  const search = foldSearchText(blob)
  const pattern = words
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\s.]+')
  if (new RegExp(`(?:^|[^a-z0-9_])${pattern}(?=[^a-z0-9_]|$)`).test(search)) return true

  const tokens = search.match(/[a-z0-9_]+/g) ?? []
  let hits = 0
  for (const w of words) {
    if (passesSearchWhere(search, w)) {
      hits++
      continue
    }
    if (
      w.length >= 4 &&
      tokens.some((tok) => {
        if (tok === w || tok.startsWith(w) || w.startsWith(tok)) {
          return Math.min(tok.length, w.length) >= 4
        }
        return false
      })
    ) {
      hits++
    }
  }
  if (hits >= words.length) return true
  if (hits >= words.length - 1 && words.some((w) => w.length >= 5)) return true
  return false
}

export function matchesQuery(searchableText: string, q: string): { match: boolean; relevance: number } {
  return scoreQueryMatch(searchableText, q)
}

export type TextHighlightRange = { start: number; end: number }

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Padrão que casa token no texto original ignorando acentos (ex.: mario ~ Mário). */
function tokenToAccentInsensitivePattern(token: string): string {
  return [...token]
    .map((ch) => {
      const base = ch.normalize('NFD').replace(/\p{M}/gu, '')
      if (!base || !/[\p{L}\p{N}_]/u.test(base)) return escapeRegExp(ch)
      return `${escapeRegExp(base)}\\p{M}*`
    })
    .join('')
}

function addRangesFromPattern(
  ranges: TextHighlightRange[],
  text: string,
  pattern: string
): void {
  if (!pattern || !text) return
  try {
    const re = new RegExp(pattern, 'giu')
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const start = m.index
      const end = start + m[0].length
      if (end > start) ranges.push({ start, end })
      if (m[0].length === 0) {
        re.lastIndex++
        if (re.lastIndex > text.length) break
      }
    }
  } catch {
    /* regex inválido */
  }
}

function mergeHighlightRanges(ranges: TextHighlightRange[]): TextHighlightRange[] {
  if (ranges.length === 0) return []
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end)
  const out: TextHighlightRange[] = [{ ...sorted[0]! }]
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!
    const last = out[out.length - 1]!
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end)
    } else {
      out.push({ ...cur })
    }
  }
  return out
}

function rangeOverlapsWord(ranges: TextHighlightRange[], word: string, text: string): boolean {
  const folded = foldSearchText(text)
  const w = foldSearchText(word)
  for (const r of ranges) {
    const slice = foldSearchText(text.slice(r.start, r.end))
    if (slice.includes(w) || w.includes(slice)) return true
  }
  return folded.includes(w) && ranges.length > 0
}

function findFuzzyWordSpanInText(text: string, word: string): TextHighlightRange | null {
  const maxDist = maxEditDistanceForWord(word)
  if (maxDist === 0) return null
  const target = foldSearchText(word)
  const re = /[\p{L}\p{N}_]{3,}/gu
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const tok = m[0]
    if (editDistanceAtMost(target, foldSearchText(tok), maxDist)) {
      return { start: m.index, end: m.index + tok.length }
    }
  }
  return null
}

/** Intervalos no texto original que correspondem à query (tokens, frase, fuzzy). */
export function findHighlightRangesInText(text: string, query: string): TextHighlightRange[] {
  const raw = text ?? ''
  if (!raw.trim() || !query.trim()) return []

  const parsed = parseSearchQuery(query)
  const ranges: TextHighlightRange[] = []

  for (const phrase of parsed.exactPhrases) {
    const words = tokenizeExactPhraseWords(phrase)
    if (words.length >= 2) {
      const phrasePat = words.map((w) => tokenToAccentInsensitivePattern(w)).join('\\s+')
      addRangesFromPattern(ranges, raw, `(${phrasePat})`)
    } else if (words.length === 1) {
      const inner = tokenToAccentInsensitivePattern(words[0]!)
      addRangesFromPattern(ranges, raw, `(?:^|[^\\p{L}\\p{N}_])(${inner})(?=[^\\p{L}\\p{N}_]|$)`)
    }
  }

  const rem = parsed.remainder.trim()
  if (!rem) return mergeHighlightRanges(ranges)

  const words = tokenizeQueryWords(rem)

  if (words.length >= 2) {
    const phrasePat = words.map((w) => tokenToAccentInsensitivePattern(w)).join('\\s+')
    addRangesFromPattern(ranges, raw, `(${phrasePat})`)
  }

  for (const word of words) {
    const inner = tokenToAccentInsensitivePattern(word)
    addRangesFromPattern(ranges, raw, `(?:^|[^\\p{L}\\p{N}_])(${inner})(?=[^\\p{L}\\p{N}_]|$)`)
    if (!rangeOverlapsWord(ranges, word, raw)) {
      const fuzzy = findFuzzyWordSpanInText(raw, word)
      if (fuzzy) ranges.push(fuzzy)
    }
  }

  if (words.length === 0 && rem.length >= MIN_TOKEN_LEN) {
    const inner = tokenToAccentInsensitivePattern(foldSearchText(rem))
    addRangesFromPattern(ranges, raw, `(?:^|[^\\p{L}\\p{N}_])(${inner})(?=[^\\p{L}\\p{N}_]|$)`)
  }

  return mergeHighlightRanges(ranges)
}

/** Trecho da legenda centrado no primeiro termo que bate na busca. */
export function getCaptionSnippetForSearch(caption: string, query: string, maxLen = 220): string {
  const t = caption.trim()
  if (!t) return ''
  if (!query.trim() || t.length <= maxLen) {
    return t.length <= maxLen ? t : `${t.slice(0, maxLen)}…`
  }

  const ranges = findHighlightRangesInText(t, query)
  if (ranges.length === 0) {
    return t.length <= maxLen ? t : `${t.slice(0, maxLen)}…`
  }

  const anchor = ranges[0]!
  const center = Math.floor((anchor.start + anchor.end) / 2)
  let start = Math.max(0, center - Math.floor(maxLen / 2))
  let end = Math.min(t.length, start + maxLen)
  if (end - start < maxLen) start = Math.max(0, end - maxLen)

  let snippet = t.slice(start, end)
  if (start > 0) snippet = `…${snippet}`
  if (end < t.length) snippet = `${snippet}…`
  return snippet
}
