/**
 * Tela de geração do Media Kit profissional.
 * Executa em background: carrega dados → gera PDF → salva → abre → valida.
 */
import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Button, Result, Spin, Typography } from 'antd'
import { CheckCircleFilled, LoadingOutlined } from '@ant-design/icons'
import { reportTokens as t } from './reportTokens'
import type { ThemeMode } from '../contexts/ThemeContext'
import { useTheme } from '../contexts/ThemeContext'
import {
  downloadMediaKitPdfToDevice,
  getCachedMediaKit,
  prepareMediaKitCache,
} from '../utils/mediaKitPipeline'

const { Text } = Typography

/** Cores das bolinhas = paleta do PDF apenas (não altera o tema da aplicação) */
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

type Status = 'loading_data' | 'ready' | 'generating' | 'saving' | 'done' | 'error'

export default function MediaKit() {
  const { handle } = useParams<{ handle: string }>()
  const navigate = useNavigate()
  const { theme: appTheme } = useTheme()
  /** Paleta de cores do PDF; independente do tema claro/escuro da interface */
  const [pdfPalette, setPdfPalette] = useState<ThemeMode>(appTheme)
  const pdfPaletteRef = useRef(pdfPalette)
  pdfPaletteRef.current = pdfPalette
  const [status, setStatus] = useState<Status>('loading_data')
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState('Carregando perfil...')
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [validated, setValidated] = useState(false)

  const runInBackground = useCallback(
    async (signal?: AbortSignal) => {
      if (!handle) {
        setError('Perfil não informado.')
        setStatus('error')
        return
      }
      const h = handle.replace(/^@/, '')

      try {
        setStatus('loading_data')
        setProgress('Carregando perfil...')

        const result = await prepareMediaKitCache(h, {
          signal,
          onProgress: (msg) => {
            if (!signal?.aborted) setProgress(msg)
          },
        })

        if (signal?.aborted) return

        if (result.ok) {
          setStatus('ready')
          return
        }
        if (result.code === 'no_profile') {
          setError('Perfil não encontrado.')
          setStatus('error')
          return
        }
        if (result.code === 'aborted') return
        setError(
          result.code === 'error'
            ? result.message
            : 'Não deu pra gerar o Media Kit. Tenta de novo.'
        )
        setStatus('error')
      } catch (e) {
        if (signal?.aborted) return
        setError(e instanceof Error ? e.message : 'Não deu pra gerar o Media Kit. Tenta de novo.')
        setStatus('error')
      }
    },
    [handle, navigate]
  )

  useEffect(() => {
    const ac = new AbortController()
    void runInBackground(ac.signal)
    return () => ac.abort()
  }, [runInBackground])

  const handleDownload = useCallback(async () => {
    if (!handle) return
    const h = handle.replace(/^@/, '')
    if (!getCachedMediaKit(h)) {
      setError('Dados indisponíveis. Tenta de novo.')
      setStatus('error')
      return
    }
    setStatus('generating')
    setProgress('Gerando PDF...')
    try {
      await downloadMediaKitPdfToDevice(h, pdfPaletteRef.current)
      setStatus('saving')
      setProgress('Salvando arquivo...')
      setSavedPath(`MediaKit_${h}.pdf`)
      setValidated(true)
      setStatus('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não deu pra gerar o Media Kit. Tenta de novo.')
      setStatus('error')
    }
  }, [handle])

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
              const isSelected = pdfPalette === themeId
              const swatchColor = THEME_SWATCH_COLORS[themeId]
              return (
                <button
                  key={themeId}
                  type="button"
                  title={`Cor do Media Kit: ${themeId}`}
                  aria-label={`Cor do Media Kit: ${themeId}`}
                  onClick={() => setPdfPalette(themeId)}
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
                background: THEME_SWATCH_COLORS[pdfPalette],
                borderColor: THEME_SWATCH_COLORS[pdfPalette],
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
              const isSelected = pdfPalette === themeId
              const swatchColor = THEME_SWATCH_COLORS[themeId]
              return (
                <button
                  key={themeId}
                  type="button"
                  title={`Cor do Media Kit: ${themeId}`}
                  aria-label={`Cor do Media Kit: ${themeId}`}
                  onClick={() => setPdfPalette(themeId)}
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
                  background: THEME_SWATCH_COLORS[pdfPalette],
                  borderColor: THEME_SWATCH_COLORS[pdfPalette],
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
            <Button key="retry" type="primary" onClick={() => void runInBackground()}>
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
