import { useEffect, useState, useMemo } from 'react'
import { useNavigate, useParams, useLocation, Link } from 'react-router-dom'
import { Card, Button, Typography, Tag, Spin, Empty, Input, Select, Space } from 'antd'
import { ArrowLeftOutlined, SendOutlined, FolderOpenOutlined, DollarOutlined, TeamOutlined, CheckCircleOutlined } from '@ant-design/icons'
import { fetchProjects, fetchProject, applyToProject, type ProjectItem } from '../api'
import { useAuth } from '../contexts/AuthContext'

const { Title, Text, Paragraph } = Typography

function formatBudget(min: number | null, max: number | null): string {
  if (min == null && max == null) return 'A combinar'
  if (min != null && max != null) return `R$ ${min.toLocaleString('pt-BR')} – R$ ${max.toLocaleString('pt-BR')}`
  if (min != null) return `A partir de R$ ${min.toLocaleString('pt-BR')}`
  return `Até R$ ${max!.toLocaleString('pt-BR')}`
}

function ProjectList() {
  const navigate = useNavigate()
  const { user, isAdm } = useAuth()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<ProjectItem[]>([])
  const [total, setTotal] = useState(0)
  const [category, setCategory] = useState<string | undefined>()
  const [status, setStatus] = useState<string>('open')

  useEffect(() => {
    if (!user) return
    setLoading(true)
    fetchProjects({ status, category, limit: 24, offset: 0 })
      .then((res) => {
        setData(res.items)
        setTotal(res.total)
      })
      .catch(() => {
        setData([])
        setTotal(0)
      })
      .finally(() => setLoading(false))
  }, [user, status, category])

  const categoryOptions = useMemo(() => {
    const set = new Set<string>()
    data.forEach((p) => {
      if (p.category?.trim()) set.add(p.category.trim())
    })
    if (category?.trim()) set.add(category.trim())
    const list = Array.from(set).sort((a, b) => a.localeCompare(b))
    const label = (c: string) => c.charAt(0).toUpperCase() + c.slice(1).toLowerCase()
    return [
      { value: '', label: 'Todas as categorias' },
      ...list.map((c) => ({ value: c, label: label(c) })),
    ]
  }, [data, category])

  if (!user) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Title level={4} style={{ color: 'var(--app-text)' }}>Faça login para ver os projetos</Title>
        <Link to="/login"><Button type="primary">Entrar</Button></Link>
      </div>
    )
  }

  const influencerInativo = user.scope === 'influencer' && (!user.profile_handle || user.profile_activated === false)
  if (influencerInativo) {
    const temHandle = !!user.profile_handle
    return (
      <div style={{ padding: 48, textAlign: 'center', maxWidth: 480, margin: '0 auto' }}>
        <Title level={4} style={{ color: 'var(--app-text)', marginBottom: 16 }}>
          Complete seu cadastro
        </Title>
        <Paragraph style={{ color: 'var(--app-text-secondary)', marginBottom: 24, fontSize: 15 }}>
          {temHandle
            ? 'Para ver e se candidatar a projetos, finalize o cadastro do seu perfil de influenciador (dados, preços e ativação).'
            : 'Para ver e se candidatar a projetos, ative seu perfil de influenciador na plataforma. Valide seu perfil do Instagram e preencha seus dados.'}
        </Paragraph>
        <Link to={temHandle ? `/activate/${encodeURIComponent(user.profile_handle!)}` : '/app/create'}>
          <Button type="primary" size="large">
            {temHandle ? 'Finalizar cadastro' : 'Completar cadastro'}
          </Button>
        </Link>
      </div>
    )
  }

  return (
    <div>
      <div style={{ marginBottom: 24, display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <Title level={3} style={{ margin: 0, color: 'var(--app-text)' }}>Projetos</Title>
          <Text type="secondary">Encontre campanhas e trabalhos para representar como influenciador</Text>
        </div>
        {isAdm && (
          <Link to="/app/projects/new">
            <Button type="primary" size="large">Publicar projeto</Button>
          </Link>
        )}
      </div>

      <Space style={{ marginBottom: 20 }} wrap>
        <Select
          value={status}
          onChange={setStatus}
          options={[
            { value: 'open', label: 'Abertos' },
            { value: 'closed', label: 'Encerrados' },
          ]}
          style={{ width: 140 }}
        />
        <Select
          placeholder="Filtrar por categoria"
          allowClear
          value={category ?? ''}
          onChange={(v) => setCategory(v ? v : undefined)}
          options={categoryOptions}
          style={{ width: 200 }}
        />
      </Space>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 48 }}><Spin size="large" /></div>
      ) : data.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={status === 'open' ? 'Nenhum projeto aberto no momento.' : 'Nenhum projeto encerrado.'}
          style={{ padding: 48 }}
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
          {[...data]
            .sort((a, b) => (b.has_applied ? 1 : 0) - (a.has_applied ? 1 : 0))
            .map((p) => (
            <Card
              key={p.id}
              hoverable
              onClick={() => navigate(`/app/projects/${p.id}`)}
              style={{
                borderRadius: 12,
                border: p.has_applied ? '2px solid #52c41a' : undefined,
                borderLeft: p.has_applied ? '6px solid #52c41a' : undefined,
                backgroundColor: p.has_applied ? '#f6ffed' : undefined,
                position: 'relative',
              }}
              styles={{ body: { padding: 20 } }}
            >
              {p.has_applied && (
                <div
                  style={{
                    margin: '-20px -20px 12px -20px',
                    background: '#52c41a',
                    color: '#fff',
                    fontSize: 12,
                    fontWeight: 600,
                    padding: '8px 20px',
                    borderRadius: '12px 12px 0 0',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <CheckCircleOutlined /> Você se candidatou a este projeto
                </div>
              )}
              <div style={{ marginBottom: 12 }}>
                {p.has_applied && (
                  <Tag color="success" icon={<CheckCircleOutlined />} style={{ marginBottom: 8 }}>
                    Candidatado
                  </Tag>
                )}
                {p.category && <Tag color="blue" style={{ marginBottom: 8 }}>{p.category}</Tag>}
                {p.status === 'closed' && <Tag color="default">Encerrado</Tag>}
              </div>
              <Title level={5} style={{ margin: '0 0 8px', color: 'var(--app-text)' }} ellipsis={{ rows: 2 }}>
                {p.title}
              </Title>
              {p.client_name && (
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                  <TeamOutlined style={{ marginRight: 4 }} /> {p.client_name}
                </Text>
              )}
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                <DollarOutlined style={{ marginRight: 4 }} /> {formatBudget(p.budget_min, p.budget_max)}
              </Text>
              <Paragraph ellipsis={{ rows: 2 }} style={{ marginBottom: 0, fontSize: 13, color: 'var(--app-text-secondary)' }}>
                {p.description}
              </Paragraph>
            </Card>
          ))}
        </div>
      )}
      {total > 0 && (
        <Text type="secondary" style={{ display: 'block', marginTop: 16 }}>
          {data.length} de {total} projeto(s)
        </Text>
      )}
    </div>
  )
}

function ProjectDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [project, setProject] = useState<ProjectItem | null>(null)
  const [applying, setApplying] = useState(false)
  const [applyMessage, setApplyMessage] = useState('')
  const [applied, setApplied] = useState(false)

  useEffect(() => {
    if (!id || !user) return
    const numId = Number(id)
    if (!Number.isInteger(numId)) {
      setLoading(false)
      return
    }
    setLoading(true)
    fetchProject(numId)
      .then(setProject)
      .catch(() => setProject(null))
      .finally(() => setLoading(false))
  }, [id, user])

  const handleApply = () => {
    if (!project || applied) return
    setApplying(true)
    applyToProject(project.id, applyMessage)
      .then(() => setApplied(true))
      .finally(() => setApplying(false))
  }

  if (!user) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Title level={4} style={{ color: 'var(--app-text)' }}>Faça login para ver o projeto</Title>
        <Link to="/login"><Button type="primary">Entrar</Button></Link>
      </div>
    )
  }

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 48 }}><Spin size="large" /></div>
  }
  if (!project) {
    return (
      <div style={{ padding: 24 }}>
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/app/projects')}>Voltar</Button>
        <Empty description="Projeto não encontrado" style={{ padding: 48 }} />
      </div>
    )
  }

  const canApply = user.scope === 'influencer' && project.status === 'open' && !project.has_applied && user.profile_handle

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/app/projects')} style={{ marginBottom: 16 }}>
        Voltar aos projetos
      </Button>
      <Card style={{ borderRadius: 12 }} styles={{ body: { padding: 24 } }}>
        <div style={{ marginBottom: 16 }}>
          {project.category && <Tag color="blue">{project.category}</Tag>}
          {project.status === 'closed' && <Tag color="default">Encerrado</Tag>}
        </div>
        <Title level={3} style={{ margin: '0 0 12px', color: 'var(--app-text)' }}>{project.title}</Title>
        {project.client_name && (
          <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
            <TeamOutlined style={{ marginRight: 6 }} /> {project.client_name}
          </Text>
        )}
        <div style={{ marginBottom: 20 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>Orçamento</Text>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--app-text)' }}>
            {formatBudget(project.budget_min, project.budget_max)}
          </div>
        </div>
        <div style={{ marginBottom: 20 }}>
          <Text strong style={{ display: 'block', marginBottom: 8 }}>Descrição</Text>
          <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0, color: 'var(--app-text-secondary)' }}>
            {project.description}
          </Paragraph>
        </div>
        {project.requirements && (
          <div style={{ marginBottom: 20 }}>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>Requisitos</Text>
            <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0, color: 'var(--app-text-secondary)' }}>
              {project.requirements}
            </Paragraph>
          </div>
        )}
        {project.applications_count != null && project.applications_count > 0 && (
          <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
            {project.applications_count} candidatura(s)
          </Text>
        )}

        {canApply && !applied && (
          <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--app-border)' }}>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>Mensagem (opcional)</Text>
            <Input.TextArea
              rows={3}
              placeholder="Apresente-se em poucas linhas..."
              value={applyMessage}
              onChange={(e) => setApplyMessage(e.target.value)}
              style={{ marginBottom: 12 }}
            />
            <Button type="primary" icon={<SendOutlined />} loading={applying} onClick={handleApply}>
              Candidatar-se
            </Button>
          </div>
        )}
        {project.has_applied && (
          <Tag color="green" style={{ marginTop: 16 }}>Você já se candidatou a este projeto</Tag>
        )}
        {applied && (
          <Tag color="green" style={{ marginTop: 16 }}>Candidatura enviada com sucesso!</Tag>
        )}
      </Card>
    </div>
  )
}

/** Rota /app/projects/new: formulário para adm publicar projeto (opcional, pode fazer depois). Por ora redireciona. */
function ProjectNew() {
  const navigate = useNavigate()
  const { user, isAdm } = useAuth()
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({
    title: '',
    description: '',
    client_name: '',
    category: '',
    budget_min: '' as string | number,
    budget_max: '' as string | number,
    requirements: '',
  })

  if (!user || !isAdm) {
    return <div style={{ padding: 24 }}><Empty description="Acesso restrito a administradores." /></div>
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim() || !form.description.trim()) return
    setSubmitting(true)
    try {
      const { createProject } = await import('../api')
      await createProject({
        title: form.title.trim(),
        description: form.description.trim(),
        client_name: form.client_name.trim() || undefined,
        category: form.category.trim() || undefined,
        requirements: form.requirements.trim() || undefined,
        budget_min: form.budget_min === '' ? undefined : Number(form.budget_min),
        budget_max: form.budget_max === '' ? undefined : Number(form.budget_max),
      })
      navigate('/app/projects')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/app/projects')} style={{ marginBottom: 16 }}>
        Voltar
      </Button>
      <Card title="Publicar projeto" style={{ borderRadius: 12 }}>
        <form onSubmit={handleSubmit}>
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <div>
              <Text strong style={{ display: 'block', marginBottom: 4 }}>Título *</Text>
              <Input
                required
                placeholder="Ex.: Campanha de lançamento produto X"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                autoFocus
              />
            </div>
            <div>
              <Text strong style={{ display: 'block', marginBottom: 4 }}>Descrição *</Text>
              <Input.TextArea
                required
                rows={4}
                placeholder="Descreva o projeto, objetivos e entregas..."
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div>
              <Text strong style={{ display: 'block', marginBottom: 4 }}>Cliente / Marca</Text>
              <Input
                placeholder="Nome da marca ou cliente"
                value={form.client_name}
                onChange={(e) => setForm((f) => ({ ...f, client_name: e.target.value }))}
              />
            </div>
            <div>
              <Text strong style={{ display: 'block', marginBottom: 4 }}>Categoria</Text>
              <Input
                placeholder="Ex.: moda, fitness, viagem"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              />
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 120 }}>
                <Text strong style={{ display: 'block', marginBottom: 4 }}>Orçamento mín. (R$)</Text>
                <Input
                  type="number"
                  min={0}
                  placeholder="0"
                  value={form.budget_min}
                  onChange={(e) => setForm((f) => ({ ...f, budget_min: e.target.value }))}
                />
              </div>
              <div style={{ flex: 1, minWidth: 120 }}>
                <Text strong style={{ display: 'block', marginBottom: 4 }}>Orçamento máx. (R$)</Text>
                <Input
                  type="number"
                  min={0}
                  placeholder="0"
                  value={form.budget_max}
                  onChange={(e) => setForm((f) => ({ ...f, budget_max: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <Text strong style={{ display: 'block', marginBottom: 4 }}>Requisitos</Text>
              <Input.TextArea
                rows={2}
                placeholder="Requisitos para o influenciador..."
                value={form.requirements}
                onChange={(e) => setForm((f) => ({ ...f, requirements: e.target.value }))}
              />
            </div>
            <Button type="primary" htmlType="submit" loading={submitting} icon={<FolderOpenOutlined />}>
              Publicar projeto
            </Button>
          </Space>
        </form>
      </Card>
    </div>
  )
}

export default function Projects() {
  const { id } = useParams<{ id?: string }>()
  const location = useLocation()
  const isNew = location.pathname === '/app/projects/new'

  if (isNew) return <ProjectNew />
  if (id && id !== 'new') return <ProjectDetail />
  return <ProjectList />
}