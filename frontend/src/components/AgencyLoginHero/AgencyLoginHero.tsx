import InfluencerLoginPanel from '../InfluencerLoginPanel/InfluencerLoginPanel'
import './AgencyLoginHero.css'

export interface AgencyLoginHeroProps {
  onInfluencerLogin: () => void
}

/**
 * Painel esquerdo da página `/login`: onboarding do criador.
 */
export default function AgencyLoginHero({ onInfluencerLogin }: AgencyLoginHeroProps) {
  return (
    <InfluencerLoginPanel
      onLogin={onInfluencerLogin}
      showHeaderVisual
      className="agency-login-hero"
    />
  )
}
