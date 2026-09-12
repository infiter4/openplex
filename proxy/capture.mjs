#!/usr/bin/env node
import http from 'node:http'
import { Readable } from 'node:stream'

const PORT = process.env.PORT || 8788
const UPSTREAM = 'https://opencode.ai'
const DROP = new Set(['host', 'connection', 'content-length', 'accept-encoding'])

const server = http.createServer(async (req, res) => {
  const chunks = []
  for await (const c of req) chunks.push(c)
  const body = chunks.length ? Buffer.concat(chunks) : undefined

  console.log('\n===== REQUEST opencode sent =====')
  console.log(req.method, req.url)
  for (const [k, v] of Object.entries(req.headers)) {
    if (/^authorization$/i.test(k)) console.log(`${k}: ${String(v).split(' ')[0]} <redacted>`)
    else if (/api-key/i.test(k)) console.log(`${k}: <redacted>`)
    else console.log(`${k}: ${v}`)
  }
  if (body) console.log('--- body ---\n' + body.toString('utf8'))
  console.log('=================================')

  const headers = {}
  for (const [k, v] of Object.entries(req.headers)) {
    if (!DROP.has(k.toLowerCase()) && typeof v === 'string') headers[k] = v
  }
  try {
    const upstream = await fetch(UPSTREAM + req.url, { method: req.method, headers, body, redirect: 'follow' })
    console.log(`<<< Zen responded HTTP ${upstream.status}\n`)
    res.statusCode = upstream.status
    upstream.headers.forEach((value, key) => {
      const k = key.toLowerCase()
      if (k !== 'content-encoding' && k !== 'content-length' && k !== 'transfer-encoding') res.setHeader(key, value)
    })
    if (upstream.body) Readable.fromWeb(upstream.body).pipe(res)
    else res.end()
  } catch (e) {
    res.statusCode = 502
    res.end(JSON.stringify({ error: { message: String(e) } }))
  }
})
server.listen(PORT, () => console.log(`Zen capture proxy on http://localhost:${PORT} → forwarding to ${UPSTREAM}\nPoint opencode's Zen baseURL here, run it once, then paste the logged request.`))
