import { useEffect, useState } from 'react'
import { Modal } from 'antd'
import AgencySignupForm from '../AgencySignupForm/AgencySignupForm'
import AgencyLoginForm from '../AgencyLoginForm/AgencyLoginForm'
import { trackAppUiClick } from '../../utils/metaPixel'
import { trackSignupIntent } from '../../utils/metaPixelFunnel'
import './AgencySignupModal.css'

type AuthModalMode = 'signup' | 'login'

export interface AgencySignupModalProps {
  open: boolean
  onClose: () => void
  onAuthSuccess: () => void
}

/**
 * Modal compacto: cadastro ou login de marca, alternando no mesmo dialog.
 */
export default function AgencySignupModal({ open, onClose, onAuthSuccess }: AgencySignupModalProps) {
  const [mode, setMode] = useState<AuthModalMode>('signup')

  useEffect(() => {
    if (!open) {
      setMode('signup')
      return
    }
    trackSignupIntent('agency_signup_modal')
  }, [open])

  const switchToLogin = () => {
    trackAppUiClick('signup_modal_ja_tenho_cadastro', { target_path: 'modal_login' })
    setMode('login')
  }

  const switchToSignup = () => {
    trackAppUiClick('signup_modal_criar_conta', { target_path: 'modal_signup' })
    setMode('signup')
  }

  return (
    <Modal
      className="agency-signup-modal"
      title={mode === 'signup' ? 'Criar conta' : 'Entrar'}
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
      centered
      width={400}
    >
      {mode === 'signup' ? (
        <AgencySignupForm onSuccess={onAuthSuccess} />
      ) : (
        <AgencyLoginForm onSuccess={onAuthSuccess} />
      )}
      <div className="agency-signup-modal__footer">
        {mode === 'signup' ? (
          <button type="button" className="agency-signup-modal__toggle-link" onClick={switchToLogin}>
            Já tenho cadastro
          </button>
        ) : (
          <button type="button" className="agency-signup-modal__toggle-link" onClick={switchToSignup}>
            Criar conta
          </button>
        )}
      </div>
    </Modal>
  )
}
