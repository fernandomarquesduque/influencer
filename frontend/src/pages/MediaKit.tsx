/**
 * Tela de geração do Media Kit profissional.
 * Executa em background: carrega dados → gera PDF → salva → abre → valida.
 */
import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Button, Result, Spin, Typography } from 'antd'
import { CheckCircleFilled, LoadingOutlined } from '@ant-design/icons'
import { pdf } from '@react-pdf/renderer'
import { fetchProfile, fetchPosts, fetchProfileActivation, getProfilePicUrl, proxyImageUrl } from '../api'
import { buildReportInsights, REPORT_POSTS_LIMIT } from '../utils/reportInsights'
import type { ProfileItem, ProfileActivation, PostsResponse } from '../api'
import { MediaKitDocument } from './MediaKitDocument'
import { reportTokens as t } from './reportTokens'

const { Text } = Typography
const s = t.spacing
const c = t.colors

type Status = 'loading_data' | 'generating' | 'saving' | 'done' | 'error'

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = reject
    r.readAsDataURL(blob)
  })
}

async function fetchImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { mode: 'cors' })
    if (!res.ok) return null
    const blob = await res.blob()
    if (!blob.type.startsWith('image/')) return null
    return blobToDataUrl(blob)
  } catch {
    return null
  }
}

const MIN_PDF_SIZE = 1000 // 1KB mínimo para considerar PDF válido

export default function MediaKit() {
  const { handle } = useParams<{ handle: string }>()
  const navigate = useNavigate()
  const [status, setStatus] = useState<Status>('loading_data')
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState('Carregando perfil...')
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [validated, setValidated] = useState(false)
  const abortRef = useRef(false)

  const runInBackground = useCallback(async () => {
    if (!handle) {
      setError('Handle do perfil não informado.')
      setStatus('error')
      return
    }
    abortRef.current = false
    const h = handle.replace(/^@/, '')

    try {
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

      setProgress('Calculando insights...')
      const reportInsights = profile && posts.length > 0 ? buildReportInsights(profile, posts) : null

      setProgress('Carregando foto do perfil...')
      const profilePicUrl = proxyImageUrl(getProfilePicUrl(profile))
      const profilePicDataUrl = profilePicUrl ? await fetchImageAsDataUrl(profilePicUrl) : null

      if (abortRef.current) return
      setStatus('generating')
      setProgress('Gerando PDF...')

      const doc = (
        <MediaKitDocument
          profile={profile}
          posts={posts}
          activation={Object.keys(activation).length ? activation : null}
          reportInsights={reportInsights}
          profilePicDataUrl={profilePicDataUrl}
        />
      )

      const blob = await pdf(doc).toBlob()
      if (abortRef.current) return

      if (!blob || blob.size < MIN_PDF_SIZE) {
        setError('O PDF gerado está vazio ou inválido.')
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
      setProgress('Abrindo PDF para validação...')

      const openUrl = URL.createObjectURL(blob)
      const opened = window.open(openUrl, '_blank', 'noopener,noreferrer')
      if (opened) {
        opened.addEventListener('load', () => {
          setTimeout(() => URL.revokeObjectURL(openUrl), 5000)
        })
      } else {
        URL.revokeObjectURL(openUrl)
      }

      setValidated(blob.size >= MIN_PDF_SIZE)
      setStatus('done')
    } catch (e) {
      if (abortRef.current) return
      setError(e instanceof Error ? e.message : 'Erro ao gerar Media Kit.')
      setStatus('error')
    }
  }, [handle])

  useEffect(() => {
    runInBackground()
    return () => {
      abortRef.current = true
    }
  }, [runInBackground])

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
            <Button key="back" onClick={() => navigate(-1)}>
              Voltar ao relatório
            </Button>,
            handle && (
              <Button
                key="again"
                type="primary"
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
