/**
 * Missão 2: assinante vincula o Instagram da empresa (2FA). Ganha 10 créditos.
 * Rota: /app/missions/link-instagram (link no e-mail abre aqui).
 */
import { useState } from 'react'
import { Form, Input, Button, Card, message } from 'antd'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { requestVerificationCode, verifyProfile } from '../api'
import { InstagramOutlined, TrophyOutlined } from '@ant-design/icons'
export default function LinkInstagramMission() {
  const navigate = useNavigate()
  const { user, loginWithToken } = useAuth()
  const [step, setStep] = useState<'handle' | 'code'>('handle')
  const [handle, setHandle] = useState('')
  const [loading, setLoading] = useState(false)
  const [form] = Form.useForm()

  if (!user) {
    return (
      <div style={{ maxWidth: 480, margin: '40px auto', padding: 24 }}>
        <Card>
          <p>Faça login para vincular o Instagram da empresa e ganhar 10 créditos.</p>
          <Button type="primary" onClick={() => navigate('/influencer/login')}>Entrar</Button>
        </Card>
      </div>
    )
  }

  if (user.scope !== 'assinante') {
    return (
      <div style={{ maxWidth: 480, margin: '40px auto', padding: 24 }}>
        <Card>
          <p>Esta missão é para contas de assinante. Sua conta não é elegível.</p>
          <Button onClick={() => navigate('/app')}>Voltar</Button>
        </Card>
      </div>
    )
  }

  const onRequestCode = async (values: { handle: string }) => {
    const n = (values.handle ?? '').replace(/^@/, '').trim()
    if (!n) return
    setLoading(true)
    try {
      const data = await requestVerificationCode(n)
      setHandle(n)
      setStep('code')
      form.setFieldValue('code', data.code ?? '')
      if (data.sent) {
        message.success('Código enviado! Confira o Direct do Instagram.')
      } else if (data.code) {
        message.warning(data.error ?? 'Use o código que apareceu abaixo.')
      } else if (data.rejectionReason === 'nao_segue_perfil') {
        message.warning('É preciso seguir o perfil oficial do programa para receber o código no Direct.')
      } else if (data.error) {
        message.warning(data.error)
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Falha ao enviar código')
    } finally {
      setLoading(false)
    }
  }

  const onVerify = async (values: { code: string }) => {
    const code = (values.code ?? '').trim()
    if (!code || !handle) return
    setLoading(true)
    try {
      const data = await verifyProfile(handle, code)
      if (data.mission_completed && data.credits != null) {
        if (data.token && data.user) {
          loginWithToken(data.token, data.user as import('../contexts/AuthContext').AuthUser)
        }
        message.success('Missão concluída! +' + data.credits + ' créditos.')
        navigate(`/missions/reward?type=instagram&credits=${data.credits}`, { replace: true })
        return
      }
      message.success('Instagram vinculado à sua conta.')
      navigate('/app', { replace: true })
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Código inválido ou expirado')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 480, margin: '40px auto', padding: 24 }}>
        <Card
          title={
            <span>
              <TrophyOutlined style={{ marginRight: 8 }} />
              Missão 2: Vincule o Instagram da empresa
            </span>
          }
        >
          <p style={{ color: 'var(--app-text-secondary)', marginBottom: 24 }}>
            Siga o fluxo abaixo para vincular o perfil do Instagram da empresa à sua conta e ganhar <strong>10 créditos</strong>.
          </p>

          {step === 'handle' && (
            <Form form={form} layout="vertical" onFinish={onRequestCode}>
              <Form.Item
                name="handle"
                label="Usuário do Instagram (sem @)"
                rules={[{ required: true, message: 'Informe o @ do perfil' }]}
              >
                <Input
                  prefix={<InstagramOutlined />}
                  placeholder="ex: empresa_instagram"
                  onPressEnter={() => form.submit()}
                />
              </Form.Item>
              <Button type="primary" htmlType="submit" loading={loading} block>
                Enviar código para o Direct
              </Button>
            </Form>
          )}

          {step === 'code' && (
            <Form form={form} layout="vertical" onFinish={onVerify}>
              <p style={{ marginBottom: 16 }}>
                Enviamos um código para o Direct de <strong>@{handle}</strong>. Cole abaixo:
              </p>
              <Form.Item
                name="code"
                label="Código recebido"
                rules={[{ required: true, message: 'Informe o código' }]}
              >
                <Input placeholder="Código de 6 dígitos" maxLength={10} />
              </Form.Item>
              <Button type="primary" htmlType="submit" loading={loading} block style={{ marginBottom: 8 }}>
                Validar e ganhar 10 créditos
              </Button>
              <Button block onClick={() => { setStep('handle'); setHandle('') }} disabled={loading}>
                Trocar perfil
              </Button>
            </Form>
          )}
        </Card>
      </div>
  )
}
