import type { KeyboardEvent, MouseEvent } from 'react'
import { HeartFilled, HeartOutlined } from '@ant-design/icons'
import { Tooltip } from 'antd'

export interface PostFavoriteHeartButtonProps {
  isFavorite: boolean
  disabled?: boolean
  onToggle: (e: MouseEvent | KeyboardEvent) => void
  size?: number
}

/** Coração para favoritar post (canto da mídia). */
export default function PostFavoriteHeartButton({
  isFavorite,
  disabled,
  onToggle,
  size = 22,
}: PostFavoriteHeartButtonProps) {
  return (
    <Tooltip title={isFavorite ? 'Remover dos favoritos' : 'Salvar nos favoritos'}>
      <button
        type="button"
        className="post-favorite-heart-btn"
        disabled={disabled}
        aria-label={isFavorite ? 'Remover dos favoritos' : 'Favoritar publicação'}
        aria-pressed={isFavorite}
        onClick={(e) => {
          e.stopPropagation()
          onToggle(e)
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            e.stopPropagation()
            onToggle(e)
          }
        }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 36,
          height: 36,
          padding: 0,
          border: 'none',
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.92)',
          boxShadow: '0 1px 6px rgba(0,0,0,0.18)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          lineHeight: 0,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {isFavorite ? (
          <HeartFilled style={{ color: 'var(--app-primary)', fontSize: size }} />
        ) : (
          <HeartOutlined style={{ color: 'var(--app-text-secondary)', fontSize: size }} />
        )}
      </button>
    </Tooltip>
  )
}
