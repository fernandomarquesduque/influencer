import type { Page } from 'playwright';
import { InstagramClient } from '../instagramClient/index.js';

export interface DiscoveredProfileRef {
  handle: string;
  profileUrl: string;
}

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Descobre handles/URLs de perfis a partir da página de uma hashtag.
 * Coleta no máximo maxPosts posts; de cada post extrai apenas autor e URL.
 */
export async function discoverProfilesByHashtag(
  client: InstagramClient,
  tag: string,
  maxPosts: number
): Promise<DiscoveredProfileRef[]> {
  const page = await client.newPage();
  const seen = new Set<string>();
  const result: DiscoveredProfileRef[] = [];
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
    console.log(`[hashtag] ${tag}: ${postCount} links, ${hrefs.length} posts para processar`);

    for (const href of hrefs) {
      if (result.length >= maxPosts) break;
      const fullUrl = href.startsWith('http') ? href : `https://www.instagram.com${href}`;
      await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await randomDelay(1500, 3000);

      const authorSelectors = [
        'header a[href^="/"]',
        'a[href^="/"][href*="/"]',
        '[role="presentation"] a[href^="/"]',
      ];
      let authorHref: string | null = null;
      for (const sel of authorSelectors) {
        try {
          const el = page.locator(sel).first().setTimeout(5000);
          const href = await el.getAttribute('href');
          if (href && /^\/[^/]+\/?$/.test(href.replace(/\?.*$/, ''))) {
            authorHref = href;
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
          result.push({
            handle,
            profileUrl: InstagramClient.profileUrl(handle),
          });
        }
      }
      await randomDelay(1500, 3000);
    }
  } finally {
    await page.close().catch(() => { });
  }
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

    for (const href of hrefs) {
      if (result.length >= maxPosts) break;
      const fullUrl = href.startsWith('http') ? href : `https://www.instagram.com${href}`;
      await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await randomDelay(1500, 3000);

      const authorSelectors = [
        'header a[href^="/"]',
        'a[href^="/"][href*="/"]',
        '[role="presentation"] a[href^="/"]',
      ];
      let authorHref: string | null = null;
      for (const sel of authorSelectors) {
        try {
          const el = page.locator(sel).first().setTimeout(5000);
          const href = await el.getAttribute('href');
          if (href && /^\/[^/]+\/?$/.test(href.replace(/\?.*$/, ''))) {
            authorHref = href;
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
          result.push({
            handle,
            profileUrl: InstagramClient.profileUrl(handle),
          });
        }
      }
      await randomDelay(1500, 3000);
    }
  } finally {
    await page.close().catch(() => { });
  }
  return result;
}
