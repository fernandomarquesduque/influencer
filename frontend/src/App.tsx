import { Routes, Route } from 'react-router-dom'
import Layout from './Layout'
import InfluencerList from './pages/InfluencerList'
import InfluencerDetail from './pages/InfluencerDetail'
import Extraction from './pages/Extraction'
import ExtractProfile from './pages/ExtractProfile'
import Activate from './pages/Activate'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<InfluencerList />} />
        <Route path="/extraction" element={<Extraction />} />
        <Route path="/extract-profile" element={<ExtractProfile />} />
        <Route path="/influencer/:handle" element={<InfluencerDetail />} />
        <Route path="/activate/:handle" element={<Activate />} />
      </Routes>
    </Layout>
  )
}
