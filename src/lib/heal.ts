import { corsFetch } from './net'
import { authHeaders, endpointFor, ENDPOINTS, listRemoteModels, type ApiStyle } from './providers'
import { chatUrl, friendlyError, LlmError } from './llm'
import { fetchPage, webSearch } from './search'
import { computeAvailable } from './agentBackend'
import { COMPUTER_TOOLS, executeTool } from './tools'
import type { AgentTool, CatalogProvider, ProviderConnection, ProviderOverride, ToolStep } from './types'
import { useProviders } from '../state/providers'
import { useSettings } from '../state/settings'

export interface HealStep {
  id: string
  tool: string
  title: string
  detail?: string
  status: 'running' | 'done' | 'error'
  output?: string
}

/** What's broken. Any field may be missing — the agent is told to work with what it has. */
export interface HealTarget {
  providerId?: string
  modelId?: string
  /** The error the user actually saw, verbatim. */
  error?: string
  /** Free-text description when the repair is started by hand from Settings. */
  note?: string
}

export interface HealRun {
  ok: boolean
  summary: string
  steps: HealStep[]
  /** true if an override was written (i.e. something will sync to the user's other devices). */
  changed: boolean
}

const MAX_ROUNDS = 14
const CLIP = 8000
const clip = (s: string, n = CLIP): string => (s.length > n ? `${s.slice(0, n)}\n…[${s.length - n} more chars]` : s)

const str = (description: string) => ({ type: 'string', description })

export interface HealToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export const REPAIR_TOOLS: HealToolSpec[] = [
  {
    name: 'get_provider_config',
    description:
      "Everything the app currently knows about a provider: the endpoint it would use right now (base URL, API style, headers), the built-in table entry, what the models.dev catalog says, any override already applied, and the provider's live model list if we have one. Start here.",
    parameters: {
      type: 'object',
      properties: { provider_id: str('Provider id, e.g. "openai", "zai", "opencode".') },
      required: ['provider_id'],
    },
  },
  {
    name: 'list_provider_models',
    description:
      "Ask the provider itself for its model list (GET /models on the endpoint, with the user's key). This is the ground truth for which model ids still exist — use it when a model 404s or 'does not exist'.",
    parameters: {
      type: 'object',
      properties: {
        provider_id: str('Provider id.'),
        base_url: str('Optional base URL to try instead of the configured one.'),
      },
      required: ['provider_id'],
    },
  },
  {
    name: 'web_search',
    description:
      "Search the web. Use it to find a provider's CURRENT API base URL, required headers, or renamed model ids — the app's built-in table and the models.dev catalog both go stale.",
    parameters: {
      type: 'object',
      properties: { query: str('Search query.') },
      required: ['query'],
    },
  },
  {
    name: 'fetch_page',
    description: 'Read a web page as text — provider docs, a changelog, a status page, a migration note.',
    parameters: {
      type: 'object',
      properties: { url: str('Full URL to read.') },
      required: ['url'],
    },
  },
  {
    name: 'test_request',
    description:
      'Send a real, tiny chat request with a CANDIDATE configuration and report exactly what came back (status + body). Nothing is saved. This is how you reproduce the failure and how you prove a fix works — every candidate must pass this before you apply it.',
    parameters: {
      type: 'object',
      properties: {
        provider_id: str('Provider id.'),
        model: str('Model id to send.'),
        base_url: str('Candidate base URL. Omit to use the configured one.'),
        api_style: { type: 'string', enum: ['openai', 'anthropic', 'cohere'], description: 'Candidate wire protocol.' },
        headers: { type: 'object', description: 'Extra headers to merge in (never auth — the key is attached for you).' },
      },
      required: ['provider_id', 'model'],
    },
  },
  {
    name: 'apply_override',
    description:
      "Save a repair for this provider and re-test it immediately. Overrides sync to the user's other devices, so this is the fix that also reaches their phone. Only the fields you pass are changed. Returns the result of the verification request — if it fails, keep working.",
    parameters: {
      type: 'object',
      properties: {
        provider_id: str('Provider id.'),
        base_url: str('New base URL for the provider.'),
        api_style: { type: 'string', enum: ['openai', 'anthropic', 'cohere'], description: 'New wire protocol.' },
        headers: { type: 'object', description: 'Extra headers to always send. Never auth headers.' },
        model_aliases: { type: 'object', description: 'Map of old model id -> id the provider actually serves now.' },
        note: str('One line: what was wrong and what you changed. Shown to the user.'),
        verify_model: str('Model id to verify with. Defaults to the broken one.'),
      },
      required: ['provider_id', 'note'],
    },
  },
  {
    name: 'add_provider',
    description:
      "Add a provider the app doesn't know about, or add models to one it does. Use this when the user asks for a provider that isn't in the list, or for models the catalog hasn't caught up with. The provider appears in the model picker on ALL their devices, because this is stored in settings rather than in a connection. You cannot set an API key — say plainly that they must paste theirs in Settings → Providers for the new provider. Call list_provider_models first when the endpoint serves /models, so you add the real ids rather than guesses.",
    parameters: {
      type: 'object',
      properties: {
        provider_id: str('Short lowercase id, e.g. "chutes" or "targon". Reuse the existing id when adding models to a provider that is already listed.'),
        name: str('Display name shown in the picker, e.g. "Chutes AI".'),
        base_url: str('API base URL, the part before /chat/completions — e.g. https://llm.chutes.ai/v1'),
        api_style: { type: 'string', enum: ['openai', 'anthropic', 'cohere'], description: 'Wire protocol. Almost always "openai".' },
        models: { type: 'array', items: { type: 'string' }, description: 'Model ids to offer. Added on top of whatever the catalog and /models already provide.' },
        headers: { type: 'object', description: 'Extra headers the provider needs. Never auth headers.' },
        note: str('One line explaining what you added, shown to the user.'),
      },
      required: ['provider_id', 'note'],
    },
  },
  {
    name: 'clear_override',
    description: 'Remove the saved repair for a provider and go back to the built-in defaults. Use if a repair turned out to be wrong.',
    parameters: {
      type: 'object',
      properties: { provider_id: str('Provider id.') },
      required: ['provider_id'],
    },
  },
  {
    name: 'refresh_catalog',
    description:
      "Re-download the model catalog and re-read connected providers' live model lists. Use when the complaint is missing/new models or models that no longer exist.",
    parameters: { type: 'object', properties: {} },
  },
]

/** Source-editing tools, only handed over when the user's computer is actually reachable. */
const SOURCE_TOOL_NAMES = new Set<AgentTool>(['terminal', 'read_file', 'edit_file', 'write_file', 'list_files'])
const SOURCE_TOOLS: HealToolSpec[] = COMPUTER_TOOLS.filter((t) => SOURCE_TOOL_NAMES.has(t.name))
const isSourceTool = (name: string): name is AgentTool => SOURCE_TOOL_NAMES.has(name as AgentTool)

const SYSTEM = `You are openplex's repair agent.

openplex is a bring-your-own-key chat app that runs in the browser and on phones, and it calls provider APIs DIRECTLY from the client. That means it breaks in one specific way: a provider moves its endpoint, changes required headers, switches wire protocol, or retires a model id, and the app's built-in table is suddenly wrong. Your job is to find out what actually changed and repair it.

How a repair is stored: a per-provider override holding a base URL, an API style, extra headers, and model-id aliases. Overrides live in settings and SYNC between the user's devices — so an override is the only kind of fix that also reaches their phone. Always prefer one.

Method:
1. get_provider_config on the failing provider.
2. test_request to reproduce the failure and read the provider's real error body. Guessing from the error message alone is not diagnosis.
3. web_search / fetch_page for the provider's current docs when the error points at an endpoint, header or model id.
4. test_request each candidate. Never apply anything you have not seen succeed.
5. apply_override, which re-verifies for you. If the verification fails, keep working.

Mapping symptoms to fixes: 404 / "model not found" / "deprecated" -> model_aliases (list_provider_models tells you what still exists). 404 on the path, DNS failure, or a redirect -> base_url. 400 about unknown fields, or auth that looks wrong for the shape of the API -> api_style plus headers.

If the user wants a provider or model that simply ISN'T in the app yet, that is add_provider, not a repair — find the provider's real base URL and model ids first (their docs, or /models once you have the URL), then add it. It will show up on all of their devices, but you cannot set their API key, so tell them to paste it in Settings -> Providers.

Never put an API key, token or Authorization/x-api-key header into an override — the user's key is attached to every request automatically, and overrides are stored in plain settings.

Stop when the verification passes. Finish with 1-3 plain sentences: what was actually wrong, what you changed, and anything the user still has to do. If you could not fix it, say precisely what you ruled out and what you would need.`

const SOURCE_NOTE = `\n\nThe user's computer is connected, so you also have read_file/edit_file/write_file/list_files/terminal on openplex's own source. Use them only for a bug no override can reach. Source edits do NOT sync to the user's phone and need a rebuild to take effect, so say so if you make one.`

// ---- repair tool implementations --------------------------------------------------------

function connFor(providerId: string): ProviderConnection {
  return useProviders.getState().connections[providerId] ?? { providerId, kind: 'catalog' }
}
function catalogFor(providerId: string): CatalogProvider | undefined {
  return useProviders.getState().catalog?.[providerId]
}

/**
 * Auth headers are added per-request from the user's key; an override must never carry them —
 * overrides live in plain (unencrypted) synced settings, so a key in here would leak off-device.
 * Exported for tests.
 */
export function safeHeaders(h: unknown): Record<string, string> | undefined {
  if (!h || typeof h !== 'object') return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(h as Record<string, unknown>)) {
    if (/^(authorization|x-api-key|api-key|proxy-authorization)$/i.test(k)) continue
    if (typeof v === 'string') out[k] = v
  }
  return Object.keys(out).length ? out : undefined
}

interface Candidate {
  base_url?: string
  api_style?: ApiStyle
  headers?: Record<string, string>
}

function effective(providerId: string, modelId: string, cand: Candidate = {}) {
  const conn = connFor(providerId)
  const current = endpointFor(conn, catalogFor(providerId), modelId)
  const baseUrl = (cand.base_url?.trim() || current?.baseUrl || '').replace(/\/$/, '')
  const style: ApiStyle = cand.api_style ?? current?.style ?? 'openai'
  const extra: Record<string, string> = { ...(current?.headers ?? {}), ...(cand.headers ?? {}) }
  if (style === 'anthropic') {
    extra['anthropic-version'] ??= '2023-06-01'
    extra['anthropic-dangerous-direct-browser-access'] ??= 'true'
  }
  return { conn, baseUrl, style, headers: authHeaders(style, conn.apiKey, extra) }
}

async function testRequest(args: any, signal?: AbortSignal): Promise<string> {
  const providerId = String(args?.provider_id ?? '')
  const model = String(args?.model ?? '')
  if (!providerId || !model) return 'ERROR: provider_id and model are both required.'
  const { baseUrl, style, headers } = effective(providerId, model, {
    base_url: args?.base_url,
    api_style: args?.api_style,
    headers: safeHeaders(args?.headers),
  })
  if (!baseUrl) return `ERROR: no base URL is known for "${providerId}" — pass base_url with a candidate.`

  const body: Record<string, unknown> =
    style === 'cohere'
      ? { model, messages: [{ role: 'user', content: 'ping' }] }
      : { model, max_tokens: 16, messages: [{ role: 'user', content: 'ping' }] }
  const url = chatUrl(baseUrl, style)
  const head = `POST ${url} (style=${style}, model=${model})`
  try {
    const res = await corsFetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal }, { buffered: true })
    const text = await res.text()
    if (res.ok) return `${head}\nPASS — HTTP ${res.status}. Response: ${clip(text, 1200)}`
    return `${head}\nFAIL — HTTP ${res.status}. Body: ${clip(text, 1500)}\n(app would show: ${friendlyError(res.status, providerId, '')})`
  } catch (e) {
    return `${head}\nFAIL — request never completed: ${(e as Error).message}. That usually means a bad host, a dead path, or the provider refusing browser requests (CORS).`
  }
}

function providerConfig(providerId: string): string {
  const conn = useProviders.getState().connections[providerId]
  const cat = catalogFor(providerId)
  const ep = endpointFor(connFor(providerId), cat)
  const ov = useSettings.getState().settings.providerOverrides?.[providerId]
  const catalogIds = Object.keys(cat?.models ?? {})
  return JSON.stringify(
    {
      provider_id: providerId,
      connected: Boolean(conn),
      has_api_key: Boolean(conn?.apiKey),
      connection: conn ? { kind: conn.kind, user_base_url: conn.baseUrl, label: conn.label } : null,
      endpoint_in_use: ep ? { base_url: ep.baseUrl, api_style: ep.style, headers: ep.headers ?? {} } : null,
      built_in_table: ENDPOINTS[providerId] ?? null,
      catalog: cat ? { api: cat.api, npm: cat.npm, doc: cat.doc, model_count: catalogIds.length, models: catalogIds.slice(0, 60) } : null,
      existing_override: ov ?? null,
      live_models: conn?.models
        ? { fetched_at: conn.modelsFetchedAt ? new Date(conn.modelsFetchedAt).toISOString() : null, count: conn.models.length, models: conn.models.slice(0, 60) }
        : null,
    },
    null,
    2,
  )
}

async function listModels(args: any): Promise<string> {
  const providerId = String(args?.provider_id ?? '')
  const conn = connFor(providerId)
  const baseUrl = (args?.base_url?.trim() || endpointFor(conn, catalogFor(providerId))?.baseUrl || '').replace(/\/$/, '')
  if (!baseUrl) return `ERROR: no base URL known for "${providerId}".`
  try {
    const models = await listRemoteModels(baseUrl, conn.apiKey)
    return `${models.length} models live at ${baseUrl}/models:\n${models.join('\n')}`
  } catch (e) {
    return `Couldn't list models at ${baseUrl}/models: ${(e as Error).message}. Not every provider serves /models — fall back to their docs.`
  }
}

/**
 * Add a provider (or extra models) the catalog doesn't have. Stored as an override so it reaches
 * every device — a connection would stay on whichever machine ran the repair. The API key is
 * deliberately not settable here; the user pastes that themselves.
 */
function addProvider(args: any): string {
  const providerId = String(args?.provider_id ?? '').trim().toLowerCase()
  if (!providerId || !/^[a-z0-9][a-z0-9._-]*$/.test(providerId)) {
    return 'ERROR: provider_id must be a short lowercase id like "chutes".'
  }
  const models: string[] = Array.isArray(args?.models)
    ? [...new Set((args.models as unknown[]).filter((m): m is string => typeof m === 'string' && m.trim().length > 0).map((m) => m.trim()))]
    : []
  const store = useSettings.getState()
  const all = { ...(store.settings.providerOverrides ?? {}) }
  const prev = all[providerId] ?? {}
  const name = String(args?.name ?? '').trim() || prev.name || providerId
  const baseUrl = String(args?.base_url ?? '').trim() || prev.baseUrl
  if (!baseUrl && !ENDPOINTS[providerId] && !catalogFor(providerId)) {
    return `ERROR: "${providerId}" is new, so base_url is required — the app has no endpoint for it.`
  }
  const headers = safeHeaders(args?.headers)

  const next: ProviderOverride = {
    ...prev,
    name,
    ...(baseUrl ? { baseUrl: baseUrl.replace(/\/$/, '') } : {}),
    ...(args?.api_style ? { apiStyle: args.api_style as ProviderOverride['apiStyle'] } : {}),
    ...(headers ? { headers: { ...(prev.headers ?? {}), ...headers } } : {}),
    ...(models.length ? { models: [...new Set([...(prev.models ?? []), ...models])] } : {}),
    note: String(args?.note ?? '').slice(0, 300),
    updatedAt: Date.now(),
  }
  all[providerId] = next
  store.update({ providerOverrides: all })

  const conn = useProviders.getState().connections[providerId]
  const keyNote = conn?.apiKey
    ? 'It already has an API key on this device.'
    : `It has NO API key yet — the user must paste one in Settings → Providers → ${name}, on each device.`
  return `Added "${name}" (${providerId})${models.length ? ` with ${models.length} model(s): ${models.join(', ')}` : ''}. It now appears in the model picker and syncs to their other devices. ${keyNote}`
}

function applyOverride(args: any): { text: string; providerId: string; verifyModel?: string } {
  const providerId = String(args?.provider_id ?? '')
  if (!providerId) return { text: 'ERROR: provider_id is required.', providerId: '' }
  const store = useSettings.getState()
  const all = { ...(store.settings.providerOverrides ?? {}) }
  const prev = all[providerId] ?? {}
  const headers = safeHeaders(args?.headers)
  const aliases =
    args?.model_aliases && typeof args.model_aliases === 'object'
      ? Object.fromEntries(Object.entries(args.model_aliases as Record<string, unknown>).filter(([, v]) => typeof v === 'string')) as Record<string, string>
      : undefined

  const next: ProviderOverride = {
    ...prev,
    ...(args?.base_url ? { baseUrl: String(args.base_url).trim() } : {}),
    ...(args?.api_style ? { apiStyle: args.api_style as ProviderOverride['apiStyle'] } : {}),
    ...(headers ? { headers: { ...(prev.headers ?? {}), ...headers } } : {}),
    ...(aliases ? { modelAliases: { ...(prev.modelAliases ?? {}), ...aliases } } : {}),
    note: String(args?.note ?? '').slice(0, 300),
    updatedAt: Date.now(),
  }
  all[providerId] = next
  store.update({ providerOverrides: all })
  return {
    text: `Saved override for ${providerId}: ${JSON.stringify(next)}\nIt is live now and will sync to the user's other devices.`,
    providerId,
    verifyModel: args?.verify_model ? String(args.verify_model) : undefined,
  }
}

function clearOverride(providerId: string): string {
  const store = useSettings.getState()
  const all = { ...(store.settings.providerOverrides ?? {}) }
  if (!(providerId in all)) return `No override was set for ${providerId}.`
  delete all[providerId]
  store.update({ providerOverrides: all })
  return `Removed the override for ${providerId} — back to built-in defaults.`
}

async function refreshCatalog(): Promise<string> {
  const store = useProviders.getState()
  await store.loadCatalog(true)
  const results: string[] = []
  for (const conn of Object.values(useProviders.getState().connections)) {
    try {
      const models = await store.refreshCustomModels(conn.providerId)
      results.push(`${conn.providerId}: ${models.length} live models`)
    } catch (e) {
      results.push(`${conn.providerId}: no live list (${(e as Error).message})`)
    }
  }
  const count = Object.keys(useProviders.getState().catalog ?? {}).length
  return `Catalog re-downloaded (${count} providers).\n${results.join('\n')}`
}

function titleFor(name: string, args: any): string {
  switch (name) {
    case 'web_search': return `search: ${String(args?.query ?? '').slice(0, 80)}`
    case 'fetch_page': return `read ${String(args?.url ?? '').slice(0, 80)}`
    case 'get_provider_config': return `inspect ${args?.provider_id ?? ''}`
    case 'list_provider_models': return `list models for ${args?.provider_id ?? ''}`
    case 'test_request': return `test ${args?.provider_id ?? ''}/${args?.model ?? ''}`
    case 'apply_override': return `repair ${args?.provider_id ?? ''}`
    case 'add_provider': return `add provider ${args?.provider_id ?? ''}`
    case 'clear_override': return `reset ${args?.provider_id ?? ''}`
    case 'refresh_catalog': return 'refresh catalog'
    case 'terminal': return `$ ${String(args?.command ?? '').slice(0, 100)}`
    case 'read_file': return `read ${args?.path ?? ''}`
    case 'edit_file': return `edit ${args?.path ?? ''}`
    case 'write_file': return `write ${args?.path ?? ''}`
    case 'list_files': return `ls ${args?.path ?? ''}`.trim()
    default: return name
  }
}

// ---- the loop ---------------------------------------------------------------------------

interface LoopDeps {
  onStep: (s: HealStep) => void
  signal?: AbortSignal
  target: HealTarget
}

async function runRepairTool(name: string, args: any, d: LoopDeps): Promise<{ content: string; changed: boolean }> {
  const id = crypto.randomUUID()
  const step: HealStep = { id, tool: name, title: titleFor(name, args), status: 'running' }
  d.onStep(step)
  let content = ''
  let changed = false
  try {
    switch (name) {
      case 'get_provider_config':
        content = providerConfig(String(args?.provider_id ?? ''))
        break
      case 'list_provider_models':
        content = await listModels(args)
        break
      case 'web_search': {
        const sources = await webSearch(String(args?.query ?? ''), useSettings.getState().settings.search)
        content = sources.map((s) => `# ${s.title}\n${s.url}\n${s.snippet ?? ''}`).join('\n\n')
        break
      }
      case 'fetch_page':
        content = await fetchPage(String(args?.url ?? ''), useSettings.getState().settings.search)
        break
      case 'test_request':
        content = await testRequest(args, d.signal)
        break
      case 'apply_override': {
        const r = applyOverride(args)
        changed = Boolean(r.providerId)
        const model = r.verifyModel ?? d.target.modelId
        // Verify for the model the agent is prescribing, not the one the app asked for, so an
        // alias repair is checked end-to-end.
        const verify = model
          ? await testRequest({ provider_id: r.providerId, model: resolveAliasFor(r.providerId, model) }, d.signal)
          : 'No model to verify with — ask the user, or call test_request yourself.'
        content = `${r.text}\n\nVerification:\n${verify}`
        break
      }
      case 'add_provider':
        content = addProvider(args)
        changed = !content.startsWith('ERROR')
        break
      case 'clear_override':
        content = clearOverride(String(args?.provider_id ?? ''))
        changed = true
        break
      case 'refresh_catalog':
        content = await refreshCatalog()
        changed = true
        break
      default:
        content = `ERROR: unknown tool "${name}"`
    }
    d.onStep({ ...step, status: 'done', output: clip(content, 4000) })
  } catch (e) {
    content = `ERROR: ${(e as Error).message}`
    d.onStep({ ...step, status: 'error', output: content })
  }
  return { content: clip(content), changed }
}

/** Read the alias back out of the just-saved override so verification tests the real id. */
function resolveAliasFor(providerId: string, modelId: string): string {
  return useSettings.getState().settings.providerOverrides?.[providerId]?.modelAliases?.[modelId] ?? modelId
}

async function runTool(name: string, args: any, d: LoopDeps): Promise<{ content: string; changed: boolean }> {
  if (isSourceTool(name)) {
    const shim = (s: ToolStep) =>
      d.onStep({ id: s.id, tool: s.tool, title: s.title, detail: s.detail, status: s.status, output: s.output })
    const r = await executeTool(name, args, `heal-${Date.now()}`, shim, d.signal)
    return { content: r.content, changed: name !== 'read_file' && name !== 'list_files' }
  }
  return runRepairTool(name, args, d)
}

function describeTarget(t: HealTarget): string {
  const bits = [
    t.providerId ? `Provider: ${t.providerId}` : null,
    t.modelId ? `Model: ${t.modelId}` : null,
    t.error ? `The error the user saw:\n${clip(t.error, 2000)}` : null,
    t.note ? `What the user says is wrong:\n${clip(t.note, 2000)}` : null,
  ].filter(Boolean)
  if (!bits.length) return 'The user opened the repair panel without describing a specific failure. Start by checking their connected providers for anything obviously broken, and say what you find.'
  return `${bits.join('\n')}\n\nDiagnose and repair this.`
}

export async function runHeal(opts: {
  conn: ProviderConnection
  catalogProvider?: CatalogProvider
  model: string
  target: HealTarget
  onStep?: (s: HealStep) => void
  onText?: (d: string) => void
  signal?: AbortSignal
}): Promise<HealRun> {
  const endpoint = endpointFor(opts.conn, opts.catalogProvider, opts.model)
  if (!endpoint) throw new LlmError(`No endpoint known for ${opts.conn.providerId}.`)
  if (endpoint.style === 'cohere') {
    throw new LlmError('Pick a repair model on an OpenAI- or Anthropic-compatible provider — repairs need tool calling.')
  }

  const steps: HealStep[] = []
  const onStep = (s: HealStep) => {
    const i = steps.findIndex((x) => x.id === s.id)
    if (i >= 0) steps[i] = s
    else steps.push(s)
    opts.onStep?.(s)
  }
  const deps: LoopDeps = { onStep, signal: opts.signal, target: opts.target }

  const hasComputer = (await computeAvailable()).ok
  const specs = hasComputer ? [...REPAIR_TOOLS, ...SOURCE_TOOLS] : REPAIR_TOOLS
  const system = hasComputer ? SYSTEM + SOURCE_NOTE : SYSTEM

  const url = chatUrl(endpoint.baseUrl, endpoint.style)
  const headers = authHeaders(endpoint.style, opts.conn.apiKey, endpoint.headers)
  const model = resolveAliasFor(opts.conn.providerId, opts.model)
  const anthropic = endpoint.style === 'anthropic'

  let summary = ''
  let changed = false

  const post = async (body: unknown): Promise<any> => {
    const res = await corsFetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: opts.signal }, { buffered: true })
    const text = await res.text()
    if (!res.ok) {
      let detail = text.slice(0, 300)
      try { const j = JSON.parse(text); detail = j?.error?.message ?? j?.message ?? detail } catch { /* keep snippet */ }
      throw new LlmError(friendlyError(res.status, opts.conn.providerId, detail), res.status)
    }
    try { return JSON.parse(text) } catch { throw new LlmError(`repair model returned non-JSON: ${text.slice(0, 200)}`) }
  }

  if (anthropic) {
    const tools = specs.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }))
    const messages: any[] = [{ role: 'user', content: describeTarget(opts.target) }]
    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (opts.signal?.aborted) break
      const j = await post({ model, system, messages, tools, max_tokens: 4096 })
      const blocks: any[] = Array.isArray(j?.content) ? j.content : []
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('')
      if (text) { summary = text; opts.onText?.(text) }
      const uses = blocks.filter((b) => b.type === 'tool_use')
      if (!uses.length) break
      messages.push({ role: 'assistant', content: blocks })
      const results: any[] = []
      for (const u of uses) {
        const r = await runTool(u.name, u.input ?? {}, deps)
        changed ||= r.changed
        results.push({ type: 'tool_result', tool_use_id: u.id, content: r.content })
      }
      messages.push({ role: 'user', content: results })
    }
  } else {
    const tools = specs.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }))
    const messages: any[] = [
      { role: 'system', content: system },
      { role: 'user', content: describeTarget(opts.target) },
    ]
    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (opts.signal?.aborted) break
      const j = await post({ model, messages, tools, tool_choice: 'auto', max_tokens: 4096 })
      const msg = j?.choices?.[0]?.message ?? {}
      if (msg.content) { summary = String(msg.content); opts.onText?.(summary) }
      const calls: any[] = msg.tool_calls ?? []
      if (!calls.length) break
      messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: calls })
      for (const call of calls) {
        let args: any = {}
        try { args = JSON.parse(call.function?.arguments || '{}') } catch { /* leave empty */ }
        const r = await runTool(call.function?.name, args, deps)
        changed ||= r.changed
        messages.push({ role: 'tool', tool_call_id: call.id, content: r.content })
      }
    }
  }

  // "It worked" means a request actually succeeded, not that the model said so.
  const verified = steps.some((s) => s.tool === 'apply_override' && s.status === 'done' && /\nPASS — HTTP/.test(s.output ?? ''))
  return {
    ok: verified || (changed && !steps.some((s) => s.status === 'error')),
    summary: summary.trim() || (changed ? 'Applied a repair.' : 'No repair was applied.'),
    steps,
    changed,
  }
}
