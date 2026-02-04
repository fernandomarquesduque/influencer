/**
 * Mapeamento de hashtags/palavras para categorias para qualificar o influenciador.
 * Usado tanto nas hashtags quanto no texto das legendas dos posts.
 */
const HASHTAG_TO_CATEGORY: Record<string, string> = {
  barbearia: 'Beleza',
  barbershop: 'Beleza',
  barba: 'Beleza',
  cabelo: 'Beleza',
  haircut: 'Beleza',
  hairstyle: 'Beleza',
  maquiagem: 'Beleza',
  makeup: 'Beleza',
  unhas: 'Beleza',
  nails: 'Beleza',
  skincare: 'Beleza',
  estetica: 'Beleza',
  sobrancelha: 'Beleza',
  manicure: 'Beleza',
  pedicure: 'Beleza',
  fitness: 'Fitness',
  academia: 'Fitness',
  gym: 'Fitness',
  treino: 'Fitness',
  workout: 'Fitness',
  musculacao: 'Fitness',
  crossfit: 'Fitness',
  corrida: 'Fitness',
  running: 'Fitness',
  yoga: 'Fitness',
  pilates: 'Fitness',
  ciclismo: 'Fitness',
  bike: 'Fitness',
  natacao: 'Fitness',
  hiit: 'Fitness',
  saudavel: 'Fitness',
  healthy: 'Fitness',
  moda: 'Moda',
  fashion: 'Moda',
  style: 'Moda',
  outfit: 'Moda',
  look: 'Moda',
  streetwear: 'Moda',
  lifestyle: 'Moda',
  viagem: 'Viagem',
  travel: 'Viagem',
  viajando: 'Viagem',
  turismo: 'Viagem',
  trip: 'Viagem',
  praia: 'Viagem',
  beach: 'Viagem',
  hotel: 'Viagem',
  trilha: 'Viagem',
  hiking: 'Viagem',
  natureza: 'Viagem',
  nature: 'Viagem',
  comida: 'Gastronomia',
  food: 'Gastronomia',
  foodie: 'Gastronomia',
  receita: 'Gastronomia',
  recipe: 'Gastronomia',
  culinaria: 'Gastronomia',
  restaurante: 'Gastronomia',
  cafe: 'Gastronomia',
  coffee: 'Gastronomia',
  cerveja: 'Gastronomia',
  beer: 'Gastronomia',
  vinho: 'Gastronomia',
  wine: 'Gastronomia',
  hamburguer: 'Gastronomia',
  burger: 'Gastronomia',
  pizza: 'Gastronomia',
  doces: 'Gastronomia',
  tech: 'Tecnologia',
  tecnologia: 'Tecnologia',
  programacao: 'Tecnologia',
  coding: 'Tecnologia',
  dev: 'Tecnologia',
  games: 'Games',
  gaming: 'Games',
  gamer: 'Games',
  carro: 'Automóveis',
  carros: 'Automóveis',
  car: 'Automóveis',
  moto: 'Automóveis',
  maternidade: 'Maternidade',
  mae: 'Maternidade',
  mom: 'Maternidade',
  familia: 'Família',
  family: 'Família',
  bebe: 'Maternidade',
  baby: 'Maternidade',
  gravidez: 'Maternidade',
  pet: 'Pets',
  pets: 'Pets',
  cachorro: 'Pets',
  dog: 'Pets',
  gato: 'Pets',
  cat: 'Pets',
  decoracao: 'Decoração',
  decor: 'Decoração',
  casa: 'Decoração',
  home: 'Decoração',
  diy: 'Decoração',
  empreendedorismo: 'Negócios',
  negocios: 'Negócios',
  business: 'Negócios',
  marketing: 'Negócios',
  musica: 'Música',
  music: 'Música',
  arte: 'Arte',
  fotografia: 'Fotografia',
  photography: 'Fotografia',
  futebol: 'Esportes',
  football: 'Esportes',
  basquete: 'Esportes',
  skate: 'Esportes',
  surf: 'Esportes',
  jiujitsu: 'Esportes',
  mma: 'Esportes',
};

const MAX_INFERRED_CATEGORIES = 5;

const STOPWORDS = new Set(
  'de da do das dos em no na nos nas e o a os as um uma que com para por mais como mas ou se nao ao eu me te le la'.split(
    ' '
  )
);

function normalizeToken(word: string): string {
  return word.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
}

function tokensFromCaption(text: string): string[] {
  const normalized = text.normalize('NFD').replace(/\p{M}/gu, '');
  const words = normalized.toLowerCase().split(/\W+/).filter((w) => w.length >= 2);
  return words.filter((w) => !STOPWORDS.has(w));
}

/**
 * Infere categorias a partir das hashtags e do texto das legendas dos posts.
 */
export function inferCategoriesFromHashtags(
  hashtags: string[],
  captionTexts: string[] = []
): string[] {
  const countByCategory = new Map<string, number>();

  for (const tag of hashtags) {
    const normalized = normalizeToken(tag);
    const category = HASHTAG_TO_CATEGORY[normalized];
    if (category) {
      countByCategory.set(category, (countByCategory.get(category) ?? 0) + 1);
    }
  }

  for (const caption of captionTexts) {
    if (!caption || caption.length < 3) continue;
    for (const word of tokensFromCaption(caption)) {
      const normalized = normalizeToken(word);
      const category = HASHTAG_TO_CATEGORY[normalized];
      if (category) {
        countByCategory.set(category, (countByCategory.get(category) ?? 0) + 1);
      }
    }
  }

  if (countByCategory.size === 0) return [];

  return [...countByCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cat]) => cat)
    .slice(0, MAX_INFERRED_CATEGORIES);
}
