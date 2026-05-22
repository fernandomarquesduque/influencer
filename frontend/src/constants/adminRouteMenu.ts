import type { MenuProps } from 'antd'
import type { NavigateFunction } from 'react-router-dom'
import {
  DashboardOutlined,
  DeleteOutlined,
  CloudUploadOutlined,
  MailOutlined,
  NotificationOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { createElement } from 'react'
import { trackAppUiClick } from '../utils/metaPixel'

export type AdminRouteMenuEntry = {
  path: string
  label: string
  icon: typeof DashboardOutlined
}

/** Telas em /app/admin. */
export const ADMIN_ROUTE_MENU_ENTRIES: readonly AdminRouteMenuEntry[] = [
  { path: '/app/admin/dashboard', label: 'Dashboard', icon: DashboardOutlined },
  { path: '/app/admin/users', label: 'Usuários', icon: TeamOutlined },
  { path: '/app/admin/reports/unregistered-mentions', label: 'Menções sem cadastro', icon: NotificationOutlined },
  { path: '/app/admin/influencers/bulk-purge', label: 'Purge em massa', icon: DeleteOutlined },
  { path: '/app/admin/direct-queue', label: 'Fila de mensagens', icon: MailOutlined },
  { path: '/app/admin/media-s3', label: 'Mídia S3', icon: CloudUploadOutlined },
] as const

export function buildAdminRouteMenuSection(navigate: NavigateFunction): NonNullable<MenuProps['items']> {
  const routeItems = ADMIN_ROUTE_MENU_ENTRIES.map((entry, index) => ({
    key: `admin-route-${index}`,
    icon: createElement(entry.icon, { 'aria-hidden': true }),
    label: entry.label,
    onClick: () => {
      trackAppUiClick('menu_admin_route', { target_path: entry.path })
      navigate(entry.path)
    },
  }))

  return [
    { type: 'divider' as const },
    {
      key: 'admin-nav-submenu',
      label: 'Administração',
      children: routeItems,
    },
  ]
}
