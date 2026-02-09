import { useState, useEffect } from 'react'
import { Form, Input, Button, Card, message, Alert } from 'antd'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { requestVerificationCode, verifyProfile, extractProfileToBackend } from '../api'
import { SafetyCertificateOutlined, MessageOutlined, UserOutlined } from '@ant-design/icons'

export default function Auth() {
  const { user, refreshUser, loginWithToken } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [step, setStep] = useState<'nickname' | 'code'>('nickname')
  const [nickname, setNickname] = useState('')
  const [loading, setLoading] = useState(false)
  const [rejectionError, setRejectionError] = useState<string | null>(null)
  const [form] = Form.useForm()

  const savedNickname = (location.state as { nickname?: string })?.nickname
  useEffect(() => {
    if (savedNickname && form) {
      form.setFieldsValue({ nickname: savedNickname })
    }
  }, [savedNickname, form])

  const onRequestCode = async (values: { nickname: string }) => {
    const n = (values.nickname ?? '').replace(/^@/, '').trim()
    if (!n) return
    setRejectionError(null)
    setLoading(true)
    try {
      const extractResult = await extractProfileToBackend(n)
      if (extractResult.saved === false) {
        setRejectionError(extractResult.rejectionReason ?? extractResult.error ?? 'Perfil não elegível.')
        return
      }
      const data = await requestVerificationCode(n)
      setNickname(n)
      setStep('code')
      form.setFieldValue('code', data.code ?? '')
      if (data.sent) {
        message.success('Código enviado! Confira sua caixa de entrada do Instagram (direct).')
      } else if (data.code) {
        message.warning(data.error ?? 'DM não enviada. Use o código abaixo para testar.')
      } else if (data.error) {
        message.warning(data.error)
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Falha ao extrair perfil ou enviar código')
    } finally {
      setLoading(false)
    }
  }

  const onVerify = async (values: { code: string }) => {
    const code = (values.code ?? '').trim()
    if (!code || !nickname) return
    setLoading(true)
    try {
      const data = await verifyProfile(nickname, code)
      if (data.token && data.user) {
        loginWithToken(data.token, data.user)
        message.success('Entrada feita! Perfil validado.')
      } else {
        await refreshUser()
        message.success('Perfil validado com sucesso!')
      }
      navigate('/create/password', { state: { handle: nickname }, replace: true })
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Código inválido ou expirado')
    } finally {
      setLoading(false)
    }
  }

  const startOver = () => {
    setStep('nickname')
    setNickname('')
    setRejectionError(null)
    form.resetFields()
  }

  return (
    <div style={{ maxWidth: 420, margin: '48px auto', padding: '0 16px' }}>
      <Card
        title={
          <span>
            <SafetyCertificateOutlined style={{ marginRight: 8 }} />
            Validar perfil Instagram
          </span>
        }
        style={{ boxShadow: '0 2px 8px rgba(0,0,0,.1)' }}
      >
        {user?.profile_handle && step === 'nickname' && (
          <div style={{ marginBottom: 16, padding: 12, background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 8 }}>
            <p style={{ margin: 0 }}>
              Você já validou o perfil <strong>@{user.profile_handle}</strong>.
            </p>
            <div style={{ marginTop: 8 }}>
              <Button type="primary" size="small" onClick={() => navigate(`/activate/${user.profile_handle}`)}>
                Continuar
              </Button>
              <Button type="link" size="small" onClick={startOver} style={{ marginLeft: 8 }}>
                Validar outro perfil
              </Button>
            </div>
          </div>
        )}

        {step === 'nickname' && (
          <>
            {rejectionError && (
              <Alert
                type="error"
                message={rejectionError}
                closable
                onClose={() => setRejectionError(null)}
                style={{ marginBottom: 16 }}
              />
            )}
            <p style={{ color: '#666', marginBottom: 20 }}>
              Digite seu nickname do Instagram para iniciar. O código de ativação (2FA) será enviado para você por <strong>mensagem no Instagram</strong> (Direct).
            </p>
            <Form form={form} name="request-code" onFinish={onRequestCode} layout="vertical" requiredMark={false}>
              <Form.Item name="nickname" label="Seu nickname no Instagram" rules={[{ required: true, message: 'Informe seu @ do Instagram' }]}>
                <Input prefix={<UserOutlined style={{ color: '#bfbfbf' }} />} placeholder="ex: seu_usuario" size="large" autoComplete="username" />
              </Form.Item>
              <Form.Item>
                <Button type="primary" htmlType="submit" loading={loading} block size="large" icon={<MessageOutlined />}>
                  Enviar código por mensagem no Instagram
                </Button>
              </Form.Item>
            </Form>
          </>
        )}

        {step === 'code' && (
          <>
            <div style={{ marginBottom: 16, padding: 12, background: '#e6f4ff', border: '1px solid #91caff', borderRadius: 8 }}>
              <p style={{ margin: 0, color: '#666' }}>
                Enviamos um código de 6 dígitos por <strong>mensagem no Instagram</strong> para <strong>@{nickname}</strong>. Confira o Direct e digite o código abaixo.
              </p>
            </div>
            <Form form={form} name="verify" onFinish={onVerify} layout="vertical" requiredMark={false}>
              <Form.Item label="Nickname">
                <Input value={`@${nickname}`} disabled size="large" />
              </Form.Item>
              <Form.Item
                name="code"
                label="Código de ativação"
                rules={[{ required: true, message: 'Informe o código' }, { len: 6, message: 'O código tem 6 dígitos' }]}
              >
                <Input placeholder="000000" size="large" maxLength={6} autoComplete="one-time-code" style={{ letterSpacing: 8, textAlign: 'center', fontSize: 18 }} />
              </Form.Item>
              <Form.Item>
                <Button type="primary" htmlType="submit" loading={loading} block size="large" icon={<SafetyCertificateOutlined />}>
                  Validar perfil
                </Button>
              </Form.Item>
              <Form.Item>
                <Button type="link" block onClick={startOver} style={{ padding: 0 }}>
                  Usar outro nickname
                </Button>
              </Form.Item>
            </Form>
          </>
        )}
      </Card>
    </div>
  )
}
