import { useParams, useLocation } from 'react-router-dom'
import InfluencerList from './InfluencerList'
import InfluencerDetail from './InfluencerDetail'

const fullscreenModalStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 1000,
  background: '#fff',
  overflow: 'auto',
}

/**
 * Renderiza a lista de influenciadores e abre o detalhe em modal de tela inteira.
 * - Pela busca: handle vem do location.state (URL não muda, não expõe nickname).
 * - Link direto/compartilhar: handle vem da rota /influencer/:handle (URL com nickname).
 */
export default function ListAndDetailModal() {
  const { handle: paramHandle } = useParams<{ handle: string }>()
  const location = useLocation()
  const handleFromState = (location.state as { detailHandle?: string } | null)?.detailHandle
  const handle = paramHandle ?? handleFromState

  return (
    <>
      <InfluencerList />
      {handle ? (
        <div style={fullscreenModalStyle} aria-modal="true" role="dialog">
          <InfluencerDetail overrideHandle={handle} />
        </div>
      ) : null}
    </>
  )
}
