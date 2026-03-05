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
  Steps,
  Space,
  Divider,
  Radio,
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
import { fetchAddressByCep } from '../utils/viaCep'
import { CONTENT_TYPE_OPTIONS } from '../constants/contentTypes'
import {
  PRICING_FIELD_KEYS,
  getSuggestedPricingFromFollowers,
  type PricingFieldKey,
} from '../constants/pricingBuckets'
import type { ProfileItem } from '../api'
import { useAuth } from '../contexts/AuthContext'

const { Title, Text } = Typography

const GENDER_OPTIONS = [
  { value: 'feminino', label: 'Feminino' },
  { value: 'masculino', label: 'Masculino' },
  { value: 'nao_binario', label: 'Não binário' },
  { value: 'outro', label: 'Outro' },
  { value: 'prefiro_nao_dizer', label: 'Prefiro não dizer' },
]

const ACTIVATE_DRAFT_KEY = (h: string) => `activate_draft_${h}`

function parseStepFromHash(): number {
  const m = window.location.hash.match(/^#step-(\d)$/)
  const n = m ? parseInt(m[1], 10) : 0
  return Number.isFinite(n) && n >= 0 && n <= 2 ? n : 0
}

function getFollowersFromProfile(profile: ProfileItem | null): number {
  if (!profile) return 0
  if (typeof profile.followers_count === 'number' && profile.followers_count >= 0) return profile.followers_count
  const userData = profile?.data?.user as { follower_count?: number } | undefined
  return typeof userData?.follower_count === 'number' ? userData.follower_count : 0
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
  const [deleting, setDeleting] = useState(false)
  const [step, setStep] = useState(parseStepFromHash)
  const saveDraftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const firstFieldStep0Ref = useRef<HTMLDivElement>(null)
  const firstFieldStep1Ref = useRef<HTMLDivElement>(null)
  const firstFieldStep2Ref = useRef<HTMLDivElement>(null)
  const [profileName, setProfileName] = useState<string | null>(null)
  const [profilePic, setProfilePic] = useState<string | undefined>(undefined)
  const [profilePicError, setProfilePicError] = useState(false)
  const [profilePicLoading, setProfilePicLoading] = useState(false)
  const [cepLoading, setCepLoading] = useState(false)

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
      // Se não tem preços salvos, sugere faixas com base nos seguidores do perfil (valores começam baixos).
      const hasAnyPricing = Object.keys(pricingForm).some((k) => pricingForm[k] != null)
      if (!hasAnyPricing && profile) {
        const followers = getFollowersFromProfile(profile)
        const suggested = getSuggestedPricingFromFollowers(followers)
        for (const k of PRICING_FIELD_KEYS) {
          const v = suggested[k as PricingFieldKey]
          if (v !== undefined) pricingForm[k] = v
        }
      }
      const neighborhoodsList =
        act.neighborhood?.split(',').map((s) => s.trim()).filter(Boolean) ?? []
      const profileBio =
        (profile as ProfileItem)?.biography ??
        (profile?.data?.user as { biography?: string } | undefined)?.biography
      const suggestedBio =
        typeof profileBio === 'string' && profileBio.trim() ? profileBio.trim() : ''
      const formValuesFromAct = {
        address: act.address ?? '',
        zip_code: act.zip_code ?? '',
        city: act.city ?? '',
        state: act.state ?? '',
        neighborhoods: neighborhoodsList,
        informar_endereco_completo: act.allow_gifts,
        whatsapp: act.whatsapp ?? '',
        tiktok: act.tiktok ?? '',
        facebook: act.facebook ?? '',
        linkedin: act.linkedin ?? '',
        twitter: act.twitter ?? '',
        websites: act.websites ?? '',
        gender: act.gender ?? undefined,
        description: act.description?.trim() || suggestedBio,
        content_type: act.content_type ?? [],
        pricing: pricingForm,
      }
      let valuesToSet = formValuesFromAct
      try {
        const raw = localStorage.getItem(ACTIVATE_DRAFT_KEY(handle))
        if (raw) {
          const parsed = JSON.parse(raw) as Record<string, unknown> | null
          if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
            valuesToSet = { ...formValuesFromAct, ...parsed }
          }
        }
      } catch {
        // ignora rascunho inválido
      }
      // Se a descrição ficou vazia (ex.: rascunho com ""), preenche com a bio do perfil como sugestão
      const desc = valuesToSet.description
      if ((!desc || typeof desc !== 'string' || !desc.trim()) && suggestedBio) {
        valuesToSet = { ...valuesToSet, description: suggestedBio }
      }
      form.setFieldsValue(valuesToSet)
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [handle, form, canEditProfile, navigate, authLoading])

  useEffect(() => {
    window.location.hash = `#step-${step}`
  }, [step])

  useEffect(() => {
    const onHashChange = () => setStep(parseStepFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    return () => {
      if (saveDraftTimerRef.current) {
        clearTimeout(saveDraftTimerRef.current)
        saveDraftTimerRef.current = null
      }
    }
  }, [])

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
    const neighborhoodsArr = Array.isArray(values.neighborhoods)
      ? (values.neighborhoods as string[]).map((s) => String(s).trim()).filter(Boolean)
      : []
    const neighborhoodStr =
      neighborhoodsArr.length > 0 ? neighborhoodsArr.join(', ') : undefined
    return {
      address: values.informar_endereco_completo === true && typeof values.address === 'string' ? values.address?.trim() || undefined : undefined,
      zip_code: typeof values.zip_code === 'string' ? values.zip_code?.trim() || undefined : undefined,
      city: typeof values.city === 'string' ? values.city?.trim() || undefined : undefined,
      state: typeof values.state === 'string' ? values.state?.trim() || undefined : undefined,
      neighborhood: neighborhoodStr,
      country: undefined,
      allow_gifts: values.informar_endereco_completo === true,
      whatsapp: typeof values.whatsapp === 'string' ? values.whatsapp?.trim() || undefined : undefined,
      tiktok: typeof values.tiktok === 'string' ? normalizeUrl(values.tiktok).trim() || undefined : undefined,
      facebook: typeof values.facebook === 'string' ? normalizeUrl(values.facebook).trim() || undefined : undefined,
      linkedin: typeof values.linkedin === 'string' ? normalizeUrl(values.linkedin).trim() || undefined : undefined,
      twitter: typeof values.twitter === 'string' ? normalizeUrl(values.twitter).trim() || undefined : undefined,
      websites: typeof values.websites === 'string' ? values.websites?.trim() || undefined : undefined,
      gender: typeof values.gender === 'string' ? values.gender || undefined : undefined,
      description: typeof values.description === 'string' ? values.description?.trim() || undefined : undefined,
      content_type: Array.isArray(values.content_type) && values.content_type.length
        ? values.content_type.filter((x): x is string => typeof x === 'string')
        : undefined,
      pricing: Object.keys(pricingData).length ? pricingData : undefined,
    }
  }

  const informarEnderecoCompleto = Form.useWatch('informar_endereco_completo', form)

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
    }
    if (step === 0) {
      form.validateFields(['gender', 'content_type', 'description']).then(() => setStep((s) => s + 1)).catch(onError)
    } else if (step === 1) {
      const informar = form.getFieldValue('informar_endereco_completo')
      const address = form.getFieldValue('address')
      if (informar === true && (!address || !String(address).trim())) {
        form.setFields([{ name: 'address', errors: ['Informe o endereço completo'] }])
        scrollToFirstError()
        return
      }
      form.validateFields(['zip_code', 'informar_endereco_completo']).then(() => setStep((s) => s + 1)).catch(onError)
    } else if (step === 2) {
      form.validateFields(['whatsapp']).then(() => setStep((s) => s + 1)).catch(onError)
    }
  }

  const onFinish = async (values: Record<string, unknown>) => {
    if (!handle) return
    setSaving(true)
    try {
      await saveProfileActivation(handle, buildPayload(values))
      await refreshUser()
      try {
        localStorage.removeItem(ACTIVATE_DRAFT_KEY(handle))
      } catch {
        // ignora falha ao limpar rascunho
      }
      message.success('Cadastro ativado com sucesso!')
      navigate(`/app/influencer/${encodeURIComponent(handle)}/media-kit`, { replace: true })
    } catch {
      message.error('Falha ao salvar. Tente novamente.')
    } finally {
      setSaving(false)
    }
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
    { title: 'Localização', description: '' },
    { title: 'Contato', description: '' },
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
            boxShadow: 'var(--app-shadow-lg)',
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
                    border: '3px solid var(--app-placeholder-bg)',
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
                      background: 'var(--app-placeholder-bg)',
                      border: '3px solid var(--app-placeholder-bg)',
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
                  background: 'var(--app-placeholder-bg)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <UserOutlined style={{ fontSize: 32, color: 'var(--app-text-tertiary)' }} />
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
            onValuesChange={() => {
              if (!handle) return
              if (saveDraftTimerRef.current) clearTimeout(saveDraftTimerRef.current)
              saveDraftTimerRef.current = setTimeout(() => {
                try {
                  const values = form.getFieldsValue()
                  localStorage.setItem(ACTIVATE_DRAFT_KEY(handle), JSON.stringify(values))
                } catch {
                  // ignora falha ao salvar rascunho
                }
                saveDraftTimerRef.current = null
              }, 500)
            }}
            onFinish={onFinish}
            onFinishFailed={() => {
              setTimeout(() => {
                window.scrollBy(0, -100)
              }, 100)
            }}
            scrollToFirstError
          >
            {/* Passo 0: Essencial */}
            <div ref={firstFieldStep0Ref} style={{ display: step === 0 ? 'block' : 'none' }}>
              <>
                <Form.Item
                  name="gender"
                  label="Gênero"
                  rules={[{ required: true, message: 'Informe o gênero' }]}
                >
                  <Select placeholder="Selecione" allowClear options={GENDER_OPTIONS} />
                </Form.Item>
                <Form.Item
                  name="content_type"
                  label="Tipo de conteúdo"
                  required
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
                <Form.Item
                  name="description"
                  label="Descrição sobre você"
                  required
                  extra="Sua trajetória e proposta de valor em poucas linhas (mínimo 100 caracteres)."
                  rules={[
                    { required: true, message: 'Informe a descrição sobre você' },
                    {
                      validator: (_, v) => {
                        if (!v || typeof v !== 'string') return Promise.reject(new Error('Mínimo 100 caracteres'))
                        if (v.trim().length < 100) return Promise.reject(new Error('Mínimo 100 caracteres'))
                        return Promise.resolve()
                      },
                    },
                  ]}
                >
                  <Input.TextArea
                    placeholder="Conte um pouco sobre você e o que você oferece"
                    rows={4}
                    showCount
                    maxLength={2000}
                  />
                </Form.Item>

              </>
            </div>

            {/* Passo 1: Localização */}
            <div ref={firstFieldStep1Ref} style={{ display: step === 1 ? 'block' : 'none' }}>
              <>
                <Text type="secondary" style={{ display: 'block', marginBottom: 16, fontSize: 13 }}>
                  Preencha suas informações para que marcas próximas a você possam te contratar.
                </Text>
                <Row gutter={16}>
                  <Col xs={24} sm={12}>
                    <Form.Item
                      name="zip_code"
                      label="CEP"
                      rules={[
                        { required: true, message: 'Informe o CEP' },
                        {
                          validator: (_, v) => {
                            if (!v || !String(v).trim()) return Promise.resolve()
                            const digits = String(v).replace(/\D/g, '')
                            if (digits.length !== 8) {
                              return Promise.reject(new Error('CEP deve ter 8 dígitos'))
                            }
                            return Promise.resolve()
                          },
                        },
                      ]}
                    >
                      <Input
                        placeholder="Ex.: 01310-100"
                        maxLength={9}
                        onChange={(e) => {
                          const cep = e.target.value?.trim()
                          if (!cep || cep.replace(/\D/g, '').length !== 8) return
                          setCepLoading(true)
                          fetchAddressByCep(cep).then((data) => {
                            if (!data) return
                            form.setFieldsValue({
                              address: data.logradouro ?? form.getFieldValue('address'),
                              city: data.localidade ?? form.getFieldValue('city'),
                              state: data.uf ?? form.getFieldValue('state'),
                            })
                            const bairro = data.bairro?.trim()
                            if (bairro) {
                              const current = (form.getFieldValue('neighborhoods') as string[]) ?? []
                              const lower = bairro.toLowerCase()
                              if (!current.some((n) => n.trim().toLowerCase() === lower)) {
                                form.setFieldsValue({ neighborhoods: [...current, bairro] })
                              }
                            }
                          }).finally(() => setCepLoading(false))
                        }}
                        suffix={cepLoading ? <Spin size="small" /> : undefined}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Form.Item name="city" label="Cidade">
                      <Input placeholder="Preenchido pelo CEP" readOnly />
                    </Form.Item>
                  </Col>
                </Row>
                <Row gutter={16}>
                  <Col xs={24} sm={12}>
                    <Form.Item name="state" label="Estado (UF)">
                      <Input placeholder="Preenchido pelo CEP" maxLength={2} readOnly />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Form.Item name="neighborhoods" label="Bairro">
                      <Select
                        mode="tags"
                        placeholder="Preenchido pelo CEP"
                        disabled
                        maxTagCount="responsive"
                        style={{ width: '100%' }}
                        options={[]}
                      />
                    </Form.Item>
                  </Col>
                </Row>
                <Row gutter={16} align="middle">
                  <Col flex="0 0 auto" style={{ fontSize: 45, marginTop: -30, lineHeight: 1 }}>
                    🎁
                  </Col>
                  <Col flex="1" style={{ minWidth: 0 }}>
                    <Form.Item
                      name="informar_endereco_completo"
                      label="Gostaria de receber brindes e amostras de empresas para influenciadores em seu endereço?"
                      rules={[{ required: true, message: 'Informe se deseja receber brindes em seu endereço' }]}
                    >
                      <Radio.Group>
                        <Radio value={true}>Sim</Radio>
                        <Radio value={false}>Não</Radio>
                      </Radio.Group>
                    </Form.Item>
                  </Col>
                </Row>
                {informarEnderecoCompleto === true && (
                  <>
                    <Form.Item
                      name="address"
                      label="Endereço completo"
                      required={informarEnderecoCompleto === true}
                      rules={[
                        {
                          validator: (_, v) => {
                            if (form.getFieldValue('informar_endereco_completo') !== true) return Promise.resolve()
                            if (!v || !String(v).trim()) return Promise.reject(new Error('Informe o endereço completo'))
                            return Promise.resolve()
                          },
                        },
                      ]}
                    >
                      <Input placeholder="Rua, número, complemento" />
                    </Form.Item>
                  </>
                )}
              </>
            </div>

            {/* Passo 2: Redes & Contato */}
            <div ref={firstFieldStep2Ref} style={{ display: step === 2 ? 'block' : 'none' }}>
              <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
                Adicione suas redes sociais e contatos para que marcas possam falar com você
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
                <Button
                  type="primary"
                  htmlType="submit"
                  icon={<CheckCircleOutlined />}
                  loading={saving}
                  size="large"
                >
                  Ativar cadastro
                </Button>
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
              color: 'var(--app-text-tertiary)',
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
