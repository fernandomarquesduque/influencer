/**
 * Textos de tooltip que explicam o cálculo de cada métrica do relatório.
 */
export const METRIC_TOOLTIPS = {
  seguidores:
    'Número de seguidores do perfil no Instagram (dado oficial da API).',

  er: 'Taxa de engajamento (ER): (média de interações por post ÷ seguidores) × 100. Interações = curtidas + comentários. Reflete quanto do seu público reage em média a cada post.',

  postsPerSemana:
    'Média de posts por semana: total de posts no período analisado ÷ número de semanas entre o primeiro e o último post (mínimo 1 semana).',

  score:
    'Score 0–100: média ponderada de 5 pilares — Comunidade (25%): proporção de comentários nas interações; Consistência (20%): cadência de posts/semana; Alcance (25%): views ou ER como proxy; Autoridade (15%): verificado, bio, link, tipo de conta; Conteúdo (15%): % de posts acima de um mínimo de performance.',

  topPercentil:
    'Percentil de engajamento na sua faixa de alcance (Nano/Micro/Mid/Macro). Seu ER é comparado com as faixas de referência da faixa e convertido em um percentil (0–90). Top 90% = engajamento no topo da faixa.',

  selo:
    'Selo do perfil: "Comunidade Forte" (score ≥75), "Alta Consistência" (≥60), "Potencial Alto" (≥45), "Audiência Envolvida" (≥15% comentários) ou "Em crescimento".',

  conversacao:
    'Seu público conversa?: percentual de comentários em relação ao total de interações (curtidas + comentários). ≥12% = Comunidade conversadora; ≥6% = Médio; &lt;6% = Público passivo.',

  valorEstimado:
    'Valor estimado por post: base = (seguidores ÷ 1000) × (ER ÷ 2), com ajustes por alcance (views), perfil verificado (+20%), conta profissional (+10%) e audiência que comenta (+15%). Faixa final: base × 0,7 a base × 1,5 (mín. R$ 50).',

  postsPorSemanaUltimas8:
    'Quantidade de posts publicados em cada uma das últimas 8 semanas, contados pela data de publicação do post.',

  melhorDiaHora:
    'Dia da semana e hora (0–23h) em que mais posts foram publicados nas últimas 8 semanas.',

  interacoesPost:
    'Interações do post = curtidas + comentários.',

  erPost:
    'ER do post: (interações do post ÷ seguidores) × 100. Mostra o engajamento daquele post em relação ao seu alcance.',

  hashtagsMaisUsadas:
    'Número de vezes que cada hashtag apareceu nos últimos 25 posts analisados.',

  hashtagsPerformam:
    'ER médio dos posts em que a hashtag aparece. Mostra quais hashtags estão associadas a posts com maior engajamento.',

  totalCurtidas:
    'Soma de todas as curtidas dos posts analisados (até os últimos 100 posts).',

  totalComentarios:
    'Soma de todos os comentários dos posts analisados (até os últimos 100 posts).',

  mediaLikesPost:
    'Média de curtidas por post: total de curtidas ÷ número de posts analisados.',

  totalPosts:
    'Quantidade total de posts considerados na análise (período dos posts carregados).',
} as const

export type MetricTooltipKey = keyof typeof METRIC_TOOLTIPS
