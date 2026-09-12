// Shared SSRF guard for the CORS proxies (dev server + CLI self-host). Allows public HTTPS hosts
// and, optionally, local HTTP model servers (Ollama / LM Studio) — but blocks loopback, link-local,
// private, and cloud-metadata targets so a page the user is visiting can't drive the proxy into
// their internal network. Mirrors proxy/server.mjs; keep them in sync.

export function isBlockedHost(host) {
  const h = (host || '').toLowerCase().replace(/^\[|\]$/g, '')
  // IPv6 loopback/link-local/unique-local + IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1)
  if (h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('::ffff:')) return true
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  return a === 127 || a === 10 || a === 0 || (a === 169 && b === 254) || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)
}

// allowLocal lets the dev/CLI proxy reach a local model server over http://localhost; everything
// else must be https to a non-blocked host. Returns false for any other scheme or a parse failure.
export function allowedTarget(url, { allowLocal = true } = {}) {
  try {
    const u = new URL(url)
    const localHttp = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/.test(u.hostname)
    if (u.protocol === 'http:') return allowLocal && localHttp
    if (u.protocol === 'https:') return !isBlockedHost(u.hostname)
    return false
  } catch {
    return false
  }
}
