import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  CheckCircleOutlined,
  SafetyOutlined,
  FileTextOutlined,
  SearchOutlined,
  RocketOutlined,
  LineChartOutlined,
  HeartOutlined,
  RiseOutlined,
  DollarOutlined,
  TeamOutlined,
  UnorderedListOutlined,
  StarFilled,
} from '@ant-design/icons'
import Logo from '../components/Logo'
import ThemeFooterButton from '../components/ThemeFooterButton'

const sectionMaxWidth = 1100

function normalizeHandle(value: string): string {
  return value.replace(/^@/, '').trim().toLowerCase()
}

export default function Landing() {
  const navigate = useNavigate()
  const [handle, setHandle] = useState('')
  const [finalHandle, setFinalHandle] = useState('')
  const [inputError, setInputError] = useState('')

  const goToValidate = (nickname: string) => {
    const n = normalizeHandle(nickname)
    setInputError('')
    if (n) {
      navigate('/app/create', { state: { nickname: n } })
    } else {
      navigate('/app/create')
    }
  }

  const handleSubmitFirst = () => {
    if (!normalizeHandle(handle)) setInputError('Digite seu @ do Instagram')
    else goToValidate(handle)
  }

  const handleSubmitFinal = () => {
    if (!normalizeHandle(finalHandle)) setInputError('Digite seu @ do Instagram')
    else goToValidate(finalHandle)
  }

  return (
    <div className="landing-vibrant" style={{ minHeight: '100vh', background: 'var(--lp-bg)', position: 'relative', overflow: 'hidden' }}>
      {/* Formas orgânicas de fundo (roxo suave) */}
      <div
        style={{
          position: 'fixed',
          top: -100,
          right: -80,
          width: 420,
          height: 420,
          borderRadius: '50%',
          background: 'var(--lp-purple)',
          opacity: 0.12,
          filter: 'blur(60px)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'fixed',
          bottom: -120,
          left: -100,
          width: 380,
          height: 380,
          borderRadius: '50%',
          background: 'var(--lp-primary)',
          opacity: 0.08,
          filter: 'blur(70px)',
          pointerEvents: 'none',
        }}
      />

      {/* Header */}
      <header
        className="landing-header"
        style={{
          height: 72,
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          maxWidth: 1200,
          margin: '0 auto',
          position: 'relative',
          zIndex: 10,
        }}
      >
        <Link to="/" className="landing-header-logo" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', color: 'var(--lp-text)' }}>
          <Logo height={40} alt="Busca Influencer" />
        </Link>
        <nav className="landing-header-nav" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Link
            to="/login"
            style={{
              color: 'var(--lp-text)',
              fontSize: 15,
              fontWeight: 500,
              textDecoration: 'none',
            }}
          >
            Entrar
          </Link>
          <Link
            to="/app/create"
            style={{
              background: 'var(--lp-primary)',
              color: '#fff',
              padding: '10px 20px',
              borderRadius: 12,
              fontWeight: 600,
              fontSize: 15,
              textDecoration: 'none',
              fontFamily: 'Montserrat, sans-serif',
            }}
          >
            Criar
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section
        id="hero"
        style={{
          maxWidth: sectionMaxWidth,
          margin: '0 auto',
          padding: '56px 24px 80px',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 56,
          alignItems: 'center',
          position: 'relative',
          zIndex: 1,
        }}
        className="landing-hero-grid"
      >
        <div>
          <h1
            style={{
              fontSize: 'clamp(28px, 3.2vw, 40px)',
              fontWeight: 700,
              color: 'var(--lp-text)',
              lineHeight: 1.25,
              margin: '0 0 20px',
              letterSpacing: '-0.02em',
              fontFamily: 'Montserrat, sans-serif',
            }}
          >
            Quer descobrir seu potencial como influencer?
          </h1>
          <p
            style={{
              fontSize: 17,
              color: 'var(--lp-text)',
              lineHeight: 1.65,
              margin: '0 0 16px',
              fontWeight: 400,
              fontFamily: 'Montserrat, sans-serif',
            }}
          >
            Às vezes, o que falta para você decolar é entender o que os números dizem. <strong>Em 1 minuto, a gente te mostra seus pontos fortes</strong> e o que as marcas estão buscando no seu perfil.
          </p>
          <h2
            style={{
              fontSize: 'clamp(20px, 2.2vw, 26px)',
              fontWeight: 600,
              color: 'var(--lp-hero-text)',
              margin: '0 0 20px',
              fontFamily: 'Montserrat, sans-serif',
            }}
          >
            Gratuito e feito para te ajudar!
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <StarFilled style={{ color: '#e8ba00', fontSize: 18 }} />
              <span style={{ fontSize: 15, color: 'var(--lp-text)', fontFamily: 'Montserrat, sans-serif' }}>
                <strong>100% seguro, não pedimos sua senha no processo</strong>
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <StarFilled style={{ color: '#e8ba00', fontSize: 18 }} />
              <span style={{ fontSize: 15, color: 'var(--lp-text)', fontFamily: 'Montserrat, sans-serif' }}>
                <strong>Relatório fácil de ler e cheio de insights</strong>
              </span>
            </div>
          </div>
        </div>

        <div
          style={{ position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
          className="landing-hero-image-container"
        >
          <div
            className="landing-hero-image-box"
            style={{
              width: 'min(100%, 420px)',
              overflow: 'hidden',
              borderRadius: 12,
            }}
          >
            <img
              src="/images/influencer.png"
              alt="Influenciadora sorrindo com óculos rosa"
              style={{ width: '100%', height: 'auto', display: 'block', verticalAlign: 'middle' }}
            />
          </div>
        </div>
      </section>

      {/* Validação e Segurança (Card Central) */}
      <section
        id="cta-inicial"
        style={{
          maxWidth: 640,
          margin: '0 auto',
          padding: '0 24px 72px',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <div
          style={{
            background: 'var(--app-chart-bar-top)',
            border: '1px solid var(--lp-border)',
            borderRadius: 20,
            padding: '32px 28px',
            boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
          }}
        >
          <div style={{ marginBottom: 20, position: 'relative' }}>
            <span
              style={{
                position: 'absolute',
                left: 16,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--lp-text)',
                opacity: 0.6,
                fontSize: 18,
                fontWeight: 500,
                zIndex: 1,
              }}
            >
              @
            </span>
            <input
              type="text"
              placeholder="seuusuario"
              value={handle}
              onChange={(e) => {
                setHandle(e.target.value.replace(/^@/, '').trim())
                setInputError('')
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmitFirst()}
              aria-label="Usuário do Instagram"
              style={{
                width: '100%',
                height: 52,
                padding: '0 16px 0 36px',
                border: '1px solid var(--lp-border)',
                borderRadius: 12,
                fontSize: 16,
                outline: 'none',
                boxSizing: 'border-box',
                fontFamily: 'Montserrat, sans-serif',
              }}
              onFocus={(e) => {
                e.target.style.borderColor = 'var(--lp-primary)'
                e.target.style.boxShadow = '0 0 0 2px rgba(92, 103, 242, 0.2)'
              }}
              onBlur={(e) => {
                e.target.style.borderColor = 'var(--lp-border)'
                e.target.style.boxShadow = 'none'
              }}
            />
          </div>
          <button
            type="button"
            onClick={handleSubmitFirst}
            style={{
              width: '100%',
              height: 52,
              background: 'var(--lp-primary)',
              color: '#fff',
              border: 'none',
              borderRadius: 12,
              fontWeight: 700,
              fontSize: 15,
              cursor: 'pointer',
              fontFamily: 'Montserrat, sans-serif',
            }}
          >
            Analisar perfil grátis
          </button>

          <ul style={{ listStyle: 'none', padding: 0, margin: '24px 0 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { icon: <CheckCircleOutlined style={{ color: 'var(--brand-white)' }} />, text: 'Gratuito e feito para te ajudar!' },
              { icon: <SafetyOutlined style={{ color: 'var(--brand-white)' }} />, text: 'Entre na vitrine e seja encontrado por empresas parceiras que buscam influenciadores' },
              { icon: <FileTextOutlined style={{ color: 'var(--brand-white)' }} />, text: 'Relatório cheio de insights + Media Kit em PDF para enviar a marcas' },
            ].map((item, i) => (
              <li
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  color: 'var(--brand-white)',
                  fontSize: 14,
                  fontWeight: 500,
                }}
              >
                {item.icon}
                {item.text}
              </li>
            ))}
          </ul>
        </div>

        {inputError ? (
          <p style={{ textAlign: 'center', fontSize: 14, color: '#dc2626', marginTop: 12 }}>{inputError}</p>
        ) : null}

        <p
          style={{
            textAlign: 'center',
            fontSize: 15,
            color: 'var(--lp-text)',
            opacity: 0.85,
            marginTop: 20,
            lineHeight: 1.55,
            maxWidth: 520,
            marginLeft: 'auto',
            marginRight: 'auto',
          }}
        >
          Cadastre-se grátis e entre na vitrine. Nossas empresas parceiras buscam influenciadores para campanhas e parcerias — seu perfil pode ser o próximo a ser contratado.
        </p>
        <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--lp-text)', opacity: 0.65, marginTop: 12 }}>
          Processo rápido e seguro.
        </p>
      </section>

      {/* Como Funciona? */}
      <section
        id="como-funciona"
        style={{
          maxWidth: sectionMaxWidth,
          margin: '0 auto',
          padding: '56px 24px 72px',
          position: 'relative',
          borderRadius: 16,
          zIndex: 1,
          background: 'var(--lp-bg-soft)',
        }}
      >
        <h2
          style={{
            fontSize: 28,
            fontWeight: 700,
            color: 'var(--lp-text)',
            marginBottom: 40,
            textAlign: 'center',
            fontFamily: 'Montserrat, sans-serif',
          }}
        >
          Como funciona?
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }} className="landing-steps-grid">
          {[
            {
              icon: <SearchOutlined style={{ fontSize: 28, color: 'var(--lp-primary)' }} />,
              title: 'Informe seu @',
              text: 'Basta colocar seu usuário do Instagram. Sem formulários longos ou complicações.',
            },
            {
              icon: <FileTextOutlined style={{ fontSize: 28, color: 'var(--lp-accent)' }} />,
              title: 'Media Kit',
              text: 'Gere um Media Kit profissional em PDF com seus dados, métricas e melhores posts. Pronto para enviar a marcas e oportunidades.',
            },
            {
              icon: <RocketOutlined style={{ fontSize: 28, color: 'var(--lp-purple)' }} />,
              title: 'Receba Insights',
              text: 'Seu relatório completo e painel online ficam prontos em segundos. Além disso, você gera um Media Kit profissional em PDF para enviar a marcas e oportunidades.',
            },
          ].map((item, i) => (
            <div
              key={i}
              style={{
                background: 'var(--lp-bg)',
                border: '1px solid var(--lp-border)',
                borderRadius: 16,
                padding: 28,
                textAlign: 'center',
                boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 14,
                  background: 'var(--lp-bg-soft)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 16px',
                }}
              >
                {item.icon}
              </div>
              <h3
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: 'var(--lp-text)',
                  margin: '0 0 10px',
                  fontFamily: 'Montserrat, sans-serif',
                }}
              >
                {item.title}
              </h3>
              <p style={{ fontSize: 15, color: 'var(--lp-text)', opacity: 0.85, lineHeight: 1.55, margin: 0 }}>
                {item.text}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* O que você vai descobrir */}
      <section
        id="o-que-vem"
        style={{
          maxWidth: sectionMaxWidth,
          margin: '0 auto',
          padding: '56px 24px 72px',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <h2
          style={{
            fontSize: 28,
            fontWeight: 700,
            color: 'var(--lp-text)',
            marginBottom: 40,
            textAlign: 'center',
            fontFamily: 'Montserrat, sans-serif',
          }}
        >
          O que você vai descobrir no relatório
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 20 }} className="landing-report-grid">
          {[
            {
              icon: <LineChartOutlined style={{ fontSize: 22, color: 'var(--lp-primary)' }} />,
              title: 'Crescimento real',
              desc: 'Entenda como sua audiência está evoluindo e quais tendências o seu perfil está seguindo.',
            },
            {
              icon: <HeartOutlined style={{ fontSize: 22, color: 'var(--lp-accent)' }} />,
              title: 'Conteúdos que dão match',
              desc: 'Saiba exatamente quais formatos e temas fazem seus seguidores comentarem e compartilharem mais.',
            },
            {
              icon: <RiseOutlined style={{ fontSize: 22, color: 'var(--lp-purple)' }} />,
              title: 'Taxa de engajamento',
              desc: 'Nada de métricas de vaidade! Calculamos sua interação real para mostrar o quanto seu público é fiel.',
            },
            {
              icon: <DollarOutlined style={{ fontSize: 22, color: 'var(--lp-primary)' }} />,
              title: 'Valor sugerido para Publis',
              desc: 'Chega de dúvida na hora de cobrar! Receba uma estimativa de preço para suas parcerias com marcas.',
            },
            {
              icon: <TeamOutlined style={{ fontSize: 22, color: 'var(--lp-accent)' }} />,
              title: 'Quem te acompanha',
              desc: 'Descubra a idade, cidade e os principais interesses de quem te segue para criar posts ainda mais certeiros.',
            },
            {
              icon: <UnorderedListOutlined style={{ fontSize: 22, color: 'var(--lp-purple)' }} />,
              title: 'Guia de melhorias',
              desc: 'Um checklist prático com pontos que você pode ajustar para deixar seu perfil irresistível para novos patrocinadores.',
            },
          ].map((item, i) => (
            <div
              key={i}
              style={{
                background: 'var(--lp-bg)',
                border: '1px solid var(--lp-border)',
                borderRadius: 16,
                padding: 24,
                display: 'flex',
                gap: 16,
                alignItems: 'flex-start',
                boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  background: 'var(--lp-bg-soft)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {item.icon}
              </div>
              <div>
                <h3
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    color: 'var(--lp-text)',
                    margin: '0 0 6px',
                    fontFamily: 'Montserrat, sans-serif',
                  }}
                >
                  {item.title}
                </h3>
                <p style={{ fontSize: 14, color: 'var(--lp-text)', opacity: 0.85, lineHeight: 1.55, margin: 0 }}>
                  {item.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA final (segundo input) */}
      <section
        style={{
          margin: '0 auto',
          padding: '48px 24px 64px',
          position: 'relative',
          zIndex: 1,
          background: 'var(--lp-bg-soft)',
        }}
      >
        <div style={{
          maxWidth: 560,
          margin: '0 auto',
        }}>
          <h2
            style={{
              fontSize: 26,
              fontWeight: 700,
              color: 'var(--lp-text)',
              marginBottom: 28,
              textAlign: 'center',
              fontFamily: 'Montserrat, sans-serif',
            }}
          >
            Quer seu relatório agora?
          </h2>
          <div
            style={{
              background: 'var(--lp-bg)',
              border: '1px solid var(--lp-border)',
              borderRadius: 20,
              padding: 28,
              boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
            }}
          >
            <div style={{ marginBottom: 16, position: 'relative' }}>
              <span
                style={{
                  position: 'absolute',
                  left: 16,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--lp-text)',
                  opacity: 0.6,
                  fontSize: 18,
                  zIndex: 1,
                }}
              >
                @
              </span>
              <input
                type="text"
                placeholder="seuusuario"
                value={finalHandle}
                onChange={(e) => {
                  setFinalHandle(e.target.value.replace(/^@/, '').trim())
                  setInputError('')
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmitFinal()}
                aria-label="Usuário do Instagram"
                style={{
                  width: '100%',
                  height: 52,
                  padding: '0 16px 0 36px',
                  border: '1px solid var(--lp-border)',
                  borderRadius: 12,
                  fontSize: 16,
                  outline: 'none',
                  boxSizing: 'border-box',
                  fontFamily: 'Montserrat, sans-serif',
                }}
              />
            </div>
            <button
              type="button"
              onClick={handleSubmitFinal}
              style={{
                width: '100%',
                height: 52,
                background: 'var(--lp-primary)',
                color: '#fff',
                border: 'none',
                borderRadius: 12,
                fontWeight: 700,
                fontSize: 15,
                cursor: 'pointer',
                fontFamily: 'Montserrat, sans-serif',
              }}
            >
              Analisar perfil
            </button>
          </div>
          {inputError ? (
            <p style={{ textAlign: 'center', fontSize: 14, color: '#dc2626', marginTop: 12 }}>{inputError}</p>
          ) : null}
          <p style={{ textAlign: 'center', fontSize: 14, color: 'var(--lp-text)', opacity: 0.7, marginTop: 16 }}>
            Sem spam. Sem custo. Só insights.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer
        style={{
          borderTop: '1px solid var(--lp-border)',
          padding: '28px 24px 32px',
          margin: '0 auto',
          position: 'relative',
          zIndex: 1,
          background: 'var(--lp-bg)',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 28, marginBottom: 20 }}>
          <a
            href="#termos"
            style={{ fontSize: 14, color: 'var(--lp-text)', opacity: 0.8, textDecoration: 'none', fontWeight: 500 }}
          >
            Termos
          </a>
          <a
            href="#privacidade"
            style={{ fontSize: 14, color: 'var(--lp-text)', opacity: 0.8, textDecoration: 'none', fontWeight: 500 }}
          >
            Privacidade
          </a>
          <a
            href="#contato"
            style={{ fontSize: 14, color: 'var(--lp-text)', opacity: 0.8, textDecoration: 'none', fontWeight: 500 }}
          >
            Contato
          </a>
        </div>
        <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--lp-text)', opacity: 0.65, margin: 0 }}>
          © 2026 Relatório de Influencer. Todos os direitos reservados.
        </p>
      </footer>

      <style>{`
        .landing-hero-grid { }
        @media (max-width: 768px) {
          .landing-header {
            flex-direction: column;
            justify-content: center;
            align-items: center;
            height: auto;
            padding: 16px 24px;
            gap: 14px;
          }
          .landing-header-logo { justify-content: center; }
          .landing-header-nav { justify-content: center; }
        }
        @media (max-width: 900px) {
          .landing-hero-grid { grid-template-columns: 1fr !important; text-align: center; }
          .landing-hero-grid .landing-cta-main { margin: 0 auto; }
          .landing-hero-image-container { margin-top: 24px; }
          .landing-hero-image-box { width: 100% !important; max-width: none !important; }
          .landing-steps-grid { grid-template-columns: 1fr !important; }
          .landing-report-grid { grid-template-columns: 1fr !important; }
        }
        .landing-cta-main:hover { filter: brightness(1.05); opacity: 0.95; }
        .landing-cta-main:focus-visible { outline: 2px solid var(--lp-primary); outline-offset: 2px; }
      `}</style>
      <ThemeFooterButton />
    </div>
  )
}
