/**
 * Ponto de entrada para uso programático.
 * estimatePayloadSize é usado pelo storage antes de salvar; exportado para uso externo.
 */
export { estimatePayloadSize, ensureWithinLimit } from './utils/estimatePayloadSize.js';
export { InstagramClient } from './instagramClient/index.js';
export { discoverProfilesByHashtag, discoverProfilesByLocation } from './discoveryService/index.js';
export { extractProfile } from './profileExtractor/index.js';
export { StorageAdapter } from './storage/index.js';
export type { ExtractedProfile, Address, CrawlConfig, DiscoveredBy } from './types/index.js';
export { DEFAULT_CRAWL_CONFIG } from './types/index.js';
