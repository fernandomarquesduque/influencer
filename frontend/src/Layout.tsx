import { useEffect, useState } from 'react'
import { Layout as AntLayout, Button, Drawer } from 'antd'
import { MenuOutlined } from '@ant-design/icons'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import { Outlet } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import { Grid } from 'antd'

const { Content } = AntLayout
const { useBreakpoint } = Grid

const navLinkStyle: React.CSSProperties = {
  color: 'var(--app-text-secondary)',
  fontSize: 14,
  padding: '8px 12px',
  textDecoration: 'none',
  fontWeight: 500,
}

const navLinkActiveStyle: React.CSSProperties = {
  ...navLinkStyle,
  color: 'var(--app-text)',
}

export default function Layout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, logout, isAdm } = useAuth()
  const screens = useBreakpoint()
  const isMobile = !screens.md
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const myHandle = user?.profile_handle?.replace(/^@/, '')
  const myProfilePath = myHandle ? `/app/influencer/${encodeURIComponent(myHandle)}` : ''
  const isOnMyProfile = myHandle && (location.pathname === myProfilePath || location.pathname === `${myProfilePath}/`)
  const isOnActivate = myHandle && location.pathname === `/activate/${encodeURIComponent(myHandle)}`
  const allowedForInfluencer = isOnMyProfile ||
    location.pathname.startsWith('/app/create') ||
    isOnActivate

  useEffect(() => {
    if (user?.scope === 'influencer' && myHandle && !allowedForInfluencer) {
      navigate(`/app/influencer/${encodeURIComponent(myHandle)}`, { replace: true })
    }
  }, [user?.scope, myHandle, allowedForInfluencer, navigate])

  const isActive = (path: string) => {
    if (path === '/app') return location.pathname === '/app' || location.pathname === '/app/'
    return location.pathname.startsWith(path)
  }

  const showNavbar = !location.pathname.startsWith('/app/create')

  return (
    <AntLayout style={{ minHeight: '100vh', background: 'var(--app-bg)' }}>
      {showNavbar && (
        <>
          <header
            style={{
              height: 56,
              padding: isMobile ? '0 12px' : '0 24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              maxWidth: 1200,
              margin: '0 auto',
              width: '100%',
              background: 'var(--app-header-bg)',
              borderBottom: '1px solid var(--app-header-border)',
              position: 'sticky',
              top: 0,
              zIndex: 100,
            }}
          >
            <Link
              to="/"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                textDecoration: 'none',
                color: 'var(--app-text)',
                minWidth: 0,
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  flexShrink: 0,
                  borderRadius: 8,
                  background: 'linear-gradient(135deg, var(--app-primary), var(--app-accent))',
                }}
              />
              <span style={{ fontWeight: 600, fontSize: isMobile ? 14 : 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Relatório de Influencer
              </span>
            </Link>
            {isMobile ? (
              <Button
                type="text"
                icon={<MenuOutlined style={{ fontSize: 20 }} />}
                onClick={() => setMobileMenuOpen(true)}
                style={{ flexShrink: 0 }}
                aria-label="Abrir menu"
              />
            ) : (
              <>
                <nav style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {user && (
                    <>
                      {isAdm && (
                        <Link to="/app" style={isActive('/app') && location.pathname === '/app' ? navLinkActiveStyle : navLinkStyle}>
                          Início
                        </Link>
                      )}

                      {isAdm && (
                        <Link to="/admin/users" style={isActive('/admin') ? navLinkActiveStyle : navLinkStyle}>
                          Usuários
                        </Link>
                      )}
                    </>
                  )}
                </nav>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {user ? (
                    <Button type="text" size="small" onClick={logout} style={{ fontSize: 13, color: 'var(--app-text-secondary)' }}>
                      Sair
                    </Button>
                  ) : (
                    <Link to="/login" style={isActive('/login') ? navLinkActiveStyle : navLinkStyle}>
                      Entrar
                    </Link>
                  )}
                  {!user && (<Link
                    to="/app/create"
                    style={{
                      ...(isActive('/app/create') ? navLinkActiveStyle : navLinkStyle),
                      background: 'linear-gradient(135deg, var(--app-primary), var(--app-accent))',
                      color: '#fff',
                      padding: '10px 20px',
                      borderRadius: 12,
                      fontWeight: 600,
                    }}
                  >
                    Criar conta
                  </Link>)}
                </div>
              </>
            )}
          </header>
          <Drawer
            title="Menu"
            placement="right"
            open={mobileMenuOpen}
            onClose={() => setMobileMenuOpen(false)}
            styles={{ body: { paddingTop: 8 } }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {user && (
                <>
                  {isAdm && (
                    <Link to="/app" style={{ ...navLinkStyle, display: 'block', padding: '12px 0' }} onClick={() => setMobileMenuOpen(false)}>
                      Início
                    </Link>
                  )}
                  {myHandle && (
                    <Link to={myProfilePath} style={{ ...(isActive(myProfilePath) ? navLinkActiveStyle : navLinkStyle), display: 'block', padding: '12px 0' }} onClick={() => setMobileMenuOpen(false)}>
                      Meu perfil
                    </Link>
                  )}
                  {isAdm && (
                    <Link to="/admin/users" style={{ ...(isActive('/admin') ? navLinkActiveStyle : navLinkStyle), display: 'block', padding: '12px 0' }} onClick={() => setMobileMenuOpen(false)}>
                      Usuários
                    </Link>
                  )}
                </>
              )}
              {user ? (
                <Button type="text" block style={{ textAlign: 'left', padding: '12px 0', fontSize: 14, color: 'var(--app-text-secondary)' }} onClick={() => { setMobileMenuOpen(false); logout(); }}>
                  Sair
                </Button>
              ) : (
                <Link to="/login" style={{ ...navLinkStyle, display: 'block', padding: '12px 0' }} onClick={() => setMobileMenuOpen(false)}>
                  Entrar
                </Link>
              )}
              <Link
                to="/app/create"
                style={{
                  ...navLinkStyle,
                  background: 'linear-gradient(135deg, var(--app-primary), var(--app-accent))',
                  color: '#fff',
                  padding: '12px 16px',
                  borderRadius: 12,
                  fontWeight: 600,
                  display: 'block',
                  textAlign: 'center',
                  marginTop: 8,
                }}
                onClick={() => setMobileMenuOpen(false)}
              >
                Criar conta
              </Link>
            </div>
          </Drawer>
        </>
      )}
      <Content className="app-layout-content">
        <div className="app-page">
          <Outlet />
        </div>
      </Content>
    </AntLayout>
  )
}
