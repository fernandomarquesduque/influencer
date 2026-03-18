/**
 * Regras de qualificação e filtros de perfil.
 */

export type Entity = Record<string, unknown>;

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

function toNumber(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.floor(v);
  if (typeof v === 'string') {
    const n = parseInt(v.replace(/\D/g, ''), 10);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

function deepFindEdgeFollowedBy(obj: unknown, seen = new Set<unknown>()): unknown {
  if (obj == null || seen.has(obj)) return undefined;
  if (typeof obj !== 'object') return undefined;
  seen.add(obj);
  const o = obj as Record<string, unknown>;
  if (
    'edge_followed_by' in o &&
    o.edge_followed_by != null &&
    typeof o.edge_followed_by === 'object'
  ) {
    const count = (o.edge_followed_by as Record<string, unknown>).count;
    if (count !== undefined && count !== null) return count;
  }
  for (const key of Object.keys(o)) {
    const found = deepFindEdgeFollowedBy(o[key], seen);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function getFollowersFromEntity(entity: Record<string, unknown>): number {
  const fromPaths = getIn(
    entity,
    'data.user.follower_count',
    'followers_count',
    'followers',
    'edge_followed_by.count',
    'data.user.edge_followed_by.count'
  );
  let v = fromPaths;
  if (v === undefined || (typeof v === 'number' && v === 0)) {
    v = deepFindEdgeFollowedBy(entity);
  }
  return toNumber(v);
}

// --- Blocklist e palavras rejeitadas ---
export const BLOCKLIST_HANDLES = new Set<string>(['franya910']);
export const REJECTED_PROFILE_KEYWORDS = new Set<string>(['jornal']);

export function isBlocklistedHandle(handle: string): boolean {
  if (!handle || typeof handle !== 'string') return false;
  return BLOCKLIST_HANDLES.has(handle.trim().toLowerCase());
}

export function containsRejectedKeyword(text: string): boolean {
  const normalized = text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\u0300-\u036f/g, '');
  if (!normalized) return false;
  for (const kw of REJECTED_PROFILE_KEYWORDS) {
    if (normalized.includes(kw.toLowerCase())) return true;
  }
  return false;
}

function profileSearchText(entity: Record<string, unknown>): string {
  const toSearch = [
    getIn(entity, 'handle', 'username', 'data.user.username'),
    getIn(entity, 'data.user.full_name', 'full_name'),
    getIn(entity, 'data.user.category', 'category'),
    getIn(entity, 'data.user.biography', 'biography'),
  ]
    .filter((v) => v != null && String(v).trim() !== '')
    .map((v) => String(v).trim());
  return toSearch.join(' ');
}

export function hasRejectedProfileKeyword(entity: Record<string, unknown>): boolean {
  return containsRejectedKeyword(profileSearchText(entity));
}

/** Motivo legível quando há palavra da lista REJECTED_PROFILE_KEYWORDS. */
export function explainRejectedProfileKeyword(entity: Record<string, unknown>): string {
  const n = normalize(profileSearchText(entity));
  for (const kw of REJECTED_PROFILE_KEYWORDS) {
    const kn = normalize(kw);
    if (kn && n.includes(kn)) {
      return `Lista de rejeição: o termo «${kw}» aparece no @, nome, bio ou categoria`;
    }
  }
  return 'Lista de rejeição: termo bloqueado no @, nome, bio ou categoria';
}

/** Motivo legível quando isBusinessFromEntity (estabelecimento/comercial). */
export function explainCommercialOrEstablishment(entity: Record<string, unknown>): string {
  const checks: { label: string; text: string }[] = [
    { label: '@', text: getHandleOrUsername(entity) },
    { label: 'nome', text: getFullNameNormalized(entity) },
    { label: 'bio', text: getBioNormalized(entity) },
    { label: 'categoria', text: normalizeCategory(getIn(entity, 'data.user.category', 'category')) },
  ];
  for (const { label, text } of checks) {
    if (!text || text.length < 2) continue;
    const nt = normalize(text);
    for (const kw of ESTABLISHMENT_KEYWORDS_RAW) {
      const kn = normalize(kw);
      if (kn.length >= 2 && nt.includes(kn)) {
        return `Indício de negócio/estabelecimento no ${label}: «${kw}»`;
      }
    }
  }
  const cat = getIn(entity, 'data.user.category', 'category');
  const catStr = cat != null ? String(cat) : '';
  const isBiz =
    getIn(entity, 'data.user.is_business_account', 'is_business_account', 'is_business') === true;
  if (isBiz && catStr) {
    return `Conta comercial no Instagram · categoria: «${catStr}»`;
  }
  if (catStr) {
    return `Categoria «${catStr}» indica serviço/estabelecimento (filtro do coletor)`;
  }
  if (isBiz) {
    return 'Conta marcada como comercial no Instagram e não passa no filtro de influenciador';
  }
  return 'Classificado como perfil de empresa/estabelecimento pelas regras do coletor';
}

/** Por que não atende qualifiesAsInfluencer (seguidores × tipo de conta). */
export function explainNotQualifiesAsInfluencer(
  entity: Record<string, unknown>,
  minFollowers: number
): string {
  const followers = getFollowersFromEntity(entity);
  const type = getAccountType(entity);
  let minimo: number;
  let tipoTxt: string;
  if (minFollowers <= 0) {
    return `Seguidores: ${followers.toLocaleString('pt-BR')} (regra de tipo de conta)`;
  }
  if (type === ACCOUNT_TYPE_CREATOR) {
    minimo = minFollowers;
    tipoTxt = 'Conta criador';
  } else if (type === ACCOUNT_TYPE_BUSINESS) {
    minimo = minFollowers;
    tipoTxt = 'Conta empresa';
  } else if (type === ACCOUNT_TYPE_PERSONAL) {
    minimo = minFollowers * 2;
    tipoTxt = 'Conta pessoal';
  } else {
    minimo = minFollowers * 3;
    tipoTxt = 'Tipo de conta desconhecido ou misto';
  }
  return `${tipoTxt}: precisa de pelo menos ${minimo.toLocaleString('pt-BR')} seguidores; este perfil tem ${followers.toLocaleString('pt-BR')}.`;
}

// --- Estabelecimento (empresa/negócio) — palavras-chave de filtro ---
const ESTABLISHMENT_KEYWORDS_RAW = [
  'loja', 'lojas', 'restaurante', 'bar ', 'lanchonete', 'padaria', 'hotel', 'clinic', 'clinica',
  'academia', 'gym', 'farmácia', 'farmacia', 'mercado', 'pizzaria', 'sorvete', 'confeitaria',
  'imobiliária', 'imobiliaria', 'company', 'ltda', 's.a.', 'official', 'brand', 'business',
  'store', 'shop', 'turismo', 'agência', 'agencia', 'studio', 'estudio',
];

function normalize(s: string): string {
  return String(s)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\u0300-\u036f/g, '');
}

const ESTABLISHMENT_KEYWORDS = new Set(ESTABLISHMENT_KEYWORDS_RAW.map((k) => normalize(k)));

function textContainsAny(text: string, keywordSet: Set<string>): boolean {
  const n = normalize(text);
  return [...keywordSet].some((kw) => n.includes(kw));
}

function getHandleOrUsername(entity: Record<string, unknown>): string {
  const h = getIn(entity, 'handle', 'username', 'data.user.username');
  return h != null ? normalize(String(h)).replace(/^@/, '') : '';
}

function getFullNameNormalized(entity: Record<string, unknown>): string {
  const name = getIn(entity, 'data.user.full_name', 'full_name', 'name');
  return name != null ? normalize(String(name)) : '';
}

function getBioNormalized(entity: Record<string, unknown>): string {
  const bio = getIn(entity, 'data.user.biography', 'biography', 'bio');
  return bio != null ? normalize(String(bio)) : '';
}

function normalizeCategory(cat: unknown): string {
  if (cat == null) return '';
  return normalize(String(cat));
}

function getAccountType(entity: Record<string, unknown>): number | undefined {
  const v = getIn(entity, 'data.user.account_type', 'account_type');
  if (v === undefined || v === null) return undefined;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isNaN(n) ? undefined : n;
}

const ACCOUNT_TYPE_PERSONAL = 1;
const ACCOUNT_TYPE_CREATOR = 2;
const ACCOUNT_TYPE_BUSINESS = 3;

export function isBusinessFromEntity(entity: Record<string, unknown>): boolean {
  const category = getIn(entity, 'data.user.category', 'category');
  const categoryStr = normalizeCategory(category);
  const categoryMatches = categoryStr ? textContainsAny(categoryStr, ESTABLISHMENT_KEYWORDS) : false;

  const handleStr = getHandleOrUsername(entity);
  if (textContainsAny(handleStr, ESTABLISHMENT_KEYWORDS)) return true;
  if (textContainsAny(getFullNameNormalized(entity), ESTABLISHMENT_KEYWORDS)) return true;
  const bioStr = getBioNormalized(entity);
  if (bioStr.length >= 5 && textContainsAny(bioStr, ESTABLISHMENT_KEYWORDS)) return true;

  const accountType = getAccountType(entity);
  if (accountType === ACCOUNT_TYPE_BUSINESS && categoryMatches) return true;
  if (categoryMatches) return true;

  const isBusiness =
    getIn(
      entity,
      'data.user.is_business_account',
      'is_business_account',
      'is_business'
    ) === true ||
    (entity as Record<string, unknown>).is_business_account === true;
  return isBusiness && categoryMatches;
}

export function isPersonOrCreator(entity: Record<string, unknown>): boolean {
  const accountType = getAccountType(entity);
  if (accountType === undefined) return true;
  return accountType === ACCOUNT_TYPE_PERSONAL || accountType === ACCOUNT_TYPE_CREATOR;
}

export function qualifiesAsInfluencer(
  entity: Record<string, unknown>,
  minFollowers: number
): boolean {
  if (isBusinessFromEntity(entity)) return false;
  const type = getAccountType(entity);
  const followers = getFollowersFromEntity(entity);
  if (minFollowers <= 0) return true;
  if (type === ACCOUNT_TYPE_CREATOR || type === ACCOUNT_TYPE_BUSINESS) return followers >= minFollowers;
  if (type === ACCOUNT_TYPE_PERSONAL) return followers >= minFollowers * 2;
  return followers >= minFollowers * 3;
}

function getLikesFromPost(post: unknown): number | undefined {
  if (post == null || typeof post !== 'object') return undefined;
  const o = post as Record<string, unknown>;
  const metrics = o.metrics as Record<string, unknown> | undefined;
  if (metrics?.likes != null && typeof metrics.likes === 'number') return Math.floor(metrics.likes as number);
  if (typeof o.like_count === 'number') return Math.floor(o.like_count as number);
  return undefined;
}

export function hasPostWithMinLikes(
  posts: unknown[],
  minLikes: number,
  minCount: number
): boolean {
  if (minLikes <= 0 || minCount <= 0 || !Array.isArray(posts)) return true;
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

export function isPrivateFromEntity(entity: Record<string, unknown>): boolean {
  const v = getIn(entity, 'data.user.is_private', 'is_private') ?? deepFindIsPrivate(entity);
  return v === true || v === 'true' || v === 1;
}
