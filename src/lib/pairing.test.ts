import { describe, expect, it } from 'vitest'
import { decodePairing, encodePairing, type PairingPayload } from './pairing'

const payload: PairingPayload = {
  url: 'https://abcdefg.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig',
  refreshToken: 'v1.MRq7-x_Token',
  deviceToken: 'deadbeefdeadbeefdeadbeef',
  deviceName: 'my computer',
  label: 'Phone',
  pairedAt: 1_700_000_000_000,
}

const ok = (code: string) => {
  const r = decodePairing(code)
  if (!r.ok) throw new Error(`expected success, got ${r.reason}`)
  return r
}

describe('pairing round trip', () => {
  it('encodes and decodes unchanged', () => {
    expect(ok(encodePairing(payload)).payload).toEqual(payload)
  })

  it('survives a device name that btoa alone would reject', () => {
    // A curly apostrophe is what Windows and phone keyboards autocorrect a straight quote into,
    // and it used to make the PC throw before it could show a code at all.
    const fancy = { ...payload, deviceName: 'Owner’s PC 💻', label: 'Ayaan’s phone' }
    expect(() => btoa(JSON.stringify(fancy))).toThrow()
    expect(ok(encodePairing(fancy)).payload).toEqual(fancy)
  })
})

describe('decodePairing recovers from transport damage', () => {
  const code = encodePairing(payload)

  it('undoes a mobile keyboard capitalising the first letter', () => {
    const mangled = code[0].toUpperCase() + code.slice(1)
    expect(mangled).not.toBe(code)
    const r = ok(mangled)
    expect(r.payload).toEqual(payload)
    expect(r.repaired).toBe('case')
  })

  it('ignores whitespace and line wrapping from a chat app', () => {
    const wrapped = `${code.slice(0, 40)}\n  ${code.slice(40, 90)} \n${code.slice(90)}`
    expect(ok(wrapped).payload).toEqual(payload)
  })

  it('accepts base64url, as a code that went through a URL comes back', () => {
    expect(ok(code.replace(/\+/g, '-').replace(/\//g, '_')).payload).toEqual(payload)
  })

  it('accepts a code whose padding was stripped', () => {
    expect(ok(code.replace(/=+$/, '')).payload).toEqual(payload)
  })
})

describe('decodePairing rejects', () => {
  it('an empty or obviously wrong string', () => {
    expect(decodePairing('')).toEqual({ ok: false, reason: 'unreadable' })
    expect(decodePairing('hello there!')).toEqual({ ok: false, reason: 'unreadable' })
  })

  it('valid base64 that is not a pairing payload', () => {
    expect(decodePairing(btoa('{"hello":"world"}'))).toEqual({ ok: false, reason: 'incomplete' })
  })

  it('a payload missing the fields the phone needs, distinctly from garbage', () => {
    const partial = encodePairing({ ...payload, refreshToken: '' })
    expect(decodePairing(partial)).toEqual({ ok: false, reason: 'incomplete' })
  })

  it('a truncated code', () => {
    expect(decodePairing(encodePairing(payload).slice(0, 30)).ok).toBe(false)
  })
})
