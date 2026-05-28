import { useState } from 'react'
import { App, Form, Input } from 'antd'
import { LockOutlined, MailOutlined, UserOutlined } from '@ant-design/icons'
import LoginCtaButton from '../LoginCtaButton/LoginCtaButton'
import { useAuth } from '../../contexts/AuthContext'
import { registerAssinanteApi, type AuthScope } from '../../api'
import { trackAgencyRegistration } from '../../utils/metaPixelFunnel'

export interface AgencySignupFormProps {
  onSuccess: () => void
}

/** Formulário de cadastro de marca/assinante (reutilizado na página `/login` e no modal). */
export default function AgencySignupForm({ onSuccess }: AgencySignupFormProps) {
  const { message } = App.useApp()
  const { loginWithToken } = useAuth()
  const [loading, setLoading] = useState(false)
  const [form] = Form.useForm<{ name?: string; email: string; password: string; confirm: string }>()

  const fi = { marginBottom: 8 }

  const onSignup = async (values: { name?: string; email: string; password: string; confirm: string }) => {
    if (values.password !== values.confirm) {
      message.error('As senhas não conferem.')
      return
    }
    setLoading(true)
    try {
      const res = await registerAssinanteApi({
        email: values.email.trim().toLowerCase(),
        password: values.password,
        name: values.name?.trim() || undefined,
      })
      loginWithToken(res.token, {
        id: res.user.id,
        username: res.user.username,
        scope: res.user.scope as AuthScope,
        profile_handle: res.user.profile_handle,
        displayName: res.user.display_name ?? null,
        emailVerified: res.user.email_verified,
      })
      trackAgencyRegistration()
      message.success('Conta criada')
      form.resetFields()
      onSuccess()
    } catch (e) {
      message.error((e as Error).message || 'Falha ao cadastrar.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Form form={form} layout="vertical" onFinish={onSignup} requiredMark={false}>
      <Form.Item name="name" label="Nome (opcional)" style={fi}>
        <Input
          className="login-input"
          prefix={<UserOutlined style={{ color: 'var(--app-text-tertiary)', fontSize: 14 }} />}
          placeholder="Como podemos te chamar"
          disabled={loading}
          style={{ borderRadius: 8 }}
        />
      </Form.Item>
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
          autoComplete="email"
          disabled={loading}
          style={{ borderRadius: 8 }}
        />
      </Form.Item>
      <Form.Item
        name="password"
        label="Senha"
        style={fi}
        rules={[
          { required: true, message: 'Obrigatório' },
          { min: 6, message: 'Mínimo de 6 caracteres' },
        ]}
      >
        <Input.Password
          className="login-input"
          prefix={<LockOutlined style={{ color: 'var(--app-text-tertiary)', fontSize: 14 }} />}
          placeholder="Mínimo 6 caracteres"
          autoComplete="new-password"
          disabled={loading}
          style={{ borderRadius: 8 }}
        />
      </Form.Item>
      <Form.Item
        name="confirm"
        label="Confirmar senha"
        style={fi}
        dependencies={['password']}
        rules={[
          { required: true, message: 'Confirme a senha' },
          ({ getFieldValue }) => ({
            validator(_, value) {
              if (!value || getFieldValue('password') === value) return Promise.resolve()
              return Promise.reject(new Error('As senhas não conferem'))
            },
          }),
        ]}
      >
        <Input.Password
          className="login-input"
          prefix={<LockOutlined style={{ color: 'var(--app-text-tertiary)', fontSize: 14 }} />}
          placeholder="Mesma senha"
          autoComplete="new-password"
          disabled={loading}
          style={{ borderRadius: 8 }}
        />
      </Form.Item>
      <LoginCtaButton
        ctaColor="agency"
        htmlType="submit"
        loading={loading}
        leadingIcon={<UserOutlined aria-hidden />}
      >
        Criar conta
      </LoginCtaButton>
    </Form>
  )
}
