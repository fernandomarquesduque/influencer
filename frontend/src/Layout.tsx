import { useEffect } from 'react'
import { Layout as AntLayout, Button } from 'antd'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import { Outlet } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'

const { Header, Content } = AntLayout

const navLinkStyle: React.CSSProperties = {
  color: 'rgba(0,0,0,0.65)',
  fontSize: 13,
  padding: '0 10px',
  textDecoration: 'none',
}
const navLinkActiveStyle: React.CSSProperties = {
  ...navLinkStyle,
  color: 'rgba(0,0,0,0.88)',
  fontWeight: 500,
}

export default function Layout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, logout, isAdm } = useAuth()
  const myHandle = user?.profile_handle?.replace(/^@/, '')
  const myProfilePath = myHandle ? `/influencer/${encodeURIComponent(myHandle)}` : ''
  const isOnMyProfile = myHandle && (location.pathname === myProfilePath || location.pathname === `${myProfilePath}/`)
  const isOnActivate = myHandle && location.pathname === `/activate/${encodeURIComponent(myHandle)}`
  const allowedForInfluencer = isOnMyProfile ||
    location.pathname.startsWith('/create') ||
    isOnActivate

  useEffect(() => {
    if (user?.scope === 'influencer' && myHandle && !allowedForInfluencer) {
      navigate(`/influencer/${encodeURIComponent(myHandle)}`, { replace: true })
    }
  }, [user?.scope, myHandle, allowedForInfluencer, navigate])

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/' || location.pathname === ''
    return location.pathname.startsWith(path)
  }

  return (
    <AntLayout style={{ minHeight: '100vh' }}>
      <Header
        style={{
          height: 40,
          lineHeight: '40px',
          padding: '0 16px',
          background: 'rgba(250,250,250,0.95)',
          borderBottom: '1px solid rgba(0,0,0,0.06)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <nav style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Link to="/create" style={isActive('/create') ? navLinkActiveStyle : navLinkStyle}>
            Criar conta
          </Link>
          {user && (
            <>
              {isAdm && (
                <>
                  <Link to="/" style={isActive('/') && location.pathname === '/' ? navLinkActiveStyle : navLinkStyle}>
                    Início
                  </Link>
                  <Link to="/extraction" style={isActive('/extraction') ? navLinkActiveStyle : navLinkStyle}>
                    Extração
                  </Link>
                  <Link to="/extract-profile" style={isActive('/extract-profile') ? navLinkActiveStyle : navLinkStyle}>
                    Extrair perfil
                  </Link>
                </>
              )}
              {myHandle && (
                <Link to={myProfilePath} style={isActive(myProfilePath) ? navLinkActiveStyle : navLinkStyle}>
                  Meu perfil
                </Link>
              )}
              {isAdm && (
                <Link to="/admin/users" style={isActive('/admin') ? navLinkActiveStyle : navLinkStyle}>
                  Admin
                </Link>
              )}
            </>
          )}
        </nav>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {user ? (
            <Button type="text" size="small" onClick={logout} style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
              Sair
            </Button>
          ) : (
            <Link to="/login" style={isActive('/login') ? navLinkActiveStyle : navLinkStyle}>
              Entrar
            </Link>
          )}
        </div>
      </Header>
      <Content style={{ padding: 24 }}>
        <Outlet />
      </Content>
    </AntLayout>
  )
}
