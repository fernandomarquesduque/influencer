/**
 * Ponto de entrada: inicia o browser com o Instagram e a interface de coleta.
 * O usuário navega no Instagram; quando quiser, liga a coleta pela UI até parar.
 * Mac e Windows.
 */

import { resolve } from 'path';
import { existsSync } from 'fs';
import dotenv from 'dotenv';

const root = resolve(process.cwd());
if (existsSync(resolve(root, '.env'))) {
  dotenv.config({ path: resolve(root, '.env') });
}

import type { Page } from 'playwright';
import { InstagramClient } from './instagram.js';
import { loadConfig } from './config.js';
import { startServer } from './server.js';
import { getCollectorApiBase, isRemoteIngestConfigured } from './serverIngest.js';

/** Grava cookies no disco quando estiver logado — após navegar, a cada poucos minutos e ao sair (Ctrl+C). */
function setupSessionPersistence(client: InstagramClient, page: Page, authStatePath: string): void {
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let lastSaveLog = 0;

  const trySave = async (reason: string): Promise<void> => {
    try {
      const ok = await client.saveAuthStateIfLoggedIn();
      if (ok && Date.now() - lastSaveLog > 60_000) {
        console.log(`[Collector] Sessão salva (${reason}) → ${authStatePath}`);
        lastSaveLog = Date.now();
      }
    } catch (e) {
      console.warn('[Collector] Não foi possível salvar a sessão:', e instanceof Error ? e.message : e);
    }
  };

  const scheduleDebounced = (): void => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      void trySave('navegação');
    }, 10_000);
  };

  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) scheduleDebounced();
  });

  setInterval(() => {
    void trySave('automático (3 min)');
  }, 3 * 60 * 1000);

  let exiting = false;
  const shutdown = (): void => {
    if (exiting) return;
    exiting = true;
    void (async () => {
      await trySave('ao encerrar');
      console.log('[Collector] Encerrando…');
      await client.close();
      process.exit(0);
    })();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function main(): Promise<void> {
  const config = loadConfig();
  console.log('Influencer Collector — iniciando browser no Instagram...');
  console.log('Min seguidores:', config.minFollowersToSave, '| Min curtidas por post:', config.minPostLikesToSave, '| Posts com min curtidas:', config.minPostsWithMinLikesToSave);
  if (isRemoteIngestConfigured()) {
    console.log('Perfis serão enviados para a API (RocksDB no servidor):', getCollectorApiBase());
    console.log('Extração completa: timeline + abas Reels e Marcados (métricas/ER no site) — ~1–2 min por perfil.');
  } else {
    console.log('API remota não configurada — perfis só na lista local. Veja COLLECTOR_API_BASE e COLLECTOR_INGEST_KEY no .env.');
  }
  console.log('');

  const client = new InstagramClient({
    headless: config.headless,
    authStatePath: config.authStatePath,
  });

  await client.init();
  const page = await client.newPage();
  await page.goto(InstagramClient.homeFeedUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 });

  const currentUrl = page.url();
  if (currentUrl.includes('/accounts/login/') || currentUrl.includes('/challenge/')) {
    console.log('Faça login manualmente na janela do browser que abriu.');
    console.log('A sessão será salva automaticamente em:', config.authStatePath);
    console.log('Na próxima vez você já entra logado (mesmo caminho no .env: AUTH_STATE_PATH).');
  } else {
    console.log('Instagram aberto (sessão restaurada). Navegue à vontade.');
  }

  setupSessionPersistence(client, page, config.authStatePath);
  startServer(client, page);
  console.log('Sessão: gravada ao navegar, a cada ~3 min e ao sair com Ctrl+C.');
  console.log('Para encerrar: Ctrl+C (recomendado para salvar antes de fechar).');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
