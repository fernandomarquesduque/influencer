/**
 * Conteúdo do checkout: compra do relatório com créditos.
 * Pode ser usado na página /app/checkout ou dentro de um modal.
 */
import { useState, useMemo, useEffect } from 'react'
import { Card, Typography, Button, Spin, Alert, Result, Slider, InputNumber } from 'antd'
import { ShoppingCartOutlined, DollarOutlined } from '@ant-design/icons'
import { useAuth } from '../../contexts/AuthContext'
import { useCredits } from '../../contexts/CreditsContext'
import { createCampaign, adminAddCredits, type ProfilesSearchQuery } from '../../api'

const { Title, Text } = Typography

const CREDITS_PER_INFLUENCER = 1
const MIN_PROFILES = 1

export interface CheckoutContentProps {
  query: ProfilesSearchQuery
  total: number
  onSuccess: (campaignId: string) => void
  onCancel: () => void
  /** Se true, botão "Comprar mais créditos" no erro leva para a app em vez de navegar (útil no modal). */
  embed?: boolean
}

export default function CheckoutContent({
  query,
  total,
  onSuccess,
  onCancel,
  embed = false,
}: CheckoutContentProps) {
  const { user, loading: authLoading, isAdm } = useAuth()
  const { balance, refreshCredits } = useCredits()

  const [loading, setLoading] = useState(false)
  const [adminAddingCredits, setAdminAddingCredits] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const minProfiles = Math.min(MIN_PROFILES, total)
  const [desiredCount, setDesiredCount] = useState(Math.max(minProfiles, total))
  useEffect(() => {
    setDesiredCount((prev) => Math.max(minProfiles, Math.min(total, prev)))
  }, [total, minProfiles])

  const required = useMemo(() => desiredCount * CREDITS_PER_INFLUENCER, [desiredCount])

  const handlePurchase = async () => {
    if (!query || total <= 0) return
    if (balance < required) {
      setError(`Saldo insuficiente. Necessário: ${required} créditos. Compre mais créditos.`)
      return
    }
    setError(null)
    setLoading(true)
    try {
      const res = await createCampaign(query, { maxHandles: desiredCount, name: query.q?.trim() || undefined })
      await refreshCredits()
      setSuccess(true)
      setTimeout(() => {
        onSuccess(res.campaignId)
      }, 1500)
    } catch (e) {
      const err = e as Error & { code?: string; required?: number }
      if (err.code === 'INSUFFICIENT_CREDITS') {
        setError(err.message || 'Créditos insuficientes.')
        await refreshCredits()
      } else {
        setError(err.message || 'Falha ao processar a compra.')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleAdminAddCreditsAndPurchase = async () => {
    if (!user || !query || total <= 0) return
    setError(null)
    setAdminAddingCredits(true)
    try {
      await adminAddCredits(user.id, 100)
      await refreshCredits()
      setLoading(true)
      setAdminAddingCredits(false)
      const res = await createCampaign(query, { maxHandles: desiredCount, name: query.q?.trim() || undefined })
      await refreshCredits()
      setLoading(false)
      setSuccess(true)
      setTimeout(() => {
        onSuccess(res.campaignId)
      }, 1500)
    } catch (e) {
      setAdminAddingCredits(false)
      setLoading(false)
      setError((e as Error).message || 'Falha ao adicionar créditos ou comprar')
    }
  }

  if (authLoading) {
    return (
      <div style={{ maxWidth: 560, margin: '24px auto', padding: 24, textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    )
  }
  if (!user) return null

  const canPurchase = balance >= required && total > 0
  const canAdminBypass = isAdm && total > 0 && balance < required

  if (success) {
    return (
      <div style={{ maxWidth: 560, margin: '24px auto', padding: 24 }}>
        <Result
          status="success"
          title="Relatório comprado!"
          subTitle="Redirecionando para a lista de influenciadores..."
        />
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: 24 }}>

      <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
        Use seus créditos para liberar a lista completa destes influenciadores.
      </Text>

      <Card style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <Text strong>Total de perfis no relatório</Text>
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
            Reduza a quantidade para economizar créditos.
          </Text>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text type="secondary">Seu saldo</Text>
          <Text strong style={{ color: balance >= required ? 'var(--app-success, #52c41a)' : 'var(--app-error, #ff4d4f)' }}>
            {balance} créditos
          </Text>
        </div>
      </Card>

      {error && (
        <Alert
          type="error"
          message={error}
          showIcon
          style={{ marginBottom: 24 }}
          action={
            error.includes('insuficiente') && !embed ? (
              <Button size="small" type="primary" onClick={onCancel}>
                Voltar
              </Button>
            ) : null
          }
        />
      )}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Button
          type="primary"
          size="large"
          icon={<DollarOutlined />}
          onClick={handlePurchase}
          disabled={!canPurchase || loading}
          loading={loading}
        >
          Comprar com créditos
        </Button>
        {canAdminBypass && (
          <Button
            type="default"
            size="large"
            onClick={handleAdminAddCreditsAndPurchase}
            disabled={loading}
            loading={adminAddingCredits || loading}
          >
            Admin: adicionar 100 créditos e comprar
          </Button>
        )}
        {!embed && (
          <Button size="large" onClick={onCancel} disabled={loading}>
            Cancelar
          </Button>
        )}
      </div>

      {!canPurchase && !canAdminBypass && total > 0 && balance < required && (
        <Text type="secondary" style={{ display: 'block', marginTop: 16 }}>
          Entre em contato para adquirir mais créditos.
        </Text>
      )}
    </div>
  )
}
