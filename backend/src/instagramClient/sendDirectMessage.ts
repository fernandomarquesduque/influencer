import type { Page } from 'playwright';
import { InstagramClient } from './index.js';
import { randomDelay } from '../utils/delay.js';
import { logTimestamp } from '../utils/logTimestamp.js';
import { isHandleMyFollower } from './getMyFollowers.js';

const INSTAGRAM_ORIGIN = 'https://www.instagram.com';
const DIRECT_NEW_URL = `${INSTAGRAM_ORIGIN}/direct/new/`;
const DEBUG = process.env.DM_DEBUG === 'true';

export type DmSendOptions = {
  skipFollowerListCheck?: boolean;
  /** Sem delays humanos, timeouts menores, uma tentativa de envio (cadastro/dev). */
  fast?: boolean;
};

function dmDelay(minMs: number, maxMs: number, fast?: boolean): Promise<void> {
  if (fast) return Promise.resolve();
  return randomDelay(minMs, maxMs);
}

function dmTimeout(ms: number, fast?: boolean): number {
  if (!fast) return ms;
  // fast: ainda precisa tempo para UI do Direct montar (0.35x quebrava o campo de busca)
  if (ms >= 2500) return 2000;
  if (ms >= 1500) return 1200;
  return Math.max(600, Math.round(ms * 0.55));
}

const DIRECT_SEARCH_SELECTORS = [
  'div[role="dialog"] input[name="queryBox"]',
  'div[role="dialog"] input[placeholder*="Pesquisar"]',
  'div[role="dialog"] input[placeholder*="Search"]',
  'input[name="queryBox"]',
  'input[placeholder*="Pesquisar"]',
  'input[placeholder*="Search"]',
  'input[placeholder*="search"]',
  'input[aria-label*="Search"]',
  'input[aria-label*="Pesquisar"]',
];

async function openDirectComposer(page: Page, t0: number, fast?: boolean, modalAttempts = 3): Promise<void> {
  try {
    const sendMessageBtn = page
      .locator('div[role="button"]:has-text("Enviar mensagem"), div[role="button"]:has-text("Send message")')
      .first();
    await sendMessageBtn.click({ timeout: dmTimeout(1200, fast) });
    log('clicado em Enviar mensagem (tela vazia)');
    await dmDelay(80, 200, fast);
    await dismissModals(page, modalAttempts, fast);
  } catch {
    // já no composer ou botão com outro layout
  }
}

async function findDirectSearchInput(
  page: Page,
  t0: number,
  fast?: boolean
): Promise<ReturnType<Page['locator']> | null> {
  const perSelector = dmTimeout(2500, fast);
  for (let round = 0; round < (fast ? 3 : 2); round++) {
    if (round > 0) {
      logStep(t0, `Campo busca: nova tentativa ${round + 1}...`);
      await openDirectComposer(page, t0, fast, fast ? 1 : 3);
      if (fast) await page.waitForTimeout(400);
      else await randomDelay(200, 400);
    }
    for (let i = 0; i < DIRECT_SEARCH_SELECTORS.length; i++) {
      const sel = DIRECT_SEARCH_SELECTORS[i];
      const el = page.locator(sel).first();
      if ((await el.count()) === 0) continue;
      try {
        const tWait = Date.now();
        await el.waitFor({ state: 'visible', timeout: perSelector });
        logStep(t0, `Campo busca seletor ${i + 1}/${DIRECT_SEARCH_SELECTORS.length} OK em ${Date.now() - tWait}ms`);
        log(`campo de busca encontrado: ${sel}`);
        return el;
      } catch {
        logStep(t0, `Campo busca seletor ${i + 1}/${DIRECT_SEARCH_SELECTORS.length} falhou`);
      }
    }
  }
  return null;
}

function log(msg: string): void {
  if (DEBUG) console.log(`[sendDM] ${msg}`);
}

/** Log sempre visível (para acompanhar request-code). Formato: ddMMyyyyHHmmss +Xms msg */
function logStep(t0: number, msg: string): void {
  console.log(`[sendDM] ${logTimestamp()} +${Date.now() - t0}ms ${msg}`);
}

/** Fecha modais do Instagram (notificações "Ativar notificações", salvar login, etc.) que bloqueiam cliques. */
async function dismissModals(page: Page, maxAttempts = 3, fast?: boolean): Promise<void> {
  const notNowSelectors = [
    // Modal "Ativar notificações" (container _a9-z com botão "Agora não")
    'div._a9-z button._a9_1',
    'div._a9-z button:has-text("Agora não")',
    'div._a9-z button:has-text("Not Now")',
    'div._a9-z button:has-text("Not now")',
    'button._a9_1',
    'button:has-text("Agora não")',
    'button:has-text("Not Now")',
    'button:has-text("Not now")',
    '[role="dialog"] button:has-text("Agora não")',
    '[role="dialog"] button:has-text("Not Now")',
  ];
  for (let i = 0; i < maxAttempts; i++) {
    let closed = false;
    for (const sel of notNowSelectors) {
      try {
        const btn = page.locator(sel).first();
        if ((await btn.count()) > 0) {
          await btn.waitFor({ state: 'visible', timeout: dmTimeout(1000, fast) }).catch(() => {});
          await btn.click({ timeout: dmTimeout(2000, fast) });
          log(`modal fechado: ${sel}`);
          closed = true;
          await dmDelay(150, 300, fast);
          break;
        }
      } catch {
        // ignore
      }
    }
    if (!closed) break;
  }
}

/**
 * Envia uma mensagem direct (inbox) do Instagram para o usuário com o handle informado.
 * Requer sessão logada (auth state em data/instagram-auth.json).
 * @param client InstagramClient já com auth state carregado
 * @param handle Nickname do Instagram (sem @)
 * @param message Texto da mensagem a enviar (pode ser vazio se imagePath for informado)
 * @param imagePath Caminho opcional para arquivo de imagem a anexar
 */
export async function sendDirectMessage(
  client: InstagramClient,
  handle: string,
  message: string,
  imagePath?: string,
  options?: DmSendOptions
): Promise<{ ok: boolean; error?: string }> {
  const fast = options?.fast === true;
  const cleanHandle = handle.replace(/^@/, '').trim().toLowerCase();
  if (!cleanHandle) {
    return { ok: false, error: 'Handle é obrigatório' };
  }
  if (!message.trim() && !imagePath) {
    return { ok: false, error: 'Informe a mensagem ou anexe uma imagem' };
  }
  const textToSend = message.trim() || ' ';

  const t0 = Date.now();
  logStep(t0, `Iniciando para @${cleanHandle}`);
  if (!options?.skipFollowerListCheck && !fast) {
    const myUsername = (process.env.INSTAGRAM_PERFIL ?? process.env.INSTAGRAM_USER ?? '').toString().trim();
    if (!myUsername) {
      return { ok: false, error: 'Configure INSTAGRAM_PERFIL ou INSTAGRAM_USER para verificar lista de seguidores.' };
    }
    const followCheck = await isHandleMyFollower(client, myUsername, cleanHandle, (msg) => logStep(t0, msg));
    if (!followCheck.isFollower) {
      return { ok: false, error: followCheck.error ?? 'Perfil não está na sua lista de seguidores; mensagem iria para spam.' };
    }
    logStep(t0, 'Verificação OK (perfil está na lista de seguidores). Abrindo Direct...');
  } else {
    logStep(t0, 'Pulando verificação da lista de seguidores (já confirmado na extração). Abrindo Direct...');
  }
  const page = await client.newPage();
  try {
    log(`abrindo ${DIRECT_NEW_URL}`);
    logStep(t0, 'Abrindo /direct/new/...');
    const directTimeout = fast
      ? 8000
      : Math.max(8000, parseInt(process.env.DIRECT_PAGE_TIMEOUT_MS ?? '12000', 10) || 12000);
    await page.goto(DIRECT_NEW_URL, { waitUntil: 'domcontentloaded', timeout: directTimeout });
    logStep(t0, 'Página direct carregada.');
    await dmDelay(200, 400, fast);

    const currentUrl = page.url();
    if (currentUrl.includes('/accounts/login') || currentUrl.includes('/challenge/')) {
      logStep(t0, 'Redirecionado para login/challenge — sessão expirada.');
      return { ok: false, error: 'Sessão do Instagram expirada ou não logada. Faça login novamente (npm run login no crawl).' };
    }

    logStep(t0, 'Fechando modais...');
    const modalAttempts = fast ? 1 : 3;
    await dismissModals(page, modalAttempts, fast);
    await dmDelay(100, 250, fast);
    if (!fast) await dismissModals(page, modalAttempts, fast);

    if (fast) await page.waitForTimeout(450);
    logStep(t0, 'Procurando botão Enviar mensagem ou campo de busca...');
    await openDirectComposer(page, t0, fast, modalAttempts);

    const searchInput = await findDirectSearchInput(page, t0, fast);
    if (!searchInput) {
      logStep(t0, 'Campo de busca não encontrado.');
      return { ok: false, error: 'Não foi possível encontrar o campo de busca do Direct.' };
    }
    logStep(t0, 'Campo de busca encontrado, digitando handle...');
    await searchInput.click();
    await dmDelay(50, 120, fast);
    await searchInput.fill(cleanHandle);
    await dmDelay(200, 400, fast);

    logStep(t0, 'Clicando no resultado do usuário...');
    // Clicar no resultado do usuário (sugestões dentro do dialog)
    const userResultSelectors = [
      `div[role="dialog"] a[href*="/${cleanHandle}/"]`,
      `div[role="dialog"] div[role="button"]:has-text("${cleanHandle}")`,
      `div[role="dialog"] [role="option"]:has-text("${cleanHandle}")`,
      `a[href*="/${cleanHandle}/"]`,
      `div[role="dialog"] span:has-text("${cleanHandle}")`,
      `div[role="button"]:has-text("${cleanHandle}")`,
      `[role="option"]:has-text("${cleanHandle}")`,
    ];
    let userClicked = false;
    for (let i = 0; i < userResultSelectors.length; i++) {
      const sel = userResultSelectors[i];
      try {
        const el = page.locator(sel).first();
        const tWait = Date.now();
        await el.waitFor({ state: 'visible', timeout: dmTimeout(2500, fast) });
        logStep(t0, `Resultado usuário seletor ${i + 1}/${userResultSelectors.length} visível em ${Date.now() - tWait}ms`);
        await el.click();
        userClicked = true;
        logStep(t0, `Usuário clicado (seletor ${i + 1})`);
        log(`usuário selecionado: ${sel}`);
        break;
      } catch {
        logStep(t0, `Resultado usuário seletor ${i + 1}/${userResultSelectors.length} falhou`);
        continue;
      }
    }
    if (!userClicked) {
      logStep(t0, 'Usuário não encontrado na busca.');
      return { ok: false, error: `Usuário @${cleanHandle} não encontrado na busca. Verifique o nickname ou se já existe conversa.` };
    }
    logStep(t0, 'Usuário selecionado, avançando para conversa...');
    await dmDelay(100, 200, fast);

    // Botão "Conversa" / "Chat" no dialog para avançar para o composer da mensagem
    try {
      const chatBtn = page.locator('div[role="dialog"] div[role="button"]:has-text("Conversa"), div[role="dialog"] div[role="button"]:has-text("Chat")').first();
      await chatBtn.click({ timeout: dmTimeout(2500, fast) });
      log('clicado em Conversa');
      await dmDelay(80, 180, fast);
    } catch {
      // Pode já ter avançado ou o botão ter outro texto
    }

    // Esperar a conversa carregar e fechar modais de novo
    await dmDelay(150, 350, fast);
    logStep(t0, `Aguardando URL /direct/ (timeout ${fast ? '1.5' : '4'}s)...`);
    try {
      const tUrl = Date.now();
      await page.waitForURL(/\/direct\//, { timeout: fast ? 1500 : 4000 }).catch(() => { });
      logStep(t0, `URL /direct/ OK em ${Date.now() - tUrl}ms`);
    } catch {
      // ignore
    }
    await dismissModals(page, modalAttempts, fast);
    await dmDelay(120, 250, fast);

    // Anexar imagem se fornecida (input file no composer do Direct)
    if (imagePath) {
      logStep(t0, 'Anexando imagem...');
      try {
        const fileInput = page.locator('input[type="file"]').first();
        await fileInput.waitFor({ state: 'attached', timeout: dmTimeout(5000, fast) }).catch(() => null);
        if ((await fileInput.count()) > 0) {
          await fileInput.setInputFiles(imagePath);
          logStep(t0, 'Imagem anexada.');
          await dmDelay(500, 1000, fast);
        } else {
          logStep(t0, 'Input file não encontrado; enviando só o texto.');
        }
      } catch (e) {
        logStep(t0, `Anexo de imagem falhou (continuando sem): ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    logStep(t0, 'Procurando campo de mensagem...');

    const messageInputSelectors = [
      'div[contenteditable="true"][aria-label*="Message"]',
      'div[contenteditable="true"][aria-label*="Mensagem"]',
      'div[contenteditable="true"][data-lexical-editor="true"]',
      'div[role="textbox"]',
      'div[contenteditable="true"]',
      'p[data-placeholder]',
      'textarea[placeholder*="Message"]',
      'textarea[placeholder*="Mensagem"]',
      '[contenteditable="true"]',
    ];
    // Botão Enviar: div[role="button"] com texto costuma funcionar primeiro (DOM atual do Instagram)
    const sendSelectors = [
      'div[role="button"]:has-text("Enviar")',
      'div[role="button"]:has-text("Send")',
      'button:has(svg[aria-label="Enviar"]), button:has(svg[aria-label="Send"])',
      'div[role="button"]:has(svg[aria-label="Enviar"]), div[role="button"]:has(svg[aria-label="Send"])',
      'button:has-text("Enviar")',
      'button:has-text("Send")',
      'svg[aria-label="Enviar"]',
      'svg[aria-label="Send"]',
    ];

    const maxSendAttempts = fast ? 1 : 3;
    let lastError: string | undefined;

    for (let attempt = 1; attempt <= maxSendAttempts; attempt++) {
      logStep(t0, `Tentativa envio ${attempt}/${maxSendAttempts}`);
      log(`tentativa de envio ${attempt}/${maxSendAttempts}`);
      if (attempt > 1) {
        await dismissModals(page, modalAttempts, fast);
        await dmDelay(200, 400, fast);
      }

      let messageInput: ReturnType<Page['locator']> | null = null;
      const msgTimeout = dmTimeout(attempt === 1 ? 5000 : 3000, fast);
      for (let i = 0; i < messageInputSelectors.length; i++) {
        const sel = messageInputSelectors[i];
        const el = page.locator(sel).first();
        if ((await el.count()) > 0) {
          try {
            const tMsg = Date.now();
            await el.waitFor({ state: 'visible', timeout: msgTimeout });
            logStep(t0, `Campo mensagem seletor ${i + 1}/${messageInputSelectors.length} OK em ${Date.now() - tMsg}ms`);
            messageInput = el;
            log(`campo de mensagem encontrado: ${sel}`);
            break;
          } catch {
            logStep(t0, `Campo mensagem seletor ${i + 1}/${messageInputSelectors.length} falhou (timeout ${msgTimeout}ms)`);
            continue;
          }
        }
      }
      if (!messageInput) {
        lastError = 'Não foi possível encontrar o campo de mensagem.';
        logStep(t0, 'Campo mensagem: nenhum seletor funcionou');
        continue;
      }

      try {
        logStep(t0, 'Clicando no campo e preenchendo mensagem...');
        const tFill = Date.now();
        await messageInput.click();
        await dmDelay(30, 80, fast);
        if (textToSend.trim()) {
          try {
            await messageInput.fill(textToSend);
          } catch {
            await messageInput.pressSequentially(textToSend, { delay: fast ? 0 : 15 });
          }
        }
        logStep(t0, `Mensagem preenchida em ${Date.now() - tFill}ms`);
        await dmDelay(40, 100, fast);
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        logStep(t0, `Erro ao preencher: ${lastError}`);
        continue;
      }

      // Botão Enviar fica habilitado logo após digitar; espera curta e clica
      await dmDelay(50, 120, fast);
      logStep(t0, 'Procurando botão Enviar...');
      let sendClicked = false;
      for (let i = 0; i < sendSelectors.length; i++) {
        const sel = sendSelectors[i];
        try {
          const btn = page.locator(sel).first();
          const tSend = Date.now();
          await btn.waitFor({ state: 'visible', timeout: dmTimeout(1500, fast) });
          await btn.click();
          logStep(t0, `Botão Enviar seletor ${i + 1}/${sendSelectors.length} OK em ${Date.now() - tSend}ms`);
          sendClicked = true;
          log(`botão Enviar clicado: ${sel}`);
          break;
        } catch {
          logStep(t0, `Botão Enviar seletor ${i + 1}/${sendSelectors.length} falhou`);
          continue;
        }
      }
      if (!sendClicked) {
        // Última tentativa: clicar em qualquer svg Enviar/Send com force (pode estar coberto)
        logStep(t0, 'Tentando svg force como fallback...');
        try {
          const tSvg = Date.now();
          const sendIcon = page.locator('svg[aria-label="Enviar"], svg[aria-label="Send"]').first();
          await sendIcon.click({ force: true, timeout: dmTimeout(2000, fast) });
          logStep(t0, `Botão Enviar (svg force) OK em ${Date.now() - tSvg}ms`);
          sendClicked = true;
          log('botão Enviar clicado (svg force)');
        } catch {
          logStep(t0, 'Botão Enviar (svg force) falhou');
          // ignore
        }
      }
      if (sendClicked) {
        await dmDelay(150, 300, fast);
        logStep(t0, `Concluído em ${Date.now() - t0}ms (ok=true).`);
        logStep(t0, 'Fechando página...');
        return { ok: true };
      }
      lastError = 'Não foi possível encontrar o botão Enviar.';
    }

    logStep(t0, `Concluído em ${Date.now() - t0}ms (ok=false): ${lastError}`);
    return { ok: false, error: lastError ?? 'Falha ao enviar após várias tentativas.' };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    logStep(t0, `ERRO: ${err}`);
    log(`erro: ${err}`);
    return { ok: false, error: err };
  } finally {
    const tClose = Date.now();
    await page.close().catch(() => { });
    logStep(t0, `Página fechada em ${Date.now() - tClose}ms`);
  }
}

/**
 * Envia o código de ativação 2FA para o handle via Direct.
 * Mensagem padrão: "Seu código de ativação: XXXXXX"
 */
export async function sendVerificationCode(
  client: InstagramClient,
  handle: string,
  code: string,
  options?: DmSendOptions
): Promise<{ ok: boolean; error?: string }> {
  const text = `Seu código de ativação: ${code}`;
  return sendDirectMessage(client, handle, text, undefined, options);
}
