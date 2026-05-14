import { Modal } from 'antd'
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
      wrapClassName="influencer-detail-modal"
      maskStyle={{ backdropFilter: 'blur(4px)' }}
      styles={{
        body: {
          padding: 0,
          maxHeight: 'min(92vh, 960px)',
          overflowY: 'auto',
          overflowX: 'hidden',
        },
      }}
    >
      {open && handle ? (
        <InfluencerDetail
          overrideHandle={handle}
          overrideCampaignId={campaignId}
          embeddedInModal
          onModalClose={onClose}
        />
      ) : null}
    </Modal>
  )
}
