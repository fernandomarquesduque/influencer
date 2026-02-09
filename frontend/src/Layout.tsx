import { useEffect } from 'react'
import { Layout as AntLayout, Button, Dropdown } from 'antd'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { UserOutlined, CloudDownloadOutlined, UserAddOutlined, TeamOutlined, LogoutOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { Outlet } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'

const { Header, Content } = AntLayout

const navStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  color: 'rgba(255,255,255,.85)',
  fontSize: 15,
  fontWeight: 500,
  textDecoration: 'none',
  padding: '4px 12px',
  borderRadius: 4,
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

  return (
    <AntLayout style={{ minHeight: '100vh' }}>
      <Header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingInline: 24,
          background: 'var(--header-bg, #001529)',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {user?.scope === 'influencer' && user.profile_handle ? (
            <Link
              to={`/influencer/${encodeURIComponent(user.profile_handle.replace(/^@/, ''))}`}
              style={{
                ...navStyle,
                fontSize: 18,
                fontWeight: 600,
                background: location.pathname.startsWith('/influencer/') ? 'rgba(255,255,255,.15)' : undefined,
              }}
            >
              <UserOutlined />
              Meu perfil
            </Link>
          ) : (
            <Link
              to="/"
              style={{
                ...navStyle,
                fontSize: 18,
                fontWeight: 600,
                background: location.pathname === '/' ? 'rgba(255,255,255,.15)' : undefined,
              }}
            >
              <UserOutlined />
              Influenciadores
            </Link>
          )}
          {user?.scope !== 'influencer' && (
            <>
              <Link
                to="/extraction"
                style={{
                  ...navStyle,
                  background: location.pathname === '/extraction' ? 'rgba(255,255,255,.15)' : undefined,
                }}
              >
                <CloudDownloadOutlined />
                Extração
              </Link>
              <Link
                to="/extract-profile"
                style={{
                  ...navStyle,
                  background: location.pathname === '/extract-profile' ? 'rgba(255,255,255,.15)' : undefined,
                }}
              >
                <UserAddOutlined />
                Extrair perfil
              </Link>
              <Link
                to="/create"
                style={{
                  ...navStyle,
                  background: location.pathname.startsWith('/create') ? 'rgba(255,255,255,.15)' : undefined,
                }}
              >
                <SafetyCertificateOutlined />
                Validar perfil
              </Link>
            </>
          )}
          {isAdm && (
            <Link
              to="/admin/users"
              style={{
                ...navStyle,
                background: location.pathname === '/admin/users' ? 'rgba(255,255,255,.15)' : undefined,
              }}
            >
              <TeamOutlined />
              Usuários
            </Link>
          )}
        </div>
        {user ? (
          <Dropdown
            menu={{
              items: [
                {
                  key: 'logout',
                  icon: <LogoutOutlined />,
                  label: 'Sair',
                  onClick: () => {
                    logout()
                    navigate('/login')
                  },
                },
              ],
            }}
            placement="bottomRight"
          >
            <Button type="text" style={{ color: 'rgba(255,255,255,.85)' }}>
              {user.username}
            </Button>
          </Dropdown>
        ) : (
          <Link to="/login" style={{ ...navStyle, marginLeft: 'auto' }}>
            Entrar
          </Link>
        )}
      </Header>
      <Content style={{ padding: 24 }}>
        <Outlet />
      </Content>
    </AntLayout>
  )
}
