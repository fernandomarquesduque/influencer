/**
 * Textos de tooltip que explicam cada métrica do relatório — linguagem clara e direta.
 */
export const METRIC_TOOLTIPS = {
  seguidores:
    'Quantos seguidores o perfil tem no Instagram (dado que vem direto da rede).',

  er: 'Taxa de engajamento: curtidas + comentários divididos pelos seguidores, em porcentagem. Mostra quanto a audiência reage de verdade nos posts.',

  postsPerSemana:
    'Quantos posts em média saem por semana: conta-se tudo que foi postado e divide pelas semanas do período. Indica se o perfil é consistente ou sumido.',

  score:
    'Nota geral do perfil (0 a 100). Considera: interação da audiência (comunidade), frequência de posts (consistência), alcance, confiança que o perfil passa (autoridade) e qualidade do conteúdo. Quanto maior a nota, mais o perfil está pronto para marcas e parcerias.',

  topPercentil:
    'O perfil está no topo da faixa. Compara-se o engajamento com outros perfis do mesmo tamanho (Nano, Micro, Mid, Macro). Top 90% = o perfil engaja mais que a maioria.',

  selo:
    'Conquistas do perfil: "Comunidade Forte" (nota alta e muita conversa), "Alta Consistência" (postando direto), "Potencial Alto", "Audiência Envolvida" (muita gente comentando) ou "Em crescimento".',

  conversacao:
    'A audiência comenta ou só curte? Mostra a fatia de comentários no total de interações. Quanto mais comentários, mais a audiência participa de verdade.',

  valorEstimado:
    'Quanto o mercado costuma pagar por um post no feed. A base leva em conta seguidores e engajamento; entram bônus (perfil verificado, conta pro, audiência que comenta) e o alcance. A faixa é uma estimativa de referência.',

  valorEstimadoDestaque:
    'Destaque (Highlights) é o catálogo fixo no perfil por 30 dias. O valor sugerido é um adicional de 10% a 25% sobre o Reels contratado, conforme negociação.',

  postsPorSemanaUltimas8:
    'Quantos posts saíram em cada uma das últimas 8 semanas. Indica se o perfil está postando de verdade ou sumido.',

  melhorDiaHora:
    'Dia e horário em que mais posts foram publicados nas últimas 8 semanas. Dá para saber quando o perfil costuma estar no ar.',

  interacoesPost:
    'Tudo que o post recebeu: curtidas + comentários. Quanto mais, mais a galera interagiu.',

  erPost:
    'Engajamento daquele post: curtidas e comentários em % dos seguidores. Mostra se aquele post bombou ou passou batido.',

  hashtagsMaisUsadas:
    'Quantas vezes cada hashtag apareceu nos posts. Dá para ver o que a pessoa mais usa.',

  hashtagsPerformam:
    'Engajamento médio dos posts em que a hashtag aparece. Indica quais hashtags estão ligadas a posts que performam melhor.',

  totalCurtidas:
    'Soma de todas as curtidas nos posts analisados (até os últimos 100).',

  totalComentarios:
    'Soma de todos os comentários nos posts analisados (até os últimos 100).',

  mediaLikesPost:
    'Média de curtidas por post: total de curtidas dividido pelo número de posts. Dá uma noção do que o perfil costuma fazer.',

  totalPosts:
    'Quantos posts entraram na análise (período considerado).',

  engajamentoPorTipo:
    'Engajamento separado por tipo: posts do feed, reels e quando o perfil foi marcado. Mostra qual tipo de conteúdo mais engaja.',

  evolucaoPorSemana:
    'Engajamento e total de interações por semana nas últimas 8. Barras mais altas = semana em que o perfil mandou bem.',

  erPorViews:
    'Engajamento considerando as views (quem viu). Importante em reels e vídeos, onde muita gente vê sem ser seguidor.',

  totalViewsMarcados:
    'Soma de todas as visualizações nos posts em que o perfil foi marcado.',

  viralizacaoReel:
    'Views do último reel dividido pelos seguidores. Mostra se o vídeo estourou além da base de seguidores.',

  totalViewsReels:
    'Visualizações apenas em reels/vídeos. Curtidas e comentários são de todos os posts (feed + reels); por isso curtidas podem ser maiores que views.',

  mediaViewsReel:
    'Média de views por reel. Dá para ver se os vídeos costumam performar.',

  erPorSeguidoresEViews:
    'Engajamento em duas formas: em relação aos seguidores e em relação a quem viu (views). Em reels, as views costumam ser bem maiores.',

  somaItensDestaques:
    'Soma de todos os itens (stories) que estão em todos os destaques do perfil.',

  mediaItensDestaque:
    'Média de itens por destaque. Mostra se os destaques são curtos ou bem recheados.',
} as const

export type MetricTooltipKey = keyof typeof METRIC_TOOLTIPS
