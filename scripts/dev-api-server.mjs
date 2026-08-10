// Локальный сервер onboarding-API для прототипа: собирает edge-хендлеры esbuild'ом
// и отдаёт их на localhost:8788. Vite (npm run dev:proto) проксирует сюда
// /api/support/onboarding*, остальное — на прод, как обычно.
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import dotenv from 'dotenv'

dotenv.config({ path: new URL('../.env.local', import.meta.url).pathname })

const ENTRIES = {
  index: 'api/support/onboarding/index.ts',
  tasks: 'api/support/onboarding/tasks.ts',
  refs: 'api/support/onboarding/refs.ts',
  card: 'api/support/onboarding/card.ts',
  stats: 'api/support/onboarding/stats.ts',
}

const outdir = mkdtempSync(join(tmpdir(), 'ob-api-'))
await build({
  entryPoints: Object.fromEntries(Object.entries(ENTRIES).map(([k, v]) => [k, v])),
  outdir,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outExtension: { '.js': '.mjs' },
  logLevel: 'error',
})

const handlers = {}
for (const key of Object.keys(ENTRIES)) {
  handlers[key] = (await import(pathToFileURL(join(outdir, `${key}.mjs`)).href)).default
}

function route(pathname) {
  if (pathname === '/api/support/onboarding' || pathname === '/api/support/onboarding/') return handlers.index
  if (pathname.startsWith('/api/support/onboarding/tasks')) return handlers.tasks
  if (pathname.startsWith('/api/support/onboarding/refs')) return handlers.refs
  if (pathname.startsWith('/api/support/onboarding/card')) return handlers.card
  if (pathname.startsWith('/api/support/onboarding/stats')) return handlers.stats
  return null
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost:8788')
    const handler = route(url.pathname)
    if (!handler) {
      res.writeHead(404).end('not found')
      return
    }
    const chunks = []
    for await (const c of req) chunks.push(c)
    const body = chunks.length ? Buffer.concat(chunks) : undefined
    const request = new Request(url.href, {
      method: req.method,
      headers: req.headers,
      body: body && req.method !== 'GET' && req.method !== 'HEAD' ? body : undefined,
    })
    const response = await handler(request)
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()))
    res.end(Buffer.from(await response.arrayBuffer()))
  } catch (e) {
    console.error(e)
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: String(e?.message || e) }))
  }
})

server.listen(8788, () => console.log('onboarding proto API on http://localhost:8788'))
