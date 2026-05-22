import type { ReactNode } from 'react'
import { findHighlightRangesInText } from '../../utils/queryRelevance'
import './HighlightedSearchText.css'

export type HighlightedSearchTextProps = {
  text: string
  query: string
  className?: string
}

/**
 * Renderiza texto com <mark> nos trechos que bateram na busca (tokens, frase, fuzzy, acentos).
 */
export default function HighlightedSearchText({ text, query, className }: HighlightedSearchTextProps) {
  const q = query.trim()
  if (!text) return <span className={className}>—</span>
  if (!q) return <span className={className}>{text}</span>

  const ranges = findHighlightRangesInText(text, q)
  if (ranges.length === 0) {
    return <span className={className}>{text}</span>
  }

  const parts: ReactNode[] = []
  let cursor = 0
  ranges.forEach((r, i) => {
    if (r.start > cursor) {
      parts.push(
        <span key={`t-${i}-pre`} className={className}>
          {text.slice(cursor, r.start)}
        </span>
      )
    }
    parts.push(
      <mark key={`m-${i}`} className="search-highlight-mark">
        {text.slice(r.start, r.end)}
      </mark>
    )
    cursor = r.end
  })
  if (cursor < text.length) {
    parts.push(
      <span key="tail" className={className}>
        {text.slice(cursor)}
      </span>
    )
  }

  return <>{parts}</>
}
