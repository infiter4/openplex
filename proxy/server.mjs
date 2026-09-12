#!/usr/bin/env node
import http from 'node:http'
import { Readable } from 'node:stream'

const PORT = process.env.PORT || 8787
const HOST = process.env.HOST || '127.0.0.1'
const HOP_BY_HOP = new Set(['host', 'connection', 'content-length', 'accept-encoding', 'x-cors-target', 'origin', 'referer'])

const ALLOW_LOCAL = process.env.OPENPLEX_ALLOW_LOCAL !== '0'

function isBlockedHost(host) {
  const h = (host || '').toLowerCase().replace(/^\[|\]$/g, '')
  if (h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  return a === 127 || a === 10 || a === 0 || (a === 169 && b === 254) || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)
}

function allowedTarget(url) {
  try {
    const u = new URL(url)
    const localHttp = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/.test(u.hostname)
    if (u.protocol === 'http:') return ALLOW_LOCAL && localHttp
    if (u.protocol === 'https:') return !isBlockedHost(u.hostname)
    return false
  } catch {
    return false
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('access-control-allow-origin', req.headers.origin || '*')
  res.setHeader('access-control-allow-methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.setHeader('access-control-allow-headers', req.headers['access-control-request-headers'] || '*')
  res.setHeader('access-control-max-age', '86400')

  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }
  if (!req.url.startsWith('/__cors')) {
    res.statusCode = 200
    res.setHeader('content-type', 'text/plain')
    res.end('openplex proxy is running. Point openplex at this URL.')
    return
  }

  const target = req.headers['x-cors-target']
  if (typeof target !== 'string' || !allowedTarget(target)) {
    res.statusCode = 400
    res.end('missing or disallowed x-cors-target')
    return
  }

  const chunks = []
  for await (const c of req) chunks.push(c)
  const body = chunks.length ? Buffer.concat(chunks) : undefined

  const headers = {}
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
      if (k !== 'content-encoding' && k !== 'content-length' && k !== 'transfer-encoding' && !k.startsWith('access-control-')) {
        res.setHeader(key, value)
      }
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
})

server.listen(PORT, HOST, () => {
  console.log(`openplex proxy listening on http://${HOST}:${PORT}`)
  console.log(`  → set this URL in openplex Settings → Providers → Connection`)
  console.log(`  → local model servers ${ALLOW_LOCAL ? 'allowed' : 'blocked'} (OPENPLEX_ALLOW_LOCAL=${ALLOW_LOCAL ? '1' : '0'})`)
})
