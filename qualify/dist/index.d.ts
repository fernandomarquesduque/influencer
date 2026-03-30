import 'dotenv/config';
/**
 * Valores literais permitidos para qualification.mainCategory (ordem fixa para prompts e validacao).
 * O LLM deve retornar EXATAMENTE uma destas strings — sem sinonimos, abreviacoes ou ingles.
 */
export declare const MAIN_CATEGORY_OPTIONS: readonly ["Gastronomia & Culinária", "Moda & Estilo", "Beleza & Maquiagem", "Decoração & Home Office", "Viagens & Turismo", "Lifestyle & Vlogs", "Maternidade & Paternidade", "Pets & Animais", "Saúde & Bem-estar", "Fitness & Esportes", "Finanças & Investimentos", "Negócios & Carreira", "Tecnologia & Inovação", "Educação & Idiomas", "Desenvolvimento Pessoal", "Games & E-sports", "Humor & Comédia", "Cultura Pop & Cinema", "Música & Dança", "Arte & Design", "Automobilismo & Motores", "Sustentabilidade & Ecologia"];
export type MainCategory = (typeof MAIN_CATEGORY_OPTIONS)[number];
export declare function isMainCategoryValue(value: string): value is MainCategory;
/** Aceita apenas string identica a uma opcao canonica (apos trim e invisiveis); NFC para estabilidade Unicode. */
export declare function parseMainCategory(raw: unknown): MainCategory | null;
