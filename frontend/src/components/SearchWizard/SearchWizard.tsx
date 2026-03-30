/**
 * Wizard de pré-filtragem gamificado: etapas visuais antes de ver os resultados.
 * Afunila o resultado: a cada escolha o usuário vê a quantidade de perfis que os filtros retornam.
 */
import { useState, useEffect, useLayoutEffect, useRef, type ReactElement } from 'react'
import { Button, Typography, Progress, Alert } from 'antd'
import {
  TeamOutlined,
  UserOutlined,
  RocketOutlined,
  IdcardOutlined,
  ApartmentOutlined,
} from '@ant-design/icons'
import type { ProfilesSearchQuery, ProfilesSearchFacets } from '../../api'

const { Text } = Typography

/** Retorno da estimativa: total e facets para mostrar contagem por opção. */
export interface EstimateResult {
  total: number
  facets: ProfilesSearchFacets | null
}

const STEPS = [
  { key: 'llmMainCategory', icon: ApartmentOutlined, title: 'Qual a categoria principal?', subtitle: 'Opcional' },
  { key: 'porte', icon: TeamOutlined, title: 'Qual o porte?', subtitle: 'Escolha uma ou mais faixas de seguidores (opcional)' },
  { key: 'llmProfileType', icon: IdcardOutlined, title: 'Qual o tipo de perfil?', subtitle: 'Escolha uma ou mais opções (opcional), com base na classificação automática' },
  { key: 'llmGender', icon: UserOutlined, title: 'Gênero (classificação IA)', subtitle: 'Opcional' },
  { key: 'llmAudience', icon: TeamOutlined, title: 'Qual o público-alvo do conteúdo?', subtitle: 'Opcional' },
] as const

const STEP_LLM_FIRST = 0
const STEP_LLM_MAIN_CATEGORY = 0
const STEP_PORTE = 1
const STEP_LLM_PROFILE_TYPE = 2
const STEP_LLM_GENDER = 3
const STEP_LLM_AUDIENCE = 4
const STEP_LLM_LAST = 4

/** Chaves alinhadas a `followers_buckets` e ao filtro `sizeFilter` da API (OR entre selecionados). */
const PORTE_OPTIONS = [
  { key: 'nano', label: 'Nano', min: 0, max: 10_000 },
  { key: 'micro', label: 'Micro', min: 10_000, max: 50_000 },
  { key: 'medio', label: 'Médio', min: 50_000, max: 200_000 },
  { key: 'macro', label: 'Macro', min: 200_000, max: undefined as number | undefined },
] as const

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

const LLM_ENUM_LABELS: Record<string, string> = {
  creator: 'Criador',
  influencer: 'Influenciador',
  personal: 'Pessoal',
  educator: 'Educador',
  high: 'Alto',
  low: 'Baixo',
  medium: 'Médio',
}

function llmOptionLabel(raw: string): string {
  const k = raw.trim().toLowerCase()
  return LLM_ENUM_LABELS[k] ?? raw
}

function LlmChipSection(props: {
  /** Se omitido, só os chips (título da etapa já está no cabeçalho do wizard). */
  title?: string
  items: { name: string; count: number }[]
  selected: string[] | undefined
  onToggle: (normalizedKey: string) => void
}) {
  const list = props.items.filter((x) => x.count > 0)
  if (!list.length) return null
  return (
    <div style={{ marginBottom: props.title ? 20 : 0, width: '100%' }}>
      {props.title ? (
        <Text strong style={{ display: 'block', marginBottom: 10, textAlign: 'center', fontSize: 15 }}>
          {props.title}
        </Text>
      ) : null}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
        {list.map((it) => {
          const key = it.name.trim().toLowerCase()
          const active = props.selected?.includes(key) ?? false
          return (
            <Button
              key={`${props.title ?? 'llm'}-${key}`}
              type={active ? 'primary' : 'default'}
              size="large"
              onClick={() => props.onToggle(key)}
              style={{ borderRadius: 14, fontSize: 14 }}
            >
              {llmOptionLabel(it.name)}
              <span style={{ marginLeft: 8, opacity: 0.9 }}>({it.count.toLocaleString('pt-BR')})</span>
            </Button>
          )
        })}
      </div>
    </div>
  )
}

/** Enviado na query quando há filtro parcial de categorias (legado / URL). */
export const NO_PERFIL_CATEGORY_KEY = 'no_perfil'

export interface WizardState {
  q?: string
  categories?: string[]
  /** Porte(s): nano | micro | medio | macro — multiselect; opcional na etapa de porte. */
  sizeFilter?: string[]
  /** Legado (URL antiga); convertido para `sizeFilter` ao hidratar. */
  minFollowers?: number
  maxFollowers?: number
  excludePrivate?: boolean
  accountTypeFilter?: number[]
  /** 'activated' | 'not_activated' — quando ['activated'], só perfis ativados. */
  activationFilter?: string[]
  llmProfileType?: string[]
  llmMainCategory?: string[]
  llmGender?: string[]
  llmLanguage?: string[]
  llmSubCategories?: string[]
  llmContentPillars?: string[]
  llmAudienceType?: string[]
  llmToneOfVoice?: string[]
  llmRiskLevel?: string[]
  llmIsFamilySafe?: boolean
  llmIsAdultContent?: boolean
}

/** Converte estado do wizard em query para a API. */
function stateToQuery(state: WizardState): Partial<ProfilesSearchQuery> {
  const q = state.q ?? (state.categories?.length ? state.categories[0] : undefined)
  const raw = (state.categories ?? []).filter((c) => c !== NO_PERFIL_CATEGORY_KEY)
  let categories: string[] | undefined
  if (raw.length > 1) {
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
    llmProfileType: state.llmProfileType?.length ? state.llmProfileType : undefined,
    llmMainCategory: state.llmMainCategory?.length ? state.llmMainCategory : undefined,
    llmGender: state.llmGender?.length ? state.llmGender : undefined,
    llmLanguage: state.llmLanguage?.length ? state.llmLanguage : undefined,
    llmSubCategories: state.llmSubCategories?.length ? state.llmSubCategories : undefined,
    llmContentPillars: state.llmContentPillars?.length ? state.llmContentPillars : undefined,
    llmAudienceType: state.llmAudienceType?.length ? state.llmAudienceType : undefined,
    llmToneOfVoice: state.llmToneOfVoice?.length ? state.llmToneOfVoice : undefined,
    llmRiskLevel: state.llmRiskLevel?.length ? state.llmRiskLevel : undefined,
    ...(state.llmIsFamilySafe === true || state.llmIsFamilySafe === false ? { llmIsFamilySafe: state.llmIsFamilySafe } : {}),
    ...(state.llmIsAdultContent === true || state.llmIsAdultContent === false ? { llmIsAdultContent: state.llmIsAdultContent } : {}),
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

function boundsToSizeKey(min?: number, max?: number): string | undefined {
  if (min === 0 && max === 10_000) return 'nano'
  if (min === 10_000 && max === 50_000) return 'micro'
  if (min === 50_000 && max === 200_000) return 'medio'
  if (min === 200_000 && max === undefined) return 'macro'
  return undefined
}

/** Maior índice de etapa LLM com filtro preenchido (para retomar a jornada pela URL). */
function maxLlmStepFromFilters(f: Partial<WizardState>): number {
  let max = -1
  if ((f.llmProfileType?.length ?? 0) > 0) max = Math.max(max, STEP_LLM_PROFILE_TYPE)
  if ((f.llmMainCategory?.length ?? 0) > 0) max = Math.max(max, STEP_LLM_MAIN_CATEGORY)
  if ((f.llmGender?.length ?? 0) > 0) max = Math.max(max, STEP_LLM_GENDER)
  if ((f.llmAudienceType?.length ?? 0) > 0) max = Math.max(max, STEP_LLM_AUDIENCE)
  if ((f.llmToneOfVoice?.length ?? 0) > 0) max = Math.max(max, STEP_LLM_AUDIENCE)
  if ((f.llmRiskLevel?.length ?? 0) > 0) max = Math.max(max, STEP_LLM_AUDIENCE)
  if (f.llmIsFamilySafe === true || f.llmIsFamilySafe === false) max = Math.max(max, STEP_LLM_AUDIENCE)
  if (f.llmIsAdultContent === true || f.llmIsAdultContent === false) max = Math.max(max, STEP_LLM_AUDIENCE)
  return max
}

function stepFromFilters(f: Partial<WizardState>): number {
  if ((f.sizeFilter?.length ?? 0) > 0 || f.minFollowers != null || f.maxFollowers != null) return STEP_PORTE
  const m = maxLlmStepFromFilters(f)
  if (m >= STEP_LLM_MAIN_CATEGORY) return m
  return STEP_LLM_MAIN_CATEGORY
}

/** Filtro associado a cada índice de etapa do wizard. */
function filterPatchForWizardStep(stepIndex: number): Partial<WizardState> {
  switch (stepIndex) {
    case STEP_PORTE:
      return { sizeFilter: undefined, minFollowers: undefined, maxFollowers: undefined }
    case STEP_LLM_PROFILE_TYPE:
      return { llmProfileType: undefined }
    case STEP_LLM_MAIN_CATEGORY:
      return { llmMainCategory: undefined }
    case STEP_LLM_GENDER:
      return { llmGender: undefined }
    case STEP_LLM_AUDIENCE:
      return { llmAudienceType: undefined, llmRiskLevel: undefined, llmToneOfVoice: undefined, llmIsFamilySafe: undefined, llmIsAdultContent: undefined }
    default:
      return {}
  }
}

/** Ao voltar: remove filtros da etapa atual e de todas as posteriores (sincroniza URL). */
function filterPatchesFromStepForward(fromStep: number): Partial<WizardState> {
  let p: Partial<WizardState> = {}
  for (let i = fromStep; i <= STEP_LLM_LAST; i++) {
    p = { ...p, ...filterPatchForWizardStep(i) }
  }
  return p
}

/** Volta à primeira tela do wizard: limpa filtros de porte e LLM. */
function filterPatchesBackToFirstStep(): Partial<WizardState> {
  return { ...filterPatchesFromStepForward(STEP_PORTE) }
}

/**
 * Serialização na hash reflete o mesmo que o estado (incl. sizeFilter).
 */
function stateToQueryForHash(state: WizardState, hashStep: number): Partial<ProfilesSearchQuery> {
  let s: WizardState = state
  if (hashStep === STEP_LLM_MAIN_CATEGORY) {
    s = { ...s, ...filterPatchesFromStepForward(STEP_PORTE) }
  }
  return stateToQuery(s)
}

function copyStrArr(a?: string[]): string[] | undefined {
  return a?.length ? [...a] : undefined
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
    llmProfileType: copyStrArr(f.llmProfileType?.map((x) => x.trim().toLowerCase()).filter(Boolean)),
    llmMainCategory: copyStrArr(f.llmMainCategory?.map((x) => x.trim().toLowerCase()).filter(Boolean)),
    llmGender: copyStrArr(f.llmGender?.map((x) => x.trim().toLowerCase()).filter(Boolean)),
    llmLanguage: copyStrArr(f.llmLanguage?.map((x) => x.trim().toLowerCase()).filter(Boolean)),
    llmSubCategories: copyStrArr(f.llmSubCategories?.map((x) => x.trim().toLowerCase()).filter(Boolean)),
    llmContentPillars: copyStrArr(f.llmContentPillars?.map((x) => x.trim().toLowerCase()).filter(Boolean)),
    llmAudienceType: copyStrArr(f.llmAudienceType?.map((x) => x.trim().toLowerCase()).filter(Boolean)),
    llmToneOfVoice: copyStrArr(f.llmToneOfVoice?.map((x) => x.trim().toLowerCase()).filter(Boolean)),
    llmRiskLevel: copyStrArr(f.llmRiskLevel?.map((x) => x.trim().toLowerCase()).filter(Boolean)),
    llmIsFamilySafe: f.llmIsFamilySafe,
    llmIsAdultContent: f.llmIsAdultContent,
  }
}

export default function SearchWizard({ onComplete, onEstimate, initialFacets, initialSearchTerm = '', initialFilters, onFiltersChange }: SearchWizardProps) {
  const [step, setStep] = useState(() => stepFromFilters(filtersToWizardState(initialFilters)))
  const [state, setState] = useState<WizardState>(() => filtersToWizardState(initialFilters))
  const fixedSearchTerm = initialSearchTerm.trim()
  const [facets, setFacets] = useState<ProfilesSearchFacets | null>(null)
  const [nextStepLoading, setNextStepLoading] = useState(false)
  const [porteValidationError, setPorteValidationError] = useState(false)
  /** Evita disparar duas vezes o auto-avanço do porte quando a URL pede buckets inexistentes. */
  const porteAutoSkipRef = useRef(false)
  /** Evita corrida entre prune do porte e o auto-avanço quando não há buckets válidos. */
  const porteAutoSkipInProgressRef = useRef(false)
  /**
   * Ao entrar numa etapa, zera os filtros **dessa** etapa (estado + hash no efeito seguinte).
   * Evita reaproveitar seleção vinda da URL e vale para todas as etapas com filtro (0 = busca não altera).
   */
  useLayoutEffect(() => {
    const patch = filterPatchForWizardStep(step)
    if (Object.keys(patch).length === 0) return
    setState((prev) => ({ ...prev, ...patch }))
    setPorteValidationError(false)
  }, [step])

  /** Sincroniza seleções com a URL conforme os filtros do wizard. */
  useEffect(() => {
    if (!onFiltersChange) return
    const sq = stateToQueryForHash(state, step)
    onFiltersChange(sq)
  }, [state, fixedSearchTerm, onFiltersChange, step, facets, initialFacets])

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
    update({ [key]: next.length ? (next as WizardState[typeof key]) : undefined })
  }

  const syncUrl = (stateOverride?: WizardState, hashStep?: number) => {
    if (!onFiltersChange) return
    const s = stateOverride ?? state
    const stepForHash = hashStep ?? step
    const sq = stateToQueryForHash(s, stepForHash)
    onFiltersChange(sq)
  }

  const nextStep = async () => {
    if (step === STEP_PORTE && !(state.sizeFilter?.length ?? 0)) {
      setPorteValidationError(true)
      return
    }
    setPorteValidationError(false)
    syncUrl()
    if (step < STEPS.length - 1) {
      if (step === STEP_LLM_LAST) {
        finish()
        return
      }
      if (onEstimate) {
        setNextStepLoading(true)
        try {
          const query = stateToQuery(state)
          const { facets: nextFacets } = await onEstimate(query)
          setFacets(nextFacets ?? null)
          {
            const nextIdx = step + 1
            setStep(nextIdx)
          }
        } catch {
          // mantém na mesma etapa em erro
        } finally {
          setNextStepLoading(false)
        }
      } else {
        const nextIdx = step + 1
        setStep(nextIdx)
      }
    } else finish()
  }

  const prevStep = async () => {
    if (step === STEP_PORTE) {
      const patch = filterPatchesBackToFirstStep()
      const cleaned = { ...state, ...patch }
      update(patch)
      setStep(STEP_LLM_MAIN_CATEGORY)
      syncUrl(cleaned, STEP_LLM_MAIN_CATEGORY)
      if (onEstimate) {
        setNextStepLoading(true)
        try {
          const query = stateToQuery(cleaned)
          const { facets: nextFacets } = await onEstimate(query)
          setFacets(nextFacets ?? null)
        } catch {
          /* mantém facets */
        } finally {
          setNextStepLoading(false)
        }
      }
      return
    }
    // Remove filtros da etapa atual e posteriores; refaz estimativa (facets / totais)
    let patch: Partial<WizardState> = step > 0 ? filterPatchesFromStepForward(step) : {}
    let target = Math.max(0, step - 1)

    const applyPrevStateAndUrl = (finalPatch: Partial<WizardState>, finalTarget: number) => {
      const cleaned = { ...state, ...finalPatch }
      update(finalPatch)
      syncUrl(cleaned, finalTarget)
      setStep(finalTarget)
    }

    if (onEstimate) {
      setNextStepLoading(true)
      try {
        if (target === STEP_LLM_MAIN_CATEGORY) {
          patch = filterPatchesBackToFirstStep()
        }
        const entryClear = filterPatchForWizardStep(target)
        const cleanedForEstimate = { ...state, ...patch, ...entryClear }
        const query = stateToQuery(cleanedForEstimate)
        const { facets: nextFacets } = await onEstimate(query)
        setFacets(nextFacets ?? null)
        const finalPatch =
          target === STEP_LLM_MAIN_CATEGORY ? filterPatchesBackToFirstStep() : { ...patch, ...entryClear }
        applyPrevStateAndUrl(finalPatch, target)
      } catch {
        if (target === STEP_LLM_MAIN_CATEGORY) {
          patch = filterPatchesBackToFirstStep()
        }
        const finalPatch =
          target === STEP_LLM_MAIN_CATEGORY
            ? filterPatchesBackToFirstStep()
            : { ...patch, ...filterPatchForWizardStep(target) }
        applyPrevStateAndUrl(finalPatch, target)
      } finally {
        setNextStepLoading(false)
      }
    } else {
      if (target === STEP_LLM_MAIN_CATEGORY) {
        patch = filterPatchesBackToFirstStep()
      }
      const finalPatch =
        target === STEP_LLM_MAIN_CATEGORY
          ? filterPatchesBackToFirstStep()
          : { ...patch, ...filterPatchForWizardStep(target) }
      applyPrevStateAndUrl(finalPatch, target)
    }
  }

  const finish = () => {
    const sq = stateToQuery(state)
    onComplete(sq)
  }

  /** URL ou padrão pode pedir micro/médio etc. sem haver perfis nesses buckets — remove da busca e avança. */
  useEffect(() => {
    if (step !== STEP_PORTE) {
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
          setStep(STEP_LLM_FIRST)
          return
        }
        setNextStepLoading(true)
        try {
          const query = stateToQuery(cleaned)
          const { facets: nextFacets } = await onEstimate(query)
          setFacets(nextFacets ?? null)
          setStep(STEP_LLM_FIRST)
        } catch {
          porteAutoSkipRef.current = false
          porteAutoSkipInProgressRef.current = false
        } finally {
          setNextStepLoading(false)
        }
      })()
  }, [step, facets, initialFacets, state, onEstimate])

  const isLoadingOptions = nextStepLoading || (step >= 1 && !(facets ?? initialFacets))
  const showFullScreenLoader = step >= 1 && !(facets ?? initialFacets)

  const canAdvance = () => {
    if (isLoadingOptions) return false
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
            {step === STEP_PORTE && (
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
                          if (next.length > 0) setPorteValidationError(false)
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
                {porteValidationError && (
                  <Alert
                    type="warning"
                    showIcon
                    message="Selecione pelo menos 1 porte para continuar."
                    style={{ marginTop: 14, maxWidth: 520, marginInline: 'auto' }}
                  />
                )}
              </div>
            )}

            {step >= STEP_LLM_FIRST && step <= STEP_LLM_LAST && (
              <div style={{ width: '100%', textAlign: 'center' }}>
                {(() => {
                  const llm = (facets ?? initialFacets)?.llm
                  if (!llm) {
                    return <Text type="secondary">Nenhuma classificação IA para este recorte — avance para continuar.</Text>
                  }
                  const emptyHint = <Text type="secondary">Nenhuma opção neste recorte — pode avançar.</Text>
                  const chipOrHint = (items: { name: string; count: number }[], el: ReactElement) =>
                    (items ?? []).some((i) => i.count > 0) ? el : emptyHint
                  switch (step) {
                    case STEP_LLM_PROFILE_TYPE:
                      return chipOrHint(llm.profileType ?? [], (
                        <LlmChipSection
                          items={llm.profileType ?? []}
                          selected={state.llmProfileType}
                          onToggle={(k) => toggleArray('llmProfileType', k)}
                        />
                      ))
                    case STEP_LLM_MAIN_CATEGORY:
                      return chipOrHint(llm.mainCategory ?? [], (
                        <LlmChipSection
                          items={llm.mainCategory ?? []}
                          selected={state.llmMainCategory}
                          onToggle={(k) => toggleArray('llmMainCategory', k)}
                        />
                      ))
                    case STEP_LLM_GENDER:
                      return chipOrHint(llm.gender ?? [], (
                        <LlmChipSection
                          items={llm.gender ?? []}
                          selected={state.llmGender}
                          onToggle={(k) => toggleArray('llmGender', k)}
                        />
                      ))
                    case STEP_LLM_AUDIENCE:
                      return chipOrHint(llm.audienceType ?? [], (
                        <LlmChipSection
                          items={llm.audienceType ?? []}
                          selected={state.llmAudienceType}
                          onToggle={(k) => toggleArray('llmAudienceType', k)}
                        />
                      ))
                    default:
                      return null
                  }
                })()}
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
                {step === STEPS.length - 1 ? 'Ver resultados' : 'Próximo'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
