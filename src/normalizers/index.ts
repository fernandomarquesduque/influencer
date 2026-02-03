import type { Address } from '../types/index.js';

const CEP_REGEX = /\b(\d{5}-?\d{3})\b/g;
const UF_REGEX = /\b(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/gi;
const RUA_AV_REGEX = /(?:Rua|R\.|Av\.|Avenida|Alameda|Travessa|Trav\.|Praça|Pça\.?)\s+([^,.\n]+)/gi;
const NUMERO_REGEX = /(?:nº|n°|numero|num\.?)\s*[:.]?\s*(\d+[A-Za-z]?)/i;
const BAIRRO_REGEX = /(?:Bairro|B\.?)\s*[:.]?\s*([^,.\n]+)/i;
const CIDADE_REGEX = /(?:Cidade|C\.?|Município)\s*[:.]?\s*([^,.\n]+)/i;

function trim(s: string | null | undefined): string | null {
  if (s == null || typeof s !== 'string') return null;
  const t = s.trim();
  return t === '' ? null : t;
}

function truncate(s: string | null, max: number): string | null {
  if (s == null) return null;
  if (s.length <= max) return s;
  return s.slice(0, max);
}

export function normalizeAddressFromText(text: string | null | undefined, rawTextMaxChars: number): Address {
  const result: Address = {
    street: null,
    number: null,
    neighborhood: null,
    city: null,
    state: null,
    postal_code: null,
    country: null,
    raw_text: truncate(trim(text) ?? null, rawTextMaxChars),
  };
  if (!text || typeof text !== 'string') return result;

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    const numMatch = line.match(NUMERO_REGEX);
    if (numMatch) result.number = trim(numMatch[1]) ?? result.number;

    const cepMatch = line.match(CEP_REGEX);
    if (cepMatch) result.postal_code = trim(cepMatch[0]?.replace(/-/g, '')) ?? result.postal_code;

    const ufMatch = line.match(UF_REGEX);
    if (ufMatch) result.state = trim(ufMatch[0]?.toUpperCase()) ?? result.state;

    const bairroMatch = line.match(BAIRRO_REGEX);
    if (bairroMatch) result.neighborhood = trim(bairroMatch[1]) ?? result.neighborhood;

    const cidadeMatch = line.match(CIDADE_REGEX);
    if (cidadeMatch) result.city = trim(cidadeMatch[1]) ?? result.city;

    let ruaMatch = RUA_AV_REGEX.exec(line);
    if (ruaMatch) result.street = trim(ruaMatch[1]) ?? result.street;
    RUA_AV_REGEX.lastIndex = 0;
  }

  if (!result.street && lines.length > 0) {
    const first = lines[0];
    if (!first.match(/^\d/) && first.length > 3 && first.length < 80) {
      result.street = trim(first) ?? result.street;
    }
  }

  if (!result.country && (result.state || result.postal_code)) {
    result.country = 'Brasil';
  }

  return result;
}

export function normalizeNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === 'string') {
    const n = parseInt(value.replace(/\D/g, ''), 10);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

export function normalizeBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return /^(1|true|yes|sim)$/i.test(value.trim());
  return false;
}

export function normalizeString(value: unknown, maxLength?: number): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (s === '') return null;
  if (maxLength != null && s.length > maxLength) return s.slice(0, maxLength);
  return s;
}
