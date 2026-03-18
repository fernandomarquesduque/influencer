/**
 * Descoberta de perfis por hashtag, feed ou explore.
 */

import type { Page } from 'playwright';
import { InstagramClient } from './instagram.js';
import { getFollowersAndMinimalProfile, extractProfile } from './profileExtractor.js';
import { buildSlimProfile } from './slimProfile.js';
import {
  getFollowersFromEntity,
  hasPostWithMinLikes,
  hasRejectedProfileKeyword,
  isBlocklistedHandle,
  isBusinessFromEntity,
  isPrivateFromEntity,
  qualifiesAsInfluencer,
  containsRejectedKeyword,
} from './entityRules.js';
import { addProfile, listHandles } from './memoryStorage.js';
import type { CollectorConfig } from './config.js';

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function randomDelay(min: number, max: number): Promise<void> {
  return delay(min + Math.random() * (max - min));
}

const profileUrlRe = /instagram\.com\/[^/]+\/?(\?.*)?$/;
const profileHrefRe = /^\/[^/]+\/?$/;
const isProfileHref = (h: string) =>
  profileHrefRe.test(h.replace(/\?.*$/, '')) && !h.includes('/p/') && !h.includes('/reel/');

export type DiscoveryMode = 'hashtag' | 'feed' | 'explore';

export interface DiscoveryOptions {
  mode: DiscoveryMode;
  tag?: string;
  maxProfiles: number;
  config: CollectorConfig;
  shouldAbort: () => boolean;
  onCollected?: (handle: string, followers: number) => void;
}

async function processOneProfile(
  page: Page,
  handle: string,
  config: CollectorConfig,
  existingHandles: Set<string>,
  discoveredBy: string,
  discoveredValue: string,
  options?: { pageAlreadyOnProfile?: boolean },
  onCollected?: (handle: string, followers: number) => void
): Promise<boolean> {
  const handleLower = handle.toLowerCase();
  if (existingHandles.has(handleLower)) return false;

  const profileUrl = InstagramClient.profileUrl(handle);
  const extracted = await extractProfile(page, handle, profileUrl, {
    pageAlreadyOnProfile: options?.pageAlreadyOnProfile ?? false,
  });
  if (!extracted) return false;

  const { profile: rawProfile, posts } = extracted;
  const raw = rawProfile as Record<string, unknown>;
  const followers = getFollowersFromEntity(raw);

  if (isPrivateFromEntity(raw)) return false;
  if (isBusinessFromEntity(raw)) return false;
  if (config.excludeBusinessProfiles && !qualifiesAsInfluencer(raw, config.minFollowersToSave))
    return false;
  if (!config.excludeBusinessProfiles) {
    if (!qualifiesAsInfluencer(raw, config.minFollowersToSave)) return false;
  }
  if (
    config.minPostLikesToSave > 0 &&
    !hasPostWithMinLikes(posts, config.minPostLikesToSave, config.minPostsWithMinLikesToSave)
  )
    return false;
  if (isBlocklistedHandle(handle)) return false;
  if (hasRejectedProfileKeyword(raw)) return false;

  const slim = buildSlimProfile(
    raw,
    handle,
    followers,
    posts,
    discoveredBy,
    discoveredValue
  );
  addProfile(slim as Record<string, unknown> & { handle: string });
  existingHandles.add(handleLower);
  onCollected?.(handle, followers);
  return true;
}

/** Obtém o handle do autor na página do post (modal ou página). */
async function getAuthorFromPostPage(page: Page): Promise<string | null> {
  for (const sel of ['section a[href^="/"]', 'header a[href^="/"]', '[role="presentation"] a[href^="/"]']) {
    try {
      const el = page.locator(sel).first();
      await el.waitFor({ state: 'attached', timeout: 5000 });
      const h = await el.getAttribute('href');
      if (h && isProfileHref(h)) {
        const handle = h.replace(/^\//, '').split('/')[0]?.trim().split('?')[0] ?? '';
        if (handle) return handle;
      }
    } catch {
      continue;
    }
  }
  try {
    const hrefs = await page.locator('section a[href^="/"]').evaluateAll((nodes) =>
      nodes.map((a) => (a as HTMLAnchorElement).getAttribute('href')).filter((h): h is string => !!h)
    );
    const first = hrefs.find((h) => isProfileHref(h));
    if (first) return first.replace(/^\//, '').split('/')[0]?.trim().split('?')[0] ?? null;
  } catch {
    // ignore
  }
  return null;
}

/** Descoberta por hashtag: abre posts da grade, pega autor, extrai perfil. */
export async function discoverByHashtag(
  client: InstagramClient,
  page: Page,
  tag: string,
  options: DiscoveryOptions
): Promise<{ saved: number; processed: number }> {
  const { config, shouldAbort, onCollected } = options;
  const existingHandles = listHandles();
  const triedInSession = new Set<string>();
  let saved = 0;
  let processed = 0;

  const url = InstagramClient.tagUrl(tag);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await randomDelay(2000, 4000);

  const currentUrl = page.url();
  if (currentUrl.includes('/accounts/login/') || currentUrl.includes('/challenge/')) {
    console.log('[discovery] Redirecionado para login — faça login no browser e tente de novo.');
    return { saved: 0, processed: 0 };
  }

  await page.evaluate(() => window.scrollTo(0, 600));
  await randomDelay(1500, 3000);

  let postLinks = page.locator('article a[href^="/p/"]');
  if ((await postLinks.count()) === 0) postLinks = page.locator('a[href*="/p/"]');
  const toProcess = Math.min(options.maxProfiles * 3, await postLinks.count(), config.maxPostsPerTag);
  if (toProcess === 0) return { saved: 0, processed: 0 };

  for (let postIndex = 0; postIndex < toProcess && saved < options.maxProfiles; postIndex++) {
    if (shouldAbort()) break;

    postLinks = page.locator('article a[href^="/p/"]');
    if ((await postLinks.count()) === 0) postLinks = page.locator('a[href*="/p/"]');
    const postLink = postLinks.nth(postIndex);
    let authorFromGrid: string | null = null;
    try {
      const postHref = await postLink.getAttribute('href');
      if (postHref?.includes('/p/')) {
        const m = postHref.match(/^\/([^/]+)\/p\//);
        if (m) authorFromGrid = m[1].split('?')[0]?.trim() ?? null;
      }
      if (!authorFromGrid) {
        const fromDom = await postLink.evaluate((el) => {
          const profileRe = /^\/[^/]+\/?$/;
          let root: Element | null = el;
          for (let i = 0; i < 10 && root; i++) {
            root = root.parentElement;
            if (!root) return null;
            const links = root.querySelectorAll('a[href^="/"]');
            for (const a of links) {
              const href = (a as HTMLAnchorElement).getAttribute('href');
              const path = href ? href.split('?')[0] : '';
              if (path && !path.includes('/p/') && profileRe.test(path)) {
                return path.replace(/^\//, '').split('/')[0]?.trim() ?? null;
              }
            }
          }
          return null;
        });
        if (fromDom) authorFromGrid = fromDom;
      }
    } catch {
      // ignore
    }

    if (authorFromGrid) {
      const lower = authorFromGrid.toLowerCase();
      if (existingHandles.has(lower) || triedInSession.has(lower)) {
        await randomDelay(800, 1500);
        continue;
      }
      if (isBlocklistedHandle(authorFromGrid) || containsRejectedKeyword(authorFromGrid)) {
        triedInSession.add(lower);
        continue;
      }
    }

    await randomDelay(1500, 3500);
    try {
      await postLink.scrollIntoViewIfNeeded();
      await postLink.click({ force: true, timeout: 15000 });
      await page.waitForURL(/\/p\//, { timeout: 20000 });
    } catch {
      await randomDelay(1000, 2000);
      continue;
    }
    await randomDelay(1000, 2000);

    let handle = await getAuthorFromPostPage(page);
    if (!handle) {
      try {
        await page.goBack({ timeout: 15000 });
      } catch {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      }
      await randomDelay(1000, 2000);
      continue;
    }

    const handleLower = handle.toLowerCase();
    if (existingHandles.has(handleLower) || triedInSession.has(handleLower)) {
      try {
        await page.goBack({ timeout: 15000 });
        await page.goBack({ timeout: 15000 });
      } catch {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      }
      await randomDelay(1000, 2000);
      continue;
    }

    if (config.minFollowersToSave > 0) {
      const result = await getFollowersAndMinimalProfile(page, InstagramClient.profileUrl(handle), {
        doNavigate: async () => {
          const authorLink = page.locator(`a[href^="/${handle}"]`).first();
          await authorLink.click({ force: true, timeout: 15000 });
          await page.waitForURL(profileUrlRe, { timeout: 20000 });
        },
      });
      const followers = result.followers;
      if (followers == null || followers < config.minFollowersToSave) {
        triedInSession.add(handleLower);
        processed++;
        try {
          await page.goBack({ timeout: 15000 });
          await page.goBack({ timeout: 15000 });
        } catch {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        }
        await randomDelay(1000, 2000);
        continue;
      }
      if (config.excludeBusinessProfiles && result.minimalProfile) {
        const entity = {
          handle,
          username: handle,
          ...result.minimalProfile,
          followers_count: followers,
        } as Record<string, unknown>;
        if (hasRejectedProfileKeyword(entity) || isBusinessFromEntity(entity)) {
          triedInSession.add(handleLower);
          try {
            await page.goBack({ timeout: 15000 });
            await page.goBack({ timeout: 15000 });
          } catch {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
          }
          await randomDelay(1000, 2000);
          continue;
        }
        if (!qualifiesAsInfluencer(entity, config.minFollowersToSave)) {
          triedInSession.add(handleLower);
          try {
            await page.goBack({ timeout: 15000 });
            await page.goBack({ timeout: 15000 });
          } catch {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
          }
          await randomDelay(1000, 2000);
          continue;
        }
      }
    } else {
      const authorLink = page.locator(`a[href^="/${handle}"]`).first();
      await authorLink.click({ force: true, timeout: 15000 });
      await page.waitForURL(profileUrlRe, { timeout: 20000 });
      await randomDelay(1500, 2500);
    }

    triedInSession.add(handleLower);
    processed++;
    const alreadyOnProfile = config.minFollowersToSave > 0;
    const ok = await processOneProfile(
      page,
      handle,
      config,
      existingHandles,
      'hashtag',
      tag,
      { pageAlreadyOnProfile: alreadyOnProfile },
      onCollected
    );
    if (ok) saved++;

    try {
      await page.goBack({ timeout: 15000 });
      await page.goBack({ timeout: 15000 });
    } catch {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    }
    await randomDelay(1500, 3000);
  }

  return { saved, processed };
}

/** Descoberta pelo feed: rola o feed, pega autor do primeiro post, extrai. */
export async function discoverByFeed(
  client: InstagramClient,
  page: Page,
  options: DiscoveryOptions
): Promise<{ saved: number; processed: number }> {
  const { config, shouldAbort, onCollected } = options;
  const existingHandles = listHandles();
  const skipped = new Set<string>();
  let saved = 0;
  let processed = 0;

  await page.goto(InstagramClient.homeFeedUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 });
  await randomDelay(2000, 4000);

  if (page.url().includes('/accounts/login/') || page.url().includes('/challenge/')) {
    console.log('[discovery] Faça login no browser e tente de novo.');
    return { saved: 0, processed: 0 };
  }

  while (saved < options.maxProfiles && !shouldAbort()) {
    await randomDelay(1500, 3500);
    const article = page.locator('article').first();
    if ((await article.count()) === 0) {
      await page.evaluate(() => window.scrollBy(0, 400));
      await randomDelay(1000, 2000);
      continue;
    }
    const isSponsored = (await article.locator('text=/patrocinado/i').count()) > 0;
    if (isSponsored) {
      await page.evaluate(() => window.scrollBy(0, 400));
      continue;
    }
    const linkCount = await article.locator('a[href^="/"]').count();
    let authorHref: string | null = null;
    for (let j = 0; j < linkCount; j++) {
      const h = await article.locator('a[href^="/"]').nth(j).getAttribute('href');
      if (h && isProfileHref(h)) {
        authorHref = h;
        break;
      }
    }
    if (!authorHref) {
      await page.evaluate(() => window.scrollBy(0, 400));
      continue;
    }
    const handle = authorHref.replace(/^\//, '').split('/')[0]?.trim().split('?')[0] ?? '';
    if (!handle || skipped.has(handle.toLowerCase()) || existingHandles.has(handle.toLowerCase())) {
      await page.evaluate(() => window.scrollBy(0, 400));
      continue;
    }
    if (isBlocklistedHandle(handle) || containsRejectedKeyword(handle)) {
      skipped.add(handle.toLowerCase());
      await page.evaluate(() => window.scrollBy(0, 400));
      continue;
    }

    try {
      await article.locator(`a[href^="/${handle}"]`).first().click();
      await page.waitForURL(profileUrlRe, { timeout: 20000 });
    } catch {
      await page.evaluate(() => window.scrollBy(0, 400));
      continue;
    }
    await randomDelay(1500, 2500);

    if (config.minFollowersToSave > 0) {
      const result = await getFollowersAndMinimalProfile(page, InstagramClient.profileUrl(handle), {
        skipGoto: true,
      });
      if (
        result.followers == null ||
        result.followers < config.minFollowersToSave
      ) {
        skipped.add(handle.toLowerCase());
        processed++;
        await page.goBack({ timeout: 15000 });
        continue;
      }
      if (config.excludeBusinessProfiles && result.minimalProfile) {
        const entity = {
          handle,
          username: handle,
          ...result.minimalProfile,
          followers_count: result.followers,
        } as Record<string, unknown>;
        if (
          hasRejectedProfileKeyword(entity) ||
          isBusinessFromEntity(entity) ||
          !qualifiesAsInfluencer(entity, config.minFollowersToSave)
        ) {
          skipped.add(handle.toLowerCase());
          await page.goBack({ timeout: 15000 });
          continue;
        }
      }
    }

    processed++;
    const ok = await processOneProfile(
      page,
      handle,
      config,
      existingHandles,
      'feed',
      'home',
      { pageAlreadyOnProfile: true },
      onCollected
    );
    if (ok) saved++;
    skipped.add(handle.toLowerCase());

    await page.goBack({ timeout: 15000 });
    await randomDelay(1000, 2000);
  }

  return { saved, processed };
}

/** Descoberta pelo Explore: abre a grade, clica no primeiro post, pega autor e extrai. */
export async function discoverByExplore(
  client: InstagramClient,
  page: Page,
  options: DiscoveryOptions
): Promise<{ saved: number; processed: number }> {
  const { config, shouldAbort, onCollected } = options;
  const existingHandles = listHandles();
  const skipped = new Set<string>();
  let saved = 0;
  let processed = 0;

  await page.goto(InstagramClient.exploreUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 });
  await randomDelay(2000, 4000);

  if (page.url().includes('/accounts/login/') || page.url().includes('/challenge/')) {
    console.log('[discovery] Faça login no browser e tente de novo.');
    return { saved: 0, processed: 0 };
  }

  await page.evaluate(() => window.scrollBy(0, 400));
  await randomDelay(1500, 3000);

  while (saved < options.maxProfiles && !shouldAbort()) {
    const postLink = page.locator('article a[href*="/p/"], a[href*="/reel/"]').first();
    if ((await postLink.count()) === 0) {
      await page.evaluate(() => window.scrollBy(0, 400));
      await randomDelay(1000, 2000);
      continue;
    }
    await randomDelay(1500, 3000);
    try {
      await postLink.click({ force: true, timeout: 15000 });
      await page.waitForURL(/\/(p|reel)\//, { timeout: 20000 });
    } catch {
      await randomDelay(1000, 2000);
      continue;
    }
    await randomDelay(1000, 2000);

    const handle = await getAuthorFromPostPage(page);
    if (!handle) {
      try {
        await page.goBack({ timeout: 15000 });
      } catch {
        await page.goto(InstagramClient.exploreUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 });
      }
      await randomDelay(1000, 2000);
      continue;
    }

    const handleLower = handle.toLowerCase();
    if (existingHandles.has(handleLower) || skipped.has(handleLower)) {
      try {
        await page.goBack({ timeout: 15000 });
      } catch {
        await page.goto(InstagramClient.exploreUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 });
      }
      await randomDelay(1000, 2000);
      continue;
    }
    if (isBlocklistedHandle(handle) || containsRejectedKeyword(handle)) {
      skipped.add(handleLower);
      try {
        await page.goBack({ timeout: 15000 });
      } catch {
        await page.goto(InstagramClient.exploreUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 });
      }
      continue;
    }

    const profileUrl = InstagramClient.profileUrl(handle);
    if (config.minFollowersToSave > 0) {
      const result = await getFollowersAndMinimalProfile(page, profileUrl, {
        doNavigate: async () => {
          const authorLink = page.locator(`a[href^="/${handle}"]`).first();
          await authorLink.click({ force: true, timeout: 15000 });
          await page.waitForURL(profileUrlRe, { timeout: 20000 });
        },
      });
      if (
        result.followers == null ||
        result.followers < config.minFollowersToSave
      ) {
        skipped.add(handleLower);
        processed++;
        try {
          await page.goBack({ timeout: 15000 });
          await page.goBack({ timeout: 15000 });
        } catch {
          await page.goto(InstagramClient.exploreUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 });
        }
        await randomDelay(1000, 2000);
        continue;
      }
      if (config.excludeBusinessProfiles && result.minimalProfile) {
        const entity = {
          handle,
          username: handle,
          ...result.minimalProfile,
          followers_count: result.followers,
        } as Record<string, unknown>;
        if (
          hasRejectedProfileKeyword(entity) ||
          isBusinessFromEntity(entity) ||
          !qualifiesAsInfluencer(entity, config.minFollowersToSave)
        ) {
          skipped.add(handleLower);
          try {
            await page.goBack({ timeout: 15000 });
            await page.goBack({ timeout: 15000 });
          } catch {
            await page.goto(InstagramClient.exploreUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 });
          }
          await randomDelay(1000, 2000);
          continue;
        }
      }
      const authorLink = page.locator(`a[href^="/${handle}"]`).first();
      await authorLink.click({ force: true, timeout: 15000 });
      await page.waitForURL(profileUrlRe, { timeout: 20000 });
      await randomDelay(1500, 2500);
    } else {
      const authorLink = page.locator(`a[href^="/${handle}"]`).first();
      await authorLink.click({ force: true, timeout: 15000 });
      await page.waitForURL(profileUrlRe, { timeout: 20000 });
      await randomDelay(1500, 2500);
    }

    processed++;
    const ok = await processOneProfile(
      page,
      handle,
      config,
      existingHandles,
      'explore',
      'explore',
      { pageAlreadyOnProfile: true },
      onCollected
    );
    if (ok) saved++;
    skipped.add(handleLower);

    try {
      await page.goBack({ timeout: 15000 });
      await page.goBack({ timeout: 15000 });
    } catch {
      await page.goto(InstagramClient.exploreUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 });
    }
    await randomDelay(1500, 3000);
  }

  return { saved, processed };
}
