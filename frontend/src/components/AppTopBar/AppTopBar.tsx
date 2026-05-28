import { useEffect, useState } from 'react'
import { Button, Dropdown, Input, Space } from 'antd'
import { SearchOutlined, UserOutlined } from '@ant-design/icons'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAppAccountMenuItems } from '../../hooks/useAppAccountMenuItems'
import { useFavoritePostsOptional } from '../../contexts/FavoritePostsContext'
import BuscaInfluencerPlansModal from '../BuscaInfluencerPlansModal/BuscaInfluencerPlansModal'
import { trackAppUiClick } from '../../utils/metaPixel'
import { trackInfluencerSearch } from '../../utils/metaPixelFunnel'
import {
  isSearchRoute as checkIsSearchRoute,
  SEARCH_ROUTE_PATH,
  getMergedUrlSearchParams,
} from '../../constants/searchRoute'
import { OPEN_PLANS_MODAL_EVENT } from '../../utils/openPlansModal'
import './AppTopBar.css'

function readSearchTermFromLocation(location: { pathname: string; search: string; hash: string }): string {
  return getMergedUrlSearchParams(location.search, location.hash).get('q')?.trim() ?? ''
}

export default function AppTopBar() {
  const location = useLocation()
  const navigate = useNavigate()
  const isSearchRoute = checkIsSearchRoute(location.pathname)
  const [searchInput, setSearchInput] = useState(() => readSearchTermFromLocation(location))
  const { items: userMenuItems, plansModalOpen, setPlansModalOpen, user } = useAppAccountMenuItems()
  const favoritePosts = useFavoritePostsOptional()
  const showFavoriteBadge =
    !!user && user.scope !== 'influencer' && (favoritePosts?.showFavoritesNotificationBadge ?? false)
  const favoriteBadgeCount = favoritePosts?.unreadFavoritesCount ?? 0
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

  useEffect(() => {
    const onOpenPlans = () => setPlansModalOpen(true)
    window.addEventListener(OPEN_PLANS_MODAL_EVENT, onOpenPlans)
    return () => window.removeEventListener(OPEN_PLANS_MODAL_EVENT, onOpenPlans)
  }, [setPlansModalOpen])

  const submitSearch = () => {
    const term = searchInput.trim()
    trackAppUiClick('topbar_search', { has_term: term.length > 0, on_search_route: isSearchRoute })
    if (term) trackInfluencerSearch(term, 'topbar', { on_search_route: isSearchRoute })
    const searchSubmitAt = Date.now()
    if (isSearchRoute) {
      const search = term ? `?q=${encodeURIComponent(term)}` : ''
      navigate(
        { pathname: SEARCH_ROUTE_PATH, search, hash: '' },
        { replace: false, state: { searchSubmitAt } }
      )
      return
    }
    navigate(term ? `${SEARCH_ROUTE_PATH}?q=${encodeURIComponent(term)}` : SEARCH_ROUTE_PATH, {
      state: term ? { searchSubmitAt } : undefined,
    })
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
              placeholder={isMobile ? 'Buscar…' : 'Digite uma palavra, cidade ou marca'}
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
          <Dropdown
            menu={{ items: userMenuItems, className: 'app-account-menu-dropdown' }}
            trigger={['click']}
            placement="bottomRight"
          >
            <button
              type="button"
              className="app-top-bar-account-btn"
              aria-label={
                showFavoriteBadge
                  ? `Notificações: ${favoriteBadgeCount} favorito${favoriteBadgeCount === 1 ? '' : 's'}. Abrir menu da conta`
                  : 'Abrir menu da conta'
              }
            >
              <span className="app-top-bar-account-btn__icon-wrap">
                {showFavoriteBadge ? (
                  <span className="app-top-bar-account-btn__bell" aria-hidden>
                    🔔
                  </span>
                ) : (
                  <UserOutlined className="app-top-bar-account-btn__user" aria-hidden />
                )}
                {showFavoriteBadge ? (
                  <span className="app-count-badge" aria-hidden>
                    {favoriteBadgeCount > 99 ? '99+' : favoriteBadgeCount}
                  </span>
                ) : null}
              </span>
            </button>
          </Dropdown>
        </div>
      </header>
      <div className="app-top-bar-spacer" aria-hidden />
      <BuscaInfluencerPlansModal open={plansModalOpen} onClose={() => setPlansModalOpen(false)} />
    </>
  )
}
