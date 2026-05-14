/**
 * Script que segue de volta os perfis que te seguem (follow-back).
 * Obtém a lista de seguidores do perfil logado, depois visita cada perfil e clica em "Seguir" quando aplicável.
 *
 * Cadência:
 * - Padrão: 15–60 s entre cada follow (máx 1 min). Use --delay-min/--delay-max ou env FOLLOW_DELAY_* para ajustar.
 * - Se o Instagram bloquear: use cadência mais lenta, ex. --delay-min 120000 --delay-max 300000 (2–5 min).
 *
 * Uso:
 *   INSTAGRAM_USER=seu_usuario tsx src/cli/follow-my-followers.ts
 *   tsx src/cli/follow-my-followers.ts --limit 20
 *   tsx src/cli/follow-my-followers.ts --dry-run
 *   tsx src/cli/follow-my-followers.ts --delay-min 120000 --delay-max 300000
 *   tsx src/cli/follow-my-followers.ts --fast   (15–60 s entre cada, até 1 min; maior risco de bloqueio)
 */
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { InstagramClient } from '../instagramClient/index.js';
import { getMyFollowers } from '../instagramClient/getMyFollowers.js';
import { followUser } from '../instagramClient/followUser.js';
import { rateLimitBackoff } from '../utils/delay.js';
import { logTimestamp } from '../utils/logTimestamp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_AUTH_PATH = path.join(BACKEND_ROOT, 'data', 'instagram-auth.json');

/** Delay entre um follow e o próximo (ms). Padrão até 1 min (15–60 s). Use --delay-min/--delay-max para cadência mais lenta. */
const DEFAULT_DELAY_MIN_MS = 15 * 1000;  // 15 s
const DEFAULT_DELAY_MAX_MS = 60 * 1000;  // 60 s (máx 1 min)
/** Modo --fast: mesmo que o padrão (15–60 s). Mantido por compatibilidade. */
const FAST_DELAY_MIN_MS = 15 * 1000;
const FAST_DELAY_MAX_MS = 60 * 1000;

function parseArgs(): {
  limit: number | undefined;
  dryRun: boolean;
  delayMinMs: number;
  delayMaxMs: number;
  maxScrolls: number;
  fast: boolean;
} {
  const argv = process.argv.slice(2);
  let limit: number | undefined;
  let dryRun = false;
  let fast = false;
  let delayMinMs = Math.max(0, parseInt(process.env.FOLLOW_DELAY_MIN_MS ?? String(DEFAULT_DELAY_MIN_MS), 10) || DEFAULT_DELAY_MIN_MS);
  let delayMaxMs = Math.max(delayMinMs, parseInt(process.env.FOLLOW_DELAY_MAX_MS ?? String(DEFAULT_DELAY_MAX_MS), 10) || DEFAULT_DELAY_MAX_MS);
  let maxScrolls = 50;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fast') {
      fast = true;
    } else if (a === '--limit' && argv[i + 1]) {
      const n = parseInt(argv[++i], 10);
      if (!Number.isNaN(n) && n > 0) limit = n;
    } else if (a.startsWith('--limit=')) {
      const n = parseInt(a.slice(8), 10);
      if (!Number.isNaN(n) && n > 0) limit = n;
    } else if (a === '--dry-run') {
      dryRun = true;
    } else if (a === '--delay-min' && argv[i + 1]) {
      const n = parseInt(argv[++i], 10);
      if (!Number.isNaN(n) && n >= 0) delayMinMs = n;
    } else if (a.startsWith('--delay-min=')) {
      const n = parseInt(a.slice(12), 10);
      if (!Number.isNaN(n) && n >= 0) delayMinMs = n;
    } else if (a === '--delay-max' && argv[i + 1]) {
      const n = parseInt(argv[++i], 10);
      if (!Number.isNaN(n) && n >= 0) delayMaxMs = n;
    } else if (a.startsWith('--delay-max=')) {
      const n = parseInt(a.slice(12), 10);
      if (!Number.isNaN(n) && n >= 0) delayMaxMs = n;
    } else if (a === '--max-scrolls' && argv[i + 1]) {
      const n = parseInt(argv[++i], 10);
      if (!Number.isNaN(n) && n > 0) maxScrolls = n;
    } else if (a.startsWith('--max-scrolls=')) {
      const n = parseInt(a.slice(14), 10);
      if (!Number.isNaN(n) && n > 0) maxScrolls = n;
    }
  }

  if (fast) {
    delayMinMs = FAST_DELAY_MIN_MS;
    delayMaxMs = FAST_DELAY_MAX_MS;
  }
  if (delayMaxMs < delayMinMs) delayMaxMs = delayMinMs;
  return { limit, dryRun, delayMinMs, delayMaxMs, maxScrolls, fast };
}

function delayBetweenFollows(minMs: number, maxMs: number): { waitMs: number; promise: Promise<void> } {
  const waitMs = minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
  return { waitMs, promise: new Promise((r) => setTimeout(r, waitMs)) };
}

/** Verifica se o valor parece ser e-mail em vez do username do Instagram. */
function looksLikeEmail(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v.includes('@') && (v.includes('.com') || v.includes('.br') || v.includes('.'));
}

async function main(): Promise<void> {
  // Perfil para abrir lista de seguidores: INSTAGRAM_PERFIL (username) ou INSTAGRAM_USER
  const profileUser = process.env.INSTAGRAM_PERFIL?.trim() || process.env.INSTAGRAM_USER?.trim();
  if (!profileUser) {
    console.error('Defina INSTAGRAM_PERFIL ou INSTAGRAM_USER no .env (nome de usuário do perfil, sem @).');
    process.exit(1);
  }
  if (looksLikeEmail(profileUser)) {
    console.error(
      'INSTAGRAM_PERFIL/INSTAGRAM_USER está com e-mail. Use o nome de usuário do Instagram (sem @).\n' +
      '  Exemplo: INSTAGRAM_PERFIL=meu_usuario (ou INSTAGRAM_USER=meu_usuario)'
    );
    process.exit(1);
  }

  const authPath = process.env.AUTH_STATE_PATH
    ? path.isAbsolute(process.env.AUTH_STATE_PATH)
      ? process.env.AUTH_STATE_PATH
      : path.resolve(BACKEND_ROOT, process.env.AUTH_STATE_PATH)
    : DEFAULT_AUTH_PATH;

  const { limit, dryRun, delayMinMs, delayMaxMs, maxScrolls, fast } = parseArgs();

  const client = new InstagramClient({
    headless: process.env.HEADFUL !== 'true',
    authStatePath: authPath,
  });

  try {
    console.log(`[follow-my-followers] ${logTimestamp()} Iniciando. Perfil: @${profileUser}. Cadência: ${delayMinMs / 1000}–${delayMaxMs / 1000} s entre follows.`);
    if (fast) console.log('[follow-my-followers] Modo --fast: intervalo curto (maior risco de bloqueio).');
    if (dryRun) console.log('[follow-my-followers] Modo --dry-run: só listar seguidores, não seguir.');

    const { usernames, error: listError } = await getMyFollowers(client, profileUser, maxScrolls);
    if (listError) {
      console.error('[follow-my-followers] Erro ao obter lista de seguidores:', listError);
      process.exit(1);
    }

    const toProcess = limit != null ? usernames.slice(0, limit) : usernames;
    console.log(`[follow-my-followers] Seguidores carregados: ${usernames.length}. A processar: ${toProcess.length}.`);

    if (dryRun) {
      toProcess.forEach((u, i) => console.log(`  ${i + 1}. @${u}`));
      console.log('[follow-my-followers] Dry-run concluído.');
      return;
    }

    let followed = 0;
    let already = 0;
    let errors = 0;

    for (let i = 0; i < toProcess.length; i++) {
      const handle = toProcess[i];
      const result = await followUser(client, handle);

      if (result.ok && result.alreadyFollowing) {
        already++;
      } else if (result.ok) {
        followed++;
      } else {
        errors++;
        console.error(`[follow-my-followers] Erro em @${handle}: ${result.error ?? 'unknown'}`);
        if (result.error?.includes('Sessão expirada') || result.error?.toLowerCase().includes('block')) {
          console.log('[follow-my-followers] Possível bloqueio. Aguardando backoff (15 min)...');
          await rateLimitBackoff();
        }
      }

      if (i < toProcess.length - 1) {
        const { waitMs, promise } = delayBetweenFollows(delayMinMs, delayMaxMs);
        console.log(`[follow-my-followers] Aguardando ${Math.round(waitMs / 1000)} s até o próximo (${i + 1}/${toProcess.length})...`);
        await promise;
      }
    }

    console.log(`[follow-my-followers] Concluído. Seguidos: ${followed}, já seguindo: ${already}, erros: ${errors}.`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
