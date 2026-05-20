import { useState } from 'react'
import { App, Segmented, Form, Input, Button } from 'antd'
import { Link } from 'react-router-dom'
import {
  MailOutlined,
  LockOutlined,
  UserOutlined,
  RightOutlined,
  GlobalOutlined,
} from '@ant-design/icons'
import { useAuth } from '../../contexts/AuthContext'
import { registerAssinanteApi, type AuthScope } from '../../api'
import './AgencyLoginPanel.css'

type PanelMode = 'login' | 'signup'

export interface AgencyLoginPanelProps {
  onSuccess: () => void
}

/**
 * Formulários de login/cadastro assinante (coluna direita da página `/login`).
 * Estilos alinhados a `AgencyForgotPassword`: `login-input`, `login-btn-primary`.
 */
export default function AgencyLoginPanel({ onSuccess }: AgencyLoginPanelProps) {
  const { message } = App.useApp()
  const { login, loginWithToken } = useAuth()
  const [mode, setMode] = useState<PanelMode>('login')
  const [loading, setLoading] = useState(false)
  const [loginForm] = Form.useForm<{ email: string; password: string }>()
  const [signupForm] = Form.useForm<{ name?: string; email: string; password: string; confirm: string }>()

  const fi = { marginBottom: 8 }

  const onLogin = async (values: { email: string; password: string }) => {
    setLoading(true)
    try {
      const email = values.email.trim().toLowerCase()
      await login(email, values.password)
      message.success('Login realizado')
      onSuccess()
    } catch (e) {
      message.error((e as Error).message || 'Falha no login.')
    } finally {
      setLoading(false)
    }
  }

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
      message.success('Conta criada')
      onSuccess()
    } catch (e) {
      message.error((e as Error).message || 'Falha ao cadastrar.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <Segmented<PanelMode>
        block
        value={mode}
        onChange={setMode}
        options={[
          { label: 'Entrar', value: 'login' },
          { label: 'Cadastrar', value: 'signup' },
        ]}
        style={{ marginBottom: 14 }}
      />
      {mode === 'login' ? (
        <Form form={loginForm} layout="vertical" onFinish={onLogin} requiredMark={false}>
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
          <Button
            type="primary"
            htmlType="submit"
            block
            loading={loading}
            className="login-btn-primary"
            style={{ height: 40, fontWeight: 600, borderRadius: 8 }}
          >
            Entrar
          </Button>
        </Form>
      ) : (
        <Form form={signupForm} layout="vertical" onFinish={onSignup} requiredMark={false}>
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
          <Button
            type="primary"
            htmlType="submit"
            block
            loading={loading}
            className="login-btn-primary"
            style={{ height: 40, fontWeight: 600, borderRadius: 8 }}
          >
            Criar conta
          </Button>
        </Form>
      )}

      <footer className="agency-login-panel-footer">
        {mode === 'login' ? (
          <>
            <Link to="/agencia/esqueci-senha" className="agency-login-panel-footer__link">
              Esqueci minha senha
              <RightOutlined aria-hidden />
            </Link>
            <div className="agency-login-panel-footer__divider">
              <span>ou</span>
            </div>
          </>
        ) : null}
        <button
          type="button"
          className="agency-login-panel-footer__link"
          onClick={() => {
            window.location.href = '/landing/index.html'
          }}
        >
          <GlobalOutlined aria-hidden />
          Voltar ao site
        </button>
      </footer>
    </div>
  )
}
