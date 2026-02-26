/**
 * Disparo em massa: templates com hash único, fila por @username e gestão do envio 1 a 1.
 * Filtro por hash: incluir apenas ou excluir quem já recebeu a mensagem; autocomplete usa busca principal.
 */
import { useState, useEffect, useRef, useMemo } from 'react'
import { Button, Card, Table, Input, Modal, Typography, Space, message as antMessage, AutoComplete, Tag, Popconfirm } from 'antd'
import { PlusOutlined, PlayCircleOutlined, PauseCircleOutlined, ReloadOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons'
import {
  fetchDirectTemplates,
  createDirectTemplate,
  updateDirectTemplate,
  fetchDirectQueue,
  addToDirectQueue,
  deleteDirectQueue,
  deleteDirectQueueItem,
  processNextDirectQueueItem,
  fetchDirectHandlesByHash,
  fetchProfilesSearch,
  type MessageTemplate,
  type DirectQueueItem,
} from '../api'
import { reportTokens as t } from './reportTokens'

const { TextArea } = Input
const { Text } = Typography
const MAIN_SEARCH_LIMIT = 100
const s = t.spacing
const c = t.colors
const r = t.radius

const DELAY_BETWEEN_SENDS_MS = 60_000 // 1 min entre cada envio

export default function BulkMessage() {
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [queue, setQueue] = useState<DirectQueueItem[]>([])
  const [total, setTotal] = useState(0)
  const [loadingTemplates, setLoadingTemplates] = useState(true)
  const [loadingQueue, setLoadingQueue] = useState(true)
  const [adding, setAdding] = useState(false)
  const [dispatching, setDispatching] = useState(false)
  const [selectedHash, setSelectedHash] = useState<string>('')
  const [receivedHandles, setReceivedHandles] = useState<string[]>([])
  const [selectedFromAutocomplete, setSelectedFromAutocomplete] = useState<string[]>([])
  const [mainSearchValue, setMainSearchValue] = useState('')
  const [mainSearchOptions, setMainSearchOptions] = useState<{ value: string; label: string }[]>([])
  const [mainSearchLoading, setMainSearchLoading] = useState(false)
  const [loadingAdd100, setLoadingAdd100] = useState(false)
  const [loadingDeleteQueue, setLoadingDeleteQueue] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const mainSearchAbortRef = useRef<AbortController | null>(null)
  const [modalTemplate, setModalTemplate] = useState(false)
  const [newHash, setNewHash] = useState('')
  const [newBody, setNewBody] = useState('')
  const [editTemplate, setEditTemplate] = useState<MessageTemplate | null>(null)
  const [editBody, setEditBody] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const dispatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadTemplates = () => {
    setLoadingTemplates(true)
    fetchDirectTemplates()
      .then((r) => setTemplates(r.items))
      .catch((e) => antMessage.error(e instanceof Error ? e.message : 'Erro ao carregar templates'))
      .finally(() => setLoadingTemplates(false))
  }

  const loadQueue = () => {
    setLoadingQueue(true)
    fetchDirectQueue({ limit: 500 })
      .then((r) => {
        setQueue(r.items)
        setTotal(r.total)
      })
      .catch((e) => antMessage.error(e instanceof Error ? e.message : 'Erro ao carregar fila'))
      .finally(() => setLoadingQueue(false))
  }

  useEffect(() => {
    loadTemplates()
    loadQueue()
  }, [])

  // Atualiza a fila automaticamente durante o disparo (lista fica sempre atualizada)
  const QUEUE_POLL_MS = 8000
  useEffect(() => {
    if (!dispatching) return
    const interval = setInterval(loadQueue, QUEUE_POLL_MS)
    return () => clearInterval(interval)
  }, [dispatching])

  // Carrega handles que já receberam o hash (para o botão "100 primeiros que ainda não receberam" e para não duplicar na fila)
  useEffect(() => {
    if (!selectedHash) {
      setReceivedHandles([])
      return
    }
    fetchDirectHandlesByHash(selectedHash)
      .then((r) => setReceivedHandles(r.handles))
      .catch(() => setReceivedHandles([]))
  }, [selectedHash])

  const receivedSet = useMemo(() => new Set(receivedHandles.map((h) => h.toLowerCase())), [receivedHandles])

  // Autocomplete principal (até 100 perfis por busca): mesma busca principal
  useEffect(() => {
    if (mainSearchValue.trim().length < 2) {
      setMainSearchOptions([])
      return
    }
    if (mainSearchAbortRef.current) mainSearchAbortRef.current.abort()
    mainSearchAbortRef.current = new AbortController()
    setMainSearchLoading(true)
    fetchProfilesSearch(
      { q: mainSearchValue.trim(), limit: MAIN_SEARCH_LIMIT },
      { signal: mainSearchAbortRef.current.signal }
    )
      .then((res) => {
        const opts = (res.items || []).map((p) => {
          const h = (p.handle ?? p.username ?? '').toString().trim().toLowerCase()
          return { value: h, label: `@${h}${p.full_name ? ` — ${(p.full_name as string).slice(0, 30)}` : ''}` }
        })
        setMainSearchOptions(opts)
      })
      .catch((err) => {
        if (err?.name !== 'AbortError') antMessage.error(err instanceof Error ? err.message : 'Erro na busca')
        setMainSearchOptions([])
      })
      .finally(() => setMainSearchLoading(false))
  }, [mainSearchValue])

  useEffect(() => {
    if (!dispatching) return
    let cancelled = false
    const runOne = () => {
      if (cancelled) return
      processNextDirectQueueItem()
        .then((result) => {
          if (cancelled) return
          if (result.processed) {
            if (result.ok) antMessage.success(`Enviado para @${result.handle}`)
            else antMessage.warning(`Falha @${result.handle}: ${result.error ?? 'erro'}`)
            loadQueue()
          }
          if (result.processed) {
            dispatchTimerRef.current = setTimeout(runOne, DELAY_BETWEEN_SENDS_MS)
          } else if (result.processed === false) {
            setDispatching(false)
            antMessage.info('Fila concluída.')
          }
        })
        .catch((e) => {
          if (!cancelled) {
            antMessage.error(e instanceof Error ? e.message : 'Erro ao processar')
            setDispatching(false)
          }
        })
    }
    runOne()
    return () => {
      cancelled = true
      if (dispatchTimerRef.current) clearTimeout(dispatchTimerRef.current)
    }
  }, [dispatching])

  const pendingCount = queue.filter((i) => i.status === 'pending').length
  const sentCount = queue.filter((i) => i.status === 'sent').length
  const failedCount = queue.filter((i) => i.status === 'failed').length

  const handleAddTemplate = () => {
    if (!newHash.trim() || !newBody.trim()) {
      antMessage.warning('Preencha o hash e o texto do template.')
      return
    }
    createDirectTemplate(newHash.trim(), newBody.trim())
      .then(() => {
        antMessage.success('Template criado.')
        setModalTemplate(false)
        setNewHash('')
        setNewBody('')
        loadTemplates()
      })
      .catch((e) => antMessage.error(e instanceof Error ? e.message : 'Erro ao criar template'))
  }

  const handleAddToQueue = () => {
    const hash = selectedHash || (templates[0]?.hash ?? '')
    if (!hash) {
      antMessage.warning('Selecione um template ou crie um primeiro.')
      return
    }
    const combined = [...new Set(selectedFromAutocomplete.map((h) => h.toLowerCase()))]
    if (combined.length === 0) {
      antMessage.warning('Adicione perfis pelo autocomplete ou use o botão "Incluir os 100 primeiros que ainda não receberam".')
      return
    }
    // Exclui quem já recebeu esta mensagem para não duplicar na fila
    let toAdd = combined.filter((h) => !receivedSet.has(h))
    if (toAdd.length < combined.length && receivedSet.size > 0) {
      antMessage.info(`${combined.length - toAdd.length} já receberam esta mensagem e foram ignorados.`)
    }
    if (toAdd.length === 0) {
      antMessage.warning('Nenhum perfil a adicionar após o filtro.')
      return
    }
    setAdding(true)
    addToDirectQueue(toAdd, hash)
      .then((r) => {
        antMessage.success(`${r.added} adicionado(s) à fila.`)
        setSelectedFromAutocomplete([])
        loadQueue()
      })
      .catch((e) => antMessage.error(e instanceof Error ? e.message : 'Erro ao adicionar'))
      .finally(() => setAdding(false))
  }

  const removeSelectedHandle = (handle: string) => {
    setSelectedFromAutocomplete((prev) => prev.filter((h) => h.toLowerCase() !== handle.toLowerCase()))
  }

  const handleAdd100NotReceived = () => {
    const hash = selectedHash || templates[0]?.hash
    if (!hash) {
      antMessage.warning('Selecione um template primeiro.')
      return
    }
    setLoadingAdd100(true)
    Promise.all([
      fetchDirectHandlesByHash(hash),
      fetchProfilesSearch({ limit: 250 }),
    ])
      .then(([byHash, searchRes]) => {
        const received = new Set((byHash.handles || []).map((h) => h.toLowerCase()))
        const items = searchRes.items || []
        const notReceived: string[] = []
        for (const p of items) {
          const h = ((p.handle ?? p.username) ?? '').toString().trim().toLowerCase()
          if (h && !received.has(h)) notReceived.push(h)
          if (notReceived.length >= MAIN_SEARCH_LIMIT) break
        }
        setSelectedFromAutocomplete((prev) => {
          const seen = new Set(prev.map((x) => x.toLowerCase()))
          const added = notReceived.filter((h) => {
            if (seen.has(h)) return false
            seen.add(h)
            return true
          })
          return [...prev, ...added]
        })
        antMessage.success(`${notReceived.length} perfil(is) adicionado(s) à seleção.`)
      })
      .catch((e) => antMessage.error(e instanceof Error ? e.message : 'Erro ao carregar perfis'))
      .finally(() => setLoadingAdd100(false))
  }

  return (
    <div style={{ padding: s.lg, maxWidth: 960, margin: '0 auto', background: c.pageBg, minHeight: '100vh' }}>
      <h1 style={{ marginBottom: s.lg, fontSize: 22, fontWeight: 600 }}>Disparo em massa</h1>

      <Card title="Templates (hash único)" loading={loadingTemplates} style={{ marginBottom: s.lg, borderRadius: r.lg }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalTemplate(true)} style={{ marginBottom: s.md }}>
          Novo template
        </Button>
        <Table
          dataSource={templates}
          rowKey="id"
          size="small"
          pagination={false}
          columns={[
            { title: 'Hash', dataIndex: 'hash', key: 'hash', width: 160, render: (v: string) => <Text code>{v}</Text> },
            { title: 'Texto', dataIndex: 'body', key: 'body', ellipsis: true, render: (v: string) => (v?.length > 80 ? `${v.slice(0, 80)}…` : v) },
            { title: 'Criado', dataIndex: 'created_at', key: 'created_at', width: 160, render: (v: string) => (v ? new Date(v).toLocaleString('pt-BR') : '—') },
            {
              title: '',
              key: 'action',
              width: 56,
              render: (_: unknown, record: MessageTemplate) => (
                <Button
                  type="text"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => {
                    setEditTemplate(record)
                    setEditBody(record.body)
                  }}
                />
              ),
            },
          ]}
        />
      </Card>

      <Card title="Adicionar à fila" style={{ marginBottom: s.lg, borderRadius: r.lg }}>
        <Space direction="vertical" style={{ width: '100%' }} size="small">
          <div>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Template</Text>
            <select
              value={selectedHash}
              onChange={(e) => setSelectedHash(e.target.value)}
              style={{ width: '100%', maxWidth: 320, padding: '6px 10px', borderRadius: r.md, border: `1px solid ${c.border}` }}
            >
              <option value="">— Selecione —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.hash}>{t.hash}</option>
              ))}
            </select>
          </div>
          <Button
            type="default"
            onClick={handleAdd100NotReceived}
            loading={loadingAdd100}
            disabled={!selectedHash && templates.length === 0}
          >
            Incluir os 100 primeiros que ainda não receberam
          </Button>
          <div>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
              Buscar perfis (até {MAIN_SEARCH_LIMIT} por busca — mesma busca principal)
            </Text>
            <AutoComplete
              value={mainSearchValue}
              onChange={(v) => setMainSearchValue(typeof v === 'string' ? v : '')}
              onSelect={(v) => {
                const h = (typeof v === 'string' ? v : '').trim().toLowerCase()
                if (h && !selectedFromAutocomplete.some((x) => x.toLowerCase() === h)) {
                  setSelectedFromAutocomplete((prev) => [...prev, h])
                  setMainSearchValue('')
                }
              }}
              options={mainSearchOptions}
              style={{ width: '100%', maxWidth: 480 }}
              placeholder="Digite nome ou @user (mín. 2 caracteres)"
              loading={mainSearchLoading}
              filterOption={false}
            />
            {selectedFromAutocomplete.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                  {selectedFromAutocomplete.map((h) => (
                    <Tag key={h} closable onClose={() => removeSelectedHandle(h)}>@{h}</Tag>
                  ))}
                  <Button type="link" size="small" onClick={() => setSelectedFromAutocomplete([])} style={{ padding: '0 4px' }}>
                    Limpar
                  </Button>
                </div>
              </div>
            )}
          </div>
          <Button type="primary" onClick={handleAddToQueue} loading={adding} disabled={!selectedHash && templates.length === 0}>
            Adicionar à fila
          </Button>
        </Space>
      </Card>

      <Card
        title={
          <Space>
            <span>Fila de disparo</span>
            <Button type="text" size="small" icon={<ReloadOutlined />} onClick={loadQueue} loading={loadingQueue} />
            <Text type="secondary">Pendentes: {pendingCount} · Enviados: {sentCount} · Falhas: {failedCount}</Text>
          </Space>
        }
        style={{ marginBottom: s.lg, borderRadius: r.lg }}
      >
        <div style={{ marginBottom: s.md, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {dispatching ? (
            <Button icon={<PauseCircleOutlined />} onClick={() => setDispatching(false)}>Parar disparo</Button>
          ) : (
            <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => setDispatching(true)} disabled={pendingCount === 0}>
              Iniciar disparo (1 a 1, ~1 min entre cada)
            </Button>
          )}
          <Popconfirm
            title="Deletar toda a fila?"
            description="Todos os itens (pendentes, enviados e falhas) serão removidos. Não é possível desfazer."
            onConfirm={async () => {
              setLoadingDeleteQueue(true)
              try {
                const r = await deleteDirectQueue()
                antMessage.success(`Fila deletada (${r.deleted} itens).`)
                loadQueue()
              } catch (e) {
                antMessage.error(e instanceof Error ? e.message : 'Erro ao deletar fila')
              } finally {
                setLoadingDeleteQueue(false)
              }
            }}
            okText="Deletar"
            cancelText="Cancelar"
            okButtonProps={{ danger: true }}
          >
            <Button type="default" danger icon={<DeleteOutlined />} loading={loadingDeleteQueue} disabled={dispatching || queue.length === 0}>
              Deletar fila
            </Button>
          </Popconfirm>
        </div>
        <Table
          dataSource={queue}
          rowKey="id"
          size="small"
          loading={loadingQueue}
          pagination={{ pageSize: 50, showSizeChanger: false }}
          columns={[
            { title: '@', dataIndex: 'profile_handle', key: 'profile_handle', width: 140, render: (v: string) => `@${v}` },
            { title: 'Template', dataIndex: 'message_hash', key: 'message_hash', width: 140, render: (v: string) => <Text code>{v}</Text> },
            { title: 'Status', dataIndex: 'status', key: 'status', width: 90, render: (v: string) => (v === 'sent' ? 'Enviado' : v === 'failed' ? 'Falha' : 'Pendente') },
            { title: 'Enviado em', dataIndex: 'sent_at', key: 'sent_at', width: 160, render: (v: string | null) => (v ? new Date(v).toLocaleString('pt-BR') : '—') },
            { title: 'Erro', dataIndex: 'error', key: 'error', ellipsis: true, render: (v: string | null) => v ?? '—' },
            {
              title: '',
              key: 'action',
              width: 56,
              render: (_: unknown, record: DirectQueueItem) => (
                <Popconfirm
                  title="Remover este item?"
                  onConfirm={async () => {
                    setDeletingId(record.id)
                    try {
                      await deleteDirectQueueItem(record.id)
                      antMessage.success('Item removido.')
                      loadQueue()
                    } catch (e) {
                      antMessage.error(e instanceof Error ? e.message : 'Erro ao remover')
                    } finally {
                      setDeletingId(null)
                    }
                  }}
                  okText="Remover"
                  cancelText="Cancelar"
                  okButtonProps={{ danger: true }}
                >
                  <Button type="text" size="small" danger icon={<DeleteOutlined />} loading={deletingId === record.id} disabled={dispatching} />
                </Popconfirm>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title="Novo template"
        open={modalTemplate}
        onCancel={() => setModalTemplate(false)}
        onOk={handleAddTemplate}
        okText="Criar"
      >
        <Space direction="vertical" style={{ width: '100%' }} size="small">
          <div>
            <Text type="secondary">Hash (identificador único, ex: campanha_jan2025)</Text>
            <Input value={newHash} onChange={(e) => setNewHash(e.target.value)} placeholder="campanha_jan2025" style={{ marginTop: 4 }} />
          </div>
          <div>
            <Text type="secondary">Texto da mensagem</Text>
            <TextArea value={newBody} onChange={(e) => setNewBody(e.target.value)} rows={5} placeholder="Olá! Somos a marca X..." style={{ marginTop: 4 }} />
          </div>
        </Space>
      </Modal>

      <Modal
        title={`Editar template: ${editTemplate?.hash ?? ''}`}
        open={!!editTemplate}
        onCancel={() => { setEditTemplate(null); setEditBody(''); }}
        onOk={async () => {
          if (!editTemplate) return
          setSavingEdit(true)
          try {
            await updateDirectTemplate(editTemplate.id, editBody)
            antMessage.success('Template atualizado.')
            setEditTemplate(null)
            setEditBody('')
            loadTemplates()
          } catch (e) {
            antMessage.error(e instanceof Error ? e.message : 'Erro ao salvar')
          } finally {
            setSavingEdit(false)
          }
        }}
        okText="Salvar"
        confirmLoading={savingEdit}
      >
        <div>
          <Text type="secondary">Texto da mensagem (hash não pode ser alterado)</Text>
          <TextArea value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={6} style={{ marginTop: 8, width: '100%' }} />
        </div>
      </Modal>
    </div>
  )
}
