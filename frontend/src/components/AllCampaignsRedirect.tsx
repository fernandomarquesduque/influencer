import { Navigate, useLocation } from 'react-router-dom'

import { SEARCH_ROUTE_PATH } from '../constants/searchRoute'

/** Legado: /app/campaigns/all → busca pública (mesmos query params). */
export default function AllCampaignsRedirect() {
  const { search, hash } = useLocation()
  return <Navigate to={{ pathname: SEARCH_ROUTE_PATH, search, hash }} replace />
}
