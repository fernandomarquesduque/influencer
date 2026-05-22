import { Link } from 'react-router-dom'
import { Card, Button, Typography } from 'antd'
import { CrownOutlined, ArrowLeftOutlined, DollarOutlined } from '@ant-design/icons'
import AppPageBackdrop from '../components/AppPageBackdrop'

const { Title, Paragraph } = Typography

export default function Premium() {
  return (
    <div className="app-standalone-page">
      <AppPageBackdrop />
      <div className="app-page" style={{ maxWidth: 560, margin: '0 auto', paddingTop: 48, paddingBottom: 48 }}>
        <Card styles={{ body: { padding: 32 } }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <CrownOutlined style={{ fontSize: 56, color: 'var(--app-primary)' }} />
          </div>
          <Title level={2} style={{ textAlign: 'center', marginBottom: 16 }}>
            Vira assinante
          </Title>
          <Paragraph style={{ fontSize: 16, color: 'var(--app-text-secondary)', textAlign: 'center', marginBottom: 24 }}>
            No você vê só a primeira página e até 10 buscas por dia. Como assinante: mais páginas, filtros e métricas completas.
          </Paragraph>
          <Paragraph style={{ textAlign: 'center', marginBottom: 32 }}>
            Compre créditos com PIX ou Boleto e use nos relatórios de influenciadores.
          </Paragraph>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
            <Link to="/checkout">
              <Button type="primary" icon={<DollarOutlined />}>Comprar créditos</Button>
            </Link>
            <Link to="/app">
              <Button icon={<ArrowLeftOutlined />}>Voltar à busca</Button>
            </Link>
          </div>
        </Card>
      </div>
    </div>
  )
}
