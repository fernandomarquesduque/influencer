import { useNavigate, useLocation } from 'react-router-dom'
import { Card, Alert, Button } from 'antd'

export default function AuthRejected() {
  const navigate = useNavigate()
  const location = useLocation()
  const reason = (location.state as { reason?: string })?.reason || 'Perfil não elegível.'

  return (
    <div style={{ maxWidth: 420, margin: '0 auto' }}>
      <Card title="Perfil não elegível">
        <Alert type="warning" message="Motivo" description={reason} showIcon style={{ marginBottom: 24 }} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button type="primary" onClick={() => navigate('/app')}>
            Ir para a lista
          </Button>
          <Button onClick={() => navigate('/app/create')}>Validar outro perfil</Button>
        </div>
      </Card>
    </div>
  )
}
