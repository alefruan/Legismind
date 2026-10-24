import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Em desenvolvimento, atende /api/* com o mesmo roteador usado pela função da
 * Vercel (server/http/router.ts), sem precisar do `vercel dev`.
 */
function devApi(): Plugin {
  return {
    name: 'legismind-dev-api',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      const env = loadEnv(server.config.mode, process.cwd(), '')
      for (const [key, value] of Object.entries(env)) {
        if (process.env[key] === undefined) process.env[key] = value
      }
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (!req.url?.startsWith('/api/')) return next()
        try {
          const mod = (await server.ssrLoadModule('/server/http/router.ts')) as typeof import('./server/http/router')
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(chunk as Buffer)
          const body = chunks.length ? Buffer.concat(chunks) : undefined
          const controller = new AbortController()
          res.on('close', () => {
            if (!res.writableFinished) controller.abort()
          })
          const request = new Request(new URL(req.url, `http://${req.headers.host ?? 'localhost'}`), {
            method: req.method,
            headers: req.headers as Record<string, string>,
            body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
            signal: controller.signal,
          })
          const response = await mod.handleApiRequest(request)
          res.statusCode = response.status
          response.headers.forEach((value, key) => res.setHeader(key, value))
          if (!response.body) return res.end()
          const reader = response.body.getReader()
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            res.write(value)
          }
          res.end()
        } catch (error) {
          server.config.logger.error(`[api] ${(error as Error).stack ?? error}`)
          if (!res.headersSent) {
            res.statusCode = 500
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ error: { code: 'internal', message: 'Erro interno no servidor de desenvolvimento.' } }))
          } else {
            res.end()
          }
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), devApi()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@shared': path.resolve(import.meta.dirname, 'shared'),
    },
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
})
