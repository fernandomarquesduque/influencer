/**
 * Cálculo de preço sugerido por tipo de conteúdo (feed, reels, story, destaque)
 * a partir do número de seguidores. Mesma lógica do frontend para manter consistência.
 * Usado no GET /api/profiles/:handle/activation quando o usuário não informou preços.
 */

import { getFollowersFromEntity } from './entityAccess.js';

const PRICE_BUCKET_VALUES = [0, 50, 100, 250, 500, 1000, 2500, 5000, 15000] as const;

const FORMAT_MULTIPLIER: Record<string, number> = {
  feed: 1,
  reels: 1.2,
  story: 0.25,
  destaque: 0.5,
};

const PRICING_KEYS = ['feed', 'reels', 'story', 'destaque'] as const;

export type SuggestedPricingKeys = (typeof PRICING_KEYS)[number];

/** Valor base sugerido por post (em reais) a partir de seguidores. Conservador, começa baixo. */
function getBaseValueFromFollowers(followers: number): number {
  if (followers < 500) return 30;
  if (followers < 2000) return 50;
  if (followers < 5000) return 80;
  if (followers < 10000) return 150;
  if (followers < 25000) return 250;
  if (followers < 50000) return 400;
  if (followers < 100000) return 700;
  if (followers < 500000) return 1500;
  return 4000;
}

/** Retorna o value do bucket cuja faixa contém o valor em reais (maior mínimo <= reais). */
function valueToBucketValue(reais: number): number {
  const sorted = [...PRICE_BUCKET_VALUES].sort((a, b) => b - a);
  for (const v of sorted) {
    if (v <= reais) return v;
  }
  return PRICE_BUCKET_VALUES[0];
}

/**
 * Sugere faixas de preço por formato com base no número de seguidores do perfil.
 * Retorna objeto com chaves feed, reels, story, destaque e valores = bucket (0, 50, 100, 250, 500, 1000, 2500, 5000, 15000).
 */
export function getSuggestedPricingFromFollowers(
  followersCount: number
): Record<SuggestedPricingKeys, number> {
  const base = getBaseValueFromFollowers(Math.max(0, followersCount));
  const result = {} as Record<SuggestedPricingKeys, number>;
  for (const key of PRICING_KEYS) {
    const mult = FORMAT_MULTIPLIER[key] ?? 1;
    const value = Math.round(base * mult);
    result[key] = valueToBucketValue(Math.max(0, value));
  }
  return result;
}

/**
 * Converte o resultado numérico para o formato de pricing da ativação (valores como string).
 */
export function suggestedPricingToActivationFormat(
  suggested: Record<SuggestedPricingKeys, number>
): Record<string, string> {
  return {
    feed: String(suggested.feed),
    reels: String(suggested.reels),
    story: String(suggested.story),
    destaque: String(suggested.destaque),
  };
}

/** Extrai seguidores do perfil (entity do RocksDB). */
export function getFollowersFromProfile(profile: Record<string, unknown> | null | undefined): number {
  if (!profile || typeof profile !== 'object') return 0;
  const direct = profile.followers_count;
  if (typeof direct === 'number' && Number.isFinite(direct) && direct > 0) return Math.max(0, direct);
  const fromEntity = getFollowersFromEntity(profile);
  if (fromEntity > 0) return fromEntity;
  if (typeof direct === 'number' && Number.isFinite(direct)) return Math.max(0, direct);
  return 0;
}

/** Verifica se o pricing da ativação está vazio (sem nenhum valor preenchido). */
export function isPricingEmpty(pricing: Record<string, unknown> | null | undefined): boolean {
  if (!pricing || typeof pricing !== 'object') return true;
  for (const k of PRICING_KEYS) {
    const v = pricing[k];
    if (v !== undefined && v !== null && v !== '') return false;
  }
  return true;
}

/** Tier de custo: mesma lógica do frontend (getCostTier). */
export type CostTier = 'low' | 'medium' | 'high' | 'very_high';

const COST_TIERS: { tier: CostTier; minAvg: number }[] = [
  { tier: 'low', minAvg: 0 },
  { tier: 'medium', minAvg: 500 },
  { tier: 'high', minAvg: 2500 },
  { tier: 'very_high', minAvg: 5000 },
];

/**
 * Calcula o tier de custo a partir do pricing (média dos valores feed, reels, story, destaque).
 * Retorna null se não houver dados.
 */
export function getCostTierFromPricing(pricing: Record<string, unknown> | null | undefined): CostTier | null {
  if (!pricing || typeof pricing !== 'object') return null;
  const values: number[] = [];
  for (const k of PRICING_KEYS) {
    const v = pricing[k];
    if (v === undefined || v === null || v === '') continue;
    const n = typeof v === 'number' ? v : Number(v);
    if (Number.isFinite(n)) values.push(n);
  }
  if (values.length === 0) return null;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  for (let i = COST_TIERS.length - 1; i >= 0; i--) {
    if (avg >= COST_TIERS[i]!.minAvg) return COST_TIERS[i]!.tier;
  }
  return COST_TIERS[0]!.tier;
}
