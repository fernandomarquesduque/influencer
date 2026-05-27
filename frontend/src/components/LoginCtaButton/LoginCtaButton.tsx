import type { ReactNode } from 'react'
import { Button } from 'antd'
import type { ButtonProps } from 'antd'
import { ArrowRightOutlined } from '@ant-design/icons'
import './LoginCtaButton.css'

export type LoginCtaColor = 'influencer' | 'agency'

export type LoginCtaButtonProps = Omit<ButtonProps, 'icon' | 'variant'> & {
  /** Paleta do gradiente: influenciador (rosa/laranja) ou agência (roxo/dourado). */
  ctaColor?: LoginCtaColor
  /** Ícone à esquerda (ex.: UserOutlined). */
  leadingIcon?: ReactNode
}

/**
 * CTA pill do login: gradiente, ícone + texto + seta (layout igual ao "Criar meu cadastro").
 * `influencer` = rosa/laranja; `agency` = roxo/dourado da marca.
 */
export default function LoginCtaButton({
  ctaColor = 'agency',
  leadingIcon,
  children,
  className,
  block = true,
  type = 'primary',
  size = 'large',
  ...rest
}: LoginCtaButtonProps) {
  const classes = ['login-btn-cta', `login-btn-cta--${ctaColor}`, className].filter(Boolean).join(' ')

  return (
    <Button type={type} size={size} block={block} className={classes} {...rest}>
      <span className="login-btn-cta__inner">
        {leadingIcon ? (
          <span className="login-btn-cta__icon">{leadingIcon}</span>
        ) : (
          <span className="login-btn-cta__icon login-btn-cta__icon--spacer" aria-hidden />
        )}
        <span className="login-btn-cta__label">{children}</span>
        <ArrowRightOutlined className="login-btn-cta__arrow" aria-hidden />
      </span>
    </Button>
  )
}
