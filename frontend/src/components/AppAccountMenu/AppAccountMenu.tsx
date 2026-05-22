import { Dropdown } from 'antd'
import { DownOutlined, UserOutlined } from '@ant-design/icons'
import BuscaInfluencerPlansModal from '../BuscaInfluencerPlansModal/BuscaInfluencerPlansModal'
import { useAppAccountMenuItems } from '../../hooks/useAppAccountMenuItems'
import './AppAccountMenu.css'

export type AppAccountMenuProps = {
  className?: string
  /** Exibe nome/@ ao lado do ícone (landing). */
  showLabel?: boolean
  includeGuestMenu?: boolean
  placement?: 'bottomRight' | 'bottomLeft'
  ariaLabel?: string
}

export default function AppAccountMenu({
  className = 'app-account-menu-btn',
  showLabel = false,
  includeGuestMenu = true,
  placement = 'bottomRight',
  ariaLabel = 'Abrir menu da conta',
}: AppAccountMenuProps) {
  const { items, plansModalOpen, setPlansModalOpen, accountLabel } = useAppAccountMenuItems({
    includeGuestMenu,
  })

  if (!items?.length) return null

  return (
    <>
      <Dropdown
        menu={{ items, className: 'app-account-menu-dropdown' }}
        trigger={['click']}
        placement={placement}
      >
        <button type="button" className={className} aria-label={ariaLabel}>
          <UserOutlined className="app-account-menu-btn__user" aria-hidden />
          {showLabel && accountLabel ? (
            <span className="app-account-menu-btn__label">{accountLabel}</span>
          ) : null}
          <DownOutlined className="app-account-menu-btn__chevron" aria-hidden />
        </button>
      </Dropdown>
      <BuscaInfluencerPlansModal open={plansModalOpen} onClose={() => setPlansModalOpen(false)} />
    </>
  )
}
