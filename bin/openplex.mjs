#!/usr/bin/env node
import http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { dirname, extname, join, normalize } from 'node:path'
import { spawn } from 'node:child_process'
import { createExecutor } from './executor.mjs'
import { createRelayManager } from './relay-manager.mjs'
import { allowedTarget } from './ssrf-guard.mjs'

const SUBCOMMAND = process.argv[2]
if (SUBCOMMAND === 'autostart') {
  const { autostart } = await import('./autostart.mjs')
  await autostart(process.argv.slice(3))
  process.exit(0)
}

const AGENT_MODE = SUBCOMMAND === 'agent'
if (AGENT_MODE) await import('./agent.mjs')

const here = dirname(fileURLToPath(import.meta.url))
const DIST = join(here, '..', 'dist')
const portArg = Number(process.argv[process.argv.indexOf('--port') + 1])
const PORT = (process.argv.includes('--port') && Number.isFinite(portArg) ? portArg : Number(process.env.PORT)) || 43210
// Both loopback families. "localhost" resolves to ::1 first on Windows, so binding it alone left
// http://127.0.0.1:PORT refused — confusing when something (or someone) reaches for the v4 address.
const HOSTS = process.env.HOST ? [process.env.HOST] : ['127.0.0.1', '::1']

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.map': 'application/json', '.txt': 'text/plain',
}
const HOP = new Set(['host', 'connection', 'content-length', 'accept-encoding', 'x-cors-target', 'origin', 'referer'])

const SELFHOST_TAG = '<script>window.__OPENPLEX_SELFHOST=true</script>'

async function loadIndex() {
  const html = await readFile(join(DIST, 'index.html'), 'utf8')
  return html.includes('__OPENPLEX_SELFHOST') ? html : html.replace('</head>', `${SELFHOST_TAG}</head>`)
}

async function serveStatic(req, res) {
  const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (pathname === '/' || pathname === '/index.html') {
    res.setHeader('content-type', MIME['.html'])
    return res.end(await loadIndex())
  }
  const file = normalize(join(DIST, pathname))
  if (!file.startsWith(DIST)) {
    res.statusCode = 403
    return res.end('forbidden')
  }
  try {
    const s = await stat(file)
    if (s.isDirectory()) throw new Error('dir')
    res.setHeader('content-type', MIME[extname(file)] || 'application/octet-stream')
    res.setHeader('cache-control', extname(file) === '.html' ? 'no-cache' : 'public, max-age=31536000')
    return res.end(await readFile(file))
  } catch {
    res.setHeader('content-type', MIME['.html'])
    return res.end(await loadIndex())
  }
}

async function proxy(req, res) {
  const target = req.headers['x-cors-target']
  if (typeof target !== 'string') {
    res.statusCode = 400
    return res.end('missing x-cors-target')
  }
  if (!allowedTarget(target)) {
    res.statusCode = 400
    return res.end('disallowed x-cors-target (only public https or local model servers)')
  }
  const chunks = []
  for await (const c of req) chunks.push(c)
  const body = chunks.length ? Buffer.concat(chunks) : undefined
  const headers = {}
  for (const [k, v] of Object.entries(req.headers)) {
    if (!HOP.has(k.toLowerCase()) && typeof v === 'string') headers[k] = v
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
      const stream = Readable.fromWeb(upstream.body)
      stream.on('error', () => {})
      res.on('error', () => {})
      stream.pipe(res)
    } else res.end()
  } catch (err) {
    if (ac.signal.aborted || res.headersSent || res.writableEnded) return
    res.statusCode = 502
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: { message: `proxy could not reach ${target}: ${err.message}` } }))
  }
}

if (!AGENT_MODE) {
const execExecutor = createExecutor({})
const relayManager = createRelayManager(execExecutor, { log: (m) => console.log('[relay]', m) })
async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch { return null }
}
function isLoopbackAddr(a) {
  if (!a) return false
  a = String(a).toLowerCase()
  return a === '::1' || a === '127.0.0.1' || a.startsWith('127.') || a.startsWith('::ffff:127.')
}

function isLoopbackHost(hostHeader) {
  const h = hostHeader.replace(/:\d+$/, '').replace(/^\[|\]$/g, '')
  return h === 'localhost' || h === '127.0.0.1' || h === '::1'
}

// Connection must be loopback, Host must be a loopback name (blocks DNS-rebinding), and the request
// must be same-origin — Origin matches Host, or (no Origin) the browser marks it same-origin via
// Sec-Fetch-Site. A no-signal request is refused. Closes the CSRF-to-RCE path on a missing Origin.
function localExecAllowed(req) {
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

async function execHandler(req, res) {
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('POST only') }
  const job = await readBody(req)
  if (!job) { res.statusCode = 400; return res.end('bad json') }
  const result = await execExecutor.exec({ tool: job.tool, input: job.input, threadId: job.threadId })
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(result))
}
async function agentHandler(req, res) {
  res.setHeader('content-type', 'application/json')
  if (req.method === 'GET') return res.end(JSON.stringify({ ok: true, devices: relayManager.list() }))
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('{"ok":false}') }
  const body = await readBody(req)
  if (body?.action === 'list') return res.end(JSON.stringify({ ok: true, devices: relayManager.list() }))
  if (body?.action === 'remove') {
    await relayManager.remove(body.deviceToken)
    return res.end(JSON.stringify({ ok: true, devices: relayManager.list() }))
  }
  const r = await relayManager.pair(body?.pair)
  if (r.ok) console.log(`\n  ◆ phone relay running for "${r.deviceName ?? 'this computer'}"\n`)
  if (!r.ok) res.statusCode = 400
  res.end(JSON.stringify({ ...r, devices: relayManager.list() }))
}

const handler = (req, res) => {
  if (req.url.startsWith('/__cors')) return proxy(req, res)
  if (req.url.startsWith('/__exec') || req.url.startsWith('/__agent')) {
    if (!localExecAllowed(req)) {
      res.statusCode = 403
      res.setHeader('content-type', 'application/json')
      return res.end('{"ok":false,"error":"forbidden — compute is local same-origin only"}')
    }
  }
  if (req.url.startsWith('/__exec')) return execHandler(req, res).catch(() => { res.statusCode = 500; res.end('exec error') })
  if (req.url.startsWith('/__agent')) return agentHandler(req, res).catch(() => { res.statusCode = 500; res.end('{"ok":false}') })
  return serveStatic(req, res).catch(() => {
    res.statusCode = 500
    res.end('server error')
  })
}

stat(join(DIST, 'index.html')).catch(() => {
  console.error('openplex: dist/ not found. If running from source, build first: npm run build')
  process.exit(1)
})

let announced = false
let bound = 0
let pending = HOSTS.length
for (const host of HOSTS) {
  const server = http.createServer(handler)
  server.on('error', (err) => {
    // One family missing (or already taken) is survivable; all of them failing is not.
    if (--pending === 0 && bound === 0) {
      console.error(`openplex: could not listen on port ${PORT} — ${err.message}`)
      process.exit(1)
    }
  })
  server.listen(PORT, host, () => {
    pending--
    bound++
    if (announced) return
    announced = true
    onReady()
  })
}

function onReady() {
  const url = `http://localhost:${PORT}`
  console.log(`\n  ◆ openplex running at \x1b[36m${url}\x1b[0m`)
  console.log(`  → your keys, every model. Provider calls are auto-proxied (no CORS setup).\n`)
  void relayManager.startAll().then((res) => {
    const live = res.filter((r) => r.ok).length
    if (live) console.log(`  ◆ reconnected ${live} paired phone${live > 1 ? 's' : ''} for computer use\n`)
  })
  // --no-open is what the autostart launcher passes: at login you want it running, not popping up.
  if (!process.env.NO_OPEN && !process.argv.includes('--no-open')) {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
    const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
    try {
      spawn(cmd, args, { stdio: 'ignore', detached: true }).unref()
    } catch {
      /* user can open it manually */
    }
  }
}
}
