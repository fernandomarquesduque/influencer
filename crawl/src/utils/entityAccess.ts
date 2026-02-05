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
    'followers_count',
    'followers',
    'edge_followed_by.count',
    'data.user.edge_followed_by.count',
    'data.xdt_api__v1__feed__user_timeline_graphql_connection.feed_user.edge_followed_by.count',
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

/** Categorias que indicam estabelecimento comercial. Termos mais específicos; não incluir "salon"/"salão" para não excluir influenciadoras de beleza (ex.: Rafaella Cassol). */
const ESTABLISHMENT_CATEGORY_KEYWORDS = new Set([
  'restaurante', 'lanche', 'ifood', 'cafe', 'café', 'lanches', 'store', 'loja', 'lojas', 'restaurant', 'bar', 'café', 'cafe', 'lanchonete', 'padaria', 'bakery',
  'hotel', 'pousada', 'loja', 'clínica', 'clinica', 'clinic',
  'academia', 'gym', 'farmácia', 'farmacia', 'pharmacy', 'supermercado',
  'pizzaria', 'hamburgueria', 'sorveteria', 'confeitaria', 'balada',
  'nightclub', 'pub', 'cervejaria', 'brewery', 'vinícola', 'winery', 'food truck',
  'gastrobar', 'gastropub', 'gastronomy',
  'imobiliária', 'imobiliaria', 'imóveis', 'imoveis', 'real estate', 'realty',
]);

/** Termos no handle/username que indicam estabelecimento (ex.: barsaojorgetatuape, santomarestaurante). */
const ESTABLISHMENT_HANDLE_KEYWORDS = new Set([
  'gastrobar', 'gastropub', 'lanche', 'lanches', 'ifood', 'cafe', 'café', 'store', 'loja', 'lojas', 'restaurante', 'restaurant', 'pizzaria', 'lanchonete',
  'padaria', 'hamburgueria', 'sorveteria', 'confeitaria', 'cervejaria', 'vinicola', 'winery',
  'bakery', 'quintal', 'bistro', 'brasserie', 'steakhouse', 'grill', 'kitchen',
  'rooftop', 'lounge',
  'imoveis', 'imobiliaria', 'realestate', 'realty',
  'barsao', 'santomar',
]);

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

/**
 * Indica se a entidade é perfil de negócio/estabelecimento (ex.: bar, restaurante).
 * Considera: (1) categoria com keywords, (2) handle/username com termos de estabelecimento (ex.: gastrobar, quintal).
 */
export function isBusinessFromEntity(entity: Record<string, unknown>): boolean {
  const category = getIn(entity, 'data.user.category', 'category');
  const categoryStr = normalizeCategory(category);
  const categoryMatchesEstablishment = categoryStr
    ? [...ESTABLISHMENT_CATEGORY_KEYWORDS].some((kw) => categoryStr.includes(kw))
    : false;

  const handleStr = getHandleOrUsername(entity);
  const handleMatchesEstablishment = handleStr
    ? [...ESTABLISHMENT_HANDLE_KEYWORDS].some((kw) => handleStr.includes(kw))
    : false;

  if (handleMatchesEstablishment) return true;

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
  /** Motivo da rejeição (ex.: estabelecimento_comercial, conta_empresa, seguidores_abaixo_minimo) */
  reason?: string;
  accountType?: number;
  followers: number;
  category?: string;
  isBusiness?: boolean;
  /** Mínimo exigido para o tipo (após multiplicador) */
  minRequired?: number;
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
