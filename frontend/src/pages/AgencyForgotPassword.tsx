import { useState } from 'react'
import { App, Form, Input, Button, Typography, Space, Divider, Alert, ConfigProvider } from 'antd'
import { useNavigate } from 'react-router-dom'
import { MailOutlined, LockOutlined, ArrowLeftOutlined, SafetyOutlined } from '@ant-design/icons'
import Logo from '../components/Logo'
import LoginCtaButton from '../components/LoginCtaButton/LoginCtaButton'
import {
  requestAgencyPasswordReset,
  verifyAgencyPasswordResetCode,
  completeAgencyPasswordReset,
} from '../api'

const { Title, Text } = Typography

type Step = 'email' | 'code' | 'password'

const fi = { marginBottom: 8 }

export default function AgencyForgotPassword() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [resetToken, setResetToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [emailForm] = Form.useForm<{ email: string }>()
  const [passwordForm] = Form.useForm<{ password: string; confirm: string }>()
  const [otp, setOtp] = useState('')

  const goLogin = () => navigate('/login')

  const onRequestCode = async (values: { email: string }) => {
    const e = values.email.trim().toLowerCase()
    setError(null)
    setLoading(true)
    try {
      await requestAgencyPasswordReset(e)
      setEmail(e)
      setStep('code')
      setOtp('')
      message.success(
        'Se existir uma conta com este e-mail, enviamos um código de 6 dígitos. Verifique a caixa de entrada e o spam.',
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível enviar o código.')
    } finally {
      setLoading(false)
    }
  }

  const onVerifyCode = async () => {
    const code = otp.replace(/\D/g, '')
    if (code.length !== 6) {
      setError('Digite os 6 dígitos do código.')
      return
    }
    setError(null)
    setLoading(true)
    try {
      const { resetToken: token } = await verifyAgencyPasswordResetCode(email, code)
      setResetToken(token)
      setStep('password')
      message.success('Código confirmado. Defina sua nova senha.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Código inválido.')
    } finally {
      setLoading(false)
    }
  }

  const onSetPassword = async (values: { password: string; confirm: string }) => {
    if (values.password !== values.confirm) {
      message.error('As senhas não conferem.')
      return
    }
    if (!resetToken) {
      message.error('Sessão expirada. Comece de novo pelo código.')
      setStep('email')
      return
    }
    setError(null)
    setLoading(true)
    try {
      await completeAgencyPasswordReset(resetToken, values.password)
      message.success('Senha alterada. Faça login com a nova senha.')
      navigate('/login', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível alterar a senha.')
    } finally {
      setLoading(false)
    }
  }

  const leftCopy =
    step === 'email'
      ? {
        title: 'Recuperar acesso',
        lead: 'Informe o e-mail da sua conta. Enviaremos um código para você confirmar a identidade antes de criar uma nova senha.',
      }
      : step === 'code'
        ? {
          title: 'Verificação',
          lead: `Enviamos um código de 6 dígitos para ${email}. Ele expira em poucos minutos.`,
        }
        : {
          title: 'Nova senha',
          lead: 'Escolha uma senha forte e que você não use em outros sites.',
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
                  {leftCopy.title}
                </Title>
                <Text style={{ fontSize: 13, lineHeight: 1.5, color: '#374151', display: 'block' }}>
                  {leftCopy.lead}
                </Text>
              </div>
              <Button
                type="link"
                icon={<ArrowLeftOutlined />}
                onClick={goLogin}
                style={{ padding: 0, fontWeight: 600, color: 'var(--app-primary)', alignSelf: 'flex-start' }}
              >
                Voltar ao login
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
                  {step === 'email' && 'Informe seu e-mail cadastrado'}
                  {step === 'code' && 'Digite o código de 6 dígitos'}
                  {step === 'password' && 'Nova senha da conta'}
                </Text>
              </Space>
              <Divider style={{ margin: '6px 0 10px' }} />

              {error && (
                <Alert
                  type="error"
                  message={error}
                  showIcon
                  closable
                  onClose={() => setError(null)}
                  style={{ marginBottom: 8, padding: '4px 8px' }}
                />
              )}

              {step === 'email' && (
                <Form form={emailForm} layout="vertical" requiredMark={false} onFinish={onRequestCode}>
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
                      autoComplete="email"
                      style={{ borderRadius: 8 }}
                    />
                  </Form.Item>
                  <LoginCtaButton
                    ctaColor="agency"
                    htmlType="submit"
                    loading={loading}
                    leadingIcon={<MailOutlined aria-hidden />}
                  >
                    Enviar código
                  </LoginCtaButton>
                </Form>
              )}

              {step === 'code' && (
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <Input.OTP
                      length={6}
                      value={otp}
                      onChange={(v) => setOtp(v)}
                      size="large"
                      formatter={(str) => str.replace(/\D/g, '')}
                    />
                  </div>
                  <LoginCtaButton
                    ctaColor="agency"
                    onClick={() => void onVerifyCode()}
                    loading={loading}
                    leadingIcon={<SafetyOutlined aria-hidden />}
                  >
                    Confirmar código
                  </LoginCtaButton>
                  <Button type="link" block onClick={() => setStep('email')} style={{ fontSize: 12 }}>
                    Usar outro e-mail
                  </Button>
                </Space>
              )}

              {step === 'password' && (
                <Form form={passwordForm} layout="vertical" requiredMark={false} onFinish={onSetPassword}>
                  <Form.Item
                    name="password"
                    label="Nova senha"
                    style={fi}
                    rules={[
                      { required: true, message: 'Informe a nova senha.' },
                      { min: 6, message: 'Mínimo 6 caracteres.' },
                    ]}
                  >
                    <Input.Password
                      className="login-input"
                      prefix={<LockOutlined style={{ color: 'var(--app-text-tertiary)', fontSize: 14 }} />}
                      placeholder="Mín. 6 caracteres"
                      autoComplete="new-password"
                      style={{ borderRadius: 8 }}
                    />
                  </Form.Item>
                  <Form.Item
                    name="confirm"
                    label="Confirmar senha"
                    style={fi}
                    dependencies={['password']}
                    rules={[
                      { required: true, message: 'Repita a senha.' },
                      ({ getFieldValue }) => ({
                        validator(_, value) {
                          if (!value || getFieldValue('password') === value) return Promise.resolve()
                          return Promise.reject(new Error('As senhas não conferem.'))
                        },
                      }),
                    ]}
                  >
                    <Input.Password
                      className="login-input"
                      prefix={<LockOutlined style={{ color: 'var(--app-text-tertiary)', fontSize: 14 }} />}
                      placeholder="Mesma senha"
                      autoComplete="new-password"
                      style={{ borderRadius: 8 }}
                    />
                  </Form.Item>
                  <LoginCtaButton
                    ctaColor="agency"
                    htmlType="submit"
                    loading={loading}
                    leadingIcon={<LockOutlined aria-hidden />}
                  >
                    Salvar nova senha
                  </LoginCtaButton>
                </Form>
              )}

              <div style={{ marginTop: 16, textAlign: 'center' }}>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  <span
                    style={{ cursor: 'pointer' }}
                    onClick={() => {
                      window.location.href = '/'
                    }}
                  >
                    Voltar ao site
                  </span>
                </Text>
              </div>
            </div>
          </ConfigProvider>
        </div>
      </div>
    </div>
  )
}
