import { Link } from 'react-router-dom'
import { Card, Button, Typography } from 'antd'
import { CrownOutlined, ArrowLeftOutlined } from '@ant-design/icons'

const { Title, Paragraph } = Typography

export default function Premium() {
  return (
    <div className="app-standalone-page">
      <div className="app-page" style={{ maxWidth: 560, margin: '0 auto', paddingTop: 48, paddingBottom: 48 }}>
        <Card styles={{ body: { padding: 32 } }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <CrownOutlined style={{ fontSize: 56, color: 'var(--app-primary)' }} />
          </div>
          <Title level={2} style={{ textAlign: 'center', marginBottom: 16 }}>
            Vira assinante
          </Title>
          <Paragraph style={{ fontSize: 16, color: 'var(--app-text-secondary)', textAlign: 'center', marginBottom: 24 }}>
          No grátis você vê só a primeira página e até 10 buscas por dia. Como assinante: mais páginas, filtros e métricas completas.
        </Paragraph>
        <Paragraph style={{ textAlign: 'center', marginBottom: 32 }}>
          Fala com a gente pra ver os planos.
        </Paragraph>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
            <Link to="/app">
              <Button icon={<ArrowLeftOutlined />}>Voltar à busca</Button>
            </Link>
          </div>
        </Card>
      </div>
    </div>
  )
}
