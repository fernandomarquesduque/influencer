import { useParams, useLocation } from 'react-router-dom'
import InfluencerList from './InfluencerList'
import InfluencerDetail from './InfluencerDetail'

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
        <div className="app-fullscreen-modal" aria-modal="true" role="dialog">
          <div className="app-page" style={{ paddingTop: 24, paddingBottom: 48 }}>
            <InfluencerDetail overrideHandle={handle} />
          </div>
        </div>
      ) : null}
    </>
  )
}
