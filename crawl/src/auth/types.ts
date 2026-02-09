/** Escopos de acesso: adm = tudo, assinante = navegação completa, influencer = edita só o próprio perfil, public = limite 10 buscas, 1ª página, sem filtros, detalhe limitado. */
export type AuthScope = 'adm' | 'assinante' | 'influencer' | 'public';

export interface AuthUser {
  id: number;
  username: string;
  scope: AuthScope;
  profile_handle: string | null;
  created_at: string;
}

export interface JwtPayload {
  sub: string; // user id
  username: string;
  scope: AuthScope;
  profile_handle?: string;
  iat?: number;
  exp?: number;
}

export interface AuthUserCreate {
  username: string;
  password: string;
  scope: AuthScope;
  profile_handle?: string | null;
}

export interface AuthUserUpdate {
  username?: string;
  password?: string;
  scope?: AuthScope;
  profile_handle?: string | null;
}
