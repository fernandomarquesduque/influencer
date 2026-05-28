import {
  ArrowRightOutlined,
  DownOutlined,
  InstagramOutlined,
  LoginOutlined,
  StarFilled,
  StarOutlined,
} from '@ant-design/icons'
import type { CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import AppAccountMenu from '../AppAccountMenu'
import { useAuth } from '../../contexts/AuthContext'
import { useAgencySignupModalOptional } from '../../contexts/AgencySignupModalContext'
import { INFLUENCER_LANDING_PATH } from '../../constants/landingPaths'
import { SEARCH_ROUTE_PATH } from '../../constants/searchRoute'
import { trackAppUiClick } from '../../utils/metaPixel'
import BuscaSearchBar from './BuscaSearchBar'
import '../AppAccountMenu/AppAccountMenu.css'
import './DiscoveryHomeHero.css'

export type DiscoveryHomeHeroVariant = 'full' | 'compact'

const DEFAULT_POPULAR_TAGS = ['Moda', 'Beleza', 'Fitness', 'Viagem']

const FLOATING_INFLUENCERS = [
  {
    position: 'tl' as const,
    category: 'Beleza',
    handle: '@belezacomproposito',
    followers: '125K seguidores',
    engagement: 'Engajamento 4.8%',
    image:
      'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=320&h=340&q=80',
  },
  {
    position: 'bl' as const,
    category: 'Fitness',
    handle: '@treinocomresultado',
    followers: '98K seguidores',
    engagement: 'Engajamento 6.2%',
    image:
      'https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?auto=format&fit=crop&w=320&h=340&q=80',
  },
  {
    position: 'tr' as const,
    category: 'Viagem',
    handle: '@explorandoomundo',
    followers: '210K seguidores',
    engagement: 'Engajamento 3.9%',
    image:
      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=320&h=340&q=80',
  },
  {
    position: 'br' as const,
    category: 'Lifestyle',
    handle: '@vidacomleveza',
    followers: '156K seguidores',
    engagement: 'Engajamento 5.1%',
    image:
      'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=320&h=340&q=80',
  },
]

function FloatingInfluencerCard({
  category,
  handle,
  followers,
  engagement,
  image,
  position,
}: (typeof FLOATING_INFLUENCERS)[number]) {
  return (
    <article
      className={`floating-influencer-card floating-influencer-card--${position}`}
      aria-hidden
    >
      <div className="floating-influencer-card__media">
        <img src={image} alt="" loading="lazy" decoding="async" />
        <span className="floating-influencer-card__category">{category}</span>
      </div>
      <div className="floating-influencer-card__body">
        <p className="floating-influencer-card__handle">{handle}</p>
        <p className="floating-influencer-card__followers">{followers}</p>
        <p className="floating-influencer-card__engagement">{engagement}</p>
      </div>
    </article>
  )
}

export type DiscoveryHomeHeroProps = {
  variant?: DiscoveryHomeHeroVariant
  searchValue: string
  onSearchValueChange: (value: string) => void
  onSearch: (term?: string) => void
  popularTags?: string[]
  className?: string
  style?: CSSProperties
  searchPlaceholder?: string
  showScrollHint?: boolean
  showInfluencerPanel?: boolean
}

export default function DiscoveryHomeHero({
  variant = 'full',
  searchValue,
  onSearchValueChange,
  onSearch,
  popularTags = DEFAULT_POPULAR_TAGS,
  className,
  style,
  searchPlaceholder,
  showScrollHint = variant === 'full',
  showInfluencerPanel = variant === 'full',
}: DiscoveryHomeHeroProps) {
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const signupModal = useAgencySignupModalOptional()
  const isCompact = variant === 'compact'
  const placeholder =
    searchPlaceholder ??
    (isCompact ? 'Digite uma palavra para buscar' : 'Digite uma palavra, cidade ou marca')

  const handleTagClick = (tag: string) => {
    onSearchValueChange(tag)
    onSearch(tag)
  }

  const goToInfluencerLanding = () => {
    trackAppUiClick('hero_sou_influenciador', { target_path: INFLUENCER_LANDING_PATH })
  }

  const goToAgencyLogin = () => {
    trackAppUiClick('hero_agency_login', { target_path: 'signup_modal' })
    if (signupModal) signupModal.openSignupModal()
    else navigate('/login')
  }

  return (
    <section
      className={[
        'discovery-home-hero',
        isCompact ? 'discovery-home-hero--compact' : 'discovery-home-hero--full',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={style}
      aria-label="Busca de influenciadores"
    >
      <div className="discovery-home-hero__bg" aria-hidden>
        <div className="discovery-home-hero__blob discovery-home-hero__blob--purple" />
        <div className="discovery-home-hero__blob discovery-home-hero__blob--yellow" />
      </div>

      {!isCompact ? (
        <div className="discovery-home-hero__cards" aria-hidden>
          {FLOATING_INFLUENCERS.map((card) => (
            <FloatingInfluencerCard key={card.handle} {...card} />
          ))}
        </div>
      ) : null}

      {authLoading ? null : user ? (
        <AppAccountMenu
          className="discovery-home-hero__account-menu app-account-menu-btn"
          showLabel
          includeGuestMenu={false}
          ariaLabel="Menu da conta"
        />
      ) : (
        <button
          type="button"
          className="discovery-home-hero__login-entry"
          onClick={goToAgencyLogin}
          aria-label="Entrar na área da marca"
        >
          <LoginOutlined aria-hidden />
          Entrar
        </button>
      )}

      <div className="discovery-home-hero__inner">
        {isCompact ? (
          <div className="discovery-home-hero__logo">
            <img src="/images/logo.svg" alt="Busca Influencer" />
          </div>
        ) : (
          <>
            <div className="discovery-home-hero__logo discovery-home-hero__logo--full">
              <button
                type="button"
                className="discovery-home-hero__logo-btn"
                onClick={() => navigate(SEARCH_ROUTE_PATH)}
                aria-label={'Busca Influencer - in\u00edcio'}
              >
                <img src="/images/logo.svg" alt="" decoding="async" />
              </button>
            </div>
            <p className="discovery-home-hero__badge">
              <StarOutlined aria-hidden />
              A plataforma que conecta marcas e criadores de conteúdo
            </p>
            <h1 className="discovery-home-hero__title">
              Encontre os <span className="discovery-home-hero__title-accent">influenciadores</span> perfeitos para sua
              marca
            </h1>
          </>
        )}

        <div className="discovery-home-hero__search-wrap">
          {!isCompact ? (
            <>
              <StarFilled className="discovery-home-hero__sparkle discovery-home-hero__sparkle--left" aria-hidden />
              <StarFilled className="discovery-home-hero__sparkle discovery-home-hero__sparkle--right" aria-hidden />
            </>
          ) : null}
          <BuscaSearchBar
            value={searchValue}
            onChange={onSearchValueChange}
            onSearch={() => onSearch(searchValue.trim() || undefined)}
            placeholder={placeholder}
            size="lg"
          />
        </div>

        {!isCompact ? (
          <>
            <div className="discovery-home-hero__tags">
              <span className="discovery-home-hero__tags-label">Populares:</span>
              {popularTags.map((tag) => (
                <button key={tag} type="button" className="discovery-home-hero__tag" onClick={() => handleTagClick(tag)}>
                  {tag}
                </button>
              ))}
            </div>

            {showInfluencerPanel ? (
              <a
                href={INFLUENCER_LANDING_PATH}
                className="discovery-influencer-panel"
                aria-labelledby="discovery-influencer-panel-title"
                onClick={goToInfluencerLanding}
              >
                <div className="discovery-influencer-panel__icon" aria-hidden>
                  <InstagramOutlined />
                </div>
                <div className="discovery-influencer-panel__body">
                  <p className="discovery-influencer-panel__eyebrow">Para criadores de conteúdo</p>
                  <h2 id="discovery-influencer-panel-title" className="discovery-influencer-panel__title">
                    Sou influenciador
                  </h2>
                  <p className="discovery-influencer-panel__text">
                    Ative seu perfil, gere seu media kit e apareça na vitrine para marcas da sua região.
                  </p>
                </div>
                <span className="discovery-influencer-panel__cta">
                  Ativar meu perfil
                  <ArrowRightOutlined aria-hidden />
                </span>
              </a>
            ) : null}
          </>
        ) : null}

        {showScrollHint && !isCompact ? (
          <span className="discovery-home-hero__scroll-hint">
            <DownOutlined aria-hidden />
            Explore as categorias
          </span>
        ) : null}
      </div>
    </section>
  )
}
