/**
 * Modal ao escolher um criador: formulário de solicitação de contratação via WhatsApp da agência.
 */
import { useEffect, useRef, useState } from 'react'
import { Modal, Button, Form, Input } from 'antd'
import { WhatsAppOutlined, UserOutlined } from '@ant-design/icons'
import ProfileAvatar from '../ProfileAvatar'
import InfluencerDetailModal from '../InfluencerDetailModal/InfluencerDetailModal'
import BuscaInfluencerPlansModal from '../BuscaInfluencerPlansModal/BuscaInfluencerPlansModal'
import { trackPlansIntent } from '../../utils/metaPixelFunnel'
import { fetchMySubscription, proxyImageUrl } from '../../api'
import { useAuth } from '../../contexts/AuthContext'
import { AGENCY_WHATSAPP_DIGITS } from '../../constants/agencyContact'
import { useLockPageScroll } from '../../utils/useLockPageScroll'
import './InfluencerConnectModal.css'

export type InfluencerConnectSnapshot = {
  displayName?: string
  profilePicUrl?: string
  stableProfilePicUrl?: string
  followersCount?: number
  /** Taxa de engajamento média (%), quando disponível na listagem. */
  engagementRatePercent?: number
  postsPerWeek?: number
  /** Resumo / descrição gerada pela classificação LLM. */
  llmDescription?: string
  /** Texto completo quando `llmDescription` está truncado na origem. */
  llmDescriptionTooltip?: string
}

type HireFormValues = {
  brandName: string
  brandWhatsapp: string
  jobDescription: string
}

const PROFILE_AVATAR_SIZE = 88

function formatFollowersShort(n: number | undefined | null): string | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M seguidores`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k seguidores`
  return `${n.toLocaleString('pt-BR')} seguidores`
}

function formatPostsPerWeekShort(n: number | undefined | null): string | null {
  if (n == null || !Number.isFinite(n)) return null
  const rounded = Math.round(n * 10) / 10
  return rounded.toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: rounded % 1 === 0 ? 0 : 1 })
}

function parseWhatsAppDigits(value: string | undefined): string {
  if (!value || typeof value !== 'string') return ''
  return value.replace(/\D/g, '')
}

function formatWhatsAppInput(value: string | undefined): string {
  if (!value || typeof value !== 'string') return ''
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 2) return digits ? `+${digits}` : ''
  if (digits.length <= 4) return `+${digits.slice(0, 2)} (${digits.slice(2)}`
  if (digits.length <= 9) return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4)}`
  return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9, 13)}`
}

function buildAgencyHireWhatsAppUrl(
  handle: string,
  displayName: string | undefined,
  { brandName, brandWhatsapp, jobDescription }: HireFormValues,
): string {
  const cleanHandle = handle.replace(/^@/, '')
  const brandDigits = parseWhatsAppDigits(brandWhatsapp)
  const creatorLabel = displayName?.trim() && displayName.trim() !== cleanHandle
    ? `${displayName.trim()} (@${cleanHandle})`
    : `@${cleanHandle}`
  const lines = [
    'Olá! Quero contratar um criador pela Busca Influencer.',
    '',
    `Criador: ${creatorLabel}`,
    `Marca: ${brandName.trim()}`,
    brandDigits ? `Meu WhatsApp: +${brandDigits}` : '',
    '',
    'Job:',
    jobDescription.trim(),
  ].filter(Boolean)
  return `https://wa.me/${AGENCY_WHATSAPP_DIGITS}?text=${encodeURIComponent(lines.join('\n'))}`
}

export type InfluencerConnectModalProps = {
  open: boolean
  onClose: () => void
  handle: string
  snapshot?: InfluencerConnectSnapshot | null
  /** Campanha atual (UUID); omitir na busca global (`all`) para carregar o perfil público da API. */
  campaignId?: string | null
}

export default function InfluencerConnectModal({
  open,
  onClose,
  handle,
  snapshot,
  campaignId = null,
}: InfluencerConnectModalProps) {
  const { user, isAdm } = useAuth()
  const [form] = Form.useForm<HireFormValues>()
  const [plansModalOpen, setPlansModalOpen] = useState(false)
  const [fullProfileLoading, setFullProfileLoading] = useState(false)
  const [profileDetailOpen, setProfileDetailOpen] = useState(false)
  useLockPageScroll(open)

  const wasOpenRef = useRef(false)
  useEffect(() => {
    if (open) {
      wasOpenRef.current = true
      return
    }
    if (wasOpenRef.current) {
      form.resetFields()
      wasOpenRef.current = false
    }
    setPlansModalOpen(false)
    setFullProfileLoading(false)
    setProfileDetailOpen(false)
  }, [open, form])

  const llmDescription = snapshot?.llmDescription?.trim() ?? ''
  const llmDescriptionTooltip = snapshot?.llmDescriptionTooltip?.trim()
  const rawPic = snapshot?.profilePicUrl
  const pic = rawPic ? (proxyImageUrl(rawPic) ?? rawPic) : undefined
  const followersLine = formatFollowersShort(snapshot?.followersCount)
  const ppw = snapshot?.postsPerWeek
  const postsLine =
    typeof ppw === 'number' && Number.isFinite(ppw)
      ? `${formatPostsPerWeekShort(ppw)} posts/sem`
      : null
  const statsBits = [followersLine, postsLine].filter(Boolean)
  const statsLine = statsBits.length ? statsBits.join(' · ') : null

  const openFullProfile = () => {
    const h = handle.replace(/^@/, '').trim()
    if (!h) return
    setProfileDetailOpen(true)
  }

  const onViewFullProfileClick = () => {
    if (isAdm) {
      openFullProfile()
      return
    }
    if (!user) {
      trackPlansIntent('modal_open', { source: 'connect_modal_guest' })
      setPlansModalOpen(true)
      return
    }
    setFullProfileLoading(true)
    void fetchMySubscription()
      .then((sub) => {
        if (sub.active) openFullProfile()
        else {
          trackPlansIntent('modal_open', { source: 'connect_modal_no_subscription' })
          setPlansModalOpen(true)
        }
      })
      .catch(() => {
        trackPlansIntent('modal_open', { source: 'connect_modal_error' })
        setPlansModalOpen(true)
      })
      .finally(() => setFullProfileLoading(false))
  }

  const onSubmit = (values: HireFormValues) => {
    const url = buildAgencyHireWhatsAppUrl(handle, snapshot?.displayName, values)
    window.open(url, '_blank', 'noopener,noreferrer')
    onClose()
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      centered
      width={Math.min(760, typeof window !== 'undefined' ? window.innerWidth - 32 : 760)}
      destroyOnHidden
      wrapClassName="influencer-connect-modal"
      styles={{ mask: { backdropFilter: 'blur(4px)' } }}
    >
      <div className="influencer-connect-modal__body">
        <div className="influencer-connect-modal__layout">
          <div className="influencer-connect-modal__info">
            <div className="influencer-connect-modal__eyebrow">Contratar criador</div>

            <div className="influencer-connect-modal__profile-card">
              <div className="influencer-connect-modal__head">
                <div className="influencer-connect-modal__avatar-wrap">
                  <ProfileAvatar
                    src={pic}
                    stableBackgroundUrl={snapshot?.stableProfilePicUrl}
                    handle={handle}
                    size={PROFILE_AVATAR_SIZE}
                    border="2px solid rgba(104, 39, 143, 0.12)"
                    shadow="0 4px 16px rgba(0,0,0,0.08)"
                    fallbackIconSize={36}
                  />
                </div>
                <div className="influencer-connect-modal__title-block">
                  {llmDescription ? (
                    <p
                      className="influencer-connect-modal__llm-desc"
                      title={llmDescriptionTooltip && llmDescriptionTooltip !== llmDescription ? llmDescriptionTooltip : undefined}
                    >
                      {llmDescription}
                    </p>
                  ) : (
                    <p className="influencer-connect-modal__llm-desc influencer-connect-modal__llm-desc--muted">
                      Análise automática deste perfil ainda não disponível.
                    </p>
                  )}
                  {statsLine ? <div className="influencer-connect-modal__stats">{statsLine}</div> : null}
                  <Button
                    type="default"
                    size="small"
                    icon={<UserOutlined />}
                    className="influencer-connect-modal__btn-profile"
                    loading={fullProfileLoading}
                    onClick={onViewFullProfileClick}
                  >
                    Ver perfil completo
                  </Button>
                </div>
              </div>
            </div>

            <p className="influencer-connect-modal__hook">
              Preencha os dados da sua marca e descreva o job. Abrimos o WhatsApp da Busca Influencer para você finalizar a contratação com nosso time.
            </p>

            <p className="influencer-connect-modal__hint">
              Você será redirecionado ao WhatsApp da Busca Influencer. Após o pagamento, cuidamos da qualificação e da contratação do criador.
            </p>
          </div>

          <div className="influencer-connect-modal__form-col">
            <Form
              form={form}
              layout="vertical"
              requiredMark={false}
              className="influencer-connect-modal__form"
              onFinish={onSubmit}
            >
              <Form.Item
                name="brandName"
                label="Nome"
                rules={[
                  { required: true, message: 'Informe seu nome ou da marca.' },
                  { min: 2, message: 'Nome muito curto.' },
                ]}
              >
                <Input placeholder="Nome ou marca" size="large" autoComplete="name" />
              </Form.Item>
              <Form.Item
                name="brandWhatsapp"
                label="WhatsApp"
                rules={[
                  { required: true, message: 'Informe seu WhatsApp.' },
                  {
                    validator: (_, v) => {
                      const digits = parseWhatsAppDigits(v)
                      if (digits.length >= 10 && digits.length <= 13) return Promise.resolve()
                      return Promise.reject(new Error('WhatsApp: 10 a 13 números com DDI.'))
                    },
                  },
                ]}
                normalize={(v) => (v ? formatWhatsAppInput(v) : v)}
              >
                <Input placeholder="+55 (11) 99999-9999" size="large" inputMode="tel" autoComplete="tel" />
              </Form.Item>
              <Form.Item
                name="jobDescription"
                label="Descrição do job"
                rules={[
                  { required: true, message: 'Descreva o job ou a parceria.' },
                  { min: 10, message: 'Descreva com um pouco mais de detalhe (mín. 10 caracteres).' },
                ]}
              >
                <Input.TextArea
                  placeholder="Ex.: Reels sobre lançamento de skincare, entrega em 2 semanas, uso de produto enviado."
                  autoSize={{ minRows: 3, maxRows: 6 }}
                />
              </Form.Item>
              <Form.Item className="influencer-connect-modal__form-submit">
                <Button
                  type="primary"
                  htmlType="submit"
                  size="large"
                  block
                  className="influencer-connect-modal__btn-primary"
                  icon={<WhatsAppOutlined />}
                >
                  Iniciar contratação no WhatsApp
                </Button>
              </Form.Item>
            </Form>
          </div>
        </div>
      </div>
      <BuscaInfluencerPlansModal open={plansModalOpen} onClose={() => setPlansModalOpen(false)} />
      <InfluencerDetailModal
        open={profileDetailOpen}
        onClose={() => setProfileDetailOpen(false)}
        profileRef={handle.replace(/^@/, '').trim()}
        campaignId={campaignId}
      />
    </Modal>
  )
}