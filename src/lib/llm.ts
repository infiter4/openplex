import { corsFetch, isNative, NetError, usingProxy } from './net'
import { authHeaders, clampTemperature, endpointFor, resolveModelId, supportsStreamUsage, type ApiStyle } from './providers'
import type { Attachment, CatalogModel, CatalogProvider, ProviderConnection, Usage } from './types'
import { estimateTokens } from './utils'

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
  attachments?: Attachment[]
}

export interface StreamCallbacks {
  onText?: (delta: string) => void
  onReasoning?: (delta: string) => void
  /** agentic-only: close the current text segment (a tool is about to run) */
  onSegmentBreak?: () => void
  /** agentic-only: discard text streamed since the last break (a system nudge fired) */
  onDropPendingText?: () => void
}

export interface ChatRequest {
  conn: ProviderConnection
  catalogProvider?: CatalogProvider
  model: string
  modelMeta?: CatalogModel
  system?: string
  turns: ChatTurn[]
  temperature?: number
  maxTokens?: number
  thinking?: string
  prefill?: string
  signal?: AbortSignal
}

export class LlmError extends Error {
  constructor(message: string, public status?: number, public retryable = false) {
    super(message)
  }
}

const has = (s: string, ...needles: string[]) => needles.some((n) => s.includes(n))
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function abortRace<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 529
}

function retryAfterMs(res: Response): number {
  const h = res.headers.get('retry-after')
  if (h) {
    const secs = Number(h)
    if (!Number.isNaN(secs)) return Math.min(secs * 1000, 12_000)
    const when = Date.parse(h)
    if (!Number.isNaN(when)) return Math.min(Math.max(0, when - Date.now()), 12_000)
  }
  return 2_500
}

/**
 * An extra line of advice, ONLY where there is something to do that the provider's own message
 * doesn't already tell you. Returns '' the rest of the time — restating an error in our own words
 * adds nothing and risks contradicting it.
 */
function hint(status: number, providerId: string, raw: string): string {
  const r = raw.toLowerCase()

  if (providerId === 'vercel' && (status === 401 || status === 403)) {
    return 'Tip: AI Gateway keys start with “vck_” — make one at vercel.com → AI Gateway → API Keys.'
  }
  if (has(r, 'context length', 'maximum context', 'context_length_exceeded', 'reduce the length', 'maximum number of tokens', 'input is too long', 'prompt is too long')) {
    return 'Tip: lower the context cap (gauge icon in the composer) or start a new thread.'
  }
  if (status === 402 || has(r, 'insufficient_quota', 'insufficient balance', 'out of credits', 'no credits', 'please recharge', 'credit balance is too low')) {
    return 'Tip: add credits in the provider’s dashboard, then retry.'
  }
  // A 429 is a limit by definition, never a question of entitlement.
  if (status === 429 || has(r, 'rate limit', 'rate_limit', 'per minute', 'per-minute', 'too many requests', 'throughput', 'try again in')) {
    return 'Tip: on free tiers a burst of calls trips this (web search fires several per answer). Wait ~30–60s, or use a higher-tier key.'
  }
  if (has(r, 'country, region, or territory not supported', 'unsupported_country', 'region is not supported')) {
    return 'Tip: this account can’t use the provider from your region; a provider-side proxy would be required.'
  }
  if (status === 401 || status === 403) {
    return 'Tip: check the API key in Settings → Providers.'
  }
  if (status === 404) {
    return 'Tip: the model id may have been renamed or retired — refresh the catalog, or run Settings → Repair.'
  }
  return ''
}

/**
 * What the user sees. The provider's own message comes first and verbatim, because every
 * classification we could do is a guess and a wrong guess is worse than no guess — "free tier rate
 * limit" once surfaced as "your account doesn't have access to this model", which sends you to a
 * billing page over something that clears in a minute. We only add a second line when there is an
 * actual action to take, and only the provider gets to say what happened.
 */
export function friendlyError(status: number, providerId: string, raw: string): string {
  const exact = (raw ?? '').replace(/\s+/g, ' ').trim()
  const tip = hint(status, providerId, exact)

  if (!exact) {
    // Nothing came back — the status code is genuinely all we know.
    const base = `${providerId} failed with HTTP ${status} and sent no error message.`
    return tip ? `${base}\n\n${tip}` : base
  }
  const head = `${providerId} (HTTP ${status}): ${exact.slice(0, 600)}`
  return tip ? `${head}\n\n${tip}` : head
}

async function readError(res: Response, providerId: string): Promise<LlmError> {
  let detail = ''
  let body = ''
  try {
    body = await res.text()
    try {
      const j: any = JSON.parse(body)
      const arr = Array.isArray(j?.errors)
        ? j.errors.map((e: any) => (typeof e === 'string' ? e : e?.message ?? e?.code ?? '')).filter(Boolean).join('; ')
        : ''
      detail =
        j?.error?.message ??
        j?.error?.code ??
        j?.message ??
        j?.detail ??
        (arr || (typeof j?.error === 'string' ? j.error : ''))
      if (typeof detail !== 'string') detail = JSON.stringify(detail)
    } catch {
      detail = body.slice(0, 300)
    }
  } catch {
    /* ignore */
  }
  if (!detail && body) detail = body.slice(0, 300)
  return new LlmError(friendlyError(res.status, providerId, detail), res.status, isRetryableStatus(res.status))
}

async function fetchWithRetry(url: string, init: RequestInit, providerId: string, opts: { buffered?: boolean } = {}): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await corsFetch(url, init, opts)
    if (res.ok || attempt >= 1 || !isRetryableStatus(res.status)) return res
    if (init.signal?.aborted) return res
    await sleep(retryAfterMs(res))
  }
}

function networkError(providerId: string, baseUrl?: string): LlmError {
  if (baseUrl && /^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(baseUrl)) {
    return new LlmError(
      `Couldn’t reach the local server for ${providerId} at ${baseUrl}. Make sure it’s running. In dev it’s proxied automatically; if you set CORS env (e.g. OLLAMA_ORIGINS=*) it works directly too.`,
    )
  }
  if (usingProxy()) {
    return new LlmError(`The proxy couldn’t reach ${providerId}. Check the address/key, or that your proxy server is running.`)
  }
  return new LlmError(
    `Couldn’t reach ${providerId} — it likely blocks direct browser calls (CORS). Set a proxy URL in Settings → Providers → Connection, run openplex locally (auto-proxied), or use the same model via OpenRouter.`,
  )
}

type OpenAIPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }

export function modelSupportsVision(meta?: CatalogModel): boolean {
  return Boolean(meta?.attachment || meta?.modalities?.input?.includes('image'))
}

function imageParts(t: ChatTurn): Array<{ dataUrl: string; mimeType: string }> {
  const out: Array<{ dataUrl: string; mimeType: string }> = []
  for (const a of t.attachments ?? []) {
    if (a.kind === 'document') {
      for (const url of a.pageImages ?? []) out.push({ dataUrl: url, mimeType: 'image/jpeg' })
    } else if (a.dataUrl) {
      out.push({ dataUrl: a.dataUrl, mimeType: a.mimeType })
    }
  }
  return out
}

function documentText(t: ChatTurn): string {
  const docs = (t.attachments ?? []).filter((a) => a.kind === 'document' && a.text?.trim())
  if (!docs.length) return ''
  return docs
    .map((a) => `\n\n===== Attached file: ${a.name ?? 'document'} =====\n${a.text!.trim()}\n===== end of file =====`)
    .join('')
}

function userTurnText(t: ChatTurn): string {
  return t.role === 'user' ? t.content + documentText(t) : t.content
}

export function openaiMessages(system: string | undefined, turns: ChatTurn[], vision: boolean): unknown[] {
  const msgs: unknown[] = []
  if (system?.trim()) msgs.push({ role: 'system', content: system })
  for (const t of turns) {
    const text = userTurnText(t)
    const imgs = vision && t.role === 'user' ? imageParts(t) : []
    if (imgs.length) {
      const parts: OpenAIPart[] = [{ type: 'text', text }]
      for (const im of imgs) parts.push({ type: 'image_url', image_url: { url: im.dataUrl } })
      msgs.push({ role: t.role, content: parts })
    } else {
      msgs.push({ role: t.role, content: text })
    }
  }
  return msgs
}

export function anthropicMessages(turns: ChatTurn[], vision: boolean): unknown[] {
  return turns.map((t) => {
    const text = userTurnText(t)
    const imgs = vision && t.role === 'user' ? imageParts(t) : []
    if (imgs.length) {
      const parts: unknown[] = []
      for (const im of imgs) {
        const base64 = im.dataUrl.split(',')[1] ?? ''
        parts.push({ type: 'image', source: { type: 'base64', media_type: im.mimeType, data: base64 } })
      }
      parts.push({ type: 'text', text })
      return { role: t.role, content: parts }
    }
    return { role: t.role, content: text }
  })
}

export function chatUrl(base: string, style: ApiStyle): string {
  if (style === 'anthropic') return `${base}/messages`
  if (style === 'cohere') return `${base}/chat`
  return `${base}/chat/completions`
}

const THINK_TAGS = ['think', 'thinking', 'thought', 'reasoning', 'reason']
const THINK_OPENERS = THINK_TAGS.map((t) => `<${t}>`)
const MAX_OPENER = Math.max(...THINK_OPENERS.map((t) => t.length))
const STRIP_RE = new RegExp(`^\\s*<(${THINK_TAGS.join('|')})>[\\s\\S]*?<\\/\\1>\\s*`, 'i')

export function stripThink(text: string): string {
  const closed = text.replace(STRIP_RE, '')
  if (closed !== text) return closed.trim()
  const open = text.match(new RegExp(`^\\s*<(${THINK_TAGS.join('|')})>`, 'i'))
  if (open && !new RegExp(`</${open[1]}>`, 'i').test(text)) return ''
  return text.trim()
}

export function makeThinkSplitter(onText: (d: string) => void, onReasoning: (d: string) => void) {
  let mode: 'detect' | 'think' | 'text' = 'detect'
  let closeTag = ''
  let buf = ''

  const push = (delta: string) => {
    buf += delta
    for (;;) {
      if (mode === 'detect') {
        const lead = buf.replace(/^\s+/, '')
        if (!lead) return
        const lower = lead.toLowerCase()
        const match = THINK_OPENERS.find((o) => lower.startsWith(o))
        if (match) {
          mode = 'think'
          closeTag = `</${match.slice(1)}`
          buf = lead.slice(match.length)
          continue
        }
        if (lead.length < MAX_OPENER && THINK_OPENERS.some((o) => o.startsWith(lower))) {
          return
        }
        mode = 'text'
        continue
      }
      if (mode === 'think') {
        const end = buf.toLowerCase().indexOf(closeTag)
        if (end >= 0) {
          if (end > 0) onReasoning(buf.slice(0, end))
          buf = buf.slice(end + closeTag.length).replace(/^\s+/, '')
          mode = 'text'
          continue
        }
        const safe = buf.length - (closeTag.length - 1)
        if (safe > 0) {
          onReasoning(buf.slice(0, safe))
          buf = buf.slice(safe)
        }
        return
      }
      if (buf) {
        onText(buf)
        buf = ''
      }
      return
    }
  }

  const flush = () => {
    if (!buf) return
    if (mode === 'think') onReasoning(buf)
    else onText(buf)
    buf = ''
  }

  return { push, flush }
}

const EFFORT_BUDGET: Record<string, number> = {
  minimal: 1024, low: 4096, medium: 12288, high: 24576, max: 32768,
}

const NO_REASONING_PARAM = new Set(['deepseek'])

export function supportsThinkingControl(providerId: string, style: ApiStyle, _modelId?: string): boolean {
  if (style === 'anthropic' || style === 'cohere') return true
  return !NO_REASONING_PARAM.has(providerId)
}

export function effortValuesFor(providerId: string, modelId: string, fromCatalog?: string[]): string[] {
  if (fromCatalog?.length) return fromCatalog
  if (providerId === 'openai' && /gpt-5/.test(modelId)) return ['minimal', 'low', 'medium', 'high']
  if (providerId === 'xai') return ['low', 'high']
  return ['low', 'medium', 'high']
}

function applyThinking(body: Record<string, unknown>, providerId: string, _modelId: string, level: string): void {
  const effort = level === 'max' ? 'high' : level === 'on' ? 'medium' : level
  switch (providerId) {
    case 'openrouter':
      body.reasoning = level === 'off' ? { enabled: false } : level === 'on' ? { enabled: true } : { effort }
      break
    case 'groq':
      body.reasoning_effort = level === 'off' ? 'none' : 'default'
      break
    case 'google':
      body.reasoning_effort = level === 'off' ? 'none' : effort
      break
    case 'zai':
      body.thinking = { type: level === 'off' ? 'disabled' : 'enabled' }
      break
    case 'xai':
      if (level !== 'off') body.reasoning_effort = effort === 'medium' ? 'high' : effort
      break
    default:
      if (level !== 'off') body.reasoning_effort = effort
      else if (/gpt-5/i.test(_modelId)) body.reasoning_effort = 'minimal'
      break
  }
}

export async function* sseLines(res: Response, signal?: AbortSignal): AsyncGenerator<string> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      if (signal?.aborted) break
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, '')
        buffer = buffer.slice(idx + 1)
        if (line) yield line
      }
    }
  } finally {
    reader.releaseLock()
  }
}

async function bufferedChat(
  req: ChatRequest,
  endpoint: { baseUrl: string; style: ApiStyle; headers?: Record<string, string> },
  headers: Record<string, string>,
  body: Record<string, unknown>,
  cb: StreamCallbacks,
): Promise<Usage> {
  const b = { ...body }
  delete b.stream
  delete b.stream_options
  const url = chatUrl(endpoint.baseUrl, endpoint.style)
  const res = await abortRace(corsFetch(url, { method: 'POST', headers, body: JSON.stringify(b), signal: req.signal }, { buffered: true }), req.signal)
  if (!res.ok) throw await readError(res, req.conn.providerId)
  const bodyText = await res.text()
  let j: any
  try {
    j = JSON.parse(bodyText)
  } catch {
    throw new LlmError(`${req.conn.providerId} returned a non-JSON response${bodyText ? `: ${bodyText.slice(0, 200)}` : ' (empty body)'}`)
  }

  let text = ''
  let reasoning = ''
  let inputTokens: number | undefined
  let outputTokens: number | undefined
  if (endpoint.style === 'anthropic') {
    const blocks = j.content ?? []
    text = blocks.filter((x: any) => x.type === 'text').map((x: any) => x.text).join('')
    reasoning = blocks.filter((x: any) => x.type === 'thinking').map((x: any) => x.thinking).join('')
    inputTokens = j.usage?.input_tokens
    outputTokens = j.usage?.output_tokens
  } else if (endpoint.style === 'cohere') {
    const blocks = j.message?.content ?? []
    text = blocks.filter((x: any) => x.type === 'text').map((x: any) => x.text).join('')
    reasoning = blocks.filter((x: any) => x.type === 'thinking').map((x: any) => x.thinking).join('')
    inputTokens = j.usage?.tokens?.input_tokens ?? j.usage?.billed_units?.input_tokens
    outputTokens = j.usage?.tokens?.output_tokens ?? j.usage?.billed_units?.output_tokens
  } else {
    const m = j.choices?.[0]?.message
    text = m?.content ?? ''
    reasoning = m?.reasoning_content ?? m?.reasoning ?? ''
    inputTokens = j.usage?.prompt_tokens ?? j.usage?.input_tokens
    outputTokens = j.usage?.completion_tokens ?? j.usage?.output_tokens
  }
  if (reasoning) cb.onReasoning?.(reasoning)
  const splitter = makeThinkSplitter((d) => cb.onText?.(d), (d) => cb.onReasoning?.(d))
  if (req.prefill) splitter.push(req.prefill)
  splitter.push(text)
  splitter.flush()

  if (inputTokens == null) {
    const promptChars = (req.system ?? '').length + req.turns.reduce((n, t) => n + t.content.length, 0)
    inputTokens = estimateTokens(' '.repeat(promptChars))
  }
  if (outputTokens == null) outputTokens = estimateTokens(text + reasoning)
  return { inputTokens, outputTokens, estimated: !j.usage }
}

export async function streamChat(req: ChatRequest, cb: StreamCallbacks): Promise<Usage> {
  const endpoint = endpointFor(req.conn, req.catalogProvider, req.model)
  if (!endpoint) {
    throw new LlmError(
      `No browser endpoint known for ${req.conn.providerId}. Set a custom base URL for it in Settings → Providers.`,
    )
  }
  const style: ApiStyle = endpoint.style
  const headers = authHeaders(style, req.conn.apiKey, endpoint.headers)
  const vision = modelSupportsVision(req.modelMeta)

  let url: string
  let body: Record<string, unknown>

  if (style === 'anthropic') {
    url = chatUrl(endpoint.baseUrl, style)
    body = {
      model: resolveModelId(req.conn.providerId, req.model),
      messages: anthropicMessages(req.turns, vision),
      max_tokens: req.maxTokens ?? Math.min(req.modelMeta?.limit?.output ?? 4096, 8192),
      stream: true,
    }
    if (req.system?.trim()) body.system = req.system
    if (req.thinking && req.thinking !== 'off' && req.modelMeta?.reasoning && !req.prefill) {
      const outputLimit = req.modelMeta?.limit?.output ?? 16384
      const budget = Math.max(1024, Math.min(EFFORT_BUDGET[req.thinking] ?? 12288, outputLimit - 4096))
      body.thinking = { type: 'enabled', budget_tokens: budget }
      body.max_tokens = Math.min(outputLimit, budget + 8192)
      // anthropic rejects custom temperature while thinking is enabled
    } else if (req.temperature != null && req.modelMeta?.temperature !== false) {
      body.temperature = clampTemperature(req.conn.providerId, req.temperature)
    }
  } else if (style === 'cohere') {
    url = chatUrl(endpoint.baseUrl, style)
    body = {
      model: resolveModelId(req.conn.providerId, req.model),
      messages: openaiMessages(req.system, req.turns, vision),
      stream: true,
    }
    if (req.temperature != null && req.modelMeta?.temperature !== false) body.temperature = clampTemperature(req.conn.providerId, req.temperature)
    if (req.maxTokens) body.max_tokens = req.maxTokens
    if (req.modelMeta?.reasoning && req.thinking && !req.prefill) {
      body.thinking = req.thinking === 'off'
        ? { type: 'disabled' }
        : { type: 'enabled', token_budget: EFFORT_BUDGET[req.thinking] ?? 8192 }
    }
  } else {
    url = chatUrl(endpoint.baseUrl, style)
    body = {
      model: resolveModelId(req.conn.providerId, req.model),
      messages: openaiMessages(req.system, req.turns, vision),
      stream: true,
    }
    if (req.temperature != null && req.modelMeta?.temperature !== false) body.temperature = clampTemperature(req.conn.providerId, req.temperature)
    if (req.maxTokens) body.max_tokens = req.maxTokens
    if (req.thinking && req.modelMeta?.reasoning && supportsThinkingControl(req.conn.providerId, 'openai', req.model)) {
      applyThinking(body, req.conn.providerId, req.model, req.thinking)
    }
    if (supportsStreamUsage(req.conn.providerId)) {
      body.stream_options = { include_usage: true }
    }
  }

  let res: Response
  try {
    res = await fetchWithRetry(url, { method: 'POST', headers, body: JSON.stringify(body), signal: req.signal }, req.conn.providerId)
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    if (isNative()) {
      try {
        return await bufferedChat(req, endpoint, headers, body, cb)
      } catch (err2) {
        if (err2 instanceof LlmError) throw err2
        if ((err2 as Error).name === 'AbortError') throw err2
        const detail = (err2 as Error)?.message || String(err2)
        throw new LlmError(`${req.conn.providerId}: direct (CORS) call failed and the native HTTP fallback also failed — ${detail}`)
      }
    }
    if (err instanceof NetError) throw new LlmError(err.message)
    throw networkError(req.conn.providerId, endpoint.baseUrl)
  }
  if (!res.ok && (res.status === 401 || res.status === 403) && isNative() && !req.signal?.aborted) {
    try {
      return await bufferedChat(req, endpoint, headers, body, cb)
    } catch (err2) {
      if (err2 instanceof LlmError) throw err2
      if ((err2 as Error).name === 'AbortError') throw err2
      /* fall through to the original auth error below */
    }
  }
  if (!res.ok || !res.body) throw await readError(res, req.conn.providerId)

  let textOut = ''
  let reasoningOut = ''
  let inputTokens: number | undefined
  let outputTokens: number | undefined

  if (style === 'anthropic') {
    if (req.prefill) {
      textOut += req.prefill
      cb.onText?.(req.prefill)
    }
    for await (const line of sseLines(res, req.signal)) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      let j: any
      try {
        j = JSON.parse(payload)
      } catch {
        continue
      }
      switch (j.type) {
        case 'message_start':
          inputTokens = j.message?.usage?.input_tokens ?? inputTokens
          break
        case 'content_block_delta': {
          const d = j.delta
          if (d?.type === 'text_delta' && d.text) {
            textOut += d.text
            cb.onText?.(d.text)
          } else if (d?.type === 'thinking_delta' && d.thinking) {
            reasoningOut += d.thinking
            cb.onReasoning?.(d.thinking)
          }
          break
        }
        case 'message_delta':
          outputTokens = j.usage?.output_tokens ?? outputTokens
          break
        case 'error':
          throw new LlmError(j.error?.message ?? 'Stream error from Anthropic')
      }
    }
  } else if (style === 'cohere') {
    if (req.prefill) {
      textOut += req.prefill
      cb.onText?.(req.prefill)
    }
    for await (const line of sseLines(res, req.signal)) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      let j: any
      try {
        j = JSON.parse(payload)
      } catch {
        continue
      }
      if (j.type === 'content-delta') {
        const c = j.delta?.message?.content
        if (typeof c?.text === 'string' && c.text) {
          textOut += c.text
          cb.onText?.(c.text)
        }
        if (typeof c?.thinking === 'string' && c.thinking) {
          reasoningOut += c.thinking
          cb.onReasoning?.(c.thinking)
        }
      } else if (j.type === 'message-end') {
        const u = j.delta?.usage?.tokens ?? j.delta?.usage?.billed_units
        if (u) {
          inputTokens = u.input_tokens ?? inputTokens
          outputTokens = u.output_tokens ?? outputTokens
        }
      }
    }
  } else {
    const splitter = makeThinkSplitter(
      (d) => {
        textOut += d
        cb.onText?.(d)
      },
      (d) => {
        reasoningOut += d
        cb.onReasoning?.(d)
      },
    )
    if (req.prefill) splitter.push(req.prefill)
    for await (const line of sseLines(res, req.signal)) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      let j: any
      try {
        j = JSON.parse(payload)
      } catch {
        continue
      }
      if (j.error) throw new LlmError(j.error.message ?? 'Stream error')
      const delta = j.choices?.[0]?.delta
      if (delta) {
        const reasoning = delta.reasoning_content ?? delta.reasoning
        if (typeof reasoning === 'string' && reasoning) {
          reasoningOut += reasoning
          cb.onReasoning?.(reasoning)
        }
        if (typeof delta.content === 'string' && delta.content) {
          splitter.push(delta.content)
        }
      }
      if (j.usage) {
        inputTokens = j.usage.prompt_tokens ?? j.usage.input_tokens ?? inputTokens
        outputTokens = j.usage.completion_tokens ?? j.usage.output_tokens ?? outputTokens
      }
    }
    splitter.flush()
  }

  const estimated = inputTokens == null || outputTokens == null
  if (inputTokens == null) {
    const promptChars = (req.system ?? '').length + req.turns.reduce((n, t) => n + t.content.length, 0)
    inputTokens = estimateTokens(' '.repeat(promptChars))
  }
  if (outputTokens == null) outputTokens = estimateTokens(textOut + reasoningOut)
  return { inputTokens, outputTokens, estimated }
}

export function splitLeadingThink(raw: string): { text: string; reasoning?: string } {
  const re = new RegExp(`^\\s*<(${THINK_TAGS.join('|')})>([\\s\\S]*?)<\\/\\1>\\s*`, 'i')
  const m = raw.match(re)
  if (m) return { text: raw.slice(m[0].length).trim(), reasoning: m[2].trim() || undefined }
  return { text: raw.trim() }
}

export async function completeOnce(req: Omit<ChatRequest, 'signal'> & { signal?: AbortSignal }): Promise<{ text: string; reasoning?: string }> {
  const endpoint = endpointFor(req.conn, req.catalogProvider, req.model)
  if (!endpoint) throw new LlmError(`No endpoint for ${req.conn.providerId}`)
  const headers = authHeaders(endpoint.style, req.conn.apiKey, endpoint.headers)

  const vision = modelSupportsVision(req.modelMeta)
  let res: Response
  try {
    if (endpoint.style === 'anthropic') {
      const body: Record<string, unknown> = {
        model: resolveModelId(req.conn.providerId, req.model),
        messages: anthropicMessages(req.turns, vision),
        max_tokens: req.maxTokens ?? 300,
      }
      if (req.system?.trim()) body.system = req.system
      res = await fetchWithRetry(chatUrl(endpoint.baseUrl, endpoint.style), {
        method: 'POST', headers, body: JSON.stringify(body), signal: req.signal,
      }, req.conn.providerId, { buffered: true })
      if (!res.ok) throw await readError(res, req.conn.providerId)
      const j = await res.json()
      const blocks = j.content ?? []
      return {
        text: blocks.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(''),
        reasoning: blocks.filter((b: any) => b.type === 'thinking').map((b: any) => b.thinking).join('') || undefined,
      }
    } else if (endpoint.style === 'cohere') {
      const body: Record<string, unknown> = {
        model: resolveModelId(req.conn.providerId, req.model),
        messages: openaiMessages(req.system, req.turns, vision),
      }
      if (req.maxTokens) body.max_tokens = req.maxTokens
      res = await fetchWithRetry(chatUrl(endpoint.baseUrl, endpoint.style), {
        method: 'POST', headers, body: JSON.stringify(body), signal: req.signal,
      }, req.conn.providerId, { buffered: true })
      if (!res.ok) throw await readError(res, req.conn.providerId)
      const j = await res.json()
      const blocks = j.message?.content ?? []
      return {
        text: blocks.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(''),
        reasoning: blocks.filter((b: any) => b.type === 'thinking').map((b: any) => b.thinking).join('') || undefined,
      }
    } else {
      const body: Record<string, unknown> = {
        model: resolveModelId(req.conn.providerId, req.model),
        messages: openaiMessages(req.system, req.turns, vision),
      }
      if (req.maxTokens) body.max_tokens = req.maxTokens
      if (req.thinking && req.modelMeta?.reasoning && supportsThinkingControl(req.conn.providerId, 'openai', req.model)) {
        applyThinking(body, req.conn.providerId, req.model, req.thinking)
      }
      res = await fetchWithRetry(chatUrl(endpoint.baseUrl, endpoint.style), {
        method: 'POST', headers, body: JSON.stringify(body), signal: req.signal,
      }, req.conn.providerId, { buffered: true })
      if (!res.ok) throw await readError(res, req.conn.providerId)
      const j = await res.json()
      const m = j.choices?.[0]?.message
      const rc = m?.reasoning_content ?? m?.reasoning
      if (typeof rc === 'string' && rc.trim()) return { text: m?.content ?? '', reasoning: rc.trim() }
      return splitLeadingThink(m?.content ?? '')
    }
  } catch (err) {
    if (err instanceof LlmError) throw err
    if ((err as Error).name === 'AbortError') throw err
    if (err instanceof NetError) throw new LlmError(err.message)
    throw networkError(req.conn.providerId, endpoint.baseUrl)
  }
}
