import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Spin, Alert, Button } from 'antd'
import { verifyEmailByToken } from '../api'

export default function VerifyEmail() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token') ?? ''
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState<string>('')
  const [credits, setCredits] = useState<number>(0)

  useEffect(() => {
    if (!token) {
      setStatus('error')
      setErrorMsg('Link inválido. Use o link que enviamos no seu e-mail.')
      return
    }
    let cancelled = false
    verifyEmailByToken(token)
      .then((data) => {
        if (cancelled) return
        setCredits(data.credits)
        setStatus('success')
        navigate(`/missions/reward?type=email&credits=${data.credits}`, { replace: true })
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
        <Alert type="error" message="Não foi possível validar" description={errorMsg} showIcon style={{ marginBottom: 16 }} />
        <Button type="primary" block onClick={() => navigate('/')}>Ir para o início</Button>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 400, margin: '60px auto', padding: 24, textAlign: 'center' }}>
      <Spin size="large" />
      <p style={{ marginTop: 16 }}>Redirecionando para sua recompensa...</p>
    </div>
  )
}
