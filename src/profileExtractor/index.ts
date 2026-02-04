import type { Page } from 'playwright';
import type { ExtractedProfile, Address, DiscoveredBy, ExtractedPost } from '../types/index.js';
import { normalizeNumber, normalizeString } from '../normalizers/index.js';
import { extractAddress } from '../addressExtractor/index.js';
import { extractPostInsights } from '../postInsightsExtractor/index.js';
import { ensureWithinLimit } from '../utils/estimatePayloadSize.js';
import type { CrawlConfig } from '../types/index.js';
import { InstagramClient } from '../instagramClient/index.js';
import { crawlLogExtract } from '../utils/crawlLogger.js';

const BIO_MAX = 500;
const RAW_TEXT_MAX = 300;

function extractPublicEmail(text: string | null): string | null {
  if (!text) return null;
  const match = text.match(/[\w.+%-]+@[\w.-]+\.\w{2,}/);
  return match ? normalizeString(match[0]) : null;
}

function extractPublicPhone(text: string | null): string | null {
  if (!text) return null;
  const match = text.match(/(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?\d{4,5}[-\s]?\d{4}/);
  return match ? normalizeString(match[0]) : null;
}

/**
 * Aplica multiplicador de milhar (mil/k = *1000, milhão/m = *1e6).
 * Sempre salva o número real no banco (ex.: "600 mil" -> 600000).
 */
function applyFollowersMultiplier(num: number, rest: string): number {
  const lower = rest.toLowerCase();
  if (lower.includes('milh') || lower.includes('m ') || /^[\d.,\s]*m\s/i.test(rest)) return Math.round(num * 1000000);
  if (lower.includes('mil') || lower.includes('k') || lower.includes(' k')) return Math.round(num * 1000);
  return Math.round(num);
}

/** Extrai apenas o número de seguidores a partir do texto da página do perfil (para filtro rápido na descoberta). */
function parseFollowersFromText(fullText: string): number | null {
  const lines = fullText.split(/\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/(\d[\d.,\s]*)\s*(?:mil|k|m|milhão|milhões)?\s*seguidores/i)
      ?? line.match(/(\d[\d.,\s]*)\s*(?:mil|k|m)?\s*followers?/i);
    if (match) {
      const numStr = match[1].replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
      const n = parseFloat(numStr);
      if (!isNaN(n)) return applyFollowersMultiplier(n, match[0] || '');
      return null;
    }
  }
  const followersMatch = fullText.match(/(\d[\d.,\s]*)\s*(?:mil|k|m|milhão|milhões)?\s*seguidores/i)
    ?? fullText.match(/(\d[\d.,\s]*)\s*(?:mil|k|m)?\s*followers?/i);
  if (followersMatch) {
    const numStr = followersMatch[1].replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
    const n = parseFloat(numStr);
    if (isNaN(n)) return null;
    return applyFollowersMultiplier(n, followersMatch[0] || '');
  }
  return null;
}

/**
 * Tenta obter o número exato de seguidores pelo atributo title (ex.: title="53.655" no link de seguidores).
 */
function parseTitleToFollowersCount(t: string): number | null {
  const numStr = t.trim().replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const num = parseFloat(numStr);
  return !Number.isNaN(num) && num > 0 ? Math.round(num) : null;
}

async function getFollowersFromTitleAttribute(page: Page): Promise<number | null> {
  let value: number | null = await page.evaluate(() => {
    const link = document.querySelector('a[href*="/followers/"]');
    if (!link) return null;
    const span = link.querySelector('span[title]');
    if (!span || !(span as HTMLElement).title) return null;
    const t = (span as HTMLElement).title.trim().replace(/\s/g, '');
    if (!t) return null;
    const numStr = t.replace(/\./g, '').replace(',', '.');
    const num = parseFloat(numStr);
    return !Number.isNaN(num) && num > 0 ? num : null;
  }).catch(() => null);
  if (value == null) {
    const titleAttr = await page.locator('a[href*="/followers/"] span[title]').first().getAttribute('title').catch(() => null);
    if (titleAttr) value = parseTitleToFollowersCount(titleAttr);
  }
  return value;
}

const GET_FOLLOWERS_TIMEOUT_MS = 28_000;

/**
 * Acessa a página do perfil e retorna apenas o número de seguidores (para qualificar na descoberta sem extrair tudo).
 * Tem timeout global para não travar se a página não carregar.
 */
export async function getFollowersFromProfile(page: Page, profileUrl: string): Promise<number | null> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('getFollowersFromProfile timeout')), GET_FOLLOWERS_TIMEOUT_MS)
  );
  try {
    const result = await Promise.race([
      (async (): Promise<number | null> => {
        await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(2000);
        const main = page.locator('main').first();
        await main.waitFor({ state: 'visible', timeout: 8000 }).catch(() => null);
        if ((await main.count()) === 0) return null;
        await page.locator('a[href*="/followers/"]').first().waitFor({ state: 'visible', timeout: 6000 }).catch(() => null);
        let followers: number | null = await getFollowersFromTitleAttribute(page);
        if (followers == null) {
          const textContent = await main.allTextContents().then((arr) => arr.join('\n'));
          const fullText = textContent.replace(/\s+/g, ' ');
          followers = parseFollowersFromText(fullText);
        }
        if (followers == null) {
          const followersText = await page.locator('header, main').filter({ hasText: /seguidores|followers/i }).first().textContent().catch(() => null);
          if (followersText) followers = parseFollowersFromText(followersText);
        }
        return followers;
      })(),
      timeoutPromise,
    ]);
    return result;
  } catch {
    return null;
  }
}

export async function extractProfile(
  page: Page,
  handle: string,
  discoveredBy: DiscoveredBy,
  discoveredValue: string,
  config: CrawlConfig
): Promise<{ profile: ExtractedProfile; posts: ExtractedPost[] } | null> {
  const profileUrl = InstagramClient.profileUrl(handle);
  let retries = config.maxRetries;
  while (retries >= 0) {
    try {
      await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(2500);

      const profilePath = `/${handle.replace(/^@/, '')}/`;
      const onProfile = await page.waitForFunction(
        (path) => !window.location.pathname.includes('/p/') && window.location.pathname.includes(path),
        profilePath,
        { timeout: 10000 }
      ).catch(() => null);
      if (!onProfile) {
        retries--;
        continue;
      }
      await page.waitForTimeout(1500);

      const main = page.locator('main').first();
      await main.waitFor({ state: 'visible', timeout: 8000 }).catch(() => { });
      if ((await main.count()) === 0) {
        retries--;
        continue;
      }

      const textContent = await main.allTextContents().then((arr) => arr.join('\n'));
      const lines = textContent.split(/\n/).map((l) => l.trim()).filter(Boolean);
      const fullText = textContent.replace(/\s+/g, ' ');

      let display_name: string | null = null;
      let bio: string | null = null;
      let website: string | null = null;
      let followers: number | null = await getFollowersFromTitleAttribute(page);
      let following: number | null = null;
      let posts_count: number | null = null;
      let is_verified = false;
      let is_business = false;
      let category: string | null = null;

      const handleLower = handle.toLowerCase();
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.toLowerCase() === handleLower || line === `@${handleLower}`) {
          if (i > 0 && lines[i - 1] && !lines[i - 1].startsWith('@')) {
            display_name = normalizeString(lines[i - 1]);
          }
          continue;
        }
        if (/^\d+\s*publicações?$/i.test(line) || /^(\d+)\s*posts?$/i.test(line)) {
          const m = line.match(/(\d+)/);
          if (m) posts_count = normalizeNumber(m[1]);
          continue;
        }
        const followersLineMatch = line.match(/(\d[\d.,\s]*)\s*(?:mil|k|m|milhão|milhões)?\s*seguidores/i)
          ?? line.match(/(\d[\d.,\s]*)\s*(?:mil|k|m)?\s*followers?/i);
        if (followersLineMatch) {
          const numStr = followersLineMatch[1].replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
          const n = parseFloat(numStr);
          if (!isNaN(n)) followers = applyFollowersMultiplier(n, followersLineMatch[0] || '');
          continue;
        }
        if (/^\d+[\s.]*\d*\s*seguindo$/i.test(line) || /^(\d+[\s.]*\d*)\s*following$/i.test(line)) {
          const m = line.replace(/\s/g, '').replace(/\./g, '').match(/(\d+)/);
          if (m) following = normalizeNumber(m[1]);
          continue;
        }
        if (line.length > 2 && line.length < 500 && !/^\d+$/.test(line) && !/^@/.test(line)) {
          if (!bio && !line.includes('seguidores') && !line.includes('seguindo') && !line.includes('publicações')) {
            bio = normalizeString(line, BIO_MAX);
          }
        }
      }

      if (followers == null) {
        const followersMatch = fullText.match(/(\d[\d.,\s]*)\s*(?:mil|k|m|milhão|milhões)?\s*seguidores/i) ?? fullText.match(/(\d[\d.,\s]*)\s*(?:mil|k|m)?\s*followers?/i);
        if (followersMatch) {
          const numStr = followersMatch[1].replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
          const n = parseFloat(numStr);
          if (!isNaN(n)) followers = applyFollowersMultiplier(n, followersMatch[0] || '');
        }
      }
      if (followers == null) {
        const followersText = await page.locator('header, main').filter({ hasText: /seguidores|followers/i }).first().textContent().catch(() => null);
        if (followersText) {
          const m = followersText.match(/(\d[\d.,\s]*)\s*(?:mil|k|m|milhão|milhões)?\s*seguidores/i) ?? followersText.match(/(\d[\d.,\s]*)\s*(?:mil|k|m)?\s*followers?/i);
          if (m) {
            const numStr = m[1].replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
            const n = parseFloat(numStr);
            if (!isNaN(n)) followers = applyFollowersMultiplier(n, m[0] || '');
          }
        }
      }
      if (following == null) {
        const followingMatch = fullText.match(/(\d[\d.,\s]*)\s*seguindo/i) ?? fullText.match(/(\d[\d.,\s]*)\s*following/i);
        if (followingMatch) {
          const numStr = followingMatch[1].replace(/\s/g, '').replace(/\./g, '');
          const n = parseInt(numStr, 10);
          if (!isNaN(n)) following = n;
        }
      }
      if (posts_count == null) {
        const postsMatch = fullText.match(/(\d+)\s*(?:publicações?|posts?)/i);
        if (postsMatch) posts_count = normalizeNumber(postsMatch[1]);
      }

      if (!bio) {
        const bioFromPage = await page.evaluate((maxLen: number) => {
          const header = document.querySelector('header');
          if (!header) return null;
          const skip = /seguidores|seguindo|publicações|posts?|followers?|following/i;
          const spans = header.querySelectorAll('span, div');
          let best = '';
          for (const el of spans) {
            const t = (el.textContent || '').trim();
            if (t.length < 15 || t.length > maxLen) continue;
            if (skip.test(t)) continue;
            if (/^\d+[\d.,\s]*$/.test(t)) continue;
            if (t.startsWith('@')) continue;
            const childSpans = el.querySelectorAll('span, div');
            if (childSpans.length > 2) continue;
            if (t.length > best.length) best = t;
          }
          return best || null;
        }, BIO_MAX).catch(() => null);
        if (bioFromPage) bio = normalizeString(bioFromPage, BIO_MAX);
      }
      if (!bio) {
        const bioSelectors = [
          'header section span',
          'header section div',
          'header span',
          'main header span',
        ];
        for (const sel of bioSelectors) {
          const els = page.locator(sel);
          const count = await els.count();
          for (let i = 0; i < Math.min(count, 8); i++) {
            const text = await els.nth(i).textContent().catch(() => null);
            if (!text) continue;
            const t = text.trim();
            if (t.length >= 15 && t.length <= BIO_MAX && !/seguidores|seguindo|publicações|^\d+[\d.,\s]*$/.test(t) && !t.startsWith('@')) {
              bio = normalizeString(t, BIO_MAX);
              break;
            }
          }
          if (bio) break;
        }
      }
      if (!bio) {
        const headerText = await page.locator('header').textContent().catch(() => null);
        if (headerText) {
          const lines = headerText.split(/\n/).map((l) => l.trim()).filter((l) => l.length >= 15 && l.length <= BIO_MAX);
          for (const line of lines) {
            if (/seguidores|seguindo|publicações|^\d+[\d.,\s]*$|^@/.test(line)) continue;
            bio = normalizeString(line, BIO_MAX);
            break;
          }
        }
      }

      if (!display_name) {
        const nameSelectors = ['header h1', 'header h2', 'header span', 'main h1', 'main h2'];
        for (const sel of nameSelectors) {
          const nameEl = page.locator(sel).first();
          const nameText = await nameEl.textContent().catch(() => null);
          if (nameText) {
            const t = nameText.trim();
            if (t.length > 0 && t.length < 120 && !/^\d+$/.test(t) && !t.startsWith('@') && t.toLowerCase() !== handleLower) {
              display_name = normalizeString(t);
              break;
            }
          }
        }
      }
      if (!display_name) display_name = normalizeString(handle);

      let profile_image_url: string | null = null;
      await page.locator('header img, main img').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => { });
      const imgFromPage = await page.evaluate(() => {
        const header = document.querySelector('header');
        if (header) {
          const imgs = header.querySelectorAll('img[src^="http"]');
          for (const img of imgs) {
            const s = (img as HTMLImageElement).src;
            if (s && (s.includes('cdninstagram') || s.includes('fbcdn')) && !s.includes('emoji')) return s.split('?')[0];
          }
        }
        const main = document.querySelector('main');
        if (main) {
          const imgs = main.querySelectorAll('img[src^="http"]');
          for (const img of imgs) {
            const s = (img as HTMLImageElement).src;
            if (s && s.length < 600 && !s.includes('emoji')) return s.split('?')[0];
          }
        }
        return null;
      }).catch(() => null);
      if (imgFromPage) profile_image_url = imgFromPage;
      if (!profile_image_url) {
        const imgSelectors = [
          'header img[src*="cdninstagram"]',
          'header img[src*="fbcdn"]',
          'header img[src^="https://"]',
          'main header img',
          'main img[src*="cdninstagram"]',
        ];
        for (const sel of imgSelectors) {
          try {
            const img = page.locator(sel).first();
            if ((await img.count()) === 0) continue;
            const src = await img.getAttribute('src');
            if (src && src.startsWith('https://') && !src.includes('emoji') && src.length < 600) {
              profile_image_url = src.split('?')[0];
              break;
            }
          } catch {
            continue;
          }
        }
      }

      const linkEl = page.locator('header a[href^="http"]').first();
      const href = await linkEl.getAttribute('href');
      if (href && !href.includes('instagram.com')) website = normalizeString(href);

      const verifiedEl = page.locator('header svg[aria-label*="Verified"], [aria-label*="Verificado"]').first();
      is_verified = (await verifiedEl.count()) > 0;

      const categoryEl = page.locator('header span').filter({ hasText: /^[^@\d]{3,50}$/ }).first();
      const catText = await categoryEl.textContent().catch(() => null);
      if (catText && catText.length < 80) category = normalizeString(catText);

      is_business = (await page.locator('a[href*="contact"], button:has-text("Contato")').count()) > 0;

      const emptyAddress: Address = {
        street: null,
        number: null,
        neighborhood: null,
        city: null,
        state: null,
        postal_code: null,
        country: null,
        raw_text: null,
      };
      let address: Address = emptyAddress;
      try {
        address = await extractAddress(page, bio, Math.min(RAW_TEXT_MAX, config.addressRawTextMaxChars));
      } catch {
        // Mantém endereço vazio; perfil é salvo mesmo sem endereço
      }

      const public_email = extractPublicEmail(bio ?? '');
      const public_phone = extractPublicPhone(bio ?? '');

      const maxForInsights = config.maxPostsToAnalyzeForInsights ?? 3;
      const POST_INSIGHTS_TIMEOUT_MS = 90_000; // 90s para não travar aqui
      crawlLogExtract(`  insights: abrindo até ${maxForInsights} posts...`);
      let insights: Awaited<ReturnType<typeof extractPostInsights>>['insights'] = null;
      let posts: import('../types/index.js').ExtractedPost[] = [];
      try {
        const result = await Promise.race([
          extractPostInsights(page, profileUrl, maxForInsights),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('extractPostInsights timeout')), POST_INSIGHTS_TIMEOUT_MS)),
        ]);
        insights = result.insights;
        posts = result.posts;
      } catch (e) {
        crawlLogExtract(`  insights: timeout ou erro, continuando sem posts (${e instanceof Error ? e.message : String(e)})`);
      }

      const profile: ExtractedProfile = {
        platform: 'instagram',
        handle,
        profile_url: profileUrl,
        profile_image_url,
        display_name,
        bio,
        website,
        followers,
        following,
        posts_count,
        is_verified,
        is_business,
        category,
        address,
        public_email,
        public_phone,
        post_insights: insights ?? null,
        discovered_by: discoveredBy,
        discovered_value: discoveredValue,
        collected_at: new Date().toISOString(),
      };

      const final = ensureWithinLimit(
        profile,
        config.nodeMaxBytes,
        config.bioMaxChars,
        config.addressRawTextMaxChars
      ) as ExtractedProfile;
      return { profile: final, posts };
    } catch {
      retries--;
    }
  }
  return null;
}
