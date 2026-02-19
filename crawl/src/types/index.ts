/** Entidade dinâmica: qualquer objeto com pelo menos `handle` para perfis. Sem normalização. */
export type Entity = Record<string, unknown>;

export type DiscoveredBy = 'hashtag' | 'location' | 'seed' | 'explore' | 'engagement' | 'feed';

export interface CrawlConfig {
  maxPostsPerTag: number;
  maxProfiles: number;
  headless: boolean;
  authStatePath: string;
  randomDelayMinMs: number;
  randomDelayMaxMs: number;
  maxRetries: number;
  nodeMaxBytes: number;
  bioMaxChars: number;
  addressRawTextMaxChars: number;
  /** Só gravar perfis com pelo menos este número de seguidores (0 = desligado) */
  minFollowersToSave: number;
  /** Cada post considerado deve ter pelo menos este número de curtidas (ex.: 200). 0 = desligado. */
  minPostLikesToSave: number;
  /** Quantidade mínima de posts que devem ter >= minPostLikesToSave (ex.: 4 = mais de 3 posts com 200 likes). */
  minPostsWithMinLikesToSave: number;
  /** Se true, não grava perfis de negócio (foco em influenciadores) */
  excludeBusinessProfiles: boolean;
  /** @deprecated Regra de perfil brasileiro removida; mantido no tipo para compatibilidade. */
  saveOnlyBrazilian?: boolean;
  /** Quantos posts do perfil analisar para extrair hashtags/localidades */
  maxPostsToAnalyzeForInsights: number;
}

export const DEFAULT_CRAWL_CONFIG: CrawlConfig = {
  maxPostsPerTag: 30,
  maxProfiles: 100,
  headless: true,
  authStatePath: 'data/instagram-auth.json',
  randomDelayMinMs: 2000,
  randomDelayMaxMs: 6000,
  maxRetries: 2,
  nodeMaxBytes: 1024 * 1024, // 1MB
  bioMaxChars: 500,
  addressRawTextMaxChars: 300,
  minFollowersToSave: 5000,
  minPostLikesToSave: 200,
  minPostsWithMinLikesToSave: 4,
  excludeBusinessProfiles: true,
  saveOnlyBrazilian: false,
  maxPostsToAnalyzeForInsights: 10,
};
