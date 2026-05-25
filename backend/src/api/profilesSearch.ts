/**
 * Listagem de perfis com filtros avançados e cálculo de engajamento
 * baseado nos posts (likes, comentários, views).
 */

import type { CompositeStorage } from '../storage/compositeStorage.js';
import { logMemorySnapshot } from '../utils/memoryDiag.js';
import type { ProfileActivationData, AuxNumericFacetAggregate, GlobalAuxSqlLlmFilter, GlobalAuxSqlFilter } from '../storage/sqliteSync.js';
import { SqliteSync } from '../storage/sqliteSync.js';
import { computeInstagramBi, type InstagramBi, type PostForBi } from '../utils/instagramBi.js';
import {
  getCostTierFromPricing,
  getSuggestedPricingFromFollowers,
  getFollowersFromProfile,
  type CostTier,
} from '../utils/suggestedPricing.js';
import {
  followersCountToSizeKey,
  createEmptyFollowersBucketsForFacets,
  incrementFollowersBucketCount,
  FOLLOWERS_SIZE_BUCKETS,
} from './followersSizeBuckets.js';
import { snapMainCategoryToTaxonomy } from '../lib/mainCategoryTaxonomy.js';
import { getFollowersFromEntity } from '../utils/entityAccess.js';
import { estimateFollowersFromPosts, resolveFollowersCountForProfile } from '../utils/followersResolve.js';
import { searchHandlesViaMeilisearch, buildMeilisearchFilterExpr } from '../search/meilisearchProfile.js';
import {
  matchesQuery,
  combineSearchRelevance,
  userQueryToFtsMatchExpression,
  userQueryToFtsMatchExpressions,
  ftsRowsToRankMap,
  mergeFtsRankMaps,
  foldSearchText,
} from '../search/queryRelevance.js';

export {
  matchesQuery,
  scoreQueryMatch,
  userQueryToFtsMatchExpression,
  combineSearchRelevance,
  tokenizeQueryWords,
  foldSearchText,
  ftsRowsToRankMap,
  userQueryToFtsMatchExpressions,
  mergeFtsRankMaps,
} from '../search/queryRelevance.js';

/**
 * Cache em memória só dos perfis (RocksDB). Posts não entram no heap: engajamento/hashtags vêm do SQLite
 * (`profile_search_aux`) e texto de busca do FTS; BI da página carrega posts só dos handles retornados.
 */
let searchDataCache: {
  profilesRaw: { key: string; value: Record<string, unknown> }[];
} | null = null;

/**
 * Geração do cache: só a carga cuja geração ainda é a atual aplica resultado.
 * Evita que um rewarm antigo (ex.: antes do último save) sobrescreva dados novos.
 */
let searchCacheGeneration = 0;

/** Carrega só perfis do storage (reaquecimento em background). */
async function loadSearchCacheData(db: CompositeStorage): Promise<{
  profilesRaw: { key: string; value: Record<string, unknown> }[];
}> {
  const profilesRaw = await db.getByBucket<Record<string, unknown>>('profile');
  return { profilesRaw };
}

function applySearchCacheIfCurrent(
  gen: number,
  data: { profilesRaw: { key: string; value: Record<string, unknown> }[] }
): void {
  if (gen === searchCacheGeneration) {
    searchDataCache = data;
  }
}

/** Só uma leitura full profile+post por vez — evita N loads em paralelo após save+savePosts+vários saveMedia (OOM). */
let searchCacheRewarmInFlight = false;
let searchCacheRewarmPending = false;

function runSearchCacheRewarmPass(db: CompositeStorage): void {
  searchCacheRewarmInFlight = true;
  const gen = ++searchCacheGeneration;
  void loadSearchCacheData(db)
    .then((data) => applySearchCacheIfCurrent(gen, data))
    .catch((err) => console.warn('[search-cache] rewarm falhou:', err))
    .finally(() => {
      searchCacheRewarmInFlight = false;
      if (searchCacheRewarmPending) {
        searchCacheRewarmPending = false;
        runSearchCacheRewarmPass(db);
      }
    });
}

/**
 * Agenda reaquecimento do cache em background.
 * Chamadas em rajada (ex.: refresh — 1× save + 1× savePosts + 3× saveMedia) viram no máximo 2 passadas sequenciais,
 * nunca várias Promise.all(profile+post) simultâneas. Substitui o snapshot só quando a nova leitura termina.
 */
export function scheduleSearchCacheRewarm(db: CompositeStorage): void {
  if (searchCacheRewarmInFlight) {
    searchCacheRewarmPending = true;
    return;
  }
  runSearchCacheRewarmPass(db);
}

/** Evita N rewarms seguidos ao fim de cada extração na fila (só um após a rajada). */
let searchCacheRewarmDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const SEARCH_CACHE_REWARM_DEBOUNCE_MS = Math.max(
  5_000,
  Number(process.env.SEARCH_CACHE_REWARM_DEBOUNCE_MS) || 25_000
);

export function scheduleSearchCacheRewarmDebounced(db: CompositeStorage): void {
  if (searchCacheRewarmDebounceTimer) clearTimeout(searchCacheRewarmDebounceTimer);
  searchCacheRewarmDebounceTimer = setTimeout(() => {
    searchCacheRewarmDebounceTimer = null;
    scheduleSearchCacheRewarm(db);
  }, SEARCH_CACHE_REWARM_DEBOUNCE_MS);
}

/** Invalidação forte: esvazia o cache (próxima busca lê do RocksDB e repovoa). Uso pontual; reaquecimento após save usa scheduleSearchCacheRewarm. */
export function clearSearchCache(): void {
  searchCacheGeneration += 1;
  searchDataCache = null;
}

/** Aquece o cache carregando perfis e posts do storage. Chamar na subida da API para a 1ª busca já ser rápida. */
export async function warmSearchCache(db: CompositeStorage): Promise<void> {
  const gen = ++searchCacheGeneration;
  searchDataCache = null;
  logMemorySnapshot('search-cache: antes de ler profile+post do disco');
  const data = await loadSearchCacheData(db);
  applySearchCacheIfCurrent(gen, data);
  logMemorySnapshot('search-cache: snapshot em RAM aplicado (só perfis)', {
    profiles_n: data.profilesRaw.length,
  });
}

function collectLevelCodes(err: unknown): Set<string> {
  const out = new Set<string>();
  let cur: unknown = err;
  let depth = 0;
  while (cur != null && depth++ < 8) {
    if (typeof cur === 'object' && cur !== null && 'code' in cur) {
      const c = (cur as { code?: unknown }).code;
      if (typeof c === 'string' && c) out.add(c);
    }
    cur = cur instanceof Error ? cur.cause : null;
  }
  return out;
}

/** Erro ao ler o Level/RocksDB por lock ou DB não aberto — outro processo pode estar usando o mesmo caminho. */
export function isSearchCacheWarmBlockedError(err: unknown): boolean {
  const codes = collectLevelCodes(err);
  return codes.has('LEVEL_LOCKED') || codes.has('LEVEL_DATABASE_NOT_OPEN');
}

let searchCacheWarmRetryTimer: ReturnType<typeof setInterval> | null = null;
let searchCacheWarmRetryInFlight = false;

/**
 * Quando o aquecimento na subida falha por lock, agenda tentativas até o banco liberar.
 * Assim a busca volta a usar RAM cheia sem exigir que o usuário espere o “1º hit” lento ao disco.
 */
export function scheduleSearchCacheWarmRetries(db: CompositeStorage): void {
  if (searchCacheWarmRetryTimer != null) return;

  const intervalMsRaw = parseInt(process.env.SEARCH_CACHE_WARM_RETRY_MS ?? '2500', 10);
  const intervalMs = Number.isFinite(intervalMsRaw) ? Math.max(500, intervalMsRaw) : 2500;

  const tryOnce = async (): Promise<'ok' | 'retry' | 'abort'> => {
    if (searchCacheWarmRetryInFlight) return 'retry';
    searchCacheWarmRetryInFlight = true;
    try {
      await warmSearchCache(db);
      return 'ok';
    } catch (err) {
      if (isSearchCacheWarmBlockedError(err)) return 'retry';
      console.warn('[search-cache] Aquecimento em background interrompido (erro não é lock):', err);
      return 'abort';
    } finally {
      searchCacheWarmRetryInFlight = false;
    }
  };

  const stopTimer = (): void => {
    if (searchCacheWarmRetryTimer != null) {
      clearInterval(searchCacheWarmRetryTimer);
      searchCacheWarmRetryTimer = null;
    }
  };

  const tick = async (): Promise<void> => {
    const r = await tryOnce();
    if (r === 'ok') {
      stopTimer();
      console.log('[search-cache] Cache aquecido em background — buscas usam snapshot em RAM.');
    } else if (r === 'abort') {
      stopTimer();
    }
  };

  console.log(
    `[search-cache] Lock no RocksDB no startup; reaquecendo a cada ${intervalMs}ms até o banco liberar (feche o outro processo que usa o mesmo STORAGE_DB_PATH).`,
  );
  void tick();
  searchCacheWarmRetryTimer = setInterval(() => {
    void tick();
  }, intervalMs);
}

function getIn(obj: unknown, ...paths: string[]): unknown {
  if (obj == null) return undefined;
  for (const path of paths) {
    const parts = path.split('.');
    let current: unknown = obj;
    for (const p of parts) {
      if (current == null || typeof current !== 'object') break;
      current = (current as Record<string, unknown>)[p];
    }
    if (current !== undefined && current !== null) return current;
  }
  return undefined;
}

function toNum(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.floor(v);
  if (typeof v === 'string') {
    const n = parseInt(v.replace(/\D/g, ''), 10);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

/** Extrai data.user do perfil (formato da API do Instagram). */
function getDataUser(profile: Record<string, unknown>): Record<string, unknown> | undefined {
  const data = profile['data'];
  if (data == null || typeof data !== 'object') return undefined;
  const user = (data as Record<string, unknown>)['user'];
  return (user != null && typeof user === 'object') ? (user as Record<string, unknown>) : undefined;
}

/** Extrai seguidores do perfil (vários formatos da API). */
function getFollowers(profile: Record<string, unknown>): number {
  const fromEntity = getFollowersFromEntity(profile);
  if (fromEntity > 0) return fromEntity;
  const fromPaths = getIn(
    profile,
    'followers_count',
    'follower_count',
    'data.user.follower_count',
    'data.user.edge_followed_by.count',
    'data.xdt_api__v1__feed__user_timeline_graphql_connection.feed_user.follower_count',
    'data.xdt_api__v1__feed__user_timeline_graphql_connection.feed_user.edge_followed_by.count',
    'graphql.user.edge_followed_by.count'
  );
  if (fromPaths !== undefined && fromPaths !== null) return toNum(fromPaths);
  const user = getDataUser(profile);
  if (user?.follower_count != null) return toNum(user.follower_count);
  const edge = user?.edge_followed_by as { count?: number } | undefined;
  return toNum(edge?.count);
}

/** Extrai handle do perfil. */
function getHandle(profile: Record<string, unknown>, key: string): string {
  const h = profile.handle ?? profile.username ?? getDataUser(profile)?.username ?? key;
  return String(h ?? key).toLowerCase().replace(/^@/, '');
}

/** Extrai nome completo. */
function getFullName(profile: Record<string, unknown>): string {
  const u = getDataUser(profile);
  return String(profile.full_name ?? u?.full_name ?? '');
}

/** Extrai categorias (array de strings). */
function getCategories(profile: Record<string, unknown>): string[] {
  const c = profile.categories;
  if (Array.isArray(c)) return c.filter((x): x is string => typeof x === 'string');
  const u = getDataUser(profile);
  const cat = u?.category ?? u?.account_type;
  if (typeof cat === 'string') return [cat];
  return [];
}

/** Extrai biografia. */
function getBiography(profile: Record<string, unknown>): string {
  const b = profile.biography ?? getDataUser(profile)?.biography;
  return typeof b === 'string' ? b : '';
}

/** Extrai is_private do perfil. */
function getIsPrivate(profile: Record<string, unknown>): boolean {
  const v = profile.is_private ?? getIn(profile, 'data.user.is_private');
  return v === true;
}

/** Extrai account_type do perfil (1=pessoal, 2=criador, 3=empresa). */
function getAccountType(profile: Record<string, unknown>): number | undefined {
  const v = profile.account_type ?? getIn(profile, 'data.user.account_type');
  return toNum(v) || undefined;
}

/** `qualification` do LLM quando a classificação terminou com sucesso (`status === "done"`). */
export function getLlmQualification(record: Record<string, unknown>): Record<string, unknown> | null {
  const llm = record.llm;
  if (llm == null || typeof llm !== 'object' || Array.isArray(llm)) return null;
  const lo = llm as Record<string, unknown>;
  const status = String(lo.status ?? '').trim().toLowerCase();
  if (status !== 'done') return null;
  const q = lo.qualification;
  if (q == null || typeof q !== 'object' || Array.isArray(q)) return null;
  return q as Record<string, unknown>;
}

export function hasCompletedLlmProfile(record: Record<string, unknown>): boolean {
  const q = getLlmQualification(record);
  return q != null && Object.keys(q).length > 0;
}

function bumpFacetString(map: Map<string, number>, raw: string): void {
  const k = raw.trim().toLowerCase();
  if (!k) return;
  map.set(k, (map.get(k) ?? 0) + 1);
}

/** Agrega mainCategory por rótulo canônico ou texto bruto quando o snap não encaixa (igual ao endpoint collector). */
function bumpFacetMainCategory(map: Map<string, number>, raw: string): void {
  const t = String(raw ?? '').trim();
  if (!t) return;
  const c = snapMainCategoryToTaxonomy(t) ?? t;
  map.set(c, (map.get(c) ?? 0) + 1);
}

function bumpFacetStringArray(map: Map<string, number>, arr: unknown): void {
  if (!Array.isArray(arr)) return;
  for (const x of arr) {
    if (typeof x === 'string' && x.trim()) bumpFacetString(map, x);
  }
}

export type ProfilePostSentimentSummary = 'positivo' | 'negativo' | 'misto';

/** Agrega sentimento dos posts (`post.llm.sentiment`) em rótulo por perfil para facetas/filtro. */
export function computeProfilePostSentimentFromPosts(
  posts: Record<string, unknown>[]
): ProfilePostSentimentSummary | null {
  let pos = 0;
  let neg = 0;
  for (const p of posts) {
    const llm = p.llm;
    if (llm == null || typeof llm !== 'object' || Array.isArray(llm)) continue;
    const s = String((llm as Record<string, unknown>).sentiment ?? '')
      .trim()
      .toLowerCase();
    if (s === 'positivo' || s === 'positive' || s === 'pos') pos++;
    else if (s === 'negativo' || s === 'negative' || s === 'neg') neg++;
  }
  if (pos === 0 && neg === 0) return null;
  if (pos > neg) return 'positivo';
  if (neg > pos) return 'negativo';
  return 'misto';
}

interface LlmFacetMaps {
  profileType: Map<string, number>;
  mainCategory: Map<string, number>;
  gender: Map<string, number>;
  language: Map<string, number>;
  audienceType: Map<string, number>;
  toneOfVoice: Map<string, number>;
  brandSafetyLevel: Map<string, number>;
  postSentiment: Map<string, number>;
}

function createEmptyLlmFacetMaps(): LlmFacetMaps {
  return {
    profileType: new Map(),
    mainCategory: new Map(),
    gender: new Map(),
    language: new Map(),
    audienceType: new Map(),
    toneOfVoice: new Map(),
    brandSafetyLevel: new Map(),
    postSentiment: new Map(),
  };
}

function mapToNameCountDesc(m: Map<string, number>): { name: string; count: number }[] {
  return [...m.entries()]
    .filter(([, count]) => count > 0)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

export function normalizeBrandSafetyLevel(brandSafety: unknown): 'adulto' | 'sensivel' | 'familia' | null {
  if (typeof brandSafety === 'string') {
    const v = brandSafety.trim().toLowerCase();
    if (v === 'adulto' || v === 'sensivel' || v === 'familia') return v;
    return null;
  }
  if (brandSafety == null || typeof brandSafety !== 'object' || Array.isArray(brandSafety)) return null;
  const b = brandSafety as Record<string, unknown>;
  const risk = String(b.riskLevel ?? '').trim().toLowerCase();
  if (risk === 'low') return 'familia';
  if (risk === 'medium') return 'sensivel';
  if (risk === 'high') return 'adulto';
  if (b.isAdultContent === true) return 'adulto';
  if (b.isFamilySafe === true) return 'familia';
  return null;
}

function accumulateLlmFacetsFromItem(item: ProfileListItem, maps: LlmFacetMaps): void {
  const q = getLlmQualification(item as unknown as Record<string, unknown>);
  if (q) {
    bumpFacetString(maps.profileType, String(q.profileType ?? ''));
    bumpFacetMainCategory(maps.mainCategory, String(q.mainCategory ?? ''));
    bumpFacetString(maps.gender, String(q.gender ?? ''));
    bumpFacetString(maps.language, String(q.language ?? ''));
    bumpFacetStringArray(maps.audienceType, q.audienceType);
    bumpFacetStringArray(maps.toneOfVoice, q.toneOfVoice);
    const brandSafetyLevel = normalizeBrandSafetyLevel(q.brandSafety);
    if (brandSafetyLevel) bumpFacetString(maps.brandSafetyLevel, brandSafetyLevel);
  }
  const ps = String((item as Record<string, unknown>).llm_post_sentiment ?? '').trim().toLowerCase();
  if (ps === 'positivo' || ps === 'negativo' || ps === 'misto') {
    bumpFacetString(maps.postSentiment, ps);
  }
}

function mapsToLlmSearchFacets(maps: LlmFacetMaps): LlmSearchFacets {
  return {
    profileType: mapToNameCountDesc(maps.profileType),
    mainCategory: mapToNameCountDesc(maps.mainCategory),
    gender: mapToNameCountDesc(maps.gender),
    language: mapToNameCountDesc(maps.language),
    audienceType: mapToNameCountDesc(maps.audienceType),
    toneOfVoice: mapToNameCountDesc(maps.toneOfVoice),
    brandSafety: {
      level: mapToNameCountDesc(maps.brandSafetyLevel),
    },
    postSentiment: mapToNameCountDesc(maps.postSentiment),
  };
}

function emptyLlmSearchFacets(): LlmSearchFacets {
  return mapsToLlmSearchFacets(createEmptyLlmFacetMaps());
}

/** Inclui termos da qualificação LLM no texto pesquisável (a busca textual bate em mainCategory, pilares etc.). */
function addLlmQualificationSearchParts(record: Record<string, unknown>, parts: string[]): void {
  const q = getLlmQualification(record);
  if (!q) return;
  for (const key of ['profileType', 'mainCategory', 'gender', 'language'] as const) {
    const v = q[key];
    if (typeof v === 'string' && v.trim()) parts.push(v.trim());
  }
  for (const key of ['audienceType', 'toneOfVoice'] as const) {
    const arr = q[key];
    if (!Array.isArray(arr)) continue;
    for (const x of arr) {
      if (typeof x === 'string' && x.trim()) parts.push(x.trim());
    }
  }
  const ps = String(q.personaSummary ?? '').trim();
  if (ps) parts.push(ps);
  const brandSafetyLevel = normalizeBrandSafetyLevel(q.brandSafety);
  if (brandSafetyLevel) parts.push(brandSafetyLevel);
}

/** Extrai hashtags do texto (ex.: "#curiosidade #viagem" → ["curiosidade", "viagem"]). */
function extractHashtagsFromText(text: string | undefined): string[] {
  if (text == null || text.length === 0) return [];
  const matches = text.match(/#[\w\u00C0-\u024F]+/g);
  if (!matches) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of matches) {
    const tag = m.slice(1).toLowerCase();
    if (!seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  }
  return out;
}

/** Extrai hashtags de qualquer string dentro de um objeto (fallback). */
function extractHashtagsFromObject(obj: unknown, maxDepth = 5): string[] {
  if (maxDepth <= 0) return [];
  const set = new Set<string>();
  function walk(o: unknown, depth: number): void {
    if (depth <= 0) return;
    if (typeof o === 'string') {
      for (const tag of extractHashtagsFromText(o)) set.add(tag);
      return;
    }
    if (o != null && typeof o === 'object') {
      for (const v of Object.values(o)) walk(v, depth - 1);
    }
  }
  walk(obj, maxDepth);
  return [...set];
}

/** Extrai hashtags de um post: content.hashtags, caption_text, caption.text, edge_media_to_caption ou varredura no objeto. */
function getPostHashtags(post: Record<string, unknown>): string[] {
  const content = post.content as Record<string, unknown> | undefined;
  const fromArray = content?.hashtags;
  if (Array.isArray(fromArray) && fromArray.length > 0) {
    const out: string[] = [];
    for (const h of fromArray) {
      if (typeof h === 'string') {
        const tag = h.replace(/^#/, '').trim().toLowerCase();
        if (tag) out.push(tag);
      }
    }
    if (out.length > 0) return out;
  }
  const captionText =
    content?.caption_text ??
    (post as { caption_text?: string }).caption_text ??
    (() => {
      const cap = (post.caption ?? content?.caption) as Record<string, unknown> | undefined;
      return cap && typeof cap.text === 'string' ? (cap.text as string) : undefined;
    })();
  if (typeof captionText === 'string') return extractHashtagsFromText(captionText);
  const edgeCaption = post.edge_media_to_caption as { edges?: Array<{ node?: { text?: string } }> } | undefined;
  const edgeText = edgeCaption?.edges?.[0]?.node?.text;
  if (typeof edgeText === 'string') return extractHashtagsFromText(edgeText);
  return extractHashtagsFromObject(post);
}

/** Coleta todas as hashtags únicas dos posts do perfil. */
function getAllHashtagsFromPosts(posts: Record<string, unknown>[]): string[] {
  const set = new Set<string>();
  for (const p of posts) {
    for (const tag of getPostHashtags(p)) set.add(tag);
  }
  return [...set].sort();
}

/** Trecho de handle Instagram para regex (1–30 caracteres, evita casar e-mail). */
const IG_MENTION_HANDLE_BODY = '[a-zA-Z0-9](?:[a-zA-Z0-9._]{0,28}[a-zA-Z0-9])?';

/**
 * Extrai handles a partir de texto (legendas etc.). Normaliza em minúsculas.
 * Não captura `usuario@dominio.com`: exige que o caractere antes de `@` não seja alfanumérico/ponto/underscore.
 */
export function extractMentionHandlesFromText(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  const re = new RegExp(`(?:^|[^a-zA-Z0-9._])@(${IG_MENTION_HANDLE_BODY})`, 'gi');
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    const h = m[1]!.toLowerCase();
    if (h.length < 1 || h.length > 30) continue;
    if (!seen.has(h)) {
      seen.add(h);
      out.push(h);
    }
  }
  return out;
}

/** Texto onde costumam aparecer @menções: legenda, acessibilidade, artista do áudio. */
export function getPostMentionSourceText(post: Record<string, unknown>): string {
  const base = getPostTextForSearch(post);
  const parts: string[] = [];
  if (base.trim()) parts.push(base.trim());
  const content = post.content as Record<string, unknown> | undefined;
  const acc = content?.accessibility_caption;
  if (typeof acc === 'string' && acc.trim()) parts.push(acc.trim());
  const audio = content?.audio as Record<string, unknown> | undefined;
  const igArtist = audio?.ig_artist_username;
  if (typeof igArtist === 'string' && igArtist.trim()) parts.push(igArtist.trim());
  return parts.join('\n');
}

/** Handles únicos citados com @ neste item do bucket `post` (formato normalizado). */
export function collectMentionHandlesFromPostItem(item: Record<string, unknown>): string[] {
  return extractMentionHandlesFromText(getPostMentionSourceText(item));
}

/** Extrai de um post: caption/descrição e hashtags para busca (todas as fontes de texto). */
function getPostTextForSearch(post: Record<string, unknown>): string {
  const parts: string[] = [];
  const content = post.content as Record<string, unknown> | undefined;
  const captionText =
    content?.caption_text ??
    (post as { caption_text?: string }).caption_text ??
    (() => {
      const cap = (post.caption ?? content?.caption) as Record<string, unknown> | undefined;
      return cap && typeof cap.text === 'string' ? (cap.text as string) : undefined;
    })();
  if (typeof captionText === 'string' && captionText.trim()) parts.push(captionText.trim());
  const edgeCaption = post.edge_media_to_caption as { edges?: Array<{ node?: { text?: string } }> } | undefined;
  const edgeText = edgeCaption?.edges?.[0]?.node?.text;
  if (typeof edgeText === 'string' && edgeText.trim()) parts.push(edgeText.trim());
  const hashtags = content?.hashtags;
  if (Array.isArray(hashtags)) {
    for (const h of hashtags) {
      if (typeof h === 'string') parts.push(h.replace(/^#/, '').trim());
    }
  }
  return parts.join(' ');
}

/** Texto do post normalizado (minúsculas) para aplicar `matchesQuery` (ex.: origem na campanha). */
export function getPostSearchableNormalized(post: Record<string, unknown>): string {
  return foldSearchText(getPostTextForSearch(post));
}

/** Máximo de posts usados para montar o texto pesquisável (evita custo com perfis com muitos posts). */
const MAX_POSTS_FOR_SEARCH = 30;

/** Monta um único texto pesquisável do perfil + posts (handle, nome, bio, categorias, hashtags, legendas, links e onde houver texto). */
function getSearchableText(
  profile: Record<string, unknown>,
  key: string,
  fullName: string,
  categories: string[],
  posts: Record<string, unknown>[]
): string {
  const handle = getHandle(profile, key);
  const username = (profile.username ?? getDataUser(profile)?.username ?? '') as string;
  const bio = getBiography(profile);
  const discoveredValue = (profile._discovered_value as string) ?? '';
  const externalUrl = (profile.external_url ?? getDataUser(profile)?.external_url ?? '') as string;
  const parts = [
    handle,
    fullName,
    username,
    bio,
    discoveredValue,
    typeof externalUrl === 'string' ? externalUrl : '',
    ...categories,
    ...categories.map((c) => c.replace(/\s+/g, ' ')),
  ];
  addLlmQualificationSearchParts(profile, parts);
  for (let i = 0; i < Math.min(posts.length, MAX_POSTS_FOR_SEARCH); i++) {
    parts.push(getPostTextForSearch(posts[i]!));
  }
  return foldSearchText(parts.filter(Boolean).join(' '));
}

/** Texto pesquisável só do perfil (sem posts). Usado para early match e evitar custo com posts quando desnecessário. */
function getSearchableTextProfileOnly(
  profile: Record<string, unknown>,
  key: string,
  fullName: string,
  categories: string[]
): string {
  const handle = getHandle(profile, key);
  const username = (profile.username ?? getDataUser(profile)?.username ?? '') as string;
  const bio = getBiography(profile);
  const discoveredValue = (profile._discovered_value as string) ?? '';
  const parts = [
    handle,
    fullName,
    username,
    bio,
    discoveredValue,
    ...categories,
    ...categories.map((c) => c.replace(/\s+/g, ' ')),
  ];
  addLlmQualificationSearchParts(profile, parts);
  return foldSearchText(parts.filter(Boolean).join(' '));
}

/** Texto pesquisável a partir de um ProfileListItem (para filtro q em cima de lista em cache). Usa _searchable_text se existir (bio + legendas + hashtags + etc.). */
function getSearchableTextFromItem(item: ProfileListItem): string {
  const precomputed = (item as Record<string, unknown>)._searchable_text;
  if (typeof precomputed === 'string' && precomputed.trim()) {
    return foldSearchText(precomputed);
  }
  const handle = (item.handle ?? item.key ?? '').toLowerCase().replace(/^@/, '');
  const fullName = (item.full_name ?? '').trim();
  const bio = (item.biography ?? '').trim();
  const categories = (item.categories ?? []).map((c) => String(c).trim().toLowerCase()).filter(Boolean);
  const parts = [handle, fullName, bio, ...categories];
  addLlmQualificationSearchParts(item as unknown as Record<string, unknown>, parts);
  return parts.filter(Boolean).join(' ').toLowerCase().replace(/\s+/g, ' ');
}

/** Extrai likes, comentários e views de um post. */
function getPostMetrics(post: Record<string, unknown>): { likes: number; comments: number; views: number } {
  const metrics = post.metrics as Record<string, unknown> | undefined;
  const likes = toNum(metrics?.likes ?? post.like_count);
  const comments = toNum(metrics?.comments ?? post.comment_count);
  const views = toNum(metrics?.view_count ?? post.view_count);
  return { likes, comments, views };
}

/** Resultado de engajamento agregado dos posts do perfil (apenas dados Instagram). */
export interface EngagementStats {
  posts_count: number;
  total_likes: number;
  total_comments: number;
  total_views: number;
  avg_likes: number;
  avg_comments: number;
  avg_views: number;
  /** (média de interações por post) / followers * 100. */
  engagement_rate: number;
  /** Média de posts por semana (intervalo de datas). */
  posts_per_week?: number;
  /** Alcance relativo: avg_views / followers (audiência ativa vs inflada). */
  reach_ratio?: number;
  /** comments / (likes + comments) — profundidade da comunidade. */
  conversation_rate?: number;
  /** total_likes / total_views quando views > 0. */
  like_view_ratio?: number | null;
  /** total_comments / followers. */
  comments_per_follower?: number;
}

/** Bucket de facet (ex.: engajamento baixa/média/alta). */
export interface FacetBucket {
  key: string;
  label: string;
  min?: number;
  count: number;
}

/**
 * Agregações dos campos de `llm.qualification` (classificador qualify / collector-ingest-llm).
 * Só perfis com `llm.status === "done"` entram na busca; estes facets refletem esse subconjunto.
 */
export interface LlmSearchFacets {
  profileType: { name: string; count: number }[];
  mainCategory: { name: string; count: number }[];
  gender: { name: string; count: number }[];
  /** Idioma provável do conteúdo (`qualification.language`, ex. BCP-47). */
  language: { name: string; count: number }[];
  audienceType: { name: string; count: number }[];
  toneOfVoice: { name: string; count: number }[];
  /** Categoria única do prompt qualify: familia | sensivel | adulto. */
  brandSafety: {
    level: { name: string; count: number }[];
  };
  /** Sentimento predominante nas legendas analisadas (`post.llm.sentiment`). */
  postSentiment: { name: string; count: number }[];
}

/** Sumarização dos resultados para filtros (hashtags/categorias, engajamento, ativação, tipo de conteúdo). */
export interface ProfilesSearchFacets {
  /** Hashtags/categorias dos perfis (dos posts + perfil). */
  categories: { name: string; count: number }[];
  engagement_rate: FacetBucket[];
  avg_likes: FacetBucket[];
  posts_count: FacetBucket[];
  /** Contagem de perfis com cadastro ativado vs não ativado. */
  activation: { activated: number; not_activated: number };
  /** Tipo de conteúdo (cadastro ativado). */
  content_type: { name: string; count: number }[];
  /** Localização (apenas perfis ativados). */
  cities: { name: string; count: number }[];
  states: { name: string; count: number }[];
  neighborhoods: { name: string; count: number }[];
  /** Contagem por rede social preenchida (apenas ativados). */
  social: { whatsapp: number; tiktok: number; facebook: number; linkedin: number; twitter: number };
  /** Contagem por faixa de seguidores (porte); definição em `followersSizeBuckets.ts`. */
  followers_buckets: { key: string; label: string; min: number; max: number | undefined; count: number }[];
  /** Contagem por tipo de conta (1=pessoal, 2=criador, 3=empresa). */
  account_type: { value: number; label: string; count: number }[];
  /** Contagem por valor de preço por formato (feed, reels, story, destaque). */
  pricing?: Record<string, { value: number; count: number }[]>;
  /** Contagem por faixa de preço (low, medium, high, very_high); só entradas com count > 0. */
  cost_tier?: { tier: CostTier; count: number }[];
  /** Facets da qualificação LLM (`qualification`), quando houver perfis com LLM concluído. */
  llm?: LlmSearchFacets;
}

/** Item retornado na listagem (perfil + engajamento + BI quando há posts). */
export interface ProfileListItem {
  key: string;
  handle: string;
  full_name: string;
  profile_pic_url?: string;
  hd_profile_pic_url?: string;
  /** Foto estável (S3); não expira como URL do Instagram. */
  stable_profile_pic_url?: string;
  followers_count: number;
  following_count?: number;
  media_count?: number;
  biography?: string;
  categories: string[];
  engagement: EngagementStats;
  /** Métricas derivadas e BI (distribuição, evolução temporal, topic concentration, etc.). */
  bi?: InstagramBi;
  search_relevance?: number;
  data?: Record<string, unknown>;
  activation?: ProfileActivationData;
  [key: string]: unknown;
}

export interface ProfilesSearchQuery {
  /** Busca textual em handle, username, full_name. */
  q?: string;
  /** Mínimo de seguidores. */
  minFollowers?: number;
  /** Máximo de seguidores. */
  maxFollowers?: number;
  /** Mínimo de taxa de engajamento (%). Se engagementRateBuckets for usado, este é ignorado. */
  minEngagementRate?: number;
  /** Mínimo de média de likes por post. Se avgLikesBuckets for usado, este é ignorado. */
  minAvgLikes?: number;
  /** Mínimo de posts analisados. Se postsCountBuckets for usado, este é ignorado. */
  minPostsCount?: number;
  /** Faixas de taxa de engajamento (multiselect): 0=baixa(<1%), 1=média(1–5%), 5=alta(5%+). */
  engagementRateBuckets?: number[];
  /** Faixas de média likes: 0=baixa(<500), 500=média, 5000=alta. */
  avgLikesBuckets?: number[];
  /** Faixas de posts: 0=baixa(<25), 25=média, 50=alta. */
  postsCountBuckets?: number[];
  /** Filtro ativação: ['activated'] | ['not_activated'] | ambos/vazio = sem filtro. */
  activationFilter?: string[];
  /** Cidades (multiselect). */
  cities?: string[];
  /** Estados (multiselect). */
  states?: string[];
  /** Bairros (multiselect). */
  neighborhoods?: string[];
  /** Redes sociais (multiselect): whatsapp, tiktok, facebook, linkedin, twitter. */
  socialNetworks?: string[];
  /** Categorias/hashtags (vírgula ou array); perfil deve ter ao menos uma. */
  categories?: string | string[];
  /** Excluir perfis privados (default: false = incluir todos). */
  excludePrivate?: boolean;
  /** Tipo de conta (1=pessoal, 2=criador, 3=empresa). Multiselect. */
  accountTypeFilter?: number[];
  /** Tipo de conteúdo (apenas perfis ativados; multiselect). */
  contentTypes?: string | string[];
  /** Faixas de preço por formato (multiselect: valores em reais 0, 50, 100, 250, 500, 1000, 2500, 5000, 15000). */
  pricingFeed?: number[];
  pricingReels?: number[];
  pricingStory?: number[];
  pricingDestaque?: number[];
  /** Filtro por faixa de preço: low = abaixo da média, medium = normal, high | very_high = acima da média. */
  costTierFilter?: string[];
  /** Filtro por tamanho (seguidores); patamares em `followersSizeBuckets.ts`. */
  sizeFilter?: string[];
  /**
   * Filtros sobre `llm.qualification` (multiselect = OR dentro do campo).
   * Só têm efeito em perfis que já passaram pelo filtro de LLM concluído.
   */
  llmProfileType?: string | string[];
  llmMainCategory?: string | string[];
  llmGender?: string | string[];
  llmLanguage?: string | string[];
  llmAudienceType?: string | string[];
  llmToneOfVoice?: string | string[];
  llmRiskLevel?: string | string[];
  /** Quando definido, exige mesmo valor em `qualification.brandSafety`. */
  llmIsFamilySafe?: boolean;
  llmIsAdultContent?: boolean;
  /** Sentimento predominante por perfil (positivo | negativo | misto), agregado dos posts. */
  llmPostSentiment?: string | string[];
  /** Ordenação: relevance_desc | engagement_desc | engagement_asc | followers_desc | followers_asc | avg_likes_desc | avg_likes_asc | total_likes_desc | total_likes_asc */
  sort?: string;
  limit?: number;
  offset?: number;
  /** Quando false, não calcula facets (resposta mais rápida; útil em paginação quando já se tem facets). Default true. */
  includeFacets?: boolean;
}

const SECONDS_PER_WEEK = 7 * 24 * 3600;
/** Período mínimo (1 semana) para não inflar "posts/semana" quando a janela observada é muito curta. */
const MIN_WEEKS_FOR_RATE = 1;

function parseNumArray(v: unknown): number[] {
  if (Array.isArray(v)) return v.map((x) => Number(x)).filter((n) => Number.isFinite(n));
  if (typeof v === 'string') return v.split(',').map((x) => Number(x.trim())).filter((n) => Number.isFinite(n));
  return [];
}

function parseStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(',').map((x) => x.trim()).filter(Boolean);
  return [];
}

function qualificationArrayMatchesOr(q: Record<string, unknown>, key: string, selected: string[]): boolean {
  if (selected.length === 0) return true;
  const set = new Set(selected.map((s) => s.trim().toLowerCase()).filter(Boolean));
  const arr = q[key];
  if (!Array.isArray(arr)) return false;
  return arr.some((x) => typeof x === 'string' && set.has(x.trim().toLowerCase()));
}

const CAMPAIGN_FACET_BOOST_QUERY_KEYS = [
  'sizeFilter',
  'accountTypeFilter',
  'contentTypes',
  'cities',
  'states',
  'neighborhoods',
  'socialNetworks',
  'engagementRateBuckets',
  'avgLikesBuckets',
  'postsCountBuckets',
  'llmProfileType',
  'llmMainCategory',
  'llmGender',
  'llmAudienceType',
] as const satisfies readonly (keyof ProfilesSearchQuery)[];

export function stripCampaignFacetBoostFromProfilesQuery(query: ProfilesSearchQuery): ProfilesSearchQuery {
  const out = { ...query } as ProfilesSearchQuery;
  for (const k of CAMPAIGN_FACET_BOOST_QUERY_KEYS) {
    delete (out as Record<string, unknown>)[k];
  }
  return out;
}

export function hasCampaignFacetBoostInQuery(query: ProfilesSearchQuery): boolean {
  return CAMPAIGN_FACET_BOOST_QUERY_KEYS.some((k) => {
    const v = query[k];
    return Array.isArray(v) && v.length > 0;
  });
}

function normalizeSizeBoostKey(s: string): string {
  const x = s.toLowerCase().trim();
  if (x === 'mid') return 'medio';
  if (x === 'subnano') return 'nano';
  return x;
}

type CampaignFacetBoostDimension = (typeof CAMPAIGN_FACET_BOOST_QUERY_KEYS)[number];

/** Dimensões ativas na ordem do painel (primeira = maior prioridade na ordenação). */
export function activeCampaignFacetBoostDimensions(
  query: ProfilesSearchQuery
): CampaignFacetBoostDimension[] {
  return CAMPAIGN_FACET_BOOST_QUERY_KEYS.filter((k) => {
    const v = query[k];
    return Array.isArray(v) && v.length > 0;
  });
}

function getProfileActivationForBoost(
  profile: Record<string, unknown> | null
): ProfileActivationData | undefined {
  const act = profile?.activation;
  if (act != null && typeof act === 'object' && !Array.isArray(act)) {
    return act as ProfileActivationData;
  }
  return undefined;
}

function getProfileEngagementForBoost(profile: Record<string, unknown> | null): EngagementStats {
  const eng = profile?.engagement;
  if (eng != null && typeof eng === 'object' && !Array.isArray(eng)) {
    return eng as EngagementStats;
  }
  return {
    posts_count: 0,
    avg_likes: 0,
    avg_comments: 0,
    avg_views: 0,
    total_likes: 0,
    total_comments: 0,
    total_views: 0,
    engagement_rate: 0,
  };
}

function profileHasSocialNetwork(act: ProfileActivationData, net: string): boolean {
  const n = net.toLowerCase();
  if (n === 'whatsapp') return !!(act.whatsapp?.trim());
  if (n === 'tiktok') return !!(act.tiktok?.trim());
  if (n === 'facebook') return !!(act.facebook?.trim());
  if (n === 'linkedin') return !!(act.linkedin?.trim());
  if (n === 'twitter') return !!(act.twitter?.trim());
  return false;
}

/** Se o perfil casa com a dimensão selecionada no painel BI (prioridade de ordenação). */
export function profileMatchesCampaignFacetBoostDimension(
  profile: Record<string, unknown> | null,
  query: ProfilesSearchQuery,
  dimension: CampaignFacetBoostDimension,
  followersCount?: number
): boolean {
  const record = profile ?? {};
  const fc =
    followersCount ??
    (typeof record.followers_count === 'number' && Number.isFinite(record.followers_count)
      ? record.followers_count
      : getFollowers(record) ?? getFollowersFromProfile(record) ?? 0);
  const act = getProfileActivationForBoost(profile);
  const engagement = getProfileEngagementForBoost(profile);

  switch (dimension) {
    case 'sizeFilter': {
      const sizeSel = parseStringArray(query.sizeFilter).map(normalizeSizeBoostKey);
      if (sizeSel.length === 0 || !Number.isFinite(fc)) return false;
      return sizeSel.includes(followersCountToSizeKey(fc));
    }
    case 'accountTypeFilter': {
      const sel = (query.accountTypeFilter ?? []).filter((n) => [1, 2, 3].includes(n));
      if (sel.length === 0) return false;
      const at = getAccountType(record);
      return at != null && sel.includes(at);
    }
    case 'contentTypes': {
      const sel = parseStringArray(query.contentTypes).map((s) => s.toLowerCase());
      if (sel.length === 0 || !act) return false;
      const ct = act.content_type;
      if (!ct || !Array.isArray(ct)) return false;
      const ctLower = ct.map((c) => String(c).trim().toLowerCase()).filter(Boolean);
      return sel.some((fc) => ctLower.includes(fc));
    }
    case 'cities': {
      const sel = parseStringArray(query.cities).map((s) => s.toLowerCase());
      if (sel.length === 0) return false;
      const city = act?.city?.trim().toLowerCase();
      return !!city && sel.includes(city);
    }
    case 'states': {
      const sel = parseStringArray(query.states).map((s) => s.toLowerCase());
      if (sel.length === 0) return false;
      const state = act?.state?.trim().toLowerCase();
      return !!state && sel.includes(state);
    }
    case 'neighborhoods': {
      const sel = parseStringArray(query.neighborhoods).map((s) => s.toLowerCase());
      if (sel.length === 0) return false;
      const raw = act?.neighborhood?.trim();
      if (!raw) return false;
      const parts = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      return parts.some((p) => sel.includes(p));
    }
    case 'socialNetworks': {
      const sel = parseStringArray(query.socialNetworks).map((s) => s.toLowerCase());
      if (sel.length === 0 || !act) return false;
      return sel.some((net) => profileHasSocialNetwork(act, net));
    }
    case 'engagementRateBuckets':
      return matchesEngagementRateBuckets(
        engagement.engagement_rate ?? 0,
        (query.engagementRateBuckets ?? []).filter(Number.isFinite)
      );
    case 'avgLikesBuckets':
      return matchesAvgLikesBuckets(
        engagement.avg_likes ?? 0,
        (query.avgLikesBuckets ?? []).filter(Number.isFinite)
      );
    case 'postsCountBuckets':
      return matchesPostsCountBuckets(
        engagement.posts_count ?? 0,
        (query.postsCountBuckets ?? []).filter(Number.isFinite)
      );
    case 'llmProfileType':
    case 'llmMainCategory':
    case 'llmGender':
    case 'llmAudienceType': {
      const qual = getLlmQualification(record);
      if (!qual) return false;
      if (dimension === 'llmProfileType') {
        const sel = parseStringArray(query.llmProfileType);
        if (sel.length === 0) return false;
        const set = new Set(sel.map((s) => s.trim().toLowerCase()).filter(Boolean));
        return set.has(String(qual.profileType ?? '').trim().toLowerCase());
      }
      if (dimension === 'llmGender') {
        const sel = parseStringArray(query.llmGender);
        if (sel.length === 0) return false;
        const set = new Set(sel.map((s) => s.trim().toLowerCase()).filter(Boolean));
        return set.has(String(qual.gender ?? '').trim().toLowerCase());
      }
      if (dimension === 'llmMainCategory') {
        const sel = parseStringArray(query.llmMainCategory);
        if (sel.length === 0) return false;
        const set = new Set(
          sel
            .map((s) => snapMainCategoryToTaxonomy(s.trim())?.toLowerCase())
            .filter((x): x is string => Boolean(x))
        );
        const stored = snapMainCategoryToTaxonomy(String(qual.mainCategory ?? '').trim())?.toLowerCase();
        return !!stored && set.has(stored);
      }
      return qualificationArrayMatchesOr(qual, 'audienceType', parseStringArray(query.llmAudienceType));
    }
    default:
      return false;
  }
}

/**
 * Prioridade lexicográfica: primeira dimensão selecionada no painel vence;
 * dentro de cada dimensão, quem casa com a seleção sobe antes dos demais.
 */
export function computeCampaignFacetBoostPriority(
  profile: Record<string, unknown> | null,
  query: ProfilesSearchQuery,
  followersCount?: number
): number {
  const dims = activeCampaignFacetBoostDimensions(query);
  let priority = 0;
  for (const dim of dims) {
    priority <<= 1;
    if (profileMatchesCampaignFacetBoostDimension(profile, query, dim, followersCount)) {
      priority |= 1;
    }
  }
  return priority;
}

/** @deprecated Use `computeCampaignFacetBoostPriority` — mantido para compatibilidade interna. */
export function computeCampaignFacetBoostScore(
  profile: Record<string, unknown> | null,
  query: ProfilesSearchQuery,
  followersCount?: number
): number {
  return computeCampaignFacetBoostPriority(profile, query, followersCount);
}

export function compareCampaignFacetBoostPriority(priorityA: number, priorityB: number): number {
  if (priorityB !== priorityA) return priorityB - priorityA;
  return 0;
}

/** Perfil mínimo a partir do item de post-matches já enriquecido (mesmos seguidores da UI). */
export function profileRecordFromPostMatchItem(item: Record<string, unknown>): Record<string, unknown> {
  const inf = item.influencer;
  const record: Record<string, unknown> = {};
  if (inf != null && typeof inf === 'object' && !Array.isArray(inf)) {
    const io = inf as Record<string, unknown>;
    if (typeof io.followers_count === 'number' && Number.isFinite(io.followers_count)) {
      record.followers_count = io.followers_count;
    }
    if (io.llm != null) record.llm = io.llm;
  }
  return record;
}

/** Reordena itens da página após enriquecer `influencer` (porte/LLM alinhados ao card). */
export function sortPostMatchItemsByCampaignFacetBoost(
  items: Record<string, unknown>[],
  query: ProfilesSearchQuery
): Record<string, unknown>[] {
  if (!hasCampaignFacetBoostInQuery(query) || items.length < 2) return items;
  return [...items]
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const profA = profileRecordFromPostMatchItem(a.item);
      const profB = profileRecordFromPostMatchItem(b.item);
      const fcA =
        typeof profA.followers_count === 'number' && Number.isFinite(profA.followers_count)
          ? profA.followers_count
          : 0;
      const fcB =
        typeof profB.followers_count === 'number' && Number.isFinite(profB.followers_count)
          ? profB.followers_count
          : 0;
      const boostCmp = compareCampaignFacetBoostPriority(
        computeCampaignFacetBoostPriority(profA, query, fcA),
        computeCampaignFacetBoostPriority(profB, query, fcB)
      );
      if (boostCmp !== 0) return boostCmp;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}

function normalizeHandleForFacetBoost(h: string): string {
  return String(h).toLowerCase().replace(/^@/, '').trim();
}

function handleFromPostBucketKey(key: string): string {
  const idx = key.indexOf(':');
  if (idx <= 0) return normalizeHandleForFacetBoost(key);
  return normalizeHandleForFacetBoost(key.slice(0, idx));
}

function normalizeDiversityToken(raw: string): string {
  const s = raw.trim().toLowerCase();
  return s || '_';
}

function normalizeGenderForDiversity(raw: string): string {
  const x = raw.trim().toLowerCase();
  if (!x || x === '_' || x === 'unknown' || x === 'n/a') return '_';
  if (x === 'm' || x === 'male' || x === 'masculino' || x === 'homem' || x === 'man') return 'masculino';
  if (x === 'f' || x === 'female' || x === 'feminino' || x === 'mulher' || x === 'woman') return 'feminino';
  return x;
}

/** Dimensões usadas para facetas do painel BI na busca por legenda. */
export type HandleDiversityMeta = {
  sizeKey: string;
  gender: string;
  mainCategory: string;
  audience: string;
  profileType: string;
};

export function buildHandleDiversityMetaFromProfile(
  profile: Record<string, unknown> | null,
  followersCount?: number
): HandleDiversityMeta {
  const fc =
    followersCount ??
    (profile != null && typeof profile.followers_count === 'number' && Number.isFinite(profile.followers_count)
      ? profile.followers_count
      : getFollowers(profile ?? {}) ?? getFollowersFromProfile(profile) ?? 0);
  const sizeKey =
    Number.isFinite(fc) && fc >= 0 ? followersCountToSizeKey(fc) : 'unknown';
  const qual = getLlmQualification(profile ?? {});
  let gender = '_';
  let mainCategory = '_';
  let audience = '_';
  let profileType = '_';
  if (qual) {
    gender = normalizeGenderForDiversity(String(qual.gender ?? ''));
    const mc = snapMainCategoryToTaxonomy(String(qual.mainCategory ?? '').trim());
    mainCategory = mc ? normalizeDiversityToken(mc) : '_';
    profileType = normalizeDiversityToken(String(qual.profileType ?? ''));
    const aud = qual.audienceType;
    if (Array.isArray(aud) && aud.length > 0) {
      audience = normalizeDiversityToken(String(aud[0] ?? ''));
    }
  }
  return { sizeKey, gender, mainCategory, audience, profileType };
}

function diversityDimensionKeys(m: HandleDiversityMeta): string[] {
  return [
    `gender:${m.gender}`,
    `size:${m.sizeKey}`,
    `main:${m.mainCategory}`,
    `aud:${m.audience}`,
    `ptype:${m.profileType}`,
  ];
}

/** Ordem fixa nano → celebridade para intercalar todos os portes na varredura. */
const DIVERSITY_SIZE_TIER_ORDER: readonly string[] = [
  'nano',
  'micro',
  'medio',
  'macro',
  'elite',
  'celebridade',
  'unknown',
];

/** Bônus ao primeiro perfil de cada porte/gênero ainda não representado na lista. */
const DIVERSITY_NEW_BUCKET_BONUS = 110;

function diversityPenaltyForKey(dimKey: string): number {
  if (dimKey.startsWith('gender:')) return 85;
  if (dimKey.startsWith('size:')) return 72;
  return 12;
}

function diversityScoreForPick(
  baseScore: number,
  m: HandleDiversityMeta,
  dimCounts: Map<string, number>
): number {
  let score = baseScore;
  for (const dk of diversityDimensionKeys(m)) {
    const seen = dimCounts.get(dk) ?? 0;
    score -= seen * diversityPenaltyForKey(dk);
    if (seen === 0 && !dk.endsWith(':_') && !dk.endsWith(':unknown')) {
      score += DIVERSITY_NEW_BUCKET_BONUS;
    }
  }
  return score;
}

/** Carrega metadados de diversidade (porte + LLM) por handle. */
export async function loadHandleDiversityMeta(
  db: CompositeStorage,
  handles: string[]
): Promise<Map<string, HandleDiversityMeta>> {
  const out = new Map<string, HandleDiversityMeta>();
  if (handles.length === 0) return out;
  const BATCH = 64;
  for (let i = 0; i < handles.length; i += BATCH) {
    const chunk = handles.slice(i, i + BATCH);
    const auxRows = db.getProfileSearchAuxRowsForHandles(chunk);
    const fcBy = new Map<string, number>();
    for (const r of auxRows) {
      const k = normalizeHandleForFacetBoost(String(r.handle ?? ''));
      if (!k) continue;
      const fc =
        typeof r.followers_count === 'number' && Number.isFinite(r.followers_count) ? r.followers_count : 0;
      fcBy.set(k, fc);
    }
    await Promise.all(
      chunk.map(async (rawH) => {
        const hk = normalizeHandleForFacetBoost(rawH);
        if (!hk) return;
        const profile = (await db.loadByHandle(rawH)) as Record<string, unknown> | null;
        const fc = fcBy.get(hk) ?? getFollowersFromProfile(profile);
        out.set(hk, buildHandleDiversityMetaFromProfile(profile, fc));
      })
    );
  }
  return out;
}

function roundRobinInterleaveHandles(
  handles: string[],
  bucketForHandle: (h: string) => string,
  bucketKeyOrder?: readonly string[]
): string[] {
  if (handles.length < 2) return handles;
  const buckets = new Map<string, { h: string; idx: number }[]>();
  handles.forEach((h, idx) => {
    const bk = bucketForHandle(h);
    if (!buckets.has(bk)) buckets.set(bk, []);
    buckets.get(bk)!.push({ h, idx });
  });
  const orderIndex = (k: string): number => {
    if (!bucketKeyOrder?.length) return 0;
    const i = bucketKeyOrder.indexOf(k);
    return i >= 0 ? i : bucketKeyOrder.length;
  };
  const keys = [...buckets.keys()].sort((a, b) => {
    const oa = orderIndex(a);
    const ob = orderIndex(b);
    if (oa !== ob) return oa - ob;
    return a.localeCompare(b);
  });
  const out: string[] = [];
  let round = 0;
  for (;;) {
    let added = false;
    for (const k of keys) {
      const list = buckets.get(k)!;
      if (round < list.length) {
        out.push(list[round]!.h);
        added = true;
      }
    }
    if (!added) break;
    round++;
  }
  return out.length > 0 ? out : handles;
}

/**
 * Varredura: intercala todos os portes (nano…celebridade), depois gênero — facetas de tamanho mais ricas.
 */
export async function orderHandlesForFacetDiversity(
  db: CompositeStorage,
  handles: string[]
): Promise<string[]> {
  if (handles.length < 2) return handles;
  const meta = await loadHandleDiversityMeta(db, handles);
  const bySize = roundRobinInterleaveHandles(
    handles,
    (h) => {
      const hk = normalizeHandleForFacetBoost(h);
      const sk = meta.get(hk)?.sizeKey ?? 'unknown';
      return sk === 'unknown' ? 'unknown' : sk;
    },
    DIVERSITY_SIZE_TIER_ORDER
  );
  return roundRobinInterleaveHandles(bySize, (h) => {
    const hk = normalizeHandleForFacetBoost(h);
    const g = meta.get(hk)?.gender ?? '_';
    return g === '_' ? 'unknown' : g;
  });
}

/** Reordena handles já priorizados (ex.: porte Mid) intercalando gênero na varredura. */
export function interleaveHandlesByDiversityGender(
  handles: string[],
  meta: Map<string, HandleDiversityMeta>
): string[] {
  return roundRobinInterleaveHandles(handles, (h) => {
    const hk = normalizeHandleForFacetBoost(h);
    const g = meta.get(hk)?.gender ?? '_';
    return g === '_' ? 'unknown' : g;
  });
}

/**
 * Ordenação gananciosa: relevância alta, penalizando repetir a mesma faceta (porte, gênero, categoria…).
 */
export function sortScratchRowsByFacetDiversity<T extends { key: string; relevance: number }>(
  rows: T[],
  handleMeta: Map<string, HandleDiversityMeta>,
  qRaw: string
): T[] {
  if (rows.length < 2) return rows;
  const remaining = [...rows];
  const result: T[] = [];
  const dimCounts = new Map<string, number>();
  while (remaining.length > 0) {
    let bestI = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const row = remaining[i]!;
      const ha = handleFromPostBucketKey(row.key);
      const m = handleMeta.get(ha) ?? {
        sizeKey: 'unknown',
        gender: '_',
        mainCategory: '_',
        audience: '_',
        profileType: '_',
      };
      const baseScore = qRaw.trim() ? row.relevance : 0;
      const score = diversityScoreForPick(baseScore, m, dimCounts);
      if (score > bestScore) {
        bestScore = score;
        bestI = i;
      }
    }
    const picked = remaining.splice(bestI, 1)[0]!;
    const ha = handleFromPostBucketKey(picked.key);
    const pm = handleMeta.get(ha) ?? {
      sizeKey: 'unknown',
      gender: '_',
      mainCategory: '_',
      audience: '_',
      profileType: '_',
    };
    for (const dk of diversityDimensionKeys(pm)) {
      dimCounts.set(dk, (dimCounts.get(dk) ?? 0) + 1);
    }
    result.push(picked);
  }
  return result;
}

function scratchRowEngagementScore(value: unknown): number {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return 0;
  const item = value as Record<string, unknown>;
  const metrics = item.metrics as Record<string, unknown> | undefined;
  const likes = typeof metrics?.likes === 'number' && Number.isFinite(metrics.likes) ? metrics.likes : 0;
  const comments =
    typeof metrics?.comments === 'number' && Number.isFinite(metrics.comments) ? metrics.comments : 0;
  return likes + comments * 2;
}

/** Dentro do mesmo nível de boost: relevância, engajamento do post, data (sem intercalar porte). */
function sortScratchRowsWithinBoostPriority<T extends { key: string; relevance: number; ts?: number; value?: unknown }>(
  rows: T[],
  qRaw: string
): T[] {
  if (rows.length < 2) return rows;
  const hasQ = qRaw.trim().length > 0;
  return [...rows].sort((a, b) => {
    if (hasQ && b.relevance !== a.relevance) return b.relevance - a.relevance;
    const engDiff = scratchRowEngagementScore(b.value) - scratchRowEngagementScore(a.value);
    if (engDiff !== 0) return engDiff;
    const tsA = typeof a.ts === 'number' && Number.isFinite(a.ts) ? a.ts : 0;
    const tsB = typeof b.ts === 'number' && Number.isFinite(b.ts) ? b.ts : 0;
    if (tsB !== tsA) return tsB - tsA;
    return a.key.localeCompare(b.key);
  });
}

/** Com filtro BI ativo: prioridade do boost; dentro do mesmo nível, relevância/engajamento (não diversidade por porte). */
export function sortScratchRowsByBoostThenDiversity<T extends { key: string; relevance: number; ts?: number; value?: unknown }>(
  rows: T[],
  query: ProfilesSearchQuery,
  boostMeta: Map<string, HandleFacetBoostMeta>,
  _diversityMeta: Map<string, HandleDiversityMeta>,
  qRaw: string
): T[] {
  if (rows.length < 2) return rows;
  if (!hasCampaignFacetBoostInQuery(query)) {
    return sortScratchRowsByFacetDiversity(rows as T[], _diversityMeta, qRaw);
  }
  const byPriority = new Map<number, T[]>();
  for (const row of rows) {
    const ha = handleFromPostBucketKey(row.key);
    const p = boostMeta.get(ha)?.priority ?? 0;
    if (!byPriority.has(p)) byPriority.set(p, []);
    byPriority.get(p)!.push(row);
  }
  const priorities = [...byPriority.keys()].sort((a, b) => b - a);
  const out: T[] = [];
  for (const p of priorities) {
    const group = byPriority.get(p)!;
    out.push(...sortScratchRowsWithinBoostPriority(group, qRaw));
  }
  return out;
}

function campaignFacetBoostNeedsProfileLoad(query: ProfilesSearchQuery): boolean {
  return (
    parseStringArray(query.sizeFilter).length > 0 ||
    parseStringArray(query.llmProfileType).length > 0 ||
    parseStringArray(query.llmMainCategory).length > 0 ||
    parseStringArray(query.llmGender).length > 0 ||
    parseStringArray(query.llmAudienceType).length > 0 ||
    (query.engagementRateBuckets?.length ?? 0) > 0 ||
    (query.avgLikesBuckets?.length ?? 0) > 0 ||
    (query.postsCountBuckets?.length ?? 0) > 0 ||
    (query.accountTypeFilter?.length ?? 0) > 0 ||
    (query.contentTypes?.length ?? 0) > 0 ||
    (query.cities?.length ?? 0) > 0 ||
    (query.states?.length ?? 0) > 0
  );
}

export type HandleFacetBoostMeta = { priority: number; fc: number };

/** Pontuação de boost por handle (índice normalizado, sem @). */
export async function loadHandleFacetBoostMeta(
  db: CompositeStorage,
  handles: string[],
  query: ProfilesSearchQuery
): Promise<Map<string, HandleFacetBoostMeta>> {
  const out = new Map<string, HandleFacetBoostMeta>();
  if (handles.length === 0) return out;
  const needsProfile = campaignFacetBoostNeedsProfileLoad(query);
  const BATCH = 64;
  for (let i = 0; i < handles.length; i += BATCH) {
    const chunk = handles.slice(i, i + BATCH);
    const auxRows = db.getProfileSearchAuxRowsForHandles(chunk);
    const fcBy = new Map<string, number>();
    for (const r of auxRows) {
      const k = normalizeHandleForFacetBoost(String(r.handle ?? ''));
      if (!k) continue;
      const fc =
        typeof r.followers_count === 'number' && Number.isFinite(r.followers_count) ? r.followers_count : 0;
      fcBy.set(k, fc);
    }
    if (needsProfile) {
      await Promise.all(
        chunk.map(async (rawH) => {
          const hk = normalizeHandleForFacetBoost(rawH);
          if (!hk) return;
          const profile = (await db.loadByHandle(rawH)) as Record<string, unknown> | null;
          const fc = fcBy.get(hk) ?? getFollowersFromProfile(profile);
          out.set(hk, {
            priority: computeCampaignFacetBoostPriority(profile, query, fc),
            fc: typeof fc === 'number' && Number.isFinite(fc) ? fc : 0,
          });
        })
      );
    } else {
      const engBy = new Map<string, EngagementStats>();
      for (const r of auxRows) {
        const k = normalizeHandleForFacetBoost(String(r.handle ?? ''));
        if (!k || !r.engagement_json) continue;
        try {
          engBy.set(k, JSON.parse(r.engagement_json) as EngagementStats);
        } catch {
          /* ignore */
        }
      }
      for (const rawH of chunk) {
        const hk = normalizeHandleForFacetBoost(rawH);
        if (!hk) continue;
        const fc = fcBy.get(hk) ?? 0;
        const stub: Record<string, unknown> = { followers_count: fc };
        const eng = engBy.get(hk);
        if (eng) stub.engagement = eng;
        out.set(hk, {
          priority: computeCampaignFacetBoostPriority(stub, query, fc),
          fc,
        });
      }
    }
  }
  return out;
}

/**
 * Ordena handles antes do scan de posts: perfis que casam com o boost (ex.: celebridade) entram no lote cedo.
 */
export async function orderHandlesForCampaignFacetBoost(
  db: CompositeStorage,
  handles: string[],
  query: ProfilesSearchQuery
): Promise<string[]> {
  if (!hasCampaignFacetBoostInQuery(query) || handles.length < 2) return handles;
  const meta = await loadHandleFacetBoostMeta(db, handles, query);
  return [...handles]
    .map((h, idx) => {
      const hk = normalizeHandleForFacetBoost(h);
      const m = meta.get(hk) ?? { priority: 0, fc: 0 };
      return { h, priority: m.priority, idx };
    })
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.idx - b.idx;
    })
    .map((x) => x.h);
}

/** Ordena perfis da campanha: quem casa com os facets do painel BI sobe (sem remover itens). */
export function sortProfileListItemsByCampaignFacetBoost(
  items: ProfileListItem[],
  query: ProfilesSearchQuery
): ProfileListItem[] {
  if (!hasCampaignFacetBoostInQuery(query) || items.length < 2) return items;
  return [...items]
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const pa = computeCampaignFacetBoostPriority(
        a.item as unknown as Record<string, unknown>,
        query,
        a.item.followers_count
      );
      const pb = computeCampaignFacetBoostPriority(
        b.item as unknown as Record<string, unknown>,
        query,
        b.item.followers_count
      );
      const boostCmp = compareCampaignFacetBoostPriority(pa, pb);
      if (boostCmp !== 0) return boostCmp;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}

/** Filtro por campos de `llm.qualification` (multiselect = OR dentro do mesmo campo). */
export function matchesLlmQualificationFilters(record: Record<string, unknown>, query: ProfilesSearchQuery): boolean {
  const qual = getLlmQualification(record);
  if (!qual) return false;

  const orScalar = (field: string, selected: string[]): boolean => {
    if (selected.length === 0) return true;
    const set = new Set(selected.map((s) => s.trim().toLowerCase()).filter(Boolean));
    const v = String(qual[field] ?? '').trim().toLowerCase();
    return set.has(v);
  };

  if (!orScalar('profileType', parseStringArray(query.llmProfileType))) return false;
  const mainCatSel = parseStringArray(query.llmMainCategory);
  if (mainCatSel.length > 0) {
    const set = new Set(
      mainCatSel
        .map((s) => snapMainCategoryToTaxonomy(s.trim())?.toLowerCase())
        .filter((x): x is string => Boolean(x))
    );
    const stored = snapMainCategoryToTaxonomy(String(qual.mainCategory ?? '').trim())?.toLowerCase();
    if (!stored || !set.has(stored)) return false;
  }
  if (!orScalar('gender', parseStringArray(query.llmGender))) return false;
  if (!orScalar('language', parseStringArray(query.llmLanguage))) return false;

  if (!qualificationArrayMatchesOr(qual, 'audienceType', parseStringArray(query.llmAudienceType))) return false;
  if (!qualificationArrayMatchesOr(qual, 'toneOfVoice', parseStringArray(query.llmToneOfVoice))) return false;

  const brandSafetyLevel = normalizeBrandSafetyLevel(qual.brandSafety);
  const riskSel = parseStringArray(query.llmRiskLevel);
  if (riskSel.length > 0) {
    if (!brandSafetyLevel) return false;
    const normalizedRiskSet = new Set(
      riskSel
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
        .map((s) => (s === 'low' ? 'familia' : s === 'medium' ? 'sensivel' : s === 'high' ? 'adulto' : s))
    );
    if (!normalizedRiskSet.has(brandSafetyLevel)) return false;
  }

  if (query.llmIsFamilySafe === true || query.llmIsFamilySafe === false) {
    if (!brandSafetyLevel) return false;
    if ((brandSafetyLevel === 'familia') !== query.llmIsFamilySafe) return false;
  }
  if (query.llmIsAdultContent === true || query.llmIsAdultContent === false) {
    if (!brandSafetyLevel) return false;
    if ((brandSafetyLevel === 'adulto') !== query.llmIsAdultContent) return false;
  }

  return true;
}

/** Filtro por sentimento agregado dos posts (independente de qualification LLM). */
export function matchesPostSentimentFilter(record: Record<string, unknown>, query: ProfilesSearchQuery): boolean {
  const selected = parseStringArray(query.llmPostSentiment)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (selected.length === 0) return true;
  const raw = String(record.llm_post_sentiment ?? '').trim().toLowerCase();
  if (!raw) return false;
  return selected.includes(raw);
}

/** Verifica se rate cai em algum bucket selecionado. Buckets: 0=<1%, 1=1-5%, 5=5%+. */
function matchesEngagementRateBuckets(rate: number, selected: number[]): boolean {
  if (selected.length === 0) return true;
  if (selected.includes(0) && rate < 1) return true;
  if (selected.includes(1) && rate >= 1 && rate < 5) return true;
  if (selected.includes(5) && rate >= 5) return true;
  return false;
}

/** Verifica se avgLikes cai em algum bucket: 0=<500, 500=500-5k, 5000=5k+. */
function matchesAvgLikesBuckets(avgLikes: number, selected: number[]): boolean {
  if (selected.length === 0) return true;
  if (selected.includes(0) && avgLikes < 500) return true;
  if (selected.includes(500) && avgLikes >= 500 && avgLikes < 5000) return true;
  if (selected.includes(5000) && avgLikes >= 5000) return true;
  return false;
}

/** Verifica se postsCount cai em algum bucket: 0=<25, 25=25-50, 50=50+. */
function matchesPostsCountBuckets(postsCount: number, selected: number[]): boolean {
  if (selected.length === 0) return true;
  if (selected.includes(0) && postsCount < 25) return true;
  if (selected.includes(25) && postsCount >= 25 && postsCount < 50) return true;
  if (selected.includes(50) && postsCount >= 50) return true;
  return false;
}

/** Média de posts por semana a partir das datas dos posts analisados. */
export function computePostsPerWeek(posts: Record<string, unknown>[]): number {
  const n = posts.length;
  if (n <= 0) return 0;
  const timestamps: number[] = [];
  for (const p of posts) {
    const ts = getPostTimestamp(p);
    if (ts != null) timestamps.push(ts);
  }
  if (timestamps.length >= 2) {
    const minTs = Math.min(...timestamps);
    const maxTs = Math.max(...timestamps);
    const observedWeeks = (maxTs - minTs) / SECONDS_PER_WEEK;
    const weeks = Math.max(observedWeeks, MIN_WEEKS_FOR_RATE);
    return weeks > 0 ? Math.round((n / weeks) * 100) / 100 : n;
  }
  return n;
}

/** Extrai timestamp Unix (segundos) do post. */
export function getPostTimestamp(p: Record<string, unknown>): number | null {
  const post = p.post as Record<string, unknown> | undefined;
  const content = p.content as Record<string, unknown> | undefined;
  const takenAt = post?.taken_at ?? (p as { taken_at?: number }).taken_at;
  if (takenAt != null && typeof takenAt === 'number') return takenAt;
  const captionAt = content?.caption_created_at;
  if (captionAt != null && typeof captionAt === 'number') return captionAt;
  const collected = post?.collected_at ?? (p as { collected_at?: string }).collected_at;
  if (collected != null && typeof collected === 'string') {
    const d = new Date(collected);
    return Number.isNaN(d.getTime()) ? null : Math.floor(d.getTime() / 1000);
  }
  return null;
}

/** Calcula engajamento a partir dos posts do perfil. */
function computeEngagement(posts: Record<string, unknown>[], followersCount: number): EngagementStats {
  let totalLikes = 0;
  let totalComments = 0;
  let totalViews = 0;
  const timestamps: number[] = [];
  for (const p of posts) {
    const m = getPostMetrics(p);
    totalLikes += m.likes;
    totalComments += m.comments;
    totalViews += m.views;
    const ts = getPostTimestamp(p);
    if (ts != null) timestamps.push(ts);
  }
  const n = posts.length;
  const totalInteractions = totalLikes + totalComments;
  // Engajamento = (média de interações por post) / seguidores — assim o % não ultrapassa 100%
  const avgInteractionsPerPost = n > 0 ? totalInteractions / n : 0;
  const engagementRate =
    followersCount > 0 && avgInteractionsPerPost >= 0
      ? (avgInteractionsPerPost / followersCount) * 100
      : 0;

  const posts_per_week = computePostsPerWeek(posts);

  const avgViews = n > 0 ? totalViews / n : 0;
  const reach_ratio = followersCount > 0 ? avgViews / followersCount : 0;
  const conversation_rate = totalInteractions > 0 ? totalComments / totalInteractions : 0;
  const like_view_ratio = totalViews > 0 ? totalLikes / totalViews : null;
  const comments_per_follower = followersCount > 0 ? totalComments / followersCount : 0;

  return {
    posts_count: n,
    total_likes: totalLikes,
    total_comments: totalComments,
    total_views: totalViews,
    avg_likes: n > 0 ? Math.round(totalLikes / n) : 0,
    avg_comments: n > 0 ? Math.round(totalComments / n) : 0,
    avg_views: n > 0 ? Math.round(totalViews / n) : 0,
    engagement_rate: Math.round(engagementRate * 100) / 100,
    posts_per_week,
    reach_ratio: Math.round(reach_ratio * 10000) / 10000,
    conversation_rate: Math.round(conversation_rate * 100) / 100,
    like_view_ratio: like_view_ratio != null ? Math.round(like_view_ratio * 10000) / 10000 : null,
    comments_per_follower: Math.round(comments_per_follower * 100) / 100,
  };
}

/** Payload gravado no SQLite (FTS + aux) a cada sync de perfil/posts. */
export interface ProfileSearchIndexPayload {
  ftsText: string;
  engagementJson: string;
  hashtagsJson: string;
  searchBlob: string;
  /** Denormalizado em `profile_search_aux` para filtros/índice sem parsear JSON. */
  followersCount: number;
  engagementRate: number;
  avgLikes: number;
  postsCount: number;
  accountType: number | null;
  isPrivate: boolean;
  categoriesJson: string;
  llmQualificationJson: string | null;
  llmBrandLevel: string | null;
  llmPostSentiment: ProfilePostSentimentSummary | null;
}

export function buildProfileSearchIndexPayload(
  profile: Record<string, unknown>,
  key: string,
  posts: Record<string, unknown>[]
): ProfileSearchIndexPayload {
  const fullName = getFullName(profile);
  const baseCategories = getCategories(profile);
  const postHashtags = getAllHashtagsFromPosts(posts);
  const categoriesSet = new Set(
    [...baseCategories.map((c) => c.trim().toLowerCase()), ...postHashtags].filter(Boolean)
  );
  const categories = [...categoriesSet].sort();
  const ftsText = getSearchableText(profile, key, fullName, categories, posts);
  const followersCount = getFollowers(profile);
  const engagement = computeEngagement(posts, followersCount);
  const hashtags = getAllHashtagsFromPosts(posts);
  const accountType = getAccountType(profile);
  const categoriesJson = JSON.stringify(categories);
  const isPrivate = getIsPrivate(profile);
  const qual = getLlmQualification(profile);
  let llmQualificationJson: string | null = null;
  let llmBrandLevel: string | null = null;
  if (qual) {
    const mc = snapMainCategoryToTaxonomy(String(qual.mainCategory ?? '').trim());
    llmQualificationJson = JSON.stringify({
      ...qual,
      mainCategoryCanonical: mc ?? null,
    });
    llmBrandLevel = normalizeBrandSafetyLevel(qual.brandSafety);
  }
  const llmPostSentiment = computeProfilePostSentimentFromPosts(posts);
  return {
    ftsText,
    engagementJson: JSON.stringify(engagement),
    hashtagsJson: JSON.stringify(hashtags),
    searchBlob: ftsText,
    followersCount,
    engagementRate: engagement.engagement_rate,
    avgLikes: engagement.avg_likes,
    postsCount: engagement.posts_count,
    accountType: accountType ?? null,
    isPrivate,
    categoriesJson,
    llmQualificationJson,
    llmBrandLevel,
    llmPostSentiment,
  };
}


/** Monta filtro LLM para o atalho SQL (`llm_qualification_json` + `llm_brand_level`). */
function buildGlobalAuxLlmSqlFromQuery(query: ProfilesSearchQuery): GlobalAuxSqlLlmFilter | null {
  const profileTypes = parseStringArray(query.llmProfileType)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const mainCategoriesCanonical = parseStringArray(query.llmMainCategory)
    .map((s) => snapMainCategoryToTaxonomy(s.trim())?.toLowerCase())
    .filter((x): x is string => Boolean(x));
  const genders = parseStringArray(query.llmGender)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const languages = parseStringArray(query.llmLanguage)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const audienceTypes = parseStringArray(query.llmAudienceType)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const toneOfVoices = parseStringArray(query.llmToneOfVoice)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const riskSel = parseStringArray(query.llmRiskLevel);
  const brandSafetyLevels = riskSel
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((s) => (s === 'low' ? 'familia' : s === 'medium' ? 'sensivel' : s === 'high' ? 'adulto' : s))
    .filter((s): s is 'familia' | 'sensivel' | 'adulto' => s === 'familia' || s === 'sensivel' || s === 'adulto');
  let isFamilySafe: boolean | undefined;
  if (query.llmIsFamilySafe === true) isFamilySafe = true;
  else if (query.llmIsFamilySafe === false) isFamilySafe = false;
  let isAdultContent: boolean | undefined;
  if (query.llmIsAdultContent === true) isAdultContent = true;
  else if (query.llmIsAdultContent === false) isAdultContent = false;
  if (
    profileTypes.length === 0 &&
    mainCategoriesCanonical.length === 0 &&
    genders.length === 0 &&
    languages.length === 0 &&
    audienceTypes.length === 0 &&
    toneOfVoices.length === 0 &&
    brandSafetyLevels.length === 0 &&
    isFamilySafe === undefined &&
    isAdultContent === undefined
  ) {
    return null;
  }
  return {
    profileTypes,
    mainCategoriesCanonical,
    genders,
    languages,
    audienceTypes,
    toneOfVoices,
    brandSafetyLevels: [...brandSafetyLevels],
    isFamilySafe,
    isAdultContent,
  };
}

function buildGlobalAuxPostSentimentsFromQuery(query: ProfilesSearchQuery): string[] | null {
  const sentiments = parseStringArray(query.llmPostSentiment)
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is ProfilePostSentimentSummary => s === 'positivo' || s === 'negativo' || s === 'misto');
  return sentiments.length > 0 ? sentiments : null;
}

/** Filtro rápido de handles (SQLite `globalAuxSearchHandles`) — post-matches / campanha; evita `searchProfiles` no RocksDB. */
export function narrowHandlesByProfilesQuery(
  db: CompositeStorage,
  handlesInOrder: string[],
  query: ProfilesSearchQuery
): string[] {
  if (handlesInOrder.length === 0) return handlesInOrder;

  const minFollowers = query.minFollowers != null ? Number(query.minFollowers) : undefined;
  const maxFollowers = query.maxFollowers != null ? Number(query.maxFollowers) : undefined;
  const minEngagementRate = query.minEngagementRate != null ? Number(query.minEngagementRate) : undefined;
  const minAvgLikes = query.minAvgLikes != null ? Number(query.minAvgLikes) : undefined;
  const minPostsCount = query.minPostsCount != null ? Number(query.minPostsCount) : undefined;
  const engagementRateBucketsFilter = parseNumArray(query.engagementRateBuckets);
  const avgLikesBucketsFilter = parseNumArray(query.avgLikesBuckets);
  const postsCountBucketsFilter = parseNumArray(query.postsCountBuckets);
  const activationFilter = parseStringArray(query.activationFilter);
  const citiesFilter = parseStringArray(query.cities).map((s) => s.toLowerCase());
  const statesFilter = parseStringArray(query.states).map((s) => s.toLowerCase());
  const neighborhoodsFilter = parseStringArray(query.neighborhoods).map((s) => s.toLowerCase());
  const socialNetworksFilter = parseStringArray(query.socialNetworks).map((s) => s.toLowerCase());
  const excludePrivate = query.excludePrivate === true;
  const accountTypeFilter = parseNumArray(query.accountTypeFilter).filter((n) => [1, 2, 3].includes(n));
  let categoriesFilter: string[] = [];
  if (query.categories != null) {
    categoriesFilter = Array.isArray(query.categories)
      ? query.categories.map((c) => String(c).trim().toLowerCase()).filter(Boolean)
      : String(query.categories)
        .split(',')
        .map((c) => c.trim().toLowerCase())
        .filter(Boolean);
  }
  const contentTypesFilter = parseStringArray(query.contentTypes).map((s) => s.toLowerCase());
  const pricingFilters: Record<string, number[]> = {};
  const pricingKeys = ['pricingFeed', 'pricingReels', 'pricingStory', 'pricingDestaque'] as const;
  const pricingActivationKeys = ['feed', 'reels', 'story', 'destaque'] as const;
  for (let i = 0; i < pricingKeys.length; i++) {
    const arr = parseNumArray((query as Record<string, unknown>)[pricingKeys[i]]);
    if (arr.length > 0) pricingFilters[pricingActivationKeys[i]] = arr;
  }
  const costTierFilterRaw = parseStringArray(query.costTierFilter).map((s) => s.toLowerCase());
  const costTierFilter = costTierFilterRaw.filter((s): s is CostTier =>
    (['low', 'medium', 'high', 'very_high'] as const).includes(s as CostTier)
  ) as CostTier[];
  const sizeFilterRaw = parseStringArray(query.sizeFilter).map((s) => s.toLowerCase());
  const sizeFilterSet =
    sizeFilterRaw.length > 0
      ? new Set(sizeFilterRaw.map((s) => (s === 'mid' ? 'medio' : s === 'subnano' ? 'nano' : s)))
      : null;

  let followerRanges: { min: number; maxExclusive: number | null }[] | undefined;
  if (sizeFilterSet != null && sizeFilterSet.size > 0) {
    followerRanges = [];
    for (const sk of sizeFilterSet) {
      const b = FOLLOWERS_SIZE_BUCKETS.find((x) => x.key === sk);
      if (b) followerRanges.push({ min: b.min, maxExclusive: b.max ?? null });
    }
  }

  let activationMode: 'activated' | 'not' | null = null;
  if (activationFilter.length === 1) {
    const v = activationFilter[0]!.toLowerCase();
    if (v === 'activated') activationMode = 'activated';
    else if (v === 'not_activated' || v === 'not activated') activationMode = 'not';
  }

  const withNoPerfilCat = categoriesFilter.includes('no_perfil');
  const filterCategoriesSql = categoriesFilter.filter((c) => c !== 'no_perfil');
  const categoriesAny =
    withNoPerfilCat || filterCategoriesSql.length === 0 ? null : filterCategoriesSql;

  const baseFilter: Omit<GlobalAuxSqlFilter, 'restrictHandles'> = {
    ftsMatchExpr: null,
    minFollowers,
    maxFollowers,
    minEngagementRate,
    minAvgLikes,
    minPostsCount,
    engagementRateBuckets: engagementRateBucketsFilter,
    avgLikesBuckets: avgLikesBucketsFilter,
    postsCountBuckets: postsCountBucketsFilter,
    accountTypeFilter,
    followerRanges,
    sort: 'engagement_desc',
    excludePrivate,
    categoriesAny,
    requireIndexedLlm: false,
    activationMode,
    citiesLower: citiesFilter.length > 0 ? citiesFilter : null,
    statesLower: statesFilter.length > 0 ? statesFilter : null,
    neighborhoodsLower: neighborhoodsFilter.length > 0 ? neighborhoodsFilter : null,
    socialNetworksLower: socialNetworksFilter.length > 0 ? socialNetworksFilter : null,
    contentTypesLower: contentTypesFilter.length > 0 ? contentTypesFilter : null,
    pricingFeedValues: pricingFilters.feed?.length ? pricingFilters.feed : null,
    pricingReelsValues: pricingFilters.reels?.length ? pricingFilters.reels : null,
    pricingStoryValues: pricingFilters.story?.length ? pricingFilters.story : null,
    pricingDestaqueValues: pricingFilters.destaque?.length ? pricingFilters.destaque : null,
    costTiers: costTierFilter.length > 0 ? costTierFilter.map((s) => String(s).toLowerCase()) : null,
    llm: buildGlobalAuxLlmSqlFromQuery(query),
    postSentiments: buildGlobalAuxPostSentimentsFromQuery(query),
  };

  const CHUNK = 400;
  const allowed = new Set<string>();
  for (let i = 0; i < handlesInOrder.length; i += CHUNK) {
    const chunk = handlesInOrder.slice(i, i + CHUNK);
    const r = db.globalAuxSearchHandles({ ...baseFilter, restrictHandles: chunk });
    for (const h of r.handles) {
      allowed.add(String(h).toLowerCase().replace(/^@/, ''));
    }
  }
  return handlesInOrder.filter((h) => {
    const n = String(h).toLowerCase().replace(/^@/, '');
    return n && allowed.has(n);
  });
}

function costTierForSearchIndexUpsert(
  db: CompositeStorage,
  handle: string,
  payload: ProfileSearchIndexPayload
): string | null {
  const act = db.getActivation(handle);
  let tier = getCostTierFromPricing(act?.pricing as Record<string, unknown> | undefined);
  if (!tier) {
    tier = getCostTierFromPricing(
      getSuggestedPricingFromFollowers(payload.followersCount) as unknown as Record<string, unknown>
    );
  }
  return tier;
}

/** Normaliza URL da foto do perfil. */
function getProfilePicUrl(profile: Record<string, unknown>): string | undefined {
  const top = profile.profile_pic_url ?? profile.hd_profile_pic_url;
  if (top && typeof top === 'string') return top;
  const u = getDataUser(profile);
  const fromUser = u?.profile_pic_url ?? u?.hd_profile_pic_url;
  if (fromUser && typeof fromUser === 'string') return fromUser;
  const hd = u?.hd_profile_pic_url_info as { url?: string } | undefined;
  return hd?.url;
}

/** Opções extras para busca (ex.: restringir a uma lista de handles para campanha). */
export interface SearchProfilesOptions {
  /** Quando definido, só retorna perfis cujo handle está nesta lista (ex.: perfis de uma campanha). */
  restrictToHandles?: string[];
  /** Quando definido, usa esta lista em vez de carregar do DB (filtros/ordenação/facets aplicados em cima). */
  initialItems?: ProfileListItem[];
  /** Permite limit até 10000 numa única chamada (ex.: criação de campanha). Evita loop de paginação. */
  allowLargeLimit?: boolean;
  /**
   * Quando true, não calcula `bi` (InstagramBi): evita milhares de leituras Rocks em série
   * (ex.: aquecimento de cache de campanha com limit 10k). Listagens paginadas normais mantêm BI.
   */
  skipInstagramBi?: boolean;
  /**
   * Facetas da lista completa (cache após primeira carga). Com `initialItems` e sem filtros na query,
   * evita revarrer milhares de itens para recomputar facetas.
   */
  campaignBaseFacets?: ProfilesSearchFacets;
  /**
   * Quando true, não ordena itens antes de facetas/total. Ordem não afeta contagens;
   * use no GET /api/profiles/search (só expõe total + facets, sem lista).
   */
  skipSort?: boolean;
  /**
   * Quando true e não há linha em `profile_search_aux`, monta texto de busca só a partir do perfil
   * (sem ler posts no RocksDB) e usa engagement vazio — não persiste no SQLite.
   * Uso interno (ex.: filtrar handles antes de post-matches) sem custo de I/O; não use em listagens
   * globais se quiser o comportamento padrão de “só índice pronto”.
   */
  skipAuxBackfill?: boolean;
  /**
   * Quando true, reativa o caminho legado: lê posts no RocksDB e grava `profile_search_aux`/FTS durante a busca.
   * Reservado a scripts/reparo admin — não usar em rotas HTTP de tráfego normal.
   */
  allowAuxBackfill?: boolean;
  /**
   * Base completa / campanha: incluir perfis sem qualificação LLM concluída (post-matches e relatórios
   * usam todos os handles no storage; a busca global pública filtra só LLM pronta).
   */
  includeProfilesWithoutLlm?: boolean;
}

/** Filtra e ordena perfis; retorna lista com engajamento e facets para sumarização. */
export async function searchProfiles(
  db: CompositeStorage,
  query: ProfilesSearchQuery,
  options?: SearchProfilesOptions
): Promise<{ total: number; items: ProfileListItem[]; facets: ProfilesSearchFacets }> {
  const restrictToHandles = options?.restrictToHandles?.length
    ? new Set(options.restrictToHandles.map((h) => String(h).toLowerCase().replace(/^@/, '')))
    : null;
  /** SQLite costuma limitar ~999 variáveis por query; acima disso o atalho IN (…) quebra. */
  const restrictWithinSqlInLimit = restrictToHandles == null || restrictToHandles.size <= 800;

  const isCampaignScope = !!(options?.restrictToHandles?.length || options?.initialItems?.length);
  const limitCap = options?.allowLargeLimit ? 10000 : isCampaignScope ? 10000 : 200;
  const limit = Math.min(Math.max(0, Number(query.limit) || 50), limitCap);
  const offset = Math.max(0, Number(query.offset) || 0);
  const sort = (query.sort || 'engagement_desc').toLowerCase();
  const minFollowers = query.minFollowers != null ? Number(query.minFollowers) : undefined;
  const maxFollowers = query.maxFollowers != null ? Number(query.maxFollowers) : undefined;
  const minEngagementRate = query.minEngagementRate != null ? Number(query.minEngagementRate) : undefined;
  const minAvgLikes = query.minAvgLikes != null ? Number(query.minAvgLikes) : undefined;
  const minPostsCount = query.minPostsCount != null ? Number(query.minPostsCount) : undefined;
  const engagementRateBucketsFilter = parseNumArray(query.engagementRateBuckets);
  const avgLikesBucketsFilter = parseNumArray(query.avgLikesBuckets);
  const postsCountBucketsFilter = parseNumArray(query.postsCountBuckets);
  const activationFilter = parseStringArray(query.activationFilter);
  const citiesFilter = parseStringArray(query.cities).map((s) => s.toLowerCase());
  const statesFilter = parseStringArray(query.states).map((s) => s.toLowerCase());
  const neighborhoodsFilter = parseStringArray(query.neighborhoods).map((s) => s.toLowerCase());
  const socialNetworksFilter = parseStringArray(query.socialNetworks).map((s) => s.toLowerCase());
  const q = (query.q || '').trim().toLowerCase();
  /** Expressão FTS5 para o atalho SQL global com texto (`q`); null se `q` vazio ou só tokens curtos demais. */
  const ftsExprForGlobalSql = q ? userQueryToFtsMatchExpression(q) : null;
  const excludePrivate = query.excludePrivate === true;
  const accountTypeFilter = parseNumArray(query.accountTypeFilter).filter((n) => [1, 2, 3].includes(n));
  let categoriesFilter: string[] = [];
  if (query.categories != null) {
    categoriesFilter = Array.isArray(query.categories)
      ? query.categories.map((c) => String(c).trim().toLowerCase()).filter(Boolean)
      : String(query.categories)
        .split(',')
        .map((c) => c.trim().toLowerCase())
        .filter(Boolean);
  }
  const contentTypesFilter = parseStringArray(query.contentTypes).map((s) => s.toLowerCase());
  const pricingFilters: Record<string, number[]> = {};
  const pricingKeys = ['pricingFeed', 'pricingReels', 'pricingStory', 'pricingDestaque'] as const;
  const pricingActivationKeys = ['feed', 'reels', 'story', 'destaque'] as const;
  for (let i = 0; i < pricingKeys.length; i++) {
    const arr = parseNumArray((query as Record<string, unknown>)[pricingKeys[i]]);
    if (arr.length > 0) pricingFilters[pricingActivationKeys[i]] = arr;
  }
  const costTierFilterRaw = parseStringArray(query.costTierFilter).map((s) => s.toLowerCase());
  const costTierFilter = costTierFilterRaw.filter((s): s is CostTier =>
    (['low', 'medium', 'high', 'very_high'] as const).includes(s as CostTier)
  ) as CostTier[];
  const sizeFilterRaw = parseStringArray(query.sizeFilter).map((s) => s.toLowerCase());
  const sizeFilterSet = sizeFilterRaw.length > 0
    ? new Set(
      sizeFilterRaw.map((s) => (s === 'mid' ? 'medio' : s === 'subnano' ? 'nano' : s))
    )
    : null;
  const includeFacets = query.includeFacets !== false;

  const searchTiming = process.env.SEARCH_PROFILE_TIMING === '1';
  const searchT0 = Date.now();
  const searchMark = (label: string): void => {
    if (searchTiming) console.log(`[search-timing] ${label} +${Date.now() - searchT0}ms`);
  };

  const useInitialItems = options?.initialItems != null && options.initialItems.length > 0;

  /** Meili antes do atalho SQL: com hits do Meili não usamos `globalAuxSearchHandles`+FTS (mantém caminho legado + `ftsNarrowSet`). */
  let meiliHits: Awaited<ReturnType<typeof searchHandlesViaMeilisearch>> | null = null;
  if (!useInitialItems && q && restrictToHandles == null) {
    meiliHits = await searchHandlesViaMeilisearch(
      q,
      50_000,
      buildMeilisearchFilterExpr({
        excludePrivate,
        minFollowers,
        maxFollowers,
        minEngagementRate,
        minAvgLikes,
        minPostsCount,
        accountTypeFilter,
        costTiers: costTierFilter.length > 0 ? costTierFilter.map((s) => String(s).toLowerCase()) : undefined,
      })
    );
    searchMark('meili-text');
  }
  const meiliHitsNonEmpty = !!(meiliHits && meiliHits.length > 0);

  const hasAnyLlmFilterInQuery =
    parseStringArray(query.llmProfileType).length > 0 ||
    parseStringArray(query.llmMainCategory).length > 0 ||
    parseStringArray(query.llmGender).length > 0 ||
    parseStringArray(query.llmLanguage).length > 0 ||
    parseStringArray(query.llmAudienceType).length > 0 ||
    parseStringArray(query.llmToneOfVoice).length > 0 ||
    parseStringArray(query.llmRiskLevel).length > 0 ||
    query.llmIsFamilySafe === true ||
    query.llmIsFamilySafe === false ||
    query.llmIsAdultContent === true ||
    query.llmIsAdultContent === false;

  const hasPostSentimentFilterInQuery = parseStringArray(query.llmPostSentiment).length > 0;

  const pricingFiltersActive = pricingActivationKeys.some((k) => (pricingFilters[k]?.length ?? 0) > 0);

  let followerRanges: { min: number; maxExclusive: number | null }[] | undefined;
  if (sizeFilterSet != null && sizeFilterSet.size > 0) {
    followerRanges = [];
    for (const sk of sizeFilterSet) {
      const b = FOLLOWERS_SIZE_BUCKETS.find((x) => x.key === sk);
      if (b) followerRanges.push({ min: b.min, maxExclusive: b.max ?? null });
    }
  }

  const sqlSupportsRelevanceInGlobalSql = Boolean(q && ftsExprForGlobalSql && !meiliHitsNonEmpty);
  const sqlSortUnsupported = sort === 'relevance_desc' && !sqlSupportsRelevanceInGlobalSql;

  const globalSqlTextPathOk = !q || (ftsExprForGlobalSql != null && !meiliHitsNonEmpty);
  const globalSqlEligible =
    globalSqlTextPathOk &&
    !useInitialItems &&
    !options?.allowAuxBackfill &&
    !meiliHitsNonEmpty &&
    !sqlSortUnsupported &&
    restrictWithinSqlInLimit &&
    options?.includeProfilesWithoutLlm !== true;

  const withNoPerfilCat = categoriesFilter.includes('no_perfil');
  const filterCategoriesSql = categoriesFilter.filter((c) => c !== 'no_perfil');
  const categoriesAny =
    withNoPerfilCat || filterCategoriesSql.length === 0 ? null : filterCategoriesSql;

  let activationMode: 'activated' | 'not' | null = null;
  if (activationFilter.length === 1) {
    const v = activationFilter[0]!.toLowerCase();
    if (v === 'activated') activationMode = 'activated';
    else if (v === 'not_activated' || v === 'not activated') activationMode = 'not';
  }

  const globalAuxLlm = buildGlobalAuxLlmSqlFromQuery(query);
  const globalAuxPostSentiments = buildGlobalAuxPostSentimentsFromQuery(query);

  let useGlobalSqlPath = false;
  let globalSqlHandles: string[] = [];
  let ftsNarrowSet: Set<string> | null = null;
  let ftsRankByHandle: Map<string, number> | null = null;
  if (globalSqlEligible) {
    const ftsMatchExpr = ftsExprForGlobalSql && !meiliHitsNonEmpty ? ftsExprForGlobalSql : null;
    const r = db.globalAuxSearchHandles({
      ftsMatchExpr,
      minFollowers,
      maxFollowers,
      minEngagementRate,
      minAvgLikes,
      minPostsCount,
      engagementRateBuckets: engagementRateBucketsFilter,
      avgLikesBuckets: avgLikesBucketsFilter,
      postsCountBuckets: postsCountBucketsFilter,
      accountTypeFilter,
      followerRanges,
      sort,
      restrictHandles: restrictToHandles && restrictToHandles.size > 0 ? [...restrictToHandles] : null,
      excludePrivate,
      categoriesAny,
      requireIndexedLlm: restrictToHandles == null && options?.includeProfilesWithoutLlm !== true,
      activationMode,
      citiesLower: citiesFilter.length > 0 ? citiesFilter : null,
      statesLower: statesFilter.length > 0 ? statesFilter : null,
      neighborhoodsLower: neighborhoodsFilter.length > 0 ? neighborhoodsFilter : null,
      socialNetworksLower: socialNetworksFilter.length > 0 ? socialNetworksFilter : null,
      contentTypesLower: contentTypesFilter.length > 0 ? contentTypesFilter : null,
      pricingFeedValues: pricingFilters.feed?.length ? pricingFilters.feed : null,
      pricingReelsValues: pricingFilters.reels?.length ? pricingFilters.reels : null,
      pricingStoryValues: pricingFilters.story?.length ? pricingFilters.story : null,
      pricingDestaqueValues: pricingFilters.destaque?.length ? pricingFilters.destaque : null,
      costTiers: costTierFilter.length > 0 ? costTierFilter.map((s) => String(s).toLowerCase()) : null,
      llm: globalAuxLlm,
      postSentiments: globalAuxPostSentiments,
    });
    globalSqlHandles = r.handles;
    useGlobalSqlPath = true;
    if (ftsMatchExpr) {
      ftsRankByHandle = new Map();
      for (let gi = 0; gi < globalSqlHandles.length; gi++) {
        const h = globalSqlHandles[gi]!.toLowerCase().replace(/^@/, '');
        ftsRankByHandle.set(h, globalSqlHandles.length - gi);
      }
    }
    searchMark('sql-global-candidates');
  }

  /** Lista de campanha em cache + mesma query sem filtros: permite reutilizar facetas e pular re-sort. */
  const campaignNoFilters =
    !q &&
    accountTypeFilter.length === 0 &&
    minFollowers == null &&
    maxFollowers == null &&
    !excludePrivate &&
    engagementRateBucketsFilter.length === 0 &&
    minEngagementRate == null &&
    avgLikesBucketsFilter.length === 0 &&
    minAvgLikes == null &&
    postsCountBucketsFilter.length === 0 &&
    minPostsCount == null &&
    activationFilter.length === 0 &&
    citiesFilter.length === 0 &&
    statesFilter.length === 0 &&
    neighborhoodsFilter.length === 0 &&
    socialNetworksFilter.length === 0 &&
    contentTypesFilter.length === 0 &&
    !pricingFiltersActive &&
    costTierFilter.length === 0 &&
    sizeFilterSet == null &&
    !hasAnyLlmFilterInQuery &&
    !hasPostSentimentFilterInQuery &&
    categoriesFilter.length === 0;

  let profilesRaw: { key: string; value: Record<string, unknown> }[];
  if (!useInitialItems) {
    if (useGlobalSqlPath) {
      profilesRaw = [];
    } else if (searchDataCache) {
      profilesRaw = searchDataCache.profilesRaw;
    } else {
      logMemorySnapshot('search: cache vazio — lendo só perfis do disco nesta requisição');
      profilesRaw = await db.getByBucket<Record<string, unknown>>('profile');
      searchDataCache = { profilesRaw };
      logMemorySnapshot('search: cache de perfis preenchido a partir do disco', {
        profiles_n: profilesRaw.length,
      });
    }
  } else {
    profilesRaw = [];
  }

  const auxRows = !useInitialItems
    ? useGlobalSqlPath
      ? db.getProfileSearchAuxRowsForHandles(globalSqlHandles)
      : db.getAllProfileSearchAuxRows()
    : [];
  const auxByHandle = new Map<
    string,
    {
      engagement_json: string;
      hashtags_json: string;
      search_blob: string;
      followers_count: number;
      engagement_rate: number;
      avg_likes: number;
      posts_count: number;
      account_type: number | null;
      llm_post_sentiment: string | null;
    }
  >();
  for (const r of auxRows) {
    auxByHandle.set(r.handle, {
      engagement_json: r.engagement_json,
      hashtags_json: r.hashtags_json,
      search_blob: r.search_blob,
      followers_count: r.followers_count,
      engagement_rate: r.engagement_rate,
      avg_likes: r.avg_likes,
      posts_count: r.posts_count,
      account_type: r.account_type,
      llm_post_sentiment: r.llm_post_sentiment ?? null,
    });
  }

  searchMark('aux-map');

  /**
   * Backfill de índice durante a busca só com `allowAuxBackfill` (reparo/script).
   * Tráfego normal mantém índice via `syncProfileSearchIndexForHandle` na ingestão + `npm run rebuild-search-index` em massa.
   */
  if (!useGlobalSqlPath && options?.allowAuxBackfill === true && !useInitialItems && restrictToHandles != null && restrictToHandles.size > 0) {
    const missingAux = [...restrictToHandles].filter((h) => !auxByHandle.has(h));
    const AUX_BATCH = 20;
    for (let ai = 0; ai < missingAux.length; ai += AUX_BATCH) {
      const batch = missingAux.slice(ai, ai + AUX_BATCH);
      await Promise.all(
        batch.map(async (handle) => {
          const profile = await db.get<Record<string, unknown>>('profile', handle);
          if (!profile) return;
          const key = handle;
          const postsRawOne = await db.getByBucket<Record<string, unknown>>('post', `${handle}:`);
          const postsOne = postsRawOne.map(({ value: pv }) => pv);
          const payload = buildProfileSearchIndexPayload(profile, key, postsOne);
          db.upsertProfileSearchIndexFromPayload(handle, {
            ...payload,
            costTier: costTierForSearchIndexUpsert(db, handle, payload),
          });
          auxByHandle.set(handle, {
            engagement_json: payload.engagementJson,
            hashtags_json: payload.hashtagsJson,
            search_blob: payload.searchBlob,
            followers_count: payload.followersCount,
            engagement_rate: payload.engagementRate,
            avg_likes: payload.avgLikes,
            posts_count: payload.postsCount,
            account_type: payload.accountType,
            llm_post_sentiment: payload.llmPostSentiment ?? null,
          });
        })
      );
    }
  } else if (
    !useGlobalSqlPath &&
    options?.allowAuxBackfill === true &&
    !useInitialItems &&
    profilesRaw.length > 0 &&
    (restrictToHandles == null || restrictToHandles.size === 0)
  ) {
    /** Busca global + allowAuxBackfill: perfis LLM sem linha aux. */
    const rowsNeedingAux: { key: string; value: Record<string, unknown> }[] = [];
    const seenNeed = new Set<string>();
    for (const row of profilesRaw) {
      const v = row.value as Record<string, unknown>;
      if (!hasCompletedLlmProfile(v)) continue;
      const h = getHandle(v, row.key).toLowerCase().replace(/^@/, '');
      if (auxByHandle.has(h) || seenNeed.has(h)) continue;
      seenNeed.add(h);
      rowsNeedingAux.push(row);
    }
    const AUX_BATCH = 20;
    for (let ai = 0; ai < rowsNeedingAux.length; ai += AUX_BATCH) {
      const batch = rowsNeedingAux.slice(ai, ai + AUX_BATCH);
      await Promise.all(
        batch.map(async (row) => {
          const profile = row.value as Record<string, unknown>;
          const key = row.key;
          const handle = getHandle(profile, key).toLowerCase().replace(/^@/, '');
          const postsRawOne = await db.getByBucket<Record<string, unknown>>('post', `${handle}:`);
          const postsOne = postsRawOne.map(({ value: pv }) => pv);
          const payload = buildProfileSearchIndexPayload(profile, key, postsOne);
          db.upsertProfileSearchIndexFromPayload(handle, {
            ...payload,
            costTier: costTierForSearchIndexUpsert(db, handle, payload),
          });
          auxByHandle.set(handle, {
            engagement_json: payload.engagementJson,
            hashtags_json: payload.hashtagsJson,
            search_blob: payload.searchBlob,
            followers_count: payload.followersCount,
            engagement_rate: payload.engagementRate,
            avg_likes: payload.avgLikes,
            posts_count: payload.postsCount,
            account_type: payload.accountType,
            llm_post_sentiment: payload.llmPostSentiment ?? null,
          });
        })
      );
    }
  }

  let excludedForMissingAux = 0;

  if (!useInitialItems && q && restrictToHandles == null) {
    if (meiliHitsNonEmpty && meiliHits) {
      ftsNarrowSet = new Set(meiliHits.map((r) => r.handle));
      ftsRankByHandle = new Map();
      for (const r of meiliHits) ftsRankByHandle.set(r.handle, r.rank);
    } else if (!useGlobalSqlPath) {
      const expr = ftsExprForGlobalSql;
      if (expr) {
        const ftsRows = db.searchProfileHandlesFts(expr, 50_000);
        if (ftsRows.length > 0) {
          ftsNarrowSet = new Set(ftsRows.map((r) => r.handle));
          ftsRankByHandle = new Map();
          for (let fi = 0; fi < ftsRows.length; fi++) {
            ftsRankByHandle.set(ftsRows[fi]!.handle, ftsRows.length - fi);
          }
        }
      }
    }
  }

  searchMark('text-narrow');

  const emptyEngagement: EngagementStats = {
    posts_count: 0,
    total_likes: 0,
    total_comments: 0,
    total_views: 0,
    avg_likes: 0,
    avg_comments: 0,
    avg_views: 0,
    engagement_rate: 0,
  };

  let items: ProfileListItem[] = [];
  if (useInitialItems) {
    // Só rotas de campanha usam initialItems; a lista deve refletir todos os handles do relatório
    // (o cartão usa handlesCount), não só quem já tem LLM concluída.
    items = options!.initialItems!;
  } else {
    const restrictSparse =
      restrictToHandles != null &&
      restrictToHandles.size > 0 &&
      restrictToHandles.size * 2 < profilesRaw.length;

    let profileRowsForSearch: { key: string; value: Record<string, unknown> }[];
    if (useGlobalSqlPath) {
      profileRowsForSearch = [];
      const byHandleFromCache = new Map<string, { key: string; value: Record<string, unknown> }>();
      if (searchDataCache?.profilesRaw) {
        for (const row of searchDataCache.profilesRaw) {
          const v = row.value as Record<string, unknown>;
          const h = getHandle(v, row.key).toLowerCase().replace(/^@/, '');
          if (!byHandleFromCache.has(h)) byHandleFromCache.set(h, row);
        }
      }
      for (const handleRaw of globalSqlHandles) {
        const handle = handleRaw.toLowerCase().replace(/^@/, '');
        const cached = byHandleFromCache.get(handle);
        if (cached) {
          profileRowsForSearch.push(cached);
        } else {
          const p = await db.get<Record<string, unknown>>('profile', handle);
          if (p) profileRowsForSearch.push({ key: handle, value: p });
        }
      }
    } else if (restrictSparse) {
      const byHandle = new Map<string, { key: string; value: Record<string, unknown> }>();
      for (const row of profilesRaw) {
        const v = row.value as Record<string, unknown>;
        const h = getHandle(v, row.key).toLowerCase().replace(/^@/, '');
        if (!byHandle.has(h)) byHandle.set(h, row);
      }
      profileRowsForSearch = [];
      for (const h of restrictToHandles!) {
        const row = byHandle.get(h);
        if (row) profileRowsForSearch.push(row);
      }
    } else {
      profileRowsForSearch = profilesRaw;
    }

    for (const { key, value } of profileRowsForSearch) {
      const profile = value as Record<string, unknown>;
      const handle = getHandle(profile, key).toLowerCase().replace(/^@/, '');
      if (!restrictSparse && restrictToHandles && !restrictToHandles.has(handle)) continue;
      // Busca geral: só perfis com qualificação LLM pronta. Campanha / base completa: todos no escopo.
      if (
        !restrictToHandles &&
        options?.includeProfilesWithoutLlm !== true &&
        !hasCompletedLlmProfile(profile)
      ) {
        continue;
      }

      if (q && ftsNarrowSet !== null && !ftsNarrowSet.has(handle)) continue;

      const fullName = getFullName(profile);
      const baseCategories = getCategories(profile);
      let aux = auxByHandle.get(handle);
      if (!aux) {
        if (options?.allowAuxBackfill) {
          const postsRawOne = await db.getByBucket<Record<string, unknown>>('post', `${handle}:`);
          const postsOne = postsRawOne.map(({ value: pv }) => pv);
          const payload = buildProfileSearchIndexPayload(profile, key, postsOne);
          db.upsertProfileSearchIndexFromPayload(handle, {
            ...payload,
            costTier: costTierForSearchIndexUpsert(db, handle, payload),
          });
          aux = {
            engagement_json: payload.engagementJson,
            hashtags_json: payload.hashtagsJson,
            search_blob: payload.searchBlob,
            followers_count: payload.followersCount,
            engagement_rate: payload.engagementRate,
            avg_likes: payload.avgLikes,
            posts_count: payload.postsCount,
            account_type: payload.accountType,
            llm_post_sentiment: payload.llmPostSentiment ?? null,
          };
          auxByHandle.set(handle, aux);
        } else if (options?.skipAuxBackfill) {
          const searchBlob = getSearchableTextProfileOnly(profile, key, fullName, baseCategories);
          aux = {
            engagement_json: JSON.stringify(emptyEngagement),
            hashtags_json: '[]',
            search_blob: searchBlob,
            followers_count: 0,
            engagement_rate: 0,
            avg_likes: 0,
            posts_count: 0,
            account_type: null,
            llm_post_sentiment: null,
          };
          auxByHandle.set(handle, aux);
        } else {
          excludedForMissingAux++;
          continue;
        }
      }

      let engagement: EngagementStats;
      try {
        engagement = JSON.parse(aux.engagement_json) as EngagementStats;
        if (typeof engagement?.posts_count !== 'number') throw new Error('invalid');
      } catch {
        engagement = emptyEngagement;
      }

      let postHashtags: string[] = [];
      try {
        const parsed = JSON.parse(aux.hashtags_json) as unknown;
        if (Array.isArray(parsed)) postHashtags = parsed.filter((x): x is string => typeof x === 'string');
      } catch {
        postHashtags = [];
      }

      const followersCount = getFollowers(profile);
      const categoriesSet = new Set<string>(
        [...baseCategories.map((c) => c.trim().toLowerCase()), ...postHashtags].filter(Boolean)
      );
      const categories = [...categoriesSet].sort();

      if (minFollowers != null && followersCount < minFollowers) continue;
      if (maxFollowers != null && followersCount > maxFollowers) continue;
      if (excludePrivate && getIsPrivate(profile)) continue;
      if (accountTypeFilter.length > 0) {
        const at = getAccountType(profile);
        if (at == null || !accountTypeFilter.includes(at)) continue;
      }

      if (engagementRateBucketsFilter.length > 0) {
        if (!matchesEngagementRateBuckets(engagement.engagement_rate, engagementRateBucketsFilter)) continue;
      } else if (minEngagementRate != null && engagement.engagement_rate < minEngagementRate) continue;
      if (avgLikesBucketsFilter.length > 0) {
        if (!matchesAvgLikesBuckets(engagement.avg_likes, avgLikesBucketsFilter)) continue;
      } else if (minAvgLikes != null && engagement.avg_likes < minAvgLikes) continue;
      if (postsCountBucketsFilter.length > 0) {
        if (!matchesPostsCountBuckets(engagement.posts_count, postsCountBucketsFilter)) continue;
      } else if (minPostsCount != null && engagement.posts_count < minPostsCount) continue;

      let searchRelevance: number | undefined;
      if (q) {
        const mq = matchesQuery(aux.search_blob, q);
        if (!mq.match) continue;
        searchRelevance = combineSearchRelevance(mq.relevance, ftsRankByHandle?.get(handle));
      }

      if (!restrictToHandles && categoriesFilter.length > 0) {
        const withNoPerfil = categoriesFilter.includes('no_perfil');
        const filterCategories = categoriesFilter.filter((c) => c !== 'no_perfil');
        // Com `no_perfil` na query (wizard / URL): não restringe por categoria — o total inclui quem bateu na busca
        // mas não está nas hashtags do facet (“no perfil”); nunca excluir esse bloco.
        if (filterCategories.length > 0 && !withNoPerfil) {
          const hasCategory = filterCategories.some((fc) => categories.some((c) => c.toLowerCase() === fc));
          if (!hasCategory) continue;
        }
      }

      const pic = getProfilePicUrl(profile);
      const at = getAccountType(profile);
      const item: ProfileListItem = {
        key,
        handle,
        full_name: fullName,
        followers_count: followersCount,
        following_count: toNum(profile.following_count ?? getDataUser(profile)?.following_count),
        media_count: (profile.media_count ?? getDataUser(profile)?.media_count) as number | undefined,
        biography: (profile.biography ?? getDataUser(profile)?.biography) as string | undefined,
        categories,
        engagement,
        ...(searchRelevance != null && { search_relevance: searchRelevance }),
        ...(pic && { profile_pic_url: pic }),
        data: profile.data as Record<string, unknown> | undefined,
        ...(at != null && { account_type: at }),
      };
      Object.assign(item, profile);
      item.categories = categories;
      if (aux.llm_post_sentiment) {
        (item as Record<string, unknown>).llm_post_sentiment = aux.llm_post_sentiment;
      }
      if (q) {
        (item as Record<string, unknown>)._searchable_text = aux.search_blob;
      }
      items.push(item);
    }
  }

  /** Timestamp (ms) da data de atualização do perfil (_collected_at ISO) para ordenação. */
  const getCollectedAtMs = (item: ProfileListItem): number => {
    const v = (item as Record<string, unknown>)._collected_at;
    if (v == null) return 0;
    if (typeof v === 'string') {
      const t = new Date(v).getTime();
      return Number.isNaN(t) ? 0 : t;
    }
    return 0;
  };

  type SortKey = 'relevance_desc' | 'engagement_desc' | 'engagement_asc' | 'followers_desc' | 'followers_asc' | 'avg_likes_desc' | 'avg_likes_asc' | 'total_likes_desc' | 'total_likes_asc';
  const order = sort as SortKey;

  const sortByOrder = (a: ProfileListItem, b: ProfileListItem): number => {
    if (order === 'relevance_desc') {
      if (q) {
        const relA = a.search_relevance ?? 0;
        const relB = b.search_relevance ?? 0;
        if (relB !== relA) return relB - relA;
        return getCollectedAtMs(b) - getCollectedAtMs(a);
      }
      return getCollectedAtMs(b) - getCollectedAtMs(a);
    }
    if (order === 'engagement_desc') return b.engagement.engagement_rate - a.engagement.engagement_rate;
    if (order === 'engagement_asc') return a.engagement.engagement_rate - b.engagement.engagement_rate;
    if (order === 'followers_desc') return b.followers_count - a.followers_count;
    if (order === 'followers_asc') return a.followers_count - b.followers_count;
    if (order === 'avg_likes_desc') return b.engagement.avg_likes - a.engagement.avg_likes;
    if (order === 'avg_likes_asc') return a.engagement.avg_likes - b.engagement.avg_likes;
    if (order === 'total_likes_desc') return b.engagement.total_likes - a.engagement.total_likes;
    if (order === 'total_likes_asc') return a.engagement.total_likes - b.engagement.total_likes;
    return 0;
  };

  /** Enriquece cada item com dados de ativação (SQLite) em uma única query em lote. */
  if (!useInitialItems) {
    const handles = items.map((i) => i.handle);
    const activationsMap = db.getActivationsBatch(handles);
    for (const item of items) {
      const act = activationsMap.get(item.handle);
      if (act) item.activation = act;
    }
  }

  /** Filtros por ativação, cidade, estado, bairro e redes (multiselect). Aplicados também quando useInitialItems (ex.: campanha com pagamento pendente). */
  let filteredItems = items;
  if (!(useInitialItems && campaignNoFilters)) {
    if (accountTypeFilter.length > 0) {
      filteredItems = filteredItems.filter((i) => {
        const at = (i as ProfileListItem & { account_type?: number }).account_type;
        return at != null && accountTypeFilter.includes(at);
      });
    }
    if (minFollowers != null) {
      filteredItems = filteredItems.filter((i) => (i.followers_count ?? 0) >= minFollowers);
    }
    if (maxFollowers != null) {
      filteredItems = filteredItems.filter((i) => (i.followers_count ?? 0) <= maxFollowers);
    }
    if (excludePrivate) {
      filteredItems = filteredItems.filter((i) => !(i as ProfileListItem & { is_private?: boolean }).is_private);
    }
    if (engagementRateBucketsFilter.length > 0) {
      filteredItems = filteredItems.filter((i) =>
        matchesEngagementRateBuckets(i.engagement?.engagement_rate ?? 0, engagementRateBucketsFilter)
      );
    } else if (minEngagementRate != null) {
      filteredItems = filteredItems.filter((i) => (i.engagement?.engagement_rate ?? 0) >= minEngagementRate);
    }
    if (avgLikesBucketsFilter.length > 0) {
      filteredItems = filteredItems.filter((i) =>
        matchesAvgLikesBuckets(i.engagement?.avg_likes ?? 0, avgLikesBucketsFilter)
      );
    } else if (minAvgLikes != null) {
      filteredItems = filteredItems.filter((i) => (i.engagement?.avg_likes ?? 0) >= minAvgLikes);
    }
    if (postsCountBucketsFilter.length > 0) {
      filteredItems = filteredItems.filter((i) =>
        matchesPostsCountBuckets(i.engagement?.posts_count ?? 0, postsCountBucketsFilter)
      );
    } else if (minPostsCount != null) {
      filteredItems = filteredItems.filter((i) => (i.engagement?.posts_count ?? 0) >= minPostsCount);
    }
    if (activationFilter.length === 1) {
      const wantActivated = activationFilter[0]!.toLowerCase() === 'activated';
      filteredItems = filteredItems.filter((i) => (wantActivated ? !!i.activation : !i.activation));
    }
    if (citiesFilter.length > 0) {
      filteredItems = filteredItems.filter(
        (i) => i.activation?.city?.trim() && citiesFilter.includes(i.activation.city!.trim().toLowerCase())
      );
    }
    if (statesFilter.length > 0) {
      filteredItems = filteredItems.filter(
        (i) => i.activation?.state?.trim() && statesFilter.includes(i.activation.state!.trim().toLowerCase())
      );
    }
    if (neighborhoodsFilter.length > 0) {
      filteredItems = filteredItems.filter((i) => {
        const raw = i.activation?.neighborhood?.trim();
        if (!raw) return false;
        const parts = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
        return parts.some((p) => neighborhoodsFilter.includes(p));
      });
    }
    if (socialNetworksFilter.length > 0) {
      const hasNetwork = (act: ProfileActivationData, net: string): boolean => {
        const n = net.toLowerCase();
        if (n === 'whatsapp') return !!(act.whatsapp?.trim());
        if (n === 'tiktok') return !!(act.tiktok?.trim());
        if (n === 'facebook') return !!(act.facebook?.trim());
        if (n === 'linkedin') return !!(act.linkedin?.trim());
        if (n === 'twitter') return !!(act.twitter?.trim());
        return false;
      };
      filteredItems = filteredItems.filter(
        (i) => i.activation && socialNetworksFilter.some((net) => hasNetwork(i.activation!, net))
      );
    }
    if (contentTypesFilter.length > 0) {
      filteredItems = filteredItems.filter((i) => {
        const ct = i.activation?.content_type;
        if (!ct || !Array.isArray(ct)) return false;
        const ctLower = ct.map((c) => String(c).trim().toLowerCase()).filter(Boolean);
        return contentTypesFilter.some((fc) => ctLower.includes(fc));
      });
    }
    for (const [actKey, allowedBuckets] of Object.entries(pricingFilters)) {
      if (allowedBuckets.length === 0) continue;
      filteredItems = filteredItems.filter((i) => {
        const pricing = i.activation?.pricing as Record<string, unknown> | undefined;
        if (!pricing) return false;
        const raw = pricing[actKey];
        if (raw === undefined || raw === null || raw === '') return false;
        const num = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isFinite(num)) return false;
        return allowedBuckets.includes(num);
      });
    }

    if (costTierFilter.length > 0) {
      const tierSet = new Set(costTierFilter);
      filteredItems = filteredItems.filter((i) => {
        let tier = getCostTierFromPricing(i.activation?.pricing as Record<string, unknown> | undefined);
        if (!tier && Number.isFinite(i.followers_count)) {
          const suggested = getSuggestedPricingFromFollowers(i.followers_count ?? 0);
          tier = getCostTierFromPricing(suggested as unknown as Record<string, unknown>);
        }
        return tier != null && tierSet.has(tier);
      });
    }

    if (sizeFilterSet != null && sizeFilterSet.size > 0) {
      filteredItems = filteredItems.filter((i) => {
        const fc = i.followers_count ?? 0;
        return sizeFilterSet.has(followersCountToSizeKey(fc));
      });
    }

    if (hasAnyLlmFilterInQuery) {
      filteredItems = filteredItems.filter((i) =>
        matchesLlmQualificationFilters(i as unknown as Record<string, unknown>, query)
      );
    }

    if (hasPostSentimentFilterInQuery) {
      filteredItems = filteredItems.filter((i) =>
        matchesPostSentimentFilter(i as unknown as Record<string, unknown>, query)
      );
    }

    if (q && useInitialItems) {
      filteredItems = filteredItems.filter((i) => {
        const text = getSearchableTextFromItem(i);
        const { match, relevance } = matchesQuery(text, q);
        if (match) {
          (i as ProfileListItem & { search_relevance?: number }).search_relevance = relevance;
          return true;
        }
        return false;
      });
    }
  }

  items = filteredItems;

  const skipResortEngagement =
    useInitialItems && campaignNoFilters && order === 'engagement_desc';

  if (!options?.skipSort) {
    if (order === 'relevance_desc') {
      items.sort(sortByOrder);
    } else if (q && ftsNarrowSet != null) {
      /** Caminho legado com `ftsNarrowSet` (Meili ou FTS isolado): relevância textual primeiro. Com atalho SQL+FTS, `ftsNarrowSet` fica null e preserva a ordem SQL + `sortByOrder`. */
      items.sort((a, b) => {
        const relA = a.search_relevance ?? 0;
        const relB = b.search_relevance ?? 0;
        if (relB !== relA) return relB - relA;
        return sortByOrder(a, b);
      });
    } else if (!skipResortEngagement) {
      items.sort(sortByOrder);
    }
  }

  const total = items.length;

  /** Facets calculados sobre o conjunto completo filtrado (para sumarização na UI). Omitidos quando includeFacets=false (ex.: paginação). */
  let facets: ProfilesSearchFacets;
  if (
    includeFacets &&
    useInitialItems &&
    campaignNoFilters &&
    options?.campaignBaseFacets != null
  ) {
    facets = options.campaignBaseFacets;
  } else if (includeFacets) {
    let activatedCount = 0;
    const categoryCount = new Map<string, number>();
    const contentTypeCount = new Map<string, number>();
    const cityCount = new Map<string, number>();
    const stateCount = new Map<string, number>();
    const neighborhoodCount = new Map<string, number>();
    const socialCount = { whatsapp: 0, tiktok: 0, facebook: 0, linkedin: 0, twitter: 0 };
    const engagementRateBuckets = [
      { key: 'baixa', label: 'Baixa', min: undefined as number | undefined, count: 0 },
      { key: 'media', label: 'Média', min: 1, count: 0 },
      { key: 'alta', label: 'Alta', min: 5, count: 0 },
    ];
    const followersBuckets = createEmptyFollowersBucketsForFacets();
    const accountTypeBuckets = [
      { value: 1, label: 'Pessoal', count: 0 },
      { value: 2, label: 'Criador', count: 0 },
      { value: 3, label: 'Empresa', count: 0 },
    ];
    const avgLikesBuckets = [
      { key: 'baixa', label: 'Baixa', min: undefined as number | undefined, count: 0 },
      { key: 'media', label: 'Média', min: 500, count: 0 },
      { key: 'alta', label: 'Alta', min: 5000, count: 0 },
    ];
    const postsCountBuckets = [
      { key: 'baixa', label: 'Baixa', min: undefined as number | undefined, count: 0 },
      { key: 'media', label: 'Média', min: 25, count: 0 },
      { key: 'alta', label: 'Alta', min: 50, count: 0 },
    ];

    const handlesForNumericFacetSql = [...new Set(items.map((i) => String(i.handle).toLowerCase().replace(/^@/, '')))];
    let sqlNumericAgg: AuxNumericFacetAggregate | null = null;
    if (
      handlesForNumericFacetSql.length > 0 &&
      handlesForNumericFacetSql.length <= SqliteSync.GLOBAL_AUX_SQL_HANDLE_CAP
    ) {
      const agg = db.aggregateAuxNumericFacetsForHandles(handlesForNumericFacetSql);
      if (agg && agg.auxRowCount === handlesForNumericFacetSql.length) {
        sqlNumericAgg = agg;
        const s = agg.sums;
        engagementRateBuckets[0]!.count = s.engagement_baixa;
        engagementRateBuckets[1]!.count = s.engagement_media;
        engagementRateBuckets[2]!.count = s.engagement_alta;
        followersBuckets[0]!.count = s.followers_nano;
        followersBuckets[1]!.count = s.followers_micro;
        followersBuckets[2]!.count = s.followers_medio;
        followersBuckets[3]!.count = s.followers_macro;
        followersBuckets[4]!.count = s.followers_elite;
        followersBuckets[5]!.count = s.followers_celebridade;
        accountTypeBuckets[0]!.count = s.account_pessoal;
        accountTypeBuckets[1]!.count = s.account_criador;
        accountTypeBuckets[2]!.count = s.account_empresa;
        avgLikesBuckets[0]!.count = s.avg_likes_baixa;
        avgLikesBuckets[1]!.count = s.avg_likes_media;
        avgLikesBuckets[2]!.count = s.avg_likes_alta;
        postsCountBuckets[0]!.count = s.posts_baixa;
        postsCountBuckets[1]!.count = s.posts_media;
        postsCountBuckets[2]!.count = s.posts_alta;
      }
    }

    const pricingCounts: Record<(typeof pricingActivationKeys)[number], Map<number, number>> = {
      feed: new Map(),
      reels: new Map(),
      story: new Map(),
      destaque: new Map(),
    };
    const costTierCount = new Map<CostTier, number>();
    const llmFacetMaps = createEmptyLlmFacetMaps();

    for (const item of items) {
      if (item.activation) {
        activatedCount++;
        const act = item.activation;
        if (act.city?.trim()) cityCount.set(act.city.trim().toLowerCase(), (cityCount.get(act.city.trim().toLowerCase()) ?? 0) + 1);
        if (act.state?.trim()) stateCount.set(act.state.trim().toLowerCase(), (stateCount.get(act.state.trim().toLowerCase()) ?? 0) + 1);
        if (act.neighborhood?.trim()) {
          const parts = act.neighborhood.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
          for (const p of parts) neighborhoodCount.set(p, (neighborhoodCount.get(p) ?? 0) + 1);
        }
        if (act.whatsapp?.trim()) socialCount.whatsapp++;
        if (act.tiktok?.trim()) socialCount.tiktok++;
        if (act.facebook?.trim()) socialCount.facebook++;
        if (act.linkedin?.trim()) socialCount.linkedin++;
        if (act.twitter?.trim()) socialCount.twitter++;
        const ct = act.content_type;
        if (Array.isArray(ct)) {
          for (const v of ct) {
            if (v && typeof v === 'string') {
              const k = v.trim().toLowerCase();
              if (k) contentTypeCount.set(k, (contentTypeCount.get(k) ?? 0) + 1);
            }
          }
        }
        const pricing = act.pricing as Record<string, unknown> | undefined;
        if (pricing && typeof pricing === 'object') {
          for (const actKey of pricingActivationKeys) {
            const raw = pricing[actKey];
            if (raw === undefined || raw === null || raw === '') continue;
            const num = typeof raw === 'number' ? raw : Number(raw);
            if (!Number.isFinite(num)) continue;
            const map = pricingCounts[actKey];
            map.set(num, (map.get(num) ?? 0) + 1);
          }
        }
        let tier = getCostTierFromPricing(act.pricing as Record<string, unknown> | undefined);
        if (!tier) {
          const suggested = getSuggestedPricingFromFollowers(item.followers_count ?? 0);
          tier = getCostTierFromPricing(suggested as unknown as Record<string, unknown>);
        }
        if (tier) costTierCount.set(tier, (costTierCount.get(tier) ?? 0) + 1);
      } else {
        const suggested = getSuggestedPricingFromFollowers(item.followers_count ?? 0);
        const tier = getCostTierFromPricing(suggested as unknown as Record<string, unknown>);
        if (tier) costTierCount.set(tier, (costTierCount.get(tier) ?? 0) + 1);
      }
      for (const c of item.categories ?? []) {
        if (c && typeof c === 'string') {
          const key = c.trim().toLowerCase();
          if (key) categoryCount.set(key, (categoryCount.get(key) ?? 0) + 1);
        }
      }
      if (!sqlNumericAgg) {
        const rate = item.engagement?.engagement_rate ?? 0;
        const avgLikes = item.engagement?.avg_likes ?? 0;
        const postsCount = item.engagement?.posts_count ?? 0;
        if (rate < 1) engagementRateBuckets[0]!.count++;
        else if (rate < 5) engagementRateBuckets[1]!.count++;
        else engagementRateBuckets[2]!.count++;
        incrementFollowersBucketCount(followersBuckets, item.followers_count);
        const at = (item as ProfileListItem & { account_type?: number }).account_type;
        if (at === 1) accountTypeBuckets[0]!.count++;
        else if (at === 2) accountTypeBuckets[1]!.count++;
        else if (at === 3) accountTypeBuckets[2]!.count++;
        if (avgLikes < 500) avgLikesBuckets[0]!.count++;
        else if (avgLikes < 5000) avgLikesBuckets[1]!.count++;
        else avgLikesBuckets[2]!.count++;
        if (postsCount < 25) postsCountBuckets[0]!.count++;
        else if (postsCount < 50) postsCountBuckets[1]!.count++;
        else postsCountBuckets[2]!.count++;
      }

      accumulateLlmFacetsFromItem(item, llmFacetMaps);
    }

    facets = {
      categories: [...categoryCount.entries()]
        .filter(([, count]) => count > 0)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
      engagement_rate: engagementRateBuckets,
      avg_likes: avgLikesBuckets,
      posts_count: postsCountBuckets,
      activation: { activated: activatedCount, not_activated: total - activatedCount },
      content_type: [...contentTypeCount.entries()]
        .filter(([, count]) => count > 0)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
      cities: [...cityCount.entries()].filter(([, count]) => count > 0).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      states: [...stateCount.entries()].filter(([, count]) => count > 0).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      neighborhoods: [...neighborhoodCount.entries()].filter(([, count]) => count > 0).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      social: socialCount,
      followers_buckets: followersBuckets.map(({ key, label, min, max, count }) => ({ key, label, min, max, count })),
      account_type: accountTypeBuckets.map(({ value, label, count }) => ({ value, label, count })),
      pricing: Object.fromEntries(
        pricingActivationKeys.map((actKey) => [
          actKey,
          [...pricingCounts[actKey].entries()]
            .filter(([, count]) => count > 0)
            .map(([value, count]) => ({ value, count }))
            .sort((a, b) => a.value - b.value),
        ])
      ) as Record<(typeof pricingActivationKeys)[number], { value: number; count: number }[]>,
      cost_tier: [...costTierCount.entries()]
        .filter(([, count]) => count > 0)
        .map(([tier, count]) => ({ tier, count }))
        .sort((a, b) => b.count - a.count),
      llm: mapsToLlmSearchFacets(llmFacetMaps),
    };
  } else {
    facets = {
      categories: [],
      engagement_rate: [
        { key: 'baixa', label: 'Baixa', min: undefined, count: 0 },
        { key: 'media', label: 'Média', min: 1, count: 0 },
        { key: 'alta', label: 'Alta', min: 5, count: 0 },
      ],
      avg_likes: [
        { key: 'baixa', label: 'Baixa', min: undefined, count: 0 },
        { key: 'media', label: 'Média', min: 500, count: 0 },
        { key: 'alta', label: 'Alta', min: 5000, count: 0 },
      ],
      posts_count: [
        { key: 'baixa', label: 'Baixa', min: undefined, count: 0 },
        { key: 'media', label: 'Média', min: 25, count: 0 },
        { key: 'alta', label: 'Alta', min: 50, count: 0 },
      ],
      activation: { activated: 0, not_activated: total },
      content_type: [],
      cities: [],
      states: [],
      neighborhoods: [],
      social: { whatsapp: 0, tiktok: 0, facebook: 0, linkedin: 0, twitter: 0 },
      followers_buckets: createEmptyFollowersBucketsForFacets(),
      account_type: [
        { value: 1, label: 'Pessoal', count: 0 },
        { value: 2, label: 'Criador', count: 0 },
        { value: 3, label: 'Empresa', count: 0 },
      ],
      pricing: Object.fromEntries(
        pricingActivationKeys.map((actKey) => [actKey, [] as { value: number; count: number }[]])
      ) as Record<(typeof pricingActivationKeys)[number], { value: number; count: number }[]>,
      cost_tier: [],
      llm: emptyLlmSearchFacets(),
    };
  }

  const slice = items.slice(offset, offset + limit);
  /**
   * BI: lê posts só dos handles do slice (não o corpus inteiro).
   * Em lotes paralelos para não serializar centenas/milhares de round-trips ao Level/Rocks.
   */
  const skipBiLargeSlice = slice.length > 400;
  if (!options?.skipInstagramBi && !skipBiLargeSlice && slice.length > 0) {
    const BI_PARALLEL = 32;
    for (let i = 0; i < slice.length; i += BI_PARALLEL) {
      const chunk = slice.slice(i, i + BI_PARALLEL);
      await Promise.all(
        chunk.map(async (item) => {
          const postsRows = await db.getByBucket<Record<string, unknown>>('post', `${item.handle}:`);
          const postsForBi = postsRows.map((r) => r.value) as PostForBi[];
          const followersForBi = item.followers_count;
          if (postsForBi.length >= 2 && followersForBi != null) {
            try {
              item.bi = computeInstagramBi(followersForBi, postsForBi);
            } catch {
              // ignora falha no BI (dados incompletos)
            }
          }
        })
      );
    }
  }

  if (!useInitialItems && excludedForMissingAux > 0) {
    console.warn(
      `[profiles-search] ${excludedForMissingAux} perfil(is) omitidos: sem linha em profile_search_aux (índice de busca). ` +
        'O índice é atualizado na ingestão (save/savePosts/saveMedia); após importação em massa rode na pasta backend: npm run rebuild-search-index',
    );
  }

  searchMark('return');
  return { total, items: slice, facets };
}

/** Resumo do perfil com engagement e BI (para GET /profiles/:handle/summary). */
export interface ProfileSummary {
  profile: Record<string, unknown>;
  engagement: EngagementStats;
  bi?: InstagramBi;
}

export async function getProfileSummary(
  db: CompositeStorage,
  handle: string
): Promise<ProfileSummary | null> {
  const key = handle.toLowerCase().replace(/^@/, '');
  const profile = await db.get<Record<string, unknown>>('profile', key);
  if (profile == null) return null;
  const postsRaw = await db.getByBucket<Record<string, unknown>>('post', key + ':');
  const posts = postsRaw.map(({ value }) => value);
  const auxRow = db.getProfileSearchAuxRowsForHandles([key])[0];
  let followersCount = resolveFollowersCountForProfile(profile, getFollowers, auxRow, posts);
  if (followersCount <= 0) followersCount = estimateFollowersFromPosts(posts);
  if (followersCount > 0) profile.followers_count = followersCount;
  const engagement = computeEngagement(posts, followersCount);
  let bi: InstagramBi | undefined;
  if (posts.length >= 2) {
    try {
      bi = computeInstagramBi(followersCount, posts as PostForBi[]);
    } catch {
      // ignora
    }
  }
  return { profile, engagement, bi };
}

/** ER por tipo de conteúdo (feed, reels, marcados) para prévia pública do perfil. */
export async function getProfileEngagementByType(
  db: CompositeStorage,
  handle: string
): Promise<{
  posts: { er: number; count: number };
  reels: { er: number; count: number };
  tagged: { er: number; count: number };
}> {
  const key = handle.toLowerCase().replace(/^@/, '');
  const profile = await db.get<Record<string, unknown>>('profile', key);
  const postsRaw = await db.getByBucket<Record<string, unknown>>('post', key + ':');
  const posts = postsRaw.map(({ value }) => value);
  const auxRow = profile != null ? db.getProfileSearchAuxRowsForHandles([key])[0] : undefined;
  let followersCount =
    profile != null ? resolveFollowersCountForProfile(profile, getFollowers, auxRow, posts) : 0;
  if (followersCount <= 0 && posts.length > 0) followersCount = estimateFollowersFromPosts(posts);
  const byType = (type: string) =>
    posts.filter((p) => {
      const ct = typeof p.content_type === 'string' ? p.content_type.toLowerCase() : 'post';
      return ct === type;
    });
  const toSlot = (list: Record<string, unknown>[]) => {
    const e = computeEngagement(list, followersCount);
    return { er: e.engagement_rate ?? 0, count: e.posts_count };
  };
  return {
    posts: toSlot(byType('post')),
    reels: toSlot(byType('reel')),
    tagged: toSlot(byType('tagged')),
  };
}
