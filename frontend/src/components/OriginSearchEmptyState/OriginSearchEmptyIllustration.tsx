/** Ilustração do empty state: caixa + lupa (estilo do layout de referência). */
export default function OriginSearchEmptyIllustration() {
  return (
    <svg
      className="origin-search-empty__illus-svg"
      viewBox="0 0 200 160"
      width="200"
      height="160"
      aria-hidden
      focusable="false"
    >
      <defs>
        <linearGradient id="origin-empty-box" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#faf7fd" />
          <stop offset="100%" stopColor="#efe8f8" />
        </linearGradient>
      </defs>
      {/* estrelas decorativas */}
      <path
        d="M28 42l2.2 4.5 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5-3.6-3.5 5-.7z"
        fill="#fde68a"
        opacity="0.95"
      />
      <path
        d="M168 28l1.6 3.2 3.5.5-2.5 2.4.6 3.5-3.1-1.7-3.1 1.7.6-3.5-2.5-2.4 3.5-.5z"
        fill="#c4b5fd"
        opacity="0.9"
      />
      <circle cx="175" cy="95" r="4" fill="#fde68a" opacity="0.8" />
      <circle cx="42" cy="108" r="3" fill="#ddd6fe" />
      {/* caixa */}
      <path
        d="M52 118V72l48-22 48 22v46H52z"
        fill="url(#origin-empty-box)"
        stroke="#d4c4e8"
        strokeWidth="1.5"
      />
      <path d="M100 50 L148 72 L100 94 L52 72 Z" fill="#fff" stroke="#e0d4ef" strokeWidth="1" />
      <path d="M52 72 L100 94 L100 118 L52 96 Z" fill="#f3edf9" stroke="#e0d4ef" strokeWidth="1" />
      <path d="M100 94 L148 72 L148 96 L100 118 Z" fill="#ebe3f5" stroke="#e0d4ef" strokeWidth="1" />
      {/* lupa — contorno clássico (anel + cabo) */}
      <g transform="translate(118 58)">
        <circle r="24" fill="#fff" fillOpacity="0.85" stroke="#8b5fae" strokeWidth="4.5" />
        <path
          d="M14 14 L34 36"
          fill="none"
          stroke="#8b5fae"
          strokeWidth="5.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  )
}
