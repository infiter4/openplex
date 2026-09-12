import { Capacitor } from '@capacitor/core'
import { corsFetch } from './net'
import { authHeaders, clampTemperature, endpointFor, resolveModelId, supportsStreamUsage, type ApiStyle } from './providers'
import { estimateTokens } from './utils'
import {
  anthropicMessages,
  chatUrl,
  friendlyError,
  LlmError,
  makeThinkSplitter,
  modelSupportsVision,
  openaiMessages,
  sseLines,
  streamChat,
  type ChatRequest,
  type StreamCallbacks,
} from './llm'
import { AGENT_TOOLS, executeTool, isAgentTool, type ToolSpec } from './tools'
import type { AgentImage, CatalogModel, ToolStep, Usage } from './types'

async function runTool(
  name: string,
  args: any,
  threadId: string,
  onToolStep: (s: ToolStep) => void,
  signal?: AbortSignal,
): Promise<{ content: string; images?: AgentImage[] }> {
  if (!isAgentTool(name)) return { content: `ERROR: unknown tool "${name}"` }
  return executeTool(name, args, threadId, onToolStep, signal)
}

const MAX_ROUNDS = 16
const STREAM = !Capacitor.isNativePlatform()

const TOOL_SYSTEM_HINT =
  "You can operate the user's computer through tools: run terminal commands and code, read/write/edit files, and produce downloadable documents (pdf/docx/pptx/xlsx/…). Each chat thread has its own persistent shell (cwd/env/venv persist between commands).\n\n" +
  "CRITICAL — you have NO other way to make a file, image, or result except by CALLING THESE TOOLS. NEVER say you created, generated, saved, rendered, drew, or attached anything, and never say a file is 'ready to download', unless you ACTUALLY called write_file / make_document / code in THIS turn and it succeeded. Claiming a result without a tool call is a hallucination and is forbidden — the user gets nothing.\n\n" +
  "To make any artifact: WRITE CODE and RUN it with the tools. E.g. for an image or generative art, write Python (PIL/Pillow, matplotlib, svgwrite, cairosvg, numpy) or an SVG/HTML file, run it to produce the PNG/SVG/PDF. For styled documents author a COMPLETE self-contained HTML document and use make_document (PDFs render through a real headless browser, so any modern CSS works).\n\n" +
  "DELIVER every file so the user can download it from chat: write_file and make_document do this automatically; for a file produced by a terminal command/script (an image, archive, dataset, anything) call download_file on its path — the user CANNOT reach files left only on disk.\n\n" +
  "VERIFY visual work before claiming done: after generating an image, chart, diagram, or PDF, call view_image on it and actually LOOK at the result. If it doesn't match what was asked, fix the code and re-render; only deliver and say it's done once you've confirmed it looks right.\n\n" +
  "NEVER open or display a file on the user's screen (no xdg-open, open, eog, start, display, etc.) — those block forever and the user can't see your screen anyway. Hand files over with download_file. A `terminal` command that goes 30s with no output is auto-paused and returned to you; for anything long-running or blocking (servers, watchers, training, or opening something) use run_background and poll it with check_background instead. Take the action with tools every time — do not just describe it."

const FILE_CLAIM = /\b(download|saved|generated|created|rendered|attached|ready|here'?s your|\.(png|jpe?g|gif|svg|pdf|docx?|pptx?|xlsx?|csv|zip|mp4|wav|mp3|html?))\b/i
const NUDGE =
  'You did NOT call any tool, so nothing was produced and no file exists — that reply was a hallucination. You can only create files or run code by calling the tools. Do it now: write the actual code/HTML and run or save it with the tools.'
const looksLikeFileClaim = (t: string) => FILE_CLAIM.test(t)

export function modelSupportsTools(meta?: CatalogModel): boolean {
  return meta?.tool_call !== false
}

const BROWSER_ONLY_HINT =
  "The user's computer is NOT connected right now, so you have exactly one tool: make_document, which builds a downloadable file (pdf, html, md, txt, csv, json) right here in the app — no computer needed. Use it whenever the user wants a document or file.\n\n" +
  "You CANNOT run commands, execute code, or read/write files on their machine this turn. Do NOT ask the user to connect, pair or sync anything, and do NOT claim you ran or saved something. If a request genuinely needs a computer, say so plainly in one line and offer what you CAN do instead (produce the document, or write the code out in your reply).\n\n" +
  "NEVER say you created, saved, generated or attached a file unless you ACTUALLY called make_document in THIS turn and it succeeded."

function withHint(system: string | undefined, hasComputer: boolean): string {
  const hint = hasComputer ? TOOL_SYSTEM_HINT : BROWSER_ONLY_HINT
  return system?.trim() ? `${system}\n\n${hint}` : hint
}

async function readErr(res: Response, providerId: string): Promise<LlmError> {
  const text = await res.text().catch(() => '')
  let detail = text.slice(0, 300)
  try {
    const j = JSON.parse(text)
    detail = j?.error?.message ?? j?.message ?? detail
  } catch {
    /* keep snippet */
  }
  return new LlmError(friendlyError(res.status, providerId, detail), res.status)
}

async function postJson(url: string, headers: Record<string, string>, body: unknown, signal: AbortSignal | undefined, providerId: string): Promise<any> {
  const res = await corsFetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal }, { buffered: true })
  const text = await res.text()
  if (!res.ok) {
    let detail = text.slice(0, 300)
    try { const j = JSON.parse(text); detail = j?.error?.message ?? j?.message ?? detail } catch { /* keep snippet */ }
    throw new LlmError(friendlyError(res.status, providerId, detail), res.status)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new LlmError(`tool request returned non-JSON: ${text.slice(0, 200)}`)
  }
}

interface Emitters {
  onContent: (d: string) => void
  onReason: (d: string) => void
  signal?: AbortSignal
}

async function openaiCall(url: string, headers: Record<string, string>, base: any, e: Emitters, streamUsage: boolean, providerId: string) {
  if (STREAM) {
    // stream_options is OpenAI-only; strict gateways (e.g. z.ai) 400 on the unknown field, so only
    // include it where supported. Without it usage may be approximate, but the request succeeds.
    const body = { ...base, stream: true, ...(streamUsage ? { stream_options: { include_usage: true } } : {}) }
    const res = await corsFetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: e.signal })
    if (!res.ok || !res.body) throw await readErr(res, providerId)
    let content = ''
    // Fold inline reasoning tags (<think>/<thought>/…) into the Reasoning section, exactly like the
    // non-agentic path — otherwise models such as Gemma leak <thought>…</thought> into the answer.
    const split = makeThinkSplitter((d) => { content += d; e.onContent(d) }, e.onReason)
    const calls: any[] = []
    let uin = 0, uout = 0
    for await (const line of sseLines(res, e.signal)) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      let j: any
      try { j = JSON.parse(payload) } catch { if (import.meta.env.DEV) console.debug('[openplex] skipped unparseable SSE frame'); continue }
      if (j.error) throw new LlmError(j.error.message ?? 'stream error')
      const delta = j.choices?.[0]?.delta
      if (delta) {
        const r = delta.reasoning_content ?? delta.reasoning
        if (typeof r === 'string' && r) e.onReason(r)
        if (typeof delta.content === 'string' && delta.content) split.push(delta.content)
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const i = tc.index ?? 0
            calls[i] = calls[i] || { id: '', type: 'function', function: { name: '', arguments: '' } }
            if (tc.id) calls[i].id = tc.id
            if (tc.function?.name) calls[i].function.name += tc.function.name
            if (typeof tc.function?.arguments === 'string') calls[i].function.arguments += tc.function.arguments
          }
        }
      }
      if (j.usage) { uin = j.usage.prompt_tokens ?? uin; uout = j.usage.completion_tokens ?? uout }
    }
    split.flush()
    return { content, toolCalls: calls.filter(Boolean), usage: { in: uin, out: uout } }
  }
  const j = await postJson(url, headers, { ...base, stream: false }, e.signal, providerId)
  const msg = j?.choices?.[0]?.message ?? {}
  const r = msg.reasoning_content ?? msg.reasoning
  if (r) e.onReason(String(r))
  let content = ''
  if (msg.content) {
    const split = makeThinkSplitter((d) => { content += d; e.onContent(d) }, e.onReason)
    split.push(String(msg.content)); split.flush()
  }
  return { content, toolCalls: msg.tool_calls ?? [], usage: { in: j?.usage?.prompt_tokens ?? 0, out: j?.usage?.completion_tokens ?? 0 } }
}

async function anthropicCall(url: string, headers: Record<string, string>, base: any, e: Emitters, providerId: string) {
  if (STREAM) {
    const res = await corsFetch(url, { method: 'POST', headers, body: JSON.stringify({ ...base, stream: true }), signal: e.signal })
    if (!res.ok || !res.body) throw await readErr(res, providerId)
    const acc: Record<number, any> = {}
    const split = makeThinkSplitter(e.onContent, e.onReason)
    let uin = 0, uout = 0
    for await (const line of sseLines(res, e.signal)) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload) continue
      let j: any
      try { j = JSON.parse(payload) } catch { if (import.meta.env.DEV) console.debug('[openplex] skipped unparseable SSE frame'); continue }
      if (j.type === 'message_start') uin = j.message?.usage?.input_tokens ?? uin
      else if (j.type === 'content_block_start') acc[j.index] = { type: j.content_block?.type, id: j.content_block?.id, name: j.content_block?.name, text: '', inputJson: '' }
      else if (j.type === 'content_block_delta') {
        const a = acc[j.index] ?? (acc[j.index] = { type: 'text', text: '', inputJson: '' })
        const d = j.delta ?? {}
        if (d.type === 'text_delta' && d.text) { a.text += d.text; split.push(d.text) }
        else if (d.type === 'thinking_delta' && d.thinking) e.onReason(d.thinking)
        else if (d.type === 'input_json_delta' && d.partial_json) a.inputJson += d.partial_json
      } else if (j.type === 'message_delta') uout = j.usage?.output_tokens ?? uout
      else if (j.type === 'error') throw new LlmError(j.error?.message ?? 'stream error')
    }
    split.flush()
    const blocks: any[] = []
    const toolUses: any[] = []
    for (const i of Object.keys(acc).map(Number).sort((a, b) => a - b)) {
      const a = acc[i]
      if (a.type === 'tool_use') {
        let input = {}
        try { input = JSON.parse(a.inputJson || '{}') } catch { /* leave empty */ }
        blocks.push({ type: 'tool_use', id: a.id, name: a.name, input })
        toolUses.push({ id: a.id, name: a.name, input })
      } else if (a.type === 'text' && a.text) {
        blocks.push({ type: 'text', text: a.text })
      }
    }
    return { blocks, toolUses, usage: { in: uin, out: uout } }
  }
  const j = await postJson(url, headers, { ...base, stream: false }, e.signal, providerId)
  const blocks: any[] = Array.isArray(j?.content) ? j.content : []
  const think = blocks.filter((b) => b.type === 'thinking').map((b) => b.thinking).join('')
  if (think) e.onReason(think)
  const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('')
  if (text) { const split = makeThinkSplitter(e.onContent, e.onReason); split.push(text); split.flush() }
  const toolUses = blocks.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, input: b.input ?? {} }))
  return { blocks, toolUses, usage: { in: j?.usage?.input_tokens ?? 0, out: j?.usage?.output_tokens ?? 0 } }
}

export async function streamChatAgentic(
  req: ChatRequest,
  cb: StreamCallbacks,
  onToolStep: (step: ToolStep) => void,
  threadId: string,
  available: ToolSpec[] = AGENT_TOOLS,
): Promise<Usage> {
  const hasComputer = available.some((t) => t.name === 'terminal')
  const endpoint = endpointFor(req.conn, req.catalogProvider, req.model)
  if (!endpoint) throw new LlmError(`No endpoint known for ${req.conn.providerId}.`)
  const style: ApiStyle = endpoint.style
  if (style !== 'openai' && style !== 'anthropic') return streamChat(req, cb)

  const headers = authHeaders(style, req.conn.apiKey, endpoint.headers)
  const url = chatUrl(endpoint.baseUrl, style)
  const vision = modelSupportsVision(req.modelMeta)
  const maxTokens = req.maxTokens ?? 4096

  let inputTokens = 0
  let outputTokens = 0
  // All generated text (content + reasoning) across rounds, used to estimate usage when a provider
  // doesn't report it — e.g. when stream_options is omitted for a strict gateway like z.ai.
  let genText = ''
  // While true, the model's text is a reply to a system intervention (the file-claim nudge),
  // so it's kept out of the user-visible stream — only the model's own history sees it.
  let suppressTurn = false
  const e: Emitters = {
    onContent: (d) => {
      if (!d) return
      genText += d
      if (suppressTurn) return
      cb.onText?.(d)
    },
    onReason: (d) => {
      if (!d) return
      genText += d
      if (!suppressTurn) cb.onReasoning?.(d)
    },
    signal: req.signal,
  }

  if (style === 'openai') {
    const tools = available.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }))
    const messages: any[] = openaiMessages(withHint(req.system, hasComputer), req.turns, vision)
    let toolsCalled = 0
    let nudged = false
    let turnText = ''
    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (req.signal?.aborted) break
      const base: any = { model: resolveModelId(req.conn.providerId, req.model), messages, tools, tool_choice: 'auto' }
      if (req.temperature != null && req.modelMeta?.temperature !== false) base.temperature = clampTemperature(req.conn.providerId, req.temperature)
      if (req.maxTokens) base.max_tokens = req.maxTokens
      const { content, toolCalls, usage } = await openaiCall(url, headers, base, e, supportsStreamUsage(req.conn.providerId), req.conn.providerId)
      inputTokens += usage.in; outputTokens += usage.out
      turnText += content || ''
      if (!toolCalls.length) {
        if (toolsCalled === 0 && !nudged && looksLikeFileClaim(turnText)) {
          nudged = true
          cb.onDropPendingText?.()
          suppressTurn = true
          messages.push({ role: 'assistant', content: content || '' })
          messages.push({ role: 'user', content: NUDGE })
          continue
        }
        break
      }
      cb.onSegmentBreak?.()
      suppressTurn = false
      toolsCalled += toolCalls.length
      messages.push({ role: 'assistant', content: content || null, tool_calls: toolCalls })
      const viewedImages: any[] = []
      for (const call of toolCalls) {
        const name = call.function?.name
        let args: any = {}
        try { args = JSON.parse(call.function?.arguments || '{}') } catch { /* leave empty */ }
        const result = await runTool(name, args, threadId, onToolStep, req.signal)
        messages.push({ role: 'tool', tool_call_id: call.id, content: result.content })
        if (vision && result.images?.length) {
          for (const im of result.images) viewedImages.push({ type: 'image_url', image_url: { url: `data:${im.mime};base64,${im.b64}` } })
        }
      }
      if (viewedImages.length) messages.push({ role: 'user', content: [{ type: 'text', text: 'Here is what you asked to view — inspect it:' }, ...viewedImages] })
    }
  } else {
    const tools = available.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }))
    const messages: any[] = anthropicMessages(req.turns, vision)
    let toolsCalled = 0
    let nudged = false
    let turnText = ''
    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (req.signal?.aborted) break
      const base: any = { model: resolveModelId(req.conn.providerId, req.model), messages, tools, max_tokens: maxTokens, system: withHint(req.system, hasComputer) }
      if (req.temperature != null && req.modelMeta?.temperature !== false) base.temperature = clampTemperature(req.conn.providerId, req.temperature)
      const { blocks, toolUses, usage } = await anthropicCall(url, headers, base, e, req.conn.providerId)
      inputTokens += usage.in; outputTokens += usage.out
      turnText += blocks.filter((b) => b.type === 'text').map((b) => b.text).join('')
      if (!toolUses.length) {
        if (toolsCalled === 0 && !nudged && blocks.length && looksLikeFileClaim(turnText)) {
          nudged = true
          cb.onDropPendingText?.()
          suppressTurn = true
          messages.push({ role: 'assistant', content: blocks })
          messages.push({ role: 'user', content: NUDGE })
          continue
        }
        break
      }
      cb.onSegmentBreak?.()
      suppressTurn = false
      toolsCalled += toolUses.length
      messages.push({ role: 'assistant', content: blocks })
      const resultBlocks: any[] = []
      for (const u of toolUses) {
        const result = await runTool(u.name, u.input ?? {}, threadId, onToolStep, req.signal)
        const content = vision && result.images?.length
          ? [{ type: 'text', text: result.content }, ...result.images.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.mime, data: im.b64 } }))]
          : result.content
        resultBlocks.push({ type: 'tool_result', tool_use_id: u.id, content })
      }
      messages.push({ role: 'user', content: resultBlocks })
    }
  }

  // Fall back to estimates if the provider reported no usage (some omit it without stream_options),
  // so token counts/cost don't read as 0 for providers outside the stream_options allowlist.
  const estimated = inputTokens === 0 || outputTokens === 0
  if (outputTokens === 0) outputTokens = estimateTokens(genText)
  if (inputTokens === 0) {
    inputTokens = estimateTokens(req.system ?? '') + req.turns.reduce((n, t) => n + estimateTokens(t.content ?? ''), 0)
  }
  return { inputTokens, outputTokens, estimated }
}
