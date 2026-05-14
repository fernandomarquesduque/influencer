/** Rótulo legível para valores de facetas (o valor bruto permanece nos filtros). */
export function formatFacetLabel(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return raw
  if (trimmed.toLowerCase() === 'unknown') return 'Desconhecido'
  const s = trimmed.replace(/[_-]+/g, ' ')
  if (!s) return raw
  return s
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export function facetOptionLabel(name: string, count?: number): string {
  const label = formatFacetLabel(name)
  return count != null ? `${label} (${count})` : label
}
