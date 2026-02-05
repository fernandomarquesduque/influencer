import { Layout as AntLayout } from 'antd'
import { Link, useLocation } from 'react-router-dom'
import { UserOutlined, CloudDownloadOutlined, UserAddOutlined } from '@ant-design/icons'
import type { ReactNode } from 'react'

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

export default function Layout({ children }: { children: ReactNode }) {
  const location = useLocation()
  return (
    <AntLayout style={{ minHeight: '100vh' }}>
      <Header
        style={{
          display: 'flex',
          alignItems: 'center',
          paddingInline: 24,
          background: 'var(--header-bg, #001529)',
          gap: 16,
        }}
      >
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
      </Header>
      <Content style={{ padding: 24 }}>{children}</Content>
    </AntLayout>
  )
}
