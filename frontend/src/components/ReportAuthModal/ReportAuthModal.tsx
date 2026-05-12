import { useEffect, useState } from 'react'
import { App, Modal, Form, Input, Button, Typography, Space, Spin } from 'antd'
import { useNavigate } from 'react-router-dom'
import { UserOutlined, LockOutlined } from '@ant-design/icons'
import { useAuth } from '../../contexts/AuthContext'

const { Paragraph, Text } = Typography

export interface ReportAuthModalProps {
  open: boolean
  onCancel: () => void
  /** Chamado após login bem-sucedido no modal (ex.: criar campanha e redirecionar). */
  onAuthenticated: () => void | Promise<void>
  /** Quando true, desativa o formulário (ex.: criação do relatório em andamento). */
  externalBusy?: boolean
}

/**
 * Modal compacto na conclusão do wizard de busca: login para salvar o relatório ou link para cadastro.
 * Estilos: `.report-auth-modal-compact` em `index.css`.
 */
export default function ReportAuthModal({ open, onCancel, onAuthenticated, externalBusy }: ReportAuthModalProps) {
  const { message } = App.useApp()
  const { login } = useAuth()
  const navigate = useNavigate()
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) form.resetFields()
  }, [open, form])

  const busy = !!externalBusy || submitting

  const handleLogin = async (values: { username: string; password: string }) => {
    const u = values.username.replace(/^@/, '').trim()
    if (!u) {
      message.error('Informe seu usuário ou @.')
      return
    }
    setSubmitting(true)
    try {
      await login(u, values.password)
      message.success('Login realizado')
      await Promise.resolve(onAuthenticated())
    } catch {
      message.error('Usuário ou senha incorretos.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      className="report-auth-modal-compact"
      title="Entre para abrir o relatório completo"
      open={open}
      onCancel={busy ? () => {} : onCancel}
      footer={null}
      destroyOnHidden
      maskClosable={!busy}
      closable={!busy}
    >
      {externalBusy ? (
        <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
          <Spin />
          <Paragraph type="secondary" style={{ marginBottom: 0, marginTop: 12 }}>
            Criando seu relatório…
          </Paragraph>
        </div>
      ) : (
        <>
          <Paragraph type="secondary" style={{ marginBottom: 12 }}>
            Faça login com sua conta para gerar o relatório com a lista completa. Ainda não tem conta? Cadastre-se em poucos passos.
          </Paragraph>
          <Form form={form} layout="vertical" onFinish={handleLogin} requiredMark={false}>
            <Form.Item
              name="username"
              label="Usuário ou @"
              rules={[{ required: true, message: 'Obrigatório' }]}
            >
              <Input prefix={<UserOutlined />} placeholder="seu_usuario" autoComplete="username" disabled={busy} />
            </Form.Item>
            <Form.Item
              name="password"
              label="Senha"
              rules={[{ required: true, message: 'Obrigatório' }]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder="Senha" autoComplete="current-password" disabled={busy} />
            </Form.Item>
            <Form.Item style={{ marginBottom: 8 }}>
              <Button type="primary" htmlType="submit" block size="large" loading={submitting} disabled={!!externalBusy}>
                Entrar e continuar
              </Button>
            </Form.Item>
          </Form>
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <Button
              type="default"
              block
              size="large"
              disabled={busy}
              onClick={() => {
                onCancel()
                navigate('/app/create')
              }}
            >
              Fazer cadastro
            </Button>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', textAlign: 'center' }}>
              Ao cadastrar, você poderá salvar relatórios e acessar os dados completos dos criadores.
            </Text>
          </Space>
        </>
      )}
    </Modal>
  )
}
