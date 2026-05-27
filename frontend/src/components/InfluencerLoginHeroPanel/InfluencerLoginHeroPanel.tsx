import {
  ThunderboltOutlined,
  CheckOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import LoginCtaButton from '../LoginCtaButton/LoginCtaButton'
import { trackMetaPixel } from '../../utils/metaPixel'
import './InfluencerLoginHeroPanel.css'

const BENEFITS = [
  'Seu perfil merece ser visto por quem importa',
  'O Mídia Kit que abre portas para parcerias',
  'Entre no radar das marcas que você admira',
] as const

function PanelSparkle({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 12 12" aria-hidden>
      <path
        d="M6 0L6.8 4.2L11 5L6.8 5.8L6 10L5.2 5.8L1 5L5.2 4.2L6 0Z"
        fill="currentColor"
      />
    </svg>
  )
}

/**
 * Painel esquerdo de `/influencer/login`: apresentação + CTA de cadastro.
 */
export default function InfluencerLoginHeroPanel() {
  const navigate = useNavigate()

  const goToCreate = () => {
    trackMetaPixel('Lead', { source: 'login_cadastrar' })
    navigate('/app/create')
  }

  return (
    <div className="influencer-login-hero-panel">
      <div className="influencer-login-hero-panel__decor" aria-hidden>
        <PanelSparkle className="influencer-login-hero-panel__star influencer-login-hero-panel__star--1" />
        <PanelSparkle className="influencer-login-hero-panel__star influencer-login-hero-panel__star--2" />
        <div className="influencer-login-hero-panel__orb influencer-login-hero-panel__orb--1" />
        <div className="influencer-login-hero-panel__orb influencer-login-hero-panel__orb--2" />
        <div className="influencer-login-hero-panel__dots" />
      </div>

      <div className="influencer-login-hero-panel__content">
        <div className="influencer-login-hero-panel__badge">
          <ThunderboltOutlined aria-hidden />
          <span>Influencer</span>
        </div>

        <h1 className="influencer-login-hero-panel__title">
          Transforme seu perfil em
          <span className="influencer-login-hero-panel__title-accent">oportunidades de parceria</span>
        </h1>

        <p className="influencer-login-hero-panel__lead">
          Descubra métricas do seu Instagram, gere seu Mídia Kit automaticamente e entre no radar de
          marcas.
        </p>

        <ul className="influencer-login-hero-panel__benefits">
          {BENEFITS.map((item) => (
            <li key={item}>
              <span className="influencer-login-hero-panel__check" aria-hidden>
                <CheckOutlined />
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ul>

        <LoginCtaButton
          ctaColor="influencer"
          leadingIcon={<UserOutlined aria-hidden />}
          onClick={goToCreate}
          className="influencer-login-hero-panel__cta"
        >
          Criar meu cadastro
        </LoginCtaButton>
      </div>
    </div>
  )
}
