import type { Page } from 'playwright';
import { InstagramClient } from './index.js';
import { randomDelay } from '../utils/delay.js';
import { logTimestamp } from '../utils/logTimestamp.js';

const DEBUG = process.env.FOLLOW_DEBUG === 'true';

function log(msg: string): void {
  if (DEBUG) console.log(`[followUser] ${msg}`);
}

/** Log sempre visível quando executar follow-back no request-code. */
function logStep(t0: number, msg: string): void {
  console.log(`[followUser] ${logTimestamp()} +${Date.now() - t0}ms ${msg}`);
}

/** Textos que indicam que já seguimos (não clicar). */
const ALREADY_FOLLOWING_TEXTS = ['seguindo', 'following', 'solicitado', 'requested', 'message', 'mensagem'];

/**
 * Verifica se o texto do botão é de ação de seguir.
 * Instagram mostra "Seguir de volta" quando o usuário nos segue e ainda não o seguimos.
 * Não confunde com "Seguindo"/"Following" (só match exato para "seguir"/"follow").
 */
function isFollowButtonText(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t === 'seguir' || t === 'follow') return true;
  if (t === 'seguir de volta' || t.startsWith('seguir de volta')) return true;
  if (t === 'follow back' || t.startsWith('follow back')) return true;
  return false;
}

function isAlreadyFollowingButtonText(text: string): boolean {
  const t = text.trim().toLowerCase();
  return ALREADY_FOLLOWING_TEXTS.some((x) => t.includes(x) || t === x);
}

/**
 * Na página atual (perfil do Instagram), procura o botão "Seguir de volta" / "Follow back" e clica.
 * No Instagram Web o botão pode ser <button>, div[role="button"] ou link.
 */
export async function followUserFromCurrentPage(page: Page): Promise<{ ok: boolean; alreadyFollowing?: boolean; error?: string }> {
  const t0 = Date.now();
  try {
    await randomDelay(500, 1000);
    await page.waitForSelector('main', { state: 'visible', timeout: 8000 }).catch(() => null);

    // 1) Clicar por texto visível "Seguir de volta" / "Follow back" (button, link ou elemento com o texto)
    const followBackSelectors = [
      page.getByRole('button', { name: /seguir de volta|follow back/i }),
      page.getByRole('link', { name: /seguir de volta|follow back/i }),
      page.locator('main').getByText(/seguir de volta|follow back/i).first(),
    ];
    for (const loc of followBackSelectors) {
      try {
        const first = loc.first();
        if ((await first.count()) > 0) {
          const text = (await first.textContent({ timeout: 1000 }))?.trim() ?? '';
          if (isAlreadyFollowingButtonText(text)) {
            logStep(t0, `Botão encontrado mas já seguindo: "${text.substring(0, 20)}"`);
            return { ok: true, alreadyFollowing: true };
          }
          logStep(t0, `Clicando em "${text.substring(0, 30)}"...`);
          await first.click({ timeout: 5000, force: true });
          await randomDelay(400, 800);
          logStep(t0, 'Follow-back executado.');
          return { ok: true };
        }
      } catch {
        continue;
      }
    }

    // 2) Varredura por role="button" e botões em main (evitar clicar em "Solicitado" etc.)
    const followButtonSelectors = [
      'main section div[role="button"]',
      'main header div[role="button"]',
      'main article header div[role="button"]',
      'main button',
    ];
    for (const selector of followButtonSelectors) {
      const buttons = page.locator(selector);
      const count = await buttons.count();
      for (let i = 0; i < Math.min(count, 8); i++) {
        const btn = buttons.nth(i);
        try {
          const text = (await btn.textContent({ timeout: 500 }))?.trim() ?? '';
          if (isAlreadyFollowingButtonText(text)) {
            logStep(t0, `Botão encontrado mas já seguindo: "${text.substring(0, 20)}"`);
            return { ok: true, alreadyFollowing: true };
          }
          if (isFollowButtonText(text)) {
            logStep(t0, `Clicando em "${text.substring(0, 25)}" (seletor: ${selector}, índice ${i})...`);
            await btn.click({ timeout: 5000 });
            await randomDelay(400, 800);
            logStep(t0, 'Follow-back executado.');
            return { ok: true };
          }
        } catch {
          continue;
        }
      }
    }

    // 3) Fallback getByRole com nome exato
    for (const label of ['Seguir de volta', 'Follow back', 'Seguir', 'Follow']) {
      try {
        const btn = page.getByRole('button', { name: label }).first();
        if ((await btn.count()) > 0) {
          const text = (await btn.textContent({ timeout: 500 }))?.trim() ?? '';
          if (!isFollowButtonText(text)) continue;
          await btn.click({ timeout: 5000 });
          await randomDelay(400, 800);
          logStep(t0, `Follow-back executado (getByRole "${label}").`);
          return { ok: true };
        }
      } catch {
        continue;
      }
    }
    logStep(t0, 'Nenhum botão "Seguir" / "Seguir de volta" encontrado (pode já estar seguindo).');
    return { ok: true, alreadyFollowing: true };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    logStep(t0, `Erro: ${err}`);
    return { ok: false, error: err };
  }
}

/**
 * Abre o perfil do usuário, executa follow-back se o botão for "Seguir"/"Follow", e fecha a página.
 * Use quando não tiver a página do perfil aberta (ex.: fluxo que confia no cache "segue perfil").
 */
export async function followUser(
  client: InstagramClient,
  handle: string
): Promise<{ ok: boolean; alreadyFollowing?: boolean; error?: string }> {
  const cleanHandle = handle.replace(/^@/, '').trim().toLowerCase();
  if (!cleanHandle) return { ok: false, error: 'Handle vazio' };
  const t0 = Date.now();
  logStep(t0, `Abrindo perfil @${cleanHandle} para follow-back...`);
  const profileUrl = InstagramClient.profileUrl(cleanHandle);
  const page = await client.newPage();
  try {
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await randomDelay(1000, 2000);
    if (page.url().includes('/accounts/login') || page.url().includes('/challenge/')) {
      return { ok: false, error: 'Sessão expirada. Faça login novamente.' };
    }
    const result = await followUserFromCurrentPage(page);
    return result;
  } finally {
    await page.close().catch(() => {});
  }
}
