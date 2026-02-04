import type { Page } from 'playwright';
import { InstagramClient } from '../instagramClient/index.js';
import { getFollowersFromProfile } from '../profileExtractor/index.js';
import { crawlLogDiscovery } from '../utils/crawlLogger.js';

export interface DiscoveredProfileRef {
  handle: string;
  profileUrl: string;
  /** Seguidores já lidos na página durante a descoberta (quando minFollowers > 0). */
  followersFromDiscovery?: number;
}

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((r) => setTimeout(r, ms));
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
  onProfileQualified: (ref: DiscoveredProfileRef) => Promise<boolean>
): Promise<number> {
  const page = await client.newPage();
  let savedCount = 0;
  try {
    const url = InstagramClient.tagUrl(tag);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await randomDelay(3000, 6000);
    await page.evaluate(() => window.scrollTo(0, 600));
    await randomDelay(2000, 4000);

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
    crawlLogDiscovery(`${tag}: ${postCount} links, ${hrefs.length} posts para processar`);

    let postIndex = 0;
    for (const href of hrefs) {
      if (savedCount >= maxProfiles) break;
      postIndex++;
      const fullUrl = href.startsWith('http') ? href : `https://www.instagram.com${href}`;
      crawlLogDiscovery(`post ${postIndex}/${hrefs.length}: ${fullUrl}`);
      try {
        await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('closed') || msg.includes('Target')) {
          crawlLogDiscovery(`Browser fechado, encerrando descoberta.`);
          break;
        }
        throw err;
      }
      await randomDelay(1500, 3000);

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
          if (h) crawlLogDiscovery(`  seletor ${sel}: href=${h.slice(0, 60)} (ignorado, nao eh perfil)`);
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
          crawlLogDiscovery(`  seletor falhou: ${sel} - ${lastError}`);
          continue;
        }
      }
      if (authorHref) {
        const handle = authorHref.replace(/^\//, '').split('/')[0]?.trim().split('?')[0] ?? '';
        if (!handle) continue;
        if (existingHandles.has(handle.toLowerCase())) {
          crawlLogDiscovery(`  -> @${handle} já no storage, pulando`);
          await randomDelay(1500, 3000);
          continue;
        }
        const profileUrl = InstagramClient.profileUrl(handle);
        if (minFollowers > 0) {
          crawlLogDiscovery(`  -> checando seguidores de @${handle}...`);
        }
        const followers = minFollowers > 0 ? await getFollowersFromProfile(page, profileUrl) : null;
        if (minFollowers > 0 && (followers == null || followers < minFollowers)) {
          crawlLogDiscovery(`  -> autor: @${handle} (${followers ?? '?'} seguidores, abaixo de ${minFollowers}, pulando)`);
          await randomDelay(1500, 3000);
          continue;
        }
        if (minFollowers > 0) {
          crawlLogDiscovery(`  -> autor: @${handle} (${followers} seguidores, ok). Processando perfil completo (1 por vez)...`);
        } else {
          crawlLogDiscovery(`  -> autor: @${handle}. Processando perfil completo (1 por vez)...`);
        }
        const ref: DiscoveredProfileRef = { handle, profileUrl, followersFromDiscovery: followers ?? undefined };
        // Não avança para o próximo post até concluir 100% deste perfil (extrair + salvar).
        const saved = await onProfileQualified(ref);
        if (saved) savedCount++;
        crawlLogDiscovery(`  -> perfil @${handle} concluído; só então indo ao próximo post.`);
        await randomDelay(1500, 3000);
      } else {
        crawlLogDiscovery(`  -> nenhum autor (ultimo erro: ${lastError || 'href nao passou no regex'})`);
      }
      await randomDelay(1500, 3000);
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
    await randomDelay(4000, 7000);
    await page.evaluate(() => window.scrollTo(0, 800));
    await randomDelay(2000, 4000);
    await page.evaluate(() => window.scrollTo(0, 1600));
    await randomDelay(2000, 4000);

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
      await randomDelay(1500, 3000);

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
      await randomDelay(1500, 3000);
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
    await randomDelay(3000, 6000);
    await page.evaluate(() => window.scrollTo(0, 800));
    await randomDelay(2000, 5000);
    await page.evaluate(() => window.scrollTo(0, 1600));
    await randomDelay(2000, 4000);

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
      await randomDelay(1500, 3000);

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
      await randomDelay(1500, 3000);
    }
  } finally {
    await page.close().catch(() => { });
  }
  return result;
}
