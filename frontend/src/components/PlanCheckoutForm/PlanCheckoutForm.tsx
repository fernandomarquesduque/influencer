import { useState, useEffect } from 'react'
import { Button, Typography, Alert, Space, Input, message } from 'antd'
import {
  DollarOutlined,
  IdcardOutlined,
  UserOutlined,
  CheckOutlined,
  CrownOutlined,
  ArrowRightOutlined,
  GiftOutlined,
  PhoneOutlined,
} from '@ant-design/icons'
import { useAuth } from '../../contexts/AuthContext'
import { useCredits } from '../../contexts/CreditsContext'
import { subscribeToPlan, checkEmailRegistered, PendingPaymentExistsError } from '../../api'
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
  /** Dias até a 1ª cobrança (trial); alinhar com BUSCA_PLAN_TRIAL_DAYS no backend. */
  trialDays?: number
}

export type PlanCheckoutFormProps = {
  plan: PlanCheckoutSummary
  onSuccess: () => void | Promise<void>
  onCancel: () => void
}

function luhnValid(cardDigits: string): boolean {
  let sum = 0
  let alt = false
  for (let i = cardDigits.length - 1; i >= 0; i--) {
    const ch = cardDigits.charCodeAt(i) - 48
    if (ch < 0 || ch > 9) return false
    let n = ch
    if (alt) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
    alt = !alt
  }
  return sum % 10 === 0
}

function parseCardExpiryOk(exp: string): boolean {
  const s = exp.replace(/\s/g, '')
  const m = /^(\d{2})\/(\d{2,4})$/.exec(s)
  if (!m) return false
  const monthNum = Number(m[1])
  if (monthNum < 1 || monthNum > 12) return false
  const yRaw = m[2]
  const year = yRaw.length === 2 ? `20${yRaw}` : yRaw
  if (!/^\d{4}$/.test(year)) return false
  const now = new Date()
  const curYm = now.getFullYear() * 100 + (now.getMonth() + 1)
  const expYm = Number(year) * 100 + monthNum
  return expYm >= curYm
}

function formatYmdBr(ymd: string): string {
  const parts = ymd.slice(0, 10).split('-')
  if (parts.length !== 3) return ymd
  const [y, m, d] = parts
  return `${d}/${m}/${y}`
}

export default function PlanCheckoutForm({ plan, onSuccess, onCancel }: PlanCheckoutFormProps) {
  const { user, login, loginWithToken, refreshUser } = useAuth()
  const { refreshCredits } = useCredits()
  const isGuest = !user
  const trialDays = Math.max(0, plan.trialDays ?? 7)

  const savedCpf = (user?.billingCpfCnpj ?? '').replace(/\D/g, '').slice(0, 14)
  const [guestAuthMode, setGuestAuthMode] = useState<'register' | 'login'>('register')
  /** Fluxo cadastro novo: 1 = dados da conta, 2 = CPF + cartão (conta só é criada após aprovação no pagamento). */
  const [guestRegisterStep, setGuestRegisterStep] = useState<1 | 2>(1)
  const [guestEmail, setGuestEmail] = useState('')
  const [guestPassword, setGuestPassword] = useState('')
  const [guestPasswordConfirm, setGuestPasswordConfirm] = useState('')
  const [guestName, setGuestName] = useState('')
  const [cardHolderName, setCardHolderName] = useState('')
  const [cardNumber, setCardNumber] = useState('')
  const [cardExpiry, setCardExpiry] = useState('')
  const [cardCcv, setCardCcv] = useState('')
  const [holderPhone, setHolderPhone] = useState('')
  const [billingDocCpfCnpj, setBillingDocCpfCnpj] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [loggingIn, setLoggingIn] = useState(false)
  const [checkingEmail, setCheckingEmail] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const showGuestAccountStep =
    isGuest && guestAuthMode === 'register' && guestRegisterStep === 1
  const showGuestLoginFields = isGuest && guestAuthMode === 'login'
  const showBillingFields =
    Boolean(user) || (isGuest && guestAuthMode === 'register' && guestRegisterStep === 2)

  useEffect(() => {
    if (!user) return
    if (savedCpf.length === 11 || savedCpf.length === 14) {
      setBillingDocCpfCnpj(savedCpf)
    }
  }, [user?.id, savedCpf])

  const resolveCpf = () => billingDocCpfCnpj.replace(/\D/g, '')

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
      message.success('Login realizado. Agora informe o cartão para assinar.')
      await refreshUser()
    } catch (e) {
      setError((e as Error).message || 'E-mail ou senha incorretos.')
    } finally {
      setLoggingIn(false)
    }
  }

  const handleGuestAccountContinue = async () => {
    const name = guestName.trim()
    if (!name || name.length < 2) {
      setError('Informe seu nome ou marca (mín. 2 caracteres).')
      return
    }
    const emailTrim = guestEmail.trim().toLowerCase()
    if (!emailTrim || !emailTrim.includes('@')) {
      setError('Informe um e-mail válido.')
      return
    }
    if (!guestPassword || guestPassword.length < 6) {
      setError('A senha deve ter no mínimo 6 caracteres.')
      return
    }
    if (guestPassword !== guestPasswordConfirm) {
      setError('A confirmação de senha não confere.')
      return
    }
    setCheckingEmail(true)
    setError(null)
    try {
      const { registered } = await checkEmailRegistered(emailTrim)
      if (registered) {
        setError('Já existe uma conta com este e-mail. Use a opção de login no checkout.')
        return
      }
      setGuestRegisterStep(2)
      message.info('Agora informe CPF ou CNPJ e os dados do cartão.')
    } catch (e) {
      setError((e as Error).message || 'Não foi possível verificar o e-mail. Tente de novo.')
    } finally {
      setCheckingEmail(false)
    }
  }

  const handlePrimaryAction = async () => {
    if (!user && guestAuthMode === 'login') {
      await handleLogin()
      return
    }
    if (!user && guestAuthMode === 'register' && guestRegisterStep === 1) {
      await handleGuestAccountContinue()
      return
    }
    await handleSubscribe()
  }

  const handleSubscribe = async () => {
    let emailTrim: string | undefined
    let passwordForSub: string | undefined
    let nameForPlan: string | undefined

    if (!user) {
      const name = guestName.trim()
      if (!name || name.length < 2) {
        setError('Informe seu nome ou marca (mín. 2 caracteres).')
        return
      }
      emailTrim = guestEmail.trim().toLowerCase()
      if (!emailTrim || !emailTrim.includes('@')) {
        setError('Informe um e-mail válido.')
        return
      }
      if (!guestPassword || guestPassword.length < 6) {
        setError('A senha deve ter no mínimo 6 caracteres.')
        return
      }
      if (guestPassword !== guestPasswordConfirm) {
        setError('A confirmação de senha não confere.')
        return
      }
      nameForPlan = name
      passwordForSub = guestPassword
    }

    const cpfDigits = resolveCpf()
    if (cpfDigits.length !== 11 && cpfDigits.length !== 14) {
      setError('Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.')
      return
    }

    const cardDigits = cardNumber.replace(/\D/g, '')
    const ccvDigits = cardCcv.replace(/\D/g, '')
    const holder = cardHolderName.trim()

    if (!holder || holder.length < 3) {
      setError('Informe o nome impresso no cartão.')
      return
    }
    if (cardDigits.length < 13 || cardDigits.length > 19 || !luhnValid(cardDigits)) {
      setError('Número do cartão inválido.')
      return
    }
    if (!parseCardExpiryOk(cardExpiry)) {
      setError('Validade inválida. Use MM/AA ou MM/AAAA.')
      return
    }
    if (ccvDigits.length < 3 || ccvDigits.length > 4) {
      setError('CVV inválido.')
      return
    }

    const phoneDigits = holderPhone.replace(/\D/g, '')
    if (phoneDigits.length !== 10 && phoneDigits.length !== 11) {
      setError('Informe o telefone do titular com DDD (10 ou 11 dígitos, sem o 55).')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const subscribeRes = await subscribeToPlan({
        planId: plan.id,
        cpfCnpj: cpfDigits,
        cardHolderName: holder,
        cardNumber: cardDigits,
        cardExpiry: cardExpiry.trim(),
        cardCcv: ccvDigits,
        holderPhone: phoneDigits,
        ...(emailTrim != null && passwordForSub != null && nameForPlan != null
          ? { email: emailTrim, password: passwordForSub, name: nameForPlan }
          : {}),
      })
      if (!user && subscribeRes.token && subscribeRes.user) {
        loginWithToken(subscribeRes.token, {
          id: subscribeRes.user.id,
          username: subscribeRes.user.username,
          scope: subscribeRes.user.scope as 'adm' | 'assinante' | 'influencer' | 'public',
          profile_handle: subscribeRes.user.profile_handle,
        })
      }
      await refreshCredits()
      await refreshUser()
      const due = subscribeRes?.planFirstInvoiceDue
      if (due) {
        message.success(
          `Assinatura ativa! Período grátis até a primeira cobrança em ${formatYmdBr(due)}. O cartão foi processado com segurança.`
        )
      } else {
        message.success('Assinatura criada com sucesso.')
      }
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
              setGuestRegisterStep(1)
              setError(null)
              setCheckingEmail(false)
              setGuestPasswordConfirm('')
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
              setGuestRegisterStep(1)
              setError(null)
              setCheckingEmail(false)
              setGuestPasswordConfirm('')
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
        <Alert
          type="error"
          message={error}
          showIcon
          style={{ margin: '16px 16px 16px' }}
          onClose={() => setError(null)}
          closable
        />
      ) : null}
      <div className="buy-credits-plan-layout">
        <aside className="buy-credits-plan-info">
          <div className="buy-credits-plan-info__eyebrow">Comece agora</div>
          {trialDays > 0 ? (
            <div className="buy-credits-plan-info__trial-callout buy-credits-plan-info__trial-callout--first" role="status">
              <div className="buy-credits-plan-info__trial-callout-icon" aria-hidden>
                <GiftOutlined />
              </div>
              <div className="buy-credits-plan-info__trial-callout-body">
                <div className="buy-credits-plan-info__trial-callout-title">
                  <span className="buy-credits-plan-info__trial-callout-headline">{trialDays} dias grátis</span>
                  <span className="buy-credits-plan-info__trial-callout-subline">Teste sem pagar a mensalidade</span>
                </div>
                <p className="buy-credits-plan-info__trial-callout-text">
                  Use relatórios e dados na prática. Só depois entra a cobrança recorrente — cancele antes se
                  não fizer sentido.
                </p>
              </div>
            </div>
          ) : null}
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
          <ul className="buy-credits-plan-info__features buy-credits-plan-info__features--prominent">
            {plan.features.map((feature) => (
              <li key={feature}>
                <CheckOutlined aria-hidden />
                {feature}
              </li>
            ))}
          </ul>
          {plan.description.trim() ? (
            <p className="buy-credits-plan-info__desc buy-credits-plan-info__desc--after-features">{plan.description}</p>
          ) : null}
          {isGuest ? <div className="buy-credits-plan-info__guest-toggle">{guestToggle}</div> : null}
        </aside>

        <div className="buy-credits-plan-layout__form">
          {showGuestAccountStep ? (
            <>
              <div className="buy-credits-field">
                <Text strong className="buy-credits-field__label">Nome ou marca</Text>
                <Input
                  placeholder="Seu nome ou marca"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  size="large"
                  autoComplete="name"
                />
              </div>
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
                <Text strong className="buy-credits-field__label">Senha (mín. 6 caracteres)</Text>
                <Input.Password
                  placeholder="••••••••"
                  value={guestPassword}
                  onChange={(e) => setGuestPassword(e.target.value)}
                  size="large"
                  autoComplete="new-password"
                />
              </div>
              <div className="buy-credits-field buy-credits-field--last">
                <Text strong className="buy-credits-field__label">Confirmar senha</Text>
                <Input.Password
                  placeholder="Repita a senha"
                  value={guestPasswordConfirm}
                  onChange={(e) => setGuestPasswordConfirm(e.target.value)}
                  size="large"
                  autoComplete="new-password"
                />
              </div>
            </>
          ) : null}

          {showGuestLoginFields ? (
            <>
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
              <div className="buy-credits-field buy-credits-field--last">
                <Text strong className="buy-credits-field__label">Senha</Text>
                <Input.Password
                  placeholder="••••••••"
                  value={guestPassword}
                  onChange={(e) => setGuestPassword(e.target.value)}
                  size="large"
                  autoComplete="current-password"
                />
              </div>
            </>
          ) : null}

          {showBillingFields ? (
            <>
              <div className="buy-credits-field">
                <Text strong className="buy-credits-field__label">CPF ou CNPJ</Text>
                <Input
                  placeholder="Apenas números (11 ou 14 dígitos)"
                  value={billingDocCpfCnpj}
                  onChange={(e) => setBillingDocCpfCnpj(e.target.value.replace(/\D/g, '').slice(0, 14))}
                  size="large"
                  inputMode="numeric"
                  prefix={<IdcardOutlined style={{ color: 'var(--app-text-tertiary)' }} />}
                  autoComplete="off"
                />
              </div>
              <div className="buy-credits-field">
                <Text strong className="buy-credits-field__label">Nome no cartão</Text>
                <Input
                  placeholder="Como impresso no cartão"
                  value={cardHolderName}
                  onChange={(e) => setCardHolderName(e.target.value)}
                  size="large"
                  autoComplete="cc-name"
                />
              </div>
              <div className="buy-credits-field">
                <Text strong className="buy-credits-field__label">Telefone do titular (DDD + número)</Text>
                <Input
                  placeholder="Ex.: 11987654321"
                  value={holderPhone}
                  onChange={(e) => setHolderPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
                  size="large"
                  inputMode="numeric"
                  prefix={<PhoneOutlined style={{ color: 'var(--app-text-tertiary)' }} />}
                  autoComplete="tel-national"
                />
              </div>
              <div className="buy-credits-field">
                <Text strong className="buy-credits-field__label">Número do cartão</Text>
                <Input
                  placeholder="0000 0000 0000 0000"
                  value={cardNumber}
                  onChange={(e) => setCardNumber(e.target.value.replace(/\D/g, '').slice(0, 19))}
                  size="large"
                  inputMode="numeric"
                  autoComplete="cc-number"
                />
              </div>
              <div className="buy-credits-field buy-credits-field--grid-2 buy-credits-field--last">
                <div>
                  <Text strong className="buy-credits-field__label">Validade</Text>
                  <Input
                    placeholder="MM/AA"
                    value={cardExpiry}
                    onChange={(e) => {
                      const d = e.target.value.replace(/\D/g, '').slice(0, 4)
                      const withSlash = d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d
                      setCardExpiry(withSlash)
                    }}
                    size="large"
                    inputMode="numeric"
                    autoComplete="cc-exp"
                  />
                </div>
                <div>
                  <Text strong className="buy-credits-field__label">CVV</Text>
                  <Input.Password
                    placeholder="•••"
                    value={cardCcv}
                    onChange={(e) => setCardCcv(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    size="large"
                    autoComplete="cc-csc"
                  />
                </div>
              </div>
            </>
          ) : null}

          <div className="buy-credits-form-actions buy-credits-form-actions--plan">
            <div />
            <Space wrap>
              <Button onClick={onCancel} size="large">
                Cancelar
              </Button>
              {isGuest && guestAuthMode === 'register' && guestRegisterStep === 2 ? (
                <Button
                  size="large"
                  onClick={() => {
                    setGuestRegisterStep(1)
                    setError(null)
                    setCheckingEmail(false)
                  }}
                >
                  Voltar
                </Button>
              ) : null}
              <Button
                type="primary"
                size="large"
                loading={
                  (!user && guestAuthMode === 'login' && loggingIn) ||
                  (!user && guestAuthMode === 'register' && guestRegisterStep === 1 && checkingEmail) ||
                  submitting
                }
                onClick={() => void handlePrimaryAction()}
                icon={
                  !user && guestAuthMode === 'login' ? (
                    <UserOutlined />
                  ) : !user && guestAuthMode === 'register' && guestRegisterStep === 1 ? (
                    <ArrowRightOutlined />
                  ) : (
                    <DollarOutlined />
                  )
                }
                className="buy-credits-submit-btn"
              >
                {!user && guestAuthMode === 'login'
                  ? 'Entrar'
                  : !user && guestAuthMode === 'register' && guestRegisterStep === 1
                    ? 'Continuar'
                    : 'Assinar plano'}
              </Button>
            </Space>
          </div>
        </div>
      </div>
    </section>
  )
}
