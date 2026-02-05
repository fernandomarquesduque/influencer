/** Entidade dinâmica: qualquer objeto com pelo menos `handle` para perfis. Sem normalização. */
export type Entity = Record<string, unknown>;

export type DiscoveredBy = 'hashtag' | 'location' | 'seed' | 'explore' | 'engagement';

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
  /** Se true, não grava perfis de negócio (foco em influenciadores) */
  excludeBusinessProfiles: boolean;
  /** Quantos posts do perfil analisar para extrair hashtags/localidades */
  maxPostsToAnalyzeForInsights: number;
}

export const DEFAULT_CRAWL_CONFIG: CrawlConfig = {
  maxPostsPerTag: 30,
  maxProfiles: 100,
  headless: true,
  authStatePath: '.auth/instagram.json',
  randomDelayMinMs: 2000,
  randomDelayMaxMs: 6000,
  maxRetries: 2,
  nodeMaxBytes: 1024 * 1024, // 1MB
  bioMaxChars: 500,
  addressRawTextMaxChars: 300,
  minFollowersToSave: 5000,
  excludeBusinessProfiles: true,
  maxPostsToAnalyzeForInsights: 10,
};
