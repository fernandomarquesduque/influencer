import type { Page } from 'playwright';
import type { ExtractedProfile, Address, DiscoveredBy } from '../types/index.js';
import { normalizeNumber, normalizeString } from '../normalizers/index.js';
import { extractAddress } from '../addressExtractor/index.js';
import { ensureWithinLimit } from '../utils/estimatePayloadSize.js';
import type { CrawlConfig } from '../types/index.js';
import { InstagramClient } from '../instagramClient/index.js';

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

export async function extractProfile(
  page: Page,
  handle: string,
  discoveredBy: DiscoveredBy,
  discoveredValue: string,
  config: CrawlConfig
): Promise<ExtractedProfile | null> {
  const profileUrl = InstagramClient.profileUrl(handle);
  let retries = config.maxRetries;
  while (retries >= 0) {
    try {
      await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(1500);

      const main = page.locator('main').first();
      if ((await main.count()) === 0) {
        retries--;
        continue;
      }

      const textContent = await main.allTextContents().then((arr) => arr.join('\n'));
      const lines = textContent.split(/\n/).map((l) => l.trim()).filter(Boolean);

      let display_name: string | null = null;
      let bio: string | null = null;
      let website: string | null = null;
      let followers: number | null = null;
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
        if (/^\d+[\s.]*\d*\s*seguidores$/i.test(line) || /^(\d+[\s.]*\d*)\s*followers?$/i.test(line)) {
          const m = line.replace(/\s/g, '').replace(/\./g, '').match(/(\d+)/);
          if (m) followers = normalizeNumber(m[1]);
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

      if (!bio) {
        const bioEl = page.locator('header section div').filter({ hasNot: page.locator('a') }).first();
        const bioText = await bioEl.textContent().catch(() => null);
        if (bioText) bio = normalizeString(bioText.trim(), BIO_MAX);
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

      const address = await extractAddress(page, bio, Math.min(RAW_TEXT_MAX, config.addressRawTextMaxChars));

      const public_email = extractPublicEmail(bio ?? '');
      const public_phone = extractPublicPhone(bio ?? '');

      const profile: ExtractedProfile = {
        platform: 'instagram',
        handle,
        profile_url: profileUrl,
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
      return final;
    } catch {
      retries--;
    }
  }
  return null;
}
