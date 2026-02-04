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

/** Indica se a entidade parece ser perfil de negócio (genérico). */
export function isBusinessFromEntity(entity: Record<string, unknown>): boolean {
  const fromPaths = getIn(
    entity,
    'data.user.is_business',
    'data.user.is_business_account',
    'is_business',
    'is_business_account',
    'graphql.user.is_business_account'
  );
  let v = fromPaths;
  if (v === undefined) {
    v = deepFindIsBusinessAccount(entity);
  }
  return v === true || v === 'true' || v === 1;
}
