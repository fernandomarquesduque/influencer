import { Navigate, useLocation } from 'react-router-dom'

/** Legado: /app/campaigns/all → /search (mesmos query params). */
export default function AllCampaignsRedirect() {
  const { search, hash } = useLocation()
  return <Navigate to={{ pathname: '/search', search, hash }} replace />
}
