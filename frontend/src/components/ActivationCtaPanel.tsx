import { useNavigate } from 'react-router-dom'
import { Button, Row, Col, Typography } from 'antd'
import { RocketOutlined, AimOutlined, MessageOutlined, FilePdfOutlined } from '@ant-design/icons'
import { reportTokens as t } from '../pages/reportTokens'

const { Text } = Typography
const { spacing: s, radiusLegacy: r, shadowLegacy: sh, typography: typ } = t

const BENEFITS = [
  { icon: AimOutlined, title: 'Visibilidade', desc: 'Aparece na busca de marcas e agências parceiras' },
  { icon: MessageOutlined, title: 'Contato', desc: 'Seus dados ficam disponíveis para convites de campanhas' },
  { icon: FilePdfOutlined, title: 'Media Kit PDF', desc: 'Documento profissional para enviar a oportunidades' },
] as const

export interface ActivationCtaPanelProps {
  handle: string
  isMobile: boolean
  marginBottom?: number
}

export function ActivationCtaPanel({
  handle,
  isMobile,
  marginBottom = s.lg,
}: ActivationCtaPanelProps) {
  const navigate = useNavigate()

  const headline = 'Ative seu perfil para baixar o Media Kit e entrar na vitrine para marcas.'

  return (
    <div
      style={{
        marginBottom,
        minWidth: isMobile ? undefined : 600,
        width: '100%',
        maxWidth: '100%',
        boxSizing: 'border-box',
        borderRadius: r,
        border: '1px solid rgba(16, 185, 129, 0.5)',
        background: '#1e293b',
        boxShadow: sh,
        overflow: 'hidden',
        padding: isMobile ? s.lg : s.xl,
      }}
    >
      <Row gutter={isMobile ? 0 : s.lg} wrap>
        <Col xs={24} md={14}>
          <div style={{ marginBottom: s.md }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: s.sm, marginBottom: s.sm }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  background: 'rgba(16, 185, 129, 0.2)',
                  border: '1px solid rgba(16, 185, 129, 0.5)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <RocketOutlined style={{ fontSize: 20, color: '#34d399' }} />
              </div>
              <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
                <Text
                  strong
                  style={{
                    fontSize: isMobile ? typ.h2.fontSize : typ.h1.fontSize,
                    color: '#f8fafc',
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
                    color: '#cbd5e1',
                    lineHeight: 1.5,
                    display: 'block',
                    marginTop: 6,
                    wordWrap: 'break-word',
                    overflowWrap: 'break-word',
                  }}
                >
                  Perfis ativados aparecem na busca de parceiros e podem receber convites para campanhas.
                </Text>
              </div>
            </div>
          </div>

          <div style={{ padding: '20px 0px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: s.sm, rowGap: s.md }}>
            <Button
              type="primary"
              size="large"
              icon={<RocketOutlined />}
              onClick={() => navigate(`/activate/${encodeURIComponent(handle)}`)}
              className="btn-activate-green"
              style={{ borderRadius: t.radius.md, color: '#fff' }}
            >
              Ativar e ficar elegível
            </Button>
          </div>
          <Text style={{ fontSize: typ.caption.fontSize, color: '#94a3b8', lineHeight: 1.5, display: 'block', marginTop: s.md, maxWidth: isMobile ? '100%' : 420, wordWrap: 'break-word', overflowWrap: 'break-word' }}>
            A ativação não garante contratação — mas te coloca elegível para ser encontrado por parceiros.
          </Text>
        </Col>

        <Col xs={24} md={10}>
          <div style={{ ...(isMobile && { marginTop: s.lg }) }}>
            <Text
              style={{
                fontSize: typ.overline.fontSize,
                fontWeight: 600,
                color: '#94a3b8',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                display: 'block',
                marginBottom: s.sm,
              }}
            >
              O que você desbloqueia
            </Text>
            <div style={{ display: 'flex', flexDirection: 'column', gap: s.sm }}>
              {BENEFITS.map(({ icon: Icon, title, desc }) => (
                <div
                  key={title}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: s.sm,
                    padding: s.sm,
                    borderRadius: t.radius.sm,
                    background: 'rgba(255, 255, 255, 0.08)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    minWidth: 0,
                  }}
                >
                  <Icon style={{ fontSize: 16, color: '#34d399', flexShrink: 0 }} />
                  <div style={{ minWidth: 0, flex: 1, wordWrap: 'break-word', overflowWrap: 'break-word' }}>
                    <Text strong style={{ fontSize: typ.body.fontSize, color: '#f8fafc' }}>{title}</Text>
                    <Text style={{ fontSize: typ.bodySmall.fontSize, color: '#cbd5e1', display: 'block' }}>{desc}</Text>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Col>
      </Row>
    </div>
  )
}
