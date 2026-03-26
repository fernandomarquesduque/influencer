/**
 * Wizard de pré-filtragem gamificado: etapas visuais antes de ver os resultados.
 * Afunila o resultado: a cada escolha o usuário vê a quantidade de perfis que os filtros retornam.
 */
import { useState, useEffect, useRef } from 'react'
import { Button, Typography, Progress, Space, Spin, Input, Alert, Modal } from 'antd'
import {
  SearchOutlined,
  TagsOutlined,
  TeamOutlined,
  UserOutlined,
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
  { key: 'hashtags', icon: TagsOutlined, title: 'Escolha as hashtags', subtitle: 'Caso queira, especificar uma ou mais hashtags (Opcional)' },
  { key: 'porte', icon: TeamOutlined, title: 'Qual o porte?', subtitle: 'Escolha uma ou mais faixas de seguidores (obrigatório)' },
  { key: 'accountType', icon: UserOutlined, title: 'Tipo de conta', subtitle: 'Pessoal, Criador ou Empresa' },
  { key: 'activation', icon: RocketOutlined, title: 'Quer só perfis segmentados?', subtitle: 'A segmentação é feita com base na localização, contato, preços e tipo de conteúdo' },
] as const

/** Chaves alinhadas a `followers_buckets` e ao filtro `sizeFilter` da API (OR entre selecionados). */
const PORTE_OPTIONS = [
  { key: 'nano', label: 'Nano (até 10k)', min: 0, max: 10_000 },
  { key: 'micro', label: 'Micro (10k – 50k)', min: 10_000, max: 50_000 },
  { key: 'medio', label: 'Médio (50k – 200k)', min: 50_000, max: 200_000 },
  { key: 'macro', label: 'Macro (200k+)', min: 200_000, max: undefined as number | undefined },
] as const

/** Pré-seleção ao entrar na etapa de porte (quando ainda não há `sizeFilter`). */
const DEFAULT_PORTE_SIZES: string[] = ['micro', 'medio']

/**
 * Alinha `sizeFilter` aos buckets com count > 0 (igual aos chips renderizados).
 * Retorna `changed` se a lista mudou; `next` undefined quando nada sobra.
 */
function prunePorteSizeFilter(
  sizeFilter: string[] | undefined,
  facetsData: ProfilesSearchFacets | null | undefined
): { next: string[] | undefined; changed: boolean } {
  if (!sizeFilter?.length) return { next: sizeFilter, changed: false }
  const buckets = facetsData?.followers_buckets
  if (!buckets?.length) return { next: sizeFilter, changed: false }
  const countByKey = new Map(buckets.map((b) => [b.key, b.count ?? 0]))
  const valid = sizeFilter.filter((k) => (countByKey.get(k) ?? 0) > 0)
  if (valid.length === sizeFilter.length) return { next: sizeFilter, changed: false }
  return { next: valid.length ? valid : undefined, changed: true }
}

/** Só há duas opções na etapa de segmentação se existir pelo menos 1 perfil segmentado. */
function activationStepHasTwoChoices(f: ProfilesSearchFacets | null | undefined): boolean {
  const act = f?.activation
  return act != null && act.activated > 0
}

function showPorteRequiredModal() {
  Modal.warning({
    title: 'Antes do próximo passo… ✨',
    content:
      'Cada creator tem um tamanho de comunidade diferente — e a gente quer acertar em cheio na sua busca. ' +
      'Marca pelo menos uma faixa (nano ao macro) pra liberar a jornada: é obrigatório, leva um clique e deixa tudo mais alinhado com a sua campanha.',
    okText: 'Beleza, vou escolher',
    centered: true,
  })
}

/** Cor base para bubbles (selected). Escala: mesma cor + quantidade de branco (menor qtd = mais branco). */
const BUBBLE_BASE_COLOR = '#3b0764'

/** Enviado na query junto com hashtags (seleção parcial); não aparece mais como bubble — o estado guarda só nomes reais de hashtag. */
export const NO_PERFIL_CATEGORY_KEY = 'no_perfil'

/** Menos que isso de hashtags distintas (facet filtrado pelo termo) → etapa de hashtags é pulada. */
const MIN_HASHTAGS_TO_SHOW_STEP = 10

/** Máximo de hashtags a exibir no cloud conforme viewport para evitar scroll vertical. */
function maxHashtagsByViewport(width: number, height: number): number {
  const reserved = 400
  const cloudHeight = Math.max(0, height - reserved)
  const rowHeight = 46
  const rows = Math.floor(cloudHeight / rowHeight)
  const colWidth = 95
  const cols = Math.max(1, Math.floor(width / colWidth))
  return Math.min(36, Math.max(6, rows * cols))
}

const ACCOUNT_TYPE_OPTIONS = [
  { value: undefined as number[] | undefined, label: 'Qualquer' },
  { value: [1], label: 'Pessoal' },
  { value: [2], label: 'Criador' },
  { value: [3], label: 'Empresa' },
]

export interface WizardState {
  /** Termo de busca quando a etapa de hashtags foi pulada (nenhuma encontrada). */
  q?: string
  categories?: string[]
  /** Porte(s): nano | micro | medio | macro — multiselect; obrigatório na etapa de porte. */
  sizeFilter?: string[]
  /** Legado (URL antiga); convertido para `sizeFilter` ao hidratar. */
  minFollowers?: number
  maxFollowers?: number
  excludePrivate?: boolean
  accountTypeFilter?: number[]
  /** 'activated' | 'not_activated' — quando ['activated'], só perfis ativados. */
  activationFilter?: string[]
}

/** Lista de categorias do step 1 (hashtags) filtrada pelo termo; usado para "todos selecionados" e init. max exibe no cloud (por viewport). */
function getStep1CategoryList(
  initialFacets: ProfilesSearchFacets | null | undefined,
  term: string,
  max: number = 36
): { name: string; count: number }[] {
  if (!term || !initialFacets?.categories?.length) return []
  return (initialFacets.categories ?? [])
    .filter((c) => {
      const label = (CONTENT_TYPE_LABELS[c.name] ?? c.name).toLowerCase()
      return c.name.toLowerCase().includes(term) || label.includes(term)
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, max)
}

/** Nomes de hashtag do passo 1 (facet), sem `no_perfil`. */
function getStep1HashtagNames(
  facetsForStep1: ProfilesSearchFacets | null | undefined,
  termLower: string,
  max: number
): string[] | undefined {
  if (!facetsForStep1?.categories?.length || !termLower.trim()) return undefined
  const list = getStep1CategoryList(facetsForStep1, termLower.trim(), max)
  return list.map((c) => c.name)
}

/** Converte estado do wizard em query para a API. Seleção parcial de hashtags → inclui `no_perfil`; todas ou nenhuma → sem filtro de categoria. */
function stateToQuery(
  state: WizardState,
  step1HashtagNames: string[] | undefined
): Partial<ProfilesSearchQuery> {
  const q = state.q ?? (state.categories?.length ? state.categories[0] : undefined)
  const raw = (state.categories ?? []).filter((c) => c !== NO_PERFIL_CATEGORY_KEY)
  let categories: string[] | undefined

  if (step1HashtagNames != null) {
    if (step1HashtagNames.length === 0) {
      categories = undefined
    } else {
      const selected = raw.filter((c) => step1HashtagNames.includes(c))
      const allSelected =
        selected.length === step1HashtagNames.length &&
        step1HashtagNames.every((n) => selected.includes(n))
      if (allSelected || selected.length === 0) {
        categories = undefined
      } else {
        categories = [...selected, NO_PERFIL_CATEGORY_KEY]
      }
    }
  } else if (raw.length > 1) {
    categories = raw
  } else {
    categories = undefined
  }
  const useSize = (state.sizeFilter?.length ?? 0) > 0
  return {
    q,
    categories,
    sizeFilter: useSize ? state.sizeFilter : undefined,
    minFollowers: useSize ? undefined : state.minFollowers,
    maxFollowers: useSize ? undefined : state.maxFollowers,
    excludePrivate: state.excludePrivate || undefined,
    accountTypeFilter: state.accountTypeFilter?.length ? state.accountTypeFilter : undefined,
    activationFilter: state.activationFilter?.length ? state.activationFilter : undefined,
  }
}

export interface SearchWizardProps {
  onComplete: (query: Partial<ProfilesSearchQuery>) => void
  /** Facets da busca sem filtros (para contagem no passo 1). Vem do banco. */
  initialFacets?: ProfilesSearchFacets | null
  /** Chamado quando os filtros mudam; retorna total e facets. signal para abortar ao avançar. */
  onEstimate?: (query: Partial<ProfilesSearchQuery>, options?: { signal?: AbortSignal }) => Promise<EstimateResult>
  /** Termo de busca inicial (ex: da URL). */
  initialSearchTerm?: string
  /** Filtros iniciais da URL (evita sobrescrever ao montar quando URL já tem q, categories, etc.). */
  initialFilters?: Partial<WizardState>
  /** Callback quando o termo de busca muda no step 0 (para sincronizar com URL). */
  onSearchTermChange?: (q: string) => void
  /** Callback quando qualquer filtro é selecionado (para sincronizar com URL). */
  onFiltersChange?: (query: Partial<ProfilesSearchQuery>) => void
}

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

function boundsToSizeKey(min?: number, max?: number): string | undefined {
  if (min === 0 && max === 10_000) return 'nano'
  if (min === 10_000 && max === 50_000) return 'micro'
  if (min === 50_000 && max === 200_000) return 'medio'
  if (min === 200_000 && max === undefined) return 'macro'
  return undefined
}

function stepFromFilters(f: Partial<WizardState>): number {
  if (f.activationFilter?.length) return 4
  if (f.accountTypeFilter?.length) return 3
  if ((f.sizeFilter?.length ?? 0) > 0 || f.minFollowers != null || f.maxFollowers != null) return 2
  if (f.categories?.length) return 1
  return 0
}

/** Filtro associado a cada índice de etapa do wizard (0 = termo, sem patch de filtro aqui). */
function filterPatchForWizardStep(stepIndex: number): Partial<WizardState> {
  switch (stepIndex) {
    case 1:
      return { categories: undefined }
    case 2:
      return { sizeFilter: undefined, minFollowers: undefined, maxFollowers: undefined }
    case 3:
      return { accountTypeFilter: undefined }
    case 4:
      return { activationFilter: undefined }
    default:
      return {}
  }
}

/** Ao voltar: remove o filtro da etapa atual e o da etapa de destino (evita ficar só uma opção por causa do funil). */
function filterPatchesForPrevStep(currentStep: number): Partial<WizardState> {
  return {
    ...filterPatchForWizardStep(currentStep),
    ...filterPatchForWizardStep(currentStep - 1),
  }
}

function filtersToWizardState(f: Partial<WizardState> | undefined): WizardState {
  if (!f?.categories?.length && !f?.q) return {}
  let sizeFilter = f.sizeFilter?.length ? [...f.sizeFilter] : undefined
  if (!sizeFilter?.length && (f.minFollowers != null || f.maxFollowers != null)) {
    const k = boundsToSizeKey(f.minFollowers, f.maxFollowers)
    if (k) sizeFilter = [k]
  }
  return {
    q: f.q,
    categories: undefined,
    sizeFilter,
    minFollowers: sizeFilter?.length ? undefined : f.minFollowers,
    maxFollowers: sizeFilter?.length ? undefined : f.maxFollowers,
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
  const [nextStepLoading, setNextStepLoading] = useState(false)
  const [step0Error, setStep0Error] = useState<string | null>(null)
  const hasInitializedHashtagsRef = useRef(false)
  const searchTermSyncRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Total da estimativa só com q (etapa 0), reutilizado nas próximas etapas. */
  const totalForQOnlyRef = useRef<number | null>(null)
  /** true se avançamos 0 → 2 sem passar por hashtags (zero matches ou poucas opções). */
  const skippedHashtagStepRef = useRef(false)
  /** Evita disparar duas vezes o auto-avanço do porte quando a URL pede buckets inexistentes. */
  const porteAutoSkipRef = useRef(false)
  /** Impede o efeito de DEFAULT_PORTE_SIZES de recolocar micro/médio após limpar o filtro para auto-avançar. */
  const porteAutoSkipInProgressRef = useRef(false)

  const [viewport, setViewport] = useState(() =>
    typeof window !== 'undefined'
      ? { w: window.innerWidth, h: window.innerHeight }
      : { w: 680, h: 800 }
  )
  const maxHashtags = Math.min(36, maxHashtagsByViewport(viewport.w, viewport.h))

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

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
    const facetsForStep1 = facets ?? initialFacets
    const termLower = hashtagSearchWord.trim().toLowerCase() || (state.q ?? '').toLowerCase()
    const step1HashtagNames = getStep1HashtagNames(facetsForStep1, termLower, maxHashtags)
    const sq = stateToQuery(state, step1HashtagNames)
    const query: Partial<ProfilesSearchQuery> = {
      q,
      categories: sq.categories,
      sizeFilter: sq.sizeFilter,
      minFollowers: sq.minFollowers,
      maxFollowers: sq.maxFollowers,
      excludePrivate: state.excludePrivate || undefined,
      accountTypeFilter: state.accountTypeFilter?.length ? state.accountTypeFilter : undefined,
      activationFilter: state.activationFilter?.length ? state.activationFilter : undefined,
    }
    onFiltersChange(query)
  }, [state, hashtagSearchWord, onFiltersChange, step, facets, initialFacets, maxHashtags])

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
    const facetsForStep1 = facets ?? initialFacets
    const termLower = hashtagSearchWord.trim().toLowerCase() || (s.q ?? '').toLowerCase()
    const step1HashtagNames = getStep1HashtagNames(facetsForStep1, termLower, maxHashtags)
    const sq = stateToQuery(s, step1HashtagNames)
    onFiltersChange({
      q,
      categories: sq.categories,
      sizeFilter: sq.sizeFilter,
      minFollowers: sq.minFollowers,
      maxFollowers: sq.maxFollowers,
      excludePrivate: s.excludePrivate || undefined,
      accountTypeFilter: s.accountTypeFilter?.length ? s.accountTypeFilter : undefined,
      activationFilter: s.activationFilter?.length ? s.activationFilter : undefined,
    })
  }

  const nextStep = async () => {
    if (step === 0) {
      const term = hashtagSearchWord.trim()
      if (term.length < 3 || !onEstimate) return
      setStep0Error(null)
      setEstimateLoading(true)
      try {
        const { total, facets: nextFacets } = await onEstimate({ q: term })
        setEstimateCount(total)
        setFacets(nextFacets ?? null)
        totalForQOnlyRef.current = total
        if (total === 0) {
          setStep0Error('Nenhum perfil encontrado para este termo. Tente outra palavra.')
          return
        }
        update({ q: term })
        syncUrl()
        const cats = nextFacets?.categories ?? []
        const list = term && cats.length > 0
          ? cats.filter((c) => {
            const label = (CONTENT_TYPE_LABELS[c.name] ?? c.name).toLowerCase()
            return c.name.toLowerCase().includes(term.toLowerCase()) || label.includes(term.toLowerCase())
          })
          : []
        if (list.length === 0 || list.length < MIN_HASHTAGS_TO_SHOW_STEP) {
          skippedHashtagStepRef.current = true
          setStep(2)
          return
        }
        skippedHashtagStepRef.current = false
        setStep(1)
      } catch {
        setStep0Error('Erro ao buscar. Tente novamente.')
      } finally {
        setEstimateLoading(false)
      }
      return
    }
    if (step === 2 && !(state.sizeFilter?.length ?? 0)) {
      showPorteRequiredModal()
      return
    }
    syncUrl()
    if (step < STEPS.length - 1) {
      if (onEstimate) {
        setNextStepLoading(true)
        try {
          const facetsForStep1 = facets ?? initialFacets
          const termLower = hashtagSearchWord.trim().toLowerCase() || (state.q ?? '').toLowerCase()
          const step1HashtagNames = getStep1HashtagNames(facetsForStep1, termLower, maxHashtags)
          const query = stateToQuery(state, step1HashtagNames)
          const { total, facets: nextFacets } = await onEstimate(query)
          setEstimateCount(total)
          setFacets(nextFacets ?? null)
          if (step === 3 && !activationStepHasTwoChoices(nextFacets)) {
            finish(nextFacets ?? null)
            return
          }
          setStep((s) => s + 1)
        } catch {
          // mantém na mesma etapa em erro
        } finally {
          setNextStepLoading(false)
        }
      } else {
        const f = facets ?? initialFacets
        if (step === 3 && !activationStepHasTwoChoices(f)) {
          finish(f)
        } else {
          setStep((s) => s + 1)
        }
      }
    } else finish()
  }

  const prevStep = async () => {
    if (step === 2 && skippedHashtagStepRef.current) {
      skippedHashtagStepRef.current = false
      const patch: Partial<WizardState> = {
        ...filterPatchForWizardStep(2),
        ...filterPatchForWizardStep(1),
      }
      const cleaned = { ...state, ...patch }
      update(patch)
      setStep(0)
      syncUrl(cleaned)
      const qTerm = (cleaned.q ?? hashtagSearchWord.trim()).trim()
      if (onEstimate && qTerm.length >= 3) {
        setNextStepLoading(true)
        try {
          const { total, facets: nextFacets } = await onEstimate({ q: qTerm })
          setEstimateCount(total)
          setFacets(nextFacets ?? null)
        } catch {
          /* mantém facets */
        } finally {
          setNextStepLoading(false)
        }
      }
      return
    }
    // Remove filtro da etapa atual + da etapa para onde volta; refaz estimativa (facets / totais)
    const patch: Partial<WizardState> = step > 0 ? filterPatchesForPrevStep(step) : {}
    const cleaned = { ...state, ...patch }
    update(patch)
    setStep((s) => Math.max(0, s - 1))
    syncUrl(cleaned)

    if (onEstimate) {
      setNextStepLoading(true)
      try {
        const facetsForStep1 = facets ?? initialFacets
        const termLower = hashtagSearchWord.trim().toLowerCase() || (cleaned.q ?? '').toLowerCase()
        const step1HashtagNames = getStep1HashtagNames(facetsForStep1, termLower, maxHashtags)
        const query = stateToQuery(cleaned, step1HashtagNames)
        const { total, facets: nextFacets } = await onEstimate(query)
        setEstimateCount(total)
        setFacets(nextFacets ?? null)
      } catch {
        /* mantém facets anteriores em erro */
      } finally {
        setNextStepLoading(false)
      }
    }
  }

  const finish = (facetsOverride?: ProfilesSearchFacets | null) => {
    const facetsForStep1 = facetsOverride ?? facets ?? initialFacets
    const termLower = hashtagSearchWord.trim().toLowerCase() || (state.q ?? '').toLowerCase()
    const step1HashtagNames = getStep1HashtagNames(facetsForStep1, termLower, maxHashtags)
    const { q, ...rest } = stateToQuery(state, step1HashtagNames)
    onComplete({
      q,
      ...rest,
      excludePrivate: state.excludePrivate || undefined,
      accountTypeFilter: state.accountTypeFilter?.length ? state.accountTypeFilter : undefined,
      activationFilter: state.activationFilter?.length ? state.activationFilter : undefined,
    })
  }

  // Uma única busca (etapa 0) alimenta todo o funil; steps 1–5 usam facets/total dessa resposta.

  useEffect(() => {
    if (step !== 1) {
      hasInitializedHashtagsRef.current = false
      return
    }
  }, [step])

  useEffect(() => {
    if (step !== 2) return
    if (porteAutoSkipInProgressRef.current) return
    setState((prev) => {
      if (prev.sizeFilter?.length) return prev
      return { ...prev, sizeFilter: [...DEFAULT_PORTE_SIZES], minFollowers: undefined, maxFollowers: undefined }
    })
  }, [step])

  /** URL ou padrão pode pedir micro/médio etc. sem haver perfis nesses buckets — remove da busca e avança. */
  useEffect(() => {
    if (step !== 2) {
      porteAutoSkipRef.current = false
      porteAutoSkipInProgressRef.current = false
      return
    }
    const f = facets ?? initialFacets
    const { next, changed } = prunePorteSizeFilter(state.sizeFilter, f)
    if (!changed) return

    if (next?.length) {
      setState((prev) => ({ ...prev, sizeFilter: next, minFollowers: undefined, maxFollowers: undefined }))
      return
    }

    if (porteAutoSkipRef.current) return
    porteAutoSkipRef.current = true
    porteAutoSkipInProgressRef.current = true

    const cleaned: WizardState = {
      ...state,
      sizeFilter: undefined,
      minFollowers: undefined,
      maxFollowers: undefined,
    }
    setState((prev) => ({
      ...prev,
      sizeFilter: undefined,
      minFollowers: undefined,
      maxFollowers: undefined,
    }))

      ; (async () => {
        if (!onEstimate) {
          setStep(3)
          return
        }
        setNextStepLoading(true)
        try {
          const facetsForStep1 = facets ?? initialFacets
          const termLower = hashtagSearchWord.trim().toLowerCase() || (cleaned.q ?? '').toLowerCase()
          const step1HashtagNames = getStep1HashtagNames(facetsForStep1, termLower, maxHashtags)
          const query = stateToQuery(cleaned, step1HashtagNames)
          const { total, facets: nextFacets } = await onEstimate(query)
          setEstimateCount(total)
          setFacets(nextFacets ?? null)
          setStep(3)
        } catch {
          porteAutoSkipRef.current = false
          porteAutoSkipInProgressRef.current = false
        } finally {
          setNextStepLoading(false)
        }
      })()
  }, [step, facets, initialFacets, state, hashtagSearchWord, onEstimate, maxHashtags])

  const isLoadingOptions = estimateLoading || nextStepLoading || (step >= 1 && !(facets ?? initialFacets))
  const showFullScreenLoader = estimateLoading || (step >= 1 && !(facets ?? initialFacets))

  const canAdvance = () => {
    if (isLoadingOptions) return false
    if (step === 0) return hashtagSearchWord.trim().length >= 3
    return true
  }

  return (
    <div
      className="search-wizard"
      style={{
        maxWidth: 680,
        margin: '0 auto',
        overflow: 'visible',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        position: 'relative',
      }}
    >
      {showFullScreenLoader && (
        <div
          className="search-wizard-loader-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'linear-gradient(135deg, rgba(104, 39, 143, 0.06) 0%, rgba(255, 255, 255, 0.98) 50%, rgba(232, 186, 0, 0.05) 100%)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 24,
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              border: '4px solid rgba(104, 39, 143, 0.15)',
              borderTopColor: 'var(--app-primary)',
              borderRadius: '50%',
              animation: 'searchWizardLoaderSpin 0.9s linear infinite',
            }}
          />
          <div style={{ textAlign: 'center', maxWidth: 320 }}>
            <Typography.Title level={3} style={{ margin: 0, fontSize: 20, fontWeight: 600, color: 'var(--app-text)' }}>
              Buscando os melhores influenciadores para você
            </Typography.Title>
            <Text type="secondary" style={{ fontSize: 15, marginTop: 8, display: 'block' }}>
              Em instantes você verá perfis incríveis que combinam com sua busca
            </Text>
          </div>
        </div>
      )}
      {/* Cada etapa em tela separada */}
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', overflow: 'visible', position: 'relative', alignItems: 'center' }} className="search-wizard-step">
        <div key={step} className="search-wizard-stage" style={{ display: 'flex', flexDirection: 'column', width: '100%', alignItems: 'center', textAlign: 'center' }}>
          <Typography.Title level={2} style={{ marginBottom: 4, fontSize: 22, fontWeight: 600, flexShrink: 0 }}>
            {currentStep.title}
          </Typography.Title>
          <Text type="secondary" style={{ fontSize: 14, lineHeight: 1.4, flexShrink: 0 }}>
            {currentStep.subtitle}
          </Text>

          <div style={{ marginTop: 20, width: '100%', maxWidth: 580, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            {step === 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, width: '100%' }}>
                <Input
                  placeholder="Buscar (ex: moda, fitness, viagem)"
                  value={hashtagSearchWord}
                  onChange={(e) => {
                    const v = e.target.value
                    setHashtagSearchWord(v)
                    setStep0Error(null)
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
                {step0Error && (
                  <Alert type="error" message={step0Error} showIcon style={{ maxWidth: 380, width: '100%' }} />
                )}
                {hashtagSearchWord.trim().length < 3 && !step0Error && (
                  <Text type="secondary" style={{ fontSize: 14, lineHeight: 1.5, textAlign: 'center' }}>
                    Digite pelo menos 3 caracteres e clique em Buscar.
                  </Text>
                )}
              </div>
            )}

            {step === 1 && (
              <div className="hashtag-bubble-cloud">
                {!(facets ?? initialFacets) ? (
                  <Space size="middle">
                    <Spin size="large" />
                    <Text type="secondary" style={{ fontSize: 17 }}>Carregando hashtags...</Text>
                  </Space>
                ) : (() => {
                  const facetsForStep1 = facets ?? initialFacets
                  const term = hashtagSearchWord.trim().toLowerCase()
                  const list = !term
                    ? []
                    : getStep1CategoryList(facetsForStep1!, term, maxHashtags)
                  const allNames = list.map((c) => c.name)
                  const allSelected = !!state.categories?.length && state.categories.length === allNames.length && allNames.every((n) => state.categories!.includes(n))
                  const counts = list.map((c) => c.count)
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
                          const isSelected = !!state.categories?.includes(c.name)
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
                      </div>
                      {term && list.length === 0 && (facetsForStep1!.categories?.length ?? 0) === 0 && (
                        <Text type="secondary" style={{ fontSize: 17 }}>Nenhuma hashtag no banco.</Text>
                      )}
                      {term && list.length === 0 && (facetsForStep1!.categories?.length ?? 0) > 0 && (
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
                  {PORTE_OPTIONS.map((p) => {
                    const f = facets ?? initialFacets
                    const bucket = f?.followers_buckets?.find((b) => b.key === p.key)
                    const count = bucket?.count ?? 0
                    if (count === 0) return null
                    const active = state.sizeFilter?.includes(p.key) ?? false
                    return (
                      <Button
                        key={p.key}
                        type={active ? 'primary' : 'default'}
                        size="large"
                        onClick={() => {
                          const cur = state.sizeFilter ?? []
                          const next = cur.includes(p.key) ? cur.filter((k) => k !== p.key) : [...cur, p.key]
                          update({ sizeFilter: next.length ? next : undefined, minFollowers: undefined, maxFollowers: undefined })
                        }}
                        style={{ borderRadius: 14, fontSize: 15 }}
                      >
                        {p.label}
                        <span style={{ marginLeft: 8, opacity: 0.9 }}>
                          ({count.toLocaleString('pt-BR')})
                        </span>
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
                    const f = facets ?? initialFacets
                    const count = i === 0
                      ? (estimateCount ?? 0)
                      : (f?.account_type?.[i - 1]?.count ?? 0)
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
                        <span style={{ marginLeft: 8, opacity: 0.9 }}>
                          ({count.toLocaleString('pt-BR')})
                        </span>
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
                        {act && act.activated > 0 && (
                          <Button
                            type={onlyActive ? 'primary' : 'default'}
                            size="large"
                            onClick={() => update({ activationFilter: ['activated'] })}
                            style={{ borderRadius: 14, fontSize: 15 }}
                          >
                            Apenas Segmentados
                            <span style={{ marginLeft: 8, opacity: 0.9 }}>
                              ({act.activated.toLocaleString('pt-BR')})
                            </span>
                          </Button>
                        )}
                      </>
                    )
                  })()}
                </div>
              </div>
            )}
          </div>

          {/* Progress e botões */}
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
              <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block', opacity: 0.8, textAlign: 'center' }}>
                {step + 1} / {STEPS.length}
              </Text>
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
              {step > 0 && (
                <Button size="middle" onClick={prevStep} disabled={!!isLoadingOptions} style={{ borderRadius: 10, minWidth: 100, height: 40, fontSize: 15 }}>
                  Voltar
                </Button>
              )}
              <Button
                type="primary"
                size="middle"
                onClick={nextStep}
                disabled={!canAdvance()}
                loading={!!isLoadingOptions}
                icon={step === STEPS.length - 1 ? <RocketOutlined /> : undefined}
                className="search-wizard-next-btn"
                style={{ borderRadius: 10, minWidth: 200, height: 40, fontSize: 15 }}
              >
                {step === STEPS.length - 1 ? 'Ver resultados' : step === 0 ? 'Buscar' : 'Próximo'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
