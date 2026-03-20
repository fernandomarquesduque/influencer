import { useEffect, useRef, useState } from 'react'
import { Avatar, Spin } from 'antd'
import { UserOutlined } from '@ant-design/icons'
import { queueRefreshProfile } from '../api'

interface ProfileAvatarProps {
  src?: string
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

  if (!src) {
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
    <div style={{ position: 'relative', flexShrink: 0, width: size, height: size }}>
      <img
        src={src}
        alt={alt}
        aria-hidden={alt === ''}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          border,
          boxShadow: shadow,
          objectFit: 'cover',
          visibility: imageLoading || imageError ? 'hidden' : 'visible',
          position: imageLoading ? 'absolute' : 'relative',
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
            background,
            border,
            boxShadow: shadow,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1,
          }}
        >
          <Spin size="default" />
        </div>
      )}
      {imageError && (
        <Avatar
          size={size}
          icon={<UserOutlined style={{ fontSize: fallbackIconSize }} />}
          alt={alt}
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 1,
            border,
            boxShadow: shadow,
            background,
          }}
        />
      )}
    </div>
  )
}
