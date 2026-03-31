/**
 * Patamares de porte por contagem de seguidores — fonte única para:
 * filtro `sizeFilter`, facetas `followers_buckets` e classificação (preview, UI).
 * Intervalos: [min, max) quando `max` está definido; último bucket com `max` indefinido é [min, ∞).
 *
 * Para alterar limites ou nomes, edite apenas `FOLLOWERS_SIZE_BUCKETS`.
 */

export type FollowersSizeKey = 'nano' | 'micro' | 'medio' | 'macro' | 'elite' | 'celebridade';

export type FollowersSizeBucketDef = {
  key: FollowersSizeKey;
  label: string;
  min: number;
  max: number | undefined;
};

export const FOLLOWERS_SIZE_BUCKETS: readonly FollowersSizeBucketDef[] = [
  { key: 'nano', label: 'Nano', min: 0, max: 30_000 },
  { key: 'micro', label: 'Micro', min: 30_000, max: 100_000 },
  { key: 'medio', label: 'Médio', min: 100_000, max: 250_000 },
  { key: 'macro', label: 'Macro', min: 250_000, max: 500_000 },
  { key: 'elite', label: 'Elite', min: 500_000, max: 1_000_000 },
  { key: 'celebridade', label: 'Celebridade', min: 1_000_000, max: undefined },
] as const;

export function followersCountToSizeKey(followers: number): FollowersSizeKey {
  const fc = Number.isFinite(followers) && followers >= 0 ? followers : 0;
  for (const b of FOLLOWERS_SIZE_BUCKETS) {
    if (b.max == null) {
      if (fc >= b.min) return b.key;
    } else if (fc >= b.min && fc < b.max) {
      return b.key;
    }
  }
  return FOLLOWERS_SIZE_BUCKETS[FOLLOWERS_SIZE_BUCKETS.length - 1]!.key;
}

export type FollowersBucketFacetRow = {
  key: string;
  label: string;
  min: number;
  max: number | undefined;
  count: number;
};

/** Modelo das facetas: contagens zeradas; mutável para acumular no loop. */
export function createEmptyFollowersBucketsForFacets(): FollowersBucketFacetRow[] {
  return FOLLOWERS_SIZE_BUCKETS.map((b) => ({
    key: b.key,
    label: b.label,
    min: b.min,
    max: b.max,
    count: 0,
  }));
}

export function incrementFollowersBucketCount(
  buckets: FollowersBucketFacetRow[],
  followersCount: number | null | undefined
): void {
  const key = followersCountToSizeKey(
    typeof followersCount === 'number' ? followersCount : Number(followersCount ?? 0)
  );
  const row = buckets.find((r) => r.key === key);
  if (row) row.count += 1;
}
