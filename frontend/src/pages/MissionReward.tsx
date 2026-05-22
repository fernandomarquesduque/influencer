import { useEffect, useRef, useMemo, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Button, Typography } from 'antd'
import { TrophyOutlined, MailOutlined, InstagramOutlined, CheckCircleOutlined } from '@ant-design/icons'
import { SEARCH_ROUTE_PATH } from '../constants/searchRoute'
import './MissionReward.css'

const { Title, Text } = Typography

const COLORS = ['#ff6b6b', '#4ecdc4', '#ffe66d', '#95e1d3', '#f38181', '#aa96da', '#fcbad3', '#a8d8ea']

function Confetti() {
  const pieces = useMemo(() => Array.from({ length: 80 }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 0.8,
    duration: 2 + Math.random() * 1.5,
    color: COLORS[i % COLORS.length],
    size: 6 + Math.random() * 8,
    rotation: Math.random() * 360,
  })), [])

  return (
    <div className="mission-reward-confetti" aria-hidden>
      {pieces.map((p) => (
        <div
          key={p.id}
          className="mission-reward-confetti-piece"
          style={{
            left: `${p.left}%`,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            backgroundColor: p.color,
            width: p.size,
            height: p.size,
            transform: `rotate(${p.rotation}deg)`,
          }}
        />
      ))}
    </div>
  )
}

export default function MissionReward() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const type = searchParams.get('type') || 'email'
  const credits = Number(searchParams.get('credits')) || 10
  const playedRef = useRef(false)
  const [countdown, setCountdown] = useState(5)

  useEffect(() => {
    if (playedRef.current) return
    playedRef.current = true
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (countdown <= 1) {
        navigate(SEARCH_ROUTE_PATH, { replace: true })
      } else {
        setCountdown((n) => n - 1)
      }
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [countdown, navigate])

  const isEmail = type === 'email'
  const title = isEmail ? 'E-mail confirmado!' : 'Instagram vinculado!'
  const subtitle = isEmail
    ? 'Sua conta está ativa. Você já pode usar a plataforma.'
    : 'Missão 2 concluída. Perfil da empresa vinculado à sua conta.'

  return (
    <div className="mission-reward-page">
      <Confetti />
      <div className="mission-reward-content">
        <div className="mission-reward-icon">
          {isEmail ? <MailOutlined /> : <InstagramOutlined />}
        </div>
        <Title level={2} style={{ marginBottom: 8 }}>{title}</Title>
        <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>{subtitle}</Text>
        {isEmail ? (
          <div className="mission-reward-success-badge">
            <CheckCircleOutlined style={{ marginRight: 8, fontSize: 22 }} />
            <span>Conta verificada</span>
          </div>
        ) : (
          <>
            <div className="mission-reward-credits">
              <TrophyOutlined style={{ marginRight: 8, fontSize: 28 }} />
              <span className="mission-reward-credits-value">+{credits} créditos</span>
            </div>
            <p style={{ marginTop: 24, color: 'var(--app-text-secondary)', fontSize: 14 }}>
              Os créditos já estão na sua conta. Use-os para gerar relatórios de influenciadores.
            </p>
          </>
        )}
        {isEmail && (
          <p style={{ marginTop: 24, color: 'var(--app-text-secondary)', fontSize: 14 }}>
            Explore influenciadores, monte campanhas e gere relatórios quando precisar.
          </p>
        )}
        <Button
          type="primary"
          size="large"
          block
          className="mission-reward-enter-btn"
          aria-live="polite"
          onClick={() => navigate(SEARCH_ROUTE_PATH, { replace: true })}
          style={{ marginTop: 28, minHeight: 48, fontWeight: 600 }}
        >
          Entrar ({countdown})
        </Button>
      </div>
    </div>
  )
}
