import type { RequestWithAuth } from '../auth/middleware.js';
import { isCampaignIdGuid } from '../storage/creditsCampaignsDb.js';
import { isOpenAccess } from '../config/accessMode.js';

type PlanSubscriptionCheck = (userId: number) => boolean;
type CampaignPaidCheck = (campaignId: string, userId: number) => boolean;

let checkActivePlanSubscription: PlanSubscriptionCheck | null = null;
let checkCampaignPaid: CampaignPaidCheck | null = null;

/** Registrado em `server.ts` após instanciar `paymentsDb` / `creditsCampaignsDb`. */
export function registerInfluencerIdentityAccessChecks(opts: {
  hasActivePlanSubscription: PlanSubscriptionCheck;
  isCampaignPaidForUser: CampaignPaidCheck;
}): void {
  checkActivePlanSubscription = opts.hasActivePlanSubscription;
  checkCampaignPaid = opts.isCampaignPaidForUser;
}

/** Adm, modo open, ou assinante pagante (plano ativo ou campanha paga) — expõe @/handle na API. */
export function shouldIncludeHandleInApi(
  req: RequestWithAuth | undefined,
  ctx?: { campaignId?: string }
): boolean {
  if (isOpenAccess()) return true;
  if (!req?.user) return false;
  if (req.user.scope === 'adm') return true;
  if (req.user.scope !== 'assinante') return false;

  const userId = Number(req.user.sub);
  if (!Number.isFinite(userId)) return false;

  if (checkActivePlanSubscription?.(userId)) return true;

  const campaignId = ctx?.campaignId?.trim();
  if (campaignId && isCampaignIdGuid(campaignId) && checkCampaignPaid?.(campaignId, userId)) {
    return true;
  }

  return false;
}
