import { SearchOutlined } from '@ant-design/icons'
import { Button, Input, Space } from 'antd'
import type { CSSProperties } from 'react'
import './DiscoveryHomeHero.css'

export type BuscaSearchBarSize = 'sm' | 'lg'

export type BuscaSearchBarProps = {
  value: string
  onChange: (value: string) => void
  onSearch: () => void
  placeholder?: string
  size?: BuscaSearchBarSize
  className?: string
  style?: CSSProperties
  id?: string
}

export default function BuscaSearchBar({
  value,
  onChange,
  onSearch,
  placeholder = 'Digite uma palavra-chave, nicho ou nome',
  size = 'lg',
  className,
  style,
  id,
}: BuscaSearchBarProps) {
  const isLarge = size === 'lg'

  return (
    <Space.Compact
      className={['busca-search-bar', isLarge ? 'busca-search-bar--lg' : 'busca-search-bar--sm', className]
        .filter(Boolean)
        .join(' ')}
      style={{ width: '100%', ...style }}
      size={isLarge ? 'large' : 'middle'}
    >
      <Input
        id={id}
        placeholder={placeholder}
        prefix={<SearchOutlined className="busca-search-bar__icon" aria-hidden />}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onPressEnter={onSearch}
        allowClear
        size={isLarge ? 'large' : 'middle'}
        className="busca-search-bar__input"
      />
      <Button
        type="primary"
        icon={<SearchOutlined />}
        onClick={onSearch}
        size={isLarge ? 'large' : 'middle'}
        className="busca-search-bar__btn"
      >
        Buscar
      </Button>
    </Space.Compact>
  )
}
