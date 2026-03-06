/**
 * Barra de progresso gamificada: nível atual → alvo.
 * Visual tipo "level up" / quest: fundo escuro, bordas douradas.
 */
import React from 'react'
import { TrophyOutlined, StarFilled } from '@ant-design/icons'
import { reportTokens as t } from '../pages/reportTokens'

const c = t.colors
const typ = t.typography

const MILESTONES = [0.25, 0.5, 0.75] as const
const BAR_HEIGHT = 16

export interface TierProgressGameBarProps {
  currentTier: string
  nextTier: string
  remainingFollowers: number
  progress: number
}

export function TierProgressGameBar({
  currentTier,
  nextTier,
  remainingFollowers,
  progress,
}: TierProgressGameBarProps) {
  const percent = Math.round(progress * 100)
  const progressPct = Math.min(100, Math.max(0, percent))

  return (
    <div className="tier-progress-game-bar tier-progress-game-bar--gamified">
      <div className="tier-progress-game-bar__quest-card">
        {/* Faixa "PRÓXIMO PATAMAR" */}
        <div className="tier-progress-game-bar__ribbon">
          <span>PRÓXIMO PATAMAR</span>
        </div>

        {/* Título: Mid → Macro */}
        <div className="tier-progress-game-bar__header">
          <span className="tier-progress-game-bar__title">
            {currentTier} → {nextTier}
          </span>
          <span className="tier-progress-game-bar__counter">
            Faltam {remainingFollowers.toLocaleString('pt-BR')}
          </span>
        </div>

        {/* Barra + labels */}
        <div className="tier-progress-game-bar__bar-row">
          <span className="tier-progress-game-bar__tier-label">{currentTier.toUpperCase()}</span>

          <div className="tier-progress-game-bar__track-container">
            <div className="tier-progress-game-bar__track">
              <div
                className="tier-progress-game-bar__fill"
                style={{ width: `${progressPct}%` }}
              />
              {MILESTONES.map((m) => (
                <span
                  key={m}
                  className={`tier-progress-game-bar__checkpoint ${progress >= m ? 'tier-progress-game-bar__checkpoint--reached' : ''}`}
                  style={{ left: `${m * 100}%` }}
                >
                  <StarFilled />
                </span>
              ))}
            </div>

            <div
              className="tier-progress-game-bar__badge"
              style={{ left: `${Math.max(8, Math.min(progressPct, 92))}%` }}
            >
              {percent}%
            </div>

            <div className="tier-progress-game-bar__milestone-labels">
              {MILESTONES.map((m) => (
                <span
                  key={m}
                  className="tier-progress-game-bar__milestone-label"
                  style={{ left: `${m * 100}%` }}
                >
                  {m * 100}%
                </span>
              ))}
            </div>
          </div>

          <div className="tier-progress-game-bar__tier-next">
            <span className="tier-progress-game-bar__tier-label">{nextTier.toUpperCase()}</span>
            <TrophyOutlined className="tier-progress-game-bar__trophy" aria-hidden />
          </div>
        </div>
      </div>
    </div>
  )
}

/** Alias para uso como TierProgressBarPremium (mesmo componente) */
export const TierProgressBarPremium = TierProgressGameBar
