import type { Page } from 'playwright';
import { InstagramClient } from './index.js';

const LOGIN_URL = 'https://www.instagram.com/accounts/login/';
const DEBUG = process.env.LOGIN_DEBUG === 'true';

function log(msg: string): void {
  if (DEBUG) console.log(`[login] ${msg}`);
}

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((r) => setTimeout(r, ms));
}

async function dismissSaveLoginOrNotifications(page: Page): Promise<void> {
  const notNowSelectors = [
    'button:has-text("Not Now")',
    'button:has-text("Agora não")',
    'button:has-text("Not now")',
    '[role="button"]:has-text("Not Now")',
    '[role="button"]:has-text("Agora não")',
  ];
  for (const sel of notNowSelectors) {
    try {
      const btn = page.locator(sel).first();
      if ((await btn.count()) > 0) {
        await btn.click({ timeout: 3000 });
        await randomDelay(1000, 2000);
      }
    } catch {
      // ignore
    }
  }
}

async function fillLoginForm(page: Page, username: string, password: string): Promise<void> {
  const userSelectors: [string, () => ReturnType<Page['locator']>][] = [
    ['form#login_form input[name="email"]', () => page.locator('form#login_form input[name="email"]')],
    ['input[name="email"]', () => page.locator('input[name="email"]')],
    ['label Número de celular...', () => page.getByLabel('Número de celular, nome de usuário ou email')],
    ['label Phone number...', () => page.getByLabel('Phone number, username, or email')],
    ['input[name="username"]', () => page.locator('input[name="username"]')],
    ['placeholder phone|username...', () => page.getByPlaceholder(/phone|username|email|telefone|usuário/i)],
  ];
  const typeHumanLike = async (el: ReturnType<Page['locator']>, text: string, delayMs: number = 80): Promise<void> => {
    await el.fill('');
    for (const char of text) {
      await el.pressSequentially(char, { delay: delayMs + Math.floor(Math.random() * 40) });
    }
  };

  let userFilled = false;
  for (const [name, fn] of userSelectors) {
    try {
      const el = fn();
      await el.waitFor({ state: 'visible', timeout: 5000 });
      await el.click();
      await randomDelay(300, 600);
      await typeHumanLike(el, username, 100);
      await el.dispatchEvent('input');
      await el.dispatchEvent('change');
      log(`usuário preenchido via: ${name}`);
      userFilled = true;
      break;
    } catch (e) {
      log(`usuário seletor ${name} falhou: ${e instanceof Error ? e.message : e}`);
      continue;
    }
  }
  if (!userFilled) throw new Error('Nenhum campo de usuário encontrado');
  await randomDelay(500, 1000);

  const passSelectors: [string, () => ReturnType<Page['locator']>][] = [
    ['form#login_form input[name="pass"]', () => page.locator('form#login_form input[name="pass"]')],
    ['input[name="pass"]', () => page.locator('input[name="pass"]')],
    ['label Senha', () => page.getByLabel('Senha')],
    ['label Password', () => page.getByLabel('Password')],
    ['input[name="password"]', () => page.locator('input[name="password"]')],
    ['placeholder password|senha', () => page.getByPlaceholder(/password|senha/i)],
  ];
  let passFilled = false;
  for (const [name, fn] of passSelectors) {
    try {
      const el = fn();
      await el.waitFor({ state: 'visible', timeout: 3000 });
      await el.click();
      await randomDelay(300, 600);
      await typeHumanLike(el, password, 90);
      await el.dispatchEvent('input');
      await el.dispatchEvent('change');
      log(`senha preenchida via: ${name}`);
      passFilled = true;
      break;
    } catch (e) {
      log(`senha seletor ${name} falhou: ${e instanceof Error ? e.message : e}`);
      continue;
    }
  }
  if (!passFilled) throw new Error('Nenhum campo de senha encontrado');
  await randomDelay(800, 1500);
  try {
    const passEl = page.locator('form#login_form input[name="pass"], form#login_form input[name="password"]').first();
    if ((await passEl.count()) > 0) await passEl.focus();
  } catch {
    // ignore
  }
  await randomDelay(300, 500);
}

async function clickLoginButton(page: Page): Promise<void> {
  await randomDelay(1000, 2000);
  const form = page.locator('form#login_form');
  const btn = form.locator('div[role="button"]').filter({ hasText: /Entrar|Log in/i }).first();

  const waitForLeaveLogin = (): Promise<boolean> =>
    page.waitForURL(/instagram\.com\/(?!accounts\/login)/, { timeout: 25000 }).then(() => true).catch(() => false);

  const trySubmitWithNavigation = async (name: string, trigger: () => Promise<unknown>): Promise<boolean> => {
    const navPromise = waitForLeaveLogin();
    try {
      await trigger();
      const left = await navPromise;
      if (left) log(`navegação detectada após ${name}`);
      return left;
    } catch (e) {
      log(`${name} falhou: ${e instanceof Error ? e.message : e}`);
      return false;
    }
  };

  if ((await btn.count()) > 0) {
    await btn.waitFor({ state: 'visible', timeout: 3000 });
    if (await trySubmitWithNavigation('clique no botão', () => btn.click({ timeout: 5000 }))) return;
  }

  const passInput = form.locator('input[name="pass"], input[name="password"]').first();
  if ((await passInput.count()) > 0) {
    await passInput.focus().catch(() => { });
    await randomDelay(200, 400);
    if (await trySubmitWithNavigation('Enter', () => page.keyboard.press('Enter'))) return;
  }

  await form.evaluate((f: HTMLFormElement) => f.requestSubmit()).catch(() => { });
  log('requestSubmit() chamado; aguardando possível navegação');
  await randomDelay(5000, 8000);
}

export async function loginWithCredentials(
  client: InstagramClient,
  username: string,
  password: string
): Promise<boolean> {
  const page = await client.newPage();
  try {
    log('navegando para login');
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await randomDelay(2500, 5000);
    const currentUrlAfterGoto = page.url();
    log(`página carregada: ${currentUrlAfterGoto}`);

    const isAuthFlowUrl = (u: string) =>
      u.includes('/accounts/login') || u.includes('/challenge/') || u.includes('/auth_platform/') || u.includes('codeentry');
    if (!isAuthFlowUrl(currentUrlAfterGoto)) {
      log('já logado (redirect para home)');
      await client.saveAuthState();
      return true;
    }

    await fillLoginForm(page, username, password);
    log('formulário preenchido');
    await clickLoginButton(page);
    log('clique Entrar enviado');

    await randomDelay(8000, 12000);

    const leftLoginAndChallenge = (url: URL) => !isAuthFlowUrl(url.href);

    const isChallengePage = async (): Promise<boolean> => {
      const u = page.url();
      if (u.includes('/challenge/') || u.includes('/auth_platform/') || u.includes('codeentry')) return true;
      try {
        const body = await page.locator('body').textContent().catch(() => '');
        const hasCodeText = /código|code|verificação|confirmation|segurança|security|two.factor|2fa|digite|enter/i.test(body ?? '');
        const codeInput = await page.locator('input[type="text"][name*="code"], input[placeholder*="code"], input[placeholder*="código"], input[autocomplete="one-time-code"]').first().count() > 0;
        return !!(hasCodeText || codeInput);
      } catch {
        return false;
      }
    };

    let urlChanged = await page.waitForURL(leftLoginAndChallenge, { timeout: 5000 }).then(() => true).catch(() => false);
    if (!urlChanged) {
      const onChallenge = isAuthFlowUrl(page.url()) || (await isChallengePage());
      if (onChallenge) {
        console.log('[login] Tela de código de verificação (2FA) detectada. Digite o código no navegador e confirme. Aguardando até 10 min...');
        urlChanged = await page.waitForURL(leftLoginAndChallenge, { timeout: 600000 }).then(() => true).catch(() => false);
        if (!urlChanged) {
          console.log('[login] Timeout aguardando código de verificação.');
          return false;
        }
      } else {
        urlChanged = await page.waitForURL(leftLoginAndChallenge, { timeout: 15000 }).then(() => true).catch(() => false);
      }
    }
    log(`URL mudou (saiu do login/challenge): ${urlChanged}, atual: ${page.url()}`);

    await randomDelay(2000, 4000);
    await dismissSaveLoginOrNotifications(page);

    const currentUrl = page.url();
    log(`URL final: ${currentUrl}`);
    if (isAuthFlowUrl(currentUrl)) {
      const errSelectors = [
        '[role="alert"]',
        '[id*="slfErrorAlert"]',
        'div[class*="error"]',
        'div[class*="ErrorMessage"]',
      ];
      for (const sel of errSelectors) {
        try {
          const el = page.locator(sel).first();
          if ((await el.count()) > 0) {
            const errText = (await el.textContent())?.trim().slice(0, 300) || null;
            if (errText) {
              log(`erro na página: ${errText}`);
              if (errText.toLowerCase().includes('senha') || errText.toLowerCase().includes('password') || errText.toLowerCase().includes('incorrect')) {
                console.error('Instagram indicou senha incorreta. Verifique INSTAGRAM_USER e INSTAGRAM_PASSWORD no .env');
              }
            }
          }
        } catch {
          // ignore
        }
      }
      return false;
    }
    await client.saveAuthState();
    return true;
  } catch (e) {
    log(`erro: ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  } finally {
    await page.close().catch(() => { });
  }
}

export async function ensureLoggedIn(
  client: InstagramClient,
  username: string,
  password: string
): Promise<boolean> {
  const page = await client.newPage();
  try {
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3000);
    const currentUrl = page.url();
    const isLoginPage = currentUrl.includes('/accounts/login');
    if (isLoginPage) {
      await page.close().catch(() => { });
      return loginWithCredentials(client, username, password);
    }
    return true;
  } catch {
    return false;
  } finally {
    await page.close().catch(() => { });
  }
}
