import { useState } from 'react'
import { Button } from 'antd'
import { LockOutlined } from '@ant-design/icons'
import type { ProfileItem } from '../../api'
import BuscaInfluencerPlansModal from '../BuscaInfluencerPlansModal/BuscaInfluencerPlansModal'
import { trackPlansIntent } from '../../utils/metaPixelFunnel'
import './ProfileLimitedPreviewLock.css'

export type PreviewEngagementByType = {
  posts: { er: number; count: number }
  reels: { er: number; erByViews?: number; count: number }
  tagged: { er: number; count: number }
}

function PreviewChartsTeaser() {
  return (
    <div className="profile-limited-preview__teaser" aria-hidden>
      <svg
        className="profile-limited-preview__teaser-svg"
        viewBox="0 0 720 112"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="pp-area" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#a855f7" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#ec4899" stopOpacity="0.08" />
          </linearGradient>
          <linearGradient id="pp-line" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#7c3aed" />
            <stop offset="50%" stopColor="#ec4899" />
            <stop offset="100%" stopColor="#06b6d4" />
          </linearGradient>
          <linearGradient id="pp-bar1" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#c4b5fd" />
          </linearGradient>
          <linearGradient id="pp-bar2" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#06b6d4" />
            <stop offset="100%" stopColor="#67e8f9" />
          </linearGradient>
          <linearGradient id="pp-bar3" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ec4899" />
            <stop offset="100%" stopColor="#f9a8d4" />
          </linearGradient>
          <linearGradient id="pp-bar4" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#fcd34d" />
          </linearGradient>
          <linearGradient id="pp-bar5" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="100%" stopColor="#6ee7b7" />
          </linearGradient>
        </defs>

        {/* Painel esquerdo — área + linha */}
        <rect x="12" y="14" width="168" height="84" rx="8" fill="#fff" fillOpacity="0.85" />
        <text x="22" y="30" fill="#6b7280" fontSize="9" fontWeight="600" fontFamily="system-ui, sans-serif">
          Crescimento
        </text>
        <path
          d="M24 82 L48 68 L72 74 L96 52 L120 58 L144 38 L168 44 L168 90 L24 90 Z"
          fill="url(#pp-area)"
        />
        <path
          d="M24 82 L48 68 L72 74 L96 52 L120 58 L144 38 L168 44"
          fill="none"
          stroke="url(#pp-line)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="144" cy="38" r="3.5" fill="#ec4899" />
        <circle cx="144" cy="38" r="6" fill="#ec4899" fillOpacity="0.25" />

        {/* Barras coloridas */}
        <rect x="196" y="14" width="148" height="84" rx="8" fill="#fff" fillOpacity="0.85" />
        <text x="206" y="30" fill="#6b7280" fontSize="9" fontWeight="600" fontFamily="system-ui, sans-serif">
          Engajamento
        </text>
        <rect x="212" y="58" width="18" height="32" rx="3" fill="url(#pp-bar1)" />
        <rect x="236" y="42" width="18" height="48" rx="3" fill="url(#pp-bar2)" />
        <rect x="260" y="50" width="18" height="40" rx="3" fill="url(#pp-bar3)" />
        <rect x="284" y="32" width="18" height="58" rx="3" fill="url(#pp-bar4)" />
        <rect x="308" y="46" width="18" height="44" rx="3" fill="url(#pp-bar5)" />

        {/* Donut multicolor */}
        <rect x="360" y="14" width="128" height="84" rx="8" fill="#fff" fillOpacity="0.85" />
        <text x="370" y="30" fill="#6b7280" fontSize="9" fontWeight="600" fontFamily="system-ui, sans-serif">
          Alcance
        </text>
        <circle cx="424" cy="58" r="28" fill="none" stroke="#ede9fe" strokeWidth="10" />
        <circle
          cx="424"
          cy="58"
          r="28"
          fill="none"
          stroke="#8b5cf6"
          strokeWidth="10"
          strokeDasharray="55 121"
          strokeDashoffset="0"
          transform="rotate(-90 424 58)"
        />
        <circle
          cx="424"
          cy="58"
          r="28"
          fill="none"
          stroke="#06b6d4"
          strokeWidth="10"
          strokeDasharray="40 121"
          strokeDashoffset="-55"
          transform="rotate(-90 424 58)"
        />
        <circle
          cx="424"
          cy="58"
          r="28"
          fill="none"
          stroke="#ec4899"
          strokeWidth="10"
          strokeDasharray="30 121"
          strokeDashoffset="-95"
          transform="rotate(-90 424 58)"
        />
        <circle
          cx="424"
          cy="58"
          r="28"
          fill="none"
          stroke="#f59e0b"
          strokeWidth="10"
          strokeDasharray="20 121"
          strokeDashoffset="-125"
          transform="rotate(-90 424 58)"
        />
        <text x="424" y="62" textAnchor="middle" fill="#1f2937" fontSize="11" fontWeight="700" fontFamily="system-ui, sans-serif">
          72%
        </text>

        {/* Heatmap + mini linha */}
        <rect x="504" y="14" width="204" height="84" rx="8" fill="#fff" fillOpacity="0.85" />
        <text x="514" y="30" fill="#6b7280" fontSize="9" fontWeight="600" fontFamily="system-ui, sans-serif">
          Interações
        </text>
        {[
          '#c4b5fd', '#a78bfa', '#8b5cf6', '#67e8f9', '#22d3ee', '#f9a8d4', '#ec4899',
          '#fde68a', '#fbbf24', '#6ee7b7', '#34d399', '#a78bfa', '#06b6d4', '#f472b6',
        ].map((color, i) => {
          const col = i % 7
          const row = Math.floor(i / 7)
          return (
            <rect
              key={i}
              x={514 + col * 26}
              y={38 + row * 22}
              width={22}
              height={18}
              rx="3"
              fill={color}
              opacity={0.75 + (i % 3) * 0.08}
            />
          )
        })}
        <path
          d="M514 88 Q560 78 600 82 T690 72"
          fill="none"
          stroke="#10b981"
          strokeWidth="2"
          strokeLinecap="round"
          opacity="0.9"
        />
      </svg>
    </div>
  )
}

export function engagementByTypeFromProfileRecord(profile: ProfileItem | null | undefined): PreviewEngagementByType | null {
  if (!profile) return null
  const raw = (profile as Record<string, unknown>).engagementByType
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, { er?: number; erByViews?: number; count?: number }>
  const slot = (key: 'posts' | 'reels' | 'tagged') => ({
    er: typeof o[key]?.er === 'number' && Number.isFinite(o[key]!.er) ? o[key]!.er! : 0,
    count: typeof o[key]?.count === 'number' && Number.isFinite(o[key]!.count) ? o[key]!.count! : 0,
    ...(key === 'reels' && typeof o.reels?.erByViews === 'number' ? { erByViews: o.reels.erByViews } : {}),
  })
  return { posts: slot('posts'), reels: slot('reels'), tagged: slot('tagged') }
}

export type ProfileLimitedPreviewLockProps = {
  isMobile?: boolean
  engagementByType?: PreviewEngagementByType | null
  rowGutter?: [number, number]
  user?: { id: number } | null
  handle?: string
}

export default function ProfileLimitedPreviewLock({
  user,
}: ProfileLimitedPreviewLockProps) {
  const [plansModalOpen, setPlansModalOpen] = useState(false)

  return (
    <>
      <section className="profile-limited-preview" aria-label="Prévia limitada do relatório">
        <div className="profile-limited-preview__blur">
          <PreviewChartsTeaser />
        </div>

        <div className="profile-limited-preview__overlay">
          <div className="profile-limited-preview__lock-icon" aria-hidden>
            <LockOutlined />
          </div>
          <div className="profile-limited-preview__copy">
            <h3 className="profile-limited-preview__title">Prévia limitada</h3>
            <p className="profile-limited-preview__desc">
              {user
                ? 'Assine para ver dados de contato, preços e insights completos.'
                : 'Faça login para ver os dados de contato, preços e insights exclusivos do influenciador.'}
            </p>
          </div>
          <div className="profile-limited-preview__cta-wrap">
            <Button
              type="primary"
              size="small"
              className="profile-limited-preview__cta"
              icon={<LockOutlined />}
              onClick={() => {
                trackPlansIntent('profile_lock', { source: 'profile_preview' })
                setPlansModalOpen(true)
              }}
            >
              Ver análises completas
            </Button>
          </div>
        </div>
      </section>
      <BuscaInfluencerPlansModal open={plansModalOpen} onClose={() => setPlansModalOpen(false)} />
    </>
  )
}
