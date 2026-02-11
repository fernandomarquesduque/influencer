import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { ListCacheProvider } from './contexts/ListCacheContext'
import { RequireAuth } from './components/RequireAuth'
import Layout from './Layout'
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

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/premium" element={<Premium />} />
        {/* Lista, detalhe e auth: acesso público */}
        <Route path="/" element={<ListCacheProvider><Layout /></ListCacheProvider>}>
          <Route index element={<ListAndDetailModal />} />
          <Route path="influencer/:handle" element={<ListAndDetailModal />} />
          <Route path="create" element={<Auth />} />
          <Route path="create/password" element={<AuthPassword />} />
          <Route path="create/rejected" element={<AuthRejected />} />
        </Route>
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
