import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { readFile, mkdir, unlink } from 'fs/promises';
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
    this.authStatePath = options.authStatePath ?? '.auth/instagram.json';
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
      '--disable-software-rasterizer',
      '--disable-setuid-sandbox',
      '--no-first-run',
      '--no-zygote',
    ];
    const baseOptions = {
      headless: this.headless,
      args,
      timeout: launchTimeout,
    };

    // Usa apenas Chromium na pasta do projeto: PLAYWRIGHT_CHROMIUM_EXECUTABLE ou Chromium instalado
    // via PLAYWRIGHT_BROWSERS_PATH (ex: ./browser) + npx playwright install chromium
    if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) {
      this.browser = await chromium.launch({
        ...baseOptions,
        executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
      });
      return;
    }

    this.browser = await chromium.launch(baseOptions);
  }

  /**
   * Retorna o context atual (cache). Só cria um novo quando não existe (primeira chamada)
   * ou após closeContext() (ex.: re-login). Assim mantemos 1 browser + 1 context quente.
   */
  private async getContext(storageState?: string): Promise<BrowserContext> {
    await this.init();
    if (!this.browser) throw new Error('Browser not initialized');
    if (this.context) return this.context;
    const statePath = storageState ?? this.authStatePath;
    let state: string | undefined;
    if (statePath && existsSync(statePath)) {
      try {
        state = await readFile(statePath, 'utf-8');
      } catch {
        state = undefined;
      }
    }
    this.context = await this.browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1280, height: 720 },
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
      extraHTTPHeaders: {
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      },
      storageState: state ? JSON.parse(state) : undefined,
    });
    return this.context;
  }

  async newPage(storageState?: string): Promise<Page> {
    const ctx = await this.getContext(storageState);
    const page = await ctx.newPage();
    return page;
  }

  async saveAuthState(): Promise<void> {
    if (!this.context) return;
    const dir = dirname(this.authStatePath);
    if (dir && dir !== '.') {
      await mkdir(dir, { recursive: true });
    }
    await this.context.storageState({ path: this.authStatePath });
  }

  /** Fecha o context atual (próximo newPage() criará um novo). Use antes de re-login. */
  async closeContext(): Promise<void> {
    if (this.context) {
      await this.context.close().catch(() => { });
      this.context = null;
    }
  }

  /** Remove o arquivo de sessão para forçar login limpo (cookies/sessão antiga). */
  async clearAuthStateFile(): Promise<void> {
    if (this.authStatePath && existsSync(this.authStatePath)) {
      await unlink(this.authStatePath).catch(() => { });
    }
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

  getAuthStatePath(): string {
    return this.authStatePath;
  }

  static profileUrl(handle: string): string {
    const clean = handle.replace(/^@/, '').trim();
    return `${INSTAGRAM_ORIGIN}/${clean}/`;
  }

  static tagUrl(tag: string): string {
    const clean = tag.replace(/^#/, '').trim();
    return `${INSTAGRAM_ORIGIN}/explore/tags/${encodeURIComponent(clean)}/`;
  }

  /** URL do Explore por local. Use o ID numérico (ex: 246052326) ou "id/slug" (ex: 246052326/aurajoki-turku). */
  static locationExploreUrl(locationIdOrSlug: string): string {
    const trimmed = locationIdOrSlug.trim();
    if (/^\d+$/.test(trimmed)) {
      return `${INSTAGRAM_ORIGIN}/explore/locations/${trimmed}/`;
    }
    if (/^\d+\/.+$/.test(trimmed)) {
      const [id, slug] = trimmed.split('/');
      return `${INSTAGRAM_ORIGIN}/explore/locations/${id}/${encodeURIComponent(slug)}/`;
    }
    return `${INSTAGRAM_ORIGIN}/explore/locations/${encodeURIComponent(trimmed)}/`;
  }

  /** Feed Explore (descoberta orgânica) */
  static exploreUrl(): string {
    return `${INSTAGRAM_ORIGIN}/explore/`;
  }

  /** Feed principal (home): posts de quem você segue. Requer login. */
  static homeFeedUrl(): string {
    return INSTAGRAM_ORIGIN;
  }
}
