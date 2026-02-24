import { useState } from 'react'
import { Card, Input, Button, Typography, Space, Alert, Descriptions, Tag, Spin } from 'antd'
import { UserAddOutlined, LinkOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import { extractProfileToBackend, type ExtractProfileResult } from '../api'

const { Title, Text } = Typography

const REASON_LABELS: Record<string, string> = {
  nao_segue_perfil: 'Não segue o perfil oficial do programa (obrigatório para 2FA)',
  perfil_privado: 'Perfil privado; é necessário que seja público',
  estabelecimento_comercial: 'Marcado como estabelecimento comercial (categoria ou is_business)',
  conta_empresa: 'Tipo de conta = empresa (account_type 3)',
  conta_tipo_desconhecido: 'Tipo de conta não é pessoa/criador',
  seguidores_abaixo_minimo: 'Seguidores abaixo do mínimo exigido para o tipo de conta',
}

export default function ExtractProfile() {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ExtractProfileResult | null>(null)

  const handleExtract = async () => {
    const value = input.trim()
    if (!value) return
    setLoading(true)
    setResult(null)
    try {
      const data = await extractProfileToBackend(value)
      setResult(data)
    } catch (e) {
      setResult({
        success: false,
        handle: value.replace(/^@/, '').replace(/^https?:\/\/[^/]+\//, '').replace(/\/$/, '') || value,
        error: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleExtract()
  }

  return (
    <>
      <Title level={3} style={{ marginBottom: 24 }}>
        Extrair perfil específico
      </Title>
      <Card title="URL ou @ do perfil" style={{ marginBottom: 24 }}>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Input
            placeholder="https://www.instagram.com/rafaellacassol/ ou rafaellacassol"
            prefix={<LinkOutlined style={{ color: 'rgba(0,0,0,.25)' }} />}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            size="large"
            style={{ maxWidth: 480 }}
            autoFocus
          />
          <Button
            type="primary"
            icon={loading ? <Spin size="small" /> : <UserAddOutlined />}
            onClick={handleExtract}
            loading={loading}
            disabled={loading}
            size="large"
          >
            {loading ? 'Extraindo… (pode levar até 2 min)' : 'Extrair perfil'}
          </Button>
        </Space>
      </Card>

      {result && (
        <Card
          title={
            <Space>
              {result.success ? (
                <CheckCircleOutlined style={{ color: '#52c41a' }} />
              ) : (
                <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
              )}
              {result.success ? 'Perfil extraído e salvo' : 'Perfil não foi salvo'}
            </Space>
          }
        >
          {result.success ? (
            <>
              <Alert
                type="success"
                message={
                  <Space>
                    Perfil <strong>@{result.handle}</strong> foi extraído e salvo.
                    {result.followers != null && (
                      <span>
                        Seguidores: <strong>{result.followers.toLocaleString('pt-BR')}</strong>
                        {result.postsSaved != null && (
                          <> · Posts salvos: <strong>{result.postsSaved}</strong></>
                        )}
                      </span>
                    )}
                  </Space>
                }
                style={{ marginBottom: 16 }}
              />
              <Link to={`/influencer/${result.handle}`}>
                <Button type="primary">Ver perfil</Button>
              </Link>
            </>
          ) : (
            <>
              {result.error && (
                <Alert type="error" message={result.error} style={{ marginBottom: 16 }} />
              )}
              {result.rejectionReason && (
                <Alert
                  type="warning"
                  message="Rejeitado pelo filtro de influenciador"
                  description={
                    <Text>
                      {REASON_LABELS[result.rejectionReason] ?? result.rejectionReason}
                    </Text>
                  }
                  style={{ marginBottom: 16 }}
                />
              )}
              {result.diagnostic && (
                <Descriptions bordered size="small" column={1} style={{ maxWidth: 560 }}>
                  <Descriptions.Item label="Handle">@{result.handle}</Descriptions.Item>
                  <Descriptions.Item label="Seguidores">
                    {result.diagnostic.followers?.toLocaleString('pt-BR') ?? '—'}
                  </Descriptions.Item>
                  <Descriptions.Item label="Mínimo exigido">
                    {result.diagnostic.minRequired != null
                      ? result.diagnostic.minRequired.toLocaleString('pt-BR')
                      : '—'}
                  </Descriptions.Item>
                  <Descriptions.Item label="Tipo da conta (account_type)">
                    {result.diagnostic.accountType != null
                      ? result.diagnostic.accountType
                      : 'não informado'}
                    {result.diagnostic.accountType === 1 && ' (pessoal)'}
                    {result.diagnostic.accountType === 2 && ' (criador)'}
                    {result.diagnostic.accountType === 3 && ' (empresa)'}
                  </Descriptions.Item>
                  <Descriptions.Item label="Categoria">
                    {result.diagnostic.category ? (
                      <Tag>{result.diagnostic.category}</Tag>
                    ) : (
                      '—'
                    )}
                  </Descriptions.Item>
                  <Descriptions.Item label="is_business">
                    {result.diagnostic.isBusiness != null
                      ? String(result.diagnostic.isBusiness)
                      : '—'}
                  </Descriptions.Item>
                </Descriptions>
              )}
            </>
          )}
        </Card>
      )}
    </>
  )
}
