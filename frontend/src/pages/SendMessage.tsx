/**
 * Tela para enviar mensagem Direct do Instagram a um influenciador.
 * Editor de texto com suporte a emojis; a mensagem é enviada via API (crawl) para o Direct do Instagram.
 */
import { useState, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Button, Card, Input, Space, Typography, message as antMessage } from 'antd'
import { ArrowLeftOutlined, SendOutlined, SmileOutlined, PictureOutlined, DeleteOutlined } from '@ant-design/icons'
import { fetchProfile, sendDirectMessageToInfluencer, getProfilePicUrl, proxyImageUrl } from '../api'
import type { ProfileItem } from '../api'
import { useAuth } from '../contexts/AuthContext'
import { reportTokens as t } from './reportTokens'
import ProfileAvatar from '../components/ProfileAvatar'

const { Text } = Typography
const { TextArea } = Input
const s = t.spacing
const c = t.colors
const r = t.radius

/** Emojis rápidos para inserir na mensagem */
const EMOJI_LIST = [
  '😀', '😊', '👍', '❤️', '🔥', '✨', '💪', '🙌', '😍', '🤝',
  '💼', '📸', '📱', '✅', '💬', '🎉', '📧', '🌟', '🙏', '👋',
]

const MAX_IMAGE_MB = 10

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function SendMessage() {
  const { handle } = useParams<{ handle: string }>()
  const navigate = useNavigate()
  const { user, isAdm, loading: authLoading } = useAuth()
  const [profile, setProfile] = useState<ProfileItem | null>(null)
  const [loadingProfile, setLoadingProfile] = useState(true)
  const [message, setMessage] = useState('')
  const [attachedImage, setAttachedImage] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!handle) {
      setLoadingProfile(false)
      return
    }
    fetchProfile(handle)
      .then((p) => setProfile(p ?? null))
      .catch(() => setProfile(null))
      .finally(() => setLoadingProfile(false))
  }, [handle])

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      antMessage.warning('Faça login para continuar.')
      navigate('/login', { replace: true })
      return
    }
    if (!isAdm) {
      antMessage.warning('Apenas administradores podem enviar mensagens pelo sistema.')
      navigate(handle ? `/app/influencer/${encodeURIComponent(handle)}` : '/app', { replace: true })
    }
  }, [authLoading, user, isAdm, navigate, handle])

  const insertEmoji = (emoji: string) => {
    const ta = textareaRef.current
    if (ta) {
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const newVal = message.slice(0, start) + emoji + message.slice(end)
      setMessage(newVal)
      setTimeout(() => {
        ta.focus()
        const pos = start + emoji.length
        ta.setSelectionRange(pos, pos)
      }, 0)
    } else {
      setMessage((prev) => prev + emoji)
    }
  }

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      antMessage.warning('Selecione apenas imagens (JPG, PNG, etc.).')
      return
    }
    if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
      antMessage.warning(`Imagem muito grande. Máximo ${MAX_IMAGE_MB} MB.`)
      return
    }
    setAttachedImage(file)
    setImagePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return URL.createObjectURL(file)
    })
  }

  const removeImage = () => {
    setAttachedImage(null)
    if (imagePreview) URL.revokeObjectURL(imagePreview)
    setImagePreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleSend = async () => {
    const trimmed = message.trim()
    if (!trimmed && !attachedImage) {
      antMessage.warning('Digite uma mensagem ou anexe uma imagem.')
      return
    }
    if (!handle) {
      antMessage.error('Perfil não encontrado.')
      return
    }
    setSending(true)
    try {
      const imageBase64 = attachedImage ? await fileToBase64(attachedImage) : undefined
      await sendDirectMessageToInfluencer(handle, trimmed || ' ', imageBase64)
      antMessage.success('Mensagem enviada pelo Direct do Instagram.')
      setMessage('')
      removeImage()
    } catch (e) {
      antMessage.error(e instanceof Error ? e.message : 'Falha ao enviar mensagem.')
    } finally {
      setSending(false)
    }
  }

  const detailPath = handle ? `/app/influencer/${encodeURIComponent(handle)}` : '/app'
  const profilePic = profile ? proxyImageUrl(getProfilePicUrl(profile)) : undefined
  const displayName = (profile?.full_name ?? profile?.username ?? handle ?? '').trim() || `@${handle}`

  if (authLoading || !user || !isAdm) {
    return (
      <div style={{ padding: s.lg, maxWidth: 640, margin: '0 auto', background: c.pageBg, minHeight: '100vh' }}>
        <Card loading={authLoading} style={{ borderRadius: r.lg }}>
          {!authLoading ? <Text type="secondary">Redirecionando…</Text> : null}
        </Card>
      </div>
    )
  }

  return (
    <div style={{ padding: s.lg, maxWidth: 640, margin: '0 auto', background: c.pageBg, minHeight: '100vh' }}>
      <Button
        type="text"
        icon={<ArrowLeftOutlined />}
        onClick={() => navigate(detailPath)}
        style={{ marginBottom: s.md }}
      >
        Voltar ao perfil
      </Button>

      <Card
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: s.sm }}>
            <ProfileAvatar src={profilePic} handle={handle} size={40} />
            <span>Enviar mensagem para {displayName}</span>
          </div>
        }
        loading={loadingProfile}
        style={{ borderRadius: r.lg, boxShadow: t.shadow.sm }}
      >
        <div style={{ marginBottom: s.sm }}>
          <Text type="secondary" style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
            <SmileOutlined /> Emojis
          </Text>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {EMOJI_LIST.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => insertEmoji(emoji)}
                style={{
                  width: 36,
                  height: 36,
                  fontSize: 20,
                  border: `1px solid ${c.border}`,
                  borderRadius: r.md,
                  background: c.cardBg,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                aria-label={`Inserir ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: s.md }}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={onFileChange}
            style={{ display: 'none' }}
          />
          <Space wrap size="small" style={{ marginBottom: attachedImage ? s.sm : 0 }}>
            <Button
              type="default"
              icon={<PictureOutlined />}
              onClick={() => fileInputRef.current?.click()}
              style={{ borderRadius: r.md }}
            >
              Anexar imagem
            </Button>
            {attachedImage && (
              <span style={{ fontSize: 12, color: c.textSecondary }}>
                {attachedImage.name} ({(attachedImage.size / 1024).toFixed(1)} KB)
              </span>
            )}
          </Space>
          {imagePreview && (
            <div style={{ position: 'relative', display: 'inline-block', marginTop: s.xs }}>
              <img
                src={imagePreview}
                alt="Preview"
                style={{ maxWidth: 200, maxHeight: 200, objectFit: 'contain', borderRadius: r.md, border: `1px solid ${c.border}` }}
              />
              <Button
                type="text"
                danger
                size="small"
                icon={<DeleteOutlined />}
                onClick={removeImage}
                style={{ position: 'absolute', top: 4, right: 4 }}
                aria-label="Remover imagem"
              />
            </div>
          )}
        </div>

        <TextArea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Digite sua mensagem para enviar pelo Direct do Instagram..."
          autoSize={{ minRows: 4, maxRows: 12 }}
          maxLength={1000}
          showCount
          style={{ marginBottom: s.md, borderRadius: r.md }}
        />

        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={handleSend}
          loading={sending}
          disabled={(!message.trim() && !attachedImage) || loadingProfile}
          style={{ borderRadius: r.md }}
        >
          Enviar mensagem
        </Button>
      </Card>
    </div>
  )
}
