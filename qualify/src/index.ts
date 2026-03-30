import 'dotenv/config';
import process from 'node:process';
import http from 'node:http';
import { Ollama } from 'ollama';

type JsonRecord = Record<string, desconhecido>;

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
const DEFAULT_LLM_REPAIR_ATTEMPTS = 2;

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
  const snippets = errors.slice(0, maxSnippets).map((e) =>
    truncateLogLine(e.replace(/^personaSummary /i, 'ps '), 88)
  );
  const tail = errors.length > maxSnippets ? ` +${errors.length - maxSnippets} mais` : '';
  return `${head} — ${snippets.join(' · ')}${tail}`;
}

function toHandle(value: desconhecido): string {
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

function validationErrorsRelateToPersonaSummary(errors: string[]): boolean {
  return errors.some((e) => e.toLowerCase().includes('personasummary'));
}

function normalizeWs(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
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
  const disc = String(profile._discovered_value ?? '').trim();
  if (disc.length >= 5 && ps.toLowerCase().includes(disc.toLowerCase())) {
    errors.push('personaSummary nao pode reproduzir termos identificadores crus do cadastro (_discovered_value)');
  }
  return errors;
}

/** Corta substring e tokens de _discovered_value (>=5 chars) para passar na validacao sem novo LLM. */
function stripDiscoveredFragmentsFromSummary(text: string, discoveredValue: string): string {
  let out = text.trim();
  const disc = discoveredValue.trim();
  if (disc.length < 5) return out;
  try {
    out = out.replace(new RegExp(escapeRegexChars(disc), 'giu'), ' ');
  } catch {
    return out;
  }
  for (const part of disc.split(/[\s,;|/]+/)) {
    const p = part.trim();
    if (p.length < 5) continue;
    try {
      out = out.replace(new RegExp(`\\b${escapeRegexChars(p)}\\b`, 'giu'), ' ');
    } catch {
      /* ignore */
    }
  }
  return out.replace(/\s+/g, ' ').trim();
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

  s = s.replace(/\s+/g, ' ').trim();
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

function asStringArray(value: desconhecido, maxLen = 8): string[] {
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

function asObject(value: desconhecido): JsonRecord {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as JsonRecord;
}

function tryParseJsonObject(content: string): JsonRecord | null {
  const trimmed = content.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as desconhecido;
    return parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as JsonRecord)
      : null;
  } catch {
    // fallback abaixo
  }

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch?.[1]) {
    try {
      const parsed = JSON.parse(fenceMatch[1]) as desconhecido;
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
      const parsed = JSON.parse(candidate) as desconhecido;
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

/**
 * Valores literais permitidos para qualification.mainCategory (ordem fixa para prompts e validacao).
 * O LLM deve retornar EXATAMENTE uma destas strings — sem sinonimos, abreviacoes ou ingles.
 */
export const MAIN_CATEGORY_OPTIONS = [
  'Gastronomia & Culinária',
  'Moda & Estilo',
  'Beleza & Maquiagem',
  'Decoração & Home Office',
  'Viagens & Turismo',
  'Lifestyle & Vlogs',
  'Maternidade & Paternidade',
  'Pets & Animais',
  'Saúde & Bem-estar',
  'Fitness & Esportes',
  'Finanças & Investimentos',
  'Negócios & Carreira',
  'Tecnologia & Inovação',
  'Educação & Idiomas',
  'Desenvolvimento Pessoal',
  'Games & E-sports',
  'Humor & Comédia',
  'Cultura Pop & Cinema',
  'Música & Dança',
  'Arte & Design',
  'Automobilismo & Motores',
  'Sustentabilidade & Ecologia',
] as const;

export type MainCategory = (typeof MAIN_CATEGORY_OPTIONS)[number];

const MAIN_CATEGORY_SET: ReadonlySet<string> = new Set(MAIN_CATEGORY_OPTIONS);

export function isMainCategoryValue(value: string): value is MainCategory {
  return MAIN_CATEGORY_SET.has(value);
}

function stripCombiningMarks(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '');
}

/** Remove ZWSP/BOM que quebram match com "familia" e confundem a UI. */
function stripInvisibleFromString(s: string): string {
  return s.replace(/[\u200B-\u200D\uFEFF]/g, '');
}

/** Aceita apenas string identica a uma opcao canonica (apos trim e invisiveis); NFC para estabilidade Unicode. */
export function parseMainCategory(raw: desconhecido): MainCategory | null {
  const s = stripInvisibleFromString(String(raw ?? '')).trim();
  if (!s) return null;
  if (MAIN_CATEGORY_SET.has(s)) return s as MainCategory;
  try {
    const nfc = s.normalize('NFC');
    if (MAIN_CATEGORY_SET.has(nfc)) return nfc as MainCategory;
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Converte brandSafety do LLM para um dos tres valores canonicos.
 * Aceita string (com acento/ingles) ou objeto simples { level } / riskLevel (compat crawl).
 */
function normalizeBrandSafety(raw: desconhecido): BrandSafetyLevel | null {
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
    const o = raw as Record<string, desconhecido>;
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
  const rec = q as Record<string, desconhecido>;
  return (
    normalizeBrandSafety(q.brandSafety) ??
    normalizeBrandSafety(rec.brand_safety) ??
    normalizeBrandSafety(rec.BrandSafety)
  );
}

/**
 * Criador/pessoal erroneo para marca de produto empacotado (B2C): nome comercial + bio institucional.
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

function normalizeClassification(
  raw: JsonRecord,
  profile: JsonRecord,
  model: string,
  _maxReasoning: number
): LlmClassification {
  const qualificationRaw = asObject(raw.qualification);
  const qualification = Object.keys(qualificationRaw).length > 0 ? qualificationRaw : asObject(raw);
  const bs = pickBrandSafetyFromQualification(qualification);
  if (bs) qualification.brandSafety = bs;
  const mc = parseMainCategory(qualification.mainCategory);
  if (mc) qualification.mainCategory = mc;
  correctProfileTypeWhenProductBrand(profile, qualification);
  const ps0 = String(qualification.personaSummary ?? '').trim();
  if (ps0 && profile && Object.keys(profile).length > 0) {
    qualification.personaSummary = sanitizePersonaSummaryForProfile(ps0, profile);
  }
  const confidence = clamp(Number(raw.confidence ?? 0), 0, 1);
  const statusRaw = String(raw.status ?? '').trim().toLowerCase();
  const status: 'done' | 'insufficient_data' = statusRaw === 'insufficient_data' ? 'insufficient_data' : 'done';

  return {
    qualifiedAt: new Date().toISOString(),
    model,
    version: 3,
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

  const requiredArraysMin2 = ['subCategories', 'audienceType'];
  for (const key of requiredArraysMin2) {
    const arr = asStringArray(q[key], 100);
    if (arr.length < 1) errors.push(`${key} deve ter pelo menos 1 itens`);
  }


  const gender = String(q.gender ?? '').trim().toLowerCase();
  if (!gender) errors.push('gender ausente');
  if (gender && gender.split(/\s+/g).filter(Boolean).length !== 1) {
    errors.push('gender deve ser uma unica palavra');
  }
  const language = String(q.language ?? '').trim().toLowerCase();
  if (!language) errors.push('language ausente');
  if (language.length > 32) errors.push('language muito longo');
  const personaSummary = String(q.personaSummary ?? '').trim();
  if (personaSummary.length < 20) errors.push('personaSummary muito curto');
  if (profile && Object.keys(profile).length > 0) {
    errors.push(...validatePersonaSummaryAgainstProfile(personaSummary, profile));
  }
  const brandSafety = pickBrandSafetyFromQualification(q);
  if (!brandSafety) {
    errors.push('brandSafety ausente ou invalido (obrigatorio: adulto|sensivel|familia)');
  }

  if (!parseMainCategory(q.mainCategory)) {
    errors.push(
      `mainCategory deve ser exatamente uma destas strings (copie literal, sem alterar): ${MAIN_CATEGORY_OPTIONS.join(' | ')}`
    );
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
    `- qualification.mainCategory deve ser EXATAMENTE uma destas strings literais: ${MAIN_CATEGORY_OPTIONS.join(' | ')}`,
    '- qualification.personaSummary: descricao agregada em terceira pessoa; PROIBIDO @, handle, nome publico, copiar biografia, links, metricas ou texto identico ao JSON; se o prompt original trouxer "amostras_textos_publicacoes", use só como pista (nao copie legendas).',
    '- textos humanos (personaSummary, categorias etc.) em pt-BR; qualification.language pelo texto AUTORAL (bio/nome/amostras), ignorando UI da rede (seguidores, Seguir, mensagem, mil); pt-br/en/es/fr/uk/ru/desconhecido; pt-br só se português DOMINAR linhas do criador; nunca pt-br só por UI em PT ou 1 frase PT curta + resto inglês/francês/cirilico',
    '- nao explique nada',
    '',
    'Prompt original:',
    originalPrompt,
    '',
    'JSON atual para corrigir:',
    JSON.stringify(invalidJson),
  ].join('\n');
}

function buildPrompt(
  profile: JsonRecord,
  options: { includePostSamples?: boolean } = {}
): string {
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
    '"criador" só com pessoa central (nome de influencer, "criador(a) de conteudo digital", etc.). "empresa" para instituicao/marca B2C sem rosto unico: produto empacotado (água mineral, bebida, alimento), nome comercial no titulo, bio de produto/prêmios/site oficial — nao use criador. Também loja, clinica, B2B, agencia em "nos". Bio só com link da marca + discurso institucional indica empresa; URL de pessoa (criador) é outro caso.';
  const profileTypeRule = includePostSamples
    ? `profileType: inferir a partir de handle, full_name, biography e amostras_textos_publicacoes (legendas/hashtags). ${profileTypeSignals}`
    : `profileType: inferir a partir de handle, full_name e biography (texto publico do perfil). ${profileTypeSignals}`;
  const personaRule = includePostSamples
    ? 'personaSummary: somente uma descricao editorial sobre o perfil (conteudo, tom, nicho, publico). PROIBIDO: arroba @, handle, nome completo do criador, copiar/colar biografia ou legendas dos posts literalmente, citar numeros de seguidores, URLs ou trechos longos identicos ao JSON. Use amostras_textos_publicacoes só como pista para inferir temas e reescrever em linguagem propria.'
    : 'personaSummary: somente uma descricao editorial sobre o perfil (conteudo, tom, nicho, publico). PROIBIDO: arroba @, handle, nome completo do criador, copiar/colar biografia, citar seguidores, URLs ou trechos longos identicos ao JSON. Se a bio for insuficiente, infira com cautela a partir do handle e do nome, sem inventar fatos especificos.';

  return [
    'Voce e um classificador de perfis para marketing de influencia (perfis podem ser de qualquer pais).',
    'Nao invente informacoes sem base minima nos dados recebidos.',
    profileTypeRule,
    'Nao use metadados omitidos aqui (ex.: account_type, categoria oficial do Instagram).',
    'Responda APENAS JSON valido, sem markdown e sem texto extra.',
    'Textos para o usuario (personaSummary, mainCategory, subCategories, gender, contentPillars, audienceType como rotulos) em portugues do Brasil (pt-BR), sem ingles ou espanhol NESSAS strings.',
    'Voce deve retornar no formato da entidade com o objeto raiz "qualification".',
    'Regras obrigatorias: NUNCA deixe arrays vazios.',
    'subCategories, contentPillars e audienceType deve ser UMA palavra unica e macro (sem frases, sem termos compostos).',
    'language: BCP-47 minuscula do texto que o CRIADOR escreveu (full_name, biography, amostras). IGNORE palavras de interface (seguidores, seguindo, posts, Seguir, mensagem, mil, rótulos de categoria do app em PT). pt-br só se português for claramente dominante nas linhas autorais; linha curta genérica em PT + bio em inglês/francês/outra → use en/es/fr conforme dominância, ou desconhecido se romano ambíguo; cirilico/Ucrânia→uk/ru/desconhecido. Nunca assuma pt-br pelo app em português ou local BR.',
    'gender, mainCategory e brandSafety sao campos OBRIGATORIOS (string escalar cada); subCategories, contentPillars e audienceType sao arrays com pelo menos 1 item.',
    'brandSafety: "familia" para beleza/maquiagem/cursos/educacao e lifestyle normais; "sensivel" so alcool/tabaco/polemica politica/saude arriscada/violencia ou sexualizacao clara; "adulto" so sexo explicito/jogos adultos/gore — nao use sensivel por maquiagem ou emoji de coracao.',
    'mainCategory: copie LITERAL UMA opcao; tema central da bio — banco/bancario/humor de trabalho/denuncia nao e Beleza & Maquiagem (Finanças & Investimentos ou Humor & Comédia). Advocacia/advogado/juridico ou handle "adv." sem eixo comida/receitas -> Negócios & Carreira, nao Gastronomia & Culinária. Igual a lista; nao invente.',
    personaRule,
    'subCategories deve ser ESPECIFICO e orientado a nicho comercial; evite termos amplos/genéricos como "saude e bem-estar", "relacionamento", "lifestyle", "variedades" quando houver contexto mais preciso.',
    'Incerteza: infira pela bio; evite "geral" e "desconhecido" salvo ultimo caso.',
    'Estrutura obrigatoria:',
    '{',
    '  "confidence": 0.0-1.0,',
    '  "qualification": {',
    '    "profileType": "criador|pessoal|empresa|noticia|marca|midia",',
    `    "mainCategory": "${MAIN_CATEGORY_OPTIONS.join('|')}",`,
    '    "gender": "feminino|masculino|desconhecido",',
    '    "language": "pt-br|en|es|fr|uk|ru|desconhecido",',
    '    "subCategories": ["string"],',
    '    "contentPillars": ["string"],',
    '    "audienceType": ["mulheres","homens","infantil","jovens","idosos","homosexual"],',
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

async function fetchPendingFromApi(
  apiBase: string,
  ingestKey: string,
  limit: number,
  offset = 0,
  refreshAll = true
): Promise<{ totalPending: number; items: Array<{ handle: string; profile: JsonRecord }> }> {
  const refreshAllQuery = refreshAll ? '1' : '0';
  const url = `${apiBase}/crawl/collector-llm-pending?limit=${limit}&offset=${offset}&refreshAll=${refreshAllQuery}&includeContent=0`;
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

interface ClassifyLlmPostContext {
  apiBase: string;
  ingestKey: string;
  refreshAll: boolean;
  /** Para logs: em qual perfil esta cada etapa (paralelismo). */
  logHandle?: string;
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
  let prompt = promptOverride ?? buildPrompt(workingProfile, { includePostSamples: false });
  const runInitialGeneration = async (): Promise<JsonRecord> => {
    logStep('>> Ollama: geracao inicial (1a resposta)...');
    const response = await ollamaClient.chat({
      model,
      messages: [
        {
          role: 'system',
          content: 'Voce responde somente JSON valido em portugues do Brasil (pt-BR).',
        },
        { role: 'user', content: prompt },
      ],
      stream: false,
    });
    const content = response.message?.content?.trim() ?? '';
    let parsed = tryParseJsonObject(content);
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
              'Reescreva AGORA apenas no formato JSON solicitado. Se algum campo estiver incerto, use valores padrao plausiveis.',
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
  let llm = normalizeClassification(parsed, workingProfile, model, maxReasoning);
  let validationErrors = validateLlmClassification(llm, workingProfile);
  if (validationErrors.length === 0) {
    logStep('>> ok: qualification valida (sem reparo LLM)');
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
      validationErrorsRelateToPersonaSummary(validationErrors) &&
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

    const usePostsInPrompt =
      promptOverride == null &&
      validationErrorsRelateToPersonaSummary(validationErrors) &&
      profileHasPostTextSamples(workingProfile);

    if (promptOverride == null) {
      prompt = buildPrompt(workingProfile, { includePostSamples: usePostsInPrompt });
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
          content: 'Voce corrige JSON e responde apenas JSON valido em portugues do Brasil (pt-BR).',
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
    llm = normalizeClassification(repairedParsed, workingProfile, model, maxReasoning);
    validationErrors = validateLlmClassification(llm, workingProfile);
    if (validationErrors.length === 0) {
      logStep('>> ok: qualification valida apos reparo');
      return llm;
    }
  }

  throw new Error(`Saida LLM invalida apos reprocessamento: ${validationErrors.join('; ')}`);
}

interface BatchProgress {
  total: number;
  processed: number;
  done: number;
  failed: number;
  currentHandle: string | null;
  runStartedAt: string;
  elapsedMs: number;
  estimatedRemainingMs: number | null;
  onlyWithLlm: boolean;
}

interface ExtractedResultRow {
  handle: string;
  result: 'ok' | 'erro';
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
  stopped: boolean;
}

interface BatchOptions {
  shouldStop?: () => boolean;
  onProgress?: (progress: BatchProgress) => void;
  onResult?: (row: ExtractedResultRow) => void;
  onlyWithLlm?: boolean;
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
  const coverage = await fetchLlmCoverageStats(apiBase, ingestKey);
  const refreshAll = onlyWithLlm;
  const queueOffset = onlyWithLlm ? coverage.withoutLlm : 0;
  const targetTotal = onlyWithLlm ? coverage.withLlm : coverage.withoutLlm;
  const processedHandles = new Set<string>();
  const firstBatch = await fetchPendingFromApi(apiBase, ingestKey, batchSize, queueOffset, refreshAll);
  const emitLog = (msg: string) => {
    const line = `[qualify] ${msg}`;
    console.log(line);
    options.onLog?.(msg);
  };
  emitLog(
    `Perfis alvo via API: ${targetTotal} (modo=${onlyWithLlm ? 'com_llm' : 'sem_llm'}, paralelo=${concurrency})`
  );
  const runStartedAtMs = Date.now();
  const progress: BatchProgress = {
    total: targetTotal,
    processed: 0,
    done: 0,
    failed: 0,
    currentHandle: null,
    runStartedAt: new Date(runStartedAtMs).toISOString(),
    elapsedMs: 0,
    estimatedRemainingMs: null,
    onlyWithLlm,
  };
  options.onProgress?.(progress);
  if (targetTotal === 0 || firstBatch.items.length === 0) {
    return { total: 0, done: 0, failed: 0, stopped: false };
  }

  let currentBatch = firstBatch.items;
  while (currentBatch.length > 0) {
    const todo = currentBatch.filter((item) => {
      const handle = toHandle(item.handle || item.profile.handle);
      return Boolean(handle) && !processedHandles.has(handle);
    });
    if (todo.length === 0) break;

    for (let sliceStart = 0; sliceStart < todo.length; sliceStart += concurrency) {
      if (options.shouldStop?.()) {
        emitLog('Interrompido por solicitacao do usuario.');
        return { total: progress.total, done: progress.done, failed: progress.failed, stopped: true };
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
            const promptPhase1 = buildPrompt(item.profile, { includePostSamples: false });
            const promptChars = promptPhase1.length;
            const promptTokensApprox = Math.ceil(promptChars / 4);
            emitLog(`@${handle} | >> prompt fase1 pronto (~${promptTokensApprox} tok, ${promptChars} chars)`);
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
            emitLog(`@${handle} | >> API collector: ingest LLM (POST)...`);
            const ingestT0 = Date.now();
            await pushLlmToApi(apiBase, ingestKey, handle, llm, refreshAll);
            const ingestMs = Date.now() - ingestT0;
            const totalMs = Date.now() - startedAt;
            emitLog(
              `@${handle} | ok | ${Math.round(llm.confidence * 100)}% | ingest ${ingestMs}ms | total ${totalMs}ms`
            );
            progress.done++;
            const qualOk = asObject(llm.qualification);
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

    const nextBatch = await fetchPendingFromApi(apiBase, ingestKey, batchSize, queueOffset, refreshAll);
    if (!onlyWithLlm) progress.total = Math.max(progress.total, nextBatch.totalPending);
    currentBatch = nextBatch.items;
  }

  return { total: progress.total, done: progress.done, failed: progress.failed, stopped: false };
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
    td.td-brand-safety,th.td-brand-safety{min-width:92px;max-width:140px;font-weight:600;color:#f8fafc}
    a.ig-link{color:#93c5fd;text-decoration:underline}
    a.ig-link:hover{color:#bfdbfe}
    .ok{color:#22c55e}.erro{color:#ef4444}
  </style>
</head>
<body>
  <div class="card">
    <h1>Qualificacao de Influencers</h1>
    <div class="row">
      <button id="startBtn" class="start">Iniciar</button>
      <button id="stopBtn" class="stop">Parar</button>
      <label class="check"><input id="refreshAll" type="checkbox" /> Atualizar perfis que ja tem LLM</label>
      <label class="check">Threads paralelas <input id="concurrency" type="number" min="1" max="16" step="1" value="1" style="width:56px" /></label>
      <div class="muted">Atualizacao automatica a cada 1s</div>
    </div>
    <div class="row">
      <div class="kpi">Status<b id="status">-</b></div>
      <div class="kpi">Pendentes no lote<b id="total">0</b></div>
      <div class="kpi">Processados<b id="processed">0</b></div>
      <div class="kpi">OK<b id="done">0</b></div>
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
    <h3>Resultados extraidos</h3>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Handle</th>
            <th>profileType</th>
            <th>mainCategory</th>
            <th>gender</th>
            <th>language</th>
            <th>subCategories</th>
            <th>contentPillars</th>
            <th>audienceType</th>
            <th class="td-brand-safety">brandSafety</th>
            <th>personaSummary</th>
            <th>Confiança</th>
          </tr>
        </thead>
        <tbody id="resultsBody">
          <tr><td colspan="11">Sem resultados ainda.</td></tr>
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
        td0.colSpan = 11;
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
        tdConf.textContent = formatConf(r.confidence);
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
        renderResults(s.results || []);
        document.getElementById('meta').textContent = 'Ultimo inicio: ' + (s.lastStartedAt || '-') + ' | Ultimo fim: ' + (s.lastEndedAt || '-');
        document.getElementById('logs').textContent = (s.logs || []).join('\\n') || 'Sem logs';
      }catch(e){
        document.getElementById('logs').textContent = 'Erro ao atualizar: ' + e.message;
      }
    }
    document.getElementById('refreshAll').checked = parseBoolParam('onlyWithLlm', false);
    document.getElementById('refreshAll').addEventListener('change', (ev)=>{
      setBoolParam('onlyWithLlm', ev.target.checked === true);
    });
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
        const concEl = document.getElementById('concurrency');
        const conc = Math.max(1, Math.min(16, parseInt(concEl && concEl.value ? concEl.value : '1', 10) || 1));
        if(concEl) conc.value = String(conc);
        try{ localStorage.setItem('qualifyConcurrency', String(conc)); }catch(_e){}
        await call('/api/start?onlyWithLlm=' + (refreshAll ? '1' : '0') + '&concurrency=' + encodeURIComponent(String(conc)),'POST');
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
    parallelThreads: 1,
    total: 0,
    processed: 0,
    done: 0,
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
    state.logs.push(line);
    if (state.logs.length > 120) state.logs.shift();
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
        concurrency: state.parallelThreads,
        onLog: (message) => pushLog(message),
        onProgress: (p) => {
          state.total = p.total;
          state.processed = p.processed;
          state.done = p.done;
          state.failed = p.failed;
          state.currentHandle = p.currentHandle;
          state.estimatedRemainingMs = p.estimatedRemainingMs;
          state.elapsedMs = p.elapsedMs;
        },
        onResult: (row) => {
          state.results.unshift(row);
          if (state.results.length > 250) state.results.length = 250;
          pushLog(
            row.result === 'ok'
              ? `@${row.handle} | OK | ${row.mainCategory} | ${row.brandSafety ?? '-'} | ${row.confidence != null ? `${Math.round(row.confidence * 100)}%` : '-'}`
              : `@${row.handle} | ERRO | ${truncateLogLine(row.error ?? '', 200)}`
          );
        },
      });
      pushLog(`Execucao finalizada. done=${summary.done} failed=${summary.failed} stopped=${summary.stopped}`);
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

    if (method === 'GET' && url.pathname === '/api/status') {
      if (!state.running && Date.now() - statsLastRefreshAt > 10000) void refreshCoverageStats();
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
  console.log(`[qualify] Finalizado. done=${summary.done} failed=${summary.failed} stopped=${summary.stopped}`);
}

main().catch((error) => {
  console.error('[qualify] Falha fatal:', error instanceof Error ? error.stack : error);
  process.exit(1);
});
