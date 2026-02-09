import { Link } from 'react-router-dom'
import { Card, Button, Typography } from 'antd'
import { CrownOutlined, ArrowLeftOutlined } from '@ant-design/icons'

const { Title, Paragraph } = Typography

export default function Premium() {
  return (
    <div style={{ maxWidth: 560, margin: '48px auto' }}>
      <Card
        style={{ boxShadow: '0 2px 12px rgba(0,0,0,.1)' }}
        styles={{ body: { padding: 32 } }}
      >
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <CrownOutlined style={{ fontSize: 56, color: '#faad14' }} />
        </div>
        <Title level={2} style={{ textAlign: 'center', marginBottom: 16 }}>
          Seja assinante
        </Title>
        <Paragraph style={{ fontSize: 16, color: '#666', textAlign: 'center', marginBottom: 24 }}>
          No plano gratuito você vê apenas a primeira página e até 10 buscas por dia.
          Como assinante você acessa mais páginas, filtros avançados e métricas completas dos influenciadores.
        </Paragraph>
        <Paragraph style={{ textAlign: 'center', marginBottom: 32 }}>
          Entre em contato com nossa equipe para conhecer os planos.
        </Paragraph>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
          <Link to="/">
            <Button icon={<ArrowLeftOutlined />}>Voltar à busca</Button>
          </Link>
        </div>
      </Card>
    </div>
  )
}
