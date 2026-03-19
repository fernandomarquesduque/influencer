/**
 * Cliente Instagram com Playwright — inicia o browser e abre o Instagram.
 * Compatível com Mac e Windows.
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { readFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { existsSync } from 'fs';

const INSTAGRAM_ORIGIN = 'https://www.instagram.com';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface InstagramClientOptions {
  headless?: boolean;
  authStatePath?: string;
}

export class InstagramClient {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private readonly headless: boolean;
  private readonly authStatePath: string;

  constructor(options: InstagramClientOptions = {}) {
    this.headless = options.headless ?? true;
    this.authStatePath = options.authStatePath ?? 'data/instagram-auth.json';
  }

  async init(): Promise<void> {
    if (this.browser) return;
    const launchTimeout = process.env.PLAYWRIGHT_LAUNCH_TIMEOUT
      ? parseInt(process.env.PLAYWRIGHT_LAUNCH_TIMEOUT, 10)
      : 60000;
    const args = [
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-extensions',
      '--no-first-run',
      '--mute-audio',
    ];
    const baseOptions = {
      headless: this.headless,
      args,
      timeout: launchTimeout,
    };
    const channel = process.env.PLAYWRIGHT_CHROME_CHANNEL?.trim();
    if (channel) {
      this.browser = await chromium.launch({ ...baseOptions, channel } as Parameters<typeof chromium.launch>[0]);
      return;
    }
    if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) {
      this.browser = await chromium.launch({
        ...baseOptions,
        executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
      } as Parameters<typeof chromium.launch>[0]);
      return;
    }
    this.browser = await chromium.launch(baseOptions as Parameters<typeof chromium.launch>[0]);
  }

  private async getContext(): Promise<BrowserContext> {
    await this.init();
    if (!this.browser) throw new Error('Browser not initialized');
    if (this.context) return this.context;
    let state: string | undefined;
    if (this.authStatePath && existsSync(this.authStatePath)) {
      try {
        state = await readFile(this.authStatePath, 'utf-8');
      } catch {
        state = undefined;
      }
    }
    this.context = await this.browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1280, height: 720 },
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
      storageState: state ? JSON.parse(state) : undefined,
    });
    return this.context;
  }

  async newPage(): Promise<Page> {
    const ctx = await this.getContext();
    return ctx.newPage();
  }

  /**
   * Garante uma página utilizável para a coleta (goto etc.).
   * Se o usuário fechou o Chromium ou a aba, relança browser e/ou abre nova aba com sessão do disco.
   */
  async ensurePageForCollection(current: Page | null): Promise<Page> {
    const needLaunch = !this.browser || !this.browser.isConnected();
    if (needLaunch) {
      await this.close();
      await this.init();
      const p = await this.newPage();
      await p.goto(InstagramClient.homeFeedUrl(), { waitUntil: 'domcontentloaded', timeout: 30000 });
      return p;
    }
    if (current && !current.isClosed()) {
      try {
        await current.evaluate(() => true);
        return current;
      } catch {
        /* corrida: fechou durante o evaluate */
      }
    }
    try {
      const ctx = await this.getContext();
      const p = await ctx.newPage();
      await p.goto(InstagramClient.homeFeedUrl(), { waitUntil: 'domcontentloaded', timeout: 30000 });
      return p;
    } catch {
      this.context = null;
      const p = await this.newPage();
      await p.goto(InstagramClient.homeFeedUrl(), { waitUntil: 'domcontentloaded', timeout: 30000 });
      return p;
    }
  }

  async saveAuthState(): Promise<void> {
    if (!this.context) return;
    const dir = dirname(this.authStatePath);
    if (dir && dir !== '.') {
      await mkdir(dir, { recursive: true });
    }
    await this.context.storageState({ path: this.authStatePath });
  }

  /** Só grava se estiver logado (evita sobrescrever sessão salva com estado vazio). */
  async saveAuthStateIfLoggedIn(): Promise<boolean> {
    if (!this.context) return false;
    const cookies = await this.context.cookies();
    const hasSession = cookies.some(
      (c) => c.name === 'sessionid' && (c.domain.includes('instagram.com') || c.domain === '.instagram.com')
    );
    if (!hasSession) return false;
    await this.saveAuthState();
    return true;
  }

  async close(): Promise<void> {
    if (this.context) {
      await this.context.close().catch(() => { });
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close().catch(() => { });
      this.browser = null;
    }
  }

  static profileUrl(handle: string): string {
    const clean = handle.replace(/^@/, '').trim();
    return `${INSTAGRAM_ORIGIN}/${clean}/`;
  }

  static tagUrl(tag: string): string {
    const clean = tag.replace(/^#/, '').trim();
    return `${INSTAGRAM_ORIGIN}/explore/search/keyword/?q=${encodeURIComponent(clean)}`;
  }

  /** href relativo ou absoluto → URL completa (post/reel/perfil). */
  static absoluteUrl(href: string): string {
    const path = href.split('?')[0] ?? href;
    if (path.startsWith('http')) return path;
    return INSTAGRAM_ORIGIN + (path.startsWith('/') ? path : `/${path}`);
  }

  static homeFeedUrl(): string {
    return INSTAGRAM_ORIGIN;
  }

  static exploreUrl(): string {
    return `${INSTAGRAM_ORIGIN}/explore/`;
  }
}
