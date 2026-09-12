
import { Capacitor, CapacitorHttp } from '@capacitor/core'

const DEV = import.meta.env.DEV
const PROXY_PATH = '/__cors'
const TARGET_HEADER = 'x-cors-target'

async function nativeRequest(url: string, init: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {}
  new Headers(init.headers).forEach((v, k) => (headers[k] = v))

  if (!('user-agent' in headers)) {
    headers['User-Agent'] =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    headers['Accept-Language'] = 'en-US,en;q=0.9'
    headers['sec-ch-ua'] = '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"'
    headers['sec-ch-ua-mobile'] = '?0'
    headers['sec-ch-ua-platform'] = '"Windows"'
  }

  let data: unknown = init.body
  if (typeof data === 'string' && (headers['Content-Type'] ?? headers['content-type'] ?? '').includes('json')) {
    try {
      data = JSON.parse(data)
    } catch {
      /* leave as string */
    }
  }
  const res = await CapacitorHttp.request({
    url,
    method: (init.method ?? 'GET').toUpperCase(),
    headers,
    data: init.method && init.method.toUpperCase() !== 'GET' ? data : undefined,
  }).catch((e: unknown) => {
    throw new Error(`native HTTP (CapacitorHttp) request to ${url} failed: ${(e as Error)?.message ?? String(e)}`)
  })
  const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '')
  return new Response(text, { status: res.status })
}

function configuredProxy(): string {
  try {
    const s = JSON.parse(localStorage.getItem('opx.settings') ?? '{}')
    return (s.proxyUrl ?? '').trim().replace(/\/$/, '')
  } catch {
    return ''
  }
}

export function isLocalTarget(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|.*\.local)(:|\/|$)/i.test(url)
}

export class NetError extends Error {
  constructor(
    message: string,
    public kind: 'cors' | 'mixed-content' | 'network' = 'network',
  ) {
    super(message)
  }
}

export async function corsFetch(targetUrl: string, init: RequestInit = {}, opts: { buffered?: boolean } = {}): Promise<Response> {
  const headers = new Headers(init.headers)

  if (DEV) {
    headers.set(TARGET_HEADER, targetUrl)
    return fetch(PROXY_PATH, { ...init, headers })
  }

  if (typeof window !== 'undefined' && (window as unknown as { __OPENPLEX_SELFHOST?: boolean }).__OPENPLEX_SELFHOST) {
    headers.set(TARGET_HEADER, targetUrl)
    return fetch(PROXY_PATH, { ...init, headers })
  }

  const proxy = configuredProxy()
  if (proxy) {
    headers.set(TARGET_HEADER, targetUrl)
    return fetch(`${proxy}/__cors`, { ...init, headers })
  }

  const native = Capacitor.isNativePlatform()

  if (opts.buffered && native) {
    return nativeRequest(targetUrl, init)
  }

  if (!native && isLocalTarget(targetUrl) && location.protocol === 'https:') {
    throw new NetError(
      'A local model server (localhost) can’t be reached from this hosted page. Run openplex locally, or set a proxy URL in Settings → Providers → Connection.',
      'mixed-content',
    )
  }

  return await fetch(targetUrl, init)
}

export function usingProxy(): boolean {
  return DEV || Boolean(configuredProxy())
}

export function isNative(): boolean {
  return Capacitor.isNativePlatform()
}
