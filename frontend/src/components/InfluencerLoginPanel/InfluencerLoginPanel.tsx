import { Button } from 'antd'
import {
  StarFilled,
  ArrowRightOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { INFLUENCER_LOGIN_FEATURES } from './influencerLoginPanelData'
import './InfluencerLoginPanel.css'

export interface InfluencerLoginPanelProps {
  onLogin: () => void
  /** Exibe o cluster decorativo ao lado do título (painel esquerdo desktop). */
  showHeaderVisual?: boolean
  className?: string
}

function HeaderVisual() {
  return (
    <div className="influencer-login-panel__visual" aria-hidden>
      <div className="influencer-login-panel__visual-dots" />
      <div className="influencer-login-panel__ig">
        <span className="influencer-login-panel__ig-heart" />
      </div>
      <div className="influencer-login-panel__mini-chart">
        <svg viewBox="0 0 80 36" className="influencer-login-panel__mini-chart-line" aria-hidden>
          <path
            d="M4 28 C18 10 30 32 44 16 S68 8 76 20"
            fill="none"
            stroke="#8b5cf6"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
        <span className="influencer-login-panel__mini-chart-badge">+ 38% ↗</span>
      </div>
      <div className="influencer-login-panel__people" />
    </div>
  )
}

/**
 * Painel de onboarding/login do criador (lista de benefícios).
 */
export default function InfluencerLoginPanel({
  onLogin,
  showHeaderVisual = false,
  className,
}: InfluencerLoginPanelProps) {
  return (
    <div className={['influencer-login-panel', className].filter(Boolean).join(' ')}>
      <header className="influencer-login-panel__intro">
        <div className="influencer-login-panel__intro-text">
          <div className="influencer-login-panel__badge">
            <StarFilled className="influencer-login-panel__badge-star" aria-hidden />
            <span>Influenciador</span>
          </div>
          <h1 className="influencer-login-panel__title">Você é um influencer?</h1>
          <p className="influencer-login-panel__subtitle">
            Transforme seu perfil em{' '}
            <span className="influencer-login-panel__subtitle-accent">oportunidades reais</span> com
            marcas.
          </p>
        </div>
        {showHeaderVisual ? <HeaderVisual /> : null}
      </header>

      <ul className="influencer-login-panel__features">
        {INFLUENCER_LOGIN_FEATURES.map((item) => (
          <li key={item.key} className="influencer-login-panel__feature">
            <span className="influencer-login-panel__feature-icon" aria-hidden>
              {typeof item.icon === 'string' ? (
                <span className="influencer-login-panel__feature-at">{item.icon}</span>
              ) : (
                item.icon
              )}
            </span>
            <div className="influencer-login-panel__feature-body">
              <strong>{item.title}</strong>
              <span>{item.description}</span>
            </div>
          </li>
        ))}
      </ul>

      <Button
        type="primary"
        size="large"
        onClick={onLogin}
        className="influencer-login-panel__cta login-btn-primary"
        block
      >
        <span className="influencer-login-panel__cta-inner">
          <ThunderboltOutlined aria-hidden />
          <span>Cadastrar Meu Perfil</span>
          <ArrowRightOutlined aria-hidden />
        </span>
      </Button>
    </div>
  )
}
