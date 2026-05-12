/**
 * Modal minimalista ao escolher um criador: abrir relatório ou enviar proposta (DM).
 */
import { Modal, Button } from 'antd'
import { InstagramOutlined, FundProjectionScreenOutlined } from '@ant-design/icons'
import ProfileAvatar from '../ProfileAvatar'
import InfluencerTierPill from '../InfluencerTierPill'
import { proxyImageUrl } from '../../api'
import './InfluencerConnectModal.css'

export type InfluencerConnectSnapshot = {
  displayName?: string
  profilePicUrl?: string
  stableProfilePicUrl?: string
  followersCount?: number
  engagementRatePercent?: number
}

function formatFollowersShort(n: number | undefined | null): string | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M seguidores`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k seguidores`
  return `${n.toLocaleString('pt-BR')} seguidores`
}

export type InfluencerConnectModalProps = {
  open: boolean
  onClose: () => void
  handle: string
  snapshot?: InfluencerConnectSnapshot | null
  /** Se true, segunda ação abre o fluxo de mensagem pelo sistema (admin). */
  canUseSystemDm: boolean
  onViewProfile: () => void
  onSendProposal: () => void
}

export default function InfluencerConnectModal({
  open,
  onClose,
  handle,
  snapshot,
  canUseSystemDm,
  onViewProfile,
  onSendProposal,
}: InfluencerConnectModalProps) {
  const display = (snapshot?.displayName?.trim() || `@${handle}`).replace(/\s+/g, ' ')
  const rawPic = snapshot?.profilePicUrl
  const pic = rawPic ? (proxyImageUrl(rawPic) ?? rawPic) : undefined
  const followersLine = formatFollowersShort(snapshot?.followersCount)
  const er = snapshot?.engagementRatePercent
  const erLine =
    typeof er === 'number' && Number.isFinite(er)
      ? `${er.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% eng.`
      : null
  const statsBits = [followersLine, erLine].filter(Boolean)
  const statsLine = statsBits.length ? statsBits.join(' · ') : null
  const fc = snapshot?.followersCount

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      centered
      width={Math.min(420, typeof window !== 'undefined' ? window.innerWidth - 32 : 420)}
      destroyOnHidden
      wrapClassName="influencer-connect-modal"
      maskStyle={{ backdropFilter: 'blur(4px)' }}
    >
      <div className="influencer-connect-modal__body">
        <div className="influencer-connect-modal__eyebrow">Conectar com o criador</div>

        <div className="influencer-connect-modal__head">
          <div className="influencer-connect-modal__avatar-wrap">
            <ProfileAvatar
              src={pic}
              stableBackgroundUrl={snapshot?.stableProfilePicUrl}
              handle={handle}
              size={64}
              border="2px solid rgba(104, 39, 143, 0.12)"
              shadow="0 4px 16px rgba(0,0,0,0.08)"
              fallbackIconSize={28}
              queueOnError={false}
            />
          </div>
          <div className="influencer-connect-modal__title-block">
            <h2 className="influencer-connect-modal__name">{display}</h2>
            <div className="influencer-connect-modal__handle">@{handle}</div>
            {statsLine ? <div className="influencer-connect-modal__stats">{statsLine}</div> : null}
            {typeof fc === 'number' && fc > 0 ? (
              <div className="influencer-connect-modal__tier">
                <InfluencerTierPill followers={fc} />
              </div>
            ) : null}
          </div>
        </div>

        <p className="influencer-connect-modal__hook">
          Uma boa parceria começa com contexto — veja o relatório completo ou leve sua proposta direto ao Direct.
        </p>

        <div className="influencer-connect-modal__actions">
          <Button
            type="primary"
            size="large"
            block
            className="influencer-connect-modal__btn-primary"
            icon={<FundProjectionScreenOutlined />}
            onClick={onViewProfile}
          >
            Ver relatório completo
          </Button>
          <Button
            size="large"
            block
            className="influencer-connect-modal__btn-secondary"
            icon={<InstagramOutlined />}
            onClick={onSendProposal}
          >
            {canUseSystemDm ? 'Mensagem pelo sistema (Direct)' : 'Proposta no Instagram (Direct)'}
          </Button>
        </div>

        <p className="influencer-connect-modal__hint">
          {canUseSystemDm
            ? 'A mensagem pelo sistema usa a conta oficial da plataforma no Instagram.'
            : 'Abre o Instagram para você enviar sua mensagem com a identidade da sua marca.'}
        </p>
      </div>
    </Modal>
  )
}
