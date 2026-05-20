import { Modal } from 'antd'
import { CloseOutlined } from '@ant-design/icons'
import InfluencerDetail from '../../pages/InfluencerDetail'
import { useLockPageScroll } from '../../utils/useLockPageScroll'
import './InfluencerDetailModal.css'

export type InfluencerDetailModalProps = {
  open: boolean
  onClose: () => void
  handle: string
  campaignId?: string | null
}

export default function InfluencerDetailModal({
  open,
  onClose,
  handle,
  campaignId = null,
}: InfluencerDetailModalProps) {
  useLockPageScroll(open)
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1200
  const modalWidth = Math.min(1120, viewportWidth - 24)

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      centered
      width={modalWidth}
      destroyOnHidden
      closable={false}
      wrapClassName="influencer-detail-modal"
      maskStyle={{ backdropFilter: 'blur(4px)' }}
      styles={{
        body: {
          padding: 0,
          maxHeight: 'min(92vh, 960px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'visible',
        },
      }}
    >
      {open && handle ? (
        <div className="influencer-detail-modal__shell">
          <button
            type="button"
            className="influencer-detail-modal__close"
            onClick={onClose}
            aria-label="Fechar"
          >
            <CloseOutlined />
          </button>
          <InfluencerDetail
            overrideHandle={handle}
            overrideCampaignId={campaignId}
            embeddedInModal
            onModalClose={onClose}
          />
        </div>
      ) : null}
    </Modal>
  )
}
