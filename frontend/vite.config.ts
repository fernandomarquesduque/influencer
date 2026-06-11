import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '')
  /** Para publicar em subpasta (ex.: IIS em weappi.com/influencer): VITE_BASE_PATH=/influencer/ */
  const base = env.VITE_BASE_PATH ?? '/'
  /** Dev local: proxy /api → backend. Produção: https://buscainfluencer.com.br */
  const apiProxyTarget = env.VITE_API_PROXY_TARGET?.trim() || 'http://localhost:3500'

  return {
    base,
    plugins: [react()],
    resolve: {
      alias: {
        /** Patamares nano→celebridade: mesma fonte que o backend (`followersSizeBuckets.ts`). */
        '@repo/followersSizeBuckets': path.resolve(__dirname, '../backend/src/api/followersSizeBuckets.ts'),
        '@repo/mainCategoryTaxonomy': path.resolve(__dirname, '../backend/src/lib/mainCategoryTaxonomy.ts'),
      },
    },
    server: {
      port: 5173,
      host: true, // escuta em 0.0.0.0 para acesso pela rede (ex.: IP público)
      allowedHosts: true, // permite túnel localtunnel (*.loca.lt) e outros hosts
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
          secure: true,
        },
      },
    },
  }
})
