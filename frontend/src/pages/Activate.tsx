import { useEffect, useState } from 'react'
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
} from 'antd'
import { ArrowLeftOutlined, CheckCircleOutlined, UserOutlined, DeleteOutlined } from '@ant-design/icons'
import { fetchProfile, fetchProfileActivation, saveProfileActivation, deleteAccount, getProfilePicUrl, proxyImageUrl, queueRefreshProfile, type ProfileActivation, type PricingData } from '../api'
import { CONTENT_TYPE_OPTIONS } from '../constants/contentTypes'
import { PRICE_BUCKETS, PRICING_FIELD_KEYS, PRICING_FIELD_LABELS, type PricingFieldKey } from '../constants/pricingBuckets'
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

export default function Activate() {
  const { handle } = useParams<{ handle: string }>()
  const navigate = useNavigate()
  const { canEditProfile, logout } = useAuth()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [profileName, setProfileName] = useState<string | null>(null)
  const [profilePic, setProfilePic] = useState<string | undefined>(undefined)
  const [profilePicError, setProfilePicError] = useState(false)

  useEffect(() => {
    if (!handle) return
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
        setProfilePic(pic ? proxyImageUrl(pic) : undefined)
      }
      const act = activation as ProfileActivation
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
    return () => { cancelled = true }
  }, [handle, form])

  const onFinish = async (values: Record<string, unknown>) => {
    if (!handle) return
    setSaving(true)
    try {
      const pricing = values.pricing as Record<string, number | string> | undefined
      const pricingData: PricingData = {}
      if (pricing && typeof pricing === 'object') {
        for (const key of PRICING_FIELD_KEYS) {
          const v = pricing[key]
          if (typeof v === 'number' && Number.isFinite(v)) pricingData[key] = String(v)
          if (typeof v === 'string' && v.trim()) pricingData[key] = v.trim()
        }
      }
      await saveProfileActivation(handle, {
        address: typeof values.address === 'string' ? values.address?.trim() || undefined : undefined,
        city: typeof values.city === 'string' ? values.city?.trim() || undefined : undefined,
        state: typeof values.state === 'string' ? values.state?.trim() || undefined : undefined,
        neighborhood: typeof values.neighborhood === 'string' ? values.neighborhood?.trim() || undefined : undefined,
        country: typeof values.country === 'string' ? values.country?.trim() || undefined : undefined,
        whatsapp: typeof values.whatsapp === 'string' ? values.whatsapp?.trim() || undefined : undefined,
        tiktok: typeof values.tiktok === 'string' ? values.tiktok?.trim() || undefined : undefined,
        facebook: typeof values.facebook === 'string' ? values.facebook?.trim() || undefined : undefined,
        linkedin: typeof values.linkedin === 'string' ? values.linkedin?.trim() || undefined : undefined,
        twitter: typeof values.twitter === 'string' ? values.twitter?.trim() || undefined : undefined,
        websites: typeof values.websites === 'string' ? values.websites?.trim() || undefined : undefined,
        gender: typeof values.gender === 'string' ? values.gender || undefined : undefined,
        description: typeof values.description === 'string' ? values.description?.trim() || undefined : undefined,
        about_topics: typeof values.about_topics === 'string' ? values.about_topics?.trim() || undefined : undefined,
        content_type: Array.isArray(values.content_type) && values.content_type.length
          ? values.content_type.filter((x): x is string => typeof x === 'string')
          : undefined,
        pricing: Object.keys(pricingData).length ? pricingData : undefined,
      })
      message.success('Cadastro ativado com sucesso!')
      navigate('/app/projects', { replace: true })
    } catch {
      message.error('Falha ao salvar. Tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  if (!handle) {
    return (
      <div>
        <Button type="link" icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>
          Voltar
        </Button>
        <Title level={4}>Handle não informado.</Title>
      </div>
    )
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 48 }}>
        <Spin size="large" />
      </div>
    )
  }

  return (
    <div>
      <Button type="link" icon={<ArrowLeftOutlined />} onClick={() => navigate(`/app/influencer/${encodeURIComponent(handle)}`)} style={{ marginBottom: 16 }}>
        Voltar ao perfil
      </Button>

      <Card style={{ maxWidth: 720, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
          {(profilePic && !profilePicError) ? (
            <img
              src={profilePic}
              alt=""
              onError={() => {
              setProfilePicError(true)
              if (handle) queueRefreshProfile(handle).catch(() => {})
            }}
              style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover' }}
            />
          ) : (
            <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--app-border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <UserOutlined style={{ fontSize: 28, color: 'var(--app-text-tertiary)' }} />
            </div>
          )}
          <div>
            <Title level={4} style={{ margin: 0 }}>
              Finalizar cadastro
            </Title>
            <Text type="secondary">@{handle}{profileName ? ` · ${profileName}` : ''}</Text>
          </div>
        </div>

        <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
          Preencha os dados abaixo para ativar seu cadastro na plataforma.
        </Text>

        <Form
          form={form}
          layout="vertical"
          onFinish={onFinish}
        >
          <Title level={5} style={{ marginTop: 0, marginBottom: 16 }}>Endereço</Title>
          <Form.Item name="address" label="Endereço completo">
            <Input placeholder="Rua, número, complemento" />
          </Form.Item>
          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item name="neighborhood" label="Bairro">
                <Input placeholder="Bairro" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="city" label="Cidade">
                <Input placeholder="Cidade" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item name="state" label="Estado">
                <Input placeholder="Estado (UF)" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="country" label="País">
                <Input placeholder="País" />
              </Form.Item>
            </Col>
          </Row>

          <Title level={5} style={{ marginTop: 24, marginBottom: 16 }}>Contato e redes</Title>
          <Form.Item name="whatsapp" label="WhatsApp">
            <Input placeholder="Número com DDI (ex: +55 11 99999-9999)" />
          </Form.Item>
          <Form.Item name="tiktok" label="TikTok">
            <Input placeholder="URL do perfil no TikTok" />
          </Form.Item>
          <Form.Item name="facebook" label="Facebook">
            <Input placeholder="URL do perfil no Facebook" />
          </Form.Item>
          <Form.Item name="linkedin" label="LinkedIn">
            <Input placeholder="URL do perfil no LinkedIn" />
          </Form.Item>
          <Form.Item name="twitter" label="X (Twitter)">
            <Input placeholder="URL do perfil no X / Twitter" />
          </Form.Item>
          <Form.Item name="websites" label="Websites">
            <Input.TextArea
              placeholder="Um ou mais sites (separados por vírgula ou linha)"
              rows={3}
            />
          </Form.Item>

          <Title level={5} style={{ marginTop: 24, marginBottom: 16 }}>Perfil</Title>
          <Form.Item name="content_type" label="Tipo de conteúdo">
            <Select
              mode="multiple"
              placeholder="Selecione os tipos que classificam seu conteúdo (ex.: fitness, moda)"
              allowClear
              showSearch
              optionFilterProp="label"
              options={CONTENT_TYPE_OPTIONS}
              maxTagCount="responsive"
            />
          </Form.Item>
          <Form.Item name="gender" label="Gênero">
            <Select placeholder="Selecione" allowClear options={GENDER_OPTIONS} />
          </Form.Item>
          <Form.Item name="description" label="Descrição sobre você">
            <Input.TextArea placeholder="Texto livre sobre você, trajetória, proposta de valor" rows={4} />
          </Form.Item>
          <Form.Item name="about_topics" label="Sobre o que você fala">
            <Input.TextArea placeholder="Temas, nichos, assuntos que você aborda (ex.: maternidade, moda, viagens)" rows={3} />
          </Form.Item>

          <Title level={5} style={{ marginTop: 24, marginBottom: 16 }}>Valores e formatos</Title>
          <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
            Selecione a faixa de preço para cada formato (apenas para categorização).
          </Text>
          {PRICING_FIELD_KEYS.map((key) => (
            <Form.Item key={key} name={['pricing', key]} label={PRICING_FIELD_LABELS[key as PricingFieldKey]}>
              <Select
                placeholder="Selecione a faixa"
                allowClear
                options={PRICE_OPTIONS}
                style={{ width: '100%' }}
              />
            </Form.Item>
          ))}

          <Form.Item style={{ marginTop: 24, marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" icon={<CheckCircleOutlined />} loading={saving} size="large">
              Ativar cadastro
            </Button>
          </Form.Item>

          <Collapse
            ghost
            defaultActiveKey={[]}
            style={{ marginTop: 32, border: 'none', background: 'transparent' }}
            items={[{
              key: 'delete-account',
              label: <span style={{ fontSize: 12, color: 'var(--app-text-tertiary)' }}>Excluir minha conta</span>,
              children: (
                <>
                  <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 13 }}>
                    Em conformidade com a LGPD, você pode excluir permanentemente sua conta e todos os dados armazenados (perfil, cadastro de ativação, posts). Esta ação não pode ser desfeita.
                  </Text>
                  <Button
                    type="primary"
                    danger
                    size="small"
                    icon={<DeleteOutlined />}
                    loading={deleting}
                    onClick={() => {
                      Modal.confirm({
                        title: 'Excluir conta permanentemente?',
                        content: 'Todos os seus dados serão removidos (cadastro, perfil, posts). Você não poderá acessar a plataforma com esta conta. Esta ação não pode ser desfeita.',
                        okText: 'Sim, excluir minha conta',
                        okType: 'danger',
                        cancelText: 'Cancelar',
                        onOk: async () => {
                          setDeleting(true)
                          try {
                            await deleteAccount()
                            message.success('Conta excluída.')
                            logout()
                            navigate('/login', { replace: true })
                          } catch (e) {
                            message.error(e instanceof Error ? e.message : 'Falha ao excluir conta')
                          } finally {
                            setDeleting(false)
                          }
                        },
                      })
                    }}
                  >
                    Excluir minha conta
                  </Button>
                </>
              ),
              style: { border: 'none', paddingLeft: 0, paddingRight: 0 },
            }]}
          />
        </Form>
      </Card>
    </div>
  )
}
