/**
 * Phone ↔ PC pairing codes.
 *
 * The code is base64 JSON that travels by copy-paste, which means it passes through a phone
 * keyboard — and two things there used to break it outright:
 *
 *  - `btoa` throws on any character above U+00FF, so naming your computer "Owner’s PC" (a curly
 *    apostrophe, which Windows and phones both autocorrect into) produced no code at all.
 *  - Mobile keyboards auto-capitalise the first letter of a text field. Base64 is case-sensitive,
 *    so "eyJ1cmwi…" silently became "EyJ1cmwi…" — still valid base64, so it decoded happily into
 *    garbage and failed at JSON.parse with "invalid code".
 */

export interface PairingPayload {
  url: string
  anonKey: string
  refreshToken: string
  deviceToken: string
  deviceName?: string
  label?: string
  pairedAt?: number
}

export type PairingResult =
  | { ok: true; payload: PairingPayload; repaired?: 'case' }
  | { ok: false; reason: 'unreadable' | 'incomplete' }

const REQUIRED = ['url', 'anonKey', 'refreshToken', 'deviceToken'] as const

/** UTF-8 → base64, so any device name or phone label survives. */
export function encodePairing(payload: PairingPayload): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function base64ToText(code: string): string | null {
  // Tolerate what transports do to a code: wrapped lines, stray spaces, base64url substitution
  // from anything that put it in a URL, and padding a chat app may have trimmed.
  let s = code.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  if (!s || /[^A-Za-z0-9+/=]/.test(s)) return null
  s = s.replace(/=+$/, '')
  if (s.length % 4 === 1) return null
  s += '='.repeat((4 - (s.length % 4)) % 4)
  try {
    const binary = atob(s)
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  } catch {
    return null
  }
}

function parse(code: string): PairingPayload | null {
  const text = base64ToText(code)
  if (!text) return null
  try {
    const parsed = JSON.parse(text) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as PairingPayload) : null
  } catch {
    return null
  }
}

export function decodePairing(code: string): PairingResult {
  const trimmed = (code ?? '').trim()
  if (!trimmed) return { ok: false, reason: 'unreadable' }

  let payload = parse(trimmed)
  let repaired: 'case' | undefined

  // The one mangling we can undo with certainty: a keyboard capitalised the leading character.
  if (!payload && /^[A-Za-z]/.test(trimmed)) {
    const first = trimmed[0]
    const flipped = (first === first.toLowerCase() ? first.toUpperCase() : first.toLowerCase()) + trimmed.slice(1)
    payload = parse(flipped)
    if (payload) repaired = 'case'
  }

  if (!payload) return { ok: false, reason: 'unreadable' }
  for (const field of REQUIRED) {
    if (typeof payload[field] !== 'string' || !payload[field]) return { ok: false, reason: 'incomplete' }
  }
  return repaired ? { ok: true, payload, repaired } : { ok: true, payload }
}
