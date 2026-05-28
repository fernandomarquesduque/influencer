/**
 * Busca textual por relevância parcial: frase completa > palavras próximas/ordenadas > todas as palavras > parte.
 */

const MIN_TOKEN_LEN = 2;
/** Tokens curtos no FTS usam match exato (sem `*`) para não confundir pai com pais. */
const FTS_EXACT_TOKEN_MAX_LEN = 5;
/** Distância máxima (caracteres) entre primeiro e último match para bônus de “quase frase”. */
const PROXIMITY_SPAN_MAX = 80;

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
]);

/** Remove acentos para match PT-BR (ex.: mario / mário). */
export function foldSearchText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Palavras significativas da query (minúsculas, sem stopwords). */
export function tokenizeQueryWords(q: string): string[] {
  const t = foldSearchText(q.trim());
  if (!t) return [];
  return t.split(' ').filter((w) => w.length >= MIN_TOKEN_LEN && !STOPWORDS.has(w));
}

/** Tokens da frase entre aspas (mantém stopwords; sem fuzzy). */
function tokenizeExactPhraseWords(q: string): string[] {
  const t = foldSearchText(q.trim());
  if (!t) return [];
  return t.split(' ').filter((w) => w.length >= MIN_TOKEN_LEN);
}

/** Trechos entre aspas (obrigatórios, frase exata) + texto livre restante. */
export type ParsedSearchQuery = { exactPhrases: string[]; remainder: string };

const QUOTED_SEGMENT_RE = /"([^"]*)"|'([^']*)'|\u201c([^\u201d]*)\u201d/g;

/**
 * Extrai cada `"frase"` / `'frase'` da query.
 * Ex.: `"silvio santos" saia rodada` → exactPhrases: ['silvio santos'], remainder: 'saia rodada'
 */
export function parseSearchQuery(q: string): ParsedSearchQuery {
  const trimmed = q.trim();
  const exactPhrases: string[] = [];
  const re = new RegExp(QUOTED_SEGMENT_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(trimmed)) !== null) {
    const inner = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (inner.length > 0) exactPhrases.push(inner);
  }
  const remainder = trimmed.replace(re, ' ').replace(/\s+/g, ' ').trim();
  return { exactPhrases, remainder };
}

export function isExactPhraseSearchQuery(q: string): boolean {
  return parseSearchQuery(q).exactPhrases.length > 0;
}

function ftsExprForExactPhrase(phrase: string): string | null {
  const words = tokenizeExactPhraseWords(phrase);
  if (words.length >= 2) {
    const p = words.join(' ').replace(/"/g, '""');
    return `content:"${p}"`;
  }
  if (words.length === 1) return escapeFtsToken(words[0]!);
  const t = foldSearchText(phrase.trim());
  if (t.length >= MIN_TOKEN_LEN) return escapeFtsToken(t);
  return null;
}

function scoreExactPhraseQuery(qTrim: string, search: string): { match: boolean; relevance: number } {
  const words = tokenizeExactPhraseWords(qTrim);
  if (words.length >= 2) {
    if (textContainsAdjacentPhrase(words, search)) return { match: true, relevance: 1000 };
    return { match: false, relevance: 0 };
  }
  if (words.length === 1) {
    if (isWholeTokenMatch(words[0]!, search)) return { match: true, relevance: 1000 };
    return { match: false, relevance: 0 };
  }
  if (qTrim.length >= MIN_TOKEN_LEN && isWholeTokenMatch(qTrim, search)) {
    return { match: true, relevance: 1000 };
  }
  return { match: false, relevance: 0 };
}

function escapeFtsToken(w: string): string {
  const esc = w.replace(/"/g, '""');
  if (/^[a-z0-9_]+$/i.test(w)) {
    if (w.length <= FTS_EXACT_TOKEN_MAX_LEN) return `content:"${w}"`;
    return `content:${w}*`;
  }
  if (w.length <= FTS_EXACT_TOKEN_MAX_LEN) return `content:"${esc}"`;
  return `content:"${esc}"*`;
}

/**
 * FTS5: frase exata + AND de tokens (restrito) + OR por token (amplo).
 */
function userQueryToFtsMatchExpressionFree(q: string): string | null {
  const words = tokenizeQueryWords(q);
  if (words.length === 0) {
    const t = foldSearchText(q.trim());
    if (t.length >= MIN_TOKEN_LEN) return escapeFtsToken(t);
    return null;
  }
  if (words.length >= 2) {
    return `(${words.map(escapeFtsToken).join(' AND ')})`;
  }
  return escapeFtsToken(words[0]!);
}

export function userQueryToFtsMatchExpression(q: string): string | null {
  const parsed = parseSearchQuery(q);
  if (parsed.exactPhrases.length > 0) {
    const andParts: string[] = [];
    for (const phrase of parsed.exactPhrases) {
      const e = ftsExprForExactPhrase(phrase);
      if (e) andParts.push(e);
    }
    const rem = parsed.remainder.trim();
    if (rem) {
      const words = tokenizeQueryWords(rem);
      if (words.length >= 2) andParts.push(`(${words.map(escapeFtsToken).join(' AND ')})`);
      else if (words.length === 1) andParts.push(escapeFtsToken(words[0]!));
      else {
        const t = foldSearchText(rem);
        if (t.length >= MIN_TOKEN_LEN) andParts.push(escapeFtsToken(t));
      }
    }
    return andParts.length > 0 ? andParts.join(' AND ') : null;
  }
  return userQueryToFtsMatchExpressionFree(q);
}

/**
 * Variantes FTS em ordem do mais ao menos restrito (frase → AND → OR amplo).
 */
export function userQueryToFtsMatchExpressions(q: string): string[] {
  const parsed = parseSearchQuery(q);
  if (parsed.exactPhrases.length > 0) {
    const expr = userQueryToFtsMatchExpression(q);
    return expr ? [expr] : [];
  }
  const words = tokenizeQueryWords(parsed.remainder || q);
  if (words.length >= 2) {
    // Pré-filtra com mais amplitude no FTS para não perder handles caso o índice esteja incompleto.
    // O WHERE final (`matchesQuery`) continua exigindo todas as palavras.
    const phrase = words.join(' ').replace(/"/g, '""');
    const phraseExpr = `content:"${phrase}"`;
    const andExpr = `(${words.map(escapeFtsToken).join(' AND ')})`;
    const orExpr = `(${words.map(escapeFtsToken).join(' OR ')})`;
    return Array.from(new Set([phraseExpr, andExpr, orExpr]));
  }
  const primary = userQueryToFtsMatchExpression(q);
  return primary ? [primary] : [];
}

function wordMatchWeight(word: string): number {
  if (word.length >= 8) return 1.5;
  if (word.length >= 5) return 1.25;
  return 1;
}

function maxEditDistanceForWord(word: string): number {
  if (word.length >= 8) return 2;
  if (word.length >= 5) return 1;
  return word.length >= 4 ? 1 : 0;
}

function editDistanceAtMost(a: string, b: string, maxDist: number): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > maxDist) return false;
  if (maxDist === 0) return false;
  if (maxDist === 1) return editDistanceAtMostOne(a, b);
  const dp = Array.from({ length: la + 1 }, (_, i) =>
    Array.from({ length: lb + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= la; i++) {
    let rowMin = maxDist + 1;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost);
      rowMin = Math.min(rowMin, dp[i]![j]!);
    }
    if (rowMin > maxDist) return false;
  }
  return (dp[la]![lb] ?? maxDist + 1) <= maxDist;
}

function editDistanceAtMostOne(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (la === 0 || lb === 0) return true;
  if (la > lb) return editDistanceAtMostOne(b, a);
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    edits++;
    if (edits > 1) return false;
    if (la === lb) {
      i++;
      j++;
    } else {
      j++;
    }
  }
  if (i < la || j < lb) edits++;
  return edits <= 1;
}

type WordHit = 'exact' | 'fuzzy' | 'none';

/** Palavra inteira no texto (evita `pai` casar dentro de `pais` / `#pais`). */
function isWholeTokenMatch(word: string, search: string): boolean {
  if (!word) return false;
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z0-9_])${esc}(?=[^a-z0-9_]|$)`).test(search);
}

/** Frase com tokens delimitados (mesma ordem, separadores flexíveis). */
function textContainsPhraseAsTokens(qTrim: string, search: string): boolean {
  const words = tokenizeQueryWords(qTrim);
  if (words.length === 0) return qTrim.length >= MIN_TOKEN_LEN && isWholeTokenMatch(foldSearchText(qTrim), search);
  if (words.length === 1) return isWholeTokenMatch(words[0]!, search);
  return matchPositionsInOrder(words, search).length === words.length;
}

/** Palavras da query adjacentes no texto (ex.: "silvio santos" colado ou com pouco espaço). */
function textContainsAdjacentPhrase(words: string[], search: string): boolean {
  if (words.length < 2) return false;
  const phrasePat = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  return new RegExp(`(?:^|[^a-z0-9_])${phrasePat}(?=[^a-z0-9_]|$)`).test(search);
}

function findWordTokenPosition(word: string, search: string, from: number): number {
  const re = /[a-z0-9_]+/g;
  re.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = re.exec(search)) !== null) {
    const tok = m[0];
    if (tok === word) return m.index;
    const maxDist = maxEditDistanceForWord(word);
    if (maxDist > 0 && tok.length >= word.length - maxDist && tok.length <= word.length + maxDist) {
      if (editDistanceAtMost(word, tok, maxDist)) return m.index;
    }
  }
  return -1;
}

function classifyWordInText(word: string, search: string): WordHit {
  if (isWholeTokenMatch(word, search)) return 'exact';
  const maxDist = maxEditDistanceForWord(word);
  if (maxDist === 0) return 'none';
  const re = /[a-z0-9_]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(search)) !== null) {
    const tok = m[0];
    if (tok.length < word.length - maxDist || tok.length > word.length + maxDist) continue;
    if (editDistanceAtMost(word, tok, maxDist)) return 'fuzzy';
  }
  return 'none';
}

/** Posições do início de cada palavra (token exato/fuzzy) na ordem da query. */
function matchPositionsInOrder(words: string[], search: string): number[] {
  const positions: number[] = [];
  let from = 0;
  for (const word of words) {
    const found = findWordTokenPosition(word, search, from);
    if (found === -1) return [];
    positions.push(found);
    from = found + word.length;
  }
  return positions;
}

function countExactTokenHits(word: string, search: string): number {
  if (!word) return 0;
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|[^a-z0-9_])${esc}(?=[^a-z0-9_]|$)`, 'g');
  let n = 0;
  while (re.exec(search)) n++;
  return n;
}

/** Bônus quando o @handle no início do texto bate com a query de uma palavra. */
function usernameExactBonus(words: string[], search: string): number {
  if (words.length !== 1) return 0;
  const w = words[0]!;
  const firstTok = search.match(/^[a-z0-9_.]+/)?.[0];
  return firstTok === w ? 85 : 0;
}

/** Bônus quando palavras aparecem na ordem da query; quanto menor o span, maior o bônus. */
function proximityBonus(words: string[], search: string): number {
  if (words.length < 2) return 0;
  const positions = matchPositionsInOrder(words, search);
  if (positions.length !== words.length) return 0;
  const span = positions[positions.length - 1]! - positions[0]!;
  if (span > PROXIMITY_SPAN_MAX) return Math.max(8, 35 - Math.floor((span - PROXIMITY_SPAN_MAX) / 12));
  return Math.round(200 - (span / PROXIMITY_SPAN_MAX) * 165);
}

function scoreMultiWordQuery(words: string[], search: string): { match: boolean; relevance: number } {
  let exact = 0;
  let fuzzy = 0;
  let hitSum = 0;
  let totalWeight = 0;
  let densityBonus = 0;
  for (const word of words) {
    const w = wordMatchWeight(word);
    totalWeight += w;
    const hit = classifyWordInText(word, search);
    if (hit === 'exact') {
      exact++;
      hitSum += w;
      densityBonus += Math.min(35, countExactTokenHits(word, search) * 10);
    } else if (hit === 'fuzzy') {
      fuzzy++;
      hitSum += w * 0.55;
    }
  }
  const total = words.length;
  if (hitSum <= 0) return { match: false, relevance: 0 };
  /** WHERE: sem aspas, todas as palavras precisam casar (AND). */
  if (exact + fuzzy < total) return { match: false, relevance: 0 };

  const coverage = totalWeight > 0 ? hitSum / totalWeight : 0;
  const exactRatio = exact / total;
  const missing = total - exact - fuzzy;

  let relevance: number;
  if (exact === total) {
    relevance = 780;
  } else if (exact + fuzzy === total) {
    relevance = 655;
  } else {
    const missPenalty = missing * 130;
    relevance = Math.round(70 + coverage * 420 + exactRatio * 140 - missPenalty);
    relevance = Math.max(35, Math.min(620, relevance));
  }

  relevance += proximityBonus(words, search);
  relevance += Math.min(55, densityBonus);
  relevance += usernameExactBonus(words, search);
  return { match: true, relevance: Math.min(relevance, 990) };
}

/** Busca livre (sem trechos entre aspas). */
function scoreFreeTextQuery(search: string, q: string): { match: boolean; relevance: number } {
  const qTrim = foldSearchText(q.trim());
  if (!qTrim) return { match: true, relevance: 0 };

  const words = tokenizeQueryWords(qTrim);
  if (words.length >= 2 && textContainsAdjacentPhrase(words, search)) {
    return { match: true, relevance: 1000 };
  }
  if (words.length >= 2 && textContainsPhraseAsTokens(qTrim, search)) {
    return scoreMultiWordQuery(words, search);
  }
  if (words.length === 1 && textContainsPhraseAsTokens(qTrim, search)) {
    return { match: true, relevance: 1000 };
  }

  if (words.length === 0) {
    if (qTrim.length >= MIN_TOKEN_LEN && isWholeTokenMatch(qTrim, search)) return { match: true, relevance: 500 };
    return { match: false, relevance: 0 };
  }

  if (words.length === 1) {
    const w = words[0]!;
    const hit = classifyWordInText(w, search);
    if (hit === 'exact') {
      const reps = Math.min(4, countExactTokenHits(w, search));
      const rel = 470 + reps * 14 + usernameExactBonus(words, search);
      return { match: true, relevance: Math.min(540, rel) };
    }
    if (hit === 'fuzzy') return { match: true, relevance: 395 };
    return { match: false, relevance: 0 };
  }

  return scoreMultiWordQuery(words, search);
}

/**
 * WHERE + score: trechos `"..."` são obrigatórios (frase exata adjacente); o restante também deve casar (busca livre).
 * `match === false` exclui o item — aspas não são critério de ordenação.
 */
export function scoreQueryMatch(searchableText: string, q: string): { match: boolean; relevance: number } {
  const parsed = parseSearchQuery(q);
  const search = foldSearchText(searchableText.trim());
  if (!search && (parsed.exactPhrases.length > 0 || parsed.remainder.trim())) {
    return { match: false, relevance: 0 };
  }
  if (!parsed.exactPhrases.length && !parsed.remainder.trim()) return { match: true, relevance: 0 };

  let relevance = 0;
  for (const phrase of parsed.exactPhrases) {
    const r = scoreExactPhraseQuery(foldSearchText(phrase.trim()), search);
    if (!r.match) return { match: false, relevance: 0 };
    relevance += r.relevance;
  }

  const rem = parsed.remainder.trim();
  if (!rem) {
    if (parsed.exactPhrases.length === 0) return { match: true, relevance: 0 };
    return { match: true, relevance: Math.round(relevance / parsed.exactPhrases.length) };
  }

  const free = scoreFreeTextQuery(search, rem);
  if (!free.match) return { match: false, relevance: 0 };
  return { match: true, relevance: relevance + free.relevance };
}

export function passesSearchWhere(searchableText: string, q: string): boolean {
  return scoreQueryMatch(searchableText, q).match;
}

/** Alias legado. */
export function matchesQuery(searchableText: string, q: string): { match: boolean; relevance: number } {
  return scoreQueryMatch(searchableText, q);
}

/** Combina score textual com rank FTS (desempate leve; texto domina o ranking). */
export function combineSearchRelevance(textRelevance: number, ftsRank: number | undefined): number {
  const text = Math.max(0, textRelevance);
  const fts = ftsRank != null && ftsRank > 0 ? ftsRank : 0;
  const ftsBoost = fts > 0 ? Math.min(48, Math.round(6 + Math.log2(fts + 1) * 7)) : 0;
  return text * 1000 + ftsBoost;
}

/** Mapa handle → rank decrescente a partir do resultado FTS (bm25 ASC). */
export function ftsRowsToRankMap(rows: { handle: string }[]): Map<string, number> {
  const map = new Map<string, number>();
  const n = rows.length;
  for (let i = 0; i < n; i++) {
    const h = rows[i]!.handle.toLowerCase().replace(/^@/, '');
    if (h) map.set(h, n - i);
  }
  return map;
}

/** Query com 2–5 palavras (nome de pessoa), sem @ ou hashtag. */
export function looksLikeInfluencerNameQuery(q: string): boolean {
  const raw = q.trim();
  if (!raw || raw.length > 80 || /[#@/]/.test(raw)) return false;
  if (/^[a-z0-9._]+$/i.test(raw.replace(/^@/, '')) && !raw.includes(' ')) return false;
  const words = tokenizeQueryWords(foldSearchText(raw.replace(/\./g, ' ')));
  if (words.length < 2 || words.length > 5) return false;
  return words.every((w) => /^[a-z0-9_]+$/.test(w));
}

/**
 * Pré-filtro FTS para nomes: interseção de handles que contêm **cada** token no índice.
 * Evita perder "Lane Esfeckm" quando OR/AND amplos não ranqueiam o perfil (ex.: token "lane" comum).
 */
export function ftsIntersectRankMapForNameLikeQuery(
  q: string,
  searchFts: (matchExpr: string, limit: number) => { handle: string }[]
): Map<string, number> {
  const words = tokenizeQueryWords(foldSearchText(q.trim().replace(/\./g, ' ')));
  if (words.length < 2) return new Map();

  const byRarity = [...words].sort((a, b) => b.length - a.length || a.localeCompare(b));
  let intersect: Set<string> | null = null;
  const rankAcc = new Map<string, number>();

  for (const w of byRarity) {
    const lim = w.length >= 7 ? 600 : w.length >= 5 ? 1200 : 3000;
    const rows = searchFts(escapeFtsToken(w), lim);
    const set = new Set<string>();
    const n = rows.length;
    for (let i = 0; i < n; i++) {
      const h = rows[i]!.handle.toLowerCase().replace(/^@/, '');
      if (!h) continue;
      set.add(h);
      rankAcc.set(h, (rankAcc.get(h) ?? 0) + (n - i));
    }
    if (intersect === null) intersect = set;
    else {
      const next = new Set<string>();
      for (const h of intersect) {
        if (set.has(h)) next.add(h);
      }
      intersect = next;
    }
    if (intersect.size === 0) return new Map();
  }

  if (!intersect || intersect.size === 0) return new Map();
  const out = new Map<string, number>();
  const sorted = [...intersect].sort((a, b) => (rankAcc.get(b) ?? 0) - (rankAcc.get(a) ?? 0));
  let rank = sorted.length;
  for (const h of sorted) {
    out.set(h, rank--);
  }
  return out;
}

/** Une resultados de várias queries FTS; mantém o melhor rank por handle. */
export function mergeFtsRankMaps(maps: Map<string, number>[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of maps) {
    for (const [h, r] of m) {
      const prev = out.get(h);
      if (prev == null || r > prev) out.set(h, r);
    }
  }
  return out;
}
