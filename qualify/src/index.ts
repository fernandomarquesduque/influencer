import './loadEnv.js';
import process from 'node:process';
import http from 'node:http';
import { francAll } from 'franc';
import { Ollama } from 'ollama';
import {
  foldMainCategoryKey,
  formatMainCategoryTaxonomyForPrompt,
  formatSubcategoryTaxonomyHintsForPrompt,
  MAIN_CATEGORY_CANONICAL_LABELS,
  isCanonicalMainCategoryLabel,
  resolveMainCategoryWithEvidence,
  scoreMainCategoriesFromEvidence,
  scoreSubCategoriesToMainCategories,
  snapMainCategoryToTaxonomy,
  inferMainCategory,
} from './mainCategoryTaxonomy.js';

type JsonRecord = Record<string, unknown>;

interface LlmClassification {
  qualifiedAt: string;
  model: string;
  version: number;
  status: 'done' | 'insufficient_data';
  confidence: number;
  qualification: JsonRecord;
}

const DEFAULT_MODEL = 'llama3.1:8b';
const DEFAULT_OLLAMA_HOST = 'http://localhost:11434';
/** Contexto menor que o padrao do Ollama (4096) — prompt fase1 ~1,8k tok. */
const DEFAULT_OLLAMA_NUM_CTX = 2048;
/** Saida JSON de classificacao; limitar evita geracao longa e lenta. */
const DEFAULT_OLLAMA_NUM_PREDICT = 700;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_MAX_REASONING = 3;
const DEFAULT_API_TIMEOUT_MS = 30000;
/** POST /collector-ingest-llm pode demorar mais que GETs; padrao 120s para evitar abort apos LLM OK. */
const DEFAULT_INGEST_TIMEOUT_MS = 120000;
const DEFAULT_UI_PORT = 3600;
/** Max de linhas no painel e no JSON de /api/status (mais recentes primeiro; reduz payload). */
const QUALIFY_UI_RESULTS_MAX = 100;
const DEFAULT_LLM_REPAIR_ATTEMPTS = 2;

/**
 * Validacao ainda falha apos todas as tentativas de reparo LLM.
 * O batch mantém o perfil na base (falha operacional), sem purge automatico.
 */
class LlmValidationExhaustedError extends Error {
  readonly lastLlm: LlmClassification;
  constructor(message: string, lastLlm: LlmClassification) {
    super(message);
    this.name = 'LlmValidationExhaustedError';
    this.lastLlm = lastLlm;
  }
}

function isQualifyVerboseLog(): boolean {
  const v = process.env.QUALIFY_LOG_VERBOSE?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function truncateLogLine(s: string, max = 200): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

/** Linha legivel com vitrine + persona (logs de lote, reprocesso e CLI). */
function summarizeQualificationForLog(qualification: JsonRecord | null): string {
  if (!qualification || Object.keys(qualification).length === 0) {
    return 'mainCategory=- | personaSummary=-';
  }
  const mcRaw = parseMainCategory(qualification.mainCategory) ?? String(qualification.mainCategory ?? '').trim();
  const mc = mcRaw || '-';
  const subs = asStringArray(qualification.subCategories, 12).join(', ');
  const ps = String(qualification.personaSummary ?? '').trim().replace(/\s+/g, ' ');
  const personaShort = ps ? truncateLogLine(ps, 420) : '-';
  let line = `mainCategory=${mc}`;
  if (subs) line += ` | subCategories=${subs}`;
  line += ` | personaSummary=${personaShort}`;
  return line;
}

function logQualificationSummaryForHandle(
  handle: string,
  qualification: JsonRecord | null,
  emitLog: (msg: string) => void
): void {
  emitLog(`@${handle} | classificacao | ${summarizeQualificationForLog(qualification)}`);
}

/** Horario local nos logs do CLI (YYYY-MM-DD HH:mm:ss). */
function formatQualifyLogTimestamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function printQualifyLog(msg: string): void {
  console.log(`[qualify] ${formatQualifyLogTimestamp()} ${msg}`);
}

/** Uma linha curta: tipos de erro + trechos (evita log gigante com validacao). */
function summarizeValidationErrorsForLog(errors: string[]): string {
  if (errors.length === 0) return '';
  const kinds = new Set<string>();
  for (const e of errors) {
    const low = e.toLowerCase();
    if (low.includes('nome publico') || low.includes('nome completo')) kinds.add('nome');
    else if (low.includes('discovered_value') || low.includes('identificadores crus')) kinds.add('termo_busca');
    else if (low.includes('biografia')) kinds.add('copia_bio');
    else if (low.includes('handle')) kinds.add('handle');
    else if (low.includes('muito curto')) kinds.add('texto_curto');
    else if (low.includes('maincategory')) kinds.add('mainCategory');
    else if (low.includes('brandsafety')) kinds.add('brandSafety');
    else if (low.includes('mencoes a usuarios') || (low.includes('personasummary') && low.includes('@')))
      kinds.add('arroba');
    else if (low.includes('personasummary')) kinds.add('personaSummary');
    else kinds.add('outro');
  }
  const head = [...kinds].sort().join(',');
  const maxSnippets = 2;
  const snippets = errors.slice(0, maxSnippets).map((e) => {
    const line = e.replace(/^personaSummary /i, 'ps ');
    const maxLen = line.toLowerCase().includes('maincategory') ? 260 : 88;
    return truncateLogLine(line, maxLen);
  });
  const tail = errors.length > maxSnippets ? ` +${errors.length - maxSnippets} mais` : '';
  return `${head} — ${snippets.join(' · ')}${tail}`;
}

function toHandle(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '');
}

function escapeRegexChars(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Amostras de legendas/hashtags dos posts (quando a API envia _llm_content). */
type PostTextSample = { tipo: string; texto: string; hashtags: string[] };

type PostSampleExtractLimits = {
  maxItems: number;
  maxTextChars: number;
  maxHashtags: number;
  maxTotalTextChars?: number;
};

function getQualifyPostSampleMaxChars(): number {
  const n = Number(process.env.QUALIFY_POST_SAMPLE_MAX_CHARS ?? 220);
  return Number.isFinite(n) && n > 0 ? Math.max(64, Math.min(480, Math.floor(n))) : 220;
}

/** Quantas amostras entram no JSON do prompt Ollama (nao confundir com midias buscadas na API). */
function getQualifyPromptPostSampleCount(): number {
  const explicit = Number(process.env.QUALIFY_PROMPT_POST_SAMPLE_LIMIT?.trim());
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.max(1, Math.min(12, Math.floor(explicit)));
  }
  return Math.min(6, getLlmMediaContextLimit());
}

function getQualifyPromptPostSamplesMaxTotalChars(): number {
  const n = Number(process.env.QUALIFY_PROMPT_POST_SAMPLES_MAX_TOTAL_CHARS ?? 1200);
  return Number.isFinite(n) && n > 0 ? Math.max(400, Math.min(8000, Math.floor(n))) : 1200;
}

function getPostSampleLimitsForPrompt(): PostSampleExtractLimits {
  return {
    maxItems: getQualifyPromptPostSampleCount(),
    maxTextChars: getQualifyPostSampleMaxChars(),
    maxHashtags: 8,
    maxTotalTextChars: getQualifyPromptPostSamplesMaxTotalChars(),
  };
}

function getPostSampleLimitsForEvidence(): PostSampleExtractLimits {
  return {
    maxItems: getLlmMediaContextLimit(),
    maxTextChars: Math.min(480, Math.max(getQualifyPostSampleMaxChars(), 320)),
    maxHashtags: 12,
  };
}

function extractPostTextSamplesFromProfile(
  profile: JsonRecord,
  limits: PostSampleExtractLimits
): PostTextSample[] {
  const raw = profile._llm_content;
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const samples = (raw as JsonRecord).samples;
  if (!Array.isArray(samples) || samples.length === 0) return [];
  const out: PostTextSample[] = [];
  let totalText = 0;
  for (const s of samples) {
    if (s == null || typeof s !== 'object' || Array.isArray(s)) continue;
    const o = s as JsonRecord;
    let texto = String(o.text ?? '').trim().replace(/\s+/g, ' ');
    if (texto.length > limits.maxTextChars) {
      texto = `${texto.slice(0, limits.maxTextChars).trim()}…`;
    }
    const tags = Array.isArray(o.hashtags)
      ? o.hashtags
          .map((t) => String(t ?? '').trim().replace(/^#/, '').slice(0, 32))
          .filter(Boolean)
          .slice(0, limits.maxHashtags)
      : [];
    if (!texto && tags.length === 0) continue;
    if (limits.maxTotalTextChars != null && texto) {
      if (totalText >= limits.maxTotalTextChars) break;
      if (totalText + texto.length > limits.maxTotalTextChars) {
        texto = `${texto.slice(0, Math.max(0, limits.maxTotalTextChars - totalText)).trim()}…`;
      }
      totalText += texto.length;
    }
    out.push({
      tipo: String(o.kind ?? 'post'),
      texto,
      hashtags: tags,
    });
    if (out.length >= limits.maxItems) break;
  }
  return out;
}

/** Amostras enviadas ao Ollama (legendas curtas, poucas entradas). */
function buildPostTextSamplesForPrompt(profile: JsonRecord): PostTextSample[] {
  return extractPostTextSamplesFromProfile(profile, getPostSampleLimitsForPrompt());
}

/** Amostras para franc, mainCategory e validacao no servidor (mais texto). */
function buildPostTextSamplesForEvidence(profile: JsonRecord): PostTextSample[] {
  return extractPostTextSamplesFromProfile(profile, getPostSampleLimitsForEvidence());
}

function profileHasPostTextSamples(profile: JsonRecord): boolean {
  return buildPostTextSamplesForPrompt(profile).length > 0;
}

/** subs + contentPillars (ordem: subs primeiro), deduplicado por fold — evidencia para mainCategory no servidor. */
function mergeSubsAndPillarsForMainCategoryEvidence(subs: string[], pillars: string[], maxItems = 40): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of [...subs, ...pillars]) {
    const t = String(s ?? '').trim();
    if (!t) continue;
    const k = foldMainCategoryKey(t);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= maxItems) break;
  }
  return out;
}

/** Texto usado para cruzar pillars/subs com sinais da taxonomia (bio, nome, descoberta, amostras). */
function buildProfileFreeTextForCategoryEvidence(profile: JsonRecord): string {
  const parts: string[] = [];
  const fn = String(profile.full_name ?? '').trim();
  const bio = String(profile.biography ?? '').trim();
  const dv = String(profile._discovered_value ?? '').trim();
  if (fn) parts.push(fn);
  if (bio) parts.push(bio);
  if (dv) parts.push(dv);
  for (const s of buildPostTextSamplesForEvidence(profile)) {
    if (s.texto) parts.push(s.texto);
    if (s.hashtags.length > 0) parts.push(s.hashtags.join(' '));
  }
  return parts.join('\n');
}

/** Nome+bio+legendas (sem discovered_*): heuristica de language nao deve herdar termos de busca em PT. */
function buildAuthorialTextForLanguageOnly(profile: JsonRecord): string {
  const parts: string[] = [];
  parts.push(String(profile.full_name ?? '').trim());
  parts.push(String(profile.biography ?? '').trim());
  for (const s of buildPostTextSamplesForEvidence(profile)) {
    if (s.texto) parts.push(s.texto);
    if (s.hashtags.length > 0) parts.push(s.hashtags.join(' '));
  }
  return parts.join(' ');
}

function authorialBlobStrippedForLanguage(profile: JsonRecord): string {
  let blob = buildAuthorialTextForLanguageOnly(profile);
  blob = stripUrlsForLanguageHeuristic(blob);
  blob = stripAtMentionsForLanguageHeuristic(blob);
  return blob;
}

/** ISO 639-3 (franc) → qualification.language; `por` tratado na funcao (sempre pt-br). */
const FRANC_ISO6393_TO_BCP47: Readonly<Record<string, string>> = {
  eng: 'en',
  por: 'pt-br',
  spa: 'es',
  fra: 'fr',
  deu: 'de',
  ita: 'it',
  nld: 'nl',
  pol: 'pl',
  rus: 'ru',
  ukr: 'uk',
  swe: 'sv',
  nob: 'no',
  nno: 'no',
  dan: 'da',
  fin: 'fi',
  ell: 'el',
  hrv: 'hr',
  hun: 'hu',
  ces: 'cs',
  ron: 'ro',
  bul: 'bg',
  cat: 'ca-es',
};

/** Quando franc coloca `eng` no topo mas `por` vem perto, assume pt-BR (bios PT com termos em ingles). */
const FRANC_POR_ENG_MARGIN = 0.1;
/** Quando `por` vence por pouco sobre `spa`, desambigua com heuristica (PT/ES muito parecidos). */
const FRANC_POR_SPA_MARGIN = 0.12;

function normalizeFrancInputBlob(blob: string): string {
  return stripInvisibleFromString(blob).replace(/\s+/g, ' ').trim();
}

function francRankedForBlob(blob: string, francMinLen: number = 10): [string, number][] {
  const norm = normalizeFrancInputBlob(blob);
  if (norm.length < francMinLen) return [];
  return francAll(norm, { minLength: francMinLen });
}

function francScoreForIso3(ranked: [string, number][], iso3: string): number | undefined {
  const row = ranked.find((x) => x[0] === iso3);
  return row ? row[1] : undefined;
}

/** TLD/handle LATAM e outros — sinal forte quando a bio e curta ou franc ambiguo. */
function languageHintFromHandle(handle: string): string | null {
  const h = String(handle ?? '').trim().toLowerCase().replace(/^@/, '');
  if (!h) return null;
  const latamEs =
    /(?:^|[._-])(cl|ve|mx|ar|pe|uy|py|bo|ec|gt|cr|pa|do|hn|ni|sv|cu|pr|co)(?:$|[._-])/i.test(h) ||
    /\.(ve|mx|ar|cl|pe|uy|py|bo|ec|gt|cr|pa|do|hn|ni|sv|cu|pr|co)\b/i.test(h);
  if (latamEs) return 'es';
  if (/\.(br|com\.br)\b/i.test(h) || /(?:^|[._-])br(?:$|[._-])/i.test(h)) return 'pt-br';
  if (/\.(it|com\.it)\b/i.test(h)) return 'it';
  if (/\.(fr|com\.fr)\b/i.test(h)) return 'fr';
  if (/\.(de|com\.de)\b/i.test(h)) return 'de';
  return null;
}

function hasDistinctiveSpanishSignals(low: string): boolean {
  return (
    /\b(ti\s+misma|tu\s+momento|puedes\s+usar|contáctanos|contactanos|contáctenos|ubicación|ubicacion|tiendas\s+a\s+nivel|nivel\s+nacional|regalos|mañana|manana|para\s+las|solo\s+para\s+las|síguenos|siguenos|es\s+tu\s+momento|la\s+mejor\s+pieza|en\s+ti\s+misma)\b/iu.test(
      low
    ) ||
    /\b(confianza|contáct|ubicaci|regalos|premios|mañana|también|información|construyamos|construir|escena|electr[oó]nica|entre\s+todos|confirmado|festival|septiembre|patria|música|musica|nosotros|santiago|chile|bogot[aá]|méxico|mexico|argentina|colombia|per[uú]|caracas|lima)\b/iu.test(
      low
    ) ||
    (/\bsantiago\b/iu.test(low) && /\bcl\b/iu.test(low))
  );
}

function hasDistinctivePortugueseSignals(low: string): boolean {
  return (
    /\b(você|voce|não|nao|são|sao|também|tambem|obrigad|beleza|seguidores|brasil|parabéns|parabens|gratidão|gratidao|corinthiano|pagode|futebol|vocês|voces)\b/iu.test(
      low
    ) ||
    hasBrazilianFinancasAuthorialSignals(low)
  );
}

/** Bio/posts claramente em ingles (evita default pt-br em texto curto). */
function hasDistinctiveEnglishSignals(low: string): boolean {
  if (hasDistinctivePortugueseSignals(low) || authorialTextLikelyBrazilianPortuguese(low)) return false;
  return (
    /\b(sandwiches|spreads|coffee|nothing fancy|bagels|shop now|order online|official account|new york|brooklyn|manhattan|williamsburg|soho|follow us|link in bio|in the line)\b/iu.test(
      low
    ) ||
    /\b(the|and|with|for|your|you|our|we're|we are|this is|based in|founder|co-?founder|architect|architecture|building|design studio|content creator|subscribe|newsletter|podcast|learn more|get started|digital|software|artificial intelligence|\bai\b for)\b/iu.test(
      low
    )
  );
}

/** Finfluencer BR: muito ingles financeiro (stock, yield) mas texto e nicho em PT. */
function hasBrazilianFinancasAuthorialSignals(low: string): boolean {
  return /\b(finfluencer\s+financeir|finfluencer|educa[cç][aã]o\s+financeira|finan[cç]as|investimentos?|investidor[a]?|carteira\s+de\s+a[cç][oõ]es|bolsa\s+de\s+valores|\bb3\b|dividendos?|renda\s+fixa|tesouro\s+direto|cdb\b|poupan[cç]a|day\s*trade|criptomoedas?|independ[eê]ncia\s+financeira|planejamento\s+financeiro|reserva\s+de\s+emerg[eê]ncia)\b/iu.test(
    low
  );
}

function shouldPreferPtBrOverFrancEnglish(blob: string, handle: string, ranked: [string, number][]): boolean {
  const low = stripInvisibleFromString(blob).toLowerCase();
  if (languageHintFromHandle(handle) === 'pt-br') return true;
  if (hasDistinctivePortugueseSignals(low)) return true;
  const porScore = francScoreForIso3(ranked, 'por') ?? 0;
  if (porScore >= FRANC_ALT_MAPPED_MIN_SCORE && hasBrazilianFinancasAuthorialSignals(low)) return true;
  if (porScore >= 0.45 && /\b(você|voce|não|nao|pra\s|pro\s|tá\b|tô\b|né\b|aí\b)\b/iu.test(low)) return true;
  if (authorialTextLikelyBrazilianPortuguese(low)) return true;
  return false;
}

/** Texto com funcoes gramaticais PT (comum em bios/posts BR mesmo com termos EN). */
function authorialTextLikelyBrazilianPortuguese(low: string): boolean {
  const t = foldAsciiWs(low);
  if (t.length < 24) return false;
  const ptFunc =
    /\b(de|da|do|das|dos|com|para|que|não|nao|uma|um|uns|umas|os|as|em|no|na|nos|nas|por|mais|muito|também|tambem|você|voce|revista|moda|beleza|brasil)\b/giu;
  const hits = t.match(ptFunc);
  return (hits?.length ?? 0) >= 4;
}

/** Heuristica lexical quando franc devolve idioma nao mapeado (ex.: sco) ou ambiguo. */
function detectLanguageHeuristicFromBlob(blob: string, handle?: string): string | null {
  const low = stripInvisibleFromString(blob).toLowerCase();
  const handleHint = languageHintFromHandle(handle ?? '');
  if (!low.trim()) return handleHint;

  const ptStrong = hasDistinctivePortugueseSignals(low);
  const itStrong =
    /\b(informazione|edicola|provincia|giornal|notizie|elezioni|della\b|delle\b|degli\b|nell'|sull'|l'informazione|comune di|on demand)\b/iu.test(
      low
    );
  const enStrong = hasDistinctiveEnglishSignals(low);
  const esStrong =
    hasDistinctiveSpanishSignals(low) ||
    /\b(restaurante|noticias|información|informacion|más información|también|síguenos|pedidos|pero\b|más\b)\b/iu.test(low);
  const frStrong = /\b(boulangerie|restaurant|commander|suivez|paris|merci)\b/iu.test(low);

  if (itStrong && !ptStrong) return 'it';
  if (enStrong && !ptStrong) return 'en';
  if (esStrong && !ptStrong) return 'es';
  if (frStrong && !ptStrong) return 'fr';
  if (handleHint && handleHint !== 'pt-br' && !ptStrong) return handleHint;
  return null;
}

const FRANC_ALT_MAPPED_MIN_SCORE = 0.65;

/** Converte ranking franc em tag BCP-47; se o topo for nao mapeado (sco, und…), usa o melhor candidato mapeado. */
function resolveMappedLanguageFromFrancRanked(
  ranked: [string, number][],
  blob: string,
  handle: string
): string | null {
  if (ranked.length === 0) return null;
  const topCode = ranked[0][0];
  const topScore = ranked[0][1];
  if (!topCode || topCode === 'und') return null;
  const low = stripInvisibleFromString(blob).toLowerCase();

  if (topCode === 'por') {
    const spaScore = francScoreForIso3(ranked, 'spa') ?? 0;
    if (spaScore > topScore - FRANC_POR_SPA_MARGIN) {
      const h = detectLanguageHeuristicFromBlob(blob, handle);
      if (h === 'es') return 'es';
      if (hasDistinctiveSpanishSignals(low)) return 'es';
    }
    return 'pt-br';
  }

  if (topCode === 'spa') {
    const porScore = francScoreForIso3(ranked, 'por') ?? 0;
    if (porScore > topScore - FRANC_POR_SPA_MARGIN) {
      const h = detectLanguageHeuristicFromBlob(blob, handle);
      if (h === 'pt-br' || hasDistinctivePortugueseSignals(low)) return 'pt-br';
    }
    if (shouldPreferPtBrOverFrancEnglish(blob, handle, ranked)) return 'pt-br';
    return 'es';
  }

  if (topCode === 'eng') {
    const spaScore = francScoreForIso3(ranked, 'spa') ?? 0;
    if (spaScore > FRANC_ALT_MAPPED_MIN_SCORE && (hasDistinctiveSpanishSignals(low) || languageHintFromHandle(handle) === 'es')) {
      return 'es';
    }
    const porScore = francScoreForIso3(ranked, 'por') ?? 0;
    if (porScore > topScore - FRANC_POR_ENG_MARGIN) return 'pt-br';
    if (shouldPreferPtBrOverFrancEnglish(blob, handle, ranked)) return 'pt-br';
    return 'en';
  }

  if (topCode === 'fra') {
    const spaScore = francScoreForIso3(ranked, 'spa') ?? 0;
    if (spaScore > 0.8 && (hasDistinctiveSpanishSignals(low) || languageHintFromHandle(handle) === 'es')) {
      return 'es';
    }
    return 'fr';
  }

  const mappedTop = FRANC_ISO6393_TO_BCP47[topCode];
  if (mappedTop) {
    if (mappedTop === 'fr') {
      const spaScore = francScoreForIso3(ranked, 'spa') ?? 0;
      if (spaScore > 0.8 && (hasDistinctiveSpanishSignals(low) || languageHintFromHandle(handle) === 'es')) {
        return 'es';
      }
    }
    return mappedTop;
  }

  for (let i = 1; i < ranked.length; i++) {
    const code = ranked[i][0];
    const score = ranked[i][1];
    if (!code || code === 'und' || score < FRANC_ALT_MAPPED_MIN_SCORE) continue;
    if (code === 'por') {
      const spaScore = francScoreForIso3(ranked, 'spa') ?? 0;
      if (spaScore > score - FRANC_POR_SPA_MARGIN && hasDistinctiveSpanishSignals(low)) return 'es';
      return 'pt-br';
    }
    if (code === 'spa') return 'es';
    if (code === 'eng') {
      const porScore = francScoreForIso3(ranked, 'por') ?? 0;
      if (porScore > score - FRANC_POR_ENG_MARGIN) return 'pt-br';
      return 'en';
    }
    const alt = FRANC_ISO6393_TO_BCP47[code];
    if (alt) return alt;
  }
  return null;
}

/**
 * Idioma BCP-47 a partir do texto autoral (franc + heuristica).
 * Default pt-br so para texto curto/ambíguo sem sinais internacionais.
 */
function resolveLanguageFromFrancProfile(profile: JsonRecord): string {
  const handle = toHandle(profile.handle ?? '');
  const handleHint = languageHintFromHandle(handle);
  const letters = countAuthorialLettersForProfileEvidence(profile);
  const minFr = parseFrancMinAuthorialLetters();

  const blob = normalizeFrancInputBlob(authorialBlobStrippedForLanguage(profile));
  const blobLetters = countUnicodeLetters(blob);

  if (letters < minFr || blobLetters < minFr) {
    const low = stripInvisibleFromString(blob).toLowerCase();
    if (hasDistinctiveEnglishSignals(low)) return 'en';
    const h = detectLanguageHeuristicFromBlob(blob, handle);
    if (h && normalizeLanguageTagForExclusionRule(h) !== 'pt-br') return h;
    return handleHint ?? 'pt-br';
  }

  let ranked = francRankedForBlob(blob, 10);
  if ((ranked.length === 0 || ranked[0][0] === 'und') && letters >= 15) {
    ranked = francRankedForBlob(blob, 8);
  }

  const fromFranc =
    ranked.length > 0 ? resolveMappedLanguageFromFrancRanked(ranked, blob, handle) : null;
  if (fromFranc) {
    if (fromFranc === 'fr' && (handleHint === 'es' || hasDistinctiveSpanishSignals(stripInvisibleFromString(blob).toLowerCase()))) {
      return 'es';
    }
    if (fromFranc === 'en' && (handleHint === 'es' || hasDistinctiveSpanishSignals(stripInvisibleFromString(blob).toLowerCase()))) {
      const spaScore = francScoreForIso3(ranked, 'spa') ?? 0;
      if (spaScore > FRANC_ALT_MAPPED_MIN_SCORE || handleHint === 'es') return 'es';
    }
    if (fromFranc === 'en' && shouldPreferPtBrOverFrancEnglish(blob, handle, ranked)) {
      return 'pt-br';
    }
    return fromFranc;
  }

  const fromHeuristic = detectLanguageHeuristicFromBlob(blob, handle);
  if (fromHeuristic) return fromHeuristic;

  return handleHint ?? 'pt-br';
}

function stripUrlsForLanguageHeuristic(s: string): string {
  return s.replace(/https?:\/\/\S+/gi, ' ').replace(/\bwww\.\S+/gi, ' ');
}

function stripAtMentionsForLanguageHeuristic(s: string): string {
  return s.replace(/@[\w.]+/gu, ' ');
}

function countUnicodeLetters(s: string): number {
  const m = s.match(/\p{L}/gu);
  return m ? m.length : 0;
}

/** Letras reais em nome+bio+amostras (URLs e @ removidos) — base para teto de confidence e “pouco texto”. */
function countAuthorialLettersForProfileEvidence(profile: JsonRecord): number {
  let blob = buildAuthorialTextForLanguageOnly(profile);
  blob = stripUrlsForLanguageHeuristic(blob);
  blob = stripAtMentionsForLanguageHeuristic(blob);
  return countUnicodeLetters(blob);
}

/**
 * Teto de confidence pelo volume de texto autoral: evita 1.0 com bio vaga.
 * Ajuste fino via env QUALIFY_CONFIDENCE_CAP_* (opcional).
 */
function maxConfidenceFromAuthorialLetterCount(n: number): number {
  const r = (k: string, def: number) => {
    const v = Number(process.env[k]?.trim());
    return Number.isFinite(v) && v > 0 && v <= 1 ? v : def;
  };
  const c22 = r('QUALIFY_CONFIDENCE_CAP_UNDER_22', 0.28);
  const c32 = r('QUALIFY_CONFIDENCE_CAP_UNDER_32', 0.38);
  const c45 = r('QUALIFY_CONFIDENCE_CAP_UNDER_45', 0.48);
  const c70 = r('QUALIFY_CONFIDENCE_CAP_UNDER_70', 0.72);
  const c95 = r('QUALIFY_CONFIDENCE_CAP_UNDER_95', 0.88);
  if (n < 22) return c22;
  if (n < 32) return c32;
  if (n < 45) return c45;
  if (n < 70) return c70;
  if (n < 95) return c95;
  return 1;
}

function parseAuthorialLettersThinThreshold(): number {
  const v = Number(process.env.QUALIFY_AUTHORIAL_LETTERS_THIN?.trim());
  if (Number.isFinite(v) && v >= 12 && v <= 120) return Math.floor(v);
  return 32;
}

/** Minimo de letras autorais para rodar franc (independente do limiar “perfil fino” p/ confidence). */
function parseFrancMinAuthorialLetters(): number {
  const v = Number(process.env.QUALIFY_FRANC_MIN_LETTERS?.trim());
  if (Number.isFinite(v) && v >= 8 && v <= 64) return Math.floor(v);
  return 12;
}

/**
 * Incoerencia entre qualification.language e texto autoral: ajusta para tag internacional
 * e retorna motivo de exclusao (nao reparo LLM). O batch usa shouldExcludeByLanguageAndCreatorRules apos o ajuste.
 */
function tryExcludeByAuthorialLanguageMismatch(
  qualification: JsonRecord,
  profile: JsonRecord
): string | null {
  const langRaw = String(qualification.language ?? '').trim();
  const lang = normalizeLanguageTagForExclusionRule(langRaw);
  if (!lang || lang === 'desconhecido') return null;

  const blob = authorialBlobStrippedForLanguage(profile);

  if (/[\u0400-\u04FF]/u.test(blob) && isPortugueseLanguageTag(langRaw)) {
    qualification.language = 'ru';
    return 'Exclusao automatica: texto autoral em cirilico com language indicando portugues — idioma assumido internacional (ru), fora da politica pt-br';
  }
  if (/[\u0600-\u06FF\u0590-\u05FF]/u.test(blob) && isPortugueseLanguageTag(langRaw)) {
    qualification.language = 'en';
    return 'Exclusao automatica: texto autoral em script nao latino com language indicando portugues — idioma assumido internacional (en), fora da politica pt-br';
  }
  if (isPortugueseLanguageTag(langRaw)) {
    const handle = toHandle(profile.handle ?? '');
    const heuristic = detectLanguageHeuristicFromBlob(blob, handle);
    const handleHint = languageHintFromHandle(handle);
    const intl =
      heuristic && normalizeLanguageTagForExclusionRule(heuristic) !== 'pt-br'
        ? heuristic
        : handleHint && handleHint !== 'pt-br'
          ? handleHint
          : null;
    if (intl) {
      qualification.language = intl;
      return `Exclusao automatica: texto autoral indica idioma ${intl}, fora da politica pt-br`;
    }
  }
  return null;
}

const BEAUTY_CONTENT_PILLAR_FOLDS: ReadonlySet<string> = new Set(
  [
    'beleza',
    'maquiagem',
    'makeup',
    'make',
    'skincare',
    'cabelo',
    'unhas',
    'sobrancelha',
    'estetica',
    'cosmeticos',
    'perfumaria',
    'maquiador',
    'maquiadora',
  ].map((w) => foldMainCategoryKey(w))
);

function isBeautyOnlyContentPillars(pillars: string[]): boolean {
  if (pillars.length === 0) return false;
  for (const p of pillars) {
    const f = foldMainCategoryKey(String(p ?? '').trim());
    if (!f || !BEAUTY_CONTENT_PILLAR_FOLDS.has(f)) return false;
  }
  return true;
}

/** Bio/amostras sustentam rotulos de Beleza (regex + sinais ja pontuados em scoreMainCategoriesFromEvidence). */
function profileFreeTextSupportsBelezaEvidence(freeText: string): boolean {
  const t = foldAsciiWs(freeText);
  if (
    /\b(beleza|beauty|makeup|cosmeticos|maquiagem|maquiador[ao]?|skincare|cosmetic|cosmetico|perfum|sobrancelh|micropigment|brow|lashes?|manicure|pedicure|cabelo|cabelereiro|cabelereira|visagista|barbeiro|barbeira|dermatolog|estetic|barbearia|barber)\b/iu.test(
      t
    )
  ) {
    return true;
  }
  const scores = scoreMainCategoriesFromEvidence([], freeText);
  return categoriesAtMaxEvidenceScore(scores).includes('Beleza');
}

function categoriesAtMaxEvidenceScore(
  scores: Map<(typeof MAIN_CATEGORY_CANONICAL_LABELS)[number], number>
): (typeof MAIN_CATEGORY_CANONICAL_LABELS)[number][] {
  let max = 0;
  for (const v of scores.values()) max = Math.max(max, v);
  if (max === 0) return [];
  return MAIN_CATEGORY_CANONICAL_LABELS.filter((c) => (scores.get(c) ?? 0) === max);
}

/** gender feminino: aceita rotulos Beleza sem termos explicitos na bio/amostras (politica de produto). */
function beautyBioEvidenceWaivedForGender(qualification: JsonRecord): boolean {
  return String(qualification.gender ?? '').trim().toLowerCase() === 'feminino';
}

/** Evita pillars só de beleza quando a bio/amostras não sustentam (ex.: advogada sem menção a maquiagem). */
function validateContentPillarsAgainstProfileEvidence(
  qualification: JsonRecord,
  profile: JsonRecord
): string[] {
  const pillars = asStringArray(qualification.contentPillars, 100);
  if (!isBeautyOnlyContentPillars(pillars)) return [];
  if (beautyBioEvidenceWaivedForGender(qualification)) return [];

  const freeText = profileAuthorialEvidenceLow(profile).trim();
  if (freeText.length < 12) return [];

  if (!profileFreeTextSupportsBelezaEvidence(freeText)) {
    return [
      'contentPillars: rotulos so de beleza (ex.: beleza, maquiagem) sem evidencia na bio/amostras — use temas que aparecem nos dados',
    ];
  }
  return [];
}

/** subCategories que mapeiam para Beleza (ex.: maquiagem) exigem o mesmo suporte textual. */
function validateSubCategoriesBeautyAgainstProfileEvidence(
  qualification: JsonRecord,
  profile: JsonRecord
): string[] {
  const subs = asStringArray(qualification.subCategories, 100);
  let beautyScore = 0;
  for (const raw of subs) {
    const m = scoreSubCategoriesToMainCategories([String(raw ?? '').trim()]);
    beautyScore += m.get('Beleza') ?? 0;
  }
  if (beautyScore <= 0) return [];
  if (beautyBioEvidenceWaivedForGender(qualification)) return [];

  const freeText = profileAuthorialEvidenceLow(profile).trim();
  if (freeText.length < 12) return [];

  if (!profileFreeTextSupportsBelezaEvidence(freeText)) {
    return [
      'subCategories: rotulo de beleza (ex.: maquiagem) sem evidencia na bio/amostras — alinhe ao nicho real do perfil',
    ];
  }
  return [];
}

/** Evidencia de Beleza: so texto do perfil (bio/nome/handle/posts). Nunca personaSummary do LLM. */
function profileAuthorialTextForBeautyEvidence(profile: JsonRecord): string {
  return profileAuthorialEvidenceLow(profile).trim();
}

function subCategoryLabelMapsToBeleza(raw: string): boolean {
  const m = scoreSubCategoriesToMainCategories([String(raw ?? '').trim()]);
  return (m.get('Beleza') ?? 0) > 0;
}

/** Subs inventados (ex. Coração) com mainCategory Beleza — alinha a taxonomia. */
function fixBeautySubCategoriesWhenMainIsBeleza(qualification: JsonRecord): void {
  const mc = snapMainCategoryToTaxonomy(String(qualification.mainCategory ?? '').trim());
  if (mc !== 'Beleza') return;
  const subs = asStringArray(qualification.subCategories, 100);
  const mapped = subs.filter((s) => subCategoryLabelMapsToBeleza(s));
  if (mapped.length > 0) {
    qualification.subCategories = mapped;
    return;
  }
  if (subs.length > 0) qualification.subCategories = ['maquiagem'];
}

/** Remove subs que nao existem na taxonomia (ex. "Coracao" inventado pelo LLM). */
function dropSubCategoriesWithoutTaxonomyHit(qualification: JsonRecord): void {
  const subs = asStringArray(qualification.subCategories, 100);
  const kept = subs.filter((s) => {
    const m = scoreSubCategoriesToMainCategories([String(s)]);
    let max = 0;
    for (const v of m.values()) max = Math.max(max, v);
    return max > 0;
  });
  if (kept.length > 0 && kept.length !== subs.length) qualification.subCategories = kept;
}

function subCategoryLabelMapsToMusica(raw: string): boolean {
  const m = scoreSubCategoriesToMainCategories([String(raw ?? '').trim()]);
  return (m.get('Música') ?? 0) > 0;
}

function contentPillarLabelIsBeauty(raw: string): boolean {
  const f = foldMainCategoryKey(String(raw ?? '').trim());
  return Boolean(f && BEAUTY_CONTENT_PILLAR_FOLDS.has(f));
}

function profileAuthorialTextSupportsMusicaEvidence(authorialLow: string): boolean {
  const t = foldAsciiWs(authorialLow);
  const compact = t.replace(/\s+/g, '');
  if (
    /\b(m[uú]sico|musico|cantor[a]?|compositor[a]?|trio\b|dupla\b|banda\b|sertanejo|pagode|forr[oó]|dj\b|rapper|show\b|turn[eê]|fernand[aã]o)\b/iu.test(
      t
    )
  ) {
    return true;
  }
  if (/paradadura|trioparada|sertanejo|duplasertaneja|creone|fernandao|zezepo|mariliamendonca/i.test(compact)) {
    return true;
  }
  const scores = scoreMainCategoriesFromEvidence([], authorialLow);
  return categoriesAtMaxEvidenceScore(scores).includes('Música');
}

/** Handle/nome de artista (bio curta): ex. trioparada, cantor X oficial — nao confundir Fernandao do futebol. */
function profileHandleOrNameSuggestsMusicaArtist(profile: JsonRecord): boolean {
  if (profileHasPackagedConsumerBrandSignals(profile)) return false;
  const authorial = profileAuthorialEvidenceLow(profile);
  const scores = scoreMainCategoriesFromEvidence([], authorial);
  const sportScore = scores.get('Esportes') ?? 0;
  const musicScore = scores.get('Música') ?? 0;
  if (sportScore > musicScore && sportScore > 0) return false;
  if (/\b(futebol|futebolista|comentarista\s+esportivo|gol\b|atleta\b|libertadores|campeonato|copa\s+do)\b/iu.test(authorial)) {
    return false;
  }

  const handle = toHandle(profile.handle ?? '').toLowerCase();
  const fn = foldAsciiWs(String(profile.full_name ?? ''));
  const compact = `${handle}${fn.replace(/\s+/g, '')}`;
  if (/fernand[aã]o/i.test(compact)) {
    return /\b(sertanejo|cantor|cantora|dupla|banda|musica|m[uú]sica|show|turn[eê])\b/iu.test(authorial);
  }
  if (/sertanejo|cantor|cantora|duplasertane|trioparada|paradadura|zeze|marilia|gusttavo|henriqueejuliano|banda|pagodeiro/i.test(compact)) {
    return true;
  }
  if (/\d+oficial$/i.test(handle) && !/\b(loja|store|shop|marca|beer|cerveja|food|pizza|burger)\b/i.test(compact)) {
    if (/music|sertanej|cantor|banda|dupla|show|live|artist/i.test(compact)) return true;
    if (/zeze|luciano|marilia|henrique|juliano|gusttavo|soraya|rafa/i.test(compact)) return true;
  }
  return false;
}

function profileSupportsMusicaNiche(profile: JsonRecord): boolean {
  const authorial = profileAuthorialEvidenceLow(profile);
  return profileAuthorialTextSupportsMusicaEvidence(authorial) || profileHandleOrNameSuggestsMusicaArtist(profile);
}

function topMainCategoriesFromAuthorialEvidence(authorialLow: string, limit = 5): (typeof MAIN_CATEGORY_CANONICAL_LABELS)[number][] {
  const scores = scoreMainCategoriesFromEvidence([], authorialLow);
  return [...MAIN_CATEGORY_CANONICAL_LABELS]
    .map((c) => ({ c, s: scores.get(c) ?? 0 }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.c);
}

function formatMainCategoryTaxonomyForPromptWithHints(hints: (typeof MAIN_CATEGORY_CANONICAL_LABELS)[number][]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of hints) {
    const k = foldMainCategoryKey(c);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(c);
    }
  }
  for (const c of MAIN_CATEGORY_CANONICAL_LABELS) {
    const k = foldMainCategoryKey(c);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(c);
    }
  }
  return out.join(' | ');
}

function buildTextualEvidencePromptHints(profile: JsonRecord): string {
  const authorial = profileAuthorialEvidenceLow(profile);
  const top = topMainCategoriesFromAuthorialEvidence(authorial, 5);
  if (top.length === 0) {
    return 'PROIBIDO chutar Beleza/maquiagem/skincare em subCategories ou contentPillars se NENHUM dado citar cosmeticos/make (gender nao feminino). Prefira o nicho que aparecer no handle, nome e bio.';
  }
  return `Pistas do servidor a partir do texto (bio/nome/posts): vitrines com sinal: ${top.join(', ')}. Alinhe subCategories, contentPillars e mainCategory a essas pistas — NUNCA Beleza/maquiagem sem termos de make/cosmeticos nos dados (salvo gender feminino).`;
}

function subCategoriesFromEvidenceWinners(
  winners: (typeof MAIN_CATEGORY_CANONICAL_LABELS)[number][],
  qualification: JsonRecord
): string[] {
  if (winners.includes('Música')) return ['sertanejo'];
  if (winners.includes('Beleza')) return ['maquiagem'];
  if (winners.includes('Alimentação')) return ['food'];
  if (winners.includes('Negócios')) return ['negocios'];
  if (winners.includes('Esportes')) return ['futebol'];
  if (winners.includes('Entretenimento')) return ['tv'];
  if (winners.includes('Moda')) return ['moda'];
  const pt = String(qualification.profileType ?? '').trim().toLowerCase();
  if (pt === 'empresa' || pt === 'marca' || pt === 'midia') return ['negocios'];
  return ['tv'];
}

function inferSubCategoriesFromAuthorialEvidence(
  authorialLow: string,
  qualification: JsonRecord,
  profile: JsonRecord
): string[] {
  if (profileHasPackagedConsumerBrandSignals(profile)) return ['food'];
  if (profileSupportsMusicaNiche(profile)) return ['sertanejo'];
  if (profileAuthorialTextSupportsMusicaEvidence(authorialLow)) return ['sertanejo'];
  if (authorialLow.trim().length >= 8) {
    const scores = scoreMainCategoriesFromEvidence([], authorialLow);
    const winners = categoriesAtMaxEvidenceScore(scores);
    if (winners.length > 0) return subCategoriesFromEvidenceWinners(winners, qualification);
    const top = topMainCategoriesFromAuthorialEvidence(authorialLow, 1);
    if (top.length > 0) return subCategoriesFromEvidenceWinners(top, qualification);
  }
  const pt = String(qualification.profileType ?? '').trim().toLowerCase();
  if (pt === 'empresa' || pt === 'marca' || pt === 'midia') return ['negocios'];
  return ['tv'];
}

function correctUnsupportedMusicSubInQualification(profile: JsonRecord, qualification: JsonRecord): void {
  const subsIn = asStringArray(qualification.subCategories, 100);
  if (subsIn.length === 0 || !subsIn.every((s) => subCategoryLabelMapsToMusica(s))) return;

  const authorial = profileAuthorialEvidenceLow(profile);
  const persona = String(qualification.personaSummary ?? '').trim();
  const ctxForMusic = persona.length >= 20 ? `${authorial}\n${persona}` : authorial;
  if (profileAuthorialTextSupportsMusicaEvidence(ctxForMusic)) return;

  const beautyEvidence = profileFreeTextSupportsBelezaEvidence(profileAuthorialTextForBeautyEvidence(profile));
  const authorialWinners = categoriesAtMaxEvidenceScore(scoreMainCategoriesFromEvidence([], authorial));
  const shouldRealign =
    beautyEvidence ||
    qualificationSuggestsBeautyNiche(qualification) ||
    (authorialWinners.length > 0 && !authorialWinners.includes('Música'));

  if (!shouldRealign) return;
  qualification.subCategories = inferSubCategoriesFromAuthorialEvidence(authorial, qualification, profile);
}

function qualificationSuggestsBeautyNiche(qualification: JsonRecord): boolean {
  const ps = foldAsciiWs(String(qualification.personaSummary ?? ''));
  if (
    /\b(beleza|autocuidado|maquiagem|skincare|cosmeticos|estetica|makeup)\b/iu.test(ps)
  ) {
    return true;
  }
  const pillars = asStringArray(qualification.contentPillars, 100);
  for (const p of pillars) {
    if (contentPillarLabelIsBeauty(p)) return true;
    if (foldMainCategoryKey(String(p ?? '')) === foldMainCategoryKey('autocuidado')) return true;
  }
  return false;
}

/** Marca global de bebida/alimento embalado (ex.: @cocacola) — nunca vitrine Beleza. */
function profileHasPackagedConsumerBrandSignals(profile: JsonRecord): boolean {
  const handle = toHandle(profile.handle ?? '').toLowerCase();
  const fn = String(profile.full_name ?? '').normalize('NFC').toLowerCase();
  const low = profileAuthorialEvidenceLow(profile);
  const blob = `${handle}\n${fn}\n${low}`;
  if (/^(cocacola|pepsi|redbull|heineken|sprite|fanta|guarana|nestle)$/i.test(handle)) return true;
  return /\b(cocacola|coca[\s-]?cola|pepsi|red[\s-]?bull|refrigerante|soft\s+drink|bebida\s+gaseificada|marca\s+de\s+bebida)\b/iu.test(
    blob
  );
}

function personaSummaryImpliesBeautyNiche(personaSummary: string): boolean {
  const ps = foldAsciiWs(personaSummary);
  return /\b(beleza|autocuidado|maquiagem|skincare|cosmeticos|estetica|makeup|tutorial\s+de\s+make)\b/iu.test(ps);
}

function profileAuthorialTextSupportsFinancasEvidence(authorialLow: string): boolean {
  const t = foldAsciiWs(authorialLow);
  if (hasBrazilianFinancasAuthorialSignals(t)) return true;
  const scores = scoreMainCategoriesFromEvidence([], authorialLow);
  return categoriesAtMaxEvidenceScore(scores).includes('Finanças');
}

function subCategoryMapsToFinancas(raw: string): boolean {
  const m = scoreSubCategoriesToMainCategories([String(raw ?? '').trim()]);
  return (m.get('Finanças') ?? 0) > 0;
}

function subCategoriesLookLikeLifestyleNoiseForFinanceProfile(subs: string[]): boolean {
  if (subs.length === 0) return false;
  return subs.every((s) => {
    if (subCategoryMapsToFinancas(s)) return false;
    const f = foldMainCategoryKey(String(s ?? ''));
    if (f === foldMainCategoryKey('tatuagem') || f === foldMainCategoryKey('festa')) return true;
    const m = scoreSubCategoriesToMainCategories([String(s)]);
    return (m.get('Lifestyle') ?? 0) > 0 || (m.get('Entretenimento') ?? 0) > 0;
  });
}

function correctMisclassifiedLifestyleWhenFinancasEvidence(
  profile: JsonRecord,
  qualification: JsonRecord
): void {
  const authorial = profileAuthorialEvidenceLow(profile);
  if (!profileAuthorialTextSupportsFinancasEvidence(authorial)) return;

  const mc = snapMainCategoryToTaxonomy(String(qualification.mainCategory ?? '').trim());
  const subs = asStringArray(qualification.subCategories, 100);
  const mcOk = mc === 'Finanças';
  const hasFinSub = subs.some((s) => subCategoryMapsToFinancas(s));
  if (mcOk && hasFinSub) return;

  const needsFix =
    !mcOk ||
    subCategoriesLookLikeLifestyleNoiseForFinanceProfile(subs);
  if (!needsFix) return;

  qualification.mainCategory = 'Finanças';
  qualification.subCategories = ['investimentos'];
  qualification.profileType = 'criador';
  let pillars = asStringArray(qualification.contentPillars, 100).filter((p) => {
    const f = foldMainCategoryKey(String(p ?? ''));
    return f !== foldMainCategoryKey('tatuagem') && f !== foldMainCategoryKey('festa');
  });
  if (pillars.length === 0) pillars = ['investimentos'];
  qualification.contentPillars = pillars;
}

function validateSubCategoriesFinancasAgainstProfileEvidence(
  qualification: JsonRecord,
  profile: JsonRecord
): string[] {
  const authorial = profileAuthorialEvidenceLow(profile).trim();
  if (!profileAuthorialTextSupportsFinancasEvidence(authorial)) return [];

  const subs = asStringArray(qualification.subCategories, 100);
  if (!subCategoriesLookLikeLifestyleNoiseForFinanceProfile(subs)) return [];

  return [
    'subCategories: perfil com sinais de financas/investimentos (finfluencer) — use subs do mapa (investimentos, bolsa, economia…), nunca tatuagem/festa/lifestyle sem evidencia',
  ];
}

function personaSummaryIsGenericBoilerplate(personaSummary: string): boolean {
  const t = foldAsciiWs(personaSummary);
  if (t.length < 16) return true;
  if (/descricao editorial agregada do nicho/i.test(t)) return true;
  if (/sem foco em beleza ou cosmeticos/i.test(t)) return true;
  if (/alinhado ao nicho publico do perfil/i.test(t)) return true;
  if (/^conteudo de criador alinhado\b/i.test(t)) return true;
  if (/^conteudo editorial alinhado\b/i.test(t)) return true;
  if (
    /^conteudo (musical|esportivo|institucional)\b/i.test(t) &&
    /tom (informativo|proximo|profissional)/i.test(t) &&
    t.length < 120
  ) {
    return !/\b(apresentador|jornalist|ator|humor|chef|nutri|advogad|medico|influencer|digital|podcast|novela|serie|receita|treino|viagem)\b/iu.test(
      t
    );
  }
  return false;
}

function correctMisclassifiedFoodOrGenericWhenMusicaArtist(
  profile: JsonRecord,
  qualification: JsonRecord
): void {
  if (!profileSupportsMusicaNiche(profile)) return;
  if (/\b(futebol|futebolista|comentarista\s+esportivo)\b/iu.test(profileAuthorialEvidenceLow(profile))) return;

  const subsIn = asStringArray(qualification.subCategories, 100);
  const mcSnapped = snapMainCategoryToTaxonomy(String(qualification.mainCategory ?? '').trim());
  const subsMapToFood =
    subsIn.length > 0 &&
    subsIn.every((s) => {
      const f = foldMainCategoryKey(String(s ?? ''));
      return (
        f === foldMainCategoryKey('food') ||
        (scoreSubCategoriesToMainCategories([String(s)]).get('Alimentação') ?? 0) > 0
      );
    });
  const mcIsFood = mcSnapped === 'Alimentação';

  if (!mcIsFood && !subsMapToFood && mcSnapped === 'Música') return;

  qualification.subCategories = ['sertanejo'];
  let pillars = asStringArray(qualification.contentPillars, 100).filter(
    (p) => foldMainCategoryKey(String(p)) !== foldMainCategoryKey('food')
  );
  if (pillars.length === 0) pillars = ['sertanejo'];
  qualification.contentPillars = pillars;
  qualification.mainCategory = 'Música';
  qualification.profileType = 'criador';
}

/** Alimentacao/food sem evidencia gastronomica mas persona ou perfil de beleza (ex. maquiagem + receitas caseiras). */
function correctMisclassifiedFoodWhenBelezaEvidence(
  profile: JsonRecord,
  qualification: JsonRecord
): void {
  const mc = snapMainCategoryToTaxonomy(String(qualification.mainCategory ?? '').trim());
  const subs = asStringArray(qualification.subCategories, 100);
  const subsFood =
    mc === 'Alimentação' ||
    subs.some((s) => {
      const f = foldMainCategoryKey(String(s));
      return (
        f === foldMainCategoryKey('food') ||
        (scoreSubCategoriesToMainCategories([String(s)]).get('Alimentação') ?? 0) > 0
      );
    });
  if (!subsFood) return;

  const authorial = profileAuthorialEvidenceLow(profile);
  const ps = String(qualification.personaSummary ?? '');
  const personaBeauty = personaSummaryImpliesBeautyNiche(ps);
  const authorialBeauty = profileFreeTextSupportsBelezaEvidence(authorial);
  const pillars = asStringArray(qualification.contentPillars, 100);
  const pillarBeauty =
    isBeautyOnlyContentPillars(pillars) || pillars.some((p) => contentPillarLabelIsBeauty(p));
  if (!personaBeauty && !authorialBeauty && !pillarBeauty) return;

  const scores = scoreMainCategoriesFromEvidence([], authorial);
  const beauty = scores.get('Beleza') ?? 0;
  const food = scores.get('Alimentação') ?? 0;
  if (!personaBeauty && beauty <= food && !authorialBeauty) return;

  qualification.mainCategory = 'Beleza';
  qualification.subCategories = ['maquiagem'];
  qualification.profileType = 'criador';
  const pillarsFiltered = pillars.filter((p) => {
    const f = foldMainCategoryKey(String(p));
    return f !== foldMainCategoryKey('food') && f !== foldMainCategoryKey('coração');
  });
  if (pillarsFiltered.length > 0) qualification.contentPillars = pillarsFiltered;
}

/** Persona fala de futebol/esporte mas vitrine veio Musica/Alimentacao por heuristica ou LLM. */
function reconcileMainCategoryWhenPersonaContradictsLabels(
  profile: JsonRecord,
  qualification: JsonRecord
): void {
  const ps = foldAsciiWs(String(qualification.personaSummary ?? '').trim());
  if (!ps) return;
  const mc = snapMainCategoryToTaxonomy(String(qualification.mainCategory ?? '').trim());
  const esportesPersona =
    /\b(comentarista\s+esportivo|futebol|futebolista|atleta\b|esporte\b|palmeiras|corinthians|libertadores)\b/iu.test(ps);
  if (!esportesPersona) return;
  if (mc === 'Esportes') return;
  qualification.mainCategory = 'Esportes';
  qualification.subCategories = ['futebol'];
  qualification.profileType = 'criador';
  const pillars = asStringArray(qualification.contentPillars, 100).filter(
    (p) => foldMainCategoryKey(String(p)) !== foldMainCategoryKey('food')
  );
  if (pillars.length > 0) qualification.contentPillars = pillars;
}

/** Alimentacao/food sem evidencia gastronomica mas perfil esportivo (ex. comentarista). */
function correctMisclassifiedFoodWhenEsportesEvidence(
  profile: JsonRecord,
  qualification: JsonRecord
): void {
  const mc = snapMainCategoryToTaxonomy(String(qualification.mainCategory ?? '').trim());
  const subs = asStringArray(qualification.subCategories, 100);
  const subsFood =
    mc === 'Alimentação' ||
    subs.some((s) => foldMainCategoryKey(String(s)) === foldMainCategoryKey('food'));
  if (!subsFood) return;

  const authorial = profileAuthorialEvidenceLow(profile);
  const scores = scoreMainCategoriesFromEvidence([], authorial);
  const sport = scores.get('Esportes') ?? 0;
  const food = scores.get('Alimentação') ?? 0;
  const ps = foldAsciiWs(String(qualification.personaSummary ?? ''));
  const esportesText =
    sport > food ||
    /\b(futebol|futebolista|comentarista\s+esportivo|atleta\b|esporte\b)\b/iu.test(authorial) ||
    /\b(futebol|comentarista\s+esportivo)\b/iu.test(ps);
  if (!esportesText) return;

  qualification.mainCategory = 'Esportes';
  qualification.subCategories = ['futebol'];
  qualification.profileType = 'criador';
}

/** Persona ou rotulos Beleza sem sustentacao na bio/handle/posts — corrige categorias; persona fica com o LLM (reparo se invalida). */
function fixPersonaAndQualificationWhenBeautyHallucinated(profile: JsonRecord, qualification: JsonRecord): void {
  if (beautyBioEvidenceWaivedForGender(qualification)) return;

  const authorial = profileAuthorialTextForBeautyEvidence(profile);
  const authorialSupportsBeleza = profileFreeTextSupportsBelezaEvidence(authorial);
  const ps = String(qualification.personaSummary ?? '').trim();
  const personaBeauty = ps.length > 0 && personaSummaryImpliesBeautyNiche(ps);

  const subs = asStringArray(qualification.subCategories, 100);
  const pillars = asStringArray(qualification.contentPillars, 100);
  const mcSnapped = snapMainCategoryToTaxonomy(String(qualification.mainCategory ?? '').trim());
  const qualBeauty =
    mcSnapped === 'Beleza' ||
    subs.some((s) => subCategoryLabelMapsToBeleza(s)) ||
    pillars.some((p) => contentPillarLabelIsBeauty(p));

  if (authorialSupportsBeleza && !personaBeauty && !qualBeauty) return;
  if (!personaBeauty && !qualBeauty) return;
  if (authorialSupportsBeleza && !profileAuthorialTextSupportsMusicaEvidence(authorial)) return;

  correctUnsupportedBeautyLabelsInQualification(profile, qualification);
}

/**
 * LLM rotula Beleza/maquiagem sem texto que sustente (comum em marcas e perfis masculinos).
 * Remove rotulos Beleza e realinha subs/pilares/mainCategory a partir do perfil.
 */
function correctUnsupportedBeautyLabelsInQualification(profile: JsonRecord, qualification: JsonRecord): void {
  if (beautyBioEvidenceWaivedForGender(qualification)) return;

  const authorial = profileAuthorialTextForBeautyEvidence(profile);
  if (profileFreeTextSupportsBelezaEvidence(authorial) && !profileSupportsMusicaNiche(profile)) {
    return;
  }

  const subsIn = asStringArray(qualification.subCategories, 100);
  const pillarsIn = asStringArray(qualification.contentPillars, 100);
  const mcSnapped = snapMainCategoryToTaxonomy(String(qualification.mainCategory ?? '').trim());
  const mcIsBeleza = mcSnapped === 'Beleza';

  const hadBeautySubs = subsIn.some((s) => subCategoryLabelMapsToBeleza(s) || foldMainCategoryKey(s) === foldMainCategoryKey('skincare'));
  const hadBeautyPillars = pillarsIn.some(
    (p) => contentPillarLabelIsBeauty(p) || foldMainCategoryKey(String(p ?? '')) === foldMainCategoryKey('autocuidado')
  );
  const musicAuthorial = profileSupportsMusicaNiche(profile);
  if (!hadBeautySubs && !hadBeautyPillars && !mcIsBeleza) {
    if (!musicAuthorial) return;
  }

  let subs = subsIn.filter((s) => !subCategoryLabelMapsToBeleza(s) && foldMainCategoryKey(s) !== foldMainCategoryKey('skincare'));
  if (subs.length === 0) subs = inferSubCategoriesFromAuthorialEvidence(authorial, qualification, profile);

  let pillars = pillarsIn.filter(
    (p) => !contentPillarLabelIsBeauty(p) && foldMainCategoryKey(String(p ?? '')) !== foldMainCategoryKey('autocuidado')
  );
  if (pillars.length === 0 && subs.length > 0) {
    pillars = musicAuthorial ? ['sertanejo'] : [subs[0]!];
  }

  qualification.subCategories = subs;
  if (pillars.length > 0) qualification.contentPillars = pillars;

  if (mcIsBeleza || hadBeautySubs || musicAuthorial) {
    const merged = mergeSubsAndPillarsForMainCategoryEvidence(subs, pillars);
    const ctx = buildProfileContextForMainCategoryEvidence(profile);
    const seedMain = musicAuthorial ? 'Música' : inferMainCategory(subs);
    const resolved = resolveMainCategoryWithEvidence(seedMain, merged, ctx);
    const parsed = parseMainCategory(resolved) ?? resolved;
    qualification.mainCategory = parsed;
  }

  if (musicAuthorial) {
    const pt = String(qualification.profileType ?? '').trim().toLowerCase();
    if (pt === 'pessoal' || pt === 'empresa') qualification.profileType = 'criador';
  }
}

function validationErrorsMentionBeautyEvidence(errors: string[]): boolean {
  return errors.some((e) => {
    const x = e.toLowerCase();
    return (
      x.includes('beleza') ||
      x.includes('maquiagem') ||
      (x.includes('contentpillars') && x.includes('beleza')) ||
      (x.includes('subcategories') && (x.includes('beleza') || x.includes('maquiagem')))
    );
  });
}

function resolveAutoExclusionAfterValidationExhausted(
  qualification: JsonRecord,
  profile: JsonRecord,
  validationMessage: string
): string | null {
  if (validationErrorsMentionBeautyEvidence([validationMessage])) return null;
  return resolveAutoExclusionReason(qualification, profile);
}

function tryServerCorrectBeautyAndRevalidate(
  llm: LlmClassification,
  workingProfile: JsonRecord,
  model: string,
  maxReasoning: number,
  languageFromFranc: string,
  pillarValidationOpts: QualificationValidationOptions,
  logStep: (msg: string) => void
): { llm: LlmClassification; validationErrors: string[] } | null {
  const qualFix = asObject(llm.qualification);
  correctUnsupportedMusicSubInQualification(workingProfile, qualFix);
  correctUnsupportedBeautyLabelsInQualification(workingProfile, qualFix);
  const raw = {
    qualification: qualFix,
    confidence: llm.confidence,
    status: llm.status,
  };
  const fixed = normalizeClassification(
    raw,
    workingProfile,
    model,
    maxReasoning,
    languageFromFranc,
    pillarValidationOpts
  );
  const errors = validateLlmClassification(fixed, workingProfile, pillarValidationOpts);
  if (errors.length === 0) {
    logStep('>> ok: servidor realinhou categorias (Beleza/musica sem evidencia autoral)');
    return { llm: fixed, validationErrors: [] };
  }
  return null;
}

function validationErrorsRelateToPersonaSummary(errors: string[]): boolean {
  return errors.some((e) => e.toLowerCase().includes('personasummary'));
}

/** persona ou pillars incoerentes com bio: vale buscar amostras de posts no reparo. */
function validationErrorsSuggestEnrichingWithPostSamples(errors: string[]): boolean {
  return errors.some((e) => {
    const x = e.toLowerCase();
    return (
      x.includes('personasummary') ||
      x.includes('contentpillars') ||
      x.includes('subcategories:')
    );
  });
}

function normalizeWs(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** subCategories, contentPillars, audienceType: um rótulo macro por string (sem espaços nem vírgulas). */
function validateMacroLabelArray(field: string, arr: string[]): string[] {
  const errors: string[] = [];
  for (const raw of arr) {
    const s = stripInvisibleFromString(String(raw ?? '')).trim();
    if (!s) {
      errors.push(`${field}: item vazio apos trim`);
      continue;
    }

    if (/[,;]/u.test(s)) {
      errors.push(
        `${field}: sem virgula ou ponto-e-virgula dentro do item — um rotulo por string; item: ${JSON.stringify(s)}`
      );
    }
    if (s.length > 48) {
      errors.push(`${field}: item muito longo (max 48 caracteres) — use uma palavra macro`);
    }
  }
  return errors;
}

const GENERIC_CONTENT_PILLAR_FOLDS: ReadonlySet<string> = new Set(
  [
    'amor',
    'motivacao',
    'dicas',
    'vida',
    'conteudo',
    'inspiracao',
    'felicidade',
    'positividade',
    'frases',
    'citacoes',
    'geral',
    'variedades',
    'bastidores',
    'stories',
    'daily',
    'gratidao',
    'reflexao',
    'pensamentos',
    'citacao',
    'amizade',
    'motivacional',
    'quotes',
    'quote',
    'love',
    'happy',
    'amores',
    'mensagens',
  ].map((w) => foldMainCategoryKey(w))
);

const CONTENT_PILLAR_FALLBACK_LABEL = 'Outros';

function isContentPillarsOnlyOutrosFallback(contentPillars: string[]): boolean {
  const pillars = asStringArray(contentPillars, 100);
  if (pillars.length !== 1) return false;
  return foldMainCategoryKey(String(pillars[0] ?? '')) === foldMainCategoryKey(CONTENT_PILLAR_FALLBACK_LABEL);
}

/** Pilares vazios: preenche Outros só quando allowOutrosFallback (ultima tentativa / fallback pos-reparo). */
function ensureContentPillarsFallback(qualification: JsonRecord, allowOutrosFallback: boolean): void {
  const pillars = asStringArray(qualification.contentPillars, 100);
  if (pillars.length === 0) {
    qualification.contentPillars = allowOutrosFallback ? [CONTENT_PILLAR_FALLBACK_LABEL] : [];
  } else {
    qualification.contentPillars = pillars;
  }
}

function validateContentPillarsOutrosReservedForLastAttempt(
  contentPillars: string[],
  allowOutrosFallback: boolean
): string[] {
  if (allowOutrosFallback) return [];
  if (isContentPillarsOnlyOutrosFallback(contentPillars)) {
    return [
      `contentPillars: rotulo "${CONTENT_PILLAR_FALLBACK_LABEL}" so e permitido na ultima tentativa — escolha temas concretos do perfil (uma palavra, sustentados nos dados).`,
    ];
  }
  return [];
}

function validationErrorsMentionContentPillars(errors: string[]): boolean {
  return errors.some((e) => e.toLowerCase().includes('contentpillars'));
}

function validateContentPillarsNotTooGeneric(contentPillars: string[]): string[] {
  if (contentPillars.length === 0) return [];
  let gen = 0;
  for (const p of contentPillars) {
    const f = foldMainCategoryKey(String(p ?? '').trim());
    if (f && GENERIC_CONTENT_PILLAR_FOLDS.has(f)) gen++;
  }
  if (contentPillars.length >= 2 && gen >= contentPillars.length) {
    return [
      `contentPillars: itens so genericos (${contentPillars.join(', ')}) — troque por temas ESPECIFICOS do conteudo (ex.: relacionamentos, maquiagem, receitas), uma palavra, sustentados nos dados.`,
    ];
  }
  if (contentPillars.length >= 3 && gen >= Math.ceil(contentPillars.length * 0.6)) {
    return [
      `contentPillars: maioria generica (${contentPillars.join(', ')}) — pilares devem nomear o nicho concreto, nao placeholders.`,
    ];
  }
  return [];
}

/** Dobra acentos para checagens de qualidade (evita regex quebrar em pt-BR). */
function foldAsciiWs(s: string): string {
  return stripInvisibleFromString(s)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Bloqueia templates/lixo comuns do LLM em personaSummary. */
function validatePersonaSummaryQuality(personaSummary: string): string[] {
  const t = foldAsciiWs(personaSummary);
  const errors: string[] = [];
  if (/recepcao de (cafe|alimento|comida)/u.test(t)) {
    errors.push(
      'personaSummary: evite "recepcao de cafe/alimentos" — descreva o negocio e o publico com frases naturais'
    );
  }
  if (/recepcoes de/u.test(t)) {
    errors.push(
      'personaSummary: evite "recepcoes de ..." — reescreva o nicho com vocabulario proprio'
    );
  }
  if (/periodo de tempo dedicad/u.test(t)) {
    errors.push(
      'personaSummary: texto tipo template ou truncado ("periodo de tempo dedicado...") — reescreva de forma clara'
    );
  }
  if (/\bde\s*,|\bdo\s*,|\bda\s*,|\bespecificamente\s+o\s+em\b|\brelacionad[oa]\s+a\s+eventos\s+de\s*,/iu.test(t)) {
    errors.push(
      'personaSummary: frase quebrada (preposicao ou artigo sem complemento) — reescreva em portugues natural, sem buracos'
    );
  }
  if (personaSummaryIsGenericBoilerplate(t)) {
    errors.push(
      'personaSummary: descreva o nicho e o tipo de conteudo do influenciador (temas, formato, publico), sem frases genericas de template'
    );
  }
  if (/\b(da|do|de)\s*,/iu.test(t) || /\brevista\s*,/iu.test(t)) {
    errors.push('personaSummary: frase incompleta ou com buraco editorial — reescreva em portugues natural');
  }
  if (personaSummaryHasEditorialHoles(personaSummary)) {
    errors.push(
      'personaSummary: frase incompleta ou com buraco editorial — reescreva em portugues natural, sem virgulas vazias ou artigos soltos'
    );
  }
  return errors;
}

/** Garante personaSummary descritivo, sem copiar dados brutos do perfil. */
function validatePersonaSummaryAgainstProfile(personaSummary: string, profile: JsonRecord): string[] {
  const errors: string[] = [];
  const ps = personaSummary.trim();
  if (ps.includes('@')) {
    errors.push('personaSummary nao pode conter @ nem mencoes a usuarios');
  }
  const handle = toHandle(profile.handle ?? '');
  if (handle.length >= 2 && ps.toLowerCase().includes(handle)) {
    errors.push('personaSummary nao pode conter o handle do perfil');
  }
  const fullName = String(profile.full_name ?? '').trim();
  if (fullName.length > 0) {
    const fnNorm = normalizeWs(fullName);
    if (fnNorm.length >= 4 && normalizeWs(ps).includes(fnNorm)) {
      errors.push('personaSummary nao pode repetir o nome completo publico do perfil');
    }
    for (const token of fullName.split(/\s+/)) {
      const cleaned = token.replace(/[^\p{L}\p{N}]/gu, '');
      if (cleaned.length < 4) continue;
      try {
        const re = new RegExp(`\\b${escapeRegexChars(cleaned)}\\b`, 'iu');
        if (re.test(ps)) {
          errors.push(
            'personaSummary nao pode incluir o nome publico do criador; use descricao agregada (ex.: "criadora de conteudo sobre...")'
          );
          break;
        }
      } catch {
        /* ignore token que quebra regex */
      }
    }
  }
  const bio = String(profile.biography ?? '').trim();
  const bioNorm = normalizeWs(bio);
  if (bioNorm.length >= 28) {
    const take = Math.min(56, bioNorm.length);
    const chunk = bioNorm.slice(0, take);
    if (normalizeWs(ps).includes(chunk)) {
      errors.push('personaSummary nao pode copiar a biografia; reescreva com outras palavras, em tom descritivo');
    }
  }

  return errors;
}

/** Corta substring e tokens de _discovered_value (>=5 chars) para passar na validacao sem novo LLM. */
function stripDiscoveredFragmentsFromSummary(text: string, discoveredValue: string): string {
  let out = text.trim();
  const disc = discoveredValue.trim();
  if (disc.length < 5) return repairPersonaSummaryBrokenPhrasing(out);
  /* Termos curtos (cidade, nicho) sozinhos: remover o trecho inteiro quebra a frase; validacao barra copia literal. */
  if (disc.length < 12) return repairPersonaSummaryBrokenPhrasing(out);
  try {
    out = out.replace(new RegExp(escapeRegexChars(disc), 'giu'), ' ');
  } catch {
    return repairPersonaSummaryBrokenPhrasing(out);
  }
  /* So palavras longas (ex.: slug de campanha); termos curtos tipo cidade/nicho quebram a frase ("eventos de ,"). */
  for (const part of disc.split(/[\s,;|/]+/)) {
    const p = part.trim();
    if (p.length < 14) continue;
    try {
      out = out.replace(new RegExp(`\\b${escapeRegexChars(p)}\\b`, 'giu'), ' ');
    } catch {
      /* ignore */
    }
  }
  return repairPersonaSummaryBrokenPhrasing(out.replace(/\s+/g, ' ').trim());
}

/** Conserta buracos comuns quando tokens foram removidos do meio da frase. */
function personaSummaryHasEditorialHoles(personaSummary: string): boolean {
  const raw = String(personaSummary ?? '');
  const t = foldAsciiWs(raw);
  if (/,(\s*,)+/u.test(raw)) return true;
  if (/\b,\s*o\s*,/iu.test(t)) return true;
  if (/\b,\s*o\s+da\s*\./iu.test(t)) return true;
  if (/\bviagens\s+e\s*,/iu.test(t)) return true;
  if (/\be\s*,\s*focando/iu.test(t)) return true;
  if (/\bseu\s+cachorro\s*,/iu.test(t)) return true;
  if (/\bnicho\s+de\s*,/iu.test(t)) return true;
  if (/\bnicho\s*,/iu.test(t)) return true;
  if (/\bsobre\s+e\s+/iu.test(t)) return true;
  if (/\bsobre\s+\./iu.test(t)) return true;
  if (/\bcuriosidades\s+sobre\s+\./iu.test(t)) return true;
  if (/\bsobre\s+o\s+da\s*\./iu.test(t)) return true;
  return false;
}

function repairPersonaSummaryBrokenPhrasing(s: string): string {
  let t = s
    .replace(/\bde\s*,/giu, ',')
    .replace(/\bdo\s*,/giu, ',')
    .replace(/\bda\s*,/giu, ',')
    .replace(/\brelacionad[oa]\s+a\s+eventos\s+de\s*,/giu, 'relacionado a eventos culturais,')
    .replace(/\bespecificamente\s+o\s+em\b/giu, 'especificamente em')
    .replace(/,\s*o\s*,/giu, ' ')
    .replace(/\bnicho\s*,/giu, 'nicho de viagens e aviacao,')
    .replace(/\bcuriosidades sobre\s*\./giu, 'curiosidades sobre aviacao.')
    .replace(/\bsobre\s+\./giu, 'sobre aviacao.')
    .replace(/\bo da\s*\./giu, 'setor aereo.')
    .replace(/\bseu cachorro\s*,/giu, 'seu cachorro ')
    .replace(/\b,\s*,+/gu, ',')
    .replace(/\s{2,}/gu, ' ')
    .trim();
  t = t.replace(/,\s*\./gu, '.');
  return t;
}

/** Aplica as mesmas regras do validador por remocao deterministica (reduz reparos e tokens). */
function sanitizePersonaSummaryForProfile(personaSummary: string, profile: JsonRecord): string {
  let s = personaSummary.trim();
  if (!s) return s;

  s = s.replace(/@\w[\w.]*/gu, ' ');
  s = s.replace(/\s+/g, ' ').trim();

  s = stripDiscoveredFragmentsFromSummary(s, String(profile._discovered_value ?? ''));

  const handle = toHandle(profile.handle ?? '');
  if (handle.length >= 2) {
    try {
      s = s.replace(new RegExp(`\\b${escapeRegexChars(handle)}\\b`, 'giu'), ' ');
    } catch {
      /* ignore */
    }
  }

  const fullName = String(profile.full_name ?? '').trim();
  if (fullName.length >= 4) {
    const pieces = fullName
      .trim()
      .split(/\s+/)
      .map((t) => t.replace(/[^\p{L}\p{N}]/gu, ''))
      .filter(Boolean);
    if (pieces.length > 0) {
      const parts = pieces.map(escapeRegexChars).join('\\s+');
      try {
        s = s.replace(new RegExp(`\\b${parts}\\b`, 'iu'), ' ');
      } catch {
        /* ignore */
      }
    }
    for (const token of fullName.split(/\s+/)) {
      const cleaned = token.replace(/[^\p{L}\p{N}]/gu, '');
      if (cleaned.length < 4) continue;
      try {
        s = s.replace(new RegExp(`\\b${escapeRegexChars(cleaned)}\\b`, 'giu'), ' ');
      } catch {
        /* ignore */
      }
    }
  }

  s = repairPersonaSummaryBrokenPhrasing(s.replace(/\s+/g, ' ').trim());
  if (personaSummaryHasEditorialHoles(s)) {
    return '';
  }
  if (s.length < 20) {
    return s;
  }
  return s;
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function asStringArray(value: unknown, maxLen = 8): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const s = String(item ?? '').trim();
    if (!s) continue;
    if (!out.includes(s)) out.push(s);
    if (out.length >= maxLen) break;
  }
  return out;
}

function asObject(value: unknown): JsonRecord {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as JsonRecord;
}

function tryParseJsonObject(content: string): JsonRecord | null {
  const trimmed = content.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as JsonRecord)
      : null;
  } catch {
    // fallback abaixo
  }

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch?.[1]) {
    try {
      const parsed = JSON.parse(fenceMatch[1]) as unknown;
      if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as JsonRecord;
    } catch {
      // segue para extração por chave
    }
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const candidate = trimmed.slice(start, end + 1);
    try {
      const parsed = JSON.parse(candidate) as unknown;
      return parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as JsonRecord)
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

type BrandSafetyLevel = 'adulto' | 'sensivel' | 'familia';

/** mainCategory: rótulo de vitrine em pt-BR (LLM elabora; não é colagem das subCategories). */
const MAIN_CATEGORY_MIN_LEN = 2;
const MAIN_CATEGORY_MAX_LEN = 200;
/** Máximo de palavras no nome da categoria (segmentos separados por espaço ou "&"). */
const MAIN_CATEGORY_MAX_WORDS = 1;
/** Quantas subCategories considerar ao detectar "colagem literal" indevida. */
const MAIN_CATEGORY_SUB_MIRROR_MAX = 4;

export type MainCategory = string;

export function isMainCategoryValue(value: string): boolean {
  return parseMainCategory(value) !== null;
}

function stripCombiningMarks(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '');
}

/** Remove ZWSP/BOM que quebram match com "familia" e confundem a UI. */
function stripInvisibleFromString(s: string): string {
  return s.replace(/[\u200B-\u200D\uFEFF]/g, '');
}

/**
 * Normaliza mainCategory: rótulo em pt-BR (comprimento limitado), Unicode NFC.
 * O texto vem do LLM; o servidor encaixa depois na taxonomia fechada (`snapMainCategoryToTaxonomy`).
 */
export function parseMainCategory(raw: unknown): MainCategory | null {
  const s = stripInvisibleFromString(String(raw ?? '')).trim();
  if (!s) return null;
  if (/[\r\n]/.test(s)) return null;
  let nfc: string;
  try {
    nfc = s.normalize('NFC');
  } catch {
    nfc = s;
  }
  if (nfc.length < MAIN_CATEGORY_MIN_LEN || nfc.length > MAIN_CATEGORY_MAX_LEN) return null;
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(nfc)) return null;
  return nfc;
}

export {
  formatMainCategoryTaxonomyForPrompt,
  MAIN_CATEGORY_CANONICAL_LABELS,
  resolveMainCategoryWithEvidence,
  scoreMainCategoriesFromEvidence,
  snapMainCategoryToTaxonomy,
} from './mainCategoryTaxonomy.js';

function capitalizeSubcategoryToken(word: string): string {
  const w = stripInvisibleFromString(word).trim();
  if (!w) return '';
  return w.charAt(0).toLocaleUpperCase('pt-BR') + w.slice(1).toLowerCase();
}

/** Conta palavras do título (segmentos separados por & ou espaço). */
function countMainCategoryWords(label: string): number {
  const t = stripInvisibleFromString(label).trim();
  if (!t) return 0;
  return t
    .split(/\s*[&]\s*|\s+/u)
    .map((x) => x.trim())
    .filter((x) => x.length > 0).length;
}

function mainCategoryWithinWordBudget(label: string): boolean {
  const n = countMainCategoryWords(label);
  return n >= 1 && n <= MAIN_CATEGORY_MAX_WORDS;
}

/** Igual à colagem mecânica das primeiras subCategories (proibido se não for rótulo canônico da taxonomia). */
function mainCategoryIsLiteralSubcategoryPaste(main: string, subs: string[]): boolean {
  const clean = subs
    .map((s) => stripInvisibleFromString(String(s ?? '').trim()))
    .filter((s) => s.length > 0)
    .slice(0, MAIN_CATEGORY_SUB_MIRROR_MAX);
  if (clean.length === 0) return false;
  const caps = clean.map(capitalizeSubcategoryToken).filter((p) => p.length > 0);
  if (caps.length === 0) return false;
  const variants = [caps.join(' & '), caps.join(' '), caps.slice(0, 2).join(' & '), caps.slice(0, 2).join(' ')];
  const m = foldMainCategoryKey(main);
  for (const v of variants) {
    if (foldMainCategoryKey(v) === m) return true;
  }
  return false;
}

function mainCategoryMatchesPoolLabel(main: string, pool: string[] | undefined): boolean {
  if (!pool || pool.length === 0) return false;
  const m = foldMainCategoryKey(main);
  return pool.some((p) => foldMainCategoryKey(p) === m);
}

/**
 * Converte brandSafety do LLM para um dos tres valores canonicos.
 * Aceita string (com acento/ingles) ou objeto simples { level } / riskLevel (compat crawl).
 */
function normalizeBrandSafety(raw: unknown): BrandSafetyLevel | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const n = stripCombiningMarks(stripInvisibleFromString(raw).trim().toLowerCase());
    if (n === 'adulto' || n === 'adult') return 'adulto';
    if (n === 'sensivel' || n === 'sensitive') return 'sensivel';
    if (n === 'familia' || n === 'family') return 'familia';
    return null;
  }
  if (Array.isArray(raw)) {
    for (const el of raw) {
      const v = normalizeBrandSafety(el);
      if (v) return v;
    }
    return null;
  }
  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    const nested = normalizeBrandSafety(o.level ?? o.value ?? o.brandSafety);
    if (nested) return nested;
    const risk = stripInvisibleFromString(String(o.riskLevel ?? ''))
      .trim()
      .toLowerCase();
    if (risk === 'low') return 'familia';
    if (risk === 'medium') return 'sensivel';
    if (risk === 'high') return 'adulto';
    if (o.isAdultContent === true) return 'adulto';
    if (o.isFamilySafe === true) return 'familia';
    return null;
  }
  return null;
}

function pickBrandSafetyFromQualification(q: JsonRecord): BrandSafetyLevel | null {
  const rec = q as Record<string, unknown>;
  return (
    normalizeBrandSafety(q.brandSafety) ??
    normalizeBrandSafety(rec.brand_safety) ??
    normalizeBrandSafety(rec.BrandSafety)
  );
}

function profileAuthorialEvidenceLow(profile: JsonRecord, includePosts = true): string {
  const parts: string[] = [];
  const handle = String(profile.handle ?? '').toLowerCase();
  const fn = String(profile.full_name ?? '').normalize('NFC').toLowerCase();
  const bio = String(profile.biography ?? '').normalize('NFC').toLowerCase();
  if (handle) parts.push(handle);
  if (fn) parts.push(fn);
  if (bio) parts.push(bio);
  for (const field of ['category_name', 'business_category_name', 'overall_category_name'] as const) {
    const v = String(profile[field] ?? '').normalize('NFC').toLowerCase().trim();
    if (v) parts.push(v);
  }
  if (includePosts) {
    for (const s of buildPostTextSamplesForEvidence(profile)) {
      if (s.texto) parts.push(String(s.texto).normalize('NFC').toLowerCase());
      if (s.hashtags.length > 0) parts.push(s.hashtags.join(' ').toLowerCase());
    }
  }
  return parts.join('\n');
}

function profilePublicTextLow(profile: JsonRecord): string {
  const disc = String(profile._discovered_value ?? '').normalize('NFC').toLowerCase();
  const authorial = profileAuthorialEvidenceLow(profile, false);
  return disc ? `${authorial}\n${disc}` : authorial;
}

function hasLinhaProductBrandHandle(handle: string): boolean {
  const h = String(handle ?? '').trim().toLowerCase().replace(/^@/, '');
  return /^linha[a-z0-9_]{2,}$/i.test(h);
}

function hasInstagramProductServiceCategory(profile: JsonRecord): boolean {
  const cats = ['category_name', 'business_category_name', 'overall_category_name']
    .map((f) => String(profile[f] ?? '').toLowerCase())
    .join(' ');
  return /\bproduto\s*\/\s*servi[cç]o\b|\bproduct\s*\/\s*service\b|\bshopping\b/i.test(cats);
}

function hasInstitutionalThirdPersonBrandVoice(bio: string, fullName: string): boolean {
  const b = String(bio ?? '').trim();
  if (!b) return false;
  const name = String(fullName ?? '').trim();
  if (name.length >= 3) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${escaped}\\s+acredita\\s+que\\b`, 'iu').test(b)) return true;
  }
  return (
    /\b\w{3,}\s+acredita\s+que\b/iu.test(b) &&
    /\b(tempo\s+vale|render|deseja\s+fazer|produto|m[aá]ximo)\b/iu.test(b)
  );
}

/** Marca D2C (cosmeticos, limpeza, linha de produtos) — sem termos de busca discovered_*. */
function hasStrongProductBrandSignalsInProfile(profile: JsonRecord): boolean {
  const low = profileAuthorialEvidenceLow(profile);
  const handle = String(profile.handle ?? '').toLowerCase();
  const bio = String(profile.biography ?? '').normalize('NFC').toLowerCase();
  const fn = String(profile.full_name ?? '').normalize('NFC');

  if (hasLinhaProductBrandHandle(handle)) return true;
  if (hasInstagramProductServiceCategory(profile) && hasInstitutionalThirdPersonBrandVoice(bio, fn)) {
    return true;
  }

  const cleaningContext =
    /\b(limpeza|detergente|sab[aã]o|lavanderia|lou[cç]a|amaciante|desinfetante|multiuso|alvejante|limpador|higiene\s+dom[eé]stica|produtos?\s+de\s+limpeza|linha\s+roupas?|linha\s+lou[cç]a|linha\s+casa|rende\s+mais|barraca\s+do\s+detergente|minuano)\b/iu.test(
      low
    ) || hasLinhaProductBrandHandle(handle);
  const cleaningVoice =
    hasInstitutionalThirdPersonBrandVoice(bio, fn) ||
    /\b(acredita\s+que|rende\s+mais|nossa\s+linha|nossos?\s+produtos?|linha\s+de\s+produtos?|e-?commerce|loja\s+oficial|compre\s+agora)\b/iu.test(
      low
    );
  if (cleaningContext && cleaningVoice) return true;

  const skinContext = /\b(cosm[eé]tic|skincare|maquiagem|perfum|pele|tallow|sebo\s+bovino)\b/iu.test(low);
  const skinVoice =
    /\bmarca\s+de\s+(cosm[eé]tic|beleza|skincare|produtos?)\b/iu.test(low) ||
    /\b(nossa\s+marca|somos\s+uma\s+marca)\b/iu.test(low);
  if (skinContext && skinVoice) return true;

  return false;
}

/** Sinais fortes de negocio/instituicao — empresa/marca/midia plausivel. */
function hasStrongEmpresaSignalsInProfile(profile: JsonRecord): boolean {
  const low = profilePublicTextLow(profile);
  const handle = String(profile.handle ?? '').toLowerCase();
  if (
    /\b(restaurante|bar\b|doceria|pizzaria|lanchonete|café|cafe\b|padaria|delivery|peça já|peca ja|pedidos pelo|whatsapp.*pedido|loja oficial|varejo|clinica|clínica|hospital|agencia de|agência de|escritório cont|b2b|ministério|ministerio|prefeitura|corpo de bombeiros|polícia militar|exército|exercito|oficial\b.*\b(pm|eb|cbm)|bagels?|sandwiches|spreads|coffee shop|square\.site|jornal\b|giornale|informazione|edicola|notizie|liga\s+nacional|liga\s+de\s+|empresa\s+de\s+entretenimento|entretenimento\b.*\b(eventos|licenciamento|media)|licenciamento\b|lnr\s+(eventos|media|music|licenciamento)|federa[cç][aã]o|associa[cç][aã]o|instituto|fund[aá][cç][aã]o|canal oficial|conta oficial|detergente|sab[aã]o|produtos?\s+de\s+limpeza|linha\s+roupas?|linha\s+lou[cç]a|linha\s+casa|rende\s+mais|e-?commerce)\b/iu.test(
      low
    )
  ) {
    return true;
  }
  if (/\bempresa\b/iu.test(low)) return true;
  if (hasLinhaProductBrandHandle(handle) || hasStrongProductBrandSignalsInProfile(profile)) return true;
  if (hasInstagramProductServiceCategory(profile)) return true;
  if (/_restaurante|_loja|_store|_shop\b/i.test(handle)) return true;
  return false;
}

/** Pessoa fisica / criador de conteudo — musica, esporte, arte, influencia. */
function hasStrongCreatorPersonSignalsInProfile(profile: JsonRecord): boolean {
  const low = profileAuthorialEvidenceLow(profile);
  if (hasStrongEmpresaSignalsInProfile(profile) || hasStrongProductBrandSignalsInProfile(profile)) return false;
  if (
    /\b(criador(a)? de conte[uú]do|influencer|youtuber|blogueir[ao]|digital influencer|content creator)\b/iu.test(
      low
    )
  ) {
    return true;
  }
  if (
    /\b(músico|musico|cantor[a]?|compositor[a]?|violonista|guitarrista|baterista|baixista|dj\b|produtor musical|integrante do|membro do|banda\b|pagode|sertanejo|forró|forro|rapper|artista\b|ator|atriz|humorista|comediante|apresentador[a]?)\b/iu.test(
      low
    )
  ) {
    return true;
  }
  if (profileHandleOrNameSuggestsMusicaArtist(profile)) return true;
  if (
    /\b(jogador[a]? de|atleta\b|personal trainer|coach\b|fotógrafo|fotografo|streamer|cosplayer)\b/iu.test(
      low
    )
  ) {
    return true;
  }
  const fn = String(profile.full_name ?? '').trim();
  if (fn.length >= 4 && /\s/.test(fn) && /\b(sou|sou o|sou a|me chamo)\b/iu.test(low)) return true;
  return false;
}

/**
 * Bio/nome institucional: força empresa/midia mesmo se o LLM rotular criador/pessoal.
 * Ex.: "Empresa de Entretenimento", Liga Nacional, LNR Eventos/Licenciamento.
 */
function correctProfileTypeWhenEmpresaOrInstitutionalSignals(
  profile: JsonRecord,
  qualification: JsonRecord
): void {
  if (hasStrongCreatorPersonSignalsInProfile(profile)) return;
  const low = profilePublicTextLow(profile);

  if (/\bempresa\s+de\b/iu.test(low)) {
    qualification.profileType = 'empresa';
    return;
  }
  if (/\bliga\s+(nacional|de\s+)/iu.test(low)) {
    qualification.profileType = 'empresa';
    return;
  }
  if (/\b(licenciamento|lnr\s+eventos|lnr\s+media|lnr\s+music|lnr\s+licenciamento)\b/iu.test(low)) {
    qualification.profileType = 'empresa';
    return;
  }
  if (/\b(canal oficial|conta oficial|perfil oficial|organiza[cç][aã]o oficial)\b/iu.test(low)) {
    qualification.profileType = 'empresa';
    return;
  }
  if (/\b(jornal|imprensa|noticias|notícias)\b/iu.test(low) && !/\b(sou|me chamo|criador)\b/iu.test(low)) {
    qualification.profileType = 'midia';
    return;
  }
  if (/\b(federa[cç][aã]o|associa[cç][aã]o|instituto|fund[aá][cç][aã]o)\b/iu.test(low)) {
    qualification.profileType = 'empresa';
    return;
  }
  if (/\bempresa\b/iu.test(low)) {
    qualification.profileType = 'empresa';
  }
}

function qualificationProfileTypeTriggersAutoExclusion(qualification: JsonRecord): boolean {
  const pt = String(qualification.profileType ?? '').trim().toLowerCase();
  return pt !== 'pessoal' && pt !== 'criador' && pt.length > 0;
}

/** LLM rotula empresa/marca/midia mas a bio indica pessoa/criador (ex.: musico, compositor). */
function correctProfileTypeWhenPersonCreatorSignals(profile: JsonRecord, qualification: JsonRecord): void {
  const pt = String(qualification.profileType ?? '').trim().toLowerCase();
  if (pt === 'criador' || pt === 'marca') return;
  if (pt === 'pessoal' && profileSupportsMusicaNiche(profile) && !hasStrongProductBrandSignalsInProfile(profile)) {
    qualification.profileType = 'criador';
    return;
  }
  if (pt === 'pessoal' || pt === 'criador') return;
  if (hasStrongProductBrandSignalsInProfile(profile)) return;
  if (!hasStrongCreatorPersonSignalsInProfile(profile)) return;
  qualification.profileType = 'criador';
}

/**
 * Criador/pessoal erroneo para marca de produto (B2C): cosméticos/skincare, bebida empacotada, bio institucional.
 * `marca` = linha de produto / marca D2C; `empresa` = caso legado bebida/institucional já mapeado abaixo.
 */
function correctProfileTypeWhenProductBrand(profile: JsonRecord, qualification: JsonRecord): void {
  const pt = String(qualification.profileType ?? '').trim().toLowerCase();
  if (pt !== 'criador' && pt !== 'pessoal') return;

  const fn = String(profile.full_name ?? '').normalize('NFC').toLowerCase();
  const bio = String(profile.biography ?? '').normalize('NFC').toLowerCase();
  const handle = String(profile.handle ?? '').toLowerCase();
  const low = profileAuthorialEvidenceLow(profile);

  if (/\bcriador(a)?\b.*\bconte[uú]do|\binfluencer\b|\byoutuber\b|\bme\s+chamo\b/i.test(`${fn}\n${bio}`)) {
    return;
  }

  if (hasStrongProductBrandSignalsInProfile(profile)) {
    qualification.profileType = 'marca';
    const g = String(qualification.gender ?? '').trim().toLowerCase();
    if (g === 'feminino' || g === 'masculino') qualification.gender = 'desconhecido';
    return;
  }

  const productOrSkinContext =
    /\b(cosm[eé]tic|skincare|maquiagem|perfum|pele|skin\s*care|body\s*care|hair\s*care|tallow|sebo\s+bovino|sebo bovino|[oó]leos?\s+nat|ingredient|f[óo]rmula|produtos?\s+nat|vegano|clean\s*beauty|dermato)\b/iu.test(
      low
    );
  const institutionalBrandVoice =
    /\bmarca\s+de\s+(cosm[eé]tic|beleza|skincare|produtos?)\b/iu.test(low) ||
    /\b(nossa\s+marca|somos\s+uma\s+marca|a\s+marca\s+\S+\s+(cria|oferece|desenvolve|acredita))\b/iu.test(
      low
    ) ||
    (/\beles\s+acredit(am|a)\b/iu.test(low) &&
      /\b(pele|produto|skin|cosm[eé]tic|nutri|gordura|ingredient)\b/iu.test(low)) ||
    /\bprodutos?\s+com\s+base\s+em\b/iu.test(low);
  const d2cCosmeticsBrand =
    productOrSkinContext &&
    (institutionalBrandVoice ||
      /\b(loja\s+oficial|compre\s+agora|shop\s+now|link\s+na\s+bio|\.com\.br\b|\.com\/shop)\b/iu.test(low) ||
      /\b(tallow|sebo\s+bovino|cosm[eé]tic(os|as)?\s+natur)\b/iu.test(low));

  if (d2cCosmeticsBrand) {
    qualification.profileType = 'marca';
    const g = String(qualification.gender ?? '').trim().toLowerCase();
    if (g === 'feminino' || g === 'masculino') qualification.gender = 'desconhecido';
    return;
  }

  const cleaningOrHomeProductContext =
    /\b(limpeza|detergente|sab[aã]o|lavanderia|lou[cç]a|amaciante|desinfetante|multiuso|alvejante|limpador|higiene\s+dom[eé]stica|produtos?\s+de\s+limpeza|linha\s+roupas?|linha\s+lou[cç]a|linha\s+casa|rende\s+mais|barraca\s+do\s+detergente)\b/iu.test(
      low
    ) ||
    /\blinha[a-z0-9_]{2,}\b/iu.test(handle);
  const consumerCleaningBrandVoice =
    /\b(acredita\s+que|rende\s+mais|nossa\s+linha|nossos?\s+produtos?|linha\s+de\s+produtos?|e-?commerce|loja\s+oficial|compre\s+agora)\b/iu.test(
      low
    ) ||
    (/\b\w{3,}\s+acredita\s+que\b/iu.test(low) &&
      /\b(tempo\s+vale|render|deseja\s+fazer|produto|m[aá]ximo)\b/iu.test(low));
  const d2cCleaningBrand =
    cleaningOrHomeProductContext &&
    (consumerCleaningBrandVoice ||
      /\b(loja\s+oficial|compre\s+agora|\.com\.br\b|\.com\/shop)\b/iu.test(low));

  if (d2cCleaningBrand) {
    qualification.profileType = 'marca';
    const g = String(qualification.gender ?? '').trim().toLowerCase();
    if (g === 'feminino' || g === 'masculino') qualification.gender = 'desconhecido';
    return;
  }

  const hasPackagedProductPhrase =
    /\bágua\s+mineral\b/u.test(low) ||
    /\bagua\s+mineral\b/i.test(low);

  const hasInstitutionalProductBio =
    /www\.[a-z0-9.-]+\.(?:com\.br|com)\b/i.test(low) &&
    /top\s+of\s+mind|novo\s+r[oó]tulo|vezes\s+campe[ãa]/i.test(low) &&
    (hasPackagedProductPhrase ||
      /agua|mineral|bebida|iogurt|latic/i.test(handle) ||
      /agua|mineral|bebida/i.test(fn));

  if (!hasPackagedProductPhrase && !hasInstitutionalProductBio) return;

  qualification.profileType = 'empresa';
  const g = String(qualification.gender ?? '').trim().toLowerCase();
  if (g === 'feminino' || g === 'masculino') qualification.gender = 'desconhecido';
}

/** Se o proprio resumo editorial disser que e marca/produto D2C, nao deixar criador/pessoal. */
function correctProfileTypeWhenPersonaDescribesProductBrand(qualification: JsonRecord): void {
  const pt = String(qualification.profileType ?? '').trim().toLowerCase();
  if (pt !== 'criador' && pt !== 'pessoal') return;
  const ps = foldAsciiWs(String(qualification.personaSummary ?? ''));
  if (
    /\bmarca\s+de\s+cosm(e|é)tic/.test(ps) ||
    /\bmarca\s+de\s+produtos?\s+nat/.test(ps) ||
    /\be\s+uma\s+marca\s+de\b/.test(ps) ||
    /\bmarca\s+de\s+skincare\b/.test(ps) ||
    /\bmarca\s+de\s+(limpeza|detergente|sab[aã]o)\b/.test(ps) ||
    /\b(linha\s+de\s+produtos?|produtos?\s+de\s+limpeza|detergente|sab[aã]o\s+l[ií]quido)\b/.test(ps) ||
    (/\bmarca\s+de\b/.test(ps) &&
      /\b(tallow|sebo|cosm(e|é)tic|skincare|pele|limpeza|detergente|sab[aã]o|minuano)\b/.test(ps)) ||
    (/\bacredita\s+que\b/.test(ps) && /\b(tempo\s+vale|render|limpeza|detergente|produto)\b/.test(ps))
  ) {
    qualification.profileType = 'marca';
    const g = String(qualification.gender ?? '').trim().toLowerCase();
    if (g === 'feminino' || g === 'masculino') qualification.gender = 'desconhecido';
  }
}

/** Texto para pontuar/corrigir mainCategory no servidor (mesmo conjunto que pillars: bio + nome + descoberta + legendas/hashtags dos posts, se houver). */
function buildProfileContextForMainCategoryEvidence(profile: JsonRecord): string {
  return buildProfileFreeTextForCategoryEvidence(profile);
}

const PROFILE_TYPE_CANONICAL = new Set([
  'criador',
  'pessoal',
  'empresa',
  'noticia',
  'marca',
  'midia',
]);

/** LLM as vezes copia o schema do prompt (ex.: "criador|pessoal") em vez de escolher um valor. */
function normalizeProfileTypeLeakage(qualification: JsonRecord): void {
  const raw = String(qualification.profileType ?? '').trim().toLowerCase();
  if (!raw || !raw.includes('|')) {
    if (PROFILE_TYPE_CANONICAL.has(raw)) qualification.profileType = raw;
    return;
  }
  const parts = raw
    .split('|')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => PROFILE_TYPE_CANONICAL.has(s));
  if (parts.length === 0) return;
  if (parts.includes('criador')) qualification.profileType = 'criador';
  else if (parts.includes('pessoal')) qualification.profileType = 'pessoal';
  else qualification.profileType = parts[0];
}

type QualificationValidationOptions = {
  /** Permite contentPillars ["Outros"] e preenchimento servidor de Outros se vazio. */
  allowContentPillarOutrosFallback?: boolean;
};

function normalizeClassification(
  raw: JsonRecord,
  profile: JsonRecord,
  model: string,
  _maxReasoning: number,
  languageFromFranc: string,
  options: QualificationValidationOptions = {}
): LlmClassification {
  const allowOutrosFallback = options.allowContentPillarOutrosFallback === true;
  const qualificationRaw = asObject(raw.qualification);
  const qualification = Object.keys(qualificationRaw).length > 0 ? qualificationRaw : asObject(raw);
  const bs = pickBrandSafetyFromQualification(qualification);
  if (bs) qualification.brandSafety = bs;
  normalizeProfileTypeLeakage(qualification);
  correctProfileTypeWhenProductBrand(profile, qualification);
  correctProfileTypeWhenEmpresaOrInstitutionalSignals(profile, qualification);
  correctProfileTypeWhenPersonCreatorSignals(profile, qualification);
  correctUnsupportedMusicSubInQualification(profile, qualification);
  correctUnsupportedBeautyLabelsInQualification(profile, qualification);
  let mc0 = parseMainCategory(qualification.mainCategory);
  if (mc0) {
    let snapped = snapMainCategoryToTaxonomy(mc0);
    if (snapped) {
      const subsArr = asStringArray(qualification.subCategories, 100);
      const pillarsArr = asStringArray(qualification.contentPillars, 100);
      const mergedForMain = mergeSubsAndPillarsForMainCategoryEvidence(subsArr, pillarsArr);
      const ctx = buildProfileContextForMainCategoryEvidence(profile);
      snapped = resolveMainCategoryWithEvidence(snapped, mergedForMain, ctx);
      mc0 = parseMainCategory(snapped) ?? snapped;
    }
    qualification.mainCategory = mc0;
  }
  const ps0 = String(qualification.personaSummary ?? '').trim();
  if (ps0 && profile && Object.keys(profile).length > 0) {
    qualification.personaSummary = sanitizePersonaSummaryForProfile(ps0, profile);
  }
  fixPersonaAndQualificationWhenBeautyHallucinated(profile, qualification);
  fixBeautySubCategoriesWhenMainIsBeleza(qualification);
  dropSubCategoriesWithoutTaxonomyHit(qualification);
  correctMisclassifiedFoodOrGenericWhenMusicaArtist(profile, qualification);
  correctMisclassifiedFoodWhenEsportesEvidence(profile, qualification);
  correctMisclassifiedFoodWhenBelezaEvidence(profile, qualification);
  reconcileMainCategoryWhenPersonaContradictsLabels(profile, qualification);
  correctMisclassifiedLifestyleWhenFinancasEvidence(profile, qualification);
  correctProfileTypeWhenPersonaDescribesProductBrand(qualification);
  correctProfileTypeWhenProductBrand(profile, qualification);
  let confidence = clamp(Number(raw.confidence ?? 0), 0, 1);
  const statusRaw = String(raw.status ?? '').trim().toLowerCase();
  let status: 'done' | 'insufficient_data' = statusRaw === 'insufficient_data' ? 'insufficient_data' : 'done';

  const letters = countAuthorialLettersForProfileEvidence(profile);
  const capByLetters = maxConfidenceFromAuthorialLetterCount(letters);
  confidence = Math.min(confidence, capByLetters);
  const thinThreshold = parseAuthorialLettersThinThreshold();
  if (letters < thinThreshold) {
    status = 'insufficient_data';
    qualification.gender = 'desconhecido';
    confidence = Math.min(confidence, 0.35);
  } else if (status === 'insufficient_data') {
    confidence = Math.min(confidence, 0.48);
  }
  /** Sempre do franc (limiar proprio); perfil “fino” nao forca desconhecido no idioma. */
  qualification.language = languageFromFranc;
  if (normalizeLanguageTagForExclusionRule(String(qualification.language ?? '')) === 'desconhecido') {
    qualification.language = 'pt-br';
  } else {
    promoteLanguageToPtBrWhenBrazilianProfileEvidence(qualification, profile);
  }

  ensureContentPillarsFallback(qualification, allowOutrosFallback);

  return {
    qualifiedAt: new Date().toISOString(),
    model,
    version: 7,
    status,
    confidence,
    qualification,
  };
}

function validateLlmClassification(
  llm: LlmClassification,
  profile?: JsonRecord,
  options: QualificationValidationOptions = {}
): string[] {
  const allowOutrosFallback = options.allowContentPillarOutrosFallback === true;
  const errors: string[] = [];
  const q = asObject(llm.qualification);
  if (Object.keys(q).length === 0) {
    errors.push('qualification ausente ou invalido');
    return errors;
  }

  const requiredArraysMin2 = ['subCategories', 'contentPillars', 'audienceType'];
  for (const key of requiredArraysMin2) {
    const arr = asStringArray(q[key], 100);
    if (arr.length < 1) errors.push(`${key} deve ter pelo menos 1 itens`);
  }

  const subsArrEarly = asStringArray(q.subCategories, 100);
  const pillarsArrEarly = asStringArray(q.contentPillars, 100);
  const audArrEarly = asStringArray(q.audienceType, 100);
  errors.push(...validateMacroLabelArray('subCategories', subsArrEarly));
  errors.push(...validateMacroLabelArray('contentPillars', pillarsArrEarly));
  errors.push(...validateMacroLabelArray('audienceType', audArrEarly));
  errors.push(...validateContentPillarsNotTooGeneric(pillarsArrEarly));
  errors.push(...validateContentPillarsOutrosReservedForLastAttempt(pillarsArrEarly, allowOutrosFallback));
  if (profile && Object.keys(profile).length > 0) {
    errors.push(...validateSubCategoriesBeautyAgainstProfileEvidence(q, profile));
    errors.push(...validateSubCategoriesFinancasAgainstProfileEvidence(q, profile));
    errors.push(...validateContentPillarsAgainstProfileEvidence(q, profile));
  }

  const gender = String(q.gender ?? '').trim().toLowerCase();
  if (!gender) errors.push('gender ausente');
  if (gender && gender.split(/\s+/g).filter(Boolean).length !== 1) {
    errors.push('gender deve ser uma unica palavra');
  }
  const language = String(q.language ?? '').trim().toLowerCase();
  if (!language) errors.push('language ausente');
  if (language.length > 32) errors.push('language muito longo');
  const langNorm = normalizeLanguageTagForExclusionRule(String(q.language ?? ''));
  if (
    langNorm &&
    langNorm !== 'desconhecido' &&
    !/^[a-z]{2,8}(-[a-z0-9]{2,8}){0,3}$/u.test(langNorm)
  ) {
    errors.push('language: tag BCP-47 invalida (ex. pt-br, en, es-mx, desconhecido)');
  }
  if (profile && Object.keys(profile).length > 0) {
  }
  const personaSummary = String(q.personaSummary ?? '').trim();
  if (personaSummary.length < 20) errors.push('personaSummary muito curto');
  if (personaSummary.length >= 20) {
    errors.push(...validatePersonaSummaryQuality(personaSummary));
  }
  if (profile && Object.keys(profile).length > 0) {
    errors.push(...validatePersonaSummaryAgainstProfile(personaSummary, profile));
  }
  const brandSafety = pickBrandSafetyFromQualification(q);
  if (!brandSafety) {
    errors.push('brandSafety ausente ou invalido (obrigatorio: adulto|sensivel|familia)');
  }

  const mcOk = parseMainCategory(q.mainCategory);
  if (!mcOk) {
    const rawMc = String(q.mainCategory ?? '').trim();
    const iaValor = rawMc === '' ? '(vazio ou ausente)' : JSON.stringify(rawMc);
    errors.push(
      `mainCategory obrigatorio e invalido (${iaValor}) — pt-BR, ${MAIN_CATEGORY_MIN_LEN}-${MAIN_CATEGORY_MAX_LEN} caracteres; nome de CATEGORIA elaborado pelo modelo (nao omita).`
    );
  } else {
    const nWords = countMainCategoryWords(mcOk);
    if (nWords !== MAIN_CATEGORY_MAX_WORDS) {
      errors.push(
        `mainCategory: exatamente ${MAIN_CATEGORY_MAX_WORDS} palavra (sem espacos nem "&" entre termos; compostos com hifen contam como uma palavra, ex. Bem-estar).`
      );
    }
    const subsArr = asStringArray(q.subCategories, 100);
    const canonicalPool = [...MAIN_CATEGORY_CANONICAL_LABELS];
    if (
      subsArr.length > 0 &&
      mainCategoryIsLiteralSubcategoryPaste(mcOk, subsArr) &&
      !mainCategoryMatchesPoolLabel(mcOk, canonicalPool)
    ) {
      errors.push(
        `mainCategory nao pode ser só a juncao literal das subCategories; escolha UM rotulo LITERAL da lista fechada do prompt (${formatMainCategoryTaxonomyForPrompt()}).`
      );
    }
    if (!isCanonicalMainCategoryLabel(mcOk)) {
      errors.push(
        `mainCategory deve ser EXATAMENTE um destes (copiar texto): ${formatMainCategoryTaxonomyForPrompt()}`
      );
    }
  }

  return errors;
}

function buildRepairPrompt(originalPrompt: string, invalidJson: JsonRecord, errors: string[]): string {
  return [
    'Corrija o JSON abaixo mantendo a MESMA estrutura geral.',
    'Erros encontrados:',
    ...errors.map((e) => `- ${e}`),
    'Regras:',
    '- retorne apenas JSON valido',
    '- mantenha todos os campos obrigatorios',
    '- qualification.subCategories: pelo menos 1 item; prefira termos da amostra/vocabulario fechado do prompt; uma palavra, sem espacos internos. Maquiagem/beleza so com evidencia na bio ou amostras.',
    `- qualification.contentPillars: pelo menos 1 item; cada item UMA palavra sem espacos (NUNCA frases tipo "recepcao de cafe"). Pilares so com base no texto do perfil/amostras; PROIBIDO "dicas", "moto", "receitas" sem aparecer nos dados. PROIBIDO lista SOMENTE com rotulos de Beleza (beleza, maquiagem, skincare, unhas…) se nada na bio/amostras falar de estetica/make; troque por pilares do nicho real (ex.: direito, negocios, humor, familia). NUNCA use "${CONTENT_PILLAR_FALLBACK_LABEL}" nesta correcao — escolha temas concretos; o servidor so aplica "${CONTENT_PILLAR_FALLBACK_LABEL}" na ultima tentativa se esgotar reparos.`,
    `- qualification.mainCategory OBRIGATORIO: copie LITERAL um unico rotulo da LISTA FECHADA do prompt (uma palavra, sem " & "); nao invente sinonimos nem traducoes.`,
    '- qualification.personaSummary: SOMENTE o modelo escreve este campo — descricao em terceira pessoa do influenciador (papel + nicho concreto + publico); PROIBIDO templates ("alinhado ao nicho publico", "tom editorial" sem tema); PROIBIDO @, handle, nome publico, copiar biografia; use amostras como pista.',
    '- qualification.profileType: marca D2C (cosmeticos/skincare/linha de produtos, voz institucional, ingredientes) → marca, nao criador; criador só quando a pessoa for o centro do posicionamento.',
    '- nao explique nada',
    '',
    'Prompt original:',
    originalPrompt,
    '',
    'JSON atual para corrigir:',
    JSON.stringify(invalidJson),
  ].join('\n');
}

function buildPrompt(profile: JsonRecord, options: { includePostSamples?: boolean } = {}): string {
  const includePostSamples = options.includePostSamples === true;
  // Nao enviar account_type/category do Instagram: o modelo copiava 1:1 para profileType.
  const postSamples = includePostSamples ? buildPostTextSamplesForPrompt(profile) : [];
  const bioRaw = String(profile.biography ?? '').trim().replace(/\s+/g, ' ');
  const bioMax = Math.max(200, Math.min(600, getQualifyPostSampleMaxChars() * 2));
  const compact: JsonRecord = {
    handle: profile.handle ?? '',
    full_name: profile.full_name ?? '',
    biography: bioRaw.length > bioMax ? `${bioRaw.slice(0, bioMax)}…` : bioRaw,
    followers_count: profile.followers_count ?? 0,
    discovered_by: profile._discovered_by ?? '',
    discovered_value: profile._discovered_value ?? '',
  };
  if (postSamples.length > 0) {
    compact.amostras_textos_publicacoes = postSamples;
  }

  const profileTypeSignals =
    'pessoal: sem voz de marca/comercial na bio. marca: D2C/propria — cosmeticos/skincare/suplementos/roupa/limpeza/detergente/sabao (linhas Roupas/Louca/Casa), bio institucional ("Marca acredita que…", "rende mais"), loja/e-commerce/comprar; se o foco e MARCA/PRODUTO, nao criador. empresa: cafe/restaurante/bar/doceria, marca de comida/bebida, varejo B2B, pedidos+link, orgao publico (PM, exercito, bombeiros, ministerio), liga/federacao/associacao, "Empresa de X", divisoes (Eventos/Licenciamento/Media) → empresa ou midia, nunca pessoal/criador. discovered_* nao manda se o texto for de marca. criador: pessoa fisica no centro do conteudo — musico/cantor/compositor/violonista/DJ/banda/integrante de grupo/artista/atleta/influencer → criador, NUNCA empresa (liga/evento corporativo NAO e criador). clinica/B2B/agencia → empresa.';
  const profileTypeRule = includePostSamples
    ? `profileType: inferir a partir de handle, full_name, biography e amostras_textos_publicacoes (legendas/hashtags). ${profileTypeSignals}`
    : `profileType: inferir a partir de handle, full_name e biography (texto publico do perfil). ${profileTypeSignals}`;
  const personaRule = includePostSamples
    ? 'personaSummary: editorial em terceira pessoa — QUEM e o criador (papel: apresentador, humorista, chef…) e EM QUE nicho atua (temas concretos: novela, futebol, receitas…); tom e publico. PROIBIDO frases vagas ("alinhado ao nicho publico", "tom editorial"). PROIBIDO: @, handle, nome publico literal, copiar bio/legendas/URLs/numeros de seguidores ou trechos iguais ao JSON. Amostras só como pista; reescreva.'
    : 'personaSummary: editorial em terceira pessoa — papel do criador e nicho concreto (temas do perfil), tom e publico; sem frases genericas de template. PROIBIDO: @, handle, nome publico literal, copiar bio, seguidores, URLs, trechos iguais ao JSON. Bio curta: infira com cautela de handle+nome, sem fatos inventados.';

  const postsLeadWhenBioWeak =
    postSamples.length > 0
      ? 'Com amostras_textos_publicacoes: se biography for curta, vaga, só slogan ou nao definir o nicho, defina profileType, subCategories (ordem: tema dominante primeiro), contentPillars e mainCategory (UMA palavra, nome de vitrine) pelo TEMA DOMINANTE nas amostras; bio e handle apenas apoiam.'
      : null;

  const mainHints = topMainCategoriesFromAuthorialEvidence(profileAuthorialEvidenceLow(profile), 5);
  const mainCategoryTaxonomyRule =
    mainHints.length > 0
      ? `LISTA FECHADA mainCategory — escolha EXATAMENTE UMA destas palavras e copie o texto LITERAL (acentos inclusos; uma unica palavra por rotulo). Priorize coerencia com o texto do perfil (${mainHints.join(', ')}): ${formatMainCategoryTaxonomyForPromptWithHints(mainHints)}`
      : `LISTA FECHADA mainCategory — escolha EXATAMENTE UMA destas palavras e copie o texto LITERAL (acentos inclusos; uma unica palavra por rotulo): ${formatMainCategoryTaxonomyForPrompt()}`;
  const subcategoryHintsRule = formatSubcategoryTaxonomyHintsForPrompt();
  const textualEvidenceRule = buildTextualEvidencePromptHints(profile);

  return [
    'Classificador de perfis (influencia; qualquer pais). Nao invente sem base nos dados.',
    profileTypeRule,
    ...(postsLeadWhenBioWeak ? [postsLeadWhenBioWeak] : []),
    textualEvidenceRule,
    mainCategoryTaxonomyRule,
    subcategoryHintsRule,
    'Ignore metadados nao enviados (account_type, categoria oficial do Instagram).',
    'Resposta: somente JSON valido, sem markdown ou texto extra.',
    'Strings de vitrine (personaSummary, mainCategory, subCategories, gender, contentPillars, audienceType): pt-BR; sem ingles/espanhol nessas chaves.',
    'Raiz: objeto com "qualification".',
    'confidence/status: sem base em texto autoral para nicho/persona → status "insufficient_data" e confidence baixo (0.2-0.45). Nunca 1.0 com bio+nome vazios ou só emoji/link.',
    'Arrays nunca vazios.',
    'subCategories, contentPillars e audienceType: uma palavra macro por item (sem frases compostas).',
    `contentPillars: só temas presentes em "Dados do perfil"; uma palavra. Nao invente; nao copie palavras deste prompt. Evite "dicas","moto","receitas","bastidores","stories" como padrao — só se o texto mostrar (ex.: moto = moto/trilha/grau). Nao repita mainCategory como pillar. Nao use "${CONTENT_PILLAR_FALLBACK_LABEL}" — nomeie o nicho concreto; o servidor so preenche "${CONTENT_PILLAR_FALLBACK_LABEL}" na ultima tentativa.`,
    'contentPillars Beleza (validacao): sem gender feminino, PROIBIDO usar APENAS rotulos de vitrine Beleza (beleza, maquiagem, skincare, unhas, estetica, cosmeticos, maquiador...) se NENHUMA bio nem amostra citar make/cosmeticos/salao/pele/tutorial/autocuidado ligado a estetica. Com gender feminino o servidor aceita pilares so Beleza mesmo sem essas palavras. Perfil juridico (adv., OAB, lei, tribunal, escritorio), saude, negocios, fitness sem estetica e sem feminino → pilares = tema REAL do conteudo, nunca "beleza+maquiagem" por estereotipo.',
    'subCategories: fonte do nicho; devem existir no mapa fechado (amostra acima). Ordem: mais especifico primeiro; pt-BR ou EN se no mapa (tv, dj). Finfluencer/educacao financeira/investimentos/bolsa/dividendos → subs Finanças (investimentos, bolsa, economia…) e mainCategory Finanças — nunca tatuagem/festa/Lifestyle sem evidencia de lifestyle. Maquiagem/beleza/skincare: com evidencia na bio/amostras, ou com gender feminino (servidor aceita sem menção explicita). Maternidade sozinha nao dispensa evidencia. Perfil adv./OAB/juridico sem cosmeticos e sem feminino → subs do oficio (direito, advocacia…), nunca maquiagem. Fora do vocabulario → falha de classificacao.',
    'mainCategory: copiar LITERAL um rotulo da lista (uma palavra). Orientar pelas subCategories (ex.: maquiagem→Beleza; receitas→Alimentacao; viagem→Viagens; tatuagem→Lifestyle, nao Musica; futebol/futsal/esporte→Esportes; video game/gaming/jogos eletronicos→Games, nao só "jogos" que em pt-BR costuma ser esporte). Vaquejada/festa com som→Musica; Esportes só hipismo competitivo sem pilar musical. Ambiguo: macro mais comercial da lista. So rotulos da lista.',
    'Servidor: valida subs no mapa, alinha main a evidencias (subs+bio/contexto), preenche language (franc) e normaliza aliases; escolha coerente. O servidor NAO reescreve personaSummary — esse campo e exclusivo do modelo.',
    'mainCategory, gender e brandSafety obrigatorios (string). subCategories, contentPillars e audienceType: arrays com pelo menos 1 item. NAO inclua "language" no JSON — o servidor preenche.',
    'brandSafety: familia = beleza/maquiagem/educacao/lifestyle normal; sensivel = alcool/tabaco/politica polemica/saude arriscada/violencia/sexualizacao; adulto = sexo explicito/jogos adultos/gore. Nao sensivel só por maquiagem/coracao.',
    personaRule,
    'subCategories: prefira nicho comercial especifico; evite "variedades","geral","conteudo" se houver termo melhor no mapa.',
    includePostSamples
      ? `Incerteza: pouco texto para nicho — contentPillars: temas concretos do perfil (nao use "${CONTENT_PILLAR_FALLBACK_LABEL}"); demais campos evite geral/desconhecido salvo necessario.`
      : `Incerteza: bio curta — contentPillars: temas concretos inferidos com cautela (nao use "${CONTENT_PILLAR_FALLBACK_LABEL}"); demais campos evite geral/desconhecido salvo necessario.`,
    'Estrutura obrigatoria:',
    '{',
    '  "confidence": 0.0-1.0 (vagos→<0.5; sem chute em 1.0),',
    '  "qualification": {',
    '    "profileType": "criador|pessoal|empresa|noticia|marca|midia",',
    `    "mainCategory": "<obrigatorio: copiar LITERAL um rotulo da lista fechada>",`,
    '    "gender": "feminino|masculino|desconhecido",',
    '    "subCategories": ["string"],',
    '    "contentPillars": ["string"],',
    '    "audienceType": ["mulheres","homens","infantil","jovens","idosos","crianças"],',
    '    "brandSafety": "adulto|sensivel|familia",',
    '    "personaSummary": "string"',
    '  }',
    '}',
    'Dados do perfil:',
    JSON.stringify(compact),
  ].join('\n');
}

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

function getApiBaseOrThrow(): string {
  const base = process.env.QUALIFY_API_BASE?.trim() || process.env.COLLECTOR_API_BASE?.trim();
  if (!base) {
    throw new Error('Defina QUALIFY_API_BASE (ou COLLECTOR_API_BASE) para usar a API remota.');
  }
  if (
    process.env.QUALIFY_API_NO_AUTO_SUFFIX === '1' ||
    process.env.QUALIFY_API_NO_AUTO_SUFFIX?.toLowerCase() === 'true'
  ) {
    return normalizeBaseUrl(base);
  }
  if (/\/api(\/|$)/i.test(base)) {
    return normalizeBaseUrl(base);
  }
  return normalizeBaseUrl(`${base}/api`);
}

function getIngestKeyOrThrow(): string {
  const key = process.env.QUALIFY_INGEST_KEY?.trim() || process.env.COLLECTOR_INGEST_KEY?.trim();
  if (!key) {
    throw new Error('Defina QUALIFY_INGEST_KEY (ou COLLECTOR_INGEST_KEY) com a chave X-Collector-Key.');
  }
  return key;
}

function getTimeoutMs(): number {
  const n = Number(process.env.QUALIFY_API_TIMEOUT_MS ?? DEFAULT_API_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_API_TIMEOUT_MS;
}

function envFlagTrue(name: string): boolean {
  const v = String(process.env[name] ?? '')
    .trim()
    .toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function batchOptionsFromEnv(): BatchOptions {
  const maxProfiles = Math.max(0, Math.floor(Number(process.env.QUALIFY_BATCH_MAX_PROFILES ?? 0) || 0));
  let processed = 0;
  const mainCategory = process.env.QUALIFY_MAIN_CATEGORY?.trim() || undefined;
  return {
    onlyWithLlm: envFlagTrue('QUALIFY_ONLY_WITH_LLM'),
    mainCategory,
    shouldStop: maxProfiles > 0 ? () => processed >= maxProfiles : undefined,
    onResult: (row) => {
      const err = String(row.error ?? '');
      if (err.includes('Pulado')) return;
      processed++;
    },
  };
}

/** Embaralha copia do lote (API devolve pendentes do mais antigo; front/processamento em ordem aleatoria). */
function shuffleQueueItems<T>(items: T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

interface QualifyShardConfig {
  index: number;
  count: number;
  active: boolean;
}

/** Particao estavel da fila entre workers/máquinas (hash do handle). */
function getQualifyShardConfig(): QualifyShardConfig {
  const combined = process.env.QUALIFY_SHARD?.trim();
  if (combined && combined.includes('/')) {
    const parts = combined.split('/').map((s) => s.trim());
    const countRaw = Number(parts[1]);
    const indexRaw = Number(parts[0]);
    const count =
      Number.isFinite(countRaw) && countRaw > 0 ? Math.max(1, Math.min(32, Math.floor(countRaw))) : 1;
    const index = Number.isFinite(indexRaw)
      ? Math.max(0, Math.min(count - 1, Math.floor(indexRaw)))
      : 0;
    return { index, count, active: count > 1 };
  }
  const countRaw = Number(process.env.QUALIFY_SHARD_COUNT ?? 1);
  const indexRaw = Number(process.env.QUALIFY_SHARD_INDEX ?? 0);
  const count =
    Number.isFinite(countRaw) && countRaw > 0 ? Math.max(1, Math.min(32, Math.floor(countRaw))) : 1;
  const index = Number.isFinite(indexRaw)
    ? Math.max(0, Math.min(count - 1, Math.floor(indexRaw)))
    : 0;
  return { index, count, active: count > 1 };
}

function handleShardSlot(handle: string, shardCount: number): number {
  const h = toHandle(handle);
  let x = 2166136261;
  for (let i = 0; i < h.length; i++) {
    x ^= h.charCodeAt(i);
    x = Math.imul(x, 16777619);
  }
  return (x >>> 0) % shardCount;
}

function handleBelongsToShard(handle: string, shard: QualifyShardConfig): boolean {
  if (!shard.active) return true;
  return handleShardSlot(handle, shard.count) === shard.index;
}

function formatShardLabel(shard: QualifyShardConfig): string {
  if (!shard.active) return '';
  return `${shard.index}/${shard.count}`;
}

function getIngestPushTimeoutMs(): number {
  const raw = process.env.QUALIFY_INGEST_TIMEOUT_MS?.trim();
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return DEFAULT_INGEST_TIMEOUT_MS;
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number, retries = 2): Promise<JsonRecord> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500 * attempt));
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: ac.signal });
      const text = await res.text();
      let data: JsonRecord = {};
      try {
        data = text ? (JSON.parse(text) as JsonRecord) : {};
      } catch {
        const err = new Error(`Resposta invalida da API (${res.status}): ${text.slice(0, 220)}`);
        if (attempt < retries && (res.status >= 500 || res.status === 429)) {
          lastError = err;
          continue;
        }
        throw err;
      }
      if (!res.ok) {
        const err = new Error(`${res.status} ${String(data.error ?? text ?? 'Erro na API')}`);
        if (attempt < retries && (res.status >= 500 || res.status === 429)) {
          lastError = err;
          continue;
        }
        throw err;
      }
      return data;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (err.name === 'AbortError') {
        const timeoutErr = new Error(`Timeout da API apos ${timeoutMs}ms`);
        if (attempt < retries) {
          lastError = timeoutErr;
          continue;
        }
        throw timeoutErr;
      }
      if (attempt < retries && err.message.includes('fetch failed')) {
        lastError = err;
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new Error('Falha na requisicao apos tentativas');
}

function getLlmMediaContextLimit(): number {
  const n = Number(process.env.QUALIFY_MEDIA_CONTEXT_LIMIT ?? 24);
  return Number.isFinite(n) && n > 0 ? Math.max(1, Math.min(60, Math.floor(n))) : 24;
}

/** Quantidade de midias mais recentes (post/reel/tagged) na fila inicial; padrao 4. */
function getQualifyInitialMediaLimit(): number {
  const n = Number(process.env.QUALIFY_INITIAL_MEDIA_LIMIT ?? 4);
  return Number.isFinite(n) && n > 0 ? Math.max(1, Math.min(10, Math.floor(n))) : 4;
}

/** Fila batch: incluir legendas/hashtags na carga inicial (1a passagem Ollama). Desligar com QUALIFY_QUEUE_INCLUDE_CONTENT=0 */
function isQualifyQueueIncludeContentEnabled(): boolean {
  const raw = process.env.QUALIFY_QUEUE_INCLUDE_CONTENT?.trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'no') return false;
  return true;
}

async function ensurePostContextOnProfileForLlm(
  profile: JsonRecord,
  postCtx: ClassifyLlmPostContext | undefined,
  options: { promptOverride?: string; logStep: (msg: string) => void; phaseLabel: string }
): Promise<JsonRecord> {
  if (options.promptOverride != null || !postCtx || profileHasPostTextSamples(profile)) {
    return profile;
  }
  options.logStep(`>> API collector: buscar legendas (${options.phaseLabel})...`);
  try {
    const enriched = await fetchProfilePostContextFromApi(
      postCtx.apiBase,
      postCtx.ingestKey,
      toHandle(profile.handle ?? ''),
      postCtx.refreshAll
    );
    options.logStep('>> API collector: legendas recebidas');
    return mergePostContextFromApiProfile(profile, enriched);
  } catch (e) {
    options.logStep(
      `>> API collector: aviso legendas — ${truncateLogLine(e instanceof Error ? e.message : String(e), 140)}`
    );
    return profile;
  }
}

async function fetchPendingFromApi(
  apiBase: string,
  ingestKey: string,
  limit: number,
  offset = 0,
  refreshAll = true,
  mainCategory?: string,
  mediaLimitOverride?: number,
  includeContent = false
): Promise<{ totalPending: number; items: Array<{ handle: string; profile: JsonRecord }> }> {
  const refreshAllQuery = refreshAll ? '1' : '0';
  const mediaLimit =
    mediaLimitOverride != null && Number.isFinite(mediaLimitOverride)
      ? Math.max(1, Math.min(60, Math.floor(mediaLimitOverride)))
      : getQualifyInitialMediaLimit();
  const qs = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
    refreshAll: refreshAllQuery,
    includeContent: includeContent ? '1' : '0',
    mediaLimit: String(mediaLimit),
  });
  const mc = String(mainCategory ?? '').trim();
  if (mc) qs.set('mainCategory', mc);
  const url = `${apiBase}/crawl/collector-llm-pending?${qs.toString()}`;
  const data = await fetchJson(
    url,
    {
      method: 'GET',
      headers: {
        'X-Collector-Key': ingestKey,
      },
    },
    getTimeoutMs()
  );
  const itemsRaw = Array.isArray(data.items) ? data.items : [];
  const totalPendingRaw = Number(data.totalPending ?? itemsRaw.length);
  const items: Array<{ handle: string; profile: JsonRecord }> = [];
  for (const item of itemsRaw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as JsonRecord;
    const handle = toHandle(o.handle);
    const profile = (o.profile ?? null) as JsonRecord | null;
    if (!handle || !profile || typeof profile !== 'object' || Array.isArray(profile)) continue;
    items.push({ handle, profile: { ...profile, handle } });
  }
  return {
    totalPending: Number.isFinite(totalPendingRaw) ? Math.max(0, Math.floor(totalPendingRaw)) : items.length,
    items,
  };
}

/** Uma requisicao pontual com legendas (barato em tokens na fila: só usada na 2a fase do LLM). */
async function fetchProfilePostContextFromApi(
  apiBase: string,
  ingestKey: string,
  handle: string,
  refreshAll: boolean
): Promise<JsonRecord | null> {
  const h = toHandle(handle);
  if (!h) return null;
  const mediaLimit = getLlmMediaContextLimit();
  const qs = new URLSearchParams({
    handle: h,
    limit: '1',
    offset: '0',
    refreshAll: refreshAll ? '1' : '0',
    includeContent: '1',
    mediaLimit: String(mediaLimit),
  });
  const url = `${apiBase}/crawl/collector-llm-pending?${qs.toString()}`;
  const data = await fetchJson(
    url,
    {
      method: 'GET',
      headers: {
        'X-Collector-Key': ingestKey,
      },
    },
    getTimeoutMs()
  );
  const itemsRaw = Array.isArray(data.items) ? data.items : [];
  const first = itemsRaw[0] as JsonRecord | undefined;
  if (!first || typeof first !== 'object') return null;
  const profile = first.profile as JsonRecord | null;
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return null;
  return profile;
}

function mergePostContextFromApiProfile(base: JsonRecord, enriched: JsonRecord | null): JsonRecord {
  if (!enriched || typeof enriched !== 'object' || Array.isArray(enriched)) return base;
  const ctx = enriched._llm_content;
  if (ctx == null || typeof ctx !== 'object' || Array.isArray(ctx)) return base;
  return { ...base, _llm_content: ctx };
}

async function fetchLlmMainCategoryLabelsFromApi(
  apiBase: string,
  ingestKey: string
): Promise<{
  items: Array<{ label: string; count: number }>;
  labels: string[];
  totalDistinct: number;
  totalInfluencersLlm: number;
}> {
  const data = await fetchJson(
    `${apiBase}/crawl/collector-llm-main-categories`,
    {
      method: 'GET',
      headers: {
        'X-Collector-Key': ingestKey,
      },
    },
    getTimeoutMs()
  );
  const rawItems = Array.isArray(data.items) ? data.items : [];
  const items: Array<{ label: string; count: number }> = [];
  for (const row of rawItems) {
    if (row == null || typeof row !== 'object' || Array.isArray(row)) continue;
    const o = row as JsonRecord;
    const label = String(o.label ?? '').trim();
    const count = Number(o.count ?? 0);
    if (!label) continue;
    if (!Number.isFinite(count) || count <= 0) continue;
    items.push({ label, count: Math.floor(count) });
  }
  const labelsFromItems = items.map((x) => x.label);
  const labelsFallback = Array.isArray(data.labels)
    ? data.labels.map((x) => String(x ?? '').trim()).filter(Boolean)
    : [];
  const labels = labelsFromItems.length > 0 ? labelsFromItems : labelsFallback;
  const totalDistinct = Number(data.totalDistinct ?? items.length);
  const totalInfluencersLlm = Number(data.totalInfluencersLlm ?? 0);
  return {
    items,
    labels,
    totalDistinct: Number.isFinite(totalDistinct) ? Math.max(0, Math.floor(totalDistinct)) : items.length,
    totalInfluencersLlm: Number.isFinite(totalInfluencersLlm)
      ? Math.max(0, Math.floor(totalInfluencersLlm))
      : items.reduce((s, x) => s + x.count, 0),
  };
}

type LlmMainCategoryLabels = Awaited<ReturnType<typeof fetchLlmMainCategoryLabelsFromApi>>;
type LlmMainCategoryLabelsResponse = LlmMainCategoryLabels & {
  cached?: boolean;
  stale?: boolean;
  fromTaxonomy?: boolean;
};

const MAIN_CATEGORIES_CACHE_TTL_MS = 10 * 60 * 1000;
let mainCategoriesCache: { data: LlmMainCategoryLabels; fetchedAt: number } | null = null;
let mainCategoriesRefreshPromise: Promise<LlmMainCategoryLabels> | null = null;

function getMainCategoryTaxonomyFallback(): LlmMainCategoryLabels {
  const labels = [...MAIN_CATEGORY_CANONICAL_LABELS];
  return {
    items: labels.map((label) => ({ label, count: 0 })),
    labels,
    totalDistinct: labels.length,
    totalInfluencersLlm: 0,
  };
}

async function refreshMainCategoriesCache(apiBase: string, ingestKey: string): Promise<LlmMainCategoryLabels> {
  if (mainCategoriesRefreshPromise) return mainCategoriesRefreshPromise;
  mainCategoriesRefreshPromise = (async () => {
    try {
      const data = await fetchLlmMainCategoryLabelsFromApi(apiBase, ingestKey);
      mainCategoriesCache = { data, fetchedAt: Date.now() };
      return data;
    } finally {
      mainCategoriesRefreshPromise = null;
    }
  })();
  return mainCategoriesRefreshPromise;
}

/** Cache local + fallback taxonomico: evita bloquear o painel ~60s na API remota. */
async function getLlmMainCategoryLabelsCached(
  apiBase: string,
  ingestKey: string,
  forceRefresh = false
): Promise<LlmMainCategoryLabelsResponse> {
  const now = Date.now();
  const cache = mainCategoriesCache;
  const fresh = cache != null && now - cache.fetchedAt < MAIN_CATEGORIES_CACHE_TTL_MS;

  if (!forceRefresh && fresh) return { ...cache.data, cached: true };

  if (!forceRefresh && cache != null) {
    void refreshMainCategoriesCache(apiBase, ingestKey).catch(() => {});
    return { ...cache.data, cached: true, stale: true };
  }

  if (mainCategoriesRefreshPromise && !forceRefresh) {
    const base = cache?.data ?? getMainCategoryTaxonomyFallback();
    return { ...base, cached: cache != null, stale: true, fromTaxonomy: cache == null };
  }

  if (!forceRefresh) {
    void refreshMainCategoriesCache(apiBase, ingestKey).catch(() => {});
    return { ...getMainCategoryTaxonomyFallback(), fromTaxonomy: true, stale: true };
  }

  try {
    const data = await refreshMainCategoriesCache(apiBase, ingestKey);
    return { ...data, cached: false };
  } catch {
    if (cache != null) return { ...cache.data, cached: true, stale: true };
    return { ...getMainCategoryTaxonomyFallback(), fromTaxonomy: true, stale: true };
  }
}

async function fetchLlmCoverageStats(
  apiBase: string,
  ingestKey: string,
  forceRefresh = false
): Promise<{ totalProfiles: number; withoutLlm: number; withLlm: number }> {
  const qs = forceRefresh ? 'coverageStats=1&refresh=1' : 'coverageStats=1';
  const data = await fetchJson(
    `${apiBase}/crawl/collector-llm-pending?${qs}`,
    {
      method: 'GET',
      headers: {
        'X-Collector-Key': ingestKey,
      },
    },
    getTimeoutMs()
  );
  const totalProfilesRaw = Number(data.totalProfiles ?? 0);
  const withoutLlmRaw = Number(data.withoutLlm ?? 0);
  const withLlmRaw = Number(data.withLlm ?? 0);
  const totalProfiles = Number.isFinite(totalProfilesRaw) ? Math.max(0, Math.floor(totalProfilesRaw)) : 0;
  const withoutLlm = Number.isFinite(withoutLlmRaw) ? Math.max(0, Math.floor(withoutLlmRaw)) : 0;
  const withLlm = Number.isFinite(withLlmRaw)
    ? Math.max(0, Math.floor(withLlmRaw))
    : Math.max(0, totalProfiles - withoutLlm);
  return { totalProfiles, withoutLlm, withLlm };
}

type LlmCoverageStats = Awaited<ReturnType<typeof fetchLlmCoverageStats>>;
const COVERAGE_STATS_CACHE_TTL_MS = 2 * 60 * 1000;
let coverageStatsCache: { data: LlmCoverageStats; fetchedAt: number } | null = null;
let coverageStatsRefreshPromise: Promise<LlmCoverageStats> | null = null;

async function fetchLlmCoverageStatsCached(
  apiBase: string,
  ingestKey: string,
  forceRefresh = false
): Promise<LlmCoverageStats> {
  const now = Date.now();
  const cache = coverageStatsCache;
  if (!forceRefresh && cache != null && now - cache.fetchedAt < COVERAGE_STATS_CACHE_TTL_MS) {
    return cache.data;
  }
  if (coverageStatsRefreshPromise) return coverageStatsRefreshPromise;
  coverageStatsRefreshPromise = (async () => {
    try {
      const data = await fetchLlmCoverageStats(apiBase, ingestKey, forceRefresh);
      coverageStatsCache = { data, fetchedAt: Date.now() };
      return data;
    } finally {
      coverageStatsRefreshPromise = null;
    }
  })();
  return coverageStatsRefreshPromise;
}

async function pushLlmToApi(
  apiBase: string,
  ingestKey: string,
  handle: string,
  llm: LlmClassification,
  allowLlmReplace: boolean
): Promise<'updated' | 'already_completed'> {
  const q = allowLlmReplace ? '?allowLlmReplace=1' : '';
  const url = `${apiBase}/crawl/collector-ingest-llm${q}`;
  try {
    await fetchJson(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Collector-Key': ingestKey,
        },
        body: JSON.stringify({ handle, llm }),
      },
      getIngestPushTimeoutMs()
    );
    return 'updated';
  } catch (error) {
    if (!allowLlmReplace && isLlmAlreadyCompletedIngestError(error)) return 'already_completed';
    throw error;
  }
}

function displayFieldsFromProfileForResultRow(profile: JsonRecord): Pick<
  ExtractedResultRow,
  'llmStatus' | 'confidence' | 'mainCategory' | 'brandSafety' | 'qualification'
> {
  const llm = profile.llm;
  const llmObj =
    llm != null && typeof llm === 'object' && !Array.isArray(llm) ? (llm as JsonRecord) : null;
  const qualOk =
    llmObj?.qualification != null &&
    typeof llmObj.qualification === 'object' &&
    !Array.isArray(llmObj.qualification)
      ? asObject(llmObj.qualification)
      : null;
  const confRaw = llmObj?.confidence;
  return {
    llmStatus: String(llmObj?.status ?? ''),
    confidence: typeof confRaw === 'number' && Number.isFinite(confRaw) ? confRaw : null,
    mainCategory: qualOk
      ? parseMainCategory(qualOk.mainCategory) ?? String(qualOk.mainCategory ?? '-')
      : '-',
    brandSafety: qualOk ? pickBrandSafetyFromQualification(qualOk) : null,
    qualification: qualOk,
  };
}

function normalizeLanguageTagForExclusionRule(raw: string): string {
  return stripInvisibleFromString(String(raw ?? '').trim())
    .toLowerCase()
    .replace(/_/g, '-');
}

/** True se BCP-47 indica português (pt, pt-br, pt-pt, etc.). Vazio → false. */
function isPortugueseLanguageTag(raw: string): boolean {
  const n = normalizeLanguageTagForExclusionRule(raw);
  if (!n) return false;
  const primary = n.split('-')[0];
  return primary === 'pt';
}

function promoteLanguageToPtBrWhenBrazilianProfileEvidence(
  qualification: JsonRecord,
  profile: JsonRecord
): void {
  const langNorm = normalizeLanguageTagForExclusionRule(String(qualification.language ?? ''));
  if (langNorm === 'pt-br' || langNorm === 'desconhecido' || !profile || Object.keys(profile).length === 0) {
    return;
  }
  const intl = new Set(['en', 'es', 'fr', 'it']);
  if (!intl.has(langNorm)) return;
  const low = foldAsciiWs(profileAuthorialEvidenceLow(profile));
  const handle = toHandle(profile.handle ?? '');
  if (
    authorialTextLikelyBrazilianPortuguese(low) ||
    languageHintFromHandle(handle) === 'pt-br' ||
    hasDistinctivePortugueseSignals(low)
  ) {
    qualification.language = 'pt-br';
  }
}

/** Idioma fora da politica pt-br detectado no texto autoral — excluir sem chamar Ollama. */
function isPreLlmLanguageGateEnabled(): boolean {
  const raw = process.env.QUALIFY_PRE_LLM_LANGUAGE_GATE?.trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'no') return false;
  return true;
}

function resolvePreLlmLanguageExclusionReason(profile: JsonRecord): string | null {
  if (!isPreLlmLanguageGateEnabled()) return null;
  let lang = resolveLanguageFromFrancProfile(profile);
  const qualStub: JsonRecord = { language: lang, profileType: 'criador' };
  promoteLanguageToPtBrWhenBrazilianProfileEvidence(qualStub, profile);
  lang = String(qualStub.language ?? lang).trim();
  qualStub.language = lang;

  const mismatch = tryExcludeByAuthorialLanguageMismatch(qualStub, profile);
  if (mismatch) {
    return mismatch.replace('Exclusao automatica:', 'Exclusao automatica (pre-LLM):');
  }

  const langNorm = normalizeLanguageTagForExclusionRule(lang);
  if (langNorm && langNorm !== 'pt-br' && langNorm !== 'desconhecido') {
    return `Exclusao automatica (pre-LLM): language deve ser pt-br (recebido: ${lang})`;
  }
  return null;
}

function buildPreLlmPolicyExclusionLlm(qualification: JsonRecord, model: string): LlmClassification {
  return {
    qualifiedAt: new Date().toISOString(),
    model,
    version: 7,
    status: 'insufficient_data',
    confidence: 0,
    qualification: { ...qualification },
  };
}

/** Exclusao automatica na fila: só language pt-br (apos normalizacao) e profileType pessoal|criador. */
function shouldExcludeByLanguageAndCreatorRules(qualification: JsonRecord): boolean {
  const langNorm = normalizeLanguageTagForExclusionRule(String(qualification.language ?? ''));
  if (langNorm !== 'pt-br') return true;
  const profileT = String(qualification.profileType ?? '').trim().toLowerCase();
  if (profileT !== 'pessoal' && profileT !== 'criador') return true;
  return false;
}

function buildAutoExclusionReason(qualification: JsonRecord): string {
  const profileT = String(qualification.profileType ?? '').trim();
  const lang = String(qualification.language ?? '').trim();
  const langNorm = normalizeLanguageTagForExclusionRule(lang);
  if (langNorm !== 'pt-br') {
    return `Exclusao automatica: language deve ser pt-br (recebido: ${lang || '(vazio)'})`;
  }
  return `Exclusao automatica: profileType deve ser pessoal ou criador (recebido: ${profileT || '(vazio)'})`;
}

/** Politica da fila: idioma pt-br + profileType pessoal|criador (para UI e checagens pos-LLM). */
function qualificationMatchesAutoExclusionPolicy(qualification: JsonRecord): boolean {
  return shouldExcludeByLanguageAndCreatorRules(qualification);
}

function resolveAutoExclusionReason(
  qualification: JsonRecord,
  profile: JsonRecord
): string | null {
  const mismatch = tryExcludeByAuthorialLanguageMismatch(qualification, profile);
  if (mismatch) return mismatch;
  if (shouldExcludeByLanguageAndCreatorRules(qualification)) {
    return buildAutoExclusionReason(qualification);
  }
  return null;
}

async function purgeProfileForAutoExclusion(
  apiBase: string,
  ingestKey: string,
  handle: string,
  reason: string,
  llm: LlmClassification,
  qual: JsonRecord,
  emitLog: (msg: string) => void,
  startedAt: number
): Promise<void> {
  emitLog(`@${handle} | EXCLUINDO | ${reason}`);
  const via =
    getOptionalAdminBearerForPurge() != null
      ? 'DELETE admin/influencers (JWT)'
      : 'POST crawl/collector-delete-profile (X-Collector-Key)';
  emitLog(`@${handle} | >> API crawl: ${via}...`);
  const delT0 = Date.now();
  await deleteProfileAfterAutoExclusion(apiBase, ingestKey, handle);
  const delMs = Date.now() - delT0;
  const totalMs = Date.now() - startedAt;
  emitLog(`@${handle} | EXCLUIDO OK | perfil removido da base | delete ${delMs}ms | total ${totalMs}ms`);
}

/** True se o registro ja tinha classificacao LLM persistida — nunca auto-excluir; tambem skip pre-Ollama no modo sem_llm. */
function profileRecordAlreadyHasLlm(profile: JsonRecord): boolean {
  const llm = profile.llm;
  if (llm == null || typeof llm !== 'object' || Array.isArray(llm)) return false;
  const lo = llm as JsonRecord;
  const status = String(lo.status ?? '').trim().toLowerCase();
  if (status === 'done') return true;
  const q = lo.qualification;
  return q != null && typeof q === 'object' && !Array.isArray(q);
}

function isLlmAlreadyCompletedIngestError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.startsWith('409 ') ||
    msg.includes('COLLECTOR_LLM_ALREADY_COMPLETED') ||
    msg.includes('classificação LLM concluída') ||
    msg.includes('classificacao LLM concluida')
  );
}

/** Reconsulta a API antes do Ollama (2+ workers): perfil fora da fila = ja qualificado por outro. */
async function fetchPendingProfileByHandle(
  apiBase: string,
  ingestKey: string,
  handle: string,
  refreshAll: boolean
): Promise<JsonRecord | null> {
  const h = toHandle(handle);
  if (!h) return null;
  const qs = new URLSearchParams({
    handle: h,
    limit: '1',
    offset: '0',
    refreshAll: refreshAll ? '1' : '0',
    includeContent: '0',
    mediaLimit: '1',
  });
  const url = `${apiBase}/crawl/collector-llm-pending?${qs.toString()}`;
  const data = await fetchJson(
    url,
    {
      method: 'GET',
      headers: {
        'X-Collector-Key': ingestKey,
      },
    },
    getTimeoutMs()
  );
  const itemsRaw = Array.isArray(data.items) ? data.items : [];
  const first = itemsRaw[0] as JsonRecord | undefined;
  if (!first || typeof first !== 'object') return null;
  const profile = first.profile as JsonRecord | null;
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return null;
  return { ...profile, handle: toHandle(first.handle) || h };
}

/** Busca um perfil na base para reprocessamento (refreshAll=1, com midias iniciais). */
async function fetchProfileForReprocess(
  apiBase: string,
  ingestKey: string,
  handle: string,
  includePostContext = true
): Promise<JsonRecord | null> {
  const h = toHandle(handle);
  if (!h) return null;
  const qs = new URLSearchParams({
    handle: h,
    limit: '1',
    offset: '0',
    refreshAll: '1',
    includeContent: includePostContext ? '1' : '0',
    mediaLimit: String(getQualifyInitialMediaLimit()),
  });
  const url = `${apiBase}/crawl/collector-llm-pending?${qs.toString()}`;
  const data = await fetchJson(
    url,
    {
      method: 'GET',
      headers: {
        'X-Collector-Key': ingestKey,
      },
    },
    getTimeoutMs()
  );
  const itemsRaw = Array.isArray(data.items) ? data.items : [];
  const first = itemsRaw[0] as JsonRecord | undefined;
  if (!first || typeof first !== 'object') return null;
  const profile = first.profile as JsonRecord | null;
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return null;
  return { ...profile, handle: toHandle(first.handle) || h };
}

type QualifyPersistCounters = { done: number; excluded: number; failed: number };

/** Ollama + regras de exclusao + ingest (compartilhado entre fila e reprocessamento unitario). */
async function runLlmQualifyAndPersist(params: {
  handle: string;
  profile: JsonRecord;
  apiBase: string;
  ingestKey: string;
  model: string;
  maxReasoning: number;
  refreshAll: boolean;
  emitLog: (msg: string) => void;
}): Promise<{ row: ExtractedResultRow; counters: QualifyPersistCounters }> {
  const { handle, profile, apiBase, ingestKey, model, maxReasoning, refreshAll, emitLog } = params;
  const postCtx: ClassifyLlmPostContext = {
    apiBase,
    ingestKey,
    refreshAll,
    logHandle: handle,
  };
  const startedAt = Date.now();
  const zero: QualifyPersistCounters = { done: 0, excluded: 0, failed: 0 };

  try {
    let profileForLlm: JsonRecord = { ...profile };
    profileForLlm = await ensurePostContextOnProfileForLlm(profileForLlm, postCtx, {
      logStep: (msg) => emitLog(`@${handle} | ${msg}`),
      phaseLabel: 'pre-LLM idioma',
    });

    const preLlmReason = resolvePreLlmLanguageExclusionReason(profileForLlm);
    if (preLlmReason) {
      const qualStub: JsonRecord = { profileType: 'criador', language: 'desconhecido' };
      let lang = resolveLanguageFromFrancProfile(profileForLlm);
      qualStub.language = lang;
      promoteLanguageToPtBrWhenBrazilianProfileEvidence(qualStub, profileForLlm);
      tryExcludeByAuthorialLanguageMismatch(qualStub, profileForLlm);
      const stubLlm = buildPreLlmPolicyExclusionLlm(qualStub, model);
      emitLog(`@${handle} | >> pre-LLM: politica idioma — sem Ollama`);
      await purgeProfileForAutoExclusion(
        apiBase,
        ingestKey,
        handle,
        preLlmReason,
        stubLlm,
        qualStub,
        emitLog,
        startedAt
      );
      return {
        counters: { ...zero, excluded: 1 },
        row: {
          handle,
          result: 'excluido',
          llmStatus: stubLlm.status,
          confidence: 0,
          mainCategory: '-',
          brandSafety: null,
          qualification: qualStub,
          processedAt: new Date().toISOString(),
          error: preLlmReason,
        },
      };
    }

    const promptPhase1 = buildPrompt(profileForLlm, {
      includePostSamples: profileHasPostTextSamples(profileForLlm),
    });
    const promptChars = promptPhase1.length;
    const promptTokensApprox = Math.ceil(promptChars / 4);
    const nPostSamples = buildPostTextSamplesForPrompt(profileForLlm).length;
    emitLog(
      `@${handle} | >> prompt fase1 pronto (~${promptTokensApprox} tok, ${promptChars} chars)${nPostSamples > 0 ? ` | ${nPostSamples} amostra(s) post/reel recente(s)` : ''}`
    );
    if (isQualifyVerboseLog()) {
      emitLog(`@${handle} | prompt completo:\n${promptPhase1}`);
    }
    const llm = await classifyProfile(profileForLlm, model, maxReasoning, undefined, emitLog, postCtx);
    const qualOk = asObject(llm.qualification);
    const autoExclusionReason = resolveAutoExclusionReason(qualOk, profileForLlm);
    if (autoExclusionReason) {
      await purgeProfileForAutoExclusion(
        apiBase,
        ingestKey,
        handle,
        autoExclusionReason,
        llm,
        qualOk,
        emitLog,
        startedAt
      );
      return {
        counters: { ...zero, excluded: 1 },
        row: {
          handle,
          result: 'excluido',
          llmStatus: llm.status,
          confidence: llm.confidence,
          mainCategory: parseMainCategory(qualOk.mainCategory) ?? String(qualOk.mainCategory ?? ''),
          brandSafety: pickBrandSafetyFromQualification(qualOk),
          qualification: qualOk,
          processedAt: new Date().toISOString(),
          error: autoExclusionReason,
        },
      };
    }

    emitLog(`@${handle} | >> API collector: ingest LLM (POST)...`);
    const ingestT0 = Date.now();
    const ingestOutcome = await pushLlmToApi(apiBase, ingestKey, handle, llm, refreshAll);
    const ingestMs = Date.now() - ingestT0;
    if (ingestOutcome === 'already_completed') {
      emitLog(`@${handle} | PULADO | ingest recusou: LLM ja concluido por outro worker | ${ingestMs}ms`);
      return {
        counters: zero,
        row: {
          handle,
          result: 'ok',
          llmStatus: 'done',
          confidence: llm.confidence,
          mainCategory: parseMainCategory(qualOk.mainCategory) ?? String(qualOk.mainCategory ?? ''),
          brandSafety: pickBrandSafetyFromQualification(qualOk),
          qualification: qualOk,
          processedAt: new Date().toISOString(),
          error: 'Pulado: outro worker concluiu (409)',
        },
      };
    }
    const totalMs = Date.now() - startedAt;
    emitLog(`@${handle} | ok | ${Math.round(llm.confidence * 100)}% | ingest ${ingestMs}ms | total ${totalMs}ms`);
    logQualificationSummaryForHandle(handle, qualOk, emitLog);
    return {
      counters: { ...zero, done: 1 },
      row: {
        handle,
        result: 'ok',
        llmStatus: llm.status,
        confidence: llm.confidence,
        mainCategory: parseMainCategory(qualOk.mainCategory) ?? String(qualOk.mainCategory ?? ''),
        brandSafety: pickBrandSafetyFromQualification(qualOk),
        qualification: qualOk,
        processedAt: new Date().toISOString(),
        error: null,
      },
    };
  } catch (error) {
    if (error instanceof LlmValidationExhaustedError) {
      const llmBad = error.lastLlm;
      const qualBad = asObject(llmBad.qualification);
      const policyReason = resolveAutoExclusionAfterValidationExhausted(qualBad, profile, error.message);
      if (policyReason) {
        await purgeProfileForAutoExclusion(
          apiBase,
          ingestKey,
          handle,
          policyReason,
          llmBad,
          qualBad,
          emitLog,
          startedAt
        );
        return {
          counters: { ...zero, excluded: 1 },
          row: {
            handle,
            result: 'excluido',
            llmStatus: llmBad.status,
            confidence: llmBad.confidence,
            mainCategory: parseMainCategory(qualBad.mainCategory) ?? String(qualBad.mainCategory ?? ''),
            brandSafety: pickBrandSafetyFromQualification(qualBad),
            qualification: qualBad,
            processedAt: new Date().toISOString(),
            error: policyReason,
          },
        };
      }
      const keepMsg = `MANTIDO | LLM sem classificacao valida apos ${DEFAULT_LLM_REPAIR_ATTEMPTS} reparo(s) — perfil permanece na base | ${truncateLogLine(error.message, 200)}`;
      emitLog(`@${handle} | ${keepMsg}`);
      emitLog(`@${handle} | ERRO (mantido) | ${truncateLogLine(keepMsg, 240)}`);
      return {
        counters: { ...zero, failed: 1 },
        row: {
          handle,
          result: 'erro',
          llmStatus: String(llmBad.status ?? 'erro'),
          confidence: llmBad.confidence,
          mainCategory: parseMainCategory(qualBad.mainCategory) ?? String(qualBad.mainCategory ?? ''),
          brandSafety: pickBrandSafetyFromQualification(qualBad),
          qualification: qualBad,
          processedAt: new Date().toISOString(),
          error: keepMsg,
        },
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    emitLog(`@${handle} | ERRO | ${truncateLogLine(message, 240)}`);
    return {
      counters: { ...zero, failed: 1 },
      row: {
        handle,
        result: 'erro',
        llmStatus: 'erro',
        confidence: null,
        mainCategory: '-',
        brandSafety: null,
        qualification: null,
        processedAt: new Date().toISOString(),
        error: message,
      },
    };
  }
}

/** Requalifica um @ especifico (substitui LLM na API com allowLlmReplace). */
async function reprocessSingleHandle(
  rawHandle: string,
  options: { onLog?: (message: string) => void; includePostContext?: boolean } = {}
): Promise<ExtractedResultRow> {
  const handle = toHandle(rawHandle);
  if (!handle) {
    throw new Error('Informe um handle valido (ex.: creonetrioparadadura ou @creonetrioparadadura).');
  }
  const apiBase = getApiBaseOrThrow();
  const ingestKey = getIngestKeyOrThrow();
  const model = getOllamaModel();
  const maxReasoning = Math.max(
    1,
    Number(process.env.QUALIFY_MAX_REASONING ?? DEFAULT_MAX_REASONING) || DEFAULT_MAX_REASONING
  );
  const emitLog = (msg: string) => {
    if (options.onLog) {
      options.onLog(msg);
    } else {
      printQualifyLog(msg);
    }
  };

  emitLog(`Reprocessar @${handle}: buscando perfil na API (refreshAll=1)...`);
  const profile = await fetchProfileForReprocess(
    apiBase,
    ingestKey,
    handle,
    options.includePostContext !== false
  );
  if (!profile) {
    throw new Error(`Perfil @${handle} nao encontrado na base (collector-llm-pending?handle=).`);
  }

  emitLog(`Reprocessar @${handle}: iniciando LLM (substituicao permitida)...`);
  const { row } = await runLlmQualifyAndPersist({
    handle,
    profile,
    apiBase,
    ingestKey,
    model,
    maxReasoning,
    refreshAll: true,
    emitLog,
  });
  return row;
}

/** JWT adm opcional; sem ele usa POST /crawl/collector-delete-profile com a mesma chave do ingest. */
function getOptionalAdminBearerForPurge(): string | null {
  const t =
    process.env.QUALIFY_ADMIN_BEARER_TOKEN?.trim() ||
    process.env.QUALIFY_ADMIN_DELETE_JWT?.trim();
  return t || null;
}

async function deleteProfileAfterAutoExclusion(
  apiBase: string,
  ingestKey: string,
  handle: string
): Promise<void> {
  const h = toHandle(handle);
  if (!h) throw new Error('Handle invalido para exclusao.');
  const bearer = getOptionalAdminBearerForPurge();
  if (bearer) {
    const url = `${apiBase}/admin/influencers/${encodeURIComponent(h)}`;
    await fetchJson(
      url,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${bearer}`,
        },
      },
      getIngestPushTimeoutMs()
    );
    return;
  }
  const url = `${apiBase}/crawl/collector-delete-profile`;
  await fetchJson(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Collector-Key': ingestKey,
      },
      body: JSON.stringify({ handle: h }),
    },
    getIngestPushTimeoutMs()
  );
}

interface ClassifyLlmPostContext {
  apiBase: string;
  ingestKey: string;
  refreshAll: boolean;
  /** Para logs: em qual perfil esta cada etapa (paralelismo). */
  logHandle?: string;
}

/** Quando a resposta vem truncada ou com JSON quebrado, ainda assim capturar profileType citado pelo modelo. */
function tryExtractProfileTypeFromLooseAssistantJson(text: string): string | null {
  const compact = stripInvisibleFromString(text).replace(/\s+/g, ' ');
  const m = /["']?profileType["']?\s*:\s*["']?(criador|pessoal|empresa|noticia|marca|midia)["']?/iu.exec(
    compact
  );
  return m ? m[1].trim().toLowerCase() : null;
}

/** Corpo minimo para seguir o fluxo da fila (regra de exclusao por profileType) sem nova chamada ao modelo. */
function buildEmpresaStubParsedWhenJsonInvalid(): JsonRecord {
  return {
    confidence: 0.35,
    status: 'insufficient_data',
    qualification: {
      profileType: 'empresa',
    },
  };
}

function qualificationProfileTypeIsEmpresa(llm: LlmClassification): boolean {
  const q = asObject(llm.qualification);
  return String(q.profileType ?? '').trim().toLowerCase() === 'empresa';
}

async function classifyProfile(
  profile: JsonRecord,
  model: string,
  maxReasoning: number,
  promptOverride?: string,
  onLog?: (message: string) => void,
  postCtx?: ClassifyLlmPostContext
): Promise<LlmClassification> {
  const ollamaClient = getOllamaClient();
  const handleTag = postCtx?.logHandle ?? toHandle(profile.handle ?? '');
  const ollamaTag = `[${model}]`;
  const logStep = (msg: string) =>
    onLog?.(handleTag ? `@${handleTag} | ${msg}` : msg);

  let workingProfile: JsonRecord = { ...profile };
  workingProfile = await ensurePostContextOnProfileForLlm(workingProfile, postCtx, {
    promptOverride,
    logStep,
    phaseLabel: '1a passagem',
  });
  let languageFromFranc = resolveLanguageFromFrancProfile(workingProfile);
  const hasPostSamples = profileHasPostTextSamples(workingProfile);
  let prompt =
    promptOverride ??
    buildPrompt(workingProfile, {
      includePostSamples: hasPostSamples,
    });
  const runInitialGeneration = async (): Promise<JsonRecord> => {
    logStep(`>> Ollama ${ollamaTag}: geracao inicial (1a resposta)...`);
    const response = await ollamaClient.chat({
      model,
      messages: [
        {
          role: 'system',
          content:
            `Voce responde somente JSON valido. Textos descritivos (personaSummary, rotulos de categoria) em portugues do Brasil. Nao inclua chave "language" no JSON. contentPillars: sem gender feminino, nao preencha só com beleza/maquiagem se a bio e amostras nao citarem estetica ou make; com gender feminino o validador aceita. Nao use "${CONTENT_PILLAR_FALLBACK_LABEL}" — escolha temas concretos do perfil.`,
        },
        { role: 'user', content: prompt },
      ],
      stream: false,
      options: getOllamaChatOptions(),
    });
    const content = response.message?.content?.trim() ?? '';
    let parsed = tryParseJsonObject(content);
    if (!parsed) {
      const loosePt = tryExtractProfileTypeFromLooseAssistantJson(content);
      if (loosePt === 'empresa') {
        logStep(
          '>> local: JSON invalido mas profileType empresa detectado no texto — sem 2a chamada Ollama (regra de exclusao na fila)'
        );
        parsed = buildEmpresaStubParsedWhenJsonInvalid();
      }
    }
    if (!parsed) {
      logStep(`>> Ollama ${ollamaTag}: 2a chamada (corrigir JSON invalido)...`);
      const retry = await ollamaClient.chat({
        model,
        messages: [
          {
            role: 'system',
            content:
              'Converta a resposta anterior para JSON valido estrito. Retorne somente JSON, sem markdown, sem comentarios e sem texto extra.',
          },
          { role: 'user', content: prompt },
          {
            role: 'assistant',
            content: content || 'Sem resposta anterior',
          },
          {
            role: 'user',
            content:
              'Reescreva AGORA apenas no formato JSON solicitado. Sem chave "language". Demais campos: valores plausiveis.',
          },
        ],
        stream: false,
        options: getOllamaChatOptions(),
      });
      const retryContent = retry.message?.content?.trim() ?? '';
      parsed = tryParseJsonObject(retryContent);
      if (!parsed) {
        throw new Error(`Resposta do Ollama nao veio em JSON valido: ${(retryContent || content).slice(0, 240)}`);
      }
    }
    return parsed;
  };

  const pillarValidationOpts: QualificationValidationOptions = { allowContentPillarOutrosFallback: false };
  const pillarLastAttemptOpts: QualificationValidationOptions = { allowContentPillarOutrosFallback: true };

  let parsed = await runInitialGeneration();
  logStep('>> local: normalizar + validar regras...');
  let llm = normalizeClassification(
    parsed,
    workingProfile,
    model,
    maxReasoning,
    languageFromFranc,
    pillarValidationOpts
  );
  let validationErrors = validateLlmClassification(llm, workingProfile, pillarValidationOpts);
  if (validationErrors.length === 0) {
    logStep('>> ok: qualification valida (sem reparo LLM)');
    return llm;
  }

  const qualAfterNorm = asObject(llm.qualification);
  if (
    qualificationProfileTypeTriggersAutoExclusion(qualAfterNorm) &&
    hasStrongEmpresaSignalsInProfile(workingProfile)
  ) {
    logStep(
      `>> local: ${String(qualAfterNorm.profileType ?? 'empresa')} confirmado na bio — sem reparo LLM; fila aplica exclusao automatica`
    );
    return llm;
  }
  if (qualificationProfileTypeIsEmpresa(llm)) {
    logStep(
      '>> local: empresa sem sinais fortes na bio — tentando reparo LLM (possivel falso positivo do modelo)'
    );
  }

  let attemptedPostFetch = false;

  for (let attempt = 1; attempt <= DEFAULT_LLM_REPAIR_ATTEMPTS; attempt++) {
    logStep(
      `>> local: validacao falhou — ${summarizeValidationErrorsForLog(validationErrors)} (reparo ${attempt}/${DEFAULT_LLM_REPAIR_ATTEMPTS})`
    );
    if (
      postCtx &&
      promptOverride == null &&
      !attemptedPostFetch &&
      validationErrorsSuggestEnrichingWithPostSamples(validationErrors) &&
      !profileHasPostTextSamples(workingProfile)
    ) {
      attemptedPostFetch = true;
      workingProfile = await ensurePostContextOnProfileForLlm(workingProfile, postCtx, {
        promptOverride,
        logStep,
        phaseLabel: 'reparo',
      });
    }

    const usePostsInPrompt = promptOverride == null && profileHasPostTextSamples(workingProfile);

    if (promptOverride == null) {
      languageFromFranc = resolveLanguageFromFrancProfile(workingProfile);
      prompt = buildPrompt(workingProfile, {
        includePostSamples: usePostsInPrompt,
      });
    }

    logStep(
      `>> Ollama ${ollamaTag}: reparo validacao #${attempt}/${DEFAULT_LLM_REPAIR_ATTEMPTS}...`
    );
    const repairPrompt = buildRepairPrompt(prompt, parsed, validationErrors);
    const repair = await ollamaClient.chat({
      model,
      messages: [
        {
          role: 'system',
          content:
            'Voce corrige JSON e responde apenas JSON valido. Textos descritivos em pt-BR. Nao inclua "language". personaSummary: sempre reescreva voce mesmo (papel do influenciador + nicho concreto); nunca use frases genericas de template. Se o erro citar beleza/maquiagem sem evidencia e gender nao for feminino: remova maquiagem/beleza dos pillars ou subs e use termos sustentados pela bio/amostras; com gender feminino pode manter Beleza.',
        },
        { role: 'user', content: repairPrompt },
      ],
      stream: false,
      options: getOllamaChatOptions(),
    });
    const repairContent = repair.message?.content?.trim() ?? '';
    let repairedParsed = tryParseJsonObject(repairContent);
    if (!repairedParsed && repairContent.length > 0) {
      logStep('>> local: reparo nao veio em JSON valido — retry estrito JSON...');
      const strictRepair = await ollamaClient.chat({
        model,
        messages: [
          {
            role: 'system',
            content:
              'Responda somente com um objeto JSON valido (sem markdown, sem comentarios). Preserve os campos qualification, confidence e status.',
          },
          {
            role: 'user',
            content: `Converta em JSON valido:\n${repairContent.slice(0, 14000)}`,
          },
        ],
        stream: false,
        options: getOllamaChatOptions(),
      });
      repairedParsed = tryParseJsonObject(strictRepair.message?.content?.trim() ?? '');
    }
    if (!repairedParsed) {
      logStep('>> local: reparo nao veio em JSON valido, nova tentativa...');
      continue;
    }
    parsed = repairedParsed;
    logStep('>> local: revalidar apos reparo...');
    llm = normalizeClassification(
      repairedParsed,
      workingProfile,
      model,
      maxReasoning,
      languageFromFranc,
      pillarValidationOpts
    );
    validationErrors = validateLlmClassification(llm, workingProfile, pillarValidationOpts);
    if (validationErrors.length === 0) {
      logStep('>> ok: qualification valida apos reparo');
      return llm;
    }
  }

  if (validationErrorsMentionContentPillars(validationErrors)) {
    const qualFallback = asObject(llm.qualification);
    qualFallback.contentPillars = [CONTENT_PILLAR_FALLBACK_LABEL];
    llm = { ...llm, qualification: qualFallback };
    validationErrors = validateLlmClassification(llm, workingProfile, pillarLastAttemptOpts);
    if (validationErrors.length === 0) {
      logStep(`>> ok: contentPillars fallback "${CONTENT_PILLAR_FALLBACK_LABEL}" (ultima tentativa)`);
      return llm;
    }
  }

  const serverFixed = tryServerCorrectBeautyAndRevalidate(
    llm,
    workingProfile,
    model,
    maxReasoning,
    languageFromFranc,
    pillarValidationOpts,
    logStep
  );
  if (serverFixed) return serverFixed.llm;

  throw new LlmValidationExhaustedError(
    `Saida LLM invalida apos reprocessamento: ${validationErrors.join('; ')}`,
    llm
  );
}

interface BatchProgress {
  total: number;
  processed: number;
  done: number;
  /** Falhas reais (rede, ingest, purge, LLM sem resposta JSON, etc.). */
  failed: number;
  /** Purge na API: regras language/profileType (empresa/marca/idioma estrangeiro). */
  excluded: number;
  currentHandle: string | null;
  runStartedAt: string;
  elapsedMs: number;
  estimatedRemainingMs: number | null;
  onlyWithLlm: boolean;
  /** Filtro por mainCategory canônica (só com "com LLM"); vazio = todas. */
  mainCategoryFilter: string | null;
  /** Particao da fila (ex.: shard 1/2); null = fila inteira. */
  shardLabel: string | null;
}

interface ExtractedResultRow {
  handle: string;
  result: 'ok' | 'erro' | 'excluido';
  llmStatus: string;
  confidence: number | null;
  mainCategory: string;
  /** Cópia explícita para a UI (JSON as vezes omite chaves undefined em objetos aninhados). */
  brandSafety: string | null;
  qualification: JsonRecord | null;
  processedAt: string;
  error: string | null;
}

interface BatchSummary {
  total: number;
  done: number;
  failed: number;
  excluded: number;
  stopped: boolean;
}

interface BatchOptions {
  shouldStop?: () => boolean;
  onProgress?: (progress: BatchProgress) => void;
  onResult?: (row: ExtractedResultRow) => void;
  onlyWithLlm?: boolean;
  /** Reprocessar só perfis cujo LLM atual tem esta mainCategory (canônica). Só faz efeito com onlyWithLlm. */
  mainCategory?: string;
  onLog?: (message: string) => void;
  /** Quantidade de perfis processados em paralelo (LLM + ingest). Padrao 1. */
  concurrency?: number;
}

async function runBatch(options: BatchOptions = {}): Promise<BatchSummary> {
  const apiBase = getApiBaseOrThrow();
  const ingestKey = getIngestKeyOrThrow();
  const model = getOllamaModel();
  const batchSize = Math.max(1, Number(process.env.QUALIFY_BATCH_SIZE ?? DEFAULT_BATCH_SIZE) || DEFAULT_BATCH_SIZE);
  const maxReasoning = Math.max(
    1,
    Number(process.env.QUALIFY_MAX_REASONING ?? DEFAULT_MAX_REASONING) || DEFAULT_MAX_REASONING
  );
  const concurrency = Math.max(
    1,
    Math.min(16, Math.floor(Number(options.concurrency ?? process.env.QUALIFY_CONCURRENCY ?? 1)) || 1)
  );
  const shard = getQualifyShardConfig();
  const fetchBatchSize = shard.active ? batchSize * shard.count : batchSize;

  const onlyWithLlm = options.onlyWithLlm === true;
  const mainCategoryFilter = String(options.mainCategory ?? '').trim();
  const useCategoryFilter = mainCategoryFilter.length > 0 && onlyWithLlm;
  const queueIncludeContent = isQualifyQueueIncludeContentEnabled();
  const refreshAll = onlyWithLlm;
  const needsCoverageForOffset = onlyWithLlm && !useCategoryFilter;

  const runStartedAtMs = Date.now();
  const progress: BatchProgress = {
    total: 0,
    processed: 0,
    done: 0,
    failed: 0,
    excluded: 0,
    currentHandle: 'Consultando fila na API…',
    runStartedAt: new Date(runStartedAtMs).toISOString(),
    elapsedMs: 0,
    estimatedRemainingMs: null,
    onlyWithLlm,
    mainCategoryFilter: useCategoryFilter ? mainCategoryFilter : null,
    shardLabel: shard.active ? formatShardLabel(shard) : null,
  };
  options.onProgress?.(progress);

  let coverage: LlmCoverageStats = { totalProfiles: 0, withoutLlm: 0, withLlm: 0 };
  if (needsCoverageForOffset) {
    options.onLog?.('Consultando estatisticas da base (pode levar ~1 min)…');
    coverage = await fetchLlmCoverageStatsCached(apiBase, ingestKey);
  }

  const queueOffset = useCategoryFilter ? 0 : onlyWithLlm ? coverage.withoutLlm : 0;
  const processedHandles = new Set<string>();
  let listOffset = queueOffset;
  options.onLog?.('Carregando primeiros perfis da fila (pode levar ~1 min)…');
  let firstBatch = await fetchPendingFromApi(
    apiBase,
    ingestKey,
    fetchBatchSize,
    listOffset,
    refreshAll,
    useCategoryFilter ? mainCategoryFilter : undefined,
    undefined,
    queueIncludeContent
  );
  const emitLog = (msg: string) => {
    if (options.onLog) {
      options.onLog(msg);
    } else {
      printQualifyLog(msg);
    }
  };
  logOllamaConfig(emitLog);
  if (firstBatch.items.length === 0 && queueOffset > 0) {
    emitLog(
      `Aviso: pagina vazia com offset inicial ${queueOffset}; tentando offset 0 (fila pode ter mudado vs estatistica inicial).`
    );
    listOffset = 0;
    firstBatch = await fetchPendingFromApi(
      apiBase,
      ingestKey,
      fetchBatchSize,
      listOffset,
      refreshAll,
      useCategoryFilter ? mainCategoryFilter : undefined,
      undefined,
      queueIncludeContent
    );
  }
  const rawTargetTotal = onlyWithLlm
    ? useCategoryFilter
      ? firstBatch.totalPending
      : coverage.withLlm
    : firstBatch.totalPending;
  const targetTotal = shard.active ? Math.max(1, Math.ceil(rawTargetTotal / shard.count)) : rawTargetTotal;
  const modoLabel = onlyWithLlm ? 'com_llm' : 'sem_llm';
  const shardSuffix = shard.active ? `, ${formatShardLabel(shard)} (~${targetTotal} perfis nesta particao)` : '';
  emitLog(
    `Perfis alvo via API: ${rawTargetTotal} (modo=${modoLabel}${useCategoryFilter ? `, categoria=${mainCategoryFilter}` : ''}, paralelo=${concurrency}${shardSuffix})`
  );
  emitLog(
    `mainCategory: taxonomia fechada com ${MAIN_CATEGORY_CANONICAL_LABELS.length} rotulos canonicos (+ normalizacao de aliases no servidor)`
  );
  progress.total = targetTotal;
  progress.currentHandle = firstBatch.items.length > 0 ? null : 'Fila vazia';
  options.onProgress?.(progress);
  if (rawTargetTotal === 0) {
    return { total: 0, done: 0, failed: 0, excluded: 0, stopped: false };
  }
  if (!shard.active && firstBatch.items.length === 0) {
    return { total: 0, done: 0, failed: 0, excluded: 0, stopped: false };
  }

  let currentBatch = shuffleQueueItems(firstBatch.items);
  /** Sem itens novos processados desde o ultimo wrap da fila (offset voltou ao base). */
  let queueWrapsWithoutWork = 0;

  while (true) {
    if (options.shouldStop?.()) {
      emitLog('Interrompido por solicitacao do usuario.');
      return {
        total: progress.total,
        done: progress.done,
        failed: progress.failed,
        excluded: progress.excluded,
        stopped: true,
      };
    }

    const todo = currentBatch.filter((item) => {
      const handle = toHandle(item.handle || item.profile.handle);
      return Boolean(handle) && !processedHandles.has(handle) && handleBelongsToShard(handle, shard);
    });

    if (todo.length === 0) {
      if (currentBatch.length === 0) {
        if (listOffset > queueOffset) {
          queueWrapsWithoutWork++;
          if (queueWrapsWithoutWork >= 2) {
            emitLog(
              '(fila) encerrando: varreu o fim da fila duas vezes sem processar nenhum perfil novo (fila vazia ou estagnada).'
            );
            break;
          }
          listOffset = queueOffset;
          const wrapBatch = await fetchPendingFromApi(
            apiBase,
            ingestKey,
            fetchBatchSize,
            listOffset,
            refreshAll,
            useCategoryFilter ? mainCategoryFilter : undefined,
            undefined,
            queueIncludeContent
          );
          if (!onlyWithLlm) progress.total = Math.max(progress.total, wrapBatch.totalPending);
          currentBatch = shuffleQueueItems(wrapBatch.items);
          continue;
        }
        break;
      }
      listOffset += currentBatch.length;
      emitLog(
        `(fila) ${currentBatch.length} perfil(is) nesta janela ja processado(s) nesta execucao — avancando offset para ${listOffset}.`
      );
      const skippedBatch = await fetchPendingFromApi(
        apiBase,
        ingestKey,
        fetchBatchSize,
        listOffset,
        refreshAll,
        useCategoryFilter ? mainCategoryFilter : undefined,
        undefined,
        queueIncludeContent
      );
      if (!onlyWithLlm) progress.total = Math.max(progress.total, skippedBatch.totalPending);
      currentBatch = shuffleQueueItems(skippedBatch.items);
      continue;
    }

    for (let sliceStart = 0; sliceStart < todo.length; sliceStart += concurrency) {
      if (options.shouldStop?.()) {
        emitLog('Interrompido por solicitacao do usuario.');
        return {
          total: progress.total,
          done: progress.done,
          failed: progress.failed,
          excluded: progress.excluded,
          stopped: true,
        };
      }
      const slice = todo.slice(sliceStart, sliceStart + concurrency);
      const activeHandles = slice
        .map((it) => toHandle(it.handle || it.profile.handle))
        .filter((h) => Boolean(h) && !processedHandles.has(h));
      if (activeHandles.length === 0) continue;
      progress.currentHandle =
        activeHandles.length <= 4
          ? activeHandles.join(' · ')
          : `${activeHandles.slice(0, 3).join(' · ')} · +${activeHandles.length - 3}`;
      options.onProgress?.(progress);

      await Promise.all(
        slice.map(async (item) => {
          const handle = toHandle(item.handle || item.profile.handle);
          if (!handle || processedHandles.has(handle)) return;
          processedHandles.add(handle);
          progress.total = Math.max(targetTotal, processedHandles.size);
          try {
            if (!refreshAll) {
              if (profileRecordAlreadyHasLlm(item.profile)) {
                const disp = displayFieldsFromProfileForResultRow(item.profile);
                emitLog(`@${handle} | PULADO | LLM ja persistido na base (sem reprocessamento)`);
                options.onResult?.({
                  handle,
                  result: 'ok',
                  llmStatus: disp.llmStatus || 'done',
                  confidence: disp.confidence,
                  mainCategory: disp.mainCategory,
                  brandSafety: disp.brandSafety,
                  qualification: disp.qualification,
                  processedAt: new Date().toISOString(),
                  error: 'Pulado: LLM ja persistido',
                });
                return;
              }
              const freshProfile = await fetchPendingProfileByHandle(apiBase, ingestKey, handle, false);
              if (!freshProfile) {
                emitLog(`@${handle} | PULADO | LLM ja concluido por outro worker`);
                options.onResult?.({
                  handle,
                  result: 'ok',
                  llmStatus: 'done',
                  confidence: null,
                  mainCategory: '-',
                  brandSafety: null,
                  qualification: null,
                  processedAt: new Date().toISOString(),
                  error: 'Pulado: outro worker concluiu',
                });
                return;
              }
              if (profileRecordAlreadyHasLlm(freshProfile)) {
                const disp = displayFieldsFromProfileForResultRow(freshProfile);
                emitLog(`@${handle} | PULADO | LLM ja persistido na base (consulta API)`);
                options.onResult?.({
                  handle,
                  result: 'ok',
                  llmStatus: disp.llmStatus || 'done',
                  confidence: disp.confidence,
                  mainCategory: disp.mainCategory,
                  brandSafety: disp.brandSafety,
                  qualification: disp.qualification,
                  processedAt: new Date().toISOString(),
                  error: 'Pulado: LLM ja persistido',
                });
                return;
              }
              item.profile = freshProfile;
            }

            const { row, counters } = await runLlmQualifyAndPersist({
              handle,
              profile: item.profile,
              apiBase,
              ingestKey,
              model,
              maxReasoning,
              refreshAll,
              emitLog,
            });
            progress.done += counters.done;
            progress.excluded += counters.excluded;
            progress.failed += counters.failed;
            options.onResult?.(row);
          } catch (error) {
            progress.failed++;
            const message = error instanceof Error ? error.message : String(error);
            options.onResult?.({
              handle,
              result: 'erro',
              llmStatus: 'erro',
              confidence: null,
              mainCategory: '-',
              brandSafety: null,
              qualification: null,
              processedAt: new Date().toISOString(),
              error: message,
            });
            emitLog(`@${handle} | ERRO | ${truncateLogLine(message, 240)}`);
          } finally {
            progress.processed++;
            progress.elapsedMs = Math.max(0, Date.now() - runStartedAtMs);
            if (progress.processed > 0 && progress.total > progress.processed) {
              const avgMsPerItem = progress.elapsedMs / progress.processed;
              progress.estimatedRemainingMs = Math.max(
                0,
                Math.round((progress.total - progress.processed) * avgMsPerItem)
              );
            } else {
              progress.estimatedRemainingMs = 0;
            }
            options.onProgress?.(progress);
          }
        })
      );
    }

    queueWrapsWithoutWork = 0;
    listOffset = queueOffset;
    const nextBatch = await fetchPendingFromApi(
      apiBase,
      ingestKey,
      fetchBatchSize,
      listOffset,
      refreshAll,
      useCategoryFilter ? mainCategoryFilter : undefined,
      undefined,
      queueIncludeContent
    );
    if (!onlyWithLlm) progress.total = Math.max(progress.total, nextBatch.totalPending);
    currentBatch = shuffleQueueItems(nextBatch.items);
  }

  return {
    total: progress.total,
    done: progress.done,
    failed: progress.failed,
    excluded: progress.excluded,
    stopped: false,
  };
}

function getOllamaModel(): string {
  return process.env.OLLAMA_MODEL?.trim() || DEFAULT_MODEL;
}

function formatOllamaConfigMessage(): string {
  const host = process.env.OLLAMA_HOST?.trim() || DEFAULT_OLLAMA_HOST;
  const opts = getOllamaChatOptions();
  const ctx = opts.num_ctx ?? DEFAULT_OLLAMA_NUM_CTX;
  const predict = opts.num_predict ?? DEFAULT_OLLAMA_NUM_PREDICT;
  return `Ollama LLM: ${getOllamaModel()} @ ${host} (num_ctx=${ctx}, num_predict=${predict})`;
}

function logOllamaConfig(onLog?: (msg: string) => void): void {
  const line = formatOllamaConfigMessage();
  if (onLog) onLog(line);
  else printQualifyLog(line);
}

let cachedOllamaClient: Ollama | null = null;

function getOllamaClient(): Ollama {
  if (cachedOllamaClient) return cachedOllamaClient;
  const host = process.env.OLLAMA_HOST?.trim() || DEFAULT_OLLAMA_HOST;
  cachedOllamaClient = new Ollama({ host });
  return cachedOllamaClient;
}

function readPositiveIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

/** Opcoes de inferencia repassadas ao Ollama (num_ctx, threads CPU, limite de saida). */
function getOllamaChatOptions(): Record<string, number> {
  const opts: Record<string, number> = {
    num_ctx: readPositiveIntEnv('OLLAMA_NUM_CTX', DEFAULT_OLLAMA_NUM_CTX, 1024, 8192),
    num_predict: readPositiveIntEnv('OLLAMA_NUM_PREDICT', DEFAULT_OLLAMA_NUM_PREDICT, 128, 4096),
    temperature: 0.15,
  };
  const threads = readPositiveIntEnv('OLLAMA_NUM_THREAD', 0, 1, 64);
  if (threads > 0) opts.num_thread = threads;
  return opts;
}

function getUiPort(): number {
  const n = Number(process.env.QUALIFY_UI_PORT ?? DEFAULT_UI_PORT);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_UI_PORT;
}

function renderUiHtml(): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Qualify - Painel</title>
  <style>
    body{font-family:Segoe UI,Arial,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:24px}
    .card{max-width:1040px;margin:0 auto;background:#111827;border:1px solid #334155;border-radius:12px;padding:20px}
    h1{margin:0 0 16px;font-size:22px}
    .row{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px}
    button{border:0;border-radius:8px;padding:10px 14px;font-weight:600;cursor:pointer}
    .start{background:#16a34a;color:#fff}.stop{background:#dc2626;color:#fff}
    .muted{color:#94a3b8;font-size:13px}
    .kpi{background:#0b1220;border:1px solid #334155;border-radius:8px;padding:12px;min-width:130px}
    .kpi b{display:block;font-size:20px;margin-top:4px}
    .check{display:flex;align-items:center;gap:8px;background:#0b1220;border:1px solid #334155;border-radius:8px;padding:10px 12px}
    .progress-wrap{margin:8px 0 4px}
    .progress-track{height:12px;background:#0b1220;border:1px solid #334155;border-radius:999px;overflow:hidden}
    .progress-bar{height:100%;width:0%;background:linear-gradient(90deg,#22c55e,#16a34a);transition:width .25s ease}
    pre{background:#020617;border:1px solid #334155;border-radius:8px;padding:12px;max-height:320px;overflow:auto}
    .timebox{margin-top:6px;padding:10px 12px;background:#0b1220;border:1px solid #334155;border-radius:8px}
    .timebox b{color:#93c5fd}
    .table-wrap{overflow:auto;border:1px solid #334155;border-radius:8px;background:#020617}
    table{width:100%;border-collapse:collapse;min-width:1400px}
    th,td{padding:8px;border-bottom:1px solid #1e293b;font-size:12px;text-align:left;vertical-align:top}
    th{color:#93c5fd;background:#0b1220}
    tr:last-child td{border-bottom:none}
    .json-cell{max-width:520px}
    .json-cell pre{margin:0;background:#000814;border:1px solid #1e293b;border-radius:6px;padding:8px;max-height:220px;overflow:auto}
    .persona-cell{max-width:280px;max-height:120px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-size:11px;line-height:1.35}
    td.td-excl-regra,th.td-excl-regra{min-width:72px;max-width:88px;white-space:nowrap;font-weight:600}
    td.td-brand-safety,th.td-brand-safety{min-width:92px;max-width:140px;font-weight:600;color:#f8fafc}
    a.ig-link{color:#93c5fd;text-decoration:underline}
    a.ig-link:hover{color:#bfdbfe}
    .ok{color:#22c55e}.erro{color:#ef4444}.excluido{color:#f59e0b}
    tr.row-excluido{outline:1px solid rgba(245,158,11,0.35)}
  </style>
</head>
<body>
  <div class="card">
    <h1>Qualificacao de Influencers</h1>
    <div class="row">
      <button id="startBtn" class="start">Iniciar</button>
      <button id="stopBtn" class="stop">Parar</button>
      <label class="check"><input id="refreshAll" type="checkbox" /> Atualizar perfis que ja tem LLM</label>
      <label class="check">Só mainCategory <select id="mainCategory" style="min-width:180px;max-width:260px;padding:6px 8px;border-radius:6px;border:1px solid #334155;background:#0b1220;color:#e2e8f0" title="Lista vinda da API (rotulos ja persistidos). Só aplica com a opcao acima."><option value="">Todas</option></select></label>
      <label class="check">Threads paralelas <input id="concurrency" type="number" min="1" max="16" step="1" value="1" style="width:56px" /></label>
      <div class="muted">Atualizacao automatica a cada 1s</div>
    </div>
    <div class="row">
      <label class="check">Reprocessar @ <input id="reprocessHandle" type="text" placeholder="usuario" autocomplete="off" style="min-width:200px;padding:8px 10px;border-radius:8px;border:1px solid #334155;background:#0b1220;color:#e2e8f0" /></label>
      <button id="reprocessBtn" type="button" style="background:#2563eb;color:#fff;border:0;border-radius:8px;padding:10px 14px;font-weight:600;cursor:pointer">Reprocessar 1 perfil</button>
      <span class="muted" id="reprocessStatus"></span>
    </div>
    <div class="row">
      <div class="kpi">Status<b id="status">-</b></div>
      <div class="kpi">Pendentes no lote<b id="total">0</b></div>
      <div class="kpi">Processados<b id="processed">0</b></div>
      <div class="kpi">OK<b id="done">0</b></div>
      <div class="kpi">Excl. regra<b id="excluded">0</b></div>
      <div class="kpi">Falhas<b id="failed">0</b></div>
      <div class="kpi">Handle atual<b id="current">-</b></div>
      <div class="kpi">Paralelo<b id="parallel">1</b></div>
      <div class="kpi">Com LLM<b id="withLlm">0</b></div>
      <div class="kpi">Sem LLM<b id="withoutLlm">0</b></div>
    </div>
    <div class="progress-wrap">
      <div class="progress-track"><div id="progressBar" class="progress-bar"></div></div>
    </div>
    <div class="muted" id="meta"></div>
    <div class="muted" id="eta">ETA: -</div>
    <div class="timebox" id="timeAnalysis">Analise de tempo: aguardando inicio.</div>
    <h3>Resultados extraidos <span class="muted" style="font-weight:400;font-size:14px">(ultimos ${QUALIFY_UI_RESULTS_MAX})</span></h3>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Processado</th>
            <th>Handle</th>
            <th>personaSummary</th>
            <th>Conf. / status</th>
            <th class="td-excl-regra">Excl. regra</th>
            <th>profileType</th>
            <th>mainCategory</th>
            <th>gender</th>
            <th>language</th>
            <th>subCategories</th>
            <th>contentPillars</th>
            <th>audienceType</th>
            <th class="td-brand-safety">brandSafety</th>
          </tr>
        </thead>
        <tbody id="resultsBody">
          <tr><td colspan="13">Sem resultados ainda.</td></tr>
        </tbody>
      </table>
    </div>
    <h3>Logs recentes</h3>
    <div class="row">
      <button id="copyLogsBtn">Copiar logs</button>
      <div class="muted" id="copyLogsStatus"></div>
    </div>
    <pre id="logs">Carregando...</pre>
  </div>
  <script>
    function parseBoolParam(name, fallback=false){
      const raw = new URLSearchParams(window.location.search).get(name);
      if(raw == null) return fallback;
      const v = String(raw).trim().toLowerCase();
      return v === '1' || v === 'true' || v === 'yes';
    }
    function setBoolParam(name, enabled){
      const params = new URLSearchParams(window.location.search);
      if(enabled) params.set(name, '1');
      else params.delete(name);
      const q = params.toString();
      const next = q ? (window.location.pathname + '?' + q) : window.location.pathname;
      window.history.replaceState({}, '', next);
    }
    function setStringParam(name, value){
      const params = new URLSearchParams(window.location.search);
      const v = String(value ?? '').trim();
      if(v) params.set(name, v);
      else params.delete(name);
      const q = params.toString();
      const next = q ? (window.location.pathname + '?' + q) : window.location.pathname;
      window.history.replaceState({}, '', next);
    }
    function formatDuration(ms){
      if(!Number.isFinite(ms) || ms < 0) return '-';
      const totalSec = Math.round(ms / 1000);
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      if(h > 0) return h + 'h ' + String(m).padStart(2,'0') + 'm ' + String(s).padStart(2,'0') + 's';
      return m + 'm ' + String(s).padStart(2,'0') + 's';
    }
    function esc(v){
      return String(v ?? '')
        .replace(/&/g,'&amp;')
        .replace(/</g,'&lt;')
        .replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;')
        .replace(/'/g,'&#039;');
    }
    function processedAtSortMs(r){
      const t = Date.parse(String(r && r.processedAt != null ? r.processedAt : ''));
      return Number.isFinite(t) ? t : 0;
    }
    function renderResults(items){
      const body = document.getElementById('resultsBody');
      const list = Array.isArray(items) ? items.slice() : [];
      list.sort((a, b) => {
        const da = processedAtSortMs(a);
        const db = processedAtSortMs(b);
        if (db !== da) return db - da;
        return String(a && a.handle != null ? a.handle : '').localeCompare(
          String(b && b.handle != null ? b.handle : ''),
          'pt-BR'
        );
      });
      body.replaceChildren();
      if(list.length === 0){
        const tr0 = document.createElement('tr');
        const td0 = document.createElement('td');
        td0.colSpan = 13;
        td0.textContent = 'Sem resultados ainda.';
        tr0.appendChild(td0);
        body.appendChild(tr0);
        return;
      }
      const rawValue = (v)=>{
        if(v == null) return '';
        if(typeof v === 'object') return JSON.stringify(v);
        return String(v);
      };
      const joinList = (v)=>{
        if(Array.isArray(v)) return v.map((x)=>String(x ?? '').trim()).filter(Boolean).join(', ');
        return rawValue(v);
      };
      const formatConf = (c)=>{
        const n = Number(c);
        if(!Number.isFinite(n)) return rawValue(c);
        return String(Math.round(n * 1000) / 1000);
      };
      const normLang = (v)=>String(v ?? '').trim().toLowerCase().replace(/_/g, '-');
      const matchesAutoExclusionPolicy = (q)=>{
        const lang = normLang(q.language);
        const pt = String(q.profileType ?? '').trim().toLowerCase();
        if(lang && lang !== 'pt-br') return true;
        if(pt && pt !== 'pessoal' && pt !== 'criador') return true;
        return false;
      };
      for(let j = 0; j < list.length; j++){
        const r = list[j];
        const q = r.qualification && typeof r.qualification === 'object' ? r.qualification : {};
        const policyExcl = matchesAutoExclusionPolicy(q);
        const tr = document.createElement('tr');
        if(r.result === 'excluido' || policyExcl) tr.className = 'row-excluido';
        const tdProc = document.createElement('td');
        const procMs = processedAtSortMs(r);
        if(procMs > 0){
          tdProc.textContent = new Date(procMs).toLocaleString('pt-BR');
          tdProc.title = String(r.processedAt ?? '');
        }else{
          tdProc.textContent = String.fromCharCode(0x2014);
        }
        tr.appendChild(tdProc);
        const tdHandle = document.createElement('td');
        const slug = String(r.handle ?? '').trim().replace(/^@/, '').split(/[/?#]/)[0];
        if(slug){
          const a = document.createElement('a');
          a.className = 'ig-link';
          a.href = 'https://www.instagram.com/' + encodeURIComponent(slug) + '/';
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.textContent = String(r.handle ?? '');
          tdHandle.appendChild(a);
        }else{
          tdHandle.textContent = String(r.handle ?? '');
        }
        tr.appendChild(tdHandle);
        const tdPs = document.createElement('td');
        tdPs.className = 'persona-cell';
        tdPs.textContent = rawValue(q.personaSummary);
        tr.appendChild(tdPs);
        const tdConf = document.createElement('td');
        if(r.result === 'excluido'){
          tdConf.className = 'excluido';
          tdConf.textContent = 'excluido';
          tdConf.title = String(r.error || 'Removido: idioma nao portugues ou profileType diferente de pessoal/criador');
        }else if(r.result === 'erro'){
          tdConf.className = 'erro';
          tdConf.textContent = 'erro';
          tdConf.title = String(r.error || '');
        }else{
          tdConf.textContent = formatConf(r.confidence);
        }
        tr.appendChild(tdConf);
        const tdExcl = document.createElement('td');
        tdExcl.className = 'td-excl-regra' + (policyExcl ? ' excluido' : '');
        if(r.result === 'excluido' || policyExcl){
          tdExcl.textContent = 'Sim';
          tdExcl.title = r.result === 'excluido'
            ? String(r.error || 'Removido da base')
            : 'Regra: language deve ser pt-br e profileType pessoal ou criador';
        }else{
          tdExcl.textContent = 'Não';
        }
        tr.appendChild(tdExcl);
        const bsSource = (r.brandSafety != null && String(r.brandSafety).trim() !== '')
          ? r.brandSafety
          : q.brandSafety;
        const tds = [
          rawValue(q.profileType),
          rawValue(q.mainCategory),
          rawValue(q.gender),
          rawValue(q.language),
          joinList(q.subCategories),
          joinList(q.contentPillars),
          joinList(q.audienceType),
          String(rawValue(bsSource)).replace(/[\u200B-\u200C\u200D\uFEFF]/g, '').trim(),
        ];
        for(let k = 0; k < tds.length; k++){
          const td = document.createElement('td');
          let cell = tds[k];
          if(k === 7 && !cell) cell = String.fromCharCode(0x2014);
          td.textContent = cell;
          if(k === 7) td.className = 'td-brand-safety';
          tr.appendChild(td);
        }
        body.appendChild(tr);
      }
    }
    async function call(path, method='GET', bustCache){
      let url = path;
      if(bustCache && method === 'GET') url = path + (path.indexOf('?') >= 0 ? '&' : '?') + '_=' + Date.now();
      const res = await fetch(url,{method,headers:{'Content-Type':'application/json'}});
      if(!res.ok) throw new Error(await res.text());
      return res.json();
    }
    async function refresh(){
      try{
        const s = await call('/api/status', 'GET', true);
        document.getElementById('status').textContent = s.running ? (s.stopRequested ? 'Parando...' : 'Rodando') : (s.reprocessRunning ? 'Reprocessando 1...' : 'Parado');
        document.getElementById('total').textContent = s.total;
        document.getElementById('processed').textContent = s.processed;
        document.getElementById('done').textContent = s.done;
        const exEl = document.getElementById('excluded');
        if(exEl) exEl.textContent = (s.excluded != null ? s.excluded : 0);
        document.getElementById('failed').textContent = s.failed;
        (function(){
          const el = document.getElementById('current');
          const ch = s.currentHandle;
          if(!ch){ el.textContent = '-'; return; }
          if(String(ch).indexOf(' · ') !== -1){ el.textContent = ch; return; }
          const slug = String(ch).trim().replace(/^@/, '').split(/[/?#]/)[0];
          if(!slug){ el.textContent = ch; return; }
          const url = 'https://www.instagram.com/' + encodeURIComponent(slug) + '/';
          el.innerHTML = '<a class="ig-link" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(ch) + '</a>';
        })();
        document.getElementById('parallel').textContent = s.parallelThreads ?? 1;
        document.getElementById('withLlm').textContent = s.withLlm ?? 0;
        document.getElementById('withoutLlm').textContent = s.withoutLlm ?? 0;
        const pct = s.total > 0 ? Math.min(100, Math.round((s.processed / s.total) * 100)) : 0;
        document.getElementById('progressBar').style.width = pct + '%';
        const etaMs = Number(s.estimatedRemainingMs ?? NaN);
        const etaText = Number.isFinite(etaMs)
          ? (etaMs <= 0 ? 'ETA: concluindo...' : ('ETA: ' + Math.ceil(etaMs / 1000) + 's'))
          : 'ETA: calculando...';
        document.getElementById('eta').textContent = etaText + ' | Progresso: ' + pct + '%';
        const elapsedMs = Number(s.elapsedMs ?? NaN);
        const speedPerMin = Number.isFinite(elapsedMs) && elapsedMs > 0 && s.processed > 0
          ? (s.processed * 60000) / elapsedMs
          : 0;
        const projectedTotalMs = Number.isFinite(elapsedMs) && s.processed > 0 && s.total > 0
          ? (elapsedMs / s.processed) * s.total
          : NaN;
        const endAt = Number.isFinite(etaMs) && etaMs > 0 ? new Date(Date.now() + etaMs) : null;
        document.getElementById('timeAnalysis').innerHTML =
          '<b>Analise de tempo:</b> '
          + 'decorrido ' + formatDuration(elapsedMs)
          + ' | restante ' + (Number.isFinite(etaMs) ? formatDuration(etaMs) : 'calculando...')
          + ' | total previsto ' + (Number.isFinite(projectedTotalMs) ? formatDuration(projectedTotalMs) : 'calculando...')
          + ' | velocidade media ' + (speedPerMin > 0 ? speedPerMin.toFixed(2) + ' perfis/min' : 'calculando...')
          + ' | termino estimado ' + (endAt ? endAt.toLocaleTimeString('pt-BR') : '-');
        const cb = document.getElementById('refreshAll');
        // Mantem o filtro escolhido pelo usuario/URL. Durante execucao, apenas trava o controle.
        cb.disabled = s.running === true;
        const concEl = document.getElementById('concurrency');
        if(concEl) concEl.disabled = s.running === true;
        const mcEl = document.getElementById('mainCategory');
        if(mcEl) mcEl.disabled = s.running === true;
        const rpBtn = document.getElementById('reprocessBtn');
        const rpInp = document.getElementById('reprocessHandle');
        const busy = s.running === true || s.reprocessRunning === true;
        if(rpBtn) rpBtn.disabled = busy;
        if(rpInp) rpInp.disabled = busy;
        document.getElementById('startBtn').disabled = s.reprocessRunning === true;
        renderResults(s.results || []);
        document.getElementById('meta').textContent =
          'Ultimo inicio: ' + (s.lastStartedAt || '-') + ' | Ultimo fim: ' + (s.lastEndedAt || '-') +
          (s.mainCategoryFilter ? ' | Filtro categoria: ' + s.mainCategoryFilter : '') +
          (s.shardLabel ? ' | Particao: ' + s.shardLabel : '');
        document.getElementById('logs').textContent = (s.logs || []).join('\\n') || 'Sem logs';
      }catch(e){
        document.getElementById('logs').textContent = 'Erro ao atualizar: ' + e.message;
      }
    }
    document.getElementById('refreshAll').checked = parseBoolParam('onlyWithLlm', false);
    document.getElementById('refreshAll').addEventListener('change', (ev)=>{
      setBoolParam('onlyWithLlm', ev.target.checked === true);
    });
    (function(){
      const sel = document.getElementById('mainCategory');
      const fromUrl = new URLSearchParams(window.location.search).get('mainCategory') || '';
      async function loadCategories(){
        if(!sel) return;
        try{
          const data = await call('/api/llm-main-categories', 'GET', true);
          const items = Array.isArray(data.items) ? data.items : [];
          const labels = Array.isArray(data.labels) ? data.labels : [];
          const keep = String(sel.value || '');
          sel.replaceChildren();
          const opt0 = document.createElement('option');
          opt0.value = '';
          const nCat = data.totalDistinct != null ? data.totalDistinct : (items.length || labels.length);
          const nInf = data.totalInfluencersLlm != null ? data.totalInfluencersLlm : '-';
          const loadingHint = data.stale || data.fromTaxonomy ? ' · carregando contagens…' : '';
          opt0.textContent = 'Todas (' + nCat + ' categorias · ' + nInf + ' perfis com LLM)' + loadingHint;
          sel.appendChild(opt0);
          if(items.length > 0){
            for(let i = 0; i < items.length; i++){
              const row = items[i] || {};
              const lab = String(row.label ?? '').trim();
              const cnt = Number(row.count);
              if(!lab) continue;
              const o = document.createElement('option');
              o.value = lab;
              o.textContent = lab + ' (' + (Number.isFinite(cnt) ? cnt : 0) + ')';
              sel.appendChild(o);
            }
          }else{
            for(let i = 0; i < labels.length; i++){
              const o = document.createElement('option');
              o.value = labels[i];
              o.textContent = labels[i];
              sel.appendChild(o);
            }
          }
          if(keep && Array.from(sel.options).some((o)=>o.value === keep)) sel.value = keep;
          else if(fromUrl && Array.from(sel.options).some((o)=>o.value === fromUrl)) sel.value = fromUrl;
        }catch(e){
          const opt0 = document.createElement('option');
          opt0.value = '';
          opt0.textContent = 'Erro ao carregar categorias';
          sel.replaceChildren(opt0);
        }
      }
      loadCategories();
      setInterval(loadCategories, 60000);
      if(sel){
        sel.addEventListener('change', (ev)=>{
          setStringParam('mainCategory', ev.target && ev.target.value ? ev.target.value : '');
        });
        if(fromUrl) sel.value = fromUrl;
      }
    })();
    document.getElementById('copyLogsBtn').addEventListener('click', async ()=>{
      const logs = document.getElementById('logs').textContent || '';
      const status = document.getElementById('copyLogsStatus');
      try{
        if(navigator.clipboard && navigator.clipboard.writeText){
          await navigator.clipboard.writeText(logs);
          status.textContent = 'Logs copiados.';
        }else{
          const ta = document.createElement('textarea');
          ta.value = logs;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          status.textContent = 'Logs copiados.';
        }
      }catch(e){
        status.textContent = 'Falha ao copiar logs.';
      }
      setTimeout(()=>{ status.textContent = ''; }, 2500);
    });
    (function(){
      const conc = document.getElementById('concurrency');
      const saved = localStorage.getItem('qualifyConcurrency');
      if(conc && saved != null && saved !== ''){
        const n = Math.max(1, Math.min(16, parseInt(saved, 10) || 1));
        conc.value = String(n);
      }
    })();
    document.getElementById('startBtn').addEventListener('click', async ()=>{
      try{
        const refreshAll = document.getElementById('refreshAll').checked;
        const mcEl = document.getElementById('mainCategory');
        const mainCat = mcEl && mcEl.value ? String(mcEl.value).trim() : '';
        const concEl = document.getElementById('concurrency');
        const conc = Math.max(1, Math.min(16, parseInt(concEl && concEl.value ? concEl.value : '1', 10) || 1));
        if(concEl) conc.value = String(conc);
        try{ localStorage.setItem('qualifyConcurrency', String(conc)); }catch(_e){}
        let startUrl = '/api/start?onlyWithLlm=' + (refreshAll ? '1' : '0') + '&concurrency=' + encodeURIComponent(String(conc));
        if(refreshAll && mainCat) startUrl += '&mainCategory=' + encodeURIComponent(mainCat);
        await call(startUrl,'POST');
        await refresh();
      }catch(e){ alert(e.message); }
    });
    document.getElementById('stopBtn').addEventListener('click', async ()=>{ try{ await call('/api/stop','POST'); await refresh(); }catch(e){ alert(e.message); } });
    document.getElementById('reprocessBtn').addEventListener('click', async ()=>{
      const inp = document.getElementById('reprocessHandle');
      const st = document.getElementById('reprocessStatus');
      const raw = inp && inp.value ? String(inp.value).trim() : '';
      if(!raw){ alert('Informe o handle (ex.: creonetrioparadadura)'); return; }
      try{
        if(st) st.textContent = 'Processando (pode levar 1–3 min)...';
        const res = await fetch('/api/reprocess?handle=' + encodeURIComponent(raw.replace(/^@/,'')), { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        const data = await res.json().catch(()=>({}));
        if(!res.ok) throw new Error(data.error || res.statusText || 'Falha');
        const row = data.result;
        if(st){
          if(row && row.result === 'ok') st.textContent = 'Concluido: ' + (row.mainCategory || 'ok');
          else if(row && row.result === 'excluido') st.textContent = 'Excluido pela regra: ' + (row.error || '');
          else st.textContent = 'Erro: ' + (row && row.error ? String(row.error).slice(0,80) : 'ver logs');
        }
        await refresh();
      }catch(e){
        alert(e.message || String(e));
        if(st) st.textContent = '';
      }
    });
    refresh(); setInterval(refresh, 1000);
  </script>
</body>
</html>`;
}

async function readRequestJsonBody(req: http.IncomingMessage): Promise<JsonRecord> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  try {
    return asObject(JSON.parse(text));
  } catch {
    return {};
  }
}

async function startUiServer(): Promise<void> {
  const state = {
    running: false,
    reprocessRunning: false,
    stopRequested: false,
    onlyWithLlm: false,
    /** mainCategory canônica quando “só uma categoria”; null = todas */
    mainCategoryFilter: null as string | null,
    shardLabel: (() => {
      const s = getQualifyShardConfig();
      return s.active ? formatShardLabel(s) : null;
    })(),
    parallelThreads: 1,
    total: 0,
    processed: 0,
    done: 0,
    excluded: 0,
    failed: 0,
    currentHandle: null as string | null,
    estimatedRemainingMs: null as number | null,
    elapsedMs: 0,
    withLlm: 0,
    withoutLlm: 0,
    totalProfiles: 0,
    resultsDisplaySeed: '',
    results: [] as ExtractedResultRow[],
    lastStartedAt: null as string | null,
    lastEndedAt: null as string | null,
    logs: [] as string[],
  };

  const pushLog = (msg: string) => {
    const line = `[qualify] ${formatQualifyLogTimestamp()} ${msg}`;
    state.logs.unshift(line);
    if (state.logs.length > 120) state.logs.pop();
    console.log(line);
  };

  let statsRefreshInFlight = false;
  let statsLastRefreshAt = 0;
  const refreshCoverageStats = async (forceRefresh = false) => {
    if (statsRefreshInFlight) return;
    statsRefreshInFlight = true;
    try {
      const stats = await fetchLlmCoverageStatsCached(
        getApiBaseOrThrow(),
        getIngestKeyOrThrow(),
        forceRefresh
      );
      state.withLlm = stats.withLlm;
      state.withoutLlm = stats.withoutLlm;
      state.totalProfiles = stats.totalProfiles;
      statsLastRefreshAt = Date.now();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushLog(`Falha ao atualizar contagem com/sem LLM: ${message}`);
    } finally {
      statsRefreshInFlight = false;
    }
  };

  const runAsync = async () => {
    if (state.running) return;
    state.running = true;
    state.stopRequested = false;
    state.total = 0;
    state.processed = 0;
    state.done = 0;
    state.excluded = 0;
    state.failed = 0;
    state.currentHandle = null;
    state.estimatedRemainingMs = null;
    state.elapsedMs = 0;
    state.resultsDisplaySeed = String(Date.now());
    state.results = [];
    state.lastStartedAt = new Date().toISOString();
    pushLog('Execucao iniciada.');
    pushLog(formatOllamaConfigMessage());
    const runStartedAtMs = Date.now();
    const elapsedTicker = setInterval(() => {
      if (!state.running) return;
      state.elapsedMs = Math.max(0, Date.now() - runStartedAtMs);
    }, 1000);
    try {
      state.currentHandle = 'Consultando fila na API…';
      const summary = await runBatch({
        shouldStop: () => state.stopRequested,
        onlyWithLlm: state.onlyWithLlm,
        mainCategory: state.mainCategoryFilter ?? undefined,
        concurrency: state.parallelThreads,
        onLog: (message) => {
          pushLog(message);
          if (message.startsWith('Carregando primeiros perfis')) {
            state.currentHandle = 'Carregando fila na API…';
          } else if (message.startsWith('Consultando estatisticas')) {
            state.currentHandle = 'Consultando estatísticas…';
          }
        },
        onProgress: (p) => {
          state.total = p.total;
          state.processed = p.processed;
          state.done = p.done;
          state.excluded = p.excluded;
          state.failed = p.failed;
          state.currentHandle = p.currentHandle;
          state.estimatedRemainingMs = p.estimatedRemainingMs;
          if (p.processed > 0) state.elapsedMs = p.elapsedMs;
          state.mainCategoryFilter = p.mainCategoryFilter ?? null;
        },
        onResult: (row) => {
          state.results.unshift(row);
          if (state.results.length > QUALIFY_UI_RESULTS_MAX) state.results.length = QUALIFY_UI_RESULTS_MAX;
          if (row.result === 'ok') {
            pushLog(
              `@${row.handle} | OK | ${row.mainCategory} | ${row.brandSafety ?? '-'} | ${row.confidence != null ? `${Math.round(row.confidence * 100)}%` : '-'}`
            );
          } else if (row.result === 'excluido') {
            /* Linhas EXCLUINDO / API / EXCLUIDO OK ja foram enviadas por emitLog no runBatch. */
          } else {
            pushLog(`@${row.handle} | ERRO | ${truncateLogLine(row.error ?? '', 200)}`);
          }
        },
      });
      pushLog(
        `Execucao finalizada. done=${summary.done} excluded=${summary.excluded} failed=${summary.failed} stopped=${summary.stopped}`
      );
      await refreshCoverageStats(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushLog(`Falha fatal: ${message}`);
    } finally {
      clearInterval(elapsedTicker);
      state.running = false;
      state.stopRequested = false;
      state.currentHandle = null;
      state.lastEndedAt = new Date().toISOString();
    }
  };

  const server = http.createServer(async (req, res) => {
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (method === 'GET' && url.pathname === '/') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
      });
      res.end(renderUiHtml());
      return;
    }

    if (method === 'GET' && url.pathname === '/api/llm-main-categories') {
      try {
        const forceRefresh = url.searchParams.get('refresh') === '1';
        const data = await getLlmMainCategoryLabelsCached(
          getApiBaseOrThrow(),
          getIngestKeyOrThrow(),
          forceRefresh
        );
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          Pragma: 'no-cache',
        });
        res.end(
          JSON.stringify({
            ok: true,
            items: data.items,
            labels: data.labels,
            totalDistinct: data.totalDistinct,
            totalInfluencersLlm: data.totalInfluencersLlm,
            cached: data.cached === true,
            stale: data.stale === true,
            fromTaxonomy: data.fromTaxonomy === true,
          })
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: message }));
      }
      return;
    }

    if (method === 'GET' && url.pathname === '/api/status') {
      // Durante execucao atualiza com/sem LLM via cache (sem refresh=1 — evita recount pesado no servidor).
      const statsIntervalMs = state.running ? 30000 : 10000;
      if (Date.now() - statsLastRefreshAt > statsIntervalMs) void refreshCoverageStats();
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
      });
      res.end(JSON.stringify(state));
      return;
    }

    if (method === 'POST' && url.pathname === '/api/start') {
      const onlyWithLlmRaw = String(url.searchParams.get('onlyWithLlm') ?? '').trim().toLowerCase();
      state.onlyWithLlm = onlyWithLlmRaw === '1' || onlyWithLlmRaw === 'true' || onlyWithLlmRaw === 'yes';
      const mainCatRaw = String(url.searchParams.get('mainCategory') ?? '').trim();
      state.mainCategoryFilter =
        state.onlyWithLlm && mainCatRaw ? mainCatRaw : null;
      const concRaw = Number(url.searchParams.get('concurrency') ?? '1');
      state.parallelThreads = Math.max(1, Math.min(16, Math.floor(Number.isFinite(concRaw) ? concRaw : 1) || 1));
      if (!state.running) void runAsync();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          ok: true,
          running: true,
          onlyWithLlm: state.onlyWithLlm,
          parallelThreads: state.parallelThreads,
        })
      );
      return;
    }

    if (method === 'POST' && url.pathname === '/api/stop') {
      state.stopRequested = true;
      pushLog('Solicitacao de parada recebida.');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, stopRequested: true }));
      return;
    }

    if (method === 'POST' && url.pathname === '/api/reprocess') {
      if (state.running) {
        res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'Lote em execucao — pare o lote ou aguarde.' }));
        return;
      }
      if (state.reprocessRunning) {
        res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'Ja ha um reprocessamento em andamento.' }));
        return;
      }
      let handleRaw = String(url.searchParams.get('handle') ?? '').trim();
      if (!handleRaw) {
        const body = await readRequestJsonBody(req);
        handleRaw = String(body.handle ?? '').trim();
      }
      const handle = toHandle(handleRaw);
      if (!handle) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'Informe handle (query ?handle= ou JSON { "handle": "..." }).' }));
        return;
      }
      state.reprocessRunning = true;
      state.currentHandle = `@${handle} (reprocesso)`;
      pushLog(`Reprocessamento unitario solicitado: @${handle}`);
      try {
        const row = await reprocessSingleHandle(handle, {
          onLog: (message) => pushLog(message),
        });
        state.results.unshift(row);
        if (state.results.length > QUALIFY_UI_RESULTS_MAX) state.results.length = QUALIFY_UI_RESULTS_MAX;
        if (row.result === 'ok') {
          pushLog(
            `@${row.handle} | REPROCESSO OK | ${row.mainCategory} | ${row.brandSafety ?? '-'} | ${row.confidence != null ? `${Math.round(row.confidence * 100)}%` : '-'}`
          );
        } else if (row.result === 'excluido') {
          pushLog(`@${row.handle} | REPROCESSO EXCLUIDO | ${truncateLogLine(row.error ?? '', 200)}`);
        } else {
          pushLog(`@${row.handle} | REPROCESSO ERRO | ${truncateLogLine(row.error ?? '', 200)}`);
        }
        await refreshCoverageStats(true);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, handle, result: row }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        pushLog(`Reprocesso @${handle} falhou: ${message}`);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: message }));
      } finally {
        state.reprocessRunning = false;
        state.currentHandle = null;
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  const port = getUiPort();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => resolve());
  });
  console.log(`[qualify-ui] Painel em http://localhost:${port}`);
  logOllamaConfig();
}

async function main(): Promise<void> {
  const mode = (process.argv[2] ?? '').trim().toLowerCase();
  if (mode === 'ui' || mode === 'server') {
    await startUiServer();
    return;
  }
  if (mode === 'reprocess') {
    const rawHandle = process.argv[3] ?? process.env.QUALIFY_REPROCESS_HANDLE ?? '';
    logOllamaConfig();
    const row = await reprocessSingleHandle(rawHandle, {});
    console.log(JSON.stringify(row, null, 2));
    process.exit(row.result === 'ok' ? 0 : 1);
  }
  const summary = await runBatch(batchOptionsFromEnv());
  printQualifyLog(
    `Finalizado. done=${summary.done} excluded=${summary.excluded} failed=${summary.failed} stopped=${summary.stopped}`
  );
}

main().catch((error) => {
  console.error('[qualify] Falha fatal:', error instanceof Error ? error.stack : error);
  process.exit(1);
});
