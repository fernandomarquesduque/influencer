/**
 * Ordem das seções na página de detalhe do influenciador.
 * Para alterar a ordem dos blocos, basta reordenar este array.
 */
export const DETAIL_SECTION_ORDER = [
  'engajamentoPorTipo', // ER por Feed, Reel, Marcado
  'alcance',            // % posts por formato (Reels, Carrossel, Foto)
  'diagnostico',        // Score 3 eixos, Patamar, O que está bom/melhorar
  'metricasMediakit',   // Métricas (blur como preços) — logo acima de valorEpublico
  'valorEpublico',      // Valor estimado (Feed, Reels, Story, Destaque) — preços
  'conteudoPerforma',   // Posts (Análise de Feed), Reels, Marcados
] as const

export type DetailSectionId = typeof DETAIL_SECTION_ORDER[number]
