import { useState, useEffect } from 'react'
import { Form, Input, Button, Card, message, Collapse } from 'antd'
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { useAuth, type AuthUser } from '../contexts/AuthContext'
import { requestCodeWithExtract, verifyProfile, type ExtractProfileResult } from '../api'
import { SafetyCertificateOutlined, MessageOutlined, UserOutlined, RocketOutlined, ExclamationCircleOutlined, InstagramOutlined, ReloadOutlined } from '@ant-design/icons'

const REJECTION_REASON_LABELS: Record<string, string> = {
  nao_segue_perfil: '', // tratado por bloco especial no RejectionFullScreen
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

/** Tela inteira: perfil não elegível + todas as regras + botão Voltar. */
function RejectionFullScreen({
  result,
  onUnderstood,
  onRetry,
}: {
  result: ExtractProfileResult
  onUnderstood: () => void
  onRetry?: (handle: string) => void
}) {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  const isFollowRequired = result.rejectionReason === 'nao_segue_perfil' && result.followProfileUrl
  const followProfileHandle = result.followProfileUrl
    ? (result.followProfileUrl.replace(/\/$/, '').split('/').pop() ?? '')
    : ''
  const reasonText = result.rejectionReason
    ? (REJECTION_REASON_LABELS[result.rejectionReason] ?? result.rejectionReason)
    : result.error ?? 'Perfil não atende aos critérios do programa.'

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'var(--app-bg)',
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
      <style>{`
        @keyframes auth-follow-pulse {
          0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(131, 58, 180, 0.4); }
          50% { transform: scale(1.03); box-shadow: 0 0 0 8px rgba(131, 58, 180, 0); }
        }
        .auth-follow-btn-pulse {
          animation: auth-follow-pulse 1.5s ease-in-out infinite;
        }
      `}</style>
      <div
        style={{
          width: '100%',
          maxWidth: 520,
          marginBottom: 20,
        }}
      >
        {isFollowRequired ? (
          <>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div
                style={{
                  width: 64,
                  height: 64,
                  margin: '0 auto 16px',
                  borderRadius: 16,
                  background: 'linear-gradient(135deg, var(--app-info-bg) 0%, rgba(104, 39, 143, 0.08) 100%)',
                  border: '1px solid var(--app-info-border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <InstagramOutlined style={{ fontSize: 28, color: 'var(--brand-primary)' }} />
              </div>
              <h1
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  color: 'var(--app-text)',
                  margin: '0 0 8px',
                  letterSpacing: '-0.02em',
                }}
              >
                Quase lá! Só falta um passinho
              </h1>
              <p style={{ fontSize: 15, color: 'var(--app-text-secondary)', margin: 0, lineHeight: 1.5 }}>
                Segue o{' '}
                <a
                  href={result.followProfileUrl!}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--app-primary)', fontWeight: 600, textDecoration: 'none' }}
                >
                  @{followProfileHandle}
                </a>
                {' '}no Insta para mandarmos código de acesso na DM.
              </p>
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
              <a
                href={result.followProfileUrl!}
                target="_blank"
                rel="noopener noreferrer"
                className="auth-follow-btn-pulse"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  padding: '8px 14px',
                  borderRadius: 20,
                  background: 'linear-gradient(135deg, #833AB4 0%, #FD1D1D 50%, #F77737 100%)',
                  color: '#fff',
                  fontWeight: 500,
                  fontSize: 13,
                  textDecoration: 'none',
                }}
              >
                <InstagramOutlined style={{ fontSize: 14 }} />
                Seguir Perfil
              </a>
            </div>
            <p style={{ fontSize: 13, color: 'var(--app-text-tertiary)', textAlign: 'center', margin: 0, marginBottom: 16 }}>
              Depois de seguir, volte aqui e tente novamente.
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
              <Button
                type="primary"
                size="large"
                onClick={() => (onRetry ? onRetry(result.handle) : onUnderstood())}
                style={{
                  height: 48,
                  minWidth: 200,
                  borderRadius: 10,
                  fontWeight: 600,
                  fontSize: 15,
                  background: 'var(--app-primary)',
                  border: 'none',
                }}
              >
                <ReloadOutlined style={{ marginRight: 8 }} />
                Já Sigo, Tentar novamente
              </Button>
            </div>
          </>
        ) : (
          <>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <ExclamationCircleOutlined style={{ fontSize: 44, color: 'var(--app-warning-accent)' }} />
              <h1
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: 'var(--app-text)',
                  margin: '12px 0 4px',
                  letterSpacing: '-0.02em',
                }}
              >
                Perfil não elegível
              </h1>
              <p style={{ fontSize: 13, color: 'var(--app-text-secondary)', margin: 0 }}>
                @{result.handle} não atende aos critérios do programa.
              </p>
            </div>
            <div
              style={{
                background: 'var(--app-alert-danger-bg)',
                border: '1px solid var(--app-alert-danger-border)',
                borderRadius: 10,
                padding: '12px 14px',
                marginBottom: 16,
              }}
            >
              <strong style={{ color: 'var(--app-danger-accent)', fontSize: 12 }}>Motivo:</strong>{' '}
              <span style={{ color: 'var(--app-text-secondary)', fontSize: 12 }}>{reasonText}</span>
              {result.diagnostic && result.diagnostic.minRequired != null && (
                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--app-text-secondary)' }}>
                  Mínimo exigido: {result.diagnostic.minRequired.toLocaleString('pt-BR')}
                </div>
              )}
            </div>
          </>
        )}

        <Collapse
          size="small"
          style={{
            marginBottom: 20,
            background: 'var(--app-card-bg)',
            border: '1px solid var(--app-border)',
            borderRadius: 10,
          }}
          items={[
            {
              key: 'regras',
              label: (
                <span style={{ color: 'var(--app-text)', fontWeight: 600, fontSize: 13 }}>
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
                      color: 'var(--app-text-secondary)',
                    }}
                  >
                    <li>É obrigatório <strong style={{ color: 'var(--app-text)' }}>seguir o perfil oficial do programa</strong> no Instagram para receber o código de ativação por mensagem direta (2FA).</li>
                    <li>O perfil precisa ser <strong style={{ color: 'var(--app-text)' }}>público</strong> (não aceitamos perfis privados).</li>
                    <li>O perfil deve ser de <strong style={{ color: 'var(--app-text)' }}>pessoa ou criador</strong> (não aceitamos contas de empresa ou estabelecimentos como bares, restaurantes, lojas).</li>
                    <li><strong style={{ color: 'var(--app-text)' }}>Conta pessoal</strong>: é exigido o dobro do mínimo de seguidores configurado no programa.</li>
                    <li><strong style={{ color: 'var(--app-text)' }}>Conta criador</strong>: é exigido o mínimo de seguidores configurado.</li>
                    <li>Se o tipo de conta não for identificado, é exigido o triplo do mínimo de seguidores.</li>
                    <li>O perfil não pode ser classificado como <strong style={{ color: 'var(--app-text)' }}>estabelecimento comercial</strong> (categoria, nome ou tipo de conta indicando negócio).</li>
                    <li>Quando há regra de curtidas, é necessário ter <strong style={{ color: 'var(--app-text)' }}>pelo menos um post</strong> com o número mínimo de curtidas exigido.</li>
                  </ul>
                </div>
              ),
            },
          ]}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <Button
          type="default"
          size="middle"
          onClick={onUnderstood}
          style={{
            height: 40,
            minWidth: 100,
            borderRadius: 10,
            fontWeight: 500,
            fontSize: 13,
            color: 'var(--app-text-secondary)',
            borderColor: 'var(--app-border)',
            background: 'transparent',
          }}
        >
          Voltar
        </Button>
      </div>
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
      className="install-loader"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'linear-gradient(135deg, #f8f4ff 0%, #fff9e6 35%, #f0ebff 70%, #fdf6e8 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        fontFamily: "'Segoe UI', system-ui, sans-serif",
        overflow: 'hidden',
      }}
    >
      {/* Blobs decorativos de fundo */}
      <div
        style={{
          position: 'absolute',
          width: 320,
          height: 320,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(104, 39, 143, 0.12) 0%, transparent 70%)',
          top: '-10%',
          left: '-5%',
          animation: 'install-blob-float 8s ease-in-out infinite',
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: 280,
          height: 280,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(232, 186, 0, 0.15) 0%, transparent 70%)',
          bottom: '-8%',
          right: '-5%',
          animation: 'install-blob-float 10s ease-in-out infinite reverse',
          animationDelay: '1s',
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: 180,
          height: 180,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(89, 128, 228, 0.12) 0%, transparent 70%)',
          top: '40%',
          right: '15%',
          animation: 'install-blob-float 12s ease-in-out infinite',
          animationDelay: '2s',
        }}
      />

      <div
        style={{
          width: '100%',
          maxWidth: 440,
          textAlign: 'center',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {/* Card com vidro */}
        <div
          style={{
            background: 'rgba(255, 255, 255, 0.85)',
            backdropFilter: 'blur(12px)',
            borderRadius: 24,
            padding: '40px 32px 36px',
            boxShadow: '0 8px 32px rgba(104, 39, 143, 0.08), 0 2px 12px rgba(232, 186, 0, 0.06)',
            border: '1px solid rgba(255, 255, 255, 0.9)',
          }}
        >
          {/* Ícone com anel e animação */}
          <div
            style={{
              width: 88,
              height: 88,
              margin: '0 auto 28px',
              borderRadius: '50%',
              background: 'linear-gradient(145deg, #68278f 0%, #8b3db5 50%, #5980e4 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 12px 28px rgba(104, 39, 143, 0.35), 0 0 0 4px rgba(232, 186, 0, 0.2)',
              animation: 'install-rocket-pulse 2.5s ease-in-out infinite',
            }}
          >
            <RocketOutlined
              style={{
                fontSize: 40,
                color: '#fff',
                filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))',
              }}
            />
          </div>

          <h2
            style={{
              color: '#2d1b4e',
              fontSize: 22,
              fontWeight: 700,
              marginBottom: 12,
              letterSpacing: '-0.02em',
            }}
          >
            Preparando seu cadastro
          </h2>
          <p
            style={{
              background: 'linear-gradient(90deg, #68278f, #8b3db5, #e8ba00)',
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              color: 'transparent',
              fontSize: 15,
              fontWeight: 500,
              minHeight: 24,
              marginBottom: 28,
              transition: 'opacity 0.4s ease',
            }}
          >
            {INSTALL_PHRASES[phraseIndex]}
          </p>

          {/* Barra de progresso elegante */}
          <div
            style={{
              height: 10,
              background: 'linear-gradient(90deg, rgba(104, 39, 143, 0.12), rgba(232, 186, 0, 0.15))',
              borderRadius: 10,
              overflow: 'hidden',
              marginBottom: 12,
              boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.06)',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${progress}%`,
                background: 'linear-gradient(90deg, #68278f 0%, #8b3db5 50%, #e8ba00 100%)',
                borderRadius: 10,
                transition: 'width 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: '0 0 12px rgba(104, 39, 143, 0.4)',
              }}
            />
          </div>
          <p
            style={{
              color: '#6b5b7a',
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: '0.05em',
            }}
          >
            {Math.round(progress)}%
          </p>
        </div>
      </div>

      <style>{`
        @keyframes install-blob-float {
          0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.8; }
          50% { transform: translate(12px, -12px) scale(1.05); opacity: 1; }
        }
        @keyframes install-rocket-pulse {
          0%, 100% { transform: scale(1); box-shadow: 0 12px 28px rgba(104, 39, 143, 0.35), 0 0 0 4px rgba(232, 186, 0, 0.2); }
          50% { transform: scale(1.03); box-shadow: 0 14px 32px rgba(104, 39, 143, 0.45), 0 0 0 6px rgba(232, 186, 0, 0.15); }
        }
      `}</style>
    </div>
  )
}

export default function Auth() {
  const { user, refreshUser, loginWithToken, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const [step, setStep] = useState<'nickname' | 'code'>('nickname')
  const [nickname, setNickname] = useState('')
  const [loading, setLoading] = useState(false)
  const [showInstallLoader, setShowInstallLoader] = useState(false)
  const [rejectionInfo, setRejectionInfo] = useState<ExtractProfileResult | null>(null)
  const [form] = Form.useForm()

  const fromState = (location.state as { nickname?: string })?.nickname
  const fromQuery = searchParams.get('u') || searchParams.get('@')
  const savedNickname = fromState || (fromQuery ? fromQuery.replace(/^@/, '').trim().toLowerCase() : undefined)

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
      const data = await requestCodeWithExtract(n)
      if (data.rejectionReason === 'nao_segue_perfil') {
        setRejectionInfo({ success: false, handle: n, rejectionReason: 'nao_segue_perfil', followProfileUrl: data.followProfileUrl })
        return
      }
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
      const err = e instanceof Error ? e.message : 'Falha ao extrair perfil ou enviar código'
      message.error(err)
      setRejectionInfo({ success: false, handle: n, error: err })
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
      navigate('/app/create/password', { state: { handle: nickname }, replace: true })
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
    // Limpa URL e state para savedNickname não repopular o formulário com o @ anterior
    navigate('/app/create', { replace: true, state: {} })
  }

  const retryRequestCode = async (handle: string) => {
    const n = handle.replace(/^@/, '').trim()
    if (!n) return
    setRejectionInfo(null)
    setLoading(true)
    setShowInstallLoader(true)
    try {
      const data = await requestCodeWithExtract(n)
      if (data.rejectionReason === 'nao_segue_perfil') {
        setRejectionInfo({ success: false, handle: n, rejectionReason: 'nao_segue_perfil', followProfileUrl: data.followProfileUrl })
        return
      }
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
      const err = e instanceof Error ? e.message : 'Falha ao extrair perfil ou enviar código'
      message.error(err)
      setRejectionInfo({ success: false, handle: n, error: err })
    } finally {
      setLoading(false)
      setShowInstallLoader(false)
    }
  }

  const validateAnotherProfile = () => {
    logout()
    startOver()
  }

  return (
    <>
      {showInstallLoader && <InstallationLoader />}
      {rejectionInfo && (
        <RejectionFullScreen result={rejectionInfo} onUnderstood={startOver} onRetry={retryRequestCode} />
      )}

      <div
        style={{
          minHeight: '100vh',
          background: 'var(--app-bg)',
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
                  background: 'var(--app-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: 'var(--app-shadow-cta)',
                }}
              >
                <RocketOutlined style={{ fontSize: 28, color: 'var(--brand-white)' }} />
              </div>
              <h1
                style={{
                  fontSize: 26,
                  fontWeight: 700,
                  color: 'var(--app-text)',
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
                  color: 'var(--app-text-secondary)',
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
                  <UserOutlined style={{ marginRight: 8, color: 'var(--app-primary)' }} />
                  Começar cadastro
                </span>
              ) : (
                <span>
                  <SafetyCertificateOutlined style={{ marginRight: 8 }} />
                  Validar perfil Instagram
                </span>
              )
            }
            style={{ overflow: 'hidden' }}
            styles={{ body: { paddingTop: step === 'nickname' ? 8 : 24 } }}
          >
            {user?.profile_handle && step === 'nickname' && (
              <div style={{ marginBottom: 16, padding: 12, background: 'var(--app-alert-success-bg)', border: '1px solid var(--app-alert-success-border)', borderRadius: 12 }}>
                <p style={{ margin: 0, color: 'var(--app-alert-success-text)' }}>
                  Você já validou o perfil <strong>@{user.profile_handle}</strong>.
                </p>
                <div style={{ marginTop: 8 }}>
                  <Button type="primary" size="small" onClick={() => navigate(`/activate/${user.profile_handle}`)}>
                    Continuar
                  </Button>
                  <Button type="link" size="small" onClick={validateAnotherProfile} style={{ marginLeft: 8 }}>
                    Validar outro perfil
                  </Button>
                </div>
              </div>
            )}

            {!user?.profile_handle && step === 'nickname' && (
              <>
                <p style={{ color: 'var(--app-text-secondary)', marginBottom: 20, fontSize: 14, lineHeight: 1.5 }}>
                  Digite seu <strong>@ do Instagram</strong>. Enviamos um código de ativação por <strong>mensagem direta</strong> no Instagram.
                </p>
                <Form form={form} name="request-code" onFinish={onRequestCode} layout="vertical" requiredMark={false}>
                  <Form.Item name="nickname" label="Seu nickname no Instagram" rules={[{ required: true, message: 'Informe seu @ do Instagram' }]}>
                    <Input
                      prefix={<UserOutlined style={{ color: 'var(--app-text-tertiary)' }} />}
                      placeholder="ex: seu_usuario"
                      size="large"
                      autoComplete="username"
                      style={{ borderRadius: 10 }}
                      autoFocus
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
                      Cadastrar Instagram
                    </Button>
                  </Form.Item>
                </Form>
              </>
            )}

            {step === 'code' && (
              <>
                <div style={{ marginBottom: 16, padding: 14, background: 'var(--app-info-bg)', border: '1px solid var(--app-info-border)', borderRadius: 12 }}>
                  <p style={{ margin: 0, color: 'var(--app-info-text)', fontSize: 14 }}>
                    Enviamos um código de 6 dígitos por <strong style={{ color: 'var(--app-info-text-accent)' }}>mensagem no Instagram</strong> para <strong style={{ color: 'var(--app-info-text-accent)' }}>@{nickname}</strong>. Confira o Direct e digite abaixo.
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
                      type="number"
                      maxLength={6}
                      autoComplete="one-time-code"
                      style={{ letterSpacing: 8, textAlign: 'center', fontSize: 18, borderRadius: 10 }}
                      autoFocus
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
