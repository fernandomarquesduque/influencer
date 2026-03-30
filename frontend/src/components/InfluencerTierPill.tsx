import { Tooltip } from 'antd'
import {
  getInfluencerTierGradientCss,
  getInfluencerTierShort,
  getInfluencerTierSolidHexForTierLabel,
  getInfluencerTierTooltip,
  getInfluencerTierTooltipFromLabel,
  sizeBucketKeyToTierLabel,
  type InfluencerTierLabel,
} from '../utils/influencerTier'

export interface InfluencerTierPillProps {
  /** Se definido e finito, patamar derivado dos seguidores (prioridade). */
  followers?: number | null
  /** Chave da API (`nano` | `micro` | `medio` | `macro`) quando não se usa seguidores. */
  sizeKey?: string | null
  /**
   * `gradient`: selo compacto (campanha, galeria).
   * `chip`: mesmo formato dos badges do preview (`.iprv-mini-badge`) — só cores do tier.
   */
  variant?: 'gradient' | 'chip'
}

/** Selo Nano/Micro/Mid/Macro — cores de `influencerTier.ts`. */
export default function InfluencerTierPill({ followers, sizeKey, variant = 'gradient' }: InfluencerTierPillProps) {
  let tier: InfluencerTierLabel
  let tooltip: string | undefined

  if (followers != null && Number.isFinite(followers)) {
    tier = getInfluencerTierShort(followers)
    tooltip = getInfluencerTierTooltip(followers)
  } else {
    tier = sizeBucketKeyToTierLabel(sizeKey)
    tooltip = getInfluencerTierTooltipFromLabel(tier)
  }

  if (tier === '—') return null

  if (variant === 'chip') {
    const hex = getInfluencerTierSolidHexForTierLabel(tier)
    return (
      <Tooltip title={tooltip}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            borderRadius: 999,
            padding: '3px 8px',
            fontSize: 12,
            lineHeight: 1.2,
            flexShrink: 0,
            border: hex ? `1px solid ${hex}` : undefined,
            background: hex ? `${hex}18` : undefined,
            color: hex,
          }}
        >
          {tier}
        </span>
      </Tooltip>
    )
  }

  return (
    <Tooltip title={tooltip}>
      <span
        style={{
          fontSize: 9,
          fontWeight: 600,
          color: '#fff',
          padding: '1px 5px',
          borderRadius: 8,
          flexShrink: 0,
          background: getInfluencerTierGradientCss(tier),
          lineHeight: 1.2,
          display: 'inline-block',
        }}
      >
        {tier}
      </span>
    </Tooltip>
  )
}
