import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRightOutlined,
  CheckOutlined,
  DollarOutlined,
  HeartOutlined,
  InstagramOutlined,
  AimOutlined,
  LineChartOutlined,
  RiseOutlined,
  RocketOutlined,
  SafetyOutlined,
  LoginOutlined,
  QuestionCircleOutlined,
  ReadOutlined,
  SearchOutlined,
  StarOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons'
import './InfluencerLanding.css'

const AVATARS = [
  'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=56&h=56&fit=crop',
  'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=56&h=56&fit=crop',
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=56&h=56&fit=crop',
]

const HERO_PHOTO =
  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=640&q=80'

const FEATURES = [
  {
    icon: <RiseOutlined />,
    title: 'Crescimento real',
    text: 'Entenda como sua audiência evolui e quais tendências o seu perfil está seguindo.',
  },
  {
    icon: <HeartOutlined />,
    title: 'Conteúdos que dão match',
    text: 'Saiba quais formatos e temas fazem seus seguidores comentarem e compartilharem mais.',
  },
  {
    icon: <DollarOutlined />,
    title: 'Valor sugerido para publis',
    text: 'Chega de dúvida na hora de cobrar! Receba uma estimativa de preço para parcerias com marcas.',
  },
  {
    icon: <TeamOutlined />,
    title: 'Quem te acompanha',
    text: 'Idade, cidade e interesses de quem te segue para criar posts ainda mais certeiros.',
  },
  {
    icon: <AimOutlined />,
    title: 'Taxa de engajamento',
    text: 'Interação real para mostrar o quanto seu público é fiel — sem métricas de vaidade.',
  },
  {
    icon: <UnorderedListOutlined />,
    title: 'Guia de melhorias',
    text: 'Checklist prático para deixar seu perfil irresistível para novos patrocinadores.',
  },
] as const

function normalizeHandle(value: string): string {
  return value.replace(/^@/, '').trim().toLowerCase()
}

type CtaFormProps = {
  id: string
  buttonLabel: string
  extraTrust?: string
  gradientButton?: boolean
}

function CtaForm({ id, buttonLabel, extraTrust, gradientButton }: CtaFormProps) {
  const navigate = useNavigate()
  const [handle, setHandle] = useState('')
  const [invalid, setInvalid] = useState(false)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const u = normalizeHandle(handle)
    if (!u) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    navigate(`/app/create?u=${encodeURIComponent(u)}`)
  }

  return (
    <div className="il-cta-card">
      <form className="il-cta-form" onSubmit={submit} aria-label="Gerar media kit do Instagram">
        <div className="il-cta-bar">
          <div className="il-cta-input-wrap">
            <InstagramOutlined className="il-ig" aria-hidden />
            <input
              id={id}
              type="text"
              value={handle}
              onChange={(e) => {
                setHandle(e.target.value)
                if (invalid) setInvalid(false)
              }}
              placeholder="Digite seu @ do Instagram"
              autoComplete="username"
              aria-label="Usuário do Instagram"
              aria-invalid={invalid || undefined}
              maxLength={100}
            />
          </div>
          <button
            type="submit"
            className={gradientButton ? 'il-btn-mk il-btn-mk--gradient' : 'il-btn-mk'}
          >
            <span className="il-btn-mk-text">{buttonLabel}</span>
            <span className="il-btn-mk-arrow" aria-hidden>
              <ArrowRightOutlined />
            </span>
          </button>
        </div>
      </form>
      <ul className="il-trust">
        <li>
          <CheckOutlined aria-hidden /> Sem senha
        </li>
        <li>
          <CheckOutlined aria-hidden /> Sem spam
        </li>
        <li>
          <CheckOutlined aria-hidden /> Sem cartão de crédito
        </li>
        {extraTrust ? (
          <li>
            <CheckOutlined aria-hidden /> {extraTrust}
          </li>
        ) : null}
      </ul>
    </div>
  )
}

export default function InfluencerLanding() {
  return (
    <div className="influencer-landing">
      <div className="il-blob-purple" aria-hidden />
      <div className="il-blob-primary" aria-hidden />

      <header className="il-header" role="banner">
        <Link to="/" className="il-header-logo" aria-label="Busca Influencer - Início">
          <img src="/images/logo.svg" alt="Busca Influencer" />
        </Link>
        <nav className="il-nav" aria-label="Menu principal">
          <a href="/blog/artigos.html">
            <ReadOutlined aria-hidden />
            Blog
          </a>
          <a href="#como-funciona">
            <QuestionCircleOutlined aria-hidden />
            Como funciona
          </a>
          <a href="#recursos">
            <StarOutlined aria-hidden />
            Recursos
          </a>
          <Link to="/home" className="il-nav-link--muted">
            <TeamOutlined aria-hidden />
            Para marcas
          </Link>
          <Link to="/influencer/login" className="il-btn-entrar">
            <LoginOutlined aria-hidden />
            Entrar
          </Link>
        </nav>
      </header>

      <main>
        <section className="il-hero" aria-labelledby="il-hero-title">
          <div className="il-hero-copy">
            <div className="il-badge">
              <div className="il-badge-avatars" aria-hidden>
                {AVATARS.map((src) => (
                  <img key={src} src={src} alt="" loading="lazy" decoding="async" />
                ))}
              </div>
              <span className="il-badge-text">
                <strong className="il-badge-num">+12.000</strong> influenciadores já analisados
              </span>
            </div>

            <h1 id="il-hero-title">
              <span className="il-hero-line">Descubra quanto seu Instagram</span>
              <span className="il-hero-line il-hero-line--accent">
                <span className="il-hero-accent-text">realmente vale</span>
                <svg className="il-hero-underline" viewBox="0 0 220 14" preserveAspectRatio="none" aria-hidden>
                  <path
                    d="M2 10 C40 4, 80 12, 120 6 S200 4, 218 8"
                    fill="none"
                    stroke="#a855f7"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
            </h1>
            <p className="il-hero-sub">
              Relatório profissional com métricas reais, valor sugerido
              <br />
              para publis e insights que marcas procuram.
            </p>

            <div className="il-pills">
              <div className="il-pill">
                <span className="il-pill-icon" aria-hidden>
                  <StarOutlined />
                </span>
                <div className="il-pill-text">
                  <strong>Gratuito</strong>
                  <span>100% sem custo</span>
                </div>
              </div>
              <div className="il-pill">
                <span className="il-pill-icon" aria-hidden>
                  <ThunderboltOutlined />
                </span>
                <div className="il-pill-text">
                  <strong>Rápido</strong>
                  <span>Pronto em 1 minuto</span>
                </div>
              </div>
              <div className="il-pill">
                <span className="il-pill-icon" aria-hidden>
                  <SafetyOutlined />
                </span>
                <div className="il-pill-text">
                  <strong>Seguro</strong>
                  <span>Seus dados protegidos</span>
                </div>
              </div>
            </div>

            <CtaForm id="nickname-hero" buttonLabel="Gerar mídia kit" gradientButton />
            <p className="il-hero-privacy">
              <SafetyOutlined aria-hidden /> Privacidade e segurança levadas a sério
            </p>
          </div>

          <div className="il-visual" aria-hidden>
            <div className="il-visual-glow" />
            <img className="il-visual-photo" src={HERO_PHOTO} alt="" width={320} height={320} loading="eager" />

            <div className="il-mock il-mock--score">
              <span className="il-mock-label">Score</span>
              <span className="il-mock-value">87</span>
              <span className="il-mock-sub" style={{ color: '#16a34a' }}>
                +1,8% · Acima da média
              </span>
            </div>
            <div className="il-mock il-mock--er">
              <span className="il-mock-label">Engajamento</span>
              <span className="il-mock-value">4,2%</span>
              <span className="il-mock-sub" style={{ color: 'var(--il-primary)' }}>
                Muito bom
              </span>
              <div className="il-mini-chart" />
            </div>
            <div className="il-mock il-mock--price">
              <span className="il-mock-label">Post estimado</span>
              <span className="il-mock-value">R$ 1.200</span>
              <span className="il-mock-sub" style={{ color: 'var(--il-text-muted)' }}>
                por publicação
              </span>
            </div>

            <div className="il-preview">
              <p className="il-preview-note">Relatório completo com mais de 40 insights</p>
              <div className="il-preview-grid">
                <div className="il-preview-widget">
                  <h4>Crescimento</h4>
                  <div className="il-preview-widget-inner il-preview-widget--growth">
                    <div className="il-line-chart" aria-hidden />
                    <div className="il-growth-stat">
                      <span className="il-growth-pct">↑ 28%</span>
                      <span className="il-growth-period">últimos 30 dias</span>
                    </div>
                  </div>
                </div>
                <div className="il-preview-widget">
                  <h4>Público principal</h4>
                  <div className="il-preview-widget-inner il-preview-widget--audience">
                    <div className="il-donut" aria-hidden />
                    <div className="il-audience-stat">
                      <p className="il-audience-main">
                        <strong>65%</strong> 18-24 anos
                      </p>
                      <span className="il-audience-sub">São Paulo, RJ, BH</span>
                    </div>
                  </div>
                </div>
              </div>
              <p className="il-cities">
                <strong>Top cidades:</strong> São Paulo • Rio de Janeiro • Belo Horizonte
              </p>
            </div>
          </div>
        </section>

        <section id="como-funciona" className="il-section-soft" aria-labelledby="il-steps-title">
          <div className="il-section-soft-inner">
            <h2 id="il-steps-title">Como funciona?</h2>
            <div className="il-steps">
              <article className="il-step">
                <span className="il-step-num">1</span>
                <div className="il-step-icon">
                  <SearchOutlined />
                </div>
                <h3>1. Informe seu @</h3>
                <p>Digite seu usuário do Instagram. Validamos a conta em segundos — sem senha nem formulário longo.</p>
              </article>
              <article className="il-step">
                <span className="il-step-num">2</span>
                <div className="il-step-icon">
                  <LineChartOutlined />
                </div>
                <h3>2. Análise inteligente</h3>
                <p>Nossa IA analisa métricas reais, engajamento, audiência e muito mais do seu perfil.</p>
              </article>
              <article className="il-step">
                <span className="il-step-num">3</span>
                <div className="il-step-icon">
                  <RocketOutlined />
                </div>
                <h3>3. Receba seu relatório</h3>
                <p>Receba seu media kit completo com preços sugeridos e insights prontos para enviar a marcas.</p>
              </article>
            </div>
          </div>
        </section>

        <section id="recursos" className="il-section il-section--features" aria-labelledby="il-features-title">
          <h2 id="il-features-title">
            O que você vai <span className="accent">descobrir</span> no relatório
          </h2>
          <div className="il-features">
            {FEATURES.map((f, i) => (
              <article key={f.title} className="il-feature">
                <div
                  className={`il-feature-icon il-feature-icon--${
                    i === 1 ? 'pink' : i === 2 ? 'gold' : 'purple'
                  }`}
                  aria-hidden
                >
                  {f.icon}
                </div>
                <div className="il-feature-body">
                  <h3>{f.title}</h3>
                  <p>{f.text}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="il-cta-final" aria-labelledby="il-cta-final-title">
          <span className="il-deco il-deco--1" aria-hidden>
            ✦
          </span>
          <span className="il-deco il-deco--2" aria-hidden>
            ✦
          </span>
          <span className="il-deco il-deco--heart" aria-hidden>
            ♥
          </span>
          <div className="il-cta-final-inner">
            <h2 id="il-cta-final-title">
              Pronto para descobrir <span className="accent">seu valor</span> como creator?
            </h2>
            <CtaForm id="nickname-final" buttonLabel="Gerar meu mídia kit grátis" extraTrust="Pronto em 1 minuto" />
          </div>
        </section>
      </main>

      <footer className="il-footer" role="contentinfo">
        <div className="il-footer-inner">
          <div className="il-footer-top">
            <Link to="/" aria-label="Busca Influencer">
              <img src="/images/logo.svg" alt="Busca Influencer" />
            </Link>
            <div className="il-footer-links">
              <a href="/documents/privacidade.html">Termos de Privacidade</a>
              <a href="/documents/termos.html">Política de Uso</a>
              <a href="mailto:contato@buscainfluencer.com.br">Contato</a>
            </div>
          </div>
          <div className="il-footer-bottom">
            <p className="il-footer-copy">© 2026 Relatório de Influencer. Todos os direitos reservados.</p>
            <a
              href="https://www.instagram.com/buscainfluencer"
              className="il-footer-ig"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Instagram Busca Influencer"
            >
              <InstagramOutlined />
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
