import type { ProfilesSearchQuery } from '../api'

/**
 * Rotas que usam o wizard de busca e compartilham o mesmo default de `llmProfileType`
 * (valores do qualify: criador + pessoal quando a URL não especifica).
 */
export const DISCOVERY_LLM_PROFILE_TYPE_PATHS = ['/app/campaigns/create', '/'] as const

const DISCOVERY_PATH_SET = new Set<string>(DISCOVERY_LLM_PROFILE_TYPE_PATHS)

/** Default quando `llmProfileType` não vem na URL (nem alias reconhecido). */
export const DISCOVERY_DEFAULT_LLM_PROFILE_TYPES = ['criador', 'pessoal'] as const

type DiscoveryCanonicalLlmProfileType = (typeof DISCOVERY_DEFAULT_LLM_PROFILE_TYPES)[number]

const LLM_PROFILE_TYPE_TO_CANONICAL: Record<string, DiscoveryCanonicalLlmProfileType> = {
  criador: 'criador',
  pessoal: 'pessoal',
  creator: 'criador',
  personal: 'pessoal',
}

export function usesDiscoveryDefaultLlmProfileType(pathname: string): boolean {
  return DISCOVERY_PATH_SET.has(pathname)
}

/** Em rotas discovery: normaliza aliases e aplica default criador+pessoal se vazio. */
export function withDiscoveryDefaultLlmProfileTypeQuery(
  pathname: string,
  q: ProfilesSearchQuery
): ProfilesSearchQuery {
  if (!usesDiscoveryDefaultLlmProfileType(pathname)) return q
  const picked = new Set<DiscoveryCanonicalLlmProfileType>()
  for (const raw of q.llmProfileType ?? []) {
    const c = LLM_PROFILE_TYPE_TO_CANONICAL[raw.trim().toLowerCase()]
    if (c) picked.add(c)
  }
  const llmProfileType =
    picked.size > 0 ? [...picked] : [...DISCOVERY_DEFAULT_LLM_PROFILE_TYPES]
  return { ...q, llmProfileType }
}
