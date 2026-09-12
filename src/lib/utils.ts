export function uid(): string {
  return crypto.randomUUID()
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function formatCost(usd: number): string {
  if (usd === 0) return '$0'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  if (usd < 1) return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(2)}`
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`
  return String(n)
}

export function formatContext(n?: number): string {
  if (!n) return ''
  return formatTokens(n)
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function safeHref(url: string | undefined): string {
  if (!url) return '#'
  try {
    return /^(https?|mailto):$/.test(new URL(url, location.origin).protocol) ? url : '#'
  } catch {
    return '#'
  }
}

const faviconCache = new Map<string, string>()

export function faviconFor(url: string): string {
  const cached = faviconCache.get(url)
  if (cached !== undefined) return cached
  const result = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostOf(url))}&sz=64`
  faviconCache.set(url, result)
  return result
}

export function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(ts).toLocaleDateString()
}

export type DateGroup = 'Pinned' | 'Today' | 'Yesterday' | 'This week' | 'This month' | 'Older'

export function dateGroupOf(ts: number): Exclude<DateGroup, 'Pinned'> {
  const now = new Date()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (ts >= startOfDay) return 'Today'
  if (ts >= startOfDay - 86_400_000) return 'Yesterday'
  if (ts >= startOfDay - 6 * 86_400_000) return 'This week'
  if (ts >= startOfDay - 29 * 86_400_000) return 'This month'
  return 'Older'
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let t: ReturnType<typeof setTimeout> | undefined
  return (...args: A) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
}

export function extractJsonArray(text: string): unknown[] | null {
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[0])
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
