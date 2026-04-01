/**
 * Meu perfil: editar dados da conta, desvincular Instagram, alterar senha.
 */
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Form, Input, Button, Typography, message, Popconfirm, Space } from 'antd'
import { UserOutlined, MailOutlined, InstagramOutlined, LockOutlined } from '@ant-design/icons'
import { useAuth } from '../contexts/AuthContext'
import { updateMyProfile, setMyPassword, deleteAccount } from '../api'

const { Title, Text } = Typography

function getDisplayNameCurrent(user: { username: string; profile_handle?: string | null; displayName?: string | null } | null): string {
  if (!user) return ''
  const isEmail = user.username.includes('@')
  const profileHandle = user.profile_handle?.replace(/^@/, '').trim() || null
  const usernameIsHandle = profileHandle && user.username.replace(/^@/, '').trim().toLowerCase() === profileHandle.toLowerCase()
  const fallback = isEmail
    ? user.username.slice(0, user.username.indexOf('@')).replace(/^./, (c) => c.toUpperCase())
    : usernameIsHandle ? '' : user.username
  return (user.displayName != null && String(user.displayName).trim() !== '')
    ? String(user.displayName).trim()
    : fallback
}

export default function Profile() {
  const navigate = useNavigate()
  const { user, loginWithToken, refreshUser, logout } = useAuth()
  const displayNameCurrent = getDisplayNameCurrent(user)
  const [unlinkLoading, setUnlinkLoading] = useState(false)
  const [passwordLoading, setPasswordLoading] = useState(false)
  const [nameSaving, setNameSaving] = useState(false)
  const [nameValue, setNameValue] = useState(displayNameCurrent)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [passwordForm] = Form.useForm()

  useEffect(() => {
    setNameValue(displayNameCurrent)
  }, [displayNameCurrent])

  if (!user) {
    navigate('/login', { replace: true })
    return null
  }

  const isEmail = user.username.includes('@')
  const displayEmail = isEmail ? user.username : (user.username || '—')
  const profileHandle = user.profile_handle?.replace(/^@/, '').trim() || null
  const usernameIsHandle = profileHandle && user.username.replace(/^@/, '').trim().toLowerCase() === profileHandle.toLowerCase()
  const displayNameFallback = isEmail
    ? user.username.slice(0, user.username.indexOf('@')).replace(/^./, (c) => c.toUpperCase())
    : usernameIsHandle
      ? ''
      : user.username

  const handleUnlinkInstagram = async () => {
    setUnlinkLoading(true)
    try {
      const data = await updateMyProfile({ profile_handle: null })
      loginWithToken(data.token, {
        id: data.user.id,
        username: data.user.username,
        scope: data.user.scope as import('../contexts/AuthContext').AuthScope,
        profile_handle: data.user.profile_handle,
        displayName: data.user.display_name ?? null,
        emailVerified: data.user.email_verified,
      })
      await refreshUser()
      message.success('Instagram desvinculado da sua conta.')
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Falha ao desvincular')
    } finally {
      setUnlinkLoading(false)
    }
  }

  const handleSaveName = async () => {
    const trimmed = nameValue.trim()
    if (trimmed === displayNameCurrent) return
    setNameSaving(true)
    try {
      const data = await updateMyProfile({ display_name: trimmed || null })
      loginWithToken(data.token, {
        id: data.user.id,
        username: data.user.username,
        scope: data.user.scope as import('../contexts/AuthContext').AuthScope,
        profile_handle: data.user.profile_handle ?? null,
        displayName: data.user.display_name ?? null,
        emailVerified: data.user.email_verified,
      })
      await refreshUser()
      message.success('Nome atualizado.')
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Falha ao atualizar nome')
    } finally {
      setNameSaving(false)
    }
  }

  const handleDeleteAccount = async () => {
    setDeleteLoading(true)
    try {
      await deleteAccount()
      logout()
      window.location.href = '/'
      message.info('Sua conta foi excluída.')
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Não foi possível excluir a conta')
    } finally {
      setDeleteLoading(false)
    }
  }

  const handlePasswordSubmit = async (values: { newPassword: string; confirmPassword: string }) => {
    if (values.newPassword !== values.confirmPassword) {
      message.error('As senhas não conferem.')
      return
    }
    if (values.newPassword.length < 6) {
      message.error('A senha deve ter no mínimo 6 caracteres.')
      return
    }
    setPasswordLoading(true)
    try {
      await setMyPassword(values.newPassword)
      message.success('Senha alterada com sucesso.')
      passwordForm.resetFields()
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Falha ao alterar senha')
    } finally {
      setPasswordLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '24px 16px' }}>
      <Title level={3} style={{ marginBottom: 24 }}>
        Meu perfil
      </Title>

      <Card title={<span><UserOutlined style={{ marginRight: 8 }} />Dados da conta</span>} style={{ marginBottom: 16 }}>
        <Form layout="vertical" style={{ marginBottom: 0 }}>
          <Form.Item label="Nome" extra="Nome escolhido no cadastro. Você pode alterar quando quiser.">
            <Space.Compact style={{ width: '100%' }}>
              <Input
                prefix={<UserOutlined />}
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                placeholder={displayNameFallback || 'Ex.: seu nome'}
                style={{ flex: 1 }}
              />
              <Button type="primary" loading={nameSaving} onClick={handleSaveName}>
                Salvar
              </Button>
            </Space.Compact>
          </Form.Item>
          <Form.Item label="E-mail">
            <Input
              prefix={<MailOutlined />}
              value={isEmail ? displayEmail : '—'}
              readOnly
              disabled
              style={{ background: 'var(--app-bg)', color: 'var(--app-text)' }}
            />
          </Form.Item>
        </Form>
        {isEmail && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            O e-mail é o seu login e não pode ser alterado aqui.
          </Text>
        )}
      </Card>

      <Card
        title={<span><InstagramOutlined style={{ marginRight: 8 }} />Instagram vinculado</span>}
        style={{ marginBottom: 16 }}
      >
        {profileHandle ? (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Text strong>@{profileHandle}</Text>
              <Button
                type="link"
                size="small"
                onClick={() => navigate(`/app/influencer/${encodeURIComponent(profileHandle)}`)}
              >
                Ver perfil
              </Button>
            </div>
            <Popconfirm
              title="Desvincular Instagram?"
              description="O perfil do Instagram será removido da sua conta. Você poderá vincular outro perfil depois."
              onConfirm={handleUnlinkInstagram}
              okText="Desvincular"
              cancelText="Cancelar"
              okButtonProps={{ danger: true }}
            >
              <Button type="default" danger loading={unlinkLoading}>
                Desvincular Instagram
              </Button>
            </Popconfirm>
          </Space>
        ) : (
          <Space direction="vertical">
            <Text type="secondary">Nenhum perfil do Instagram vinculado.</Text>
            <Button type="primary" onClick={() => navigate('/app/missions/link-instagram')}>
              Vincular Instagram da empresa
            </Button>
          </Space>
        )}
      </Card>

      <Card title={<span><LockOutlined style={{ marginRight: 8 }} />Alterar senha</span>}>
        <Form
          form={passwordForm}
          layout="vertical"
          onFinish={handlePasswordSubmit}
          style={{ maxWidth: 360 }}
        >
          <Form.Item
            name="newPassword"
            label="Nova senha"
            rules={[
              { required: true, message: 'Informe a nova senha' },
              { min: 6, message: 'Mínimo 6 caracteres' },
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="Nova senha" autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label="Confirmar nova senha"
            dependencies={['newPassword']}
            rules={[
              { required: true, message: 'Confirme a nova senha' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) return Promise.resolve()
                  return Promise.reject(new Error('As senhas não conferem'))
                },
              }),
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="Repita a nova senha" autoComplete="new-password" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={passwordLoading}>
              Alterar senha
            </Button>
          </Form.Item>
        </Form>
      </Card>

      <div style={{ marginTop: 48, textAlign: 'center' }}>
        <Popconfirm
          title="Excluir conta?"
          description="Todos os seus dados serão removidos. Esta ação não pode ser desfeita."
          onConfirm={handleDeleteAccount}
          okText="Excluir conta"
          cancelText="Cancelar"
          okButtonProps={{ danger: true, loading: deleteLoading }}
        >
          <Button type="link" danger size="small" style={{ color: 'var(--app-text-tertiary)', fontSize: 12 }}>
            Excluir minha conta
          </Button>
        </Popconfirm>
      </div>
    </div>
  )
}
