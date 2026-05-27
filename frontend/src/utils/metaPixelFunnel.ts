import { trackMetaPixel, trackMetaPixelCustom, type MetaPixelTrackParams } from './metaPixel'

/** Origem da busca — use no Events Manager para filtrar `AppSearch` e `Search`. */
export type SearchTrackSource =
  | 'topbar'
  | 'home_hero'
  | 'campaign_toolbar'
  | 'campaign_hero'
  | 'campaign_suggestion'
  | 'search_wizard'
  | 'url_landing'
  | 'bulk_message'

export type PlansIntentAction =
  | 'modal_open'
  | 'plan_select'
  | 'whatsapp'
  | 'quota_cta'
  | 'profile_lock'
  | 'premium_page'

export type PurchaseProductType = 'credits' | 'campaign_unlock' | 'credits_checkout'

const SEARCH_URL_DEDUP_PREFIX = 'busca:pixel:url-search:'

function trimParam(value: string, max = 120): string {
  return value.trim().slice(0, max)
}

/** Termo buscado (posts/perfis). Eventos: `Search` (padrão Meta) + `AppSearch` (custom). */
export function trackInfluencerSearch(
  searchString: string,
  source: SearchTrackSource,
  extra?: MetaPixelTrackParams
): void {
  const search_string = trimParam(searchString)
  if (!search_string) return
  trackMetaPixel('Search', { search_string, content_category: source, ...extra })
  trackMetaPixelCustom('AppSearch', { search_string, source, ...extra })
}

/** Primeira vez por sessão que a URL carrega com `?q=` (links compartilhados). */
export function trackInfluencerSearchFromUrlOnce(
  searchString: string,
  source: SearchTrackSource = 'url_landing'
): void {
  const search_string = trimParam(searchString)
  if (!search_string) return
  const dedupKey = `${SEARCH_URL_DEDUP_PREFIX}${source}:${search_string.toLowerCase()}`
  try {
    if (sessionStorage.getItem(dedupKey)) return
    sessionStorage.setItem(dedupKey, '1')
  } catch {
    /* sessionStorage indisponível */
  }
  trackInfluencerSearch(search_string, source)
}

/** Filtro do painel BI (cidade, tamanho, LLM, etc.). */
export function trackAppFilter(
  filterKey: string,
  value: string,
  selected: boolean,
  extra?: MetaPixelTrackParams
): void {
  trackMetaPixelCustom('AppFilter', {
    filter_key: filterKey,
    value: trimParam(value, 80),
    selected,
    ...extra,
  })
}

/** Intenção de assinar / ver planos (modal, CTA de limite, WhatsApp, etc.). */
export function trackPlansIntent(
  action: PlansIntentAction,
  extra?: MetaPixelTrackParams & { plan_id?: string; source?: string }
): void {
  trackMetaPixelCustom('PlansIntent', { action, ...extra })
  if (action === 'plan_select' && extra?.plan_id) {
    trackMetaPixel('Lead', {
      content_name: String(extra.plan_id),
      content_category: extra.source ?? 'plans_panel',
    })
  }
}

/** Página de checkout do plano aberta. */
export function trackCheckoutPlanView(planId: string, priceBrl: number): void {
  trackMetaPixel('InitiateCheckout', {
    content_name: planId,
    value: priceBrl,
    currency: 'BRL',
  })
}

/** Cobrança de créditos gerada (PIX/boleto). */
export function trackCreditsCheckoutInitiated(
  credits: number,
  valueBrl: number,
  extra?: MetaPixelTrackParams
): void {
  trackMetaPixel('InitiateCheckout', {
    content_category: 'credits',
    content_name: String(credits),
    value: valueBrl,
    currency: 'BRL',
    ...extra,
  })
  trackMetaPixelCustom('AppCreditsCheckout', {
    credits,
    value: valueBrl,
    currency: 'BRL',
    ...extra,
  })
}

/** Pagamento confirmado (créditos ou desbloqueio de campanha). */
export function trackPurchaseComplete(
  productType: PurchaseProductType,
  valueBrl: number,
  extra?: MetaPixelTrackParams
): void {
  trackMetaPixel('Purchase', {
    value: valueBrl,
    currency: 'BRL',
    content_category: productType,
    ...extra,
  })
  trackMetaPixelCustom('AppPurchase', {
    product_type: productType,
    value: valueBrl,
    currency: 'BRL',
    ...extra,
  })
}

/** Assinatura criada com sucesso (cartão aprovado ou trial ativo). */
export function trackSubscribeComplete(
  planId: string,
  priceBrl: number,
  extra?: MetaPixelTrackParams
): void {
  trackMetaPixel('Subscribe', {
    content_name: planId,
    value: priceBrl,
    currency: 'BRL',
    ...extra,
  })
  trackMetaPixelCustom('AppSubscribe', {
    plan_id: planId,
    value: priceBrl,
    currency: 'BRL',
    ...extra,
  })
}

/** Fatura do plano confirmada (PIX/boleto após assinatura pendente). */
export function trackSubscribePaymentConfirmed(
  planId: string,
  priceBrl: number,
  extra?: MetaPixelTrackParams
): void {
  trackMetaPixelCustom('AppSubscribePaid', {
    plan_id: planId,
    value: priceBrl,
    currency: 'BRL',
    ...extra,
  })
}

/** Cadastro de marca/assinante na página `/login`. */
export function trackAgencyRegistration(extra?: MetaPixelTrackParams): void {
  trackMetaPixel('CompleteRegistration', { source: 'agency_signup', ...extra })
}

/** Login de marca/assinante (intenção de retorno). */
export function trackAgencyLogin(extra?: MetaPixelTrackParams): void {
  trackMetaPixelCustom('AppLogin', { source: 'agency_login', ...extra })
}

/** E-mail validado pelo link. */
export function trackEmailVerified(extra?: MetaPixelTrackParams): void {
  trackMetaPixelCustom('EmailVerified', { ...extra })
}

/** Intenção de cadastro (ex.: modal de relatório). */
export function trackSignupIntent(source: string, extra?: MetaPixelTrackParams): void {
  trackMetaPixel('Lead', { source, ...extra })
}
