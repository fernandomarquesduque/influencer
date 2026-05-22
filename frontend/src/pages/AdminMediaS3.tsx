/**
 * Admin: perfis com LLM concluído, sem mídia estável no S3, e fila de re-extração (Playwright → S3).
 */
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  App,
  Button,
  Card,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  Row,
  Col,
  Statistic,
} from 'antd'
import type { TableRowSelection } from 'antd/es/table/interface'
import {
  ArrowLeftOutlined,
  CloudUploadOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import { useAuth } from '../contexts/AuthContext'
import {
  adminEnqueueAllFilteredExtractQueue,
  adminEnqueueExtractQueue,
  fetchAdminExtractQueue,
  fetchAdminMediaS3Audit,
  type AdminExtractQueueStatus,
  type AdminMediaS3AuditResponse,
  type AdminMediaS3Filter,
  type AdminMediaS3MissingRow,
} from '../api'
import './AdminDashboard.css'

const PAGE_SIZE = 50
const QUEUE_POLL_MS = 4000

function formatInt(n: number): string {
  return n.toLocaleString('pt-BR')
}

export default function AdminMediaS3() {
  const { message, modal } = App.useApp()
  const { isAdm } = useAuth()

  const [filter, setFilter] = useState<AdminMediaS3Filter>('any')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [audit, setAudit] = useState<AdminMediaS3AuditResponse | null>(null)
  const [loadingAudit, setLoadingAudit] = useState(false)
  const [queue, setQueue] = useState<AdminExtractQueueStatus | null>(null)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [addHandleInput, setAddHandleInput] = useState('')
  const [enqueuingHandles, setEnqueuingHandles] = useState<Set<string>>(new Set())
  const [bulkEnqueuing, setBulkEnqueuing] = useState(false)

  const loadQueue = useCallback(async () => {
    try {
      const data = await fetchAdminExtractQueue()
      setQueue(data)
    } catch {
      /* polling silencioso */
    }
  }, [])

  const patchAuditQueueFlags = useCallback((handles: string[], inQueue: boolean) => {
    const norm = new Set(handles.map((h) => h.replace(/^@/, '').trim().toLowerCase()))
    setAudit((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        items: prev.items.map((row) =>
          norm.has(row.handle) ? { ...row, in_extract_queue: inQueue } : row
        ),
      }
    })
  }, [])

  const loadAudit = useCallback(
    async (opts?: { refresh?: boolean; silent?: boolean }) => {
      if (!opts?.silent) setLoadingAudit(true)
      try {
        const data = await fetchAdminMediaS3Audit({
          limit: PAGE_SIZE,
          offset: (page - 1) * PAGE_SIZE,
          filter,
          q,
          refresh: opts?.refresh,
        })
        setAudit(data)
        if (opts?.refresh) message.success('Auditoria atualizada.')
      } catch (e) {
        message.error(e instanceof Error ? e.message : 'Erro ao carregar auditoria')
        setAudit(null)
      } finally {
        if (!opts?.silent) setLoadingAudit(false)
      }
    },
    [filter, q, page, message]
  )

  useEffect(() => {
    if (!isAdm) return
    void loadAudit()
  }, [isAdm, loadAudit])

  useEffect(() => {
    if (!isAdm) return
    void loadQueue()
    const id = setInterval(() => void loadQueue(), QUEUE_POLL_MS)
    return () => clearInterval(id)
  }, [isAdm, loadQueue])

  const enqueueAllFiltered = () => {
    const total = audit?.total ?? 0
    if (total === 0) {
      message.warning('Nenhum perfil pendente com os filtros atuais.')
      return
    }
    modal.confirm({
      title: 'Enfileirar todos?',
      content: `Serão enfileirados até ${formatInt(total)} perfil(is) com LLM concluído que aparecem na lista filtrada (fora os que já estão na fila). A extração roda uma por vez.`,
      okText: 'Enfileirar todos',
      cancelText: 'Cancelar',
      onOk: async () => {
        setBulkEnqueuing(true)
        try {
          const out = await adminEnqueueAllFilteredExtractQueue({ filter, q })
          if (out.message && out.added === 0) {
            message.info(out.message)
          } else {
            message.success(
              `${formatInt(out.added)} enfileirado(s) de ${formatInt(out.total)} · ${formatInt(out.skipped)} já na fila ou ignorado(s). A extração roda em série; pendências de S3 somem após concluir.`
            )
          }
          setSelectedRowKeys([])
          await loadQueue()
          void loadAudit({ silent: true })
        } catch (e) {
          message.error(e instanceof Error ? e.message : 'Falha ao enfileirar todos')
        } finally {
          setBulkEnqueuing(false)
        }
      },
    })
  }

  const enqueueHandles = async (handles: string[]) => {
    const clean = handles.map((h) => h.replace(/^@/, '').trim().toLowerCase()).filter(Boolean)
    if (clean.length === 0) {
      message.warning('Nenhum @ válido.')
      return
    }
    setEnqueuingHandles((prev) => {
      const next = new Set(prev)
      clean.forEach((h) => next.add(h))
      return next
    })
    try {
      const out = await adminEnqueueExtractQueue(clean)
      if (out.added > 0) {
        message.success(
          `${out.added} enfileirado(s), ${out.skipped} ignorado(s). Extração em andamento (uma por vez).`
        )
        patchAuditQueueFlags(clean, true)
      } else {
        const detail = out.results?.find((r) => !r.queued)?.message
        message.info(
          detail ||
            (out.skipped > 0
              ? 'Perfil já na fila, em processamento ou sem LLM concluído.'
              : 'Nenhum perfil enfileirado (exige LLM concluído).')
        )
      }
      setSelectedRowKeys([])
      setAddHandleInput('')
      await loadQueue()
      void loadAudit({ silent: true })
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Falha ao enfileirar')
      patchAuditQueueFlags(clean, false)
    } finally {
      setEnqueuingHandles((prev) => {
        const next = new Set(prev)
        clean.forEach((h) => next.delete(h))
        return next
      })
    }
  }

  const rowSelection: TableRowSelection<AdminMediaS3MissingRow> = {
    selectedRowKeys,
    onChange: (keys) => setSelectedRowKeys(keys),
  }

  if (!isAdm) {
    return (
      <div className="admin-dashboard">
        <Typography.Text type="danger">Acesso negado. Apenas administradores.</Typography.Text>
      </div>
    )
  }

  const summary = audit?.summary
  const blockedUntil = queue?.extract_blocked_until
  const blockedLabel =
    blockedUntil && blockedUntil > Date.now()
      ? `Extração bloqueada até ${new Date(blockedUntil).toLocaleString('pt-BR')}`
      : null

  return (
    <div className="admin-dashboard">
      <div className="admin-dashboard__top">
        <div className="admin-dashboard__title-block">
          <Space direction="vertical" size={4}>
            <Link to="/app/admin/dashboard">
              <Button type="link" icon={<ArrowLeftOutlined />} style={{ padding: 0, height: 'auto' }}>
                Voltar ao painel admin
              </Button>
            </Link>
            <h1 style={{ margin: 0 }}>Mídia S3 e fila de extração</h1>
            <p style={{ margin: 0 }}>
              Perfis com classificação LLM concluída, sem avatar ou capas estáveis no S3, e fila de re-extração (só
              enfileira quem tem LLM preenchido).
            </p>
          </Space>
        </div>
        <Space wrap>
          <Button
            type="primary"
            icon={<ReloadOutlined />}
            loading={loadingAudit}
            onClick={() => void loadAudit({ refresh: true })}
          >
            Atualizar auditoria
          </Button>
        </Space>
      </div>

      {blockedLabel ? (
        <div className="admin-dashboard__warn" style={{ marginBottom: 16 }}>
          {blockedLabel}
        </div>
      ) : null}

      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic
              title="Com LLM classificado"
              value={summary?.llm_done_profiles ?? '—'}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic title="Sem avatar S3" value={summary?.missing_avatar ?? '—'} valueStyle={{ color: '#e11d48' }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic title="Sem capas S3" value={summary?.missing_covers ?? '—'} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic title="Com pendência" value={summary?.missing_any ?? '—'} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic title="Na fila agora" value={queue?.length ?? summary?.extract_queue_length ?? '—'} />
          </Card>
        </Col>
      </Row>

      <section className="admin-dashboard__section" style={{ marginBottom: 24 }}>
        <div className="admin-dashboard__section-head">
          <span className="admin-dashboard__section-accent" style={{ background: '#14b8a6' }} />
          <div className="admin-dashboard__section-head-text">
            <h2>Fila de extração</h2>
            <span className="admin-dashboard__section-muted">
              Re-extração serial (prioridade admin ignora intervalo de 60 min)
            </span>
          </div>
        </div>
        <Card size="small" style={{ marginBottom: 12 }}>
          <Space wrap style={{ width: '100%' }} align="start">
            <Input
              placeholder="@handle ou profile_ref"
              value={addHandleInput}
              onChange={(e) => setAddHandleInput(e.target.value)}
              onPressEnter={() => void enqueueHandles([addHandleInput])}
              style={{ minWidth: 220 }}
            />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              loading={bulkEnqueuing}
              onClick={() => void enqueueHandles([addHandleInput])}
            >
              Adicionar à fila
            </Button>
            <Button
              loading={bulkEnqueuing}
              disabled={selectedRowKeys.length === 0}
              onClick={() => void enqueueHandles(selectedRowKeys as string[])}
            >
              Enfileirar selecionados ({selectedRowKeys.length})
            </Button>
            <Button
              loading={bulkEnqueuing}
              disabled={!audit?.summary?.missing_any}
              onClick={() => {
                if (!audit?.items?.length) {
                  message.info('Atualize a auditoria e filtre perfis pendentes.')
                  return
                }
                void enqueueHandles(audit.items.map((r) => r.handle))
              }}
            >
              Enfileirar página atual
            </Button>
          </Space>
        </Card>
        {queue?.processing_handle ? (
          <div style={{ marginBottom: 8 }}>
            <Tag color="processing">Processando agora: @{queue.processing_handle}</Tag>
          </div>
        ) : null}
        {queue && queue.pending.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {queue.pending.map((h) => (
              <Tag
                key={h}
                color={queue.priority_handles.includes(h) ? 'purple' : 'blue'}
              >
                @{h}
                {queue.priority_handles.includes(h) ? ' · prio' : ''}
              </Tag>
            ))}
          </div>
        ) : queue?.processing_handle ? (
          <Typography.Text type="secondary">Aguardando na fila: nenhum (só o perfil em processamento acima).</Typography.Text>
        ) : (
          <Typography.Text type="secondary">Fila vazia.</Typography.Text>
        )}
      </section>

      <section className="admin-dashboard__section">
        <div className="admin-dashboard__section-head">
          <span className="admin-dashboard__section-accent" style={{ background: '#6366f1' }} />
          <div className="admin-dashboard__section-head-text">
            <h2>Perfis sem mídia S3 (com LLM)</h2>
            <span className="admin-dashboard__section-muted">
              {audit
                ? `Gerado em ${new Date(audit.generated_at).toLocaleString('pt-BR')} · só perfis com LLM concluído`
                : '—'}
            </span>
          </div>
        </div>
        <Space wrap style={{ marginBottom: 16 }}>
          <Input
            placeholder="Buscar @ ou nome"
            prefix={<SearchOutlined />}
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setPage(1)
            }}
            onPressEnter={() => void loadAudit()}
            style={{ width: 220 }}
            allowClear
          />
          <Select
            value={filter}
            onChange={(v) => {
              setFilter(v)
              setPage(1)
            }}
            style={{ width: 200 }}
            options={[
              { value: 'any', label: 'Avatar ou capas' },
              { value: 'avatar', label: 'Só avatar' },
              { value: 'covers', label: 'Só capas de posts' },
            ]}
          />
          <Button icon={<SearchOutlined />} onClick={() => void loadAudit()}>
            Filtrar
          </Button>
          <Button
            type="primary"
            icon={<CloudUploadOutlined />}
            loading={bulkEnqueuing}
            disabled={!audit?.total}
            onClick={enqueueAllFiltered}
          >
            Enfileirar todos ({audit?.total != null ? formatInt(audit.total) : '…'})
          </Button>
        </Space>
        <Table<AdminMediaS3MissingRow>
          rowKey="handle"
          loading={loadingAudit}
          dataSource={audit?.items ?? []}
          rowSelection={rowSelection}
          pagination={{
            current: page,
            pageSize: PAGE_SIZE,
            total: audit?.total ?? 0,
            showSizeChanger: false,
            onChange: (p) => setPage(p),
            showTotal: (t) => `${formatInt(t)} perfil(is)`,
          }}
          size="small"
          columns={[
            {
              title: '@',
              dataIndex: 'handle',
              render: (h: string, row) => (
                <Link to={`/app/influencer/${encodeURIComponent(row.profile_ref)}`}>@{h}</Link>
              ),
            },
            {
              title: 'Nome',
              dataIndex: 'full_name',
              ellipsis: true,
              render: (v: string | undefined) => v || '—',
            },
            {
              title: 'Seguidores',
              dataIndex: 'followers_count',
              width: 100,
              render: (n: number | undefined) => (n != null ? formatInt(n) : '—'),
            },
            {
              title: 'Pendências',
              key: 'issues',
              render: (_: unknown, row) => (
                <Space size={4} wrap>
                  {row.missing_avatar ? <Tag color="red">Avatar</Tag> : null}
                  {row.posts_missing_stable_cover > 0 ? (
                    <Tag color="orange">
                      Capas {row.posts_missing_stable_cover}/{row.posts_with_media}
                    </Tag>
                  ) : null}
                  {row.in_extract_queue ||
                  queue?.processing_handle === row.handle ||
                  queue?.pending.includes(row.handle) ? (
                    <Tag color="processing">
                      {queue?.processing_handle === row.handle ? 'Extraindo' : 'Na fila'}
                    </Tag>
                  ) : null}
                </Space>
              ),
            },
            {
              title: 'Última extração',
              dataIndex: 'collected_at',
              width: 160,
              render: (v: string | undefined) => (v ? new Date(v).toLocaleString('pt-BR') : '—'),
            },
            {
              title: '',
              key: 'action',
              width: 120,
              render: (_: unknown, row) => (
                <Button
                  type="link"
                  size="small"
                  icon={<CloudUploadOutlined />}
                  disabled={
                    row.in_extract_queue ||
                    queue?.processing_handle === row.handle ||
                    enqueuingHandles.has(row.handle)
                  }
                  loading={enqueuingHandles.has(row.handle)}
                  onClick={() => void enqueueHandles([row.handle])}
                >
                  Enfileirar
                </Button>
              ),
            },
          ]}
        />
      </section>
    </div>
  )
}
