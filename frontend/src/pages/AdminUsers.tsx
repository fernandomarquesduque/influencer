import { useEffect, useState } from 'react'
import {
  Table,
  Button,
  Card,
  Modal,
  Form,
  Input,
  Select,
  message,
  Space,
  Popconfirm,
  Typography,
} from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import { useAuth } from '../contexts/AuthContext'
import {
  fetchAdminUsers,
  createAdminUser,
  updateAdminUser,
  deleteAdminUser,
  type AdminUser,
  type AuthScope,
} from '../api'

const SCOPE_OPTIONS: { value: AuthScope; label: string }[] = [
  { value: 'adm', label: 'Administrador' },
  { value: 'assinante', label: 'Assinante' },
  { value: 'influencer', label: 'Influenciador' },
  { value: 'public', label: 'Público' },
]

export default function AdminUsers() {
  const { isAdm } = useAuth()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<AdminUser | null>(null)
  const [form] = Form.useForm()

  const load = async () => {
    setLoading(true)
    try {
      const list = await fetchAdminUsers()
      setUsers(list)
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Falha ao carregar usuários')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAdm) load()
  }, [isAdm])

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    setModalOpen(true)
  }

  const openEdit = (row: AdminUser) => {
    setEditing(row)
    form.setFieldsValue({
      username: row.username,
      scope: row.scope,
      profile_handle: row.profile_handle ?? '',
    })
    setModalOpen(true)
  }

  const onFinish = async (values: {
    username: string
    password?: string
    scope: AuthScope
    profile_handle?: string
  }) => {
    try {
      if (editing) {
        await updateAdminUser(editing.id, {
          username: values.username,
          scope: values.scope,
          profile_handle: values.profile_handle?.trim() || null,
          ...(values.password ? { password: values.password } : {}),
        })
        message.success('Usuário atualizado')
      } else {
        if (!values.password?.trim()) {
          message.error('Senha é obrigatória para novo usuário')
          return
        }
        await createAdminUser({
          username: values.username,
          password: values.password!,
          scope: values.scope,
          profile_handle: values.profile_handle?.trim() || null,
        })
        message.success('Usuário criado')
      }
      setModalOpen(false)
      load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Erro ao salvar')
    }
  }

  const onDelete = async (id: number) => {
    try {
      await deleteAdminUser(id)
      message.success('Usuário excluído')
      load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Erro ao excluir')
    }
  }

  if (!isAdm) {
    return (
      <Card>
        <Typography.Text type="danger">Acesso negado. Apenas administradores podem gerenciar usuários.</Typography.Text>
      </Card>
    )
  }

  return (
    <>
      <Card
        title="Usuários de acesso"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            Novo usuário
          </Button>
        }
      >
        <Table
          rowKey="id"
          loading={loading}
          dataSource={users}
          columns={[
            { title: 'ID', dataIndex: 'id', width: 72 },
            { title: 'Usuário', dataIndex: 'username' },
            {
              title: 'Perfil',
              dataIndex: 'scope',
              render: (scope: AuthScope) => SCOPE_OPTIONS.find((o) => o.value === scope)?.label ?? scope,
            },
            { title: 'Handle (influencer)', dataIndex: 'profile_handle', render: (v: string | null) => v ?? '—' },
            {
              title: 'Ações',
              width: 140,
              render: (_, row: AdminUser) => (
                <Space>
                  <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>
                    Editar
                  </Button>
                  <Popconfirm
                    title="Excluir este usuário?"
                    onConfirm={() => onDelete(row.id)}
                  >
                    <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                      Excluir
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
          pagination={{ pageSize: 20 }}
        />
      </Card>

      <Modal
        title={editing ? 'Editar usuário' : 'Novo usuário'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        footer={null}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={onFinish}>
          <Form.Item
            name="username"
            label="Usuário"
            rules={[{ required: true, message: 'Usuário é obrigatório' }]}
          >
            <Input placeholder="@handle ou nome de usuário" />
          </Form.Item>
          {!editing && (
            <Form.Item name="password" label="Senha" rules={[{ required: true, message: 'Obrigatório para novo usuário' }]}>
              <Input.Password placeholder="Senha" />
            </Form.Item>
          )}
          {editing && (
            <Form.Item name="password" label="Nova senha (deixe em branco para manter)">
              <Input.Password placeholder="Opcional" />
            </Form.Item>
          )}
          <Form.Item name="scope" label="Perfil de acesso" rules={[{ required: true }]}>
            <Select options={SCOPE_OPTIONS} placeholder="Selecione" />
          </Form.Item>
          <Form.Item name="profile_handle" label="Handle do perfil (apenas para perfil Influenciador)">
            <Input placeholder="@handle ou vazio" />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                {editing ? 'Salvar' : 'Criar'}
              </Button>
              <Button onClick={() => setModalOpen(false)}>Cancelar</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
