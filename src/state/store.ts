import { create } from 'zustand'
import { bus, setMetaTs } from '../lib/bus'
import { resolveModel } from '../lib/catalog'
import { db } from '../lib/db'
import { completeOnce, streamChat, stripThink, type ChatRequest } from '../lib/llm'
import { modelSupportsTools, streamChatAgentic } from '../lib/agentLoop'
import { toolsFor } from '../lib/tools'
import { computeAvailable } from '../lib/agentBackend'
import { agenticSearchPrompt, buildSearchAugmentedText, buildSystemPrompt, buildTurns, memoryExtractionPrompt, searchQueryPrompt, sourceSelectionPrompt, TITLE_PROMPT } from '../lib/prompts'
import { applyMetaPayload, buildMetaPayload, getStoredBlob, getStoredPassphrase } from '../lib/settingsSync'
import { fetchPages, lightSources, searchAll } from '../lib/search'
import { diversify, rankSources } from '../lib/rank'
import { getSupabase } from '../lib/supabase'
import type { HealTarget } from '../lib/heal'
import { SyncEngine, type SyncStatus } from '../lib/sync'
import { mergeUsage } from '../lib/cost'
import type { AgentFile, Attachment, Memory, Message, MessageSegment, ModelRef, SearchStep, Source, Thread, ToolStep, Usage } from '../lib/types'
import { estimateTokens, extractJsonArray, hostOf, uid } from '../lib/utils'
import { useConflicts } from './conflicts'
import { useProviders } from './providers'
import { useSettings } from './settings'
import { toast } from './toasts'

export type SettingsTab = 'providers' | 'search' | 'voice' | 'memory' | 'sync' | 'repair' | 'appearance' | 'data'
export type StreamPhase = 'searching' | 'waiting' | 'streaming'

interface StreamingInfo {
  threadId: string
  messageId: string
  phase: StreamPhase
  detail?: string
  steps?: SearchStep[]
}

export type Surface = 'stage' | 'library' | 'models' | 'settings'

export interface CompareItem {
  ref: ModelRef
  status: 'pending' | 'done' | 'error'
  text: string
  reasoning?: string
  usage?: Usage
  error?: string
}

export interface CompareState {
  messageId: string
  items: CompareItem[]
}

interface AppStore {
  ready: boolean
  threads: Thread[]
  messages: Record<string, Message[]>
  memories: Memory[]
  activeThreadId: string | null
  streaming: StreamingInfo | null
  draftWebSearch: boolean
  draftThinking?: string
  draftContextCap?: number
  draftMaxOutput?: number
  draftSystemPrompt?: string

  sidebarOpen: boolean
  settingsTab: SettingsTab | null
  settingsProviderFocus: string | null
  /** What the repair agent should look at, when Repair was opened from a failure. */
  healTarget: HealTarget | null
  paletteOpen: boolean
  sourcesFor: string | null
  viewerFile: AgentFile | null
  shortcutsOpen: boolean
  surface: Surface
  pickerOpen: boolean
  compare: CompareState | null

  syncStatus: SyncStatus
  syncUser: { id: string; email?: string } | null
  lastSyncError?: string

  init: () => Promise<void>
  selectThread: (id: string | null) => Promise<void>
  send: (text: string, attachments?: Attachment[], prefill?: string) => Promise<void>
  stop: () => void
  regenerate: (messageId: string) => Promise<void>
  setMessageVariant: (messageId: string, index: number) => Promise<void>
  editUserMessage: (messageId: string, newText: string) => Promise<void>
  editAssistantMessage: (messageId: string, newText: string) => Promise<void>
  insertAssistantMessage: (text: string) => Promise<void>
  setModel: (ref: ModelRef) => void
  setWebSearch: (on: boolean) => void
  setThinking: (level: string | undefined) => void
  setContextCap: (tokens: number | undefined) => void
  setMaxOutput: (tokens: number | undefined) => void
  setSystemPrompt: (prompt: string | undefined) => void
  renameThread: (id: string, title: string) => void
  setThreadFolder: (id: string, folder: string | undefined) => void
  setThreadSystemPrompt: (id: string, prompt: string) => void
  togglePin: (id: string) => void
  deleteThread: (id: string) => Promise<void>
  addMemory: (content: string, source: Memory['source']) => void
  updateMemory: (id: string, patch: Partial<Pick<Memory, 'content' | 'enabled'>>) => void
  deleteMemory: (id: string) => void
  rememberMessage: (messageId: string) => Promise<void>
  reloadFromDb: () => Promise<void>

  setSidebarOpen: (open: boolean) => void
  openSettings: (tab?: SettingsTab, focusProvider?: string) => void
  setSettingsProviderFocus: (id: string | null) => void
  openRepair: (target?: HealTarget) => void
  closeSettings: () => void
  setPaletteOpen: (open: boolean) => void
  setSourcesFor: (messageId: string | null) => void
  openFile: (file: AgentFile) => void
  closeFile: () => void
  setShortcutsOpen: (open: boolean) => void
  setSurface: (s: Surface) => void
  setPickerOpen: (open: boolean) => void
  toggleArchive: (id: string) => void
  startCompare: (messageId: string, refs: ModelRef[]) => Promise<void>
  closeCompare: () => void
  keepCompare: (index: number) => Promise<void>

  initSync: () => Promise<void>
  syncNow: () => void
  stopSyncEngine: () => void
}

const searchCache = new Map<string, Source[]>()
let currentAbort: AbortController | null = null
let engine: SyncEngine | null = null
let authUnsub: (() => void) | null = null
let pushTimer: ReturnType<typeof setTimeout> | null = null

function requestPush(): void {
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(() => void engine?.sync(), 1500)
}

const now = () => Date.now()

const ENTITY_STOP = new Set(['The', 'What', 'Which', 'How', 'Who', 'When', 'Where', 'Why', 'Compare', 'Is', 'Are', 'Does', 'A', 'An', 'And', 'Or', 'Vs', 'Versus', 'Give', 'Me'])
function distinctiveEntities(question: string): string[] {
  const nameish = (t: string) => /^[A-Z]/.test(t) || /[A-Za-z]-[A-Za-z0-9]/.test(t) || /^[0-9]+(\.[0-9]+)?$/.test(t) || /[A-Za-z]-?[0-9]/.test(t)
  const phrases: string[] = []
  let cur: string[] = []
  const flush = () => { if (cur.length) phrases.push(cur.join(' ')); cur = [] }
  for (const raw of question.split(/\s+/)) {
    const t = raw.replace(/^[("'[]+|[)"'\].,;:?!]+$/g, '')
    if (!t) { flush(); continue }
    if (nameish(t) && !(cur.length === 0 && ENTITY_STOP.has(t))) {
      cur.push(t)
      if (/[,;:)]$/.test(raw)) flush()
    } else {
      flush()
    }
  }
  flush()
  const out: string[] = []
  for (const p of phrases) {
    const cleaned = p.replace(/[.,;:?!]+$/, '').trim()
    if (cleaned.length < 3) continue
    if (!/[0-9]/.test(cleaned)) continue
    if (!/[a-z]/i.test(cleaned)) continue
    out.push(cleaned)
  }
  return [...new Set(out)].slice(0, 8)
}

function cleanQuery(q: string): string {
  const stripped = q
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(please|kindly|can you|could you|would you|give me|show me|tell me|get me|find me|i want|i need|i'?d like|help me|make( me)?|create|draft|write|provide|present|generate)\b/gi, ' ')
    .replace(/\b(an? )?(answer|response)\b\s*(referencing|about|with|on|for)?/gi, ' ')
    .replace(/\b(in|as|into|using)\s+(a|an|the)?\s*(neat|nice|clean|simple|detailed|comparison)?\s*(table|chart|grid|list|markdown|format|spreadsheet)\b/gi, ' ')
    .replace(/\b(arrange|organi[sz]e|format|lay ?out|sort)\b/gi, ' ')
    .replace(/[?!]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return stripped.length >= 3 ? stripped : q.trim()
}

const TOPIC_FILLER = new Set(['the','a','an','of','for','and','or','to','in','on','at','by','with','about','what','whats','wbat','which','who','are','is','was','were','do','does','did','their','they','them','it','its','vs','versus','compare','comparison','between','give','tell','show','find','me','us','your','our','please','api','apis','app','apps'])
function questionTopic(question: string, entities: string[]): string {
  let q = ` ${question.toLowerCase()} `
  for (const e of entities) {
    q = q.replace(new RegExp(`\\b${e.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), ' ')
  }
  const words = q.split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !TOPIC_FILLER.has(w))
  return [...new Set(words)].slice(0, 5).join(' ') || cleanQuery(question)
}

function plannerThought(raw: string, fallback?: string): string | undefined {
  const field = raw.match(/"thought"\s*:\s*"((?:[^"\\]|\\.)*)/)
  if (field && field[1].trim()) {
    return field[1].replace(/\\"/g, '"').replace(/\\[nrt]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 280)
  }
  const prose = raw.replace(/```[a-z]*|```/gi, '').replace(/[{[][\s\S]*$/, '').replace(/\s+/g, ' ').trim()
  if (prose.length > 12) return prose.slice(0, 280)
  return fallback?.trim() || undefined
}

function extractQueries(raw: string): string[] {
  const take = (arr: unknown): string[] =>
    Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((s) => s.trim()) : []
  const obj = raw.match(/\{[\s\S]*\}/)
  if (obj) {
    try {
      const p = JSON.parse(obj[0]) as { queries?: unknown; search?: unknown }
      const qs = [...take(p.queries), ...take(p.search)]
      if (qs.length) return [...new Set(qs)]
    } catch {
      /* truncated — fall through */
    }
  }
  const block = raw.match(/"(?:queries|search)"\s*:\s*\[([\s\S]*?)(?:\]|$)/)
  if (block) {
    const items = block[1].match(/"((?:[^"\\]|\\.)+)"/g)
    if (items?.length) return [...new Set(items.map((s) => s.slice(1, -1).trim()).filter(Boolean))].slice(0, 5)
  }
  const bare = take(extractJsonArray(raw) ?? [])
  if (bare.length) return [...new Set(bare)]
  const lines: string[] = []
  for (const line of raw.split('\n')) {
    const mm = line.match(/^\s*(?:\d+[.)]|[-*•])\s*["“']([^"”']{4,100})["”']/)
    if (mm) lines.push(mm[1].trim())
  }
  return [...new Set(lines)].slice(0, 5)
}

export const useStore = create<AppStore>()((set, get) => {

  async function putThread(thread: Thread): Promise<void> {
    await db.threads.put(thread)
    const threads = get().threads.filter((t) => t.id !== thread.id)
    threads.push(thread)
    set({ threads })
    requestPush()
  }

  async function putMessage(msg: Message): Promise<void> {
    await db.messages.put(msg)
    patchMessageInState(msg.threadId, msg.id, () => msg)
    requestPush()
  }

  function patchMessageInState(threadId: string, messageId: string, patch: (m: Message | undefined) => Message): void {
    const list = get().messages[threadId] ?? []
    const idx = list.findIndex((m) => m.id === messageId)
    const next = [...list]
    if (idx >= 0) {
      next[idx] = patch(next[idx])
    } else {
      next.push(patch(undefined))
      next.sort((a, b) => a.createdAt - b.createdAt)
    }
    set({ messages: { ...get().messages, [threadId]: next } })
  }

  async function loadMessages(threadId: string): Promise<Message[]> {
    const cached = get().messages[threadId]
    if (cached) return cached
    const list = await db.messages.where('threadId').equals(threadId).sortBy('createdAt')
    set({ messages: { ...get().messages, [threadId]: list } })
    return list
  }

  function touchThread(threadId: string, patch: Partial<Thread> = {}): void {
    const t = get().threads.find((t) => t.id === threadId)
    if (!t) return
    void putThread({ ...t, ...patch, updatedAt: now(), dirty: 1 })
  }

  function resolveActiveModel(threadId?: string | null): { ref: ModelRef | null } {
    const tid = threadId ?? get().activeThreadId
    const thread = tid ? get().threads.find((t) => t.id === tid) : null
    const ref = thread?.modelRef ?? useSettings.getState().settings.defaultModel ?? null
    return { ref }
  }

  function buildRequestBits(ref: ModelRef) {
    const { catalog, connections } = useProviders.getState()
    const conn = connections[ref.providerId]
    const catalogProvider = catalog?.[ref.providerId]
    const modelMeta = resolveModel(catalog, ref).model
    return { conn, catalogProvider, modelMeta }
  }

  async function generateTitle(threadId: string): Promise<void> {
    const thread = get().threads.find((t) => t.id === threadId)
    if (!thread || !thread.untitled) return
    const { ref } = resolveActiveModel(threadId)
    if (!ref) return
    const { conn, catalogProvider, modelMeta } = buildRequestBits(ref)
    if (!conn) return
    const msgs = (get().messages[threadId] ?? []).filter((m) => !m.deleted && m.status === 'complete')
    const firstUser = msgs.find((m) => m.role === 'user')
    const firstAssistant = msgs.find((m) => m.role === 'assistant')
    if (!firstUser) return
    try {
      const { text: raw } = await completeOnce({
        conn, catalogProvider, modelMeta, model: ref.modelId,
        system: TITLE_PROMPT,
        turns: [{ role: 'user', content: `${firstUser.content.slice(0, 600)}\n\n${stripThink(firstAssistant?.content ?? '').slice(0, 400)}` }],
        maxTokens: 64,
        thinking: 'off', // hybrid reasoners would burn the whole budget thinking about a title
      })
      let title = stripThink(raw).replace(/^["'#\s]+|["'\s.]+$/g, '').split('\n')[0].slice(0, 80)
      if (!title) title = firstUser.content.replace(/\s+/g, ' ').trim().slice(0, 48)
      if (title) {
        const t = get().threads.find((t) => t.id === threadId)
        if (t) void putThread({ ...t, title, untitled: false, updatedAt: now(), dirty: 1 })
      }
    } catch {
      /* title stays "New chat" — retried after the next exchange */
    }
  }

  async function autoExtractMemories(threadId: string): Promise<void> {
    const { settings } = useSettings.getState()
    if (!settings.memory.enabled || !settings.memory.auto) return
    const { ref } = resolveActiveModel(threadId)
    if (!ref) return
    const { conn, catalogProvider, modelMeta } = buildRequestBits(ref)
    if (!conn) return
    const msgs = (get().messages[threadId] ?? []).filter((m) => !m.deleted && m.status === 'complete')
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user')
    const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant')
    if (!lastUser || lastUser.content.length < 40) return
    const existing = get().memories.filter((m) => !m.deleted).map((m) => m.content)
    try {
      const { text: raw } = await completeOnce({
        conn, catalogProvider, modelMeta, model: ref.modelId,
        system: memoryExtractionPrompt(existing),
        turns: [{ role: 'user', content: `User: ${lastUser.content.slice(0, 1500)}\n\nAssistant: ${stripThink(lastAssistant?.content ?? '').slice(0, 800)}` }],
        maxTokens: 250,
        thinking: 'off',
      })
      const arr = extractJsonArray(stripThink(raw)) ?? []
      const fresh = arr
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .map((s) => s.trim())
        .filter((s) => !existing.some((e) => e.toLowerCase() === s.toLowerCase()))
        .slice(0, 3)
      for (const content of fresh) get().addMemory(content, 'auto')
      if (fresh.length) toast.info(`Remembered ${fresh.length} thing${fresh.length > 1 ? 's' : ''}`, fresh[0])
    } catch {
      /* silent */
    }
  }

  const SMALLTALK =
    /^(hi+|hello|hey+|yo|sup|thanks?( you)?|thx|ty|ok(ay)?|cool|nice|great|perfect|lol|haha+|good (morning|night|evening|day)|bye|goodbye|see ya|no|yes|yeah|nah)[!,.\s]*$/i
  function shouldSkipSearch(text: string): boolean {
    const t = text.trim()
    return SMALLTALK.test(t) || (t.length <= 3 && !t.includes('?'))
  }

  interface SearchPlan {
    gaps: { entity: string; query: string }[]
    read: number[]
    reasoning?: string
  }

  function subjectContext(threadId: string): string {
    const thread = get().threads.find((t) => t.id === threadId)
    const settings = useSettings.getState().settings
    const sys = [settings.defaultSystemPrompt, thread?.systemPrompt].map((p) => p?.trim()).filter(Boolean).join('\n\n')
    const mems = settings.memory.enabled
      ? get().memories.filter((m) => m.enabled && !m.deleted).map((m) => m.content)
      : []
    const parts: string[] = []
    if (sys) parts.push(`Standing instructions: ${sys.slice(0, 1500)}`)
    if (mems.length) parts.push(`Known about the user:\n${mems.slice(-30).map((m) => `- ${m}`).join('\n')}`)
    return parts.join('\n\n')
  }

  function searchContext(threadId: string): string {
    const msgs = (get().messages[threadId] ?? []).filter((m) => !m.deleted && m.content.trim())
    const recent = msgs.slice(-10)
    const firstUser = msgs.find((m) => m.role === 'user')
    const out: string[] = []
    const subj = subjectContext(threadId)
    if (subj) out.push(subj)
    if (firstUser && !recent.includes(firstUser)) out.push(`user (first message): ${firstUser.content.slice(0, 600)}`)
    for (const m of recent) out.push(`${m.role}: ${(m.role === 'assistant' ? stripThink(m.content) : m.content).slice(0, 400)}`)
    return out.join('\n')
  }

  async function planSearch(
    question: string,
    context: string,
    sources: Source[],
    entities: string[],
    ref: ModelRef,
    signal: AbortSignal,
  ): Promise<SearchPlan | null> {
    const { conn, catalogProvider, modelMeta } = buildRequestBits(ref)
    if (!conn) return null
    try {
      const list = sources
        .slice(0, 16)
        .map((s, i) => {
          const full = (s.content?.length ?? 0) > 400
          const preview = (s.snippet ?? s.content ?? '').replace(/\s+/g, ' ').slice(0, 320)
          return `${i + 1}. [${full ? 'FULL' : 'SNIPPET'}] ${s.title} (${hostOf(s.url)})\n   ${preview}`
        })
        .join('\n')
      const checklist = entities.length ? entities.join(', ') : '(none pre-identified — judge from the question)'
      const { text: raw, reasoning } = await completeOnce({
        conn, catalogProvider, modelMeta, model: ref.modelId,
        system: agenticSearchPrompt(),
        turns: [{ role: 'user', content: `${context ? `Conversation so far:\n${context}\n\n` : ''}Question: ${question}\n\nEntities to cover: ${checklist}\n\nSources gathered so far:\n${list}\n\nFor EACH entity, check the sources for the specific data asked, then output the JSON (brief reasoning in "thought" — no long preamble).` }],
        maxTokens: 2000, thinking: 'off', signal,
      })
      const cleaned = stripThink(raw)
      const reasoningOut = plannerThought(cleaned, reasoning)
      const parseGaps = (v: unknown): { entity: string; query: string }[] => {
        if (!Array.isArray(v)) return []
        const out: { entity: string; query: string }[] = []
        for (const g of v) {
          if (g && typeof g === 'object') {
            const rec = g as Record<string, unknown>
            const query = typeof rec.query === 'string' ? rec.query.trim() : ''
            const entity = typeof rec.entity === 'string' ? rec.entity.trim() : ''
            if (query) out.push({ entity, query })
          }
        }
        return out
      }
      const m = cleaned.match(/\{[\s\S]*\}/)
      let p: { gaps?: unknown; read?: unknown } | null = null
      if (m) {
        try { p = JSON.parse(m[0]) } catch { /* truncated — salvage below */ }
      }
      if (p) {
        return {
          gaps: parseGaps(p.gaps).slice(0, 6),
          read: Array.isArray(p.read) ? p.read.filter((n): n is number => typeof n === 'number') : [],
          reasoning: reasoningOut,
        }
      }
      const salvaged = extractQueries(cleaned)
      if (salvaged.length) return { gaps: salvaged.slice(0, 4).map((query) => ({ entity: '', query })), read: [], reasoning: reasoningOut }
      return { gaps: [], read: [], reasoning: reasoningOut }
    } catch {
      return null
    }
  }

  interface SourceSelection {
    trust: string[]
    read: number[]
    reasoning?: string
  }

  async function selectSources(
    question: string,
    context: string,
    candidates: Source[],
    ref: ModelRef,
    signal: AbortSignal,
  ): Promise<SourceSelection | null> {
    const { conn, catalogProvider, modelMeta } = buildRequestBits(ref)
    if (!conn || !candidates.length) return null
    try {
      const list = candidates
        .map((s, i) => {
          const preview = (s.snippet ?? s.content ?? '').replace(/\s+/g, ' ').slice(0, 240)
          return `${i + 1}. ${s.title} (${hostOf(s.url)})\n   ${preview}`
        })
        .join('\n')
      const { text: raw } = await completeOnce({
        conn, catalogProvider, modelMeta, model: ref.modelId,
        system: sourceSelectionPrompt(),
        turns: [{ role: 'user', content: `${context ? `Conversation so far:\n${context}\n\n` : ''}Question: ${question}\n\nResults from the first search:\n${list}\n\nPick the hosts to trust and the results to read, then output the JSON.` }],
        maxTokens: 1200, thinking: 'off', signal,
      })
      const m = stripThink(raw).match(/\{[\s\S]*\}/)
      if (!m) return null
      const p = JSON.parse(m[0]) as { thought?: unknown; trust?: unknown; read?: unknown }
      const present = candidates.map((s) => hostOf(s.url))
      const trust = (Array.isArray(p.trust) ? p.trust : [])
        .filter((d): d is string => typeof d === 'string' && d.trim().length > 0)
        .map((d) => d.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '').trim().toLowerCase())
        // keep only hosts that genuinely appeared — blocks recall/hallucination
        .filter((h) => h && present.some((ph) => ph === h || ph.endsWith('.' + h) || h.endsWith('.' + ph)))
      return {
        trust: [...new Set(trust)].slice(0, 8),
        read: Array.isArray(p.read) ? p.read.filter((n): n is number => typeof n === 'number') : [],
        reasoning: plannerThought(stripThink(raw)),
      }
    } catch {
      return null
    }
  }

  async function runAgenticSearch(
    threadId: string,
    question: string,
    ref: ModelRef,
    signal: AbortSignal,
    onStep: (step: SearchStep) => void,
  ): Promise<Source[]> {
    if (signal.aborted) return []
    const settings = useSettings.getState().settings
    const { conn } = buildRequestBits(ref)

    const collected = new Map<string, Source>()
    const searched = new Set<string>()
    const fetched = new Set<string>()
    const norm = (q: string) => q.trim().toLowerCase()
    // Per-query result orders, kept apart so the ranker can fuse them (see lib/rank.ts).
    const lists: Source[][] = []

    const contextText = searchContext(threadId)
    const seedGen = await generateSearchQueries(threadId, question, ref, signal)
    if (signal.aborted) return []
    const entities = [...new Set([
      ...seedGen.entities.map((e) => e.trim()).filter(Boolean),
      ...distinctiveEntities(`${contextText}\n${question}`),
    ])].slice(0, 10)

    // Two gap rounds, not six: every round costs a full planner round trip, and with the queries
    // now fanned out in parallel the first pass already gathers what the old loop took rounds to.
    const MAX_ROUNDS = 2
    const MAX_GATHER = Math.min(40, Math.max(18, entities.length * 6))
    const MAX_FETCH = Math.min(14, Math.max(6, entities.length * 2))
    const RETURN_CAP = 16

    const absorb = (results: Source[]) => {
      for (const s of results) {
        if (!s.url) continue
        const ex = collected.get(s.url)
        if (ex) {
          if (!ex.content && s.content) ex.content = s.content
        } else {
          collected.set(s.url, { ...s })
        }
      }
    }

    let lastSearchErr: unknown
    const runSearch = async (queries: string[], includeDomains?: string[]) => {
      const fresh = queries.map((q) => q.trim()).filter((q) => q && !searched.has(norm(q)))
      if (!fresh.length || signal.aborted || collected.size >= MAX_GATHER) return
      for (const q of fresh) {
        searched.add(norm(q))
        onStep({ kind: 'search', label: q })
      }
      const { lists: got, errors } = await searchAll(fresh, settings.search, { includeDomains, signal })
      if (errors.length) lastSearchErr = errors[0]
      // A domain-restricted pass that found almost nothing means the restriction was wrong, not
      // that the web is empty — retry those queries unrestricted.
      if (includeDomains?.length && got.reduce((n, l) => n + l.length, 0) < 3 && !signal.aborted) {
        const retry = await searchAll(fresh, settings.search, { signal })
        got.push(...retry.lists)
        if (retry.lists.length) lastSearchErr = undefined
      }
      for (const list of got) {
        lists.push(list)
        absorb(list)
      }
    }

    const readUrls = async (urls: string[]): Promise<number> => {
      const todo = [...new Set(urls)].filter((u) => u && !fetched.has(u)).slice(0, Math.max(0, MAX_FETCH - fetched.size))
      if (!todo.length || signal.aborted) return 0
      for (const url of todo) {
        fetched.add(url)
        onStep({ kind: 'read', label: hostOf(url) })
      }
      // One batched extract call for the lot instead of a serial fetch per page.
      const pages = await fetchPages(todo, settings.search, { signal })
      for (const [url, content] of pages) {
        const ex = collected.get(url)
        if (ex) ex.content = content
        else collected.set(url, { title: hostOf(url), url, content })
      }
      return todo.length
    }
    const readByNumbers = (nums: number[], ordered: Source[]): Promise<number> =>
      readUrls(
        nums
          .map((n) => ordered[n - 1])
          .filter((s): s is Source => Boolean(s) && (s.content?.length ?? 0) <= 400)
          .map((s) => s.url),
      )
    /** Current best-first view of everything gathered, ranked against the question. */
    const ranked = (trusted?: string[]): Source[] =>
      diversify(rankSources(question, lists.length ? lists : [[...collected.values()]], { trusted }), 2)

    const readEntityPages = async (): Promise<void> => {
      if (!entities.length) return
      const ordered = ranked()
      const picks = new Set<string>()
      for (const ent of entities) {
        const probe = ent.toLowerCase()
        const compact = probe.replace(/\s+/g, '')
        const best = ordered.find((s) => {
          if (fetched.has(s.url) || picks.has(s.url) || (s.content?.length ?? 0) > 400) return false
          const hay = `${s.title} ${s.snippet ?? ''}`.toLowerCase()
          return hay.includes(probe) || hay.replace(/\s+/g, '').includes(compact)
        })
        if (best) picks.add(best.url)
      }
      await readUrls([...picks])
    }

    if (seedGen.reasoning) onStep({ kind: 'think', label: seedGen.reasoning })
    const qNorm = norm(question)
    const isEcho = (q: string) => {
      const n = norm(q)
      return n === qNorm || (question.length > 25 && (n.includes(qNorm) || qNorm.includes(n)))
    }
    let seed = seedGen.queries.map((q) => q.trim()).filter(Boolean).filter((q) => !isEcho(q))
    if (!seed.length && entities.length) {
      const topic = questionTopic(question, entities)
      seed = entities.map((e) => `${e} ${topic}`.trim())
    }
    if (!seed.length) seed = [cleanQuery(question)]
    seed = seed.slice(0, 6)
    await runSearch(seed)
    if (collected.size === 0) {
      if (lastSearchErr) throw lastSearchErr
      return []
    }

    let preferredDomains: string[] = []
    if (!signal.aborted && conn) {
      // The selector judges the RANKED top of the pile, not whatever order results arrived in, so
      // its attention goes to pages that already look like answers.
      const seedCandidates = ranked().slice(0, 18)
      // Reading the best pages doesn't depend on what the selector says, so don't wait for it:
      // the extract batch and the planner call overlap instead of queueing. An answer built from
      // previews is exactly the thin, hedging answer this pipeline exists to avoid.
      const [selection] = await Promise.all([
        selectSources(question, contextText, seedCandidates, ref, signal),
        readUrls(seedCandidates.filter((s) => (s.content?.length ?? 0) < 1200).slice(0, 6).map((s) => s.url)),
      ])
      if (selection) {
        if (selection.reasoning) onStep({ kind: 'think', label: selection.reasoning })
        if (selection.trust.length) {
          preferredDomains = selection.trust
          onStep({ kind: 'sources', label: selection.trust.join(', ') })
        }
        await readByNumbers(selection.read, seedCandidates)
      }
    }
    let lastDomainsKey = preferredDomains.join(',')

    for (let round = 0; round < MAX_ROUNDS && !signal.aborted; round++) {
      if (collected.size >= MAX_GATHER || !conn) break

      const plan = await planSearch(question, contextText, ranked(preferredDomains), entities, ref, signal)
      if (!plan || signal.aborted) break
      if (plan.reasoning) onStep({ kind: 'think', label: plan.reasoning })

      const didRead = await readByNumbers(plan.read, ranked(preferredDomains))

      if (!plan.gaps.length) break
      const gapQueries = [...new Set(plan.gaps.map((g) => g.query.trim()).filter(Boolean))]
        .filter((q) => !searched.has(norm(q)))
        .slice(0, 5)
      if (!gapQueries.length && !didRead) break

      const targetDomains = preferredDomains.length ? preferredDomains : undefined
      const domainsKey = preferredDomains.join(',')
      if (targetDomains && gapQueries.length && domainsKey !== lastDomainsKey) {
        onStep({ kind: 'sources', label: targetDomains.join(', ') })
        lastDomainsKey = domainsKey
      }
      await runSearch(gapQueries, targetDomains)
    }

    if (!signal.aborted) await readEntityPages()

    // Pages we actually read outrank previews of the same quality — they're what the answer can be
    // built from — but only enough to break ties, never enough to bury a better match.
    return ranked(preferredDomains)
      .map((s) => ({ ...s, score: (s.score ?? 0) + ((s.content?.length ?? 0) > 1200 ? 0.06 : 0) }))
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, RETURN_CAP)
  }

  async function runLightSearch(
    threadId: string,
    question: string,
    signal: AbortSignal,
    onStep: (step: SearchStep) => void,
  ): Promise<Source[]> {
    if (signal.aborted) return []
    const settings = useSettings.getState().settings
    const contextText = searchContext(threadId)
    const entities = distinctiveEntities(`${contextText}\n${question}`)
    let queries: string[] = []
    if (entities.length >= 2) {
      const topic = questionTopic(question, entities)
      queries = entities.map((e) => `${e} ${topic}`.trim())
    }
    if (!queries.length) queries = [cleanQuery(question)]
    queries = [...new Set(queries.filter(Boolean))].slice(0, 4)

    for (const q of queries) onStep({ kind: 'search', label: q })
    // Still light — snippets only, no planner — but the queries run at once and the merged list is
    // ranked against the question instead of being whatever each query happened to return first.
    const { lists, errors } = await searchAll(queries, settings.search, { signal, maxResults: 4 })
    if (!lists.length) {
      if (errors.length) throw errors[0]
      return []
    }
    const trimmed = lists.map((l) => l.slice(0, 3).map((s) => ({ ...s, content: undefined })))
    return diversify(rankSources(question, trimmed), 2).slice(0, 6)
  }

  async function generateSearchQueries(
    threadId: string,
    question: string,
    ref: ModelRef,
    signal: AbortSignal,
  ): Promise<{ queries: string[]; entities: string[]; reasoning?: string }> {
    const { conn, catalogProvider, modelMeta } = buildRequestBits(ref)
    if (!conn) return { queries: [], entities: [] }
    try {
      const recent = searchContext(threadId)
      const { text: raw, reasoning } = await completeOnce({
        conn, catalogProvider, modelMeta, model: ref.modelId,
        system: searchQueryPrompt(),
        turns: [{ role: 'user', content: `${recent ? `Conversation so far:\n${recent}\n\n` : ''}Latest user message: ${question}\n\nResolve any references from the conversation and output the JSON object (put your brief reasoning in the "thought" field — don't write a long preamble before it).` }],
        maxTokens: 1800, thinking: 'off', signal,
      })
      const clean = stripThink(raw)
      const queries = extractQueries(clean).slice(0, 5)
      let entities: string[] = []
      const obj = clean.match(/\{[\s\S]*\}/)
      if (obj) {
        try {
          const p = JSON.parse(obj[0]) as { entities?: unknown }
          if (Array.isArray(p.entities)) entities = p.entities.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((s) => s.trim())
        } catch {
          /* entities are best-effort */
        }
      }
      return { queries, entities, reasoning: plannerThought(clean, reasoning) }
    } catch {
      return { queries: [], entities: [] }
    }
  }

  async function generate(threadId: string, opts: { searchQuery?: string; fresh?: boolean; prefill?: string; carryVariants?: string[] }): Promise<void> {
    const finalizeVariants = (content: string): Partial<Message> => {
      const prior = opts.carryVariants
      if (!prior?.length) return {}
      if (content) return { variants: [...prior, content], variantIndex: prior.length }
      return { content: prior[prior.length - 1], variants: prior, variantIndex: prior.length - 1 }
    }
    const { ref } = resolveActiveModel(threadId)
    if (!ref) {
      toast.error('No model selected', 'Pick a model and connect a provider first.')
      get().openSettings('providers')
      return
    }
    const { conn, catalogProvider, modelMeta } = buildRequestBits(ref)
    if (!conn) {
      toast.error(`Connect ${catalogProvider?.name ?? ref.providerId}`, 'Add an API key in Settings → Providers.')
      get().openSettings('providers')
      return
    }

    const settings = useSettings.getState().settings
    const prefill = opts.prefill?.trimEnd() || undefined
    const assistantMsg: Message = {
      id: uid(), threadId, role: 'assistant', content: '', model: ref,
      status: 'streaming', deleted: false, createdAt: now(), updatedAt: now(), dirty: 0,
    }

    currentAbort = new AbortController()
    const signal = currentAbort.signal
    const thread = get().threads.find((t) => t.id === threadId)
    const systemPrompt = buildSystemPrompt({
      defaultPrompt: settings.defaultSystemPrompt,
      threadPrompt: thread?.systemPrompt,
      memories: get().memories,
      memoryEnabled: settings.memory.enabled,
    })
    set({ streaming: { threadId, messageId: assistantMsg.id, phase: opts.searchQuery ? 'searching' : 'waiting' } })

    let sources = undefined as Message['sources']
    let finalUserOverride: string | undefined
    if (opts.searchQuery && !shouldSkipSearch(opts.searchQuery)) {
      const cacheKey = `${threadId}|${opts.searchQuery.trim()}`
      if (opts.fresh) searchCache.delete(cacheKey)
      try {
        let fullSources = searchCache.get(cacheKey)
        if (!fullSources) {
          const steps: SearchStep[] = []
          const onStep = (step: SearchStep) => {
            steps.push(step)
            if (get().streaming?.messageId === assistantMsg.id) {
              set({ streaming: { threadId, messageId: assistantMsg.id, phase: 'searching', steps: [...steps] } })
            }
          }
          fullSources = settings.search.light
            ? await runLightSearch(threadId, opts.searchQuery, signal, onStep)
            : await runAgenticSearch(threadId, opts.searchQuery, ref, signal, onStep)
          if (steps.length) assistantMsg.searchSteps = steps
          if (fullSources.length) {
            searchCache.set(cacheKey, fullSources)
            if (searchCache.size > 12) {
              const oldest = searchCache.keys().next().value
              if (oldest) searchCache.delete(oldest)
            }
          }
        }
        if (fullSources?.length) {
          const ctxLimit = Math.min(modelMeta?.limit?.context ?? 16_000, thread?.contextCap ?? Infinity)
          const outReserve = Math.min(modelMeta?.limit?.output ?? 4096, 8192)
          const room = Math.floor(ctxLimit * 0.8) - outReserve - estimateTokens(systemPrompt) - estimateTokens(opts.searchQuery) - 600
          const budgetChars = Math.min(56_000, Math.max(2_000, room * 4))
          const maxSources = Math.max(3, Math.min(fullSources.length, 14, Math.floor(budgetChars / 1_500)))
          const modelSources = fullSources.slice(0, maxSources)
          finalUserOverride = buildSearchAugmentedText(opts.searchQuery, modelSources, budgetChars)
          sources = lightSources(modelSources)
          assistantMsg.sources = sources
        }
      } catch (err) {
        const msg = (err as Error).message
        assistantMsg.searchError = msg
        toast.error('Web search failed', msg)
        if (import.meta.env.DEV) console.warn('[openplex] web search failed:', err)
      }
      if (signal.aborted) {
        set({ streaming: null })
        return
      }
    }

    patchMessageInState(threadId, assistantMsg.id, () => assistantMsg)
    await db.messages.put(assistantMsg)
    set({ streaming: { threadId, messageId: assistantMsg.id, phase: 'waiting' } })

    const history = (get().messages[threadId] ?? []).filter((m) => m.id !== assistantMsg.id)
    const { turns } = buildTurns({
      messages: history,
      model: modelMeta,
      systemPrompt,
      finalUserTextOverride: finalUserOverride,
      contextCap: thread?.contextCap,
    })
    if (prefill) turns.push({ role: 'assistant', content: prefill })

    let textBuf = ''
    let reasoningBuf = ''
    const toolSteps: ToolStep[] = []
    // Ordered layout of the turn (text interleaved with tool cards) in true stream order, so
    // computer-use commands render where the model ran them instead of all at the top. Only
    // persisted once a tool actually ran; otherwise the plain content render is used.
    const segments: MessageSegment[] = []
    let curText = ''
    const sealText = () => {
      if (curText) { segments.push({ kind: 'text', text: curText }); curText = '' }
    }
    const hasToolSegment = () => segments.some((s) => s.kind === 'tool')
    let stepsDirty = false
    let stepsSnap: ToolStep[] | undefined
    const upsertStep = (step: ToolStep) => {
      const i = toolSteps.findIndex((s) => s.id === step.id)
      if (i >= 0) toolSteps[i] = step
      else {
        toolSteps.push(step)
        sealText()
        segments.push({ kind: 'tool', stepId: step.id })
      }
      stepsDirty = true
      scheduleFlush()
    }
    let flushScheduled = false
    const flush = () => {
      flushScheduled = false
      if (stepsDirty) { stepsSnap = toolSteps.length ? toolSteps.map((s) => ({ ...s })) : undefined; stepsDirty = false }
      const segs = hasToolSegment()
        ? [...segments, ...(curText ? [{ kind: 'text', text: curText } as MessageSegment] : [])]
        : undefined
      patchMessageInState(threadId, assistantMsg.id, (m) => ({
        ...(m ?? assistantMsg),
        content: textBuf,
        reasoning: reasoningBuf || undefined,
        toolSteps: stepsSnap,
        segments: segs,
        updatedAt: now(),
      }))
      if (get().streaming?.messageId === assistantMsg.id && get().streaming?.phase !== 'streaming' && (textBuf || reasoningBuf)) {
        set({ streaming: { threadId, messageId: assistantMsg.id, phase: 'streaming' } })
      }
    }
    const scheduleFlush = () => {
      if (!flushScheduled) {
        flushScheduled = true
        setTimeout(flush, 90)
      }
    }

    const answerCtx = Math.min(modelMeta?.limit?.context ?? 16_000, thread?.contextCap ?? Infinity)
    const inputEstimate = estimateTokens(systemPrompt) + turns.reduce((n, t) => n + estimateTokens(t.content), 0)
    // Max output tokens. Default to a modest 32k (most replies are far shorter) rather than the
    // model's whole context — requesting the full context trips provider caps (z.ai rejects above
    // 131072, Cloudflare above 256000, etc.). Adjustable per-thread via the context meter; always
    // clamped to the model's output limit, remaining context, and a hard 128k ceiling.
    const requestedOut = thread?.maxOutput ?? 32_768
    const answerTokens = Math.max(512, Math.min(modelMeta?.limit?.output ?? 8192, answerCtx - inputEstimate - 1024, requestedOut, 128_000))

    const req: ChatRequest = {
      conn, catalogProvider, model: ref.modelId, modelMeta,
      system: systemPrompt, turns, temperature: settings.temperature,
      thinking: thread?.thinking, maxTokens: answerTokens, signal, prefill,
    }

    try {
      const cb = {
        onText: (d: string) => { textBuf += d; curText += d; scheduleFlush() },
        onReasoning: (d: string) => { reasoningBuf += d; scheduleFlush() },
        onSegmentBreak: () => { sealText(); scheduleFlush() },
        onDropPendingText: () => {
          if (curText) { textBuf = textBuf.slice(0, textBuf.length - curText.length); curText = '' }
          scheduleFlush()
        },
      }
      // Browser tools (documents) are always on; computer tools only when the PC actually answers.
      const supportsTools = modelSupportsTools(modelMeta)
      const computeOk = supportsTools ? (await computeAvailable()).ok : false
      const agentTools = supportsTools ? toolsFor(computeOk) : []
      const useTools = agentTools.length > 0
      const genStart = now()
      const usage = useTools
        ? await streamChatAgentic(req, cb, upsertStep, threadId, agentTools)
        : await streamChat(req, cb)
      sealText()
      flush()
      const final: Message = {
        ...assistantMsg,
        content: textBuf,
        reasoning: reasoningBuf || undefined,
        toolSteps: toolSteps.length ? toolSteps : undefined,
        segments: hasToolSegment() ? segments : undefined,
        sources,
        usage: { ...mergeUsage(modelMeta, usage), latencyMs: now() - genStart },
        status: signal.aborted ? 'stopped' : 'complete',
        updatedAt: now(),
        dirty: 1,
        ...finalizeVariants(textBuf),
      }
      await putMessage(final)
      touchThread(threadId)
      set({ streaming: null })
      if (!signal.aborted) {
        void generateTitle(threadId)
        void autoExtractMemories(threadId)
      }
    } catch (err) {
      sealText()
      flush()
      const aborted = (err as Error).name === 'AbortError' || signal.aborted
      const interrupted = !aborted && textBuf.trim().length > 0
      const final: Message = {
        ...assistantMsg,
        content: textBuf,
        reasoning: reasoningBuf || undefined,
        toolSteps: toolSteps.length ? toolSteps : undefined,
        segments: hasToolSegment() ? segments : undefined,
        sources,
        status: aborted || interrupted ? 'stopped' : 'error',
        error: aborted || interrupted ? undefined : (err as Error).message,
        updatedAt: now(),
        dirty: 1,
        ...finalizeVariants(textBuf),
      }
      await putMessage(final)
      set({ streaming: null })
      if (!aborted && !interrupted) toast.error('Generation failed', (err as Error).message)
    } finally {
      currentAbort = null
    }
  }

  return {
    ready: false,
    threads: [],
    messages: {},
    memories: [],
    activeThreadId: null,
    streaming: null,
    draftWebSearch: false,
    sidebarOpen: window.innerWidth > 900,
    settingsTab: null,
    paletteOpen: false,
    sourcesFor: null,
    viewerFile: null,
    shortcutsOpen: false,
    surface: 'stage',
    pickerOpen: false,
    settingsProviderFocus: null,
    healTarget: null,
    compare: null,
    syncStatus: 'off',
    syncUser: null,

    init: async () => {
      // Unresolved conflicts hold their records out of sync, so they must be known before it runs.
      await useConflicts.getState().load()
      await db.messages.where('dirty').equals(1).toArray()
      const stuck = await db.messages.filter((m) => m.status === 'streaming').toArray()
      for (const m of stuck) await db.messages.put({ ...m, status: 'stopped', dirty: 1 })

      let [threads, memories] = await Promise.all([db.threads.toArray(), db.memories.toArray()])

      const polluted = /^\s*<(think|thinking|thought|reasoning|reason)\b/i
      threads = await Promise.all(
        threads.map(async (t) => {
          if (!polluted.test(t.title)) return t
          const healed = { ...t, title: 'New chat', untitled: true, updatedAt: now(), dirty: 1 }
          await db.threads.put(healed)
          return healed
        }),
      )

      set({ threads, memories, ready: true })
      void useProviders.getState().loadCatalog()
      useProviders.getState().startAutoRefresh()

      const { settings } = useSettings.getState()
      if (settings.keySync.enabled && getStoredBlob() && !getStoredPassphrase()) {
        useProviders.getState().setPendingKeysBlob(getStoredBlob())
      }

      bus.addEventListener('meta-changed', requestPush)
      // The version the user just picked should reach the other device immediately.
      bus.addEventListener('conflict-resolved', () => {
        void get().reloadFromDb()
        get().syncNow()
      })
      void get().initSync()
    },

    reloadFromDb: async () => {
      const [threads, memories] = await Promise.all([db.threads.toArray(), db.memories.toArray()])
      const loadedIds = Object.keys(get().messages)
      const messages: Record<string, Message[]> = {}
      for (const tid of loadedIds) {
        messages[tid] = await db.messages.where('threadId').equals(tid).sortBy('createdAt')
      }
      set({ threads, memories, messages })
    },

    selectThread: async (id) => {
      set({ activeThreadId: id, sourcesFor: null, surface: 'stage', compare: null })
      if (id) {
        await loadMessages(id)
        window.location.hash = `/t/${id}`
      } else {
        window.location.hash = '/'
      }
      if (window.innerWidth <= 900) set({ sidebarOpen: false })
    },

    send: async (text, attachments, prefill) => {
      const trimmed = text.trim()
      if (!trimmed && !attachments?.length) return
      if (get().streaming) return

      let threadId = get().activeThreadId
      const settings = useSettings.getState().settings

      if (!threadId) {
        const ref = settings.defaultModel
        const thread: Thread = {
          id: uid(), title: 'New chat', untitled: true,
          modelRef: ref ?? undefined, webSearch: get().draftWebSearch,
          thinking: get().draftThinking, contextCap: get().draftContextCap, maxOutput: get().draftMaxOutput,
          systemPrompt: get().draftSystemPrompt,
          pinned: false, archived: false, deleted: false,
          createdAt: now(), updatedAt: now(), dirty: 1,
        }
        await putThread(thread)
        threadId = thread.id
        set({ activeThreadId: threadId, messages: { ...get().messages, [threadId]: [] } })
        window.location.hash = `/t/${threadId}`
      } else {
        await loadMessages(threadId)
      }

      const userMsg: Message = {
        id: uid(), threadId, role: 'user', content: trimmed,
        attachments: attachments?.length ? attachments : undefined,
        status: 'complete', deleted: false, createdAt: now(), updatedAt: now(), dirty: 1,
      }
      await putMessage(userMsg)
      touchThread(threadId)

      const thread = get().threads.find((t) => t.id === threadId)
      await generate(threadId, { searchQuery: thread?.webSearch ? trimmed : undefined, prefill })
    },

    stop: () => {
      currentAbort?.abort()
    },

    regenerate: async (messageId) => {
      if (get().streaming) return
      const threadId = get().activeThreadId
      if (!threadId) return
      const list = get().messages[threadId] ?? []
      const target = list.find((m) => m.id === messageId)
      if (!target || target.role !== 'assistant') return
      const priorVariants = (target.variants ?? (target.content ? [target.content] : [])).filter(Boolean)
      const cutoff = target.createdAt
      for (const m of list.filter((m) => m.createdAt >= cutoff && !m.deleted)) {
        await db.messages.put({ ...m, deleted: true, updatedAt: now(), dirty: 1 })
      }
      set({ messages: { ...get().messages, [threadId]: list.filter((m) => m.createdAt < cutoff) } })
      requestPush()
      const thread = get().threads.find((t) => t.id === threadId)
      const lastUser = [...(get().messages[threadId] ?? [])].reverse().find((m) => m.role === 'user' && !m.deleted)
      await generate(threadId, {
        searchQuery: thread?.webSearch ? lastUser?.content : undefined,
        fresh: true,
        carryVariants: priorVariants.length ? priorVariants : undefined,
      })
    },

    setMessageVariant: async (messageId, index) => {
      const threadId = get().activeThreadId
      if (!threadId) return
      const list = get().messages[threadId] ?? []
      const target = list.find((m) => m.id === messageId)
      if (!target?.variants || index < 0 || index >= target.variants.length || index === target.variantIndex) return
      await putMessage({ ...target, content: target.variants[index], variantIndex: index, updatedAt: now(), dirty: 1 })
    },

    editUserMessage: async (messageId, newText) => {
      if (get().streaming) return
      const threadId = get().activeThreadId
      if (!threadId) return
      const list = get().messages[threadId] ?? []
      const target = list.find((m) => m.id === messageId)
      if (!target || target.role !== 'user') return
      for (const m of list.filter((m) => m.createdAt > target.createdAt && !m.deleted)) {
        await db.messages.put({ ...m, deleted: true, updatedAt: now(), dirty: 1 })
      }
      const updated: Message = { ...target, content: newText.trim(), updatedAt: now(), dirty: 1 }
      await db.messages.put(updated)
      set({
        messages: {
          ...get().messages,
          [threadId]: list.filter((m) => m.createdAt <= target.createdAt).map((m) => (m.id === messageId ? updated : m)),
        },
      })
      requestPush()
      const thread = get().threads.find((t) => t.id === threadId)
      await generate(threadId, { searchQuery: thread?.webSearch ? updated.content : undefined })
    },

    editAssistantMessage: async (messageId, newText) => {
      if (get().streaming) return
      const threadId = get().activeThreadId
      if (!threadId) return
      const list = get().messages[threadId] ?? []
      const target = list.find((m) => m.id === messageId)
      if (!target || target.role !== 'assistant') return
      const content = newText.trim()
      if (!content || content === target.content) return
      const updated: Message = {
        ...target, content, manual: true, reasoning: undefined, status: 'complete', error: undefined,
        updatedAt: now(), dirty: 1,
      }
      await putMessage(updated)
      touchThread(threadId)
    },

    insertAssistantMessage: async (text) => {
      if (get().streaming) return
      const content = text.trim()
      if (!content) return
      const threadId = get().activeThreadId
      if (!threadId) return
      await loadMessages(threadId)
      const msg: Message = {
        id: uid(), threadId, role: 'assistant', content, manual: true,
        status: 'complete', deleted: false, createdAt: now(), updatedAt: now(), dirty: 1,
      }
      await putMessage(msg)
      touchThread(threadId)
    },

    setModel: (ref) => {
      useSettings.getState().update({ defaultModel: ref })
      const threadId = get().activeThreadId
      if (threadId) touchThread(threadId, { modelRef: ref })
    },

    setWebSearch: (on) => {
      const threadId = get().activeThreadId
      if (threadId) touchThread(threadId, { webSearch: on })
      else set({ draftWebSearch: on })
    },

    setThinking: (level) => {
      const threadId = get().activeThreadId
      if (threadId) touchThread(threadId, { thinking: level })
      else set({ draftThinking: level })
    },

    setContextCap: (tokens) => {
      const threadId = get().activeThreadId
      if (threadId) touchThread(threadId, { contextCap: tokens })
      else set({ draftContextCap: tokens })
    },

    setMaxOutput: (tokens) => {
      const threadId = get().activeThreadId
      if (threadId) touchThread(threadId, { maxOutput: tokens })
      else set({ draftMaxOutput: tokens })
    },

    setSystemPrompt: (prompt) => {
      const value = prompt && prompt.trim() ? prompt : undefined
      const threadId = get().activeThreadId
      if (threadId) touchThread(threadId, { systemPrompt: value })
      else set({ draftSystemPrompt: value })
    },

    renameThread: (id, title) => touchThread(id, { title: title.trim() || 'Untitled', untitled: false }),
    setThreadFolder: (id, folder) => touchThread(id, { folder: folder?.trim() || undefined }),
    setThreadSystemPrompt: (id, prompt) => touchThread(id, { systemPrompt: prompt }),
    togglePin: (id) => {
      const t = get().threads.find((t) => t.id === id)
      if (t) touchThread(id, { pinned: !t.pinned })
    },

    deleteThread: async (id) => {
      const t = get().threads.find((t) => t.id === id)
      if (!t) return
      await putThread({ ...t, deleted: true, updatedAt: now(), dirty: 1 })
      const msgs = await db.messages.where('threadId').equals(id).toArray()
      for (const m of msgs) await db.messages.put({ ...m, deleted: true, updatedAt: now(), dirty: 1 })
      const messages = { ...get().messages }
      delete messages[id]
      set({ messages })
      if (get().activeThreadId === id) void get().selectThread(null)
      requestPush()
    },

    addMemory: (content, source) => {
      const mem: Memory = {
        id: uid(), content: content.trim(), source, enabled: true,
        deleted: false, createdAt: now(), updatedAt: now(), dirty: 1,
      }
      void db.memories.put(mem)
      set({ memories: [...get().memories, mem] })
      requestPush()
    },

    updateMemory: (id, patch) => {
      const memories = get().memories.map((m) => (m.id === id ? { ...m, ...patch, updatedAt: now(), dirty: 1 } : m))
      const target = memories.find((m) => m.id === id)
      if (target) void db.memories.put(target)
      set({ memories })
      requestPush()
    },

    deleteMemory: (id) => {
      const memories = get().memories.map((m) => (m.id === id ? { ...m, deleted: true, updatedAt: now(), dirty: 1 } : m))
      const target = memories.find((m) => m.id === id)
      if (target) void db.memories.put(target)
      set({ memories })
      requestPush()
    },

    rememberMessage: async (messageId) => {
      const threadId = get().activeThreadId
      if (!threadId) return
      const msg = (get().messages[threadId] ?? []).find((m) => m.id === messageId)
      if (!msg) return
      const { ref } = resolveActiveModel(threadId)
      const bits = ref ? buildRequestBits(ref) : null
      if (ref && bits?.conn) {
        try {
          const { text: raw } = await completeOnce({
            conn: bits.conn, catalogProvider: bits.catalogProvider, modelMeta: bits.modelMeta, model: ref.modelId,
            system: 'Condense the following into ONE short, durable memory sentence about the user or their work. Reply with only the sentence.',
            turns: [{ role: 'user', content: stripThink(msg.content).slice(0, 2000) || msg.content.slice(0, 2000) }],
            maxTokens: 80,
            thinking: 'off',
          })
          const content = stripThink(raw).replace(/^["']|["']$/g, '')
          if (content) {
            get().addMemory(content, 'manual')
            toast.success('Saved to memory', content)
            return
          }
        } catch {
          /* fall through to raw save */
        }
      }
      const fallback = msg.content.slice(0, 200)
      get().addMemory(fallback, 'manual')
      toast.success('Saved to memory')
    },

    setSidebarOpen: (open) => set({ sidebarOpen: open }),
    setSurface: (s) => set({ surface: s }),
    setPickerOpen: (open) => set({ pickerOpen: open }),
    openSettings: (tab = 'providers', focusProvider) => set({ settingsTab: tab, surface: 'settings', settingsProviderFocus: focusProvider ?? null }),
    setSettingsProviderFocus: (id) => set({ settingsProviderFocus: id }),
    openRepair: (target) => set({ healTarget: target ?? null, settingsTab: 'repair', surface: 'settings', settingsProviderFocus: null }),
    closeSettings: () => set({ surface: 'stage' }),
    setPaletteOpen: (open) => set({ paletteOpen: open }),
    setSourcesFor: (messageId) => set({ sourcesFor: messageId }),
    openFile: (file) => set({ viewerFile: file }),
    closeFile: () => set({ viewerFile: null }),
    setShortcutsOpen: (open) => set({ shortcutsOpen: open }),

    toggleArchive: (id) => {
      const t = get().threads.find((t) => t.id === id)
      if (t) touchThread(id, { archived: !t.archived })
    },

    startCompare: async (messageId, refs) => {
      const threadId = get().activeThreadId
      if (!threadId || !refs.length) return
      const list = get().messages[threadId] ?? []
      const target = list.find((m) => m.id === messageId)
      if (!target || target.role !== 'assistant') return
      const history = list.filter((m) => !m.deleted && m.createdAt < target.createdAt)
      const settings = useSettings.getState().settings
      const thread = get().threads.find((t) => t.id === threadId)
      const systemPrompt = buildSystemPrompt({
        defaultPrompt: settings.defaultSystemPrompt,
        threadPrompt: thread?.systemPrompt,
        memories: get().memories,
        memoryEnabled: settings.memory.enabled,
      })
      set({ compare: { messageId, items: refs.map((ref) => ({ ref, status: 'pending', text: '' })) } })
      const patchItem = (i: number, patch: Partial<CompareItem>) => {
        const cur = get().compare
        if (!cur || cur.messageId !== messageId) return
        const items = [...cur.items]
        items[i] = { ...items[i], ...patch }
        set({ compare: { messageId, items } })
      }
      await Promise.all(refs.map(async (ref, i) => {
        const { conn, catalogProvider, modelMeta } = buildRequestBits(ref)
        if (!conn) return patchItem(i, { status: 'error', error: 'Provider not connected' })
        const { turns } = buildTurns({ messages: history, model: modelMeta, systemPrompt, contextCap: thread?.contextCap })
        try {
          const start = now()
          const { text, reasoning } = await completeOnce({
            conn, catalogProvider, modelMeta, model: ref.modelId,
            system: systemPrompt, turns, temperature: settings.temperature, thinking: thread?.thinking,
            maxTokens: Math.min(modelMeta?.limit?.output ?? 4096, 4096),
          })
          const clean = stripThink(text)
          const inTok = estimateTokens(systemPrompt) + turns.reduce((n, t) => n + estimateTokens(t.content), 0)
          const usage: Usage = {
            ...mergeUsage(modelMeta, { inputTokens: inTok, outputTokens: estimateTokens(clean), estimated: true }),
            latencyMs: now() - start,
          }
          patchItem(i, { status: 'done', text: clean, reasoning, usage })
        } catch (err) {
          patchItem(i, { status: 'error', error: (err as Error).message })
        }
      }))
    },
    closeCompare: () => set({ compare: null }),
    keepCompare: async (index) => {
      const cur = get().compare
      const threadId = get().activeThreadId
      if (!cur || !threadId) return
      const item = cur.items[index]
      if (!item || item.status !== 'done') return
      const list = get().messages[threadId] ?? []
      const target = list.find((m) => m.id === cur.messageId)
      if (!target) return
      const base = target.variants ?? (target.content ? [target.content] : [])
      const variants = [...base, item.text]
      await putMessage({
        ...target, content: item.text, model: item.ref, usage: item.usage,
        variants, variantIndex: variants.length - 1, manual: false, status: 'complete',
        updatedAt: now(), dirty: 1,
      })
      touchThread(threadId)
      set({ compare: null })
    },

    initSync: async () => {
      const cfg = useSettings.getState().settings.sync
      const sb = getSupabase(cfg)
      authUnsub?.()
      authUnsub = null
      if (!sb) {
        get().stopSyncEngine()
        set({ syncStatus: 'off', syncUser: null })
        return
      }
      const { data } = sb.auth.onAuthStateChange((_event, session) => {
        const user = session?.user
        if (user) {
          if (get().syncUser?.id !== user.id || !engine) {
            get().stopSyncEngine()
            set({ syncUser: { id: user.id, email: user.email ?? undefined } })
            engine = new SyncEngine(sb, user.id, {
              onRemoteApplied: () => void get().reloadFromDb(),
              onStatus: (status, detail) => set({ syncStatus: status, lastSyncError: detail }),
              getMetaPayload: () => buildMetaPayload(),
              onMetaPushed: (ts) => setMetaTs(ts),
              applyRemoteMeta: async (data, ts) => {
                await applyMetaPayload(data as Parameters<typeof applyMetaPayload>[0], ts)
                const { pendingKeysBlob } = useProviders.getState()
                if (pendingKeysBlob) {
                  toast.info('Synced API keys are locked', 'Enter your key-sync passphrase in Settings → Account & sync.')
                }
              },
            })
            void engine.start()
          }
        } else {
          get().stopSyncEngine()
          set({ syncUser: null, syncStatus: 'idle' })
        }
      })
      authUnsub = () => data.subscription.unsubscribe()
    },

    syncNow: () => void engine?.sync(),

    stopSyncEngine: () => {
      engine?.stop()
      engine = null
    },
  }
})

export function visibleThreads(threads: Thread[]): Thread[] {
  return threads.filter((t) => !t.deleted && !t.archived).sort((a, b) => b.updatedAt - a.updatedAt)
}

export function visibleMessages(messages: Message[] | undefined): Message[] {
  return (messages ?? []).filter((m) => !m.deleted)
}
