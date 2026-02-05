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
} from 'antd'
import { ArrowLeftOutlined, CheckCircleOutlined } from '@ant-design/icons'
import { fetchProfile, fetchProfileActivation, saveProfileActivation, getProfilePicUrl, proxyImageUrl, type ProfileActivation, type PricingData } from '../api'
import { CONTENT_TYPE_OPTIONS } from '../constants/contentTypes'

const { Title, Text } = Typography

const GENDER_OPTIONS = [
  { value: 'feminino', label: 'Feminino' },
  { value: 'masculino', label: 'Masculino' },
  { value: 'nao_binario', label: 'Não binário' },
  { value: 'outro', label: 'Outro' },
  { value: 'prefiro_nao_dizer', label: 'Prefiro não dizer' },
]

const PRICING_FIELDS: { key: keyof PricingData; label: string; placeholder: string }[] = [
  { key: 'post_unique', label: '1️⃣ Post único (publipost)', placeholder: 'Foto, vídeo ou carrossel. Valores médios: Micro R$300–R$2.000, Médio R$2.000–R$15.000, Grande R$15.000+' },
  { key: 'stories', label: '2️⃣ Stories', placeholder: 'Pacotes (3, 5 ou 7). Micro R$150–R$800, Médio R$800–R$5.000' },
  { key: 'package_monthly', label: '3️⃣ Pacote mensal', placeholder: 'X posts/mês + stories. Micro R$1.000–R$5.000/mês, Médio R$5.000–R$30.000/mês' },
  { key: 'commission', label: '4️⃣ Comissão / afiliado', placeholder: '5% a 30%. Fixo + comissão' },
  { key: 'permuta', label: '5️⃣ Permuta', placeholder: 'Produto ou serviço em troca de divulgação' },
  { key: 'image_rights', label: '6️⃣ Uso de imagem (direitos)', placeholder: '+30% a +200% do valor do post. Repost em anúncios, site, mídia paga' },
  { key: 'content_delivery', label: '7️⃣ Entrega de conteúdo (sem postar)', placeholder: 'Vídeos, fotos, UGC. A marca publica no próprio perfil' },
  { key: 'launch', label: '8️⃣ Lançamento / campanha', placeholder: 'Série de conteúdos, datas específicas. Valor fechado (ex: R$10k, R$30k)' },
]

export default function Activate() {
  const { handle } = useParams<{ handle: string }>()
  const navigate = useNavigate()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [profileName, setProfileName] = useState<string | null>(null)
  const [profilePic, setProfilePic] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (!handle) return
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
        pricing: act.pricing ?? {},
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
      const pricing = values.pricing as Record<string, string> | undefined
      const pricingData: PricingData = {}
      if (pricing && typeof pricing === 'object') {
        for (const key of PRICING_FIELDS.map((f) => f.key)) {
          const v = pricing[key]
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
      <Button type="link" icon={<ArrowLeftOutlined />} onClick={() => navigate(`/influencer/${encodeURIComponent(handle)}`)} style={{ marginBottom: 16 }}>
        Voltar ao perfil
      </Button>

      <Card style={{ maxWidth: 720, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
          {profilePic && (
            <img
              src={profilePic}
              alt=""
              style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover' }}
            />
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
            Descreva valores, faixas ou condições para cada formato (pode usar os placeholders como referência).
          </Text>
          {PRICING_FIELDS.map(({ key, label, placeholder }) => (
            <Form.Item key={key} name={['pricing', key]} label={label}>
              <Input.TextArea placeholder={placeholder} rows={2} />
            </Form.Item>
          ))}

          <Form.Item style={{ marginTop: 24, marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" icon={<CheckCircleOutlined />} loading={saving} size="large">
              Ativar cadastro
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  )
}
