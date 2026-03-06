import { Dropdown } from 'antd'
import { BgColorsOutlined } from '@ant-design/icons'
import { useTheme, THEME_OPTIONS } from '../contexts/ThemeContext'

/**
 * Botão redondo do balde de tinta, fixo no canto inferior direito,
 * para trocar o tema. Discreto, flutuando no rodapé.
 */
export default function ThemeFooterButton() {
  const { setTheme } = useTheme()

  return (
    <Dropdown
      menu={{
        items: THEME_OPTIONS.map((opt) => ({
          key: opt.value,
          label: opt.label,
          onClick: () => setTheme(opt.value),
        })),
      }}
      trigger={['click']}
      placement="topRight"
    >
      <button
        type="button"
        aria-label="Escolher tema"
        title="Tema"
        style={{
          position: 'fixed',
          bottom: 20,
          right: 24,
          zIndex: 50,
          width: 44,
          height: 44,
          borderRadius: '50%',
          border: '1px solid var(--app-border)',
          background: 'var(--app-card-bg)',
          color: 'var(--app-text-secondary)',
          opacity: 0.75,
          boxShadow: 'var(--app-shadow-sm)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.opacity = '1'
          e.currentTarget.style.background = 'var(--app-card-bg)'
          e.currentTarget.style.boxShadow = 'var(--app-shadow-md)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.opacity = '0.75'
          e.currentTarget.style.background = 'var(--app-card-bg)'
          e.currentTarget.style.boxShadow = 'var(--app-shadow-sm)'
        }}
      >
        <BgColorsOutlined style={{ fontSize: 18 }} />
      </button>
    </Dropdown>
  )
}
