import { useState } from 'react'
import { App, Form, Input, Button, Card, Typography, Space, Divider } from 'antd'
import { useNavigate, useLocation } from 'react-router-dom'
import { UserOutlined, LockOutlined, LoginOutlined, MessageOutlined } from '@ant-design/icons'
import { useAuth } from '../contexts/AuthContext'
import Logo from '../components/Logo'

const { Title, Text } = Typography

type AccessMode = 'password' | 'dm'

function Login() {
  const { message } = App.useApp()
  const [loading, setLoading] = useState(false)
  const [accessMode, setAccessMode] = useState<AccessMode>('password')
  const [nickname, setNickname] = useState('')
  const [failedAttempts, setFailedAttempts] = useState(0)
  const [form] = Form.useForm()
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: { pathname: string } })?.from?.pathname ?? '/app'

  const normalizedNick = nickname.replace(/^@/, '').trim()

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
      navigate(from, { replace: true })
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
    navigate('/app/create', {
      replace: true,
      state: normalizedNick ? { nickname: normalizedNick.toLowerCase() } : {},
    })
  }

  return (
    <div
      style={{
        height: '100vh',
        maxHeight: '100dvh',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--app-bg)',
        backgroundImage: `
          var(--app-hero-gradient),
          radial-gradient(circle at 20% 80%, var(--app-bg-blob1) 0%, transparent 50%),
          radial-gradient(circle at 80% 20%, var(--app-bg-blob2) 0%, transparent 50%)
        `,
        padding: 24,
        boxSizing: 'border-box',
      }}
    >
      <div style={{ width: '100%', maxWidth: 440 }}>
        <Card
          variant="borderless"
          style={{
            borderRadius: 18,
            boxShadow: 'var(--app-shadow-xl)',
            overflow: 'hidden',
          }}
          styles={{
            body: { padding: '32px 36px 28px' },
          }}
        >
          {/* Header */}
          <Space direction="vertical" size={16} style={{ width: '100%', marginBottom: 24 }} align="center">
            <Logo height={48} alt="Relatório de Influencer" />
            <Space direction="vertical" size={4} align="center" style={{ width: '100%' }}>
              <Title level={3} style={{ margin: 0, fontWeight: 600 }}>
                E aí, de volta?
              </Title>
              <Text type="secondary" style={{ fontSize: 14 }}>
                Entra aí e continua de onde parou.
              </Text>
            </Space>
          </Space>
          <Divider style={{ margin: '0 0 24px' }} />

          {/* Escolha: Senha ou DM */}
          <div
            style={{
              display: 'flex',
              gap: 0,
              marginBottom: 24,
              padding: 4,
              borderRadius: 12,
              background: 'var(--app-border-light)',
              border: '1px solid var(--app-border)',
            }}
          >
            <button
              type="button"
              onClick={() => setAccessMode('password')}
              style={{
                flex: 1,
                padding: '12px 16px',
                borderRadius: 10,
                border: 'none',
                background: accessMode === 'password' ? 'var(--app-primary)' : 'transparent',
                color: accessMode === 'password' ? 'var(--brand-white)' : 'var(--app-text-secondary)',
                fontWeight: 600,
                fontSize: 14,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <LockOutlined />
              Entrar com senha
            </button>
            <button
              type="button"
              onClick={() => setAccessMode('dm')}
              style={{
                flex: 1,
                padding: '12px 16px',
                borderRadius: 10,
                border: 'none',
                background: accessMode === 'dm' ? 'var(--app-primary)' : 'transparent',
                color: accessMode === 'dm' ? 'var(--brand-white)' : 'var(--app-text-secondary)',
                fontWeight: 600,
                fontSize: 14,
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
          <div style={{ marginBottom: accessMode === 'password' ? 12 : 16 }}>
            <label
              style={{
                display: 'block',
                marginBottom: 4,
                fontSize: 14,
                fontWeight: 500,
                color: 'var(--app-text)',
              }}
            >
              {accessMode === 'password' ? 'Seu @ ou usuário' : 'Seu @ do Instagram'}
            </label>
            <Input
              prefix={<UserOutlined style={{ color: 'var(--app-text-tertiary)' }} />}
              placeholder={accessMode === 'password' ? 'ex: seu_usuario' : 'ex: seu_usuario'}
              value={nickname}
              onChange={(e) => setNickname(e.target.value.replace(/^\s*@/, '').trimStart())}
              onPressEnter={accessMode === 'dm' ? goToDmAccess : () => form.submit()}
              size="large"
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
              size="large"
            >
              <Form.Item
                name="password"
                label="Senha"
                rules={[{ required: true, message: 'Preenche a senha.' }]}
                style={{ marginBottom: 28 }}
              >
                <Input.Password
                  prefix={<LockOutlined style={{ color: 'var(--app-text-tertiary)' }} />}
                  placeholder="Digite sua senha"
                  autoComplete="current-password"
                  visibilityToggle
                />
              </Form.Item>
              <Form.Item style={{ marginBottom: failedAttempts >= 1 ? 12 : 24 }}>
                <Button
                  type="primary"
                  htmlType="submit"
                  loading={loading}
                  block
                  size="large"
                  icon={<LoginOutlined />}
                  style={{ height: 48, fontWeight: 500 }}
                >
                  Entrar
                </Button>
              </Form.Item>
              {failedAttempts >= 1 && (
                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: 10,
                    background: 'var(--app-info-bg)',
                    border: '1px solid var(--app-info-border)',
                    marginBottom: 24,
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
            <div style={{ padding: '4px 0' }}>
              <Text
                style={{
                  display: 'block',
                  fontSize: 14,
                  color: 'var(--app-text-secondary)',
                  marginBottom: 16,
                  lineHeight: 1.5,
                }}
              >
                A gente manda um código no Direct do Instagram. Cola aí e segue.
              </Text>
              <Button
                type="primary"
                size="large"
                icon={<MessageOutlined />}
                onClick={goToDmAccess}
                block
                style={{
                  height: 48,
                  borderRadius: 10,
                  fontWeight: 500,
                  background: 'var(--app-primary)',
                  borderColor: 'var(--app-primary)',
                }}
              >
                Continuar
              </Button>
            </div>
          )}

          <Divider style={{ margin: '16px 0' }} />
          <Space direction="vertical" size={8} style={{ width: '100%' }} align="center">
            <Text
              type="secondary"
              style={{ fontSize: 12, cursor: 'pointer' }}
              onClick={() => window.location.href = '/'}
            >
              Voltar ao site
            </Text>
            <Text type="secondary" style={{ fontSize: 11 }}>
              Seus dados ficam seguros com a gente.
            </Text>
          </Space>
        </Card>
      </div>
    </div>
  )
}

export default Login
