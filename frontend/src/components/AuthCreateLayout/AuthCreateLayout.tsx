import type { ReactNode } from 'react'
import { Button } from 'antd'
import { HeartOutlined, UserOutlined, ArrowLeftOutlined, SendOutlined } from '@ant-design/icons'
import './AuthCreateLayout.css'

function Sparkle({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 12 12" aria-hidden>
      <path
        d="M6 0L6.8 4.2L11 5L6.8 5.8L6 10L5.2 5.8L1 5L5.2 4.2L6 0Z"
        fill="currentColor"
      />
    </svg>
  )
}

export type AuthCreateLayoutProps = {
  children: ReactNode
  compact?: boolean
  showSignupHint?: boolean
  cardTitle?: ReactNode
  onBack?: () => void
}

/**
 * Layout da tela /app/create (validação de influenciador) — mockup com gradiente, card glass e decorações.
 */
export default function AuthCreateLayout({
  children,
  compact = false,
  showSignupHint = true,
  cardTitle,
  onBack,
}: AuthCreateLayoutProps) {
  return (
    <div className="auth-create">
      <div className="auth-create__decor" aria-hidden>
        <div className="auth-create__blob auth-create__blob--1" />
        <div className="auth-create__blob auth-create__blob--2" />
        <div className="auth-create__blob auth-create__blob--3" />
        <Sparkle className="auth-create__sparkle auth-create__sparkle--1" />
        <Sparkle className="auth-create__sparkle auth-create__sparkle--2" />
        <Sparkle className="auth-create__sparkle auth-create__sparkle--3" />
        <div className="auth-create__bubble auth-create__bubble--left">
          <HeartOutlined />
        </div>
        <div className="auth-create__bubble auth-create__bubble--right">
          <UserOutlined />
        </div>
      </div>

      <div className="auth-create__inner">
        <header className="auth-create__hero">

          <div className="auth-create__title-wrap">
            <div className="auth-create__title-stars" aria-hidden>
              <Sparkle />
              <Sparkle />
              <Sparkle />
            </div>
            <h1 className="auth-create__title">
              Você é um
              <span className="auth-create__title-accent">influenciador?</span>
            </h1>
          </div>
          <p className="auth-create__subtitle">
            Valide seu perfil e comece a receber oportunidades de marcas que combinam com você.
          </p>
        </header>

        <div className={`auth-create__card${compact ? ' auth-create__card--compact' : ''}`}>
          {cardTitle}
          {showSignupHint && (
            <div className="auth-create__hint">
              <div className="auth-create__hint-icon" aria-hidden>
                <SendOutlined />
              </div>
              <div className="auth-create__hint-text">
                <strong>Informe seu @ do Instagram.</strong>
                <span>Vamos enviar um código no Direct para confirmar seu perfil.</span>
              </div>
            </div>
          )}
          <div className="auth-create__form">{children}</div>
        </div>

        <Button
          type="text"
          className="auth-create__back"
          icon={<ArrowLeftOutlined />}
          onClick={onBack ?? (() => { window.location.href = '/' })}
        >
          Voltar
        </Button>
      </div>
    </div>
  )
}
