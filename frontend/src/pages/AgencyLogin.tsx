import { useEffect } from 'react'
import { Spin, Typography, Space, Divider, ConfigProvider } from 'antd'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import AgencyLoginPanel from '../components/AgencyLoginPanel/AgencyLoginPanel'
import AgencyLoginHero from '../components/AgencyLoginHero/AgencyLoginHero'
import AgencyLoginInfluencerAside from '../components/AgencyLoginInfluencerAside/AgencyLoginInfluencerAside'
import Logo from '../components/Logo'
import { SEARCH_ROUTE_PATH } from '../constants/searchRoute'

const { Text } = Typography

const DEFAULT_REDIRECT = SEARCH_ROUTE_PATH

const AGENCY_LOGIN_SLOGAN =
  'Encontre os influenciadores perfeitos para sua marca.'

/**
 * Rota `/login` (marcas/assinantes): card central em duas colunas —
 * esquerda com hero visual + CTA do criador; direita só com formulário de agência.
 */
export default function AgencyLogin() {
  const navigate = useNavigate()
  const location = useLocation()
  const from =
    (location.state as { from?: { pathname: string } })?.from?.pathname ?? DEFAULT_REDIRECT
  const { user, loading: authLoading } = useAuth()

  useEffect(() => {
    if (authLoading) return
    if (user) {
      navigate(from, { replace: true })
    }
  }, [authLoading, user, navigate, from])

  const goToInfluencerLanding = () => {
    window.location.href = '/landing/index.html'
  }

  if (authLoading || user) {
    return (
      <div
        className="login-page agency-login-page agency-login-page--loading"
        style={{
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--app-bg)',
        }}
      >
        <Spin size="large" />
      </div>
    )
  }

  return (
    <div className="login-page agency-login-page">
      <div className="agency-login-shell">
        <div className="agency-login-card">
          <div className="login-two-columns agency-login-two-columns">
            <div className="login-left-panel agency-login-left-panel">
              <AgencyLoginHero onInfluencerLogin={goToInfluencerLanding} />
            </div>

            <div className="login-right-panel agency-login-right-panel">
              <div className="agency-login-right">
                <div className="agency-login-right__agency">
                  <ConfigProvider componentSize="middle">
                    <div className="login-right-content agency-login-form-block">
                      <Space
                        direction="vertical"
                        size={8}
                        style={{ width: '100%', marginBottom: 10 }}
                        align="center"
                      >
                        <Logo height={36} alt="Busca Influencer" className="login-logo" />
                        <Text className="agency-login-slogan">{AGENCY_LOGIN_SLOGAN}</Text>
                      </Space>
                      <Divider className="agency-login-form-divider" />
                      <AgencyLoginPanel onSuccess={() => navigate(from, { replace: true })} />
                    </div>
                  </ConfigProvider>
                </div>

                <div className="agency-login-right__influencer agency-login-right__influencer--mobile">
                  <AgencyLoginInfluencerAside
                    className="agency-login-influencer-aside--mobile"
                    onInfluencerLogin={goToInfluencerLanding}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
