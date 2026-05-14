import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Para publicar em subpasta (ex.: IIS em weappi.com/influencer): VITE_BASE_PATH=/influencer/ */
const base = process.env.VITE_BASE_PATH ?? '/'

export default defineConfig({
  base,
  plugins: [react()],
  resolve: {
    alias: {
      /** Patamares nano→celebridade: mesma fonte que o backend (`followersSizeBuckets.ts`). */
      '@repo/followersSizeBuckets': path.resolve(__dirname, '../backend/src/api/followersSizeBuckets.ts'),
      '@repo/llmMainCategoryTaxonomy': path.resolve(__dirname, '../backend/src/lib/mainCategoryTaxonomy.ts'),
    },
  },
  server: {
    port: 5173,
    host: true, // escuta em 0.0.0.0 para acesso pela rede (ex.: IP público)
    allowedHosts: true, // permite túnel localtunnel (*.loca.lt) e outros hosts
    proxy: {
      '/api': {
        target: 'http://localhost:3500',
        changeOrigin: true,
      },
    },
  },
})
