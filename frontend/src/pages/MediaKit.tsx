/**
 * Tela de geração do Media Kit profissional.
 * Executa em background: carrega dados → gera PDF → salva → abre → valida.
 */
import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Button, Result, Spin, Typography } from 'antd'
import { CheckCircleFilled, LoadingOutlined } from '@ant-design/icons'
import { pdf } from '@react-pdf/renderer'
import { fetchProfile, fetchPosts, fetchProfileActivation, getProfilePicUrl, proxyImageUrl, authHeaders } from '../api'
import type { PostItem } from '../api'
import { buildReportInsights, getTopPosts, REPORT_POSTS_LIMIT } from '../utils/reportInsights'
import type { ProfileItem, ProfileActivation, PostsResponse } from '../api'
import QRCode from 'qrcode'
import { MediaKitDocument } from './MediaKitDocument'
import { reportTokens as t } from './reportTokens'
import { ActivationCtaPanel } from '../components/ActivationCtaPanel'
import { useTheme } from '../contexts/ThemeContext'
import type { ThemeMode } from '../contexts/ThemeContext'

const { Text } = Typography

/** Cores para as bolinhas do seletor de tema (uma por tema, fixas) */
const THEME_SWATCH_COLORS: Record<ThemeMode, string> = {
  light: '#68278f',
  dark: '#00b4d8',
  sepia: '#8b4513',
  ocean: '#0077b6',
  contrast: '#000000',
}

const THEME_ORDER: ThemeMode[] = ['light', 'dark', 'sepia', 'ocean', 'contrast']
const s = t.spacing
const c = t.colors

type Status = 'loading_data' | 'ready' | 'generating' | 'saving' | 'done' | 'error' | 'not_activated'

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = reject
    r.readAsDataURL(blob)
  })
}

const IMAGE_FETCH_TIMEOUT_MS = 5_000
const POST_IMAGES_PHASE_MAX_MS = 20_000
const MAX_URL_CANDIDATES_PER_POST = 3

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), ms)
    ),
  ])
}

async function fetchImageAsDataUrl(url: string, retries = 1): Promise<string | null> {
  const headers = { ...authHeaders() }
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await withTimeout(
        fetch(url, { mode: 'cors', credentials: 'include', headers }),
        IMAGE_FETCH_TIMEOUT_MS
      )
      if (!res.ok) {
        if (attempt < retries) await new Promise((r) => setTimeout(r, 200))
        continue
      }
      const blob = await withTimeout(res.blob(), IMAGE_FETCH_TIMEOUT_MS)
      if (!blob.type.startsWith('image/')) return null
      return await blobToDataUrl(blob)
    } catch {
      if (attempt < retries) await new Promise((r) => setTimeout(r, 200))
    }
  }
  return null
}

const MIN_PDF_SIZE = 1000 // 1KB mínimo para considerar PDF válido

const MEDIA_KIT_CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutos

interface MediaKitCacheEntry {
  profile: ProfileItem
  posts: PostItem[]
  reels: PostItem[]
  tagged: PostItem[]
  highlights: PostItem[]
  activation: ProfileActivation | null
  reportInsights: ReturnType<typeof buildReportInsights> | null
  profilePicDataUrl: string | null
  postImageDataUrls: Record<string, string>
  postImageDataUrlsOrdered: string[]
  cachedAt: number
}

const mediaKitCache = new Map<string, MediaKitCacheEntry>()

function getCachedMediaKit(handle: string): MediaKitCacheEntry | null {
  const key = handle.replace(/^@/, '').toLowerCase()
  const entry = mediaKitCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.cachedAt > MEDIA_KIT_CACHE_TTL_MS) {
    mediaKitCache.delete(key)
    return null
  }
  return entry
}

function setCachedMediaKit(handle: string, entry: Omit<MediaKitCacheEntry, 'cachedAt'>): void {
  const key = handle.replace(/^@/, '').toLowerCase()
  mediaKitCache.set(key, { ...entry, cachedAt: Date.now() })
}

export default function MediaKit() {
  const { handle } = useParams<{ handle: string }>()
  const navigate = useNavigate()
  const { theme, setTheme } = useTheme()
  const themeRef = useRef(theme)
  themeRef.current = theme
  const [status, setStatus] = useState<Status>('loading_data')
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState('Carregando perfil...')
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [validated, setValidated] = useState(false)
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768)
  const abortRef = useRef(false)

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const runInBackground = useCallback(async () => {
    if (!handle) {
      setError('Perfil não informado.')
      setStatus('error')
      return
    }
    abortRef.current = false
    const h = handle.replace(/^@/, '')

    try {
      const cached = getCachedMediaKit(h)
      const hasCity = (act: ProfileActivation | null) => !!(act?.city && String(act.city).trim())
      if (cached) {
        if (!hasCity(cached.activation)) {
          mediaKitCache.delete(h.toLowerCase())
          setStatus('not_activated')
          return
        }
        setStatus('ready')
        return
      }

      setStatus('loading_data')
      setProgress('Carregando perfil...')

      const [profileRes, postsRes, activationRes] = await Promise.all([
        fetchProfile(h).catch(() => null),
        fetchPosts(h, Math.max(REPORT_POSTS_LIMIT, 50), 0).catch((): PostsResponse => ({ items: [], total: 0 })),
        fetchProfileActivation(h).catch(() => ({} as ProfileActivation)),
      ])

      if (abortRef.current) return
      const profile = profileRes as ProfileItem | null
      if (!profile) {
        setError('Perfil não encontrado.')
        setStatus('error')
        return
      }

      const allItems = postsRes.items ?? []
      const ct = (p: PostItem) => (p.content_type || 'post') as string
      const posts = allItems.filter((p) => ct(p) === 'post')
      const reels = allItems.filter((p) => ct(p) === 'reel')
      const tagged = allItems.filter((p) => ct(p) === 'tagged')
      const highlights = allItems.filter((p) => ct(p) === 'highlight')
      const activation = (activationRes && typeof activationRes === 'object' ? activationRes : {}) as ProfileActivation

      if (!hasCity(activation)) {
        setStatus('not_activated')
        return
      }

      setProgress('Calculando dados...')
      const reportInsights = profile && allItems.length > 0 ? buildReportInsights(profile, allItems) : null

      setProgress('Carregando foto do perfil...')
      const profilePicUrl = proxyImageUrl(getProfilePicUrl(profile))
      const profilePicDataUrl = profilePicUrl ? await fetchImageAsDataUrl(profilePicUrl) : null

      setProgress('Carregando imagens dos posts...')
      function getPostImageUrlCandidates(p: PostItem): string[] {
        const urls: string[] = []
        const cover = p.media?.cover_images?.[0]?.url
        if (cover) urls.push(cover)
        const video = p.media?.video_versions?.[0]?.url
        if (video && !urls.includes(video)) urls.push(video)
        const topLevel = (p as { image_url?: string }).image_url
        if (topLevel && !urls.includes(topLevel)) urls.push(topLevel)
        const displayUrl = (p.media as { display_url?: string } | undefined)?.display_url ?? (p as { display_url?: string }).display_url
        if (displayUrl && !urls.includes(displayUrl)) urls.push(displayUrl)
        const contentImg = (p.content as { image_url?: string; thumbnail_url?: string; display_url?: string } | undefined)?.image_url
        if (contentImg && !urls.includes(contentImg)) urls.push(contentImg)
        const contentThumb = (p.content as { thumbnail_url?: string; display_url?: string } | undefined)?.thumbnail_url
        if (contentThumb && !urls.includes(contentThumb)) urls.push(contentThumb)
        const contentDisplay = (p.content as { display_url?: string } | undefined)?.display_url
        if (contentDisplay && !urls.includes(contentDisplay)) urls.push(contentDisplay)
        if (p.media?.cover_images) {
          for (let i = 1; i < p.media.cover_images.length; i++) {
            const u = p.media.cover_images[i]?.url
            if (u && !urls.includes(u)) urls.push(u)
          }
        }
        return urls
      }
      // Posts para carregar imagens: 4 destaques gerais + top 2 feed, top 2 reels, top 2 marcados (dedupe por key)
      const fc = profile?.followers_count ?? 0
      const topGlobal = (reportInsights?.topPosts?.byInteractions ?? []).slice(0, 4).map((t) => t.post)
      const topFeed = getTopPosts(posts, fc).byInteractions.slice(0, 2).map((t) => t.post)
      const topReels = getTopPosts(reels, fc).byInteractions.slice(0, 2).map((t) => t.post)
      const topTagged = getTopPosts(tagged, fc).byInteractions.slice(0, 2).map((t) => t.post)
      const seen = new Set<string>()
      const topPostsForImages: PostItem[] = []
      for (const post of [...topGlobal, ...topFeed, ...topReels, ...topTagged]) {
        const k = (post as { key?: string }).key ?? (post as { id?: string }).id ?? (post?.post as { shortcode?: string })?.shortcode ?? ''
        if (k && !seen.has(k)) {
          seen.add(k)
          topPostsForImages.push(post)
        }
      }
      const postImageDataUrls: Record<string, string> = {}

      function setPostImageDataUrl(post: PostItem, dataUrl: string) {
        const keys = [
          post.key,
          (post as { id?: string }).id,
          (post as { pk?: string }).pk,
          (post.post as { shortcode?: string; code?: string; id?: string; pk?: string } | undefined)?.shortcode,
          (post.post as { shortcode?: string; code?: string; id?: string; pk?: string } | undefined)?.code,
          (post.post as { id?: string; pk?: string } | undefined)?.id,
          (post.post as { id?: string; pk?: string } | undefined)?.pk,
          (post.content as { code?: string; shortcode?: string; id?: string; pk?: string } | undefined)?.code,
          (post.content as { code?: string; shortcode?: string } | undefined)?.shortcode,
          (post.content as { id?: string; pk?: string } | undefined)?.id,
          (post.content as { id?: string; pk?: string } | undefined)?.pk,
        ].filter(Boolean).map(String)
        for (const k of keys) {
          postImageDataUrls[k] = dataUrl
        }
      }

      async function tryLoadPostImage(post: PostItem): Promise<boolean> {
        const candidates = getPostImageUrlCandidates(post).slice(0, MAX_URL_CANDIDATES_PER_POST)
        for (const rawUrl of candidates) {
          const url = proxyImageUrl(rawUrl)
          if (!url) continue
          const dataUrl = await fetchImageAsDataUrl(url)
          if (dataUrl) {
            setPostImageDataUrl(post, dataUrl)
            return true
          }
          await new Promise((r) => setTimeout(r, 150))
        }
        return false
      }

      const loadOne = (post: PostItem | undefined) =>
        post && !getPostImageByKeys(post, postImageDataUrls) ? tryLoadPostImage(post) : Promise.resolve(false)
      await Promise.race([
        Promise.all(topPostsForImages.slice(0, 12).map((post) => loadOne(post))),
        new Promise<void>((resolve) => setTimeout(resolve, POST_IMAGES_PHASE_MAX_MS)),
      ])

      const postImageDataUrlsOrdered: string[] = []
      function getPostImageByKeys(post: PostItem | undefined, map: Record<string, string>): string {
        if (!post) return ''
        const keys = [
          post.key,
          (post as { id?: string }).id,
          (post as { pk?: string }).pk,
          (post.post as { shortcode?: string; code?: string; id?: string; pk?: string } | undefined)?.shortcode,
          (post.post as { shortcode?: string; code?: string } | undefined)?.code,
          (post.post as { id?: string; pk?: string } | undefined)?.id,
          (post.post as { id?: string; pk?: string } | undefined)?.pk,
          (post.content as { code?: string; shortcode?: string } | undefined)?.code,
          (post.content as { code?: string; shortcode?: string } | undefined)?.shortcode,
          (post.content as { id?: string; pk?: string } | undefined)?.id,
          (post.content as { id?: string; pk?: string } | undefined)?.pk,
        ].filter(Boolean).map(String)
        for (const k of keys) {
          const v = map[k]
          if (v && String(v).trim()) return v
        }
        return ''
      }
      // Ordenado: primeiros 4 são os destaques gerais (página de destaques do conteúdo)
      for (let i = 0; i < 4; i++) {
        postImageDataUrlsOrdered.push(getPostImageByKeys(topPostsForImages[i], postImageDataUrls))
      }

      if (abortRef.current) return

      setCachedMediaKit(h, {
        profile,
        posts,
        reels,
        tagged,
        highlights,
        activation: Object.keys(activation).length ? activation : null,
        reportInsights,
        profilePicDataUrl,
        postImageDataUrls: { ...postImageDataUrls },
        postImageDataUrlsOrdered: [...postImageDataUrlsOrdered],
      })

      setStatus('ready')
    } catch (e) {
      if (abortRef.current) return
      setError(e instanceof Error ? e.message : 'Não deu pra gerar o Media Kit. Tenta de novo.')
      setStatus('error')
    }
  }, [handle])

  useEffect(() => {
    runInBackground()
    return () => {
      abortRef.current = true
    }
  }, [runInBackground])

  const handleDownload = useCallback(async () => {
    if (!handle) return
    const h = handle.replace(/^@/, '')
    const cached = getCachedMediaKit(h)
    if (!cached) {
      setError('Dados indisponíveis. Tenta de novo.')
      setStatus('error')
      return
    }
    setStatus('generating')
    setProgress('Gerando PDF...')
    try {
      const themeToUse = themeRef.current
      const instagramUrl = `https://www.instagram.com/${h}/`
      const qrCodeDataUrl = await QRCode.toDataURL(instagramUrl, { width: 200, margin: 1 })
      const doc = (
        <MediaKitDocument
          profile={cached.profile}
          posts={cached.posts}
          reels={cached.reels ?? []}
          highlights={cached.highlights ?? []}
          activation={cached.activation}
          reportInsights={cached.reportInsights}
          profilePicDataUrl={cached.profilePicDataUrl}
          postImageDataUrls={cached.postImageDataUrls}
          postImageDataUrlsOrdered={cached.postImageDataUrlsOrdered}
          qrCodeDataUrl={qrCodeDataUrl}
          theme={themeToUse}
        />
      )
      const blob = await pdf(doc).toBlob()
      if (!blob || blob.size < MIN_PDF_SIZE) {
        setError('O PDF veio vazio ou inválido. Gera de novo.')
        setStatus('error')
        return
      }
      setStatus('saving')
      setProgress('Salvando arquivo...')
      const filename = `MediaKit_${h}.pdf`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.style.display = 'none'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setSavedPath(filename)
      setValidated(blob.size >= MIN_PDF_SIZE)
      setStatus('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não deu pra gerar o Media Kit. Tenta de novo.')
      setStatus('error')
    }
  }, [handle])

  if (status === 'not_activated' && handle) {
    return (
      <div style={{ padding: s.xl, maxWidth: 640, margin: '0 auto', textAlign: 'left' }}>
        <ActivationCtaPanel handle={handle} isMobile={isMobile} marginBottom={s.lg} />
        <div style={{ textAlign: 'center', marginTop: s.lg }}>
          <Button onClick={() => handle ? navigate(`/app/influencer/${encodeURIComponent(handle)}`) : navigate(-1)}>Voltar</Button>
        </div>
      </div>
    )
  }

  if (status === 'ready') {
    const displayHandle = handle ? `@${handle.replace(/^@/, '')}` : ''
    return (
      <div
        className="media-kit-success"
        style={{
          padding: s.xl,
          maxWidth: 520,
          margin: '0 auto',
          minHeight: '60vh',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}
      >
        <div
          className="media-kit-success-card"
          style={{
            background: 'var(--app-card-bg)',
            borderRadius: 24,
            boxShadow: 'var(--app-shadow-lg)',
            padding: s.xl + 8,
            border: '1px solid var(--app-border-light)',
            textAlign: 'center',
          }}
        >
          <h1
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: 'var(--app-text)',
              marginBottom: s.sm,
              lineHeight: 1.3,
            }}
          >
            {displayHandle ? (
              <>Seu Media Kit está pronto, {displayHandle}</>
            ) : (
              'Escolha uma cor e baixe seu Media Kit'
            )}
          </h1>
          <p
            style={{
              fontSize: 15,
              color: 'var(--app-text-secondary)',
              marginBottom: s.lg,
              lineHeight: 1.5,
            }}
          >
            A cor já vem selecionada. Clique em Baixar quando quiser.
          </p>

          <div style={{ marginBottom: s.lg, display: 'flex', justifyContent: 'center', gap: 12 }}>
            {THEME_ORDER.map((themeId) => {
              const isSelected = theme === themeId
              const swatchColor = THEME_SWATCH_COLORS[themeId]
              return (
                <button
                  key={themeId}
                  type="button"
                  title={`Tema ${themeId}`}
                  aria-label={`Tema: ${themeId}`}
                  onClick={() => setTheme(themeId)}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    border: isSelected ? '3px solid var(--app-accent)' : '1px solid var(--app-border-light)',
                    background: swatchColor,
                    cursor: 'pointer',
                    padding: 0,
                    boxShadow: isSelected ? 'var(--app-shadow-md)' : 'var(--app-shadow-sm)',
                  }}
                />
              )
            })}
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: s.lg }}>
            <Button
              size="large"
              type="primary"
              onClick={() => handleDownload()}
              style={{
                borderRadius: 12,
                paddingLeft: 24,
                paddingRight: 24,
                background: 'var(--app-primary)',
                borderColor: 'var(--app-primary)',
              }}
            >
              Baixar Media Kit
            </Button>
          </div>
          <button
            type="button"
            onClick={() => handle ? navigate(`/app/influencer/${encodeURIComponent(handle)}`) : navigate(-1)}
            style={{
              background: 'none',
              border: 'none',
              padding: 8,
              fontSize: 13,
              color: 'var(--app-text-tertiary)',
              cursor: 'pointer',
            }}
          >
            Voltar
          </button>
        </div>
      </div>
    )
  }

  if (status === 'done') {
    const displayHandle = handle ? `@${handle.replace(/^@/, '')}` : ''
    return (
      <div
        className="media-kit-success"
        style={{
          padding: s.xl,
          maxWidth: 520,
          margin: '0 auto',
          minHeight: '60vh',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}
      >
        <div
          className="media-kit-success-card"
          style={{
            background: 'var(--app-card-bg)',
            borderRadius: 24,
            boxShadow: 'var(--app-shadow-lg)',
            padding: s.xl + 8,
            border: '1px solid var(--app-border-light)',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              width: 72,
              height: 72,
              margin: '0 auto',
              borderRadius: '50%',
              background: 'var(--app-success-bg)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: s.lg,
            }}
          >
            <CheckCircleFilled style={{ fontSize: 36, color: 'var(--app-success)' }} />
          </div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: 'var(--app-text)',
              marginBottom: s.sm,
              lineHeight: 1.3,
            }}
          >
            {displayHandle ? (
              <>Pronto, {displayHandle}! Seu Media Kit saiu do forno.</>
            ) : (
              'Seu Media Kit está pronto!'
            )}
          </h1>
          <p
            style={{
              fontSize: 15,
              color: 'var(--app-text-secondary)',
              marginBottom: s.md,
              lineHeight: 1.5,
            }}
          >
            O arquivo <strong style={{ color: 'var(--app-text)' }}>{savedPath}</strong> foi salvo no seu computador.
            Pode abrir e mandar para as marcas.
          </p>
          {validated && (
            <p
              style={{
                fontSize: 12,
                color: 'var(--app-text-tertiary)',
                marginBottom: s.lg,
              }}
            >
              PDF validado (tamanho correto e pronto para usar).
            </p>
          )}

          <div style={{ marginBottom: s.lg, display: 'flex', justifyContent: 'center', gap: 12 }}>
            {THEME_ORDER.map((themeId) => {
              const isSelected = theme === themeId
              const swatchColor = THEME_SWATCH_COLORS[themeId]
              return (
                <button
                  key={themeId}
                  type="button"
                  title={`Tema ${themeId}`}
                  aria-label={`Tema: ${themeId}`}
                  onClick={() => setTheme(themeId)}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    border: isSelected ? '3px solid var(--app-accent)' : '1px solid var(--app-border-light)',
                    background: swatchColor,
                    cursor: 'pointer',
                    padding: 0,
                    boxShadow: isSelected ? 'var(--app-shadow-md)' : 'var(--app-shadow-sm)',
                  }}
                />
              )
            })}
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: s.lg }}>
            {handle && (
              <Button
                size="large"
                type="primary"
                onClick={() => handleDownload()}
                style={{
                  borderRadius: 12,
                  paddingLeft: 24,
                  paddingRight: 24,
                  background: 'var(--app-primary)',
                  borderColor: 'var(--app-primary)',
                }}
              >
                Baixar de novo
              </Button>
            )}
          </div>
          <button
            type="button"
            onClick={() => handle ? navigate(`/app/influencer/${encodeURIComponent(handle)}`) : navigate(-1)}
            style={{
              background: 'none',
              border: 'none',
              padding: 8,
              fontSize: 13,
              color: 'var(--app-text-tertiary)',
              cursor: 'pointer',
            }}
          >
            Voltar
          </button>
        </div>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div style={{ padding: s.xl, maxWidth: 480, margin: '0 auto', textAlign: 'center' }}>
        <Result
          status="error"
          title="Falha ao gerar Media Kit"
          subTitle={error ?? 'Tente novamente mais tarde.'}
          extra={[
            <Button key="back" onClick={() => handle ? navigate(`/app/influencer/${encodeURIComponent(handle)}`) : navigate(-1)}>
              Voltar
            </Button>,
            <Button key="retry" type="primary" onClick={() => runInBackground()}>
              Tentar novamente
            </Button>,
          ]}
        />
      </div>
    )
  }

  return (
    <div style={{ padding: s.xl, maxWidth: 400, margin: '0 auto', textAlign: 'center' }}>
      <Spin
        indicator={<LoadingOutlined style={{ fontSize: 48, color: c.primary }} spin />}
        size="large"
      />
      <div style={{ marginTop: s.xl }}>
        <Text strong style={{ display: 'block', marginBottom: s.xs }}>Gerando Media Kit em segundo plano</Text>
        <Text type="secondary" style={{ fontSize: 13 }}>{progress}</Text>
      </div>
      <div style={{ marginTop: s.lg }}>
        <Button type="text" onClick={() => navigate(-1)} style={{ color: c.textSecondary }}>
          Cancelar e voltar
        </Button>
      </div>
    </div>
  )
}
