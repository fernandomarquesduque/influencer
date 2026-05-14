import { useState } from 'react'
import { Button, Typography, Alert, Space, Input, message } from 'antd'
import {
  DollarOutlined,
  IdcardOutlined,
  UserOutlined,
  CheckOutlined,
  CrownOutlined,
} from '@ant-design/icons'
import { useAuth } from '../../contexts/AuthContext'
import { useCredits } from '../../contexts/CreditsContext'
import { subscribeToPlan, PendingPaymentExistsError } from '../../api'
import '../BuyCreditsModal/BuyCreditsModal.css'

const { Text } = Typography

export type PlanCheckoutSummary = {
  id: string
  name: string
  priceBrl: number
  description: string
  features: string[]
  featured?: boolean
  credits: number
}

export type PlanCheckoutFormProps = {
  plan: PlanCheckoutSummary
  onSuccess: () => void | Promise<void>
  onCancel: () => void
}

export default function PlanCheckoutForm({ plan, onSuccess, onCancel }: PlanCheckoutFormProps) {
  const { user, login, loginWithToken, refreshUser } = useAuth()
  const { refreshCredits } = useCredits()
  const isGuest = !user

  const savedCpf = (user?.billingCpfCnpj ?? '').replace(/\D/g, '').slice(0, 14)
  const [guestAuthMode, setGuestAuthMode] = useState<'register' | 'login'>('register')
  const [guestEmail, setGuestEmail] = useState('')
  const [guestPassword, setGuestPassword] = useState('')
  const [guestName, setGuestName] = useState('')
  const [guestCpfCnpj, setGuestCpfCnpj] = useState('')
  const [loggedInCpfCnpj, setLoggedInCpfCnpj] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [loggingIn, setLoggingIn] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const resolveCpf = () => {
    if (isGuest) return guestCpfCnpj.replace(/\D/g, '')
    const typed = loggedInCpfCnpj.replace(/\D/g, '')
    if (typed.length === 11 || typed.length === 14) return typed
    return savedCpf
  }

  const handleLogin = async () => {
    const emailTrim = guestEmail.trim().toLowerCase()
    if (!emailTrim || !emailTrim.includes('@')) {
      setError('Informe um e-mail válido.')
      return
    }
    if (!guestPassword) {
      setError('Informe sua senha.')
      return
    }
    setLoggingIn(true)
    setError(null)
    try {
      await login(emailTrim, guestPassword)
      message.success('Login realizado')
      await refreshUser()
    } catch (e) {
      setError((e as Error).message || 'E-mail ou senha incorretos.')
    } finally {
      setLoggingIn(false)
    }
  }

  const handleSubscribe = async () => {
    if (isGuest && guestAuthMode === 'login') {
      await handleLogin()
      return
    }

    const cpfDigits = resolveCpf()
    if (cpfDigits.length !== 11 && cpfDigits.length !== 14) {
      setError('Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      if (isGuest) {
        const emailTrim = guestEmail.trim().toLowerCase()
        if (!emailTrim || !emailTrim.includes('@')) {
          setError('Informe um e-mail válido.')
          return
        }
        if (!guestPassword || guestPassword.length < 6) {
          setError('A senha deve ter no mínimo 6 caracteres.')
          return
        }
        const res = await subscribeToPlan({
          planId: plan.id,
          cpfCnpj: cpfDigits,
          email: emailTrim,
          password: guestPassword,
          name: guestName.trim() || undefined,
        })
        if (res.token && res.user) {
          loginWithToken(res.token, {
            id: res.user.id,
            username: res.user.username,
            scope: res.user.scope as 'adm' | 'assinante' | 'influencer' | 'public',
            profile_handle: res.user.profile_handle,
          })
        }
      } else {
        await subscribeToPlan({ planId: plan.id, cpfCnpj: cpfDigits })
      }
      await refreshCredits()
      await refreshUser()
      message.success('Assinatura criada! Conclua o cartão em Meus pagamentos.')
      await Promise.resolve(onSuccess())
    } catch (e) {
      if (e instanceof PendingPaymentExistsError) {
        message.info('Você já possui uma cobrança pendente.')
        await Promise.resolve(onSuccess())
        return
      }
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const guestToggle = (
    <div className="buy-credits-guest-auth-toggle">
      {guestAuthMode === 'register' ? (
        <Text type="secondary">
          Já tem conta?{' '}
          <button
            type="button"
            className="buy-credits-guest-auth-toggle__link"
            onClick={() => {
              setGuestAuthMode('login')
              setError(null)
            }}
          >
            Já tenho cadastro
          </button>
        </Text>
      ) : (
        <Text type="secondary">
          Primeira compra?{' '}
          <button
            type="button"
            className="buy-credits-guest-auth-toggle__link"
            onClick={() => {
              setGuestAuthMode('register')
              setError(null)
            }}
          >
            Criar conta nova
          </button>
        </Text>
      )}
    </div>
  )

  return (
    <section className="buy-credits-page-card buy-credits-modal--plan-checkout">
      {error ? (
        <Alert type="error" message={error} showIcon style={{ margin: '16px 16px 0' }} onClose={() => setError(null)} closable />
      ) : null}
      <div className="buy-credits-plan-layout">
        <aside className="buy-credits-plan-info">
          <div className="buy-credits-plan-info__eyebrow">Contratar plano</div>
          {plan.featured ? (
            <div className="buy-credits-plan-info__badge">
              <CrownOutlined aria-hidden />
              Recomendado
            </div>
          ) : null}
          <h2 className="buy-credits-plan-info__name">{plan.name}</h2>
          <div className="buy-credits-plan-info__price">
            <span className="buy-credits-plan-info__price-currency">R$</span>
            <span className="buy-credits-plan-info__price-value">{plan.priceBrl}</span>
            <span className="buy-credits-plan-info__price-period">/mês</span>
          </div>
          <p className="buy-credits-plan-info__desc">{plan.description}</p>
          <ul className="buy-credits-plan-info__features">
            {plan.features.map((feature) => (
              <li key={feature}>
                <CheckOutlined aria-hidden />
                {feature}
              </li>
            ))}
          </ul>
          <p className="buy-credits-plan-info__hint">
            A Busca Influencer cuida de todo o processo — da pré-seleção ao pagamento. Você descreve o job e nós fazemos o resto.
          </p>
          <p className="buy-credits-plan-info__hint buy-credits-plan-info__billing-note">
            Assinatura mensal no cartão (Asaas). Após assinar, cadastre o cartão na fatura em Meus pagamentos.
          </p>
        </aside>

        <div className="buy-credits-plan-layout__form">
          {isGuest ? (
            <>
              <Text type="secondary" className="buy-credits-form-block__intro">
                {guestAuthMode === 'login'
                  ? 'Faça login com seu e-mail e senha para continuar.'
                  : 'Informe seus dados para criar a assinatura. O cartão é cadastrado na página segura do Asaas.'}
              </Text>
              {guestToggle}
              <div className="buy-credits-field">
                <Text strong className="buy-credits-field__label">E-mail</Text>
                <Input
                  type="email"
                  placeholder="seu@email.com"
                  value={guestEmail}
                  onChange={(e) => setGuestEmail(e.target.value)}
                  size="large"
                  autoComplete="email"
                />
              </div>
              <div className="buy-credits-field">
                <Text strong className="buy-credits-field__label">
                  {guestAuthMode === 'login' ? 'Senha' : 'Senha (mín. 6 caracteres)'}
                </Text>
                <Input.Password
                  placeholder="••••••••"
                  value={guestPassword}
                  onChange={(e) => setGuestPassword(e.target.value)}
                  size="large"
                  autoComplete={guestAuthMode === 'login' ? 'current-password' : 'new-password'}
                />
              </div>
              {guestAuthMode === 'register' ? (
                <>
                  <div className="buy-credits-field">
                    <Text strong className="buy-credits-field__label">Nome (opcional)</Text>
                    <Input
                      placeholder="Seu nome ou marca"
                      value={guestName}
                      onChange={(e) => setGuestName(e.target.value)}
                      size="large"
                      autoComplete="name"
                    />
                  </div>
                  <div className="buy-credits-field buy-credits-field--last">
                    <Text strong className="buy-credits-field__label">CPF ou CNPJ</Text>
                    <Input
                      placeholder="Apenas números (11 ou 14 dígitos)"
                      value={guestCpfCnpj}
                      onChange={(e) => setGuestCpfCnpj(e.target.value.replace(/\D/g, '').slice(0, 14))}
                      size="large"
                      inputMode="numeric"
                      prefix={<IdcardOutlined style={{ color: 'var(--app-text-tertiary)' }} />}
                    />
                  </div>
                </>
              ) : null}
            </>
          ) : (
            <>
              <Text type="secondary" className="buy-credits-form-block__intro">
                Confirme seus dados para assinar. Em seguida, cadastre o cartão na fatura do Asaas.
              </Text>
              {savedCpf.length !== 11 && savedCpf.length !== 14 ? (
                <div className="buy-credits-field buy-credits-field--last">
                  <Text strong className="buy-credits-field__label">CPF ou CNPJ</Text>
                  <Input
                    placeholder="Apenas números (11 ou 14 dígitos)"
                    value={loggedInCpfCnpj}
                    onChange={(e) => setLoggedInCpfCnpj(e.target.value.replace(/\D/g, '').slice(0, 14))}
                    size="large"
                    inputMode="numeric"
                    prefix={<IdcardOutlined style={{ color: 'var(--app-text-tertiary)' }} />}
                  />
                </div>
              ) : null}
            </>
          )}

          <div className="buy-credits-form-actions buy-credits-form-actions--plan">
            <div />
            <Space wrap>
              <Button onClick={onCancel} size="large">
                Cancelar
              </Button>
              <Button
                type="primary"
                size="large"
                loading={isGuest && guestAuthMode === 'login' ? loggingIn : submitting}
                onClick={() => void handleSubscribe()}
                icon={isGuest && guestAuthMode === 'login' ? <UserOutlined /> : <DollarOutlined />}
                className="buy-credits-submit-btn"
              >
                {isGuest && guestAuthMode === 'login' ? 'Entrar' : 'Assinar plano'}
              </Button>
            </Space>
          </div>
        </div>
      </div>
    </section>
  )
}
