import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Spin, Alert, Button } from 'antd'
import { verifyEmailByToken } from '../api'
import { trackEmailVerified } from '../utils/metaPixelFunnel'

export default function VerifyEmail() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token') ?? ''
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState<string>('')
  useEffect(() => {
    if (!token) {
      setStatus('error')
      setErrorMsg('Link inválido. Use o link que enviamos no seu e-mail.')
      return
    }
    let cancelled = false
    verifyEmailByToken(token)
      .then(() => {
        if (cancelled) return
        trackEmailVerified()
        setStatus('success')
        navigate('/missions/reward?type=email', { replace: true })
      })
      .catch((e) => {
        if (cancelled) return
        setStatus('error')
        setErrorMsg(e instanceof Error ? e.message : 'Falha ao validar')
      })
    return () => { cancelled = true }
  }, [token, navigate])

  if (status === 'loading') {
    return (
      <div style={{ maxWidth: 400, margin: '60px auto', padding: 24, textAlign: 'center' }}>
        <Spin size="large" />
        <p style={{ marginTop: 16 }}>Validando seu e-mail...</p>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div style={{ maxWidth: 400, margin: '60px auto', padding: 24 }}>
        <Alert type="error" message="Não foi possível validar" description={<><div>{errorMsg}</div><div style={{ marginTop: 8, fontSize: 13, color: 'var(--app-text-secondary)' }}>Se não recebeu o e-mail, verifique a pasta de spam. Dentro do app você pode usar &quot;Reenviar link&quot; na barra de recompensas.</div></>} showIcon style={{ marginBottom: 16 }} />
        <Button type="primary" block onClick={() => window.location.href = '/'}>Ir para o início</Button>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 400, margin: '60px auto', padding: 24, textAlign: 'center' }}>
      <Spin size="large" />
      <p style={{ marginTop: 16 }}>Redirecionando...</p>
    </div>
  )
}
