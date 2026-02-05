import type { Page } from 'playwright';
import { InstagramClient } from '../instagramClient/index.js';
import { loginWithCredentials } from '../instagramClient/login.js';
import { getFollowersFromProfile, getFollowersAndMinimalProfile } from '../profileExtractor/index.js';
import { crawlLogDiscovery } from '../utils/crawlLogger.js';
import { randomDelay, humanDelay } from '../utils/delay.js';
import { isBusinessFromEntity, qualifiesAsInfluencer } from '../utils/entityAccess.js';
import { get429BackoffMs, record429, shouldAbortRunAfter429 } from '../utils/rateLimit429.js';

export interface DiscoveredProfileRef {
  handle: string;
  profileUrl: string;
  /** Seguidores já lidos na página durante a descoberta (quando minFollowers > 0). */
  followersFromDiscovery?: number;
}

/**
 * Processa uma hashtag: para cada post, obtém o autor, checa seguidores e, se >= minFollowers,
 * chama onProfileQualified e **espera terminar** (extrair + salvar) antes de ir ao próximo post.
 * Regra: 1 perfil completo por vez — NUNCA avança para o próximo post até o fluxo do perfil
 * atual estar 100% concluído (onProfileQualified retornar).
 */
export async function discoverAndProcessByHashtag(
  client: InstagramClient,
  tag: string,
  maxPosts: number,
  maxProfiles: number,
  minFollowers: number,
  existingHandles: Set<string>,
  onProfileQualified: (ref: DiscoveredProfileRef, pageAlreadyOnProfile?: Page) => Promise<boolean>,
  shouldAbort?: () => boolean,
  excludeBusinessProfiles: boolean = true
): Promise<number> {
  const CONSECUTIVE_FAILURES_BEFORE_RELOGIN = 5;
  let page = await client.newPage();
  let savedCount = 0;
  let consecutiveLoadFailures = 0;
  try {
    const url = InstagramClient.tagUrl(tag);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await humanDelay();

    const currentUrl = page.url();
    const isLoginOrChallenge = currentUrl.includes('/accounts/login/') || currentUrl.includes('/challenge/');
    if (isLoginOrChallenge) {
      crawlLogDiscovery('Página de login/challenge detectada — sessão expirada ou não logado.');
      const user = process.env.INSTAGRAM_USER;
      const password = process.env.INSTAGRAM_PASSWORD;
      if (user && password) {
        crawlLogDiscovery('Tentando login com credenciais do .env...');
        await page.close().catch(() => { });
        await client.closeContext();
        await client.clearAuthStateFile();
        try {
          const loginOk = await loginWithCredentials(client, user, password);
          if (loginOk) {
            page = await client.newPage();
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
            await humanDelay();
            const urlAfterLogin = page.url();
            if (urlAfterLogin.includes('/accounts/login/') || urlAfterLogin.includes('/challenge/')) {
              crawlLogDiscovery('Ainda na página de login após tentativa. Verifique usuário/senha no .env.');
              return 0;
            }
          } else {
            crawlLogDiscovery('Login falhou. Verifique INSTAGRAM_USER e INSTAGRAM_PASSWORD no .env.');
            return 0;
          }
        } catch (loginErr) {
          crawlLogDiscovery(`Erro ao fazer login: ${loginErr instanceof Error ? loginErr.message : String(loginErr)}`);
          return 0;
        }
      } else {
        crawlLogDiscovery('Rode: npm run login (sessão em .auth/instagram.json) ou defina INSTAGRAM_USER e INSTAGRAM_PASSWORD no .env.');
        return 0;
      }
    }

    await page.evaluate(() => window.scrollTo(0, 600));
    await randomDelay(800, 1500);

    let postLinks = page.locator('article a[href^="/p/"]');
    let postCount = await postLinks.count();
    if (postCount === 0) {
      postLinks = page.locator('a[href*="/p/"]');
      postCount = await postLinks.count();
    }
    if (postCount === 0) {
      const urlNow = page.url();
      if (urlNow.includes('/accounts/login/') || urlNow.includes('/challenge/')) {
        crawlLogDiscovery('Redirecionado para login/challenge. Rode npm run login ou defina INSTAGRAM_USER e INSTAGRAM_PASSWORD no .env.');
        return 0;
      }
      crawlLogDiscovery('Nenhum post encontrado para esta hashtag. Verifique o termo ou se a hashtag existe.');
      return 0;
    }
    const toProcess = Math.min(maxPosts, Math.max(0, postCount));
    const hrefs: string[] = [];
    for (let i = 0; i < toProcess; i++) {
      const href = await postLinks.nth(i).getAttribute('href');
      if (href && !hrefs.includes(href)) hrefs.push(href);
    }
    crawlLogDiscovery(`${tag}: ${postCount} links, ${hrefs.length} posts para processar`);

    let postIndex = 0;
    let stoppedDueToBlock = false;
    for (const href of hrefs) {
      if (shouldAbort?.()) {
        crawlLogDiscovery('Crawl interrompido pelo usuário.');
        break;
      }
      if (savedCount >= maxProfiles) break;
      postIndex++;
      const fullUrl = href.startsWith('http') ? href : `https://www.instagram.com${href}`;
      crawlLogDiscovery(`post ${postIndex}/${hrefs.length}: ${fullUrl}`);
      try {
        await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        consecutiveLoadFailures = 0;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('closed') || msg.includes('Target')) {
          crawlLogDiscovery(`Browser fechado, encerrando descoberta.`);
          break;
        }
        const isBlock = msg.includes('ERR_HTTP_RESPONSE_CODE_FAILURE') || msg.includes('403') || msg.includes('429') || msg.includes('Too Many Requests') || msg.includes('401') || msg.includes('rate limit');
        if (isBlock) {
          record429();
          stoppedDueToBlock = true;
          crawlLogDiscovery(`  -> Bloqueio (403/429) detectado. Parando imediatamente e aguardando backoff.`);
          break;
        }
        consecutiveLoadFailures++;
        crawlLogDiscovery(`  -> post falhou ao carregar: ${msg.slice(0, 80)}`);

        if (consecutiveLoadFailures >= CONSECUTIVE_FAILURES_BEFORE_RELOGIN) {
          const user = process.env.INSTAGRAM_USER;
          const password = process.env.INSTAGRAM_PASSWORD;
          await page.close().catch(() => { });
          if (user && password) {
            crawlLogDiscovery(`  -> Sessão provavelmente expirada. Limpando cookies e fazendo login novamente...`);
            await client.closeContext();
            await client.clearAuthStateFile();
            try {
              const loginOk = await loginWithCredentials(client, user, password);
              if (loginOk) {
                crawlLogDiscovery(`  -> Login OK. Retomando extração.`);
                consecutiveLoadFailures = 0;
              } else {
                crawlLogDiscovery(`  -> Login falhou. Continuando com nova página.`);
              }
            } catch (loginErr) {
              crawlLogDiscovery(`  -> Erro no re-login: ${loginErr instanceof Error ? loginErr.message : String(loginErr)}`);
            }
          } else {
            crawlLogDiscovery(`  -> Defina INSTAGRAM_USER e INSTAGRAM_PASSWORD no .env para re-login automático, ou rode npm run login.`);
          }
          page = await client.newPage();
        }
        await humanDelay();
        continue;
      }
      await humanDelay();

      const authorSelectors = [
        'section a[href^="/"]',
        'header a[href^="/"]',
        '[role="presentation"] a[href^="/"]',
        'a[href^="/"][href*="/"]',
      ];
      const profileHrefRe = /^\/[^/]+\/?$/;
      const isProfileHref = (h: string) => profileHrefRe.test(h.replace(/\?.*$/, '')) && !h.includes('/p/');

      let authorHref: string | null = null;
      let lastError = '';
      for (const sel of authorSelectors) {
        try {
          const el = page.locator(sel).first();
          await el.waitFor({ state: 'visible', timeout: 5000 });
          const h = await el.getAttribute('href');
          if (h && isProfileHref(h)) {
            authorHref = h;
            crawlLogDiscovery(`  seletor ok: ${sel} -> ${h}`);
            break;
          }
          if (h) crawlLogDiscovery(`  seletor ${sel}: href=${h.slice(0, 60)} (ignorado, nao eh perfil)`);
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
          crawlLogDiscovery(`  seletor falhou: ${sel} - ${lastError}`);
          continue;
        }
      }

      if (!authorHref) {
        try {
          const hrefs = await page.locator('section a[href^="/"]').evaluateAll((nodes) =>
            nodes.map((a) => (a as HTMLAnchorElement).getAttribute('href')).filter((h): h is string => !!h)
          );
          const first = hrefs.find((h) => isProfileHref(h));
          if (first) {
            authorHref = first;
            crawlLogDiscovery(`  autor (link oculto): section a[href^="/"] -> ${first}`);
          }
        } catch {
          // ignore
        }
      }
      if (authorHref) {
        const handle = authorHref.replace(/^\//, '').split('/')[0]?.trim().split('?')[0] ?? '';
        if (!handle) continue;
        if (existingHandles.has(handle.toLowerCase())) {
          crawlLogDiscovery(`  -> @${handle} já no storage, pulando`);
          await humanDelay();
          continue;
        }
        if (excludeBusinessProfiles && isBusinessFromEntity({ handle })) {
          crawlLogDiscovery(`  -> @${handle} parece estabelecimento (handle), pulando sem abrir`);
          await humanDelay();
          continue;
        }
        const profileUrl = InstagramClient.profileUrl(handle);
        let followers: number | null = null;
        let minimalProfile: Record<string, unknown> | null = null;

        if (minFollowers > 0) {
          crawlLogDiscovery(`  -> checando seguidores de @${handle}...`);
          if (excludeBusinessProfiles) {
            const result = await getFollowersAndMinimalProfile(page, profileUrl);
            followers = result.followers;
            minimalProfile = result.minimalProfile;
          } else {
            followers = await getFollowersFromProfile(page, profileUrl);
          }
        }

        if (minFollowers > 0 && (followers == null || followers < minFollowers)) {
          crawlLogDiscovery(`  -> autor: @${handle} (${followers ?? '?'} seguidores, abaixo de ${minFollowers}, pulando)`);
          await humanDelay();
          continue;
        }

        if (excludeBusinessProfiles && minimalProfile != null) {
          const dataUser = minimalProfile?.data != null && typeof minimalProfile.data === 'object'
            ? (minimalProfile.data as Record<string, unknown>).user
            : undefined;
          const entity: Record<string, unknown> = {
            handle,
            username: handle,
            ...(typeof dataUser === 'object' && dataUser != null ? (dataUser as Record<string, unknown>) : {}),
            followers_count: followers ?? 0,
          };
          if (!qualifiesAsInfluencer(entity, minFollowers)) {
            crawlLogDiscovery(`  -> @${handle} não qualifica como influenciador (filtro no início), pulando`);
            await humanDelay();
            continue;
          }
        }

        if (minFollowers > 0) {
          crawlLogDiscovery(`  -> autor: @${handle} (${followers} seguidores, ok). Processando perfil completo (1 por vez)...`);
        } else {
          crawlLogDiscovery(`  -> autor: @${handle}. Processando perfil completo (1 por vez)...`);
        }
        const ref: DiscoveredProfileRef = { handle, profileUrl, followersFromDiscovery: followers ?? undefined };
        try {
          const saved = await onProfileQualified(ref, page);
          if (saved) savedCount++;
          crawlLogDiscovery(`  -> perfil @${handle} concluído; só então indo ao próximo post.`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg === 'RATE_LIMIT_429') {
            const backoffMs = get429BackoffMs();
            const min = Math.round(backoffMs / 60000);
            crawlLogDiscovery(`  -> 429 detectado. Pausa de ${min} min antes de continuar.`);
            await new Promise((r) => setTimeout(r, backoffMs));
            if (shouldAbortRunAfter429()) {
              crawlLogDiscovery('  -> Segundo 429 no mesmo run. Encerrando crawl (volte em ~12h).');
              break;
            }
            consecutiveLoadFailures = 0;
          } else {
            throw err;
          }
        }
        await humanDelay();
      } else {
        crawlLogDiscovery(`  -> nenhum autor (ultimo erro: ${lastError || 'href nao passou no regex'})`);
      }
      await humanDelay();
    }

    if (stoppedDueToBlock) {
      const backoffMs = get429BackoffMs();
      const min = Math.round(backoffMs / 60000);
      crawlLogDiscovery(`Aguardando ${min} min (backoff por bloqueio) antes de encerrar.`);
      await new Promise((r) => setTimeout(r, backoffMs));
      if (shouldAbortRunAfter429()) {
        crawlLogDiscovery('Encerrando crawl por excesso de bloqueios (2+). Volte em ~12h.');
      }
    }
  } finally {
    await page.close().catch(() => { });
  }
  return savedCount;
}

/**
 * Versão que apenas coleta refs (para uso programático).
 * Para crawl com "1 perfil por vez", use discoverAndProcessByHashtag.
 */
export async function discoverProfilesByHashtag(
  client: InstagramClient,
  tag: string,
  maxPosts: number,
  maxProfiles: number,
  minFollowers: number = 0
): Promise<DiscoveredProfileRef[]> {
  const result: DiscoveredProfileRef[] = [];
  await discoverAndProcessByHashtag(
    client,
    tag,
    maxPosts,
    maxProfiles,
    minFollowers,
    new Set<string>(),
    async (ref) => {
      result.push(ref);
      return true;
    }
  );
  return result;
}

/**
 * Descobre perfis por localização (explore/locations/...).
 * Abre a página do local e coleta autores dos posts (até maxPosts).
 */
export async function discoverProfilesByLocation(
  client: InstagramClient,
  locationIdOrSlug: string,
  maxPosts: number
): Promise<DiscoveredProfileRef[]> {
  const page = await client.newPage();
  const seen = new Set<string>();
  const result: DiscoveredProfileRef[] = [];
  try {
    const url = InstagramClient.locationExploreUrl(locationIdOrSlug);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await randomDelay(1500, 3000);
    await page.evaluate(() => window.scrollTo(0, 800));
    await randomDelay(800, 1500);
    await page.evaluate(() => window.scrollTo(0, 1600));
    await randomDelay(800, 1500);

    let postLinks = page.locator('article a[href^="/p/"]');
    let postCount = await postLinks.count();
    if (postCount === 0) {
      postLinks = page.locator('a[href*="/p/"]');
      postCount = await postLinks.count();
    }
    const toProcess = Math.min(maxPosts, Math.max(0, postCount));
    const hrefs: string[] = [];
    for (let i = 0; i < toProcess; i++) {
      const href = await postLinks.nth(i).getAttribute('href');
      if (href && !hrefs.includes(href)) hrefs.push(href);
    }
    crawlLogDiscovery(`location ${locationIdOrSlug}: ${postCount} links, ${hrefs.length} posts`);

    let postIndex = 0;
    for (const href of hrefs) {
      if (result.length >= maxPosts) break;
      postIndex++;
      const fullUrl = href.startsWith('http') ? href : `https://www.instagram.com${href}`;
      crawlLogDiscovery(`post ${postIndex}/${hrefs.length}: ${fullUrl}`);
      await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await randomDelay(600, 1200);

      const authorSelectors = [
        'section a[href^="/"]',
        'header a[href^="/"]',
        '[role="presentation"] a[href^="/"]',
        'a[href^="/"][href*="/"]',
      ];
      let authorHref: string | null = null;
      let lastError = '';
      for (const sel of authorSelectors) {
        try {
          const el = page.locator(sel).first();
          await el.waitFor({ state: 'visible', timeout: 5000 });
          const h = await el.getAttribute('href');
          if (h && /^\/[^/]+\/?$/.test(h.replace(/\?.*$/, '')) && !h.includes('/p/')) {
            authorHref = h;
            crawlLogDiscovery(`  seletor ok: ${sel} -> ${h}`);
            break;
          }
          if (h) crawlLogDiscovery(`  seletor ${sel}: href ignorado (nao perfil)`);
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
          crawlLogDiscovery(`  seletor falhou: ${sel} - ${lastError}`);
        }
      }
      if (authorHref) {
        const handle = authorHref.replace(/^\//, '').split('/')[0]?.trim().split('?')[0] ?? '';
        if (handle && !seen.has(handle.toLowerCase())) {
          seen.add(handle.toLowerCase());
          result.push({ handle, profileUrl: InstagramClient.profileUrl(handle) });
          crawlLogDiscovery(`  -> autor: @${handle}`);
        }
      } else {
        crawlLogDiscovery(`  -> nenhum autor: ${lastError || 'href nao passou no regex'}`);
      }
      await randomDelay(600, 1200);
    }
  } finally {
    await page.close().catch(() => { });
  }
  return result;
}

/**
 * Descoberta orgânica: abre o feed Explore e coleta autores dos posts sugeridos.
 */
export async function discoverProfilesFromExplore(
  client: InstagramClient,
  maxPosts: number
): Promise<DiscoveredProfileRef[]> {
  const page = await client.newPage();
  const seen = new Set<string>();
  const result: DiscoveredProfileRef[] = [];
  try {
    const url = InstagramClient.exploreUrl();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await randomDelay(1200, 2500);
    await page.evaluate(() => window.scrollTo(0, 800));
    await randomDelay(800, 1500);
    await page.evaluate(() => window.scrollTo(0, 1600));
    await randomDelay(800, 1500);

    let postLinks = page.locator('article a[href^="/p/"]');
    let postCount = await postLinks.count();
    if (postCount === 0) postLinks = page.locator('a[href*="/p/"]');
    postCount = await postLinks.count();
    const toProcess = Math.min(maxPosts, Math.max(0, postCount));
    const hrefs: string[] = [];
    for (let i = 0; i < toProcess; i++) {
      const href = await postLinks.nth(i).getAttribute('href');
      if (href && !hrefs.includes(href)) hrefs.push(href);
    }
    crawlLogDiscovery(`explore: ${postCount} links, ${hrefs.length} posts para processar`);

    let postIndex = 0;
    for (const href of hrefs) {
      if (result.length >= maxPosts) break;
      postIndex++;
      const fullUrl = href.startsWith('http') ? href : `https://www.instagram.com${href}`;
      crawlLogDiscovery(`post ${postIndex}/${hrefs.length}: ${fullUrl}`);
      await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await randomDelay(600, 1200);

      const authorSelectors = ['section a[href^="/"]', 'header a[href^="/"]', '[role="presentation"] a[href^="/"]', 'a[href^="/"][href*="/"]'];
      let authorHref: string | null = null;
      for (const sel of authorSelectors) {
        try {
          const el = page.locator(sel).first();
          await el.waitFor({ state: 'visible', timeout: 5000 });
          const h = await el.getAttribute('href');
          if (h && /^\/[^/]+\/?$/.test(h.replace(/\?.*$/, '')) && !h.includes('/p/')) {
            authorHref = h;
            break;
          }
        } catch {
          continue;
        }
      }
      if (authorHref) {
        const handle = authorHref.replace(/^\//, '').split('/')[0]?.trim().split('?')[0] ?? '';
        if (handle && !seen.has(handle.toLowerCase())) {
          seen.add(handle.toLowerCase());
          result.push({ handle, profileUrl: InstagramClient.profileUrl(handle) });
          crawlLogDiscovery(`  -> autor: @${handle}`);
        }
      }
      await randomDelay(600, 1200);
    }
  } finally {
    await page.close().catch(() => { });
  }
  return result;
}
