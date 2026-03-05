import { useNavigate, useLocation } from 'react-router-dom'
import { Card, Alert, Button } from 'antd'
import { useAuth } from '../contexts/AuthContext'

export default function AuthRejected() {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const reason = (location.state as { reason?: string })?.reason || 'Perfil não elegível.'

  const validateAnotherProfile = () => {
    logout()
    navigate('/app/create', { replace: true, state: {} })
  }

  return (
    <div style={{ maxWidth: 420, margin: '0 auto' }}>
      <Card title="Perfil não entrou no programa">
        <Alert type="warning" message="Motivo" description={reason} showIcon style={{ marginBottom: 24 }} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button type="primary" onClick={() => navigate('/app')}>
            Ver lista de influenciadores
          </Button>
          <Button onClick={validateAnotherProfile}>Validar outro perfil</Button>
        </div>
      </Card>
    </div>
  )
}
