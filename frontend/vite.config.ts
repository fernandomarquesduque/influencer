import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Dev: encaminha /p/*, /influenciadores e sitemaps SEO para o backend. */
function seoDevProxyPlugin(apiTarget: string): Plugin {
  return {
    name: 'seo-dev-proxy',
    configureServer(server) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => {
        const rawUrl = req.url ?? ''
        const pathOnly = rawUrl.split('?')[0] ?? ''
        const isSeo =
          pathOnly.startsWith('/p/') ||
          pathOnly === '/influenciadores' ||
          pathOnly.startsWith('/influenciadores?') ||
          pathOnly.startsWith('/sitemap-influencers') ||
          pathOnly.startsWith('/sitemap-posts')
        if (!isSeo) {
          next()
          return
        }
        const targetPath = `/api/seo${rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`}`
        console.log('[seo-dev-proxy]', req.method, rawUrl, '→', targetPath)
        const target = new URL(targetPath, apiTarget.endsWith('/') ? apiTarget : `${apiTarget}/`)
        fetch(target.href, {
          method: req.method ?? 'GET',
          headers: { Accept: req.headers.accept ?? 'text/html,*/*' },
        })
          .then(async (upstream) => {
            console.log('[seo-dev-proxy] upstream', target.href, upstream.status)
            res.statusCode = upstream.status
            const ct = upstream.headers.get('content-type')
            if (ct) res.setHeader('Content-Type', ct)
            const cache = upstream.headers.get('cache-control')
            if (cache) res.setHeader('Cache-Control', cache)
            const buf = Buffer.from(await upstream.arrayBuffer())
            if (upstream.status >= 400) {
              console.log('[seo-dev-proxy] body', buf.toString('utf8').slice(0, 200))
            }
            res.end(buf)
          })
          .catch((err) => {
            res.statusCode = 502
            res.setHeader('Content-Type', 'text/plain; charset=utf-8')
            res.end(`SEO proxy error: ${err instanceof Error ? err.message : String(err)}`)
          })
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '')
  /** Para publicar em subpasta (ex.: IIS em weappi.com/influencer): VITE_BASE_PATH=/influencer/ */
  const base = env.VITE_BASE_PATH ?? '/'
  /** Dev local: proxy /api → backend. Produção: https://buscainfluencer.com.br */
  const apiProxyTarget = env.VITE_API_PROXY_TARGET?.trim() || 'http://127.0.0.1:3500'

  const apiProxy: ProxyOptions = {
    target: apiProxyTarget,
    changeOrigin: true,
    secure: false,
  }

  return {
    base,
    plugins: [react(), seoDevProxyPlugin(apiProxyTarget)],
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
        '/api': apiProxy,
      },
    },
  }
})
