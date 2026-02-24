import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Card,
  Form,
  Input,
  Button,
  Row,
  Col,
  Spin,
  Typography,
  message,
  Select,
  Modal,
  Collapse,
  Steps,
  Space,
  Divider,
} from 'antd'
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  UserOutlined,
  MessageOutlined,
  LinkOutlined,
  GlobalOutlined,
} from '@ant-design/icons'
import {
  fetchProfile,
  fetchProfileActivation,
  saveProfileActivation,
  deleteAccount,
  getProfilePicUrl,
  proxyImageUrl,
  queueRefreshProfile,
  type ProfileActivation,
  type PricingData,
} from '../api'
import { CONTENT_TYPE_OPTIONS } from '../constants/contentTypes'
import {
  PRICE_BUCKETS,
  PRICING_FIELD_KEYS,
  PRICING_FIELD_LABELS,
  type PricingFieldKey,
} from '../constants/pricingBuckets'
import { useAuth } from '../contexts/AuthContext'

const { Title, Text } = Typography

const GENDER_OPTIONS = [
  { value: 'feminino', label: 'Feminino' },
  { value: 'masculino', label: 'Masculino' },
  { value: 'nao_binario', label: 'Não binário' },
  { value: 'outro', label: 'Outro' },
  { value: 'prefiro_nao_dizer', label: 'Prefiro não dizer' },
]

const PRICE_OPTIONS = PRICE_BUCKETS.map((b) => ({ value: b.value, label: b.label }))

/** Faixa intermediária para "Preencher com padrão". */
const DEFAULT_PRICE_BUCKET = 1000

const PRICING_FIELD_HELP: Record<PricingFieldKey, string> = {
  post_unique: 'Post único no feed (publipost)',
  stories: 'Stories (24h)',
  package_monthly: 'Pacote mensal recorrente',
  commission: 'Comissão / afiliado',
  permuta: 'Permuta (produto/serviço)',
  image_rights: 'Uso de imagem (direitos de uso)',
  content_delivery: 'Entrega de conteúdo (sem postar)',
  launch: 'Lançamento / campanha',
}

function normalizeUrl(value: string | undefined): string {
  if (!value || typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

function formatWhatsApp(value: string | undefined): string {
  if (!value || typeof value !== 'string') return ''
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 2) return digits ? `+${digits}` : ''
  if (digits.length <= 4) return `+${digits.slice(0, 2)} (${digits.slice(2)}`
  if (digits.length <= 9) return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4)}`
  return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9, 13)}`
}

function parseWhatsAppDigits(value: string | undefined): string {
  if (!value || typeof value !== 'string') return ''
  return value.replace(/\D/g, '')
}

export default function Activate() {
  const { handle } = useParams<{ handle: string }>()
  const navigate = useNavigate()
  const { canEditProfile, logout, refreshUser, isAdm, loading: authLoading } = useAuth()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [draftSaving, setDraftSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [step, setStep] = useState(0)
  const firstFieldStep0Ref = useRef<HTMLDivElement>(null)
  const firstFieldStep1Ref = useRef<HTMLDivElement>(null)
  const firstFieldStep2Ref = useRef<HTMLDivElement>(null)
  const [profileName, setProfileName] = useState<string | null>(null)
  const [profilePic, setProfilePic] = useState<string | undefined>(undefined)
  const [profilePicError, setProfilePicError] = useState(false)
  const [profilePicLoading, setProfilePicLoading] = useState(false)

  useEffect(() => {
    if (!handle) return
    if (authLoading) return
    if (!canEditProfile(handle)) {
      navigate('/app', { replace: true })
      return
    }
    let cancelled = false
    setLoading(true)
    Promise.all([
      fetchProfile(handle).catch(() => null),
      fetchProfileActivation(handle).catch(() => ({})),
    ]).then(([profile, activation]) => {
      if (cancelled) return
      if (profile) {
        setProfileName((profile.full_name as string) || (profile.username as string) || handle)
        const pic = getProfilePicUrl(profile)
        const picUrl = pic ? proxyImageUrl(pic) : undefined
        setProfilePic(picUrl)
        setProfilePicLoading(!!picUrl)
      }
      const act = (activation || {}) as ProfileActivation
      const pricingForm: Record<string, number | undefined> = {}
      if (act.pricing && typeof act.pricing === 'object') {
        for (const k of PRICING_FIELD_KEYS) {
          const v = act.pricing[k as keyof PricingData]
          if (v !== undefined && v !== null && v !== '') {
            const n = Number(v)
            if (Number.isFinite(n)) pricingForm[k] = n
          }
        }
      }
      form.setFieldsValue({
        address: act.address ?? '',
        city: act.city ?? '',
        state: act.state ?? '',
        neighborhood: act.neighborhood ?? '',
        country: act.country ?? '',
        whatsapp: act.whatsapp ?? '',
        tiktok: act.tiktok ?? '',
        facebook: act.facebook ?? '',
        linkedin: act.linkedin ?? '',
        twitter: act.twitter ?? '',
        websites: act.websites ?? '',
        gender: act.gender ?? undefined,
        description: act.description ?? '',
        about_topics: act.about_topics ?? '',
        content_type: act.content_type ?? [],
        pricing: pricingForm,
      })
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [handle, form, canEditProfile, navigate, authLoading])

  useEffect(() => {
    const refs = [firstFieldStep0Ref, firstFieldStep1Ref, firstFieldStep2Ref]
    const el = refs[step]?.current
    if (!el) return
    const focusable = el.querySelector<HTMLElement>('input:not([type="hidden"]), textarea, .ant-select-selector, [role="combobox"]')
    if (focusable && typeof focusable.focus === 'function') focusable.focus()
  }, [step])

  const buildPayload = (values: Record<string, unknown>) => {
    const pricing = values.pricing as Record<string, number | string> | undefined
    const pricingData: PricingData = {}
    if (pricing && typeof pricing === 'object') {
      for (const key of PRICING_FIELD_KEYS) {
        const v = pricing[key]
        if (typeof v === 'number' && Number.isFinite(v)) pricingData[key] = String(v)
        if (typeof v === 'string' && v.trim()) pricingData[key] = v.trim()
      }
    }
    return {
      address: typeof values.address === 'string' ? values.address?.trim() || undefined : undefined,
      city: typeof values.city === 'string' ? values.city?.trim() || undefined : undefined,
      state: typeof values.state === 'string' ? values.state?.trim() || undefined : undefined,
      neighborhood: typeof values.neighborhood === 'string' ? values.neighborhood?.trim() || undefined : undefined,
      country: typeof values.country === 'string' ? values.country?.trim() || undefined : undefined,
      whatsapp: typeof values.whatsapp === 'string' ? values.whatsapp?.trim() || undefined : undefined,
      tiktok: typeof values.tiktok === 'string' ? normalizeUrl(values.tiktok).trim() || undefined : undefined,
      facebook: typeof values.facebook === 'string' ? normalizeUrl(values.facebook).trim() || undefined : undefined,
      linkedin: typeof values.linkedin === 'string' ? normalizeUrl(values.linkedin).trim() || undefined : undefined,
      twitter: typeof values.twitter === 'string' ? normalizeUrl(values.twitter).trim() || undefined : undefined,
      websites: typeof values.websites === 'string' ? values.websites?.trim() || undefined : undefined,
      gender: typeof values.gender === 'string' ? values.gender || undefined : undefined,
      description: typeof values.description === 'string' ? values.description?.trim() || undefined : undefined,
      about_topics: typeof values.about_topics === 'string' ? values.about_topics?.trim() || undefined : undefined,
      content_type: Array.isArray(values.content_type) && values.content_type.length
        ? values.content_type.filter((x): x is string => typeof x === 'string')
        : undefined,
      pricing: Object.keys(pricingData).length ? pricingData : undefined,
    }
  }

  const scrollToFirstError = () => {
    setTimeout(() => {
      const firstError = document.querySelector('.ant-form-item-has-error')
      if (!firstError) return
      const target = firstError.previousElementSibling ?? firstError
      target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
    }, 100)
  }

  const goToNextStep = () => {
    const onError = () => {
      scrollToFirstError()
      Modal.warning({
        title: 'Campos obrigatórios',
        content: 'Preencha os campos obrigatórios para continuar.',
        okText: 'Entendi',
      })
    }
    if (step === 0) {
      form.validateFields(['city', 'state']).then(() => setStep((s) => s + 1)).catch(onError)
    } else if (step === 1) {
      form.validateFields(['whatsapp']).then(() => setStep((s) => s + 1)).catch(onError)
    }
  }

  const onFinish = async (values: Record<string, unknown>) => {
    if (!handle) return
    setSaving(true)
    try {
      await saveProfileActivation(handle, buildPayload(values))
      await refreshUser()
      message.success('Cadastro ativado com sucesso!')
      navigate(`/app/influencer/${encodeURIComponent(handle)}`, { replace: true })
    } catch {
      message.error('Falha ao salvar. Tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  const onSaveDraft = async () => {
    if (!handle) return
    try {
      const values = await form.validateFields().catch(() => form.getFieldsValue())
      setDraftSaving(true)
      await saveProfileActivation(handle, buildPayload(values as Record<string, unknown>))
      await refreshUser()
      message.success('Rascunho salvo.')
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Falha ao salvar rascunho.')
    } finally {
      setDraftSaving(false)
    }
  }

  const fillPricingDefault = () => {
    const current = form.getFieldValue('pricing') || {}
    const next = { ...current }
    for (const key of PRICING_FIELD_KEYS) {
      next[key] = DEFAULT_PRICE_BUCKET
    }
    form.setFieldsValue({ pricing: next })
    message.info('Faixas preenchidas com o padrão (R$ 1.000 – R$ 2.500).')
  }

  const clearPricing = () => {
    form.setFieldsValue({
      pricing: PRICING_FIELD_KEYS.reduce<Record<string, undefined>>((acc, k) => {
        acc[k] = undefined
        return acc
      }, {}),
    })
    message.info('Valores de preço limpos.')
  }

  if (!handle) {
    return (
      <div style={{ padding: 24 }}>
        <Button type="link" icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>
          Voltar
        </Button>
        <Title level={4}>Handle não informado.</Title>
      </div>
    )
  }

  if (authLoading || loading) {
    return (
      <div style={{ textAlign: 'center', padding: 48 }}>
        <Spin size="large" />
      </div>
    )
  }

  const steps = [
    { title: 'Essencial', description: '' },
    { title: 'Redes & Contato', description: '' },
    { title: 'Conteúdo & Valores', description: '' },
  ]

  return (
    <div style={{ minHeight: '100vh' }}>
      <div style={{ margin: '0 auto' }}>
        <Button
          type="link"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate(`/app/influencer/${encodeURIComponent(handle)}`)}
          style={{ marginBottom: 16 }}
        >
          Voltar ao perfil
        </Button>

        <Card
          style={{
            boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          {/* Cabeçalho premium */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 24 }}>
            {profilePic && !profilePicError ? (
              <div style={{ position: 'relative', flexShrink: 0, width: 72, height: 72 }}>
                <img
                  src={profilePic}
                  alt=""
                  onLoad={() => setProfilePicLoading(false)}
                  onError={() => {
                    setProfilePicLoading(false)
                    setProfilePicError(true)
                    if (handle) queueRefreshProfile(handle).catch(() => { })
                  }}
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: '50%',
                    objectFit: 'cover',
                    border: '3px solid #f0f0f0',
                    visibility: profilePicLoading ? 'hidden' : 'visible',
                    position: profilePicLoading ? 'absolute' : 'relative',
                  }}
                />
                {profilePicLoading && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: 72,
                      height: 72,
                      borderRadius: '50%',
                      background: '#f0f0f0',
                      border: '3px solid #f0f0f0',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      zIndex: 1,
                    }}
                  >
                    <Spin size="default" />
                  </div>
                )}
              </div>
            ) : (
              <div
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: '50%',
                  background: '#f0f0f0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <UserOutlined style={{ fontSize: 32, color: '#bfbfbf' }} />
              </div>
            )}
            <div style={{ flex: 1 }}>
              <Title level={4} style={{ margin: 0, fontWeight: 600 }}>
                Finalizar cadastro
              </Title>
              <Text type="secondary" style={{ fontSize: 14 }}>
                @{handle}
                {profileName ? ` · ${profileName}` : ''}
              </Text>

            </div>
          </div>

          <Steps current={step} size="small" style={{ marginBottom: 28 }}>
            {steps.map((s, i) => (
              <Steps.Step key={i} title={s.title} description={s.description} />
            ))}
          </Steps>

          <Form
            form={form}
            layout="vertical"
            onFinish={onFinish}
            onFinishFailed={() => {
              Modal.warning({
                title: 'Campos obrigatórios',
                content: 'Preencha os campos obrigatórios para continuar.',
                okText: 'Entendi',
              })
            }}
            scrollToFirstError
          >
            {/* Passo 1: Essencial */}
            <div ref={firstFieldStep0Ref} style={{ display: step === 0 ? 'block' : 'none' }}>
              <>
                <Form.Item
                  name="gender"
                  label="Gênero"
                  extra="Opcional."
                >
                  <Select placeholder="Selecione (opcional)" allowClear options={GENDER_OPTIONS} />
                </Form.Item>
                <Form.Item
                  name="about_topics"
                  label="Sobre o que você fala"
                  extra="Temas e nichos que você aborda. Ex.: maternidade, moda, viagens."
                >
                  <Input.TextArea
                    placeholder="Ex.: maternidade, moda, viagens, fitness"
                    rows={2}
                    showCount
                    maxLength={500}
                  />
                </Form.Item>
                <Form.Item
                  name="description"
                  label="Descrição sobre você"
                  extra="Sua trajetória e proposta de valor em poucas linhas."
                >
                  <Input.TextArea
                    placeholder="Conte um pouco sobre você e o que você oferece"
                    rows={4}
                    showCount
                    maxLength={2000}
                  />
                </Form.Item>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ margin: '16px 0 12px' }}>
                    Localização
                  </div>
                  <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 13 }}>
                    Cidade e estado ajudam marcas a encontrar você.
                  </Text>
                </div>
                <Row gutter={16}>
                  <Col xs={24} sm={12}>
                    <Form.Item name="city" label="Cidade" rules={[{ required: true, message: 'Informe a cidade' }]}>
                      <Input placeholder="Ex.: São Paulo" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Form.Item name="state" label="Estado (UF)" rules={[{ required: true, message: 'Informe o estado (UF)' }]}>
                      <Input placeholder="Ex.: SP" maxLength={2} />
                    </Form.Item>
                  </Col>
                </Row>
                <Collapse
                  ghost
                  items={[
                    {
                      key: 'address',
                      label: <Text type="secondary">Detalhes avançados (endereço completo)</Text>,
                      children: (
                        <>
                          <Form.Item name="address" label="Endereço completo">
                            <Input placeholder="Rua, número, complemento" />
                          </Form.Item>
                          <Form.Item name="neighborhood" label="Bairro">
                            <Input placeholder="Bairro" />
                          </Form.Item>
                          <Form.Item name="country" label="País">
                            <Input placeholder="País" />
                          </Form.Item>
                        </>
                      ),
                    },
                  ]}
                />
              </>
            </div>

            {/* Passo 2: Redes & Contato */}
            <div ref={firstFieldStep1Ref} style={{ display: step === 1 ? 'block' : 'none' }}>
              <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
                Adicione redes e contato para marcas entrarem em contato. WhatsApp é obrigatório.
              </Text>
              <Row gutter={[16, 0]}>
                <Col xs={24} md={12}>
                  <Form.Item
                    name="whatsapp"
                    label={
                      <Space>
                        <MessageOutlined />
                        WhatsApp
                      </Space>
                    }
                    extra="Ex.: +55 (11) 99999-9999. Use 10 a 13 dígitos (com DDI)."
                    rules={[
                      { required: true, message: 'Informe o WhatsApp' },
                      {
                        validator: (_, v) => {
                          if (!v || !String(v).trim()) return Promise.resolve()
                          const digits = parseWhatsAppDigits(v)
                          if (digits.length < 10 || digits.length > 13) {
                            return Promise.reject(new Error('Use 10 a 13 dígitos (com DDI).'))
                          }
                          return Promise.resolve()
                        },
                      },
                    ]}
                    normalize={(v) => (v ? formatWhatsApp(v) : v)}
                  >
                    <Input placeholder="+55 (11) 99999-9999" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item
                    name="tiktok"
                    label={<Space><LinkOutlined /> TikTok</Space>}
                    normalize={(v) => (v && typeof v === 'string' ? normalizeUrl(v) : v)}
                  >
                    <Input placeholder="https://tiktok.com/@seuuser" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item
                    name="facebook"
                    label={<Space><LinkOutlined /> Facebook</Space>}
                    normalize={(v) => (v && typeof v === 'string' ? normalizeUrl(v) : v)}
                  >
                    <Input placeholder="https://facebook.com/seuperfil" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item
                    name="linkedin"
                    label={<Space><LinkOutlined /> LinkedIn</Space>}
                    normalize={(v) => (v && typeof v === 'string' ? normalizeUrl(v) : v)}
                  >
                    <Input placeholder="https://linkedin.com/in/seuperfil" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item
                    name="twitter"
                    label={<Space><LinkOutlined /> X (Twitter)</Space>}
                    normalize={(v) => (v && typeof v === 'string' ? normalizeUrl(v) : v)}
                  >
                    <Input placeholder="https://x.com/seuuser" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item
                    name="websites"
                    label={<Space><GlobalOutlined /> Websites</Space>}
                    extra="Um ou mais sites, separados por vírgula ou linha."
                  >
                    <Input.TextArea placeholder="https://meusite.com" rows={2} />
                  </Form.Item>
                </Col>
              </Row>
            </div>

            {/* Passo 3: Conteúdo & Valores */}
            <div ref={firstFieldStep2Ref} style={{ display: step === 2 ? 'block' : 'none' }}>
              <>
                <Form.Item
                  name="content_type"
                  label="Tipo de conteúdo"
                  extra="Selecione os tipos que classificam seu conteúdo (ex.: fitness, moda)."
                  rules={[{ type: 'array' as const, min: 1, message: 'Selecione pelo menos um tipo de conteúdo' }]}
                >
                  <Select
                    mode="multiple"
                    placeholder="Ex.: fitness, moda, viagens"
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    options={CONTENT_TYPE_OPTIONS}
                    maxTagCount="responsive"
                  />
                </Form.Item>
                <div>
                  Valores e formatos
                </div>
                <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                  Faixa de preço por formato (apenas para categorização). Você pode pular ou preencher em lote.
                </Text>
                <Space style={{ marginBottom: 16 }}>
                  <Button size="small" onClick={fillPricingDefault}>
                    Preencher com padrão
                  </Button>
                  <Button size="small" onClick={clearPricing}>
                    Limpar
                  </Button>
                </Space>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {PRICING_FIELD_KEYS.map((key) => (
                    <div
                      key={key}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 16,
                        padding: '12px 0',
                        borderBottom: '1px solid #f0f0f0',
                      }}
                    >
                      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                        <div style={{ fontWeight: 500, marginBottom: 2 }}>
                          {PRICING_FIELD_LABELS[key as PricingFieldKey]}
                        </div>
                        <div style={{ fontSize: 12, color: '#8c8c8c' }}>
                          {PRICING_FIELD_HELP[key as PricingFieldKey]}
                        </div>
                      </div>
                      <div style={{ flex: '0 0 220px' }}>
                        <Form.Item name={['pricing', key]} noStyle>
                          <Select
                            placeholder="Faixa"
                            allowClear
                            options={PRICE_OPTIONS}
                            style={{ width: '100%' }}
                          />
                        </Form.Item>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            </div>

            {/* Navegação e ações */}
            <Divider style={{ margin: '24px 0 16px' }} />
            <Space wrap size="middle">
              {step > 0 && (
                <Button onClick={() => setStep((s) => s - 1)}>
                  Voltar
                </Button>
              )}
              {step < 2 && (
                <Button type="primary" onClick={goToNextStep}>
                  Próximo
                </Button>
              )}
              {step === 2 && (
                <>
                  <Button loading={draftSaving} onClick={onSaveDraft}>
                    Salvar rascunho
                  </Button>
                  <Button
                    type="primary"
                    htmlType="submit"
                    icon={<CheckCircleOutlined />}
                    loading={saving}
                    size="large"
                  >
                    Ativar cadastro
                  </Button>
                </>
              )}
            </Space>
          </Form>
        </Card>

        {/* Excluir conta: fora do wizard, o mais sutil possível */}
        <div style={{ textAlign: 'center', marginTop: 32, paddingBottom: 24 }}>
          <button
            type="button"
            onClick={() => {
              Modal.confirm({
                title: isAdm && handle ? 'Excluir conta deste influenciador?' : 'Excluir conta permanentemente?',
                content:
                  isAdm && handle
                    ? `Todos os dados de @${handle} serão removidos (perfil, cadastro, posts). Esta ação não pode ser desfeita.`
                    : 'Todos os seus dados serão removidos (perfil, cadastro, posts). Esta ação não pode ser desfeita.',
                okText: isAdm && handle ? 'Sim, excluir conta' : 'Sim, excluir minha conta',
                okType: 'danger',
                cancelText: 'Cancelar',
                onOk: async () => {
                  setDeleting(true)
                  try {
                    await deleteAccount(isAdm && handle ? handle : undefined)
                    message.success('Conta excluída.')
                    if (isAdm && handle) {
                      navigate('/app', { replace: true })
                    } else {
                      logout()
                      navigate('/login', { replace: true })
                    }
                  } catch (e) {
                    message.error(e instanceof Error ? e.message : 'Falha ao excluir conta')
                  } finally {
                    setDeleting(false)
                  }
                },
              })
            }}
            disabled={deleting}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              fontSize: 12,
              color: '#8c8c8c',
              textDecoration: 'none',
            }}
          >
            {isAdm && handle ? 'Excluir conta do influenciador' : 'Excluir minha conta'}
          </button>
        </div>
      </div>
    </div >
  )
}
