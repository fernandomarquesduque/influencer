/** Fallback se a API de defaults não responder (deve coincidir com o padrão do servidor). */
export const FALLBACK_CAMPAIGN_ACCESS_DAYS = 365

export function expiresAtIsoFromDurationDays(days: number, from: Date = new Date()): string {
  const d = new Date(from.getTime());
  d.setDate(d.getDate() + Math.max(1, Math.floor(days)));
  return d.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` → data por extenso em pt-BR (ex.: 15 de março de 2026). */
export function formatCampaignExpiresLong(iso: string | null | undefined): string | null {
  if (!iso?.trim()) return null;
  const parts = iso.trim().split('-');
  if (parts.length !== 3) return null;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(day)) return null;
  try {
    const date = new Date(y, m - 1, day);
    return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' }).format(date);
  } catch {
    return null;
  }
}
