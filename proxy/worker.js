
const SECRET_PLACEHOLDER = 'CHANGE_ME_TO_A_RANDOM_STRING'
const SECRET = SECRET_PLACEHOLDER

const HOP_BY_HOP = new Set([
  'host', 'connection', 'content-length', 'accept-encoding', 'x-cors-target', 'origin', 'referer',
])

function isBlockedHost(host) {
  const h = (host || '').toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h === '0.0.0.0' || h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  return a === 127 || a === 10 || a === 0 || (a === 169 && b === 254) || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)
}

export default {
  async fetch(request) {
    const url = new URL(request.url)
    const cors = {
      'access-control-allow-origin': request.headers.get('origin') || '*',
      'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'access-control-allow-headers': request.headers.get('access-control-request-headers') || '*',
      'access-control-max-age': '86400',
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

    if (!SECRET || SECRET === SECRET_PLACEHOLDER) {
      return new Response(
        'openplex proxy is not configured: edit proxy/worker.js and set SECRET to your own random string before deploying.',
        { status: 503, headers: { 'content-type': 'text/plain', ...cors } },
      )
    }

    let path = url.pathname
    if (SECRET) {
      const prefix = '/' + SECRET
      if (path !== prefix && !path.startsWith(prefix + '/')) {
        return new Response('forbidden', { status: 403, headers: cors })
      }
      path = path.slice(prefix.length) || '/'
    }

    if (!path.startsWith('/__cors')) {
      return new Response('openplex proxy is running. Point openplex at this URL (including the secret path).', {
        status: 200,
        headers: { 'content-type': 'text/plain', ...cors },
      })
    }

    const target = request.headers.get('x-cors-target')
    if (!target || !/^https:\/\//i.test(target)) {
      return new Response('missing or disallowed x-cors-target (https only)', { status: 400, headers: cors })
    }
    if (isBlockedHost(new URL(target).hostname)) {
      return new Response('disallowed target host', { status: 403, headers: cors })
    }

    const headers = new Headers()
    for (const [k, v] of request.headers) {
      if (!HOP_BY_HOP.has(k.toLowerCase())) headers.set(k, v)
    }

    const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
    const body = hasBody ? await request.arrayBuffer() : undefined

    let upstream
    try {
      upstream = await fetch(target, { method: request.method, headers, body, redirect: 'follow' })
    } catch (err) {
      return new Response(JSON.stringify({ error: { message: `proxy could not reach ${target}: ${err}` } }), {
        status: 502,
        headers: { 'content-type': 'application/json', ...cors },
      })
    }

    const respHeaders = new Headers(upstream.headers)
    for (const h of ['content-encoding', 'content-length', 'transfer-encoding']) respHeaders.delete(h)
    for (const k of [...respHeaders.keys()]) if (k.toLowerCase().startsWith('access-control-')) respHeaders.delete(k)
    for (const [k, v] of Object.entries(cors)) respHeaders.set(k, v)

    return new Response(upstream.body, { status: upstream.status, headers: respHeaders })
  },
}
