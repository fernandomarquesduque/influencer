/**
 * Painel de pagamento da campanha: apenas créditos.
 * PIX/boleto ficam só em BuyCreditsModal (compra de créditos).
 */
import { Button, Tag, Popconfirm, Tooltip, Modal } from 'antd'
import { WalletOutlined, DollarOutlined, RocketOutlined } from '@ant-design/icons'
import type { ProfileListItem, ProfilesSearchQuery, ProfilesSearchFacets } from '../../api'
import { CONTENT_TYPE_LABELS } from '../../constants/contentTypes'
import InfluencerPreviewTable from '../InfluencerPreviewTable/InfluencerPreviewTable'
import { formatCampaignExpiresLong } from '../../utils/campaignExpires'
import './CampaignPaymentCart.css'

function buildActiveFilters(
  query: Partial<ProfilesSearchQuery>,
  facets: ProfilesSearchFacets | null,
  onFilter: (overrides: Partial<ProfilesSearchQuery>) => void
): { id: string; label: string; onRemove: () => void }[] {
  const out: { id: string; label: string; onRemove: () => void }[] = []
  const sizeBuckets = facets?.size_buckets ?? []
  const accountTypes = facets?.account_type ?? []
  query.sizeFilter?.forEach((key) => {
    const bucketKey = key === 'medio' ? 'mid' : key
    const label = sizeBuckets.find((b) => b.key === bucketKey || b.key === key)?.label ?? key
    out.push({ id: `size-${key}`, label, onRemove: () => onFilter({ sizeFilter: query.sizeFilter?.filter((k) => k !== key).length ? query.sizeFilter!.filter((k) => k !== key) : undefined }) })
  })
  query.accountTypeFilter?.forEach((value) => {
    const label = accountTypes.find((a) => a.value === value)?.label ?? String(value)
    out.push({ id: `account-${value}`, label, onRemove: () => onFilter({ accountTypeFilter: query.accountTypeFilter?.filter((v) => v !== value).length ? query.accountTypeFilter!.filter((v) => v !== value) : undefined }) })
  })
  query.contentTypes?.forEach((name) => {
    out.push({ id: `content-${name}`, label: CONTENT_TYPE_LABELS[name] ?? name, onRemove: () => onFilter({ contentTypes: query.contentTypes?.filter((c) => c !== name).length ? query.contentTypes!.filter((c) => c !== name) : undefined }) })
  })
  query.cities?.forEach((name) => {
    out.push({ id: `city-${name}`, label: name, onRemove: () => onFilter({ cities: query.cities?.filter((c) => c !== name).length ? query.cities!.filter((c) => c !== name) : undefined }) })
  })
  query.states?.forEach((name) => {
    out.push({ id: `state-${name}`, label: name, onRemove: () => onFilter({ states: query.states?.filter((s) => s !== name).length ? query.states!.filter((s) => s !== name) : undefined }) })
  })
  query.socialNetworks?.forEach((net) => {
    out.push({ id: `social-${net}`, label: net, onRemove: () => onFilter({ socialNetworks: query.socialNetworks?.filter((n) => n !== net).length ? query.socialNetworks!.filter((n) => n !== net) : undefined }) })
  })
  const pushLlmArr = (key: keyof ProfilesSearchQuery, prefix: string, labelFn: (v: string) => string) => {
    const arr = query[key] as string[] | undefined
    arr?.forEach((v) => {
      out.push({
        id: `${prefix}-${v}`,
        label: labelFn(v),
        onRemove: () => {
          const cur = (query[key] as string[] | undefined) ?? []
          const next = cur.filter((x) => x !== v)
          onFilter({ [key]: next.length ? next : undefined } as Partial<ProfilesSearchQuery>)
        },
      })
    })
  }
  pushLlmArr('llmProfileType', 'llm-pt', (v) => `Perfil: ${v}`)
  pushLlmArr('llmMainCategory', 'llm-cat', (v) => `Categoria: ${v}`)
  pushLlmArr('llmGender', 'llm-gen', (v) => `Gênero: ${v}`)
  pushLlmArr('llmSubCategories', 'llm-sub', (v) => `Sub: ${v}`)
  pushLlmArr('llmContentPillars', 'llm-pillar', (v) => `Pilar: ${v}`)
  pushLlmArr('llmAudienceType', 'llm-aud', (v) => `Público: ${v}`)
  if (query.q?.trim()) {
    out.push({ id: 'q', label: `Busca: "${query.q.trim().slice(0, 20)}${query.q!.trim().length > 20 ? '…' : ''}"`, onRemove: () => onFilter({ q: undefined }) })
  }
  return out
}

export interface CampaignPaymentCartProps {
  query: Partial<ProfilesSearchQuery>
  facets: ProfilesSearchFacets | null
  onFilter: (overrides: Partial<ProfilesSearchQuery>) => void
  /** Valor total (R$) pelos filtros atuais */
  valueTotal: number
  /** Quantidade de perfis (pelos filtros) */
  maxQuantity: number
  /** Pode pagar (pelo menos parte) com créditos */
  canPayWithCredits: boolean
  /** Créditos a usar ao clicar em "Pagar com créditos" */
  creditsToApply: number
  payingWithCredits: boolean
  onPayWithCredits: () => void | Promise<void>
  /** Abre o modal único de compra de créditos (PIX/boleto) */
  onBuyCredits: () => void
  /** Desconto: perfis que o cliente já tinha em outro relatório pago. */
  ownershipDiscount?: {
    alreadyOwnedCount: number
    originalValueBrl: number
    billableProfileCount: number
  }
  /** Valor em centavos após desconto (para liberar grátis quando 0). */
  amountCentsAfterDiscount?: number
  /** Lista filtrada para preview no checkout (pagamento pendente). */
  previewItems?: ProfileListItem[]
  previewLoading?: boolean
  /** Data de expiração do acesso ao relatório (`YYYY-MM-DD`, vinda da campanha). */
  campaignExpiresAt?: string | null
}

const formatBrl = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(n)

function openFinalizePurchaseModal() {
  Modal.info({
    title: 'Finalize a compra',
    content:
      'Esta é só uma amostra. Para ver todos os perfis da seleção no relatório completo, utilize seus créditos ou compre créditos e quite o pagamento acima.',
    okText: 'Entendi',
    centered: true,
  })
}

export default function CampaignPaymentCart({
  query,
  facets,
  onFilter,
  valueTotal,
  maxQuantity,
  canPayWithCredits,
  creditsToApply,
  payingWithCredits,
  onPayWithCredits,
  onBuyCredits,
  ownershipDiscount,
  amountCentsAfterDiscount,
  previewItems,
  previewLoading = false,
  campaignExpiresAt,
}: CampaignPaymentCartProps) {
  const activeFilters = buildActiveFilters(query, facets, onFilter)
  const freeUnlock = canPayWithCredits && creditsToApply === 0 && amountCentsAfterDiscount === 0
  const hasDiscount = ownershipDiscount && ownershipDiscount.alreadyOwnedCount > 0
  const expiresLabel = formatCampaignExpiresLong(campaignExpiresAt ?? null)

  return (
    <div className="campaign-payment-panel campaign-payment-cart">
      <div className="campaign-payment-cart__top-grid">
        <div className="campaign-payment-cart__summary-col">
          <div className="campaign-payment-cart__checkout-block">
            <button
              type="button"
              className="campaign-payment-cart__hook"
              onClick={openFinalizePurchaseModal}
              aria-label="Como liberar o relatório completo"
            >
              <RocketOutlined className="campaign-payment-cart__hook-icon" aria-hidden />
              <span className="campaign-payment-cart__hook-text">
                Quase pronto: libere o relatório completo e decida com dados reais sobre quem leva sua campanha adiante.
              </span>
            </button>
            {expiresLabel ? (
              <p className="campaign-payment-cart__expires-line">
                Acesso ao relatório até <strong>{expiresLabel}</strong>
              </p>
            ) : null}
            {hasDiscount ? (
              <p className="campaign-payment-cart__discount-note">
                <strong>{ownershipDiscount!.alreadyOwnedCount}</strong>{' '}
                {ownershipDiscount!.alreadyOwnedCount === 1 ? 'perfil sem custo' : 'perfis sem custo'} (já em outro relatório seu).
              </p>
            ) : null}
          </div>
        </div>

        <div className="campaign-payment-cart__actions-col">
          <div className="campaign-payment-cart__paybox">
            <div className="campaign-payment-cart__paybox-total" aria-label={`Total a pagar ${formatBrl(valueTotal)}`}>
              <span className="campaign-payment-cart__total-label">Total a pagar</span>
              <span className="campaign-payment-cart__price-value">{formatBrl(valueTotal)}</span>
            </div>
            <div className="campaign-payment-cart__actions">
              {canPayWithCredits ? (
                <div className="campaign-payment-cart__cta">
                  <Popconfirm
                    title={freeUnlock ? 'Liberar relatório sem custo?' : 'Confirmar pagamento com créditos?'}
                    description={
                      freeUnlock
                        ? 'Todos os perfis desta seleção já estão em outros relatórios seus ou não há valor a cobrar. O relatório será liberado sem debitar créditos.'
                        : `Debitar ${creditsToApply} crédito${creditsToApply !== 1 ? 's' : ''} e liberar o relatório. Não dá para desfazer.`
                    }
                    okText={freeUnlock ? 'Liberar relatório' : 'Confirmar pagamento'}
                    cancelText="Cancelar"
                    okButtonProps={{ loading: payingWithCredits }}
                    disabled={payingWithCredits}
                    onConfirm={() => Promise.resolve(onPayWithCredits())}
                  >
                    <span className="campaign-payment-cart__cta-inner">
                      <Button type="primary" icon={<WalletOutlined />} loading={payingWithCredits} block>
                        {payingWithCredits
                          ? 'Processando...'
                          : freeUnlock
                            ? 'Liberar relatório (sem custo)'
                            : 'Utilizar Créditos'}
                      </Button>
                    </span>
                  </Popconfirm>
                </div>
              ) : null}
              <div className="campaign-payment-cart__cta">
                <Tooltip title="Compra por PIX ou boleto; depois use o botão roxo para liberar este relatório.">
                  <Button type="default" icon={<DollarOutlined />} block onClick={onBuyCredits} disabled={payingWithCredits}>
                    Comprar créditos
                  </Button>
                </Tooltip>
              </div>
            </div>
          </div>
        </div>
      </div>

      {previewItems !== undefined ? (
        <div className="campaign-payment-cart__preview-wrap">
          <InfluencerPreviewTable
            className="iprv-preview--in-payment-cart"
            campaignProfiles={previewItems}
            selectionTotalCount={maxQuantity}
            loading={previewLoading}
            limit={5}
            title="Quem entra neste relatório"
            previewStablePicOnly
            hideSelectionCountInTitle
            onSelectionOverflowClick={openFinalizePurchaseModal}
          />
        </div>
      ) : null}

      {activeFilters.length > 0 ? (
        <div className="campaign-payment-cart__filters">
          {activeFilters.map((f) => (
            <Tag key={f.id} closable onClose={f.onRemove}>
              {f.label}
            </Tag>
          ))}
        </div>
      ) : null}
    </div>
  )
}
