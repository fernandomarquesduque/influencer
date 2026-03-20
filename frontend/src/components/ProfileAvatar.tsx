import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Avatar, Spin } from 'antd'
import { UserOutlined } from '@ant-design/icons'
import { queueRefreshProfile } from '../api'

interface ProfileAvatarProps {
  src?: string
  /** URL direta (ex.: S3) como fundo / fallback quando a foto do Instagram falha ou expira. */
  stableBackgroundUrl?: string
  handle?: string | null
  size: number
  alt?: string
  border?: string
  shadow?: string
  fallbackIconSize?: number
  background?: string
  queueOnError?: boolean
  onRefreshQueued?: (handle: string) => void
  onImageError?: () => void
}

export default function ProfileAvatar({
  src,
  stableBackgroundUrl,
  handle,
  size,
  alt = '',
  border,
  shadow,
  fallbackIconSize = 20,
  background = 'var(--app-placeholder-bg)',
  queueOnError = true,
  onRefreshQueued,
  onImageError,
}: ProfileAvatarProps) {
  const [imageLoading, setImageLoading] = useState(!!src)
  const [imageError, setImageError] = useState(false)
  const queuedForCurrentSrcRef = useRef(false)

  useEffect(() => {
    setImageLoading(!!src)
    setImageError(false)
    queuedForCurrentSrcRef.current = false
  }, [src])

  const normalizedHandle = String(handle ?? '').replace(/^@/, '').trim()

  const stableBgStyle: CSSProperties | undefined =
    stableBackgroundUrl != null && stableBackgroundUrl !== ''
      ? {
          position: 'absolute',
          inset: 0,
          backgroundImage: `url(${stableBackgroundUrl})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center center',
        }
      : undefined

  if (!src) {
    if (stableBackgroundUrl) {
      return (
        <div
          style={{
            position: 'relative',
            flexShrink: 0,
            width: size,
            height: size,
            borderRadius: '50%',
            overflow: 'hidden',
            border,
            boxShadow: shadow,
            background,
          }}
          title={alt || undefined}
        >
          <div aria-hidden style={stableBgStyle} />
        </div>
      )
    }
    return (
      <Avatar
        size={size}
        icon={<UserOutlined style={{ fontSize: fallbackIconSize }} />}
        alt={alt}
        style={{ border, boxShadow: shadow, background }}
      />
    )
  }

  return (
    <div
      style={{
        position: 'relative',
        flexShrink: 0,
        width: size,
        height: size,
        borderRadius: '50%',
        overflow: 'hidden',
        border,
        boxShadow: shadow,
      }}
    >
      {stableBgStyle ? <div aria-hidden style={stableBgStyle} /> : null}
      <img
        src={src}
        alt={alt}
        aria-hidden={alt === ''}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          objectFit: 'cover',
          visibility: imageLoading || imageError ? 'hidden' : 'visible',
          position: 'relative',
          zIndex: 1,
        }}
        onLoad={() => setImageLoading(false)}
        onError={() => {
          setImageLoading(false)
          setImageError(true)
          onImageError?.()
          if (!queueOnError || queuedForCurrentSrcRef.current || !normalizedHandle) return
          queuedForCurrentSrcRef.current = true
          queueRefreshProfile(normalizedHandle).catch(() => {})
          onRefreshQueued?.(normalizedHandle)
        }}
      />
      {imageLoading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            width: size,
            height: size,
            borderRadius: '50%',
            background: stableBackgroundUrl ? 'rgba(0,0,0,0.2)' : background,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2,
          }}
        >
          <Spin size="default" />
        </div>
      )}
      {imageError && !stableBackgroundUrl && (
        <Avatar
          size={size}
          icon={<UserOutlined style={{ fontSize: fallbackIconSize }} />}
          alt={alt}
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 2,
            border: 'none',
            boxShadow: 'none',
            background,
          }}
        />
      )}
    </div>
  )
}
