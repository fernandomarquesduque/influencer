/**
 * Listagem de perfis com filtros avançados e cálculo de engajamento
 * baseado nos posts (likes, comentários, views).
 */

import type { CompositeStorage } from '../storage/compositeStorage.js';
import { logMemorySnapshot } from '../utils/memoryDiag.js';
import type { ProfileActivationData } from '../storage/sqliteSync.js';
import { computeInstagramBi, type InstagramBi, type PostForBi } from '../utils/instagramBi.js';
import { getCostTierFromPricing, getSuggestedPricingFromFollowers, type CostTier } from '../utils/suggestedPricing.js';
import {
  followersCountToSizeKey,
  createEmptyFollowersBucketsForFacets,
  incrementFollowersBucketCount,
} from './followersSizeBuckets.js';

/** Cache em memória dos dados do RocksDB (perfis + posts). Não expira por tempo: substituído ao concluir warmSearchCache ou scheduleSearchCacheRewarm (swap atômico; durante reload segue servindo o snapshot anterior). */
let searchDataCache: {
  profilesRaw: { key: string; value: Record<string, unknown> }[];
  postsRaw: { key: string; value: Record<string, unknown> }[];
} | null = null;

/**
 * Geração do cache: só a carga cuja geração ainda é a atual aplica resultado.
 * Evita que um rewarm antigo (ex.: antes do último save) sobrescreva dados novos.
 */
let searchCacheGeneration = 0;

/** Carrega perfis e posts do storage (para reaquecimento em background). */
async function loadSearchCacheData(db: CompositeStorage): Promise<{
  profilesRaw: { key: string; value: Record<string, unknown> }[];
  postsRaw: { key: string; value: Record<string, unknown> }[];
}> {
  const [profilesRaw, postsRaw] = await Promise.all([
    db.getByBucket<Record<string, unknown>>('profile'),
    db.getByBucket<Record<string, unknown>>('post'),
  ]);
  return { profilesRaw, postsRaw };
}

function applySearchCacheIfCurrent(
  gen: number,
  data: { profilesRaw: { key: string; value: Record<string, unknown> }[]; postsRaw: { key: string; value: Record<string, unknown> }[] }
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
 * Agenda reaquecimento do cache em background (stale-while-revalidate).
 * Chamadas em rajada (ex.: refresh — 1× save + 1× savePosts + 3× saveMedia) viram no máximo 2 passadas sequenciais,
 * nunca várias Promise.all(profile+post) simultâneas.
 */
export function scheduleSearchCacheRewarm(db: CompositeStorage): void {
  if (searchCacheRewarmInFlight) {
    searchCacheRewarmPending = true;
    return;
  }
  runSearchCacheRewarmPass(db);
}

/** Invalidação forte: esvazia o cache (próxima busca lê do RocksDB e repovoa). Uso pontual; reaquecimento após save usa scheduleSearchCacheRewarm. */
export function clearSearchCache(): void {
  searchCacheGeneration += 1;
  searchDataCache = null;
}

/** Aquece o cache carregando perfis e posts do storage. Chamar na subida da API para a 1ª busca já ser rápida. */
export async function warmSearchCache(db: CompositeStorage): Promise<void> {
  const gen = ++searchCacheGeneration;
  logMemorySnapshot('search-cache: antes de ler profile+post do disco');
  const data = await loadSearchCacheData(db);
  applySearchCacheIfCurrent(gen, data);
  logMemorySnapshot('search-cache: snapshot em RAM aplicado', {
    profiles_n: data.profilesRaw.length,
    posts_n: data.postsRaw.length,
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
  const fromPaths = getIn(
    profile,
    'followers_count',
    'data.user.follower_count',
    'data.user.edge_followed_by.count',
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

function bumpFacetStringArray(map: Map<string, number>, arr: unknown): void {
  if (!Array.isArray(arr)) return;
  for (const x of arr) {
    if (typeof x === 'string' && x.trim()) bumpFacetString(map, x);
  }
}

interface LlmFacetMaps {
  profileType: Map<string, number>;
  mainCategory: Map<string, number>;
  gender: Map<string, number>;
  language: Map<string, number>;
  subCategories: Map<string, number>;
  contentPillars: Map<string, number>;
  audienceType: Map<string, number>;
  toneOfVoice: Map<string, number>;
  brandSafetyLevel: Map<string, number>;
}

function createEmptyLlmFacetMaps(): LlmFacetMaps {
  return {
    profileType: new Map(),
    mainCategory: new Map(),
    gender: new Map(),
    language: new Map(),
    subCategories: new Map(),
    contentPillars: new Map(),
    audienceType: new Map(),
    toneOfVoice: new Map(),
    brandSafetyLevel: new Map(),
  };
}

function mapToNameCountDesc(m: Map<string, number>): { name: string; count: number }[] {
  return [...m.entries()]
    .filter(([, count]) => count > 0)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

function normalizeBrandSafetyLevel(brandSafety: unknown): 'adulto' | 'sensivel' | 'familia' | null {
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
  if (!q) return;
  bumpFacetString(maps.profileType, String(q.profileType ?? ''));
  bumpFacetString(maps.mainCategory, String(q.mainCategory ?? ''));
  bumpFacetString(maps.gender, String(q.gender ?? ''));
  bumpFacetString(maps.language, String(q.language ?? ''));
  bumpFacetStringArray(maps.subCategories, q.subCategories);
  bumpFacetStringArray(maps.contentPillars, q.contentPillars);
  bumpFacetStringArray(maps.audienceType, q.audienceType);
  bumpFacetStringArray(maps.toneOfVoice, q.toneOfVoice);
  const brandSafetyLevel = normalizeBrandSafetyLevel(q.brandSafety);
  if (brandSafetyLevel) bumpFacetString(maps.brandSafetyLevel, brandSafetyLevel);
}

function mapsToLlmSearchFacets(maps: LlmFacetMaps): LlmSearchFacets {
  return {
    profileType: mapToNameCountDesc(maps.profileType),
    mainCategory: mapToNameCountDesc(maps.mainCategory),
    gender: mapToNameCountDesc(maps.gender),
    language: mapToNameCountDesc(maps.language),
    subCategories: mapToNameCountDesc(maps.subCategories),
    contentPillars: mapToNameCountDesc(maps.contentPillars),
    audienceType: mapToNameCountDesc(maps.audienceType),
    toneOfVoice: mapToNameCountDesc(maps.toneOfVoice),
    brandSafety: {
      level: mapToNameCountDesc(maps.brandSafetyLevel),
    },
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
  for (const key of ['subCategories', 'contentPillars', 'audienceType', 'toneOfVoice'] as const) {
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
  return getPostTextForSearch(post).toLowerCase().replace(/\s+/g, ' ');
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
  return parts.filter(Boolean).join(' ').toLowerCase().replace(/\s+/g, ' ');
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
  return parts.filter(Boolean).join(' ').toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Verifica se o texto pesquisável atende à query q.
 * - Se q tem espaços: primeiro exige match da frase completa (relevância 2); senão exige que todas as palavras apareçam (relevância 1, tipo LIKE %palavra%).
 * - Se q não tem espaços: match por contém (relevância 2).
 * Retorna { match, relevance }.
 */
export function matchesQuery(searchableText: string, q: string): { match: boolean; relevance: number } {
  const qTrim = q.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!qTrim) return { match: true, relevance: 0 };
  const search = searchableText;

  if (qTrim.includes(' ')) {
    if (search.includes(qTrim)) return { match: true, relevance: 2 };
    const words = qTrim.split(' ').filter((w) => w.length > 0);
    const allWordsMatch = words.every((word) => search.includes(word));
    return { match: allWordsMatch, relevance: allWordsMatch ? 1 : 0 };
  }

  if (search.includes(qTrim)) return { match: true, relevance: 2 };
  return { match: false, relevance: 0 };
}

/** Texto pesquisável a partir de um ProfileListItem (para filtro q em cima de lista em cache). Usa _searchable_text se existir (bio + legendas + hashtags + etc.). */
function getSearchableTextFromItem(item: ProfileListItem): string {
  const precomputed = (item as Record<string, unknown>)._searchable_text;
  if (typeof precomputed === 'string' && precomputed.trim()) {
    return precomputed.trim().toLowerCase().replace(/\s+/g, ' ');
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
  subCategories: { name: string; count: number }[];
  contentPillars: { name: string; count: number }[];
  audienceType: { name: string; count: number }[];
  toneOfVoice: { name: string; count: number }[];
  /** Categoria única do prompt qualify: familia | sensivel | adulto. */
  brandSafety: {
    level: { name: string; count: number }[];
  };
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
  llmSubCategories?: string | string[];
  llmContentPillars?: string | string[];
  llmAudienceType?: string | string[];
  llmToneOfVoice?: string | string[];
  llmRiskLevel?: string | string[];
  /** Quando definido, exige mesmo valor em `qualification.brandSafety`. */
  llmIsFamilySafe?: boolean;
  llmIsAdultContent?: boolean;
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
  if (!orScalar('mainCategory', parseStringArray(query.llmMainCategory))) return false;
  if (!orScalar('gender', parseStringArray(query.llmGender))) return false;
  if (!orScalar('language', parseStringArray(query.llmLanguage))) return false;

  if (!qualificationArrayMatchesOr(qual, 'subCategories', parseStringArray(query.llmSubCategories))) return false;
  if (!qualificationArrayMatchesOr(qual, 'contentPillars', parseStringArray(query.llmContentPillars))) return false;
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

  let posts_per_week: number;
  if (timestamps.length >= 2) {
    const minTs = Math.min(...timestamps);
    const maxTs = Math.max(...timestamps);
    const observedWeeks = (maxTs - minTs) / SECONDS_PER_WEEK;
    const weeks = Math.max(observedWeeks, MIN_WEEKS_FOR_RATE);
    posts_per_week = weeks > 0 ? Math.round((n / weeks) * 100) / 100 : n;
  } else {
    posts_per_week = n > 0 ? n : 0;
  }

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

  const useInitialItems = options?.initialItems != null && options.initialItems.length > 0;

  let profilesRaw: { key: string; value: Record<string, unknown> }[];
  let postsRaw: { key: string; value: Record<string, unknown> }[];
  if (!useInitialItems) {
    if (searchDataCache) {
      profilesRaw = searchDataCache.profilesRaw;
      postsRaw = searchDataCache.postsRaw;
    } else {
      logMemorySnapshot('search: cache vazio — lendo profile+post do disco nesta requisição');
      [profilesRaw, postsRaw] = await Promise.all([
        db.getByBucket<Record<string, unknown>>('profile'),
        db.getByBucket<Record<string, unknown>>('post'),
      ]);
      searchDataCache = { profilesRaw, postsRaw };
      logMemorySnapshot('search: cache preenchido a partir do disco', {
        profiles_n: profilesRaw.length,
        posts_n: postsRaw.length,
      });
    }
  } else {
    profilesRaw = [];
    postsRaw = [];
  }

  const postsByHandle = new Map<string, Record<string, unknown>[]>();
  for (const { key, value } of postsRaw) {
    const v = value as Record<string, unknown>;
    const handleRaw = (v.profile_handle ?? (key.includes(':') ? key.split(':')[0]! : key)) as string;
    const handle = String(handleRaw ?? '').toLowerCase().replace(/^@/, '');
    if (!handle) continue;
    const list = postsByHandle.get(handle) ?? [];
    list.push(v);
    postsByHandle.set(handle, list);
  }

  let items: ProfileListItem[] = [];
  if (useInitialItems) {
    // Só rotas de campanha usam initialItems; a lista deve refletir todos os handles do relatório
    // (o cartão usa handlesCount), não só quem já tem LLM concluída.
    items = options!.initialItems!;
  } else {
    for (const { key, value } of profilesRaw) {
      const profile = value as Record<string, unknown>;
      const handle = getHandle(profile, key).toLowerCase().replace(/^@/, '');
      if (restrictToHandles && !restrictToHandles.has(handle)) continue;
      // Busca geral: só perfis com qualificação LLM pronta. Campanha: todos os handles presentes no DB.
      if (!restrictToHandles && !hasCompletedLlmProfile(profile)) continue;
      const followersCount = getFollowers(profile);
      const fullName = getFullName(profile);
      const baseCategories = getCategories(profile);
      const posts = postsByHandle.get(handle) ?? [];
      const postHashtags = getAllHashtagsFromPosts(posts);
      const categoriesSet = new Set<string>([...baseCategories.map((c) => c.trim().toLowerCase()), ...postHashtags].filter(Boolean));
      const categories = [...categoriesSet].sort();

      if (minFollowers != null && followersCount < minFollowers) continue;
      if (maxFollowers != null && followersCount > maxFollowers) continue;
      if (excludePrivate && getIsPrivate(profile)) continue;
      if (accountTypeFilter.length > 0) {
        const at = getAccountType(profile);
        if (at == null || !accountTypeFilter.includes(at)) continue;
      }

      const engagement = computeEngagement(posts, followersCount);

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
      if (!restrictToHandles && q) {
        const textProfileOnly = getSearchableTextProfileOnly(profile, key, fullName, categories);
        const { match: matchProfile, relevance: relProfile } = matchesQuery(textProfileOnly, q);
        if (matchProfile) {
          searchRelevance = relProfile;
        } else {
          const searchableText = getSearchableText(profile, key, fullName, categories, posts);
          const { match, relevance } = matchesQuery(searchableText, q);
          if (!match) continue;
          searchRelevance = relevance;
        }
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
      if (q) {
        (item as Record<string, unknown>)._searchable_text = getSearchableText(profile, key, fullName, categories, posts);
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

  const hasAnyLlmFilterInQuery =
    parseStringArray(query.llmProfileType).length > 0 ||
    parseStringArray(query.llmMainCategory).length > 0 ||
    parseStringArray(query.llmGender).length > 0 ||
    parseStringArray(query.llmLanguage).length > 0 ||
    parseStringArray(query.llmSubCategories).length > 0 ||
    parseStringArray(query.llmContentPillars).length > 0 ||
    parseStringArray(query.llmAudienceType).length > 0 ||
    parseStringArray(query.llmToneOfVoice).length > 0 ||
    parseStringArray(query.llmRiskLevel).length > 0 ||
    query.llmIsFamilySafe === true ||
    query.llmIsFamilySafe === false ||
    query.llmIsAdultContent === true ||
    query.llmIsAdultContent === false;

  if (hasAnyLlmFilterInQuery) {
    filteredItems = filteredItems.filter((i) =>
      matchesLlmQualificationFilters(i as unknown as Record<string, unknown>, query)
    );
  }

  if (q) {
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

  items = filteredItems;

  if (order === 'relevance_desc') {
    items.sort(sortByOrder);
  } else if (q) {
    items.sort((a, b) => {
      const relA = a.search_relevance ?? 0;
      const relB = b.search_relevance ?? 0;
      if (relB !== relA) return relB - relA;
      return sortByOrder(a, b);
    });
  } else {
    items.sort(sortByOrder);
  }

  const total = items.length;

  /** Facets calculados sobre o conjunto completo filtrado (para sumarização na UI). Omitidos quando includeFacets=false (ex.: paginação). */
  let facets: ProfilesSearchFacets;
  if (includeFacets) {
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
  /** BI pesado só para os itens da página retornada (otimização); posts vêm do map para não guardar em cada item. */
  for (const item of slice) {
    const postsForBi = postsByHandle.get(item.handle) as PostForBi[] | undefined;
    const followersForBi = item.followers_count;
    if (postsForBi && postsForBi.length >= 2 && followersForBi != null) {
      try {
        item.bi = computeInstagramBi(followersForBi, postsForBi);
      } catch {
        // ignora falha no BI (dados incompletos)
      }
    }
  }
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
  const followersCount = getFollowers(profile);
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
