import type { ReactNode } from 'react'
import { Button, Collapse } from 'antd'
import { CaretRightOutlined, EditOutlined, SafetyOutlined } from '@ant-design/icons'
import './ProfileLocationCard.css'

export type ProfileLocationCardProps = {
  city?: string | null
  state?: string | null
  neighborhood?: string | null
  country?: string | null
  isActive?: boolean
  showEdit?: boolean
  onEdit?: () => void
  details?: ReactNode
}

function buildLocationParts(city?: string | null, state?: string | null, neighborhood?: string | null, country?: string | null) {
  const titleParts = [city, state].filter(Boolean)
  const title = titleParts.length > 0 ? titleParts.join(', ') : 'Localização'
  const subtitle = neighborhood?.trim() || country?.trim() || ''
  return { title, subtitle }
}

export default function ProfileLocationCard({
  city,
  state,
  neighborhood,
  country,
  isActive = false,
  showEdit = false,
  onEdit,
  details,
}: ProfileLocationCardProps) {
  const { title, subtitle } = buildLocationParts(city, state, neighborhood, country)

  const header = (
    <div className="profile-location-card__header">
      <div className="profile-location-card__icon-wrap" aria-hidden>
        <SafetyOutlined />
      </div>
      <div className="profile-location-card__divider" aria-hidden />
      <div className="profile-location-card__text">
        <div className="profile-location-card__title">{title}</div>
        {subtitle ? <div className="profile-location-card__subtitle">{subtitle}</div> : null}
      </div>
      {isActive ? (
        <span className="profile-location-card__badge">
          <span className="profile-location-card__badge-dot" aria-hidden />
          Ativo
        </span>
      ) : null}
      {showEdit && onEdit ? (
        <Button
          type="default"
          size="small"
          className="profile-location-card__edit"
          icon={<EditOutlined />}
          onClick={(e) => {
            e.stopPropagation()
            onEdit()
          }}
        >
          Editar
        </Button>
      ) : null}
    </div>
  )

  if (!details) {
    return (
      <div className="profile-location-card">
        <div className="profile-location-card__body">{header}</div>
      </div>
    )
  }

  return (
    <div className="profile-location-card">
      <div className="profile-location-card__body">
        <Collapse
          ghost
          bordered={false}
          defaultActiveKey={[]}
          expandIconPosition="start"
          expandIcon={({ isActive }) => (
            <CaretRightOutlined rotate={isActive ? 90 : 0} style={{ fontSize: 11 }} />
          )}
          items={[
            {
              key: 'details',
              label: header,
              children: details,
            },
          ]}
        />
      </div>
    </div>
  )
}
