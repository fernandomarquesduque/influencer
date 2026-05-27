import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from 'antd'
import { ArrowLeftOutlined } from '@ant-design/icons'
import Logo from '../components/Logo'
import PlanCheckoutForm from '../components/PlanCheckoutForm/PlanCheckoutForm'
import { getBuscaPlanById } from '../constants/buscaPlans'
import { trackCheckoutPlanView } from '../utils/metaPixelFunnel'
import { useAuth } from '../contexts/AuthContext'
import './CheckoutPlan.css'

function checkoutDisplayTrialDays(): number {
  const raw = import.meta.env.VITE_BUSCA_PLAN_TRIAL_DAYS
  if (raw === undefined || raw === '') return 7
  const n = Number(raw)
  if (!Number.isFinite(n)) return 7
  return Math.min(120, Math.max(0, n))
}

export default function CheckoutPlan() {
  const { planId } = useParams<{ planId: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const plan = getBuscaPlanById(planId)

  useEffect(() => {
    if (!plan) {
      navigate('/', { replace: true })
    }
  }, [plan, navigate])

  useEffect(() => {
    if (plan) trackCheckoutPlanView(plan.id, plan.priceBrl)
  }, [plan])

  if (!plan) return null

  const goBack = () => {
    if (window.history.length > 1) {
      navigate(-1)
      return
    }
    navigate(user ? '/app' : '/')
  }

  return (
    <div className="checkout-plan-page">
      <header className="checkout-plan-page__header">
        <Logo size="large" height={36} variant="default" alt="Busca Influencer" />
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={goBack} className="checkout-plan-page__back">
          Voltar
        </Button>
      </header>

      <main className="checkout-plan-page__main">
        <PlanCheckoutForm
          plan={{
            id: plan.id,
            name: plan.name,
            priceBrl: plan.priceBrl,
            description: plan.description,
            features: [...plan.features],
            featured: plan.featured,
            credits: plan.credits,
            trialDays: checkoutDisplayTrialDays(),
          }}
          onCancel={goBack}
          onSuccess={() => navigate('/app/payments', { replace: true, state: { openPendingPayment: true } })}
        />
      </main>
    </div>
  )
}
