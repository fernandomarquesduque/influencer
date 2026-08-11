/**
 * Gauge de ER (Engagement Rate) — reutilizável em relatório, Mídia Kit e outras telas.
 * Escala 0–8%, 4 faixas de qualidade (Baixo, Bom, Excelente, Viral).
 */
import { reportTokens as t } from '../pages/reportTokens'
import './ERGaugeChart.css'

const c = t.colors

export type ERQualidadeBanda = { min: number; max: number; label: string; color: string }

/** Faixas de qualidade do ER para o Gauge — escala 0–6% (acima de 6% = Viral). Viral sem teto. */
export const ER_QUALIDADE_BANDAS: ERQualidadeBanda[] = [
  { min: 0, max: 2, label: 'Baixo', color: '#dc2626' },
  { min: 2, max: 4, label: 'Bom', color: '#fa8c16' },
  { min: 4, max: 6, label: 'Excelente', color: '#0891b2' },
  { min: 6, max: 100, label: 'Viral', color: '#22c55e' },
]

export function erBandaRangeLabel(b: ERQualidadeBanda): string {
  if (b.min === 0) return '< 2%'
  if (b.max >= 100) return `> ${b.min}%`
  return `${b.min}% – ${b.max}%`
}

/** Retorna a banda de qualidade do ER para um valor (label + color). */
export function getErBanda(er: number): ERQualidadeBanda {
  return ER_QUALIDADE_BANDAS.find((b) => er >= b.min && er < b.max) ?? ER_QUALIDADE_BANDAS[ER_QUALIDADE_BANDAS.length - 1]
}

const ER_GAUGE_R = 52
const ER_GAUGE_STROKE = 18
const ER_GAUGE_CX = 80
const ER_GAUGE_CY = 62
const ER_GAUGE_VIEW_WIDTH = 165
const ER_GAUGE_VIEW_HEIGHT = 100
const ER_GAUGE_VIEW_Y_OFFSET = 18
const ER_GAUGE_TICK_OFFSET = 12
const ER_GAUGE_PCT_INSIDE_R = 35
/** Escala fixa do gauge (0–8%). Valores acima de 8% mostram a agulha no máximo. */
const ER_GAUGE_MAX = 8

function erToAngle(er: number, scaleMax: number): number {
  const v = Math.min(scaleMax, Math.max(0, er))
  return 180 - (v / scaleMax) * 180
}

/** Ticks em % para o gauge: 0, 2, 4, 6, 8. */
function getGaugeTicks(): number[] {
  return [0, 2, 4, 6, 8]
}

export interface ERGaugeChartProps {
  value: number
  count: number
  title: string
}

export function ERGaugeChart({ value, count, title }: ERGaugeChartProps) {
  const scaleMax = ER_GAUGE_MAX
  const ticks = getGaugeTicks()
  const angle = erToAngle(value, scaleMax)
  const rad = (angle * Math.PI) / 180
  const needleX = ER_GAUGE_CX + (ER_GAUGE_R - 2) * Math.cos(rad)
  const needleY = ER_GAUGE_CY - (ER_GAUGE_R - 2) * Math.sin(rad)
  const bandaAtual =
    ER_QUALIDADE_BANDAS.find((b) => value >= b.min && value < b.max) ??
    ER_QUALIDADE_BANDAS[ER_QUALIDADE_BANDAS.length - 1]

  return (
    <div className="er-gauge-chart">
      <div className="er-gauge-chart__row">
        <div className="er-gauge-chart__gauge">
          <div className="er-gauge-chart__gauge-frame">
            <svg
              viewBox={`0 ${-ER_GAUGE_VIEW_Y_OFFSET} ${ER_GAUGE_VIEW_WIDTH} ${ER_GAUGE_VIEW_HEIGHT}`}
              aria-hidden
            >
              <path
                d={`M ${ER_GAUGE_CX - ER_GAUGE_R} ${ER_GAUGE_CY} A ${ER_GAUGE_R} ${ER_GAUGE_R} 0 0 1 ${ER_GAUGE_CX + ER_GAUGE_R} ${ER_GAUGE_CY}`}
                fill="none"
                stroke={c.progressTrail ?? c.borderLight}
                strokeWidth={ER_GAUGE_STROKE}
                strokeLinecap="butt"
              />
              {ER_QUALIDADE_BANDAS.map((b, i) => {
                const arcEnd = Math.min(b.max, scaleMax)
                const a0 = erToAngle(b.min, scaleMax)
                const a1 = erToAngle(arcEnd, scaleMax)
                const r0 = (a0 * Math.PI) / 180
                const r1 = (a1 * Math.PI) / 180
                const x0 = ER_GAUGE_CX + ER_GAUGE_R * Math.cos(r0)
                const y0 = ER_GAUGE_CY - ER_GAUGE_R * Math.sin(r0)
                const x1 = ER_GAUGE_CX + ER_GAUGE_R * Math.cos(r1)
                const y1 = ER_GAUGE_CY - ER_GAUGE_R * Math.sin(r1)
                const large = a0 - a1 > 180 ? 1 : 0
                return (
                  <path
                    key={i}
                    d={`M ${x0} ${y0} A ${ER_GAUGE_R} ${ER_GAUGE_R} 0 ${large} 1 ${x1} ${y1}`}
                    fill="none"
                    stroke={b.color}
                    strokeWidth={ER_GAUGE_STROKE - 2}
                    strokeLinecap="butt"
                  />
                )
              })}
              <line
                x1={ER_GAUGE_CX}
                y1={ER_GAUGE_CY}
                x2={needleX}
                y2={needleY}
                stroke={c.text}
                strokeWidth={3}
                strokeLinecap="round"
              />
              <circle cx={ER_GAUGE_CX} cy={ER_GAUGE_CY} r={5} fill={c.text} />
              {ticks.map((pct) => {
                const a = erToAngle(pct, scaleMax)
                const rRad = (a * Math.PI) / 180
                const x = ER_GAUGE_CX + ER_GAUGE_PCT_INSIDE_R * Math.cos(rRad)
                const y = ER_GAUGE_CY - ER_GAUGE_PCT_INSIDE_R * Math.sin(rRad)
                return (
                  <text
                    key={pct}
                    x={x}
                    y={y}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill={c.textMuted}
                    fontSize={8}
                    fontFamily="inherit"
                  >
                    {pct}%
                  </text>
                )
              })}
              {ER_QUALIDADE_BANDAS.map((b, idx) => {
                const n = ER_QUALIDADE_BANDAS.length
                const a = 180 - ((2 * idx + 1) / (2 * n)) * 180
                const rRad = (a * Math.PI) / 180
                const labelR = ER_GAUGE_R + ER_GAUGE_STROKE / 2 + ER_GAUGE_TICK_OFFSET
                const x = ER_GAUGE_CX + labelR * Math.cos(rRad)
                const y = ER_GAUGE_CY - labelR * Math.sin(rRad)
                return (
                  <text
                    key={b.label}
                    x={x}
                    y={y}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill={b.color}
                    fontSize={9}
                    fontFamily="inherit"
                    fontWeight={600}
                  >
                    {b.label}
                  </text>
                )
              })}
            </svg>
          </div>
        </div>
        <div className="er-gauge-chart__meta">
          <div className="er-gauge-chart__value-block">
            <div className="er-gauge-chart__title">{title}</div>
            <div className="er-gauge-chart__value" style={{ color: bandaAtual.color }}>
              {value.toFixed(2)}%
            </div>
          </div>
          <div className="er-gauge-chart__band">
            <div className="er-gauge-chart__band-label" style={{ color: bandaAtual.color }}>
              {bandaAtual.label}
            </div>
            <div className="er-gauge-chart__count">{count} itens</div>
          </div>
        </div>
      </div>
    </div>
  )
}
