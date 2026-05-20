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
  /** Gate/DOM gravam no topo; o GraphQL aninhado costuma vir com follower_count: 0 antes de carregar. */
  const top = getIn(entity, 'followers_count', 'followers', 'follower_count');
  if (top !== undefined && top !== null) {
    const n = toNumber(top);
    if (n > 0) return n;
  }
  const fromNested = getIn(
    entity,
    'data.user.follower_count',
    'edge_followed_by.count',
    'data.user.edge_followed_by.count'
  );
  let v = fromNested;
  if (v === undefined || (typeof v === 'number' && v === 0)) {
    v = deepFindEdgeFollowedBy(entity);
  }
  return toNumber(v);
}

/** Injeta contagem do gate/DOM quando o GraphQL aninhado veio com follower_count: 0. */
export function enrichProfileWithFollowersHint(
  entity: Record<string, unknown>,
  followersHint?: number | null
): Record<string, unknown> {
  if (followersHint == null || followersHint <= 0) return entity;
  if (getFollowersFromEntity(entity) > 0) return entity;
  return { ...entity, followers_count: followersHint };
}

// --- Blocklist e palavras rejeitadas ---
export const BLOCKLIST_HANDLES = new Set<string>(['franya910']);


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
  for (const kw of ESTABLISHMENT_KEYWORDS_RAW) {
    if (normalized.includes(kw.toLowerCase())) return true;
  }
  return false;
}

function profileSearchText(entity: Record<string, unknown>): string {
  const toSearch = [
    getIn(entity, 'handle', 'username', 'data.user.username'),
    getIn(entity, 'data.user.full_name', 'full_name'),
    getIn(entity, 'data.user.category', 'category'),
    collectBioRawText(entity),
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
  for (const kw of ESTABLISHMENT_KEYWORDS_RAW) {
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
  'governo', 'banco',
  'agência', 'teatro', 'shopping', 'coffe',
  'condominio', 'condomínio',
  'mensagem', 'prefeitura',
  'noticia', 'notícia', 'noticias', 'notícias',
  'universidade', 'escola', 'radio', 'rádio',
  'clinica', 'clínica', 'studio', 'estudio', 'estúdio',
  'lanche', 'lanches', 'ifood', 'finanças',
  'loja', 'lanchonete',
  'padaria', 'bakery', 'hotel', 'pousada', 'clinic',
  'academia', 'farmácia', 'farmacia', 'pharmacy',
  'mercado', 'pizzaria', 'hamburgueria', 'sorvete',
  'confeitaria', 'balada', 'nightclub',
  'cervejaria',
  'gastrobar', 'gastropub', 'gastronomy',
  'bistro', 'brasserie', 'steakhouse', 'grill',
  'kitchen', 'rooftop', 'lounge',

  'imobiliária', 'imobiliaria', 'imóveis', 'imoveis',

  'gazeta', 'jornal',
];

/**
 * Bio contém termo da lista de estabelecimento/negócio — usar antes da validação de idioma.
 */
export function explainRejectedEstablishmentKeywordInBio(
  entity: Record<string, unknown>
): string | null {
  const raw = collectBioRawText(entity).trim();
  if (!raw) return null;
  const n = normalize(raw);
  for (const kw of ESTABLISHMENT_KEYWORDS_RAW) {
    const kn = normalize(kw);
    if (!kn) continue;
    if (n.includes(kn)) {
      return `Bio: termo da lista de rejeição «${kw}» (antes da validação de idioma)`;
    }
  }
  return null;
}

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

/**
 * Junta todo texto de bio que a API do Instagram pode enviar (campos variam por endpoint).
 * Exportado para regras de idioma e outras checagens alinhadas à mesma fonte.
 */
export function collectBioRawText(entity: Record<string, unknown>): string {
  const parts: string[] = [];
  const push = (v: unknown) => {
    if (v == null) return;
    const s = String(v).trim();
    if (s) parts.push(s);
  };
  push(getIn(entity, 'data.user.biography', 'biography', 'bio'));
  const bwe = getIn(entity, 'data.user.biography_with_entities', 'biography_with_entities');
  if (bwe != null && typeof bwe === 'object') {
    const o = bwe as Record<string, unknown>;
    push(o.text);
    push(o.raw_text);
  }
  const links = getIn(entity, 'data.user.bio_links', 'bio_links');
  if (Array.isArray(links)) {
    for (const item of links) {
      if (item != null && typeof item === 'object') {
        const L = item as Record<string, unknown>;
        push(L.title);
        push(L.name);
        push(L.link_title);
      }
    }
  }
  return parts.join('\n');
}

function getBioNormalized(entity: Record<string, unknown>): string {
  const raw = collectBioRawText(entity);
  return raw ? normalize(raw) : '';
}

function normalizeCategory(cat: unknown): string {
  if (cat == null) return '';
  return normalize(String(cat));
}

function parseAccountTypeRaw(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined;
  const n = typeof v === 'number' ? v : parseInt(String(v).replace(/\D/g, ''), 10);
  if (Number.isNaN(n) || n < 1 || n > 3) return undefined;
  return n;
}

/**
 * Varre JSON GraphQL (perfil) em busca de account_type — o IG nem sempre envia só em data.user.
 * Ignora arrays grandes (timeline) para não pegar tipo de outro usuário no feed.
 */
function deepFindAccountType(obj: unknown, maxDepth: number, seen: Set<unknown>): number | undefined {
  if (maxDepth <= 0 || obj == null || typeof obj !== 'object') return undefined;
  if (seen.has(obj)) return undefined;
  seen.add(obj);
  const o = obj as Record<string, unknown>;
  const here = parseAccountTypeRaw(o.account_type);
  if (here !== undefined) return here;
  const keys = Object.keys(o).sort((a, b) => {
    const pref = (k: string) =>
      k === 'data' || k === 'user' ? 0 : k === 'owner' || k === 'username' ? 1 : 2;
    return pref(a) - pref(b);
  });
  for (const k of keys) {
    const v = o[k];
    if (Array.isArray(v) && v.length > 80) continue;
    const found = deepFindAccountType(v, maxDepth - 1, seen);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function getAccountType(entity: Record<string, unknown>): number | undefined {
  const v = getIn(
    entity,
    'data.user.account_type',
    'user.account_type',
    'account_type',
    'data.viewer.user.account_type',
    'data.xdt_shortcode_media.owner.account_type'
  );
  const direct = parseAccountTypeRaw(v);
  if (direct !== undefined) return direct;

  const userObj = getIn(entity, 'data.user', 'user');
  if (userObj != null && typeof userObj === 'object') {
    const fromUser = parseAccountTypeRaw((userObj as Record<string, unknown>).account_type);
    if (fromUser !== undefined) return fromUser;
  }

  return deepFindAccountType(entity, 12, new Set());
}

const ACCOUNT_TYPE_PERSONAL = 1;
const ACCOUNT_TYPE_CREATOR = 2;
const ACCOUNT_TYPE_BUSINESS = 3;

/** Rótulos alinhados ao site (1=pessoal, 2=criador, 3=empresa). */
export function labelAccountType(type: number | undefined): string {
  if (type === 1) return 'Pessoal';
  if (type === 2) return 'Criador';
  if (type === 3) return 'Empresa';
  if (type === undefined) return 'desconhecido';
  return `tipo ${type}`;
}

/** Snapshot para a UI “em processamento” (gate ou perfil já extraído). */
export function summarizeProfileForUi(
  entity: Record<string, unknown>,
  followersHint?: number | null
): {
  full_name: string;
  category: string;
  account_type: number | null;
  followers_count: number | null;
} {
  const fn = String(getIn(entity, 'data.user.full_name', 'full_name', 'name') ?? '').trim();
  const cat = String(
    getIn(entity, 'data.user.category_name', 'data.user.category', 'category_name', 'category') ?? ''
  ).trim();
  const at = getAccountType(entity);
  let followers_count: number | null = null;
  if (followersHint != null && followersHint > 0) followers_count = followersHint;
  else {
    const n = getFollowersFromEntity(entity);
    if (n > 0) followers_count = n;
  }
  return {
    full_name: fn.slice(0, 120),
    category: cat.slice(0, 100),
    account_type: at ?? null,
    followers_count,
  };
}

function formatAllowedAccountTypesForMessage(allowed: number[]): string {
  return [...allowed]
    .sort((a, b) => a - b)
    .map((n) => `${n}=${labelAccountType(n)}`)
    .join(', ');
}

/**
 * Se `allowed` não for vazio e o Instagram informou `account_type`, exige que esteja na lista.
 * Se o tipo for 3 (empresa) e "Empresa" não estiver permitida, rejeita mesmo quando só há `is_business_account` + categoria (tipo às vezes omitido no primeiro payload).
 */
export function explainAccountTypeFilterMismatch(
  entity: Record<string, unknown>,
  allowed: number[],
  options?: { skipEstablishmentCategoryHeuristic?: boolean }
): string | null {
  if (!allowed.length) return null;
  const at = getAccountType(entity);
  if (at != null) {
    if (allowed.includes(at)) return null;
    return `Tipo de conta não permitido: account_type=${at} (${labelAccountType(at)}); aceitos: ${formatAllowedAccountTypesForMessage(allowed)}.`;
  }

  /** Sem account_type detectável: heurística para empresa (categoria comercial + conta business). */
  if (!allowed.includes(ACCOUNT_TYPE_BUSINESS)) {
    const rawAt = parseAccountTypeRaw(getIn(entity, 'data.user.account_type', 'account_type'));
    if (rawAt === ACCOUNT_TYPE_BUSINESS) {
      return `Tipo de conta não permitido: account_type=3 (${labelAccountType(3)}); aceitos: ${formatAllowedAccountTypesForMessage(allowed)}.`;
    }
    if (!options?.skipEstablishmentCategoryHeuristic) {
      const cat = String(
        getIn(entity, 'data.user.category_name', 'data.user.category', 'category_name', 'category') ?? ''
      ).trim();
      if (cat.length > 0) {
        const isBizFlag =
          getIn(entity, 'data.user.is_business_account', 'is_business_account', 'is_business') === true;
        if (isBizFlag && textContainsAny(normalizeCategory(cat), ESTABLISHMENT_KEYWORDS)) {
          return `Tipo de conta não permitido: account_type=? (heurística empresa; categoria «${cat.slice(0, 80)}»); aceitos: ${formatAllowedAccountTypesForMessage(allowed)}.`;
        }
      }
    }
  }

  return null;
}

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
  minFollowers: number,
  options?: { skipEstablishmentKeywordRules?: boolean }
): boolean {
  if (!options?.skipEstablishmentKeywordRules && isBusinessFromEntity(entity)) return false;
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
