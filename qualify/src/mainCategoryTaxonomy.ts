/**
 * Taxonomia fechada de mainCategory (macro, uma palavra) + subCategories → main (V2).
 * Prioridade: subCategories (mapa fechado) → bio/contexto (aliases + sinais) → snap do LLM.
 * Duplicado em backend/src/lib/mainCategoryTaxonomy.ts — altere nos dois arquivos.
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
] as const;

export type MainCategoryCanonical = (typeof MAIN_CATEGORY_CANONICAL_LABELS)[number];

const MAIN_CATEGORY_SNAP_SCORE_HIGH = 0.74;
const MAIN_CATEGORY_SNAP_SCORE_LOW = 0.58;
/** Último recurso quando o texto não encaixa em nenhuma faceta (evita perfil “sem categoria”). */
const MAIN_CATEGORY_FALLBACK: MainCategoryCanonical = 'Lifestyle';

function stripCombiningMarks(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '');
}

function stripInvisible(s: string): string {
  return s.replace(/[\u200B-\u200D\uFEFF]/g, '');
}

/** Mesma ideia do qualify: comparar rótulos “dobrados” (acento/minúsculas). */
export function foldMainCategoryKey(s: string): string {
  return stripCombiningMarks(stripInvisible(s).trim().toLowerCase())
    .replace(/\s+/g, ' ')
    .replace(/\s*&\s*/g, ' & ');
}

/** Normaliza token de subCategory para lookup no mapa fechado (underscore → espaço, depois fold). */
export function normalizeSubcategoryToken(s: string): string {
  return foldMainCategoryKey(String(s ?? '').trim().replace(/_/g, ' '));
}

const MIN_SUBCATEGORY_TOKEN_LEN = 2;

/**
 * Quebra rótulos em linguagem natural ("direito trabalhista", "advogado_familia") em tokens
 * que existem no mapa (cada palavra pontua separadamente).
 */
export function expandSubcategoryTokensForLookup(raw: string): string[] {
  const t = stripInvisible(String(raw ?? '').trim()).replace(/_/g, ' ');
  if (!t) return [];
  let nfc: string;
  try {
    nfc = t.normalize('NFC').toLowerCase();
  } catch {
    nfc = t.toLowerCase();
  }
  const parts = nfc
    .split(/[^a-zà-áâãéêíóôõúüç0-9]+/iu)
    .map((p) => foldMainCategoryKey(p))
    .filter((p) => p.length >= MIN_SUBCATEGORY_TOKEN_LEN);
  const whole = normalizeSubcategoryToken(t);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of [whole, ...parts]) {
    if (!p || p.length < MIN_SUBCATEGORY_TOKEN_LEN) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

/**
 * Sinais lexicalmente ambíguos: contam fração do peso para ceder a tokens específicos
 * no mesmo sub/texto (ex.: natureza + fotografia; familia + amamentação).
 */
const AMBIGUOUS_SUBCATEGORY_SIGNAL_WEIGHT = 0.25;
const AMBIGUOUS_SUBCATEGORY_SIGNAL_FOLDS = new Set<string>(
  [
    'natureza',
    'bar',
    'arte',
    'artes',
    'familia',
    'família',
    'produtor',
    'produtora',
  ].map((k) => foldMainCategoryKey(k))
);

function weightForSubcategoryTokenMatch(foldToken: string): number {
  return AMBIGUOUS_SUBCATEGORY_SIGNAL_FOLDS.has(foldToken) ? AMBIGUOUS_SUBCATEGORY_SIGNAL_WEIGHT : 1;
}

function countMainCategoryWords(label: string): number {
  const t = stripInvisible(label).trim();
  if (!t) return 0;
  return t
    .split(/\s*[&]\s*|\s+/u)
    .map((x) => x.trim())
    .filter((x) => x.length > 0).length;
}

function mainCategoryWithinWordBudget(label: string): boolean {
  const n = countMainCategoryWords(label);
  return n >= 1 && n <= 1;
}

/**
 * SubCategories controladas → mainCategory. Cada chave: uma palavra ou snake_case;
 * valores devem existir em MAIN_CATEGORY_CANONICAL_LABELS.
 */
const SUBCATEGORY_TO_MAIN_RAW: Record<string, MainCategoryCanonical> = {
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
  manicure: 'Beleza',
  pedicure: 'Beleza',
  sobrancelha: 'Beleza',
  lash: 'Beleza',
  lashes: 'Beleza',
  brow: 'Beleza',
  brows: 'Beleza',
  hidratacao: 'Beleza',
  hidratação: 'Beleza',
  antiaging: 'Beleza',
  barbearia: 'Beleza',
  barber: 'Beleza',
  fragrance: 'Beleza',
  dermatologia: 'Beleza',
  micropigmentacao: 'Beleza',
  micropigmentação: 'Beleza',

  // Moda
  roupas: 'Moda',
  estilo: 'Moda',
  fashion: 'Moda',
  streetwear: 'Moda',
  roupa: 'Moda',
  cores: 'Moda',
  outfit: 'Moda',
  outfits: 'Moda',
  look: 'Moda',
  looks: 'Moda',
  acessorios: 'Moda',
  acessórios: 'Moda',
  style: 'Moda',
  sneakers: 'Moda',
  tenis: 'Moda',
  tênis: 'Moda',
  calcados: 'Moda',
  calçados: 'Moda',
  lingerie: 'Moda',
  modinha: 'Moda',
  luxo: 'Moda',
  vintage: 'Moda',
  outlet: 'Moda',
  thrift: 'Moda',
  moda: 'Moda',
  fashionista: 'Moda',
  stylist: 'Moda',
  personal_style: 'Moda',
  armario: 'Moda',
  armário: 'Moda',

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
  funcional: 'Fitness',
  bodybuilding: 'Fitness',
  spinning: 'Fitness',
  hiit: 'Fitness',
  natacao: 'Fitness',
  natação: 'Fitness',
  jiujitsu: 'Fitness',
  jiu_jitsu: 'Fitness',
  muaythai: 'Fitness',
  muay_thai: 'Fitness',
  boxe: 'Fitness',
  mma: 'Fitness',
  kettlebell: 'Fitness',
  calistenia: 'Fitness',
  alongamento: 'Fitness',
  mobility: 'Fitness',
  personal: 'Fitness',
  personal_trainer: 'Fitness',

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
  dentista: 'Saúde',
  odonto: 'Saúde',
  odontologia: 'Saúde',
  fisioterapia: 'Saúde',
  fisioterapeuta: 'Saúde',
  nutricionista: 'Saúde',
  cardiologia: 'Saúde',
  dermatologista: 'Saúde',
  enfermagem: 'Saúde',
  farmaceutico: 'Saúde',
  farmacêutico: 'Saúde',
  psiquiatria: 'Saúde',
  oftalmologia: 'Saúde',
  ortopedia: 'Saúde',
  pediatria: 'Saúde',
  endocrino: 'Saúde',
  endocrinologia: 'Saúde',
  saude_bucal: 'Saúde',
  'saúde bucal': 'Saúde',
  doenca: 'Saúde',
  doença: 'Saúde',
  doencas_raras: 'Saúde',
  doenças_raras: 'Saúde',
  tratamento: 'Saúde',
  curativo: 'Saúde',
  hospitalar: 'Saúde',
  campanha_solidaria: 'Saúde',
  doacao: 'Saúde',
  doação: 'Saúde',
  epidermolise: 'Saúde',
  epidermólise: 'Saúde',
  medico: 'Saúde',
  médico: 'Saúde',
  medica: 'Saúde',
  médica: 'Saúde',
  psicologo: 'Saúde',
  psicólogo: 'Saúde',
  psicologa: 'Saúde',
  psicóloga: 'Saúde',
  terapeuta: 'Saúde',
  clinico: 'Saúde',
  clínico: 'Saúde',

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
  confeitaria: 'Alimentação',
  doces: 'Alimentação',
  sobremesa: 'Alimentação',
  chocolate: 'Alimentação',
  churrasco: 'Alimentação',
  churrasqueiro: 'Alimentação',
  padaria: 'Alimentação',
  lowcarb: 'Alimentação',
  keto: 'Alimentação',
  vegetariano: 'Alimentação',
  vegetariana: 'Alimentação',
  barman: 'Alimentação',
  mixologia: 'Alimentação',
  sommelier: 'Alimentação',
  cafe: 'Alimentação',
  café: 'Alimentação',
  cafeteria: 'Alimentação',
  coffee: 'Alimentação',
  torrefacao: 'Alimentação',
  torrefação: 'Alimentação',
  espresso: 'Alimentação',
  lanchonete: 'Alimentação',
  pizzaria: 'Alimentação',
  hamburgueria: 'Alimentação',
  churrascaria: 'Alimentação',
  doceria: 'Alimentação',
  comida_japonesa: 'Alimentação',
  sushi: 'Alimentação',
  temaki: 'Alimentação',
  poke: 'Alimentação',
  acai: 'Alimentação',
  açaí: 'Alimentação',
  brunch: 'Alimentação',
  foodtruck: 'Alimentação',
  food_truck: 'Alimentação',
  bolo: 'Alimentação',
  bolos: 'Alimentação',
  confeiteira: 'Alimentação',
  confeiteiro: 'Alimentação',
  cozinheiro: 'Alimentação',
  cozinheira: 'Alimentação',

  // Viagens
  turismo: 'Viagens',
  viagem: 'Viagens',
  hoteis: 'Viagens',
  hotel: 'Viagens',
  travel: 'Viagens',
  viajar: 'Viagens',
  'viagens & turismo': 'Viagens',
  'viagens e turismo': 'Viagens',
  hostel: 'Viagens',
  resort: 'Viagens',
  cruzeiro: 'Viagens',
  mochilao: 'Viagens',
  mochilão: 'Viagens',
  backpacking: 'Viagens',
  vanlife: 'Viagens',
  nomade: 'Viagens',
  nomade_digital: 'Viagens',
  aeroporto: 'Viagens',
  passagens: 'Viagens',
  destinos: 'Viagens',
  praia: 'Viagens',
  praias: 'Viagens',

  // Entretenimento
  cinema: 'Entretenimento',
  series: 'Entretenimento',
  celebridades: 'Entretenimento',
  entretenimento: 'Entretenimento',
  tv: 'Entretenimento',
  séries: 'Entretenimento',
  streaming: 'Entretenimento',
  anime: 'Entretenimento',
  manga: 'Entretenimento',
  podcast: 'Entretenimento',
  livros: 'Entretenimento',
  literatura: 'Entretenimento',
  leitura: 'Entretenimento',
  teatro: 'Entretenimento',
  musical: 'Entretenimento',
  cosplay: 'Entretenimento',
  nerd: 'Entretenimento',
  geek: 'Entretenimento',
  reality: 'Entretenimento',
  novela: 'Entretenimento',
  novelas: 'Entretenimento',
  galeria: 'Entretenimento',
  galerista: 'Entretenimento',
  museu: 'Entretenimento',
  exposicao: 'Entretenimento',
  exposição: 'Entretenimento',
  curadoria: 'Entretenimento',
  vernissage: 'Entretenimento',
  espetaculo: 'Entretenimento',
  espetáculo: 'Entretenimento',
  producao_teatral: 'Entretenimento',
  teatro_infantil: 'Entretenimento',
  cultura: 'Entretenimento',
  artgallery: 'Entretenimento',
  television: 'Entretenimento',
  televisao: 'Entretenimento',
  televisão: 'Entretenimento',
  apresentador: 'Entretenimento',
  apresentadora: 'Entretenimento',
  famosos: 'Entretenimento',
  famosas: 'Entretenimento',
  famoso: 'Entretenimento',
  famosa: 'Entretenimento',
  noticias: 'Entretenimento',
  notícias: 'Entretenimento',
  fofoca: 'Entretenimento',
  fofocas: 'Entretenimento',
  midia: 'Entretenimento',
  mídia: 'Entretenimento',
  celebridade: 'Entretenimento',
  coluna: 'Entretenimento',
  viral: 'Entretenimento',
  fotografia: 'Entretenimento',
  fotografo: 'Entretenimento',
  fotógrafo: 'Entretenimento',
  paisagem: 'Entretenimento',
  fotografias: 'Entretenimento',
  ensaio: 'Entretenimento',
  ensaios: 'Entretenimento',
  audiovisual: 'Entretenimento',
  filmmaker: 'Entretenimento',
  videomaker: 'Entretenimento',
  editorial: 'Entretenimento',

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
  standup: 'Humor',
  stand_up: 'Humor',
  satira: 'Humor',
  sátira: 'Humor',
  piadas: 'Humor',
  improv: 'Humor',

  // Música — gêneros, BR/carnaval, instrumentos, papel, produção (PT/EN)
  cantor: 'Música',
  cantora: 'Música',
  banda: 'Música',
  dj: 'Música',
  mc: 'Música',
  musica: 'Música',
  cover: 'Música',
  vocalista: 'Música',
  instrumentista: 'Música',
  compositor: 'Música',
  compositora: 'Música',
  rapper: 'Música',
  rap: 'Música',
  trap: 'Música',
  phonk: 'Música',
  reggaeton: 'Música',
  dembow: 'Música',
  funk: 'Música',
  rock: 'Música',
  pop: 'Música',
  jazz: 'Música',
  blues: 'Música',
  soul: 'Música',
  rnb: 'Música',
  indie: 'Música',
  metal: 'Música',
  punk: 'Música',
  mpb: 'Música',
  sertanejo: 'Música',
  forro: 'Música',
  forró: 'Música',
  brega: 'Música',
  arrocha: 'Música',
  tecnobrega: 'Música',
  eletronica: 'Música',
  eletrônica: 'Música',
  edm: 'Música',
  techno: 'Música',
  house: 'Música',
  kpop: 'Música',
  reggae: 'Música',
  salsa: 'Música',
  bachata: 'Música',
  merengue: 'Música',
  cumbia: 'Música',
  samba: 'Música',
  sambista: 'Música',
  samba_enredo: 'Música',
  pagode: 'Música',
  maracatu: 'Música',
  ijexa: 'Música',
  ijexá: 'Música',
  ciranda: 'Música',
  carnaval: 'Música',
  bloco: 'Música',
  frevo: 'Música',
  axe: 'Música',
  axé: 'Música',
  enredo: 'Música',
  desfile: 'Música',
  alegoria: 'Música',
  quadra: 'Música',
  bateria: 'Música',
  mestre_de_bateria: 'Música',
  escola_de_samba: 'Música',
  porta_bandeira: 'Música',
  mestre_sala: 'Música',
  surdo: 'Música',
  tamborim: 'Música',
  repique: 'Música',
  ritmista: 'Música',
  pandeiro: 'Música',
  agogo: 'Música',
  agogô: 'Música',
  cuica: 'Música',
  cuíca: 'Música',
  cavaquinho: 'Música',
  berimbau: 'Música',
  reco_reco: 'Música',
  guitarra: 'Música',
  violao: 'Música',
  violão: 'Música',
  piano: 'Música',
  teclado: 'Música',
  violino: 'Música',
  sax: 'Música',
  saxofone: 'Música',
  trompete: 'Música',
  trombone: 'Música',
  flauta: 'Música',
  clarinete: 'Música',
  baterista: 'Música',
  percussionista: 'Música',
  ukulele: 'Música',
  banjo: 'Música',
  harpa: 'Música',
  orquestra: 'Música',
  coro: 'Música',
  beatmaker: 'Música',
  produtor_musical: 'Música',
  estudio: 'Música',
  estúdio: 'Música',
  mixagem: 'Música',
  mastering: 'Música',
  songwriter: 'Música',
  arranjador: 'Música',
  arranjadora: 'Música',
  musico: 'Música',
  músico: 'Música',
  musicista: 'Música',
  backing: 'Música',
  remix: 'Música',
  soundcloud: 'Música',
  spotify: 'Música',
  bandcamp: 'Música',
  // Vaquejada (NE): cena cultural, festas e musica na pista — vitrine Musica, nao só hipismo
  vaquejada: 'Música',
  vaqueiro: 'Música',
  vaqueiros: 'Música',

  // Esportes
  futebol: 'Esportes',
  futsal: 'Esportes',
  society: 'Esportes',
  pelada: 'Esportes',
  futbol: 'Esportes',
  skate: 'Esportes',
  surf: 'Esportes',
  esporte: 'Esportes',
  basquete: 'Esportes',
  volei: 'Esportes',
  vôlei: 'Esportes',
  tennis: 'Esportes',
  handebol: 'Esportes',
  rugby: 'Esportes',
  ciclismo: 'Esportes',
  maratona: 'Esportes',
  triathlon: 'Esportes',
  golfe: 'Esportes',
  beisebol: 'Esportes',
  pickleball: 'Esportes',
  formula1: 'Esportes',
  f1: 'Esportes',
  motocross: 'Esportes',
  parkour: 'Esportes',
  hipismo: 'Esportes',
  xadrez: 'Esportes',
  esgrima: 'Esportes',
  judo: 'Esportes',
  judô: 'Esportes',
  karate: 'Esportes',
  karatê: 'Esportes',
  taekwondo: 'Esportes',
  capoeira: 'Esportes',
  volei_de_praia: 'Esportes',
  grau: 'Esportes',
  manobra: 'Esportes',
  manobras: 'Esportes',
  stunt: 'Esportes',
  wheelie: 'Esportes',
  motovlog: 'Esportes',
  pilotagem: 'Esportes',
  motoqueiro: 'Esportes',
  motoqueiros: 'Esportes',
  bixo: 'Esportes',
  trilheiro: 'Esportes',
  enduro: 'Esportes',
  velocidade: 'Esportes',

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
  ia: 'Tecnologia',
  inteligencia_artificial: 'Tecnologia',
  'inteligência artificial': 'Tecnologia',
  machine_learning: 'Tecnologia',
  smartphone: 'Tecnologia',
  android: 'Tecnologia',
  iphone: 'Tecnologia',
  blockchain: 'Tecnologia',
  dev: 'Tecnologia',
  devops: 'Tecnologia',
  desenvolvedor: 'Tecnologia',
  desenvolvedora: 'Tecnologia',
  coding: 'Tecnologia',
  programador: 'Tecnologia',
  programadora: 'Tecnologia',
  startup: 'Tecnologia',
  cybersecurity: 'Tecnologia',
  ciberseguranca: 'Tecnologia',
  cibersegurança: 'Tecnologia',
  hardware: 'Tecnologia',
  cloud: 'Tecnologia',
  dados: 'Tecnologia',
  data_science: 'Tecnologia',

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
  reforco: 'Educação',
  reforço: 'Educação',
  vestibular: 'Educação',
  concursos: 'Educação',
  redacao: 'Educação',
  redação: 'Educação',
  matematica: 'Educação',
  matemática: 'Educação',
  fisica: 'Educação',
  física: 'Educação',
  quimica: 'Educação',
  química: 'Educação',
  historia: 'Educação',
  história: 'Educação',
  filosofia: 'Educação',
  coaching_estudos: 'Educação',
  mentalidade: 'Educação',
  desenvolvimento_pessoal: 'Educação',
  autoconhecimento: 'Educação',
  disciplina: 'Educação',
  motivacao: 'Educação',
  motivação: 'Educação',
  mindset: 'Educação',
  produtividade: 'Educação',
  coaching: 'Educação',
  mentor: 'Educação',
  mentoria: 'Educação',
  motivacional: 'Educação',
  reflexao: 'Educação',
  reflexão: 'Educação',
  frases: 'Educação',

  // Negócios
  empreendedorismo: 'Negócios',
  marketing: 'Negócios',
  vendas: 'Negócios',
  negocios: 'Negócios',
  ecommerce: 'Negócios',
  'e-commerce': 'Negócios',
  lideranca: 'Negócios',
  liderança: 'Negócios',
  rh: 'Negócios',
  recrutamento: 'Negócios',
  carreira: 'Negócios',
  negociacao: 'Negócios',
  negociação: 'Negócios',
  consultoria: 'Negócios',
  franquia: 'Negócios',
  dropshipping: 'Negócios',
  b2b: 'Negócios',
  b2c: 'Negócios',
  ceo: 'Negócios',
  coo: 'Negócios',
  cfo: 'Negócios',
  direito: 'Negócios',
  juridico: 'Negócios',
  jurídico: 'Negócios',
  advogado: 'Negócios',
  advogada: 'Negócios',
  advocacia: 'Negócios',
  advogados: 'Negócios',
  advogadas: 'Negócios',
  juristas: 'Negócios',
  empreendedor: 'Negócios',
  empreendedora: 'Negócios',
  empreendedores: 'Negócios',
  empresa: 'Negócios',
  empresas: 'Negócios',
  negocio: 'Negócios',
  negócio: 'Negócios',
  lei: 'Negócios',
  leis: 'Negócios',
  processo: 'Negócios',
  processos: 'Negócios',
  trabalhista: 'Negócios',
  direito_trabalhista: 'Negócios',
  divorcio: 'Negócios',
  divórcio: 'Negócios',
  contrato: 'Negócios',
  contratos: 'Negócios',
  oab: 'Negócios',
  jurisprudencia: 'Negócios',
  jurisprudência: 'Negócios',
  agro: 'Negócios',
  agricultura: 'Negócios',
  fazenda: 'Negócios',
  roca: 'Negócios',
  roça: 'Negócios',
  pecuaria: 'Negócios',
  pecuária: 'Negócios',
  agronegocio: 'Negócios',
  agronegócio: 'Negócios',
  rural: 'Negócios',

  // Finanças
  investimentos: 'Finanças',
  crypto: 'Finanças',
  bolsa: 'Finanças',
  financas: 'Finanças',
  finanças: 'Finanças',
  finfluencer: 'Finanças',
  investimento: 'Finanças',
  investidor: 'Finanças',
  investidora: 'Finanças',
  investidores: 'Finanças',
  bitcoin: 'Finanças',
  cripto: 'Finanças',
  acao: 'Finanças',
  ação: 'Finanças',
  acoes: 'Finanças',
  ações: 'Finanças',
  forex: 'Finanças',
  daytrade: 'Finanças',
  trader: 'Finanças',
  renda_fixa: 'Finanças',
  fundos: 'Finanças',
  imposto: 'Finanças',
  contabilidade: 'Finanças',
  economia: 'Finanças',
  poupar: 'Finanças',
  fire: 'Finanças',

  // Maternidade
  bebe: 'Maternidade',
  gravidez: 'Maternidade',
  maternidade: 'Maternidade',
  mae: 'Maternidade',
  mãe: 'Maternidade',
  maes: 'Maternidade',
  mães: 'Maternidade',
  gestante: 'Maternidade',
  amamentacao: 'Maternidade',
  amamentação: 'Maternidade',
  parto: 'Maternidade',
  pos_parto: 'Maternidade',
  posparto: 'Maternidade',
  puericultura: 'Maternidade',
  cha_revelacao: 'Maternidade',
  paternidade: 'Maternidade',
  'maternidade & paternidade': 'Maternidade',
  'maternidade e paternidade': 'Maternidade',
  'maternidade/paternidade': 'Maternidade',

  // Pets
  cao: 'Pets',
  cachorro: 'Pets',
  cães: 'Pets',
  gatos: 'Pets',
  animais: 'Pets',
  adestramento: 'Pets',
  adestrador: 'Pets',
  petshop: 'Pets',
  pet_shop: 'Pets',
  pet: 'Pets',
  caes: 'Pets',
  cachorros: 'Pets',
  gato: 'Pets',
  veterinario: 'Pets',
  veterinário: 'Pets',
  veterinaria: 'Pets',
  veterinária: 'Pets',
  hamster: 'Pets',
  coelho: 'Pets',
  passaro: 'Pets',
  pássaro: 'Pets',
  aves: 'Pets',
  aquario: 'Pets',
  aquário: 'Pets',
  exoticos: 'Pets',
  exóticos: 'Pets',

  // Casa
  decoracao: 'Casa',
  arquitetura: 'Casa',
  interiores: 'Casa',
  casa: 'Casa',
  decor: 'Casa',
  decoração: 'Casa',
  jardinagem: 'Casa',
  paisagismo: 'Casa',
  diy: 'Casa',
  organizacao: 'Casa',
  organização: 'Casa',
  minimalismo_casa: 'Casa',
  limpeza: 'Casa',
  faxina: 'Casa',
  smart_home: 'Casa',
  interior: 'Casa',
  moveis: 'Casa',
  móveis: 'Casa',
  reforma: 'Casa',
  reformas: 'Casa',
  construcao: 'Casa',
  construção: 'Casa',
  obra: 'Casa',
  obras: 'Casa',

  // Automotivo
  carros: 'Automotivo',
  motos: 'Automotivo',
  mecanica: 'Automotivo',
  mecânica: 'Automotivo',
  moto: 'Automotivo',
  automobilismo: 'Automotivo',
  tuning: 'Automotivo',
  drift: 'Automotivo',
  pickup: 'Automotivo',
  suv: 'Automotivo',
  eletrico: 'Automotivo',
  elétrico: 'Automotivo',
  combustivel: 'Automotivo',
  combustível: 'Automotivo',
  oficina: 'Automotivo',
  mecanico: 'Automotivo',
  mecânico: 'Automotivo',

  // Religião
  cristianismo: 'Religião',
  cristandade: 'Religião',
  crista: 'Religião',
  cristã: 'Religião',
  fe: 'Religião',
  espiritualidade: 'Religião',
  religiao: 'Religião',
  religião: 'Religião',
  gospel: 'Religião',
  biblia: 'Religião',
  bíblia: 'Religião',
  catolicismo: 'Religião',
  evangelico: 'Religião',
  evangélico: 'Religião',
  evangelica: 'Religião',
  umbanda: 'Religião',
  candomble: 'Religião',
  candomblé: 'Religião',
  budismo: 'Religião',
  islam: 'Religião',
  islamismo: 'Religião',
  judaismo: 'Religião',
  espirita: 'Religião',
  espírita: 'Religião',
  teologia: 'Religião',
  missao: 'Religião',
  missão: 'Religião',
  jesus: 'Religião',
  igreja: 'Religião',
  pastor: 'Religião',
  pastora: 'Religião',
  missionario: 'Religião',
  missionário: 'Religião',
  devocional: 'Religião',
  oracao: 'Religião',
  oração: 'Religião',

  // Games — evitar "jogo/jogos" soltos (em pt-BR = partida de esporte); use termos de video game.
  gamer: 'Games',
  esports: 'Games',
  gaming: 'Games',
  games: 'Games',
  gameplay: 'Games',
  jogos_eletronicos: 'Games',
  jogos_online: 'Games',
  videogame: 'Games',
  videogames: 'Games',
  streamer: 'Games',
  twitch: 'Games',
  youtube_gaming: 'Games',
  minecraft: 'Games',
  fortnite: 'Games',
  roblox: 'Games',
  valorant: 'Games',
  league_of_legends: 'Games',
  speedrun: 'Games',
  cosplay_games: 'Games',

  // Política
  politica: 'Política',
  política: 'Política',
  politico: 'Política',
  político: 'Política',
  eleicoes: 'Política',
  eleições: 'Política',
  governo: 'Política',
  vereador: 'Política',
  vereadora: 'Política',
  deputado: 'Política',
  deputada: 'Política',
  senador: 'Política',
  senadora: 'Política',
  ministra: 'Política',
  ministro: 'Política',
  stf: 'Política',
  camara: 'Política',
  câmara: 'Política',
  senado: 'Política',
  prefeitura: 'Política',
  municipio: 'Política',
  município: 'Política',
  policia: 'Política',
  policial: 'Política',
  pm: 'Política',
  bpm: 'Política',
  militar: 'Política',
  exercito: 'Política',
  exército: 'Política',
  forcas_armadas: 'Política',
  forças_armadas: 'Política',
  bombeiro: 'Política',
  bombeiros: 'Política',
  seguranca_publica: 'Política',
  defesa: 'Política',
  instituicao: 'Política',
  instituição: 'Política',
  governo_federal: 'Política',

  // Lifestyle (subs amplas — main ainda pode ser Lifestyle)
  life: 'Lifestyle',
  'estilo de vida': 'Lifestyle',
  rotina: 'Lifestyle',
  vlog: 'Lifestyle',
  casal: 'Lifestyle',
  minimalismo: 'Lifestyle',
  sustentavel: 'Lifestyle',
  sustentável: 'Lifestyle',
  ecologia: 'Lifestyle',
  autocuidado: 'Lifestyle',
  tatuagem: 'Lifestyle',
  tatuagens: 'Lifestyle',
  tatuador: 'Lifestyle',
  tatuadora: 'Lifestyle',
  tattoo: 'Lifestyle',
  tattoos: 'Lifestyle',
  tatoo: 'Lifestyle',
  ink: 'Lifestyle',
  bodyart: 'Lifestyle',
  body_art: 'Lifestyle',
  piercing: 'Lifestyle',
  piercings: 'Lifestyle',
  piercer: 'Lifestyle',
  arte_visual: 'Lifestyle',
  caligrafia: 'Lifestyle',
};

function buildSubcategoryToMainMap(raw: Record<string, MainCategoryCanonical>): Map<string, MainCategoryCanonical> {
  const m = new Map<string, MainCategoryCanonical>();
  for (const [k, v] of Object.entries(raw)) {
    if (!(MAIN_CATEGORY_CANONICAL_LABELS as readonly string[]).includes(v)) continue;
    const token = normalizeSubcategoryToken(k);
    if (token.length < 2) continue;
    if (!m.has(token)) m.set(token, v);
  }
  return m;
}

const SUBCATEGORY_FOLD_TO_MAIN = buildSubcategoryToMainMap(SUBCATEGORY_TO_MAIN_RAW);

/** True se algum token da subCategory (frase ou snake_case) existe no mapa fechado sub → main. */
export function isSubcategoryMappedToMain(raw: string): boolean {
  for (const tok of expandSubcategoryTokensForLookup(String(raw ?? '').trim())) {
    if (SUBCATEGORY_FOLD_TO_MAIN.has(tok)) return true;
  }
  return false;
}

/**
 * Amostra compacta por vitrine (main) para o prompt: o LLM deve preferir termos reconheciveis pelo mapa.
 */
export function formatSubcategoryTaxonomyHintsForPrompt(): string {
  const byMain = new Map<MainCategoryCanonical, string[]>();
  for (const [k, v] of Object.entries(SUBCATEGORY_TO_MAIN_RAW)) {
    if (!(MAIN_CATEGORY_CANONICAL_LABELS as readonly string[]).includes(v)) continue;
    if (!byMain.has(v)) byMain.set(v, []);
    const display = /\s/u.test(k) ? k : k.replace(/_/g, ' ');
    byMain.get(v)!.push(display);
  }
  const lines: string[] = [];
  /** Amostra menor por vitrine: servidor rejeita termos fora do mapa; 8 costuma bastar como gancho. */
  const SAMPLE_PER_MAIN = 8;
  for (const cat of MAIN_CATEGORY_CANONICAL_LABELS) {
    const arr = [...new Set(byMain.get(cat) ?? [])].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const slice = arr.slice(0, SAMPLE_PER_MAIN);
    if (slice.length === 0) continue;
    lines.push(`${cat}: ${slice.join(', ')}`);
  }
  return [
    'subCategories — vocabulario FECHADO (uma palavra; so termos que existem no mapa do servidor; amostra por vitrine):',
    ...lines,
    'Evite vagos fora do mapa (pessoas, geral, conteudo). Prefira termos da amostra ou equivalente no mapa.',
  ].join('\n');
}

/**
 * Variações comuns (ES/EN, compostos, grafias) → rótulo canônico da lista fechada.
 * Usado para snap do main vindo do LLM e para evidência em texto livre quando subs não batem no mapa V2.
 */
const RAW_ALIASES: Record<string, string> = {
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
  beauty: 'Beleza',
  manicure: 'Beleza',
  pedicure: 'Beleza',
  sobrancelha: 'Beleza',
  lash: 'Beleza',
  lashes: 'Beleza',
  brow: 'Beleza',
  brows: 'Beleza',
  hidratacao: 'Beleza',
  hidratação: 'Beleza',
  antiaging: 'Beleza',
  barbearia: 'Beleza',
  barber: 'Beleza',
  fragrance: 'Beleza',
  dermatologia: 'Beleza',
  micropigmentacao: 'Beleza',
  micropigmentação: 'Beleza',

  // Moda
  fashion: 'Moda',
  style: 'Moda',
  estilo: 'Moda',
  roupa: 'Moda',
  roupas: 'Moda',
  cores: 'Moda',
  outfit: 'Moda',
  outfits: 'Moda',
  look: 'Moda',
  looks: 'Moda',
  acessorios: 'Moda',
  acessórios: 'Moda',
  streetwear: 'Moda',
  sneakers: 'Moda',
  tenis: 'Moda',
  tênis: 'Moda',
  calcados: 'Moda',
  calçados: 'Moda',
  lingerie: 'Moda',
  modinha: 'Moda',
  luxo: 'Moda',
  vintage: 'Moda',
  outlet: 'Moda',
  thrift: 'Moda',
  moda: 'Moda',
  fashionista: 'Moda',
  stylist: 'Moda',
  personal_style: 'Moda',
  armario: 'Moda',
  armário: 'Moda',

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
  funcional: 'Fitness',
  bodybuilding: 'Fitness',
  spinning: 'Fitness',
  hiit: 'Fitness',
  natacao: 'Fitness',
  natação: 'Fitness',
  jiujitsu: 'Fitness',
  jiu_jitsu: 'Fitness',
  muaythai: 'Fitness',
  muay_thai: 'Fitness',
  boxe: 'Fitness',
  mma: 'Fitness',
  kettlebell: 'Fitness',
  calistenia: 'Fitness',
  alongamento: 'Fitness',
  mobility: 'Fitness',
  personal: 'Fitness',
  personal_trainer: 'Fitness',

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
  dentista: 'Saúde',
  odonto: 'Saúde',
  odontologia: 'Saúde',
  fisioterapia: 'Saúde',
  fisioterapeuta: 'Saúde',
  nutricionista: 'Saúde',
  cardiologia: 'Saúde',
  dermatologista: 'Saúde',
  enfermagem: 'Saúde',
  farmaceutico: 'Saúde',
  farmacêutico: 'Saúde',
  psiquiatria: 'Saúde',
  oftalmologia: 'Saúde',
  ortopedia: 'Saúde',
  pediatria: 'Saúde',
  endocrino: 'Saúde',
  endocrinologia: 'Saúde',
  saude_bucal: 'Saúde',
  'saúde bucal': 'Saúde',
  doenca: 'Saúde',
  doença: 'Saúde',
  doencas_raras: 'Saúde',
  doenças_raras: 'Saúde',
  tratamento: 'Saúde',
  curativo: 'Saúde',
  hospitalar: 'Saúde',
  campanha_solidaria: 'Saúde',
  doacao: 'Saúde',
  doação: 'Saúde',
  epidermolise: 'Saúde',
  epidermólise: 'Saúde',
  medico: 'Saúde',
  médico: 'Saúde',
  medica: 'Saúde',
  médica: 'Saúde',
  psicologo: 'Saúde',
  psicólogo: 'Saúde',
  psicologa: 'Saúde',
  psicóloga: 'Saúde',
  terapeuta: 'Saúde',
  clinico: 'Saúde',
  clínico: 'Saúde',

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
  confeitaria: 'Alimentação',
  doces: 'Alimentação',
  sobremesa: 'Alimentação',
  chocolate: 'Alimentação',
  churrasco: 'Alimentação',
  churrasqueiro: 'Alimentação',
  padaria: 'Alimentação',
  lowcarb: 'Alimentação',
  keto: 'Alimentação',
  vegetariano: 'Alimentação',
  vegetariana: 'Alimentação',
  barman: 'Alimentação',
  mixologia: 'Alimentação',
  sommelier: 'Alimentação',
  cafe: 'Alimentação',
  café: 'Alimentação',
  cafeteria: 'Alimentação',
  coffee: 'Alimentação',
  torrefacao: 'Alimentação',
  torrefação: 'Alimentação',
  espresso: 'Alimentação',
  bar: 'Alimentação',
  lanchonete: 'Alimentação',
  pizzaria: 'Alimentação',
  hamburgueria: 'Alimentação',
  churrascaria: 'Alimentação',
  doceria: 'Alimentação',
  comida_japonesa: 'Alimentação',
  sushi: 'Alimentação',
  temaki: 'Alimentação',
  poke: 'Alimentação',
  acai: 'Alimentação',
  açaí: 'Alimentação',
  brunch: 'Alimentação',
  foodtruck: 'Alimentação',
  food_truck: 'Alimentação',
  bolo: 'Alimentação',
  bolos: 'Alimentação',
  confeiteira: 'Alimentação',
  confeiteiro: 'Alimentação',
  cozinheiro: 'Alimentação',
  cozinheira: 'Alimentação',

  // Viagens
  viagem: 'Viagens',
  turismo: 'Viagens',
  'viagens & turismo': 'Viagens',
  'viagens e turismo': 'Viagens',
  travel: 'Viagens',
  viajar: 'Viagens',
  hostel: 'Viagens',
  resort: 'Viagens',
  cruzeiro: 'Viagens',
  mochilao: 'Viagens',
  mochilão: 'Viagens',
  backpacking: 'Viagens',
  vanlife: 'Viagens',
  nomade: 'Viagens',
  nomade_digital: 'Viagens',
  aeroporto: 'Viagens',
  passagens: 'Viagens',
  destinos: 'Viagens',
  praia: 'Viagens',
  praias: 'Viagens',

  // Entretenimento
  entretenimento: 'Entretenimento',
  tv: 'Entretenimento',
  cinema: 'Entretenimento',
  series: 'Entretenimento',
  séries: 'Entretenimento',
  streaming: 'Entretenimento',
  celebridades: 'Entretenimento',
  anime: 'Entretenimento',
  manga: 'Entretenimento',
  podcast: 'Entretenimento',
  livros: 'Entretenimento',
  literatura: 'Entretenimento',
  leitura: 'Entretenimento',
  teatro: 'Entretenimento',
  musical: 'Entretenimento',
  cosplay: 'Entretenimento',
  nerd: 'Entretenimento',
  geek: 'Entretenimento',
  reality: 'Entretenimento',
  novela: 'Entretenimento',
  novelas: 'Entretenimento',
  galeria: 'Entretenimento',
  galerista: 'Entretenimento',
  museu: 'Entretenimento',
  exposicao: 'Entretenimento',
  exposição: 'Entretenimento',
  curadoria: 'Entretenimento',
  vernissage: 'Entretenimento',
  espetaculo: 'Entretenimento',
  espetáculo: 'Entretenimento',
  producao_teatral: 'Entretenimento',
  teatro_infantil: 'Entretenimento',
  cultura: 'Entretenimento',
  artgallery: 'Entretenimento',
  television: 'Entretenimento',
  televisao: 'Entretenimento',
  televisão: 'Entretenimento',
  apresentador: 'Entretenimento',
  apresentadora: 'Entretenimento',
  famosos: 'Entretenimento',
  famosas: 'Entretenimento',
  famoso: 'Entretenimento',
  famosa: 'Entretenimento',
  noticias: 'Entretenimento',
  notícias: 'Entretenimento',
  fofoca: 'Entretenimento',
  fofocas: 'Entretenimento',
  midia: 'Entretenimento',
  mídia: 'Entretenimento',
  celebridade: 'Entretenimento',
  coluna: 'Entretenimento',
  viral: 'Entretenimento',
  fotografia: 'Entretenimento',
  fotografo: 'Entretenimento',
  fotógrafo: 'Entretenimento',
  paisagem: 'Entretenimento',
  fotografias: 'Entretenimento',
  ensaio: 'Entretenimento',
  ensaios: 'Entretenimento',
  audiovisual: 'Entretenimento',
  filmmaker: 'Entretenimento',
  videomaker: 'Entretenimento',
  editorial: 'Entretenimento',
  natureza: 'Entretenimento',

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
  standup: 'Humor',
  stand_up: 'Humor',
  satira: 'Humor',
  sátira: 'Humor',
  piadas: 'Humor',
  improv: 'Humor',

  // Música — gêneros, BR/carnaval, instrumentos, papel, produção (PT/EN)
  musica: 'Música',
  cantor: 'Música',
  cantora: 'Música',
  dj: 'Música',
  mc: 'Música',
  banda: 'Música',
  cover: 'Música',
  vocalista: 'Música',
  instrumentista: 'Música',
  compositor: 'Música',
  compositora: 'Música',
  rapper: 'Música',
  rap: 'Música',
  trap: 'Música',
  phonk: 'Música',
  reggaeton: 'Música',
  dembow: 'Música',
  funk: 'Música',
  rock: 'Música',
  pop: 'Música',
  jazz: 'Música',
  blues: 'Música',
  soul: 'Música',
  rnb: 'Música',
  indie: 'Música',
  metal: 'Música',
  punk: 'Música',
  mpb: 'Música',
  sertanejo: 'Música',
  forro: 'Música',
  forró: 'Música',
  brega: 'Música',
  arrocha: 'Música',
  tecnobrega: 'Música',
  eletronica: 'Música',
  eletrônica: 'Música',
  edm: 'Música',
  techno: 'Música',
  house: 'Música',
  kpop: 'Música',
  reggae: 'Música',
  salsa: 'Música',
  bachata: 'Música',
  merengue: 'Música',
  cumbia: 'Música',
  samba: 'Música',
  sambista: 'Música',
  samba_enredo: 'Música',
  pagode: 'Música',
  maracatu: 'Música',
  ijexa: 'Música',
  ijexá: 'Música',
  ciranda: 'Música',
  carnaval: 'Música',
  bloco: 'Música',
  frevo: 'Música',
  axe: 'Música',
  axé: 'Música',
  enredo: 'Música',
  desfile: 'Música',
  alegoria: 'Música',
  quadra: 'Música',
  bateria: 'Música',
  mestre_de_bateria: 'Música',
  escola_de_samba: 'Música',
  porta_bandeira: 'Música',
  mestre_sala: 'Música',
  surdo: 'Música',
  tamborim: 'Música',
  repique: 'Música',
  ritmista: 'Música',
  pandeiro: 'Música',
  agogo: 'Música',
  agogô: 'Música',
  cuica: 'Música',
  cuíca: 'Música',
  cavaquinho: 'Música',
  berimbau: 'Música',
  reco_reco: 'Música',
  guitarra: 'Música',
  violao: 'Música',
  violão: 'Música',
  piano: 'Música',
  teclado: 'Música',
  violino: 'Música',
  sax: 'Música',
  saxofone: 'Música',
  trompete: 'Música',
  trombone: 'Música',
  flauta: 'Música',
  clarinete: 'Música',
  baterista: 'Música',
  percussionista: 'Música',
  ukulele: 'Música',
  banjo: 'Música',
  harpa: 'Música',
  orquestra: 'Música',
  coro: 'Música',
  beatmaker: 'Música',
  produtor_musical: 'Música',
  estudio: 'Música',
  estúdio: 'Música',
  mixagem: 'Música',
  mastering: 'Música',
  songwriter: 'Música',
  arranjador: 'Música',
  arranjadora: 'Música',
  musico: 'Música',
  músico: 'Música',
  musicista: 'Música',
  backing: 'Música',
  remix: 'Música',
  soundcloud: 'Música',
  spotify: 'Música',
  bandcamp: 'Música',
  vaquejada: 'Música',
  vaqueiro: 'Música',
  vaqueiros: 'Música',

  // Esportes
  esporte: 'Esportes',
  futebol: 'Esportes',
  futsal: 'Esportes',
  society: 'Esportes',
  pelada: 'Esportes',
  futbol: 'Esportes',
  basquete: 'Esportes',
  surf: 'Esportes',
  skate: 'Esportes',
  volei: 'Esportes',
  vôlei: 'Esportes',
  tennis: 'Esportes',
  handebol: 'Esportes',
  rugby: 'Esportes',
  ciclismo: 'Esportes',
  maratona: 'Esportes',
  triathlon: 'Esportes',
  golfe: 'Esportes',
  beisebol: 'Esportes',
  pickleball: 'Esportes',
  formula1: 'Esportes',
  f1: 'Esportes',
  motocross: 'Esportes',
  parkour: 'Esportes',
  hipismo: 'Esportes',
  xadrez: 'Esportes',
  esgrima: 'Esportes',
  judo: 'Esportes',
  judô: 'Esportes',
  karate: 'Esportes',
  karatê: 'Esportes',
  taekwondo: 'Esportes',
  capoeira: 'Esportes',
  volei_de_praia: 'Esportes',
  grau: 'Esportes',
  manobra: 'Esportes',
  manobras: 'Esportes',
  stunt: 'Esportes',
  wheelie: 'Esportes',
  motovlog: 'Esportes',
  pilotagem: 'Esportes',
  motoqueiro: 'Esportes',
  motoqueiros: 'Esportes',
  bixo: 'Esportes',
  trilheiro: 'Esportes',
  enduro: 'Esportes',
  velocidade: 'Esportes',

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
  ia: 'Tecnologia',
  inteligencia_artificial: 'Tecnologia',
  'inteligência artificial': 'Tecnologia',
  machine_learning: 'Tecnologia',
  smartphone: 'Tecnologia',
  android: 'Tecnologia',
  iphone: 'Tecnologia',
  blockchain: 'Tecnologia',
  dev: 'Tecnologia',
  devops: 'Tecnologia',
  desenvolvedor: 'Tecnologia',
  desenvolvedora: 'Tecnologia',
  coding: 'Tecnologia',
  programador: 'Tecnologia',
  programadora: 'Tecnologia',
  startup: 'Tecnologia',
  cybersecurity: 'Tecnologia',
  ciberseguranca: 'Tecnologia',
  cibersegurança: 'Tecnologia',
  hardware: 'Tecnologia',
  cloud: 'Tecnologia',
  dados: 'Tecnologia',
  data_science: 'Tecnologia',

  // Educação
  educacao: 'Educação',
  estudos: 'Educação',
  curso: 'Educação',
  cursos: 'Educação',
  conhecimento: 'Educação',
  dicas: 'Educação',
  ingles: 'Educação',
  inglês: 'Educação',
  ensino: 'Educação',
  reforco: 'Educação',
  reforço: 'Educação',
  vestibular: 'Educação',
  concursos: 'Educação',
  redacao: 'Educação',
  redação: 'Educação',
  matematica: 'Educação',
  matemática: 'Educação',
  fisica: 'Educação',
  física: 'Educação',
  quimica: 'Educação',
  química: 'Educação',
  historia: 'Educação',
  história: 'Educação',
  filosofia: 'Educação',
  coaching_estudos: 'Educação',
  mentalidade: 'Educação',
  desenvolvimento_pessoal: 'Educação',
  autoconhecimento: 'Educação',
  disciplina: 'Educação',
  motivacao: 'Educação',
  motivação: 'Educação',
  mindset: 'Educação',
  produtividade: 'Educação',
  coaching: 'Educação',
  mentor: 'Educação',
  mentoria: 'Educação',
  motivacional: 'Educação',
  reflexao: 'Educação',
  reflexão: 'Educação',
  frases: 'Educação',

  // Negócios
  negocios: 'Negócios',
  empreendedorismo: 'Negócios',
  marketing: 'Negócios',
  vendas: 'Negócios',
  ecommerce: 'Negócios',
  'e-commerce': 'Negócios',
  lideranca: 'Negócios',
  liderança: 'Negócios',
  rh: 'Negócios',
  recrutamento: 'Negócios',
  carreira: 'Negócios',
  negociacao: 'Negócios',
  negociação: 'Negócios',
  consultoria: 'Negócios',
  franquia: 'Negócios',
  dropshipping: 'Negócios',
  b2b: 'Negócios',
  b2c: 'Negócios',
  ceo: 'Negócios',
  coo: 'Negócios',
  cfo: 'Negócios',
  direito: 'Negócios',
  juridico: 'Negócios',
  jurídico: 'Negócios',
  advogado: 'Negócios',
  advogada: 'Negócios',
  advocacia: 'Negócios',
  advogados: 'Negócios',
  advogadas: 'Negócios',
  juristas: 'Negócios',
  empreendedor: 'Negócios',
  empreendedora: 'Negócios',
  empreendedores: 'Negócios',
  empresa: 'Negócios',
  empresas: 'Negócios',
  negocio: 'Negócios',
  negócio: 'Negócios',
  lei: 'Negócios',
  leis: 'Negócios',
  processo: 'Negócios',
  processos: 'Negócios',
  trabalhista: 'Negócios',
  direito_trabalhista: 'Negócios',
  divorcio: 'Negócios',
  divórcio: 'Negócios',
  contrato: 'Negócios',
  contratos: 'Negócios',
  oab: 'Negócios',
  jurisprudencia: 'Negócios',
  jurisprudência: 'Negócios',
  agro: 'Negócios',
  agricultura: 'Negócios',
  fazenda: 'Negócios',
  roca: 'Negócios',
  roça: 'Negócios',
  pecuaria: 'Negócios',
  pecuária: 'Negócios',
  agronegocio: 'Negócios',
  agronegócio: 'Negócios',
  rural: 'Negócios',

  // Finanças
  financas: 'Finanças',
  finanças: 'Finanças',
  finfluencer: 'Finanças',
  investimentos: 'Finanças',
  investimento: 'Finanças',
  investidor: 'Finanças',
  investidora: 'Finanças',
  investidores: 'Finanças',
  bitcoin: 'Finanças',
  crypto: 'Finanças',
  cripto: 'Finanças',
  bolsa: 'Finanças',
  acao: 'Finanças',
  ação: 'Finanças',
  acoes: 'Finanças',
  ações: 'Finanças',
  forex: 'Finanças',
  daytrade: 'Finanças',
  trader: 'Finanças',
  renda_fixa: 'Finanças',
  fundos: 'Finanças',
  imposto: 'Finanças',
  contabilidade: 'Finanças',
  economia: 'Finanças',
  poupar: 'Finanças',
  fire: 'Finanças',

  // Maternidade
  mae: 'Maternidade',
  mãe: 'Maternidade',
  maes: 'Maternidade',
  mães: 'Maternidade',
  gestante: 'Maternidade',
  gravidez: 'Maternidade',
  bebe: 'Maternidade',
  bebê: 'Maternidade',
  amamentacao: 'Maternidade',
  amamentação: 'Maternidade',
  parto: 'Maternidade',
  pos_parto: 'Maternidade',
  posparto: 'Maternidade',
  puericultura: 'Maternidade',
  cha_revelacao: 'Maternidade',

  // Lifestyle
  life: 'Lifestyle',
  'estilo de vida': 'Lifestyle',
  rotina: 'Lifestyle',
  vlog: 'Lifestyle',
  casal: 'Lifestyle',
  minimalismo: 'Lifestyle',
  sustentavel: 'Lifestyle',
  sustentável: 'Lifestyle',
  ecologia: 'Lifestyle',
  autocuidado: 'Lifestyle',
  tatuagem: 'Lifestyle',
  tatuagens: 'Lifestyle',
  tatuador: 'Lifestyle',
  tatuadora: 'Lifestyle',
  tattoo: 'Lifestyle',
  tattoos: 'Lifestyle',
  tatoo: 'Lifestyle',
  ink: 'Lifestyle',
  bodyart: 'Lifestyle',
  body_art: 'Lifestyle',
  piercing: 'Lifestyle',
  piercings: 'Lifestyle',
  piercer: 'Lifestyle',
  arte_visual: 'Lifestyle',
  caligrafia: 'Lifestyle',

  // Política
  politica: 'Política',
  politico: 'Política',
  político: 'Política',
  eleicoes: 'Política',
  eleições: 'Política',
  governo: 'Política',
  vereador: 'Política',
  vereadora: 'Política',
  deputado: 'Política',
  deputada: 'Política',
  senador: 'Política',
  senadora: 'Política',
  ministra: 'Política',
  ministro: 'Política',
  stf: 'Política',
  camara: 'Política',
  câmara: 'Política',
  senado: 'Política',
  prefeitura: 'Política',
  municipio: 'Política',
  município: 'Política',
  policia: 'Política',
  policial: 'Política',
  pm: 'Política',
  bpm: 'Política',
  militar: 'Política',
  exercito: 'Política',
  exército: 'Política',
  forcas_armadas: 'Política',
  forças_armadas: 'Política',
  bombeiro: 'Política',
  bombeiros: 'Política',
  seguranca_publica: 'Política',
  defesa: 'Política',
  instituicao: 'Política',
  instituição: 'Política',
  governo_federal: 'Política',

  // Pets
  pet: 'Pets',
  cao: 'Pets',
  caes: 'Pets',
  cães: 'Pets',
  cachorro: 'Pets',
  cachorros: 'Pets',
  gato: 'Pets',
  gatos: 'Pets',
  animais: 'Pets',
  adestramento: 'Pets',
  adestrador: 'Pets',
  petshop: 'Pets',
  pet_shop: 'Pets',
  veterinario: 'Pets',
  veterinário: 'Pets',
  veterinaria: 'Pets',
  veterinária: 'Pets',
  hamster: 'Pets',
  coelho: 'Pets',
  passaro: 'Pets',
  pássaro: 'Pets',
  aves: 'Pets',
  aquario: 'Pets',
  aquário: 'Pets',
  exoticos: 'Pets',
  exóticos: 'Pets',

  // Games
  gamer: 'Games',
  gaming: 'Games',
  games: 'Games',
  gameplay: 'Games',
  jogos_eletronicos: 'Games',
  jogos_online: 'Games',
  videogame: 'Games',
  videogames: 'Games',
  esports: 'Games',
  streamer: 'Games',
  twitch: 'Games',
  youtube_gaming: 'Games',
  minecraft: 'Games',
  fortnite: 'Games',
  roblox: 'Games',
  valorant: 'Games',
  league_of_legends: 'Games',
  speedrun: 'Games',
  cosplay_games: 'Games',

  // Casa
  casa: 'Casa',
  decor: 'Casa',
  decoracao: 'Casa',
  decoração: 'Casa',
  arquitetura: 'Casa',
  interiores: 'Casa',
  jardinagem: 'Casa',
  paisagismo: 'Casa',
  diy: 'Casa',
  organizacao: 'Casa',
  organização: 'Casa',
  minimalismo_casa: 'Casa',
  limpeza: 'Casa',
  faxina: 'Casa',
  smart_home: 'Casa',
  interior: 'Casa',
  moveis: 'Casa',
  móveis: 'Casa',
  reforma: 'Casa',
  reformas: 'Casa',
  construcao: 'Casa',
  construção: 'Casa',
  obra: 'Casa',
  obras: 'Casa',

  // Automotivo
  carros: 'Automotivo',
  motos: 'Automotivo',
  moto: 'Automotivo',
  mecanica: 'Automotivo',
  mecânica: 'Automotivo',
  automobilismo: 'Automotivo',
  tuning: 'Automotivo',
  drift: 'Automotivo',
  pickup: 'Automotivo',
  suv: 'Automotivo',
  eletrico: 'Automotivo',
  elétrico: 'Automotivo',
  combustivel: 'Automotivo',
  combustível: 'Automotivo',
  oficina: 'Automotivo',
  mecanico: 'Automotivo',
  mecânico: 'Automotivo',

  // Religião
  religiao: 'Religião',
  religião: 'Religião',
  cristianismo: 'Religião',
  cristandade: 'Religião',
  crista: 'Religião',
  cristã: 'Religião',
  gospel: 'Religião',
  espiritualidade: 'Religião',
  fe: 'Religião',
  biblia: 'Religião',
  bíblia: 'Religião',
  catolicismo: 'Religião',
  evangelico: 'Religião',
  evangélico: 'Religião',
  evangelica: 'Religião',
  umbanda: 'Religião',
  candomble: 'Religião',
  candomblé: 'Religião',
  budismo: 'Religião',
  islam: 'Religião',
  islamismo: 'Religião',
  judaismo: 'Religião',
  espirita: 'Religião',
  espírita: 'Religião',
  teologia: 'Religião',
  missao: 'Religião',
  missão: 'Religião',
  jesus: 'Religião',
  igreja: 'Religião',
  pastor: 'Religião',
  pastora: 'Religião',
  missionario: 'Religião',
  missionário: 'Religião',
  devocional: 'Religião',
  oracao: 'Religião',
  oração: 'Religião',
};

const RAW_EVIDENCE_SIGNALS: Record<string, string> = {
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
};

function buildAliasMap(): Map<string, MainCategoryCanonical> {
  const m = new Map<string, MainCategoryCanonical>();
  for (const [k, v] of Object.entries(RAW_ALIASES)) {
    const canon = v as MainCategoryCanonical;
    if (!(MAIN_CATEGORY_CANONICAL_LABELS as readonly string[]).includes(canon)) continue;
    m.set(foldMainCategoryKey(k), canon);
  }
  return m;
}

const ALIAS_FOLD_TO_CANONICAL = buildAliasMap();

const EVIDENCE_SIGNAL_TO_CATEGORY: Map<string, MainCategoryCanonical> = (() => {
  const m = new Map(ALIAS_FOLD_TO_CANONICAL);
  for (const [k, v] of Object.entries(RAW_EVIDENCE_SIGNALS)) {
    const canon = v as MainCategoryCanonical;
    if (!(MAIN_CATEGORY_CANONICAL_LABELS as readonly string[]).includes(canon)) continue;
    m.set(foldMainCategoryKey(k), canon);
  }
  return m;
})();

const CANONICAL_BY_FOLD: Map<string, MainCategoryCanonical> = new Map(
  MAIN_CATEGORY_CANONICAL_LABELS.map((c) => [foldMainCategoryKey(c), c])
);

function tokenSetForReuse(s: string): Set<string> {
  const out = new Set<string>();
  for (const part of foldMainCategoryKey(s).split(/[&]+/)) {
    for (const w of part.split(/\s+/)) {
      const t = w.trim();
      if (t.length >= 2) out.add(t);
    }
  }
  return out;
}

function jaccardTokenSimilarity(a: string, b: string): number {
  const ta = tokenSetForReuse(a);
  const tb = tokenSetForReuse(b);
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) {
    if (tb.has(t)) inter += 1;
  }
  const union = ta.size + tb.size - inter;
  return union > 0 ? inter / union : 0;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const row: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j]!;
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[n]!;
}

function levenshteinRatio(a: string, b: string): number {
  if (!a && !b) return 1;
  const d = levenshtein(a, b);
  return 1 - d / Math.max(a.length, b.length, 1);
}

function reuseMainCategoryLabel(candidate: string, pool: string[], minScore: number): string | null {
  const c = foldMainCategoryKey(candidate);
  if (!c || pool.length === 0) return null;
  let best: { label: string; score: number } | null = null;
  for (const label of pool) {
    if (!mainCategoryWithinWordBudget(label)) continue;
    const p = foldMainCategoryKey(label);
    if (!p) continue;
    let score: number;
    if (c === p) score = 1;
    else {
      const jac = jaccardTokenSimilarity(candidate, label);
      const lev = levenshteinRatio(c, p);
      if (p.length >= 5 && c.length >= 5 && (c.includes(p) || p.includes(c))) {
        score = Math.max(jac, lev, (Math.min(c.length, p.length) / Math.max(c.length, p.length)) * 0.94);
      } else {
        score = Math.max(jac * 0.98, lev * 0.92);
      }
    }
    if (
      score > (best?.score ?? 0) ||
      (best != null && Math.abs(score - best.score) < 1e-6 && label.length < best.label.length)
    ) {
      best = { label, score };
    }
  }
  if (best && best.score >= minScore) return best.label;
  return null;
}

/** Desempate quando duas categorias têm o mesmo score (nichos mais específicos antes de Lifestyle). */
const MAIN_CATEGORY_EVIDENCE_TIE_PRIORITY: readonly MainCategoryCanonical[] = [
  'Pets',
  'Política',
  'Religião',
  'Humor',
  'Música',
  'Esportes',
  'Games',
  'Automotivo',
  'Viagens',
  'Entretenimento',
  'Alimentação',
  'Maternidade',
  'Saúde',
  'Finanças',
  'Fitness',
  'Moda',
  'Beleza',
  'Tecnologia',
  'Educação',
  'Negócios',
  'Casa',
  /** Por ultimo: evita "caixao" quando empata com categorias mais especificas. */
  'Lifestyle',
] as const;

const MIN_FREE_TEXT_TOKEN_LEN = 3;

function tokenizeFreeTextForEvidenceSignals(text: string): string[] {
  const s = stripInvisible(String(text ?? '').trim());
  if (!s) return [];
  let nfc: string;
  try {
    nfc = s.normalize('NFC');
  } catch {
    nfc = s;
  }
  return nfc
    .toLowerCase()
    .split(/[^a-zà-áâãéêíóôõúüç0-9]+/iu)
    .map((p) => foldMainCategoryKey(p))
    .filter((p) => p.length >= MIN_FREE_TEXT_TOKEN_LEN);
}

function bumpEvidenceScore(scores: Map<MainCategoryCanonical, number>, cat: MainCategoryCanonical, delta: number): void {
  scores.set(cat, (scores.get(cat) ?? 0) + delta);
}

/** Pontuação só a partir do mapa fechado sub → main (V2). */
export function scoreSubCategoriesToMainCategories(subCategories: string[]): Map<MainCategoryCanonical, number> {
  const scores = new Map<MainCategoryCanonical, number>();
  for (const raw of subCategories) {
    for (const token of expandSubcategoryTokensForLookup(String(raw ?? '').trim())) {
      const mapped = SUBCATEGORY_FOLD_TO_MAIN.get(token);
      if (mapped) bumpEvidenceScore(scores, mapped, weightForSubcategoryTokenMatch(token));
    }
  }
  return scores;
}

function maxEvidenceScore(scores: Map<MainCategoryCanonical, number>): number {
  let m = 0;
  for (const v of scores.values()) m = Math.max(m, v);
  return m;
}

function pickCategoryAtMaxScoreWithTieBreak(scores: Map<MainCategoryCanonical, number>, maxScore: number): MainCategoryCanonical {
  const winners = MAIN_CATEGORY_CANONICAL_LABELS.filter((c) => (scores.get(c) ?? 0) === maxScore);
  if (winners.length === 0) return MAIN_CATEGORY_FALLBACK;
  for (const c of MAIN_CATEGORY_EVIDENCE_TIE_PRIORITY) {
    if (winners.includes(c)) return c;
  }
  return winners[0]!;
}

/**
 * Infere mainCategory a partir das subCategories usando apenas SUBCATEGORY_TO_MAIN.
 * Sem match → Lifestyle (fallback de vitrine).
 */
export function inferMainCategory(subCategories: string[]): MainCategoryCanonical {
  const scores = scoreSubCategoriesToMainCategories(subCategories);
  const maxScore = maxEvidenceScore(scores);
  if (maxScore === 0) return MAIN_CATEGORY_FALLBACK;
  return pickCategoryAtMaxScoreWithTieBreak(scores, maxScore);
}

/**
 * Se houver pelo menos uma sub mapeada e o main canônico divergir da inferência, corrige para a inferência.
 * Sem subs mapeadas: mantém o main já “snapped” para a taxonomia.
 */
export function validateMainCategoryAgainstSubCategories(main: string, subCategories: string[]): MainCategoryCanonical {
  const subScores = scoreSubCategoriesToMainCategories(subCategories);
  const maxSub = maxEvidenceScore(subScores);
  const snapped = snapMainCategoryToTaxonomy(main) ?? MAIN_CATEGORY_FALLBACK;
  if (maxSub === 0) return snapped;
  const inferred = pickCategoryAtMaxScoreWithTieBreak(subScores, maxSub);
  if (snapped !== inferred) return inferred;
  return snapped;
}

/**
 * Pontua cada categoria a partir de subCategories + texto (bio, nome, hashtags em linha única).
 * Cada token que bate em EVIDENCE_SIGNAL_TO_CATEGORY soma +1.
 */
export function scoreMainCategoriesFromEvidence(subCategories: string[], freeText: string): Map<MainCategoryCanonical, number> {
  const scores = new Map<MainCategoryCanonical, number>();
  for (const raw of subCategories) {
    for (const tok of expandSubcategoryTokensForLookup(String(raw ?? '').trim())) {
      const cat = SUBCATEGORY_FOLD_TO_MAIN.get(tok) ?? EVIDENCE_SIGNAL_TO_CATEGORY.get(tok);
      if (cat) bumpEvidenceScore(scores, cat, weightForSubcategoryTokenMatch(tok));
    }
  }
  for (const tok of tokenizeFreeTextForEvidenceSignals(freeText)) {
    const cat = EVIDENCE_SIGNAL_TO_CATEGORY.get(tok);
    if (cat) bumpEvidenceScore(scores, cat, weightForSubcategoryTokenMatch(tok));
  }
  return scores;
}

/**
 * Ajusta mainCategory já canônico (ex.: snap do LLM) para alinhar com evidências.
 * 1) Se alguma sub bater em SUBCATEGORY_TO_MAIN, o vencedor por score + desempate manda (evita Pets → Beleza).
 * 2) Senão, mesma lógica anterior: subs + texto livre vs snap do LLM.
 */
export function resolveMainCategoryWithEvidence(
  snappedMainCanonical: string,
  subCategories: string[],
  freeTextProfileContext: string
): MainCategoryCanonical {
  const subMapScores = scoreSubCategoriesToMainCategories(subCategories);
  const subMapMax = maxEvidenceScore(subMapScores);
  if (subMapMax > 0) {
    return pickCategoryAtMaxScoreWithTieBreak(subMapScores, subMapMax);
  }

  const scores = scoreMainCategoriesFromEvidence(subCategories, freeTextProfileContext);
  /** Sem nenhuma sub mapeada: texto livre nao deve empurrar Lifestyle com peso cheio (evita vitrine vazia). */
  const ls = scores.get('Lifestyle') ?? 0;
  if (ls > 0) scores.set('Lifestyle', Math.max(0, ls - 1));
  const maxScore = maxEvidenceScore(scores);
  const snapped = (MAIN_CATEGORY_CANONICAL_LABELS as readonly string[]).includes(snappedMainCanonical)
    ? (snappedMainCanonical as MainCategoryCanonical)
    : MAIN_CATEGORY_FALLBACK;
  if (maxScore === 0) return snapped;

  const snappedScore = scores.get(snapped) ?? 0;
  if (snappedScore >= maxScore) return snapped;

  return pickCategoryAtMaxScoreWithTieBreak(scores, maxScore);
}

/** Texto curto para o prompt: lista fechada com separador visual. */
export function formatMainCategoryTaxonomyForPrompt(): string {
  return MAIN_CATEGORY_CANONICAL_LABELS.join(' | ');
}

/**
 * Converte qualquer rótulo (novo ou legado) para um dos canônicos.
 * Usa aliases, igualdade dobrada e similaridade contra a lista fechada; fallback Lifestyle.
 */
export function snapMainCategoryToTaxonomy(raw: string): MainCategoryCanonical | null {
  const trimmed = stripInvisible(String(raw ?? '').trim());
  if (!trimmed) return null;
  let nfc: string;
  try {
    nfc = trimmed.normalize('NFC');
  } catch {
    nfc = trimmed;
  }
  if (nfc.length < 2 || nfc.length > 200) return null;
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(nfc)) return null;

  const fk = foldMainCategoryKey(nfc);
  const fromAlias = ALIAS_FOLD_TO_CANONICAL.get(fk);
  if (fromAlias) return fromAlias;

  const exact = CANONICAL_BY_FOLD.get(fk);
  if (exact) return exact;

  const pool = [...MAIN_CATEGORY_CANONICAL_LABELS];
  const r1 = reuseMainCategoryLabel(nfc, pool, MAIN_CATEGORY_SNAP_SCORE_HIGH);
  if (r1) return r1 as MainCategoryCanonical;

  const r2 = reuseMainCategoryLabel(nfc, pool, MAIN_CATEGORY_SNAP_SCORE_LOW);
  if (r2) return r2 as MainCategoryCanonical;

  /** Rótulos compostos do LLM ("Maternidade & Paternidade") — tenta cada segmento antes do fallback. */
  const compoundParts = nfc
    .split(/\s*(?:&|\/|,|\+|·|\be\b|\band\b)\s*/i)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2);
  if (compoundParts.length > 1) {
    for (const part of compoundParts) {
      const partSnap = snapMainCategoryToTaxonomy(part);
      if (partSnap && partSnap !== MAIN_CATEGORY_FALLBACK) return partSnap;
    }
  }

  return MAIN_CATEGORY_FALLBACK;
}

/** True se o texto, após normalização de dobra, corresponde a um rótulo canônico. */
export function isCanonicalMainCategoryLabel(value: string): boolean {
  return CANONICAL_BY_FOLD.has(foldMainCategoryKey(value));
}
