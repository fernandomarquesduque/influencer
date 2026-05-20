import React, { useState } from 'react'
import { Alert, Button, Card, Typography, message } from 'antd'
import { LockOutlined, HeartOutlined, SyncOutlined } from '@ant-design/icons'
import { reportTokens as t } from '../pages/reportTokens'
import ProfileAvatar from './ProfileAvatar'
import {
  queueRefreshProfile,
  fetchProfile,
  fetchPosts,
  getProfilePicUrl,
  proxyImageUrl,
  type ProfileItem,
  type PostItem,
} from '../api'

const { spacing: s, colors: c, radiusLegacy: r, shadowLegacy: sh } = t

const cardBaseStyle: React.CSSProperties = {
  borderRadius: r,
  border: 'none',
  boxShadow: sh,
  background: c.cardBg,
}

const POLL_INTERVAL_MS = 10_000
const MAX_POLLS = 12 // até 2 min de polling (12 × 10s), depois reseta
const TOTAL_DURATION_MS = 60_000 // barra chega em 95% em 1 min; para em 95% se não finalizar
const PROGRESS_TICK_MS = 250

export interface PrivateProfileMessageProps {
  /** Perfil com is_private: true. Toda a lógica de exibição e retry fica encapsulada aqui. */
  profile: ProfileItem
  profileRef: string
  isAdm?: boolean
  isMobile?: boolean
  /** Chamado quando o retry atualiza perfil/posts (ex.: após aceitar solicitação). O pai atualiza estado e re-renderiza. */
  onProfileUpdate: (
    profile: ProfileItem | null,
    posts: { items: PostItem[]; total: number },
    dataRedacted?: boolean
  ) => void
}

/**
 * Exibe o card de "perfil privado" e encapsula:
 * - Derivação de foto, nome e @ a partir de profile
 * - Lógica de retry (queue-refresh, polling, barra de progresso fluida por tempo)
 * Só deve ser renderizado quando profile?.is_private === true.
 */
export function PrivateProfileMessage({
  profile,
  profileRef,
  isAdm = false,
  isMobile = false,
  onProfileUpdate,
}: PrivateProfileMessageProps) {
  const [retrying, setRetrying] = useState(false)
  const [retryProgress, setRetryProgress] = useState(0)
  const [timeoutError, setTimeoutError] = useState(false)

  const userData = profile?.data?.user as Record<string, unknown> | undefined
  const name = profile?.full_name ?? (userData?.full_name != null ? String(userData.full_name) : undefined)
  const profilePic = proxyImageUrl(getProfilePicUrl(profile)) || undefined

  const onRetry = async () => {
    const h = profileRef?.trim()
    if (!h || retrying) return
    setRetrying(true)
    setRetryProgress(0)
    setTimeoutError(false)
    let progressIntervalId: ReturnType<typeof setInterval> | null = null
    await new Promise((r) => setTimeout(r, 0))
    try {
      const queueRes = await queueRefreshProfile(h, { priority: isAdm })
      if (queueRes.queued) {
        const startTime = Date.now()
        progressIntervalId = setInterval(() => {
          const elapsed = Date.now() - startTime
          setRetryProgress(Math.min(95, (elapsed / TOTAL_DURATION_MS) * 95))
        }, PROGRESS_TICK_MS)
        let p: ProfileItem | null = null
        for (let i = 0; i < MAX_POLLS; i++) {
          const [profileData, postsData] = await Promise.all([
            fetchProfile(h),
            fetchPosts(h, 100, 0),
          ])
          p = profileData ?? null
          const raw = postsData as { items: PostItem[]; total: number; _redacted?: boolean }
          const items = raw?.items ?? []
          const total = raw?.total ?? 0
          const pr = p as Record<string, unknown> | null
          const redacted = pr?._redacted === true || raw?._redacted === true
          onProfileUpdate(p, { items, total }, redacted)
          if (p && !p.is_private) break
          if (i < MAX_POLLS - 1) await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
        }
        // Passou o tempo e não finalizou: perfil segue privado ou sem dados
        if (!p || p.is_private) setTimeoutError(true)
      } else {
        const [p, postsRes] = await Promise.all([fetchProfile(h), fetchPosts(h, 100, 0)])
        const pr = p as Record<string, unknown> | null
        const r = postsRes as { items: PostItem[]; total: number; _redacted?: boolean }
        onProfileUpdate(p ?? null, { items: r?.items ?? [], total: r?.total ?? 0 }, pr?._redacted === true || r?._redacted === true)
        if (queueRes.message) message.info(queueRes.message)
      }
    } catch {
      message.error('Não foi possível atualizar. Tente de novo em instantes.')
    } finally {
      if (progressIntervalId) clearInterval(progressIntervalId)
      setRetryProgress(100)
      setRetrying(false)
    }
  }

  const avatarSize = isMobile ? 56 : 88
  const pad = isMobile ? s.sm : s.xl
  const padTop = isMobile ? s.md : 40

  return (
    <div style={{ width: '100%', maxWidth: 520, margin: '0 auto', padding: pad, paddingTop: padTop, boxSizing: 'border-box' }}>
      <Card
        style={{
          ...cardBaseStyle,
          overflow: 'hidden',
          padding: 0,
          border: 'none',
          boxShadow: sh,
          background: c.cardBg,
        }}
        bodyStyle={{ padding: 0 }}
      >
        {/* Faixa colorida no topo: perfil + badge (em coluna no mobile) */}
        <div
          style={{
            background: c.primary,
            padding: pad,
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            alignItems: isMobile ? 'stretch' : 'center',
            justifyContent: 'space-between',
            gap: isMobile ? s.sm : s.md,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: isMobile ? s.sm : s.md, minWidth: 0 }}>
            {profilePic ? (
              <ProfileAvatar
                src={profilePic}
                handle={profileRef}
                alt={name || 'Foto do perfil'}
                size={avatarSize}
                border={isMobile ? '3px solid rgba(255,255,255,0.9)' : '4px solid rgba(255,255,255,0.9)'}
                shadow={sh}
              />
            ) : (
              <div
                style={{
                  width: avatarSize,
                  height: avatarSize,
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,0.3)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: isMobile ? '3px solid rgba(255,255,255,0.9)' : '4px solid rgba(255,255,255,0.9)',
                  flexShrink: 0,
                }}
              >
                <LockOutlined style={{ fontSize: isMobile ? 24 : 36, color: 'rgba(255,255,255,0.9)' }} />
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
              {name && (
                <Typography.Title level={5} style={{ margin: 0, color: '#fff', fontWeight: 700, fontSize: isMobile ? 15 : undefined }}>
                  {name}
                </Typography.Title>
              )}
            </div>
          </div>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: s.xs,
              padding: isMobile ? `${s.xs}px ${s.sm}px` : `${s.xs}px ${s.sm}px`,
              borderRadius: r,
              background: 'rgba(255,255,255,0.95)',
              border: '1px solid rgba(255,255,255,0.5)',
              flexShrink: 0,
              alignSelf: isMobile ? 'center' : undefined,
            }}
          >
            <LockOutlined style={{ color: c.warning, fontSize: isMobile ? 14 : 16 }} />
            <span style={{ fontSize: isMobile ? 12 : 13, fontWeight: 600, color: c.text }}>Perfil privado</span>
          </div>
        </div>
        {/* Conteúdo */}
        <div style={{ padding: pad }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: s.xs, marginBottom: s.sm }}>
            <HeartOutlined style={{ color: c.primary, fontSize: isMobile ? 18 : 20 }} />
            <Typography.Title level={5} style={{ margin: 0, color: c.text, fontSize: isMobile ? 15 : undefined }}>
              Aceite nossa solicitação de amizade
            </Typography.Title>
          </div>
          <Typography.Paragraph
            style={{
              marginBottom: 0,
              color: c.textSecondary,
              fontSize: isMobile ? 14 : 15,
              lineHeight: 1.5,
            }}
          >
            Seu perfil está fechado, então a gente não consegue acessar seus posts para montar o relatório. Assim que você aceitar a gente no Insta, conseguimos analisar seu conteúdo e gerar seu relatório de influenciador.
          </Typography.Paragraph>
          {timeoutError && (
            <Alert
              type="warning"
              showIcon
              message="Não foi possível extrair os dados"
              description="Verifique se aceitou a solicitação de amizade no Instagram e tente novamente."
              style={{ marginBottom: s.md }}
            />
          )}
          <div style={{ marginTop: isMobile ? s.md : s.lg, width: '100%' }}>
            {retrying && (
              <div style={{ marginBottom: s.md }}>
                <div
                  style={{
                    height: 10,
                    background: 'linear-gradient(90deg, var(--app-primary-muted), var(--app-warning-bg))',
                    borderRadius: 10,
                    overflow: 'hidden',
                    marginBottom: 8,
                    boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.06)',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.min(100, Math.max(0, retryProgress))}%`,
                      background: 'linear-gradient(90deg, var(--app-primary) 0%, var(--app-primary-dark) 50%, var(--app-accent) 100%)',
                      borderRadius: 10,
                      transition: 'width 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                      boxShadow: 'var(--app-shadow-md)',
                    }}
                  />
                </div>
                <p style={{ color: c.textSecondary, fontSize: 13, fontWeight: 600, letterSpacing: '0.05em', margin: 0 }}>
                  {Math.round(retryProgress)}%
                </p>
              </div>
            )}
            <Button
              type="primary"
              size="large"
              loading={retrying}
              onClick={onRetry}
              block
              disabled={retrying}
              style={{ borderRadius: r, fontWeight: 600, width: '100%', minHeight: 44 }}
              icon={<SyncOutlined />}
            >
              {retrying ? 'Atualizando…' : 'Tentar novamente'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
