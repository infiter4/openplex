import { defineConfig, type Connect, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { Readable } from 'node:stream'
import { createExecutor } from './bin/executor.mjs'
import { createRelayManager } from './bin/relay-manager.mjs'
import { allowedTarget } from './bin/ssrf-guard.mjs'

// Headers we must NOT forward upstream. Beyond the usual hop-by-hop set we strip browser-injected
// headers — above all `cookie`, which on the same-origin /__cors fetch carries the app's Supabase
// session (a multi-KB token). Forwarding it leaks auth to every provider AND trips strict gateways
// that reject an oversized cookie/header block with an (empty-body) 400 — exactly z.ai's failure.
const HOP_BY_HOP = new Set([
  'host', 'connection', 'content-length', 'accept-encoding', 'x-cors-target', 'origin', 'referer',
  'cookie', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform',
  'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'sec-fetch-user',
])

function corsProxy(): Plugin {
  const handler: Connect.SimpleHandleFunction = async (req, res) => {
    const target = req.headers['x-cors-target']
    if (typeof target !== 'string') {
      res.statusCode = 400
      res.end('missing x-cors-target')
      return
    }
    if (!allowedTarget(target)) {
      res.statusCode = 400
      res.end('disallowed x-cors-target (only public https or local model servers)')
      return
    }
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const body = chunks.length ? Buffer.concat(chunks) : undefined

    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(req.headers)) {
      if (!HOP_BY_HOP.has(k.toLowerCase()) && typeof v === 'string') headers[k] = v
    }

    const ac = new AbortController()
    res.on('close', () => ac.abort())

    try {
      const upstream = await fetch(target, { method: req.method, headers, body, signal: ac.signal })
      res.statusCode = upstream.status
      upstream.headers.forEach((value, key) => {
        const k = key.toLowerCase()
        if (k !== 'content-encoding' && k !== 'content-length' && k !== 'transfer-encoding') res.setHeader(key, value)
      })
      if (upstream.body) {
        const stream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0])
        stream.on('error', () => {})
        res.on('error', () => {})
        stream.pipe(res)
      } else res.end()
    } catch (err) {
      if (ac.signal.aborted || res.headersSent || res.writableEnded) return
      res.statusCode = 502
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: { message: `proxy could not reach ${target}: ${(err as Error).message}` } }))
    }
  }
  return {
    name: 'openplex-cors-proxy',
    configureServer(server) {
      server.middlewares.use('/__cors', handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/__cors', handler)
    },
  }
}

async function readBody(req: Connect.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch { return null }
}

function isLoopbackAddr(a: string | undefined): boolean {
  if (!a) return false
  a = a.toLowerCase()
  return a === '::1' || a === '127.0.0.1' || a.startsWith('127.') || a.startsWith('::ffff:127.')
}

function isLoopbackHost(hostHeader: string): boolean {
  const h = hostHeader.replace(/:\d+$/, '').replace(/^\[|\]$/g, '')
  return h === 'localhost' || h === '127.0.0.1' || h === '::1'
}

// Gate /__exec and /__agent: the connection must be loopback, the Host header must be a loopback
// name (blocks DNS-rebinding — a malicious site resolving to 127.0.0.1 still sends Host: attacker.com),
// and the request must be same-origin: Origin matches Host, or — with no Origin — the browser flags
// it same-origin via Sec-Fetch-Site. A cross-site page can forge neither, and a no-signal request is
// refused. This closes the CSRF-to-RCE path where a missing Origin previously skipped the check.
function localExecAllowed(req: Connect.IncomingMessage): boolean {
  if (!isLoopbackAddr(req.socket?.remoteAddress)) return false
  const host = String(req.headers.host || '').toLowerCase()
  if (!isLoopbackHost(host)) return false
  const origin = req.headers.origin
  if (origin) {
    try { return new URL(origin).host.toLowerCase() === host } catch { return false }
  }
  const site = String(req.headers['sec-fetch-site'] || '').toLowerCase()
  return site === 'same-origin' || site === 'none'
}

function localExec(): Plugin {
  const executor = createExecutor({})
  const relayManager = createRelayManager(executor, { log: (m: string) => console.log('[relay]', m) })

  const execHandler: Connect.SimpleHandleFunction = async (req, res) => {
    if (!localExecAllowed(req)) { res.statusCode = 403; return res.end('forbidden — compute is local same-origin only') }
    if (req.method !== 'POST') { res.statusCode = 405; return res.end('POST only') }
    const job = await readBody(req)
    if (!job) { res.statusCode = 400; return res.end('bad json') }
    const result = await executor.exec({ tool: job.tool, input: job.input, threadId: job.threadId })
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(result))
  }

  const agentHandler: Connect.SimpleHandleFunction = async (req, res) => {
    res.setHeader('content-type', 'application/json')
    if (!localExecAllowed(req)) { res.statusCode = 403; return res.end('{"ok":false,"error":"forbidden — local same-origin only"}') }
    if (req.method === 'GET') return res.end(JSON.stringify({ ok: true, devices: relayManager.list() }))
    if (req.method !== 'POST') { res.statusCode = 405; return res.end('{"ok":false}') }
    const body = await readBody(req)
    if (body?.action === 'list') return res.end(JSON.stringify({ ok: true, devices: relayManager.list() }))
    if (body?.action === 'remove') {
      await relayManager.remove(body.deviceToken)
      return res.end(JSON.stringify({ ok: true, devices: relayManager.list() }))
    }
    const r = await relayManager.pair(body?.pair)
    if (r.ok) console.log(`[openplex] phone relay running for "${r.deviceName ?? 'this computer'}"`)
    if (!r.ok) res.statusCode = 400
    res.end(JSON.stringify({ ...r, devices: relayManager.list() }))
  }

  let started = false
  const register = (server: { middlewares: { use(path: string, fn: Connect.SimpleHandleFunction): void } }) => {
    server.middlewares.use('/__exec', execHandler)
    server.middlewares.use('/__agent', agentHandler)
    if (!started) {
      started = true
      void relayManager.startAll().then((res) => {
        const live = res.filter((r) => r.ok).length
        if (live) console.log(`[openplex] reconnected ${live} paired phone(s) for computer use`)
      })
    }
  }
  return {
    name: 'openplex-local-exec',
    configureServer: register,
    configurePreviewServer: register,
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), corsProxy(), localExec()],
  server: { port: 43210 },
  preview: { port: 43210 },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('pdfjs-dist') || id.includes('mammoth')) return 'documents'
          if (id.includes('/react-dom/') || id.includes('/react/') || id.includes('/scheduler/')) return 'react-vendor'
        },
      },
    },
  },
})
