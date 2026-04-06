import 'dotenv/config';
import process from 'node:process';
import http from 'node:http';
import { Ollama } from 'ollama';
import { foldMainCategoryKey, formatMainCategoryTaxonomyForPrompt, MAIN_CATEGORY_CANONICAL_LABELS, isCanonicalMainCategoryLabel, resolveMainCategoryWithEvidence, snapMainCategoryToTaxonomy, } from './mainCategoryTaxonomy.js';
const DEFAULT_MODEL = 'llama3.1:8b';
const DEFAULT_OLLAMA_HOST = 'http://localhost:11434';
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_MAX_REASONING = 3;
const DEFAULT_API_TIMEOUT_MS = 30000;
/** POST /collector-ingest-llm pode demorar mais que GETs; padrao 120s para evitar abort apos LLM OK. */
const DEFAULT_INGEST_TIMEOUT_MS = 120000;
const DEFAULT_UI_PORT = 3600;
const DEFAULT_LLM_REPAIR_ATTEMPTS = 2;
function isQualifyVerboseLog() {
    const v = process.env.QUALIFY_LOG_VERBOSE?.trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
}
function truncateLogLine(s, max = 200) {
    const t = s.replace(/\s+/g, ' ').trim();
    if (t.length <= max)
        return t;
    return `${t.slice(0, Math.max(0, max - 1))}…`;
}
/** Uma linha curta: tipos de erro + trechos (evita log gigante com validacao). */
function summarizeValidationErrorsForLog(errors) {
    if (errors.length === 0)
        return '';
    const kinds = new Set();
    for (const e of errors) {
        const low = e.toLowerCase();
        if (low.includes('nome publico') || low.includes('nome completo'))
            kinds.add('nome');
        else if (low.includes('discovered_value') || low.includes('identificadores crus'))
            kinds.add('termo_busca');
        else if (low.includes('biografia'))
            kinds.add('copia_bio');
        else if (low.includes('handle'))
            kinds.add('handle');
        else if (low.includes('muito curto'))
            kinds.add('texto_curto');
        else if (low.includes('maincategory'))
            kinds.add('mainCategory');
        else if (low.includes('brandsafety'))
            kinds.add('brandSafety');
        else if (low.includes('mencoes a usuarios') || (low.includes('personasummary') && low.includes('@')))
            kinds.add('arroba');
        else if (low.includes('personasummary'))
            kinds.add('personaSummary');
        else
            kinds.add('outro');
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
function toHandle(value) {
    return String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/^@/, '');
}
function escapeRegexChars(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/** Amostras de legendas/hashtags dos posts (quando a API envia _llm_content) — só para enriquecer personaSummary. */
function buildPostTextSamplesForPrompt(profile) {
    const raw = profile._llm_content;
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw))
        return [];
    const samples = raw.samples;
    if (!Array.isArray(samples) || samples.length === 0)
        return [];
    const out = [];
    for (const s of samples) {
        if (s == null || typeof s !== 'object' || Array.isArray(s))
            continue;
        const o = s;
        const texto = String(o.text ?? '').trim().slice(0, 480);
        const tags = Array.isArray(o.hashtags)
            ? o.hashtags
                .map((t) => String(t ?? '').trim().replace(/^#/, ''))
                .filter(Boolean)
                .slice(0, 12)
            : [];
        if (!texto && tags.length === 0)
            continue;
        out.push({
            tipo: String(o.kind ?? 'post'),
            texto,
            hashtags: tags,
        });
        if (out.length >= 24)
            break;
    }
    return out;
}
function profileHasPostTextSamples(profile) {
    return buildPostTextSamplesForPrompt(profile).length > 0;
}
function validationErrorsRelateToPersonaSummary(errors) {
    return errors.some((e) => e.toLowerCase().includes('personasummary'));
}
function normalizeWs(s) {
    return s.trim().toLowerCase().replace(/\s+/g, ' ');
}
/** Garante personaSummary descritivo, sem copiar dados brutos do perfil. */
function validatePersonaSummaryAgainstProfile(personaSummary, profile) {
    const errors = [];
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
            if (cleaned.length < 4)
                continue;
            try {
                const re = new RegExp(`\\b${escapeRegexChars(cleaned)}\\b`, 'iu');
                if (re.test(ps)) {
                    errors.push('personaSummary nao pode incluir o nome publico do criador; use descricao agregada (ex.: "criadora de conteudo sobre...")');
                    break;
                }
            }
            catch {
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
function stripDiscoveredFragmentsFromSummary(text, discoveredValue) {
    let out = text.trim();
    const disc = discoveredValue.trim();
    if (disc.length < 5)
        return out;
    try {
        out = out.replace(new RegExp(escapeRegexChars(disc), 'giu'), ' ');
    }
    catch {
        return out;
    }
    for (const part of disc.split(/[\s,;|/]+/)) {
        const p = part.trim();
        if (p.length < 5)
            continue;
        try {
            out = out.replace(new RegExp(`\\b${escapeRegexChars(p)}\\b`, 'giu'), ' ');
        }
        catch {
            /* ignore */
        }
    }
    return out.replace(/\s+/g, ' ').trim();
}
/** Aplica as mesmas regras do validador por remocao deterministica (reduz reparos e tokens). */
function sanitizePersonaSummaryForProfile(personaSummary, profile) {
    let s = personaSummary.trim();
    if (!s)
        return s;
    s = s.replace(/@\w[\w.]*/gu, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    s = stripDiscoveredFragmentsFromSummary(s, String(profile._discovered_value ?? ''));
    const handle = toHandle(profile.handle ?? '');
    if (handle.length >= 2) {
        try {
            s = s.replace(new RegExp(`\\b${escapeRegexChars(handle)}\\b`, 'giu'), ' ');
        }
        catch {
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
            }
            catch {
                /* ignore */
            }
        }
        for (const token of fullName.split(/\s+/)) {
            const cleaned = token.replace(/[^\p{L}\p{N}]/gu, '');
            if (cleaned.length < 4)
                continue;
            try {
                s = s.replace(new RegExp(`\\b${escapeRegexChars(cleaned)}\\b`, 'giu'), ' ');
            }
            catch {
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
function clamp(n, min, max) {
    if (!Number.isFinite(n))
        return min;
    return Math.max(min, Math.min(max, n));
}
function asStringArray(value, maxLen = 8) {
    if (!Array.isArray(value))
        return [];
    const out = [];
    for (const item of value) {
        const s = String(item ?? '').trim();
        if (!s)
            continue;
        if (!out.includes(s))
            out.push(s);
        if (out.length >= maxLen)
            break;
    }
    return out;
}
function asObject(value) {
    if (value == null || typeof value !== 'object' || Array.isArray(value))
        return {};
    return value;
}
function tryParseJsonObject(content) {
    const trimmed = content.trim();
    if (!trimmed)
        return null;
    try {
        const parsed = JSON.parse(trimmed);
        return parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed
            : null;
    }
    catch {
        // fallback abaixo
    }
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch?.[1]) {
        try {
            const parsed = JSON.parse(fenceMatch[1]);
            if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed))
                return parsed;
        }
        catch {
            // segue para extração por chave
        }
    }
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
        const candidate = trimmed.slice(start, end + 1);
        try {
            const parsed = JSON.parse(candidate);
            return parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)
                ? parsed
                : null;
        }
        catch {
            return null;
        }
    }
    return null;
}
/** mainCategory: rótulo de vitrine em pt-BR (LLM elabora; não é colagem das subCategories). */
const MAIN_CATEGORY_MIN_LEN = 2;
const MAIN_CATEGORY_MAX_LEN = 200;
/** Máximo de palavras no nome da categoria (segmentos separados por espaço ou "&"). */
const MAIN_CATEGORY_MAX_WORDS = 1;
/** Quantas subCategories considerar ao detectar "colagem literal" indevida. */
const MAIN_CATEGORY_SUB_MIRROR_MAX = 4;
export function isMainCategoryValue(value) {
    return parseMainCategory(value) !== null;
}
function stripCombiningMarks(s) {
    return s.normalize('NFD').replace(/\p{M}/gu, '');
}
/** Remove ZWSP/BOM que quebram match com "familia" e confundem a UI. */
function stripInvisibleFromString(s) {
    return s.replace(/[\u200B-\u200D\uFEFF]/g, '');
}
/**
 * Normaliza mainCategory: rótulo em pt-BR (comprimento limitado), Unicode NFC.
 * O texto vem do LLM; o servidor encaixa depois na taxonomia fechada (`snapMainCategoryToTaxonomy`).
 */
export function parseMainCategory(raw) {
    const s = stripInvisibleFromString(String(raw ?? '')).trim();
    if (!s)
        return null;
    if (/[\r\n]/.test(s))
        return null;
    let nfc;
    try {
        nfc = s.normalize('NFC');
    }
    catch {
        nfc = s;
    }
    if (nfc.length < MAIN_CATEGORY_MIN_LEN || nfc.length > MAIN_CATEGORY_MAX_LEN)
        return null;
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(nfc))
        return null;
    return nfc;
}
export { formatMainCategoryTaxonomyForPrompt, MAIN_CATEGORY_CANONICAL_LABELS, resolveMainCategoryWithEvidence, scoreMainCategoriesFromEvidence, snapMainCategoryToTaxonomy, } from './mainCategoryTaxonomy.js';
function capitalizeSubcategoryToken(word) {
    const w = stripInvisibleFromString(word).trim();
    if (!w)
        return '';
    return w.charAt(0).toLocaleUpperCase('pt-BR') + w.slice(1).toLowerCase();
}
/** Conta palavras do título (segmentos separados por & ou espaço). */
function countMainCategoryWords(label) {
    const t = stripInvisibleFromString(label).trim();
    if (!t)
        return 0;
    return t
        .split(/\s*[&]\s*|\s+/u)
        .map((x) => x.trim())
        .filter((x) => x.length > 0).length;
}
function mainCategoryWithinWordBudget(label) {
    const n = countMainCategoryWords(label);
    return n >= 1 && n <= MAIN_CATEGORY_MAX_WORDS;
}
/** Igual à colagem mecânica das primeiras subCategories (proibido se não for rótulo canônico da taxonomia). */
function mainCategoryIsLiteralSubcategoryPaste(main, subs) {
    const clean = subs
        .map((s) => stripInvisibleFromString(String(s ?? '').trim()))
        .filter((s) => s.length > 0)
        .slice(0, MAIN_CATEGORY_SUB_MIRROR_MAX);
    if (clean.length === 0)
        return false;
    const caps = clean.map(capitalizeSubcategoryToken).filter((p) => p.length > 0);
    if (caps.length === 0)
        return false;
    const variants = [caps.join(' & '), caps.join(' '), caps.slice(0, 2).join(' & '), caps.slice(0, 2).join(' ')];
    const m = foldMainCategoryKey(main);
    for (const v of variants) {
        if (foldMainCategoryKey(v) === m)
            return true;
    }
    return false;
}
function mainCategoryMatchesPoolLabel(main, pool) {
    if (!pool || pool.length === 0)
        return false;
    const m = foldMainCategoryKey(main);
    return pool.some((p) => foldMainCategoryKey(p) === m);
}
/**
 * Converte brandSafety do LLM para um dos tres valores canonicos.
 * Aceita string (com acento/ingles) ou objeto simples { level } / riskLevel (compat crawl).
 */
function normalizeBrandSafety(raw) {
    if (raw == null)
        return null;
    if (typeof raw === 'string') {
        const n = stripCombiningMarks(stripInvisibleFromString(raw).trim().toLowerCase());
        if (n === 'adulto' || n === 'adult')
            return 'adulto';
        if (n === 'sensivel' || n === 'sensitive')
            return 'sensivel';
        if (n === 'familia' || n === 'family')
            return 'familia';
        return null;
    }
    if (Array.isArray(raw)) {
        for (const el of raw) {
            const v = normalizeBrandSafety(el);
            if (v)
                return v;
        }
        return null;
    }
    if (typeof raw === 'object') {
        const o = raw;
        const nested = normalizeBrandSafety(o.level ?? o.value ?? o.brandSafety);
        if (nested)
            return nested;
        const risk = stripInvisibleFromString(String(o.riskLevel ?? ''))
            .trim()
            .toLowerCase();
        if (risk === 'low')
            return 'familia';
        if (risk === 'medium')
            return 'sensivel';
        if (risk === 'high')
            return 'adulto';
        if (o.isAdultContent === true)
            return 'adulto';
        if (o.isFamilySafe === true)
            return 'familia';
        return null;
    }
    return null;
}
function pickBrandSafetyFromQualification(q) {
    const rec = q;
    return (normalizeBrandSafety(q.brandSafety) ??
        normalizeBrandSafety(rec.brand_safety) ??
        normalizeBrandSafety(rec.BrandSafety));
}
/**
 * Criador/pessoal erroneo para marca de produto empacotado (B2C): nome comercial + bio institucional.
 */
function correctProfileTypeWhenProductBrand(profile, qualification) {
    const pt = String(qualification.profileType ?? '').trim().toLowerCase();
    if (pt !== 'criador' && pt !== 'pessoal')
        return;
    const fn = String(profile.full_name ?? '').normalize('NFC').toLowerCase();
    const bio = String(profile.biography ?? '').normalize('NFC').toLowerCase();
    const handle = String(profile.handle ?? '').toLowerCase();
    const disc = String(profile._discovered_value ?? '').normalize('NFC').toLowerCase();
    const low = `${handle}\n${fn}\n${bio}\n${disc}`;
    if (/\bcriador(a)?\b.*\bconte[uú]do|\binfluencer\b|\byoutuber\b|\bme\s+chamo\b/i.test(low))
        return;
    const hasPackagedProductPhrase = /\bágua\s+mineral\b/u.test(low) ||
        /\bagua\s+mineral\b/i.test(low);
    const hasInstitutionalProductBio = /www\.[a-z0-9.-]+\.(?:com\.br|com)\b/i.test(low) &&
        /top\s+of\s+mind|novo\s+r[oó]tulo|vezes\s+campe[ãa]/i.test(low) &&
        (hasPackagedProductPhrase ||
            /agua|mineral|bebida|iogurt|latic/i.test(handle) ||
            /agua|mineral|bebida/i.test(fn));
    if (!hasPackagedProductPhrase && !hasInstitutionalProductBio)
        return;
    qualification.profileType = 'empresa';
    const g = String(qualification.gender ?? '').trim().toLowerCase();
    if (g === 'feminino' || g === 'masculino')
        qualification.gender = 'desconhecido';
}
function buildProfileContextForMainCategoryEvidence(profile) {
    return [profile.full_name, profile.biography, profile._discovered_value]
        .map((x) => String(x ?? '').trim())
        .filter(Boolean)
        .join('\n');
}
function normalizeClassification(raw, profile, model, _maxReasoning) {
    const qualificationRaw = asObject(raw.qualification);
    const qualification = Object.keys(qualificationRaw).length > 0 ? qualificationRaw : asObject(raw);
    const bs = pickBrandSafetyFromQualification(qualification);
    if (bs)
        qualification.brandSafety = bs;
    correctProfileTypeWhenProductBrand(profile, qualification);
    let mc0 = parseMainCategory(qualification.mainCategory);
    if (mc0) {
        let snapped = snapMainCategoryToTaxonomy(mc0);
        if (snapped) {
            const subsArr = asStringArray(qualification.subCategories, 100);
            const ctx = buildProfileContextForMainCategoryEvidence(profile);
            snapped = resolveMainCategoryWithEvidence(snapped, subsArr, ctx);
            mc0 = parseMainCategory(snapped) ?? snapped;
        }
        qualification.mainCategory = mc0;
    }
    const ps0 = String(qualification.personaSummary ?? '').trim();
    if (ps0 && profile && Object.keys(profile).length > 0) {
        qualification.personaSummary = sanitizePersonaSummaryForProfile(ps0, profile);
    }
    const confidence = clamp(Number(raw.confidence ?? 0), 0, 1);
    const statusRaw = String(raw.status ?? '').trim().toLowerCase();
    const status = statusRaw === 'insufficient_data' ? 'insufficient_data' : 'done';
    return {
        qualifiedAt: new Date().toISOString(),
        model,
        version: 7,
        status,
        confidence,
        qualification,
    };
}
function validateLlmClassification(llm, profile) {
    const errors = [];
    const q = asObject(llm.qualification);
    if (Object.keys(q).length === 0) {
        errors.push('qualification ausente ou invalido');
        return errors;
    }
    const requiredArraysMin2 = ['subCategories', 'audienceType'];
    for (const key of requiredArraysMin2) {
        const arr = asStringArray(q[key], 100);
        if (arr.length < 1)
            errors.push(`${key} deve ter pelo menos 1 itens`);
    }
    const gender = String(q.gender ?? '').trim().toLowerCase();
    if (!gender)
        errors.push('gender ausente');
    if (gender && gender.split(/\s+/g).filter(Boolean).length !== 1) {
        errors.push('gender deve ser uma unica palavra');
    }
    const language = String(q.language ?? '').trim().toLowerCase();
    if (!language)
        errors.push('language ausente');
    if (language.length > 32)
        errors.push('language muito longo');
    const personaSummary = String(q.personaSummary ?? '').trim();
    if (personaSummary.length < 20)
        errors.push('personaSummary muito curto');
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
        errors.push(`mainCategory obrigatorio e invalido (${iaValor}) — pt-BR, ${MAIN_CATEGORY_MIN_LEN}-${MAIN_CATEGORY_MAX_LEN} caracteres; nome de CATEGORIA elaborado pelo modelo (nao omita).`);
    }
    else {
        const nWords = countMainCategoryWords(mcOk);
        if (nWords !== MAIN_CATEGORY_MAX_WORDS) {
            errors.push(`mainCategory: exatamente ${MAIN_CATEGORY_MAX_WORDS} palavra (sem espacos nem "&" entre termos; compostos com hifen contam como uma palavra, ex. Bem-estar).`);
        }
        const subsArr = asStringArray(q.subCategories, 100);
        const canonicalPool = [...MAIN_CATEGORY_CANONICAL_LABELS];
        if (subsArr.length > 0 &&
            mainCategoryIsLiteralSubcategoryPaste(mcOk, subsArr) &&
            !mainCategoryMatchesPoolLabel(mcOk, canonicalPool)) {
            errors.push(`mainCategory nao pode ser só a juncao literal das subCategories; escolha UM rotulo LITERAL da lista fechada do prompt (${formatMainCategoryTaxonomyForPrompt()}).`);
        }
        if (!isCanonicalMainCategoryLabel(mcOk)) {
            errors.push(`mainCategory deve ser EXATAMENTE um destes (copiar texto): ${formatMainCategoryTaxonomyForPrompt()}`);
        }
    }
    return errors;
}
function buildRepairPrompt(originalPrompt, invalidJson, errors) {
    return [
        'Corrija o JSON abaixo mantendo a MESMA estrutura geral.',
        'Erros encontrados:',
        ...errors.map((e) => `- ${e}`),
        'Regras:',
        '- retorne apenas JSON valido',
        '- mantenha todos os campos obrigatorios',
        `- qualification.subCategories: pelo menos 1 item (nicho macro, uma palavra).`,
        `- qualification.mainCategory OBRIGATORIO: copie LITERAL um unico rotulo da LISTA FECHADA do prompt (uma palavra, sem " & "); nao invente sinonimos nem traducoes.`,
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
function buildPrompt(profile, options = {}) {
    const includePostSamples = options.includePostSamples === true;
    // Nao enviar account_type/category do Instagram: o modelo copiava 1:1 para profileType.
    const postSamples = includePostSamples ? buildPostTextSamplesForPrompt(profile) : [];
    const compact = {
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
    const profileTypeSignals = 'pessoal: individuo sem voz de marca nem operacao comercial na bio. empresa: nome tipo linha de produto (ex. X Style); atacado/varejo; email comercial/vendas; fones regionais/Whats; bio de pedidos+link (linktr/site); OU bio de campanha/colecao, CTA institucional (conheca a colecao, maior X do pais), terceira pessoa da marca (a [marca] preparou), hashtag oficial #Marca — tudo isso e empresa, nao pessoal. Rotulos em discovered_* (ex. empreendedor) nao definem profileType se o texto for claramente de marca. criador: pessoa/influencer no centro. produto empacotado, loja, clinica, B2B, agencia → empresa.';
    const profileTypeRule = includePostSamples
        ? `profileType: inferir a partir de handle, full_name, biography e amostras_textos_publicacoes (legendas/hashtags). ${profileTypeSignals}`
        : `profileType: inferir a partir de handle, full_name e biography (texto publico do perfil). ${profileTypeSignals}`;
    const personaRule = includePostSamples
        ? 'personaSummary: somente uma descricao editorial sobre o perfil (conteudo, tom, nicho, publico). PROIBIDO: arroba @, handle, nome completo do criador, copiar/colar biografia ou legendas dos posts literalmente, citar numeros de seguidores, URLs ou trechos longos identicos ao JSON. Use amostras_textos_publicacoes só como pista para inferir temas e reescrever em linguagem propria.'
        : 'personaSummary: somente uma descricao editorial sobre o perfil (conteudo, tom, nicho, publico). PROIBIDO: arroba @, handle, nome completo do criador, copiar/colar biografia, citar seguidores, URLs ou trechos longos identicos ao JSON. Se a bio for insuficiente, infira com cautela a partir do handle e do nome, sem inventar fatos especificos.';
    const postsLeadWhenBioWeak = postSamples.length > 0
        ? 'Com amostras_textos_publicacoes: se biography for curta, vaga, só slogan ou nao definir o nicho, defina profileType, subCategories (ordem: tema dominante primeiro), contentPillars e mainCategory (UMA palavra, nome de vitrine) pelo TEMA DOMINANTE nas amostras; bio e handle apenas apoiam.'
        : null;
    const mainCategoryTaxonomyRule = `LISTA FECHADA mainCategory — escolha EXATAMENTE UMA destas palavras e copie o texto LITERAL (acentos inclusos; uma unica palavra por rotulo): ${formatMainCategoryTaxonomyForPrompt()}`;
    return [
        'Voce e um classificador de perfis para marketing de influencia (perfis podem ser de qualquer pais).',
        'Nao invente informacoes sem base minima nos dados recebidos.',
        profileTypeRule,
        ...(postsLeadWhenBioWeak ? [postsLeadWhenBioWeak] : []),
        mainCategoryTaxonomyRule,
        'Nao use metadados omitidos aqui (ex.: account_type, categoria oficial do Instagram).',
        'Responda APENAS JSON valido, sem markdown e sem texto extra.',
        'Textos para o usuario (personaSummary, mainCategory, subCategories, gender, contentPillars, audienceType como rotulos) em portugues do Brasil (pt-BR), sem ingles ou espanhol NESSAS strings.',
        'Voce deve retornar no formato da entidade com o objeto raiz "qualification".',
        'Regras obrigatorias: NUNCA deixe arrays vazios.',
        'subCategories, contentPillars e audienceType deve ser UMA palavra unica e macro (sem frases, sem termos compostos).',
        'language: BCP-47 minuscula do texto que o CRIADOR escreveu (full_name, biography, amostras). IGNORE palavras de interface (seguidores, seguindo, posts, Seguir, mensagem, mil, rótulos de categoria do app em PT). pt-br só se português for claramente dominante nas linhas autorais; linha curta genérica em PT + bio em inglês/francês/outra → use en/es/fr conforme dominância, ou desconhecido se romano ambíguo; cirilico/Ucrânia→uk/ru/desconhecido. Nunca assuma pt-br pelo app em português ou local BR.',
        'subCategories e a FONTE do nicho (termos especificos): defina primeiro (ordem importa: mais especifico ou dominante primeiro). Cada item UMA palavra macro em pt-BR (sem frases).',
        'mainCategory e OBRIGATORIO: deve ser EXATAMENTE um dos rotulos da lista fechada acima (uma palavra, copiar igual). PROIBIDO espacos, " & " e frases compostas. Use as subCategories para decidir QUAL rotulo da lista melhor representa o nicho (ex.: subs maquiagem, skincare -> "Beleza"; subs receitas, vegano -> "Alimentacao"; subs viagem, hotel -> "Viagens").',
        'PROIBIDO inventar rotulos fora da lista fechada. Se o nicho for ambiguo, escolha o rotulo macro mais comercial da lista.',
        'O servidor reavalia mainCategory contra subCategories + bio/nome/descoberta: se o rotulo nao bater com os sinais, corrige para a categoria sustentada pelas evidencias (nao confie em chute incoerente).',
        'O servidor normaliza grafias/aliases comuns e texto legado para essa lista; ainda assim copie sempre um rotulo literal da lista alinhado as subs.',
        'mainCategory, gender e brandSafety sao campos OBRIGATORIOS (string escalar cada); subCategories, contentPillars e audienceType sao arrays com pelo menos 1 item.',
        'brandSafety: "familia" para beleza/maquiagem/cursos/educacao e lifestyle normais; "sensivel" so alcool/tabaco/polemica politica/saude arriscada/violencia ou sexualizacao clara; "adulto" so sexo explicito/jogos adultos/gore — nao use sensivel por maquiagem ou emoji de coracao.',
        personaRule,
        'subCategories deve ser ESPECIFICO e orientado a nicho comercial; evite termos amplos/genéricos como "variedades", "geral", "conteudo" quando houver contexto mais preciso (ex.: pilates, receitas, skincare, investimentos).',
        includePostSamples
            ? 'Incerteza: infira pela bio e pelas amostras recentes; evite "geral" e "desconhecido" salvo ultimo caso.'
            : 'Incerteza: infira pela bio; evite "geral" e "desconhecido" salvo ultimo caso.',
        'Estrutura obrigatoria:',
        '{',
        '  "confidence": 0.0-1.0,',
        '  "qualification": {',
        '    "profileType": "criador|pessoal|empresa|noticia|marca|midia",',
        `    "mainCategory": "<obrigatorio: copiar LITERAL um rotulo da lista fechada>",`,
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
function normalizeBaseUrl(raw) {
    return raw.trim().replace(/\/+$/, '');
}
function getApiBaseOrThrow() {
    const base = process.env.QUALIFY_API_BASE?.trim() || process.env.COLLECTOR_API_BASE?.trim();
    if (!base) {
        throw new Error('Defina QUALIFY_API_BASE (ou COLLECTOR_API_BASE) para usar a API remota.');
    }
    if (process.env.QUALIFY_API_NO_AUTO_SUFFIX === '1' ||
        process.env.QUALIFY_API_NO_AUTO_SUFFIX?.toLowerCase() === 'true') {
        return normalizeBaseUrl(base);
    }
    if (/\/api(\/|$)/i.test(base)) {
        return normalizeBaseUrl(base);
    }
    return normalizeBaseUrl(`${base}/api`);
}
function getIngestKeyOrThrow() {
    const key = process.env.QUALIFY_INGEST_KEY?.trim() || process.env.COLLECTOR_INGEST_KEY?.trim();
    if (!key) {
        throw new Error('Defina QUALIFY_INGEST_KEY (ou COLLECTOR_INGEST_KEY) com a chave X-Collector-Key.');
    }
    return key;
}
function getTimeoutMs() {
    const n = Number(process.env.QUALIFY_API_TIMEOUT_MS ?? DEFAULT_API_TIMEOUT_MS);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_API_TIMEOUT_MS;
}
function getIngestPushTimeoutMs() {
    const raw = process.env.QUALIFY_INGEST_TIMEOUT_MS?.trim();
    if (raw) {
        const n = Number(raw);
        if (Number.isFinite(n) && n > 0)
            return Math.floor(n);
    }
    return DEFAULT_INGEST_TIMEOUT_MS;
}
async function fetchJson(url, init, timeoutMs) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...init, signal: ac.signal });
        const text = await res.text();
        let data = {};
        try {
            data = text ? JSON.parse(text) : {};
        }
        catch {
            throw new Error(`Resposta invalida da API (${res.status}): ${text.slice(0, 220)}`);
        }
        if (!res.ok) {
            throw new Error(`${res.status} ${String(data.error ?? text ?? 'Erro na API')}`);
        }
        return data;
    }
    finally {
        clearTimeout(timer);
    }
}
function getLlmMediaContextLimit() {
    const n = Number(process.env.QUALIFY_MEDIA_CONTEXT_LIMIT ?? 24);
    return Number.isFinite(n) && n > 0 ? Math.max(1, Math.min(60, Math.floor(n))) : 24;
}
/** Quantidade de midias mais recentes (post/reel/tagged) na fila inicial; padrao 4. */
function getQualifyInitialMediaLimit() {
    const n = Number(process.env.QUALIFY_INITIAL_MEDIA_LIMIT ?? 4);
    return Number.isFinite(n) && n > 0 ? Math.max(1, Math.min(10, Math.floor(n))) : 4;
}
async function fetchPendingFromApi(apiBase, ingestKey, limit, offset = 0, refreshAll = true) {
    const refreshAllQuery = refreshAll ? '1' : '0';
    const mediaLimit = getQualifyInitialMediaLimit();
    const url = `${apiBase}/crawl/collector-llm-pending?limit=${limit}&offset=${offset}&refreshAll=${refreshAllQuery}&includeContent=1&mediaLimit=${mediaLimit}`;
    const data = await fetchJson(url, {
        method: 'GET',
        headers: {
            'X-Collector-Key': ingestKey,
        },
    }, getTimeoutMs());
    const itemsRaw = Array.isArray(data.items) ? data.items : [];
    const totalPendingRaw = Number(data.totalPending ?? itemsRaw.length);
    const items = [];
    for (const item of itemsRaw) {
        if (!item || typeof item !== 'object')
            continue;
        const o = item;
        const handle = toHandle(o.handle);
        const profile = (o.profile ?? null);
        if (!handle || !profile || typeof profile !== 'object' || Array.isArray(profile))
            continue;
        items.push({ handle, profile: { ...profile, handle } });
    }
    return {
        totalPending: Number.isFinite(totalPendingRaw) ? Math.max(0, Math.floor(totalPendingRaw)) : items.length,
        items,
    };
}
/** Uma requisicao pontual com legendas (barato em tokens na fila: só usada na 2a fase do LLM). */
async function fetchProfilePostContextFromApi(apiBase, ingestKey, handle, refreshAll) {
    const h = toHandle(handle);
    if (!h)
        return null;
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
    const data = await fetchJson(url, {
        method: 'GET',
        headers: {
            'X-Collector-Key': ingestKey,
        },
    }, getTimeoutMs());
    const itemsRaw = Array.isArray(data.items) ? data.items : [];
    const first = itemsRaw[0];
    if (!first || typeof first !== 'object')
        return null;
    const profile = first.profile;
    if (!profile || typeof profile !== 'object' || Array.isArray(profile))
        return null;
    return profile;
}
function mergePostContextFromApiProfile(base, enriched) {
    if (!enriched || typeof enriched !== 'object' || Array.isArray(enriched))
        return base;
    const ctx = enriched._llm_content;
    if (ctx == null || typeof ctx !== 'object' || Array.isArray(ctx))
        return base;
    return { ...base, _llm_content: ctx };
}
async function fetchLlmCoverageStats(apiBase, ingestKey) {
    const [all, pendingOnly] = await Promise.all([
        fetchJson(`${apiBase}/crawl/collector-llm-pending?limit=1&offset=0&refreshAll=1&includeContent=0`, {
            method: 'GET',
            headers: {
                'X-Collector-Key': ingestKey,
            },
        }, getTimeoutMs()),
        fetchJson(`${apiBase}/crawl/collector-llm-pending?limit=1&offset=0&refreshAll=0&includeContent=0`, {
            method: 'GET',
            headers: {
                'X-Collector-Key': ingestKey,
            },
        }, getTimeoutMs()),
    ]);
    const totalProfilesRaw = Number(all.totalPending ?? 0);
    const withoutLlmRaw = Number(pendingOnly.totalPending ?? 0);
    const totalProfiles = Number.isFinite(totalProfilesRaw) ? Math.max(0, Math.floor(totalProfilesRaw)) : 0;
    const withoutLlm = Number.isFinite(withoutLlmRaw) ? Math.max(0, Math.floor(withoutLlmRaw)) : 0;
    const withLlm = Math.max(0, totalProfiles - withoutLlm);
    return { totalProfiles, withoutLlm, withLlm };
}
async function pushLlmToApi(apiBase, ingestKey, handle, llm, allowLlmReplace) {
    const q = allowLlmReplace ? '?allowLlmReplace=1' : '';
    const url = `${apiBase}/crawl/collector-ingest-llm${q}`;
    await fetchJson(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Collector-Key': ingestKey,
        },
        body: JSON.stringify({ handle, llm }),
    }, getIngestPushTimeoutMs());
}
/** Regra de negócio: manter só criadores/pessoas físicas em conteúdo pt-BR; demais tipos em pt-br saem da base. */
function shouldExcludePtBrNonPersonalCreator(qualification) {
    const pt = String(qualification.profileType ?? '').trim().toLowerCase();
    const lang = String(qualification.language ?? '').trim().toLowerCase();
    if (pt === 'pessoal' || pt === 'criador')
        return false;
    return lang === 'pt-br';
}
/** JWT adm opcional; sem ele usa POST /crawl/collector-delete-profile com a mesma chave do ingest. */
function getOptionalAdminBearerForPurge() {
    const t = process.env.QUALIFY_ADMIN_BEARER_TOKEN?.trim() ||
        process.env.QUALIFY_ADMIN_DELETE_JWT?.trim();
    return t || null;
}
async function deleteProfileAfterAutoExclusion(apiBase, ingestKey, handle) {
    const h = toHandle(handle);
    if (!h)
        throw new Error('Handle invalido para exclusao.');
    const bearer = getOptionalAdminBearerForPurge();
    if (bearer) {
        const url = `${apiBase}/admin/influencers/${encodeURIComponent(h)}`;
        await fetchJson(url, {
            method: 'DELETE',
            headers: {
                Authorization: `Bearer ${bearer}`,
            },
        }, getIngestPushTimeoutMs());
        return;
    }
    const url = `${apiBase}/crawl/collector-delete-profile`;
    await fetchJson(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Collector-Key': ingestKey,
        },
        body: JSON.stringify({ handle: h }),
    }, getIngestPushTimeoutMs());
}
async function classifyProfile(profile, model, maxReasoning, promptOverride, onLog, postCtx) {
    const ollamaClient = getOllamaClient();
    const handleTag = postCtx?.logHandle ?? toHandle(profile.handle ?? '');
    const logStep = (msg) => onLog?.(handleTag ? `@${handleTag} | ${msg}` : msg);
    let workingProfile = { ...profile };
    const hasPostSamples = profileHasPostTextSamples(workingProfile);
    let prompt = promptOverride ??
        buildPrompt(workingProfile, {
            includePostSamples: hasPostSamples,
        });
    const runInitialGeneration = async () => {
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
                        content: 'Converta a resposta anterior para JSON valido estrito. Retorne somente JSON, sem markdown, sem comentarios e sem texto extra.',
                    },
                    { role: 'user', content: prompt },
                    {
                        role: 'assistant',
                        content: content || 'Sem resposta anterior',
                    },
                    {
                        role: 'user',
                        content: 'Reescreva AGORA apenas no formato JSON solicitado. Se algum campo estiver incerto, use valores padrao plausiveis.',
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
        logStep(`>> local: validacao falhou — ${summarizeValidationErrorsForLog(validationErrors)} (reparo ${attempt}/${DEFAULT_LLM_REPAIR_ATTEMPTS})`);
        if (postCtx &&
            promptOverride == null &&
            !attemptedPostFetch &&
            validationErrorsRelateToPersonaSummary(validationErrors) &&
            !profileHasPostTextSamples(workingProfile)) {
            attemptedPostFetch = true;
            logStep('>> API collector: buscar legendas (enriquecer prompt)...');
            try {
                const enriched = await fetchProfilePostContextFromApi(postCtx.apiBase, postCtx.ingestKey, toHandle(workingProfile.handle ?? ''), postCtx.refreshAll);
                workingProfile = mergePostContextFromApiProfile(workingProfile, enriched);
                logStep('>> API collector: legendas recebidas');
            }
            catch (e) {
                logStep(`>> API collector: aviso legendas — ${truncateLogLine(e instanceof Error ? e.message : String(e), 140)}`);
            }
        }
        const usePostsInPrompt = promptOverride == null && profileHasPostTextSamples(workingProfile);
        if (promptOverride == null) {
            prompt = buildPrompt(workingProfile, {
                includePostSamples: usePostsInPrompt,
            });
        }
        logStep(`>> Ollama: reparo validacao #${attempt}/${DEFAULT_LLM_REPAIR_ATTEMPTS}...`);
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
async function runBatch(options = {}) {
    const apiBase = getApiBaseOrThrow();
    const ingestKey = getIngestKeyOrThrow();
    const model = process.env.OLLAMA_MODEL?.trim() || DEFAULT_MODEL;
    const batchSize = Math.max(1, Number(process.env.QUALIFY_BATCH_SIZE ?? DEFAULT_BATCH_SIZE) || DEFAULT_BATCH_SIZE);
    const maxReasoning = Math.max(1, Number(process.env.QUALIFY_MAX_REASONING ?? DEFAULT_MAX_REASONING) || DEFAULT_MAX_REASONING);
    const concurrency = Math.max(1, Math.min(16, Math.floor(Number(options.concurrency ?? process.env.QUALIFY_CONCURRENCY ?? 1)) || 1));
    const onlyWithLlm = options.onlyWithLlm === true;
    const coverage = await fetchLlmCoverageStats(apiBase, ingestKey);
    const refreshAll = onlyWithLlm;
    const queueOffset = onlyWithLlm ? coverage.withoutLlm : 0;
    const targetTotal = onlyWithLlm ? coverage.withLlm : coverage.withoutLlm;
    const processedHandles = new Set();
    const firstBatch = await fetchPendingFromApi(apiBase, ingestKey, batchSize, queueOffset, refreshAll);
    const emitLog = (msg) => {
        const line = `[qualify] ${msg}`;
        console.log(line);
        options.onLog?.(msg);
    };
    emitLog(`Perfis alvo via API: ${targetTotal} (modo=${onlyWithLlm ? 'com_llm' : 'sem_llm'}, paralelo=${concurrency})`);
    emitLog(`mainCategory: taxonomia fechada com ${MAIN_CATEGORY_CANONICAL_LABELS.length} rotulos canonicos (+ normalizacao de aliases no servidor)`);
    const runStartedAtMs = Date.now();
    const progress = {
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
    };
    options.onProgress?.(progress);
    if (targetTotal === 0 || firstBatch.items.length === 0) {
        return { total: 0, done: 0, failed: 0, excluded: 0, stopped: false };
    }
    let currentBatch = firstBatch.items;
    while (currentBatch.length > 0) {
        const todo = currentBatch.filter((item) => {
            const handle = toHandle(item.handle || item.profile.handle);
            return Boolean(handle) && !processedHandles.has(handle);
        });
        if (todo.length === 0)
            break;
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
            if (activeHandles.length === 0)
                continue;
            progress.currentHandle =
                activeHandles.length <= 4
                    ? activeHandles.join(' · ')
                    : `${activeHandles.slice(0, 3).join(' · ')} · +${activeHandles.length - 3}`;
            options.onProgress?.(progress);
            await Promise.all(slice.map(async (item) => {
                const handle = toHandle(item.handle || item.profile.handle);
                if (!handle || processedHandles.has(handle))
                    return;
                processedHandles.add(handle);
                progress.total = Math.max(targetTotal, processedHandles.size);
                try {
                    const promptPhase1 = buildPrompt(item.profile, {
                        includePostSamples: profileHasPostTextSamples(item.profile),
                    });
                    const promptChars = promptPhase1.length;
                    const promptTokensApprox = Math.ceil(promptChars / 4);
                    const nPostSamples = buildPostTextSamplesForPrompt(item.profile).length;
                    emitLog(`@${handle} | >> prompt fase1 pronto (~${promptTokensApprox} tok, ${promptChars} chars)${nPostSamples > 0 ? ` | ${nPostSamples} amostra(s) post/reel recente(s)` : ''}`);
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
                    if (shouldExcludePtBrNonPersonalCreator(qualOk)) {
                        const pt = String(qualOk.profileType ?? '').trim();
                        const lang = String(qualOk.language ?? '').trim();
                        const reason = `Exclusao automatica: language=pt-br exige profileType pessoal ou criador (atual: profileType=${pt}, language=${lang})`;
                        emitLog(`@${handle} | EXCLUINDO | ${reason}`);
                        const via = getOptionalAdminBearerForPurge() != null
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
                    else {
                        emitLog(`@${handle} | >> API collector: ingest LLM (POST)...`);
                        const ingestT0 = Date.now();
                        await pushLlmToApi(apiBase, ingestKey, handle, llm, refreshAll);
                        const ingestMs = Date.now() - ingestT0;
                        const totalMs = Date.now() - startedAt;
                        emitLog(`@${handle} | ok | ${Math.round(llm.confidence * 100)}% | ingest ${ingestMs}ms | total ${totalMs}ms`);
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
                }
                catch (error) {
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
                finally {
                    progress.processed++;
                    progress.elapsedMs = Math.max(0, Date.now() - runStartedAtMs);
                    if (progress.processed > 0 && progress.total > progress.processed) {
                        const avgMsPerItem = progress.elapsedMs / progress.processed;
                        progress.estimatedRemainingMs = Math.max(0, Math.round((progress.total - progress.processed) * avgMsPerItem));
                    }
                    else {
                        progress.estimatedRemainingMs = 0;
                    }
                    options.onProgress?.(progress);
                }
            }));
        }
        const nextBatch = await fetchPendingFromApi(apiBase, ingestKey, batchSize, queueOffset, refreshAll);
        if (!onlyWithLlm)
            progress.total = Math.max(progress.total, nextBatch.totalPending);
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
let cachedOllamaClient = null;
function getOllamaClient() {
    if (cachedOllamaClient)
        return cachedOllamaClient;
    const host = process.env.OLLAMA_HOST?.trim() || DEFAULT_OLLAMA_HOST;
    cachedOllamaClient = new Ollama({ host });
    return cachedOllamaClient;
}
function getUiPort() {
    const n = Number(process.env.QUALIFY_UI_PORT ?? DEFAULT_UI_PORT);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_UI_PORT;
}
function renderUiHtml() {
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
            <th>Conf. / status</th>
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
          tdConf.title = String(r.error || 'Removido pela regra pt-br / pessoal|criador');
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
async function startUiServer() {
    const state = {
        running: false,
        stopRequested: false,
        onlyWithLlm: false,
        parallelThreads: 1,
        total: 0,
        processed: 0,
        done: 0,
        excluded: 0,
        failed: 0,
        currentHandle: null,
        estimatedRemainingMs: null,
        elapsedMs: 0,
        withLlm: 0,
        withoutLlm: 0,
        totalProfiles: 0,
        results: [],
        lastStartedAt: null,
        lastEndedAt: null,
        logs: [],
    };
    const pushLog = (msg) => {
        const line = `[${new Date().toISOString()}] ${msg}`;
        state.logs.push(line);
        if (state.logs.length > 120)
            state.logs.shift();
        console.log(line);
    };
    let statsRefreshInFlight = false;
    let statsLastRefreshAt = 0;
    const refreshCoverageStats = async () => {
        if (statsRefreshInFlight)
            return;
        statsRefreshInFlight = true;
        try {
            const stats = await fetchLlmCoverageStats(getApiBaseOrThrow(), getIngestKeyOrThrow());
            state.withLlm = stats.withLlm;
            state.withoutLlm = stats.withoutLlm;
            state.totalProfiles = stats.totalProfiles;
            statsLastRefreshAt = Date.now();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            pushLog(`Falha ao atualizar contagem com/sem LLM: ${message}`);
        }
        finally {
            statsRefreshInFlight = false;
        }
    };
    const runAsync = async () => {
        if (state.running)
            return;
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
                },
                onResult: (row) => {
                    state.results.unshift(row);
                    if (state.results.length > 250)
                        state.results.length = 250;
                    if (row.result === 'ok') {
                        pushLog(`@${row.handle} | OK | ${row.mainCategory} | ${row.brandSafety ?? '-'} | ${row.confidence != null ? `${Math.round(row.confidence * 100)}%` : '-'}`);
                    }
                    else if (row.result === 'excluido') {
                        /* Linhas EXCLUINDO / API / EXCLUIDO OK ja foram enviadas por emitLog no runBatch. */
                    }
                    else {
                        pushLog(`@${row.handle} | ERRO | ${truncateLogLine(row.error ?? '', 200)}`);
                    }
                },
            });
            pushLog(`Execucao finalizada. done=${summary.done} excluded=${summary.excluded} failed=${summary.failed} stopped=${summary.stopped}`);
            await refreshCoverageStats();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            pushLog(`Falha fatal: ${message}`);
        }
        finally {
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
            if (!state.running && Date.now() - statsLastRefreshAt > 10000)
                void refreshCoverageStats();
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
            if (!state.running)
                void runAsync();
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
                ok: true,
                running: true,
                onlyWithLlm: state.onlyWithLlm,
                parallelThreads: state.parallelThreads,
            }));
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
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '0.0.0.0', () => resolve());
    });
    console.log(`[qualify-ui] Painel em http://localhost:${port}`);
}
async function main() {
    const mode = (process.argv[2] ?? '').trim().toLowerCase();
    if (mode === 'ui' || mode === 'server') {
        await startUiServer();
        return;
    }
    const summary = await runBatch();
    console.log(`[qualify] Finalizado. done=${summary.done} excluded=${summary.excluded} failed=${summary.failed} stopped=${summary.stopped}`);
}
main().catch((error) => {
    console.error('[qualify] Falha fatal:', error instanceof Error ? error.stack : error);
    process.exit(1);
});
