/**
 * Wizard de pré-filtragem gamificado: etapas visuais antes de ver os resultados.
 * Afunila o resultado: a cada escolha o usuário vê a quantidade de perfis que os filtros retornam.
 */
import { useState, useEffect, useLayoutEffect, useMemo, useRef, type ReactElement, type ComponentType } from 'react'
import { Button, Typography, Progress, Spin, Modal, message } from 'antd'
import {
  TeamOutlined,
  UserOutlined,
  RocketOutlined,
  ApartmentOutlined,
  CrownOutlined,
  GlobalOutlined,
  MedicineBoxOutlined,
  SmileOutlined,
  BankOutlined,
  CoffeeOutlined,
  FireOutlined,
  VideoCameraOutlined,
  HomeOutlined,
  RiseOutlined,
  ReadOutlined,
  ThunderboltOutlined,
  LineChartOutlined,
  PictureOutlined,
  CarOutlined,
  TrophyOutlined,
  FlagOutlined,
  ShoppingOutlined,
  HeartOutlined,
  AppstoreOutlined,
  AudioOutlined,
  SkinOutlined,
  StarOutlined,
} from '@ant-design/icons'
import type { ProfilesSearchQuery, ProfilesSearchFacets } from '../../api'
import { formatPatamarRangeCompact } from '../../utils/influencerTier'

const { Text } = Typography

/** Retorno da estimativa: total e facets para mostrar contagem por opção. */
export interface EstimateResult {
  total: number
  facets: ProfilesSearchFacets | null
}

/** Máximo de categorias principais no passo 1 (filtro na busca). */
const LLM_MAIN_CATEGORY_MAX = 3

const STEPS = [
  {
    key: 'llmMainCategory',
    icon: ApartmentOutlined,
    title: 'Qual a categoria deseja buscar?',
    subtitle: `Selecione de 1 a ${LLM_MAIN_CATEGORY_MAX} itens para buscar o influencer ideal para sua campanha`,
  },
  { key: 'porte', icon: TeamOutlined, title: 'Qual o tamanho do influencer?', subtitle: 'Escolha uma ou mais faixas de seguidores' },
  { key: 'llmGender', icon: UserOutlined, title: 'Gênero do Influenciador', subtitle: 'Opcional' },
  { key: 'llmAudience', icon: TeamOutlined, title: 'Qual o público-alvo que você busca?', subtitle: 'Opcional' },
] as const

const STEP_LLM_FIRST = 0
const STEP_LLM_MAIN_CATEGORY = 0
const STEP_PORTE = 1
const STEP_LLM_GENDER = 2
const STEP_LLM_AUDIENCE = 3
const STEP_LLM_LAST = 3

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

type CategoryIconComp = ComponentType<{ style?: React.CSSProperties }>

function categoryVisualForLabel(rawName: string): { Icon: CategoryIconComp; fg: string; bg: string } {
  const n = rawName.toLowerCase()
  const rules: { test: (s: string) => boolean; Icon: CategoryIconComp; fg: string; bg: string }[] = [
    { test: (s) => /beleza|maquiagem|skincare|cosm[eé]/.test(s), Icon: CrownOutlined, fg: '#c41d7f', bg: 'rgba(196, 29, 127, 0.14)' },
    { test: (s) => /moda|estilo|fashion/.test(s), Icon: SkinOutlined, fg: '#531dab', bg: 'rgba(83, 29, 171, 0.12)' },
    { test: (s) => /maternidade|paternidade|beb[eê]|gesta[cç][aã]o/.test(s), Icon: TeamOutlined, fg: '#08979c', bg: 'rgba(8, 151, 156, 0.14)' },
    { test: (s) => /viagem|turismo/.test(s), Icon: GlobalOutlined, fg: '#1677ff', bg: 'rgba(22, 119, 255, 0.12)' },
    { test: (s) => /sa[uú]de|bem[- ]estar|wellness/.test(s), Icon: MedicineBoxOutlined, fg: '#52c41a', bg: 'rgba(82, 196, 26, 0.14)' },
    { test: (s) => /humor|com[eé]dia|entretenimento/.test(s), Icon: SmileOutlined, fg: '#fa8c16', bg: 'rgba(250, 140, 22, 0.14)' },
    { test: (s) => /neg[oó]cio|carreira|empreendedor|startup/.test(s), Icon: BankOutlined, fg: '#2f54eb', bg: 'rgba(47, 84, 235, 0.12)' },
    { test: (s) => /lifestyle|vlog/.test(s), Icon: CoffeeOutlined, fg: '#d48806', bg: 'rgba(212, 136, 6, 0.14)' },
    { test: (s) => /gastronomia|culin[aá]ria|receita|food/.test(s), Icon: FireOutlined, fg: '#cf1322', bg: 'rgba(207, 19, 34, 0.1)' },
    { test: (s) => /cinema|cultura pop|celebridade|s[eé]rie/.test(s), Icon: VideoCameraOutlined, fg: '#722ed1', bg: 'rgba(114, 46, 209, 0.12)' },
    { test: (s) => /decora[cç][aã]o|home office|lar|casa /.test(s), Icon: HomeOutlined, fg: '#13c2c2', bg: 'rgba(19, 194, 194, 0.14)' },
    { test: (s) => /desenvolvimento pessoal|produtivida|mindset/.test(s), Icon: RiseOutlined, fg: '#237804', bg: 'rgba(35, 120, 4, 0.12)' },
    { test: (s) => /educa[cç][aã]o|idioma|curso|ensino/.test(s), Icon: ReadOutlined, fg: '#096dd9', bg: 'rgba(9, 109, 217, 0.12)' },
    { test: (s) => /pet|animal/.test(s), Icon: StarOutlined, fg: '#fa541c', bg: 'rgba(250, 84, 28, 0.12)' },
    { test: (s) => /m[uú]sica|dança|dance/.test(s), Icon: AudioOutlined, fg: '#eb2f96', bg: 'rgba(235, 47, 150, 0.12)' },
    { test: (s) => /tecnologia|inova[cç][aã]o|tech|gadget/.test(s), Icon: ThunderboltOutlined, fg: '#0050b3', bg: 'rgba(0, 80, 179, 0.12)' },
    { test: (s) => /finanças|investimento|crypto|bitcoin|mercado financeiro/.test(s), Icon: LineChartOutlined, fg: '#135200', bg: 'rgba(19, 82, 0, 0.12)' },
    { test: (s) => /arte|design|ilustra/.test(s), Icon: PictureOutlined, fg: '#c41d7f', bg: 'rgba(196, 29, 127, 0.1)' },
    { test: (s) => /automobil|motor|carro|moto/.test(s), Icon: CarOutlined, fg: '#434343', bg: 'rgba(67, 67, 67, 0.1)' },
    { test: (s) => /fitness|academia|muscula/.test(s), Icon: RiseOutlined, fg: '#ad4e00', bg: 'rgba(173, 78, 0, 0.12)' },
    { test: (s) => /^esportes$|futebol|atleta|basquete|v[oô]lei/.test(s), Icon: TrophyOutlined, fg: '#d4380d', bg: 'rgba(212, 56, 13, 0.12)' },
    { test: (s) => /pol[ií]tica|governo|elei[cç][aã]o/.test(s), Icon: FlagOutlined, fg: '#595959', bg: 'rgba(89, 89, 89, 0.12)' },
    { test: (s) => /compra|desconto|promo[cç][aã]o|oferta/.test(s), Icon: ShoppingOutlined, fg: '#f5222d', bg: 'rgba(245, 34, 45, 0.1)' },
    { test: (s) => /relacionamento|casal|amor /.test(s), Icon: HeartOutlined, fg: '#eb2f96', bg: 'rgba(235, 47, 150, 0.12)' },
  ]
  for (const r of rules) {
    if (r.test(n)) return { Icon: r.Icon, fg: r.fg, bg: r.bg }
  }
  let h = 0
  for (let i = 0; i < rawName.length; i++) h = (h * 31 + rawName.charCodeAt(i)) >>> 0
  const hues = [280, 200, 24, 145, 265, 198]
  const hue = hues[h % hues.length]!
  const fg = `hsl(${hue} 72% 36%)`
  const bg = `hsla(${hue} 60% 50% / 0.15)`
  return { Icon: AppstoreOutlined, fg, bg }
}

function MainCategoryGridSection(props: {
  items: { name: string; count: number }[]
  selected: string[] | undefined
  /** Quando definido, tiles não selecionados ficam visualmente indisponíveis ao atingir o limite. */
  maxSelectable?: number
  onToggle: (normalizedKey: string) => void
}) {
  const list = props.items.filter((x) => x.count > 0).sort((a, b) => b.count - a.count)
  if (!list.length) return null
  const selectedCount = props.selected?.length ?? 0
  const max = props.maxSelectable
  return (
    <div className="search-wizard-category-grid" role="list">
      {list.map((it) => {
        const norm = it.name.trim().toLowerCase()
        const active = props.selected?.includes(norm) ?? false
        const atLimit = max != null && selectedCount >= max && !active
        const { Icon, fg, bg } = categoryVisualForLabel(it.name)
        return (
          <button
            key={norm}
            type="button"
            role="listitem"
            className={`search-wizard-category-tile${active ? ' search-wizard-category-tile--active' : ''}${atLimit ? ' search-wizard-category-tile--limit' : ''}`}
            onClick={() => props.onToggle(norm)}
            aria-pressed={active}
            aria-disabled={atLimit}
          >
            <span className="search-wizard-category-tile-icon" style={{ background: bg, color: fg }} aria-hidden>
              <Icon style={{ fontSize: 22 }} />
            </span>
            <span className="search-wizard-category-tile-label">{llmOptionLabel(it.name)}</span>
            <span className="search-wizard-category-tile-count">{it.count.toLocaleString('pt-BR')} perfis</span>
          </button>
        )
      })}
    </div>
  )
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
  /** Porte(s): chaves de `followers_buckets` (ex.: nano … celebridade); multiselect opcional. */
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
  /** Enquanto o primeiro fetch (facets iniciais) não termina. */
  wizardPrefetchLoading?: boolean
}

/**
 * Lista de categorias LLM na etapa 1: usa facetas do prefetch (`initialFacets`) quando existem,
 * pois não têm filtro `llmMainCategory` — ao voltar do porte, `facets` pode estar restrita à categoria
 * selecionada e só mostraria um chip.
 */
function mainCategoryFacetItemsForWizard(
  facetsState: ProfilesSearchFacets | null,
  initial: ProfilesSearchFacets | null | undefined
): { name: string; count: number }[] {
  const pre = initial?.llm?.mainCategory ?? []
  if (pre.some((i) => i.count > 0)) return pre
  return facetsState?.llm?.mainCategory ?? initial?.llm?.mainCategory ?? []
}

function boundsToSizeKeyFromBuckets(
  buckets: NonNullable<ProfilesSearchFacets['followers_buckets']> | undefined,
  min?: number | null,
  max?: number | null | undefined
): string | undefined {
  if (!buckets?.length) return undefined
  if (min == null && max == null) return undefined
  for (const b of buckets) {
    if (b.min !== min) continue
    if (b.max === max || (b.max == null && max == null)) return b.key
  }
  return undefined
}

/** Maior índice de etapa LLM com filtro preenchido (para retomar a jornada pela URL). */
function maxLlmStepFromFilters(f: Partial<WizardState>): number {
  let max = -1
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

function filtersToWizardState(
  f: Partial<WizardState> | undefined,
  followersBuckets?: ProfilesSearchFacets['followers_buckets']
): WizardState {
  if (!f?.categories?.length && !f?.q) return {}
  let sizeFilter = f.sizeFilter?.length ? [...f.sizeFilter] : undefined
  if (!sizeFilter?.length && (f.minFollowers != null || f.maxFollowers != null)) {
    const k = boundsToSizeKeyFromBuckets(followersBuckets, f.minFollowers, f.maxFollowers)
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
    llmMainCategory: (() => {
      const v = copyStrArr(f.llmMainCategory?.map((x) => x.trim().toLowerCase()).filter(Boolean))
      if (!v?.length) return undefined
      return v.length > LLM_MAIN_CATEGORY_MAX ? v.slice(0, LLM_MAIN_CATEGORY_MAX) : v
    })(),
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

export default function SearchWizard({
  onComplete,
  onEstimate,
  initialFacets,
  initialSearchTerm = '',
  initialFilters,
  onFiltersChange,
  wizardPrefetchLoading = false,
}: SearchWizardProps) {
  const initialBuckets = initialFacets?.followers_buckets
  const [step, setStep] = useState(() => stepFromFilters(filtersToWizardState(initialFilters, initialBuckets)))
  const [state, setState] = useState<WizardState>(() => filtersToWizardState(initialFilters, initialBuckets))
  const fixedSearchTerm = initialSearchTerm.trim()
  const [facets, setFacets] = useState<ProfilesSearchFacets | null>(null)
  const [nextStepLoading, setNextStepLoading] = useState(false)
  const mainCategoryItems = useMemo(
    () => mainCategoryFacetItemsForWizard(facets, initialFacets),
    [facets, initialFacets]
  )
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

  const toggleLlmMainCategory = (norm: string) => {
    const arr = state.llmMainCategory ?? []
    if (arr.includes(norm)) {
      toggleArray('llmMainCategory', norm)
      return
    }
    if (arr.length >= LLM_MAIN_CATEGORY_MAX) {
      message.info(`Você pode selecionar no máximo ${LLM_MAIN_CATEGORY_MAX} categorias.`)
      return
    }
    toggleArray('llmMainCategory', norm)
  }

  const syncUrl = (stateOverride?: WizardState, hashStep?: number) => {
    if (!onFiltersChange) return
    const s = stateOverride ?? state
    const stepForHash = hashStep ?? step
    const sq = stateToQueryForHash(s, stepForHash)
    onFiltersChange(sq)
  }

  const nextStep = async () => {
    if (step === STEP_LLM_MAIN_CATEGORY) {
      const hasCats = mainCategoryItems.some((i) => i.count > 0)
      if (!wizardPrefetchLoading && hasCats && !(state.llmMainCategory?.length ?? 0)) {
        Modal.warning({
          title: 'Categoria obrigatória',
          content: 'Selecione pelo menos uma categoria para continuar.',
          okText: 'Entendi',
          centered: true,
        })
        return
      }
    }
    if (step === STEP_PORTE && !(state.sizeFilter?.length ?? 0)) {
      Modal.warning({
        title: 'Porte obrigatório',
        content: 'Selecione pelo menos 1 porte para continuar.',
        okText: 'Entendi',
        centered: true,
      })
      return
    }
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
        } catch (e) {
          Modal.error({
            title: 'Não foi possível atualizar',
            content: (e as Error)?.message || 'Não foi possível atualizar a busca. Tente novamente.',
            okText: 'Entendi',
            centered: true,
          })
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
        } catch (e) {
          Modal.error({
            title: 'Não foi possível atualizar',
            content: (e as Error)?.message || 'Não foi possível atualizar a busca. Tente novamente.',
            okText: 'Entendi',
            centered: true,
          })
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
      } catch (e) {
        Modal.error({
          title: 'Não foi possível atualizar',
          content: (e as Error)?.message || 'Não foi possível atualizar a busca. Tente novamente.',
          okText: 'Entendi',
          centered: true,
        })
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
        } catch (e) {
          Modal.error({
            title: 'Não foi possível atualizar',
            content: (e as Error)?.message || 'Não foi possível atualizar a busca. Tente novamente.',
            okText: 'Entendi',
            centered: true,
          })
          porteAutoSkipRef.current = false
          porteAutoSkipInProgressRef.current = false
        } finally {
          setNextStepLoading(false)
        }
      })()
  }, [step, facets, initialFacets, state, onEstimate])

  const isLoadingOptions =
    nextStepLoading || (step >= 1 && !(facets ?? initialFacets)) || (step === STEP_LLM_MAIN_CATEGORY && wizardPrefetchLoading)
  const showFullScreenLoader = step >= 1 && !(facets ?? initialFacets)

  /** Só bloqueia o botão durante carregamento; validação de etapa mostra erro ao clicar. */
  const nextButtonDisabled = isLoadingOptions

  const isMainCategoryStep = step === STEP_LLM_MAIN_CATEGORY
  const contentMaxWidth = isMainCategoryStep ? 'min(1040px, 100%)' : 580

  return (
    <div
      className={
        (isMainCategoryStep ? 'search-wizard search-wizard--category-wide' : 'search-wizard') +
        ' search-wizard--with-fixed-footer'
      }
      style={{
        maxWidth: isMainCategoryStep ? 'min(1040px, 100%)' : 680,
        width: '100%',
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
      {/* Conteúdo rolável; rodapé (progresso + ações) fica fixo na viewport */}
      <div className="search-wizard__scroll">
        <div
          style={{ width: '100%', display: 'flex', flexDirection: 'column', overflow: 'visible', position: 'relative', alignItems: 'center' }}
          className="search-wizard-step"
        >
          <div key={step} className="search-wizard-stage" style={{ display: 'flex', flexDirection: 'column', width: '100%', alignItems: 'center', textAlign: 'center' }}>
            <Typography.Title level={2} style={{ marginBottom: 4, fontSize: 22, fontWeight: 600, flexShrink: 0 }}>
              {currentStep.title}
            </Typography.Title>
            <Text type="secondary" style={{ fontSize: 14, lineHeight: 1.4, flexShrink: 0 }}>
              {currentStep.subtitle}
            </Text>

            <div style={{ marginTop: 20, width: '100%', maxWidth: contentMaxWidth, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              {step === STEP_PORTE && (
                <div style={{ width: '100%', textAlign: 'center' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
                    {((facets ?? initialFacets)?.followers_buckets ?? [])
                      .filter((b) => b.count > 0)
                      .map((p) => {
                        const active = state.sizeFilter?.includes(p.key) ?? false
                        const max = p.max ?? undefined
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
                            <span style={{ marginLeft: 6, opacity: 0.92, fontWeight: 500 }}>
                              · {formatPatamarRangeCompact({ min: p.min, max })}
                            </span>
                            <span style={{ marginLeft: 8, opacity: 0.9 }}>
                              ({p.count.toLocaleString('pt-BR')})
                            </span>
                          </Button>
                        )
                      })}
                  </div>
                </div>
              )}

              {step >= STEP_LLM_FIRST && step <= STEP_LLM_LAST && (
                <div style={{ width: '100%', textAlign: 'center' }}>
                  {(() => {
                    const llm = (facets ?? initialFacets)?.llm
                    if (step === STEP_LLM_MAIN_CATEGORY && wizardPrefetchLoading) {
                      return (
                        <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0', width: '100%' }}>
                          <Spin size="large" />
                        </div>
                      )
                    }
                    if (!llm) {
                      return <Text type="secondary">Nenhuma classificação IA para este recorte — avance para continuar.</Text>
                    }
                    const emptyHint = <Text type="secondary">Nenhuma opção neste recorte — pode avançar.</Text>
                    const chipOrHint = (items: { name: string; count: number }[], el: ReactElement) =>
                      (items ?? []).some((i) => i.count > 0) ? el : emptyHint
                    switch (step) {
                    case STEP_LLM_MAIN_CATEGORY: {
                        if (!mainCategoryItems.some((i) => i.count > 0)) return emptyHint
                        return (
                          <div className="search-wizard-category-pane">
                            <MainCategoryGridSection
                              items={mainCategoryItems}
                              selected={state.llmMainCategory}
                              maxSelectable={LLM_MAIN_CATEGORY_MAX}
                              onToggle={toggleLlmMainCategory}
                            />
                          </div>
                        )
                      }
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
          </div>
        </div>
      </div>

      <footer className="search-wizard-footer-fixed" role="contentinfo">
        <div className="search-wizard-footer-fixed__inner" style={{ width: '100%', maxWidth: contentMaxWidth }}>
          <div className="search-wizard-progress" style={{ width: '100%', maxWidth: 400, marginInline: 'auto' }}>
            <Progress
              percent={progressPercent}
              showInfo={false}
              strokeColor="#1677ff"
              trailColor="rgba(0, 0, 0, 0.09)"
              strokeWidth={3}
              style={{ borderRadius: 999 }}
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
              disabled={nextButtonDisabled}
              loading={!!isLoadingOptions}
              icon={step === STEPS.length - 1 ? <RocketOutlined /> : undefined}
              className="search-wizard-next-btn"
              style={{ borderRadius: 10, minWidth: 200, height: 40, fontSize: 15 }}
            >
              {step === STEPS.length - 1 ? 'Ver resultados' : 'Próximo'}
            </Button>
          </div>
        </div>
      </footer>
    </div>
  )
}
