import { useNavigate, useLocation } from 'react-router-dom'
import { Card, Alert, Button } from 'antd'

export default function AuthRejected() {
  const navigate = useNavigate()
  const location = useLocation()
  const reason = (location.state as { reason?: string })?.reason || 'Perfil não elegível.'

  return (
    <div style={{ maxWidth: 420, margin: '48px auto', padding: '0 16px' }}>
      <Card title="Perfil não elegível" style={{ boxShadow: '0 2px 8px rgba(0,0,0,.1)' }}>
        <Alert type="warning" message="Motivo" description={reason} showIcon style={{ marginBottom: 24 }} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button type="primary" onClick={() => navigate('/')}>
            Ir para a lista
          </Button>
          <Button onClick={() => navigate('/create')}>Validar outro perfil</Button>
        </div>
      </Card>
    </div>
  )
}
