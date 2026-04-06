import 'dotenv/config';
export type MainCategory = string;
export declare function isMainCategoryValue(value: string): boolean;
/**
 * Normaliza mainCategory: rótulo em pt-BR (comprimento limitado), Unicode NFC.
 * O texto vem do LLM; o servidor encaixa depois na taxonomia fechada (`snapMainCategoryToTaxonomy`).
 */
export declare function parseMainCategory(raw: unknown): MainCategory | null;
export { formatMainCategoryTaxonomyForPrompt, MAIN_CATEGORY_CANONICAL_LABELS, resolveMainCategoryWithEvidence, scoreMainCategoriesFromEvidence, snapMainCategoryToTaxonomy, } from './mainCategoryTaxonomy.js';
