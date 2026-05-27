/**
 * Disparo em massa: templates com hash único, fila por @username e gestão do envio 1 a 1.
 * Filtro por hash: incluir apenas ou excluir quem já recebeu a mensagem; autocomplete usa busca principal.
 */
import { useState, useEffect, useRef, useMemo } from 'react'
import { Button, Card, Table, Input, Modal, Typography, Space, message as antMessage, AutoComplete, Select, Tag, Popconfirm } from 'antd'
import { PlusOutlined, ReloadOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons'
import {
  fetchDirectTemplates,
  createDirectTemplate,
  updateDirectTemplate,
  fetchDirectQueue,
  addToDirectQueue,
  deleteDirectQueue,
  deleteDirectQueueItem,
  updateDirectQueueItem,
  fetchDirectHandlesByHash,
  fetchFollowersSearch,
  fetchDirectQueueServiceStatus,
  pauseDirectQueueService,
  resumeDirectQueueService,
  type MessageTemplate,
  type DirectQueueItem,
} from '../api'
import { reportTokens as t } from './reportTokens'
import { trackInfluencerSearch } from '../utils/metaPixelFunnel'

const { TextArea } = Input
const { Text } = Typography
const FOLLOWERS_SEARCH_DEBOUNCE_MS = 550
const s = t.spacing
const c = t.colors
const r = t.radius

const SEND_INTERVAL_OPTIONS = [
  { value: 0, label: '0 min' },
  { value: 1, label: '1 min' },
  { value: 10, label: '10 min' },
  { value: 30, label: '30 min' },
  { value: 50, label: '50 min' },
  { value: 100, label: '100 min' },
]

/** Formata Date para value do input datetime-local (horário local, não UTC). */
function toLocalDatetimeInputValue(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${d}T${h}:${min}`
}

export default function BulkMessage() {
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [queue, setQueue] = useState<DirectQueueItem[]>([])
  const [, setTotal] = useState(0)
  const [loadingTemplates, setLoadingTemplates] = useState(true)
  const [loadingQueue, setLoadingQueue] = useState(true)
  const [adding, setAdding] = useState(false)
  const [selectedHash, setSelectedHash] = useState<string>('')
  const [receivedHandles, setReceivedHandles] = useState<string[]>([])
  const [selectedFromAutocomplete, setSelectedFromAutocomplete] = useState<string[]>([])
  const [mainSearchValue, setMainSearchValue] = useState('')
  const [mainSearchOptions, setMainSearchOptions] = useState<{ value: string; label: string }[]>([])
  const [mainSearchLoading, setMainSearchLoading] = useState(false)
  const [loadingDeleteQueue, setLoadingDeleteQueue] = useState(false)
  const [loadingAddAll, setLoadingAddAll] = useState(false)
  const [templatesModalOpen, setTemplatesModalOpen] = useState(false)
  const [, setServiceRunning] = useState(false)
  const [servicePaused, setServicePaused] = useState(false)
  const [loadingServiceToggle, setLoadingServiceToggle] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [editQueueItem, setEditQueueItem] = useState<DirectQueueItem | null>(null)
  const [editQueueHash, setEditQueueHash] = useState('')
  const [editQueueScheduledAt, setEditQueueScheduledAt] = useState('')
  const [editQueueStatus, setEditQueueStatus] = useState<'pending' | 'sent' | 'failed'>('pending')
  const [savingEditQueue, setSavingEditQueue] = useState(false)
  const mainSearchAbortRef = useRef<AbortController | null>(null)
  const followersSearchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastFollowersSearchTrackedRef = useRef('')
  const mainSearchValueRef = useRef('')
  const filterExcludeSetRef = useRef<Set<string>>(new Set())
  const [modalTemplate, setModalTemplate] = useState(false)
  const [newHash, setNewHash] = useState('')
  const [newBody, setNewBody] = useState('')
  const [newRejectHashes, setNewRejectHashes] = useState<string[]>([])
  const [newSendDelayMinutes, setNewSendDelayMinutes] = useState(1)
  const [editTemplate, setEditTemplate] = useState<MessageTemplate | null>(null)
  const [editBody, setEditBody] = useState('')
  const [editRejectHashes, setEditRejectHashes] = useState<string[]>([])
  const [editSendDelayMinutes, setEditSendDelayMinutes] = useState(1)
  const [savingEdit, setSavingEdit] = useState(false)
  const [filterExcludeHandles, setFilterExcludeHandles] = useState<string[]>([])
  const selectedTemplate = useMemo(() => templates.find((t) => t.hash === selectedHash) ?? null, [templates, selectedHash])

  const loadTemplates = () => {
    setLoadingTemplates(true)
    fetchDirectTemplates()
      .then((r) => setTemplates(r.items))
      .catch((e) => antMessage.error(e instanceof Error ? e.message : 'Não deu pra carregar os templates.'))
      .finally(() => setLoadingTemplates(false))
  }

  const loadQueue = () => {
    setLoadingQueue(true)
    fetchDirectQueue({ limit: 500 })
      .then((r) => {
        setQueue(r.items)
        setTotal(r.total)
      })
      .catch((e) => antMessage.error(e instanceof Error ? e.message : 'Não deu pra carregar a fila.'))
      .finally(() => setLoadingQueue(false))
  }

  useEffect(() => {
    loadTemplates()
    loadQueue()
  }, [])

  // Atualiza fila e status do serviço periodicamente (o worker roda em background)
  const QUEUE_POLL_MS = 8000
  useEffect(() => {
    const poll = () => {
      loadQueue()
      fetchDirectQueueServiceStatus()
        .then((s) => {
          setServiceRunning(s.running)
          setServicePaused(s.paused)
        })
        .catch(() => { })
    }
    poll()
    const interval = setInterval(poll, QUEUE_POLL_MS)
    return () => clearInterval(interval)
  }, [])

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

  // Filtro: rejeitar perfis que já receberam hashes do template (reject_hashes)
  useEffect(() => {
    const hashes = selectedTemplate?.reject_hashes ?? []
    if (hashes.length === 0) {
      setFilterExcludeHandles([])
      return
    }
    Promise.all(hashes.map((h) => fetchDirectHandlesByHash(h.trim()).then((r) => r.handles ?? [])))
      .then((results) => {
        const merged = new Set<string>()
        results.forEach((handles) => handles.forEach((h) => merged.add(h.trim().toLowerCase())))
        setFilterExcludeHandles(Array.from(merged))
      })
      .catch(() => setFilterExcludeHandles([]))
  }, [selectedTemplate?.reject_hashes])

  // Rejeitados = template selecionado (obrigatório) + hashes do filtro
  const rejectedSet = useMemo(() => {
    const s = new Set<string>()
    receivedHandles.forEach((h) => s.add(h.toLowerCase()))
    filterExcludeHandles.forEach((h) => s.add(h.toLowerCase()))
    return s
  }, [receivedHandles, filterExcludeHandles])
  const rejectedHandles = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const h of [...receivedHandles, ...filterExcludeHandles]) {
      const lower = h.trim().toLowerCase()
      if (!seen.has(lower)) {
        seen.add(lower)
        out.push(h)
      }
    }
    return out
  }, [receivedHandles, filterExcludeHandles])
  filterExcludeSetRef.current = rejectedSet
  mainSearchValueRef.current = mainSearchValue

  // Autocomplete: busca entre seus seguidores do Instagram (debounce para não enviar várias requisições)
  useEffect(() => {
    if (followersSearchDebounceRef.current) {
      clearTimeout(followersSearchDebounceRef.current)
      followersSearchDebounceRef.current = null
    }
    const trimmed = mainSearchValue.trim()
    if (trimmed.length === 0) {
      setMainSearchOptions([])
      return
    }
    const runSearch = () => {
      if (mainSearchAbortRef.current) mainSearchAbortRef.current.abort()
      mainSearchAbortRef.current = new AbortController()
      setMainSearchLoading(true)
      const searchTerm = trimmed
      fetchFollowersSearch(searchTerm, { signal: mainSearchAbortRef.current.signal })
        .then((res) => {
          if (mainSearchValueRef.current.trim() !== searchTerm) return
          if (lastFollowersSearchTrackedRef.current !== searchTerm) {
            lastFollowersSearchTrackedRef.current = searchTerm
            trackInfluencerSearch(searchTerm, 'bulk_message')
          }
          const exclude = filterExcludeSetRef.current
          const allUsernames = (res.usernames || []).map((u) => u.trim().toLowerCase()).filter(Boolean)
          const rejected = exclude.size > 0 ? allUsernames.filter((h) => exclude.has(h)) : []
          const allowed = exclude.size > 0 ? allUsernames.filter((h) => !exclude.has(h)) : allUsernames
          if (rejected.length > 0) {
            antMessage.warning(`${rejected.length} perfil(is) ocultado(s): já receberam algum hash selecionado.`)
          }
          const opts = allowed.map((h) => ({ value: h, label: `@${h}` }))
          setMainSearchOptions(opts)
        })
        .catch((err) => {
          if (err?.name === 'AbortError') return
          if (mainSearchValueRef.current.trim() !== searchTerm) return
          antMessage.error(err instanceof Error ? err.message : 'Falha na busca de seguidores.')
          setMainSearchOptions([])
        })
        .finally(() => setMainSearchLoading(false))
    }
    followersSearchDebounceRef.current = setTimeout(runSearch, FOLLOWERS_SEARCH_DEBOUNCE_MS)
    return () => {
      if (followersSearchDebounceRef.current) clearTimeout(followersSearchDebounceRef.current)
    }
  }, [mainSearchValue])


  const pendingCount = queue.filter((i) => i.status === 'pending').length
  const sentCount = queue.filter((i) => i.status === 'sent').length
  const failedCount = queue.filter((i) => i.status === 'failed').length

  const handleAddTemplate = () => {
    if (!newHash.trim() || !newBody.trim()) {
      antMessage.warning('Coloca o hash e o texto do template.')
      return
    }
    if (newRejectHashes.length === 0) {
      antMessage.warning('Selecione ao menos um hash para rejeitar perfis.')
      return
    }
    createDirectTemplate(newHash.trim(), newBody.trim(), newRejectHashes, newSendDelayMinutes)
      .then(() => {
        antMessage.success('Template criado.')
        setModalTemplate(false)
        setNewHash('')
        setNewBody('')
        setNewRejectHashes([])
        setNewSendDelayMinutes(1)
        loadTemplates()
      })
      .catch((e) => antMessage.error(e instanceof Error ? e.message : 'Não deu pra criar o template.'))
  }

  const handleAddToQueue = () => {
    const hash = selectedHash || (templates[0]?.hash ?? '')
    if (!hash) {
      antMessage.warning('Selecione um template ou crie um primeiro.')
      return
    }
    const tpl = templates.find((t) => t.hash === hash)
    if (!tpl?.reject_hashes?.length) {
      antMessage.warning('O template selecionado deve ter ao menos um hash para rejeitar perfis. Edite o template.')
      return
    }
    const combined = [...new Set(selectedFromAutocomplete.map((h) => h.toLowerCase()))]
    if (combined.length === 0) {
      antMessage.warning('Adicione perfis pelo autocomplete.')
      return
    }
    // Exclui rejeitados (template selecionado + filtro de hash)
    let toAdd = combined.filter((h) => !rejectedSet.has(h))
    const excluded = combined.length - toAdd.length
    if (excluded > 0) antMessage.info(`${excluded} rejeitado(s) (template ou filtro).`)
    if (toAdd.length === 0) {
      antMessage.warning('Nenhum perfil a adicionar após o filtro.')
      return
    }
    const delayMin = tpl?.send_delay_minutes ?? 1
    const scheduledAt = new Date(Date.now() + delayMin * 60 * 1000).toISOString()
    setAdding(true)
    addToDirectQueue(toAdd, hash, scheduledAt)
      .then((r) => {
        antMessage.success(`${r.added} adicionado(s) à fila.`)
        setSelectedFromAutocomplete([])
        loadQueue()
      })
      .catch((e) => antMessage.error(e instanceof Error ? e.message : 'Não deu pra adicionar.'))
      .finally(() => setAdding(false))
  }

  const removeSelectedHandle = (handle: string) => {
    setSelectedFromAutocomplete((prev) => prev.filter((h) => h.toLowerCase() !== handle.toLowerCase()))
  }

  return (
    <div style={{ padding: s.lg, maxWidth: 960, margin: '0 auto', background: c.pageBg, minHeight: '100vh' }}>
      <h1 style={{ marginBottom: s.lg, fontSize: 22, fontWeight: 600 }}>Disparo em massa</h1>

      <div style={{ marginBottom: s.lg }}>
        <Button type="default" onClick={() => setTemplatesModalOpen(true)}>
          Gerenciar Templates
        </Button>
      </div>

      <Modal
        title="Templates (hash único)"
        open={templatesModalOpen}
        onCancel={() => setTemplatesModalOpen(false)}
        footer={null}
        width={880}
      >
        <Card loading={loadingTemplates} style={{ borderRadius: r.lg, marginBottom: 0 }} bodyStyle={{ padding: s.md }}>
          <div style={{ marginBottom: s.md }}>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalTemplate(true)}>
              Novo template
            </Button>
          </div>
          <Table
            dataSource={templates}
            rowKey="id"
            size="small"
            pagination={false}
            columns={[
              { title: 'Hash', dataIndex: 'hash', key: 'hash', width: 160, render: (v: string) => <Text code>{v}</Text> },
              { title: 'Texto', dataIndex: 'body', key: 'body', ellipsis: true, render: (v: string) => (v?.length > 80 ? `${v.slice(0, 80)}…` : v) },
              {
                title: 'Rejeitar perfis que já receberam (hash) (obrigatório)',
                dataIndex: 'reject_hashes',
                key: 'reject_hashes',
                width: 260,
                render: (v: string[] | undefined) => (v && v.length > 0 ? v.join(', ') : '—'),
              },
              { title: 'Início em (min)', dataIndex: 'send_delay_minutes', key: 'send_delay_minutes', width: 100, render: (v: number | undefined) => v ?? 1 },
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
                      setEditRejectHashes(record.reject_hashes ?? [])
                      setEditSendDelayMinutes(record.send_delay_minutes ?? 1)
                    }}
                  />
                ),
              },
            ]}
          />
        </Card>
      </Modal>

      <Card title="Adicionar à fila" style={{ marginBottom: s.lg, borderRadius: r.lg }}>
        <Space direction="vertical" style={{ width: '100%' }} size="small">
          <div>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Template (obrigatório)</Text>
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
            {selectedTemplate && (
              <>
                <Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 12 }}>
                  Rejeitar perfis que já receberam: {selectedTemplate.reject_hashes?.join(', ') ?? '—'}
                </Text>
                <Text type="secondary" style={{ display: 'block', marginTop: 2, fontSize: 12 }}>
                  Início do envio: {selectedTemplate.send_delay_minutes ?? 1} min à frente (definido no template)
                </Text>
              </>
            )}
          </div>
          <div>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
              Buscar entre seus seguidores (Instagram) — digite para filtrar
            </Text>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <AutoComplete
                value={mainSearchValue}
                onChange={(v) => setMainSearchValue(typeof v === 'string' ? v : '')}
                onSelect={(v) => {
                  const h = (typeof v === 'string' ? v : '').trim().toLowerCase()
                  if (!h) return
                  if (rejectedSet.has(h)) {
                    antMessage.warning(`@${h} já recebeu o template ou algum hash e foi rejeitado.`)
                    return
                  }
                  if (!selectedFromAutocomplete.some((x) => x.toLowerCase() === h)) {
                    setSelectedFromAutocomplete((prev) => [...prev, h])
                    setMainSearchValue('')
                  }
                }}
                options={mainSearchOptions}
                style={{ flex: 1, maxWidth: 480 }}
                placeholder={mainSearchLoading ? 'Buscando...' : 'Digite nome ou @user para buscar (mín. 1 caractere)'}
                filterOption={false}
              />
              <Button
                type="link"
                size="small"
                loading={loadingAddAll}
                disabled={!selectedHash || !selectedTemplate?.reject_hashes?.length}
                onClick={async () => {
                  setLoadingAddAll(true)
                  try {
                    const res = await fetchFollowersSearch('', { scrolls: 6 })
                    const allUsernames = (res.usernames || []).map((u) => u.trim().toLowerCase()).filter(Boolean)
                    const seen = new Set(selectedFromAutocomplete.map((x) => x.toLowerCase()))
                    const toAdd = allUsernames.filter(
                      (h) => !seen.has(h) && !rejectedSet.has(h)
                    )
                    toAdd.forEach((h) => seen.add(h))
                    setSelectedFromAutocomplete((prev) => [...prev, ...toAdd])
                    if (toAdd.length > 0) antMessage.success(`${toAdd.length} seguidor(es) adicionado(s).`)
                    else if (allUsernames.length > 0) antMessage.info('Todos já estão na seleção ou foram rejeitados pelo filtro.')
                    else antMessage.warning('Nenhum seguidor encontrado.')
                  } catch (e) {
                    antMessage.error(e instanceof Error ? e.message : 'Falha na busca de seguidores.')
                  } finally {
                    setLoadingAddAll(false)
                  }
                }}
                style={{ flexShrink: 0, padding: '0 4px', fontSize: 12, opacity: 0.85 }}
              >
                Adicionar todos
              </Button>
            </div>
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
          <Button type="primary" onClick={handleAddToQueue} loading={adding} disabled={!selectedHash || !selectedTemplate?.reject_hashes?.length}>
            Adicionar à fila
          </Button>
          {selectedHash && rejectedHandles.length > 0 && (
            <div style={{ marginTop: s.md, paddingTop: s.sm, borderTop: `1px solid ${c.border}` }}>
              <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
                Rejeitados ({selectedTemplate?.reject_hashes?.join(', ') ?? selectedHash}): {rejectedHandles.length} perfil(is)
              </Text>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {rejectedHandles.map((h) => (
                  <Tag key={h} style={{ marginBottom: 0 }}>@{h}</Tag>
                ))}
              </div>
            </div>
          )}
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
          <Tag color={servicePaused ? 'default' : 'green'}>{servicePaused ? 'Serviço pausado' : 'Serviço rodando'}</Tag>
          <Button
            loading={loadingServiceToggle}
            onClick={async () => {
              setLoadingServiceToggle(true)
              try {
                if (servicePaused) {
                  await resumeDirectQueueService()
                  setServicePaused(false)
                  setServiceRunning(true)
                  antMessage.success('Serviço retomado.')
                } else {
                  await pauseDirectQueueService()
                  setServicePaused(true)
                  setServiceRunning(false)
                  antMessage.success('Serviço pausado.')
                }
              } catch (e) {
                antMessage.error(e instanceof Error ? e.message : 'Não deu pra alterar o serviço.')
              } finally {
                setLoadingServiceToggle(false)
              }
            }}
          >
            {servicePaused ? 'Retomar serviço' : 'Pausar serviço'}
          </Button>
          <Popconfirm
            title="Deletar toda a fila?"
            description="Tudo da fila será apagado (pendentes, enviados, falhas). Não dá pra desfazer."
            onConfirm={async () => {
              setLoadingDeleteQueue(true)
              try {
                const r = await deleteDirectQueue()
                antMessage.success(`Fila deletada (${r.deleted} itens).`)
                loadQueue()
              } catch (e) {
                antMessage.error(e instanceof Error ? e.message : 'Não deu pra apagar a fila.')
              } finally {
                setLoadingDeleteQueue(false)
              }
            }}
            okText="Deletar"
            cancelText="Cancelar"
            okButtonProps={{ danger: true }}
          >
            <Button type="default" danger icon={<DeleteOutlined />} loading={loadingDeleteQueue} disabled={queue.length === 0}>
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
            {
              title: 'Agendado em',
              dataIndex: 'created_at',
              key: 'created_at',
              width: 180,
              render: (_v: string, record: DirectQueueItem) => {
                const v = record.scheduled_at || record.created_at
                if (!v) return '—'
                const d = new Date(v)
                if (Number.isNaN(d.getTime())) return '—'
                return d.toLocaleString('pt-BR')
              },
            },
            { title: 'Status', dataIndex: 'status', key: 'status', width: 90, render: (v: string) => (v === 'sent' ? 'Enviado' : v === 'failed' ? 'Falha' : 'Pendente') },
            { title: 'Enviado em', dataIndex: 'sent_at', key: 'sent_at', width: 160, render: (v: string | null) => (v ? new Date(v).toLocaleString('pt-BR') : '—') },
            { title: 'Erro', dataIndex: 'error', key: 'error', ellipsis: true, render: (v: string | null) => v ?? '—' },
            {
              title: '',
              key: 'action',
              width: 90,
              render: (_: unknown, record: DirectQueueItem) => (
                <Space size="small">
                  <Button
                    type="text"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => {
                      setEditQueueItem(record)
                      setEditQueueHash(record.message_hash)
                      const raw = record.scheduled_at || record.created_at
                      setEditQueueScheduledAt(raw ? toLocalDatetimeInputValue(new Date(raw)) : '')
                      setEditQueueStatus((record.status === 'sent' || record.status === 'failed' ? record.status : 'pending') as 'pending' | 'sent' | 'failed')
                    }}
                  />
                  <Popconfirm
                    title="Remover este item?"
                    onConfirm={async () => {
                      setDeletingId(record.id)
                      try {
                        await deleteDirectQueueItem(record.id)
                        antMessage.success('Item removido.')
                        loadQueue()
                      } catch (e) {
                        antMessage.error(e instanceof Error ? e.message : 'Não deu pra remover.')
                      } finally {
                        setDeletingId(null)
                      }
                    }}
                    okText="Remover"
                    cancelText="Cancelar"
                    okButtonProps={{ danger: true }}
                  >
                    <Button type="text" size="small" danger icon={<DeleteOutlined />} loading={deletingId === record.id} />
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title="Novo template"
        open={modalTemplate}
        onCancel={() => { setModalTemplate(false); setNewRejectHashes([]); }}
        onOk={handleAddTemplate}
        okText="Cadastrar"
      >
        <Space direction="vertical" style={{ width: '100%' }} size="small">
          <div>
            <Text type="secondary">Hash (identificador único, ex: campanha_jan2025)</Text>
            <Input value={newHash} onChange={(e) => setNewHash(e.target.value)} placeholder="campanha_jan2025" style={{ marginTop: 4 }} />
          </div>
          <div>
            <Text type="secondary">Texto da mensagem</Text>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 2 }}>Use {'{firstname}'} e {'{nickname}'} para personalizar (primeiro nome e @ do perfil).</Text>
            <TextArea value={newBody} onChange={(e) => setNewBody(e.target.value)} rows={5} placeholder="Olá! Somos a marca X..." style={{ marginTop: 4 }} />
          </div>
          <div>
            <Text type="secondary">Rejeitar perfis que já receberam (hash) (obrigatório)</Text>
            <Select
              mode="multiple"
              value={newRejectHashes}
              onChange={setNewRejectHashes}
              options={[
                ...templates.filter((t) => t.hash !== newHash.trim()).map((t) => ({ value: t.hash, label: t.hash })),
                ...(newHash.trim() ? [{ value: newHash.trim(), label: `${newHash.trim()} (este template)` }] : []),
              ]}
              style={{ width: '100%', marginTop: 4 }}
              placeholder="Selecione templates (ou use o hash deste)"
              allowClear
              showSearch
              filterOption={(input, option) =>
                (option?.label ?? '').toString().toLowerCase().includes((input || '').toLowerCase())
              }
            />
          </div>
          <div>
            <Text type="secondary">Início do envio em (minutos à frente)</Text>
            <Select
              value={newSendDelayMinutes}
              onChange={setNewSendDelayMinutes}
              options={SEND_INTERVAL_OPTIONS}
              style={{ width: 120, marginTop: 4, display: 'block' }}
            />
          </div>
        </Space>
      </Modal>

      <Modal
        title={`Editar template: ${editTemplate?.hash ?? ''}`}
        open={!!editTemplate}
        onCancel={() => { setEditTemplate(null); setEditBody(''); setEditRejectHashes([]); setEditSendDelayMinutes(1); }}
        onOk={async () => {
          if (!editTemplate) return
          if (editRejectHashes.length === 0) {
            antMessage.warning('Selecione ao menos um hash para rejeitar perfis.')
            return
          }
          setSavingEdit(true)
          try {
            await updateDirectTemplate(editTemplate.id, { body: editBody, reject_hashes: editRejectHashes, send_delay_minutes: editSendDelayMinutes })
            antMessage.success('Template atualizado.')
            setEditTemplate(null)
            setEditBody('')
            setEditRejectHashes([])
            setEditSendDelayMinutes(1)
            loadTemplates()
          } catch (e) {
            antMessage.error(e instanceof Error ? e.message : 'Não deu pra salvar.')
          } finally {
            setSavingEdit(false)
          }
        }}
        okText="Salvar"
        confirmLoading={savingEdit}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="small">
          <div>
            <Text type="secondary">Texto da mensagem (hash não pode ser alterado)</Text>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 2 }}>Use {'{firstname}'} e {'{nickname}'} para personalizar (primeiro nome e @ do perfil).</Text>
            <TextArea value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={6} style={{ marginTop: 8, width: '100%' }} />
          </div>
          <div>
            <Text type="secondary">Rejeitar perfis que já receberam (hash) (obrigatório)</Text>
            <Select
              mode="multiple"
              value={editRejectHashes}
              onChange={setEditRejectHashes}
              options={[
                ...templates.map((t) => ({
                  value: t.hash,
                  label: editTemplate && t.hash === editTemplate.hash ? `${t.hash} (este)` : t.hash,
                })),
              ]}
              style={{ width: '100%', marginTop: 4 }}
              placeholder="Selecione templates"
              allowClear
              showSearch
              filterOption={(input, option) =>
                (option?.label ?? '').toString().toLowerCase().includes((input || '').toLowerCase())
              }
            />
          </div>
          <div>
            <Text type="secondary">Início do envio em (minutos à frente)</Text>
            <Select
              value={editSendDelayMinutes}
              onChange={setEditSendDelayMinutes}
              options={SEND_INTERVAL_OPTIONS}
              style={{ width: 120, marginTop: 4, display: 'block' }}
            />
          </div>
        </Space>
      </Modal>

      <Modal
        title="Editar disparo"
        open={!!editQueueItem}
        onCancel={() => { setEditQueueItem(null); setEditQueueHash(''); setEditQueueScheduledAt(''); setEditQueueStatus('pending'); }}
        onOk={async () => {
          if (!editQueueItem) return
          if (!editQueueHash.trim()) {
            antMessage.warning('Selecione um template.')
            return
          }
          setSavingEditQueue(true)
          try {
            await updateDirectQueueItem(editQueueItem.id, {
              message_hash: editQueueHash.trim(),
              scheduled_at: editQueueScheduledAt.trim() ? new Date(editQueueScheduledAt).toISOString() : null,
              status: editQueueStatus,
            })
            antMessage.success('Disparo atualizado.')
            setEditQueueItem(null)
            setEditQueueHash('')
            setEditQueueScheduledAt('')
            loadQueue()
          } catch (e) {
            antMessage.error(e instanceof Error ? e.message : 'Não deu pra salvar.')
          } finally {
            setSavingEditQueue(false)
          }
        }}
        okText="Salvar"
        confirmLoading={savingEditQueue}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="small">
          {editQueueItem && (
            <div>
              <Text type="secondary">@</Text>
              <Text strong>@{editQueueItem.profile_handle}</Text>
            </div>
          )}
          <div>
            <Text type="secondary">Template</Text>
            <Select
              value={editQueueHash || undefined}
              onChange={setEditQueueHash}
              options={templates.map((t) => ({ value: t.hash, label: t.hash }))}
              style={{ width: '100%', marginTop: 4 }}
              placeholder="Selecione o template"
              allowClear
              showSearch
              filterOption={(input, option) =>
                (option?.label ?? '').toString().toLowerCase().includes((input || '').toLowerCase())
              }
            />
          </div>
          <div>
            <Text type="secondary">Agendado em (deixe vazio para enviar quando possível)</Text>
            <Input
              type="datetime-local"
              value={editQueueScheduledAt}
              onChange={(e) => setEditQueueScheduledAt(e.target.value)}
              style={{ marginTop: 4, width: '100%' }}
            />
          </div>
          <div>
            <Text type="secondary">Status</Text>
            <Select
              value={editQueueStatus}
              onChange={(v) => setEditQueueStatus(v)}
              options={[
                { value: 'pending', label: 'Pendente' },
                { value: 'sent', label: 'Enviado' },
                { value: 'failed', label: 'Falha' },
              ]}
              style={{ width: '100%', marginTop: 4 }}
            />
          </div>
        </Space>
      </Modal>
    </div>
  )
}
