import InfluencerLoginPanel from '../InfluencerLoginPanel/InfluencerLoginPanel'
import './AgencyLoginInfluencerAside.css'

export interface AgencyLoginInfluencerAsideProps {
  onInfluencerLogin: () => void
  className?: string
}

/**
 * CTA do criador na coluna direita (mobile) da página `/login`.
 */
export default function AgencyLoginInfluencerAside({
  onInfluencerLogin,
  className,
}: AgencyLoginInfluencerAsideProps) {
  return (
    <InfluencerLoginPanel
      onLogin={onInfluencerLogin}
      className={['agency-login-influencer-aside', className].filter(Boolean).join(' ')}
    />
  )
}
