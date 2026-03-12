/**
 * Wizard de pré-filtragem gamificado: etapas visuais antes de ver os resultados.
 * Afunila o resultado: a cada escolha o usuário vê a quantidade de perfis que os filtros retornam.
 */
import { useState, useEffect, useRef } from 'react'
import { Button, Typography, Progress, Space, Spin, Input } from 'antd'
import {
  SearchOutlined,
  TagsOutlined,
  TeamOutlined,
  UserOutlined,
  BarChartOutlined,
  RocketOutlined,
} from '@ant-design/icons'
import { CONTENT_TYPE_LABELS } from '../../constants/contentTypes'
import type { ProfilesSearchQuery, ProfilesSearchFacets } from '../../api'

const { Text } = Typography

/** Retorno da estimativa: total e facets para mostrar contagem por opção. */
export interface EstimateResult {
  total: number
  facets: ProfilesSearchFacets | null
}

const STEPS = [
  { key: 'search', icon: SearchOutlined, title: 'O que você busca?', subtitle: 'Digite uma palavra e veja quantos influenciadores foram encontrados' },
  { key: 'hashtags', icon: TagsOutlined, title: 'Escolha as hashtags', subtitle: 'Selecione uma ou mais hashtags' },
  { key: 'porte', icon: TeamOutlined, title: 'Qual o porte?', subtitle: 'Seleção por quantidade de seguidores' },
  { key: 'accountType', icon: UserOutlined, title: 'Tipo de conta', subtitle: 'Pessoal, Criador ou Empresa' },
  { key: 'engagement', icon: BarChartOutlined, title: 'Nível de engajamento', subtitle: 'Baixo, médio ou alto' },
  { key: 'activation', icon: RocketOutlined, title: 'Quer só perfis segmentados?', subtitle: 'A segmentação é feita com base na localização, contato, preços e tipo de conteúdo' },
] as const

const PORTE_OPTIONS = [
  { label: 'Qualquer', min: undefined as number | undefined, max: undefined as number | undefined },
  { label: 'Nano (até 10k)', min: 0, max: 10_000 },
  { label: 'Micro (10k – 50k)', min: 10_000, max: 50_000 },
  { label: 'Médio (50k – 200k)', min: 50_000, max: 200_000 },
  { label: 'Macro (200k+)', min: 200_000, max: undefined },
]

/** Cor base para bubbles (selected). Escala: mesma cor + quantidade de branco (menor qtd = mais branco). */
const BUBBLE_BASE_COLOR = '#3b0764'

/** Chave usada em state.categories quando o usuário seleciona "No Perfil"; o backend inclui perfis que batem na busca mas não têm as hashtags listadas. */
export const NO_PERFIL_CATEGORY_KEY = 'no_perfil'

const ACCOUNT_TYPE_OPTIONS = [
  { value: undefined as number[] | undefined, label: 'Qualquer' },
  { value: [1], label: 'Pessoal' },
  { value: [2], label: 'Criador' },
  { value: [3], label: 'Empresa' },
]

const ENGAGEMENT_OPTIONS = [
  { label: 'Qualquer', value: [] as number[] },
  { label: 'Baixo', value: [0] },
  { label: 'Médio', value: [1] },
  { label: 'Alto', value: [5] },
]

export interface WizardState {
  /** Termo de busca quando a etapa de hashtags foi pulada (nenhuma encontrada). */
  q?: string
  categories?: string[]
  minFollowers?: number
  maxFollowers?: number
  engagementRateBuckets?: number[]
  excludePrivate?: boolean
  accountTypeFilter?: number[]
  /** 'activated' | 'not_activated' — quando ['activated'], só perfis ativados. */
  activationFilter?: string[]
}

/** Lista de categorias do step 1 (hashtags) filtrada pelo termo; usado para "todos selecionados" e init. */
function getStep1CategoryList(
  initialFacets: ProfilesSearchFacets | null | undefined,
  term: string
): { name: string; count: number }[] {
  if (!term || !initialFacets?.categories?.length) return []
  return (initialFacets.categories ?? [])
    .filter((c) => {
      const label = (CONTENT_TYPE_LABELS[c.name] ?? c.name).toLowerCase()
      return c.name.toLowerCase().includes(term) || label.includes(term)
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 36)
}

/** Converte estado do wizard em query para a API (igual ao onComplete). q é sempre o termo digitado (state.q); categories vazio quando "todos" selecionados. */
function stateToQuery(
  state: WizardState,
  step1AllNames?: string[]
): Partial<ProfilesSearchQuery> {
  const q = state.q ?? (state.categories?.length ? state.categories[0] : undefined)
  let categories: string[] | undefined
  if (step1AllNames && state.categories?.length === step1AllNames.length && step1AllNames.every((n) => state.categories!.includes(n))) {
    categories = undefined
  } else if (state.categories?.length && state.categories.length > 1) {
    categories = state.categories
  } else {
    categories = undefined
  }
  return {
    q,
    categories,
    minFollowers: state.minFollowers,
    maxFollowers: state.maxFollowers,
    engagementRateBuckets: state.engagementRateBuckets?.length ? state.engagementRateBuckets : undefined,
    excludePrivate: state.excludePrivate || undefined,
    accountTypeFilter: state.accountTypeFilter?.length ? state.accountTypeFilter : undefined,
    activationFilter: state.activationFilter?.length ? state.activationFilter : undefined,
  }
}

export interface SearchWizardProps {
  onComplete: (query: Partial<ProfilesSearchQuery>) => void
  /** Facets da busca sem filtros (para contagem no passo 1). Vem do banco. */
  initialFacets?: ProfilesSearchFacets | null
  /** Chamado quando os filtros mudam; retorna total e facets. Integrado ao banco. */
  onEstimate?: (query: Partial<ProfilesSearchQuery>) => Promise<EstimateResult>
  /** Termo de busca inicial (ex: da URL). */
  initialSearchTerm?: string
  /** Filtros iniciais da URL (evita sobrescrever ao montar quando URL já tem q, categories, etc.). */
  initialFilters?: Partial<WizardState>
  /** Callback quando o termo de busca muda no step 0 (para sincronizar com URL). */
  onSearchTermChange?: (q: string) => void
  /** Callback quando qualquer filtro é selecionado (para sincronizar com URL). */
  onFiltersChange?: (query: Partial<ProfilesSearchQuery>) => void
}

const ESTIMATE_DEBOUNCE_MS = 400

/** Tamanho do item proporcional à quantidade (min/max na lista). */
function countToSizeStyle(
  count: number,
  minCount: number,
  maxCount: number
): React.CSSProperties {
  if (maxCount <= minCount || count <= 0) return {}
  const t = (count - minCount) / (maxCount - minCount)
  const fontSize = 12 + t * 8
  const py = 4 + t * 8
  const px = 10 + t * 12
  return {
    fontSize,
    paddingTop: py,
    paddingBottom: py,
    paddingLeft: px,
    paddingRight: px,
  }
}

function stepFromFilters(f: Partial<WizardState>): number {
  if (f.activationFilter?.length) return 5
  if (f.engagementRateBuckets?.length) return 4
  if (f.accountTypeFilter?.length) return 3
  if (f.minFollowers != null || f.maxFollowers != null) return 2
  if (f.categories?.length) return 1
  return 0
}

function filtersToWizardState(f: Partial<WizardState> | undefined): WizardState {
  if (!f?.categories?.length && !f?.q) return {}
  return {
    q: f.q,
    categories: f.categories,
    minFollowers: f.minFollowers,
    maxFollowers: f.maxFollowers,
    engagementRateBuckets: f.engagementRateBuckets?.length ? f.engagementRateBuckets : undefined,
    excludePrivate: f.excludePrivate ?? undefined,
    accountTypeFilter: f.accountTypeFilter?.length ? f.accountTypeFilter : undefined,
    activationFilter: f.activationFilter?.length ? f.activationFilter : undefined,
  }
}

export default function SearchWizard({ onComplete, onEstimate, initialFacets, initialSearchTerm = '', initialFilters, onSearchTermChange, onFiltersChange }: SearchWizardProps) {
  const [step, setStep] = useState(() => stepFromFilters(filtersToWizardState(initialFilters)))
  const [state, setState] = useState<WizardState>(() => filtersToWizardState(initialFilters))
  const [hashtagSearchWord, setHashtagSearchWord] = useState(initialSearchTerm)
  const [estimateCount, setEstimateCount] = useState<number | null>(null)
  const [facets, setFacets] = useState<ProfilesSearchFacets | null>(null)
  const [estimateLoading, setEstimateLoading] = useState(false)
  const [optionCounts, setOptionCounts] = useState<Record<string, number>>({})
  const [optionCountsLoading, setOptionCountsLoading] = useState(false)
  const estimateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const estimateRequestIdRef = useRef(0)
  const optionCountsStepRef = useRef(0)
  const hasInitializedHashtagsRef = useRef(false)
  const searchTermSyncRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Total quando a busca é só por termo (q), sem categorias; usado no step 1 para o bubble "No Perfil". */
  const totalForQOnlyRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (searchTermSyncRef.current) clearTimeout(searchTermSyncRef.current)
    }
  }, [])

  /** Sincroniza seleções com a URL. q é o termo digitado; categories vazio quando "todos" selecionados no step 1. */
  useEffect(() => {
    if (!onFiltersChange) return
    const q = state.q ?? (hashtagSearchWord.trim().length >= 3 ? hashtagSearchWord.trim() : undefined) ?? (state.categories?.length ? state.categories[0] : undefined)
    if (!q) {
      onFiltersChange({})
      return
    }
    let step1AllNames: string[] | undefined
    if (step === 1 && initialFacets?.categories?.length) {
      const term = hashtagSearchWord.trim().toLowerCase()
      const list = getStep1CategoryList(initialFacets, term)
      const sumList = list.reduce((s, c) => s + c.count, 0)
      const restCount = Math.max(0, (totalForQOnlyRef.current ?? estimateCount ?? 0) - sumList)
      step1AllNames = [...list.map((c) => c.name), ...(restCount > 0 ? [NO_PERFIL_CATEGORY_KEY] : [])]
    }
    const { categories } = stateToQuery(state, step1AllNames)
    const query: Partial<ProfilesSearchQuery> = {
      q,
      categories,
      minFollowers: state.minFollowers,
      maxFollowers: state.maxFollowers,
      engagementRateBuckets: state.engagementRateBuckets?.length ? state.engagementRateBuckets : undefined,
      excludePrivate: state.excludePrivate || undefined,
      accountTypeFilter: state.accountTypeFilter?.length ? state.accountTypeFilter : undefined,
    }
    onFiltersChange(query)
  }, [state, hashtagSearchWord, onFiltersChange, step, initialFacets, estimateCount])

  const currentStep = STEPS[step]
  const progressPercent = ((step + 1) / STEPS.length) * 100

  const update = (patch: Partial<WizardState>) => {
    setState((prev) => ({ ...prev, ...patch }))
  }

  const toggleArray = (key: keyof WizardState, value: string | number) => {
    const arr = (state[key] as (string | number)[] | undefined) ?? []
    const next = arr.includes(value)
      ? arr.filter((x) => x !== value)
      : [...arr, value]
    update({ [key]: next.length ? next : undefined })
  }

  const syncUrl = (stateOverride?: WizardState) => {
    if (!onFiltersChange) return
    const s = stateOverride ?? state
    const q = s.q ?? (hashtagSearchWord.trim().length >= 3 ? hashtagSearchWord.trim() : undefined) ?? (s.categories?.length ? s.categories[0] : undefined)
    if (!q) {
      onFiltersChange({})
      return
    }
    let step1AllNames: string[] | undefined
    if (step === 1 && initialFacets?.categories?.length) {
      const term = hashtagSearchWord.trim().toLowerCase()
      const list = getStep1CategoryList(initialFacets, term)
      const sumList = list.reduce((s0, c) => s0 + c.count, 0)
      const restCount = Math.max(0, (totalForQOnlyRef.current ?? estimateCount ?? 0) - sumList)
      step1AllNames = [...list.map((c) => c.name), ...(restCount > 0 ? [NO_PERFIL_CATEGORY_KEY] : [])]
    }
    const { categories } = stateToQuery(s, step1AllNames)
    onFiltersChange({
      q,
      categories,
      minFollowers: s.minFollowers,
      maxFollowers: s.maxFollowers,
      engagementRateBuckets: s.engagementRateBuckets?.length ? s.engagementRateBuckets : undefined,
      excludePrivate: s.excludePrivate || undefined,
      accountTypeFilter: s.accountTypeFilter?.length ? s.accountTypeFilter : undefined,
      activationFilter: s.activationFilter?.length ? s.activationFilter : undefined,
    })
  }

  const nextStep = () => {
    syncUrl()
    if (step < STEPS.length - 1) {
      if (step === 0) {
        const term = hashtagSearchWord.trim().toLowerCase()
        const list = term && initialFacets?.categories
          ? initialFacets.categories.filter((c) => {
            const label = (CONTENT_TYPE_LABELS[c.name] ?? c.name).toLowerCase()
            return c.name.toLowerCase().includes(term) || label.includes(term)
          })
          : []
        const searchTerm = hashtagSearchWord.trim() || undefined
        if (list.length === 0) {
          update({ q: searchTerm })
          setStep(2)
          return
        }
        update({ q: searchTerm })
      }
      setStep((s) => s + 1)
    } else finish()
  }

  const prevStep = () => {
    // Se estiver no step 2 mas pulou o de hashtags (tem q sem categories), voltar para o step 0
    if (step === 2 && state.q && !state.categories?.length) {
      update({ q: undefined, minFollowers: undefined, maxFollowers: undefined })
      syncUrl({ ...state, q: undefined, minFollowers: undefined, maxFollowers: undefined })
      setStep(0)
      return
    }
    // Remove o filtro da etapa atual ao voltar
    const patch: Partial<WizardState> =
      step === 1 ? { categories: undefined }
        : step === 2 ? { minFollowers: undefined, maxFollowers: undefined }
          : step === 3 ? { accountTypeFilter: undefined }
            : step === 4 ? { engagementRateBuckets: undefined }
              : step === 5 ? { activationFilter: undefined }
                : {}
    const cleaned = { ...state, ...patch }
    update(patch)
    syncUrl(cleaned)
    setStep((s) => Math.max(0, s - 1))
  }

  const finish = () => {
    let step1AllNames: string[] | undefined
    if (step === 1 && initialFacets?.categories?.length) {
      const term = hashtagSearchWord.trim().toLowerCase()
      const list = getStep1CategoryList(initialFacets, term)
      const sumList = list.reduce((s0, c) => s0 + c.count, 0)
      const restCount = Math.max(0, (totalForQOnlyRef.current ?? estimateCount ?? 0) - sumList)
      step1AllNames = [...list.map((c) => c.name), ...(restCount > 0 ? [NO_PERFIL_CATEGORY_KEY] : [])]
    }
    const { q, categories } = stateToQuery(state, step1AllNames)
    onComplete({
      q,
      categories,
      minFollowers: state.minFollowers,
      maxFollowers: state.maxFollowers,
      engagementRateBuckets: state.engagementRateBuckets?.length ? state.engagementRateBuckets : undefined,
      excludePrivate: state.excludePrivate || undefined,
      accountTypeFilter: state.accountTypeFilter?.length ? state.accountTypeFilter : undefined,
      activationFilter: state.activationFilter?.length ? state.activationFilter : undefined,
    })
  }

  const canAdvance = () => {
    if (step === 0) return hashtagSearchWord.trim().length >= 3 && !estimateLoading && estimateCount !== null
    if (step === 1) return (state.categories === undefined || !!state.categories?.length) && !estimateLoading && estimateCount !== null
    return true
  }

  /** Contagem exibida no botão Próximo. Steps 2 e 3 usam optionCounts; 0, 1, 4 e 5 usam estimateCount. */
  const displayCount = (() => {
    if (step === 0 || step === 1 || step === 4 || step === 5) return estimateCount
    if (step === 2) {
      const idx = PORTE_OPTIONS.findIndex(
        (p) =>
          (state.minFollowers === p.min || (p.min == null && state.minFollowers == null)) &&
          (state.maxFollowers === p.max || (p.max == null && state.maxFollowers == null))
      )
      return idx >= 0 ? optionCounts[`porte:${idx}`] : null
    }
    if (step === 3) {
      const idx = ACCOUNT_TYPE_OPTIONS.findIndex(
        (opt) =>
          (opt.value == null && !state.accountTypeFilter?.length) ||
          (opt.value != null &&
            state.accountTypeFilter?.length === opt.value.length &&
            opt.value.every((v) => state.accountTypeFilter!.includes(v)))
      )
      return idx >= 0 ? optionCounts[`accountType:${idx}`] : null
    }
    return null
  })()

  // Afunilamento: busca o total de perfis. Steps 2 e 3 usam optionCounts; 0, 1, 4 e 5 usam estimateCount.
  const shouldRunMainEstimate = step === 0 || step === 1 || step === 4 || step === 5
  useEffect(() => {
    const term = hashtagSearchWord.trim()
    const hasData = (step === 0 && term.length >= 3) || (step >= 1 && (!!state.categories?.length || !!state.q))
    const shouldEstimate =
      onEstimate &&
      hasData &&
      shouldRunMainEstimate
    if (!shouldEstimate) {
      if (shouldRunMainEstimate && !hasData) setEstimateCount(null)
      return
    }
    if (estimateTimeoutRef.current) {
      clearTimeout(estimateTimeoutRef.current)
      estimateTimeoutRef.current = null
    }
    estimateTimeoutRef.current = setTimeout(() => {
      estimateTimeoutRef.current = null
      let step1AllNames: string[] | undefined
      if (step === 1 && initialFacets?.categories?.length && term) {
        const list = getStep1CategoryList(initialFacets, term)
        const sumList = list.reduce((s0, c) => s0 + c.count, 0)
        const restCount = Math.max(0, (totalForQOnlyRef.current ?? estimateCount ?? 0) - sumList)
        step1AllNames = [...list.map((c) => c.name), ...(restCount > 0 ? [NO_PERFIL_CATEGORY_KEY] : [])]
      }
      const query =
        step === 0 && term
          ? { q: term }
          : stateToQuery(state, step1AllNames)
      const isQOnlyRequest = (step === 0 && !!term) || (step >= 1 && (state.categories?.length === 0 || (step1AllNames && state.categories?.length === step1AllNames.length && step1AllNames.every((n) => state.categories!.includes(n)))))
      const id = ++estimateRequestIdRef.current
      setEstimateLoading(true)
      onEstimate(query)
        .then(({ total, facets: nextFacets }) => {
          if (id === estimateRequestIdRef.current) {
            setEstimateCount(total)
            setFacets(nextFacets)
            if (isQOnlyRequest) totalForQOnlyRef.current = total
          }
        })
        .catch(() => {
          if (id === estimateRequestIdRef.current) {
            setEstimateCount(0)
            setFacets(null)
          }
        })
        .finally(() => {
          if (id === estimateRequestIdRef.current) {
            setEstimateLoading(false)
          }
        })
    }, ESTIMATE_DEBOUNCE_MS)
    return () => {
      if (estimateTimeoutRef.current) {
        clearTimeout(estimateTimeoutRef.current)
      }
    }
  }, [state, onEstimate, step, hashtagSearchWord, shouldRunMainEstimate, initialFacets])

  // Contagens por opção: step 2 = porte; step 3 = tipo de conta (dentro da etapa combinada)
  useEffect(() => {
    const hasQuery = !!state.categories?.length || !!state.q
    if (!onEstimate || step < 2 || !hasQuery) {
      setOptionCounts({})
      return
    }
    const base = stateToQuery(state)
    const baseQ = { ...base, limit: 1, offset: 0, sort: 'relevance_desc' as const }
    const currentStep = step
    optionCountsStepRef.current = currentStep
    const fetchCounts = async () => {
      setOptionCountsLoading(true)
      const counts: Record<string, number> = {}
      try {
        if (step === 2) {
          await Promise.all(
            PORTE_OPTIONS.map(async (p, i) => {
              const res = await onEstimate({
                ...baseQ,
                minFollowers: p.min,
                maxFollowers: p.max,
              })
              counts[`porte:${i}`] = res.total
            })
          )
        } else if (step === 3) {
          await Promise.all(
            ACCOUNT_TYPE_OPTIONS.map(async (opt, i) => {
              const query = { ...baseQ } as Partial<ProfilesSearchQuery>
              if (opt.value != null && opt.value.length > 0) {
                query.accountTypeFilter = opt.value
              } else {
                delete query.accountTypeFilter
              }
              const res = await onEstimate(query)
              counts[`accountType:${i}`] = res.total
            })
          )
        }
        if (optionCountsStepRef.current === currentStep) {
          setOptionCounts(counts)
        }
      } catch {
        if (optionCountsStepRef.current === currentStep) {
          setOptionCounts({})
        }
      } finally {
        if (optionCountsStepRef.current === currentStep) {
          setOptionCountsLoading(false)
        }
      }
    }
    fetchCounts()
  }, [step, state, onEstimate])

  // Ao entrar no step 1 (hashtags): todos os itens + "No Perfil" (quando restCount > 0) vêm selecionados
  useEffect(() => {
    if (step !== 1) {
      hasInitializedHashtagsRef.current = false
      return
    }
    if (!initialFacets?.categories?.length) return
    const term = hashtagSearchWord.trim().toLowerCase()
    if (!term) return
    const list = getStep1CategoryList(initialFacets, term)
    if (!list.length || hasInitializedHashtagsRef.current) return
    const sumList = list.reduce((s, c) => s + c.count, 0)
    const totalForRest = totalForQOnlyRef.current ?? estimateCount ?? 0
    const restCount = Math.max(0, totalForRest - sumList)
    const allNames = [...list.map((c) => c.name), ...(restCount > 0 ? [NO_PERFIL_CATEGORY_KEY] : [])]
    update({ categories: allNames })
    hasInitializedHashtagsRef.current = true
  }, [step, initialFacets, hashtagSearchWord, estimateCount])

  return (
    <div
      className="search-wizard"
      style={{
        maxWidth: 680,
        margin: '0 auto',
        padding: '20px 24px 24px',
        height: '100%',
        minHeight: 'calc(100vh - 100px)',
        maxHeight: '100vh',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      {/* Cada etapa em tela separada */}
      <div style={{ textAlign: 'center', flex: 1, width: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', overflow: 'auto', position: 'relative' }} className="search-wizard-step">
        <div key={step} className="search-wizard-stage" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', flex: 1 }}>
          <Typography.Title level={2} style={{ marginBottom: 4, fontSize: 22, fontWeight: 600, flexShrink: 0 }}>
            {currentStep.title}
          </Typography.Title>
          <Text type="secondary" style={{ fontSize: 14, lineHeight: 1.4, flexShrink: 0 }}>
            {currentStep.subtitle}
          </Text>

          <div style={{ marginTop: 20, textAlign: 'center', width: '100%', maxWidth: 580 }}>
            {step === 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                <Input
                  placeholder="Buscar (ex: moda, fitness, viagem)"
                  value={hashtagSearchWord}
                  onChange={(e) => {
                    const v = e.target.value
                    setHashtagSearchWord(v)
                    if (onSearchTermChange) {
                      if (searchTermSyncRef.current) clearTimeout(searchTermSyncRef.current)
                      searchTermSyncRef.current = setTimeout(() => {
                        searchTermSyncRef.current = null
                        onSearchTermChange(v.trim())
                      }, 400)
                    }
                  }}
                  allowClear
                  size="middle"
                  style={{ maxWidth: 380, borderRadius: 12, fontSize: 16, height: 44 }}
                  prefix={<SearchOutlined style={{ color: 'var(--colorTextQuaternary)', fontSize: 20 }} />}
                />
                {hashtagSearchWord.trim().length < 3 && (
                  <Text type="secondary" style={{ fontSize: 14, lineHeight: 1.5 }}>
                    Digite pelo menos 3 caracteres para buscar e ver quantos influenciadores foram encontrados.
                  </Text>
                )}
              </div>
            )}

            {step === 1 && (
              <div className="hashtag-bubble-cloud">
                {!initialFacets ? (
                  <Space size="middle">
                    <Spin size="large" />
                    <Text type="secondary" style={{ fontSize: 17 }}>Carregando hashtags do banco...</Text>
                  </Space>
                ) : (() => {
                  const term = hashtagSearchWord.trim().toLowerCase()
                  const list = !term
                    ? []
                    : (initialFacets.categories ?? [])
                      .filter((c) => {
                        const label = (CONTENT_TYPE_LABELS[c.name] ?? c.name).toLowerCase()
                        return c.name.toLowerCase().includes(term) || label.includes(term)
                      })
                      .sort((a, b) => b.count - a.count)
                      .slice(0, 36)
                  const sumList = list.reduce((s, c) => s + c.count, 0)
                  const totalForRest = totalForQOnlyRef.current ?? estimateCount ?? 0
                  const restCount = Math.max(0, totalForRest - sumList)
                  const allNames = [...list.map((c) => c.name), ...(restCount > 0 ? [NO_PERFIL_CATEGORY_KEY] : [])]
                  const allSelected = !state.categories?.length || (state.categories.length === allNames.length && allNames.every((n) => state.categories!.includes(n)))
                  const counts = list.map((c) => c.count)
                  if (restCount > 0) counts.push(restCount)
                  const minC = counts.length ? Math.min(...counts) : 0
                  const maxC = counts.length ? Math.max(...counts) : 0
                  // Maior exatamente no centro; ordem espiralando do centro (maior → centro, menores → bordas)
                  const n = list.length
                  const reordered: typeof list =
                    n === 0
                      ? []
                      : (() => {
                        const center = Math.floor(n / 2)
                        const arr = new Array<typeof list[0]>(n)
                        arr[center] = list[0]
                        let L = center - 1
                        let R = center + 1
                        for (let i = 1; i < n; i++) {
                          if (i % 2 === 1) arr[L--] = list[i]
                          else arr[R++] = list[i]
                        }
                        return arr
                      })()
                  return (
                    <>
                      <div className="hashtag-bubble-cloud-inner">
                        {reordered.map((c, i) => {
                          if (!c) return null
                          const label = CONTENT_TYPE_LABELS[c.name] ?? c.name
                          const sizeStyle = countToSizeStyle(c.count, minC, maxC)
                          const isSelected = allSelected || !!state.categories?.includes(c.name)
                          const t = maxC > minC ? (c.count - minC) / (maxC - minC) : 1
                          const whiteMix = Math.round((1 - t) * 10)
                          return (
                            <button
                              key={c.name}
                              type="button"
                              className={`hashtag-bubble ${isSelected ? 'hashtag-bubble-selected' : ''}`}
                              onClick={() => {
                                if (allSelected) update({ categories: allNames.filter((n) => n !== c.name) })
                                else toggleArray('categories', c.name)
                              }}
                              style={{
                                ...sizeStyle,
                                '--bubble-delay': `${i * 30}ms`,
                                '--bubble-base': BUBBLE_BASE_COLOR,
                                '--bubble-white-mix': `${whiteMix}%`,
                              } as React.CSSProperties}
                            >
                              <span className="hashtag-bubble-label">{label}</span>
                              <span className="hashtag-bubble-count">
                                {c.count.toLocaleString('pt-BR')}
                              </span>
                            </button>
                          )
                        })}
                        {restCount > 0 && (
                          <button
                            key={NO_PERFIL_CATEGORY_KEY}
                            type="button"
                            className={`hashtag-bubble hashtag-bubble-outros ${allSelected || state.categories?.includes(NO_PERFIL_CATEGORY_KEY) ? 'hashtag-bubble-selected' : ''}`}
                            onClick={() => {
                              if (allSelected) update({ categories: allNames.filter((n) => n !== NO_PERFIL_CATEGORY_KEY) })
                              else toggleArray('categories', NO_PERFIL_CATEGORY_KEY)
                            }}
                            style={{
                              ...countToSizeStyle(restCount, minC, maxC),
                              '--bubble-delay': `${n * 30}ms`,
                              '--bubble-base': BUBBLE_BASE_COLOR,
                              '--bubble-white-mix': maxC > minC ? `${Math.round((1 - (restCount - minC) / (maxC - minC)) * 10)}%` : '0%',
                            } as React.CSSProperties}
                          >
                            <span className="hashtag-bubble-label">No Perfil</span>
                            <span className="hashtag-bubble-count">
                              {restCount.toLocaleString('pt-BR')}
                            </span>
                          </button>
                        )}
                      </div>
                      {term && list.length === 0 && (initialFacets.categories?.length ?? 0) === 0 && (
                        <Text type="secondary" style={{ fontSize: 17 }}>Nenhuma hashtag no banco.</Text>
                      )}
                      {term && list.length === 0 && (initialFacets.categories?.length ?? 0) > 0 && (
                        <Text type="secondary" style={{ fontSize: 17 }}>Nenhuma hashtag encontrada para &quot;{hashtagSearchWord.trim()}&quot;. Tente outra palavra.</Text>
                      )}
                    </>
                  )
                })()}
              </div>
            )}

            {step === 2 && (
              <div style={{ width: '100%', textAlign: 'center' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
                  {PORTE_OPTIONS.map((p, i) => {
                    const count = optionCounts[`porte:${i}`]
                    if (count === 0) return null
                    const active =
                      (state.minFollowers === p.min || (p.min == null && state.minFollowers == null)) &&
                      (state.maxFollowers === p.max || (p.max == null && state.maxFollowers == null))
                    return (
                      <Button
                        key={p.label}
                        type={active ? 'primary' : 'default'}
                        size="large"
                        onClick={() =>
                          update({
                            minFollowers: p.min,
                            maxFollowers: p.max,
                          })
                        }
                        style={{ borderRadius: 14, fontSize: 15 }}
                      >
                        {p.label}
                        {count != null ? (
                          <span style={{ marginLeft: 8, opacity: 0.9 }}>
                            ({count.toLocaleString('pt-BR')})
                          </span>
                        ) : optionCountsLoading ? (
                          <Spin size="small" style={{ marginLeft: 8 }} />
                        ) : null}
                      </Button>
                    )
                  })}
                </div>
              </div>
            )}

            {step === 3 && (
              <div style={{ width: '100%', textAlign: 'center' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
                  {ACCOUNT_TYPE_OPTIONS.map((opt, i) => {
                    const count = optionCounts[`accountType:${i}`]
                    if (count === 0) return null
                    const active =
                      (opt.value == null && !state.accountTypeFilter?.length) ||
                      (opt.value != null &&
                        state.accountTypeFilter?.length === opt.value.length &&
                        opt.value.every((v) => state.accountTypeFilter!.includes(v)))
                    return (
                      <Button
                        key={opt.label}
                        type={active ? 'primary' : 'default'}
                        size="large"
                        onClick={() => update({ accountTypeFilter: opt.value })}
                        style={{ borderRadius: 14, fontSize: 15 }}
                      >
                        {opt.label}
                        {count != null ? (
                          <span style={{ marginLeft: 8, opacity: 0.9 }}>
                            ({count.toLocaleString('pt-BR')})
                          </span>
                        ) : optionCountsLoading ? (
                          <Spin size="small" style={{ marginLeft: 8 }} />
                        ) : null}
                      </Button>
                    )
                  })}
                </div>
              </div>
            )}

            {step === 4 && (
              <div style={{ width: '100%', textAlign: 'center' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
                  {(() => {
                    const rateBuckets = facets?.engagement_rate
                    const counts = ENGAGEMENT_OPTIONS.map((_, idx) =>
                      idx === 0
                        ? (rateBuckets ? rateBuckets.reduce((s, b) => s + b.count, 0) : 0)
                        : (rateBuckets?.[idx - 1]?.count ?? 0)
                    )
                    return ENGAGEMENT_OPTIONS.map((opt, idx) => {
                      const count = counts[idx]
                      if (count === 0) return null
                      const active =
                        JSON.stringify(state.engagementRateBuckets ?? []) ===
                        JSON.stringify(opt.value)
                      return (
                        <Button
                          key={opt.label}
                          type={active ? 'primary' : 'default'}
                          size="large"
                          onClick={() => update({ engagementRateBuckets: opt.value })}
                          style={{ borderRadius: 14, fontSize: 15 }}
                        >
                          {opt.label}
                          {count != null ? (
                            <span style={{ marginLeft: 8, opacity: 0.9 }}>
                              ({count.toLocaleString('pt-BR')})
                            </span>
                          ) : estimateLoading ? (
                            <Spin size="small" style={{ marginLeft: 8 }} />
                          ) : null}
                        </Button>
                      )
                    })
                  })()}
                </div>
              </div>
            )}

            {step === 5 && (
              <div style={{ width: '100%', textAlign: 'center' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
                  {(() => {
                    const act = facets?.activation
                    const totalAct = act ? act.activated + act.not_activated : 0
                    const onlyActive = state.activationFilter?.includes('activated') ?? false
                    return (
                      <>
                        <Button
                          type={!onlyActive ? 'primary' : 'default'}
                          size="large"
                          onClick={() => update({ activationFilter: undefined })}
                          style={{ borderRadius: 14, fontSize: 15 }}
                        >
                          Todos os perfis
                          {totalAct > 0 ? (
                            <span style={{ marginLeft: 8, opacity: 0.9 }}>
                              ({totalAct.toLocaleString('pt-BR')})
                            </span>
                          ) : estimateLoading ? (
                            <Spin size="small" style={{ marginLeft: 8 }} />
                          ) : null}
                        </Button>
                        <Button
                          type={onlyActive ? 'primary' : 'default'}
                          size="large"
                          onClick={() => update({ activationFilter: ['activated'] })}
                          style={{ borderRadius: 14, fontSize: 15 }}
                        >
                          Apenas Segmentados
                          {act && act.activated >= 0 ? (
                            <span style={{ marginLeft: 8, opacity: 0.9 }}>
                              ({act.activated.toLocaleString('pt-BR')})
                            </span>
                          ) : estimateLoading ? (
                            <Spin size="small" style={{ marginLeft: 8 }} />
                          ) : null}
                        </Button>
                      </>
                    )
                  })()}
                </div>
              </div>
            )}
          </div>

          {/* Progress e botões junto ao conteúdo, no meio */}
          <div style={{ paddingTop: 20, width: '100%', maxWidth: 580, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, flexShrink: 0 }}>
            <div className="search-wizard-progress" style={{ width: '100%', maxWidth: 400 }}>
              <Progress
                percent={progressPercent}
                showInfo={false}
                strokeColor="rgba(0, 0, 0, 0.12)"
                trailColor="var(--colorFillTertiary)"
                strokeWidth={4}
                style={{ borderRadius: 2 }}
              />
              <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block', textAlign: 'center', opacity: 0.8 }}>
                {step + 1} / {STEPS.length}
              </Text>
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              {step > 0 && (
                <Button size="middle" onClick={prevStep} style={{ borderRadius: 10, minWidth: 100, height: 40, fontSize: 15 }}>
                  Voltar
                </Button>
              )}
              <Button
                type="primary"
                size="middle"
                onClick={nextStep}
                disabled={!canAdvance()}
                loading={!!(estimateLoading && shouldRunMainEstimate && ((step === 0 && hashtagSearchWord.trim().length >= 3) || (step >= 1 && (state.categories?.length || state.q))))}
                icon={step === STEPS.length - 1 ? <RocketOutlined /> : undefined}
                className="search-wizard-next-btn"
                style={{ borderRadius: 10, minWidth: 200, height: 40, fontSize: 15 }}
              >
                {displayCount != null && (
                  <span style={{ marginRight: 8, opacity: 0.95 }}>
                    ({displayCount.toLocaleString('pt-BR')} perfil{displayCount !== 1 ? 's' : ''})
                  </span>
                )}
                {step === STEPS.length - 1 ? 'Ver resultados' : 'Próximo'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
