
export interface EncryptedBlob {
  v: 1
  salt: string
  iv: string
  ct: string
}

const enc = new TextEncoder()
const dec = new TextDecoder()

function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function unb64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 210_000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptJson(passphrase: string, data: unknown): Promise<EncryptedBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(passphrase, salt)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, enc.encode(JSON.stringify(data)))
  return { v: 1, salt: b64(salt), iv: b64(iv), ct: b64(ct) }
}

export async function decryptJson<T>(passphrase: string, blob: EncryptedBlob): Promise<T> {
  const key = await deriveKey(passphrase, unb64(blob.salt))
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(blob.iv) as BufferSource },
    key,
    unb64(blob.ct) as BufferSource,
  )
  return JSON.parse(dec.decode(pt)) as T
}
