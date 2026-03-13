import { useEffect, useState } from 'react'
import { Layout as AntLayout, Button, Drawer, Dropdown } from 'antd'
import type { MenuProps } from 'antd'
import { CaretDownFilled, MenuOutlined, UserOutlined } from '@ant-design/icons'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import { Outlet } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import { useCreditsOptional } from './contexts/CreditsContext'
import { useTheme, THEME_OPTIONS } from './contexts/ThemeContext'
import { fetchProfile, getProfilePicUrl, proxyImageUrl } from './api'
import Logo from './components/Logo'
import ThemeFooterButton from './components/ThemeFooterButton'
import { Grid } from 'antd'

const { Content } = AntLayout
const { useBreakpoint } = Grid

/* Header usa mesmo padrão da Landing: --app-header-bg = fundo da página, --app-header-text = texto */
const navLinkStyle: React.CSSProperties = {
  color: 'var(--app-header-text)',
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
  background: 'var(--app-primary-muted)',
  color: 'var(--app-primary)',
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
  const creditsState = useCreditsOptional()
  const { theme, setTheme } = useTheme()
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
    if (user?.scope === 'assinante') {
      const allowed = location.pathname === '/app' || location.pathname === '/app/'
      if (!allowed) navigate('/app', { replace: true })
    }
  }, [user?.scope, location.pathname, navigate])

  const isAssinante = user?.scope === 'assinante'

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
              background: user ? 'var(--app-header-bg)' : 'transparent',
              borderBottom: user ? '1px solid var(--app-header-border)' : 'none',
              ...(user ? { position: 'sticky' as const, top: 0, zIndex: 100 } : {}),
              boxShadow: user ? 'var(--app-shadow-sm)' : 'none',
            }}
          >
            <header
              style={{
                height: user ? (isMobile ? 64 : 56) : 'auto',
                padding: user
                  ? (isMobile ? '0 56px 0 12px' : '0 24px')
                  : (isMobile ? '24px 12px 0px 24px' : '24px 12px 0px 24px'),
                display: 'flex',
                alignItems: 'center',
                justifyContent: user ? (isMobile ? 'flex-start' : 'space-between') : 'center',
                position: isMobile ? 'relative' : undefined,
                maxWidth: 1200,
                margin: '0 auto',
                width: '100%',
              }}
            >
              {!user ? (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => { window.location.href = '/' }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.location.href = '/' } }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    textDecoration: 'none',
                    color: 'var(--app-header-text)',
                    cursor: 'pointer',
                  }}
                >
                  <Logo
                    size="large"
                    height={isMobile ? 40 : 36}
                    variant="default"
                    style={{ flexShrink: 0 }}
                    alt="Relatório de Influencer"
                  />
                </div>
              ) : isMobile ? (
                <>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => { window.location.href = '/' }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.location.href = '/' } }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      textDecoration: 'none',
                      color: 'var(--app-header-text)',
                      minWidth: 0,
                      maxWidth: 250,
                      cursor: 'pointer',
                    }}
                  >
                    <Logo
                      size="large"
                      height={40}
                      variant="default"
                      style={{ flexShrink: 0, maxWidth: '100%' }}
                      alt="Relatório de Influencer"
                    />
                  </div>
                  <Button
                    type="text"
                    icon={<MenuOutlined style={{ fontSize: 22, color: 'var(--app-header-text)' }} />}
                    onClick={() => setMobileMenuOpen(true)}
                    style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', flexShrink: 0, zIndex: 1 }}
                    aria-label="Abrir menu"
                  />
                </>
              ) : (
                <>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => { window.location.href = '/' }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.location.href = '/' } }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      textDecoration: 'none',
                      color: 'var(--app-header-text)',
                      minWidth: 0,
                      cursor: 'pointer',
                    }}
                  >
                    <Logo
                      size="large"
                      height={36}
                      variant="default"
                      style={{ flexShrink: 0 }}
                      alt="Relatório de Influencer"
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginLeft: 'auto' }}>
                    {user ? (
                      <>
                        <Dropdown
                          menu={{
                            items: [
                              ...(myProfilePath
                                ? [{ key: 'profile', label: 'Meu perfil', onClick: () => navigate(myProfilePath) }]
                                : []),
                              ...(isAssinante ? [{ key: 'home', label: 'Início', onClick: () => navigate('/app') }] : []),
                              ...(isAdm ? [{ key: 'influencers', label: 'Influenciadores', onClick: () => navigate('/app') }] : []),
                              ...(user ? [{ key: 'campaigns', label: 'Minhas campanhas', onClick: () => navigate('/app/campaigns') }] : []),
                              ...(user ? [{ key: 'payments', label: 'Meus pagamentos', onClick: () => navigate('/app/payments') }] : []),
                              ...(isAdm ? [{ key: 'advertisers', label: 'Anúnciantes', onClick: () => navigate('/app/projects') }] : []),
                              ...(isAdm ? [{ key: 'users', label: 'Usuários', onClick: () => navigate('/admin/users') }] : []),
                              ...(isAdm ? [{ key: 'bulk', label: 'Disparo em massa', onClick: () => navigate('/app/bulk-message') }] : []),
                              { type: 'divider' as const },
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
                                <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--app-header-text)', whiteSpace: 'nowrap', overflow: 'hidden', maxWidth: 140, textOverflow: 'ellipsis' }}>
                                  {headerProfileName ?? user.username}
                                </span>
                                {myHandle && (
                                  <span style={{ fontSize: 12, color: 'var(--app-header-text)', opacity: 0.9 }}>
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
                                background: headerProfilePic ? 'transparent' : 'var(--app-placeholder-bg)',
                                color: 'var(--app-header-text)',
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
                            <CaretDownFilled style={{ fontSize: 14, color: 'var(--app-header-text)', opacity: 0.95, marginLeft: -6, marginBottom: -2 }} />
                          </button>
                        </Dropdown>
                        {creditsState != null && (
                          <span
                            style={{
                              fontSize: 15,
                              fontWeight: 600,
                              color: 'var(--app-primary)',
                              background: 'var(--app-primary-muted)',
                              padding: '6px 12px',
                              borderRadius: 8,
                              whiteSpace: 'nowrap',
                            }}
                            title="Créditos disponíveis"
                          >
                            💰 {creditsState.loading ? '...' : `${creditsState.balance} créditos`}
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        <Link to="/login" style={isActive('/login') ? navLinkActiveStyle : navLinkStyle}>
                          Entrar
                        </Link>
                        <Link
                          to="/app/create"
                          style={{
                            ...navLinkStyle,
                            background: 'var(--app-primary)',
                            color: 'var(--brand-white)',
                            padding: '8px 18px',
                            fontWeight: 600,
                          }}
                        >
                          Cadastrar
                        </Link>
                      </>
                    )}
                  </div>
                </>
              )}
            </header>
          </div>
          {user && (
            <Drawer
              title="Menu"
              placement="right"
              open={mobileMenuOpen}
              onClose={() => setMobileMenuOpen(false)}
              styles={{ body: { paddingTop: 8 } }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--app-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Tema</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {THEME_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => { setTheme(opt.value); setMobileMenuOpen(false) }}
                        style={{
                          padding: '8px 12px',
                          borderRadius: 8,
                          border: theme === opt.value ? '2px solid var(--app-primary)' : '1px solid var(--app-border)',
                          background: theme === opt.value ? 'var(--app-primary-muted)' : 'var(--app-card-bg)',
                          color: 'var(--app-text)',
                          fontSize: 13,
                          fontWeight: 500,
                          cursor: 'pointer',
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                {user && (
                  <>
                    {(user.scope === 'influencer' || isAdm) && (
                      <Link to="/app/projects" style={{ ...drawerLinkStyle, ...(isActive('/app/projects') ? drawerLinkActiveStyle : {}) }} onClick={() => setMobileMenuOpen(false)}>
                        Projetos
                      </Link>
                    )}
                    {(isAdm || isAssinante) && (
                      <Link to="/app" style={{ ...drawerLinkStyle, ...(isActive('/app') && location.pathname === '/app' ? drawerLinkActiveStyle : {}) }} onClick={() => setMobileMenuOpen(false)}>
                        Início
                      </Link>
                    )}
                    {user && (
                      <Link to="/app/payments" style={{ ...drawerLinkStyle, ...(isActive('/app/payments') ? drawerLinkActiveStyle : {}) }} onClick={() => setMobileMenuOpen(false)}>
                        Meus pagamentos
                      </Link>
                    )}
                    {user && (
                      <Link to="/app/campaigns" style={{ ...drawerLinkStyle, ...(isActive('/app/campaigns') ? drawerLinkActiveStyle : {}) }} onClick={() => setMobileMenuOpen(false)}>
                        Minhas campanhas
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
                    {isAdm && (
                      <Link to="/app/bulk-message" style={{ ...drawerLinkStyle, ...(isActive('/app/bulk-message') ? drawerLinkActiveStyle : {}) }} onClick={() => setMobileMenuOpen(false)}>
                        Disparo em massa
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
                      background: 'var(--app-primary)',
                      color: 'var(--brand-white)',
                      padding: '12px 16px',
                      borderRadius: 12,
                      fontWeight: 600,
                      display: 'block',
                      textAlign: 'center',
                      marginTop: 8,
                    }}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    Cadastrar conta
                  </Link>
                )}
              </div>
            </Drawer>
          )}
        </>
      )}
      <Content className="app-layout-content" style={{ overflow: 'visible' }}>
        <div className="app-page">
          <Outlet />
        </div>
      </Content>

      <ThemeFooterButton />
    </AntLayout>
  )
}
