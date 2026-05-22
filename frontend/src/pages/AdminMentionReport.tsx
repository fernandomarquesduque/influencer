import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card, List, Space, Typography, message } from 'antd'
import { ArrowLeftOutlined, CopyOutlined, ReloadOutlined } from '@ant-design/icons'
import { fetchAdminUnregisteredMentionsReport, type AdminUnregisteredMentionsReport } from '../api'
import { useAuth } from '../contexts/AuthContext'
import './AdminDashboard.css'

function formatInt(n: number): string {
  return n.toLocaleString('pt-BR')
}

export default function AdminMentionReport() {
  const { isAdm } = useAuth()
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<AdminUnregisteredMentionsReport | null>(null)

  if (!isAdm) {
    return (
      <div className="admin-dashboard">
        <Typography.Text type="danger">Acesso negado. Apenas administradores.</Typography.Text>
      </div>
    )
  }

  const run = useCallback(async () => {
    setLoading(true)
    try {
      const report = await fetchAdminUnregisteredMentionsReport()
      setData(report)
      message.success('Relatório gerado.')
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Erro ao gerar relatório')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const copyList = useCallback(async () => {
    const handles = data?.notRegistered ?? []
    if (handles.length === 0) {
      message.warning('Não há lista para copiar.')
      return
    }
    const content = handles.join('\n')
    try {
      await navigator.clipboard.writeText(content)
      message.success(`Lista copiada (${handles.length} @).`)
    } catch {
      message.error('Não foi possível copiar a lista.')
    }
  }, [data])

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
            <h1 style={{ margin: 0 }}>Relatório: @ não cadastrados</h1>
            <p style={{ margin: 0 }}>
              Varre todos os posts na base, extrai menções (@) em legendas e textos auxiliares e compara com perfis
              existentes no RocksDB.
            </p>
          </Space>
        </div>
        <Button type="primary" icon={<ReloadOutlined />} onClick={() => void run()} loading={loading}>
          Gerar relatório
        </Button>
      </div>

      {data && (
        <section className="admin-dashboard__section" style={{ marginTop: 20 }}>
          <div className="admin-dashboard__stat-row" style={{ marginBottom: 20 }}>
            <div className="admin-dashboard__stat-tile admin-dashboard__stat-tile--posts">
              <div className="admin-dashboard__stat-label">Posts analisados</div>
              <div className="admin-dashboard__stat-value">{formatInt(data.postsScanned)}</div>
            </div>
            <div className="admin-dashboard__stat-tile admin-dashboard__stat-tile--profiles">
              <div className="admin-dashboard__stat-label">Perfis na base</div>
              <div className="admin-dashboard__stat-value">{formatInt(data.profilesInDb)}</div>
            </div>
            <div className="admin-dashboard__stat-tile admin-dashboard__stat-tile--meta">
              <div className="admin-dashboard__stat-label">@ únicos encontrados</div>
              <div className="admin-dashboard__stat-value">{formatInt(data.uniqueMentions)}</div>
            </div>
            <div className="admin-dashboard__stat-tile" style={{ borderColor: 'rgba(244, 63, 94, 0.35)' }}>
              <div className="admin-dashboard__stat-label">Sem cadastro na base</div>
              <div className="admin-dashboard__stat-value" style={{ color: '#e11d48' }}>
                {formatInt(data.notRegisteredCount)}
              </div>
            </div>
          </div>

          <Card
            title="Usernames citados com @ e ainda não cadastrados"
            size="small"
            extra={
              <Button
                icon={<CopyOutlined />}
                onClick={() => void copyList()}
                disabled={data.notRegistered.length === 0}
              >
                Copiar lista
              </Button>
            }
          >
            {data.notRegistered.length === 0 ? (
              <Typography.Text type="secondary">Nenhuma menção fora da base — ou ainda não há posts com @.</Typography.Text>
            ) : (
              <List
                size="small"
                bordered
                dataSource={data.notRegistered}
                style={{ maxHeight: 'min(70vh, 560px)', overflow: 'auto' }}
                renderItem={(item) => (
                  <List.Item style={{ fontFamily: 'ui-monospace, monospace' }}>{item}</List.Item>
                )}
              />
            )}
          </Card>
        </section>
      )}

      {!data && !loading && (
        <Typography.Paragraph type="secondary" style={{ marginTop: 24 }}>
          Clique em <strong>Gerar relatório</strong> para escanear a base. Em volumes grandes pode levar alguns segundos.
        </Typography.Paragraph>
      )}
    </div>
  )
}
