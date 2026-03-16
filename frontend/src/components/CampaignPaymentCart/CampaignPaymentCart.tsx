/**
 * Painel de pagamento da campanha: créditos, PIX e boleto.
 * Estilo carrinho — compacto, foco no pagamento.
 */
import { Card, Button, Tag, Typography } from 'antd'
import { BankOutlined, CopyOutlined, WalletOutlined } from '@ant-design/icons'
import type { ProfilesSearchQuery, ProfilesSearchFacets } from '../../api'
import { CONTENT_TYPE_LABELS } from '../../constants/contentTypes'
import './CampaignPaymentCart.css'

const COST_TIER_LABELS: Record<string, string> = { low: 'Preço baixo', medium: 'Preço normal', high: 'Preço acima', very_high: 'Preço acima' }

function buildActiveFilters(
  query: Partial<ProfilesSearchQuery>,
  facets: ProfilesSearchFacets | null,
  onFilter: (overrides: Partial<ProfilesSearchQuery>) => void
): { id: string; label: string; onRemove: () => void }[] {
  const out: { id: string; label: string; onRemove: () => void }[] = []
  const sizeBuckets = facets?.size_buckets ?? []
  const accountTypes = facets?.account_type ?? []
  query.sizeFilter?.forEach((key) => {
    const label = sizeBuckets.find((b) => b.key === key)?.label ?? key
    out.push({ id: `size-${key}`, label, onRemove: () => onFilter({ sizeFilter: query.sizeFilter?.filter((k) => k !== key).length ? query.sizeFilter!.filter((k) => k !== key) : undefined }) })
  })
  query.accountTypeFilter?.forEach((value) => {
    const label = accountTypes.find((a) => a.value === value)?.label ?? String(value)
    out.push({ id: `account-${value}`, label, onRemove: () => onFilter({ accountTypeFilter: query.accountTypeFilter?.filter((v) => v !== value).length ? query.accountTypeFilter!.filter((v) => v !== value) : undefined }) })
  })
  query.activationFilter?.forEach((val) => {
    const label = val === 'activated' ? 'Ativados' : 'Não ativados'
    out.push({ id: `act-${val}`, label, onRemove: () => onFilter({ activationFilter: query.activationFilter?.filter((v) => v !== val).length ? query.activationFilter!.filter((v) => v !== val) : undefined }) })
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
  query.costTierFilter?.forEach((tier) => {
    out.push({ id: `cost-${tier}`, label: COST_TIER_LABELS[tier] ?? tier, onRemove: () => onFilter({ costTierFilter: query.costTierFilter?.filter((t) => t !== tier).length ? query.costTierFilter!.filter((t) => t !== tier) : undefined }) })
  })
  query.socialNetworks?.forEach((net) => {
    out.push({ id: `social-${net}`, label: net, onRemove: () => onFilter({ socialNetworks: query.socialNetworks?.filter((n) => n !== net).length ? query.socialNetworks!.filter((n) => n !== net) : undefined }) })
  })
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
  /** Pode pagar 100% com créditos */
  canPayWithCredits: boolean
  /** Créditos a usar ao clicar em "Pagar com créditos" */
  creditsToApply: number
  /** Pagamento pendente da API (quando já gerou PIX/boleto) */
  pendingPayment?: {
    billingType: string | null
    bankSlipUrl: string | null
    invoiceUrl: string | null
    pixCopyPaste: string | null
  } | null
  /** Precisa gerar PIX/boleto (não existe ainda) */
  needsGeneratePayment: boolean
  payingWithCredits: boolean
  creatingPayment: 'pix' | 'boleto' | null
  onPayWithCredits: () => void
  onGeneratePix: () => void
  onOpenBoletoModal: () => void
}

const formatBrl = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(n)

export default function CampaignPaymentCart({
  query,
  facets,
  onFilter,
  valueTotal,
  maxQuantity,
  canPayWithCredits,
  creditsToApply,
  pendingPayment,
  needsGeneratePayment,
  payingWithCredits,
  creatingPayment,
  onPayWithCredits,
  onGeneratePix,
  onOpenBoletoModal,
}: CampaignPaymentCartProps) {
  const activeFilters = buildActiveFilters(query, facets, onFilter)

  return (
    <Card
      className="campaign-payment-panel campaign-payment-cart"
      size="small"
      style={{
        width: '100%',
        background: 'var(--app-card-bg)',
        border: '1px solid var(--app-border)',
        borderRadius: 12,
        overflow: 'hidden',
      }}
      bodyStyle={{ padding: '14px 16px' }}
    >
      <div className="campaign-payment-cart__summary">
        <strong>{maxQuantity}</strong> perfil{maxQuantity !== 1 ? 's' : ''}
        <span>·</span>
        <span>{formatBrl(valueTotal)}</span>
      </div>

      {activeFilters.length > 0 && (
        <div className="campaign-payment-cart__filters">
          {activeFilters.map((f) => (
            <Tag key={f.id} closable onClose={f.onRemove}>
              {f.label}
            </Tag>
          ))}
        </div>
      )}

      <div className="campaign-payment-cart__total-row">
        <span className="campaign-payment-cart__total-label">Total</span>
        <span className="campaign-payment-cart__total-value">{formatBrl(valueTotal)}</span>
      </div>

      {canPayWithCredits && (
        <div className="campaign-payment-cart__cta">
          <Button
            type="primary"
            icon={<WalletOutlined />}
            loading={payingWithCredits}
            disabled={!!creatingPayment}
            onClick={onPayWithCredits}
            style={{ fontWeight: 600, boxShadow: 'var(--app-shadow-cta)', background: 'linear-gradient(135deg, var(--app-primary) 0%, var(--app-primary-dark) 100%)', border: 'none' }}
          >
            {payingWithCredits ? 'Processando...' : `Pagar com ${creditsToApply} crédito${creditsToApply !== 1 ? 's' : ''}`}
          </Button>
        </div>
      )}

      <div className="campaign-payment-cart__method">
        <span className="campaign-payment-cart__method-label">PIX</span>
        {needsGeneratePayment ? (
          <Button
            type={canPayWithCredits ? 'default' : 'primary'}
            size="small"
            icon={<BankOutlined />}
            loading={creatingPayment === 'pix'}
            disabled={!!creatingPayment || payingWithCredits}
            onClick={onGeneratePix}
            style={canPayWithCredits ? {} : { fontWeight: 600, boxShadow: 'var(--app-shadow-cta)', background: 'linear-gradient(135deg, var(--app-primary) 0%, var(--app-primary-dark) 100%)', border: 'none' }}
          >
            Gerar PIX
          </Button>
        ) : pendingPayment?.billingType === 'PIX' && pendingPayment?.pixCopyPaste ? (
          <>
            <Typography.Text copyable={{ text: pendingPayment.pixCopyPaste }} style={{ fontSize: 11, wordBreak: 'break-all', flex: 1, minWidth: 0 }} ellipsis />
            <Button type="primary" size="small" icon={<CopyOutlined />} onClick={() => pendingPayment?.pixCopyPaste && void navigator.clipboard.writeText(pendingPayment.pixCopyPaste)}>
              Copiar e pagar
            </Button>
          </>
        ) : (
          <Button size="small" icon={<BankOutlined />} loading={creatingPayment === 'pix'} disabled={!!creatingPayment || payingWithCredits} onClick={onGeneratePix}>
            Gerar PIX
          </Button>
        )}
      </div>

      <div className="campaign-payment-cart__method">
        <span className="campaign-payment-cart__method-label">Boleto</span>
        {needsGeneratePayment ? (
          <Button size="small" icon={<BankOutlined />} loading={creatingPayment === 'boleto'} disabled={!!creatingPayment || payingWithCredits} onClick={onOpenBoletoModal}>
            Gerar boleto
          </Button>
        ) : pendingPayment?.billingType === 'BOLETO' && pendingPayment?.bankSlipUrl ? (
          <>
            <Button type="primary" size="small" href={pendingPayment.bankSlipUrl} target="_blank" rel="noopener noreferrer" icon={<BankOutlined />}>
              Abrir boleto
            </Button>
            <Button size="small" icon={<BankOutlined />} loading={creatingPayment === 'pix'} disabled={!!creatingPayment || payingWithCredits} onClick={onGeneratePix}>
              Gerar PIX
            </Button>
          </>
        ) : (
          <Button size="small" icon={<BankOutlined />} loading={creatingPayment === 'boleto'} disabled={!!creatingPayment || payingWithCredits} onClick={onOpenBoletoModal}>
            Gerar boleto
          </Button>
        )}
        {pendingPayment?.invoiceUrl && (
          <Button href={pendingPayment.invoiceUrl} target="_blank" rel="noopener noreferrer" size="small" type="link" style={{ padding: 0, marginLeft: 8 }}>
            Ver fatura
          </Button>
        )}
      </div>
    </Card>
  )
}
