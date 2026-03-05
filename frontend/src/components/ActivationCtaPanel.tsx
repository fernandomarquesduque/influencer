import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Row, Col, Typography } from 'antd'
import { RocketOutlined } from '@ant-design/icons'
import { reportTokens as t } from '../pages/reportTokens'

const { Text } = Typography
const { spacing: s, typography: typ } = t

export interface ActivationCtaPanelProps {
  handle: string
  isMobile: boolean
  marginBottom?: number
  /** Id do elemento âncora (ex.: secao-metricas-mediakit). O painel só aparece quando essa seção estiver pelo menos 50% visível (meio da seção). */
  scrollAnchorId?: string
}

const CONTENT_MAX_WIDTH = 1120
const PAGE_PADDING_DESKTOP = 24
const PAGE_PADDING_MOBILE = 16

const VISIBILITY_THRESHOLD = 0.5

export function ActivationCtaPanel({
  handle,
  isMobile,
  marginBottom = 90,
  scrollAnchorId,
}: ActivationCtaPanelProps) {
  const navigate = useNavigate()
  const [showPanel, setShowPanel] = useState(!scrollAnchorId)
  const hasReachedMetricasRef = useRef(false)

  useEffect(() => {
    if (!scrollAnchorId) return
    const el = document.getElementById(scrollAnchorId)
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        const [e] = entries
        if (!e) return
        const rect = e.boundingClientRect
        const inView = e.intersectionRatio >= VISIBILITY_THRESHOLD
        const pastSection = rect.bottom < 0
        const aboveSection = rect.top >= (typeof window !== 'undefined' ? window.innerHeight : 0)

        if (inView || pastSection) hasReachedMetricasRef.current = true
        if (aboveSection) hasReachedMetricasRef.current = false

        // Mostra a partir do meio da seção; some só quando rolar de volta e ficar acima de métricas
        setShowPanel(hasReachedMetricasRef.current && !aboveSection)
      },
      { threshold: [0, VISIBILITY_THRESHOLD], rootMargin: '0px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [scrollAnchorId])

  const headline = 'Marcas perto de você procuram criadores agora.'
  const subline = 'Ativando, você entra na busca e marcas da sua região te encontram.'
  const buttonLabel = 'Ativar cadastro'
  const disclaimer = 'Monetiza seus posts e sua reputação.'

  const horizontalPadding = isMobile ? PAGE_PADDING_MOBILE : PAGE_PADDING_DESKTOP

  if (!showPanel) return null

  return (
    <>
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 1000,
          paddingLeft: horizontalPadding,
          paddingRight: horizontalPadding,
          paddingBottom: marginBottom + 65,
          boxSizing: 'border-box',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            pointerEvents: 'auto',
            maxWidth: CONTENT_MAX_WIDTH,
            margin: '0 auto',
            maxHeight: '85vh',
            overflowY: 'auto',
            background: 'color-mix(in srgb, var(--app-card-bg-soft) 92%, transparent)',
            border: '2px solid var(--app-primary)',
            borderRadius: t.radius.lg,
            padding: isMobile ? s.lg : s.xl,
            paddingBottom: `max(${s.xl}px, env(safe-area-inset-bottom))`,
            boxSizing: 'border-box',
          }}
        >
          <Row gutter={isMobile ? 0 : s.lg} wrap align="top">
            <Col xs={24} md={14}>
              <div style={{ marginBottom: s.lg }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: s.sm, marginBottom: s.sm }}>
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 14,
                      background: 'var(--app-primary-muted)',
                      border: '1px solid var(--app-border)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <RocketOutlined style={{ fontSize: 24, color: 'var(--app-primary)' }} />
                  </div>
                  <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
                    <Text
                      strong
                      style={{
                        fontSize: isMobile ? typ.h2.fontSize : typ.h1.fontSize,
                        color: 'var(--app-text)',
                        letterSpacing: '-0.02em',
                        lineHeight: 1.3,
                        display: 'block',
                        wordWrap: 'break-word',
                        overflowWrap: 'break-word',
                      }}
                    >
                      {headline}
                    </Text>
                    <Text
                      style={{
                        fontSize: typ.body.fontSize,
                        color: 'var(--app-text-secondary)',
                        lineHeight: 1.5,
                        display: 'block',
                        marginTop: 8,
                        wordWrap: 'break-word',
                        overflowWrap: 'break-word',
                      }}
                    >
                      {subline}
                    </Text>
                  </div>
                </div>
              </div>
            </Col>

            <Col xs={24} md={10}>
              <div style={{ ...(isMobile && { marginTop: s.md }), textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: s.md }}>
                <Button
                  type="default"
                  size="large"
                  icon={<RocketOutlined />}
                  onClick={() => navigate(`/activate/${encodeURIComponent(handle)}`)}
                  className="activation-cta-btn"
                  style={{
                    borderRadius: t.radius.md,
                    background: 'var(--app-primary)',
                    borderColor: 'var(--app-primary)',
                    color: 'var(--brand-white)',
                    fontWeight: 700,
                    minHeight: 48,
                  }}
                >
                  {buttonLabel}
                </Button>
                <Text
                  style={{
                    fontSize: typ.caption.fontSize,
                    color: 'var(--app-text-secondary)',
                    lineHeight: 1.5,
                    display: 'block',
                    maxWidth: 420,
                    wordWrap: 'break-word',
                    overflowWrap: 'break-word',
                  }}
                >
                  {disclaimer}
                </Text>
              </div>
            </Col>
          </Row>
        </div>
      </div>
    </>
  )
}
