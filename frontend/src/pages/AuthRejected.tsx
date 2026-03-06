import { useNavigate, useLocation } from 'react-router-dom'
import { Button } from 'antd'
import { useAuth } from '../contexts/AuthContext'
import { EditOutlined, ArrowRightOutlined } from '@ant-design/icons'

export default function AuthRejected() {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const reason = (location.state as { reason?: string })?.reason || 'Perfil não elegível.'

  const validateAnotherProfile = () => {
    logout()
    navigate('/app/create', { replace: true, state: {} })
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
            Perfil não entrou no programa
          </h1>
          <p style={{ fontSize: 15, color: 'var(--app-text-secondary)', margin: 0, lineHeight: 1.5 }}>
            Seu perfil não atende aos critérios do programa no momento.
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
          <span style={{ color: 'var(--app-text-secondary)', fontSize: 13 }}>{reason}</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'stretch' }}>
          <Button
            type="primary"
            size="large"
            onClick={() => navigate('/app')}
            icon={<ArrowRightOutlined />}
            style={{ height: 48, borderRadius: 14, fontWeight: 600, background: 'var(--app-primary)', border: 'none' }}
          >
            Ver lista de influenciadores
          </Button>
          <Button
            onClick={validateAnotherProfile}
            size="large"
            style={{ height: 48, borderRadius: 14, fontWeight: 600 }}
          >
            Validar outro perfil
          </Button>
        </div>
      </div>
    </div>
  )
}
