import { useEffect, useState } from 'react'
import { App, Form, Input, Button, Typography, Space, Divider, Spin } from 'antd'
import { useNavigate, useLocation } from 'react-router-dom'
import { UserOutlined, LockOutlined, LoginOutlined, MessageOutlined, UserAddOutlined, CheckOutlined, ArrowLeftOutlined } from '@ant-design/icons'
import { useAuth } from '../contexts/AuthContext'
import Logo from '../components/Logo'
import { trackMetaPixel } from '../utils/metaPixel'
import { SEARCH_ROUTE_PATH } from '../constants/searchRoute'

const { Title, Text } = Typography

type AccessMode = 'password' | 'dm'

function influencerProfilePath(handle: string | null | undefined): string | null {
  const h = handle?.replace(/^@/, '').trim().toLowerCase()
  if (!h) return null
  return `/app/influencer/${encodeURIComponent(h)}`
}

function Login() {
  const { message } = App.useApp()
  const [loading, setLoading] = useState(false)
  const [accessMode, setAccessMode] = useState<AccessMode>('password')
  const [nickname, setNickname] = useState('')
  const [failedAttempts, setFailedAttempts] = useState(0)
  const [form] = Form.useForm()
  const { login, user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: { pathname: string } })?.from?.pathname ?? SEARCH_ROUTE_PATH

  const normalizedNick = nickname.replace(/^@/, '').trim()

  useEffect(() => {
    if (authLoading) return
    if (!user) return
    const profilePath = user.scope === 'influencer' ? influencerProfilePath(user.profile_handle) : null
    navigate(profilePath ?? from, { replace: true })
  }, [authLoading, user, navigate, from])

  if (authLoading || user) {
    return (
      <div
        className="login-page influencer-login-page"
        style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <Spin size="large" />
      </div>
    )
  }

  const onFinish = async (values: { password: string }) => {
    if (!normalizedNick) {
      message.error('Coloca seu @ ou usuário aí.')
      return
    }
    setLoading(true)
    form.setFields([{ name: 'password', errors: [] }])
    try {
      await login(normalizedNick, values.password)
      message.success('Login realizado com sucesso')
      const profilePath = influencerProfilePath(normalizedNick)
      navigate(profilePath ?? from, { replace: true })
    } catch {
      message.error('Usuário ou senha errados. Confere e tenta de novo.')
      form.setFields([
        { name: 'password', errors: ['Usuário ou senha errados. Confere e tenta de novo.'] },
      ])
      setFailedAttempts((n) => {
        const next = n + 1
        if (next >= 2) setAccessMode('dm')
        return next
      })
    } finally {
      setLoading(false)
    }
  }

  const goToDmAccess = () => {
    trackMetaPixel('Lead', { source: 'login_dm_continue' })
    navigate('/app/create', {
      replace: true,
      state: normalizedNick ? { nickname: normalizedNick.toLowerCase() } : {},
    })
  }

  return (
    <div
      className="login-page influencer-login-page"
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
      }}
    >
      {/* Split screen: esquerda = produto | direita = login */}
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
        {/* Painel esquerdo: apresentação do produto */}
        <div
          className="login-left-panel"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'clamp(24px, 5vw, 56px) clamp(24px, 4vw, 48px)',
            borderRight: '1px solid var(--app-border)',
            background: 'linear-gradient(135deg, #f7f3ff 0%, #f1ebff 100%)',
          }}
        >
          <div style={{ maxWidth: 420, width: '100%' }}>
            <Space direction="vertical" size={32} style={{ width: '100%' }}>
              <div>
                <Title
                  level={1}
                  style={{
                    margin: 0,
                    marginBottom: 16,
                    fontSize: 36,
                    fontWeight: 700,
                    color: '#1a1a2e',
                    lineHeight: 1.25,
                  }}
                >
                  Transforme seu perfil em oportunidades de parceria
                </Title>
                <Text
                  style={{
                    fontSize: 18,
                    lineHeight: 1.6,
                    color: '#374151',
                    display: 'block',
                  }}
                >
                  Descubra métricas do seu Instagram, gere seu Mídia Kit automaticamente e entre no radar de marcas.
                </Text>
              </div>

              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                {[
                  'Seu perfil merece ser visto por quem importa',
                  'O Mídia Kit que abre portas para parcerias',
                  'Entre no radar das marcas que você admira',
                ].map((item) => (
                  <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <CheckOutlined style={{ color: 'var(--app-success)', fontSize: 16, flexShrink: 0 }} />
                    <Text style={{ fontSize: 16, color: '#4b5563' }}>{item}</Text>
                  </div>
                ))}
              </Space>



              <Button
                type="default"
                size="large"
                icon={<UserAddOutlined />}
                onClick={() => {
                  trackMetaPixel('Lead', { source: 'login_cadastrar' })
                  navigate('/app/create')
                }}
                className="login-tab"
                style={{
                  height: 48,
                  borderRadius: 12,
                  fontWeight: 600,
                  fontSize: 15,
                  width: '100%',
                  maxWidth: 260,
                  borderColor: 'var(--app-primary)',
                  color: 'var(--app-primary)',
                }}
              >
                Cadastrar
              </Button>
            </Space>
            <Space direction="vertical" size={8} style={{ width: '100%', marginTop: 16 }} >
              <Text
                type="secondary"
                style={{
                  fontSize: 14,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
                onClick={() => window.location.href = '/landing/index.html'}
              >
                <ArrowLeftOutlined />
                Voltar ao site
              </Text>

            </Space>
          </div>
        </div>

        {/* Painel direito: login */}
        <div
          className="login-right-panel"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'clamp(12px, 2.5vw, 32px)',
            overflow: 'auto',
            minHeight: 0,
            minWidth: 0,
            background: 'var(--app-bg)',
          }}
        >
          <div
            className="login-right-content"
            style={{
              width: '100%',
              maxWidth: 420,
              minWidth: 0,
              padding: 'clamp(8px, 2vw, 24px) clamp(12px, 3vw, 28px) clamp(8px, 2vw, 20px)',
            }}
          >
            {/* Header */}
            <Space direction="vertical" size={8} style={{ width: '100%', marginBottom: 14 }} align="center" className="login-header">
              <Logo height={38} alt="Relatório de Influencer" className="login-logo" />
              <Space direction="vertical" size={2} align="center" style={{ width: '100%' }}>
                <Title level={3} style={{ margin: 0, fontWeight: 700, fontSize: 18, lineHeight: 1.3 }}>
                  Bem vindo de volta!
                </Title>

              </Space>
            </Space>
            <Divider style={{ margin: '0 0 14px' }} />

            {/* Tabs: Senha ou DM */}
            <div
              className="login-tabs"
              style={{
                display: 'flex',
                gap: 0,
                marginBottom: 14,
                padding: 3,
                borderRadius: 10,
                background: 'var(--app-card-bg-soft)',
                border: '1px solid var(--app-border)',
              }}
            >
              <button
                type="button"
                className="login-tab"
                onClick={() => setAccessMode('password')}
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: 'none',
                  background: accessMode === 'password' ? 'var(--app-primary)' : 'transparent',
                  color: accessMode === 'password' ? 'var(--brand-white)' : 'var(--app-text-secondary)',
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                <LockOutlined />
                Entrar com senha
              </button>
              <button
                type="button"
                className="login-tab"
                onClick={() => setAccessMode('dm')}
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: 'none',
                  background: accessMode === 'dm' ? 'var(--app-primary)' : 'transparent',
                  color: accessMode === 'dm' ? 'var(--brand-white)' : 'var(--app-text-secondary)',
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
              >
                <MessageOutlined />
                Entrar por DM
              </button>
            </div>

            {/* Nickname compartilhado pelas duas abas */}
            <div style={{ marginBottom: accessMode === 'password' ? 8 : 12 }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: 2,
                  fontSize: 13,
                  fontWeight: 500,
                  color: 'var(--app-text)',
                }}
              >
                {accessMode === 'password' ? 'Seu @ ou usuário' : 'Seu @ do Instagram'}
              </label>
              <Input
                className="login-input"
                prefix={<UserOutlined style={{ color: 'var(--app-text-tertiary)' }} />}
                placeholder={accessMode === 'password' ? 'ex: seu_usuario' : 'ex: seu_usuario'}
                value={nickname}
                onChange={(e) => setNickname(e.target.value.replace(/^\s*@/, '').trimStart())}
                onPressEnter={accessMode === 'dm' ? goToDmAccess : () => form.submit()}
                size="middle"
                autoComplete="username"
                style={{ borderRadius: 10 }}
              />
            </div>

            {accessMode === 'password' && (
              <Form
                form={form}
                name="login"
                onFinish={onFinish}
                layout="vertical"
                requiredMark={false}
                size="middle"
              >
                <Form.Item
                  name="password"
                  label="Senha"
                  rules={[{ required: true, message: 'Preenche a senha.' }]}
                  style={{ marginBottom: 4 }}
                >
                  <Input.Password
                    className="login-input"
                    prefix={<LockOutlined style={{ color: 'var(--app-text-tertiary)' }} />}
                    placeholder="Digite sua senha"
                    autoComplete="current-password"
                    visibilityToggle
                    style={{ borderRadius: 10 }}
                  />
                </Form.Item>
                <div style={{ textAlign: 'right', marginTop: -6, marginBottom: 10 }}>
                  <Text
                    type="secondary"
                    style={{ fontSize: 12, cursor: 'pointer' }}
                    onClick={() => navigate('/agencia/esqueci-senha')}
                  >
                    Esqueci minha senha
                  </Text>
                </div>
                <Form.Item style={{ marginBottom: failedAttempts >= 1 ? 8 : 12 }}>
                  <Button
                    type="primary"
                    htmlType="submit"
                    loading={loading}
                    block
                    size="middle"
                    icon={<LoginOutlined />}
                    className="login-btn-primary"
                    style={{ height: 44, fontWeight: 600, borderRadius: 10 }}
                  >
                    Entrar
                  </Button>
                </Form.Item>
                {failedAttempts >= 1 && (
                  <div
                    style={{
                      padding: '8px 10px',
                      borderRadius: 8,
                      background: 'var(--app-info-bg)',
                      border: '1px solid var(--app-info-border)',
                      marginBottom: 12,
                    }}
                  >
                    <Text style={{ fontSize: 13, color: 'var(--app-text-secondary)', marginRight: 8 }}>
                      Esqueceu a senha?
                    </Text>
                    <Button
                      type="link"
                      size="small"
                      onClick={() => setAccessMode('dm')}
                      style={{ padding: 0, height: 'auto', fontWeight: 600, fontSize: 13 }}
                    >
                      Tenta entrar por DM
                    </Button>
                  </div>
                )}
              </Form>
            )}

            {accessMode === 'dm' && (
              <div style={{ padding: '2px 0' }}>
                <Text
                  style={{
                    display: 'block',
                    fontSize: 13,
                    color: 'var(--app-text-secondary)',
                    marginBottom: 10,
                    lineHeight: 1.45,
                  }}
                >
                  A gente manda um código no Direct do Instagram. Cola aí e segue.
                </Text>
                <Button
                  type="primary"
                  size="middle"
                  icon={<MessageOutlined />}
                  onClick={goToDmAccess}
                  block
                  className="login-btn-primary"
                  style={{
                    height: 44,
                    borderRadius: 10,
                    fontWeight: 600,
                  }}
                >
                  Continuar
                </Button>
              </div>
            )}


          </div>
        </div>
      </div>
    </div>
  )
}

export default Login
