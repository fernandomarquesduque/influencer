import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Dropdown } from 'antd'
import type { MenuProps } from 'antd'
import {
  CheckCircleOutlined,
  FileTextOutlined,
  SafetyOutlined,
  SearchOutlined,
  MessageOutlined,
  DownloadOutlined,
  LineChartOutlined,
  TeamOutlined,
  RiseOutlined,
  BulbOutlined,
  DollarOutlined,
  UnorderedListOutlined,
  BgColorsOutlined,
  CaretDownFilled,
} from '@ant-design/icons'
import { useTheme, THEME_OPTIONS, type ThemeMode } from '../contexts/ThemeContext'

/* Paleta central (index.css): --brand-primary, --brand-accent, --app-* */
const colors = {
  primary: 'var(--app-primary)',
  accent: 'var(--app-accent)',
  text: 'var(--app-text)',
  textSecondary: 'var(--app-text-secondary)',
  textMuted: 'var(--app-text-tertiary)',
  border: 'var(--app-border)',
  success: 'var(--app-success)',
  white: 'var(--brand-white)',
}

const cardStyle: React.CSSProperties = {
  background: 'var(--app-card-bg)',
  border: '1px solid var(--app-border)',
  borderRadius: 20,
  boxShadow: 'var(--app-card-shadow)',
}

const sectionMaxWidth = 1100

function normalizeHandle(value: string): string {
  return value.replace(/^@/, '').trim().toLowerCase()
}

export default function Landing() {
  const navigate = useNavigate()
  const { theme, setTheme } = useTheme()
  const currentThemeLabel = THEME_OPTIONS.find((o: { value: ThemeMode; label: string }) => o.value === theme)?.label ?? 'Tema'
  const [handle, setHandle] = useState('')
  const [finalHandle, setFinalHandle] = useState('')
  const [inputError, setInputError] = useState('')

  /** Leva o usuário para o fluxo de validação com o @ preenchido (se houver). */
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
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--app-bg)',
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Blobs de fundo */}
      <div
        style={{
          position: 'fixed',
          top: -120,
          right: -120,
          width: 400,
          height: 400,
          borderRadius: '50%',
          background: 'var(--app-bg-blob1)',
          filter: 'blur(80px)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'fixed',
          bottom: -100,
          left: -100,
          width: 350,
          height: 350,
          borderRadius: '50%',
          background: 'var(--app-bg-blob2)',
          filter: 'blur(80px)',
          pointerEvents: 'none',
        }}
      />

      {/* 1) Topbar */}
      <header
        style={{
          height: 64,
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
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', color: 'var(--app-text)' }}>
          <img
            src="/images/logo.svg"
            alt="Busca Influencer - Filtrar e Encontrar os Melhores"
            style={{ height: 36, width: 'auto', display: 'block' }}
          />

        </Link>
        <nav style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Dropdown
            menu={{
              items: THEME_OPTIONS.map((opt: { value: ThemeMode; label: string }) => ({
                key: opt.value,
                label: opt.label,
                onClick: () => setTheme(opt.value),
              })) as MenuProps['items'],
            }}
            trigger={['click']}
            placement="bottomRight"
          >
            <Button
              type="text"
              icon={<BgColorsOutlined />}
              style={{
                color: 'var(--app-text-secondary)',
                height: 40,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                borderRadius: 10,
                padding: '0 12px',
                fontWeight: 500,
              }}
              title="Tema"
              aria-label="Escolher tema"
            >
              <span style={{ fontSize: 14 }}>{currentThemeLabel}</span>
              <CaretDownFilled style={{ fontSize: 12, opacity: 0.8 }} />
            </Button>
          </Dropdown>
          <Link to="/login" style={navLinkStyle}>Entrar</Link>
          <Link
            to="/app/create"
            style={{
              ...navLinkStyle,
              background: `linear-gradient(135deg, ${colors.primary}, ${colors.accent})`,
              color: colors.white,
              padding: '10px 20px',
              borderRadius: 12,
              fontWeight: 600,
            }}
          >
            Criar conta
          </Link>
        </nav>
      </header>

      {/* 2) Hero */}
      <section
        style={{
          maxWidth: sectionMaxWidth,
          margin: '0 auto',
          padding: '48px 24px 80px',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 48,
          alignItems: 'center',
          position: 'relative',
          zIndex: 1,
        }}
        className="landing-hero-grid"
      >
        <div>
          <h1
            style={{
              fontSize: 'clamp(28px, 4vw, 40px)',
              fontWeight: 700,
              color: 'var(--app-text)',
              lineHeight: 1.2,
              margin: '0 0 16px',
              letterSpacing: '-0.02em',
            }}
          >
            Análise grátis do seu Instagram em 1 minuto.
          </h1>
          <p style={{ fontSize: 17, color: 'var(--app-text-secondary)', lineHeight: 1.6, margin: '0 0 24px' }}>
            Valide seu @ por DM e receba um relatório completo com métricas reais, pontos fortes e oportunidades com marcas.
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 28px' }}>
            {[
              { icon: <CheckCircleOutlined style={{ color: colors.success, marginRight: 10 }} />, text: '100% gratuito' },
              { icon: <SafetyOutlined style={{ color: colors.primary, marginRight: 10 }} />, text: 'Sem pedir senha' },
              { icon: <FileTextOutlined style={{ color: colors.accent, marginRight: 10 }} />, text: 'Relatório em PDF + painel' },
            ].map((item, i) => (
              <li key={i} style={{ display: 'flex', alignItems: 'center', marginBottom: 10, color: 'var(--app-text-secondary)', fontSize: 15 }}>
                {item.icon}
                {item.text}
              </li>
            ))}
          </ul>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
            <a
              href="#cta-inicial"
              className="landing-btn-primary"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: 52,
                padding: '0 28px',
                background: `linear-gradient(135deg, ${colors.primary}, ${colors.accent})`,
                color: colors.white,
                borderRadius: 14,
                fontWeight: 600,
                fontSize: 16,
                textDecoration: 'none',
                boxShadow: `0 4px 14px ${colors.primary}40`,
                transition: 'filter 0.2s',
              }}
            >
              Gerar relatório grátis
            </a>
            <Link
              to="/app"
              style={{
                color: colors.primary,
                fontWeight: 500,
                fontSize: 15,
                textDecoration: 'none',
              }}
            >
              Ver exemplo do relatório
            </Link>
          </div>
        </div>

        {/* Mock dashboard */}
        <div
          style={{
            ...cardStyle,
            padding: 24,
            maxWidth: 420,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: '50%',
                background: 'var(--app-hero-gradient)',
              }}
            />
            <span style={{ fontWeight: 600, color: 'var(--app-text)' }}>@seuusuario</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 20 }}>
            {[
              { label: 'Seguidores', value: '24K', icon: <TeamOutlined style={{ color: colors.primary }} /> },
              { label: 'Alcance', value: '324K', icon: <LineChartOutlined style={{ color: colors.accent }} /> },
              { label: 'Engajamento', value: '7,5%', icon: <RiseOutlined style={{ color: colors.success }} /> },
            ].map((kpi, i) => (
              <div
                key={i}
                style={{
                  padding: '12px 10px',
                  background: 'var(--app-bg)',
                  borderRadius: 12,
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: 11, color: 'var(--app-text-tertiary)', marginBottom: 4 }}>{kpi.label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--app-text)' }}>{kpi.value}</div>
              </div>
            ))}
          </div>
          <div style={{ height: 80, marginBottom: 20, display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            {[40, 65, 45, 70, 55, 80, 60].map((h, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: `${h}%`,
                  background: `linear-gradient(180deg, ${colors.primary}30, ${colors.primary}60)`,
                  borderRadius: 6,
                }}
              />
            ))}
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--app-text-tertiary)', marginBottom: 8 }}>Insights</div>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: 13, color: 'var(--app-text-secondary)' }}>
            <li style={{ marginBottom: 6 }}>• Melhor horário para publicar</li>
            <li style={{ marginBottom: 6 }}>• Taxa de crescimento</li>
            <li>• Conteúdos que performam</li>
          </ul>
        </div>
      </section>

      {/* Input + CTA inicial */}
      <section
        id="cta-inicial"
        style={{
          maxWidth: sectionMaxWidth,
          margin: '0 auto',
          padding: '0 24px 64px',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <div
          style={{
            ...cardStyle,
            padding: '24px 28px',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div style={{ flex: '1 1 260px', position: 'relative' }}>
            <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--app-text-tertiary)', fontSize: 15, zIndex: 1 }}>@</span>
            <input
              type="text"
              placeholder="seuusuario"
              value={handle}
              onChange={(e) => { setHandle(e.target.value.replace(/^@/, '').trim()); setInputError('') }}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmitFirst()}
              aria-label="Usuário do Instagram"
              style={{
                width: '100%',
                height: 48,
                padding: '0 14px 0 28px',
                border: `1px solid ${colors.border}`,
                borderRadius: 12,
                fontSize: 15,
                outline: 'none',
                boxSizing: 'border-box',
              }}
              onFocus={(e) => { e.target.style.borderColor = colors.primary; e.target.style.boxShadow = `0 0 0 2px ${colors.primary}20` }}
              onBlur={(e) => { e.target.style.borderColor = colors.border; e.target.style.boxShadow = 'none' }}
            />
          </div>
          <button
            type="button"
            className="landing-btn-primary"
            onClick={handleSubmitFirst}
            style={{
              height: 48,
              padding: '0 24px',
              background: `linear-gradient(135deg, ${colors.primary}, ${colors.accent})`,
              color: colors.white,
              border: 'none',
              borderRadius: 12,
              fontWeight: 600,
              fontSize: 15,
              cursor: 'pointer',
              transition: 'filter 0.2s',
            }}
          >
            Analisar perfil grátis
          </button>
        </div>
        {inputError ? <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--app-error)', marginTop: 8 }}>{inputError}</p> : null}
        <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--app-text-tertiary)', marginTop: 12 }}>
          Enviaremos um código de ativação por DM. Não pedimos sua senha.
        </p>
      </section>

      {/* 3) Como funciona */}
      <section
        id="como-funciona"
        style={{
          maxWidth: sectionMaxWidth,
          margin: '0 auto',
          padding: '48px 24px 64px',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <h2 style={{ fontSize: 26, fontWeight: 700, color: 'var(--app-text)', marginBottom: 32, textAlign: 'center' }}>
          Como funciona
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }} className="landing-steps-grid">
          {[
            { step: 1, icon: <SearchOutlined style={{ fontSize: 24, color: colors.primary }} />, title: 'Digite seu @', text: 'Informe seu usuário do Instagram no campo acima.' },
            { step: 2, icon: <MessageOutlined style={{ fontSize: 24, color: colors.primary }} />, title: 'Receba um código por DM', text: 'Enviamos um código de validação na sua DM do Instagram.' },
            { step: 3, icon: <DownloadOutlined style={{ fontSize: 24, color: colors.primary }} />, title: 'Baixe seu relatório e veja o painel', text: 'Acesse o relatório em PDF e o painel online.' },
          ].map((item) => (
            <div key={item.step} style={{ ...cardStyle, padding: 28, textAlign: 'center' }}>
              <div style={{ width: 48, height: 48, borderRadius: 14, background: 'var(--app-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                {item.icon}
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: colors.primary, marginBottom: 8 }}>Passo {item.step}</div>
              <h3 style={{ fontSize: 17, fontWeight: 600, color: 'var(--app-text)', margin: '0 0 8px' }}>{item.title}</h3>
              <p style={{ fontSize: 14, color: 'var(--app-text-secondary)', lineHeight: 1.5, margin: 0 }}>{item.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 4) O que vem no relatório */}
      <section
        id="o-que-vem"
        style={{
          maxWidth: sectionMaxWidth,
          margin: '0 auto',
          padding: '48px 24px 64px',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <h2 style={{ fontSize: 26, fontWeight: 700, color: 'var(--app-text)', marginBottom: 32, textAlign: 'center' }}>
          O que vem no relatório
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }} className="landing-report-grid">
          {[
            { icon: <LineChartOutlined />, title: 'Crescimento e tendência', desc: 'Evolução de seguidores e alcance ao longo do tempo.' },
            { icon: <RiseOutlined />, title: 'Taxa de engajamento real', desc: 'Cálculo com base em likes e comentários dos seus posts.' },
            { icon: <TeamOutlined />, title: 'Perfil do público', desc: 'Idade, cidade e interesses do seu público (quando disponível).' },
            { icon: <BulbOutlined />, title: 'Conteúdos que mais rendem', desc: 'Quais formatos e temas geram mais interação.' },
            { icon: <DollarOutlined />, title: 'Preço estimado para publi', desc: 'Faixa de valor sugerida para parcerias com marcas.' },
            { icon: <UnorderedListOutlined />, title: 'Checklist de melhorias', desc: 'Pontos para fortalecer seu perfil e atrair marcas.' },
          ].map((item, i) => (
            <div key={i} style={{ ...cardStyle, padding: 20, display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--app-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: colors.primary, flexShrink: 0 }}>
                {item.icon}
              </div>
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--app-text)', margin: '0 0 4px' }}>{item.title}</h3>
                <p style={{ fontSize: 13, color: 'var(--app-text-secondary)', lineHeight: 1.5, margin: 0 }}>{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 5) Confiança / Privacidade */}
      <section
        id="privacidade"
        style={{
          maxWidth: sectionMaxWidth,
          margin: '0 auto',
          padding: '48px 24px 64px',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <div style={{ ...cardStyle, padding: 32, display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 24 }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: 'var(--app-primary-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <SafetyOutlined style={{ fontSize: 28, color: colors.primary }} />
          </div>
          <div style={{ flex: '1 1 300px' }}>
            <h3 style={{ fontSize: 18, fontWeight: 600, color: 'var(--app-text)', margin: '0 0 12px' }}>Seguro e transparente</h3>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', color: 'var(--app-text-secondary)', fontSize: 15, lineHeight: 1.8 }}>
              <li>• Não pedimos senha do Instagram</li>
              <li>• Validação via código por DM</li>
              <li>• Você pode remover seus dados quando quiser</li>
            </ul>
            <a href="#politica" style={{ fontSize: 14, color: colors.primary, fontWeight: 500, marginTop: 12, display: 'inline-block' }}>
              Ler política de privacidade
            </a>
          </div>
        </div>
      </section>

      {/* 6) CTA final */}
      <section
        style={{
          maxWidth: 560,
          margin: '0 auto',
          padding: '48px 24px 80px',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <h2 style={{ fontSize: 26, fontWeight: 700, color: 'var(--app-text)', marginBottom: 24, textAlign: 'center' }}>
          Quer seu relatório agora?
        </h2>
        <div style={{ ...cardStyle, padding: 28 }}>
          <div style={{ marginBottom: 12, position: 'relative' }}>
            <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--app-text-tertiary)', fontSize: 15 }}>@</span>
            <input
              type="text"
              placeholder="seuusuario"
              value={finalHandle}
              onChange={(e) => { setFinalHandle(e.target.value.replace(/^@/, '').trim()); setInputError('') }}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmitFinal()}
              aria-label="Usuário do Instagram"
              style={{
                width: '100%',
                height: 48,
                padding: '0 14px 0 32px',
                border: `1px solid ${colors.border}`,
                borderRadius: 12,
                fontSize: 15,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <button
            type="button"
            className="landing-btn-primary"
            onClick={handleSubmitFinal}
            style={{
              width: '100%',
              height: 52,
              background: `linear-gradient(135deg, ${colors.primary}, ${colors.accent})`,
              color: colors.white,
              border: 'none',
              borderRadius: 14,
              fontWeight: 600,
              fontSize: 16,
              cursor: 'pointer',
              transition: 'filter 0.2s',
            }}
          >
            Enviar código por DM
          </button>
        </div>
        {inputError ? <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--app-error)', marginTop: 8 }}>{inputError}</p> : null}
        <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--app-text-tertiary)', marginTop: 12 }}>
          Sem spam. Sem custo. Só insights.
        </p>
      </section>

      {/* 7) Footer */}
      <footer
        style={{
          borderTop: `1px solid ${colors.border}`,
          padding: '24px 24px 32px',
          maxWidth: sectionMaxWidth,
          margin: '0 auto',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 24, marginBottom: 16 }}>
          <a href="#termos" style={{ fontSize: 13, color: 'var(--app-text-secondary)', textDecoration: 'none' }}>Termos</a>
          <a href="#privacidade" style={{ fontSize: 13, color: 'var(--app-text-secondary)', textDecoration: 'none' }}>Privacidade</a>
          <a href="#contato" style={{ fontSize: 13, color: 'var(--app-text-secondary)', textDecoration: 'none' }}>Contato</a>
        </div>
        <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--app-text-tertiary)', margin: 0 }}>
          © {new Date().getFullYear()} Relatório de Influencer. Todos os direitos reservados.
        </p>
      </footer>

      <style>{`
        .landing-hero-grid { }
        @media (max-width: 900px) {
          .landing-hero-grid { grid-template-columns: 1fr; }
          .landing-steps-grid { grid-template-columns: 1fr !important; }
          .landing-report-grid { grid-template-columns: 1fr !important; }
        }
        header nav button { background: none; border: none; cursor: pointer; font-size: 14px; color: var(--app-text-secondary); }
        header nav button:hover { color: var(--app-text); }
        .landing-btn-primary:hover { filter: brightness(0.92); }
        .landing-btn-primary:focus-visible { outline: 2px solid var(--app-primary); outline-offset: 2px; }
      `}</style>
    </div>
  )
}

const navLinkStyle: React.CSSProperties = {
  color: 'var(--app-text-secondary)',
  fontSize: 14,
  padding: '8px 12px',
  textDecoration: 'none',
  fontWeight: 500,
}
