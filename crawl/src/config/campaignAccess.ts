/**
 * Duração do acesso ao relatório de campanha (dias a partir da criação).
 * Configure no servidor: CAMPAIGN_ACCESS_DURATION_DAYS (padrão 365).
 * Expõe também a data ISO YYYY-MM-DD usada ao criar campanha sem data explícita.
 */

export function campaignAccessDurationDays(): number {
  const raw = process.env.CAMPAIGN_ACCESS_DURATION_DAYS;
  const n = raw != null && String(raw).trim() !== '' ? Number(raw) : NaN;
  if (Number.isFinite(n) && n > 0) return Math.min(Math.floor(n), 3650);
  return 365;
}

/** Data de expiração padrão para novas campanhas (fim do dia local não é necessário; só YYYY-MM-DD). */
export function defaultCampaignExpiresAtIso(from: Date = new Date()): string {
  const d = new Date(from.getTime());
  d.setDate(d.getDate() + campaignAccessDurationDays());
  return d.toISOString().slice(0, 10);
}
