/**
 * Posts favoritados — galeria + painel BI (facets) como na busca.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Drawer, Empty, Spin } from 'antd'
import { AppstoreOutlined, UnorderedListOutlined, FilterOutlined, HeartFilled, StarOutlined } from '@ant-design/icons'
import { useAuth } from '../contexts/AuthContext'
import { useAgencySignupModal } from '../contexts/AgencySignupModalContext'
import CampaignOriginGallery, { type OriginGalleryViewMode } from '../components/CampaignOriginGallery'
import CampaignBIPanel from '../components/CampaignBIPanel/CampaignBIPanel'
import InfluencerDetailModal from '../components/InfluencerDetailModal/InfluencerDetailModal'
import type { InfluencerConnectSnapshot } from '../components/InfluencerConnectModal/InfluencerConnectModal'
import type { PostItem, ProfilesSearchFacets, ProfilesSearchQuery } from '../api'
import {
  computeFacetsFromItems,
  countCampaignFacetBoostSelections,
  filterFacetsForDisplay,
  isCampaignFacetBoostOnlyPatch,
  isCampaignGalleryUiOnlyPatch,
  normalizeSingleSelectFacetBoost,
  profileListItemsFromOriginPosts,
} from '../utils/campaignFilterClient'
import './CampaignInfluencers.css'
import './FavoritePosts.css'

const ALL_CAMPAIGNS_SLUG = 'all'
const MOBILE_BREAKPOINT = 768
const CAMPAIGN_MAIN_COLUMN_GAP_PX = 24

const defaultQuery: Partial<ProfilesSearchQuery> = {
  limit: 36,
  offset: 0,
}

export default function FavoritePosts() {
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const { openSignupModal } = useAgencySignupModal()
  const [viewMode, setViewMode] = useState<OriginGalleryViewMode>('list')
  const [profileDetailRef, setProfileDetailRef] = useState<string | null>(null)
  const [query, setQuery] = useState<Partial<ProfilesSearchQuery>>(() => ({ ...defaultQuery }))
  const [facets, setFacets] = useState<ProfilesSearchFacets | null>(null)
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT)
  const [mobileBiDrawerOpen, setMobileBiDrawerOpen] = useState(false)

  useEffect(() => {
    if (!authLoading && !user) {
      openSignupModal()
    }
  }, [authLoading, user, openSignupModal])

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const updateFilter = useCallback((overrides: Partial<ProfilesSearchQuery>) => {
    if (isCampaignFacetBoostOnlyPatch(overrides) || isCampaignGalleryUiOnlyPatch(overrides)) {
      setQuery((prev) => normalizeSingleSelectFacetBoost({ ...prev, ...overrides, offset: 0 }))
      return
    }
    setQuery((prev) => normalizeSingleSelectFacetBoost({ ...prev, ...overrides, offset: 0 }))
  }, [])

  const updateFilterFromMobileDrawer = useCallback(
    (overrides: Partial<ProfilesSearchQuery>) => {
      updateFilter(overrides)
      setMobileBiDrawerOpen(false)
    },
    [updateFilter]
  )

  const handleOriginPostsForFacets = useCallback((posts: PostItem[]) => {
    if (posts.length === 0) {
      setFacets(null)
      return
    }
    const items = profileListItemsFromOriginPosts(posts)
    setFacets(filterFacetsForDisplay(computeFacetsFromItems(items)))
  }, [])

  const mobileFiltersCount = countCampaignFacetBoostSelections(query)
  const showMobileFiltersFab = isMobile && facets != null

  const renderViewToggle = (fullWidth = false) => (
    <div
      className={`campaign-instagram-view-toggle${fullWidth ? ' campaign-instagram-view-toggle--full' : ''}`}
      role="group"
      aria-label="Lista ou foto"
    >
      <button
        type="button"
        className={`campaign-instagram-view-toggle-btn${viewMode === 'list' ? ' is-active' : ''}`}
        onClick={() => setViewMode('list')}
      >
        <UnorderedListOutlined />
        <span>lista</span>
      </button>
      <button
        type="button"
        className={`campaign-instagram-view-toggle-btn${viewMode === 'grid' ? ' is-active' : ''}`}
        onClick={() => setViewMode('grid')}
      >
        <AppstoreOutlined />
        <span>foto</span>
      </button>
    </div>
  )

  const openInfluencerFromCard = useCallback((profileRef: string, _snapshot?: InfluencerConnectSnapshot) => {
    const ref = profileRef.trim()
    if (ref) setProfileDetailRef(ref)
  }, [])

  const galleryProps = useMemo(
    () => ({
      campaignId: ALL_CAMPAIGNS_SLUG,
      textQuery: '',
      viewMode,
      favoritesFeed: true as const,
      facetBoostQuery: query,
      originPostSort: query.originPostSort,
      onOpenInfluencerDetail: openInfluencerFromCard,
      onLoadedPostsForFacets: handleOriginPostsForFacets,
    }),
    [viewMode, query, openInfluencerFromCard, handleOriginPostsForFacets]
  )

  if (authLoading || !user) {
    return (
      <div style={{ padding: '48px 24px', textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    )
  }

  if (user.scope === 'influencer') {
    return (
      <div className="favorite-posts-page" style={{ padding: '24px 0' }}>
        <Empty description="Favoritos de posts estão disponíveis para agências e assinantes." />
        <Button type="primary" onClick={() => navigate('/')} style={{ marginTop: 16 }}>
          Ir para busca
        </Button>
      </div>
    )
  }

  return (
    <div
      className={[
        'campaign-page campaign-page--all favorite-posts-page',
        showMobileFiltersFab ? 'campaign-page--mobile-fab' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ overflowX: 'hidden' }}
    >
      <InfluencerDetailModal
        open={profileDetailRef != null}
        onClose={() => setProfileDetailRef(null)}
        profileRef={profileDetailRef ?? ''}
        campaignId={ALL_CAMPAIGNS_SLUG}
      />

      <div
        className="campaign-split-layout"
        style={{
          display: 'flex',
          gap: 0,
          alignItems: 'flex-start',
          minWidth: 0,
        }}
      >
        {!isMobile ? (
          <>
            <div className="campaign-split-layout__rail-spacer" aria-hidden />
            <div className="campaign-split-layout__rail" style={{ minWidth: 0 }}>
              <div className="campaign-rail-view-toggle" style={{ marginBottom: 10 }}>
                {renderViewToggle(true)}
              </div>
              <CampaignBIPanel
                facets={facets}
                query={query}
                onFilter={updateFilter}
                showOriginPostSort
              />
            </div>
          </>
        ) : null}

        <div
          className="favorite-posts-page__main"
          style={{ flex: 1, minWidth: 0, paddingLeft: isMobile ? 0 : CAMPAIGN_MAIN_COLUMN_GAP_PX }}
        >
          <header className="favorite-posts-page__header">
            <h1 className="favorite-posts-page__title">
              <span className="favorite-posts-page__title-icon" aria-hidden>
                <HeartFilled />
              </span>
              <span className="favorite-posts-page__title-block">
                <span className="favorite-posts-page__title-text">Favoritos</span>
                <span className="favorite-posts-page__sparkles" aria-hidden>
                  <StarOutlined className="favorite-posts-page__sparkle favorite-posts-page__sparkle--lg" />
                  <StarOutlined className="favorite-posts-page__sparkle favorite-posts-page__sparkle--sm" />
                </span>
              </span>
            </h1>
            <p className="favorite-posts-page__lead">
              Publicações que você salvou com o coração na busca. Use os filtros ao lado para refinar.
            </p>
          </header>
          {isMobile ? (
            <div className="favorite-posts-page__mobile-toolbar">{renderViewToggle(true)}</div>
          ) : null}
          <CampaignOriginGallery {...galleryProps} />
        </div>
      </div>

      {showMobileFiltersFab ? (
        <>
          <Drawer
            title={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <FilterOutlined aria-hidden />
                Filtrar e ordenar
              </span>
            }
            placement="right"
            open={mobileBiDrawerOpen}
            onClose={() => setMobileBiDrawerOpen(false)}
            width={Math.min(320, typeof window !== 'undefined' ? window.innerWidth - 24 : 320)}
            styles={{ body: { paddingTop: 8 } }}
            destroyOnClose={false}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {renderViewToggle(true)}
              <CampaignBIPanel
                facets={facets}
                query={query}
                onFilter={updateFilterFromMobileDrawer}
                showOriginPostSort
              />
            </div>
          </Drawer>
          <button
            type="button"
            className="campaign-mobile-filters-fab"
            aria-label={
              mobileFiltersCount > 0
                ? `Abrir filtros e ordenação, ${mobileFiltersCount} filtro${mobileFiltersCount === 1 ? '' : 's'} selecionado${mobileFiltersCount === 1 ? '' : 's'}`
                : 'Abrir filtros e ordenação'
            }
            aria-expanded={mobileBiDrawerOpen}
            onClick={() => setMobileBiDrawerOpen(true)}
          >
            <FilterOutlined aria-hidden />
            {mobileFiltersCount > 0 ? (
              <span className="campaign-mobile-filters-fab__badge" aria-hidden>
                {mobileFiltersCount > 9 ? '9+' : mobileFiltersCount}
              </span>
            ) : null}
          </button>
        </>
      ) : null}
    </div>
  )
}
