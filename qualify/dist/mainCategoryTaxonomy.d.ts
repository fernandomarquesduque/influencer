/**
 * Taxonomia fechada de mainCategory (macro, uma palavra) + subCategories → main (V2).
 * Prioridade: subCategories (mapa fechado) → bio/contexto (aliases + sinais) → snap do LLM.
 * Duplicado em crawl/src/lib/mainCategoryTaxonomy.ts — altere nos dois arquivos.
 */
export declare const MAIN_CATEGORY_CANONICAL_LABELS: readonly ["Beleza", "Moda", "Fitness", "Saúde", "Alimentação", "Viagens", "Entretenimento", "Humor", "Música", "Esportes", "Tecnologia", "Educação", "Negócios", "Finanças", "Maternidade", "Lifestyle", "Política", "Pets", "Games", "Casa", "Automotivo", "Religião"];
export type MainCategoryCanonical = (typeof MAIN_CATEGORY_CANONICAL_LABELS)[number];
/** Mesma ideia do qualify: comparar rótulos “dobrados” (acento/minúsculas). */
export declare function foldMainCategoryKey(s: string): string;
/** Normaliza token de subCategory para lookup no mapa fechado (underscore → espaço, depois fold). */
export declare function normalizeSubcategoryToken(s: string): string;
/** Pontuação só a partir do mapa fechado sub → main (V2). */
export declare function scoreSubCategoriesToMainCategories(subCategories: string[]): Map<MainCategoryCanonical, number>;
/**
 * Infere mainCategory a partir das subCategories usando apenas SUBCATEGORY_TO_MAIN.
 * Sem match → Lifestyle (fallback de vitrine).
 */
export declare function inferMainCategory(subCategories: string[]): MainCategoryCanonical;
/**
 * Se houver pelo menos uma sub mapeada e o main canônico divergir da inferência, corrige para a inferência.
 * Sem subs mapeadas: mantém o main já “snapped” para a taxonomia.
 */
export declare function validateMainCategoryAgainstSubCategories(main: string, subCategories: string[]): MainCategoryCanonical;
/**
 * Pontua cada categoria a partir de subCategories + texto (bio, nome, hashtags em linha única).
 * Cada token que bate em EVIDENCE_SIGNAL_TO_CATEGORY soma +1.
 */
export declare function scoreMainCategoriesFromEvidence(subCategories: string[], freeText: string): Map<MainCategoryCanonical, number>;
/**
 * Ajusta mainCategory já canônico (ex.: snap do LLM) para alinhar com evidências.
 * 1) Se alguma sub bater em SUBCATEGORY_TO_MAIN, o vencedor por score + desempate manda (evita Pets → Beleza).
 * 2) Senão, mesma lógica anterior: subs + texto livre vs snap do LLM.
 */
export declare function resolveMainCategoryWithEvidence(snappedMainCanonical: string, subCategories: string[], freeTextProfileContext: string): MainCategoryCanonical;
/** Texto curto para o prompt: lista fechada com separador visual. */
export declare function formatMainCategoryTaxonomyForPrompt(): string;
/**
 * Converte qualquer rótulo (novo ou legado) para um dos canônicos.
 * Usa aliases, igualdade dobrada e similaridade contra a lista fechada; fallback Lifestyle.
 */
export declare function snapMainCategoryToTaxonomy(raw: string): MainCategoryCanonical | null;
/** True se o texto, após normalização de dobra, corresponde a um rótulo canônico. */
export declare function isCanonicalMainCategoryLabel(value: string): boolean;
