import { useEffect } from 'react'
import { Layout as AntLayout } from 'antd'
import { useLocation, useNavigate } from 'react-router-dom'
import { Outlet } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import MissionsBar from './components/MissionsBar/MissionsBar'
import { RequireActiveSubscription } from './components/RequireActiveSubscription'
import AppTopBar from './components/AppTopBar/AppTopBar'
import { isSearchRoute, isSearchLandingHome } from './constants/searchRoute'

const { Content } = AntLayout

export default function Layout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user } = useAuth()
  const myProfileRef = user?.profile_ref?.trim() ?? ''
  const myProfilePath = myProfileRef ? `/app/influencer/${encodeURIComponent(myProfileRef)}` : ''
  const isOnActivate = myProfileRef && location.pathname === `/activate/${encodeURIComponent(myProfileRef)}`
  const allowedForInfluencer =
    isSearchRoute(location.pathname) ||
    location.pathname.startsWith('/app/influencer') ||
    location.pathname.startsWith('/app/create') ||
    location.pathname.startsWith('/app/projects') ||
    isOnActivate

  useEffect(() => {
    if (user?.scope === 'influencer' && myProfileRef && !allowedForInfluencer) {
      navigate(myProfilePath, { replace: true })
    }
  }, [user?.scope, myProfileRef, myProfilePath, allowedForInfluencer, navigate])

  useEffect(() => {
    if (user?.scope === 'assinante') {
      const base = '/app'
      const path = location.pathname
      const allowed =
        path === base || path === `${base}/` ||
        path.startsWith(`${base}/campaigns`) ||
        path.startsWith(`${base}/influencer`) ||
        path.startsWith(`${base}/payments`) ||
        path.startsWith(`${base}/profile`) ||
        path.startsWith(`${base}/missions`) ||
        isSearchRoute(path)
      if (!allowed) navigate(base, { replace: true })
    }
  }, [user?.scope, location.pathname, navigate])

  useEffect(() => {
    if (!user) return
    if (location.pathname.startsWith('/app/admin') && user.scope !== 'adm') {
      navigate('/app', { replace: true })
    }
  }, [user, location.pathname, navigate])

  const missionsBarPath = location.pathname.replace(/\/$/, '') || '/'
  const isSearchLanding = isSearchLandingHome(location.pathname, location.search, location.hash)
  const showMissionsBar =
    !isSearchLanding && (missionsBarPath === '/app' || missionsBarPath === '/app/campaigns')
  const showTopBar =
    !location.pathname.startsWith('/app/create') && !isSearchLanding

  return (
    <AntLayout
      className={isSearchLanding ? 'app-layout--no-top-bar' : undefined}
      style={{ minHeight: '100vh', background: 'var(--app-bg)' }}
    >
      {showTopBar ? <AppTopBar /> : null}
      <Content className="app-layout-content" style={{ overflowX: 'hidden' }}>
        {user && showMissionsBar ? <MissionsBar /> : null}
        <div className="app-page">
          <RequireActiveSubscription>
            <Outlet />
          </RequireActiveSubscription>
        </div>
      </Content>
    </AntLayout>
  )
}
