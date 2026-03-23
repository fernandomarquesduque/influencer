/**
 * Checkout: liberação do relatório apenas com créditos.
 * Compra de créditos (PIX/Boleto) fica centralizada em BuyCreditsModal.
 * Fluxo de onboarding por e-mail: quantidade → cadastro leve → verificar e-mail → pagamento com créditos.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { Card, Typography, Button, Spin, Alert, Slider, InputNumber, Space, Input } from 'antd'
import { WalletOutlined, MailOutlined, DollarOutlined } from '@ant-design/icons'
import { useAuth } from '../../contexts/AuthContext'
import { useCredits } from '../../contexts/CreditsContext'
import {
  reportPricePreview,
  createCampaign,
  registerCheckoutUser,
  resendVerificationEmail,
  fetchMyPendingPayment,
  type ProfilesSearchQuery,
  type AuthScope,
  type CreatePaymentForCreditsResponse,
} from '../../api'
import BuyCreditsModal from '../BuyCreditsModal/BuyCreditsModal'

const { Text, Title } = Typography

const MIN_PROFILES = 1

export type GuestStep = 'quantity' | 'signup' | 'verify-email' | 'payment'

function formatBrl(cents: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100)
}

export interface CheckoutContentProps {
  query: ProfilesSearchQuery
  total: number
  onSuccess: (campaignId: string) => void
  onCancel: () => void
  onPaymentCreated?: () => void
  embed?: boolean
}

export default function CheckoutContent({
  query,
  total,
  onSuccess,
  onCancel,
  onPaymentCreated,
  embed = false,
}: CheckoutContentProps) {
  const { user, loading: authLoading, loginWithToken, refreshUser, logout } = useAuth()
  const { balance: creditsBalance, refreshCredits } = useCredits()

  const [guestStep, setGuestStep] = useState<GuestStep>('quantity')
  const [guestName, setGuestName] = useState('')
  const [guestEmail, setGuestEmail] = useState('')
  const [guestPassword, setGuestPassword] = useState('')
  const [guestPasswordConfirm, setGuestPasswordConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resendSuccess, setResendSuccess] = useState(false)
  const [buyCreditsOpen, setBuyCreditsOpen] = useState(false)
  const [buyCreditsResume, setBuyCreditsResume] = useState<CreatePaymentForCreditsResponse | null>(null)

  const openBuyCreditsModal = useCallback(async () => {
    try {
      const p = await fetchMyPendingPayment()
      setBuyCreditsResume(p)
    } catch {
      setBuyCreditsResume(null)
    }
    setBuyCreditsOpen(true)
  }, [])

  const minProfiles = Math.min(MIN_PROFILES, total)
  const [desiredCount, setDesiredCount] = useState(() => Math.max(minProfiles, total))
  const defaultExpires = () => {
    const d = new Date()
    d.setFullYear(d.getFullYear() + 1)
    return d.toISOString().slice(0, 10)
  }
  const expiresAt = useMemo(() => defaultExpires(), [])
  useEffect(() => {
    setDesiredCount(Math.max(minProfiles, total))
  }, [total, minProfiles])

  const [pricePreview, setPricePreview] = useState<{ amountCents: number; activatedCount: number; notActivatedCount: number } | null>(null)
  useEffect(() => {
    if (!query || total <= 0 || desiredCount < 1) {
      setPricePreview(null)
      return
    }
    let cancelled = false
    const t = setTimeout(() => {
      reportPricePreview({ query, desiredCount })
        .then((r) => { if (!cancelled) setPricePreview({ amountCents: r.amountCents, activatedCount: r.activatedCount, notActivatedCount: r.notActivatedCount }) })
        .catch(() => { if (!cancelled) setPricePreview({ amountCents: desiredCount * 100, activatedCount: 0, notActivatedCount: desiredCount }) })
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query, desiredCount, total])

  const creditsNeeded = desiredCount
  const canUseCredits = creditsBalance >= creditsNeeded
  const creditsShortfall = Math.max(0, creditsNeeded - creditsBalance)

  const totalCents = pricePreview?.amountCents ?? 0
  const priceReady = pricePreview != null

  const handleSignup = async () => {
    setError(null)
    if (!guestEmail.trim() || !guestEmail.includes('@')) {
      setError('Informe um e-mail válido.')
      return
    }
    if (guestPassword.length < 6) {
      setError('A senha deve ter no mínimo 6 caracteres.')
      return
    }
    if (guestPassword !== guestPasswordConfirm) {
      setError('Senha e confirmar senha não conferem.')
      return
    }
    setLoading(true)
    try {
      const res = await registerCheckoutUser({
        email: guestEmail.trim().toLowerCase(),
        name: guestName.trim() || undefined,
        password: guestPassword,
      })
      loginWithToken(res.token, {
        id: res.user.id,
        username: res.user.username,
        scope: res.user.scope as AuthScope,
        profile_handle: res.user.profile_handle,
        displayName: res.user.display_name ?? null,
        emailVerified: res.user.email_verified,
      })
      setGuestStep('payment')
      void refreshCredits()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const handleResendVerification = async () => {
    setError(null)
    setResendSuccess(false)
    setLoading(true)
    try {
      await resendVerificationEmail()
      setResendSuccess(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const handleAlreadyVerified = async () => {
    setError(null)
    setLoading(true)
    try {
      await refreshUser()
      setGuestStep('payment')
    } catch {
      setError('Não foi possível atualizar. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  const handleTrocarEmail = () => {
    logout()
    setGuestStep('signup')
    setGuestEmail('')
    setError(null)
  }

  const handlePayWithCredits = async () => {
    if (!query || total <= 0) return
    setError(null)
    setLoading(true)
    try {
      const res = await createCampaign(query, { maxHandles: desiredCount, expiresAt, name: query.q?.trim() || undefined })
      if (res.campaignId && onSuccess) {
        void refreshCredits()
        onSuccess(res.campaignId)
      }
    } catch (e) {
      const err = e as Error & { code?: string; required?: number; balance?: number }
      if ((err.code === 'INSUFFICIENT_CREDITS' || err.code === 'CREDITS_INSUFFICIENT') && err.required != null) {
        setError(`Saldo insuficiente. Necessário: ${err.required} créditos. Seu saldo: ${err.balance ?? 0}. Compre créditos para continuar.`)
      } else {
        setError((e as Error).message)
      }
    } finally {
      setLoading(false)
    }
  }

  if (authLoading) {
    return (
      <div style={{ maxWidth: 560, margin: '24px auto', padding: 24, textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    )
  }

  // ——— ETAPA 1: Escolha da quantidade (guest)
  if (!user && guestStep === 'quantity') {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto', padding: 24 }}>
        <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
          Escolha a quantidade de influenciadores para o relatório.
        </Text>
        <Card style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <Text strong>Quantidade de influenciadores</Text>
            <Text strong>{total.toLocaleString('pt-BR')}</Text>
          </div>
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 8 }}>
              <Slider
                min={minProfiles}
                max={total}
                value={desiredCount}
                onChange={(v) => setDesiredCount(typeof v === 'number' ? v : v[0] ?? total)}
                style={{ flex: 1 }}
              />
              <InputNumber
                min={minProfiles}
                max={total}
                value={desiredCount}
                onChange={(v) => setDesiredCount(v != null && Number.isFinite(v) ? Math.min(total, Math.max(minProfiles, Math.floor(v))) : desiredCount)}
                style={{ width: 90 }}
              />
            </div>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
              Reduza a quantidade para pagar menos.
            </Text>
          </div>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: priceReady && pricePreview && (pricePreview.activatedCount > 0 || pricePreview.notActivatedCount > 0) ? 4 : 0 }}>
              <Text strong>Total</Text>
              <Text strong style={{ color: 'var(--app-primary)' }}>
                {priceReady ? formatBrl(totalCents) : <Spin size="small" />}
              </Text>
            </div>
            {priceReady && pricePreview && (pricePreview.activatedCount > 0 || pricePreview.notActivatedCount > 0) && (
              <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                {pricePreview.activatedCount > 0 && `${pricePreview.activatedCount} ativados (R$ 2) `}
                {pricePreview.activatedCount > 0 && pricePreview.notActivatedCount > 0 && '+ '}
                {pricePreview.notActivatedCount > 0 && `${pricePreview.notActivatedCount} normais (R$ 1)`}
              </Text>
            )}
          </div>
        </Card>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Button type="primary" size="large" onClick={() => setGuestStep('signup')} disabled={total <= 0 || !priceReady}>
            Continuar
          </Button>
          {!embed && <Button size="large" onClick={onCancel}>Cancelar</Button>}
        </div>
      </div>
    )
  }

  // ——— ETAPA 2: Cadastro leve (nome, e-mail, senha) — sem CPF/CNPJ
  if (!user && guestStep === 'signup') {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '12px 20px 16px' }}>
        <Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>Etapa 2 de 4</Text>
        <Card size="small" style={{ marginBottom: 10, padding: '8px 12px' }} bodyStyle={{ padding: '8px 12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 13 }}>{desiredCount.toLocaleString('pt-BR')} influenciadores</Text>
            <Text strong style={{ color: 'var(--app-primary)', fontSize: 13 }}>
              {priceReady ? formatBrl(totalCents) : <Spin size="small" />}
            </Text>
          </div>
        </Card>
        <Title level={5} style={{ marginTop: 16, marginBottom: 4 }}>Crie sua conta para continuar</Title>
        <Text type="secondary" style={{ display: 'block', marginBottom: 16, fontSize: 13 }}>
          Cadastre-se para salvar sua busca, receber seus créditos de boas-vindas e liberar o relatório com créditos.
        </Text>
        <Card size="small" style={{ marginBottom: 10 }} bodyStyle={{ padding: '10px 12px' }}>
          <Space direction="vertical" style={{ width: '100%' }} size="small">
            <div>
              <Text strong style={{ fontSize: 12 }}>Nome</Text>
              <Input size="small" placeholder="Seu nome" value={guestName} onChange={(e) => setGuestName(e.target.value)} style={{ marginTop: 2 }} />
            </div>
            <div>
              <Text strong style={{ fontSize: 12 }}>E-mail</Text>
              <Input size="small" type="email" placeholder="seu@email.com" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} style={{ marginTop: 2 }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <Text strong style={{ fontSize: 12 }}>Senha (mín. 6)</Text>
                <Input.Password size="small" placeholder="••••••••" value={guestPassword} onChange={(e) => setGuestPassword(e.target.value)} style={{ marginTop: 2 }} />
              </div>
              <div>
                <Text strong style={{ fontSize: 12 }}>Confirmar senha</Text>
                <Input.Password size="small" placeholder="••••••••" value={guestPasswordConfirm} onChange={(e) => setGuestPasswordConfirm(e.target.value)} style={{ marginTop: 2 }} />
              </div>
            </div>
          </Space>
        </Card>
        {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 10 }} onClose={() => setError(null)} closable />}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button type="primary" size="middle" loading={loading} disabled={loading} onClick={handleSignup}>
            Continuar
          </Button>
          <Button size="middle" onClick={() => { setGuestStep('quantity'); setError(null) }} disabled={loading}>Voltar</Button>
          {!embed && <Button size="middle" onClick={onCancel} disabled={loading}>Cancelar</Button>}
        </div>
      </div>
    )
  }

  // ——— ETAPA 3: Verificar e-mail (usuário já logado após cadastro)
  if (user && guestStep === 'verify-email') {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto', padding: 24 }}>
        <Title level={5} style={{ marginBottom: 4 }}>Confirme seu e-mail</Title>
        <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
          Enviamos um link de confirmação para o seu e-mail. Após validar, você poderá continuar com a liberação do relatório.
        </Text>
        <Alert
          type="info"
          message="Valide sua conta para liberar seus créditos e continuar."
          description="Enviamos um link de confirmação para o seu e-mail. Valide sua conta para liberar seus créditos e continuar."
          showIcon
          icon={<MailOutlined />}
          style={{ marginBottom: 20 }}
        />
        {resendSuccess && <Alert type="success" message="E-mail reenviado." showIcon style={{ marginBottom: 16 }} />}
        {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} onClose={() => setError(null)} closable />}
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Button type="primary" block size="large" loading={loading} onClick={handleAlreadyVerified}>
            Já validei meu e-mail
          </Button>
          <Button block loading={loading} onClick={handleResendVerification}>
            Reenviar e-mail
          </Button>
          <Button block type="link" size="small" onClick={handleTrocarEmail}>
            Trocar e-mail
          </Button>
          {!embed && <Button block onClick={onCancel}>Fechar</Button>}
        </Space>
      </div>
    )
  }

  // ——— ETAPA 4 (e usuário logado): somente créditos + modal de compra
  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: 24 }}>
      <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
        Escolha quantos influenciadores deseja no relatório. A liberação é feita com créditos da sua conta.
      </Text>

      <Card style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <Text strong>Quantidade de influenciadores</Text>
          <Text strong>{total.toLocaleString('pt-BR')}</Text>
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 8 }}>
            <Slider
              min={minProfiles}
              max={total}
              value={desiredCount}
              onChange={(v) => setDesiredCount(typeof v === 'number' ? v : v[0] ?? total)}
              style={{ flex: 1 }}
            />
            <InputNumber
              min={minProfiles}
              max={total}
              value={desiredCount}
              onChange={(v) => setDesiredCount(v != null && Number.isFinite(v) ? Math.min(total, Math.max(minProfiles, Math.floor(v))) : desiredCount)}
              style={{ width: 90 }}
            />
          </div>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
            Reduza a quantidade para gastar menos créditos.
          </Text>
        </div>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: priceReady && pricePreview && (pricePreview.activatedCount > 0 || pricePreview.notActivatedCount > 0) ? 4 : 0 }}>
            <Text strong>Total (referência em R$)</Text>
            <Text strong style={{ color: 'var(--app-primary)' }}>
              {priceReady ? formatBrl(totalCents) : <Spin size="small" />}
            </Text>
          </div>
          {priceReady && pricePreview && (pricePreview.activatedCount > 0 || pricePreview.notActivatedCount > 0) && (
            <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
              {pricePreview.activatedCount > 0 && `${pricePreview.activatedCount} ativados (R$ 2) `}
              {pricePreview.activatedCount > 0 && pricePreview.notActivatedCount > 0 && '+ '}
              {pricePreview.notActivatedCount > 0 && `${pricePreview.notActivatedCount} normais (R$ 1)`}
            </Text>
          )}
        </div>
      </Card>

      <Card size="small" style={{ marginBottom: 24 }} bodyStyle={{ padding: 12 }}>
        <Text strong style={{ display: 'block', marginBottom: 8 }}>Créditos</Text>
        <Space direction="vertical" style={{ width: '100%' }} size="small">
          <Space wrap>
            <WalletOutlined />
            <span>Para este relatório: <Text strong>{creditsNeeded}</Text> crédito{creditsNeeded !== 1 ? 's' : ''}</span>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Seu saldo: {creditsBalance}
            </Text>
            {canUseCredits ? (
              <Text type="success" style={{ fontSize: 12 }}>Saldo suficiente</Text>
            ) : (
              <Text type="warning" style={{ fontSize: 12 }}>Faltam {creditsShortfall} crédito{creditsShortfall !== 1 ? 's' : ''}</Text>
            )}
          </Space>
          {!canUseCredits && (
            <Alert
              type="info"
              showIcon
              message="Compre créditos com PIX ou boleto"
              description="O pagamento do relatório não usa PIX/boleto direto: você adiciona créditos e libera com um clique."
              style={{ marginTop: 4 }}
            />
          )}
        </Space>
      </Card>

      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 24 }} onClose={() => setError(null)} closable />}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button
          type="primary"
          size="large"
          icon={<WalletOutlined />}
          onClick={handlePayWithCredits}
          disabled={loading || total <= 0 || !priceReady || !canUseCredits}
          loading={loading}
        >
          Usar créditos e gerar relatório
        </Button>
        {!canUseCredits && (
          <Button
            type="default"
            size="large"
            icon={<DollarOutlined />}
            onClick={() => void openBuyCreditsModal()}
          >
            Comprar créditos
          </Button>
        )}
        {!embed && (
          <Button size="large" onClick={onCancel} disabled={loading}>Cancelar</Button>
        )}
      </div>

      <BuyCreditsModal
        open={buyCreditsOpen}
        onClose={() => {
          setBuyCreditsOpen(false)
          setBuyCreditsResume(null)
        }}
        suggestedCredits={creditsNeeded}
        resumePayment={buyCreditsResume}
        onAfterPaymentCreated={() => {
          void refreshCredits()
          onPaymentCreated?.()
        }}
      />
    </div>
  )
}
