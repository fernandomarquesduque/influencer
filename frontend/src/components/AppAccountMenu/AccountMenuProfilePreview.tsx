import { Avatar } from 'antd'
import { UserOutlined } from '@ant-design/icons'
import type { AuthUser } from '../../contexts/AuthContext'
import type { AuthScope } from '../../api'

export type AccountMenuPreviewData = {
  name: string
  email: string | null
  nickname: string | null
  initials: string
  scopeLabel: string
}

const SCOPE_LABELS: Record<AuthScope, string> = {
  adm: 'Administrador',
  assinante: 'Agência',
  influencer: 'Influenciador',
  public: 'Conta',
}

function buildInitials(name: string, fallback: string): string {
  const parts = name.replace(/^@/, '').split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase()
  }
  const one = parts[0] ?? fallback
  return (one.slice(0, 2) || '?').toUpperCase()
}

export function buildAccountMenuPreviewData(user: AuthUser): AccountMenuPreviewData {
  const display = user.displayName?.trim()
  const handle = user.profile_handle?.replace(/^@/, '').trim()
  const username = user.username.trim()
  const atHandle = handle ? `@${handle}` : null
  const email = username.includes('@') ? username : null

  let name = display || atHandle || username
  if (!display && email && !atHandle) {
    const local = email.slice(0, email.indexOf('@'))
    name = local ? local.charAt(0).toUpperCase() + local.slice(1) : email
  }

  let nickname: string | null = null
  if (atHandle && name.toLowerCase() !== atHandle.toLowerCase()) nickname = atHandle
  if (!nickname && handle && !email) nickname = atHandle

  const initials = buildInitials(name, handle || username || '?')

  return {
    name,
    email,
    nickname,
    initials,
    scopeLabel: SCOPE_LABELS[user.scope] ?? user.scope,
  }
}

type AccountMenuProfilePreviewProps = {
  user: AuthUser
}

export default function AccountMenuProfilePreview({ user }: AccountMenuProfilePreviewProps) {
  const { name, email, nickname, initials, scopeLabel } = buildAccountMenuPreviewData(user)

  return (
    <div className="app-account-menu-preview">
      <Avatar
        size={48}
        className="app-account-menu-preview__avatar"
        icon={initials.length === 0 ? <UserOutlined aria-hidden /> : undefined}
      >
        {initials.length > 0 ? initials : null}
      </Avatar>
      <div className="app-account-menu-preview__body">
        <span className="app-account-menu-preview__name">{name}</span>
        {email ? <span className="app-account-menu-preview__email">{email}</span> : null}
        {nickname ? <span className="app-account-menu-preview__nickname">{nickname}</span> : null}
        <span className="app-account-menu-preview__badge">{scopeLabel}</span>
      </div>
    </div>
  )
}
