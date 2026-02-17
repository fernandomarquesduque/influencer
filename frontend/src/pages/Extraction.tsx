import { useEffect, useState, useRef, useCallback } from 'react'
import {
  Card,
  Input,
  InputNumber,
  Button,
  Switch,
  Typography,
  Space,
  List,
  Tag,
  Alert,
  Spin,
  Row,
  Col,
  Statistic,
  Avatar,
} from 'antd'
import { PlayCircleOutlined, StopOutlined, ReloadOutlined, TagOutlined, UserOutlined } from '@ant-design/icons'
import { fetchCrawlStatus, startCrawl, stopCrawl, fetchProfiles, getProfilePicUrl, proxyImageUrl, queueRefreshProfile, type ProfileItem } from '../api'

const { Title, Text } = Typography

const POLL_STATUS_MS = 2000
const POLL_PROFILES_MS = 3000

export default function Extraction() {
  const [tag, setTag] = useState('')
  const [limit, setLimit] = useState<number | undefined>(30)
  const [clearBefore, setClearBefore] = useState(false)
  const [running, setRunning] = useState(false)
  const [lastResult, setLastResult] = useState<{ saved: number; tag: string; finishedAt: string } | null>(null)
  const [profiles, setProfiles] = useState<ProfileItem[]>([])
  const [profilesLoading, setProfilesLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [extractionStartedAt, setExtractionStartedAt] = useState<string | null>(null)
  const statusPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const profilesPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadProfiles = useCallback(async () => {
    if (extractionStartedAt == null) {
      setProfiles([])
      return
    }
    setProfilesLoading(true)
    try {
      const res = await fetchProfiles(200, 0, extractionStartedAt)
      setProfiles(res.items ?? [])
    } catch {
      setProfiles([])
    } finally {
      setProfilesLoading(false)
    }
  }, [extractionStartedAt])

  const loadStatus = useCallback(async () => {
    try {
      const status = await fetchCrawlStatus()
      setRunning(status.running)
      if (status.last) setLastResult(status.last)
    } catch {
      setRunning(false)
    }
  }, [])

  useEffect(() => {
    loadStatus()
    if (extractionStartedAt != null) loadProfiles()
  }, [loadStatus, loadProfiles, extractionStartedAt])

  useEffect(() => {
    if (running) {
      statusPollRef.current = setInterval(loadStatus, POLL_STATUS_MS)
      profilesPollRef.current = setInterval(loadProfiles, POLL_PROFILES_MS)
    } else {
      if (statusPollRef.current) {
        clearInterval(statusPollRef.current)
        statusPollRef.current = null
      }
      if (profilesPollRef.current) {
        clearInterval(profilesPollRef.current)
        profilesPollRef.current = null
      }
    }
    return () => {
      if (statusPollRef.current) clearInterval(statusPollRef.current)
      if (profilesPollRef.current) clearInterval(profilesPollRef.current)
    }
  }, [running, loadStatus, loadProfiles])

  const handleStart = async () => {
    const t = tag.replace(/^#/, '').trim()
    if (!t) {
      setError('Digite a hashtag (ex.: viagem)')
      return
    }
    setError(null)
    try {
      setExtractionStartedAt(new Date().toISOString())
      await startCrawl({ tag: t, limit: limit ?? undefined, clear: clearBefore })
      setRunning(true)
      setLastResult(null)
      setProfiles([])
      loadStatus()
      loadProfiles()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const handleStop = async () => {
    setError(null)
    try {
      await stopCrawl()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <>
      <Title level={3} style={{ marginBottom: 24 }}>
        Extração por hashtag
      </Title>

      <Card title="Iniciar coleta" style={{ marginBottom: 24 }}>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          {error && (
            <Alert type="error" message={error} closable onClose={() => setError(null)} />
          )}
          <Row gutter={16} align="middle">
            <Col flex="1" style={{ minWidth: 200 }}>
              <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Hashtag</Text>
              <Input
                placeholder="Ex.: viagem"
                prefix={<TagOutlined style={{ color: 'rgba(0,0,0,.25)' }} />}
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                onPressEnter={handleStart}
                disabled={running}
                size="large"
              />
            </Col>
            <Col>
              <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Limite de perfis</Text>
              <InputNumber
                min={1}
                max={5000}
                value={limit}
                onChange={(v) => setLimit(v ?? undefined)}
                disabled={running}
                style={{ width: 100 }}
              />
            </Col>
            <Col>
              <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Limpar banco antes</Text>
              <Switch checked={clearBefore} onChange={setClearBefore} disabled={running} />
            </Col>
          </Row>
          <Space>
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={handleStart}
              loading={running}
              disabled={running}
              size="large"
            >
              Iniciar extração
            </Button>
            {running && (
              <Button
                danger
                icon={<StopOutlined />}
                onClick={handleStop}
                size="large"
              >
                Parar
              </Button>
            )}
          </Space>
          {running && (
            <Alert
              type="info"
              message="Extração em andamento. Os dados abaixo são atualizados automaticamente. Clique em Parar para encerrar após o perfil atual."
              showIcon
            />
          )}
          {lastResult && !running && (
            <Text type="secondary">
              Última execução: <strong>{lastResult.saved}</strong> perfil(is) salvos — #{lastResult.tag} — {new Date(lastResult.finishedAt).toLocaleString('pt-BR')}
            </Text>
          )}
        </Space>
      </Card>

      <Card
        title={
          <Space>
            <ReloadOutlined spin={profilesLoading && running} />
            {extractionStartedAt != null ? 'Perfis coletados nesta extração' : 'Perfis desta extração'}
          </Space>
        }
        extra={
          <Statistic title="Coletados nesta sessão" value={profiles.length} />
        }
      >
        {extractionStartedAt == null ? (
          <Typography.Text type="secondary">
            Inicie uma extração pela hashtag acima para listar aqui apenas os perfis coletados a partir do início.
          </Typography.Text>
        ) : profilesLoading && profiles.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 48 }}>
            <Spin size="large" />
          </div>
        ) : profiles.length === 0 ? (
          <Typography.Text type="secondary">
            Nenhum perfil coletado ainda nesta extração. Aguarde ou verifique se a coleta está rodando.
          </Typography.Text>
        ) : (
          <List
            size="small"
            dataSource={profiles}
            renderItem={(item, index) => {
              const handle = (item.handle ?? item.key ?? '').toString()
              const name = (item.full_name ?? item.username ?? handle) as string
              const followers = item.followers_count ?? (item.data?.user as { follower_count?: number } | undefined)?.follower_count
              const picUrl = proxyImageUrl(getProfilePicUrl(item))
              return (
                <List.Item>
                  <Space>
                    <Avatar
                      size={40}
                      src={picUrl}
                      icon={<UserOutlined />}
                      alt={handle}
                      onError={() => {
                        if (handle) queueRefreshProfile(handle).catch(() => {})
                        return false
                      }}
                    />
                    <Text type="secondary">#{index + 1}</Text>
                    <Tag color="blue">@{handle}</Tag>
                    {name && name !== handle && <Text ellipsis style={{ maxWidth: 200 }}>{name}</Text>}
                    {followers != null && (
                      <Text type="secondary">{Number(followers).toLocaleString('pt-BR')} seguidores</Text>
                    )}
                  </Space>
                </List.Item>
              )
            }}
            style={{ maxHeight: 400, overflow: 'auto' }}
          />
        )}
      </Card>
    </>
  )
}
