import { createHmac } from 'node:crypto';
import type { JwtPayload } from './types.js';

const ALG = 'HS256';
const TYP = 'JWT';
const DEFAULT_EXP_SEC = 7 * 24 * 3600; // 7 days

function base64UrlEncode(data: Buffer | string): string {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  return buf.toString('base64url');
}

function base64UrlDecode(str: string): Buffer {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4;
  const padded = pad ? base64 + '='.repeat(4 - pad) : base64;
  return Buffer.from(padded, 'base64');
}

export function signJwt(payload: Omit<JwtPayload, 'iat' | 'exp'>, secret: string, expSec = DEFAULT_EXP_SEC): string {
  const header = { alg: ALG, typ: TYP };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + expSec };
  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(fullPayload));
  const signatureInput = `${headerB64}.${payloadB64}`;
  const sig = createHmac('sha256', secret).update(signatureInput).digest();
  const sigB64 = base64UrlEncode(sig);
  return `${signatureInput}.${sigB64}`;
}

export function verifyJwt(token: string, secret: string): JwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');
  const [headerB64, payloadB64, sigB64] = parts;
  const signatureInput = `${headerB64}.${payloadB64}`;
  const expectedSig = createHmac('sha256', secret).update(signatureInput).digest();
  const expectedB64 = base64UrlEncode(expectedSig);
  if (sigB64 !== expectedB64) throw new Error('Invalid JWT signature');
  const payloadJson = base64UrlDecode(payloadB64).toString('utf8');
  const payload = JSON.parse(payloadJson) as JwtPayload;
  if (payload.exp != null && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('JWT expired');
  }
  return payload;
}

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.length >= 16) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set and at least 16 characters in production');
  }
  return 'dev-secret-change-in-production-min-16-chars';
}
