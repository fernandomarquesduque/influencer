import { useState, useEffect } from 'react'
import { App, Form, Input, Button, Typography, Space, Divider, Alert, Spin, ConfigProvider, Checkbox } from 'antd'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  MailOutlined,
  LockOutlined,
  LoginOutlined,
  UserOutlined,
  UserAddOutlined,
  CheckOutlined,
} from '@ant-design/icons'
import { useAuth, type AuthUser } from '../contexts/AuthContext'
import Logo from '../components/Logo'
import { registerCheckoutUser, type AuthScope } from '../api'
import { trackMetaPixel } from '../utils/metaPixel'

const { Title, Text } = Typography

type PanelMode = 'login' | 'signup'

const DEFAULT_REDIRECT = '/app'
/** Documento estático em `public/documents/contrato.html` */
const CONTRATO_AGENCIA_HREF = '/documents/contrato.html'

/** Formulário mais baixo: evita scroll na coluna direita em viewports comuns */
const fi = { marginBottom: 8 }

const LEFT_LOGIN = {
  title: 'Bem-vindo de volta',
  lead: 'Entre com o e-mail e a senha da sua conta para acessar buscas, relatórios e créditos.',
  bullets: [
    'Retome campanhas e favoritos',
    'Compre créditos e desbloqueie perfis',
    'Histórico e dados da sua equipe',
  ],
}

const LEFT_SIGNUP = {
  title: 'Crie sua conta',
  lead: 'Cadastro em poucos passos para marcas e agências buscarem influenciadores na plataforma.',
  bullets: [
    'Acesso à vitrine e filtros por nicho e região',
    'Relatórios e uso por créditos',
    'Confirme o e-mail para ativar benefícios',
  ],
}

export default function AgencyLogin() {
  const { message } = App.useApp()
  const { login, loginWithToken, user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from =
    (location.state as { from?: { pathname: string } })?.from?.pathname ?? DEFAULT_REDIRECT

  const [panelMode, setPanelMode] = useState<PanelMode>('login')
  const [submitLoading, setSubmitLoading] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [loginForm] = Form.useForm<{ email: string; password: string }>()
  const [signupName, setSignupName] = useState('')
  const [signupEmail, setSignupEmail] = useState('')
  const [signupPassword, setSignupPassword] = useState('')
  const [signupPasswordConfirm, setSignupPasswordConfirm] = useState('')
  const [termsAccepted, setTermsAccepted] = useState(false)

  useEffect(() => {
    if (authLoading) return
    if (user) {
      navigate(from, { replace: true })
    }
  }, [authLoading, user, navigate, from])

  const onLoginFinish = async (values: { email: string; password: string }) => {
    const loginId = values.email.trim().replace(/^@/, '')
    if (!loginId) {
      message.error('Informe seu e-mail.')
      return
    }
    setSubmitLoading(true)
    setFormError(null)
    loginForm.setFields([{ name: 'password', errors: [] }])
    try {
      await login(loginId, values.password)
      message.success('Login realizado com sucesso')
      navigate(from, { replace: true })
    } catch (e) {
      const msg = (e as Error).message || 'E-mail ou senha inválidos.'
      setFormError(msg)
      loginForm.setFields([{ name: 'password', errors: [msg] }])
    } finally {
      setSubmitLoading(false)
    }
  }

  const setPanelModeAndClearError = (m: PanelMode) => {
    setPanelMode(m)
    setFormError(null)
    if (m !== 'signup') setTermsAccepted(false)
  }

  const onSignup = async () => {
    setFormError(null)
    if (!termsAccepted) {
      setFormError('É necessário ler e aceitar o contrato para criar a conta.')
      return
    }
    if (!signupEmail.trim() || !signupEmail.includes('@')) {
      setFormError('Informe um e-mail válido.')
      return
    }
    if (signupPassword.length < 6) {
      setFormError('A senha deve ter no mínimo 6 caracteres.')
      return
    }
    if (signupPassword !== signupPasswordConfirm) {
      setFormError('Senha e confirmação não conferem.')
      return
    }
    setSubmitLoading(true)
    try {
      trackMetaPixel('Lead', { source: 'agency_signup_submit' })
      const res = await registerCheckoutUser({
        email: signupEmail.trim().toLowerCase(),
        name: signupName.trim() || undefined,
        password: signupPassword,
      })
      loginWithToken(res.token, {
        id: res.user.id,
        username: res.user.username,
        scope: res.user.scope as AuthScope,
        profile_handle: res.user.profile_handle,
        displayName: res.user.display_name ?? null,
        emailVerified: res.user.email_verified,
      } as AuthUser)
      trackMetaPixel('CompleteRegistration', { source: 'agency_signup_success' })
      message.success('Conta criada. Bem-vindo!')
      navigate(from, { replace: true })
    } catch (e) {
      setFormError((e as Error).message)
    } finally {
      setSubmitLoading(false)
    }
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
            background:
              panelMode === 'login'
                ? 'linear-gradient(145deg, #eef2ff 0%, #e4e9ff 55%, #dce4ff 100%)'
                : 'linear-gradient(145deg, #f3f0ff 0%, #ebe6ff 55%, #e2dcff 100%)',
            minHeight: 0,
            overflow: 'hidden',
            transition: 'background 0.35s ease',
          }}
        >
          <div
            style={{ maxWidth: 400, width: '100%' }}
            aria-live="polite"
            key={panelMode}
          >
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
                  {panelMode === 'login' ? 'Acesso' : 'Novo por aqui'}
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
                  {panelMode === 'login' ? LEFT_LOGIN.title : LEFT_SIGNUP.title}
                </Title>
                <Text
                  style={{
                    fontSize: 13,
                    lineHeight: 1.5,
                    color: '#374151',
                    display: 'block',
                  }}
                >
                  {panelMode === 'login' ? LEFT_LOGIN.lead : LEFT_SIGNUP.lead}
                </Text>
              </div>

              <Space direction="vertical" size={6} style={{ width: '100%' }}>
                {(panelMode === 'login' ? LEFT_LOGIN.bullets : LEFT_SIGNUP.bullets).map((item) => (
                  <div key={item} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <CheckOutlined style={{ color: 'var(--app-success)', fontSize: 14, flexShrink: 0, marginTop: 2 }} />
                    <Text style={{ fontSize: 13, color: '#4b5563', lineHeight: 1.4 }}>{item}</Text>
                  </div>
                ))}
              </Space>

              <div style={{ marginTop: 8, paddingTop: 12, borderTop: '1px solid rgba(104, 39, 143, 0.12)' }}>
                {panelMode === 'login' ? (
                  <Text style={{ fontSize: 13, color: '#4b5563', display: 'block', marginBottom: 8 }}>
                    Primeira vez na plataforma?
                  </Text>
                ) : (
                  <Text style={{ fontSize: 13, color: '#4b5563', display: 'block', marginBottom: 8 }}>
                    Já possui conta?
                  </Text>
                )}
                <Button
                  type="default"
                  icon={panelMode === 'login' ? <UserAddOutlined /> : <LoginOutlined />}
                  onClick={() => {
                    const nextMode = panelMode === 'login' ? 'signup' : 'login'
                    if (nextMode === 'signup') {
                      trackMetaPixel('Lead', { source: 'agency_open_signup' })
                    }
                    setPanelModeAndClearError(nextMode)
                  }}
                  block
                  style={{
                    fontWeight: 600,
                    borderRadius: 8,
                    height: 40,
                    borderColor: 'var(--app-primary)',
                    color: 'var(--app-primary)',
                  }}
                >
                  {panelMode === 'login' ? 'Criar conta gratuita' : 'Ir para o login'}
                </Button>
              </div>

              <div
                style={{
                  marginTop: 10,
                  paddingTop: 8,
                  borderTop: '1px solid var(--app-border)',
                  textAlign: 'center',
                }}
              >
                <Text type="secondary" style={{ fontSize: 11, lineHeight: 1.5 }}>
                  <span
                    style={{ cursor: 'pointer' }}
                    onClick={() => {
                      window.location.href = '/landing/search/'
                    }}
                  >
                    Voltar ao site
                  </span>

                </Text>
              </div>
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
              <Space direction="vertical" size={8} style={{ width: '100%', marginBottom: 10 }} align="center" className="login-header">
                <Logo height={36} alt="Busca Influencer" className="login-logo" />
                <Space direction="vertical" size={0} align="center" style={{ width: '100%' }}>

                  <Text type="secondary" style={{ fontSize: 12, textAlign: 'center', lineHeight: 1.35 }}>
                    {panelMode === 'login'
                      ? 'Acesse com seu e-mail e senha'
                      : 'Preencha os dados para criar sua conta'}
                  </Text>
                </Space>
              </Space>
              <Divider style={{ margin: '6px 0 10px' }} />

              {/* Coluna esquerda some no mobile: mesmos botões aqui só em telas estreitas */}
              <div
                className="agency-login-mobile-mode"
                role="group"
                aria-label="Entrar ou criar conta"
                style={{ gap: 8, width: '100%', marginBottom: 10 }}
              >
                <Button
                  type={panelMode === 'login' ? 'primary' : 'default'}
                  icon={<LoginOutlined />}
                  onClick={() => setPanelModeAndClearError('login')}
                  className={panelMode === 'login' ? 'login-btn-primary' : undefined}
                  block
                  style={{ fontWeight: 600, borderRadius: 8, height: 40 }}
                >
                  Entrar
                </Button>
                <Button
                  type={panelMode === 'signup' ? 'primary' : 'default'}
                  icon={<UserAddOutlined />}
                  onClick={() => setPanelModeAndClearError('signup')}
                  className={panelMode === 'signup' ? 'login-btn-primary' : undefined}
                  block
                  style={{ fontWeight: 600, borderRadius: 8, height: 40 }}
                >
                  Criar conta
                </Button>
              </div>

              {formError && (
                <Alert
                  type="error"
                  message={formError}
                  showIcon
                  closable
                  onClose={() => setFormError(null)}
                  style={{ marginBottom: 8, padding: '4px 8px' }}
                />
              )}

              {panelMode === 'login' ? (
                <Form
                  form={loginForm}
                  name="agency-login"
                  onFinish={onLoginFinish}
                  layout="vertical"
                  requiredMark={false}
                >
                  <Form.Item
                    name="email"
                    label="E-mail"
                    style={fi}
                    rules={[
                      { required: true, message: 'Informe seu e-mail.' },
                      { type: 'email', message: 'E-mail inválido.' },
                    ]}
                  >
                    <Input
                      className="login-input"
                      prefix={<MailOutlined style={{ color: 'var(--app-text-tertiary)', fontSize: 14 }} />}
                      placeholder="seu@empresa.com"
                      autoComplete="username"
                      style={{ borderRadius: 8 }}
                    />
                  </Form.Item>
                  <Form.Item
                    name="password"
                    label="Senha"
                    rules={[{ required: true, message: 'Informe a senha.' }]}
                    style={fi}
                  >
                    <Input.Password
                      className="login-input"
                      prefix={<LockOutlined style={{ color: 'var(--app-text-tertiary)', fontSize: 14 }} />}
                      placeholder="Sua senha"
                      autoComplete="current-password"
                      style={{ borderRadius: 8 }}
                    />
                  </Form.Item>
                  <div style={{ textAlign: 'right', marginTop: -4, marginBottom: 8 }}>
                    <Text
                      type="secondary"
                      style={{ fontSize: 12, cursor: 'pointer' }}
                      onClick={() => navigate('/agencia/esqueci-senha')}
                    >
                      Esqueci minha senha
                    </Text>
                  </div>
                  <Form.Item style={{ marginBottom: 0 }}>
                    <Button
                      type="primary"
                      htmlType="submit"
                      loading={submitLoading}
                      block
                      icon={<LoginOutlined />}
                      className="login-btn-primary"
                      style={{ height: 40, fontWeight: 600, borderRadius: 8 }}
                    >
                      Entrar
                    </Button>
                  </Form.Item>
                </Form>
              ) : (
                <div>
                  <Form layout="vertical" requiredMark={false}>
                    <Form.Item label="Nome (opcional)" style={fi}>
                      <Input
                        className="login-input"
                        prefix={<UserOutlined style={{ color: 'var(--app-text-tertiary)', fontSize: 14 }} />}
                        placeholder="Nome ou agência"
                        value={signupName}
                        onChange={(e) => setSignupName(e.target.value)}
                        style={{ borderRadius: 8 }}
                      />
                    </Form.Item>
                    <Form.Item label="E-mail" required style={fi}>
                      <Input
                        className="login-input"
                        type="email"
                        prefix={<MailOutlined style={{ color: 'var(--app-text-tertiary)', fontSize: 14 }} />}
                        placeholder="seu@empresa.com"
                        value={signupEmail}
                        onChange={(e) => setSignupEmail(e.target.value)}
                        autoComplete="email"
                        style={{ borderRadius: 8 }}
                      />
                    </Form.Item>
                    <Form.Item label="Senha (mín. 6)" required style={fi}>
                      <Input.Password
                        className="login-input"
                        prefix={<LockOutlined style={{ color: 'var(--app-text-tertiary)', fontSize: 14 }} />}
                        placeholder="••••••••"
                        value={signupPassword}
                        onChange={(e) => setSignupPassword(e.target.value)}
                        autoComplete="new-password"
                        style={{ borderRadius: 8 }}
                      />
                    </Form.Item>
                    <Form.Item label="Confirmar senha" required style={fi}>
                      <Input.Password
                        className="login-input"
                        prefix={<LockOutlined style={{ color: 'var(--app-text-tertiary)', fontSize: 14 }} />}
                        placeholder="••••••••"
                        value={signupPasswordConfirm}
                        onChange={(e) => setSignupPasswordConfirm(e.target.value)}
                        autoComplete="new-password"
                        style={{ borderRadius: 8 }}
                      />
                    </Form.Item>
                    <Form.Item required style={{ marginBottom: 10 }}>
                      <Checkbox
                        checked={termsAccepted}
                        onChange={(e) => {
                          setTermsAccepted(e.target.checked)
                          if (e.target.checked && formError?.includes('contrato')) setFormError(null)
                        }}
                      >
                        <span style={{ fontSize: 13, lineHeight: 1.45 }}>
                          Li e aceito o{' '}
                          <a
                            href={CONTRATO_AGENCIA_HREF}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ fontWeight: 600 }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            contrato de licença de uso
                          </a>
                        </span>
                      </Checkbox>
                    </Form.Item>
                  </Form>
                  <Button
                    type="primary"
                    block
                    loading={submitLoading}
                    onClick={() => void onSignup()}
                    icon={<UserAddOutlined />}
                    className="login-btn-primary"
                    style={{ height: 40, fontWeight: 600, borderRadius: 8, marginTop: 0 }}
                  >
                    Criar conta e entrar
                  </Button>
                </div>
              )}

            </div>
          </ConfigProvider>
        </div>
      </div>
    </div>
  )
}
