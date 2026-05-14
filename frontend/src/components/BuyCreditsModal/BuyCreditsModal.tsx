/**
 * Compra de créditos (PIX / Boleto) — único lugar no app para gerar esses pagamentos.
 * Após gerar: segundo modal com QR PIX ou abertura do boleto (não só link de fatura).
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import QRCode from 'qrcode'
import { Modal, Button, Typography, Alert, Space, InputNumber, message, Input, Popconfirm } from 'antd'
import {
  DollarOutlined,
  CopyOutlined,
  BankOutlined,
  ThunderboltOutlined,
  CheckCircleOutlined,
  IdcardOutlined,
  DeleteOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { useAuth } from '../../contexts/AuthContext'
import { useCredits } from '../../contexts/CreditsContext'
import { useRegisterPendingPaymentWatch } from '../../contexts/PendingPaymentCelebrationContext'
import {
  createPaymentForCredits,
  adminAddCredits,
  deleteMyPendingPayment,
  PendingPaymentExistsError,
  type CreatePaymentForCreditsResponse,
} from '../../api'

const { Text, Title } = Typography

export const MIN_BUY_CREDITS = 10

export const CREDIT_PACKS = [
  { credits: 10, label: '10 créditos' },
  { credits: 50, label: '50 créditos' },
  { credits: 100, label: '100 créditos' },
  { credits: 200, label: '200 créditos' },
]

function clampBuyCredits(n: number): number {
  return Math.min(10000, Math.max(MIN_BUY_CREDITS, Math.floor(n)))
}

function errorSuggestsDocument(msg: string): boolean {
  return /cpf|cnpj|documento|cliente/i.test(msg)
}

function buyCreditsDbg(...args: unknown[]) {
  if (import.meta.env.DEV) console.debug('[BuyCredits]', ...args)
}

function defaultTitularName(user: { username?: string; profile_handle?: string | null } | null | undefined): string {
  if (!user) return ''
  const h = user.profile_handle?.trim()
  if (h) return `@${h.replace(/^@/, '')}`
  return (user.username ?? '').trim()
}

function paymentBrlAmount(p: CreatePaymentForCreditsResponse): number {
  const brl =
    typeof p.valueBrl === 'number' && Number.isFinite(p.valueBrl)
      ? p.valueBrl
      : (Number.isFinite(p.amountCents) ? p.amountCents / 100 : 0)
  return brl
}

function formatBrlPayment(p: CreatePaymentForCreditsResponse): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(paymentBrlAmount(p))
}

/** Partes para exibir o valor com hierarquia visual (R$ + inteiro + centavos). */
function formatBrlDisplayParts(brl: number): { currency: string; integer: string; fraction: string } {
  const f = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  const parts = f.formatToParts(brl)
  const currency = parts.find((x) => x.type === 'currency')?.value ?? 'R$'
  const integer = parts
    .filter((x) => x.type === 'integer' || x.type === 'group')
    .map((x) => x.value)
    .join('')
  const fraction = parts.find((x) => x.type === 'fraction')?.value ?? '00'
  return { currency, integer, fraction }
}

function PaymentValueBanner({ payment }: { payment: CreatePaymentForCreditsResponse }) {
  const parts = formatBrlDisplayParts(paymentBrlAmount(payment))
  const full = formatBrlPayment(payment)
  return (
    <div className="buy-credits-payment-value" aria-label={`Valor ${full}`}>
      <span className="buy-credits-payment-value-label">Total a pagar</span>
      <div className="buy-credits-payment-value-amount">
        <span className="buy-credits-payment-value-currency">{parts.currency}</span>
        <span className="buy-credits-payment-value-int">{parts.integer}</span>
        <span className="buy-credits-payment-value-frac">,{parts.fraction}</span>
      </div>
    </div>
  )
}

export interface BuyCreditsModalProps {
  open: boolean
  onClose: () => void
  /** Preço total em créditos (campanha / relatório). Ao abrir, pré-preenche (respeitando o mínimo de compra). */
  suggestedCredits?: number
  /** Ao fechar o modal de resultado (Concluir / X), após PIX/boleto gerado — evita refresh pesado no pai enquanto o modal ainda está aberto. */
  onAfterPaymentCreated?: () => void | Promise<void>
  /** Se o usuário já tem cobrança pendente, abre direto o modal de PIX/boleto (sem formulário). */
  resumePayment?: CreatePaymentForCreditsResponse | null
  /** Em Meus pagamentos: fecha o modal e delega o resultado ao card pendente na página. */
  showPaymentResultOnPage?: boolean
  onPaymentCreated?: (payment: CreatePaymentForCreditsResponse) => void
}

export default function BuyCreditsModal({
  open,
  onClose,
  suggestedCredits,
  onAfterPaymentCreated,
  resumePayment = null,
  showPaymentResultOnPage = false,
  onPaymentCreated,
}: BuyCreditsModalProps) {
  const { user, isAdm, refreshUser } = useAuth()
  const { refreshCredits } = useCredits()
  const registerPendingPaymentWatch = useRegisterPendingPaymentWatch()

  const savedBillingDocument = (user?.billingCpfCnpj ?? '').replace(/\D/g, '').slice(0, 14)
  const [buyCredits, setBuyCredits] = useState(50)
  const [buyBillingType, setBuyBillingType] = useState<'PIX' | 'BOLETO'>('PIX')
  const [creating, setCreating] = useState(false)
  const [approvingAdmin, setApprovingAdmin] = useState(false)
  const [createdPayment, setCreatedPayment] = useState<CreatePaymentForCreditsResponse | null>(null)
  const [pixQrDataUrl, setPixQrDataUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cpfModalOpen, setCpfModalOpen] = useState(false)
  const [cpfCnpjInput, setCpfCnpjInput] = useState('')
  const [billingTitularNameInput, setBillingTitularNameInput] = useState('')
  const [deletingInvoice, setDeletingInvoice] = useState(false)
  /** Só reinicia o formulário na abertura do modal — não quando `suggestedCredits` muda (ex.: refresh da campanha após pagamento). */
  const buyModalWasOpenRef = useRef(false)
  /**
   * Ant Design pode disparar onCancel do modal do formulário quando ele fecha por `open` virar false
   * (ao setar createdPayment). Isso chamava onClose() do pai e fechava tudo antes do modal do PIX abrir.
   * Ref atualizado no mesmo tick que setCreatedPayment.
   */
  const createdPaymentRef = useRef<CreatePaymentForCreditsResponse | null>(null)

  useEffect(() => {
    const id = createdPayment?.paymentId
    if (id) registerPendingPaymentWatch(id)
  }, [createdPayment?.paymentId, registerPendingPaymentWatch])

  const deliverPaymentToParent = useCallback(
    async (p: CreatePaymentForCreditsResponse) => {
      if (showPaymentResultOnPage) {
        createdPaymentRef.current = null
        setCreatedPayment(null)
        setPixQrDataUrl(null)
        onPaymentCreated?.(p)
        onClose()
        await Promise.resolve(onAfterPaymentCreated?.()).catch(() => {})
        return true
      }
      return false
    },
    [showPaymentResultOnPage, onPaymentCreated, onClose, onAfterPaymentCreated]
  )

  useEffect(() => {
    if (!open) {
      buyModalWasOpenRef.current = false
      buyCreditsDbg('parent open=false', { hadPaymentRef: createdPaymentRef.current != null })
      return
    }
    if (buyModalWasOpenRef.current) {
      return
    }
    buyModalWasOpenRef.current = true

    if (resumePayment?.paymentId) {
      const p = resumePayment
      createdPaymentRef.current = p
      setCreatedPayment(p)
      setBuyBillingType(p.billingType === 'BOLETO' ? 'BOLETO' : 'PIX')
      setPixQrDataUrl(null)
      setError(null)
      setCpfModalOpen(false)
      setCpfCnpjInput('')
      setBillingTitularNameInput('')
      buyCreditsDbg('session start (resume pending payment)', { paymentId: p.paymentId })
      if (suggestedCredits != null && Number.isFinite(suggestedCredits) && suggestedCredits > 0) {
        setBuyCredits(clampBuyCredits(suggestedCredits))
      }
      void refreshCredits()
      void refreshUser()
      return
    }

    createdPaymentRef.current = null
    setCreatedPayment(null)
    setPixQrDataUrl(null)
    setError(null)
    setCpfModalOpen(false)
    setCpfCnpjInput('')
    setBillingTitularNameInput('')
    buyCreditsDbg('session start (form opened)', { suggestedCredits })
    if (suggestedCredits != null && Number.isFinite(suggestedCredits) && suggestedCredits > 0) {
      setBuyCredits(clampBuyCredits(suggestedCredits))
    }
  }, [open, suggestedCredits, resumePayment, refreshCredits, refreshUser])

  useEffect(() => {
    const payload = createdPayment?.pixCopyPaste
    if (!payload) {
      setPixQrDataUrl(null)
      return
    }
    let cancelled = false
    QRCode.toDataURL(payload, { width: 260, margin: 2 })
      .then((url) => {
        if (!cancelled) setPixQrDataUrl(url)
      })
      .catch(() => {
        if (!cancelled) setPixQrDataUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [createdPayment?.pixCopyPaste])

  const runCreatePayment = useCallback(
    async (explicitCpf?: string, opts?: { fromDocumentModal?: boolean; customerName?: string }) => {
      setCreating(true)
      setError(null)
      try {
        const fromExplicit = (explicitCpf ?? '').replace(/\D/g, '')
        const fromSaved = buyBillingType === 'PIX' ? savedBillingDocument : ''
        const digits =
          fromExplicit.length === 11 || fromExplicit.length === 14
            ? fromExplicit
            : fromSaved.length === 11 || fromSaved.length === 14
              ? fromSaved
              : ''
        const titularTrim = (opts?.customerName ?? '').trim()
        const apiOpts: { cpfCnpj?: string; customerName?: string } = {}
        if (digits) apiOpts.cpfCnpj = digits
        if (opts?.fromDocumentModal && titularTrim.length >= 2) {
          apiOpts.customerName = titularTrim.slice(0, 200)
        }
        const res = await createPaymentForCredits(
          buyCredits,
          buyBillingType,
          Object.keys(apiOpts).length > 0 ? apiOpts : undefined
        )
        if (await deliverPaymentToParent(res)) return
        createdPaymentRef.current = res
        setCreatedPayment(res)
        setCpfModalOpen(false)
        buyCreditsDbg('payment created, showing result modal (independent of parent open)', {
          hasPix: Boolean(res.pixCopyPaste),
          hasBoleto: Boolean(res.bankSlipUrl),
        })
        // Deixa o modal de pagamento montar antes do refresh do pai (evita corrida com o modal que fecha).
        await new Promise<void>((r) => {
          requestAnimationFrame(() => r())
        })
        await refreshCredits()
        await refreshUser()
      } catch (e) {
        if (e instanceof PendingPaymentExistsError) {
          const p = e.payment
          if (await deliverPaymentToParent(p)) return
          createdPaymentRef.current = p
          setCreatedPayment(p)
          setBuyBillingType(p.billingType === 'BOLETO' ? 'BOLETO' : 'PIX')
          setCpfModalOpen(false)
          setError(null)
          message.info('Você já possui uma cobrança pendente. Use a fatura abaixo ou cancele em Meus pagamentos.')
          await new Promise<void>((r) => {
            requestAnimationFrame(() => r())
          })
          await refreshCredits()
          await refreshUser()
          return
        }
        const msg = (e as Error).message
        if (buyBillingType === 'PIX' && errorSuggestsDocument(msg)) {
          setCpfCnpjInput(savedBillingDocument)
          setBillingTitularNameInput(defaultTitularName(user))
          setCpfModalOpen(true)
        }
        setError(msg)
        if (opts?.fromDocumentModal) {
          message.error(msg)
        }
      } finally {
        setCreating(false)
      }
    },
    [buyCredits, buyBillingType, refreshCredits, refreshUser, savedBillingDocument, user, deliverPaymentToParent]
  )

  const handleGerarPagamentoClick = () => {
    if (buyBillingType === 'BOLETO') {
      setCpfCnpjInput(savedBillingDocument)
      setBillingTitularNameInput(defaultTitularName(user))
      setCpfModalOpen(true)
      return
    }
    void runCreatePayment()
  }

  const handleConfirmCpf = () => {
    const titular = billingTitularNameInput.trim()
    if (titular.length < 2) {
      message.warning('Informe o nome do titular como no documento (mínimo 2 caracteres).')
      return
    }
    const digits = cpfCnpjInput.replace(/\D/g, '')
    if (digits.length !== 11 && digits.length !== 14) {
      message.warning('Informe CPF (11 dígitos) ou CNPJ (14 dígitos).')
      return
    }
    void runCreatePayment(cpfCnpjInput, { fromDocumentModal: true, customerName: titular })
  }

  const handleAdminApprove = async () => {
    if (!user?.id) return
    setApprovingAdmin(true)
    setError(null)
    try {
      await adminAddCredits(user.id, buyCredits)
      message.success(`${buyCredits} créditos adicionados com sucesso`)
      await refreshCredits()
      await onAfterPaymentCreated?.()
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setApprovingAdmin(false)
    }
  }

  const copyPix = () => {
    if (!createdPayment?.pixCopyPaste) return
    void navigator.clipboard.writeText(createdPayment.pixCopyPaste).then(() => {
      message.success('Código PIX copiado!')
    })
  }

  const handleCloseFormModal = () => {
    if (createdPaymentRef.current != null || createdPayment != null) {
      buyCreditsDbg('ignore form onCancel — payment result pending', {
        ref: createdPaymentRef.current != null,
        state: createdPayment != null,
      })
      return
    }
    setError(null)
    setCpfModalOpen(false)
    buyCreditsDbg('form closed → parent onClose')
    onClose()
  }

  const handleClosePaymentModal = () => {
    createdPaymentRef.current = null
    setCreatedPayment(null)
    setPixQrDataUrl(null)
    buyCreditsDbg('payment result closed → parent onClose + onAfterPaymentCreated')
    onClose()
    queueMicrotask(() => {
      void Promise.resolve(onAfterPaymentCreated?.()).catch(() => { })
    })
  }

  const handleDeleteInvoice = async () => {
    const id = createdPayment?.paymentId
    if (!id) return
    setDeletingInvoice(true)
    try {
      await deleteMyPendingPayment(id)
      message.success('Cobrança removida.')
      createdPaymentRef.current = null
      setCreatedPayment(null)
      setPixQrDataUrl(null)
      onClose()
      queueMicrotask(() => {
        void Promise.resolve(onAfterPaymentCreated?.()).catch(() => { })
      })
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setDeletingInvoice(false)
    }
  }

  const openBoleto = () => {
    const url = createdPayment?.bankSlipUrl
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
  }

  const openInvoice = () => {
    const url = createdPayment?.invoiceUrl
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
  }

  const paymentModalTitle =
    buyBillingType === 'PIX' ? 'Pague com PIX' : 'Seu boleto está pronto'

  const hasPixPayload = Boolean(createdPayment?.pixCopyPaste)
  const hasBoletoLink = Boolean(createdPayment?.bankSlipUrl)
  const hasInvoice = Boolean(createdPayment?.invoiceUrl)

  return (
    <>
      <Modal
        className="buy-credits-modal"
        title="Comprar créditos"
        open={open && !createdPayment}
        onCancel={handleCloseFormModal}
        footer={null}
        width={500}
        destroyOnHidden={false}
        maskClosable={!creating}
        zIndex={1000}
      >
        {error && (
          <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} onClose={() => setError(null)} closable />
        )}
        <div style={{ marginBottom: 24 }}>
          <Text strong style={{ fontSize: 14, display: 'block', marginBottom: 10 }}>Quantidade de créditos</Text>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {CREDIT_PACKS.map((p) => (
              <button
                key={p.credits}
                type="button"
                className={`credit-pack-btn ${buyCredits === p.credits ? 'credit-pack-btn-selected' : ''}`}
                onClick={() => setBuyCredits(p.credits)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 6 }}>Ou escolha o valor:</Text>
            <InputNumber
              min={MIN_BUY_CREDITS}
              max={10000}
              value={buyCredits}
              onChange={(v) => setBuyCredits(v != null && Number.isFinite(v) ? clampBuyCredits(v) : MIN_BUY_CREDITS)}
              size="large"
              style={{ width: '100%' }}
              addonAfter="créditos"
            />
          </div>
        </div>
        <div style={{ marginBottom: 24 }}>
          <Text strong style={{ fontSize: 14, display: 'block', marginBottom: 10 }}>Forma de pagamento</Text>
          <div style={{ display: 'flex', gap: 12, width: '100%' }}>
            <div
              className={`payment-option ${buyBillingType === 'PIX' ? 'payment-option-selected' : ''}`}
              onClick={() => setBuyBillingType('PIX')}
              style={{ flex: 1, width: '50%', minWidth: 0 }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && setBuyBillingType('PIX')}
            >
              <ThunderboltOutlined style={{ marginRight: 8, color: 'var(--app-primary)' }} />
              <Text strong>PIX</Text>
              <Text type="secondary" style={{ fontSize: 12, marginLeft: 4 }}>instantâneo</Text>
            </div>
            <div
              className={`payment-option ${buyBillingType === 'BOLETO' ? 'payment-option-selected' : ''}`}
              onClick={() => setBuyBillingType('BOLETO')}
              style={{ flex: 1, width: '50%', minWidth: 0 }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && setBuyBillingType('BOLETO')}
            >
              <BankOutlined style={{ marginRight: 8, color: 'var(--app-primary)' }} />
              <Text strong>Boleto</Text>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div>
            {isAdm && (
              <Button
                type="default"
                size="large"
                loading={approvingAdmin}
                onClick={handleAdminApprove}
                icon={<CheckCircleOutlined />}
                style={{ borderColor: 'var(--app-primary)', color: 'var(--app-primary)' }}
              >
                Aprovar sem pagar
              </Button>
            )}
          </div>
          <Space>
            <Button onClick={handleCloseFormModal} size="large">Cancelar</Button>
            <Button
              type="primary"
              size="large"
              loading={creating}
              onClick={handleGerarPagamentoClick}
              icon={<DollarOutlined />}
              style={{
                background: 'linear-gradient(135deg, var(--app-primary) 0%, rgba(104, 39, 143, 0.9) 100%)',
                border: 'none',
                paddingLeft: 24,
                paddingRight: 24,
                fontWeight: 600,
              }}
            >
              Gerar pagamento
            </Button>
          </Space>
        </div>
      </Modal>

      {/* Modal de resultado não usa `open` do pai — evita sumir o PIX se o pai receber onClose ao fechar o formulário por controle. */}
      <Modal
        title={paymentModalTitle}
        open={Boolean(createdPayment)}
        onCancel={handleClosePaymentModal}
        footer={
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 8,
              width: '100%',
            }}
          >
            <Popconfirm
              title="Excluir esta fatura?"
              description="Cancela no gateway e remove a cobrança. Não dá para desfazer."
              okText="Excluir"
              cancelText="Cancelar"
              okButtonProps={{ danger: true, loading: deletingInvoice }}
              disabled={deletingInvoice}
              onConfirm={() => void handleDeleteInvoice()}
            >
              <Button danger type="default" size="large" icon={<DeleteOutlined />} loading={deletingInvoice} disabled={deletingInvoice}>
                Excluir fatura
              </Button>
            </Popconfirm>
            <Button type="primary" size="large" onClick={handleClosePaymentModal} disabled={deletingInvoice}>
              Concluir
            </Button>
          </div>
        }
        width={440}
        centered
        destroyOnHidden
        zIndex={1150}
        className="buy-credits-payment-result-modal"
      >
        {createdPayment && (
          <div style={{ textAlign: 'center' }}>
            <PaymentValueBanner payment={createdPayment} />

            {buyBillingType === 'PIX' && hasPixPayload && (
              <>
                {pixQrDataUrl && (
                  <div style={{ marginBottom: 16 }}>
                    <img src={pixQrDataUrl} alt="QR Code PIX" style={{ width: 260, height: 260, display: 'block', margin: '0 auto', borderRadius: 8 }} />
                    <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
                      Abra o app do banco e escaneie
                    </Text>
                  </div>
                )}
                <Button type="primary" size="large" block icon={<CopyOutlined />} onClick={copyPix} style={{ marginBottom: 12 }}>
                  Copiar código PIX
                </Button>
                <Text type="secondary" copyable={{ text: createdPayment.pixCopyPaste ?? '' }} style={{ fontSize: 11, wordBreak: 'break-all', display: 'block', textAlign: 'left' }}>
                  {createdPayment.pixCopyPaste}
                </Text>
              </>
            )}

            {buyBillingType === 'BOLETO' && hasBoletoLink && (
              <>
                <Title level={5} style={{ marginTop: 0, marginBottom: 16 }}>
                  Boleto bancário
                </Title>
                <Button
                  type="primary"
                  size="large"
                  block
                  icon={<BankOutlined />}
                  onClick={openBoleto}
                  style={{
                    marginBottom: 12,
                    fontWeight: 600,
                    minHeight: 48,
                    background: 'linear-gradient(135deg, var(--app-primary) 0%, rgba(104, 39, 143, 0.9) 100%)',
                    border: 'none',
                  }}
                >
                  Abrir boleto em nova aba
                </Button>
                <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                  Se o navegador bloquear pop-up, use o botão acima de novo ou aba “Ver fatura” abaixo.
                </Text>
              </>
            )}

            {buyBillingType === 'PIX' && !hasPixPayload && hasInvoice && (
              <Button type="primary" size="large" block onClick={openInvoice} style={{ marginBottom: 12 }}>
                Abrir página de pagamento (PIX / cartão)
              </Button>
            )}

            {buyBillingType === 'BOLETO' && !hasBoletoLink && hasInvoice && (
              <Button type="primary" size="large" block icon={<BankOutlined />} onClick={openInvoice} style={{ marginBottom: 12 }}>
                Abrir boleto / fatura no Asaas
              </Button>
            )}

            {hasInvoice && (hasPixPayload || hasBoletoLink) && (
              <Button type="default" block onClick={openInvoice} style={{ marginTop: 8 }}>
                Ver fatura no Asaas
              </Button>
            )}

            {!hasPixPayload && !hasBoletoLink && !hasInvoice && (
              <Text type="warning">Não recebemos link de pagamento da operadora. Tente em Meus pagamentos ou fale com o suporte.</Text>
            )}
          </div>
        )}
      </Modal>

      <Modal
        title="Nome e CPF/CNPJ do titular"
        open={cpfModalOpen}
        onCancel={() => {
          setCpfModalOpen(false)
          setCpfCnpjInput('')
          setBillingTitularNameInput('')
          setError(null)
        }}
        footer={null}
        destroyOnHidden
        width={420}
        zIndex={1100}
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          {buyBillingType === 'BOLETO'
            ? 'O boleto exige nome e CPF ou CNPJ do titular no gateway de pagamento.'
            : 'Informe nome e documento para concluir a cobrança.'}
          {savedBillingDocument ? (
            <span style={{ display: 'block', marginTop: 8 }}>Usamos o último documento que você informou; altere nome ou documento se precisar.</span>
          ) : (
            <span style={{ display: 'block', marginTop: 8 }}>O nome deve coincidir com o titular do CPF/CNPJ.</span>
          )}
        </Text>
        {error ? (
          <Alert
            type="error"
            message={error}
            showIcon
            closable
            onClose={() => setError(null)}
            style={{ marginBottom: 16 }}
          />
        ) : null}
        <Input
          placeholder="Nome completo ou razão social do titular"
          value={billingTitularNameInput}
          onChange={(e) => setBillingTitularNameInput(e.target.value)}
          size="large"
          maxLength={200}
          prefix={<UserOutlined style={{ color: 'var(--app-text-tertiary)' }} />}
          style={{ marginBottom: 16 }}
        />
        <Input
          placeholder="Apenas números (11 ou 14 dígitos)"
          value={cpfCnpjInput}
          onChange={(e) => setCpfCnpjInput(e.target.value.replace(/\D/g, '').slice(0, 14))}
          size="large"
          maxLength={14}
          prefix={<IdcardOutlined style={{ color: 'var(--app-text-tertiary)' }} />}
          onPressEnter={handleConfirmCpf}
          style={{ marginBottom: 16 }}
        />
        <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
          <Button
            onClick={() => {
              setCpfModalOpen(false)
              setCpfCnpjInput('')
              setBillingTitularNameInput('')
              setError(null)
            }}
          >
            Voltar
          </Button>
          <Button type="primary" loading={creating} onClick={handleConfirmCpf} icon={<DollarOutlined />}>
            Gerar pagamento
          </Button>
        </Space>
      </Modal>
    </>
  )
}
