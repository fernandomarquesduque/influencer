import { ESTABLISHMENT_KEYWORDS_RAW } from "../cli/defaultTags.js";
/**
 * Acesso genérico a campos em entidades dinâmicas (response completo).
 * Não assume estrutura fixa; tenta caminhos comuns e busca profunda na API do Instagram.
 */

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

/** Busca profunda: encontra edge_followed_by.count em qualquer nível do objeto. */
function deepFindEdgeFollowedByCount(obj: unknown, seen = new Set<unknown>()): unknown {
  if (obj == null || seen.has(obj)) return undefined;
  if (typeof obj !== 'object') return undefined;
  seen.add(obj);
  const o = obj as Record<string, unknown>;
  if ('edge_followed_by' in o && o.edge_followed_by != null && typeof o.edge_followed_by === 'object') {
    const count = (o.edge_followed_by as Record<string, unknown>).count;
    if (count !== undefined && count !== null) return count;
  }
  for (const key of Object.keys(o)) {
    const found = deepFindEdgeFollowedByCount(o[key], seen);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Busca profunda: encontra is_business_account em qualquer nível (boolean). */
function deepFindIsBusinessAccount(obj: unknown, seen = new Set<unknown>()): unknown {
  if (obj == null || seen.has(obj)) return undefined;
  if (typeof obj !== 'object') return undefined;
  seen.add(obj);
  const o = obj as Record<string, unknown>;
  if ('is_business_account' in o) return o.is_business_account;
  if ('is_business' in o) return o.is_business;
  for (const key of Object.keys(o)) {
    const found = deepFindIsBusinessAccount(o[key], seen);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Busca profunda: encontra is_private em qualquer nível (boolean). */
function deepFindIsPrivate(obj: unknown, seen = new Set<unknown>()): unknown {
  if (obj == null || seen.has(obj)) return undefined;
  if (typeof obj !== 'object') return undefined;
  seen.add(obj);
  const o = obj as Record<string, unknown>;
  if ('is_private' in o) return o.is_private;
  for (const key of Object.keys(o)) {
    const found = deepFindIsPrivate(o[key], seen);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Busca profunda: public_phone_country_code (ex.: "55" para Brasil). */
function deepFindCountryCode(obj: unknown, seen = new Set<unknown>()): unknown {
  if (obj == null || seen.has(obj)) return undefined;
  if (typeof obj !== 'object') return undefined;
  seen.add(obj);
  const o = obj as Record<string, unknown>;
  if ('public_phone_country_code' in o) return o.public_phone_country_code;
  for (const key of Object.keys(o)) {
    const found = deepFindCountryCode(o[key], seen);
    if (found !== undefined) return found;
  }
  return undefined;
}

function toNumber(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.floor(v);
  if (typeof v === 'string') {
    const n = parseInt(v.replace(/\D/g, ''), 10);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// 1) MÉTRICAS (não classificam por si só)
// ---------------------------------------------------------------------------

/** Obtém número de seguidores de uma entidade genérica (response completo). */
export function getFollowersFromEntity(entity: Record<string, unknown>): number {
  const fromPaths = getIn(
    entity,
    'data.user.follower_count',
    'data.user.followers_count',
    'followers_count',
    'follower_count',
    'followers',
    'edge_followed_by.count',
    'data.user.edge_followed_by.count',
    'data.xdt_api__v1__feed__user_timeline_graphql_connection.feed_user.follower_count',
    'data.xdt_api__v1__feed__user_timeline_graphql_connection.feed_user.edge_followed_by.count',
    'data.feed_user_timeline.feed_user.follower_count',
    'data.feed_user_timeline.feed_user.edge_followed_by.count',
    'graphql.user.edge_followed_by.count'
  );
  let v = fromPaths;
  if (v === undefined || (typeof v === 'number' && v === 0)) {
    v = deepFindEdgeFollowedByCount(entity);
  }
  return toNumber(v);
}

// ---------------------------------------------------------------------------
// 2) ESTABELECIMENTO (filtro: excluir negócios)
// ---------------------------------------------------------------------------

/**
 * account_type no Instagram: 1 = pessoal, 2 = criador, 3 = empresa/estabelecimento.
 */
const ACCOUNT_TYPE_PERSONAL = 1;
const ACCOUNT_TYPE_CREATOR = 2;
const ACCOUNT_TYPE_BUSINESS = 3;

/**
 * Normaliza texto para comparação de keywords: case insensitive e sem acentos.
 * Garante que "Brasil" e "brasil" (e "Brasíl") deem match na mesma regra.
 */
function normalizeForKeyword(s: string): string {
  return String(s)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\u0300-\u036f/g, '');
}

/** Normaliza keyword sem trim, para preservar " sa ", " ltda" etc. (só devem dar match com espaço). */
function normalizeKeywordForSet(s: string): string {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\u0300-\u036f/g, '');
}

/**
 * Termos que indicam estabelecimento comercial ou empresa (categoria, handle, nome, bio).
 * Não incluir "salon"/"salão" para não excluir influenciadoras de beleza (ex.: Rafaella Cassol).
 * Regras: (1) handle contém keyword, (2) nome contém keyword, (3) bio contém keyword (só keywords com 5+ caracteres),
 * (4) categoria contém keyword, (5) conta empresa API + categoria. Motivo/regra: getBusinessBlockReason().
 * Comparação sempre case-insensitive e com acentos normalizados.
 */
/** Set de keywords normalizadas (sem acento, minúsculo; sem trim para preservar " sa ", " ltda"). */
const ESTABLISHMENT_KEYWORDS = new Set(
  ESTABLISHMENT_KEYWORDS_RAW.filter((s): s is string => typeof s === 'string').map(normalizeKeywordForSet)
);

/** Mínimo de caracteres para keyword ser validada na bio (evita falsos positivos com termos muito curtos). */
const MIN_CHARS_BIO_KEYWORD = 5;

/** Keywords de estabelecimento com 5+ caracteres: só essas são validadas na bio (evita falsos positivos). */
const ESTABLISHMENT_KEYWORDS_BIO = new Set(
  ESTABLISHMENT_KEYWORDS_RAW.filter((s): s is string => typeof s === 'string')
    .filter((kw) => normalizeKeywordForSet(kw).trim().length >= MIN_CHARS_BIO_KEYWORD)
    .map(normalizeKeywordForSet)
);

/** Verifica se texto contém alguma keyword do set (texto e set já em forma normalizada, ou normaliza aqui). */
function textContainsAnyKeyword(text: string, keywordSet: Set<string>): boolean {
  const n = normalizeForKeyword(text);
  return [...keywordSet].some((kw) => n.includes(kw));
}

/** Retorna a primeira keyword do set que aparece no texto, ou undefined. */
function findKeywordInText(text: string, keywordSet: Set<string>): string | undefined {
  const n = normalizeForKeyword(text);
  return [...keywordSet].find((kw) => n.includes(kw));
}

/** Extrai curtidas de um post Entity (NormalizedPost ou formato legado). */
function getLikesFromPost(post: unknown): number | undefined {
  if (post == null || typeof post !== 'object') return undefined;
  const o = post as Record<string, unknown>;
  const metrics = o.metrics;
  if (metrics != null && typeof metrics === 'object') {
    const likes = (metrics as Record<string, unknown>).likes;
    if (typeof likes === 'number' && Number.isFinite(likes)) return Math.floor(likes);
  }
  const likeCount = o.like_count;
  if (typeof likeCount === 'number' && Number.isFinite(likeCount)) return Math.floor(likeCount);
  return undefined;
}

/**
 * Verifica se há pelo menos minCount posts com no mínimo minLikes curtidas (>=).
 * @param minCount Número mínimo de posts que devem ter >= minLikes (default 1 = pelo menos um post).
 */
export function hasPostWithMinLikes(posts: unknown[], minLikes: number, minCount: number = 1): boolean {
  if (minLikes <= 0 || minCount <= 0 || !Array.isArray(posts)) return true;
  if (posts.length === 0) return minCount <= 0;
  let count = 0;
  for (const p of posts) {
    const likes = getLikesFromPost(p);
    if (likes != null && likes >= minLikes) {
      count++;
      if (count >= minCount) return true;
    }
  }
  return false;
}

function normalizeCategory(cat: unknown): string {
  if (cat == null) return '';
  const s = typeof cat === 'string' ? cat : String(cat);
  return s.trim().toLowerCase().normalize('NFD').replace(/\u0300-\u036f/g, '');
}

function getAccountType(entity: Record<string, unknown>): number | undefined {
  const v = getIn(
    entity,
    'data.user.account_type',
    'account_type'
  );
  if (v === undefined || v === null) return undefined;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isNaN(n) ? undefined : n;
}

function getHandleOrUsername(entity: Record<string, unknown>): string {
  const h = getIn(entity, 'handle', 'username', 'data.user.username');
  const s = h != null ? String(h).trim().toLowerCase().normalize('NFD').replace(/\u0300-\u036f/g, '') : '';
  return s.replace(/^@/, '');
}

/** Bio/descrição do perfil (biography) para checagem de keywords. */
function getBioNormalized(entity: Record<string, unknown>): string {
  const bio = getIn(entity, 'data.user.biography', 'biography', 'bio', 'description');
  if (bio == null) return '';
  const s = String(bio).trim().toLowerCase().normalize('NFD').replace(/\u0300-\u036f/g, '');
  return s;
}

/** Nome de exibição (full_name) normalizado para checagem de keywords. */
function getFullNameNormalized(entity: Record<string, unknown>): string {
  const name = getIn(entity, 'data.user.full_name', 'full_name', 'name');
  if (name == null) return '';
  return String(name).trim().toLowerCase().normalize('NFD').replace(/\u0300-\u036f/g, '');
}

/** Palavras que rejeitam o perfil (handle, nome, categoria ou bio). Usar sempre este array em todo o código. */
export const REJECTED_PROFILE_KEYWORDS = new Set<string>(['jornal']);

/** Handles que nunca devem ser coletados (ex.: perfis não brasileiros que passaram por bug). */
export const BLOCKLIST_HANDLES = new Set<string>(['franya910']);

/**
 * Verifica se o handle está na lista de bloqueados (case insensitive).
 */
export function isBlocklistedHandle(handle: string): boolean {
  if (!handle || typeof handle !== 'string') return false;
  return BLOCKLIST_HANDLES.has(handle.trim().toLowerCase());
}

/**
 * Verifica se algum termo de REJECTED_PROFILE_KEYWORDS aparece no texto (case insensitive).
 */
export function containsRejectedKeyword(text: string): boolean {
  const normalized = text.trim().toLowerCase().normalize('NFD').replace(/\u0300-\u036f/g, '');
  if (!normalized) return false;
  for (const kw of REJECTED_PROFILE_KEYWORDS) {
    if (normalized.includes(kw.toLowerCase())) return true;
  }
  return false;
}

/**
 * Indica se o perfil contém alguma palavra de REJECTED_PROFILE_KEYWORDS (handle, nome, categoria ou bio).
 * Esses perfis não devem ser coletados.
 */
export function hasRejectedProfileKeyword(entity: Record<string, unknown>): boolean {
  const toSearch = [
    getIn(entity, 'handle', 'username', 'data.user.username'),
    getIn(entity, 'data.user.full_name', 'full_name'),
    getIn(entity, 'data.user.category', 'category'),
    getIn(entity, 'data.user.biography', 'biography'),
  ]
    .filter((v) => v != null && String(v).trim() !== '')
    .map((v) => String(v).trim());
  const combined = toSearch.join(' ');
  return containsRejectedKeyword(combined);
}

/**
 * Retorna o motivo do bloqueio por palavra rejeitada (regra + palavra) para log.
 * Ex.: "handle contém 'jornal'", "bio contém 'jornal'". Retorna null se não houver match.
 */
export function getRejectedKeywordReason(entity: Record<string, unknown>): string | null {
  const normalize = (v: unknown): string =>
    (v != null ? String(v).trim().toLowerCase().normalize('NFD').replace(/\u0300-\u036f/g, '') : '');
  const findKeyword = (text: string): string | undefined =>
    [...REJECTED_PROFILE_KEYWORDS].find((kw) => text.includes(kw.toLowerCase()));

  const handleStr = normalize(getIn(entity, 'handle', 'username', 'data.user.username'));
  if (handleStr) {
    const kw = findKeyword(handleStr);
    if (kw) return `handle contém '${kw}'`;
  }
  const nameStr = normalize(getIn(entity, 'data.user.full_name', 'full_name'));
  if (nameStr) {
    const kw = findKeyword(nameStr);
    if (kw) return `nome contém '${kw}'`;
  }
  const categoryStr = normalize(getIn(entity, 'data.user.category', 'category'));
  if (categoryStr) {
    const kw = findKeyword(categoryStr);
    if (kw) return `categoria contém '${kw}'`;
  }
  const bioStr = normalize(getIn(entity, 'data.user.biography', 'biography'));
  if (bioStr) {
    const kw = findKeyword(bioStr);
    if (kw) return `bio contém '${kw}'`;
  }
  return null;
}

/**
 * Indica se a entidade é perfil de negócio/estabelecimento (ex.: bar, restaurante).
 * Considera: (1) categoria com keywords, (2) handle/nome com termos de estabelecimento,
 * (3) bio/descrição contendo termos de estabelecimento. Não pode conter no nome nem na bio.
 */
export function isBusinessFromEntity(entity: Record<string, unknown>): boolean {
  const category = getIn(entity, 'data.user.category', 'category');
  const categoryStr = normalizeCategory(category);
  const categoryMatchesEstablishment = categoryStr
    ? textContainsAnyKeyword(categoryStr, ESTABLISHMENT_KEYWORDS)
    : false;

  const handleStr = getHandleOrUsername(entity);
  const handleMatchesEstablishment = handleStr
    ? textContainsAnyKeyword(handleStr, ESTABLISHMENT_KEYWORDS)
    : false;

  const fullNameStr = getFullNameNormalized(entity);
  const nameMatchesEstablishment = fullNameStr
    ? textContainsAnyKeyword(fullNameStr, ESTABLISHMENT_KEYWORDS)
    : false;

  const bioStr = getBioNormalized(entity);
  const bioMatchesEstablishment = bioStr
    ? textContainsAnyKeyword(bioStr, ESTABLISHMENT_KEYWORDS_BIO)
    : false;

  if (handleMatchesEstablishment || nameMatchesEstablishment || bioMatchesEstablishment) return true;

  const handleSuggestsDoctorInfluencer = handleStr ? /^(dra\.|dr\.|dra_|dr_)/.test(handleStr) : false;
  const categoryIsClinicOnly = categoryStr
    ? (categoryStr.includes('clinic') || categoryStr.includes('clinica'))
    : false;
  const effectiveCategoryEstablishment =
    categoryMatchesEstablishment && !(handleSuggestsDoctorInfluencer && categoryIsClinicOnly);

  const accountType = getAccountType(entity);
  if (accountType === ACCOUNT_TYPE_BUSINESS && effectiveCategoryEstablishment) return true;
  if (effectiveCategoryEstablishment) return true;

  const fromPaths = getIn(
    entity,
    'data.user.is_business',
    'data.user.is_business_account',
    'is_business',
    'is_business_account',
    'graphql.user.is_business_account'
  );
  let v = fromPaths;
  if (v === undefined) v = deepFindIsBusinessAccount(entity);
  const isBusiness = v === true || v === 'true' || v === 1;
  return isBusiness && effectiveCategoryEstablishment;
}

/**
 * Retorna o motivo do bloqueio por estabelecimento (regra + palavra/campo) para log.
 * Retorna null se a entidade não for considerada empresa.
 */
export function getBusinessBlockReason(entity: Record<string, unknown>): string | null {
  const category = getIn(entity, 'data.user.category', 'category');
  const categoryStr = normalizeCategory(category);
  const handleStr = getHandleOrUsername(entity);
  const fullNameStr = getFullNameNormalized(entity);
  const bioStr = getBioNormalized(entity);

  const handleKw = handleStr ? findKeywordInText(handleStr, ESTABLISHMENT_KEYWORDS) : undefined;
  if (handleKw) return `handle contém '${handleKw}'`;

  const nameKw = fullNameStr ? findKeywordInText(fullNameStr, ESTABLISHMENT_KEYWORDS) : undefined;
  if (nameKw) return `nome contém '${nameKw}'`;

  const bioKw = bioStr
    ? findKeywordInText(bioStr, ESTABLISHMENT_KEYWORDS_BIO)
    : undefined;
  if (bioKw) return `bio contém '${bioKw}'`;

  const categoryKw = categoryStr ? findKeywordInText(categoryStr, ESTABLISHMENT_KEYWORDS) : undefined;
  const handleSuggestsDoctorInfluencer = handleStr ? /^(dra\.|dr\.|dra_|dr_)/.test(handleStr) : false;
  const categoryIsClinicOnly = categoryStr
    ? (categoryStr.includes('clinic') || categoryStr.includes('clinica'))
    : false;
  const effectiveCategoryEstablishment =
    !!categoryKw && !(handleSuggestsDoctorInfluencer && categoryIsClinicOnly);

  if (effectiveCategoryEstablishment && categoryKw)
    return `categoria contém '${categoryKw}'`;

  const accountType = getAccountType(entity);
  if (accountType === ACCOUNT_TYPE_BUSINESS && effectiveCategoryEstablishment)
    return 'conta empresa (API) + categoria estabelecimento';

  const fromPaths = getIn(
    entity,
    'data.user.is_business',
    'data.user.is_business_account',
    'is_business',
    'is_business_account',
    'graphql.user.is_business_account'
  );
  let v = fromPaths;
  if (v === undefined) v = deepFindIsBusinessAccount(entity);
  const isBusiness = v === true || v === 'true' || v === 1;
  if (isBusiness && effectiveCategoryEstablishment)
    return 'conta empresa (API) + categoria estabelecimento';

  return null;
}

// ---------------------------------------------------------------------------
// 2b) PERFIL PÚBLICO (elegibilidade)
// ---------------------------------------------------------------------------

/** Indica se o perfil é privado (is_private === true). Se o campo não vier na API, trata como público. */
export function isPrivateFromEntity(entity: Record<string, unknown>): boolean {
  const fromPaths = getIn(
    entity,
    'data.user.is_private',
    'is_private'
  );
  let v = fromPaths;
  if (v === undefined) v = deepFindIsPrivate(entity);
  return v === true || v === 'true' || v === 1;
}

/** Busca profunda: encontra friendship_status.followed_by (o perfil visualizado segue o viewer/logado). */
function deepFindFollowedBy(obj: unknown, seen = new Set<unknown>()): unknown {
  if (obj == null || seen.has(obj)) return undefined;
  if (typeof obj !== 'object') return undefined;
  seen.add(obj);
  const o = obj as Record<string, unknown>;
  if ('friendship_status' in o && o.friendship_status != null && typeof o.friendship_status === 'object') {
    const fs = o.friendship_status as Record<string, unknown>;
    if ('followed_by' in fs) return fs.followed_by;
  }
  for (const key of Object.keys(o)) {
    const found = deepFindFollowedBy(o[key], seen);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Indica se o perfil visualizado segue o usuário logado (viewer).
 * A API retorna friendship_status.followed_by quando o perfil é carregado estando logado.
 * Retorna true só se followed_by === true; false se explícito ou ausente (fail closed para 2FA).
 */
export function isFollowingViewerFromEntity(entity: Record<string, unknown>): boolean {
  const fromPaths = getIn(
    entity,
    'data.user.friendship_status.followed_by',
    'friendship_status.followed_by'
  );
  let v = fromPaths;
  if (v === undefined) v = deepFindFollowedBy(entity);
  return v === true || v === 'true' || v === 1;
}

// ---------------------------------------------------------------------------
// 3) PESSOA / CRIADOR (base para influenciador)
// ---------------------------------------------------------------------------

/** Indica se o perfil é pessoa ou criador (account_type 1 ou 2). Exclui empresa (3). Se account_type ausente, trata como pessoal. */
export function isPersonOrCreator(entity: Record<string, unknown>): boolean {
  const accountType = getAccountType(entity);
  if (accountType === undefined) return true;
  return accountType === ACCOUNT_TYPE_PERSONAL || accountType === ACCOUNT_TYPE_CREATOR;
}

// ---------------------------------------------------------------------------
// 4) INFLUENCIADOR (pessoa/criador + audiência mínima)
// ---------------------------------------------------------------------------

/**
 * Qualifica como influenciador: não estabelecimento + pessoa/criador (ou tipo 3 sem categoria de negócio) + seguidores.
 * - account_type 2 (creator) ou 3 sem categoria estabelecimento: followers >= minFollowers
 * - account_type 1 (pessoal): followers >= minFollowers * 2
 * - account_type ausente: followers >= minFollowers * 3
 * - account_type 3 com categoria estabelecimento: false (isBusinessFromEntity já retorna true)
 */
export function qualifiesAsInfluencer(
  entity: Record<string, unknown>,
  minFollowers: number
): boolean {
  if (isBusinessFromEntity(entity)) return false;
  const type = getAccountType(entity);
  if (type !== ACCOUNT_TYPE_PERSONAL && type !== ACCOUNT_TYPE_CREATOR && type !== ACCOUNT_TYPE_BUSINESS && type !== undefined) return false;

  const followers = getFollowersFromEntity(entity);
  if (minFollowers <= 0) return true;

  if (type === ACCOUNT_TYPE_CREATOR || type === ACCOUNT_TYPE_BUSINESS) return followers >= minFollowers;
  if (type === ACCOUNT_TYPE_PERSONAL) return followers >= minFollowers * 2;
  return followers >= minFollowers * 3;
}

// ---------------------------------------------------------------------------
// 5) DIAGNÓSTICO (para identificar qual regra rejeitou um perfil)
// ---------------------------------------------------------------------------

export interface InfluencerRejectionDiagnostic {
  pass: boolean;
  /** Motivo da rejeição (ex.: estabelecimento_comercial, perfil_privado, seguidores_abaixo_minimo) */
  reason?: string;
  /** Regra + palavra que identificou empresa (ex.: "handle contém 'loja'", "bio contém 'restaurante'") */
  businessBlockReason?: string;
  accountType?: number;
  followers: number;
  category?: string;
  isBusiness?: boolean;
  /** Perfil privado (is_private === true) */
  isPrivate?: boolean;
  /** Mínimo exigido para o tipo (após multiplicador) */
  minRequired?: number;
  /** Perfil não segue a conta obrigatória (INSTAGRAM_PERFIL) */
  followsRequiredProfile?: boolean;
}

/**
 * Retorna por que um perfil passou ou foi rejeitado (mesma lógica do runCrawl com excludeBusinessProfiles).
 */
export function getInfluencerRejectionDiagnostic(
  entity: Record<string, unknown>,
  minFollowers: number,
  excludeBusiness: boolean
): InfluencerRejectionDiagnostic {
  const followers = getFollowersFromEntity(entity);
  const accountType = getAccountType(entity);
  const category = getIn(entity, 'data.user.category', 'category');
  const categoryStr = typeof category === 'string' ? category : category != null ? String(category) : undefined;
  const isBusiness = isBusinessFromEntity(entity);

  const diagnostic: InfluencerRejectionDiagnostic = {
    pass: false,
    followers,
    accountType,
    category: categoryStr,
    isBusiness,
  };

  if (excludeBusiness) {
    if (isBusiness) {
      diagnostic.reason = 'estabelecimento_comercial';
      diagnostic.businessBlockReason = getBusinessBlockReason(entity) ?? undefined;
      return diagnostic;
    }
    if (accountType !== ACCOUNT_TYPE_PERSONAL && accountType !== ACCOUNT_TYPE_CREATOR && accountType !== ACCOUNT_TYPE_BUSINESS && accountType !== undefined) {
      diagnostic.reason = 'conta_tipo_desconhecido';
      return diagnostic;
    }
    if (minFollowers <= 0) {
      diagnostic.pass = true;
      return diagnostic;
    }
    let minRequired: number;
    if (accountType === ACCOUNT_TYPE_CREATOR || accountType === ACCOUNT_TYPE_BUSINESS) minRequired = minFollowers;
    else if (accountType === ACCOUNT_TYPE_PERSONAL) minRequired = minFollowers * 2;
    else minRequired = minFollowers * 3;
    diagnostic.minRequired = minRequired;
    if (followers < minRequired) {
      diagnostic.reason = 'seguidores_abaixo_minimo';
      return diagnostic;
    }
    diagnostic.pass = true;
    return diagnostic;
  }

  if (!isPersonOrCreator(entity)) {
    diagnostic.reason = 'conta_empresa';
    diagnostic.businessBlockReason = getBusinessBlockReason(entity) ?? undefined;
    return diagnostic;
  }
  if (minFollowers > 0 && followers < minFollowers) {
    diagnostic.minRequired = minFollowers;
    diagnostic.reason = 'seguidores_abaixo_minimo';
    return diagnostic;
  }
  diagnostic.pass = true;
  return diagnostic;
}

// ---------------------------------------------------------------------------
// 6) PERFIL BRASILEIRO (filtro: salvar apenas Brasil)
// ---------------------------------------------------------------------------

/** Termos que indicam perfil brasileiro (bio, nome, cidade, endereço). */
const BRASIL_KEYWORDS = new Set([
  'brasil', 'brazil', 'brasileira', 'brasileiro', 'brasileiros', 'brasileiras',
  'são paulo', 'sao paulo', 'rio de janeiro', 'belo horizonte', 'curitiba', 'porto alegre', 'brasília', 'brasilia',
  'salvador', 'fortaleza', 'recife', 'belém', 'belem', 'manaus', 'curitiba', 'florianópolis', 'florianopolis', 'floripa',
  'sp', 'rj', 'mg', 'pr', 'rs', 'sc', 'ba', 'pe', 'ce', 'pa', 'am', 'df', 'go', 'pb', 'rn', 'al', 'se', 'ma', 'pi', 'to', 'ms', 'mt', 'es', 'ro', 'ac', 'ap', 'rr',
  'bh ', ' bh', 'carioca', 'paulista', 'gaúcho', 'gaucho', 'mineiro', 'baiano', 'catarinense', 'paranaense', 'sulista', 'nordestino',
  'curitibano', 'florianopolitano', 'porto-alegrense', 'recifense', 'fortalezense', 'salvadorense', 'belenense', 'manauara',
  'litoral brasileiro', 'nordeste', 'norte', 'sul', 'sudeste', 'centro-oeste', 'amazonia', 'amazônia', 'pantanal',
  'rio grande do sul', 'rio grande do norte', 'minas gerais', 'santa catarina', 'espírito santo', 'espirito santo',
  'distrito federal', 'mato grosso', 'mato grosso do sul', 'rondônia', 'rondonia', 'acre', 'amapá', 'amapa', 'roraima', 'tocantins', 'pará', 'para ', 'maranhão', 'maranhao', 'piauí', 'piaui', 'ceará', 'ceara', 'paraíba', 'paraiba', 'alagoas', 'sergipe',
  'campinas', 'guarulhos', 'niterói', 'niteroi', 'santos', 'sorocaba', 'ribeirão', 'ribeirao', 'uberlândia', 'uberlandia', 'joinville', 'blumenau', 'pelotas', 'canoas', 'natal', 'maceió', 'maceio', 'joão pessoa', 'joao pessoa', 'aracaju', 'teresina', 'são luís', 'sao luis', 'belém', 'belem', 'macapá', 'macapa', 'manaus', 'porto velho', 'rio branco', 'boavista', 'palmas', 'cuiabá', 'cuiaba', 'campo grande', 'goiânia', 'goiania',
  'colombo', // Colombo (PR), região metropolitana de Curitiba
]);

function normalizeForBrazilCheck(v: unknown): string {
  if (v == null) return '';
  const s = typeof v === 'string' ? v : String(v);
  return s.trim().toLowerCase().normalize('NFD').replace(/\u0300-\u036f/g, '');
}

/**
 * Indica se o perfil parece ser brasileiro (país Brasil).
 * Considera: (1) public_phone_country_code === 55, (2) biografia/nome/cidade/endereço com termos brasileiros.
 * Quando não há nenhum dado disponível, retorna false (não salvar para evitar perfis de outros países).
 */
export function isLikelyBrazilianProfile(entity: Record<string, unknown>): boolean {
  const code = getIn(
    entity,
    'data.user.public_phone_country_code',
    'public_phone_country_code'
  ) ?? deepFindCountryCode(entity);
  if (code !== undefined && code !== null) {
    const s = String(code).trim();
    if (s === '55' || s === '+55') return true;
  }

  const bio = getIn(entity, 'data.user.biography', 'biography', 'bio');
  const fullName = getIn(entity, 'data.user.full_name', 'full_name');
  const city = getIn(entity, 'data.user.city_name', 'city_name');
  const address = getIn(entity, 'data.user.address_street', 'address_street');
  const combined = [bio, fullName, city, address]
    .filter((x) => x != null && String(x).trim() !== '')
    .map((x) => normalizeForBrazilCheck(x))
    .join(' ');
  if (!combined) return false;

  const words = combined.split(/\s+/).filter(Boolean);
  for (const w of words) {
    const normalized = w.replace(/[^\p{L}\d]/gu, '').toLowerCase();
    if (normalized.length < 2) continue;
    if (BRASIL_KEYWORDS.has(normalized)) return true;
    if (BRASIL_KEYWORDS.has(w)) return true;
  }
  if (combined.includes('brasil') || combined.includes('brazil') || combined.includes('brasileir')) return true;
  // Para keywords curtas (ex.: sp, rj, pa), exige palavra inteira para evitar falso positivo (ex.: "Spain" → "sp")
  for (const kw of BRASIL_KEYWORDS) {
    if (kw.length <= 3) {
      const re = new RegExp('(^|[\\s\\p{P}])' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([\\s\\p{P}]|$)', 'iu');
      if (re.test(combined)) return true;
    } else {
      if (combined.includes(kw)) return true;
    }
  }
  return false;
}
