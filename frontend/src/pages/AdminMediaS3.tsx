/**
 * Admin: fila de re-extração (Playwright → S3). Enfileiramento em lote sem auditoria completa na tela.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  App,
  Button,
  Card,
  Input,
  Progress,
  Space,
  Tag,
  Typography,
} from 'antd'
import {
  ArrowLeftOutlined,
  CloudUploadOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  PlusOutlined,
  StopOutlined,
} from '@ant-design/icons'
import { useAuth } from '../contexts/AuthContext'
import {
  adminBulkEnqueueExtractQueueBatch,
  adminClearExtractQueue,
  adminEnqueueExtractQueue,
  fetchAdminExtractQueue,
  type AdminBulkEnqueueMode,
  type AdminExtractQueueStatus,
} from '../api'
import './AdminDashboard.css'

const QUEUE_POLL_MS = 4000
const BULK_BATCH_SIZE = 40

function formatInt(n: number): string {
  return n.toLocaleString('pt-BR')
}

type BulkProgress = {
  mode: AdminBulkEnqueueMode
  offset: number
  totalHandles: number
  scanned: number
  added: number
  skipped: number
}

export default function AdminMediaS3() {
  const { message, modal } = App.useApp()
  const { isAdm } = useAuth()

  const [queue, setQueue] = useState<AdminExtractQueueStatus | null>(null)
  const [addHandleInput, setAddHandleInput] = useState('')
  const [enqueuingOne, setEnqueuingOne] = useState(false)
  const [clearingQueue, setClearingQueue] = useState(false)
  const [bulkProgress, setBulkProgress] = useState<BulkProgress | null>(null)
  const bulkAbortRef = useRef(false)

  const loadQueue = useCallback(async () => {
    try {
      const data = await fetchAdminExtractQueue()
      setQueue(data)
    } catch {
      /* polling silencioso */
    }
  }, [])

  useEffect(() => {
    if (!isAdm) return
    void loadQueue()
    const id = setInterval(() => void loadQueue(), QUEUE_POLL_MS)
    return () => clearInterval(id)
  }, [isAdm, loadQueue])

  const enqueueHandles = async (handles: string[]) => {
    const clean = handles.map((h) => h.replace(/^@/, '').trim().toLowerCase()).filter(Boolean)
    if (clean.length === 0) {
      message.warning('Nenhum @ válido.')
      return
    }
    setEnqueuingOne(true)
    try {
      const out = await adminEnqueueExtractQueue(clean)
      if (out.added > 0) {
        message.success(
          `${out.added} enfileirado(s), ${out.skipped} ignorado(s). Extração em andamento (uma por vez).`
        )
      } else {
        const detail = out.results?.find((r) => !r.queued)?.message
        message.info(
          detail ||
            (out.skipped > 0
              ? 'Perfil já na fila, em processamento ou sem LLM concluído.'
              : 'Nenhum perfil enfileirado (exige LLM concluído).')
        )
      }
      setAddHandleInput('')
      await loadQueue()
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Falha ao enfileirar')
    } finally {
      setEnqueuingOne(false)
    }
  }

  const runBulkEnqueue = async (mode: AdminBulkEnqueueMode) => {
    if (bulkProgress) {
      message.warning('Já há uma varredura em andamento.')
      return
    }
    bulkAbortRef.current = false
    let offset = 0
    let totalHandles = 0
    let scanned = 0
    let added = 0
    let skipped = 0

    setBulkProgress({ mode, offset: 0, totalHandles: 0, scanned: 0, added: 0, skipped: 0 })

    try {
      for (;;) {
        if (bulkAbortRef.current) {
          message.info('Varredura interrompida.')
          break
        }
        const batch = await adminBulkEnqueueExtractQueueBatch({
          mode,
          offset,
          batch_size: BULK_BATCH_SIZE,
        })
        totalHandles = batch.total_handles
        offset = batch.next_offset
        scanned += batch.scanned
        added += batch.added
        skipped += batch.skipped
        setBulkProgress({ mode, offset, totalHandles, scanned, added, skipped })
        await loadQueue()
        if (batch.done) {
          message.success(
            `Varredura concluída: ${formatInt(added)} enfileirado(s), ${formatInt(skipped)} ignorado(s) · fila com ${formatInt(batch.queue_length)} item(ns).`
          )
          break
        }
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Falha na varredura em lote')
    } finally {
      setBulkProgress(null)
      bulkAbortRef.current = false
    }
  }

  const stopBulk = () => {
    bulkAbortRef.current = true
  }

  const confirmClearQueue = () => {
    const pendingCount = queue?.pending.length ?? 0
    if (pendingCount === 0 && !queue?.processing_handle) {
      message.info('A fila já está vazia.')
      return
    }
    modal.confirm({
      title: 'Limpar fila de extração?',
      content: queue?.processing_handle
        ? `Serão removidos ${formatInt(pendingCount)} perfil(is) aguardando. A extração de @${queue.processing_handle} em andamento não é cancelada.`
        : `Serão removidos ${formatInt(pendingCount)} perfil(is) da fila.`,
      okText: 'Limpar fila',
      okType: 'danger',
      cancelText: 'Cancelar',
      onOk: async () => {
        setClearingQueue(true)
        try {
          const out = await adminClearExtractQueue()
          if (out.cleared_pending === 0) {
            message.info('Nenhum pendente para remover.')
          } else {
            message.success(
              `${formatInt(out.cleared_pending)} removido(s) da fila${
                out.processing_handle ? ` · @${out.processing_handle} ainda em extração` : ''
              }.`
            )
          }
          await loadQueue()
        } catch (e) {
          message.error(e instanceof Error ? e.message : 'Falha ao limpar fila')
        } finally {
          setClearingQueue(false)
        }
      },
    })
  }

  if (!isAdm) {
    return (
      <div className="admin-dashboard">
        <Typography.Text type="danger">Acesso negado. Apenas administradores.</Typography.Text>
      </div>
    )
  }

  const blockedUntil = queue?.extract_blocked_until
  const blockedLabel =
    blockedUntil && blockedUntil > Date.now()
      ? `Extração bloqueada até ${new Date(blockedUntil).toLocaleString('pt-BR')}`
      : null

  const bulkPct =
    bulkProgress && bulkProgress.totalHandles > 0
      ? Math.min(100, Math.round((bulkProgress.offset / bulkProgress.totalHandles) * 100))
      : undefined

  const bulkModeLabel =
    bulkProgress?.mode === 'all_llm'
      ? 'Toda a base (com LLM concluído)'
      : 'Sem mídia estável no S3 (com LLM)'

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
              Enfileira perfis para re-extração (Playwright → S3). Só entra na fila quem tem classificação LLM
              concluída. A varredura da base roda em lotes — não carrega todos os perfis na tela de uma vez.
            </p>
          </Space>
        </div>
      </div>

      {blockedLabel ? (
        <div className="admin-dashboard__warn" style={{ marginBottom: 16 }}>
          {blockedLabel}
        </div>
      ) : null}

      <section className="admin-dashboard__section" style={{ marginBottom: 24 }}>
        <div className="admin-dashboard__section-head">
          <span className="admin-dashboard__section-accent" style={{ background: '#6366f1' }} />
          <div className="admin-dashboard__section-head-text">
            <h2>Enfileirar em massa</h2>
            <span className="admin-dashboard__section-muted">
              Varre a base aos poucos e adiciona na fila · extração serial (prioridade admin)
            </span>
          </div>
        </div>
        <Card size="small" style={{ marginBottom: 12 }}>
          <Space wrap>
            <Button
              type="primary"
              icon={<CloudUploadOutlined />}
              disabled={!!bulkProgress}
              onClick={() => void runBulkEnqueue('missing_s3')}
            >
              Enfileirar todos sem S3
            </Button>
            <Button
              icon={<DatabaseOutlined />}
              disabled={!!bulkProgress}
              onClick={() => void runBulkEnqueue('all_llm')}
            >
              Enfileirar toda a base (LLM ok)
            </Button>
            {bulkProgress ? (
              <Button danger icon={<StopOutlined />} onClick={stopBulk}>
                Parar varredura
              </Button>
            ) : null}
          </Space>
          {bulkProgress ? (
            <div style={{ marginTop: 16 }}>
              <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                {bulkModeLabel} · {formatInt(bulkProgress.added)} enfileirado(s) ·{' '}
                {formatInt(bulkProgress.skipped)} ignorado(s) ·{' '}
                {bulkProgress.totalHandles > 0
                  ? `${formatInt(bulkProgress.offset)} / ${formatInt(bulkProgress.totalHandles)} handles`
                  : 'iniciando…'}
              </Typography.Text>
              <Progress percent={bulkPct} status="active" />
            </div>
          ) : null}
        </Card>
      </section>

      <section className="admin-dashboard__section">
        <div className="admin-dashboard__section-head">
          <span className="admin-dashboard__section-accent" style={{ background: '#14b8a6' }} />
          <div className="admin-dashboard__section-head-text">
            <h2>Fila de extração</h2>
            <span className="admin-dashboard__section-muted">
              {queue?.length != null ? `${formatInt(queue.length)} na fila agora` : '—'} · re-extração serial
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
              disabled={!!bulkProgress}
            />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              loading={enqueuingOne}
              disabled={!!bulkProgress}
              onClick={() => void enqueueHandles([addHandleInput])}
            >
              Adicionar à fila
            </Button>
            <Button
              danger
              icon={<DeleteOutlined />}
              loading={clearingQueue}
              disabled={!!bulkProgress || !queue?.pending.length}
              onClick={confirmClearQueue}
            >
              Limpar fila
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
              <Tag key={h} color={queue.priority_handles.includes(h) ? 'purple' : 'blue'}>
                @{h}
                {queue.priority_handles.includes(h) ? ' · prio' : ''}
              </Tag>
            ))}
          </div>
        ) : queue?.processing_handle ? (
          <Typography.Text type="secondary">
            Aguardando na fila: nenhum (só o perfil em processamento acima).
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary">Fila vazia.</Typography.Text>
        )}
      </section>
    </div>
  )
}
