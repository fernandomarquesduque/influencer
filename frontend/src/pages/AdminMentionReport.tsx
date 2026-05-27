import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card, InputNumber, List, Radio, Space, Typography, message } from 'antd'
import { ArrowLeftOutlined, CopyOutlined, ReloadOutlined } from '@ant-design/icons'
import { fetchAdminUnregisteredMentionsReport, type AdminUnregisteredMentionsReport } from '../api'
import { useAuth } from '../contexts/AuthContext'
import './AdminDashboard.css'

function formatInt(n: number): string {
  return n.toLocaleString('pt-BR')
}

type ReportStrategy = 'profiles' | 'posts'

export default function AdminMentionReport() {
  const { isAdm } = useAuth()
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<AdminUnregisteredMentionsReport | null>(null)
  const [strategy, setStrategy] = useState<ReportStrategy>('profiles')
  const [sampleSize, setSampleSize] = useState(800)
  const [listLimit, setListLimit] = useState(500)
  const [maxPostsPerProfile, setMaxPostsPerProfile] = useState(15)

  if (!isAdm) {
    return (
      <div className="admin-dashboard">
        <Typography.Text type="danger">Acesso negado. Apenas administradores.</Typography.Text>
      </div>
    )
  }

  const sampleMax = strategy === 'profiles' ? 3_000 : 5_000
  const sampleDefault = strategy === 'profiles' ? 800 : 2_000

  const run = useCallback(async () => {
    setLoading(true)
    try {
      const report = await fetchAdminUnregisteredMentionsReport({
        strategy,
        sample: sampleSize,
        limit: listLimit,
        maxPostsPerProfile: strategy === 'profiles' ? maxPostsPerProfile : undefined,
      })
      setData(report)
      message.success('Relatório gerado.')
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Erro ao gerar relatório')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [strategy, sampleSize, listLimit, maxPostsPerProfile])

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
              Extrai @ em legendas e compara com as chaves do bucket <code>profile</code>. O modo{' '}
              <strong>por perfis</strong> (padrão) sorteia perfis e lê só os posts deles — adequado para produção. O
              modo <strong>por posts</strong> faz amostra global na base inteira (mais lento; máx. 5 mil posts).
            </p>
          </Space>
        </div>
        <Space wrap align="end">
          <Space direction="vertical" size={2}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Estratégia
            </Typography.Text>
            <Radio.Group
              value={strategy}
              disabled={loading}
              onChange={(e) => {
                const next = e.target.value as ReportStrategy
                setStrategy(next)
                setSampleSize(next === 'profiles' ? 800 : 2_000)
              }}
              optionType="button"
              buttonStyle="solid"
              options={[
                { label: 'Por perfis', value: 'profiles' },
                { label: 'Por posts', value: 'posts' },
              ]}
            />
          </Space>
          <Space direction="vertical" size={2}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {strategy === 'profiles' ? 'Perfis na amostra' : 'Posts na amostra'}
            </Typography.Text>
            <InputNumber
              min={50}
              max={sampleMax}
              step={strategy === 'profiles' ? 100 : 500}
              value={sampleSize}
              onChange={(v) => setSampleSize(typeof v === 'number' ? v : sampleDefault)}
              disabled={loading}
            />
          </Space>
          {strategy === 'profiles' ? (
            <Space direction="vertical" size={2}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Máx. posts / perfil
              </Typography.Text>
              <InputNumber
                min={5}
                max={40}
                step={5}
                value={maxPostsPerProfile}
                onChange={(v) => setMaxPostsPerProfile(typeof v === 'number' ? v : 15)}
                disabled={loading}
              />
            </Space>
          ) : null}
          <Space direction="vertical" size={2}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Máx. @ na lista
            </Typography.Text>
            <InputNumber
              min={50}
              max={2_000}
              step={100}
              value={listLimit}
              onChange={(v) => setListLimit(typeof v === 'number' ? v : 500)}
              disabled={loading}
            />
          </Space>
          <Button type="primary" icon={<ReloadOutlined />} onClick={() => void run()} loading={loading}>
            Gerar relatório
          </Button>
        </Space>
      </div>

      {data && (
        <section className="admin-dashboard__section" style={{ marginTop: 20 }}>
          <div className="admin-dashboard__stat-row" style={{ marginBottom: 20 }}>
            <div className="admin-dashboard__stat-tile admin-dashboard__stat-tile--posts">
              <div className="admin-dashboard__stat-label">Posts analisados</div>
              <div className="admin-dashboard__stat-value">{formatInt(data.postsScanned)}</div>
              {data.postsInDb != null && data.postsInDb > data.postsScanned ? (
                <div className="admin-dashboard__stat-hint" style={{ fontSize: 12, opacity: 0.85 }}>
                  de {formatInt(data.postsInDb)} na base
                </div>
              ) : null}
              {data.strategy === 'profiles' && data.profileSampleSize != null ? (
                <div className="admin-dashboard__stat-hint" style={{ fontSize: 12, opacity: 0.85 }}>
                  {formatInt(data.profileSampleSize)} perfis × até {data.maxPostsPerProfile ?? 15} posts
                </div>
              ) : null}
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
              <div className="admin-dashboard__stat-label">Sem cadastro (amostra)</div>
              <div className="admin-dashboard__stat-value" style={{ color: '#e11d48' }}>
                {formatInt(data.notRegisteredCount)}
              </div>
              {data.notRegisteredTruncated ? (
                <div className="admin-dashboard__stat-hint" style={{ fontSize: 12, opacity: 0.85 }}>
                  exibindo {formatInt(data.notRegisteredReturned ?? data.notRegistered.length)} aleatórios
                </div>
              ) : null}
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
          Clique em <strong>Gerar relatório</strong> para sortear perfis (recomendado) ou posts e listar @ ainda não
          cadastrados.
        </Typography.Paragraph>
      )}
    </div>
  )
}
