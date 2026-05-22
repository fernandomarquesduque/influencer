import { useEffect } from 'react'
import { Layout as AntLayout } from 'antd'
import { useLocation, useNavigate } from 'react-router-dom'
import { Outlet } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import MissionsBar from './components/MissionsBar/MissionsBar'
import { RequireActiveSubscription } from './components/RequireActiveSubscription'
import AppTopBar from './components/AppTopBar/AppTopBar'
import AppPageBackdrop from './components/AppPageBackdrop'
import { isSearchRoute, isSearchLandingHome, isStandaloneNavRoute } from './constants/searchRoute'
import { cleanupAppUiBlockers } from './utils/cleanupAppUiBlockers'

const { Content } = AntLayout

export default function Layout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, isAdm } = useAuth()
  const myProfileRef = user?.profile_ref?.trim() ?? ''
  const myProfilePath = myProfileRef ? `/app/influencer/${encodeURIComponent(myProfileRef)}` : ''
  const isOnActivate = myProfileRef && location.pathname === `/activate/${encodeURIComponent(myProfileRef)}`
  const path = location.pathname
  const isAppArea = path === '/app' || path.startsWith('/app/')
  const allowedForInfluencer =
    isAdm ||
    isSearchRoute(path) ||
    isAppArea ||
    isStandaloneNavRoute(path) ||
    isOnActivate

  useEffect(() => {
    if (isAdm || user?.scope !== 'influencer' || !myProfileRef || allowedForInfluencer) return
    navigate(myProfilePath, { replace: true })
  }, [isAdm, user?.scope, myProfileRef, myProfilePath, allowedForInfluencer, navigate])

  useEffect(() => {
    if (isAdm || user?.scope !== 'assinante') return
    const allowed = isSearchRoute(path) || isAppArea || isStandaloneNavRoute(path)
    if (!allowed) navigate('/app', { replace: true })
  }, [isAdm, user?.scope, path, isAppArea, navigate])

  useEffect(() => {
    if (!user || isAdm) return
    if (path.startsWith('/app/admin') && user.scope !== 'adm') {
      navigate('/app', { replace: true })
    }
  }, [user, isAdm, path, navigate])

  useEffect(() => {
    cleanupAppUiBlockers()
    return () => cleanupAppUiBlockers()
  }, [path])

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
        <AppPageBackdrop />
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
