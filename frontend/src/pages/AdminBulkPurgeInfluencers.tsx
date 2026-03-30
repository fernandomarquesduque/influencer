/**
 * Admin: listagem global do índice com filtros LLM e exclusão em lote (purge completo).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  App,
  Card,
  Table,
  Button,
  Space,
  Input,
  Select,
  Typography,
  Row,
  Col,
  Collapse,
  Alert,
  Tag,
} from 'antd'
import type { TableRowSelection } from 'antd/es/table/interface'
import { DeleteOutlined, SearchOutlined, ReloadOutlined } from '@ant-design/icons'
import {
  fetchAdminInfluencers,
  adminPurgeInfluencersBatch,
  type ProfileListItem,
  type ProfilesSearchFacets,
  type ProfilesSort,
  type ProfilesSearchQuery,
} from '../api'
import { getLlmQualification } from '../utils/mapProfileListToPreviewItems'
import { getLlmProfileTypeBadge, getLlmMainCategoryLabel, getLlmGenderBadge } from '../utils/campaignLlmBadges'
import './AdminBulkPurgeInfluencers.css'

const PAGE_SIZE = 50

const SORT_OPTIONS: { value: ProfilesSort; label: string }[] = [
  { value: 'engagement_desc', label: 'Engajamento (maior)' },
  { value: 'engagement_asc', label: 'Engajamento (menor)' },
  { value: 'followers_desc', label: 'Seguidores (maior)' },
  { value: 'followers_asc', label: 'Seguidores (menor)' },
  { value: 'name_asc', label: 'Nome A–Z' },
  { value: 'name_desc', label: 'Nome Z–A' },
  { value: 'posts_count_desc', label: 'Posts (maior)' },
  { value: 'posts_count_asc', label: 'Posts (menor)' },
]

function facetOptions(rows: { name: string; count: number }[] | undefined): { label: string; value: string }[] {
  if (!rows?.length) return []
  return rows.map((r) => ({
    label: `${r.name} (${r.count})`,
    value: r.name,
  }))
}

function brandSafetyLabel(item: ProfileListItem): string {
  const q = getLlmQualification(item as unknown as Record<string, unknown>)
  if (!q) return '—'
  const bs = q.brandSafety
  if (typeof bs === 'string' && bs.trim()) return bs.trim()
  if (bs != null && typeof bs === 'object' && !Array.isArray(bs)) {
    const o = bs as Record<string, unknown>
    const risk = String(o.riskLevel ?? '').trim()
    if (risk) return risk
  }
  return '—'
}

export default function AdminBulkPurgeInfluencers() {
  const { message, modal } = App.useApp()
  const [qText, setQText] = useState('')
  const [sort, setSort] = useState<ProfilesSort>('followers_desc')
  const [llmProfileType, setLlmProfileType] = useState<string[]>([])
  const [llmMainCategory, setLlmMainCategory] = useState<string[]>([])
  const [llmGender, setLlmGender] = useState<string[]>([])
  const [llmLanguage, setLlmLanguage] = useState<string[]>([])
  const [llmAudienceType, setLlmAudienceType] = useState<string[]>([])
  const [llmToneOfVoice, setLlmToneOfVoice] = useState<string[]>([])
  const [llmSubCategories, setLlmSubCategories] = useState<string[]>([])
  const [llmContentPillars, setLlmContentPillars] = useState<string[]>([])
  const [llmRiskLevelRaw, setLlmRiskLevelRaw] = useState('')
  const [brandSafetyFilter, setBrandSafetyFilter] = useState<'' | 'familia' | 'adulto'>('')
  const [sizeFilter, setSizeFilter] = useState<string[]>([])

  const [facets, setFacets] = useState<ProfilesSearchFacets | null>(null)
  const [items, setItems] = useState<ProfileListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [purging, setPurging] = useState(false)

  const llmFacets = facets?.llm

  const searchQuery = useCallback((): ProfilesSearchQuery => {
    const riskParts = llmRiskLevelRaw
      .split(/[,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
    const q: ProfilesSearchQuery = {
      sort,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }
    const t = qText.trim()
    if (t) q.q = t
    if (llmProfileType.length) q.llmProfileType = llmProfileType
    if (llmMainCategory.length) q.llmMainCategory = llmMainCategory
    if (llmGender.length) q.llmGender = llmGender
    if (llmLanguage.length) q.llmLanguage = llmLanguage
    if (llmAudienceType.length) q.llmAudienceType = llmAudienceType
    if (llmToneOfVoice.length) q.llmToneOfVoice = llmToneOfVoice
    if (llmSubCategories.length) q.llmSubCategories = llmSubCategories
    if (llmContentPillars.length) q.llmContentPillars = llmContentPillars
    if (riskParts.length) q.llmRiskLevel = riskParts
    if (brandSafetyFilter === 'familia') q.llmIsFamilySafe = true
    if (brandSafetyFilter === 'adulto') q.llmIsAdultContent = true
    if (sizeFilter.length) q.sizeFilter = sizeFilter
    return q
  }, [
    sort,
    page,
    qText,
    llmProfileType,
    llmMainCategory,
    llmGender,
    llmLanguage,
    llmAudienceType,
    llmToneOfVoice,
    llmSubCategories,
    llmContentPillars,
    llmRiskLevelRaw,
    brandSafetyFilter,
    sizeFilter,
  ])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchAdminInfluencers(searchQuery())
      setItems(res.items)
      setTotal(res.total)
      if (res.facets) setFacets(res.facets)
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Falha ao carregar lista')
      setItems([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [searchQuery, message])

  useEffect(() => {
    void load()
  }, [load])

  const sizeOptions = useMemo(() => {
    const buckets = facets?.followers_buckets ?? facets?.size_buckets
    if (!buckets?.length) return []
    return buckets.map((b) => ({
      label: `${b.label} (${b.count})`,
      value: b.key === 'medio' ? 'mid' : b.key,
    }))
  }, [facets])

  const rowSelection: TableRowSelection<ProfileListItem> = {
    selectedRowKeys,
    onChange: setSelectedRowKeys,
    preserveSelectedRowKeys: true,
  }

  const handlePurgeSelected = () => {
    const handles = selectedRowKeys.map(String).filter(Boolean)
    if (handles.length === 0) {
      message.warning('Selecione pelo menos um influenciador.')
      return
    }
    modal.confirm({
      title: 'Excluir influenciadores em lote?',
      width: 560,
      okText: `Excluir ${handles.length}`,
      okType: 'danger',
      cancelText: 'Cancelar',
      content: (
        <div>
          <p>
            Esta ação remove perfil, mídias, campanhas (referências), S3 e conta vinculada — como em &quot;Excluir
            completamente&quot;. Não dá para desfazer.
          </p>
          <p style={{ marginTop: 8 }}>
            <strong>{handles.length}</strong> perfil(is):{' '}
            <span style={{ wordBreak: 'break-all' }}>{handles.slice(0, 15).join(', ')}</span>
            {handles.length > 15 ? ` … +${handles.length - 15}` : ''}
          </p>
        </div>
      ),
      onOk: async () => {
        setPurging(true)
        try {
          const out = await adminPurgeInfluencersBatch(handles)
          const removedSet = new Set(out.removed)
          setSelectedRowKeys((keys) => keys.filter((k) => !removedSet.has(String(k))))
          if (out.failed.length === 0) {
            message.success(
              out.s3ObjectsRemoved > 0
                ? `Removidos ${out.removed.length} perfil(is). ${out.s3ObjectsRemoved} arquivo(s) no S3.`
                : `Removidos ${out.removed.length} perfil(is).`,
            )
          } else {
            message.warning(
              `Removidos ${out.removed.length}; falhas: ${out.failed.length}. Verifique o console ou tente de novo.`,
            )
            console.warn('[purge-batch] failed', out.failed)
          }
          await load()
        } catch (e) {
          message.error(e instanceof Error ? e.message : 'Falha na exclusão em lote')
          throw e
        } finally {
          setPurging(false)
        }
      },
    })
  }

  return (
    <div className="admin-bulk-purge">
      <Card
        title="Exclusão em lote (admin)"
        extra={
          <Space wrap>
            <Link to="/app/admin/dashboard">Painel admin</Link>
            <Link to="/app/admin/users">Usuários</Link>
          </Space>
        }
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="Área restrita a administradores. Use filtros LLM para reduzir o conjunto antes de selecionar e excluir."
        />

        <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
          <Col xs={24} md={10}>
            <Input
              allowClear
              placeholder="Busca (nome, @handle, bio, categorias…)"
              value={qText}
              onChange={(e) => {
                setQText(e.target.value)
                setPage(1)
              }}
              onPressEnter={() => void load()}
            />
          </Col>
          <Col xs={24} md={6}>
            <Select
              style={{ width: '100%' }}
              value={sort}
              options={SORT_OPTIONS}
              onChange={(v) => {
                setSort(v)
                setPage(1)
              }}
            />
          </Col>
          <Col xs={24} md={8}>
            <Space wrap>
              <Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={() => void load()}>
                Atualizar lista
              </Button>
              <Button
                icon={<ReloadOutlined />}
                onClick={() => {
                  setSelectedRowKeys([])
                  void load()
                }}
              >
                Limpar seleção
              </Button>
            </Space>
          </Col>
        </Row>

        <Collapse
          defaultActiveKey={['llm']}
          items={[
            {
              key: 'llm',
              label: 'Filtros LLM e porte',
              children: (
                <Row gutter={[12, 12]}>
                  <Col xs={24} sm={12} md={8}>
                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
                      Tipo de perfil
                    </Typography.Text>
                    <Select
                      mode="multiple"
                      allowClear
                      style={{ width: '100%' }}
                      placeholder="Qualquer"
                      options={facetOptions(llmFacets?.profileType)}
                      value={llmProfileType}
                      onChange={(v) => {
                        setLlmProfileType(v)
                        setPage(1)
                      }}
                    />
                  </Col>
                  <Col xs={24} sm={12} md={8}>
                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
                      Categoria principal
                    </Typography.Text>
                    <Select
                      mode="multiple"
                      allowClear
                      style={{ width: '100%' }}
                      placeholder="Qualquer"
                      options={facetOptions(llmFacets?.mainCategory)}
                      value={llmMainCategory}
                      onChange={(v) => {
                        setLlmMainCategory(v)
                        setPage(1)
                      }}
                    />
                  </Col>
                  <Col xs={24} sm={12} md={8}>
                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
                      Gênero
                    </Typography.Text>
                    <Select
                      mode="multiple"
                      allowClear
                      style={{ width: '100%' }}
                      placeholder="Qualquer"
                      options={facetOptions(llmFacets?.gender)}
                      value={llmGender}
                      onChange={(v) => {
                        setLlmGender(v)
                        setPage(1)
                      }}
                    />
                  </Col>
                  <Col xs={24} sm={12} md={8}>
                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
                      Idioma
                    </Typography.Text>
                    <Select
                      mode="multiple"
                      allowClear
                      style={{ width: '100%' }}
                      placeholder="Qualquer"
                      options={facetOptions(llmFacets?.language)}
                      value={llmLanguage}
                      onChange={(v) => {
                        setLlmLanguage(v)
                        setPage(1)
                      }}
                    />
                  </Col>
                  <Col xs={24} sm={12} md={8}>
                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
                      Público-alvo
                    </Typography.Text>
                    <Select
                      mode="multiple"
                      allowClear
                      style={{ width: '100%' }}
                      placeholder="Qualquer"
                      options={facetOptions(llmFacets?.audienceType)}
                      value={llmAudienceType}
                      onChange={(v) => {
                        setLlmAudienceType(v)
                        setPage(1)
                      }}
                    />
                  </Col>
                  <Col xs={24} sm={12} md={8}>
                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
                      Tom de voz
                    </Typography.Text>
                    <Select
                      mode="multiple"
                      allowClear
                      style={{ width: '100%' }}
                      placeholder="Qualquer"
                      options={facetOptions(llmFacets?.toneOfVoice)}
                      value={llmToneOfVoice}
                      onChange={(v) => {
                        setLlmToneOfVoice(v)
                        setPage(1)
                      }}
                    />
                  </Col>
                  <Col xs={24} sm={12} md={8}>
                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
                      Subcategorias
                    </Typography.Text>
                    <Select
                      mode="multiple"
                      allowClear
                      style={{ width: '100%' }}
                      placeholder="Qualquer"
                      options={facetOptions(llmFacets?.subCategories)}
                      value={llmSubCategories}
                      onChange={(v) => {
                        setLlmSubCategories(v)
                        setPage(1)
                      }}
                    />
                  </Col>
                  <Col xs={24} sm={12} md={8}>
                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
                      Pilares de conteúdo
                    </Typography.Text>
                    <Select
                      mode="multiple"
                      allowClear
                      style={{ width: '100%' }}
                      placeholder="Qualquer"
                      options={facetOptions(llmFacets?.contentPillars)}
                      value={llmContentPillars}
                      onChange={(v) => {
                        setLlmContentPillars(v)
                        setPage(1)
                      }}
                    />
                  </Col>
                  <Col xs={24} sm={12} md={8}>
                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
                      Nível de risco
                    </Typography.Text>
                    <Input
                      allowClear
                      placeholder="ex.: low, medium, high (separados por vírgula)"
                      value={llmRiskLevelRaw}
                      onChange={(e) => {
                        setLlmRiskLevelRaw(e.target.value)
                        setPage(1)
                      }}
                    />
                  </Col>
                  <Col xs={24} sm={12} md={8}>
                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
                      Segurança de marca
                    </Typography.Text>
                    <Select
                      allowClear
                      style={{ width: '100%' }}
                      placeholder="Qualquer"
                      value={brandSafetyFilter || undefined}
                      options={[
                        { value: 'familia', label: 'Adequado à família' },
                        { value: 'adulto', label: 'Conteúdo adulto' },
                      ]}
                      onChange={(v) => {
                        setBrandSafetyFilter((v ?? '') as '' | 'familia' | 'adulto')
                        setPage(1)
                      }}
                    />
                  </Col>
                  <Col xs={24} sm={12} md={8}>
                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
                      Porte (seguidores)
                    </Typography.Text>
                    <Select
                      mode="multiple"
                      allowClear
                      style={{ width: '100%' }}
                      placeholder="Qualquer"
                      options={sizeOptions}
                      value={sizeFilter}
                      onChange={(v) => {
                        setSizeFilter(v)
                        setPage(1)
                      }}
                    />
                  </Col>
                </Row>
              ),
            },
          ]}
        />

        <div className="admin-bulk-purge-toolbar">
          <Space wrap>
            <Typography.Text>
              Total no filtro: <strong>{total}</strong>
            </Typography.Text>
            {selectedRowKeys.length > 0 && (
              <Tag color="magenta">Selecionados: {selectedRowKeys.length}</Tag>
            )}
            <Button
              danger
              type="primary"
              icon={<DeleteOutlined />}
              disabled={selectedRowKeys.length === 0 || purging}
              loading={purging}
              onClick={handlePurgeSelected}
            >
              Excluir selecionados
            </Button>
          </Space>
        </div>

        <Table<ProfileListItem>
          rowKey={(r) => r.handle || r.key}
          loading={loading}
          dataSource={items}
          rowSelection={rowSelection}
          scroll={{ x: 960 }}
          pagination={{
            current: page,
            pageSize: PAGE_SIZE,
            total,
            showSizeChanger: false,
            onChange: (p) => setPage(p),
          }}
          columns={[
            {
              title: 'Handle',
              dataIndex: 'handle',
              width: 160,
              fixed: 'left',
              render: (_: unknown, row) => `@${row.handle || row.key}`,
            },
            {
              title: 'Nome',
              ellipsis: true,
              render: (_: unknown, row) => row.full_name || '—',
            },
            {
              title: 'Seguidores',
              width: 110,
              render: (_: unknown, row) => (row.followers_count ?? 0).toLocaleString('pt-BR'),
            },
            {
              title: 'Tipo LLM',
              width: 130,
              ellipsis: true,
              render: (_: unknown, row) => getLlmProfileTypeBadge(row)?.text ?? '—',
            },
            {
              title: 'Categoria',
              width: 140,
              ellipsis: true,
              render: (_: unknown, row) => getLlmMainCategoryLabel(row) ?? '—',
            },
            {
              title: 'Gênero',
              width: 100,
              render: (_: unknown, row) => getLlmGenderBadge(row)?.text ?? '—',
            },
            {
              title: 'Marca / risco',
              width: 120,
              ellipsis: true,
              render: (_: unknown, row) => brandSafetyLabel(row),
            },
          ]}
        />
      </Card>
    </div>
  )
}
