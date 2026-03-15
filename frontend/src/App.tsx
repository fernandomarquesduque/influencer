import { useEffect } from 'react'
import { Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { CreditsProvider } from './contexts/CreditsContext'
import { ListCacheProvider } from './contexts/ListCacheContext'
import { RequireAuth } from './components/RequireAuth'
import Layout from './Layout'

/** Ao focar em input/textarea/select, reposiciona o scroll para o campo não ficar atrás do teclado e o botão de ação continuar visível. (Desativado na Home.) */
function FocusScrollHandler() {
  const location = useLocation()
  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      if (location.pathname === '/') return
      const el = e.target as HTMLElement
      if (el.closest('.ant-modal-wrap, .ant-drawer-content-wrapper')) return
      const isField =
        el.matches('input, textarea, select, [contenteditable="true"]') ||
        el.closest('.ant-input-affix-wrapper, .ant-select-selector')
      if (!isField) return
      const target = (el.closest('input, textarea, select') || el) as HTMLElement
      const scroll = () => {
        const rect = target.getBoundingClientRect()
        const offset = 100
        const top = Math.max(0, window.scrollY + rect.top - offset)
        window.scrollTo({ top, behavior: 'smooth' })
      }
      setTimeout(scroll, 150)
      if ('visualViewport' in window) {
        setTimeout(scroll, 450)
      }
    }
    document.addEventListener('focusin', onFocus)
    return () => document.removeEventListener('focusin', onFocus)
  }, [location.pathname])
  return null
}
import Home from './pages/Home'
import Login from './pages/Login'
import Premium from './pages/Premium'
import AdminUsers from './pages/AdminUsers'
import ListAndDetailModal from './pages/ListAndDetailModal'
import Checkout from './pages/Checkout'
import MyCampaigns from './pages/MyCampaigns'
import CampaignInfluencers from './pages/CampaignInfluencers'
import InfluencerDetail from './pages/InfluencerDetail'
import Projects from './pages/Projects'
import Extraction from './pages/Extraction'
import ExtractProfile from './pages/ExtractProfile'
import Activate from './pages/Activate'
import Auth from './pages/Auth'
import AuthPassword from './pages/AuthPassword'
import AuthRejected from './pages/AuthRejected'
import MediaKit from './pages/MediaKit'
import SendMessage from './pages/SendMessage'
import BulkMessage from './pages/BulkMessage'
import Payments from './pages/Payments'
import CheckoutCredits from './pages/CheckoutCredits'
import Logo from './components/Logo'

function RedirectInfluencerToApp() {
  const { handle } = useParams<{ handle: string }>()
  return <Navigate to={handle ? `/app/influencer/${handle}` : '/app'} replace />
}

function RedirectValidarToCreate() {
  const location = useLocation()
  const search = location.search || ''
  return <Navigate to={`/app/create${search}`} replace />
}

export default function App() {
  return (
    <AuthProvider>
      <CreditsProvider>
        <FocusScrollHandler />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/premium" element={<Premium />} />
          <Route path="search" element={<div style={{ padding: '20px 20px' }}><div style={{ marginBottom: '30px', display: 'flex', justifyContent: 'center', padding: '24px 24px 0' }}><Logo size="large" height={36} variant="default" style={{ flexShrink: 0 }} alt="Relatório de Influencer" /></div><ListAndDetailModal /></div>} />
          <Route path="/checkout" element={<><Logo size="large" height={36} variant="default" style={{ flexShrink: 0 }} alt="Relatório de Influencer" /><CheckoutCredits /></>} />
          <Route path="/" element={<Home />} />

          <Route path="/app" element={<Layout />}>
            <Route index element={<MyCampaigns />} />
            <Route path="campaigns" element={<MyCampaigns />} />
            <Route path="campaigns/create" element={<ListAndDetailModal />} />
            <Route path="campaigns/:campaignId" element={<CampaignInfluencers />} />
            <Route path="campaigns/:campaignId/influencer/:handle" element={<InfluencerDetail />} />
            <Route path="payments" element={<Payments />} />
            <Route path="projects" element={<Projects />} />
            <Route path="projects/:projectId" element={<Projects />} />
            <Route path="bulk-message" element={<BulkMessage />} />
            <Route path="create" element={<Auth />} />
            <Route path="create/password" element={<AuthPassword />} />
            <Route path="influencer/:handle" element={<InfluencerDetail />} />
            <Route path="influencer/:handle/media-kit" element={<MediaKit />} />
            <Route path="influencer/:handle/send-message" element={<SendMessage />} />
          </Route>

          <Route path="/extraction" element={<Extraction />} />
          <Route path="/extract-profile" element={<ExtractProfile />} />
          <Route path="/activate/:handle" element={<Activate />} />
          <Route
            path="/admin/users"
            element={
              <RequireAuth requireAdm>
                <AdminUsers />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </CreditsProvider>
    </AuthProvider >
  )
}
