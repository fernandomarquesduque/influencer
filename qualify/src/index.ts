import 'dotenv/config';
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
 * O batch trata como exclusao automatica (purge), nao como "Falha" operacional.
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

/** Amostras de legendas/hashtags dos posts (quando a API envia _llm_content) — só para enriquecer personaSummary. */
function buildPostTextSamplesForPrompt(profile: JsonRecord): Array<{ tipo: string; texto: string; hashtags: string[] }> {
  const raw = profile._llm_content;
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const samples = (raw as JsonRecord).samples;
  if (!Array.isArray(samples) || samples.length === 0) return [];
  const out: Array<{ tipo: string; texto: string; hashtags: string[] }> = [];
  for (const s of samples) {
    if (s == null || typeof s !== 'object' || Array.isArray(s)) continue;
    const o = s as JsonRecord;
    const texto = String(o.text ?? '').trim().slice(0, 480);
    const tags = Array.isArray(o.hashtags)
      ? o.hashtags
        .map((t) => String(t ?? '').trim().replace(/^#/, ''))
        .filter(Boolean)
        .slice(0, 12)
      : [];
    if (!texto && tags.length === 0) continue;
    out.push({
      tipo: String(o.kind ?? 'post'),
      texto,
      hashtags: tags,
    });
    if (out.length >= 24) break;
  }
  return out;
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
  for (const s of buildPostTextSamplesForPrompt(profile)) {
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
  for (const s of buildPostTextSamplesForPrompt(profile)) {
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

/**
 * Idioma BCP-47 a partir do texto autoral (franc).
 * Usa limiar de letras baixo (12 por padrao). Quando franc nao decide (und, muito curto, iso fora do mapa) → pt-br (base BR).
 */
function resolveLanguageFromFrancProfile(profile: JsonRecord): string {
  const letters = countAuthorialLettersForProfileEvidence(profile);
  const minFr = parseFrancMinAuthorialLetters();
  if (letters < minFr) return 'pt-br';

  const blob = normalizeFrancInputBlob(authorialBlobStrippedForLanguage(profile));
  if (countUnicodeLetters(blob) < minFr) return 'pt-br';

  let ranked = francRankedForBlob(blob, 10);
  if ((ranked.length === 0 || ranked[0][0] === 'und') && letters >= 15) {
    ranked = francRankedForBlob(blob, 8);
  }
  if (ranked.length === 0 || ranked[0][0] === 'und') return 'pt-br';

  const topCode = ranked[0][0];
  const topScore = ranked[0][1];
  if (!topCode) return 'pt-br';

  if (topCode === 'por') return 'pt-br';

  if (topCode === 'eng') {
    const porScore = francScoreForIso3(ranked, 'por') ?? 0;
    if (porScore > topScore - FRANC_POR_ENG_MARGIN) return 'pt-br';
    return 'en';
  }

  const mapped = FRANC_ISO6393_TO_BCP47[topCode];
  if (mapped) return mapped;

  return 'pt-br';
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

  const freeText = buildProfileFreeTextForCategoryEvidence(profile).trim();
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

  const freeText = buildProfileFreeTextForCategoryEvidence(profile).trim();
  if (freeText.length < 12) return [];

  if (!profileFreeTextSupportsBelezaEvidence(freeText)) {
    return [
      'subCategories: rotulo de beleza (ex.: maquiagem) sem evidencia na bio/amostras — alinhe ao nicho real do perfil',
    ];
  }
  return [];
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
function repairPersonaSummaryBrokenPhrasing(s: string): string {
  let t = s
    .replace(/\bde\s*,/giu, ',')
    .replace(/\bdo\s*,/giu, ',')
    .replace(/\bda\s*,/giu, ',')
    .replace(/\brelacionad[oa]\s+a\s+eventos\s+de\s*,/giu, 'relacionado a eventos culturais,')
    .replace(/\bespecificamente\s+o\s+em\b/giu, 'especificamente em')
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
  if (s.length < 20) {
    s = `${s} Descricao editorial agregada do nicho, sem nome nem termo de busca do cadastro.`.trim();
    s = s.replace(/\s+/g, ' ').trim();
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
  const disc = String(profile._discovered_value ?? '').normalize('NFC').toLowerCase();
  const low = `${handle}\n${fn}\n${bio}\n${disc}`;

  if (/\bcriador(a)?\b.*\bconte[uú]do|\binfluencer\b|\byoutuber\b|\bme\s+chamo\b/i.test(low)) return;

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
    (/\bmarca\s+de\b/.test(ps) && /\b(tallow|sebo|cosm(e|é)tic|skincare|pele)\b/.test(ps))
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

function normalizeClassification(
  raw: JsonRecord,
  profile: JsonRecord,
  model: string,
  _maxReasoning: number,
  languageFromFranc: string
): LlmClassification {
  const qualificationRaw = asObject(raw.qualification);
  const qualification = Object.keys(qualificationRaw).length > 0 ? qualificationRaw : asObject(raw);
  const bs = pickBrandSafetyFromQualification(qualification);
  if (bs) qualification.brandSafety = bs;
  correctProfileTypeWhenProductBrand(profile, qualification);
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
  correctProfileTypeWhenPersonaDescribesProductBrand(qualification);
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
  }

  return {
    qualifiedAt: new Date().toISOString(),
    model,
    version: 7,
    status,
    confidence,
    qualification,
  };
}

function validateLlmClassification(llm: LlmClassification, profile?: JsonRecord): string[] {
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
  if (profile && Object.keys(profile).length > 0) {
    errors.push(...validateSubCategoriesBeautyAgainstProfileEvidence(q, profile));
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
    '- qualification.contentPillars: pelo menos 1 item; cada item UMA palavra sem espacos (NUNCA frases tipo "recepcao de cafe"). Pilares so com base no texto do perfil/amostras; PROIBIDO "dicas", "moto", "receitas" sem aparecer nos dados. PROIBIDO lista SOMENTE com rotulos de Beleza (beleza, maquiagem, skincare, unhas…) se nada na bio/amostras falar de estetica/make; troque por pilares do nicho real (ex.: direito, negocios, humor, familia).',
    `- qualification.mainCategory OBRIGATORIO: copie LITERAL um unico rotulo da LISTA FECHADA do prompt (uma palavra, sem " & "); nao invente sinonimos nem traducoes.`,
    '- qualification.personaSummary: descricao agregada em terceira pessoa; PROIBIDO @, handle, nome publico, copiar biografia, links, metricas ou texto identico ao JSON; PROIBIDO templates tipo "recepcao de cafe" ou "periodo de tempo dedicado"; se o prompt original trouxer "amostras_textos_publicacoes", use só como pista (nao copie legendas).',
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
  const compact: JsonRecord = {
    handle: profile.handle ?? '',
    full_name: profile.full_name ?? '',
    biography: profile.biography ?? '',
    followers_count: profile.followers_count ?? 0,
    discovered_by: profile._discovered_by ?? '',
    discovered_value: profile._discovered_value ?? '',
  };
  if (postSamples.length > 0) {
    compact.amostras_textos_publicacoes = postSamples;
  }

  const profileTypeSignals =
    'pessoal: sem voz de marca/comercial na bio. marca: D2C/propria — cosmeticos/skincare/suplementos/roupa com nome da marca, bio institucional, loja/comprar, ingredientes; se o foco e MARCA/PRODUTO, nao criador. empresa: cafe/restaurante/bar/doceria, marca de comida/bebida, varejo B2B, pedidos+link, orgao publico (PM, exercito, bombeiros, ministerio) → empresa ou midia, nunca pessoal. discovered_* nao manda se o texto for de marca. criador: pessoa no centro do conteudo. clinica/B2B/agencia → empresa.';
  const profileTypeRule = includePostSamples
    ? `profileType: inferir a partir de handle, full_name, biography e amostras_textos_publicacoes (legendas/hashtags). ${profileTypeSignals}`
    : `profileType: inferir a partir de handle, full_name e biography (texto publico do perfil). ${profileTypeSignals}`;
  const personaRule = includePostSamples
    ? 'personaSummary: editorial (conteudo, tom, nicho, publico). PROIBIDO: @, handle, nome publico literal, copiar bio/legendas/URLs/numeros de seguidores ou trechos iguais ao JSON. Amostras só como pista; reescreva.'
    : 'personaSummary: editorial (conteudo, tom, nicho, publico). PROIBIDO: @, handle, nome publico literal, copiar bio, seguidores, URLs, trechos iguais ao JSON. Bio curta: infira com cautela de handle+nome, sem fatos inventados.';

  const postsLeadWhenBioWeak =
    postSamples.length > 0
      ? 'Com amostras_textos_publicacoes: se biography for curta, vaga, só slogan ou nao definir o nicho, defina profileType, subCategories (ordem: tema dominante primeiro), contentPillars e mainCategory (UMA palavra, nome de vitrine) pelo TEMA DOMINANTE nas amostras; bio e handle apenas apoiam.'
      : null;

  const mainCategoryTaxonomyRule = `LISTA FECHADA mainCategory — escolha EXATAMENTE UMA destas palavras e copie o texto LITERAL (acentos inclusos; uma unica palavra por rotulo): ${formatMainCategoryTaxonomyForPrompt()}`;
  const subcategoryHintsRule = formatSubcategoryTaxonomyHintsForPrompt();

  return [
    'Classificador de perfis (influencia; qualquer pais). Nao invente sem base nos dados.',
    profileTypeRule,
    ...(postsLeadWhenBioWeak ? [postsLeadWhenBioWeak] : []),
    mainCategoryTaxonomyRule,
    subcategoryHintsRule,
    'Ignore metadados nao enviados (account_type, categoria oficial do Instagram).',
    'Resposta: somente JSON valido, sem markdown ou texto extra.',
    'Strings de vitrine (personaSummary, mainCategory, subCategories, gender, contentPillars, audienceType): pt-BR; sem ingles/espanhol nessas chaves.',
    'Raiz: objeto com "qualification".',
    'confidence/status: sem base em texto autoral para nicho/persona → status "insufficient_data" e confidence baixo (0.2-0.45). Nunca 1.0 com bio+nome vazios ou só emoji/link.',
    'Arrays nunca vazios.',
    'subCategories, contentPillars e audienceType: uma palavra macro por item (sem frases compostas).',
    'contentPillars: só temas presentes em "Dados do perfil"; uma palavra. Nao invente; nao copie palavras deste prompt. Evite "dicas","moto","receitas","bastidores","stories" como padrao — só se o texto mostrar (ex.: moto = moto/trilha/grau). Nao repita mainCategory como pillar.',
    'contentPillars Beleza (validacao): sem gender feminino, PROIBIDO usar APENAS rotulos de vitrine Beleza (beleza, maquiagem, skincare, unhas, estetica, cosmeticos, maquiador...) se NENHUMA bio nem amostra citar make/cosmeticos/salao/pele/tutorial/autocuidado ligado a estetica. Com gender feminino o servidor aceita pilares so Beleza mesmo sem essas palavras. Perfil juridico (adv., OAB, lei, tribunal, escritorio), saude, negocios, fitness sem estetica e sem feminino → pilares = tema REAL do conteudo, nunca "beleza+maquiagem" por estereotipo.',
    'subCategories: fonte do nicho; devem existir no mapa fechado (amostra acima). Ordem: mais especifico primeiro; pt-BR ou EN se no mapa (tv, dj). Maquiagem/beleza/skincare: com evidencia na bio/amostras, ou com gender feminino (servidor aceita sem menção explicita). Maternidade sozinha nao dispensa evidencia. Perfil adv./OAB/juridico sem cosmeticos e sem feminino → subs do oficio (direito, advocacia…), nunca maquiagem. Fora do vocabulario → falha de classificacao.',
    'mainCategory: copiar LITERAL um rotulo da lista (uma palavra). Orientar pelas subCategories (ex.: maquiagem→Beleza; receitas→Alimentacao; viagem→Viagens; tatuagem→Lifestyle, nao Musica; futebol/futsal/esporte→Esportes; video game/gaming/jogos eletronicos→Games, nao só "jogos" que em pt-BR costuma ser esporte). Vaquejada/festa com som→Musica; Esportes só hipismo competitivo sem pilar musical. Ambiguo: macro mais comercial da lista. So rotulos da lista.',
    'Servidor: valida subs no mapa, alinha main a evidencias (subs+bio/contexto), preenche language (franc) e normaliza aliases; escolha coerente.',
    'mainCategory, gender e brandSafety obrigatorios (string). subCategories, contentPillars e audienceType: arrays com pelo menos 1 item. NAO inclua "language" no JSON — o servidor preenche.',
    'brandSafety: familia = beleza/maquiagem/educacao/lifestyle normal; sensivel = alcool/tabaco/politica polemica/saude arriscada/violencia/sexualizacao; adulto = sexo explicito/jogos adultos/gore. Nao sensivel só por maquiagem/coracao.',
    personaRule,
    'subCategories: prefira nicho comercial especifico; evite "variedades","geral","conteudo" se houver termo melhor no mapa.',
    includePostSamples
      ? 'Incerteza: pouco texto para nicho — outros campos evite geral/desconhecido salvo necessario.'
      : 'Incerteza: bio curta — outros campos evite geral/desconhecido salvo necessario.',
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

function getIngestPushTimeoutMs(): number {
  const raw = process.env.QUALIFY_INGEST_TIMEOUT_MS?.trim();
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return DEFAULT_INGEST_TIMEOUT_MS;
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<JsonRecord> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ac.signal });
    const text = await res.text();
    let data: JsonRecord = {};
    try {
      data = text ? (JSON.parse(text) as JsonRecord) : {};
    } catch {
      throw new Error(`Resposta invalida da API (${res.status}): ${text.slice(0, 220)}`);
    }
    if (!res.ok) {
      throw new Error(`${res.status} ${String(data.error ?? text ?? 'Erro na API')}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
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

async function fetchPendingFromApi(
  apiBase: string,
  ingestKey: string,
  limit: number,
  offset = 0,
  refreshAll = true,
  mainCategory?: string
): Promise<{ totalPending: number; items: Array<{ handle: string; profile: JsonRecord }> }> {
  const refreshAllQuery = refreshAll ? '1' : '0';
  const mediaLimit = getQualifyInitialMediaLimit();
  const qs = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
    refreshAll: refreshAllQuery,
    includeContent: '1',
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

async function fetchLlmCoverageStats(
  apiBase: string,
  ingestKey: string
): Promise<{ totalProfiles: number; withoutLlm: number; withLlm: number }> {
  const [all, pendingOnly] = await Promise.all([
    fetchJson(
      `${apiBase}/crawl/collector-llm-pending?limit=1&offset=0&refreshAll=1&includeContent=0`,
      {
        method: 'GET',
        headers: {
          'X-Collector-Key': ingestKey,
        },
      },
      getTimeoutMs()
    ),
    fetchJson(
      `${apiBase}/crawl/collector-llm-pending?limit=1&offset=0&refreshAll=0&includeContent=0`,
      {
        method: 'GET',
        headers: {
          'X-Collector-Key': ingestKey,
        },
      },
      getTimeoutMs()
    ),
  ]);
  const totalProfilesRaw = Number(all.totalPending ?? 0);
  const withoutLlmRaw = Number(pendingOnly.totalPending ?? 0);
  const totalProfiles = Number.isFinite(totalProfilesRaw) ? Math.max(0, Math.floor(totalProfilesRaw)) : 0;
  const withoutLlm = Number.isFinite(withoutLlmRaw) ? Math.max(0, Math.floor(withoutLlmRaw)) : 0;
  const withLlm = Math.max(0, totalProfiles - withoutLlm);
  return { totalProfiles, withoutLlm, withLlm };
}

async function pushLlmToApi(
  apiBase: string,
  ingestKey: string,
  handle: string,
  llm: LlmClassification,
  allowLlmReplace: boolean
): Promise<void> {
  const q = allowLlmReplace ? '?allowLlmReplace=1' : '';
  const url = `${apiBase}/crawl/collector-ingest-llm${q}`;
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

/** True se o registro ja tinha classificacao LLM persistida — nunca auto-excluir na API ao falhar revalidacao. */
function profileRecordAlreadyHasLlm(profile: JsonRecord): boolean {
  const llm = profile.llm;
  if (llm == null || typeof llm !== 'object' || Array.isArray(llm)) return false;
  const lo = llm as JsonRecord;
  const status = String(lo.status ?? '').trim().toLowerCase();
  if (status === 'done') return true;
  const q = lo.qualification;
  return q != null && typeof q === 'object' && !Array.isArray(q);
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
  const logStep = (msg: string) =>
    onLog?.(handleTag ? `@${handleTag} | ${msg}` : msg);

  let workingProfile: JsonRecord = { ...profile };
  let languageFromFranc = resolveLanguageFromFrancProfile(workingProfile);
  const hasPostSamples = profileHasPostTextSamples(workingProfile);
  let prompt =
    promptOverride ??
    buildPrompt(workingProfile, {
      includePostSamples: hasPostSamples,
    });
  const runInitialGeneration = async (): Promise<JsonRecord> => {
    logStep('>> Ollama: geracao inicial (1a resposta)...');
    const response = await ollamaClient.chat({
      model,
      messages: [
        {
          role: 'system',
          content:
            'Voce responde somente JSON valido. Textos descritivos (personaSummary, rotulos de categoria) em portugues do Brasil. Nao inclua chave "language" no JSON. contentPillars: sem gender feminino, nao preencha só com beleza/maquiagem se a bio e amostras nao citarem estetica ou make; com gender feminino o validador aceita.',
        },
        { role: 'user', content: prompt },
      ],
      stream: false,
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
      logStep('>> Ollama: 2a chamada (corrigir JSON invalido)...');
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
      });
      const retryContent = retry.message?.content?.trim() ?? '';
      parsed = tryParseJsonObject(retryContent);
      if (!parsed) {
        throw new Error(`Resposta do Ollama nao veio em JSON valido: ${(retryContent || content).slice(0, 240)}`);
      }
    }
    return parsed;
  };

  let parsed = await runInitialGeneration();
  logStep('>> local: normalizar + validar regras...');
  let llm = normalizeClassification(parsed, workingProfile, model, maxReasoning, languageFromFranc);
  let validationErrors = validateLlmClassification(llm, workingProfile);
  if (validationErrors.length === 0) {
    logStep('>> ok: qualification valida (sem reparo LLM)');
    return llm;
  }

  if (qualificationProfileTypeIsEmpresa(llm)) {
    logStep(
      '>> local: empresa ja na 1a passagem (normalizacao/regras locais) — sem reparo LLM; fila aplica exclusao automatica'
    );
    return llm;
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
      logStep('>> API collector: buscar legendas (enriquecer prompt)...');
      try {
        const enriched = await fetchProfilePostContextFromApi(
          postCtx.apiBase,
          postCtx.ingestKey,
          toHandle(workingProfile.handle ?? ''),
          postCtx.refreshAll
        );
        workingProfile = mergePostContextFromApiProfile(workingProfile, enriched);
        logStep('>> API collector: legendas recebidas');
      } catch (e) {
        logStep(`>> API collector: aviso legendas — ${truncateLogLine(e instanceof Error ? e.message : String(e), 140)}`);
      }
    }

    const usePostsInPrompt = promptOverride == null && profileHasPostTextSamples(workingProfile);

    if (promptOverride == null) {
      languageFromFranc = resolveLanguageFromFrancProfile(workingProfile);
      prompt = buildPrompt(workingProfile, {
        includePostSamples: usePostsInPrompt,
      });
    }

    logStep(
      `>> Ollama: reparo validacao #${attempt}/${DEFAULT_LLM_REPAIR_ATTEMPTS}...`
    );
    const repairPrompt = buildRepairPrompt(prompt, parsed, validationErrors);
    const repair = await ollamaClient.chat({
      model,
      messages: [
        {
          role: 'system',
          content:
            'Voce corrige JSON e responde apenas JSON valido. Textos descritivos em pt-BR. Nao inclua "language". Se o erro citar beleza/maquiagem sem evidencia e gender nao for feminino: remova maquiagem/beleza dos pillars ou subs e use termos sustentados pela bio/amostras; com gender feminino pode manter Beleza.',
        },
        { role: 'user', content: repairPrompt },
      ],
      stream: false,
    });
    const repairContent = repair.message?.content?.trim() ?? '';
    const repairedParsed = tryParseJsonObject(repairContent);
    if (!repairedParsed) {
      logStep('>> local: reparo nao veio em JSON valido, nova tentativa...');
      continue;
    }
    parsed = repairedParsed;
    logStep('>> local: revalidar apos reparo...');
    llm = normalizeClassification(repairedParsed, workingProfile, model, maxReasoning, languageFromFranc);
    validationErrors = validateLlmClassification(llm, workingProfile);
    if (validationErrors.length === 0) {
      logStep('>> ok: qualification valida apos reparo');
      return llm;
    }
  }

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
  /** Purge na API: regras language/profileType, ou LLM com saida invalida apos reparos esgotados. */
  excluded: number;
  currentHandle: string | null;
  runStartedAt: string;
  elapsedMs: number;
  estimatedRemainingMs: number | null;
  onlyWithLlm: boolean;
  /** Filtro por mainCategory canônica (só com "com LLM"); vazio = todas. */
  mainCategoryFilter: string | null;
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
  const model = process.env.OLLAMA_MODEL?.trim() || DEFAULT_MODEL;
  const batchSize = Math.max(1, Number(process.env.QUALIFY_BATCH_SIZE ?? DEFAULT_BATCH_SIZE) || DEFAULT_BATCH_SIZE);
  const maxReasoning = Math.max(
    1,
    Number(process.env.QUALIFY_MAX_REASONING ?? DEFAULT_MAX_REASONING) || DEFAULT_MAX_REASONING
  );
  const concurrency = Math.max(
    1,
    Math.min(16, Math.floor(Number(options.concurrency ?? process.env.QUALIFY_CONCURRENCY ?? 1)) || 1)
  );

  const onlyWithLlm = options.onlyWithLlm === true;
  const mainCategoryFilter = String(options.mainCategory ?? '').trim();
  const useCategoryFilter = onlyWithLlm && mainCategoryFilter.length > 0;
  const coverage = await fetchLlmCoverageStats(apiBase, ingestKey);
  const refreshAll = onlyWithLlm;
  const queueOffset = onlyWithLlm && !useCategoryFilter ? coverage.withoutLlm : 0;
  const processedHandles = new Set<string>();
  let listOffset = queueOffset;
  let firstBatch = await fetchPendingFromApi(
    apiBase,
    ingestKey,
    batchSize,
    listOffset,
    refreshAll,
    useCategoryFilter ? mainCategoryFilter : undefined
  );
  const emitLog = (msg: string) => {
    const line = `[qualify] ${msg}`;
    console.log(line);
    options.onLog?.(msg);
  };
  if (firstBatch.items.length === 0 && queueOffset > 0) {
    emitLog(
      `Aviso: pagina vazia com offset inicial ${queueOffset}; tentando offset 0 (fila pode ter mudado vs estatistica inicial).`
    );
    listOffset = 0;
    firstBatch = await fetchPendingFromApi(
      apiBase,
      ingestKey,
      batchSize,
      listOffset,
      refreshAll,
      useCategoryFilter ? mainCategoryFilter : undefined
    );
  }
  const targetTotal = onlyWithLlm
    ? useCategoryFilter
      ? firstBatch.totalPending
      : coverage.withLlm
    : coverage.withoutLlm;
  emitLog(
    `Perfis alvo via API: ${targetTotal} (modo=${onlyWithLlm ? 'com_llm' : 'sem_llm'}${useCategoryFilter ? `, categoria=${mainCategoryFilter}` : ''}, paralelo=${concurrency})`
  );
  emitLog(
    `mainCategory: taxonomia fechada com ${MAIN_CATEGORY_CANONICAL_LABELS.length} rotulos canonicos (+ normalizacao de aliases no servidor)`
  );
  const runStartedAtMs = Date.now();
  const progress: BatchProgress = {
    total: targetTotal,
    processed: 0,
    done: 0,
    failed: 0,
    excluded: 0,
    currentHandle: null,
    runStartedAt: new Date(runStartedAtMs).toISOString(),
    elapsedMs: 0,
    estimatedRemainingMs: null,
    onlyWithLlm,
    mainCategoryFilter: useCategoryFilter ? mainCategoryFilter : null,
  };
  options.onProgress?.(progress);
  if (targetTotal === 0 || firstBatch.items.length === 0) {
    return { total: 0, done: 0, failed: 0, excluded: 0, stopped: false };
  }

  let currentBatch = firstBatch.items;
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
      return Boolean(handle) && !processedHandles.has(handle);
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
            batchSize,
            listOffset,
            refreshAll,
            useCategoryFilter ? mainCategoryFilter : undefined
          );
          if (!onlyWithLlm) progress.total = Math.max(progress.total, wrapBatch.totalPending);
          currentBatch = wrapBatch.items;
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
        batchSize,
        listOffset,
        refreshAll,
        useCategoryFilter ? mainCategoryFilter : undefined
      );
      if (!onlyWithLlm) progress.total = Math.max(progress.total, skippedBatch.totalPending);
      currentBatch = skippedBatch.items;
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
            const promptPhase1 = buildPrompt(item.profile, {
              includePostSamples: profileHasPostTextSamples(item.profile),
            });
            const promptChars = promptPhase1.length;
            const promptTokensApprox = Math.ceil(promptChars / 4);
            const nPostSamples = buildPostTextSamplesForPrompt(item.profile).length;
            emitLog(
              `@${handle} | >> prompt fase1 pronto (~${promptTokensApprox} tok, ${promptChars} chars)${nPostSamples > 0 ? ` | ${nPostSamples} amostra(s) post/reel recente(s)` : ''
              }`
            );
            if (isQualifyVerboseLog()) {
              emitLog(`@${handle} | prompt completo:\n${promptPhase1}`);
            }
            const startedAt = Date.now();
            const llm = await classifyProfile(item.profile, model, maxReasoning, undefined, emitLog, {
              apiBase,
              ingestKey,
              refreshAll,
              logHandle: handle,
            });
            const qualOk = asObject(llm.qualification);
            const authorialMismatchReason = tryExcludeByAuthorialLanguageMismatch(qualOk, item.profile);
            const langExclude = shouldExcludeByLanguageAndCreatorRules(qualOk);
            if (authorialMismatchReason || langExclude) {
              const reason = authorialMismatchReason ?? buildAutoExclusionReason(qualOk);
              const hadPriorLlm = profileRecordAlreadyHasLlm(item.profile);
              if (hadPriorLlm) {
                const keepMsg = `NAO EXCLUI | perfil ja tinha LLM persistido — mantido na base | ${reason}`;
                emitLog(`@${handle} | ${keepMsg}`);
                progress.failed++;
                const totalMs = Date.now() - startedAt;
                emitLog(`@${handle} | ERRO (mantido) | total ${totalMs}ms`);
                options.onResult?.({
                  handle,
                  result: 'erro',
                  llmStatus: String(llm.status ?? 'erro'),
                  confidence: llm.confidence,
                  mainCategory: parseMainCategory(qualOk.mainCategory) ?? String(qualOk.mainCategory ?? ''),
                  brandSafety: pickBrandSafetyFromQualification(qualOk),
                  qualification: qualOk,
                  processedAt: new Date().toISOString(),
                  error: keepMsg,
                });
              } else {
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
                progress.excluded++;
                options.onResult?.({
                  handle,
                  result: 'excluido',
                  llmStatus: llm.status,
                  confidence: llm.confidence,
                  mainCategory: parseMainCategory(qualOk.mainCategory) ?? String(qualOk.mainCategory ?? ''),
                  brandSafety: pickBrandSafetyFromQualification(qualOk),
                  qualification: qualOk,
                  processedAt: new Date().toISOString(),
                  error: reason,
                });
              }
            } else {
              emitLog(`@${handle} | >> API collector: ingest LLM (POST)...`);
              const ingestT0 = Date.now();
              await pushLlmToApi(apiBase, ingestKey, handle, llm, refreshAll);
              const ingestMs = Date.now() - ingestT0;
              const totalMs = Date.now() - startedAt;
              emitLog(
                `@${handle} | ok | ${Math.round(llm.confidence * 100)}% | ingest ${ingestMs}ms | total ${totalMs}ms`
              );
              progress.done++;
              options.onResult?.({
                handle,
                result: 'ok',
                llmStatus: llm.status,
                confidence: llm.confidence,
                mainCategory: parseMainCategory(qualOk.mainCategory) ?? String(qualOk.mainCategory ?? ''),
                brandSafety: pickBrandSafetyFromQualification(qualOk),
                qualification: qualOk,
                processedAt: new Date().toISOString(),
                error: null,
              });
            }
          } catch (error) {
            if (error instanceof LlmValidationExhaustedError) {
              const llmBad = error.lastLlm;
              const qualBad = asObject(llmBad.qualification);
              const reason = `Exclusao automatica: LLM sem classificacao valida apos ${DEFAULT_LLM_REPAIR_ATTEMPTS} reparo(s) — ${truncateLogLine(error.message, 220)}`;
              const hadPriorLlm = profileRecordAlreadyHasLlm(item.profile);
              if (hadPriorLlm) {
                const keepMsg = `NAO EXCLUI | perfil ja tinha LLM persistido — mantido na base | ${reason}`;
                emitLog(`@${handle} | ${keepMsg}`);
                progress.failed++;
                options.onResult?.({
                  handle,
                  result: 'erro',
                  llmStatus: String(llmBad.status ?? 'erro'),
                  confidence: llmBad.confidence,
                  mainCategory: parseMainCategory(qualBad.mainCategory) ?? String(qualBad.mainCategory ?? ''),
                  brandSafety: pickBrandSafetyFromQualification(qualBad),
                  qualification: qualBad,
                  processedAt: new Date().toISOString(),
                  error: keepMsg,
                });
                emitLog(`@${handle} | ERRO (mantido) | ${truncateLogLine(keepMsg, 240)}`);
              } else {
                emitLog(`@${handle} | EXCLUINDO | ${reason}`);
                const via =
                  getOptionalAdminBearerForPurge() != null
                    ? 'DELETE admin/influencers (JWT)'
                    : 'POST crawl/collector-delete-profile (X-Collector-Key)';
                emitLog(`@${handle} | >> API crawl: ${via}...`);
                try {
                  const delT0 = Date.now();
                  await deleteProfileAfterAutoExclusion(apiBase, ingestKey, handle);
                  const delMs = Date.now() - delT0;
                  emitLog(`@${handle} | EXCLUIDO OK | perfil removido da base | delete ${delMs}ms`);
                  progress.excluded++;
                  options.onResult?.({
                    handle,
                    result: 'excluido',
                    llmStatus: llmBad.status,
                    confidence: llmBad.confidence,
                    mainCategory: parseMainCategory(qualBad.mainCategory) ?? String(qualBad.mainCategory ?? ''),
                    brandSafety: pickBrandSafetyFromQualification(qualBad),
                    qualification: qualBad,
                    processedAt: new Date().toISOString(),
                    error: reason,
                  });
                } catch (purgeErr) {
                  progress.failed++;
                  const purgeMsg = purgeErr instanceof Error ? purgeErr.message : String(purgeErr);
                  const message = `${error.message} | purge falhou: ${purgeMsg}`;
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
                }
              }
            } else {
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
            }
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
      batchSize,
      listOffset,
      refreshAll,
      useCategoryFilter ? mainCategoryFilter : undefined
    );
    if (!onlyWithLlm) progress.total = Math.max(progress.total, nextBatch.totalPending);
    currentBatch = nextBatch.items;
  }

  return {
    total: progress.total,
    done: progress.done,
    failed: progress.failed,
    excluded: progress.excluded,
    stopped: false,
  };
}

let cachedOllamaClient: Ollama | null = null;

function getOllamaClient(): Ollama {
  if (cachedOllamaClient) return cachedOllamaClient;
  const host = process.env.OLLAMA_HOST?.trim() || DEFAULT_OLLAMA_HOST;
  cachedOllamaClient = new Ollama({ host });
  return cachedOllamaClient;
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
            <th>Handle</th>
            <th class="td-excl-regra">Excl. regra</th>
            <th>profileType</th>
            <th>mainCategory</th>
            <th>gender</th>
            <th>language</th>
            <th>subCategories</th>
            <th>contentPillars</th>
            <th>audienceType</th>
            <th class="td-brand-safety">brandSafety</th>
            <th>personaSummary</th>
            <th>Conf. / status</th>
          </tr>
        </thead>
        <tbody id="resultsBody">
          <tr><td colspan="12">Sem resultados ainda.</td></tr>
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
    function renderResults(items){
      const body = document.getElementById('resultsBody');
      const list = Array.isArray(items) ? items : [];
      body.replaceChildren();
      if(list.length === 0){
        const tr0 = document.createElement('tr');
        const td0 = document.createElement('td');
        td0.colSpan = 12;
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
      for(let j = 0; j < list.length; j++){
        const r = list[j];
        const q = r.qualification && typeof r.qualification === 'object' ? r.qualification : {};
        const tr = document.createElement('tr');
        if(r.result === 'excluido') tr.className = 'row-excluido';
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
        const tdExcl = document.createElement('td');
        tdExcl.className = 'td-excl-regra';
        if(r.result === 'excluido'){
          tdExcl.className = 'td-excl-regra excluido';
          tdExcl.textContent = 'Sim';
          tdExcl.title = String(r.error || 'Removido: language diferente de pt-br ou profileType diferente de pessoal/criador');
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
        document.getElementById('status').textContent = s.running ? (s.stopRequested ? 'Parando...' : 'Rodando') : 'Parado';
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
        renderResults(s.results || []);
        document.getElementById('meta').textContent =
          'Ultimo inicio: ' + (s.lastStartedAt || '-') + ' | Ultimo fim: ' + (s.lastEndedAt || '-') +
          (s.mainCategoryFilter ? ' | Filtro categoria: ' + s.mainCategoryFilter : '');
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
          opt0.textContent = 'Todas (' + nCat + ' categorias · ' + nInf + ' perfis com LLM)';
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
      setInterval(loadCategories, 20000);
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
    refresh(); setInterval(refresh, 1000);
  </script>
</body>
</html>`;
}

async function startUiServer(): Promise<void> {
  const state = {
    running: false,
    stopRequested: false,
    onlyWithLlm: false,
    /** mainCategory canônica quando “só uma categoria”; null = todas */
    mainCategoryFilter: null as string | null,
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
    results: [] as ExtractedResultRow[],
    lastStartedAt: null as string | null,
    lastEndedAt: null as string | null,
    logs: [] as string[],
  };

  const pushLog = (msg: string) => {
    const line = `[${new Date().toISOString()}] ${msg}`;
    state.logs.unshift(line);
    if (state.logs.length > 120) state.logs.pop();
    console.log(line);
  };

  let statsRefreshInFlight = false;
  let statsLastRefreshAt = 0;
  const refreshCoverageStats = async () => {
    if (statsRefreshInFlight) return;
    statsRefreshInFlight = true;
    try {
      const stats = await fetchLlmCoverageStats(getApiBaseOrThrow(), getIngestKeyOrThrow());
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
    state.results = [];
    state.lastStartedAt = new Date().toISOString();
    pushLog('Execucao iniciada.');
    try {
      await refreshCoverageStats();
      const summary = await runBatch({
        shouldStop: () => state.stopRequested,
        onlyWithLlm: state.onlyWithLlm,
        mainCategory: state.mainCategoryFilter ?? undefined,
        concurrency: state.parallelThreads,
        onLog: (message) => pushLog(message),
        onProgress: (p) => {
          state.total = p.total;
          state.processed = p.processed;
          state.done = p.done;
          state.excluded = p.excluded;
          state.failed = p.failed;
          state.currentHandle = p.currentHandle;
          state.estimatedRemainingMs = p.estimatedRemainingMs;
          state.elapsedMs = p.elapsedMs;
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
      await refreshCoverageStats();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushLog(`Falha fatal: ${message}`);
    } finally {
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
        const data = await fetchLlmMainCategoryLabelsFromApi(getApiBaseOrThrow(), getIngestKeyOrThrow());
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
      // Durante execucao tambem precisa atualizar com/sem LLM (antes ficava congelado ate parar o lote).
      const statsIntervalMs = state.running ? 5000 : 10000;
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

    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  const port = getUiPort();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => resolve());
  });
  console.log(`[qualify-ui] Painel em http://localhost:${port}`);
}

async function main(): Promise<void> {
  const mode = (process.argv[2] ?? '').trim().toLowerCase();
  if (mode === 'ui' || mode === 'server') {
    await startUiServer();
    return;
  }
  const summary = await runBatch();
  console.log(
    `[qualify] Finalizado. done=${summary.done} excluded=${summary.excluded} failed=${summary.failed} stopped=${summary.stopped}`
  );
}

main().catch((error) => {
  console.error('[qualify] Falha fatal:', error instanceof Error ? error.stack : error);
  process.exit(1);
});
