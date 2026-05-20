import { Modal } from 'antd'
import { useLockPageScroll } from '../../utils/useLockPageScroll'
import BuscaInfluencerPlansPanel from './BuscaInfluencerPlansPanel'
import './BuscaInfluencerPlansModal.css'

export type BuscaInfluencerPlansModalProps = {
  open: boolean
  onClose: () => void
}

export default function BuscaInfluencerPlansModal({ open, onClose }: BuscaInfluencerPlansModalProps) {
  useLockPageScroll(open)

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      centered
      width={Math.min(1100, typeof window !== 'undefined' ? window.innerWidth - 32 : 1100)}
      destroyOnHidden
      zIndex={1100}
      wrapClassName="busca-plans-modal"
      maskStyle={{ backdropFilter: 'blur(4px)' }}
    >
      <BuscaInfluencerPlansPanel checkSubscription onAfterAction={onClose} />
    </Modal>
  )
}
