import { useState } from 'react'
import { Form, Input, Button, Card, message } from 'antd'
import { useNavigate, useLocation } from 'react-router-dom'
import { setMyPassword } from '../api'
import { LockOutlined, MessageOutlined } from '@ant-design/icons'

export default function AuthPassword() {
  const navigate = useNavigate()
  const location = useLocation()
  const handle = (location.state as { handle?: string })?.handle || ''
  const [loading, setLoading] = useState(false)
  const [form] = Form.useForm()

  if (!handle) {
    navigate('/app/create', { replace: true })
    return null
  }

  const onFinish = async (values: { password: string; confirmPassword: string }) => {
    if (values.password !== values.confirmPassword) {
      message.error('As duas senhas precisam ser iguais.')
      return
    }
    setLoading(true)
    try {
      await setMyPassword(values.password)
      message.success('Senha criada. Te levando pro seu relatório...')
      navigate(`/app/influencer/${encodeURIComponent(handle)}`, { state: { fromSignup: true }, replace: true })
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Não deu pra criar a senha. Tenta de novo.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: '0 auto' }}>
      <Card title="Cadastrar sua senha">
        <p style={{ marginBottom: 16, color: 'var(--app-text-secondary)' }}>
          <strong>@{handle}</strong> validado. Cria uma senha pra acessar quando quiser.
        </p>
        <Form form={form} name="set-password" onFinish={onFinish} layout="vertical" requiredMark={false}>
          <Form.Item
            name="password"
            label="Senha"
            rules={[
              { required: true, message: 'Coloca uma senha com no mínimo 6 caracteres.' },
              { min: 6, message: 'Coloca uma senha com no mínimo 6 caracteres.' },
            ]}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: '#bfbfbf' }} />}
              placeholder="Mín. 6 caracteres"
              size="large"
              autoComplete="new-password"
              autoFocus
            />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label="Repetir a senha"
            dependencies={['password']}
            rules={[
              { required: true, message: 'Repete a senha.' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('password') === value) return Promise.resolve()
                  return Promise.reject(new Error('As duas senhas precisam ser iguais.'))
                },
              }),
            ]}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: '#bfbfbf' }} />}
              placeholder="Repete a mesma senha"
              size="large"
              autoComplete="new-password"
            />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block size="large" icon={<LockOutlined />}>
              Continuar
            </Button>
          </Form.Item>
          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <Button
              type="link"
              size="small"
              icon={<MessageOutlined />}
              onClick={() => navigate(`/app/influencer/${encodeURIComponent(handle)}`, { state: { fromSignup: true }, replace: true })}
              style={{ color: 'var(--app-text-tertiary)', fontSize: 13 }}
            >
              Pular e entrar por DM
            </Button>
          </div>
        </Form>
      </Card>
    </div>
  )
}
