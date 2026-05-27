import { useCallback, useEffect, useState } from 'react'
import { Button, Spin } from 'antd'
import { useNavigate } from 'react-router-dom'
import { CheckOutlined, CrownOutlined, WhatsAppOutlined, CreditCardOutlined } from '@ant-design/icons'
import { AGENCY_WHATSAPP_DIGITS } from '../../constants/agencyContact'
import { BUSCA_PLANS } from '../../constants/buscaPlans'
import { trackPlansIntent } from '../../utils/metaPixelFunnel'
import { fetchMyPendingPayment, fetchMySubscription } from '../../api'
import { useAuth } from '../../contexts/AuthContext'
import './BuscaInfluencerPlansModal.css'

function buildPlansWhatsAppUrl(): string {
  const text = [
    'Olá! Quero saber mais sobre os planos da Busca Influencer.',
    '',
    'Tenho interesse em contratar criadores com apoio completo da agência.',
  ].join('\n')
  return `https://wa.me/${AGENCY_WHATSAPP_DIGITS}?text=${encodeURIComponent(text)}`
}

export type BuscaInfluencerPlansPanelProps = {
  className?: string
  checkSubscription?: boolean
  onAfterAction?: () => void
}

export function useBuscaPlansSubscriptionAccess(enabled: boolean) {
  const { user } = useAuth()
  const [loading, setLoading] = useState(enabled)
  const [active, setActive] = useState(!enabled)
  const [hasPendingSubscription, setHasPendingSubscription] = useState(false)
  const [refreshNonce, setRefreshNonce] = useState(0)

  const refresh = useCallback(() => {
    if (!enabled) return
    setRefreshNonce((n) => n + 1)
  }, [enabled])

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      setActive(true)
      setHasPendingSubscription(false)
      return
    }
    if (!user) {
      setLoading(false)
      setActive(false)
      setHasPendingSubscription(false)
      return
    }
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const [subscription, pending] = await Promise.all([
          fetchMySubscription().catch(() => null),
          fetchMyPendingPayment().catch(() => null),
        ])
        if (cancelled) return
        const pendingPlan = subscription?.active
          ? false
          : Boolean(subscription?.hasPendingPlanPayment) ||
            Boolean(pending && !subscription?.active)
        setHasPendingSubscription(pendingPlan)
        setActive(Boolean(subscription?.active))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [enabled, user, refreshNonce])

  return { loading, active, hasPendingSubscription, refresh }
}

export default function BuscaInfluencerPlansPanel({
  className,
  checkSubscription = false,
  onAfterAction,
}: BuscaInfluencerPlansPanelProps) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { loading, hasPendingSubscription } = useBuscaPlansSubscriptionAccess(
    checkSubscription && Boolean(user)
  )

  const onWhatsApp = () => {
    if (!AGENCY_WHATSAPP_DIGITS) return
    trackPlansIntent('whatsapp', { source: 'plans_panel' })
    window.open(buildPlansWhatsAppUrl(), '_blank', 'noopener,noreferrer')
    onAfterAction?.()
  }

  const openPlanCheckout = (planId: string) => {
    trackPlansIntent('plan_select', { plan_id: planId, source: 'plans_panel' })
    onAfterAction?.()
    navigate(`/checkout/plan/${planId}`)
  }

  const goToPayments = () => {
    onAfterAction?.()
    navigate('/app/payments')
  }

  const rootClass = ['busca-plans-modal__body', className].filter(Boolean).join(' ')

  if (checkSubscription && user && loading) {
    return (
      <div className={rootClass}>
        <div className="busca-plans-modal__loading">
          <Spin size="large" />
        </div>
      </div>
    )
  }

  if (checkSubscription && user && hasPendingSubscription) {
    return (
      <div className={rootClass}>
        <div className="busca-plans-modal__eyebrow">Assinatura pendente</div>
        <h2 className="busca-plans-modal__title">Conclua o pagamento para liberar a busca completa</h2>
        <p className="busca-plans-modal__intro">
          Sua assinatura já foi criada, mas ainda falta finalizar o pagamento (cartão ou fatura).
          Depois de confirmado, você acessa a base completa e a contratação de criadores.
        </p>
        <Button
          type="primary"
          size="large"
          block
          className="busca-plans-modal__cta busca-plans-modal__pending-cta"
          icon={<CreditCardOutlined />}
          onClick={goToPayments}
        >
          Ir para Meus pagamentos
        </Button>
        <p className="busca-plans-modal__hint">
          Em Meus pagamentos você encontra a fatura em aberto e o link para concluir.
        </p>
      </div>
    )
  }

  return (
    <div className={rootClass}>
      <div className="busca-plans-modal__eyebrow">Nossos planos</div>
      <h2 className="busca-plans-modal__title">Dados reais para escolher e contratar criadores na sua região</h2>
      <p className="busca-plans-modal__intro">
        Veja preço sugerido, engajamento e alcance antes de falar com o criador. Desbloqueie o @, filtre por cidade
        e feche a parceria com apoio da Busca Influencer.
      </p>

      <div className="busca-plans-modal__grid">
        {BUSCA_PLANS.map((plan) => (
          <article
            key={plan.id}
            className={[
              'busca-plans-modal__card',
              plan.featured ? 'busca-plans-modal__card--featured' : 'busca-plans-modal__card--basic',
            ].join(' ')}
          >
            {'badge' in plan && plan.badge ? (
              <div
                className={
                  plan.featured
                    ? 'busca-plans-modal__badge busca-plans-modal__badge--featured'
                    : 'busca-plans-modal__badge busca-plans-modal__badge--basic'
                }
              >
                {plan.featured ? <CrownOutlined aria-hidden /> : null}
                {plan.badge}
              </div>
            ) : null}
            <div className="busca-plans-modal__card-head">
              <div className="busca-plans-modal__plan-meta">
                <span className="busca-plans-modal__plan-name">{plan.name}</span>
                {'tagline' in plan && plan.tagline ? (
                  <span className="busca-plans-modal__plan-tagline">{plan.tagline}</span>
                ) : null}
              </div>
              <div className="busca-plans-modal__price">
                <span className="busca-plans-modal__price-currency">R$</span>
                <span className="busca-plans-modal__price-value">{plan.priceBrl}</span>
                <span className="busca-plans-modal__price-period">/mês</span>
              </div>
            </div>
            <p className="busca-plans-modal__card-desc">{plan.description}</p>
            <ul className="busca-plans-modal__features">
              {plan.features.map((feature, index) => (
                <li
                  key={feature}
                  className={index < 2 ? 'busca-plans-modal__feature--highlight' : undefined}
                >
                  <CheckOutlined aria-hidden />
                  {feature}
                </li>
              ))}
            </ul>
            <Button
              type={plan.featured ? 'primary' : 'default'}
              block
              className={
                plan.featured
                  ? 'busca-plans-modal__card-cta busca-plans-modal__card-cta--primary'
                  : 'busca-plans-modal__card-cta busca-plans-modal__card-cta--basic'
              }
              onClick={() => openPlanCheckout(plan.id)}
            >
              {plan.featured ? 'Contratar com nossa equipe' : 'Começar agora'}
            </Button>
          </article>
        ))}

        {AGENCY_WHATSAPP_DIGITS ? (
          <Button
            type="default"
            size="large"
            block
            className="busca-plans-modal__cta-secondary busca-plans-modal__grid-span"
            icon={<WhatsAppOutlined />}
            onClick={onWhatsApp}
          >
            Falar com a Busca Influencer
          </Button>
        ) : null}

        <p className="busca-plans-modal__hint busca-plans-modal__grid-span">
          Cancele quando quiser. No plano avançado, qualificamos, negociamos e buscamos descontos exclusivos para sua campanha.
        </p>
      </div>
    </div>
  )
}



