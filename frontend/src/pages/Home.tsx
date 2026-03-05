import { Link } from 'react-router-dom'
import {
  SearchOutlined,
  FilterOutlined,
  BarChartOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons'
import Logo from '../components/Logo'
import ThemeFooterButton from '../components/ThemeFooterButton'

const sectionMaxWidth = 1000

export default function Home() {
  return (
    <div
      className="landing-vibrant home-b2b"
      style={{
        minHeight: '100vh',
        background: 'var(--lp-bg)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Fundo: faixas diagonais sutis (diferente da landing influencer) */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: '70vh',
          background: `linear-gradient(165deg, var(--lp-bg-soft) 0%, var(--lp-bg) 50%, transparent 100%)`,
          pointerEvents: 'none',
          zIndex: 0,
        }}
        aria-hidden
      />
      <div
        style={{
          position: 'fixed',
          top: -80,
          right: -80,
          width: 320,
          height: 320,
          borderRadius: '50%',
          background: 'var(--lp-primary)',
          opacity: 0.06,
          filter: 'blur(80px)',
          pointerEvents: 'none',
        }}
        aria-hidden
      />
      <div
        style={{
          position: 'fixed',
          bottom: -60,
          left: -60,
          width: 280,
          height: 280,
          borderRadius: '50%',
          background: 'var(--lp-accent)',
          opacity: 0.08,
          filter: 'blur(60px)',
          pointerEvents: 'none',
        }}
        aria-hidden
      />

      {/* Header minimalista B2B */}
      <header
        className="landing-header home-header"
        style={{
          padding: '20px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          maxWidth: 1200,
          margin: '0 auto',
          position: 'relative',
          zIndex: 10,
          borderBottom: '1px solid var(--lp-border)',
          background: 'var(--lp-bg)',
        }}
        role="banner"
      >
        <Link
          to="/"
          className="landing-header-logo"
          style={{
            display: 'flex',
            alignItems: 'center',
            textDecoration: 'none',
            color: 'var(--lp-text)',
          }}
          aria-label="Busca Influencer - Início"
        >
          <Logo height={36} alt="Busca Influencer" />
        </Link>
        <nav
          className="landing-header-nav"
          style={{ display: 'flex', alignItems: 'center', gap: 24 }}
          aria-label="Menu principal"
        >
          <Link
            to="/app"
            style={{
              color: 'var(--lp-text)',
              fontSize: 14,
              fontWeight: 500,
              textDecoration: 'none',
              opacity: 0.9,
            }}
          >
            Ver vitrine
          </Link>
          <Link
            to="/login"
            style={{
              color: 'var(--lp-text)',
              fontSize: 14,
              fontWeight: 500,
              textDecoration: 'none',
            }}
          >
            Entrar
          </Link>
          <Link
            to="/login"
            style={{
              background: 'var(--lp-primary)',
              color: '#fff',
              padding: '10px 20px',
              borderRadius: 10,
              fontWeight: 600,
              fontSize: 14,
              textDecoration: 'none',
              fontFamily: 'Montserrat, sans-serif',
            }}
          >
            Acessar plataforma
          </Link>
        </nav>
      </header>

      <main>
        {/* Hero B2B: foco em marcas e agências */}
        <section
          id="hero"
          style={{
            maxWidth: 800,
            margin: '0 auto',
            padding: '80px 24px 100px',
            textAlign: 'center',
            position: 'relative',
            zIndex: 1,
          }}
          aria-labelledby="hero-title"
        >
          <p
            style={{
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--lp-primary)',
              marginBottom: 16,
              fontFamily: 'Montserrat, sans-serif',
            }}
          >
            Para marcas e agências
          </p>
          <h1
            id="hero-title"
            style={{
              fontSize: 'clamp(32px, 4.5vw, 48px)',
              fontWeight: 700,
              color: 'var(--lp-text)',
              lineHeight: 1.2,
              margin: '0 0 24px',
              letterSpacing: '-0.03em',
              fontFamily: 'Montserrat, sans-serif',
            }}
          >
            Ache os criadores certos pra sua campanha
          </h1>
          <p
            style={{
              fontSize: 18,
              color: 'var(--lp-text)',
              opacity: 0.85,
              lineHeight: 1.65,
              margin: '0 auto 40px',
              maxWidth: 560,
            }}
          >
            Vitrine de criadores verificados, métricas reais e filtros por nicho e engajamento. Menos tempo caçando, mais parceria.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'center' }}>
            <Link
              to="/app"
              style={{
                display: 'inline-block',
                background: 'var(--lp-primary)',
                color: '#fff',
                padding: '16px 32px',
                borderRadius: 10,
                fontWeight: 600,
                fontSize: 15,
                textDecoration: 'none',
                fontFamily: 'Montserrat, sans-serif',
                boxShadow: '0 4px 20px rgba(104, 39, 143, 0.3)',
              }}
            >
              Ver vitrine
            </Link>
            <Link
              to="/login"
              style={{
                display: 'inline-block',
                background: 'transparent',
                color: 'var(--lp-text)',
                padding: '16px 32px',
                borderRadius: 10,
                fontWeight: 600,
                fontSize: 15,
                textDecoration: 'none',
                border: '2px solid var(--lp-border)',
                fontFamily: 'Montserrat, sans-serif',
              }}
            >
              Entrar
            </Link>
          </div>
        </section>

        {/* O que a plataforma oferece para marcas/agências */}
        <section
          id="para-voce"
          style={{
            padding: '64px 24px 80px',
            background: 'var(--lp-bg)',
            position: 'relative',
            zIndex: 1,
          }}
          aria-labelledby="para-voce-title"
        >
          <h2
            id="para-voce-title"
            style={{
              fontSize: 26,
              fontWeight: 700,
              color: 'var(--lp-text)',
              marginBottom: 48,
              textAlign: 'center',
              fontFamily: 'Montserrat, sans-serif',
            }}
          >
            Feito pra quem quer fechar parceria com critério
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 24,
              maxWidth: sectionMaxWidth,
              margin: '0 auto',
            }}
            className="home-benefits-grid"
          >
            {[
              {
                icon: <SearchOutlined style={{ fontSize: 24, color: 'var(--lp-primary)' }} />,
                title: 'Vitrine curada',
                text: 'Criadores verificados, métricas reais. Sem fake.',
              },
              {
                icon: <FilterOutlined style={{ fontSize: 24, color: 'var(--lp-primary)' }} />,
                title: 'Filtros que importam',
                text: 'Nicho, alcance, engajamento e valor. Acha quem encaixa no briefing.',
              },
              {
                icon: <BarChartOutlined style={{ fontSize: 24, color: 'var(--lp-primary)' }} />,
                title: 'Dados transparentes',
                text: 'Relatórios e Media Kits na mão. Decisão em número, não no achismo.',
              },
              {
                icon: <ThunderboltOutlined style={{ fontSize: 24, color: 'var(--lp-primary)' }} />,
                title: 'Menos tempo perdido',
                text: 'Tudo num lugar. Ideal pra agência com várias campanhas.',
              },
            ].map((item, i) => (
              <div
                key={i}
                style={{
                  background: 'var(--lp-bg-soft)',
                  border: '1px solid var(--lp-border)',
                  borderRadius: 12,
                  padding: 24,
                  textAlign: 'center',
                }}
              >
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 10,
                    background: 'var(--lp-bg)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 16px',
                    border: '1px solid var(--lp-border)',
                  }}
                >
                  {item.icon}
                </div>
                <h3
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    color: 'var(--lp-text)',
                    margin: '0 0 8px',
                    fontFamily: 'Montserrat, sans-serif',
                  }}
                >
                  {item.title}
                </h3>
                <p style={{ fontSize: 14, color: 'var(--lp-text)', opacity: 0.85, lineHeight: 1.5, margin: 0 }}>
                  {item.text}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Como funciona (para marcas/agências) */}
        <section
          id="como-funciona"
          style={{
            padding: '64px 24px 80px',
            background: 'var(--lp-bg-soft)',
            position: 'relative',
            zIndex: 1,
          }}
          aria-labelledby="como-funciona-title"
        >
          <h2
            id="como-funciona-title"
            style={{
              fontSize: 26,
              fontWeight: 700,
              color: 'var(--lp-text)',
              marginBottom: 48,
              textAlign: 'center',
              fontFamily: 'Montserrat, sans-serif',
            }}
          >
            Como funciona pra sua marca ou agência
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 32,
              maxWidth: sectionMaxWidth,
              margin: '0 auto',
            }}
            className="home-steps-grid"
          >
            {[
              { step: '1', title: 'Acesse a vitrine', desc: 'Entra e vê criadores verificados com métricas atualizadas.' },
              { step: '2', title: 'Filtre e compare', desc: 'Usa nicho, alcance, engajamento e valor pra achar o fit da campanha.' },
              { step: '3', title: 'Feche a parceria', desc: 'Vê Media Kit e relatório, entra em contato e fecha com transparência.' },
            ].map((item) => (
              <div
                key={item.step}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  textAlign: 'center',
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: '50%',
                    background: 'var(--lp-primary)',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: 18,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 16,
                  }}
                >
                  {item.step}
                </div>
                <h3
                  style={{
                    fontSize: 17,
                    fontWeight: 700,
                    color: 'var(--lp-text)',
                    margin: '0 0 8px',
                    fontFamily: 'Montserrat, sans-serif',
                  }}
                >
                  {item.title}
                </h3>
                <p style={{ fontSize: 14, color: 'var(--lp-text)', opacity: 0.85, lineHeight: 1.55, margin: 0 }}>
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Diferenciais em lista */}
        <section
          id="diferenciais"
          style={{
            padding: '64px 24px 80px',
            background: 'var(--lp-bg)',
            position: 'relative',
            zIndex: 1,
          }}
          aria-labelledby="diferenciais-title"
        >
          <div style={{ maxWidth: 640, margin: '0 auto' }}>
            <h2
              id="diferenciais-title"
              style={{
                fontSize: 26,
                fontWeight: 700,
                color: 'var(--lp-text)',
                marginBottom: 32,
                textAlign: 'center',
                fontFamily: 'Montserrat, sans-serif',
              }}
            >
              Por que marcas e agências usam o Busca Influencer
            </h2>
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
              }}
            >
              {[
                'Métricas reais. Sem seguidor ou engajamento inflado.',
                'Vitrine com criadores já analisados e com Media Kit.',
                'Filtros por nicho, alcance e valor pra orçamento.',
                'Processo seguro e transparente pros dois lados.',
                'Suporte pra gestão de campanhas e vários criadores.',
              ].map((text, i) => (
                <li
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    fontSize: 15,
                    color: 'var(--lp-text)',
                    lineHeight: 1.5,
                  }}
                >
                  <CheckCircleOutlined style={{ color: 'var(--lp-primary)', fontSize: 20, flexShrink: 0 }} />
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* CTA final */}
        <section
          style={{
            padding: '72px 24px 80px',
            background: 'var(--lp-bg-soft)',
            position: 'relative',
            zIndex: 1,
            borderTop: '1px solid var(--lp-border)',
          }}
        >
          <div
            style={{
              maxWidth: 560,
              margin: '0 auto',
              textAlign: 'center',
              padding: '48px 32px',
              background: 'var(--lp-bg)',
              borderRadius: 16,
              border: '1px solid var(--lp-border)',
              boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
            }}
          >
            <TeamOutlined
              style={{
                fontSize: 40,
                color: 'var(--lp-primary)',
                marginBottom: 20,
                display: 'block',
              }}
            />
            <h2
              style={{
                fontSize: 24,
                fontWeight: 700,
                color: 'var(--lp-text)',
                marginBottom: 12,
                fontFamily: 'Montserrat, sans-serif',
              }}
            >
              Pronto pra achar seus criadores?
            </h2>
            <p
              style={{
                fontSize: 15,
                color: 'var(--lp-text)',
                opacity: 0.85,
                lineHeight: 1.55,
                marginBottom: 28,
              }}
            >
              Entra na vitrine ou fala com a gente pra ver planos.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
              <Link
                to="/app"
                style={{
                  display: 'inline-block',
                  background: 'var(--lp-primary)',
                  color: '#fff',
                  padding: '14px 28px',
                  borderRadius: 10,
                  fontWeight: 600,
                  fontSize: 15,
                  textDecoration: 'none',
                  fontFamily: 'Montserrat, sans-serif',
                }}
              >
                Ver vitrine
              </Link>
              <Link
                to="/login"
                style={{
                  display: 'inline-block',
                  background: 'transparent',
                  color: 'var(--lp-text)',
                  padding: '14px 28px',
                  borderRadius: 10,
                  fontWeight: 600,
                  fontSize: 15,
                  textDecoration: 'none',
                  border: '2px solid var(--lp-border)',
                  fontFamily: 'Montserrat, sans-serif',
                }}
              >
                Entrar
              </Link>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer
          style={{
            borderTop: '1px solid var(--lp-border)',
            padding: '32px 24px 40px',
            margin: '0 auto',
            position: 'relative',
            zIndex: 1,
            background: 'var(--lp-bg)',
          }}
          role="contentinfo"
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: 32,
              marginBottom: 20,
            }}
          >
            <Link
              to="/#termos"
              style={{
                fontSize: 13,
                color: 'var(--lp-text)',
                opacity: 0.75,
                textDecoration: 'none',
                fontWeight: 500,
              }}
            >
              Termos
            </Link>
            <Link
              to="/#privacidade"
              style={{
                fontSize: 13,
                color: 'var(--lp-text)',
                opacity: 0.75,
                textDecoration: 'none',
                fontWeight: 500,
              }}
            >
              Privacidade
            </Link>
            <Link
              to="/#contato"
              style={{
                fontSize: 13,
                color: 'var(--lp-text)',
                opacity: 0.75,
                textDecoration: 'none',
                fontWeight: 500,
              }}
            >
              Contato
            </Link>
          </div>
          <p
            style={{
              textAlign: 'center',
              fontSize: 12,
              color: 'var(--lp-text)',
              opacity: 0.6,
              margin: 0,
            }}
          >
            © {new Date().getFullYear()} Busca Influencer. Pra marcas e agências acharem criadores.
          </p>
        </footer>
      </main>

      <style>{`
        .home-b2b .home-header { }
        @media (max-width: 768px) {
          .landing-header.home-header {
            flex-direction: column;
            gap: 16px;
            padding: 16px 24px;
          }
          .landing-header-logo { justify-content: center; }
          .landing-header-nav { justify-content: center; flex-wrap: wrap; }
        }
        @media (max-width: 900px) {
          .home-benefits-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .home-steps-grid { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 600px) {
          .home-benefits-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
      <ThemeFooterButton />
    </div>
  )
}
