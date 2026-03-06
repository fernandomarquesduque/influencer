import { useState, useEffect, useRef } from 'react'
import { Form, Input, Button, Card, message, Collapse } from 'antd'
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { useAuth, type AuthUser } from '../contexts/AuthContext'
import { requestCodeWithExtract, verifyProfile, type ExtractProfileResult } from '../api'
import { SafetyCertificateOutlined, MessageOutlined, UserOutlined, RocketOutlined, InstagramOutlined, ReloadOutlined, EditOutlined, ArrowRightOutlined, ArrowLeftOutlined } from '@ant-design/icons'

const REJECTION_REASON_LABELS: Record<string, string> = {
  nao_segue_perfil: '', // tratado por bloco especial no RejectionFullScreen
  perfil_privado: 'Perfil precisa ser público. Marca não vê conteúdo de conta fechada.',
  estabelecimento_comercial: 'Conta de negócio (bar, loja, etc.). Só aceitamos perfil de criador ou pessoa.',
  conta_empresa: 'Essa conta é de empresa. Aqui entram só perfil pessoal ou criador.',
  conta_tipo_desconhecido: 'Não conseguimos identificar se é perfil de pessoa/criador.',
  seguidores_abaixo_minimo: 'Seguidores abaixo do mínimo do programa para seu tipo de conta.',
  nenhum_post_com_curtidas_minimas: 'Nenhum post atingiu o mínimo de curtidas que o programa pede.',
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

const ELIGIBILITY_RULES = (
  <ul
    style={{
      margin: 0,
      paddingLeft: 18,
      lineHeight: 1.6,
      fontSize: 12,
      color: 'var(--app-text-secondary)',
    }}
  >
    <li>Tem que <strong style={{ color: 'var(--app-text)' }}>seguir o perfil do programa</strong> no Instagram para receber o código na DM.</li>
    <li>O perfil precisa ser <strong style={{ color: 'var(--app-text)' }}>público</strong> (não aceitamos perfis privados).</li>
    <li>O perfil deve ser de <strong style={{ color: 'var(--app-text)' }}>pessoa ou criador</strong> (não aceitamos contas de empresa ou estabelecimentos como bares, restaurantes, lojas).</li>
    <li><strong style={{ color: 'var(--app-text)' }}>Conta pessoal</strong>: é exigido o dobro do mínimo de seguidores configurado no programa.</li>
    <li><strong style={{ color: 'var(--app-text)' }}>Conta criador</strong>: é exigido o mínimo de seguidores configurado.</li>
    <li>Se o tipo de conta não for identificado, é exigido o triplo do mínimo de seguidores.</li>
    <li>O perfil não pode ser classificado como <strong style={{ color: 'var(--app-text)' }}>estabelecimento comercial</strong> (categoria, nome ou tipo de conta indicando negócio).</li>
    <li>Quando há regra de curtidas, é necessário ter <strong style={{ color: 'var(--app-text)' }}>pelo menos um post</strong> com o número mínimo de curtidas exigido.</li>
  </ul>
)

/** Tela inteira: perfil não elegível + solução (colocar perfil correto) + regras. */
function RejectionFullScreen({
  result,
  onUnderstood,
  onRetry,
}: {
  result: ExtractProfileResult
  onUnderstood: () => void
  onRetry?: (handle: string) => void
}) {
  const [correctHandle, setCorrectHandle] = useState('')
  const [submitting, setSubmitting] = useState(false)

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

  const isNotFound = String(result.error ?? '').toLowerCase().includes('não encontrado') || String(reasonText).toLowerCase().includes('não encontrado')

  const handleTryCorrectProfile = async () => {
    const handle = correctHandle.replace(/^@/, '').trim().toLowerCase()
    if (!handle) return
    setSubmitting(true)
    try {
      onRetry?.(handle)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'linear-gradient(160deg, var(--app-card-bg-soft) 0%, var(--app-warning-bg) 40%, var(--app-primary-muted) 100%)',
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
          maxWidth: 480,
          background: 'var(--app-glass-bg)',
          backdropFilter: 'blur(14px)',
          borderRadius: 'var(--app-card-radius)',
          padding: '32px 28px 28px',
          boxShadow: 'var(--app-shadow-lg)',
          border: '1px solid var(--app-glass-border)',
          marginBottom: 16,
        }}
      >
        {isFollowRequired ? (
          <>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div
                style={{
                  width: 72,
                  height: 72,
                  margin: '0 auto 20px',
                  borderRadius: 20,
                  background: 'linear-gradient(135deg, var(--app-primary) 0%, var(--app-primary-dark) 50%, var(--app-accent) 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: 'var(--app-shadow-lg)',
                }}
              >
                <InstagramOutlined style={{ fontSize: 32, color: 'var(--brand-white)' }} />
              </div>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--app-text)', margin: '0 0 10px', letterSpacing: '-0.02em' }}>
                Quase! Só falta um passo
              </h1>
              <p style={{ fontSize: 15, color: 'var(--app-text-secondary)', margin: 0, lineHeight: 1.5 }}>
                Segue o{' '}
                <a href={result.followProfileUrl!} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--app-primary)', fontWeight: 600, textDecoration: 'none' }}>
                  @{followProfileHandle}
                </a>
                {' '}no Instagram que a gente manda o código na DM.
              </p>
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
              <a
                href={result.followProfileUrl!}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: '12px 20px', borderRadius: 14,
                  background: 'linear-gradient(135deg, var(--app-primary) 0%, var(--app-accent) 100%)',
                  color: 'var(--brand-white)', fontWeight: 600, fontSize: 14, textDecoration: 'none',
                }}
              >
                <InstagramOutlined style={{ fontSize: 16 }} />
                Seguir no Instagram
              </a>
            </div>
            <p style={{ fontSize: 13, color: 'var(--app-text-tertiary)', textAlign: 'center', margin: 0, marginBottom: 20 }}>
              Depois de seguir, volta aqui e clica de novo.
            </p>
            <Button
              type="primary"
              size="large"
              onClick={() => (onRetry ? onRetry(result.handle) : onUnderstood())}
              style={{ height: 48, marginBottom: 12, minWidth: 220, borderRadius: 14, fontWeight: 600, fontSize: 15, background: 'var(--app-primary)', border: 'none', display: 'block', margin: '0 auto' }}
              icon={<ReloadOutlined />}
            >
              &nbsp;&nbsp;Já sigo, tentar de novo
            </Button>
          </>
        ) : (
          <>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div
                style={{
                  width: 64,
                  height: 64,
                  margin: '0 auto 16px',
                  borderRadius: 20,
                  background: 'var(--app-warning-bg)',
                  border: '1px solid var(--app-warning-border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <EditOutlined style={{ fontSize: 28, color: 'var(--app-warning-accent)' }} />
              </div>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--app-text)', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
                {isNotFound ? `@${result.handle} não encontrado` : 'Esse perfil não passou'}
              </h1>
              <p style={{ fontSize: 15, color: 'var(--app-text-secondary)', margin: 0, lineHeight: 1.5 }}>
                {isNotFound
                  ? 'Confere se o @ está certo e tenta de novo.'
                  : `@${result.handle} não bate com as regras do programa. Usa outro @ ou o perfil certo.`}
              </p>
            </div>

            <div
              style={{
                background: 'var(--app-alert-danger-bg)',
                border: '1px solid var(--app-alert-danger-border)',
                borderRadius: 12,
                padding: '12px 16px',
                marginBottom: 24,
              }}
            >
              <strong style={{ color: 'var(--app-danger-accent)', fontSize: 12 }}>Motivo:</strong>{' '}
              <span style={{ color: 'var(--app-text-secondary)', fontSize: 13 }}>{reasonText}</span>
              {result.diagnostic && result.diagnostic.minRequired != null && (
                <div style={{ marginTop: 6, fontSize: 12, color: 'var(--app-text-secondary)' }}>
                  Mínimo exigido: {result.diagnostic.minRequired.toLocaleString('pt-BR')}
                </div>
              )}
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--app-text)', marginBottom: 10 }}>
                Coloca o @ certo do Instagram
              </label>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Input
                  prefix={<span style={{ color: 'var(--app-text-tertiary)', fontWeight: 500 }}>@</span>}
                  placeholder="ex: seu_usuario"
                  value={correctHandle}
                  onChange={(e) => setCorrectHandle(e.target.value.replace(/^@/, '').trim())}
                  onPressEnter={handleTryCorrectProfile}
                  size="large"
                  style={{ flex: 1, minWidth: 160, borderRadius: 12 }}
                  autoFocus
                />
                <Button
                  type="primary"
                  size="large"
                  loading={submitting}
                  onClick={handleTryCorrectProfile}
                  disabled={!correctHandle.replace(/\s/g, '')}
                  style={{ height: 40, borderRadius: 12, fontWeight: 600, background: 'var(--app-primary)', border: 'none' }}
                  icon={<ArrowRightOutlined />}
                >
                  Validar
                </Button>
              </div>
            </div>
          </>
        )}

        <Collapse

          size="small"
          style={{ marginTop: '20px', background: 'var(--app-primary-muted)', border: '1px solid var(--app-border)', borderRadius: 14 }}
          items={[
            {
              key: 'regras',
              label: <span style={{ color: 'var(--app-text)', fontWeight: 600, fontSize: 13 }}>Regras do programa</span>,
              children: <div style={{ paddingTop: 2, paddingBottom: 2 }}>{ELIGIBILITY_RULES}</div>,
            },
          ]}
        />
      </div>

      <Button
        type="text"
        onClick={onUnderstood}
        style={{
          height: 40,
          padding: '0 20px',
          borderRadius: 12,
          fontWeight: 500,
          fontSize: 13,
          color: 'var(--app-text-tertiary)',
          border: 'none',
          background: 'transparent',
        }}
      >
        Voltar ao início
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
      className="install-loader"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'linear-gradient(135deg, var(--app-card-bg-soft) 0%, var(--app-warning-bg) 35%, var(--app-primary-muted) 70%, var(--app-warning-bg) 100%)',
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
          background: 'radial-gradient(circle, var(--app-primary-muted) 0%, transparent 70%)',
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
          background: 'radial-gradient(circle, var(--app-warning-bg) 0%, transparent 70%)',
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
          background: 'radial-gradient(circle, var(--app-bg-blob1) 0%, transparent 70%)',
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
            background: 'var(--app-glass-bg)',
            backdropFilter: 'blur(12px)',
            borderRadius: 'var(--app-card-radius)',
            padding: '40px 32px 36px',
            boxShadow: 'var(--app-shadow-lg)',
            border: '1px solid var(--app-glass-border)',
          }}
        >
          {/* Ícone com anel e animação */}
          <div
            style={{
              width: 88,
              height: 88,
              margin: '0 auto 28px',
              borderRadius: '50%',
              background: 'linear-gradient(145deg, var(--app-primary) 0%, var(--app-primary-dark) 50%, var(--app-chart-bar-top) 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: 'var(--app-shadow-lg)',
              animation: 'install-rocket-pulse 2.5s ease-in-out infinite',
            }}
          >
            <RocketOutlined
              style={{
                fontSize: 40,
                color: 'var(--brand-white)',
                filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))',
              }}
            />
          </div>

          <h2
            style={{
              color: 'var(--app-text)',
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
              background: 'linear-gradient(90deg, var(--app-primary), var(--app-primary-dark), var(--app-accent))',
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
              background: 'linear-gradient(90deg, var(--app-primary-muted), var(--app-warning-bg))',
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
                background: 'linear-gradient(90deg, var(--app-primary) 0%, var(--app-primary-dark) 50%, var(--app-accent) 100%)',
                borderRadius: 10,
                transition: 'width 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: 'var(--app-shadow-md)',
              }}
            />
          </div>
          <p
            style={{
              color: 'var(--app-text-secondary)',
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
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.03); }
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
  const didAutoStartExtraction = useRef(false)

  useEffect(() => {
    if (savedNickname && form) {
      form.setFieldsValue({ nickname: savedNickname })
    }
  }, [savedNickname, form])

  // Iniciar extração automaticamente quando chega por DM (ex.: do Login com nickname no state)
  useEffect(() => {
    if (!savedNickname || user?.profile_handle || didAutoStartExtraction.current) return
    didAutoStartExtraction.current = true
    onRequestCode({ nickname: savedNickname })
  }, [savedNickname, user?.profile_handle])

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
        message.success('Código enviado! Olha no Direct do Instagram.')
      } else if (data.code) {
        message.warning(data.error ?? 'DM não foi. Usa o código que apareceu aí em baixo.')
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
        message.success('Entrou! Perfil validado.')
      } else {
        await refreshUser()
        message.success('Perfil validado.')
      }
      navigate('/app/create/password', { state: { handle: nickname }, replace: true })
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Código errado ou já venceu. Pede outro.')
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
        message.success('Código enviado! Olha no Direct do Instagram.')
      } else if (data.code) {
        message.warning(data.error ?? 'DM não foi. Usa o código que apareceu aí em baixo.')
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

      {!showInstallLoader && !rejectionInfo && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            padding: '24px 16px',
            background: 'linear-gradient(135deg, var(--app-card-bg-soft) 0%, var(--app-warning-bg) 25%, var(--app-primary-muted) 50%, var(--app-gold-light) 75%, var(--app-primary-muted) 100%)',
            backgroundAttachment: 'fixed',
            fontFamily: "'Segoe UI', system-ui, sans-serif",
          }}
        >
          {/* Blobs decorativos de fundo */}
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

          <div style={{ maxWidth: 440, width: '100%', position: 'relative', zIndex: 1, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            {/* Hero para primeiro passo */}
            {step === 'nickname' && (
              <div style={{ textAlign: 'center', marginBottom: 28 }}>
                <div
                  style={{
                    width: 72,
                    height: 72,
                    margin: '0 auto 16px',
                    borderRadius: 24,
                    background: 'linear-gradient(145deg, var(--app-primary) 0%, var(--app-primary-dark) 40%, var(--app-accent) 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: 'var(--app-shadow-lg)',
                    animation: 'auth-hero-pulse 3s ease-in-out infinite',
                  }}
                >
                  <RocketOutlined style={{ fontSize: 34, color: 'var(--brand-white)', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))' }} />
                </div>
                <style>{`
                @keyframes auth-hero-pulse {
                  0%, 100% { transform: scale(1); }
                  50% { transform: scale(1.04); }
                }
              `}</style>
                <h1
                  style={{
                    fontSize: 24,
                    fontWeight: 800,
                    margin: 0,
                    lineHeight: 1.3,
                    letterSpacing: '-0.02em',
                    color: 'var(--app-text)',
                    textShadow: '0 1px 2px rgba(0,0,0,0.1)',
                  }}
                >
                  Entra pro programa de influenciadores
                </h1>
                <p
                  style={{
                    fontSize: 14,
                    color: 'var(--app-text-secondary)',
                    marginTop: 8,
                    lineHeight: 1.5,
                    maxWidth: 340,
                    margin: '8px auto 0',
                  }}
                >
                  Valida teu perfil em poucos cliques e começa a receber proposta de marca.
                </p>
              </div>
            )}

            <Card
              title={
                step === 'nickname' ? (
                  <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--app-text)' }}>
                    <UserOutlined style={{ marginRight: 8, color: 'var(--app-primary)' }} />
                    {user?.profile_handle ? 'Perfil validado' : 'Começar cadastro'}
                  </span>
                ) : (
                  <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--app-text)' }}>
                    <SafetyCertificateOutlined style={{ marginRight: 8, color: 'var(--app-primary)' }} />
                    Validar perfil no Instagram
                  </span>
                )
              }
              style={{
                overflow: 'hidden',
                background: 'var(--app-glass-bg)',
                backdropFilter: 'blur(12px)',
                borderRadius: 'var(--app-card-radius)',
                border: '1px solid var(--app-glass-border)',
                boxShadow: 'var(--app-shadow-lg)',
              }}
              styles={{
                header: { borderBottom: '1px solid var(--app-border)', padding: '20px 24px' },
                body: {
                  padding: step === 'nickname'
                    ? (user?.profile_handle ? '24px 24px 28px' : '16px 24px 24px')
                    : '24px 24px 28px',
                },
              }}
            >
              {user?.profile_handle && step === 'nickname' && (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 20,
                  alignItems: 'stretch',
                }}>
                  <div style={{
                    padding: '20px 20px',
                    background: 'var(--app-alert-success-bg)',
                    border: '1px solid var(--app-alert-success-border)',
                    borderRadius: 16,
                    textAlign: 'center',
                  }}>
                    <p style={{ margin: 0, color: 'var(--app-alert-success-text)', fontSize: 15, lineHeight: 1.6 }}>
                      Você já validou o <strong style={{ color: 'var(--app-success-accent)' }}>@{user.profile_handle}</strong>.
                    </p>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <Button
                      type="primary"
                      size="large"
                      onClick={() => navigate(`/activate/${user.profile_handle}`)}
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
                    <Button
                      type="text"
                      size="large"
                      onClick={validateAnotherProfile}
                      block
                      style={{ color: 'var(--app-primary)', fontWeight: 600, height: 44 }}
                    >
                      Validar outro perfil
                    </Button>
                  </div>
                </div>
              )}

              {!user?.profile_handle && step === 'nickname' && (
                <>
                  <p style={{ color: 'var(--app-text-secondary)', marginBottom: 24, fontSize: 14, lineHeight: 1.6 }}>
                    Coloca teu <strong style={{ color: 'var(--app-primary)' }}>@</strong>. A gente manda um código no <strong style={{ color: 'var(--app-primary)' }}>Direct do Instagram</strong>.
                  </p>
                  <Form form={form} name="request-code" onFinish={onRequestCode} layout="vertical" requiredMark={false}>
                    <Form.Item name="nickname" label={<span style={{ fontWeight: 600, color: 'var(--app-text)' }}>Seu @ no Instagram</span>} rules={[{ required: true, message: 'Coloca teu @ do Instagram.' }]}>
                      <Input
                        prefix={<UserOutlined style={{ color: 'var(--app-primary)' }} />}
                        placeholder="ex: seu_usuario"
                        size="large"
                        autoComplete="username"
                        style={{ borderRadius: 12, borderColor: 'var(--app-border)' }}
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
                        style={{
                          height: 52,
                          borderRadius: 14,
                          fontWeight: 700,
                          fontSize: 15,
                          background: 'linear-gradient(90deg, var(--app-primary) 0%, var(--app-accent) 100%)',
                          border: 'none',
                          boxShadow: 'var(--app-shadow-md)',
                        }}
                      >
                        Pedir código no Instagram
                      </Button>
                    </Form.Item>
                  </Form>
                </>
              )}

              {step === 'code' && (
                <>
                  <div style={{
                    marginBottom: 24,
                    padding: 20,
                    background: 'var(--app-info-bg)',
                    border: '1px solid var(--app-info-border)',
                    borderRadius: 16,
                    boxShadow: 'var(--app-shadow-sm)',
                  }}>
                    <p style={{ margin: 0, color: 'var(--app-info-text)', fontSize: 14, lineHeight: 1.5 }}>
                      Mandamos um código de 6 números no <strong style={{ color: 'var(--app-info-text-accent)', fontWeight: 700 }}>Direct</strong> para <strong style={{ color: 'var(--app-info-text-accent)', fontWeight: 700 }}>@{nickname}</strong>. Olha a DM e cola aqui.
                    </p>
                  </div>
                  <Form form={form} name="verify" onFinish={onVerify} layout="vertical" requiredMark={false}>
                    <Form.Item label={<span style={{ fontWeight: 600, color: 'var(--app-text)' }}>Nickname</span>}>
                      <Input value={`@${nickname}`} disabled size="large" style={{ borderRadius: 12, borderColor: 'var(--app-border)' }} />
                    </Form.Item>
                    <Form.Item
                      name="code"
                      label={<span style={{ fontWeight: 600, color: 'var(--app-text)' }}>Código de 6 dígitos</span>}
                      rules={[{ required: true, message: 'Coloca o código de 6 números.' }, { len: 6, message: 'Coloca o código de 6 números.' }]}
                    >
                      <Input
                        placeholder="000000"
                        size="large"
                        type="number"
                        maxLength={6}
                        autoComplete="one-time-code"
                        style={{ letterSpacing: 10, textAlign: 'center', fontSize: 20, fontWeight: 600, borderRadius: 12, borderColor: 'var(--app-border)' }}
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
                        style={{
                          height: 52,
                          borderRadius: 14,
                          fontWeight: 700,
                          fontSize: 15,
                          background: 'linear-gradient(90deg, var(--app-primary) 0%, var(--app-accent) 100%)',
                          border: 'none',
                          boxShadow: 'var(--app-shadow-md)',
                        }}
                      >
                        Validar e continuar
                      </Button>
                    </Form.Item>
                    <Form.Item style={{ marginTop: 8, marginBottom: 0 }}>
                      <Button type="link" block onClick={startOver} style={{ padding: 0, color: 'var(--app-primary)', fontWeight: 600 }}>
                        Usar outro @
                      </Button>
                    </Form.Item>
                  </Form>
                </>
              )}
            </Card>

            <Button
              type="text"
              onClick={() => window.location.href = '/'}
              style={{
                marginTop: 24,
                height: 40,
                padding: '0 20px',
                borderRadius: 12,
                fontWeight: 500,
                fontSize: 13,
                color: 'var(--app-text-tertiary)',
              }}
              icon={<ArrowLeftOutlined />}
            >
              Voltar
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
