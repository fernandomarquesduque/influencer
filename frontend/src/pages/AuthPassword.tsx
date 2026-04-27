import { useState } from 'react'
import { Form, Input, Button, message } from 'antd'
import { useNavigate, useLocation } from 'react-router-dom'
import { setMyPassword } from '../api'
import { LockOutlined, MessageOutlined } from '@ant-design/icons'
import { trackMetaPixel } from '../utils/metaPixel'

export default function AuthPassword() {
  const navigate = useNavigate()
  const location = useLocation()
  const handle = (location.state as { handle?: string })?.handle || ''
  const [loading, setLoading] = useState(false)
  const [form] = Form.useForm()

  if (!handle) {
    navigate('/app/create', { replace: true })
    return null
  }

  const onFinish = async (values: { password: string; confirmPassword: string }) => {
    if (values.password !== values.confirmPassword) {
      message.error('As duas senhas precisam ser iguais.')
      return
    }
    setLoading(true)
    try {
      await setMyPassword(values.password)
      trackMetaPixel('CompleteRegistration', { source: 'auth_password_created' })
      message.success('Senha criada. Te levando pro seu relatório...')
      navigate(`/app/influencer/${encodeURIComponent(handle)}`, { state: { fromSignup: true }, replace: true })
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Não deu pra criar a senha. Tenta de novo.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        padding: 24,
        background: 'linear-gradient(135deg, var(--app-card-bg-soft) 0%, var(--app-warning-bg) 25%, var(--app-primary-muted) 50%, var(--app-gold-light) 75%, var(--app-primary-muted) 100%)',
        backgroundAttachment: 'fixed',
        fontFamily: "'Segoe UI', system-ui, sans-serif",
      }}
    >
      {/* Blobs decorativos */}
      <div
        style={{
          position: 'absolute',
          width: 400,
          height: 400,
          borderRadius: '50%',
          background: 'radial-gradient(circle, var(--app-primary-muted) 0%, transparent 70%)',
          top: '-15%',
          right: '-10%',
          animation: 'auth-blob-float 12s ease-in-out infinite',
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: 320,
          height: 320,
          borderRadius: '50%',
          background: 'radial-gradient(circle, var(--app-warning-bg) 0%, transparent 70%)',
          bottom: '10%',
          left: '-8%',
          animation: 'auth-blob-float 10s ease-in-out infinite reverse',
          animationDelay: '2s',
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: 200,
          height: 200,
          borderRadius: '50%',
          background: 'radial-gradient(circle, var(--app-gold-light) 0%, transparent 70%)',
          top: '45%',
          left: '20%',
          animation: 'auth-blob-float 8s ease-in-out infinite',
          animationDelay: '1s',
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: 180,
          height: 180,
          borderRadius: '50%',
          background: 'radial-gradient(circle, var(--app-bg-blob1) 0%, transparent 70%)',
          bottom: '25%',
          right: '25%',
          animation: 'auth-blob-float 11s ease-in-out infinite',
          animationDelay: '0.5s',
        }}
      />

      <style>{`
        @keyframes auth-blob-float {
          0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.85; }
          50% { transform: translate(15px, -15px) scale(1.08); opacity: 1; }
        }
      `}</style>

      <div
        style={{
          width: '100%',
          maxWidth: 440,
          position: 'relative',
          zIndex: 1,
          background: 'var(--app-glass-bg)',
          backdropFilter: 'blur(14px)',
          borderRadius: 'var(--app-card-radius)',
          padding: '32px 28px 28px',
          boxShadow: 'var(--app-shadow-lg)',
          border: '1px solid var(--app-glass-border)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div
            style={{
              width: 64,
              height: 64,
              margin: '0 auto 16px',
              borderRadius: 20,
              background: 'linear-gradient(145deg, var(--app-primary) 0%, var(--app-primary-dark) 50%, var(--app-accent) 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: 'var(--app-shadow-lg)',
            }}
          >
            <LockOutlined style={{ fontSize: 28, color: 'var(--brand-white)' }} />
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--app-text)', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
            Cadastrar sua senha
          </h1>
          <p style={{ fontSize: 15, color: 'var(--app-text-secondary)', margin: 0, lineHeight: 1.5 }}>
            <strong style={{ color: 'var(--app-primary)' }}>@{handle}</strong> validado. Cria uma senha pra acessar quando quiser.
          </p>
        </div>

        <Form form={form} name="set-password" onFinish={onFinish} layout="vertical" requiredMark={false}>
          <Form.Item
            name="password"
            label={<span style={{ fontWeight: 600, color: 'var(--app-text)' }}>Senha</span>}
            rules={[
              { required: true, message: 'Coloca uma senha com no mínimo 6 caracteres.' },
              { min: 6, message: 'Coloca uma senha com no mínimo 6 caracteres.' },
            ]}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: 'var(--app-text-tertiary)' }} />}
              placeholder="Mín. 6 caracteres"
              size="large"
              autoComplete="new-password"
              autoFocus
              style={{ borderRadius: 12, borderColor: 'var(--app-border)' }}
            />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label={<span style={{ fontWeight: 600, color: 'var(--app-text)' }}>Repetir a senha</span>}
            dependencies={['password']}
            rules={[
              { required: true, message: 'Repete a senha.' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('password') === value) return Promise.resolve()
                  return Promise.reject(new Error('As duas senhas precisam ser iguais.'))
                },
              }),
            ]}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: 'var(--app-text-tertiary)' }} />}
              placeholder="Repete a mesma senha"
              size="large"
              autoComplete="new-password"
              style={{ borderRadius: 12, borderColor: 'var(--app-border)' }}
            />
          </Form.Item>
          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              block
              size="large"
              icon={<LockOutlined />}
              style={{
                height: 48,
                borderRadius: 14,
                fontWeight: 600,
                background: 'linear-gradient(90deg, var(--app-primary) 0%, var(--app-accent) 100%)',
                border: 'none',
                boxShadow: 'var(--app-shadow-md)',
              }}
            >
              Continuar
            </Button>
          </Form.Item>
          <div style={{ textAlign: 'center', marginTop: 12 }}>
            <Button
              type="link"
              size="small"
              icon={<MessageOutlined />}
              onClick={() => {
                trackMetaPixel('Lead', { source: 'auth_password_skip_dm' })
                navigate(`/app/influencer/${encodeURIComponent(handle)}`, { state: { fromSignup: true }, replace: true })
              }}
              style={{ color: 'var(--app-primary)', fontWeight: 600 }}
            >
              Pular e entrar por DM
            </Button>
          </div>
        </Form>
      </div>
    </div>
  )
}
