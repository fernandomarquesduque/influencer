import { useEffect, useMemo, useState } from 'react'
import { Layout as AntLayout, Button, Drawer, Dropdown } from 'antd'
import type { MenuProps } from 'antd'
import { CaretDownFilled, MenuOutlined } from '@ant-design/icons'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import { Outlet } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import { useCreditsOptional } from './contexts/CreditsContext'
import { usePendingInvoiceBadge } from './contexts/PendingPaymentCelebrationContext'
import { fetchProfile, getProfilePicUrl, proxyImageUrl } from './api'
import Logo from './components/Logo'
import ProfileAvatar from './components/ProfileAvatar'
import MissionsBar from './components/MissionsBar/MissionsBar'
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
  const hasPendingInvoice = usePendingInvoiceBadge()
  const screens = useBreakpoint()
  const isMobile = !screens.md
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [headerProfilePic, setHeaderProfilePic] = useState<string | null>(null)
  const [headerProfilePicFetching, setHeaderProfilePicFetching] = useState(false)
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
      const base = '/app'
      const path = location.pathname
      const allowed =
        path === base || path === `${base}/` ||
        path.startsWith(`${base}/campaigns`) ||
        path.startsWith(`${base}/payments`) ||
        path.startsWith(`${base}/profile`) ||
        path.startsWith(`${base}/missions`)
      if (!allowed) navigate(base, { replace: true })
    }
  }, [user?.scope, location.pathname, navigate])

  /** Rotas /app/admin/* exclusivas do perfil adm (reforço além do RequireAuth nas rotas). */
  useEffect(() => {
    if (!user) return
    if (location.pathname.startsWith('/app/admin') && user.scope !== 'adm') {
      navigate('/app', { replace: true })
    }
  }, [user, location.pathname, navigate])

  const isAssinante = user?.scope === 'assinante'
  const showCampaignsAndCredits = isAssinante || isAdm

  const userMenuItems = useMemo((): MenuProps['items'] => {
    if (!user) return []
    const items: MenuProps['items'] = [
      { key: 'edit-profile', label: 'Editar perfil', onClick: () => navigate('/app/profile') },
    ]

    const influencerChildren: NonNullable<MenuProps['items']> = []
    if (isAdm) influencerChildren.push({ key: 'influencers', label: 'Influenciadores', onClick: () => navigate('/app') })

    const assinanteChildren: NonNullable<MenuProps['items']> = []
    if (isAssinante) influencerChildren.push({ key: 'campaigns/create', label: 'Buscar Influencer', onClick: () => navigate('/app/campaigns/create') })
    if (isAdm) assinanteChildren.push({ key: 'advertisers', label: 'Anúnciantes', onClick: () => navigate('/app/projects') })
    if (assinanteChildren.length > 0) {
      items.push({ type: 'group', label: 'Assinante', children: assinanteChildren })
    }
    if (showCampaignsAndCredits) {
      influencerChildren.push(
        { key: 'campaigns', label: 'Minhas campanhas', onClick: () => navigate('/app/campaigns') },
        { key: 'payments', label: 'Comprar Créditos', onClick: () => navigate('/app/payments') },
      )
    }
    if (influencerChildren.length > 0) {
      items.push({ type: 'group', label: 'Funcionalidades', children: influencerChildren })
    }

    if (isAdm) {
      items.push({
        type: 'group',
        label: 'Administrativo',
        children: [
          { key: 'admin-dash', label: 'Painel admin', onClick: () => navigate('/app/admin/dashboard') },
          { key: 'users', label: 'Usuários', onClick: () => navigate('/app/admin/users') },
          {
            key: 'admin-mentions',
            label: 'Relatório @ não cadastrados',
            onClick: () => navigate('/app/admin/reports/unregistered-mentions'),
          },
          {
            key: 'admin-bulk-purge',
            label: 'Exclusão em lote',
            onClick: () => navigate('/app/admin/influencers/bulk-purge'),
          },
          { key: 'bulk', label: 'Disparo em massa', onClick: () => navigate('/app/bulk-message') },
        ],
      })
    }

    items.push({ type: 'divider' }, { key: 'logout', label: 'Sair', onClick: () => logout() })
    return items
  }, [user, isAdm, isAssinante, showCampaignsAndCredits, navigate, logout])
  /** Barra de missões/recompensas só na lista Minhas campanhas (não em create, detalhe de campanha, etc.). */
  const missionsBarPath = location.pathname.replace(/\/$/, '') || '/'
  const showMissionsBar =
    missionsBarPath === '/app' || missionsBarPath === '/app/campaigns'
  const hideCreditsOnInfluencerProfile =
    location.pathname.startsWith('/app/influencer') && !isAdm

  useEffect(() => {
    if (!user) {
      setHeaderProfilePic(null)
      setHeaderProfilePicFetching(false)
      setHeaderProfileName(null)
      return
    }
    setHeaderProfileName(user.profile_handle ? `@${user.profile_handle.replace(/^@/, '')}` : user.username)
    if (!myHandle) {
      setHeaderProfilePicFetching(false)
      return
    }
    let cancelled = false
    setHeaderProfilePic(null)
    setHeaderProfilePicFetching(true)
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
      .finally(() => {
        if (!cancelled) setHeaderProfilePicFetching(false)
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
                  onClick={() => { window.location.href = '/app' }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.location.href = '/app' } }}
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
                    onClick={() => { window.location.href = '/app' }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.location.href = '/app' } }}
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
                    onClick={() => { window.location.href = '/app' }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.location.href = '/app' } }}
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
                          menu={{ items: userMenuItems }}
                          trigger={['click']}
                          placement="bottomRight"
                        >
                          <button
                            type="button"
                            style={{
                              display: 'flex',
                              alignItems: 'flex-end',
                              gap: 0,
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
                            {!isMobile && (() => {
                              const isEmail = user.username.includes('@')
                              const nomeDoPerfil = user.displayName != null && String(user.displayName).trim() !== '' ? String(user.displayName).trim() : null
                              const displayName = nomeDoPerfil
                                ?? (myHandle && headerProfileName && headerProfileName !== user.username ? headerProfileName : null)
                                ?? (isEmail ? user.username.slice(0, user.username.indexOf('@')).replace(/^./, (c: string) => c.toUpperCase()) : null)
                                ?? headerProfileName
                                ?? user.username
                              const displaySubtext = myHandle ? `@${myHandle}` : (isEmail ? user.username : null)
                              return (
                                <div
                                  style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'flex-end',
                                    justifyContent: 'center',
                                    lineHeight: 1.3,
                                    marginBottom: 2,
                                  }}
                                >
                                  <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--app-header-text)', whiteSpace: 'nowrap', overflow: 'hidden', maxWidth: 140, textOverflow: 'ellipsis' }}>
                                    {displayName}
                                  </span>
                                  {displaySubtext && (
                                    <span style={{ fontSize: 12, color: 'var(--app-header-text)', opacity: 0.85, whiteSpace: 'nowrap', overflow: 'hidden', maxWidth: 140, textOverflow: 'ellipsis' }}>
                                      {displaySubtext}
                                    </span>
                                  )}
                                </div>
                              )
                            })()}
                            <CaretDownFilled style={{ fontSize: 14, color: 'var(--app-header-text)', opacity: 0.95, marginBottom: -6, marginLeft: -2, marginRight: -2 }} />
                            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              <ProfileAvatar
                                src={headerProfilePic ?? undefined}
                                handle={myHandle}
                                size={36}
                                fallbackIconSize={18}
                                pending={headerProfilePicFetching}
                                onImageError={() => setHeaderProfilePic(null)}
                              />
                            </span>
                          </button>
                        </Dropdown>
                        {creditsState != null && !hideCreditsOnInfluencerProfile && (
                          <span className="layout-credits-wrap">
                            <Link
                              to="/app/payments"
                              className={`layout-credits-pill${hasPendingInvoice ? ' layout-credits-pill--pending' : ''}`}
                              style={{
                                fontSize: 15,
                                fontWeight: 600,
                                color: 'var(--app-primary)',
                                background: 'var(--app-primary-muted)',
                                padding: '6px 12px',
                                borderRadius: 8,
                                whiteSpace: 'nowrap',
                                textDecoration: 'none',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                              }}
                              title={
                                hasPendingInvoice
                                  ? 'Créditos — há cobrança pendente (PIX/boleto). Clique para ver.'
                                  : 'Créditos disponíveis — clique para ver pagamentos'
                              }
                            >
                              💰 {creditsState.loading ? '...' : `${creditsState.balance} créditos`}
                            </Link>
                            {hasPendingInvoice && (
                              <span
                                className="layout-credits-pending-count"
                                aria-label="1 cobrança pendente"
                                title="1 fatura pendente"
                              >
                                1
                              </span>
                            )}
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
                {user && (
                  <>
                    {(user.scope === 'influencer' || isAdm) && (
                      <Link to="/app/projects" style={{ ...drawerLinkStyle, ...(isActive('/app/projects') ? drawerLinkActiveStyle : {}) }} onClick={() => setMobileMenuOpen(false)}>
                        Projetos
                      </Link>
                    )}
                    {(isAdm || isAssinante) && (
                      <Link to="/app/campaigns/create" style={{ ...drawerLinkStyle, ...(isActive('/app/campaigns/create') && location.pathname === '/app/campaigns/create' ? drawerLinkActiveStyle : {}) }} onClick={() => setMobileMenuOpen(false)}>
                        Busca Influencer
                      </Link>
                    )}
                    {showCampaignsAndCredits && (
                      <Link
                        to="/app/payments"
                        style={{ ...drawerLinkStyle, ...(isActive('/app/payments') ? drawerLinkActiveStyle : {}) }}
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          Comprar Créditos
                          {hasPendingInvoice && (
                            <span className="layout-drawer-pending-badge" title="Fatura PIX/boleto pendente">
                              Pendente
                            </span>
                          )}
                        </span>
                      </Link>
                    )}
                    {showCampaignsAndCredits && (
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
                      <Link
                        to="/app/admin/dashboard"
                        style={{ ...drawerLinkStyle, ...(isActive('/app/admin/dashboard') ? drawerLinkActiveStyle : {}) }}
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        Painel admin
                      </Link>
                    )}
                    {isAdm && (
                      <Link
                        to="/app/admin/users"
                        style={{ ...drawerLinkStyle, ...(isActive('/app/admin/users') ? drawerLinkActiveStyle : {}) }}
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        Usuários
                      </Link>
                    )}
                    {isAdm && (
                      <Link
                        to="/app/admin/reports/unregistered-mentions"
                        style={{
                          ...drawerLinkStyle,
                          ...(isActive('/app/admin/reports/unregistered-mentions') ? drawerLinkActiveStyle : {}),
                        }}
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        Relatório @ não cadastrados
                      </Link>
                    )}
                    {isAdm && (
                      <Link
                        to="/app/admin/influencers/bulk-purge"
                        style={{
                          ...drawerLinkStyle,
                          ...(isActive('/app/admin/influencers/bulk-purge') ? drawerLinkActiveStyle : {}),
                        }}
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        Exclusão em lote
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
      <Content className="app-layout-content" style={{ overflowX: 'hidden' }}>
        {user && showMissionsBar && <MissionsBar />}
        <div className="app-page">
          <Outlet />
        </div>
      </Content>
    </AntLayout>
  )
}
