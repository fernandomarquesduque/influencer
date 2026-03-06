/**
 * Gauge de ER (Engagement Rate) — reutilizável em relatório, media kit e outras telas.
 * Escala 0–6% (arco até 7% para o segmento Excelente ser visível), 4 faixas de qualidade.
 */
import { reportTokens as t } from '../pages/reportTokens'

const s = t.spacing
const c = t.colors
const typ = t.typography

export type ERQualidadeBanda = { min: number; max: number; label: string; color: string }

/** Faixas de qualidade do ER para o Gauge — escala 0–6%, cores: ruim → bom */
export const ER_QUALIDADE_BANDAS: ERQualidadeBanda[] = [
  { min: 0, max: 2, label: 'Baixo', color: '#dc2626' },
  { min: 2, max: 4, label: 'Bom', color: '#fa8c16' },
  { min: 4, max: 6, label: 'Excelente', color: '#0891b2' },
  { min: 6, max: 10, label: 'Viral', color: '#22c55e' },
]

export function erBandaRangeLabel(b: ERQualidadeBanda): string {
  if (b.min === 0) return '< 2%'
  if (b.max >= 10) return `> ${b.min}%`
  return `${b.min}% – ${b.max}%`
}

/** Retorna a banda de qualidade do ER para um valor (label + color). */
export function getErBanda(er: number): ERQualidadeBanda {
  return ER_QUALIDADE_BANDAS.find((b) => er >= b.min && er < b.max) ?? ER_QUALIDADE_BANDAS[ER_QUALIDADE_BANDAS.length - 1]
}

const ER_GAUGE_MAX = 7
const ER_GAUGE_R = 52
const ER_GAUGE_STROKE = 18
const ER_GAUGE_CX = 80
const ER_GAUGE_CY = 62
const ER_GAUGE_VIEW_WIDTH = 165
const ER_GAUGE_VIEW_HEIGHT = 88
const ER_GAUGE_VIEW_Y_OFFSET = 12
const ER_GAUGE_TICK_OFFSET = 12
const ER_GAUGE_PCT_INSIDE_R = 35
const ER_GAUGE_PCT_TICKS = [0, 2, 4, 6]

function erToAngle(er: number): number {
  const v = Math.min(ER_GAUGE_MAX, Math.max(0, er))
  return 180 - (v / ER_GAUGE_MAX) * 180
}

export interface ERGaugeChartProps {
  value: number
  count: number
  title: string
}

export function ERGaugeChart({ value, count, title }: ERGaugeChartProps) {
  const angle = erToAngle(value)
  const rad = (angle * Math.PI) / 180
  const needleX = ER_GAUGE_CX + (ER_GAUGE_R - 2) * Math.cos(rad)
  const needleY = ER_GAUGE_CY - (ER_GAUGE_R - 2) * Math.sin(rad)
  const bandaAtual = ER_QUALIDADE_BANDAS.find((b) => value >= b.min && value < b.max) ?? ER_QUALIDADE_BANDAS[0]

  return (
    <div className="er-gauge-chart" style={{ display: 'flex', flexDirection: 'column', gap: 0, width: '100%' }}>
      <div className="er-gauge-chart__row" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: s.sm, width: '100%' }}>
        <div style={{ flex: '0 0 auto', minWidth: 0, display: 'flex', justifyContent: 'flex-start', alignItems: 'center' }}>
          <div style={{ position: 'relative', width: 165, height: ER_GAUGE_VIEW_HEIGHT }}>
            <svg viewBox={`0 ${-ER_GAUGE_VIEW_Y_OFFSET} ${ER_GAUGE_VIEW_WIDTH} ${ER_GAUGE_VIEW_HEIGHT}`} style={{ width: '100%', height: '100%', overflow: 'visible' }} aria-hidden>
              <path
                d={`M ${ER_GAUGE_CX - ER_GAUGE_R} ${ER_GAUGE_CY} A ${ER_GAUGE_R} ${ER_GAUGE_R} 0 0 1 ${ER_GAUGE_CX + ER_GAUGE_R} ${ER_GAUGE_CY}`}
                fill="none"
                stroke={c.progressTrail ?? c.borderLight}
                strokeWidth={ER_GAUGE_STROKE}
                strokeLinecap="butt"
              />
              {ER_QUALIDADE_BANDAS.map((b, i) => {
                const arcEnd = Math.min(b.max, ER_GAUGE_MAX)
                const a0 = erToAngle(b.min)
                const a1 = erToAngle(arcEnd)
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
              <line x1={ER_GAUGE_CX} y1={ER_GAUGE_CY} x2={needleX} y2={needleY} stroke={c.text} strokeWidth={3} strokeLinecap="round" />
              <circle cx={ER_GAUGE_CX} cy={ER_GAUGE_CY} r={5} fill={c.text} />
              {ER_GAUGE_PCT_TICKS.map((pct) => {
                const a = erToAngle(pct)
                const rRad = (a * Math.PI) / 180
                const x = ER_GAUGE_CX + ER_GAUGE_PCT_INSIDE_R * Math.cos(rRad)
                const y = ER_GAUGE_CY - ER_GAUGE_PCT_INSIDE_R * Math.sin(rRad)
                return (
                  <text key={pct} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fill={c.textMuted} fontSize={8} fontFamily="inherit">
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
                  <text key={b.label} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fill={b.color} fontSize={9} fontFamily="inherit" fontWeight={600}>
                    {b.label}
                  </text>
                )
              })}
            </svg>
          </div>
        </div>
        <div style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'row', gap: s.md, alignItems: 'center', minWidth: 0, justifyContent: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 auto', minWidth: 90, alignItems: 'center', textAlign: 'center' }}>
            <div style={{ ...typ.caption, color: c.textMuted, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>{title}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: bandaAtual.color, margin: 0, lineHeight: 1.2 }}>{value.toFixed(2)}%</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '0 0 auto', alignItems: 'flex-end', textAlign: 'right' }}>
            <div style={{ ...typ.caption, fontSize: 14, color: bandaAtual.color, fontWeight: 600 }}>{bandaAtual.label}</div>
            <div style={{ ...typ.caption, fontSize: 13, color: c.textMuted }}>{count} itens</div>
          </div>
        </div>
      </div>
    </div>
  )
}
