import type { Page } from 'playwright';
import { InstagramClient } from './index.js';
import { randomDelay } from '../utils/delay.js';

const INSTAGRAM_ORIGIN = 'https://www.instagram.com';
const DIRECT_NEW_URL = `${INSTAGRAM_ORIGIN}/direct/new/`;
const DEBUG = process.env.DM_DEBUG === 'true';

function log(msg: string): void {
  if (DEBUG) console.log(`[sendDM] ${msg}`);
}

/** Fecha modais do Instagram (notificações "Ativar notificações", salvar login, etc.) que bloqueiam cliques. */
async function dismissModals(page: Page, maxAttempts = 5): Promise<void> {
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
          await btn.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
          await btn.click({ timeout: 3000 });
          log(`modal fechado: ${sel}`);
          closed = true;
          await randomDelay(150, 300);
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
 * @param message Texto da mensagem a enviar
 */
export async function sendDirectMessage(
  client: InstagramClient,
  handle: string,
  message: string
): Promise<{ ok: boolean; error?: string }> {
  const cleanHandle = handle.replace(/^@/, '').trim().toLowerCase();
  if (!cleanHandle || !message.trim()) {
    return { ok: false, error: 'Handle e mensagem são obrigatórios' };
  }

  const page = await client.newPage();
  try {
    log(`abrindo ${DIRECT_NEW_URL}`);
    await page.goto(DIRECT_NEW_URL, { waitUntil: 'domcontentloaded', timeout: 2000 });
    await randomDelay(400, 700);

    const currentUrl = page.url();
    if (currentUrl.includes('/accounts/login') || currentUrl.includes('/challenge/')) {
      return { ok: false, error: 'Sessão do Instagram expirada ou não logada. Faça login novamente (npm run login no crawl).' };
    }

    // Fecha modal "Ativar notificações" e outros que aparecem após carregar
    await dismissModals(page);
    await randomDelay(200, 400);
    await dismissModals(page);

    // Tela "Suas mensagens" vazia: clicar em "Enviar mensagem" para abrir o composer (campo de busca)
    try {
      const sendMessageBtn = page.locator('div[role="button"]:has-text("Enviar mensagem"), div[role="button"]:has-text("Send message")').first();
      await sendMessageBtn.click({ timeout: 3000 });
      log('clicado em Enviar mensagem (tela vazia)');
      await randomDelay(150, 300);
      await dismissModals(page);
    } catch {
      // Não está na tela vazia ou já no composer
    }

    // Modal "Nova mensagem" (role=dialog) – campo de busca "Para:" / "To:"
    const searchSelectors = [
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
    let searchInput: ReturnType<Page['locator']> | null = null;
    for (const sel of searchSelectors) {
      const el = page.locator(sel).first();
      if ((await el.count()) > 0) {
        try {
          await el.waitFor({ state: 'visible', timeout: 3000 });
          searchInput = el;
          log(`campo de busca encontrado: ${sel}`);
          break;
        } catch {
          continue;
        }
      }
    }
    if (!searchInput) {
      return { ok: false, error: 'Não foi possível encontrar o campo de busca do Direct.' };
    }

    await searchInput.click();
    await randomDelay(50, 120);
    await searchInput.fill(cleanHandle);
    await randomDelay(200, 400);

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
    for (const sel of userResultSelectors) {
      try {
        const el = page.locator(sel).first();
        await el.waitFor({ state: 'visible', timeout: 3000 });
        await el.click();
        userClicked = true;
        log(`usuário selecionado: ${sel}`);
        break;
      } catch {
        continue;
      }
    }
    if (!userClicked) {
      return { ok: false, error: `Usuário @${cleanHandle} não encontrado na busca. Verifique o nickname ou se já existe conversa.` };
    }

    await randomDelay(150, 300);

    // Botão "Conversa" / "Chat" no dialog para avançar para o composer da mensagem
    try {
      const chatBtn = page.locator('div[role="dialog"] div[role="button"]:has-text("Conversa"), div[role="dialog"] div[role="button"]:has-text("Chat")').first();
      await chatBtn.click({ timeout: 3000 });
      log('clicado em Conversa');
      await randomDelay(150, 300);
    } catch {
      // Pode já ter avançado ou o botão ter outro texto
    }

    // Esperar a conversa carregar e fechar modais de novo
    await randomDelay(250, 500);
    try {
      await page.waitForURL(/\/direct\//, { timeout: 5000 }).catch(() => { });
    } catch {
      // ignore
    }
    await dismissModals(page);
    await randomDelay(120, 250);

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
    // Botão Enviar: pode ser texto ou ícone (avião); clicar no botão que contém o ícone
    const sendSelectors = [
      'button:has(svg[aria-label="Enviar"]), button:has(svg[aria-label="Send"])',
      'div[role="button"]:has(svg[aria-label="Enviar"]), div[role="button"]:has(svg[aria-label="Send"])',
      'button:has-text("Enviar")',
      'button:has-text("Send")',
      'div[role="button"]:has-text("Enviar")',
      'div[role="button"]:has-text("Send")',
      'svg[aria-label="Enviar"]',
      'svg[aria-label="Send"]',
    ];

    const maxSendAttempts = 3;
    let lastError: string | undefined;

    for (let attempt = 1; attempt <= maxSendAttempts; attempt++) {
      log(`tentativa de envio ${attempt}/${maxSendAttempts}`);
      if (attempt > 1) {
        await dismissModals(page);
        await randomDelay(200, 400);
      }

      let messageInput: ReturnType<Page['locator']> | null = null;
      for (const sel of messageInputSelectors) {
        const el = page.locator(sel).first();
        if ((await el.count()) > 0) {
          try {
            await el.waitFor({ state: 'visible', timeout: attempt === 1 ? 5000 : 3000 });
            messageInput = el;
            log(`campo de mensagem encontrado: ${sel}`);
            break;
          } catch {
            continue;
          }
        }
      }
      if (!messageInput) {
        lastError = 'Não foi possível encontrar o campo de mensagem.';
        continue;
      }

      try {
        await messageInput.click();
        await randomDelay(30, 80);
        try {
          await messageInput.fill(message);
        } catch {
          await messageInput.pressSequentially(message, { delay: 15 });
        }
        await randomDelay(40, 100);
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        continue;
      }

      // Botão Enviar fica habilitado logo após digitar; espera curta e clica
      await randomDelay(50, 120);
      let sendClicked = false;
      for (const sel of sendSelectors) {
        try {
          const btn = page.locator(sel).first();
          await btn.waitFor({ state: 'visible', timeout: 1500 });
          await btn.click();
          sendClicked = true;
          log(`botão Enviar clicado: ${sel}`);
          break;
        } catch {
          continue;
        }
      }
      if (!sendClicked) {
        // Última tentativa: clicar em qualquer svg Enviar/Send com force (pode estar coberto)
        try {
          const sendIcon = page.locator('svg[aria-label="Enviar"], svg[aria-label="Send"]').first();
          await sendIcon.click({ force: true, timeout: 2000 });
          sendClicked = true;
          log('botão Enviar clicado (svg force)');
        } catch {
          // ignore
        }
      }
      if (sendClicked) {
        await randomDelay(150, 300);
        return { ok: true };
      }
      lastError = 'Não foi possível encontrar o botão Enviar.';
    }

    return { ok: false, error: lastError ?? 'Falha ao enviar após várias tentativas.' };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log(`erro: ${err}`);
    return { ok: false, error: err };
  } finally {
    await page.close().catch(() => { });
  }
}

/**
 * Envia o código de ativação 2FA para o handle via Direct.
 * Mensagem padrão: "Seu código de ativação: XXXXXX"
 */
export async function sendVerificationCode(
  client: InstagramClient,
  handle: string,
  code: string
): Promise<{ ok: boolean; error?: string }> {
  const text = `Seu código de ativação: ${code}`;
  return sendDirectMessage(client, handle, text);
}
