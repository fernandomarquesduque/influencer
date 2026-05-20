/**
 * Pipeline compartilhado: cache em memória, carga de dados e geração do PDF do Media Kit.
 * Usado pela página MediaKit e pelo botão "Gerar MediaKit" no detalhe do perfil.
 */
import { pdf } from '@react-pdf/renderer'
import QRCode from 'qrcode'
import {
  fetchProfile,
  fetchPosts,
  fetchProfileActivation,
  getProfilePicUrl,
  proxyImageUrl,
  proxyImageUrlForDisplay,
  authHeaders,
} from '../api'
import type { PostItem, ProfileItem, ProfileActivation, PostsResponse } from '../api'
import { buildReportInsights, getTopPosts, REPORT_POSTS_LIMIT } from './reportInsights'
import { MediaKitDocument } from '../pages/MediaKitDocument'
import type { ThemeMode } from '../contexts/ThemeContext'

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
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms)),
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

export const MIN_PDF_SIZE = 1000

const MEDIA_KIT_CACHE_TTL_MS = 10 * 60 * 1000

export interface MediaKitCacheEntry {
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

export function getCachedMediaKit(handle: string): MediaKitCacheEntry | null {
  const key = handle.replace(/^@/, '').toLowerCase()
  const entry = mediaKitCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.cachedAt > MEDIA_KIT_CACHE_TTL_MS) {
    mediaKitCache.delete(key)
    return null
  }
  return entry
}

export function setCachedMediaKit(handle: string, entry: Omit<MediaKitCacheEntry, 'cachedAt'>): void {
  const key = handle.replace(/^@/, '').toLowerCase()
  mediaKitCache.set(key, { ...entry, cachedAt: Date.now() })
}

export type PrepareMediaKitResult =
  | { ok: true }
  | { ok: false; code: 'no_profile' }
  | { ok: false; code: 'aborted' }
  | { ok: false; code: 'error'; message: string }

export async function prepareMediaKitCache(
  handle: string,
  options?: { onProgress?: (msg: string) => void; signal?: AbortSignal }
): Promise<PrepareMediaKitResult> {
  const onProgress = options?.onProgress ?? (() => {})
  const signal = options?.signal
  const h = handle.replace(/^@/, '')

  const cached = getCachedMediaKit(h)
  if (cached) {
    return { ok: true }
  }

  onProgress('Carregando perfil...')

  const [profileRes, postsRes, activationRes] = await Promise.all([
    fetchProfile(h).catch(() => null),
    fetchPosts(h, Math.max(REPORT_POSTS_LIMIT, 50), 0).catch((): PostsResponse => ({ items: [], total: 0 })),
    fetchProfileActivation(h).catch(() => ({} as ProfileActivation)),
  ])

  if (signal?.aborted) return { ok: false, code: 'aborted' }

  const profile = profileRes as ProfileItem | null
  if (!profile) return { ok: false, code: 'no_profile' }

  const allItems = postsRes.items ?? []
  const ct = (p: PostItem) => (p.content_type || 'post') as string
  const posts = allItems.filter((p) => ct(p) === 'post')
  const reels = allItems.filter((p) => ct(p) === 'reel')
  const tagged = allItems.filter((p) => ct(p) === 'tagged')
  const highlights = allItems.filter((p) => ct(p) === 'highlight')
  const activation = (activationRes && typeof activationRes === 'object' ? activationRes : {}) as ProfileActivation

  onProgress('Calculando dados...')
  const reportInsights = profile && allItems.length > 0 ? buildReportInsights(profile, allItems) : null

  onProgress('Carregando foto do perfil...')
  const profilePicUrl = proxyImageUrl(getProfilePicUrl(profile))
  const profilePicDataUrl = profilePicUrl ? await fetchImageAsDataUrl(profilePicUrl) : null

  if (signal?.aborted) return { ok: false, code: 'aborted' }

  onProgress('Carregando imagens dos posts...')

  function getPostImageUrlCandidates(p: PostItem): string[] {
    const urls: string[] = []
    const stable = p.media?.stable_cover_url
    if (typeof stable === 'string' && stable.startsWith('http')) urls.push(stable)
    const cover = p.media?.cover_images?.[0]?.url
    if (cover) urls.push(cover)
    const video = p.media?.video_versions?.[0]?.url
    if (video && !urls.includes(video)) urls.push(video)
    const topLevel = (p as { image_url?: string }).image_url
    if (topLevel && !urls.includes(topLevel)) urls.push(topLevel)
    const displayUrl =
      (p.media as { display_url?: string } | undefined)?.display_url ?? (p as { display_url?: string }).display_url
    if (displayUrl && !urls.includes(displayUrl)) urls.push(displayUrl)
    const contentImg = (p.content as { image_url?: string; thumbnail_url?: string; display_url?: string } | undefined)
      ?.image_url
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
    ]
      .filter(Boolean)
      .map(String)
    for (const k of keys) {
      const v = map[k]
      if (v && String(v).trim()) return v
    }
    return ''
  }

  const fc = profile?.followers_count ?? 0
  const topGlobal = (reportInsights?.topPosts?.byInteractions ?? []).slice(0, 4).map((t) => t.post)
  const topFeed = getTopPosts(posts, fc).byInteractions.slice(0, 2).map((t) => t.post)
  const topReels = getTopPosts(reels, fc).byInteractions.slice(0, 2).map((t) => t.post)
  const topTagged = getTopPosts(tagged, fc).byInteractions.slice(0, 2).map((t) => t.post)
  const seen = new Set<string>()
  const topPostsForImages: PostItem[] = []
  for (const post of [...topGlobal, ...topFeed, ...topReels, ...topTagged]) {
    const k =
      (post as { key?: string }).key ??
      (post as { id?: string }).id ??
      (post?.post as { shortcode?: string })?.shortcode ??
      ''
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
      (post.post as { shortcode?: string; code?: string } | undefined)?.code,
      (post.post as { id?: string; pk?: string } | undefined)?.id,
      (post.post as { id?: string; pk?: string } | undefined)?.pk,
      (post.content as { code?: string; shortcode?: string; id?: string; pk?: string } | undefined)?.code,
      (post.content as { code?: string; shortcode?: string } | undefined)?.shortcode,
      (post.content as { id?: string; pk?: string } | undefined)?.id,
      (post.content as { id?: string; pk?: string } | undefined)?.pk,
    ]
      .filter(Boolean)
      .map(String)
    for (const k of keys) {
      postImageDataUrls[k] = dataUrl
    }
  }

  async function tryLoadPostImage(post: PostItem): Promise<boolean> {
    const candidates = getPostImageUrlCandidates(post).slice(0, MAX_URL_CANDIDATES_PER_POST)
    for (const rawUrl of candidates) {
      const url = proxyImageUrlForDisplay(rawUrl) ?? proxyImageUrl(rawUrl)
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
  for (let i = 0; i < 4; i++) {
    postImageDataUrlsOrdered.push(getPostImageByKeys(topPostsForImages[i], postImageDataUrls))
  }

  if (signal?.aborted) return { ok: false, code: 'aborted' }

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

  return { ok: true }
}

export async function downloadMediaKitPdfToDevice(handle: string, theme: ThemeMode): Promise<void> {
  const h = handle.replace(/^@/, '')
  const cached = getCachedMediaKit(h)
  if (!cached) throw new Error('Dados indisponíveis. Tenta de novo.')

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
      theme={theme}
    />
  )
  const blob = await pdf(doc).toBlob()
  if (!blob || blob.size < MIN_PDF_SIZE) throw new Error('O PDF veio vazio ou inválido. Gera de novo.')

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
}
