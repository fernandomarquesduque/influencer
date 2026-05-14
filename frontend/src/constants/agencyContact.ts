/** WhatsApp da agência Busca Influencer (bot de contratação). Dígitos com DDI, ex.: 5511999999999 */
export const AGENCY_WHATSAPP_DIGITS = (
  import.meta.env.VITE_AGENCY_WHATSAPP as string | undefined
)?.replace(/\D/g, '') ?? ''
