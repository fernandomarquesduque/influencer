/**
 * Taxonomia fechada de mainCategory (macro, uma palavra) + subCategories → main (V2).
 * Prioridade: subCategories (mapa fechado) → bio/contexto (aliases + sinais) → snap do LLM.
 * Duplicado em crawl/src/lib/mainCategoryTaxonomy.ts — altere nos dois arquivos.
 */
export const MAIN_CATEGORY_CANONICAL_LABELS = [
    'Beleza',
    'Moda',
    'Fitness',
    'Saúde',
    'Alimentação',
    'Viagens',
    'Entretenimento',
    'Humor',
    'Música',
    'Esportes',
    'Tecnologia',
    'Educação',
    'Negócios',
    'Finanças',
    'Maternidade',
    'Lifestyle',
    'Política',
    'Pets',
    'Games',
    'Casa',
    'Automotivo',
    'Religião',
];
const MAIN_CATEGORY_SNAP_SCORE_HIGH = 0.74;
const MAIN_CATEGORY_SNAP_SCORE_LOW = 0.58;
/** Último recurso quando o texto não encaixa em nenhuma faceta (evita perfil “sem categoria”). */
const MAIN_CATEGORY_FALLBACK = 'Lifestyle';
function stripCombiningMarks(s) {
    return s.normalize('NFD').replace(/\p{M}/gu, '');
}
function stripInvisible(s) {
    return s.replace(/[\u200B-\u200D\uFEFF]/g, '');
}
/** Mesma ideia do qualify: comparar rótulos “dobrados” (acento/minúsculas). */
export function foldMainCategoryKey(s) {
    return stripCombiningMarks(stripInvisible(s).trim().toLowerCase())
        .replace(/\s+/g, ' ')
        .replace(/\s*&\s*/g, ' & ');
}
/** Normaliza token de subCategory para lookup no mapa fechado (underscore → espaço, depois fold). */
export function normalizeSubcategoryToken(s) {
    return foldMainCategoryKey(String(s ?? '').trim().replace(/_/g, ' '));
}
function countMainCategoryWords(label) {
    const t = stripInvisible(label).trim();
    if (!t)
        return 0;
    return t
        .split(/\s*[&]\s*|\s+/u)
        .map((x) => x.trim())
        .filter((x) => x.length > 0).length;
}
function mainCategoryWithinWordBudget(label) {
    const n = countMainCategoryWords(label);
    return n >= 1 && n <= 1;
}
/**
 * SubCategories controladas → mainCategory. Cada chave: uma palavra ou snake_case;
 * valores devem existir em MAIN_CATEGORY_CANONICAL_LABELS.
 */
const SUBCATEGORY_TO_MAIN_RAW = {
    // Beleza
    maquiagem: 'Beleza',
    skincare: 'Beleza',
    cabelo: 'Beleza',
    unhas: 'Beleza',
    estetica: 'Beleza',
    perfumaria: 'Beleza',
    belleza: 'Beleza',
    bellezas: 'Beleza',
    makeup: 'Beleza',
    make: 'Beleza',
    'skin care': 'Beleza',
    cosmeticos: 'Beleza',
    estética: 'Beleza',
    // Moda
    roupas: 'Moda',
    estilo: 'Moda',
    fashion: 'Moda',
    streetwear: 'Moda',
    roupa: 'Moda',
    acessorios: 'Moda',
    acessórios: 'Moda',
    style: 'Moda',
    // Fitness
    treino: 'Fitness',
    musculacao: 'Fitness',
    crossfit: 'Fitness',
    academia: 'Fitness',
    corrida: 'Fitness',
    treinos: 'Fitness',
    musculação: 'Fitness',
    pilates: 'Fitness',
    yoga: 'Fitness',
    nutricao: 'Fitness',
    nutrição: 'Fitness',
    wellness: 'Fitness',
    'bem estar': 'Fitness',
    'bem-estar': 'Fitness',
    // Saúde
    medicina: 'Saúde',
    psicologia: 'Saúde',
    terapia: 'Saúde',
    saude_mental: 'Saúde',
    saude: 'Saúde',
    clinica: 'Saúde',
    clínica: 'Saúde',
    hospital: 'Saúde',
    farmacia: 'Saúde',
    farmácia: 'Saúde',
    saudemental: 'Saúde',
    'saúde mental': 'Saúde',
    // Alimentação
    culinaria: 'Alimentação',
    gastronomia: 'Alimentação',
    receitas: 'Alimentação',
    comida: 'Alimentação',
    culinária: 'Alimentação',
    receita: 'Alimentação',
    chef: 'Alimentação',
    cozinha: 'Alimentação',
    vegano: 'Alimentação',
    vegana: 'Alimentação',
    food: 'Alimentação',
    resturante: 'Alimentação',
    restaurante: 'Alimentação',
    // Viagens
    turismo: 'Viagens',
    viagem: 'Viagens',
    hoteis: 'Viagens',
    hotel: 'Viagens',
    travel: 'Viagens',
    viajar: 'Viagens',
    'viagens & turismo': 'Viagens',
    'viagens e turismo': 'Viagens',
    // Entretenimento
    cinema: 'Entretenimento',
    series: 'Entretenimento',
    celebridades: 'Entretenimento',
    entretenimento: 'Entretenimento',
    tv: 'Entretenimento',
    séries: 'Entretenimento',
    streaming: 'Entretenimento',
    // Humor
    comedia: 'Humor',
    memes: 'Humor',
    comédia: 'Humor',
    'humor & comedia': 'Humor',
    'humor & comédia': 'Humor',
    'humor e comedia': 'Humor',
    'humor e comédia': 'Humor',
    humorismo: 'Humor',
    engracado: 'Humor',
    engraçado: 'Humor',
    // Música
    cantor: 'Música',
    banda: 'Música',
    dj: 'Música',
    musica: 'Música',
    cantora: 'Música',
    cover: 'Música',
    // Esportes
    futebol: 'Esportes',
    skate: 'Esportes',
    surf: 'Esportes',
    esporte: 'Esportes',
    basquete: 'Esportes',
    // Tecnologia
    programacao: 'Tecnologia',
    software: 'Tecnologia',
    gadgets: 'Tecnologia',
    tech: 'Tecnologia',
    tecnologia: 'Tecnologia',
    gadget: 'Tecnologia',
    programação: 'Tecnologia',
    ciencia: 'Tecnologia',
    ciência: 'Tecnologia',
    // Educação
    ensino: 'Educação',
    cursos: 'Educação',
    idiomas: 'Educação',
    educacao: 'Educação',
    estudos: 'Educação',
    curso: 'Educação',
    conhecimento: 'Educação',
    dicas: 'Educação',
    ingles: 'Educação',
    inglês: 'Educação',
    // Negócios
    empreendedorismo: 'Negócios',
    marketing: 'Negócios',
    vendas: 'Negócios',
    negocios: 'Negócios',
    ecommerce: 'Negócios',
    'e-commerce': 'Negócios',
    // Finanças
    investimentos: 'Finanças',
    crypto: 'Finanças',
    bolsa: 'Finanças',
    financas: 'Finanças',
    finanças: 'Finanças',
    investimento: 'Finanças',
    bitcoin: 'Finanças',
    cripto: 'Finanças',
    // Maternidade
    bebe: 'Maternidade',
    gravidez: 'Maternidade',
    maternidade: 'Maternidade',
    mae: 'Maternidade',
    mãe: 'Maternidade',
    maes: 'Maternidade',
    mães: 'Maternidade',
    gestante: 'Maternidade',
    infantil: 'Maternidade',
    // Pets
    cachorro: 'Pets',
    gatos: 'Pets',
    animais: 'Pets',
    adestramento: 'Pets',
    pet: 'Pets',
    caes: 'Pets',
    cães: 'Pets',
    cachorros: 'Pets',
    gato: 'Pets',
    // Casa
    decoracao: 'Casa',
    arquitetura: 'Casa',
    interiores: 'Casa',
    casa: 'Casa',
    decor: 'Casa',
    decoração: 'Casa',
    // Automotivo
    carros: 'Automotivo',
    motos: 'Automotivo',
    mecanica: 'Automotivo',
    mecânica: 'Automotivo',
    moto: 'Automotivo',
    automobilismo: 'Automotivo',
    // Religião
    cristianismo: 'Religião',
    fe: 'Religião',
    espiritualidade: 'Religião',
    religiao: 'Religião',
    religião: 'Religião',
    gospel: 'Religião',
    biblia: 'Religião',
    bíblia: 'Religião',
    // Games
    jogos: 'Games',
    gamer: 'Games',
    esports: 'Games',
    jogo: 'Games',
    gaming: 'Games',
    videogame: 'Games',
    videogames: 'Games',
    // Política
    politica: 'Política',
    política: 'Política',
    politico: 'Política',
    político: 'Política',
    eleicoes: 'Política',
    eleições: 'Política',
    governo: 'Política',
    // Lifestyle (subs amplas — main ainda pode ser Lifestyle)
    life: 'Lifestyle',
    'estilo de vida': 'Lifestyle',
    rotina: 'Lifestyle',
    vlog: 'Lifestyle',
};
function buildSubcategoryToMainMap(raw) {
    const m = new Map();
    for (const [k, v] of Object.entries(raw)) {
        if (!MAIN_CATEGORY_CANONICAL_LABELS.includes(v))
            continue;
        const token = normalizeSubcategoryToken(k);
        if (token.length < 2)
            continue;
        if (!m.has(token))
            m.set(token, v);
    }
    return m;
}
const SUBCATEGORY_FOLD_TO_MAIN = buildSubcategoryToMainMap(SUBCATEGORY_TO_MAIN_RAW);
/**
 * Variações comuns (ES/EN, compostos, grafias) → rótulo canônico da lista fechada.
 * Usado para snap do main vindo do LLM e para evidência em texto livre quando subs não batem no mapa V2.
 */
const RAW_ALIASES = {
    // Beleza
    belleza: 'Beleza',
    bellezas: 'Beleza',
    'beleza & maquiagem': 'Beleza',
    'beleza e maquiagem': 'Beleza',
    maquiagem: 'Beleza',
    makeup: 'Beleza',
    make: 'Beleza',
    skincare: 'Beleza',
    'skin care': 'Beleza',
    estetica: 'Beleza',
    estética: 'Beleza',
    cosmeticos: 'Beleza',
    cosméticos: 'Beleza',
    cabelo: 'Beleza',
    unhas: 'Beleza',
    perfumaria: 'Beleza',
    // Moda
    fashion: 'Moda',
    style: 'Moda',
    estilo: 'Moda',
    roupa: 'Moda',
    roupas: 'Moda',
    acessorios: 'Moda',
    acessórios: 'Moda',
    streetwear: 'Moda',
    // Fitness
    treino: 'Fitness',
    treinos: 'Fitness',
    musculacao: 'Fitness',
    musculação: 'Fitness',
    crossfit: 'Fitness',
    pilates: 'Fitness',
    yoga: 'Fitness',
    corrida: 'Fitness',
    academia: 'Fitness',
    nutricao: 'Fitness',
    nutrição: 'Fitness',
    'bem estar': 'Fitness',
    'bem-estar': 'Fitness',
    wellness: 'Fitness',
    // Saúde
    saude: 'Saúde',
    medicina: 'Saúde',
    saudemental: 'Saúde',
    'saúde mental': 'Saúde',
    psicologia: 'Saúde',
    terapia: 'Saúde',
    clinica: 'Saúde',
    clínica: 'Saúde',
    hospital: 'Saúde',
    farmacia: 'Saúde',
    farmácia: 'Saúde',
    // Alimentação
    gastronomia: 'Alimentação',
    culinaria: 'Alimentação',
    culinária: 'Alimentação',
    comida: 'Alimentação',
    receitas: 'Alimentação',
    receita: 'Alimentação',
    chef: 'Alimentação',
    cozinha: 'Alimentação',
    vegano: 'Alimentação',
    vegana: 'Alimentação',
    food: 'Alimentação',
    resturante: 'Alimentação',
    restaurante: 'Alimentação',
    // Viagens
    viagem: 'Viagens',
    turismo: 'Viagens',
    'viagens & turismo': 'Viagens',
    'viagens e turismo': 'Viagens',
    travel: 'Viagens',
    viajar: 'Viagens',
    // Entretenimento
    entretenimento: 'Entretenimento',
    tv: 'Entretenimento',
    cinema: 'Entretenimento',
    series: 'Entretenimento',
    séries: 'Entretenimento',
    streaming: 'Entretenimento',
    celebridades: 'Entretenimento',
    // Humor
    'humor & comedia': 'Humor',
    'humor & comédia': 'Humor',
    'humor e comedia': 'Humor',
    'humor e comédia': 'Humor',
    comedia: 'Humor',
    comédia: 'Humor',
    humorismo: 'Humor',
    memes: 'Humor',
    engracado: 'Humor',
    engraçado: 'Humor',
    // Música
    musica: 'Música',
    cantor: 'Música',
    cantora: 'Música',
    dj: 'Música',
    banda: 'Música',
    cover: 'Música',
    // Esportes
    esporte: 'Esportes',
    futebol: 'Esportes',
    basquete: 'Esportes',
    surf: 'Esportes',
    skate: 'Esportes',
    // Tecnologia
    tech: 'Tecnologia',
    tecnologia: 'Tecnologia',
    gadget: 'Tecnologia',
    gadgets: 'Tecnologia',
    software: 'Tecnologia',
    programacao: 'Tecnologia',
    programação: 'Tecnologia',
    ciencia: 'Tecnologia',
    ciência: 'Tecnologia',
    // Educação
    educacao: 'Educação',
    estudos: 'Educação',
    curso: 'Educação',
    cursos: 'Educação',
    conhecimento: 'Educação',
    dicas: 'Educação',
    ingles: 'Educação',
    inglês: 'Educação',
    // Negócios
    negocios: 'Negócios',
    empreendedorismo: 'Negócios',
    marketing: 'Negócios',
    vendas: 'Negócios',
    ecommerce: 'Negócios',
    'e-commerce': 'Negócios',
    // Finanças
    financas: 'Finanças',
    finanças: 'Finanças',
    investimentos: 'Finanças',
    investimento: 'Finanças',
    bitcoin: 'Finanças',
    crypto: 'Finanças',
    cripto: 'Finanças',
    bolsa: 'Finanças',
    // Maternidade
    mae: 'Maternidade',
    mãe: 'Maternidade',
    maes: 'Maternidade',
    mães: 'Maternidade',
    gestante: 'Maternidade',
    gravidez: 'Maternidade',
    bebe: 'Maternidade',
    bebê: 'Maternidade',
    infantil: 'Maternidade',
    // Lifestyle
    life: 'Lifestyle',
    'estilo de vida': 'Lifestyle',
    rotina: 'Lifestyle',
    vlog: 'Lifestyle',
    // Política
    politica: 'Política',
    politico: 'Política',
    político: 'Política',
    eleicoes: 'Política',
    eleições: 'Política',
    governo: 'Política',
    // Pets
    pet: 'Pets',
    caes: 'Pets',
    cães: 'Pets',
    cachorro: 'Pets',
    cachorros: 'Pets',
    gato: 'Pets',
    gatos: 'Pets',
    animais: 'Pets',
    // Games
    jogos: 'Games',
    jogo: 'Games',
    gamer: 'Games',
    gaming: 'Games',
    videogame: 'Games',
    videogames: 'Games',
    esports: 'Games',
    // Casa
    casa: 'Casa',
    decor: 'Casa',
    decoracao: 'Casa',
    decoração: 'Casa',
    arquitetura: 'Casa',
    interiores: 'Casa',
    // Automotivo
    carros: 'Automotivo',
    motos: 'Automotivo',
    moto: 'Automotivo',
    mecanica: 'Automotivo',
    mecânica: 'Automotivo',
    automobilismo: 'Automotivo',
    // Religião
    religiao: 'Religião',
    religião: 'Religião',
    cristianismo: 'Religião',
    gospel: 'Religião',
    espiritualidade: 'Religião',
    fe: 'Religião',
    biblia: 'Religião',
    bíblia: 'Religião',
};
const RAW_EVIDENCE_SIGNALS = {
    animal: 'Pets',
    animals: 'Pets',
    veterinario: 'Pets',
    veterinário: 'Pets',
    vet: 'Pets',
    cao: 'Pets',
    cão: 'Pets',
    filhote: 'Pets',
    adocao: 'Pets',
    adoção: 'Pets',
    petshop: 'Pets',
    adestramento: 'Pets',
    escola: 'Educação',
    professor: 'Educação',
    professora: 'Educação',
    aula: 'Educação',
    universidade: 'Educação',
    faculdade: 'Educação',
    enem: 'Educação',
    beleza: 'Beleza',
    beauty: 'Beleza',
};
function buildAliasMap() {
    const m = new Map();
    for (const [k, v] of Object.entries(RAW_ALIASES)) {
        const canon = v;
        if (!MAIN_CATEGORY_CANONICAL_LABELS.includes(canon))
            continue;
        m.set(foldMainCategoryKey(k), canon);
    }
    return m;
}
const ALIAS_FOLD_TO_CANONICAL = buildAliasMap();
const EVIDENCE_SIGNAL_TO_CATEGORY = (() => {
    const m = new Map(ALIAS_FOLD_TO_CANONICAL);
    for (const [k, v] of Object.entries(RAW_EVIDENCE_SIGNALS)) {
        const canon = v;
        if (!MAIN_CATEGORY_CANONICAL_LABELS.includes(canon))
            continue;
        m.set(foldMainCategoryKey(k), canon);
    }
    return m;
})();
const CANONICAL_BY_FOLD = new Map(MAIN_CATEGORY_CANONICAL_LABELS.map((c) => [foldMainCategoryKey(c), c]));
function tokenSetForReuse(s) {
    const out = new Set();
    for (const part of foldMainCategoryKey(s).split(/[&]+/)) {
        for (const w of part.split(/\s+/)) {
            const t = w.trim();
            if (t.length >= 2)
                out.add(t);
        }
    }
    return out;
}
function jaccardTokenSimilarity(a, b) {
    const ta = tokenSetForReuse(a);
    const tb = tokenSetForReuse(b);
    if (ta.size === 0 && tb.size === 0)
        return 1;
    if (ta.size === 0 || tb.size === 0)
        return 0;
    let inter = 0;
    for (const t of ta) {
        if (tb.has(t))
            inter += 1;
    }
    const union = ta.size + tb.size - inter;
    return union > 0 ? inter / union : 0;
}
function levenshtein(a, b) {
    if (a === b)
        return 0;
    const m = a.length;
    const n = b.length;
    if (m === 0)
        return n;
    if (n === 0)
        return m;
    const row = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
        let prev = row[0];
        row[0] = i;
        for (let j = 1; j <= n; j++) {
            const tmp = row[j];
            const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
            row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
            prev = tmp;
        }
    }
    return row[n];
}
function levenshteinRatio(a, b) {
    if (!a && !b)
        return 1;
    const d = levenshtein(a, b);
    return 1 - d / Math.max(a.length, b.length, 1);
}
function reuseMainCategoryLabel(candidate, pool, minScore) {
    const c = foldMainCategoryKey(candidate);
    if (!c || pool.length === 0)
        return null;
    let best = null;
    for (const label of pool) {
        if (!mainCategoryWithinWordBudget(label))
            continue;
        const p = foldMainCategoryKey(label);
        if (!p)
            continue;
        let score;
        if (c === p)
            score = 1;
        else {
            const jac = jaccardTokenSimilarity(candidate, label);
            const lev = levenshteinRatio(c, p);
            if (p.length >= 5 && c.length >= 5 && (c.includes(p) || p.includes(c))) {
                score = Math.max(jac, lev, (Math.min(c.length, p.length) / Math.max(c.length, p.length)) * 0.94);
            }
            else {
                score = Math.max(jac * 0.98, lev * 0.92);
            }
        }
        if (score > (best?.score ?? 0) ||
            (best != null && Math.abs(score - best.score) < 1e-6 && label.length < best.label.length)) {
            best = { label, score };
        }
    }
    if (best && best.score >= minScore)
        return best.label;
    return null;
}
/** Desempate quando duas categorias têm o mesmo score (nichos mais específicos antes de Lifestyle). */
const MAIN_CATEGORY_EVIDENCE_TIE_PRIORITY = [
    'Pets',
    'Maternidade',
    'Política',
    'Games',
    'Religião',
    'Humor',
    'Música',
    'Esportes',
    'Automotivo',
    'Viagens',
    'Entretenimento',
    'Alimentação',
    'Saúde',
    'Finanças',
    'Fitness',
    'Beleza',
    'Moda',
    'Tecnologia',
    'Educação',
    'Negócios',
    'Casa',
    'Lifestyle',
];
const MIN_FREE_TEXT_TOKEN_LEN = 3;
function tokenizeFreeTextForEvidenceSignals(text) {
    const s = stripInvisible(String(text ?? '').trim());
    if (!s)
        return [];
    let nfc;
    try {
        nfc = s.normalize('NFC');
    }
    catch {
        nfc = s;
    }
    return nfc
        .toLowerCase()
        .split(/[^a-zà-áâãéêíóôõúüç0-9]+/iu)
        .map((p) => foldMainCategoryKey(p))
        .filter((p) => p.length >= MIN_FREE_TEXT_TOKEN_LEN);
}
function bumpEvidenceScore(scores, cat, delta) {
    scores.set(cat, (scores.get(cat) ?? 0) + delta);
}
/** Pontuação só a partir do mapa fechado sub → main (V2). */
export function scoreSubCategoriesToMainCategories(subCategories) {
    const scores = new Map();
    for (const raw of subCategories) {
        const token = normalizeSubcategoryToken(String(raw ?? '').trim());
        if (token.length < 2)
            continue;
        const mapped = SUBCATEGORY_FOLD_TO_MAIN.get(token);
        if (mapped)
            bumpEvidenceScore(scores, mapped, 1);
    }
    return scores;
}
function maxEvidenceScore(scores) {
    let m = 0;
    for (const v of scores.values())
        m = Math.max(m, v);
    return m;
}
function pickCategoryAtMaxScoreWithTieBreak(scores, maxScore) {
    const winners = MAIN_CATEGORY_CANONICAL_LABELS.filter((c) => (scores.get(c) ?? 0) === maxScore);
    if (winners.length === 0)
        return MAIN_CATEGORY_FALLBACK;
    for (const c of MAIN_CATEGORY_EVIDENCE_TIE_PRIORITY) {
        if (winners.includes(c))
            return c;
    }
    return winners[0];
}
/**
 * Infere mainCategory a partir das subCategories usando apenas SUBCATEGORY_TO_MAIN.
 * Sem match → Lifestyle (fallback de vitrine).
 */
export function inferMainCategory(subCategories) {
    const scores = scoreSubCategoriesToMainCategories(subCategories);
    const maxScore = maxEvidenceScore(scores);
    if (maxScore === 0)
        return MAIN_CATEGORY_FALLBACK;
    return pickCategoryAtMaxScoreWithTieBreak(scores, maxScore);
}
/**
 * Se houver pelo menos uma sub mapeada e o main canônico divergir da inferência, corrige para a inferência.
 * Sem subs mapeadas: mantém o main já “snapped” para a taxonomia.
 */
export function validateMainCategoryAgainstSubCategories(main, subCategories) {
    const subScores = scoreSubCategoriesToMainCategories(subCategories);
    const maxSub = maxEvidenceScore(subScores);
    const snapped = snapMainCategoryToTaxonomy(main) ?? MAIN_CATEGORY_FALLBACK;
    if (maxSub === 0)
        return snapped;
    const inferred = pickCategoryAtMaxScoreWithTieBreak(subScores, maxSub);
    if (snapped !== inferred)
        return inferred;
    return snapped;
}
/**
 * Pontua cada categoria a partir de subCategories + texto (bio, nome, hashtags em linha única).
 * Cada token que bate em EVIDENCE_SIGNAL_TO_CATEGORY soma +1.
 */
export function scoreMainCategoriesFromEvidence(subCategories, freeText) {
    const scores = new Map();
    for (const raw of subCategories) {
        const fk = foldMainCategoryKey(String(raw ?? '').trim());
        if (fk.length < 2)
            continue;
        const cat = EVIDENCE_SIGNAL_TO_CATEGORY.get(fk);
        if (cat)
            bumpEvidenceScore(scores, cat, 1);
    }
    for (const tok of tokenizeFreeTextForEvidenceSignals(freeText)) {
        const cat = EVIDENCE_SIGNAL_TO_CATEGORY.get(tok);
        if (cat)
            bumpEvidenceScore(scores, cat, 1);
    }
    return scores;
}
/**
 * Ajusta mainCategory já canônico (ex.: snap do LLM) para alinhar com evidências.
 * 1) Se alguma sub bater em SUBCATEGORY_TO_MAIN, o vencedor por score + desempate manda (evita Pets → Beleza).
 * 2) Senão, mesma lógica anterior: subs + texto livre vs snap do LLM.
 */
export function resolveMainCategoryWithEvidence(snappedMainCanonical, subCategories, freeTextProfileContext) {
    const subMapScores = scoreSubCategoriesToMainCategories(subCategories);
    const subMapMax = maxEvidenceScore(subMapScores);
    if (subMapMax > 0) {
        return pickCategoryAtMaxScoreWithTieBreak(subMapScores, subMapMax);
    }
    const scores = scoreMainCategoriesFromEvidence(subCategories, freeTextProfileContext);
    const maxScore = maxEvidenceScore(scores);
    const snapped = MAIN_CATEGORY_CANONICAL_LABELS.includes(snappedMainCanonical)
        ? snappedMainCanonical
        : MAIN_CATEGORY_FALLBACK;
    if (maxScore === 0)
        return snapped;
    const snappedScore = scores.get(snapped) ?? 0;
    if (snappedScore >= maxScore)
        return snapped;
    return pickCategoryAtMaxScoreWithTieBreak(scores, maxScore);
}
/** Texto curto para o prompt: lista fechada com separador visual. */
export function formatMainCategoryTaxonomyForPrompt() {
    return MAIN_CATEGORY_CANONICAL_LABELS.join(' | ');
}
/**
 * Converte qualquer rótulo (novo ou legado) para um dos canônicos.
 * Usa aliases, igualdade dobrada e similaridade contra a lista fechada; fallback Lifestyle.
 */
export function snapMainCategoryToTaxonomy(raw) {
    const trimmed = stripInvisible(String(raw ?? '').trim());
    if (!trimmed)
        return null;
    let nfc;
    try {
        nfc = trimmed.normalize('NFC');
    }
    catch {
        nfc = trimmed;
    }
    if (nfc.length < 2 || nfc.length > 200)
        return null;
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(nfc))
        return null;
    const fk = foldMainCategoryKey(nfc);
    const fromAlias = ALIAS_FOLD_TO_CANONICAL.get(fk);
    if (fromAlias)
        return fromAlias;
    const exact = CANONICAL_BY_FOLD.get(fk);
    if (exact)
        return exact;
    const pool = [...MAIN_CATEGORY_CANONICAL_LABELS];
    const r1 = reuseMainCategoryLabel(nfc, pool, MAIN_CATEGORY_SNAP_SCORE_HIGH);
    if (r1)
        return r1;
    const r2 = reuseMainCategoryLabel(nfc, pool, MAIN_CATEGORY_SNAP_SCORE_LOW);
    if (r2)
        return r2;
    return MAIN_CATEGORY_FALLBACK;
}
/** True se o texto, após normalização de dobra, corresponde a um rótulo canônico. */
export function isCanonicalMainCategoryLabel(value) {
    return CANONICAL_BY_FOLD.has(foldMainCategoryKey(value));
}
