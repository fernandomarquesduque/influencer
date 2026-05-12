/**
 * Normaliza caracteres Unicode "fancy" (ex.: Mathematical Bold) para ASCII equivalente.
 * Usado ao extrair textos do perfil (nome, bio, etc.) para evitar problemas de busca e exibição.
 */
export function normalizeFancyUnicode(input: string): string {
  if (!input) return '';
  const map: Record<string, string> = {
    // Mathematical Bold (A-Z)
    '𝐀': 'A', '𝐁': 'B', '𝐂': 'C', '𝐃': 'D', '𝐄': 'E', '𝐅': 'F', '𝐆': 'G', '𝐇': 'H', '𝐈': 'I', '𝐉': 'J', '𝐊': 'K', '𝐋': 'L', '𝐌': 'M', '𝐍': 'N', '𝐎': 'O', '𝐏': 'P', '𝐐': 'Q', '𝐑': 'R', '𝐒': 'S', '𝐓': 'T', '𝐔': 'U', '𝐕': 'V', '𝐖': 'W', '𝐗': 'X', '𝐘': 'Y', '𝐙': 'Z',
    // Mathematical Bold (a-z)
    '𝐚': 'a', '𝐛': 'b', '𝐜': 'c', '𝐝': 'd', '𝐞': 'e', '𝐟': 'f', '𝐠': 'g', '𝐡': 'h', '𝐢': 'i', '𝐣': 'j', '𝐤': 'k', '𝐥': 'l', '𝐦': 'm', '𝐧': 'n', '𝐨': 'o', '𝐩': 'p', '𝐪': 'q', '𝐫': 'r', '𝐬': 's', '𝐭': 't', '𝐮': 'u', '𝐯': 'v', '𝐰': 'w', '𝐱': 'x', '𝐲': 'y', '𝐳': 'z',
  };
  // U+1D400–1D419 = Mathematical Bold A–Z, 1D41A–1D433 = a–z (evita "Range out of order" com literais)
  return input.replace(/[\u{1D400}-\u{1D419}\u{1D41A}-\u{1D433}]/gu, (ch) => map[ch] ?? ch);
}

/**
 * Sanitiza texto extraído do perfil: normaliza Unicode fancy e remove caracteres de controle.
 */
export function sanitizeText(str: string): string {
  if (typeof str !== 'string') return '';
  return normalizeFancyUnicode(str)
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .trim();
}
