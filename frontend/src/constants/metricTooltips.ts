/**
 * Textos de tooltip que explicam cada métrica do relatório — linguagem clara e direta.
 */
export const METRIC_TOOLTIPS = {
  seguidores:
    'Quantos seguidores o perfil tem no Instagram (dado que vem direto da rede).',

  er: 'Taxa de engajamento: a gente pega curtidas + comentários, divide pelos seguidores e vira porcentagem. Mostra quanto sua galera reage de verdade nos posts.',

  postsPerSemana:
    'Quantos posts em média saem por semana: a gente conta tudo que foi postado e divide pelas semanas do período. Assim você vê se o perfil é consistente ou sumido.',

  score:
    'É a nota geral do perfil (0 a 100). A gente junta: quanto sua audiência interage (comunidade), se você posta com frequência (consistência), alcance dos posts, se o perfil passa confiança (autoridade) e qualidade do conteúdo. Quanto maior a nota, mais seu perfil está pronto para marcas e parcerias.',

  topPercentil:
    'Você está no topo da sua faixa. A gente compara seu engajamento com outros perfis do mesmo tamanho (Nano, Micro, Mid, Macro). Top 90% = você engaja mais que a maioria da galera.',

  selo:
    'Conquistas do perfil: "Comunidade Forte" (nota alta e muita conversa), "Alta Consistência" (postando direto), "Potencial Alto", "Audiência Envolvida" (muita gente comentando) ou "Em crescimento".',

  conversacao:
    'Sua audiência comenta ou só curte? A gente vê a fatia de comentários no total de interações. Quanto mais comentários, mais sua galera participa de verdade.',

  valorEstimado:
    'Quanto o mercado costuma pagar por um post no feed. A base leva em conta seguidores e engajamento; aí entram bônus (perfil verificado, conta pro, audiência que comenta) e o alcance. A faixa é uma estimativa para você ter uma ideia.',

  valorEstimadoDestaque:
    'Destaque (Highlights) não é formato principal: é aquele catálogo fixo no perfil. O mercado usa como bônus (tipo +10% a +25% do story por 30 dias) ou inclui no pacote. Quem vê é quem já entra no perfil. Em nichos tipo restaurante e clínica pode valer um pouco mais.',

  postsPorSemanaUltimas8:
    'Quantos posts saíram em cada uma das últimas 8 semanas. Assim você vê se a pessoa está postando de verdade ou sumida.',

  melhorDiaHora:
    'Dia e horário em que mais posts foram publicados nas últimas 8 semanas. Dá para saber quando o perfil costuma estar no ar.',

  interacoesPost:
    'Tudo que o post recebeu: curtidas + comentários. Quanto mais, mais a galera interagiu.',

  erPost:
    'Engajamento daquele post: curtidas e comentários em % dos seguidores. Mostra se aquele post bombou ou passou batido.',

  hashtagsMaisUsadas:
    'Quantas vezes cada hashtag apareceu nos posts. Dá para ver o que a pessoa mais usa.',

  hashtagsPerformam:
    'Engajamento médio dos posts em que a hashtag aparece. Assim você vê quais hashtags estão ligadas a posts que bombam.',

  totalCurtidas:
    'Soma de todas as curtidas nos posts que a gente analisou (até os últimos 100).',

  totalComentarios:
    'Soma de todos os comentários nos posts analisados (até os últimos 100).',

  mediaLikesPost:
    'Média de curtidas por post: total de curtidas dividido pelo número de posts. Dá uma noção do que o perfil costuma fazer.',

  totalPosts:
    'Quantos posts entraram na análise (o período que a gente considerou).',

  engajamentoPorTipo:
    'Engajamento separado por tipo: posts do feed, reels e quando o perfil foi marcado. Assim você vê qual tipo de conteúdo mais engaja.',

  evolucaoPorSemana:
    'Engajamento e total de interações por semana nas últimas 8. Barras mais altas = semana em que o perfil mandou bem.',

  erPorViews:
    'Engajamento considerando as views (quem viu). Importante em reels e vídeos, onde muita gente vê sem ser seguidor.',

  totalViewsMarcados:
    'Soma de todas as visualizações nos posts em que o perfil foi marcado.',

  viralizacaoReel:
    'Views do último reel dividido pelos seguidores. Mostra se o vídeo estourou além da sua base.',

  totalViewsReels:
    'Soma de todas as visualizações nos reels analisados.',

  mediaViewsReel:
    'Média de views por reel. Dá para ver se os vídeos costumam performar.',

  erPorSeguidoresEViews:
    'Aqui a gente mostra o engajamento de duas formas: em relação aos seguidores e em relação a quem viu (views). Em reels, as views costumam ser bem maiores.',

  somaItensDestaques:
    'Soma de todos os itens (stories) que estão em todos os destaques do perfil.',

  mediaItensDestaque:
    'Média de itens por destaque. Mostra se os destaques são curtos ou bem recheados.',
} as const

export type MetricTooltipKey = keyof typeof METRIC_TOOLTIPS
