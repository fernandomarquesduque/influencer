import { useParams, useLocation } from 'react-router-dom'
import InfluencerList from './InfluencerList'
import InfluencerDetail from './InfluencerDetail'

/**
 * Lista de influenciadores ou detalhe do perfil (sem modal).
 * - Com handle na URL (/app/influencer/:handle): mostra só o detalhe (perfil “aberto”).
 * - Com detailHandle no state (busca): mostra só o detalhe.
 * - Sem handle: mostra a lista.
 */
export default function ListAndDetailModal() {
  const { handle: paramHandle } = useParams<{ handle?: string }>()
  const location = useLocation()
  const handleFromState = (location.state as { detailHandle?: string } | null)?.detailHandle
  const handle = paramHandle ?? handleFromState

  if (handle) {
    return (
      <>

        <InfluencerDetail overrideHandle={handle} />
      </>
    )
  }

  return <InfluencerList />
}
