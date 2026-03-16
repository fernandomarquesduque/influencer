import { Button, message } from 'antd'
import { MailOutlined, InstagramOutlined, CheckCircleOutlined, GiftOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { resendVerificationEmail } from '../../api'

export default function MissionsBar() {
  const { user } = useAuth()
  const navigate = useNavigate()

  if (!user) return null

  const m1Done = user.emailVerified !== false
  const m2Done = user.scope === 'assinante' && !!user.profile_handle
  const bothMissionsDone = user.scope === 'assinante' ? (m1Done && m2Done) : m1Done

  if (bothMissionsDone) return null

  const done = (m1Done ? 1 : 0) + (m2Done ? 1 : 0)
  const hasPending = done < 2

  return (
    <div
      style={{
        padding: '10px 24px 12px',
        maxWidth: 1200,
        margin: '0 auto',
        width: '100%',
      }}
    >
      <div
        className="missions-bar"
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 16,
          padding: '14px 20px',
          background: hasPending
            ? 'linear-gradient(135deg, rgba(22, 119, 255, 0.06) 0%, var(--app-card-bg-soft) 50%)'
            : 'var(--app-card-bg-soft)',
          border: '1px solid var(--app-border-light)',
          borderRadius: 14,
          boxShadow: hasPending ? '0 2px 8px rgba(22, 119, 255, 0.08)' : '0 1px 3px rgba(0,0,0,0.04)',
          borderLeft: '3px solid var(--app-primary)',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                background: done === 2 ? 'var(--ant-color-success)' : 'var(--app-primary-muted)',
                color: done === 2 ? '#fff' : 'var(--app-primary)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              {done}/2
            </span>
            <div>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--app-text)', letterSpacing: '0.04em' }}>
                {hasPending ? 'Desbloqueie suas recompensas' : 'Todas as recompensas desbloqueadas'}
              </span>
              {hasPending && (
                <div style={{ fontSize: 11, color: 'var(--app-text-tertiary)', marginTop: 1 }}>
                  Até 60 créditos grátis para seus relatórios
                </div>
              )}
            </div>
          </div>
        </div>
        <div style={{ width: 1, height: 28, background: 'var(--app-border-light)', flexShrink: 0 }} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 14px',
              borderRadius: 10,
              background: m1Done ? 'rgba(82, 196, 26, 0.08)' : 'rgba(255,255,255,0.6)',
              border: m1Done ? 'none' : '1px dashed var(--app-border)',
              flex: 1,
              minWidth: 160,
            }}
          >
            {m1Done ? (
              <CheckCircleOutlined style={{ color: 'var(--ant-color-success)', fontSize: 18 }} />
            ) : (
              <span style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--app-primary-muted)', color: 'var(--app-primary)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <GiftOutlined style={{ fontSize: 14 }} />
              </span>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 13, color: m1Done ? 'var(--app-text-secondary)' : 'var(--app-text)', fontWeight: 500 }}>
                {m1Done ? 'E-mail validado' : 'Valide seu e-mail'}
              </span>
              <span style={{ fontSize: 12, color: m1Done ? 'var(--ant-color-success)' : 'var(--app-primary)', fontWeight: 700, marginLeft: 6 }}>
                {m1Done ? '· +10 na conta' : '→ 10 créditos'}
              </span>
            </div>
            {!m1Done && (
              <Button
                type="primary"
                size="small"
                ghost
                style={{ fontSize: 12, height: 28, fontWeight: 600 }}
                onClick={async () => {
                  try {
                    await resendVerificationEmail()
                    message.success('E-mail reenviado.')
                  } catch (e) {
                    message.error(e instanceof Error ? e.message : 'Falha ao reenviar')
                  }
                }}
              >
                Reenviar link
              </Button>
            )}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 14px',
              borderRadius: 10,
              background: m2Done ? 'rgba(82, 196, 26, 0.08)' : 'rgba(255,255,255,0.6)',
              border: m2Done ? 'none' : '1px dashed var(--app-border)',
              flex: 1,
              minWidth: 160,
            }}
          >
            {m2Done ? (
              <CheckCircleOutlined style={{ color: 'var(--ant-color-success)', fontSize: 18 }} />
            ) : (
              <span style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--app-primary-muted)', color: 'var(--app-primary)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <GiftOutlined style={{ fontSize: 14 }} />
              </span>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 13, color: m2Done ? 'var(--app-text-secondary)' : 'var(--app-text)', fontWeight: 500 }}>
                {m2Done ? 'Instagram vinculado' : 'Vincule o Instagram da empresa'}
              </span>
              <span style={{ fontSize: 12, color: m2Done ? 'var(--ant-color-success)' : 'var(--app-primary)', fontWeight: 700, marginLeft: 6 }}>
                {m2Done ? '· +50 na conta' : '→ 50 créditos'}
              </span>
            </div>
            {user.scope === 'assinante' && !m2Done && (
              <Button
                type="primary"
                size="small"
                style={{ fontSize: 12, height: 28, fontWeight: 600 }}
                onClick={() => navigate('/app/missions/link-instagram')}
              >
                Desbloquear 50
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
