import { useEffect, useMemo, useState } from 'react'
import { Button, Dropdown, Input, Space } from 'antd'
import type { MenuProps } from 'antd'
import {
  CreditCardOutlined,
  DownOutlined,
  LoginOutlined,
  LogoutOutlined,
  SearchOutlined,
  SettingOutlined,
  StarFilled,
  UserOutlined,
} from '@ant-design/icons'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import BuscaInfluencerPlansModal from '../BuscaInfluencerPlansModal/BuscaInfluencerPlansModal'
import { trackAppUiClick } from '../../utils/metaPixel'
import { INFLUENCER_LANDING_PATH } from '../../constants/landingPaths'
import { isSearchRoute as checkIsSearchRoute, SEARCH_ROUTE_PATH } from '../../constants/searchRoute'
import './AppTopBar.css'

/** Handle do influenciador em contexto (admin editando perfil na URL atual). */
function resolveActivateHandleFromPath(pathname: string): string | null {
  const patterns = [
    /^\/app\/influencer\/([^/]+)/i,
    /^\/app\/campaigns\/[^/]+\/influencer\/([^/]+)/i,
    /^\/activate\/([^/]+)/i,
  ]
  for (const pattern of patterns) {
    const match = pathname.match(pattern)
    if (match?.[1]) {
      const handle = decodeURIComponent(match[1]).replace(/^@/, '').trim().toLowerCase()
      if (handle) return handle
    }
  }
  return null
}

function readSearchTermFromLocation(location: { pathname: string; search: string; hash: string }): string {
  const merged = new URLSearchParams()
  const qs = location.search?.replace(/^\?/, '').trim()
  if (qs) new URLSearchParams(qs).forEach((v, k) => merged.set(k, v))
  const hash = location.hash?.replace(/^#/, '').trim()
  if (hash) new URLSearchParams(hash).forEach((v, k) => merged.set(k, v))
  return merged.get('q')?.trim() ?? ''
}

export default function AppTopBar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, logout, isAdm } = useAuth()
  const isSearchRoute = checkIsSearchRoute(location.pathname)
  const [searchInput, setSearchInput] = useState(() => readSearchTermFromLocation(location))
  const [plansModalOpen, setPlansModalOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches
  )

  useEffect(() => {
    if (isSearchRoute) setSearchInput(readSearchTermFromLocation(location))
  }, [isSearchRoute, location.search, location.hash])

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)')
    const onChange = () => setIsMobile(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const userMenuItems = useMemo((): MenuProps['items'] => {
    const influencerLandingItem: NonNullable<MenuProps['items']>[number] = {
      key: 'influencer-landing',
      className: 'app-top-bar-menu-item--highlight',
      icon: <StarFilled aria-hidden />,
      label: 'Sou Influencer',
      onClick: () => {
        trackAppUiClick('menu_sou_influencer', { target_path: INFLUENCER_LANDING_PATH })
        window.location.assign(INFLUENCER_LANDING_PATH)
      },
    }

    if (!user) {
      return [
        influencerLandingItem,
        { type: 'divider' },
        {
          key: 'login',
          icon: <LoginOutlined aria-hidden />,
          label: 'Login',
          onClick: () => {
            trackAppUiClick('menu_login', { target_path: '/login' })
            navigate('/login')
          },
        },
        {
          key: 'invoice',
          icon: <CreditCardOutlined aria-hidden />,
          label: 'Assinatura',
          onClick: () => setPlansModalOpen(true),
        },
      ]
    }

    const isInfluencer = user.scope === 'influencer'
    const myProfileHandle = user.profile_handle?.replace(/^@/, '').trim().toLowerCase() ?? null
    const activateHandle =
      resolveActivateHandleFromPath(location.pathname) ?? myProfileHandle ?? null

    const myProfileItem: NonNullable<MenuProps['items']> =
      isInfluencer && myProfileHandle
        ? [
          {
            key: 'my-profile',
            icon: <UserOutlined aria-hidden />,
            label: 'Meu Perfil',
            onClick: () => {
              const targetPath = `/app/influencer/${encodeURIComponent(myProfileHandle)}`
              trackAppUiClick('menu_meu_perfil', { target_path: targetPath })
              navigate(targetPath)
            },
          },
        ]
        : []

    return [
      influencerLandingItem,
      { type: 'divider' },
      ...myProfileItem,
      {
        key: 'account',
        icon: <SettingOutlined aria-hidden />,
        label: 'Configurações',
        onClick: () => {
          if ((isAdm || isInfluencer) && activateHandle) {
            const targetPath = `/activate/${encodeURIComponent(activateHandle)}`
            trackAppUiClick('menu_minha_conta', { target_path: targetPath, hash: '#step-0' })
            navigate({ pathname: targetPath, hash: '#step-0' })
            return
          }
          trackAppUiClick('menu_minha_conta', { target_path: '/app/profile' })
          navigate('/app/profile')
        },
      },
      ...(isInfluencer
        ? []
        : [
          {
            key: 'invoice',
            icon: <CreditCardOutlined aria-hidden />,
            label: 'Assinatura',
            onClick: () => {
              trackAppUiClick('menu_fatura', { target_path: '/app/payments' })
              navigate('/app/payments')
            },
          },
        ]),
      {
        key: 'logout',
        icon: <LogoutOutlined aria-hidden />,
        label: 'Sair',
        onClick: () => {
          trackAppUiClick('menu_logout')
          logout()
          navigate(SEARCH_ROUTE_PATH)
        },
      },
    ]
  }, [user, navigate, logout, isAdm, location.pathname])

  const submitSearch = () => {
    const term = searchInput.trim()
    trackAppUiClick('topbar_search', { has_term: term.length > 0, on_search_route: isSearchRoute })
    if (isSearchRoute) {
      const params = new URLSearchParams(location.search)
      if (term) params.set('q', term)
      else params.delete('q')
      const next = params.toString()
      const path = next ? `${SEARCH_ROUTE_PATH}?${next}` : SEARCH_ROUTE_PATH
      // Mesma URL não dispara navegação no React Router; state força nova busca na página.
      navigate(path, { replace: false, state: { searchSubmitAt: Date.now() } })
      return
    }
    navigate(term ? `${SEARCH_ROUTE_PATH}?q=${encodeURIComponent(term)}` : SEARCH_ROUTE_PATH)
  }

  return (
    <>
      <header className="app-top-bar">
        <button
          type="button"
          className="app-top-bar__brand"
          onClick={() => {
            trackAppUiClick('header_logo_home', { target_path: SEARCH_ROUTE_PATH })
            window.location.href = SEARCH_ROUTE_PATH
          }}
          aria-label="Busca Influencer"
        >
          <img src="/images/logo.svg" alt="Busca Influencer" />
        </button>
        <div className="app-top-bar__search">
          <Space.Compact style={{ flex: 1, minWidth: 0 }}>
            <Input
              placeholder={isMobile ? 'Buscar…' : 'Digite uma palavra'}
              prefix={<SearchOutlined style={{ color: 'var(--app-text-tertiary)', fontSize: isMobile ? 14 : 16 }} />}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onPressEnter={submitSearch}
              allowClear
              size={isMobile ? 'middle' : 'large'}
              style={{ flex: 1 }}
            />
            <Button
              type="primary"
              size={isMobile ? 'middle' : 'large'}
              className="app-top-bar__search-btn"
              icon={<SearchOutlined aria-hidden />}
              onClick={submitSearch}
            >
              <span className="app-top-bar__search-btn-label">Buscar</span>
            </Button>
          </Space.Compact>
          <Dropdown menu={{ items: userMenuItems }} trigger={['click']} placement="bottomRight">
            <button type="button" className="app-top-bar-account-btn" aria-label="Abrir menu">
              <UserOutlined className="app-top-bar-account-btn__user" />
              <DownOutlined className="app-top-bar-account-btn__chevron" />
            </button>
          </Dropdown>
        </div>
      </header>
      <div className="app-top-bar-spacer" aria-hidden />
      <BuscaInfluencerPlansModal open={plansModalOpen} onClose={() => setPlansModalOpen(false)} />
    </>
  )
}
