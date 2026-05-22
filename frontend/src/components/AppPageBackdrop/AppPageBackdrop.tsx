import './AppPageBackdrop.css'

/** Decoração de fundo padrão — tons suaves roxo/lilás e amarelo nos cantos. */
export default function AppPageBackdrop() {
  return (
    <div className="app-page-backdrop" aria-hidden>
      <div className="app-page-backdrop__wash" />
      <div className="app-page-backdrop__deco app-page-backdrop__deco--tl" />
      <div className="app-page-backdrop__deco app-page-backdrop__deco--tr" />
      <div className="app-page-backdrop__deco app-page-backdrop__deco--bl" />
      <div className="app-page-backdrop__deco app-page-backdrop__deco--br" />
    </div>
  )
}
