/**
 * Checkout: compra do relatório (pagamento direto com PIX ou Boleto).
 * Sem créditos: usuário escolhe a quantidade de influenciadores e paga o valor.
 */
import { useState, useEffect } from 'react'
import QRCode from 'qrcode'
import { Card, Typography, Button, Spin, Alert, Slider, InputNumber, Space, Input } from 'antd'
import { DollarOutlined, CopyOutlined, BankOutlined } from '@ant-design/icons'
import { useAuth } from '../../contexts/AuthContext'
import { useCredits } from '../../contexts/CreditsContext'
import { payForReport, type ProfilesSearchQuery, type AuthScope } from '../../api'

const { Text } = Typography

const MIN_PROFILES = 1
/** Preço por influenciador em centavos (ex.: 100 = R$ 1,00). Deve bater com o backend. */
const PRICE_CENTS_PER_INFLUENCER = 100

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
  onBuyCredits?: () => void
}

export default function CheckoutContent({
  query,
  total,
  onSuccess,
  onCancel,
  onPaymentCreated,
  embed = false,
}: CheckoutContentProps) {
  const { user, loading: authLoading, loginWithToken } = useAuth()
  const { refreshCredits } = useCredits()

  const [guestStep, setGuestStep] = useState<1 | 2>(1)
  const [guestName, setGuestName] = useState('')
  const [guestEmail, setGuestEmail] = useState('')
  const [guestCpfCnpj, setGuestCpfCnpj] = useState('')
  const [guestPassword, setGuestPassword] = useState('')
  const [guestPasswordConfirm, setGuestPasswordConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [billingType, setBillingType] = useState<'PIX' | 'BOLETO'>('PIX')
  const [paymentCreated, setPaymentCreated] = useState<{
    pixCopyPaste: string | null
    bankSlipUrl: string | null
    invoiceUrl: string | null
    billingType: string
  } | null>(null)
  const [pixQrDataUrl, setPixQrDataUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!paymentCreated?.pixCopyPaste) {
      setPixQrDataUrl(null)
      return
    }
    let cancelled = false
    QRCode.toDataURL(paymentCreated.pixCopyPaste, { width: 220, margin: 2 })
      .then((url) => {
        if (!cancelled) setPixQrDataUrl(url)
      })
      .catch(() => {
        if (!cancelled) setPixQrDataUrl(null)
      })
    return () => { cancelled = true }
  }, [paymentCreated?.pixCopyPaste])

  const minProfiles = Math.min(MIN_PROFILES, total)
  const [desiredCount, setDesiredCount] = useState(() => Math.max(minProfiles, total))
  useEffect(() => {
    setDesiredCount(Math.max(minProfiles, total))
  }, [total, minProfiles])

  const totalCents = desiredCount * PRICE_CENTS_PER_INFLUENCER

  const handlePayForReport = async () => {
    if (!query || total <= 0) return
    if (!user) {
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
    }
    setError(null)
    setLoading(true)
    try {
      const res = await payForReport({
        query,
        desiredCount,
        billingType,
        ...(!user
          ? {
              email: guestEmail.trim().toLowerCase(),
              name: guestName.trim() || undefined,
              password: guestPassword,
            }
          : {}),
      })
      if (res.token && res.user) {
        loginWithToken(res.token, {
          id: res.user.id,
          username: res.user.username,
          scope: res.user.scope as AuthScope,
          profile_handle: res.user.profile_handle,
        })
        void refreshCredits()
      }
      if (res.campaignId && onSuccess) {
        onSuccess(res.campaignId)
        return
      }
      if (!user && res.token && res.pixCopyPaste && onPaymentCreated) {
        onPaymentCreated()
        return
      }
      setPaymentCreated({
        pixCopyPaste: res.pixCopyPaste ?? null,
        bankSlipUrl: res.bankSlipUrl ?? null,
        invoiceUrl: res.invoiceUrl ?? null,
        billingType: res.billingType,
      })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const copyPix = () => {
    if (!paymentCreated?.pixCopyPaste) return
    void navigator.clipboard.writeText(paymentCreated.pixCopyPaste)
  }

  if (authLoading) {
    return (
      <div style={{ maxWidth: 560, margin: '24px auto', padding: 24, textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    )
  }
  if (paymentCreated && user) {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto', padding: 24 }}>
        <Alert
          type="success"
          message="Pagamento gerado"
          description={
            paymentCreated.billingType === 'PIX'
              ? 'Escaneie o QR Code com o app do seu banco ou copie o código PIX. Após a confirmação, acesse Minhas campanhas para ver o relatório.'
              : 'Pague o boleto pelo link abaixo. Após a confirmação, acesse Minhas campanhas para ver o relatório.'
          }
          showIcon
          style={{ marginBottom: 20 }}
        />
        {paymentCreated.billingType === 'PIX' && paymentCreated.pixCopyPaste && (
          <Card size="small" style={{ marginBottom: 16, textAlign: 'center' }}>
            {pixQrDataUrl && (
              <div style={{ marginBottom: 16 }}>
                <img src={pixQrDataUrl} alt="QR Code PIX" style={{ display: 'block', margin: '0 auto', width: 220, height: 220 }} />
                <Text strong style={{ display: 'block', marginTop: 8 }}>Escaneie para pagar</Text>
              </div>
            )}
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>Ou copie o código PIX:</Text>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
              <Text type="secondary" style={{ flex: 1, minWidth: 0, wordBreak: 'break-all', fontSize: 12 }}>{paymentCreated.pixCopyPaste}</Text>
              <Button type="primary" icon={<CopyOutlined />} onClick={copyPix}>Copiar PIX</Button>
            </div>
          </Card>
        )}
        {paymentCreated.billingType === 'BOLETO' && paymentCreated.bankSlipUrl && (
          <Button type="primary" href={paymentCreated.bankSlipUrl} target="_blank" rel="noopener noreferrer" block icon={<BankOutlined />} style={{ marginBottom: 16 }}>
            Abrir boleto
          </Button>
        )}
        {paymentCreated.invoiceUrl && (
          <Button href={paymentCreated.invoiceUrl} target="_blank" rel="noopener noreferrer" block style={{ marginBottom: 16 }}>Ver fatura</Button>
        )}
        <Button type="primary" block onClick={onCancel}>Fechar</Button>
      </div>
    )
  }

  // Fluxo em três etapas para guest: 1 = quantidade, 2 = dados, 3 = pagamento (PIX/Boleto)
  if (!user && guestStep === 1) {
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text strong>Total</Text>
            <Text strong style={{ color: 'var(--app-primary)' }}>{formatBrl(totalCents)}</Text>
          </div>
        </Card>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Button type="primary" size="large" onClick={() => setGuestStep(2)} disabled={total <= 0}>
            Continuar
          </Button>
          {!embed && <Button size="large" onClick={onCancel}>Cancelar</Button>}
        </div>
      </div>
    )
  }

  if (!user && guestStep === 2) {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '12px 20px 16px' }}>
        <Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>Etapa 2 de 2</Text>
        <Card size="small" style={{ marginBottom: 10, padding: '8px 12px' }} bodyStyle={{ padding: '8px 12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 13 }}>{desiredCount.toLocaleString('pt-BR')} influenciadores</Text>
            <Text strong style={{ color: 'var(--app-primary)', fontSize: 13 }}>{formatBrl(totalCents)}</Text>
          </div>
        </Card>
        <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>Preencha seus dados.</Text>
        <Card size="small" style={{ marginBottom: 10 }} bodyStyle={{ padding: '10px 12px' }}>
          <Space direction="vertical" style={{ width: '100%' }} size="small">
            <div>
              <Text strong style={{ fontSize: 12 }}>Nome</Text>
              <Input size="small" placeholder="Seu nome" value={guestName} onChange={(e) => setGuestName(e.target.value)} style={{ marginTop: 2 }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <Text strong style={{ fontSize: 12 }}>E-mail</Text>
                <Input size="small" type="email" placeholder="seu@email.com" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} style={{ marginTop: 2 }} />
              </div>
              <div>
                <Text strong style={{ fontSize: 12 }}>CPF ou CNPJ</Text>
                <Input size="small" placeholder="Apenas números" value={guestCpfCnpj} onChange={(e) => setGuestCpfCnpj(e.target.value.replace(/\D/g, ''))} style={{ marginTop: 2 }} maxLength={14} />
              </div>
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
          <Button
            type="primary"
            size="middle"
            loading={loading}
            disabled={loading}
            onClick={async () => {
              setError(null)
              if (!guestEmail.trim() || !guestEmail.includes('@')) {
                setError('Informe um e-mail válido.')
                return
              }
              const cpfCnpjDigits = guestCpfCnpj.replace(/\D/g, '')
              if (cpfCnpjDigits.length !== 11 && cpfCnpjDigits.length !== 14) {
                setError('Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.')
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
                const res = await payForReport({
                  query,
                  desiredCount,
                  billingType: 'BOLETO',
                  email: guestEmail.trim().toLowerCase(),
                  name: guestName.trim() || undefined,
                  password: guestPassword,
                  cpfCnpj: cpfCnpjDigits,
                })
                if (res.token && res.user) {
                  loginWithToken(res.token, {
                    id: res.user.id,
                    username: res.user.username,
                    scope: res.user.scope as AuthScope,
                    profile_handle: res.user.profile_handle,
                  })
                  void refreshCredits()
                }
                if ((res.pixCopyPaste || res.bankSlipUrl) && res.token && onPaymentCreated) {
                  requestAnimationFrame(() => {
                    requestAnimationFrame(() => onPaymentCreated())
                  })
                  return
                }
                setError('Não foi possível gerar o pagamento. Tente novamente.')
              } catch (e) {
                setError((e as Error).message)
              } finally {
                setLoading(false)
              }
            }}
          >
            Continuar
          </Button>
          <Button size="middle" onClick={() => { setGuestStep(1); setError(null) }} disabled={loading}>Voltar</Button>
          {!embed && <Button size="middle" onClick={onCancel} disabled={loading}>Cancelar</Button>}
        </div>
      </div>
    )
  }

  // Usuário logado: tela única (quantidade + forma de pagamento + botão)
  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: 24 }}>
      <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
        Escolha quantos influenciadores deseja no relatório e pague com PIX ou Boleto.
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text strong>Total</Text>
          <Text strong style={{ color: 'var(--app-primary)' }}>{formatBrl(totalCents)}</Text>
        </div>
      </Card>

      <div style={{ marginBottom: 20 }}>
        <Text strong>Forma de pagamento</Text>
        <div style={{ marginTop: 8 }}>
          <Space wrap>
            <Button type={billingType === 'PIX' ? 'primary' : 'default'} onClick={() => setBillingType('PIX')}>
              PIX (recomendado)
            </Button>
            <Button type={billingType === 'BOLETO' ? 'primary' : 'default'} onClick={() => setBillingType('BOLETO')}>
              Boleto
            </Button>
          </Space>
        </div>
      </div>

      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 24 }} onClose={() => setError(null)} closable />}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Button
          type="primary"
          size="large"
          icon={<DollarOutlined />}
          onClick={handlePayForReport}
          disabled={loading || total <= 0}
          loading={loading}
        >
          {billingType === 'PIX' ? 'Gerar QR Code PIX' : 'Gerar boleto'}
        </Button>
        {!embed && (
          <Button size="large" onClick={onCancel} disabled={loading}>Cancelar</Button>
        )}
      </div>
    </div>
  )
}
