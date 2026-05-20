import type { ReactNode } from 'react'
import {
  BarChartOutlined,
  EyeOutlined,
  FileTextOutlined,
} from '@ant-design/icons'

export type InfluencerLoginFeature = {
  key: string
  icon: ReactNode
  title: string
  description: string
}

export const INFLUENCER_LOGIN_FEATURES: InfluencerLoginFeature[] = [
  {
    key: 'instagram',
    icon: '@',
    title: 'Acesse com seu Instagram',
    description: 'Digite seu @ e conecte seu perfil em segundos.',
  },
  {
    key: 'metrics',
    icon: <BarChartOutlined />,
    title: 'Veja suas métricas',
    description: 'Acompanhe seu crescimento e engajamento.',
  },
  {
    key: 'mediakit',
    icon: <FileTextOutlined />,
    title: 'Mídia Kit automático',
    description: 'Gere um mídia kit profissional em poucos cliques.',
  },
  {
    key: 'visibility',
    icon: <EyeOutlined />,
    title: 'Ganhe visibilidade para marcas',
    description: 'Seu perfil visível para agências e empresas.',
  },
]
