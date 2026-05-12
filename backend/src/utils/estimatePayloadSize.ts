/**
 * Estima o tamanho em bytes do payload serializado (JSON) para validar limite de node/documento (≤1MB).
 * Usado antes de salvar para truncar bio/raw_text se necessário.
 */

export function estimatePayloadSize(obj: unknown): number {
  const str = JSON.stringify(obj);
  return new TextEncoder().encode(str).byteLength;
}

/**
 * Verifica se o payload está dentro do limite e retorna o objeto (possivelmente truncado).
 * Trunca bio e address.raw_text se exceder nodeMaxBytes.
 */
export function ensureWithinLimit<T extends { bio?: string | null; address?: { raw_text?: string | null } }>(
  obj: T,
  nodeMaxBytes: number,
  bioMaxChars: number,
  addressRawTextMaxChars: number
): T {
  let current = { ...obj };
  if (current.bio && current.bio.length > bioMaxChars) {
    current = { ...current, bio: current.bio.slice(0, bioMaxChars) };
  }
  if (current.address?.raw_text && current.address.raw_text.length > addressRawTextMaxChars) {
    current = {
      ...current,
      address: { ...current.address, raw_text: current.address.raw_text.slice(0, addressRawTextMaxChars) },
    };
  }
  while (estimatePayloadSize(current) > nodeMaxBytes) {
    if (current.bio && current.bio.length > 0) {
      current = { ...current, bio: current.bio.slice(0, Math.max(0, current.bio.length - 100)) };
      continue;
    }
    if (current.address?.raw_text && current.address.raw_text.length > 0) {
      current = {
        ...current,
        address: {
          ...current.address,
          raw_text: current.address.raw_text.slice(0, Math.max(0, (current.address.raw_text?.length ?? 0) - 100)),
        },
      };
      continue;
    }
    break;
  }
  return current;
}
