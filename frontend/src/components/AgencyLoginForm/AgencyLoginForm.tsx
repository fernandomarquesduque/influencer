import { useState } from 'react'
import { App, Form, Input } from 'antd'
import { LockOutlined, LoginOutlined, MailOutlined } from '@ant-design/icons'
import LoginCtaButton from '../LoginCtaButton/LoginCtaButton'
import { useAuth } from '../../contexts/AuthContext'
import { trackAgencyLogin } from '../../utils/metaPixelFunnel'

export interface AgencyLoginFormProps {
  onSuccess: () => void
}

/** Formulário de login de marca/assinante (reutilizado na página `/login` e no modal). */
export default function AgencyLoginForm({ onSuccess }: AgencyLoginFormProps) {
  const { message } = App.useApp()
  const { login } = useAuth()
  const [loading, setLoading] = useState(false)
  const [form] = Form.useForm<{ email: string; password: string }>()

  const fi = { marginBottom: 8 }

  const onLogin = async (values: { email: string; password: string }) => {
    setLoading(true)
    try {
      const email = values.email.trim().toLowerCase()
      await login(email, values.password)
      trackAgencyLogin({ source: 'agency_auth_modal' })
      message.success('Login realizado')
      form.resetFields()
      onSuccess()
    } catch (e) {
      message.error((e as Error).message || 'Falha no login.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Form form={form} layout="vertical" onFinish={onLogin} requiredMark={false}>
      <Form.Item
        name="email"
        label="E-mail"
        style={fi}
        rules={[{ required: true, type: 'email', message: 'Informe um e-mail válido' }]}
      >
        <Input
          className="login-input"
          prefix={<MailOutlined style={{ color: 'var(--app-text-tertiary)', fontSize: 14 }} />}
          placeholder="seu@empresa.com"
          autoComplete="username"
          disabled={loading}
          style={{ borderRadius: 8 }}
        />
      </Form.Item>
      <Form.Item name="password" label="Senha" style={fi} rules={[{ required: true, message: 'Obrigatório' }]}>
        <Input.Password
          className="login-input"
          prefix={<LockOutlined style={{ color: 'var(--app-text-tertiary)', fontSize: 14 }} />}
          placeholder="Senha"
          autoComplete="current-password"
          disabled={loading}
          style={{ borderRadius: 8 }}
        />
      </Form.Item>
      <LoginCtaButton
        ctaColor="agency"
        htmlType="submit"
        loading={loading}
        leadingIcon={<LoginOutlined aria-hidden />}
      >
        Entrar
      </LoginCtaButton>
    </Form>
  )
}
