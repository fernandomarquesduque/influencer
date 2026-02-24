import { useState } from 'react'
import { App, Form, Input, Button, Card, Typography, Space, Divider } from 'antd'
import { useNavigate, useLocation } from 'react-router-dom'
import { UserOutlined, LockOutlined, LoginOutlined } from '@ant-design/icons'
import { useAuth } from '../contexts/AuthContext'

const { Title, Text } = Typography

function Login() {
  const { message } = App.useApp()
  const [loading, setLoading] = useState(false)
  const [form] = Form.useForm()
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: { pathname: string } })?.from?.pathname ?? '/app'

  const onFinish = async (values: { login: string; password: string }) => {
    setLoading(true)
    form.setFields([{ name: 'password', errors: [] }])
    try {
      await login(values.login, values.password)
      message.success('Login realizado com sucesso')
      navigate(from, { replace: true })
    } catch {
      message.error('Verifique seu usuário e senha')
      form.setFields([
        { name: 'password', errors: ['Verifique seu usuário e senha'] },
      ])
    } finally {
      setLoading(false)
    }
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
        background: 'linear-gradient(135deg, #f5f7ff 0%, #ffffff 55%, #f7f7fb 100%)',
        backgroundImage: `
          linear-gradient(135deg, #f5f7ff 0%, #ffffff 55%, #f7f7fb 100%),
          radial-gradient(circle at 20% 80%, rgba(109, 94, 246, 0.04) 0%, transparent 50%),
          radial-gradient(circle at 80% 20%, rgba(47, 128, 237, 0.04) 0%, transparent 50%)
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
            boxShadow: '0 10px 30px rgba(0,0,0,0.08)',
            overflow: 'hidden',
          }}
          styles={{
            body: { padding: '32px 36px 28px' },
          }}
        >
          {/* Header */}
          <Space direction="vertical" size={16} style={{ width: '100%', marginBottom: 24 }} align="center">
            <img
              src="/images/logo.svg"
              alt="Relatório de Influencer"
              style={{ height: 48, width: 'auto', display: 'block' }}
            />
            <Space direction="vertical" size={4} align="center" style={{ width: '100%' }}>
              <Title level={3} style={{ margin: 0, fontWeight: 600 }}>
                Bem-vindo de volta
              </Title>
              <Text type="secondary" style={{ fontSize: 14 }}>
                Acesse sua conta para continuar
              </Text>
            </Space>
          </Space>
          <Divider style={{ margin: '0 0 24px' }} />

          <Form
            form={form}
            name="login"
            onFinish={onFinish}
            layout="vertical"
            requiredMark={false}
            size="large"
          >
            <Form.Item
              name="login"
              label="Usuário"
              rules={[{ required: true, message: 'Informe o usuário' }]}
              style={{ marginBottom: 20 }}
            >
              <Input
                prefix={<UserOutlined style={{ color: 'var(--app-text-tertiary)' }} />}
                placeholder="@handle ou admin"
                autoComplete="username"
                autoFocus
              />
            </Form.Item>
            <Form.Item
              name="password"
              label="Senha"
              rules={[{ required: true, message: 'Informe a senha' }]}
              style={{ marginBottom: 28 }}
            >
              <Input.Password
                prefix={<LockOutlined style={{ color: 'var(--app-text-tertiary)' }} />}
                placeholder="Sua senha de acesso"
                autoComplete="current-password"
                visibilityToggle
              />
            </Form.Item>
            <Form.Item style={{ marginBottom: 24 }}>
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
          </Form>

          <Divider style={{ margin: '16px 0' }} />
          <Space direction="vertical" size={8} style={{ width: '100%' }} align="center">
            <Text
              type="secondary"
              style={{ fontSize: 12, cursor: 'pointer' }}
              onClick={() => navigate('/')}
            >
              Voltar para o site
            </Text>
            <Text type="secondary" style={{ fontSize: 11 }}>
              Seus dados são protegidos.
            </Text>
          </Space>
        </Card>
      </div>
    </div>
  )
}

export default Login
