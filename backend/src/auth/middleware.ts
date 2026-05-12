import type { Request, Response, NextFunction } from 'express';
import { verifyJwt, getJwtSecret } from './jwt.js';
import type { JwtPayload, AuthScope } from './types.js';

export interface RequestWithAuth extends Request {
  user?: JwtPayload;
  /** Preenchido pelo middleware requireProfileOrCampaign quando o acesso foi liberado via campanha. */
  allowedCampaignId?: string;
  /**
   * Quando X-Campaign-Id é `all` e o handle não está em nenhuma campanha paga do usuário
   * (GET /api/posts deve redigir como visitante).
   */
  allBaseOutsidePaidCampaigns?: boolean;
}

/** Extrai JWT do header Authorization: Bearer <token> e define req.user. Se não houver token ou for inválido, req.user fica undefined (acesso público). */
export function authOptional(req: RequestWithAuth, _res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    if (token) {
      try {
        const secret = getJwtSecret();
        const payload = verifyJwt(token, secret);
        // Tokens de redefinição de senha não autenticam rotas da API.
        if (payload.pwd_reset === true) {
          req.user = undefined;
        } else {
          req.user = payload;
        }
      } catch {
        // token inválido ou expirado; segue como não autenticado
      }
    }
  }
  next();
}

/** Exige que req.user exista e tenha um dos scopes. Retorna 401 se não autenticado, 403 se scope insuficiente. */
export function requireScopes(...allowed: AuthScope[]) {
  return (req: RequestWithAuth, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Não autenticado', code: 'UNAUTHORIZED' });
      return;
    }
    if (allowed.includes(req.user.scope)) {
      next();
      return;
    }
    res.status(403).json({ error: 'Sem permissão para esta ação', code: 'FORBIDDEN' });
  };
}

/** Permite acesso sem autenticação ou com um dos scopes. Usado para rotas de cadastro (ex.: extract-profile no /app/create). */
export function requireScopesOrPublic(...allowed: AuthScope[]) {
  return (req: RequestWithAuth, res: Response, next: NextFunction): void => {
    if (!req.user) {
      next();
      return;
    }
    if (allowed.includes(req.user.scope)) {
      next();
      return;
    }
    res.status(403).json({ error: 'Sem permissão para esta ação', code: 'FORBIDDEN' });
  };
}

/** Retorna true se o usuário tem scope adm (acesso total). */
export function isAdm(payload: JwtPayload): boolean {
  return payload.scope === 'adm';
}

/** Retorna true se o usuário pode editar o perfil do handle dado (adm ou influencer com profile_handle === handle). */
export function canEditProfile(payload: JwtPayload, handle: string): boolean {
  if (payload.scope === 'adm') return true;
  if (payload.scope === 'influencer') {
    const h = (handle || '').replace(/^@/, '').toLowerCase();
    const profileHandle = (payload.profile_handle || '').replace(/^@/, '').toLowerCase();
    return profileHandle === h;
  }
  return false;
}
