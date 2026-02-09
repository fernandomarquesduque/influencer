import { useState, useEffect } from 'react'
import { Form, Input, Button, Card, message, Alert } from 'antd'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth, type AuthUser } from '../contexts/AuthContext'
import { requestVerificationCode, verifyProfile, extractProfileToBackend } from '../api'
import { SafetyCertificateOutlined, MessageOutlined, UserOutlined, RocketOutlined } from '@ant-design/icons'

const INSTALL_PHRASES = [
  'Verificando se o perfil é elegível...',
  'Analisando seu perfil no Instagram...',
  'Conectando aos nossos sistemas...',
  'Preparando seu código de acesso...',
  'Validando requisitos do programa...',
  'Quase lá, não feche esta janela...',
  'Configurando sua conta de influenciador...',
  'Tudo certo por aqui, aguarde...',
]

const INSTALL_DURATION_MS = 30_000 // barra avança ao longo de ~30 segundos

function InstallationLoader() {
  const [phraseIndex, setPhraseIndex] = useState(0)
  const [progress, setProgress] = useState(0)
  const [startTime] = useState(() => Date.now())

  useEffect(() => {
    const phraseInterval = setInterval(() => {
      setPhraseIndex((i) => (i + 1) % INSTALL_PHRASES.length)
    }, 2200)
    return () => clearInterval(phraseInterval)
  }, [])

  useEffect(() => {
    const progressInterval = setInterval(() => {
      const elapsed = Date.now() - startTime
      setProgress(Math.min(95, (elapsed / INSTALL_DURATION_MS) * 95))
    }, 250)
    return () => clearInterval(progressInterval)
  }, [startTime])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'linear-gradient(145deg, #0d0d12 0%, #1a1a2e 50%, #0f0f1a 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        fontFamily: "'Segoe UI', system-ui, sans-serif",
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          textAlign: 'center',
        }}
      >
        <div
          style={{
            fontSize: 48,
            marginBottom: 24,
            filter: 'drop-shadow(0 0 12px rgba(114, 46, 209, 0.5))',
          }}
        >
          <RocketOutlined style={{ color: '#a78bfa' }} />
        </div>
        <h2
          style={{
            color: '#e2e8f0',
            fontSize: 18,
            fontWeight: 600,
            marginBottom: 32,
            letterSpacing: '0.02em',
          }}
        >
          Preparando seu cadastro
        </h2>
        <p
          style={{
            color: '#94a3b8',
            fontSize: 15,
            minHeight: 24,
            marginBottom: 28,
            transition: 'opacity 0.3s ease',
          }}
        >
          {INSTALL_PHRASES[phraseIndex]}
        </p>
        <div
          style={{
            height: 6,
            background: 'rgba(255,255,255,0.08)',
            borderRadius: 3,
            overflow: 'hidden',
            marginBottom: 8,
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${progress}%`,
              background: 'linear-gradient(90deg, #7c3aed, #a78bfa)',
              borderRadius: 3,
              transition: 'width 0.35s ease',
            }}
          />
        </div>
        <p style={{ color: '#64748b', fontSize: 12 }}>
          {Math.round(progress)}%
        </p>
      </div>
    </div>
  )
}

export default function Auth() {
  const { user, refreshUser, loginWithToken } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [step, setStep] = useState<'nickname' | 'code'>('nickname')
  const [nickname, setNickname] = useState('')
  const [loading, setLoading] = useState(false)
  const [showInstallLoader, setShowInstallLoader] = useState(false)
  const [rejectionError, setRejectionError] = useState<string | null>(null)
  const [form] = Form.useForm()

  const savedNickname = (location.state as { nickname?: string })?.nickname
  useEffect(() => {
    if (savedNickname && form) {
      form.setFieldsValue({ nickname: savedNickname })
    }
  }, [savedNickname, form])

  const onRequestCode = async (values: { nickname: string }) => {
    const n = (values.nickname ?? '').replace(/^@/, '').trim()
    if (!n) return
    setRejectionError(null)
    setLoading(true)
    setShowInstallLoader(true)
    try {
      const extractResult = await extractProfileToBackend(n)
      if (extractResult.saved === false) {
        setRejectionError(extractResult.rejectionReason ?? extractResult.error ?? 'Perfil não elegível.')
        return
      }
      const data = await requestVerificationCode(n)
      setNickname(n)
      setStep('code')
      form.setFieldValue('code', data.code ?? '')
      if (data.sent) {
        message.success('Código enviado! Confira sua caixa de entrada do Instagram (direct).')
      } else if (data.code) {
        message.warning(data.error ?? 'DM não enviada. Use o código abaixo para testar.')
      } else if (data.error) {
        message.warning(data.error)
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Falha ao extrair perfil ou enviar código')
    } finally {
      setLoading(false)
      setShowInstallLoader(false)
    }
  }

  const onVerify = async (values: { code: string }) => {
    const code = (values.code ?? '').trim()
    if (!code || !nickname) return
    setLoading(true)
    try {
      const data = await verifyProfile(nickname, code)
      if (data.token && data.user) {
        loginWithToken(data.token, data.user as AuthUser)
        message.success('Entrada feita! Perfil validado.')
      } else {
        await refreshUser()
        message.success('Perfil validado com sucesso!')
      }
      navigate('/create/password', { state: { handle: nickname }, replace: true })
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Código inválido ou expirado')
    } finally {
      setLoading(false)
    }
  }

  const startOver = () => {
    setStep('nickname')
    setNickname('')
    setRejectionError(null)
    form.resetFields()
  }

  return (
    <>
      {showInstallLoader && <InstallationLoader />}

      <div
        style={{
          minHeight: '100vh',
          background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)',
          padding: '40px 16px 48px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <div style={{ maxWidth: 440, width: '100%' }}>
          {/* Hero para primeiro passo */}
          {step === 'nickname' && (
            <div style={{ textAlign: 'center', marginBottom: 28 }}>
              <div
                style={{
                  width: 64,
                  height: 64,
                  margin: '0 auto 16px',
                  borderRadius: 16,
                  background: 'linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 8px 24px rgba(124, 58, 237, 0.35)',
                }}
              >
                <RocketOutlined style={{ fontSize: 28, color: '#fff' }} />
              </div>
              <h1
                style={{
                  fontSize: 26,
                  fontWeight: 700,
                  color: '#1e293b',
                  margin: 0,
                  lineHeight: 1.3,
                  letterSpacing: '-0.02em',
                }}
              >
                Faça parte do programa de influenciadores
              </h1>
              <p
                style={{
                  fontSize: 16,
                  color: '#64748b',
                  marginTop: 12,
                  lineHeight: 1.5,
                }}
              >
                Valide seu perfil do Instagram em poucos passos e comece a receber ofertas de marcas.
              </p>
            </div>
          )}

          <Card
            title={
              step === 'nickname' ? (
                <span style={{ fontSize: 16, fontWeight: 600 }}>
                  <UserOutlined style={{ marginRight: 8, color: '#7c3aed' }} />
                  Começar cadastro
                </span>
              ) : (
                <span>
                  <SafetyCertificateOutlined style={{ marginRight: 8 }} />
                  Validar perfil Instagram
                </span>
              )
            }
            style={{
              boxShadow: '0 4px 20px rgba(0,0,0,.08)',
              borderRadius: 16,
              overflow: 'hidden',
            }}
            styles={{ body: { paddingTop: step === 'nickname' ? 8 : 24 } }}
          >
            {user?.profile_handle && step === 'nickname' && (
              <div style={{ marginBottom: 16, padding: 12, background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 12 }}>
                <p style={{ margin: 0, color: '#166534' }}>
                  Você já validou o perfil <strong>@{user.profile_handle}</strong>.
                </p>
                <div style={{ marginTop: 8 }}>
                  <Button type="primary" size="small" onClick={() => navigate(`/activate/${user.profile_handle}`)}>
                    Continuar
                  </Button>
                  <Button type="link" size="small" onClick={startOver} style={{ marginLeft: 8 }}>
                    Validar outro perfil
                  </Button>
                </div>
              </div>
            )}

            {step === 'nickname' && (
              <>
                {rejectionError && (
                  <Alert
                    type="error"
                    message={rejectionError}
                    closable
                    onClose={() => setRejectionError(null)}
                    style={{ marginBottom: 16, borderRadius: 8 }}
                  />
                )}
                <p style={{ color: '#64748b', marginBottom: 20, fontSize: 14, lineHeight: 1.5 }}>
                  Digite seu <strong>@ do Instagram</strong>. Enviamos um código de ativação por <strong>mensagem direta</strong> no Instagram.
                </p>
                <Form form={form} name="request-code" onFinish={onRequestCode} layout="vertical" requiredMark={false}>
                  <Form.Item name="nickname" label="Seu nickname no Instagram" rules={[{ required: true, message: 'Informe seu @ do Instagram' }]}>
                    <Input
                      prefix={<UserOutlined style={{ color: '#94a3b8' }} />}
                      placeholder="ex: seu_usuario"
                      size="large"
                      autoComplete="username"
                      style={{ borderRadius: 10 }}
                    />
                  </Form.Item>
                  <Form.Item style={{ marginBottom: 0 }}>
                    <Button
                      type="primary"
                      htmlType="submit"
                      loading={loading && !showInstallLoader}
                      block
                      size="large"
                      icon={<MessageOutlined />}
                      style={{ height: 48, borderRadius: 10, fontWeight: 600 }}
                    >
                      Enviar código por mensagem no Instagram
                    </Button>
                  </Form.Item>
                </Form>
              </>
            )}

            {step === 'code' && (
              <>
                <div style={{ marginBottom: 16, padding: 14, background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: 12 }}>
                  <p style={{ margin: 0, color: '#1e40af', fontSize: 14 }}>
                    Enviamos um código de 6 dígitos por <strong>mensagem no Instagram</strong> para <strong>@{nickname}</strong>. Confira o Direct e digite abaixo.
                  </p>
                </div>
                <Form form={form} name="verify" onFinish={onVerify} layout="vertical" requiredMark={false}>
                  <Form.Item label="Nickname">
                    <Input value={`@${nickname}`} disabled size="large" style={{ borderRadius: 10 }} />
                  </Form.Item>
                  <Form.Item
                    name="code"
                    label="Código de ativação"
                    rules={[{ required: true, message: 'Informe o código' }, { len: 6, message: 'O código tem 6 dígitos' }]}
                  >
                    <Input
                      placeholder="000000"
                      size="large"
                      maxLength={6}
                      autoComplete="one-time-code"
                      style={{ letterSpacing: 8, textAlign: 'center', fontSize: 18, borderRadius: 10 }}
                    />
                  </Form.Item>
                  <Form.Item>
                    <Button
                      type="primary"
                      htmlType="submit"
                      loading={loading}
                      block
                      size="large"
                      icon={<SafetyCertificateOutlined />}
                      style={{ height: 48, borderRadius: 10, fontWeight: 600 }}
                    >
                      Validar perfil
                    </Button>
                  </Form.Item>
                  <Form.Item style={{ marginBottom: 0 }}>
                    <Button type="link" block onClick={startOver} style={{ padding: 0 }}>
                      Usar outro nickname
                    </Button>
                  </Form.Item>
                </Form>
              </>
            )}
          </Card>
        </div>
      </div>
    </>
  )
}
