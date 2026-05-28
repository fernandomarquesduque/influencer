import { useState } from 'react'
import { Segmented } from 'antd'
import { Link } from 'react-router-dom'
import { RightOutlined, GlobalOutlined } from '@ant-design/icons'
import AgencyLoginForm from '../AgencyLoginForm/AgencyLoginForm'
import AgencySignupForm from '../AgencySignupForm/AgencySignupForm'
import './AgencyLoginPanel.css'

type PanelMode = 'login' | 'signup'

export interface AgencyLoginPanelProps {
  onSuccess: () => void
}

/**
 * Formulários de login/cadastro assinante (coluna direita da página `/login`).
 * Estilos alinhados a `AgencyForgotPassword`: `login-input`, `login-btn-primary`.
 */
export default function AgencyLoginPanel({ onSuccess }: AgencyLoginPanelProps) {
  const [mode, setMode] = useState<PanelMode>('login')

  return (
    <div>
      <Segmented<PanelMode>
        block
        value={mode}
        onChange={setMode}
        options={[
          { label: 'Entrar', value: 'login' },
          { label: 'Cadastrar', value: 'signup' },
        ]}
        style={{ marginBottom: 14 }}
      />
      {mode === 'login' ? (
        <AgencyLoginForm onSuccess={onSuccess} />
      ) : (
        <AgencySignupForm onSuccess={onSuccess} />
      )}

      <footer className="agency-login-panel-footer">
        {mode === 'login' ? (
          <>
            <Link to="/agencia/esqueci-senha" className="agency-login-panel-footer__link">
              Esqueci minha senha
              <RightOutlined aria-hidden />
            </Link>
            <div className="agency-login-panel-footer__divider">
              <span>ou</span>
            </div>
          </>
        ) : (
          <>
            <button
              type="button"
              className="agency-login-panel-footer__link"
              onClick={() => setMode('login')}
            >
              Já tenho cadastro
            </button>
            <div className="agency-login-panel-footer__divider">
              <span>ou</span>
            </div>
          </>
        )}
        <button
          type="button"
          className="agency-login-panel-footer__link"
          onClick={() => {
            window.location.href = '/'
          }}
        >
          <GlobalOutlined aria-hidden />
          Voltar ao site
        </button>
      </footer>
    </div>
  )
}
