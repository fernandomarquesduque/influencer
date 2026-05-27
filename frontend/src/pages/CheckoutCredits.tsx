/**
 * Checkout público: compra de créditos sem estar logado.
 * Cadastra o usuário como Assinante e gera o pagamento (PIX/Boleto); em sucesso faz login e exibe o PIX/boleto.
 */
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Typography, Button, Spin, Alert, Input, Radio, message } from 'antd'
import { DollarOutlined, CopyOutlined, BankOutlined } from '@ant-design/icons'
import { useAuth } from '../contexts/AuthContext'
import { useCredits } from '../contexts/CreditsContext'
import { useRegisterPendingPaymentWatch } from '../contexts/PendingPaymentCelebrationContext'
import { registerAndCreatePayment, type RegisterAndCreatePaymentResponse } from '../api'
import { trackAgencyRegistration, trackCreditsCheckoutInitiated } from '../utils/metaPixelFunnel'

const { Title, Text } = Typography

const CREDIT_PACKS = [
  { credits: 10, label: '10 créditos' },
  { credits: 50, label: '50 créditos' },
  { credits: 100, label: '100 créditos' },
  { credits: 200, label: '200 créditos' },
]

function formatBrl(cents: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100)
}

export default function CheckoutCredits() {
  const navigate = useNavigate()
  const { user, loading: authLoading, loginWithToken } = useAuth()
  const { refreshCredits } = useCredits()
  const registerPendingPaymentWatch = useRegisterPendingPaymentWatch()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [cpfCnpj, setCpfCnpj] = useState('')
  const [credits, setCredits] = useState(50)
  const [billingType, setBillingType] = useState<'PIX' | 'BOLETO'>('PIX')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<RegisterAndCreatePaymentResponse | null>(null)

  useEffect(() => {
    const id = created?.paymentId
    if (id) registerPendingPaymentWatch(id)
  }, [created?.paymentId, registerPendingPaymentWatch])

  useEffect(() => {
    if (authLoading) return
    if (user) {
      navigate('/app/payments', { replace: true })
    }
  }, [authLoading, user, navigate])

  const handleSubmit = async () => {
    const emailTrim = email.trim().toLowerCase()
    if (!emailTrim || !emailTrim.includes('@')) {
      setError('Informe um e-mail válido.')
      return
    }
    if (!password || password.length < 6) {
      setError('A senha deve ter no mínimo 6 caracteres.')
      return
    }
    const cpfDigits = cpfCnpj.replace(/\D/g, '')
    if (cpfDigits.length !== 11 && cpfDigits.length !== 14) {
      setError('Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const res = await registerAndCreatePayment({
        email: emailTrim,
        password,
        name: name.trim() || undefined,
        cpfCnpj: cpfDigits,
        credits,
        billingType,
      })
      loginWithToken(res.token, {
        id: res.user.id,
        username: res.user.username,
        scope: res.user.scope as 'adm' | 'assinante' | 'influencer' | 'public',
        profile_handle: res.user.profile_handle,
      })
      await refreshCredits()
      trackAgencyRegistration({ source: 'checkout_credits' })
      trackCreditsCheckoutInitiated(credits, credits, { billing_type: billingType })
      setCreated(res)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const copyPix = () => {
    if (!created?.pixCopyPaste) return
    void navigator.clipboard.writeText(created.pixCopyPaste).then(() => {
      message.success('Código PIX copiado!')
    })
  }

  if (authLoading || user) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    )
  }

  if (created) {
    return (
      <div style={{ maxWidth: 520, margin: '0 auto', padding: 24 }}>
        <Card>
          <Alert
            type="success"
            message="Conta criada e pagamento gerado"
            description={
              billingType === 'PIX'
                ? 'Copie o código PIX abaixo e pague no app do seu banco. Os créditos serão creditados em instantes.'
                : 'Pague o boleto pelo link abaixo. Os créditos serão creditados após a confirmação do pagamento.'
            }
            showIcon
            style={{ marginBottom: 20 }}
          />
          {billingType === 'PIX' && created.pixCopyPaste && (
            <Card size="small" style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <Text type="secondary" style={{ flex: 1, minWidth: 0, wordBreak: 'break-all' }}>
                  {created.pixCopyPaste}
                </Text>
                <Button type="primary" icon={<CopyOutlined />} onClick={copyPix}>
                  Copiar PIX
                </Button>
              </div>
            </Card>
          )}
          {billingType === 'BOLETO' && created.bankSlipUrl && (
            <Button type="primary" href={created.bankSlipUrl} target="_blank" rel="noopener noreferrer" block icon={<BankOutlined />} style={{ marginBottom: 16 }}>
              Abrir boleto
            </Button>
          )}
          {created.invoiceUrl && (
            <Button href={created.invoiceUrl} target="_blank" rel="noopener noreferrer" block style={{ marginBottom: 16 }}>
              Ver fatura
            </Button>
          )}
          <div style={{ marginTop: 24, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Button type="primary" onClick={() => navigate('/app')}>
              Ir para o app
            </Button>
            <Button onClick={() => navigate('/app/payments')}>
              Meus pagamentos
            </Button>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: 24 }}>
      <Title level={3} style={{ textAlign: 'center', marginBottom: 8 }}>
        Comprar créditos
      </Title>
      <Text type="secondary" style={{ display: 'block', textAlign: 'center', marginBottom: 24 }}>
        Crie sua conta como assinante e pague com PIX ou Boleto. Você já será logado após o cadastro.
      </Text>

      <Card>
        {error && (
          <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} onClose={() => setError(null)} closable />
        )}

        <div style={{ marginBottom: 16 }}>
          <Text strong>E-mail</Text>
          <Input
            type="email"
            placeholder="seu@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ marginTop: 6 }}
            size="large"
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <Text strong>Senha (mín. 6 caracteres)</Text>
          <Input.Password
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ marginTop: 6 }}
            size="large"
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <Text strong>Nome (opcional)</Text>
          <Input
            placeholder="Seu nome"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ marginTop: 6 }}
            size="large"
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <Text strong>CPF ou CNPJ</Text>
          <Input
            placeholder="Apenas números (11 ou 14 dígitos)"
            value={cpfCnpj}
            onChange={(e) => setCpfCnpj(e.target.value.replace(/\D/g, '').slice(0, 14))}
            style={{ marginTop: 6 }}
            size="large"
            inputMode="numeric"
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <Text strong>Quantidade de créditos</Text>
          <div style={{ marginTop: 8 }}>
            <Radio.Group
              optionType="button"
              value={credits}
              onChange={(e) => setCredits(e.target.value)}
              options={CREDIT_PACKS.map((p) => ({ label: p.label, value: p.credits }))}
            />
          </div>
        </div>
        <div style={{ marginBottom: 20 }}>
          <Text strong>Forma de pagamento</Text>
          <div style={{ marginTop: 8 }}>
            <Radio.Group
              value={billingType}
              onChange={(e) => setBillingType(e.target.value)}
              options={[
                { label: 'PIX (instantâneo)', value: 'PIX' },
                { label: 'Boleto', value: 'BOLETO' },
              ]}
            />
          </div>
        </div>

        <div style={{ marginBottom: 8 }}>
          <Text type="secondary">
            Total: {formatBrl(credits * (100))} (R$ 1,00 por crédito)
          </Text>
        </div>

        <Button
          type="primary"
          size="large"
          block
          icon={<DollarOutlined />}
          loading={submitting}
          onClick={handleSubmit}
        >
          Criar conta e gerar pagamento
        </Button>

        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <Text type="secondary">
            Já tem conta? <Button type="link" style={{ padding: 0 }} onClick={() => navigate('/login')}>Entrar</Button>
          </Text>
        </div>
      </Card>
    </div>
  )
}
