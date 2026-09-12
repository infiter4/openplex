import type { CatalogProvider, ProviderConnection, ProviderOverride } from './types'

export type ApiStyle = 'openai' | 'anthropic' | 'cohere'

interface EndpointInfo {
  baseUrl: string
  style: ApiStyle
  headers?: Record<string, string>
  keyless?: boolean
  note?: string
}

export const ENDPOINTS: Record<string, EndpointInfo> = {
  openai: { baseUrl: 'https://api.openai.com/v1', style: 'openai' },
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1',
    style: 'anthropic',
    headers: {
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
  },
  google: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', style: 'openai' },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    style: 'openai',
    headers: { 'HTTP-Referer': 'https://openplex.local', 'X-Title': 'openplex' },
  },
  xai: { baseUrl: 'https://api.x.ai/v1', style: 'openai' },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', style: 'openai' },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', style: 'openai' },
  mistral: { baseUrl: 'https://api.mistral.ai/v1', style: 'openai' },
  perplexity: { baseUrl: 'https://api.perplexity.ai', style: 'openai' },
  togetherai: { baseUrl: 'https://api.together.xyz/v1', style: 'openai' },
  'fireworks-ai': { baseUrl: 'https://api.fireworks.ai/inference/v1', style: 'openai' },
  cerebras: { baseUrl: 'https://api.cerebras.ai/v1', style: 'openai' },
  moonshotai: { baseUrl: 'https://api.moonshot.ai/v1', style: 'openai' },
  zai: { baseUrl: 'https://api.z.ai/api/paas/v4', style: 'openai' },
  minimax: { baseUrl: 'https://api.minimax.io/v1', style: 'openai' },
  'ollama-cloud': { baseUrl: 'https://ollama.com/v1', style: 'openai' },
  nvidia: { baseUrl: 'https://integrate.api.nvidia.com/v1', style: 'openai' },
  deepinfra: { baseUrl: 'https://api.deepinfra.com/v1/openai', style: 'openai' },
  nebius: { baseUrl: 'https://api.studio.nebius.com/v1', style: 'openai' },
  siliconflow: { baseUrl: 'https://api.siliconflow.com/v1', style: 'openai' },
  cohere: { baseUrl: 'https://api.cohere.com/v2', style: 'cohere' },
  vercel: { baseUrl: 'https://ai-gateway.vercel.sh/v1', style: 'openai' },
  v0: { baseUrl: 'https://api.v0.dev/v1', style: 'openai' },
  venice: { baseUrl: 'https://api.venice.ai/api/v1', style: 'openai' },
  aihubmix: { baseUrl: 'https://aihubmix.com/v1', style: 'openai' },
  opencode: { baseUrl: 'https://opencode.ai/zen/v1', style: 'openai' },
  llm7: { baseUrl: 'https://api.llm7.io/v1', style: 'openai' },
  omniroute: { baseUrl: 'http://localhost:20128/v1', style: 'openai', note: 'Self-hosted OmniRoute gateway' },
  lmstudio: { baseUrl: 'http://127.0.0.1:1234/v1', style: 'openai', keyless: true, note: 'Local LM Studio server' },
}

/**
 * Providers models.dev doesn't carry, so they'd never appear on their own. `models` seeds the
 * picker: without it the provider is listed in Settings but shows nothing to pick until you
 * connect, because the picker iterates models rather than providers. The live /models list
 * replaces this seed once a connection exists.
 */
export const EXTRA_PROVIDERS: Array<{ id: string; name: string; baseUrl: string; note: string; models?: string[] }> = [
  {
    id: 'llm7',
    name: 'LLM7',
    baseUrl: 'https://api.llm7.io/v1',
    note: 'One endpoint, many models — get a key at dash.llm7.io',
    models: [
      'DeepSeek-V4-Flash-0731', 'Inkling', 'Inkling-Small', 'L3-8B-Lunaris-v1-Turbo', 'XiaomiMiMo/MiMo-V2.5',
      'XiaomiMiMo/MiMo-V2.5-Pro', 'claude-fable-5', 'claude-fable-5-1', 'claude-haiku-4-5', 'claude-opus-4-8',
      'claude-opus-5', 'claude-sonnet-4-6', 'claude-sonnet-5', 'codestral-latest', 'deepseek-v4-flash:0731',
      'deepseek-v4-flash_0731', 'deepseek-v4-pro', 'gemini-3-flash', 'gemini-3.1-flash-lite', 'gemini-3.7-flash',
      'gemini-3.8-flash-high', 'gemma4:31b', 'glm-5.3', 'glm-5.3-flash', 'gpt-5.5', 'gpt-5.6-luna', 'gpt-5.6-sol',
      'gpt-5.6-terra', 'gpt-6-astra', 'grok-4.5', 'grok-4.6', 'kimi-k3', 'llama-4-maverick', 'minimax-m2.7',
      'mistral-Nemo-Instruct-2407', 'mistral-Small-24B-Instruct-2501', 'seed-2.0-mini',
    ],
  },
  {
    // A gateway's models are whatever the user configured in it, so there is nothing honest to
    // seed — they arrive from /models once the gateway is running and connected.
    id: 'omniroute',
    name: 'OmniRoute (self-hosted)',
    baseUrl: 'http://localhost:20128/v1',
    note: 'Your own OmniRoute gateway — use a key from Endpoint → Registered Keys',
  },
]

export const LOCAL_PROVIDERS: Array<{ id: string; name: string; baseUrl: string; note: string; models?: string[] }> = [
  { id: 'ollama', name: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1', note: 'Local Ollama server — no key needed' },
  { id: 'lmstudio', name: 'LM Studio (local)', baseUrl: 'http://127.0.0.1:1234/v1', note: 'Local LM Studio server — no key needed' },
]

const CLOUD_AUTH = new Set([
  'amazon-bedrock', 'google-vertex', 'google-vertex-anthropic', 'azure',
  'azure-cognitive-services', 'github-copilot', 'snowflake-cortex', 'sap-ai-core',
  'databricks', 'cloudflare-ai-gateway',
])

export const FEATURED_ORDER = [
  'openai', 'anthropic', 'google', 'openrouter', 'xai', 'groq', 'deepseek',
  'mistral', 'perplexity', 'togetherai', 'fireworks-ai', 'cerebras', 'moonshotai',
  'zai', 'minimax', 'nvidia', 'deepinfra', 'ollama-cloud', 'huggingface', 'cohere',
]

function usableApi(api?: string): string | undefined {
  if (!api || api.includes('${') || api.includes('{')) return undefined
  return /^https?:\/\//.test(api) ? api : undefined
}

export function isBrowserReady(p: CatalogProvider): boolean {
  if (CLOUD_AUTH.has(p.id)) return false
  return Boolean(ENDPOINTS[p.id] || usableApi(p.api))
}

function baseEndpointFor(conn: ProviderConnection, catalogProvider?: CatalogProvider, modelId?: string): EndpointInfo | null {
  if (conn.providerId === 'cloudflare-workers-ai') {
    const accountId = conn.accountId?.trim()
    if (!accountId) return null
    return {
      baseUrl: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`,
      style: 'openai',
    }
  }
  if (conn.providerId === 'opencode' && !conn.baseUrl) {
    const base = 'https://opencode.ai/zen/v1'
    const m = (modelId ?? '').toLowerCase()
    if (m.startsWith('claude') || m.startsWith('qwen'))
      return { baseUrl: base, style: 'anthropic', headers: { 'anthropic-version': '2023-06-01' } }
    return { baseUrl: base, style: 'openai' }
  }
  if (conn.baseUrl) {
    const known = ENDPOINTS[conn.providerId]
    return { baseUrl: conn.baseUrl.replace(/\/$/, ''), style: known?.style ?? 'openai', headers: known?.headers }
  }
  const known = ENDPOINTS[conn.providerId]
  if (known) return known
  const api = usableApi(catalogProvider?.api)
  if (api) {
    const style = styleFromCatalogNpm(catalogProvider?.npm)
    const headers = style === 'anthropic' ? { 'anthropic-version': '2023-06-01' } : undefined
    return { baseUrl: api.replace(/\/$/, ''), style, headers }
  }
  return null
}

// ---- repair overrides -------------------------------------------------------------------
// Kept in a module registry (fed by the settings store) so endpointFor stays callable from
// anywhere without importing state, and every existing call site picks up repairs for free.
let OVERRIDES: Record<string, ProviderOverride> = {}

export function setProviderOverrides(o?: Record<string, ProviderOverride>): void {
  OVERRIDES = o ?? {}
}
export function providerOverride(providerId: string): ProviderOverride | undefined {
  return OVERRIDES[providerId]
}
/** Every repair currently in force — used to surface repair-added providers in the pickers. */
export function allProviderOverrides(): Record<string, ProviderOverride> {
  return OVERRIDES
}
/** Map a requested model id through any repair alias (provider renamed/retired an id). */
export function resolveModelId(providerId: string, modelId: string): string {
  return OVERRIDES[providerId]?.modelAliases?.[modelId] ?? modelId
}

/**
 * Endpoint for a provider, with any repair applied. Precedence: a base URL the user typed wins,
 * then a repaired base URL, then our built-in table, then the catalog's `api`. A repair can also
 * change the API style or add headers — and can give an endpoint to a provider we know nothing about.
 */
export function endpointFor(conn: ProviderConnection, catalogProvider?: CatalogProvider, modelId?: string): EndpointInfo | null {
  const base = baseEndpointFor(conn, catalogProvider, modelId)
  const ov = OVERRIDES[conn.providerId]
  if (!ov) return base
  const baseUrl = conn.baseUrl?.trim() || ov.baseUrl?.trim() || base?.baseUrl
  if (!baseUrl) return base
  const headers = { ...(base?.headers ?? {}), ...(ov.headers ?? {}) }
  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    style: ov.apiStyle ?? base?.style ?? 'openai',
    headers: Object.keys(headers).length ? headers : undefined,
    keyless: base?.keyless,
    note: base?.note,
  }
}

export function authHeaders(style: ApiStyle, apiKey: string | undefined, extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', ...extra }
  if (style === 'anthropic') {
    if (apiKey) h['x-api-key'] = apiKey
  } else if (apiKey) {
    h['Authorization'] = `Bearer ${apiKey}`
  }
  return h
}

/** Infer a catalog provider's API style from its models.dev `npm` SDK hint. Most are OpenAI-compatible;
 *  a few (FreeModel, the Kimi/MiniMax coding endpoints) are Anthropic-native (@ai-sdk/anthropic). */
function styleFromCatalogNpm(npm?: string): ApiStyle {
  const s = (npm ?? '').toLowerCase()
  if (s.includes('anthropic')) return 'anthropic'
  if (s.includes('cohere')) return 'cohere'
  return 'openai'
}

/** Per-provider max sampling temperature. The settings slider goes to 2 (OpenAI's range), but
 *  some gateways cap lower — z.ai and Anthropic only accept 0–1 and 400 on anything above. */
const TEMP_MAX: Record<string, number> = { zai: 1, anthropic: 1 }
export function clampTemperature(providerId: string, t: number): number {
  return Math.min(t, TEMP_MAX[providerId] ?? 2)
}

/** OpenAI's `stream_options: { include_usage }` is not universally supported — strict gateways like
 *  z.ai reject the unknown field with an (empty-body) 400. Only send it where it's known to work. */
const STREAM_USAGE = new Set(['openai', 'groq', 'openrouter'])
export function supportsStreamUsage(providerId: string): boolean {
  return STREAM_USAGE.has(providerId)
}

export async function listRemoteModels(baseUrl: string, apiKey?: string): Promise<string[]> {
  const { corsFetch } = await import('./net')
  const res = await corsFetch(`${baseUrl.replace(/\/$/, '')}/models`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
  }, { buffered: true })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()
  const data = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : []
  return data.map((m: { id?: string }) => m?.id).filter((x: unknown): x is string => typeof x === 'string')
}
