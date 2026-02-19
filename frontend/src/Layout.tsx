import { useEffect, useState } from 'react'
import { Layout as AntLayout, Button, Drawer, Dropdown } from 'antd'
import type { MenuProps } from 'antd'
import { CaretDownFilled, MenuOutlined, UserOutlined } from '@ant-design/icons'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import { Outlet } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import { fetchProfile, getProfilePicUrl, proxyImageUrl } from './api'
import { Grid } from 'antd'

const { Content } = AntLayout
const { useBreakpoint } = Grid

/* Barra estilo Facebook: azul sólido, texto branco */
const FB_HEADER_BG = '#1877f2'
const FB_HEADER_TEXT = '#fff'

const navLinkStyle: React.CSSProperties = {
  color: FB_HEADER_TEXT,
  fontSize: 15,
  padding: '8px 14px',
  textDecoration: 'none',
  fontWeight: 500,
  borderRadius: 8,
  opacity: 0.95,
}
const navLinkActiveStyle: React.CSSProperties = {
  ...navLinkStyle,
  opacity: 1,
  background: 'rgba(255,255,255,0.15)',
}

const drawerLinkStyle: React.CSSProperties = {
  color: 'var(--app-text)',
  fontSize: 15,
  padding: '12px 0',
  textDecoration: 'none',
  fontWeight: 500,
  display: 'block',
}
const drawerLinkActiveStyle: React.CSSProperties = {
  color: 'var(--app-primary)',
  fontWeight: 600,
}

export default function Layout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, logout, isAdm } = useAuth()
  const screens = useBreakpoint()
  const isMobile = !screens.md
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [headerProfilePic, setHeaderProfilePic] = useState<string | null>(null)
  const [headerProfileName, setHeaderProfileName] = useState<string | null>(null)
  const myHandle = user?.profile_handle?.replace(/^@/, '')
  const myProfilePath = myHandle ? `/app/influencer/${encodeURIComponent(myHandle)}` : ''
  const isOnActivate = myHandle && location.pathname === `/activate/${encodeURIComponent(myHandle)}`
  const allowedForInfluencer =
    location.pathname.startsWith('/app/influencer') ||
    location.pathname.startsWith('/app/create') ||
    location.pathname.startsWith('/app/projects') ||
    isOnActivate

  useEffect(() => {
    if (user?.scope === 'influencer' && myHandle && !allowedForInfluencer) {
      navigate(myProfilePath, { replace: true })
    }
  }, [user?.scope, myHandle, myProfilePath, allowedForInfluencer, navigate])

  useEffect(() => {
    if (!user) {
      setHeaderProfilePic(null)
      setHeaderProfileName(null)
      return
    }
    setHeaderProfileName(user.profile_handle ? `@${user.profile_handle.replace(/^@/, '')}` : user.username)
    if (!myHandle) return
    let cancelled = false
    fetchProfile(myHandle)
      .then((profile) => {
        if (cancelled) return
        const url = proxyImageUrl(getProfilePicUrl(profile ?? undefined))
        setHeaderProfilePic(url ?? null)
        const name = (profile as { full_name?: string; username?: string } | null)?.full_name
          || (profile as { full_name?: string; username?: string } | null)?.username
        if (name) setHeaderProfileName(name)
      })
      .catch(() => {
        if (!cancelled) setHeaderProfilePic(null)
      })
    return () => { cancelled = true }
  }, [myHandle, user?.id, user?.username, user?.profile_handle])

  const isActive = (path: string) => {
    if (path === '/app') return location.pathname === '/app' || location.pathname === '/app/'
    return location.pathname.startsWith(path)
  }

  const showNavbar = !location.pathname.startsWith('/app/create')

  return (
    <AntLayout style={{ minHeight: '100vh', background: 'var(--app-bg)' }}>
      {showNavbar && (
        <>
          <div
            style={{
              background: FB_HEADER_BG,
              position: 'sticky',
              top: 0,
              zIndex: 100,
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            }}
          >
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
              }}
            >
              <Link
                to="/"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  textDecoration: 'none',
                  color: FB_HEADER_TEXT,
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    flexShrink: 0,
                    borderRadius: 8,
                    background: 'rgba(255,255,255,0.25)',
                  }}
                />
                <span style={{ fontWeight: 700, fontSize: isMobile ? 14 : 18, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  Relatório de Influencer
                </span>
              </Link>
              {isMobile ? (
                <Button
                  type="text"
                  icon={<MenuOutlined style={{ fontSize: 22, color: FB_HEADER_TEXT }} />}
                  onClick={() => setMobileMenuOpen(true)}
                  style={{ flexShrink: 0 }}
                  aria-label="Abrir menu"
                />
              ) : (
                <>
                  <nav style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
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
                      <Dropdown
                        menu={{
                          items: [
                            ...(myProfilePath
                              ? [{ key: 'profile', label: 'Meu perfil', onClick: () => navigate(myProfilePath) }]
                              : []),
                            ...(isAdm || user?.scope === 'influencer'
                              ? [{ key: 'projects', label: 'Projetos', onClick: () => navigate('/app/projects') }]
                              : []),
                            { key: 'logout', label: 'Sair', onClick: () => logout() },
                          ] as MenuProps['items'],
                        }}
                        trigger={['click']}
                        placement="bottomRight"
                      >
                        <button
                          type="button"
                          style={{
                            display: 'flex',
                            alignItems: 'flex-end',
                            gap: 8,
                            height: 36,
                            padding: 0,
                            border: 'none',
                            background: 'transparent',
                            cursor: 'pointer',
                            flexShrink: 0,
                          }}
                          title="Conta"
                          aria-label="Abrir menu da conta"
                        >
                          {!isMobile && (
                            <div
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'flex-end',
                                justifyContent: 'center',
                                lineHeight: 1.2,
                                marginBottom: 2,
                              }}
                            >
                              <span style={{ fontSize: 14, fontWeight: 600, color: FB_HEADER_TEXT, whiteSpace: 'nowrap', overflow: 'hidden', maxWidth: 140, textOverflow: 'ellipsis' }}>
                                {headerProfileName ?? user.username}
                              </span>
                              {myHandle && (
                                <span style={{ fontSize: 12, color: FB_HEADER_TEXT, opacity: 0.9 }}>
                                  @{myHandle}
                                </span>
                              )}
                            </div>
                          )}
                          <span
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: 36,
                              height: 36,
                              borderRadius: '50%',
                              background: headerProfilePic ? 'transparent' : 'rgba(255,255,255,0.2)',
                              color: FB_HEADER_TEXT,
                              overflow: 'hidden',
                              flexShrink: 0,
                            }}
                          >
                            {headerProfilePic ? (
                              <img
                                src={headerProfilePic}
                                alt=""
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                onError={() => setHeaderProfilePic(null)}
                              />
                            ) : (
                              <UserOutlined style={{ fontSize: 18 }} />
                            )}
                          </span>
                          <CaretDownFilled style={{ fontSize: 14, color: FB_HEADER_TEXT, opacity: 0.95, marginLeft: -6, marginBottom: -2 }} />
                        </button>
                      </Dropdown>
                    ) : (
                      <>
                        <Link to="/login" style={isActive('/login') ? navLinkActiveStyle : navLinkStyle}>
                          Entrar
                        </Link>
                        <Link
                          to="/app/create"
                          style={{
                            ...navLinkStyle,
                            background: 'rgba(255,255,255,0.2)',
                            padding: '8px 18px',
                            fontWeight: 600,
                          }}
                        >
                          Criar conta
                        </Link>
                      </>
                    )}
                  </div>
                </>
              )}
            </header>
          </div>
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
                  {(user.scope === 'influencer' || isAdm) && (
                    <Link to="/app/projects" style={{ ...drawerLinkStyle, ...(isActive('/app/projects') ? drawerLinkActiveStyle : {}) }} onClick={() => setMobileMenuOpen(false)}>
                      Projetos
                    </Link>
                  )}
                  {isAdm && (
                    <Link to="/app" style={{ ...drawerLinkStyle, ...(isActive('/app') && location.pathname === '/app' ? drawerLinkActiveStyle : {}) }} onClick={() => setMobileMenuOpen(false)}>
                      Início
                    </Link>
                  )}
                  {myHandle && (
                    <Link to={myProfilePath} style={{ ...drawerLinkStyle, ...(isActive(myProfilePath) ? drawerLinkActiveStyle : {}) }} onClick={() => setMobileMenuOpen(false)}>
                      Meu perfil
                    </Link>
                  )}
                  {isAdm && (
                    <Link to="/admin/users" style={{ ...drawerLinkStyle, ...(isActive('/admin') ? drawerLinkActiveStyle : {}) }} onClick={() => setMobileMenuOpen(false)}>
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
                <Link to="/login" style={{ ...drawerLinkStyle, display: 'block' }} onClick={() => setMobileMenuOpen(false)}>
                  Entrar
                </Link>
              )}
              {!user && (
                <Link
                  to="/app/create"
                  style={{
                    ...drawerLinkStyle,
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
              )}
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
