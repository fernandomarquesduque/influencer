/**
 * Insere projetos de exemplo no banco para validar o frontend (lista e detalhe).
 * Uso: npx tsx scripts/seed-projects.ts (a partir da pasta crawl)
 */
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { SqliteSync } from '../src/storage/sqliteSync.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const crawlRoot = path.resolve(__dirname, '..');
const dbPath = process.env.SQLITE_DB_PATH ?? path.join(crawlRoot, 'data', 'influencer.db');

const PROJECTS = [
  {
    title: 'Campanha de lançamento – linha de skincare',
    description: `Precisamos de influenciadores de beleza e lifestyle para o lançamento da nossa nova linha de skincare vegana.

O que precisamos:
- 3 a 5 posts no feed (fotos e Reels)
- 3 a 5 stories ao longo da campanha
- Menção à marca e uso da hashtag #MarcaSkincare

Período: 2 semanas a partir da aprovação.
Produtos serão enviados gratuitamente para teste.`,
    client_name: 'Beleza Natural Cosméticos',
    budget_min: 1500,
    budget_max: 5000,
    category: 'beleza',
    requirements: 'Mínimo 5k seguidores. Perfil alinhado a beleza, autocuidado ou lifestyle. Conteúdo em português.',
    status: 'open',
  },
  {
    title: 'Parceria para divulgação de app de fitness',
    description: `Buscamos criadores de conteúdo de fitness e saúde para divulgar nosso app de treinos em casa.

Entregas:
- 1 Reel mostrando uso do app (treino de 15–20 min)
- 5 stories ao longo da primeira semana
- 1 post no feed com depoimento

O app oferece planos mensais e anuais; a divulgação deve destacar a facilidade e os resultados.`,
    client_name: 'FitHome App',
    budget_min: 800,
    budget_max: 2500,
    category: 'fitness',
    requirements: 'Perfil focado em treinos, emagrecimento ou vida saudável. Seguidores engajados. Preferência para quem já grava treinos.',
    status: 'open',
  },
  {
    title: 'Influenciador para viagem – pacote Fernando de Noronha',
    description: `Agência de viagens procura influenciador para campanha em Fernando de Noronha.

Inclui:
- Hospedagem 4 noites (acompanhante incluso)
- Passeios (mergulho, trilhas)
- Em contrapartida: 2 Reels, 10 stories e 2 posts no feed durante e após a viagem

Foco em experiência, paisagem e dicas para quem planeja visitar o destino.`,
    client_name: 'Noronha Experience',
    budget_min: null,
    budget_max: null,
    category: 'viagem',
    requirements: 'Perfil de viagem, lifestyle ou aventura. Conteúdo de qualidade. Aceitamos permuta (pacote) como forma de pagamento principal.',
    status: 'open',
  },
  {
    title: 'Parceria longa – moda feminina (primavera/verão)',
    description: `Marca de roupas femininas busca influenciadoras para coleção primavera/verão.

Proposta:
- 4 posts no feed (looks da coleção)
- 4 Reels (unboxing, dicas de combinação, etc.)
- Stories semanais durante 2 meses

Envio de peças para o guarda-roupa. Valores a combinar conforme alcance e engajamento.`,
    client_name: 'Ateliê Maria',
    budget_min: 3000,
    budget_max: 8000,
    category: 'moda',
    requirements: 'Público majoritariamente feminino. Estética alinhada à marca (minimalista, tons neutros e naturais). Mínimo 10k seguidores.',
    status: 'open',
  },
  {
    title: 'Reels para rede de food delivery',
    description: `Rede de delivery de comida saudável quer Reels mostrando pratos do cardápio e a experiência de pedir pelo app.

Entregas por mês:
- 4 Reels (1 por semana) com prato diferente
- Refeição cortesia para o influenciador em cada gravação

Tema: praticidade, sabor e opções saudáveis no dia a dia.`,
    client_name: 'Bowl & Go',
    budget_min: 500,
    budget_max: 1500,
    category: 'food',
    requirements: 'Perfil de gastronomia, dieta ou lifestyle. Boa qualidade de vídeo. Disponibilidade para retirada/entrega na região atendida.',
    status: 'open',
  },
  {
    title: 'Campanha encerrada – produto tech (referência)',
    description: 'Campanha de lançamento de fone de ouvido já realizada. Projeto mantido no sistema apenas como referência de projeto encerrado.',
    client_name: 'TechSound Brasil',
    budget_min: 2000,
    budget_max: 4000,
    category: 'tech',
    requirements: 'Perfil tech ou gaming. Campanha já finalizada.',
    status: 'closed',
  },
];

function main() {
  const sqlite = new SqliteSync(dbPath);
  let inserted = 0;
  for (const p of PROJECTS) {
    try {
      sqlite.createProject({
        title: p.title,
        description: p.description,
        client_name: p.client_name,
        budget_min: p.budget_min ?? null,
        budget_max: p.budget_max ?? null,
        category: p.category,
        requirements: p.requirements,
        status: p.status,
      });
      inserted++;
      console.log('[seed-projects] Inserido:', p.title.slice(0, 50) + '...');
    } catch (e) {
      console.error('[seed-projects] Erro ao inserir:', p.title, e);
    }
  }
  sqlite.close();
  console.log('[seed-projects] Total inserido:', inserted, 'projetos.');
}

main();
