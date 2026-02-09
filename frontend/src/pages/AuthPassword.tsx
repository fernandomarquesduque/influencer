import { useState } from 'react'
import { Form, Input, Button, Card, message } from 'antd'
import { useNavigate, useLocation } from 'react-router-dom'
import { setMyPassword } from '../api'
import { LockOutlined } from '@ant-design/icons'

export default function AuthPassword() {
  const navigate = useNavigate()
  const location = useLocation()
  const handle = (location.state as { handle?: string })?.handle || ''
  const [loading, setLoading] = useState(false)
  const [form] = Form.useForm()

  if (!handle) {
    navigate('/create', { replace: true })
    return null
  }

  const onFinish = async (values: { password: string; confirmPassword: string }) => {
    if (values.password !== values.confirmPassword) {
      message.error('As senhas não coincidem.')
      return
    }
    setLoading(true)
    try {
      await setMyPassword(values.password)
      message.success('Senha definida.')
      navigate(`/activate/${handle}`, { replace: true })
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Falha ao definir senha')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: '48px auto', padding: '0 16px' }}>
      <Card title="Definir senha" style={{ boxShadow: '0 2px 8px rgba(0,0,0,.1)' }}>
        <p style={{ marginBottom: 16, color: '#666' }}>
          Perfil <strong>@{handle}</strong> validado. Defina uma senha para acessar sua conta.
        </p>
        <Form form={form} name="set-password" onFinish={onFinish} layout="vertical" requiredMark={false}>
          <Form.Item
            name="password"
            label="Senha"
            rules={[
              { required: true, message: 'Informe a senha' },
              { min: 6, message: 'Mínimo 6 caracteres' },
            ]}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: '#bfbfbf' }} />}
              placeholder="Mínimo 6 caracteres"
              size="large"
              autoComplete="new-password"
            />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label="Confirmar senha"
            dependencies={['password']}
            rules={[
              { required: true, message: 'Confirme a senha' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('password') === value) return Promise.resolve()
                  return Promise.reject(new Error('As senhas não coincidem'))
                },
              }),
            ]}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: '#bfbfbf' }} />}
              placeholder="Repita a senha"
              size="large"
              autoComplete="new-password"
            />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block size="large" icon={<LockOutlined />}>
              Continuar
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  )
}
