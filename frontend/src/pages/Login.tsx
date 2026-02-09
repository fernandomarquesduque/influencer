import { useState } from 'react'
import { Form, Input, Button, Card, message } from 'antd'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { UserOutlined, LockOutlined } from '@ant-design/icons'

export default function Login() {
  const [loading, setLoading] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: { pathname: string } })?.from?.pathname ?? '/'

  const onFinish = async (values: { login: string; password: string }) => {
    setLoading(true)
    try {
      await login(values.login, values.password)
      message.success('Login realizado com sucesso')
      navigate(from, { replace: true })
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Falha no login')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 400, margin: '48px auto' }}>
      <Card title="Entrar" style={{ boxShadow: '0 2px 8px rgba(0,0,0,.1)' }}>
        <Form
          name="login"
          onFinish={onFinish}
          layout="vertical"
          requiredMark={false}
        >
          <Form.Item
            name="login"
            rules={[{ required: true, message: 'Informe o usuário' }]}
          >
            <Input prefix={<UserOutlined />} placeholder="Usuário (handle @ ou admin)" size="large" autoComplete="username" />
          </Form.Item>
          <Form.Item
            name="password"
            rules={[{ required: true, message: 'Informe a senha' }]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="Senha" size="large" autoComplete="current-password" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block size="large">
              Entrar
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  )
}
