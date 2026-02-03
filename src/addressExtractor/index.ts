import type { Page } from 'playwright';
import type { Address } from '../types/index.js';
import { normalizeAddressFromText } from '../normalizers/index.js';

const BIO_ADDRESS_PATTERNS = [
  /\b(?:Rua|R\.|Av\.|Avenida|Al\.|Travessa|Trav\.|Praça|Pça\.?)\s+[^,\n]+(?:,\s*n[º°.]?\s*\d+)?/gi,
  /\b(?:Bairro|B\.?)\s*[:.]?\s*[^,\n]+/gi,
  /\b\d{5}-?\d{3}\b/g,
  /\b(?:AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/gi,
  /\b(?:Cidade|Município)\s*[:.]?\s*[^,\n]+/gi,
];

function hasAddressLikeContent(text: string): boolean {
  const lower = text.toLowerCase();
  if (/\d{5}-?\d{3}/.test(text)) return true;
  if (/\b(rua|av\.|avenida|alameda|travessa|bairro|cep|cidade)\b/i.test(lower)) return true;
  if (/\b(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/.test(text)) return true;
  return false;
}

/**
 * 1) Extrai endereço da bio (linha a linha, padrões BR).
 */
export function extractAddressFromBio(bio: string | null | undefined, rawTextMaxChars: number): Address {
  if (!bio || !hasAddressLikeContent(bio)) {
    return {
      street: null,
      number: null,
      neighborhood: null,
      city: null,
      state: null,
      postal_code: null,
      country: null,
      raw_text: null,
    };
  }
  const lines = bio.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const addressLines: string[] = [];
  for (const line of lines) {
    let matched = false;
    for (const re of BIO_ADDRESS_PATTERNS) {
      re.lastIndex = 0;
      if (re.test(line)) {
        matched = true;
        break;
      }
    }
    if (matched || line.length < 100) addressLines.push(line);
  }
  const raw = addressLines.length > 0 ? addressLines.join(' ').slice(0, rawTextMaxChars) : null;
  return normalizeAddressFromText(raw ?? bio.slice(0, rawTextMaxChars), rawTextMaxChars);
}

/**
 * 2) Perfil comercial: abre modal Contato/Endereço, captura só texto visível, fecha.
 */
export async function extractAddressFromContactModal(
  page: Page,
  rawTextMaxChars: number
): Promise<Address | null> {
  const contactSelectors = [
    'a[href*="contact"]',
    'button:has-text("Contato")',
    'span:has-text("Contato")',
    '[aria-label*="Contato"]',
    'a:has-text("Endereço")',
    'button:has-text("Endereço")',
    'span:has-text("Endereço")',
  ];
  for (const sel of contactSelectors) {
    try {
      const el = page.locator(sel).first();
      if ((await el.count()) === 0) continue;
      await el.click({ timeout: 3000 });
      await page.waitForTimeout(1500);
      const modal = page.locator('[role="dialog"], [aria-modal="true"], .modal, section').first();
      if ((await modal.count()) > 0) {
        const text = await modal.allTextContents().then((arr) => arr.join(' ').replace(/\s+/g, ' ').trim());
        const raw = text.slice(0, rawTextMaxChars);
        const address = normalizeAddressFromText(raw || null, rawTextMaxChars);
        const closeBtn = page.locator('button[aria-label="Fechar"], [aria-label="Close"], button:has-text("Fechar")').first();
        if ((await closeBtn.count()) > 0) await closeBtn.click().catch(() => { });
        else await page.keyboard.press('Escape');
        return address;
      }
    } catch {
      await page.keyboard.press('Escape').catch(() => { });
    }
  }
  return null;
}

/**
 * 3) Geotag: até 3 últimos posts, se tiver local — abre, pega nome/área, não navega histórico.
 */
export async function extractAddressFromGeotag(
  page: Page,
  rawTextMaxChars: number,
  maxPostsToCheck: number = 3
): Promise<Address | null> {
  try {
    const anchors = page.locator('article a[href*="/p/"]');
    if ((await anchors.count()) === 0) return null;

    const links: string[] = [];
    const n = await anchors.count();
    for (let i = 0; i < Math.min(maxPostsToCheck, n); i++) {
      const href = await anchors.nth(i).getAttribute('href');
      if (href && !links.includes(href)) links.push(href);
    }

    for (const postUrl of links) {
      const fullUrl = postUrl.startsWith('http') ? postUrl : `https://www.instagram.com${postUrl}`;
      await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(800);

      const locationLink = page.locator('a[href*="/explore/locations/"]').first();
      if ((await locationLink.count()) === 0) continue;

      await locationLink.click({ timeout: 3000 });
      await page.waitForTimeout(1500);

      const locationText = await page.locator('main, [role="main"], header').first().allTextContents()
        .then((arr) => arr.join(' ').replace(/\s+/g, ' ').trim().slice(0, rawTextMaxChars));
      if (locationText) {
        const address = normalizeAddressFromText(locationText, rawTextMaxChars);
        if (address.city || address.raw_text) return address;
      }
      await page.goBack().catch(() => { });
      await page.waitForTimeout(1000);
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Orquestra: bio primeiro, depois modal comercial, depois geotag. Mescla em um único Address.
 */
export async function extractAddress(
  page: Page,
  bio: string | null,
  rawTextMaxChars: number
): Promise<Address> {
  const fromBio = extractAddressFromBio(bio, rawTextMaxChars);
  const hasFromBio = Boolean(
    fromBio.street || fromBio.city || fromBio.state || fromBio.postal_code || fromBio.raw_text
  );
  if (hasFromBio) return fromBio;

  const fromModal = await extractAddressFromContactModal(page, rawTextMaxChars);
  if (fromModal && (fromModal.raw_text || fromModal.city || fromModal.street)) {
    return {
      ...fromModal,
      raw_text: fromModal.raw_text ?? fromBio.raw_text,
    };
  }

  const fromGeotag = await extractAddressFromGeotag(page, rawTextMaxChars);
  if (fromGeotag && (fromGeotag.raw_text || fromGeotag.city)) {
    return {
      ...fromGeotag,
      raw_text: fromGeotag.raw_text ?? fromBio.raw_text,
    };
  }

  return fromBio;
}
