import { Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { ListCacheProvider } from './contexts/ListCacheContext'
import { RequireAuth } from './components/RequireAuth'
import Layout from './Layout'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Premium from './pages/Premium'
import AdminUsers from './pages/AdminUsers'
import ListAndDetailModal from './pages/ListAndDetailModal'
import Extraction from './pages/Extraction'
import ExtractProfile from './pages/ExtractProfile'
import Activate from './pages/Activate'
import Auth from './pages/Auth'
import AuthPassword from './pages/AuthPassword'
import AuthRejected from './pages/AuthRejected'

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
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/premium" element={<Premium />} />
        {/* Landing (home) */}
        <Route path="/" element={<Landing />} />
        {/* Lista, detalhe e auth: acesso público */}
        <Route path="/app" element={<ListCacheProvider><Layout /></ListCacheProvider>}>
          <Route index element={<ListAndDetailModal />} />
          <Route path="influencer/:handle" element={<ListAndDetailModal />} />
          <Route path="create" element={<Auth />} />
          <Route path="create/password" element={<AuthPassword />} />
          <Route path="create/rejected" element={<AuthRejected />} />
        </Route>
        {/* Compatibilidade: rotas antigas */}
        <Route path="influencer/:handle" element={<RedirectInfluencerToApp />} />
        <Route path="validar" element={<RedirectValidarToCreate />} />
        <Route path="create" element={<Navigate to="/app/create" replace />} />
        <Route path="create/password" element={<Navigate to="/app/create/password" replace />} />
        <Route path="create/rejected" element={<Navigate to="/app/create/rejected" replace />} />
        {/* Rotas que exigem login */}
        <Route
          element={
            <RequireAuth requireLogin>
              <Layout />
            </RequireAuth>
          }
        >
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
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}
