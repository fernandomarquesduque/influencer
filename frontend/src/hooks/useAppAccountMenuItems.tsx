import { useEffect, useMemo, useState } from 'react'
import type { MenuProps } from 'antd'
import {
  CreditCardOutlined,
  HeartOutlined,
  LoginOutlined,
  LogoutOutlined,
  SettingOutlined,
  StarFilled,
} from '@ant-design/icons'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useAgencySignupModal } from '../contexts/AgencySignupModalContext'
import { useFavoritePostsOptional } from '../contexts/FavoritePostsContext'
import type { AuthUser } from '../contexts/AuthContext'
import { INFLUENCER_LANDING_PATH } from '../constants/landingPaths'
import { activatePath, influencerDetailPath } from '../constants/profilePaths'
import AccountMenuProfilePreview from '../components/AppAccountMenu/AccountMenuProfilePreview'
import { buildAdminRouteMenuSection } from '../constants/adminRouteMenu'
import { SEARCH_ROUTE_PATH } from '../constants/searchRoute'
import { trackAppUiClick } from '../utils/metaPixel'
import { trackPlansIntent } from '../utils/metaPixelFunnel'

function resolveMyProfileRef(user: AuthUser): string | null {
  const ref = user.profile_ref?.trim()
  if (ref) return ref
  const handle = user.profile_handle?.replace(/^@/, '').trim().toLowerCase()
  return handle || null
}

/** Handle do influenciador em contexto (admin editando perfil na URL atual). */
export function resolveActivateHandleFromPath(pathname: string): string | null {
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

export function getAccountMenuLabel(user: AuthUser): string {
  const display = user.displayName?.trim()
  if (display) return display
  const handle = user.profile_handle?.replace(/^@/, '').trim()
  if (handle) return `@${handle}`
  const username = user.username.trim()
  if (username.includes('@')) {
    const local = username.slice(0, username.indexOf('@'))
    return local ? local.charAt(0).toUpperCase() + local.slice(1) : username
  }
  return username
}

function resolveProfileTargetPath(user: AuthUser, myProfileRef: string | null): string {
  if (user.scope === 'influencer' && myProfileRef) return influencerDetailPath(myProfileRef)
  return '/app/profile'
}

type UseAppAccountMenuItemsOptions = {
  /** Menu para visitante (login + assinatura). Default true. */
  includeGuestMenu?: boolean
}

export function useAppAccountMenuItems(options: UseAppAccountMenuItemsOptions = {}) {
  const { includeGuestMenu = true } = options
  const location = useLocation()
  const navigate = useNavigate()
  const { user, logout, isAdm } = useAuth()
  const { openSignupModal } = useAgencySignupModal()
  const favoritePosts = useFavoritePostsOptional()
  const [plansModalOpen, setPlansModalOpen] = useState(false)

  const favoritesMenuBadgeCount = favoritePosts?.unreadFavoritesCount ?? 0
  const showFavoritesMenuBadge = (favoritePosts?.showFavoritesNotificationBadge ?? false) && favoritesMenuBadgeCount > 0

  const favoritesMenuLabel = (
    <span className="app-account-menu-item-label">
      <span>Favoritos</span>
      {showFavoritesMenuBadge ? (
        <span className="app-account-menu-item-badge" aria-hidden>
          {favoritesMenuBadgeCount > 99 ? '99+' : favoritesMenuBadgeCount}
        </span>
      ) : null}
    </span>
  )

  useEffect(() => {
    setPlansModalOpen(false)
  }, [location.pathname])

  const items = useMemo((): MenuProps['items'] => {
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
      if (!includeGuestMenu) return []
      return [
        {
          key: 'login',
          icon: <LoginOutlined aria-hidden />,
          label: 'Login',
          onClick: () => {
            trackAppUiClick('menu_login', { target_path: 'signup_modal' })
            openSignupModal()
          },
        },
        {
          key: 'invoice',
          icon: <CreditCardOutlined aria-hidden />,
          label: 'Assinatura',
          onClick: () => {
            trackPlansIntent('modal_open', { source: 'account_menu_guest' })
            setPlansModalOpen(true)
          },
        },
        {
          key: 'favorites',
          icon: <HeartOutlined aria-hidden />,
          label: 'Favoritos',
          onClick: () => {
            trackAppUiClick('menu_favoritos_guest', { target_path: 'signup_modal' })
            openSignupModal()
          },
        },
        { type: 'divider' },
        influencerLandingItem,
      ]
    }

    const isInfluencer = user.scope === 'influencer'
    const myProfileRef = resolveMyProfileRef(user)
    const activateHandle =
      resolveActivateHandleFromPath(location.pathname) ?? myProfileRef ?? null

    const accountIdentityItem: NonNullable<MenuProps['items']>[number] = {
      key: 'account-identity',
      label: <AccountMenuProfilePreview user={user} />,
      className: 'app-account-menu-identity-item',
      onClick: () => {
        const targetPath = resolveProfileTargetPath(user, myProfileRef)
        trackAppUiClick('menu_conta_identidade', { target_path: targetPath })
        navigate(targetPath)
      },
    }

    return [
      accountIdentityItem,
      {
        key: 'account',
        icon: <SettingOutlined aria-hidden />,
        label: 'Configurações',
        onClick: () => {
          if (isInfluencer && myProfileRef) {
            const targetPath = activatePath(myProfileRef)
            trackAppUiClick('menu_configuracoes', { target_path: targetPath, hash: '#step-0' })
            navigate({ pathname: targetPath, hash: '#step-0' })
            return
          }
          if (isAdm && activateHandle) {
            const targetPath = activatePath(activateHandle)
            trackAppUiClick('menu_configuracoes', { target_path: targetPath, hash: '#step-0' })
            navigate({ pathname: targetPath, hash: '#step-0' })
            return
          }
          trackAppUiClick('menu_configuracoes', { target_path: '/app/profile' })
          navigate('/app/profile')
        },
      },
      ...(isInfluencer
        ? []
        : [
          {
            key: 'favorites',
            icon: <HeartOutlined aria-hidden />,
          label: favoritesMenuLabel,
          onClick: () => {
            trackAppUiClick('menu_favoritos', { target_path: '/app/favorites' })
            favoritePosts?.acknowledgeFavoritesMenu()
            navigate('/app/favorites')
          },
          },
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
      ...(isAdm ? buildAdminRouteMenuSection(navigate) : []),
      {
        key: 'logout',
        icon: <LogoutOutlined aria-hidden />,
        label: 'Sair',
        onClick: () => {
          trackAppUiClick('menu_logout')
          logout()
          window.location.href = SEARCH_ROUTE_PATH
        },
      },
      { type: 'divider' },
      influencerLandingItem,
    ]
  }, [
    user,
    navigate,
    logout,
    isAdm,
    location.pathname,
    includeGuestMenu,
    openSignupModal,
    favoritesMenuLabel,
    favoritePosts,
  ])

  const accountLabel = user ? getAccountMenuLabel(user) : ''

  return { items, plansModalOpen, setPlansModalOpen, accountLabel, user }
}
