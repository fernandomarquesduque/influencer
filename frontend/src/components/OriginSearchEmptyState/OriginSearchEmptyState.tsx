import {
  BookOutlined,
  ClockCircleOutlined,
  CoffeeOutlined,
  FireOutlined,
  ReloadOutlined,
  ShoppingOutlined,
  SkinOutlined,
  StarFilled,
  TagOutlined,
} from '@ant-design/icons'
import type { ReactNode } from 'react'
import { getSearchEmptySuggestionItems } from '../../utils/searchEmptySuggestions'
import OriginSearchEmptyIllustration from './OriginSearchEmptyIllustration'
import './OriginSearchEmptyState.css'

export type OriginSearchEmptyVariant = 'no-results' | 'prompt' | 'rate-limit'

export type OriginSearchEmptyStateProps = {
  variant?: OriginSearchEmptyVariant
  searchQuery?: string
  onSuggestionClick?: (term: string) => void
  /** Segundos sugeridos antes de nova tentativa (variant `rate-limit`). */
  retryAfterSeconds?: number
  onRetry?: () => void
}

const PROMPT_SUGGESTIONS = ['Moda', 'Beleza', 'Fitness', 'Viagem', 'Gastronomia', 'Maternidade']

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
}: OriginSearchEmptyStateProps) {
  const isPrompt = variant === 'prompt'
  const isRateLimit = variant === 'rate-limit'
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
      className={`origin-search-empty${isRateLimit ? ' origin-search-empty--rate-limit' : ''}`}
      role="status"
      aria-live="polite"
    >
      <div className="origin-search-empty__content">
        {isRateLimit ? (
          <span className="origin-search-empty__rate-icon" aria-hidden>
            <ClockCircleOutlined />
          </span>
        ) : (
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
        ) : (
          <>
            <h2 className="origin-search-empty__title">
              Nenhum post com <span className="origin-search-empty__term">&ldquo;{q}&rdquo;</span>
            </h2>
            <p className="origin-search-empty__lead">Tente outro termo ou explore um dos destaques abaixo.</p>
          </>
        )}

        {!isRateLimit ? (
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
