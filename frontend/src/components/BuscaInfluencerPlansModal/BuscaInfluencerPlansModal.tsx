import { useEffect, useState } from 'react'
import { Modal, Button, Spin } from 'antd'
import { useNavigate } from 'react-router-dom'
import { CheckOutlined, CrownOutlined, WhatsAppOutlined, CreditCardOutlined } from '@ant-design/icons'
import { AGENCY_WHATSAPP_DIGITS } from '../../constants/agencyContact'
import { BUSCA_PLANS } from '../../constants/buscaPlans'
import { fetchMyPendingPayment, fetchMySubscription } from '../../api'
import { useAuth } from '../../contexts/AuthContext'
import { useLockPageScroll } from '../../utils/useLockPageScroll'
import './BuscaInfluencerPlansModal.css'

function buildPlansWhatsAppUrl(): string {
  const text = [
    'Olá! Quero saber mais sobre os planos da Busca Influencer.',
    '',
    'Tenho interesse em contratar criadores com apoio completo da agência.',
  ].join('\n')
  return `https://wa.me/${AGENCY_WHATSAPP_DIGITS}?text=${encodeURIComponent(text)}`
}

export type BuscaInfluencerPlansModalProps = {
  open: boolean
  onClose: () => void
}

export default function BuscaInfluencerPlansModal({ open, onClose }: BuscaInfluencerPlansModalProps) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [hasPendingSubscription, setHasPendingSubscription] = useState(false)
  useLockPageScroll(open)

  useEffect(() => {
    if (!open) {
      setHasPendingSubscription(false)
      setLoading(false)
      return
    }
    if (!user) {
      setHasPendingSubscription(false)
      setLoading(false)
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
        const pendingPlan =
          Boolean(subscription?.hasPendingPlanPayment) ||
          Boolean(pending && !subscription?.active)
        setHasPendingSubscription(pendingPlan)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, user])

  const onWhatsApp = () => {
    if (!AGENCY_WHATSAPP_DIGITS) return
    window.open(buildPlansWhatsAppUrl(), '_blank', 'noopener,noreferrer')
    onClose()
  }

  const openPlanCheckout = (planId: string) => {
    onClose()
    navigate(`/checkout/plan/${planId}`)
  }

  const goToPayments = () => {
    onClose()
    navigate('/app/payments')
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      centered
      width={Math.min(480, typeof window !== 'undefined' ? window.innerWidth - 32 : 480)}
      destroyOnHidden
      zIndex={1100}
      wrapClassName="busca-plans-modal"
      maskStyle={{ backdropFilter: 'blur(4px)' }}
    >
      <div className="busca-plans-modal__body">
        {loading ? (
          <div className="busca-plans-modal__loading">
            <Spin />
          </div>
        ) : hasPendingSubscription ? (
          <>
            <div className="busca-plans-modal__eyebrow">Assinatura pendente</div>
            <h2 className="busca-plans-modal__title">Conclua o pagamento para liberar o perfil completo</h2>
            <p className="busca-plans-modal__intro">
              Sua assinatura já foi criada, mas ainda falta finalizar o pagamento no Asaas (cartão ou fatura).
              Depois de confirmado, você acessa o perfil completo e a contratação.
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
          </>
        ) : (
          <>
            <div className="busca-plans-modal__eyebrow">Nossos planos</div>
            <h2 className="busca-plans-modal__title">Acesso completo ao perfil e contratação sem esforço</h2>
            <p className="busca-plans-modal__intro">
              A Busca Influencer cuida de todo o processo — da pré-seleção ao pagamento. Você descreve o job e nós
              fazemos o resto.
            </p>

            <div className="busca-plans-modal__grid">
              {BUSCA_PLANS.map((plan) => (
                <article
                  key={plan.id}
                  className={
                    plan.featured
                      ? 'busca-plans-modal__card busca-plans-modal__card--featured'
                      : 'busca-plans-modal__card'
                  }
                >
                  {plan.featured ? (
                    <div className="busca-plans-modal__badge">
                      <CrownOutlined aria-hidden />
                      Recomendado
                    </div>
                  ) : null}
                  <div className="busca-plans-modal__card-head">
                    <span className="busca-plans-modal__plan-name">{plan.name}</span>
                    <div className="busca-plans-modal__price">
                      <span className="busca-plans-modal__price-currency">R$</span>
                      <span className="busca-plans-modal__price-value">{plan.priceBrl}</span>
                      <span className="busca-plans-modal__price-period">/mês</span>
                    </div>
                  </div>
                  <p className="busca-plans-modal__card-desc">{plan.description}</p>
                  <ul className="busca-plans-modal__features">
                    {plan.features.map((feature) => (
                      <li key={feature}>
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
                        : 'busca-plans-modal__card-cta'
                    }
                    onClick={() => openPlanCheckout(plan.id)}
                  >
                    Contratar
                  </Button>
                </article>
              ))}
            </div>

            {AGENCY_WHATSAPP_DIGITS ? (
              <Button
                type="default"
                size="large"
                block
                className="busca-plans-modal__cta-secondary"
                icon={<WhatsAppOutlined />}
                onClick={onWhatsApp}
              >
                Falar com a Busca Influencer
              </Button>
            ) : null}

            <p className="busca-plans-modal__hint">
              Sem burocracia: você não precisa negociar, contatar ou pagar o criador diretamente.
            </p>
          </>
        )}
      </div>
    </Modal>
  )
}
