/**
 * Painel de pagamento da campanha: apenas créditos.
 * PIX/boleto ficam só em BuyCreditsModal (compra de créditos).
 */
import { Card, Button, Tag, Alert, Popconfirm } from 'antd'
import { WalletOutlined, DollarOutlined } from '@ant-design/icons'
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
  payingWithCredits,
  onPayWithCredits,
  onBuyCredits,
  ownershipDiscount,
  amountCentsAfterDiscount,
}: CampaignPaymentCartProps) {
  const activeFilters = buildActiveFilters(query, facets, onFilter)
  const freeUnlock = canPayWithCredits && creditsToApply === 0 && amountCentsAfterDiscount === 0

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
        {ownershipDiscount && ownershipDiscount.alreadyOwnedCount > 0 ? (
          <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '6px 10px' }}>
            <span style={{ textDecoration: 'line-through', opacity: 0.65, fontWeight: 500 }}>
              {formatBrl(ownershipDiscount.originalValueBrl)}
            </span>
            <span style={{ fontWeight: 700 }}>{formatBrl(valueTotal)}</span>
          </span>
        ) : (
          <span>{formatBrl(valueTotal)}</span>
        )}
      </div>

      {ownershipDiscount && ownershipDiscount.alreadyOwnedCount > 0 && (
        <Alert
          type="success"
          showIcon
          message={
            <span>
              <strong>{ownershipDiscount.alreadyOwnedCount}</strong>{' '}
              {ownershipDiscount.alreadyOwnedCount === 1
                ? 'perfil já está em outro relatório seu'
                : 'perfis já estão em outros relatórios seus'}
              {' — sem cobrança de novo.'}
            </span>
          }
          description={
            <span style={{ fontSize: 13 }}>
              Cobramos apenas <strong>{ownershipDiscount.billableProfileCount}</strong>{' '}
              {ownershipDiscount.billableProfileCount === 1 ? 'perfil novo' : 'perfis novos'} (
              {formatBrl(valueTotal)} no total desta seleção).
            </span>
          }
          style={{ marginBottom: 12, textAlign: 'left' }}
        />
      )}

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
        <span className="campaign-payment-cart__total-value" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
          {ownershipDiscount && ownershipDiscount.alreadyOwnedCount > 0 && (
            <span style={{ fontSize: 13, fontWeight: 500, textDecoration: 'line-through', opacity: 0.55 }}>
              {formatBrl(ownershipDiscount.originalValueBrl)}
            </span>
          )}
          <span>{formatBrl(valueTotal)}</span>
        </span>
      </div>

      <Alert
        type="info"
        showIcon
        message="Liberação com créditos"
        description="Compre créditos (PIX ou boleto) no botão abaixo e quite o relatório com um clique."
        style={{ marginBottom: 12 }}
      />

      {canPayWithCredits && (
        <div className="campaign-payment-cart__cta">
          <Popconfirm
            title={freeUnlock ? 'Liberar relatório sem custo?' : 'Confirmar pagamento com créditos?'}
            description={
              freeUnlock
                ? 'Todos os perfis desta seleção já estão em outros relatórios seus ou não há valor a cobrar. O relatório será liberado sem debitar créditos.'
                : `Serão usados ${creditsToApply} crédito${creditsToApply !== 1 ? 's' : ''} do seu saldo para liberar o relatório desta campanha. Esta ação não pode ser desfeita.`
            }
            okText={freeUnlock ? 'Liberar relatório' : 'Confirmar pagamento'}
            cancelText="Cancelar"
            okButtonProps={{ loading: payingWithCredits }}
            disabled={payingWithCredits}
            onConfirm={() => Promise.resolve(onPayWithCredits())}
          >
            <span style={{ display: 'block', width: '100%' }}>
              <Button
                type="primary"
                icon={<WalletOutlined />}
                loading={payingWithCredits}
                style={{ fontWeight: 600, boxShadow: 'var(--app-shadow-cta)', background: 'linear-gradient(135deg, var(--app-primary) 0%, var(--app-primary-dark) 100%)', border: 'none' }}
              >
                {payingWithCredits
                  ? 'Processando...'
                  : freeUnlock
                    ? 'Liberar relatório (sem custo)'
                    : `Pagar com ${creditsToApply} crédito${creditsToApply !== 1 ? 's' : ''}`}
              </Button>
            </span>
          </Popconfirm>
        </div>
      )}

      <div className="campaign-payment-cart__cta" style={{ marginTop: canPayWithCredits ? 10 : 0 }}>
        <Button type="default" icon={<DollarOutlined />} block onClick={onBuyCredits} disabled={payingWithCredits}>
          Comprar créditos (PIX ou boleto)
        </Button>
      </div>
    </Card>
  )
}
