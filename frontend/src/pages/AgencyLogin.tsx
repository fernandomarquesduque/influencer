import { useEffect } from 'react'
import { Spin, Button, Typography, Space, Divider, ConfigProvider } from 'antd'
import { useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeftOutlined } from '@ant-design/icons'
import { useAuth } from '../contexts/AuthContext'
import AgencyLoginPanel from '../components/AgencyLoginPanel/AgencyLoginPanel'
import Logo from '../components/Logo'

const { Title, Text } = Typography

const DEFAULT_REDIRECT = '/app'

/**
 * Rota `/agencia/login`: layout em duas colunas (igual recuperação de senha e CSS `.agency-login-page`),
 * não é modal — painel esquerdo com contexto, direito com formulário.
 */
export default function AgencyLogin() {
  const navigate = useNavigate()
  const location = useLocation()
  const from =
    (location.state as { from?: { pathname: string } })?.from?.pathname ?? DEFAULT_REDIRECT
  const returnTo = (location.state as { returnTo?: string } | null)?.returnTo?.trim() ?? ''

  const { user, loading: authLoading } = useAuth()

  useEffect(() => {
    if (authLoading) return
    if (user) {
      navigate(from, { replace: true })
    }
  }, [authLoading, user, navigate, from])

  const handleBack = () => {
    if (returnTo) {
      navigate(returnTo, { replace: true })
      return
    }
    if (typeof window !== 'undefined' && window.history.length > 1) {
      navigate(-1)
      return
    }
    navigate('/', { replace: true })
  }

  if (authLoading || user) {
    return (
      <div
        className="login-page"
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
      <div
        className="login-two-columns"
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gridTemplateRows: '1fr',
          minHeight: 0,
          alignItems: 'stretch',
        }}
      >
        <div
          className="login-left-panel"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'clamp(12px, 2.5vw, 28px) clamp(16px, 3vw, 32px)',
            borderRight: '1px solid var(--app-border)',
            background: 'linear-gradient(145deg, #eef2ff 0%, #e4e9ff 55%, #dce4ff 100%)',
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          <div style={{ maxWidth: 400, width: '100%' }}>
            <Space direction="vertical" size={14} style={{ width: '100%' }}>
              <div>
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: 'var(--app-primary)',
                    display: 'block',
                    marginBottom: 6,
                  }}
                >
                  Agência
                </Text>
                <Title
                  level={1}
                  style={{
                    margin: 0,
                    marginBottom: 8,
                    fontSize: 'clamp(1.2rem, 2.4vw, 1.65rem)',
                    fontWeight: 700,
                    color: '#1a1a2e',
                    lineHeight: 1.25,
                  }}
                >
                  Relatórios e busca de influenciadores
                </Title>
                <Text style={{ fontSize: 13, lineHeight: 1.5, color: '#374151', display: 'block' }}>
                  Acesse com o e-mail da sua conta para ver campanhas, créditos e listas completas. Se ainda não tem cadastro,
                  use a aba <strong>Cadastrar</strong> ao lado.
                </Text>
              </div>
              <Button
                type="link"
                icon={<ArrowLeftOutlined />}
                onClick={handleBack}
                style={{ padding: 0, fontWeight: 600, color: 'var(--app-primary)', alignSelf: 'flex-start' }}
              >
                Voltar
              </Button>
            </Space>
          </div>
        </div>

        <div
          className="login-right-panel"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'clamp(8px, 1.5vw, 20px) clamp(12px, 2.5vw, 24px)',
            overflow: 'auto',
            minWidth: 0,
            minHeight: 0,
            background: 'var(--app-bg)',
          }}
        >
          <ConfigProvider componentSize="middle">
            <div
              className="login-right-content"
              style={{
                width: '100%',
                maxWidth: 380,
                minWidth: 0,
                padding: '8px 4px 10px',
              }}
            >
              <Space direction="vertical" size={8} style={{ width: '100%', marginBottom: 10 }} align="center">
                <Logo height={36} alt="Busca Influencer" className="login-logo" />
                <Text type="secondary" style={{ fontSize: 12, textAlign: 'center' }}>
                  E-mail da conta e senha — ou cadastro rápido
                </Text>
              </Space>
              <Divider style={{ margin: '6px 0 10px' }} />
              <AgencyLoginPanel onSuccess={() => navigate(from, { replace: true })} />
            </div>
          </ConfigProvider>
        </div>
      </div>
    </div>
  )
}
