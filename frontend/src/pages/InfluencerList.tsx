import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Row,
  Col,
  Spin,
  Typography,
  Empty,
  Input,
  Select,
  Button,
  Space,
} from 'antd'
import { SearchOutlined, FilterOutlined, ClearOutlined } from '@ant-design/icons'
import { fetchProfilesSearch, type ProfileListItem, type ProfilesSearchQuery, type ProfilesSort, type ProfilesSearchFacets } from '../api'
import ProfileSummaryCard from '../components/ProfileSummaryCard'
import { CONTENT_TYPE_LABELS } from '../constants/contentTypes'

const { Title, Text } = Typography

const SORT_OPTIONS: { value: ProfilesSort; label: string }[] = [
  { value: 'engagement_desc', label: 'Maior engajamento %' },
  { value: 'engagement_asc', label: 'Menor engajamento %' },
  { value: 'avg_likes_desc', label: 'Mais likes/post' },
  { value: 'avg_likes_asc', label: 'Menos likes/post' },
  { value: 'total_likes_desc', label: 'Mais likes total' },
  { value: 'total_likes_asc', label: 'Menos likes total' },
  { value: 'followers_desc', label: 'Mais seguidores' },
  { value: 'followers_asc', label: 'Menos seguidores' },
]

const PAGE_SIZE = 12

export default function InfluencerList() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const qFromUrl = searchParams.get('q') ?? ''

  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [data, setData] = useState<ProfileListItem[]>([])
  const [total, setTotal] = useState(0)
  const [facets, setFacets] = useState<ProfilesSearchFacets | null>(null)
  const [searchInput, setSearchInput] = useState(qFromUrl)
  const [query, setQuery] = useState<ProfilesSearchQuery>({
    q: qFromUrl || undefined,
    limit: PAGE_SIZE,
    offset: 0,
    sort: 'engagement_desc',
  })

  const load = (overrides?: Partial<ProfilesSearchQuery>) => {
    const q = { ...query, ...overrides, limit: overrides?.limit ?? PAGE_SIZE }
    const isLoadMore = (q.offset ?? 0) > 0
    if (isLoadMore) setLoadingMore(true)
    else setLoading(true)
    fetchProfilesSearch(q)
      .then((res) => {
        if (isLoadMore) {
          setData((prev) => [...prev, ...res.items])
        } else {
          setData(res.items)
        }
        setTotal(res.total)
        if (res.facets) setFacets(res.facets)
      })
      .catch(() => {
        if (!isLoadMore) {
          setData([])
          setTotal(0)
          setFacets(null)
        }
      })
      .finally(() => {
        setLoading(false)
        setLoadingMore(false)
      })
  }

  useEffect(() => {
    setSearchInput(qFromUrl)
    setQuery((prev) => ({ ...prev, q: qFromUrl || undefined, offset: 0 }))
    if (qFromUrl.trim()) {
      load({ q: qFromUrl.trim() || undefined, offset: 0 })
    } else {
      setData([])
      setTotal(0)
      setFacets(null)
    }
  }, [qFromUrl])

  const runSearch = () => {
    const q = searchInput.trim()
    setSearchParams(q ? { q } : {})
  }

  /** Categorias e engajamento vêm da sumarização da API (facets), não dos itens da página atual */
  const categoryFacets = facets?.categories ?? []
  const engagementFacets = facets
    ? {
      engagement_rate: facets.engagement_rate,
      avg_likes: facets.avg_likes,
      posts_count: facets.posts_count,
    }
    : { engagement_rate: [], avg_likes: [], posts_count: [] }

  const selectedCategories = (query.categories ?? []) as string[]
  const selectedEngagementRate = (query.engagementRateBuckets ?? []) as number[]
  const selectedAvgLikes = (query.avgLikesBuckets ?? []) as number[]
  const selectedPostsCount = (query.postsCountBuckets ?? []) as number[]
  const selectedActivation = (query.activationFilter ?? []) as string[]
  const selectedCities = (query.cities ?? []) as string[]
  const selectedStates = (query.states ?? []) as string[]
  const selectedNeighborhoods = (query.neighborhoods ?? []) as string[]
  const selectedSocial = (query.socialNetworks ?? []) as string[]
  const selectedContentTypes = (query.contentTypes ?? []) as string[]

  const updateFilter = (overrides: Partial<ProfilesSearchQuery>) => {
    const newQuery = { ...query, ...overrides, offset: 0 }
    setQuery(newQuery)
    load(newQuery)
  }

  const hasActiveFilters = selectedCategories.length > 0 || selectedEngagementRate.length > 0 || selectedAvgLikes.length > 0 || selectedPostsCount.length > 0 || selectedActivation.length > 0 || selectedCities.length > 0 || selectedStates.length > 0 || selectedNeighborhoods.length > 0 || selectedSocial.length > 0 || selectedContentTypes.length > 0

  const clearFilters = () => {
    updateFilter({
      categories: undefined,
      engagementRateBuckets: undefined,
      avgLikesBuckets: undefined,
      postsCountBuckets: undefined,
      activationFilter: undefined,
      cities: undefined,
      states: undefined,
      neighborhoods: undefined,
      socialNetworks: undefined,
      contentTypes: undefined,
    })
  }

  const hasSearchQuery = qFromUrl.trim().length > 0

  if (!hasSearchQuery) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 'calc(100vh - 120px)',
          padding: 24,
        }}
      >
        <Title level={1} style={{ marginBottom: 32, fontWeight: 300, color: 'rgba(0,0,0,.85)' }}>
          Buscar influenciadores
        </Title>
        <Space.Compact size="large" style={{ width: '100%', maxWidth: 584 }}>
          <Input
            placeholder="Nome, @handle, categoria..."
            allowClear
            prefix={<SearchOutlined style={{ color: 'var(--colorTextPlaceholder)' }} />}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onPressEnter={runSearch}
            style={{ borderRadius: '24px 0 0 24px', fontSize: 16 }}
            onFocus={(e) => e.target.select?.()}
          />
          <Button type="primary" onClick={runSearch} style={{ borderRadius: '0 24px 24px 0' }}>
            <SearchOutlined /> Buscar
          </Button>
        </Space.Compact>
        <Text type="secondary" style={{ marginTop: 16, fontSize: 13 }}>
          Digite e pressione Enter ou clique em Buscar
        </Text>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
      {(facets != null || total > 0 || selectedCategories.length > 0 || selectedEngagementRate.length > 0 || selectedAvgLikes.length > 0 || selectedPostsCount.length > 0 || selectedActivation.length > 0 || selectedCities.length > 0 || selectedStates.length > 0 || selectedNeighborhoods.length > 0 || selectedSocial.length > 0 || selectedContentTypes.length > 0) && (
        <aside
          style={{
            flexShrink: 0,
            width: 260,
            padding: 16,
            background: 'var(--aside-bg, #fafafa)',
            borderRadius: 8,
            border: '1px solid var(--aside-border, #f0f0f0)',
            position: 'sticky',
            top: 24,
            alignSelf: 'flex-start',
            maxHeight: 'calc(100vh - 48px)',
            overflowY: 'auto',
          }}
        >
          <Typography.Title level={5} style={{ marginBottom: 8, marginTop: 0 }}>
            <FilterOutlined /> {total === 0 ? 'Nenhum perfil encontrado' : `${total} perfil(is) encontrado(s)`}
          </Typography.Title>

          <div style={{ marginBottom: 16 }}>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
              {total === 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span>Tente outro termo ou remova filtros.</span>
                  {hasActiveFilters && (
                    <Button
                      type="default"
                      size="small"
                      icon={<ClearOutlined />}
                      onClick={clearFilters}
                      style={{ fontSize: 11, padding: '0 6px', color: '#d46b08', borderColor: '#d46b08', flexShrink: 0 }}
                    >
                      Limpar
                    </Button>
                  )}
                </div>
              )}
              {total > 0 && (
                <>
                  {hasActiveFilters && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span>Com filtros aplicados</span>
                      <Button
                        type="default"
                        size="small"
                        icon={<ClearOutlined />}
                        onClick={clearFilters}
                        style={{ fontSize: 11, padding: '0 6px', color: '#d46b08', borderColor: '#d46b08', flexShrink: 0 }}
                      >
                        Limpar
                      </Button>
                    </div>
                  )}
                  {!hasActiveFilters && 'Todos os resultados da busca'}
                </>
              )}
            </Text>
          </div>

          {facets != null && (
            <div style={{ marginBottom: 16 }}>
              <Text strong type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
                Ordenar
              </Text>
              <Select
                size="small"
                value={query.sort ?? 'engagement_desc'}
                options={SORT_OPTIONS}
                style={{ width: '100%' }}
                onChange={(value) => {
                  const newQuery = { ...query, sort: value as ProfilesSort, offset: 0 }
                  setQuery(newQuery)
                  load(newQuery)
                }}
              />
            </div>
          )}

          {/* 1. Hashtags (sumarização da API) – autocomplete multiselect, todas sem limite */}
          <Text strong type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
            Hashtags
          </Text>
          {categoryFacets.length > 0 ? (
            <Select
              mode="multiple"
              size="small"
              placeholder="Filtrar por hashtag..."
              allowClear
              showSearch
              optionFilterProp="label"
              value={selectedCategories}
              options={categoryFacets.map(({ name, count }) => ({
                value: name,
                label: `${name} (${count})`,
              }))}
              onChange={(values) => {
                const newQuery = { ...query, categories: values.length ? values : undefined, offset: 0 }
                setQuery(newQuery)
                load(newQuery)
              }}
              style={{ width: '100%', marginBottom: 16 }}
              maxTagCount="responsive"
            />
          ) : (
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 16 }}>
              Nenhuma hashtag nos resultados.
            </Text>
          )}

          {/* Tipo de conteúdo – só aparece quando a sumarização retorna tipos (dados dos perfis ativados) */}
          {facets?.content_type && facets.content_type.length > 0 && (
            <div style={{ marginTop: 0 }}>
              <Text strong type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
                Tipo de conteúdo
              </Text>
              <Select
                mode="multiple"
                size="small"
                placeholder="Filtrar por tipo..."
                allowClear
                showSearch
                optionFilterProp="label"
                value={selectedContentTypes}
                options={facets.content_type.map(({ name, count }) => ({
                  value: name,
                  label: `${CONTENT_TYPE_LABELS[name] ?? name} (${count})`,
                }))}
                onChange={(vals) => updateFilter({ contentTypes: vals.length ? vals : undefined })}
                style={{ width: '100%', marginBottom: 16 }}
                maxTagCount="responsive"
              />
            </div>
          )}

          {/* 2. Engajamento – autocomplete multiselect */}
          {facets && (
            <>
              <Text strong type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
                Taxa engajamento %
              </Text>
              <Select
                mode="multiple"
                size="small"
                placeholder="Filtrar por faixa..."
                allowClear
                showSearch
                optionFilterProp="label"
                value={selectedEngagementRate}
                options={engagementFacets.engagement_rate.map((b) => ({
                  value: b.min ?? 0,
                  label: `${b.label} (${b.count})`,
                }))}
                onChange={(vals) => updateFilter({ engagementRateBuckets: vals.length ? vals : undefined })}
                style={{ width: '100%', marginBottom: 12 }}
                maxTagCount="responsive"
              />
              <Text strong type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
                Média curtidas/post
              </Text>
              <Select
                mode="multiple"
                size="small"
                placeholder="Filtrar por faixa..."
                allowClear
                showSearch
                optionFilterProp="label"
                value={selectedAvgLikes}
                options={engagementFacets.avg_likes.map((b) => ({
                  value: b.min ?? 0,
                  label: `${b.label} (${b.count})`,
                }))}
                onChange={(vals) => updateFilter({ avgLikesBuckets: vals.length ? vals : undefined })}
                style={{ width: '100%', marginBottom: 12 }}
                maxTagCount="responsive"
              />
              <Text strong type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
                Posts analisados
              </Text>
              <Select
                mode="multiple"
                size="small"
                placeholder="Filtrar por faixa..."
                allowClear
                showSearch
                optionFilterProp="label"
                value={selectedPostsCount}
                options={engagementFacets.posts_count.map((b) => ({
                  value: b.min ?? 0,
                  label: `${b.label} (${b.count})`,
                }))}
                onChange={(vals) => updateFilter({ postsCountBuckets: vals.length ? vals : undefined })}
                style={{ width: '100%', marginBottom: 16 }}
                maxTagCount="responsive"
              />
            </>
          )}

          {facets?.activation && (facets.activation.activated > 0 || facets.activation.not_activated > 0) && (
            <div style={{ marginTop: 0 }}>
              <Text strong type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
                Cadastro na plataforma
              </Text>
              <Select
                mode="multiple"
                size="small"
                placeholder="Ativados / Não ativados..."
                allowClear
                showSearch={false}
                value={selectedActivation}
                options={[
                  { value: 'activated', label: `Ativados (${facets.activation.activated})` },
                  { value: 'not_activated', label: `Não ativados (${facets.activation.not_activated})` },
                ]}
                onChange={(vals) => updateFilter({ activationFilter: vals.length && vals.length < 2 ? vals : undefined })}
                style={{ width: '100%', marginBottom: 16 }}
                maxTagCount="responsive"
              />
            </div>
          )}

          {facets?.cities?.length > 0 && (
            <div style={{ marginTop: 0 }}>
              <Text strong type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
                Cidades
              </Text>
              <Select
                mode="multiple"
                size="small"
                placeholder="Filtrar por cidade..."
                allowClear
                showSearch
                optionFilterProp="label"
                value={selectedCities}
                options={facets.cities.map(({ name, count }) => ({ value: name, label: `${name} (${count})` }))}
                onChange={(vals) => updateFilter({ cities: vals.length ? vals : undefined })}
                style={{ width: '100%', marginBottom: 16 }}
                maxTagCount="responsive"
              />
            </div>
          )}
          {facets?.states?.length > 0 && (
            <div style={{ marginTop: 0 }}>
              <Text strong type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
                Estados
              </Text>
              <Select
                mode="multiple"
                size="small"
                placeholder="Filtrar por estado..."
                allowClear
                showSearch
                optionFilterProp="label"
                value={selectedStates}
                options={facets.states.map(({ name, count }) => ({ value: name, label: `${name} (${count})` }))}
                onChange={(vals) => updateFilter({ states: vals.length ? vals : undefined })}
                style={{ width: '100%', marginBottom: 16 }}
                maxTagCount="responsive"
              />
            </div>
          )}
          {facets?.neighborhoods?.length > 0 && (
            <div style={{ marginTop: 0 }}>
              <Text strong type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
                Bairros
              </Text>
              <Select
                mode="multiple"
                size="small"
                placeholder="Filtrar por bairro..."
                allowClear
                showSearch
                optionFilterProp="label"
                value={selectedNeighborhoods}
                options={facets.neighborhoods.map(({ name, count }) => ({ value: name, label: `${name} (${count})` }))}
                onChange={(vals) => updateFilter({ neighborhoods: vals.length ? vals : undefined })}
                style={{ width: '100%', marginBottom: 16 }}
                maxTagCount="responsive"
              />
            </div>
          )}
          {facets?.social && (facets.social.whatsapp > 0 || facets.social.tiktok > 0 || facets.social.facebook > 0 || facets.social.linkedin > 0 || facets.social.twitter > 0) && (
            <div style={{ marginTop: 0 }}>
              <Text strong type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
                Redes (ativados)
              </Text>
              <Select
                mode="multiple"
                size="small"
                placeholder="WhatsApp, TikTok..."
                allowClear
                showSearch={false}
                value={selectedSocial}
                options={[
                  facets.social.whatsapp > 0 && { value: 'whatsapp', label: `WhatsApp (${facets.social.whatsapp})` },
                  facets.social.tiktok > 0 && { value: 'tiktok', label: `TikTok (${facets.social.tiktok})` },
                  facets.social.facebook > 0 && { value: 'facebook', label: `Facebook (${facets.social.facebook})` },
                  facets.social.linkedin > 0 && { value: 'linkedin', label: `LinkedIn (${facets.social.linkedin})` },
                  facets.social.twitter > 0 && { value: 'twitter', label: `X/Twitter (${facets.social.twitter})` },
                ].filter(Boolean) as { value: string; label: string }[]}
                onChange={(vals) => updateFilter({ socialNetworks: vals.length ? vals : undefined })}
                style={{ width: '100%', marginBottom: 16 }}
                maxTagCount="responsive"
              />
            </div>
          )}

          {facets == null && !loading && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              Digite na busca e pressione Enter para ver a sumarização.
            </Text>
          )}
        </aside>
      )}

      <main style={{ flex: 1, minWidth: 0 }}>


        <div style={{ marginBottom: 24, width: '100%' }}>
          <Space.Compact size="large" style={{ width: '100%' }}>
            <Input
              placeholder="Buscar por nome, @handle, categoria..."
              allowClear
              prefix={<SearchOutlined style={{ color: 'var(--colorTextPlaceholder)' }} />}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onPressEnter={runSearch}
              style={{ borderRadius: '24px 0 0 24px' }}
            />
            <Button type="primary" onClick={runSearch} style={{ borderRadius: '0 24px 24px 0' }}>
              <SearchOutlined /> Buscar
            </Button>
          </Space.Compact>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 48 }}>
            <Spin size="large" />
          </div>
        ) : data.length === 0 ? (
          <Empty description="Nenhum influenciador encontrado. Ajuste os filtros ou execute o crawl." />
        ) : (
          <>
            <Row gutter={[16, 16]}>
              {data.map((item) => (
                <Col key={item.key} xs={24} sm={24} md={12} lg={12} xl={8} xxl={6} style={{ minWidth: 0 }}>
                  <ProfileSummaryCard
                    item={item}
                    variant="list"
                    onClick={() => navigate(`/influencer/${encodeURIComponent(item.handle ?? item.key)}`)}
                  />
                </Col>
              ))}
            </Row>
            {data.length < total && (
              <div style={{ textAlign: 'center', marginTop: 24 }}>
                <Button
                  type="primary"
                  onClick={() => load({ offset: data.length })}
                  loading={loadingMore}
                  size="large"
                >
                  Ver mais
                </Button>
              </div>
            )}
          </>
        )}
        {total > 0 && (
          <Typography.Text type="secondary" style={{ display: 'block', marginTop: 16 }}>
            Exibindo {data.length} de {total} perfil(is)
          </Typography.Text>
        )}
      </main>
    </div>
  )
}
