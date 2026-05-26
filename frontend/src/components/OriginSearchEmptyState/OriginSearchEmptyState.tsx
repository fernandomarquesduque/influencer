import {
  BookOutlined,
  ClockCircleOutlined,
  CoffeeOutlined,
  CreditCardOutlined,
  FireOutlined,
  ReloadOutlined,
  RightOutlined,
  SearchOutlined,
  ShoppingOutlined,
  SkinOutlined,
  StarFilled,
  TagOutlined,
} from '@ant-design/icons'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { getSearchEmptySuggestionItems } from '../../utils/searchEmptySuggestions'
import OriginSearchEmptyIllustration from './OriginSearchEmptyIllustration'
import './OriginSearchEmptyState.css'

export type OriginSearchEmptyVariant = 'no-results' | 'prompt' | 'rate-limit' | 'search-quota'

export type OriginSearchEmptyStateProps = {
  variant?: OriginSearchEmptyVariant
  searchQuery?: string
  onSuggestionClick?: (term: string) => void
  /** Segundos sugeridos antes de nova tentativa (variant `rate-limit`). */
  retryAfterSeconds?: number
  onRetry?: () => void
  /** Abre o modal de planos (variant `search-quota`). */
  onOpenPlans?: () => void
  /** Ao zerar o contador da cota horária (variant `search-quota`). */
  onQuotaExpired?: () => void
}

const PROMPT_SUGGESTIONS = ['Moda', 'Beleza', 'Fitness', 'Viagem', 'Gastronomia', 'Maternidade']

function formatQuotaCountdown(totalSeconds: number): string {
  const sec = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function useCountdownSeconds(initialSeconds: number, onComplete?: () => void): number {
  const [remaining, setRemaining] = useState(() => Math.max(0, Math.round(initialSeconds)))
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete
  const completedRef = useRef(false)

  useEffect(() => {
    setRemaining(Math.max(0, Math.round(initialSeconds)))
    completedRef.current = false
  }, [initialSeconds])

  useEffect(() => {
    if (remaining <= 0) {
      if (!completedRef.current) {
        completedRef.current = true
        onCompleteRef.current?.()
      }
      return
    }
    const timer = window.setInterval(() => {
      setRemaining((prev) => (prev <= 1 ? 0 : prev - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [remaining])

  return remaining
}

function iconForSuggestion(label: string): ReactNode {
  const key = label.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  if (key.includes('gastronom')) return <CoffeeOutlined />
  if (key.includes('receita')) return <BookOutlined />
  if (key.includes('comida')) return <ShoppingOutlined />
  if (key.includes('moda') || key.includes('estilo') || key.includes('look')) return <TagOutlined />
  if (key.includes('beleza') || key.includes('skincare') || key.includes('maquiagem')) return <SkinOutlined />
  if (key.includes('fitness') || key.includes('treino') || key.includes('academia')) return <FireOutlined />
  return <TagOutlined />
}

export default function OriginSearchEmptyState({
  variant = 'no-results',
  searchQuery = '',
  onSuggestionClick,
  retryAfterSeconds = 60,
  onRetry,
  onOpenPlans,
  onQuotaExpired,
}: OriginSearchEmptyStateProps) {
  const isPrompt = variant === 'prompt'
  const isRateLimit = variant === 'rate-limit'
  const isSearchQuota = variant === 'search-quota'
  const quotaCountdown = useCountdownSeconds(
    isSearchQuota ? retryAfterSeconds : 0,
    isSearchQuota ? onQuotaExpired : undefined
  )
  const q = searchQuery.trim()
  const suggestions = isPrompt
    ? PROMPT_SUGGESTIONS.map((label) => ({ label }))
    : getSearchEmptySuggestionItems(q, 6)
  const waitLabel =
    retryAfterSeconds >= 60
      ? `cerca de ${Math.max(1, Math.round(retryAfterSeconds / 60))} minuto${retryAfterSeconds >= 120 ? 's' : ''}`
      : `${retryAfterSeconds} segundos`

  return (
    <div
      className={`origin-search-empty${
        isRateLimit ? ' origin-search-empty--rate-limit origin-search-empty--centered' : ''
      }${isSearchQuota ? ' origin-search-empty--search-quota' : ''}`}
      role="status"
      aria-live="polite"
    >
      <div className="origin-search-empty__content">
        {isRateLimit ? (
          <span className="origin-search-empty__rate-icon" aria-hidden>
            <ClockCircleOutlined />
          </span>
        ) : isSearchQuota ? null : (
          <OriginSearchEmptyIllustration />
        )}

        {isPrompt ? (
          <>
            <h2 className="origin-search-empty__title">Busque por conteúdo</h2>
            <p className="origin-search-empty__lead">Digite um tema ou explore um dos destaques abaixo.</p>
          </>
        ) : isRateLimit ? (
          <>
            <h2 className="origin-search-empty__title">Muitas buscas em pouco tempo</h2>
            <p className="origin-search-empty__lead">
              Aguarde {waitLabel} e tente de novo. Isso é um limite temporário da plataforma — não significa que não
              existem posts
              {q ? (
                <>
                  {' '}
                  com <span className="origin-search-empty__term">&ldquo;{q}&rdquo;</span>
                </>
              ) : null}
              .
            </p>
            {onRetry ? (
              <button type="button" className="origin-search-empty__retry" onClick={onRetry}>
                <ReloadOutlined aria-hidden />
                Tentar novamente
              </button>
            ) : null}
          </>
        ) : isSearchQuota ? (
          <div className="origin-search-quota">
            <div className="origin-search-quota__hero" aria-hidden>
              <span className="origin-search-quota__spark origin-search-quota__spark--a">+</span>
              <span className="origin-search-quota__spark origin-search-quota__spark--b">+</span>
              <span className="origin-search-quota__spark origin-search-quota__spark--c">−</span>
              <span className="origin-search-quota__icon-ring">
                <CreditCardOutlined className="origin-search-quota__icon-card" />
                <SearchOutlined className="origin-search-quota__icon-search" />
              </span>
            </div>

            <h2 className="origin-search-quota__title">Você atingiu o limite gratuito</h2>
            <p className="origin-search-quota__lead">
              Suas buscas gratuitas acabaram por enquanto. Assine um plano para continuar explorando posts e
              encontrar novos resultados sem interrupções.
            </p>

            <div className="origin-search-quota__timer" aria-live="polite">
              <ClockCircleOutlined className="origin-search-quota__timer-icon" aria-hidden />
              <span className="origin-search-quota__timer-label">
                {quotaCountdown > 0 ? 'Próxima busca gratuita em' : 'Próxima busca gratuita disponível'}
              </span>
              {quotaCountdown > 0 ? (
                <span className="origin-search-quota__timer-value">{formatQuotaCountdown(quotaCountdown)}</span>
              ) : null}
            </div>

            {onOpenPlans ? (
              <button type="button" className="origin-search-quota__cta" onClick={onOpenPlans}>
                <CreditCardOutlined aria-hidden />
                Ver planos e continuar pesquisando
                <RightOutlined aria-hidden />
              </button>
            ) : null}

            {onQuotaExpired ? (
              <button
                type="button"
                className="origin-search-quota__wait"
                onClick={() => {
                  if (quotaCountdown <= 0) onQuotaExpired()
                }}
                disabled={quotaCountdown > 0}
              >
                Aguardar próxima busca gratuita
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <h2 className="origin-search-empty__title">
              Nenhum post com <span className="origin-search-empty__term">&ldquo;{q}&rdquo;</span>
            </h2>
            <p className="origin-search-empty__lead">Tente outro termo ou explore um dos destaques abaixo.</p>
          </>
        )}

        {!isRateLimit && !isSearchQuota ? (
          <>
            <p className="origin-search-empty__suggestions-title">
              <StarFilled className="origin-search-empty__sparkle" aria-hidden />
              Sugestões para você
              <StarFilled className="origin-search-empty__sparkle" aria-hidden />
            </p>

            <div className="origin-search-empty__tags">
              {suggestions.map(({ label }) => (
                <button
                  key={label}
                  type="button"
                  className="origin-search-empty__tag"
                  onClick={() => onSuggestionClick?.(label)}
                  disabled={!onSuggestionClick}
                >
                  <span className="origin-search-empty__tag-icon" aria-hidden>
                    {iconForSuggestion(label)}
                  </span>
                  {label}
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
