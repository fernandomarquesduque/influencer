/**
 * Ordem das seções na página de detalhe do influenciador.
 * Para alterar a ordem dos blocos, basta reordenar este array.
 */
export const DETAIL_SECTION_ORDER = [
  'engajamentoPorTipo', // ER por Feed, Reel, Marcado
  'diagnostico',      // Score 3 eixos, Patamar, O que está bom/melhorar
  'valorEpublico',    // Valor estimado (Feed, Reels, Story, Destaque) — acima de Análise de Feed
  'conteudoPerforma', // Posts (Análise de Feed), Reels, Marcados
] as const

export type DetailSectionId = typeof DETAIL_SECTION_ORDER[number]
