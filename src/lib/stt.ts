import { corsFetch, isNative } from './net'
import { isSpeechToText } from './modality'
import { endpointFor, FEATURED_ORDER, isBrowserReady } from './providers'
import type { Catalog, CatalogModel, CatalogProvider, ProviderConnection } from './types'

/** Well-known transcription models the models.dev catalog doesn't list — most notably OpenAI's,
 *  whose catalog entry only carries chat models. Merged in for connected providers so they're
 *  offered even though models.dev omits them. Everything else comes straight from the catalog. */
export const CURATED_STT: Record<string, string[]> = {
  openai: ['gpt-4o-transcribe', 'gpt-4o-mini-transcribe', 'whisper-1'],
  groq: ['whisper-large-v3-turbo', 'whisper-large-v3', 'distil-whisper-large-v3-en'],
  deepinfra: ['openai/whisper-large-v3-turbo', 'openai/whisper-large-v3'],
  'fireworks-ai': ['whisper-v3', 'whisper-v3-turbo'],
}

export interface SttOption {
  providerId: string
  providerName: string
  modelId: string
  modelName: string
  /** The catalog entry when models.dev lists this model — carries cost/context for the picker. */
  model?: CatalogModel
  /** Whether the user has connected this provider (has an API key). */
  connected: boolean
}

/** Every speech-to-text model available to the user: the dedicated audio→text models models.dev
 *  lists for each connected provider, unioned with the curated fallback above. Sorted by provider
 *  then model so the picker groups cleanly. */
export function sttModelsFor(
  catalog: Catalog | null,
  connections: Record<string, ProviderConnection>,
  showAll = false,
): SttOption[] {
  const out: SttOption[] = []
  const seen = new Set<string>()
  const connectedIds = new Set(Object.keys(connections))
  const add = (providerId: string, modelId: string, connected: boolean, model?: CatalogModel) => {
    const key = `${providerId}/${modelId}`
    if (seen.has(key)) return
    seen.add(key)
    const prov = catalog?.[providerId]
    out.push({
      providerId,
      providerName: prov?.name ?? connections[providerId]?.label ?? providerId,
      modelId,
      modelName: model?.name ?? modelId,
      model,
      connected,
    })
  }
  // Mirror the chat model picker: a provider's STT models show when it's connected, browser-ready,
  // or "show all providers" is on — so the whole catalog is browsable and connecting unlocks use.
  const providerIds = new Set<string>([
    ...Object.keys(CURATED_STT),
    ...connectedIds,
    ...(catalog ? Object.keys(catalog) : []),
  ])
  for (const providerId of providerIds) {
    const prov = catalog?.[providerId]
    const connected = connectedIds.has(providerId)
    const ready = connected || showAll || (prov ? isBrowserReady(prov) : providerId in CURATED_STT)
    if (!ready) continue
    for (const id of CURATED_STT[providerId] ?? []) add(providerId, id, connected, prov?.models?.[id])
    if (prov) for (const m of Object.values(prov.models)) if (isSpeechToText(m)) add(providerId, m.id, connected, m)
  }
  // Connected first, then featured providers, then alphabetical — like the chat picker's resting order.
  return out.sort((a, b) => {
    if (a.connected !== b.connected) return a.connected ? -1 : 1
    const fa = FEATURED_ORDER.indexOf(a.providerId)
    const fb = FEATURED_ORDER.indexOf(b.providerId)
    const oa = fa >= 0 ? fa : 999
    const ob = fb >= 0 ? fb : 999
    if (oa !== ob) return oa - ob
    return a.providerName.localeCompare(b.providerName) || a.modelId.localeCompare(b.modelId)
  })
}

/** Transcribe a recorded audio blob via the provider's OpenAI-style `/audio/transcriptions`
 *  endpoint. Pass the catalog provider so the base URL resolves for providers that aren't in the
 *  built-in ENDPOINTS table (alibaba, scaleway, evroc, …). Returns the recognized text. */
export async function transcribe(
  conn: ProviderConnection,
  model: string,
  blob: Blob,
  catalogProvider?: CatalogProvider,
): Promise<string> {
  const ep = endpointFor(conn, catalogProvider, model)
  if (!ep) throw new Error(`No endpoint configured for ${conn.providerId}.`)
  const url = `${ep.baseUrl.replace(/\/$/, '')}/audio/transcriptions`

  const ext = /mp4|m4a/.test(blob.type) ? 'mp4' : /ogg/.test(blob.type) ? 'ogg' : /wav/.test(blob.type) ? 'wav' : 'webm'
  const form = new FormData()
  form.append('file', blob, `speech.${ext}`)
  form.append('model', model)
  form.append('response_format', 'json')

  // Deliberately no Content-Type — the browser sets the multipart boundary itself.
  const headers: Record<string, string> = {}
  if (conn.apiKey) headers['Authorization'] = `Bearer ${conn.apiKey}`

  // Native WebView: CapacitorHttp can't post FormData, but STT providers are CORS-friendly, so a
  // plain fetch works there. Web/dev goes through corsFetch (the Vite /__cors proxy).
  const res = isNative()
    ? await fetch(url, { method: 'POST', headers, body: form })
    : await corsFetch(url, { method: 'POST', headers, body: form })

  if (!res.ok) {
    let detail = ''
    try { const j = await res.json(); detail = j?.error?.message ?? j?.error ?? '' } catch { /* ignore */ }
    if (res.status === 404 || res.status === 400) {
      detail = detail || `${conn.providerId} didn't accept “${model}” for transcription — pick a dedicated speech-to-text model.`
    }
    throw new Error(detail || `Transcription failed (HTTP ${res.status}).`)
  }
  const j = await res.json().catch(() => null)
  const text = (j?.text ?? (typeof j === 'string' ? j : '')) as string
  if (!text.trim()) throw new Error('Nothing was transcribed — try speaking a little longer.')
  return text.trim()
}
