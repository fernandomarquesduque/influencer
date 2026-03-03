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
}

const CONTENT_MAX_WIDTH = 1120
const PAGE_PADDING_DESKTOP = 24
const PAGE_PADDING_MOBILE = 16

export function ActivationCtaPanel({
  handle,
  isMobile,
  marginBottom = 40,
}: ActivationCtaPanelProps) {
  const navigate = useNavigate()

  const headline = 'Marcas perto de você estão procurando criadores agora.'
  const subline = 'Ao ativar, você entra na busca comercial e passa a ser considerado por marcas que procuram criadores na sua região.'
  const buttonLabel = 'Ativar e Gerar MediaKit'
  const disclaimer = 'Seu Media Kit organiza seus dados, comprova sua performance e aumenta sua credibilidade na hora de negociar com marcas.'

  const horizontalPadding = isMobile ? PAGE_PADDING_MOBILE : PAGE_PADDING_DESKTOP

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
          paddingBottom: marginBottom,
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
            background: 'var(--app-primary)',
            border: '2px solid var(--brand-white)',
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
                      background: 'var(--brand-white)',
                      border: '2px solid var(--app-border)',
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
                        color: 'var(--brand-white)',
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
                        color: 'var(--brand-white)',
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
              <div style={{ ...(isMobile && { marginTop: s.md }), display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: s.md }}>
                <Button
                  type="primary"
                  size="large"
                  icon={<RocketOutlined />}
                  onClick={() => navigate(`/activate/${encodeURIComponent(handle)}`)}
                  className="activation-cta-btn"
                  style={{
                    borderRadius: t.radius.md,
                    background: 'var(--app-warning)',
                    borderColor: 'transparent',
                    color: 'var(--app-text)',
                    fontWeight: 700,
                    minHeight: 48,
                  }}
                >
                  {buttonLabel}
                </Button>
                <Text
                  style={{
                    fontSize: typ.caption.fontSize,
                    color: 'var(--brand-white)',
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
