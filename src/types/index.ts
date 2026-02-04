/** Perfil normalizado — armazenado em node/documento ≤1MB */

export interface Address {
  street: string | null;
  number: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  raw_text: string | null;
}

export type DiscoveredBy = 'hashtag' | 'location' | 'seed' | 'explore' | 'engagement';

/** Insights extraídos dos posts do perfil (hashtags, localidades, categorias inferidas) */
export interface PostInsights {
  /** Hashtags usados nos posts (ex.: #tatuapé #sp) */
  hashtags: string[];
  /** Localidades mencionadas em legendas (bairros, cidades, ex.: Tatuapé, São Paulo) */
  locations_mentioned: string[];
  /** Categorias inferidas das hashtags e do texto para qualificar o influenciador (ex.: Beleza, Fitness) */
  inferred_categories: string[];
}

/** Um post extraído do perfil para armazenar na tabela posts + hashtags normalizadas */
export interface ExtractedPost {
  post_url: string;
  shortcode: string;
  media_url: string | null;
  media_type: 'image' | 'video';
  likes_count: number | null;
  comments_count: number | null;
  caption: string | null;
  hashtags: string[];
}

export interface ExtractedProfile {
  platform: 'instagram';
  handle: string;
  profile_url: string;
  /** URL da imagem de perfil (avatar) */
  profile_image_url: string | null;
  display_name: string | null;
  bio: string | null;
  website: string | null;
  followers: number | null;
  following: number | null;
  posts_count: number | null;
  is_verified: boolean;
  is_business: boolean;
  category: string | null;
  address: Address;
  public_email: string | null;
  public_phone: string | null;
  /** Hashtags e localidades extraídos das legendas dos posts (categorização) */
  post_insights: PostInsights | null;
  discovered_by: DiscoveredBy;
  discovered_value: string;
  collected_at: string; // ISO date
}

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
  minFollowersToSave: 10000,
  excludeBusinessProfiles: true,
  maxPostsToAnalyzeForInsights: 10,
};
