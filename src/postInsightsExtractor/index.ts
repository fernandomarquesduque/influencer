import type { Page } from 'playwright';
import type { PostInsights, ExtractedPost } from '../types/index.js';
import { inferCategoriesFromHashtags } from '../utils/inferCategoriesFromHashtags.js';

const MAX_HASHTAGS = 100;
const MAX_LOCATIONS = 50;

export interface PostInsightsResult {
  insights: PostInsights | null;
  posts: ExtractedPost[];
}

function parseLikesCount(text: string): number | null {
  const m = text.match(/(\d[\d.,\s]*)\s*(?:curtidas?|likes?)/i);
  if (!m) return null;
  const n = parseInt(m[1].replace(/\s/g, '').replace(/\./g, '').replace(',', ''), 10);
  return Number.isNaN(n) ? null : n;
}

function parseCommentsCount(text: string): number | null {
  const m = text.match(/(\d[\d.,\s]*)\s*(?:comentários?|comments?)/i) ?? text.match(/ver\s+todos?\s+os?\s+(\d+)/i);
  if (!m) return null;
  const n = parseInt(m[1].replace(/\s/g, ''), 10);
  return Number.isNaN(n) ? null : n;
}

const LOCATION_KEYWORDS = new Set([
  'tatuapé', 'tatuape', 'pinheiros', 'vila madalena', 'moema', 'jardins', 'itaim bibi',
  'são paulo', 'sao paulo', 'sp', 'paulista', 'centro', 'copacabana', 'ipanema', 'leblon', 'barra',
  'rio de janeiro', 'rio', 'rj', 'belo horizonte', 'bh', 'curitiba', 'porto alegre', 'recife',
  'salvador', 'fortaleza', 'brasília', 'brasilia', 'df', 'campinas', 'guarulhos', 'santo andré',
  'santo andre', 'osasco', 'são bernardo', 'sao bernardo', 'abc', 'atibaia', 'sorocaba',
  'santos', 'praia grande', 'guarujá', 'guaruja', 'interior', 'capital', 'zona sul', 'zona norte',
  'zona leste', 'zona oeste', 'litoral', 'litoral norte', 'litoral sul',
]);

function extractHashtags(text: string): string[] {
  const matches = text.match(/#[\w\u00C0-\u024F\u1E00-\u1EFF]+/g);
  if (!matches) return [];
  return [...new Set(matches.map((m) => m.slice(1).toLowerCase()))];
}

function extractLocationsFromText(text: string): string[] {
  const lower = text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const found: string[] = [];
  for (const loc of LOCATION_KEYWORDS) {
    const locNorm = loc.normalize('NFD').replace(/\p{M}/gu, '');
    if (lower.includes(locNorm)) found.push(loc);
  }
  return [...new Set(found)];
}

export async function extractPostInsights(
  page: Page,
  profileUrl: string,
  maxPosts: number
): Promise<PostInsightsResult> {
  const allHashtags = new Set<string>();
  const allLocations = new Set<string>();
  const allCaptionTexts: string[] = [];
  const extractedPosts: ExtractedPost[] = [];

  try {
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000);

    const postLinks = page.locator('a[href*="/p/"]');
    const count = await postLinks.count();
    const toOpen = Math.min(maxPosts, count);
    const hrefs: string[] = [];
    for (let i = 0; i < toOpen; i++) {
      const href = await postLinks.nth(i).getAttribute('href');
      if (href && !hrefs.includes(href)) hrefs.push(href);
    }

    let postIndex = 0;
    for (const href of hrefs) {
      postIndex++;
      const fullUrl = href.startsWith('http') ? href : `https://www.instagram.com${href}`;
      const shortcode = (href.replace(/^.*\/p\/([^/?#]+).*$/, '$1').trim() || fullUrl.split('/p/')[1]?.split('/')[0]) ?? '';
      if (process.env.CRAWL_LOG_QUIET !== '1') {
        console.log(`[extract] insights: post ${postIndex}/${hrefs.length}`);
      }
      try {
        await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 12000 });
        await page.waitForTimeout(1500);

        let captionText = '';
        const captionSelectors = [
          'span[class*="Caption"]',
          'h1',
          '[data-ad-preview="message"]',
          'section span',
        ];
        for (const sel of captionSelectors) {
          const el = page.locator(sel).first();
          if ((await el.count()) === 0) continue;
          const text = await el.textContent().catch(() => null);
          if (text && text.length > 10 && text.length < 3000) {
            captionText = text;
            break;
          }
        }
        if (!captionText) {
          const main = page.locator('main');
          captionText = (await main.textContent().catch(() => '')) ?? '';
        }

        const hashtags = extractHashtags(captionText);
        hashtags.forEach((h) => allHashtags.add(h));
        const locs = extractLocationsFromText(captionText);
        locs.forEach((l) => allLocations.add(l));
        if (captionText.trim().length > 0) {
          allCaptionTexts.push(captionText.trim());
        }

        const mainText = (captionText || (await page.locator('main').textContent().catch(() => ''))) ?? '';
        const likesCount = parseLikesCount(mainText);
        const commentsCount = parseCommentsCount(mainText);

        let media_url: string | null = null;
        let media_type: 'image' | 'video' = 'image';
        const imgSrc = await page.locator('main img[src^="http"]').first().getAttribute('src').catch(() => null);
        if (imgSrc && (imgSrc.includes('cdninstagram') || imgSrc.includes('fbcdn') || imgSrc.includes('cdninstagram'))) {
          media_url = imgSrc.split('?')[0] ?? imgSrc;
        }
        if (!media_url) {
          const videoSrc = await page.locator('main video source[src]').first().getAttribute('src').catch(() => null);
          if (videoSrc) {
            media_url = videoSrc.split('?')[0] ?? videoSrc;
            media_type = 'video';
          }
        }
        if (!media_url && imgSrc) {
          media_url = imgSrc.split('?')[0] ?? imgSrc;
        }

        extractedPosts.push({
          post_url: fullUrl,
          shortcode,
          media_url,
          media_type,
          likes_count: likesCount,
          comments_count: commentsCount,
          caption: captionText.trim() || null,
          hashtags,
        });
      } catch {
        extractedPosts.push({
          post_url: fullUrl,
          shortcode,
          media_url: null,
          media_type: 'image',
          likes_count: null,
          comments_count: null,
          caption: null,
          hashtags: [],
        });
      }
      await page.waitForTimeout(1000);
    }

    const hashtagsList = [...allHashtags].slice(0, MAX_HASHTAGS);
    const locationsList = [...allLocations].slice(0, MAX_LOCATIONS);
    const inferred_categories = inferCategoriesFromHashtags(hashtagsList, allCaptionTexts);

    const insights: PostInsights | null =
      hashtagsList.length === 0 && locationsList.length === 0 && inferred_categories.length === 0
        ? null
        : {
            hashtags: hashtagsList,
            locations_mentioned: locationsList,
            inferred_categories,
          };

    return { insights, posts: extractedPosts };
  } catch {
    return { insights: null, posts: [] };
  }
}
