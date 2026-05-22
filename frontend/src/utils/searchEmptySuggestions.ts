export type SearchEmptySuggestionItem = {
  label: string
}

const DEFAULT_ITEMS: SearchEmptySuggestionItem[] = [
  { label: 'Gastronomia' },
  { label: 'Receitas' },
  { label: 'Comida' },
  { label: 'Moda' },
  { label: 'Beleza' },
  { label: 'Fitness' },
]

const POPULAR_SEARCHES = ['Moda', 'Beleza', 'Fitness', 'Viagem', 'Gastronomia', 'Maternidade'] as const

const NICHE_TERMS: Record<string, string[]> = {
  moda: ['Moda', 'look do dia', 'estilo'],
  beleza: ['Beleza', 'skincare', 'maquiagem'],
  fitness: ['Fitness', 'treino', 'academia'],
  viagem: ['Viagem', 'turismo', 'destinos'],
  gastronomia: ['Gastronomia', 'Receitas', 'Comida'],
  maternidade: ['Maternidade', 'família', 'bebê'],
  lifestyle: ['Lifestyle', 'rotina', 'bem-estar'],
  skincare: ['Skincare', 'pele', 'autocuidado'],
}

function normalizeForMatch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
}

function nicheKeyFromQuery(q: string): string | null {
  const n = normalizeForMatch(q)
  if (!n) return null
  for (const [key, terms] of Object.entries(NICHE_TERMS)) {
    if (key.startsWith(n) || n.startsWith(key)) return key
    if (terms.some((t) => normalizeForMatch(t).startsWith(n) || n.startsWith(normalizeForMatch(t)))) return key
  }
  return null
}

/** Sugestões clicáveis para estado vazio da busca em posts. */
export function getSearchEmptySuggestionItems(query: string, max = 6): SearchEmptySuggestionItem[] {
  const q = query.trim()
  const seen = new Set<string>()
  const out: SearchEmptySuggestionItem[] = []

  const push = (label: string) => {
    const t = label.trim()
    if (!t || t.length < 2) return
    const key = normalizeForMatch(t)
    if (key === normalizeForMatch(q)) return
    if (seen.has(key)) return
    seen.add(key)
    out.push({ label: t.charAt(0).toUpperCase() + t.slice(1) })
  }

  const niche = nicheKeyFromQuery(q)
  if (niche && NICHE_TERMS[niche]) {
    for (const term of NICHE_TERMS[niche]) push(term)
  }

  for (const p of DEFAULT_ITEMS) push(p.label)
  for (const p of POPULAR_SEARCHES) push(p)

  if (out.length >= max) return out.slice(0, max)
  return out.length > 0 ? out.slice(0, max) : DEFAULT_ITEMS.slice(0, max)
}

/** @deprecated use getSearchEmptySuggestionItems */
export function getSearchEmptySuggestions(query: string, max = 6): string[] {
  return getSearchEmptySuggestionItems(query, max).map((x) => x.label)
}
