import { useState, useEffect } from 'react'
import { Form, Input, Button, Card, message, Collapse } from 'antd'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth, type AuthUser } from '../contexts/AuthContext'
import { requestVerificationCode, verifyProfile, extractProfileToBackend, type ExtractProfileResult } from '../api'
import { SafetyCertificateOutlined, MessageOutlined, UserOutlined, RocketOutlined, ExclamationCircleOutlined } from '@ant-design/icons'

const REJECTION_REASON_LABELS: Record<string, string> = {
  nao_segue_perfil: 'É necessário seguir o perfil oficial do programa no Instagram para receber o código de ativação por mensagem direta.',
  perfil_privado: 'O perfil está privado; é necessário que seja público para participar do programa.',
  estabelecimento_comercial: 'Perfil classificado como estabelecimento comercial (ex.: bar, restaurante, loja).',
  conta_empresa: 'Conta do tipo empresa; aceitamos apenas perfis pessoais ou de criador.',
  conta_tipo_desconhecido: 'Tipo de conta não identificado como pessoa ou criador.',
  seguidores_abaixo_minimo: 'Número de seguidores abaixo do mínimo exigido para o seu tipo de conta.',
  nenhum_post_com_curtidas_minimas: 'Nenhum post com o mínimo de curtidas exigido.',
}

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

/** Tela inteira: perfil não elegível + todas as regras + botão Entendi. */
function RejectionFullScreen({
  result,
  onUnderstood,
}: {
  result: ExtractProfileResult
  onUnderstood: () => void
}) {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  const reasonText = result.rejectionReason
    ? (REJECTION_REASON_LABELS[result.rejectionReason] ?? result.rejectionReason)
    : result.error ?? 'Perfil não atende aos critérios do programa.'

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: '#f8fafc',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        fontFamily: "'Segoe UI', system-ui, sans-serif",
        overflow: 'auto',
        overflowX: 'hidden',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 520,
          marginBottom: 20,
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <ExclamationCircleOutlined style={{ fontSize: 44, color: '#ca8a04' }} />
          <h1
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: '#1e293b',
              margin: '12px 0 4px',
              letterSpacing: '-0.02em',
            }}
          >
            Perfil não elegível
          </h1>
          <p style={{ fontSize: 13, color: '#475569', margin: 0 }}>
            @{result.handle} não atende aos critérios do programa.
          </p>
        </div>

        <div
          style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 10,
            padding: '12px 14px',
            marginBottom: 16,
          }}
        >
          <strong style={{ color: '#b91c1c', fontSize: 12 }}>Motivo:</strong>{' '}
          <span style={{ color: '#334155', fontSize: 12 }}>{reasonText}</span>
          {result.rejectionReason === 'nao_segue_perfil' && result.followProfileUrl && (
            <div style={{ marginTop: 10 }}>
              <a
                href={result.followProfileUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  color: '#7c3aed',
                  fontWeight: 600,
                  fontSize: 12,
                  textDecoration: 'none',
                }}
              >
                Abrir perfil e seguir →
              </a>
            </div>
          )}
          {result.diagnostic && result.diagnostic.minRequired != null && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#475569' }}>
              Mínimo exigido: {result.diagnostic.minRequired.toLocaleString('pt-BR')}
            </div>
          )}
        </div>

        <Collapse
          size="small"
          style={{
            marginBottom: 20,
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 10,
          }}
          items={[
            {
              key: 'regras',
              label: (
                <span style={{ color: '#1e293b', fontWeight: 600, fontSize: 13 }}>
                  Regras de elegibilidade do programa
                </span>
              ),
              children: (
                <div style={{ paddingTop: 2, paddingBottom: 2 }}>
                  <ul
                    style={{
                      margin: 0,
                      paddingLeft: 18,
                      lineHeight: 1.6,
                      fontSize: 12,
                      color: '#334155',
                    }}
                  >
                    <li>É obrigatório <strong style={{ color: '#0f172a' }}>seguir o perfil oficial do programa</strong> no Instagram para receber o código de ativação por mensagem direta (2FA).</li>
                    <li>O perfil precisa ser <strong style={{ color: '#0f172a' }}>público</strong> (não aceitamos perfis privados).</li>
                    <li>O perfil deve ser de <strong style={{ color: '#0f172a' }}>pessoa ou criador</strong> (não aceitamos contas de empresa ou estabelecimentos como bares, restaurantes, lojas).</li>
                    <li><strong style={{ color: '#0f172a' }}>Conta pessoal</strong>: é exigido o dobro do mínimo de seguidores configurado no programa.</li>
                    <li><strong style={{ color: '#0f172a' }}>Conta criador</strong>: é exigido o mínimo de seguidores configurado.</li>
                    <li>Se o tipo de conta não for identificado, é exigido o triplo do mínimo de seguidores.</li>
                    <li>O perfil não pode ser classificado como <strong style={{ color: '#0f172a' }}>estabelecimento comercial</strong> (categoria, nome ou tipo de conta indicando negócio).</li>
                    <li>Quando há regra de curtidas, é necessário ter <strong style={{ color: '#0f172a' }}>pelo menos um post</strong> com o número mínimo de curtidas exigido.</li>
                  </ul>
                </div>
              ),
            },
          ]}
        />
      </div>

      <Button
        type="primary"
        size="large"
        onClick={onUnderstood}
        style={{
          height: 44,
          minWidth: 140,
          borderRadius: 10,
          fontWeight: 600,
          fontSize: 14,
          background: 'linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%)',
          border: 'none',
        }}
      >
        Entendi
      </Button>
    </div>
  )
}

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
  const [rejectionInfo, setRejectionInfo] = useState<ExtractProfileResult | null>(null)
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
    setRejectionInfo(null)
    setLoading(true)
    setShowInstallLoader(true)
    try {
      const extractResult = await extractProfileToBackend(n)
      if (!extractResult.success) {
        setRejectionInfo(extractResult)
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
    setRejectionInfo(null)
    form.resetFields()
  }

  return (
    <>
      {showInstallLoader && <InstallationLoader />}
      {rejectionInfo && (
        <RejectionFullScreen result={rejectionInfo} onUnderstood={startOver} />
      )}

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
