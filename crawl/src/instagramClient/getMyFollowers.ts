import type { Page } from 'playwright';
import { InstagramClient } from './index.js';
import { randomDelay } from '../utils/delay.js';
import { logTimestamp } from '../utils/logTimestamp.js';

const DEBUG = process.env.FOLLOW_DEBUG === 'true';
const EVAL_TIMEOUT_MS = 12_000; // page.evaluate pode travar; limite por chamada

function log(msg: string): void {
  if (DEBUG) console.log(`[getMyFollowers] ${msg}`);
}

function logStep(t0: number, msg: string): void {
  console.log(`[getMyFollowers] ${logTimestamp()} +${Date.now() - t0}ms ${msg}`);
}

/** Rejeita após ms com mensagem (para detectar onde travou). */
function withTimeout<T>(p: Promise<T>, ms: number, step: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Travou em: ${step} (timeout ${ms / 1000}s)`)), ms)
    ),
  ]);
}

/** Fecha modais de notificação (Ativar notificações, etc.) que atrapalham. */
async function dismissModals(page: Page, maxAttempts = 2): Promise<void> {
  const notNow = [
    'div._a9-z button:has-text("Agora não")',
    'div._a9-z button:has-text("Not Now")',
    '[role="dialog"] button:has-text("Agora não")',
    '[role="dialog"] button:has-text("Not Now")',
  ];
  for (let i = 0; i < maxAttempts; i++) {
    for (const sel of notNow) {
      try {
        const btn = page.locator(sel).first();
        if ((await btn.count()) > 0) {
          await btn.click({ timeout: 2000 });
          await randomDelay(200, 400);
          break;
        }
      } catch {
        // ignore
      }
    }
  }
}

const INVALID_USERNAMES = new Set(['explore', 'direct', 'reel', 'stories', 'accounts', 'p', 'reels', 'challenge']);

/**
 * Extrai usernames dos links no modal de seguidores.
 * Aceita href como /username/ ou /username (e ignora query string).
 * Considera apenas links que parecem perfil (um único segmento no path).
 */
function extractUsernamesFromDialog(page: Page): Promise<string[]> {
  return page.evaluate((invalidSet: string[]) => {
    const invalid = new Set(invalidSet);
    const dialogs = document.querySelectorAll('div[role="dialog"]');
    const dialog = dialogs.length > 1 ? dialogs[dialogs.length - 1] : dialogs[0];
    if (!dialog) return [];
    const links = dialog.querySelectorAll<HTMLAnchorElement>('a[href^="/"]');
    const seen = new Set<string>();
    for (const a of links) {
      const href = (a.getAttribute('href') || '').trim().split('?')[0];
      // /username ou /username/
      const match = href.match(/^\/([^/]+)\/?$/);
      if (!match) continue;
      const user = match[1].toLowerCase();
      if (invalid.has(user) || /^\d+$/.test(user)) continue;
      seen.add(user);
    }
    return Array.from(seen);
  }, Array.from(INVALID_USERNAMES));
}

/**
 * Encontra o elemento scrollável dentro do dialog e rola.
 * Limita a 25 divs para não travar (getComputedStyle em muitos nós é lento).
 */
async function scrollFollowersList(page: Page, scrollPauseMs = 600): Promise<void> {
  await page.evaluate(async (pauseMs: number) => {
    const dialogs = document.querySelectorAll('div[role="dialog"]');
    const dialog = dialogs.length > 1 ? dialogs[dialogs.length - 1] : dialogs[0];
    if (!dialog) return;
    const divs = Array.from(dialog.querySelectorAll('div')).slice(0, 25);
    let scrollable: HTMLElement | null = null;
    for (const d of divs) {
      const style = window.getComputedStyle(d);
      if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && d.scrollHeight > d.clientHeight) {
        scrollable = d;
        break;
      }
    }
    const target = (scrollable ?? dialog.querySelector('div[role="presentation"]') ?? dialog) as HTMLElement;
    target.scrollTop = target.scrollHeight;
    await new Promise<void>((r) => setTimeout(r, pauseMs));
  }, scrollPauseMs);
}

/**
 * Abre o perfil do usuário logado, clica em "Seguidores", abre o modal,
 * rola a lista para carregar mais e retorna os usernames dos seguidores.
 * @param client InstagramClient com sessão logada
 * @param myUsername Nome de usuário do perfil logado (ex.: INSTAGRAM_USER)
 * @param maxScrolls Quantidade de rolagens no modal (cada uma carrega mais ~12 itens)
 */
/** Verifica se o valor parece ser e-mail (use o username do Instagram, não o e-mail). */
function looksLikeEmail(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v.includes('@') && (v.includes('.com') || v.includes('.br') || v.includes('.'));
}

export async function getMyFollowers(
  client: InstagramClient,
  myUsername: string,
  maxScrolls = 50
): Promise<{ usernames: string[]; error?: string }> {
  const clean = myUsername.replace(/^@/, '').trim().toLowerCase();
  if (!clean) return { usernames: [], error: 'Username vazio' };
  if (looksLikeEmail(clean)) {
    return { usernames: [], error: 'Use só o nome de usuário do Instagram (sem @), não o e-mail de login.' };
  }

  const t0 = Date.now();
  const profileUrl = InstagramClient.profileUrl(clean);
  const TIMEOUT_MS = 2 * 60 * 1000; // 2 min total

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Timeout após ${TIMEOUT_MS / 1000}s. O script pode ter travado na página ou no modal.`)), TIMEOUT_MS);
  });

  const work = (async (): Promise<{ usernames: string[]; error?: string }> => {
    logStep(t0, 'Abrindo browser/page...');
  const page = await withTimeout(client.newPage(), 30_000, 'client.newPage()');

  try {
    logStep(t0, `Abrindo perfil @${clean}...`);
    await withTimeout(
      page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }),
      25_000,
      'page.goto(perfil)'
    );
    await randomDelay(1000, 2000);

    if (page.url().includes('/accounts/login') || page.url().includes('/challenge/')) {
      return { usernames: [], error: 'Sessão expirada. Faça login novamente.' };
    }

    logStep(t0, 'Fechando modais de notificação (se houver)...');
    await withTimeout(dismissModals(page), 8000, 'dismissModals');

    // Link "X seguidores" no perfil (href pode ser /user/followers/ ou /user/followers)
    logStep(t0, 'Procurando link "Seguidores"...');
    const followersLink = page.locator('main a[href*="followers"]').first();
    await withTimeout(followersLink.waitFor({ state: 'visible', timeout: 10000 }), 12_000, 'waitFor(link Seguidores)').catch(() => null);
    if ((await followersLink.count()) === 0) {
      return { usernames: [], error: 'Link "Seguidores" não encontrado no perfil (verifique se está no perfil correto e se a página carregou).' };
    }
    logStep(t0, 'Clicando em "Seguidores"...');
    await withTimeout(followersLink.click({ timeout: 8000 }), 10_000, 'click(Seguidores)');
    await randomDelay(2000, 3500);

    // Esperar o dialog abrir
    logStep(t0, 'Aguardando modal de seguidores...');
    const dialog = page.locator('div[role="dialog"]').first();
    await withTimeout(dialog.waitFor({ state: 'visible', timeout: 12000 }), 14_000, 'waitFor(dialog)').catch(() => null);
    if ((await dialog.count()) === 0) {
      return { usernames: [], error: 'Modal de seguidores não abriu.' };
    }

    // Esperar aparecer pelo menos um link de perfil dentro do modal (lista carregou)
    for (let w = 0; w < 15; w++) {
      const first = await withTimeout(extractUsernamesFromDialog(page), EVAL_TIMEOUT_MS, 'extrair usernames (aguardando lista)');
      if (first.length > 0) {
        logStep(t0, `Modal OK; ${first.length} usuário(s) visível(is) na primeira carga.`);
        break;
      }
      if (w === 5 || w === 10) {
        logStep(t0, `Aguardando lista no modal... (tentativa ${w + 1}/15)`);
      }
      await randomDelay(500, 800);
    }

    logStep(t0, 'Rolando lista para carregar mais...');

    const allUsernames = new Set<string>();
    let lastCount = 0;
    let sameCountTurns = 0;

    for (let s = 0; s < maxScrolls; s++) {
      logStep(t0, `Rolagem ${s + 1}/${maxScrolls} — extraindo...`);
      const current = await withTimeout(extractUsernamesFromDialog(page), EVAL_TIMEOUT_MS, `extrair usernames (rolagem ${s + 1})`);
      current.forEach((u) => allUsernames.add(u));

      if ((s + 1) % 5 === 0 || s === 0) {
        logStep(t0, `Rolagem ${s + 1}/${maxScrolls} — ${allUsernames.size} usuário(s) até agora.`);
      }

      if (allUsernames.size === lastCount) {
        sameCountTurns++;
        if (sameCountTurns >= 3) {
          logStep(t0, `Parando rolagem: sem novos itens após ${sameCountTurns} rolagens.`);
          break;
        }
      } else {
        sameCountTurns = 0;
      }
      lastCount = allUsernames.size;

      logStep(t0, `Rolagem ${s + 1}/${maxScrolls} — rolando...`);
      await withTimeout(scrollFollowersList(page, 500 + Math.random() * 300), EVAL_TIMEOUT_MS, `scroll (rolagem ${s + 1})`);
      await randomDelay(200, 500);
    }

    const usernames = Array.from(allUsernames);
    if (usernames.length === 0) {
      logStep(t0, 'Nenhum usuário extraído do modal. Pode ser layout diferente ou lista vazia.');
      return { usernames: [], error: 'Nenhum seguidor encontrado no modal. Tente FOLLOW_DEBUG=true para diagnóstico.' };
    }
    logStep(t0, `Lista de seguidores obtida: ${usernames.length} usuários.`);
    return { usernames };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    logStep(t0, `Erro: ${err}`);
    return { usernames: [], error: err };
  } finally {
    await page.close().catch(() => {});
  }
  })();

  return Promise.race([work, timeoutPromise]).catch((e) => {
    const err = e instanceof Error ? e.message : String(e);
    logStep(t0, err);
    return { usernames: [], error: err };
  });
}

/** Log callback opcional (ex.: do sendDM) para manter um único prefixo de tempo. */
export type LogStepFn = (msg: string) => void;

/**
 * Verifica se o handle está na lista de SEGUIDORES do usuário logado (modal Seguidores).
 * Abre o perfil do myUsername, clica em "Seguidores", usa a busca do modal e verifica se targetHandle aparece.
 * Se aparecer (é seguidor) e tiver botão/link "Seguir", clica (seguir de volta).
 * Regra correta para DM: só enviar se estiver aqui na lista (eles te seguem).
 */
export async function isHandleMyFollower(
  client: InstagramClient,
  myUsername: string,
  targetHandle: string,
  logStepFn?: LogStepFn
): Promise<{ isFollower: boolean; followedBack?: boolean; error?: string }> {
  const myUser = myUsername.replace(/^@/, '').trim().toLowerCase();
  const target = targetHandle.replace(/^@/, '').trim().toLowerCase();
  if (!myUser || !target) return { isFollower: false, error: 'myUsername e targetHandle obrigatórios' };
  if (looksLikeEmail(myUser)) return { isFollower: false, error: 'Use o username do Instagram (não e-mail) em INSTAGRAM_PERFIL.' };

  const step = logStepFn ?? ((msg: string) => logStep(0, msg));
  const page = await client.newPage();
  try {
    step(`Verificando se @${target} está na sua lista de seguidores...`);
    const profileUrl = InstagramClient.profileUrl(myUser);
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await randomDelay(1000, 1800);
    if (page.url().includes('/accounts/login') || page.url().includes('/challenge/')) {
      return { isFollower: false, error: 'Sessão expirada.' };
    }
    await dismissModals(page);

    const followersLink = page.locator('main a[href*="followers"]').first();
    await followersLink.waitFor({ state: 'visible', timeout: 10000 }).catch(() => null);
    if ((await followersLink.count()) === 0) {
      return { isFollower: false, error: 'Link "Seguidores" não encontrado.' };
    }
    await followersLink.click({ timeout: 5000 });
    await randomDelay(1800, 2800);

    const dialog = page.locator('div[role="dialog"]').first();
    await dialog.waitFor({ state: 'visible', timeout: 12000 }).catch(() => null);
    if ((await dialog.count()) === 0) {
      return { isFollower: false, error: 'Modal de seguidores não abriu.' };
    }

    const searchSelectors = [
      'div[role="dialog"] input[placeholder*="Pesquisar"]',
      'div[role="dialog"] input[placeholder*="Search"]',
      'div[role="dialog"] input[type="text"]',
      'div[role="dialog"] input[aria-label*="Pesquisar"]',
      'div[role="dialog"] input[aria-label*="Search"]',
    ];
    let searchInput: ReturnType<Page['locator']> | null = null;
    for (const sel of searchSelectors) {
      const el = page.locator(sel).first();
      if ((await el.count()) > 0) {
        try {
          await el.waitFor({ state: 'visible', timeout: 2000 });
          searchInput = el;
          break;
        } catch {
          continue;
        }
      }
    }
    if (!searchInput) {
      step('Campo de busca do modal não encontrado; verificando lista visível...');
    } else {
      await searchInput.click();
      await randomDelay(100, 200);
      await searchInput.fill(target);
      await randomDelay(800, 1400);
    }

    const usernames = await extractUsernamesFromDialog(page);
    const isFollower = usernames.some((u) => u.toLowerCase() === target);
    if (!isFollower) {
      step(`@${target} não está na sua lista de seguidores. Não enviando DM.`);
      return { isFollower: false, error: 'Este perfil não te segue (não está na lista de seguidores); mensagem iria para spam.' };
    }

    step(`@${target} é seguidor. Procurando botão "Seguir" para seguir de volta...`);
    const seguirLinks = page.locator('div[role="dialog"]').getByRole('link', { name: /^\s*•?\s*Seguir\s*$/i });
    const followLinksEn = page.locator('div[role="dialog"]').getByRole('link', { name: /^\s*•?\s*Follow\s*$/i });
    let followedBack = false;
    for (const loc of [seguirLinks.first(), followLinksEn.first()]) {
      if ((await loc.count()) > 0) {
        try {
          await loc.click({ timeout: 4000 });
          await randomDelay(400, 700);
          step('Seguir de volta clicado.');
          followedBack = true;
          break;
        } catch {
          continue;
        }
      }
    }

    return { isFollower: true, followedBack };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    step(`Erro ao verificar seguidor: ${err}`);
    return { isFollower: false, error: err };
  } finally {
    await page.close().catch(() => {});
  }
}
