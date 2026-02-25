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
import { buildReportInsights, REPORT_POSTS_LIMIT } from '../utils/reportInsights'
import type { ProfileItem, ProfileActivation, PostsResponse } from '../api'
import { MediaKitDocument } from './MediaKitDocument'
import { reportTokens as t } from './reportTokens'
import { ActivationCtaPanel } from '../components/ActivationCtaPanel'
import { useTheme } from '../contexts/ThemeContext'

const { Text } = Typography
const s = t.spacing
const c = t.colors

type Status = 'loading_data' | 'generating' | 'saving' | 'done' | 'error' | 'not_activated'

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
  const { theme } = useTheme()
  const themeRef = useRef(theme)
  themeRef.current = theme
  const [status, setStatus] = useState<Status>('loading_data')
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState('Carregando perfil...')
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [validated, setValidated] = useState(false)
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768)
  const abortRef = useRef(false)
  const effectRunIdRef = useRef(0)

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const runInBackground = useCallback(async (effectRunId?: number) => {
    if (!handle) {
      setError('Handle do perfil não informado.')
      setStatus('error')
      return
    }
    abortRef.current = false
    const h = handle.replace(/^@/, '')

    try {
      const cached = getCachedMediaKit(h)
      const hasWhatsapp = (act: ProfileActivation | null) => !!(act?.whatsapp && String(act.whatsapp).trim())
      if (cached) {
        if (!hasWhatsapp(cached.activation)) {
          mediaKitCache.delete(h.toLowerCase())
          setStatus('not_activated')
          return
        }
        setStatus('generating')
        setProgress('Gerando PDF (dados em cache)...')
        if (abortRef.current) return
        const currentTheme = themeRef.current
        const doc = (
          <MediaKitDocument
            profile={cached.profile}
            posts={cached.posts}
            activation={cached.activation}
            reportInsights={cached.reportInsights}
            profilePicDataUrl={cached.profilePicDataUrl}
            postImageDataUrls={cached.postImageDataUrls}
            postImageDataUrlsOrdered={cached.postImageDataUrlsOrdered}
            theme={currentTheme}
          />
        )
        const blob = await pdf(doc).toBlob()
        if (abortRef.current) return
        if (!blob || blob.size < MIN_PDF_SIZE) {
          mediaKitCache.delete(h.toLowerCase())
          setError('O PDF gerado está vazio ou inválido.')
          setStatus('error')
          return
        }
        if (typeof effectRunId === 'number' && effectRunId !== effectRunIdRef.current) return
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

      const posts = postsRes.items ?? []
      const activation = (activationRes && typeof activationRes === 'object' ? activationRes : {}) as ProfileActivation

      if (!hasWhatsapp(activation)) {
        setStatus('not_activated')
        return
      }

      setProgress('Calculando insights...')
      const reportInsights = profile && posts.length > 0 ? buildReportInsights(profile, posts) : null

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
      // Só os 4 posts usados no PDF: capa (post 0) + 4 destaques
      const topPostsForImages = (reportInsights?.topPosts?.byInteractions ?? [])
        .slice(0, 4)
        .map((t) => t.post)
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
        Promise.all(topPostsForImages.slice(0, 4).map((post) => loadOne(post))),
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
      for (let i = 0; i < 4; i++) {
        postImageDataUrlsOrdered.push(getPostImageByKeys(topPostsForImages[i], postImageDataUrls))
      }

      if (abortRef.current) return

      setCachedMediaKit(h, {
        profile,
        posts,
        activation: Object.keys(activation).length ? activation : null,
        reportInsights,
        profilePicDataUrl,
        postImageDataUrls: { ...postImageDataUrls },
        postImageDataUrlsOrdered: [...postImageDataUrlsOrdered],
      })

      setStatus('generating')
      setProgress('Gerando PDF...')

      const currentTheme = themeRef.current
      const doc = (
        <MediaKitDocument
          profile={profile}
          posts={posts}
          activation={Object.keys(activation).length ? activation : null}
          reportInsights={reportInsights}
          profilePicDataUrl={profilePicDataUrl}
          postImageDataUrls={postImageDataUrls}
          postImageDataUrlsOrdered={postImageDataUrlsOrdered}
          theme={currentTheme}
        />
      )

      const blob = await pdf(doc).toBlob()
      if (abortRef.current) return

      if (!blob || blob.size < MIN_PDF_SIZE) {
        setError('O PDF gerado está vazio ou inválido.')
        setStatus('error')
        return
      }

      // Em Strict Mode o efeito roda 2x: só a última execução dispara o download (1 arquivo só)
      if (typeof effectRunId === 'number' && effectRunId !== effectRunIdRef.current) return

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
      if (abortRef.current) return
      setError(e instanceof Error ? e.message : 'Erro ao gerar Media Kit.')
      setStatus('error')
    }
  }, [handle])

  useEffect(() => {
    effectRunIdRef.current += 1
    runInBackground(effectRunIdRef.current)
    return () => {
      abortRef.current = true
    }
  }, [runInBackground])

  if (status === 'not_activated' && handle) {
    return (
      <div style={{ padding: s.xl, maxWidth: 640, margin: '0 auto', textAlign: 'left' }}>
        <ActivationCtaPanel handle={handle} isMobile={isMobile} marginBottom={s.lg} />
        <div style={{ textAlign: 'center', marginTop: s.lg }}>
          <Button onClick={() => navigate(-1)}>Voltar</Button>
        </div>
      </div>
    )
  }

  if (status === 'done') {
    return (
      <div style={{ padding: s.xl, maxWidth: 480, margin: '0 auto', textAlign: 'center' }}>
        <Result
          status="success"
          icon={<CheckCircleFilled style={{ color: c.success }} />}
          title="Media Kit gerado com sucesso"
          subTitle={
            <>
              <Text style={{ display: 'block', marginBottom: s.sm }}>
                O arquivo <strong>{savedPath}</strong> foi salvo no seu computador.
              </Text>
              {validated && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  PDF validado (tamanho correto e aberto no navegador).
                </Text>
              )}
            </>
          }
          extra={[
            <Button key="back"
              style={{ marginBottom: 10 }}
              onClick={() => navigate(-1)}>
              Voltar
            </Button>,
            handle && (
              <Button
                key="again"
                type="primary"
                style={{ marginBottom: 10 }}
                onClick={() => {
                  setStatus('loading_data')
                  setError(null)
                  setSavedPath(null)
                  setValidated(false)
                  runInBackground()
                }}
              >
                Gerar novamente
              </Button>
            ),
          ].filter(Boolean)}
        />
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
            <Button key="back" onClick={() => navigate(-1)}>
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
