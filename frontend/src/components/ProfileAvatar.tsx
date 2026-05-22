import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Avatar, Spin } from 'antd'
import { UserOutlined } from '@ant-design/icons'
import { profileRefFromMediaUrl, queueMediaRefreshForProfile } from '../utils/queueMediaRefreshForProfile'

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
  /**
   * Quando true e ainda não há `src` nem `stableBackgroundUrl`, exibe loader em vez do placeholder de usuário
   * (ex.: perfil no header enquanto a API ainda não devolveu a URL da foto).
   */
  pending?: boolean
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
  pending = false,
}: ProfileAvatarProps) {
  const hasSrc = Boolean(src)
  const hasStableBg = Boolean(stableBackgroundUrl)

  const [imageLoading, setImageLoading] = useState(hasSrc)
  const [imageError, setImageError] = useState(false)
  const [stableBgReady, setStableBgReady] = useState(!hasStableBg)
  const queuedForCurrentSrcRef = useRef(false)
  const imgRef = useRef<HTMLImageElement>(null)

  const markImageReadyIfComplete = useCallback(() => {
    const img = imgRef.current
    if (img?.complete && img.naturalWidth > 0) {
      setImageLoading(false)
    }
  }, [])

  useEffect(() => {
    setImageLoading(hasSrc)
    setImageError(false)
    queuedForCurrentSrcRef.current = false
  }, [src])

  useEffect(() => {
    if (!hasSrc) return
    markImageReadyIfComplete()
  }, [hasSrc, src, markImageReadyIfComplete])

  useEffect(() => {
    if (!hasSrc && hasStableBg && stableBackgroundUrl) {
      setStableBgReady(false)
      const img = new Image()
      const done = () => setStableBgReady(true)
      img.onload = done
      img.onerror = done
      img.src = stableBackgroundUrl
      return () => {
        img.onload = null
        img.onerror = null
      }
    }
    setStableBgReady(true)
  }, [hasSrc, hasStableBg, stableBackgroundUrl])

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

  const stableBgLoading = !hasSrc && hasStableBg && !stableBgReady
  const showPendingOnly = !hasSrc && !hasStableBg && pending
  const showLoader = hasSrc
    ? imageLoading && !imageError && !(hasStableBg && stableBgReady)
    : stableBgLoading

  const loaderOverlay = (
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
      <Spin size={size >= 56 ? 'default' : 'small'} />
    </div>
  )

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
          {showLoader ? loaderOverlay : null}
        </div>
      )
    }
    if (showPendingOnly) {
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
          aria-busy="true"
        >
          {loaderOverlay}
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
        ref={imgRef}
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
        onLoad={() => {
          setImageLoading(false)
        }}
        onError={() => {
          setImageLoading(false)
          setImageError(true)
          onImageError?.()
          const refreshKey =
            normalizedHandle || profileRefFromMediaUrl(src) || profileRefFromMediaUrl(stableBackgroundUrl)
          if (!queueOnError || queuedForCurrentSrcRef.current || !refreshKey) return
          queuedForCurrentSrcRef.current = true
          queueMediaRefreshForProfile(refreshKey)
          onRefreshQueued?.(refreshKey)
        }}
      />
      {showLoader ? loaderOverlay : null}
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
