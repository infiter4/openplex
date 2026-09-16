import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import { db, kvGet, kvSet, shadowGet, shadowPut } from './db'
import { merge3, type MergeRule } from './merge'
import type { Memory, Message, Thread } from './types'
import { pendingConflictIds, useConflicts, type ConflictKind } from '../state/conflicts'

const CURSOR_KEY = 'sync.cursor'
const OVERLAP_MS = 5_000

/**
 * Per-field merge policy. Anything not listed is a low-stakes preference and follows the more
 * recently touched record; only user-authored text can raise a conflict the user has to settle.
 */
const THREAD_RULES: Record<string, MergeRule> = {
  title: { kind: 'text', label: 'Title' },
  systemPrompt: { kind: 'text', label: 'System prompt' },
  deleted: { kind: 'flagTrue' },
  archived: { kind: 'flagTrue' },
  pinned: { kind: 'flagTrue' },
}
const MESSAGE_RULES: Record<string, MergeRule> = {
  content: { kind: 'text', label: 'Message text' },
  deleted: { kind: 'flagTrue' },
  variants: { kind: 'longer' },
  toolSteps: { kind: 'longer' },
  sources: { kind: 'longer' },
}
const MEMORY_RULES: Record<string, MergeRule> = {
  content: { kind: 'text', label: 'Memory' },
  deleted: { kind: 'flagTrue' },
}

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'off'

export interface SyncEvents {
  onRemoteApplied?: () => void
  onStatus?: (status: SyncStatus, detail?: string) => void
  getMetaPayload?: () => Promise<{ data: unknown; ts: number } | null>
  applyRemoteMeta?: (data: unknown, ts: number) => Promise<void>
  onMetaPushed?: (ts: number) => void
}

interface ThreadRow {
  id: string; user_id: string; title: string; system_prompt: string | null
  model_ref: unknown; web_search: boolean | null; prefs: unknown; pinned: boolean; archived: boolean
  deleted: boolean; untitled: boolean | null; created_at: string; updated_at: string
}
interface MessageRow {
  id: string; user_id: string; thread_id: string; role: string; content: string
  reasoning: string | null; model: unknown; usage: unknown; sources: unknown; tool_steps: unknown
  variants: unknown
  status: string; error: string | null; deleted: boolean; created_at: string; updated_at: string
}
interface MemoryRow {
  id: string; user_id: string; content: string; source: string; enabled: boolean
  deleted: boolean; created_at: string; updated_at: string
}

const toThreadRow = (t: Thread, userId: string): ThreadRow => ({
  id: t.id, user_id: userId, title: t.title, system_prompt: t.systemPrompt ?? null,
  model_ref: t.modelRef ?? null, web_search: t.webSearch ?? null,
  prefs:
    t.thinking != null || t.contextCap != null || t.folder != null || t.maxOutput != null
      ? { thinking: t.thinking, contextCap: t.contextCap, folder: t.folder, maxOutput: t.maxOutput }
      : null,
  pinned: t.pinned, archived: t.archived, deleted: t.deleted, untitled: t.untitled ?? null,
  created_at: new Date(t.createdAt).toISOString(), updated_at: new Date(t.updatedAt).toISOString(),
})
const fromThreadRow = (r: ThreadRow): Thread => {
  const prefs = (r.prefs ?? {}) as { thinking?: string; contextCap?: number; folder?: string; maxOutput?: number }
  return {
    id: r.id, title: r.title, systemPrompt: r.system_prompt ?? undefined,
    modelRef: (r.model_ref as Thread['modelRef']) ?? undefined, webSearch: r.web_search ?? undefined,
    thinking: prefs.thinking, contextCap: prefs.contextCap, folder: prefs.folder, maxOutput: prefs.maxOutput,
    pinned: r.pinned, archived: r.archived, deleted: r.deleted, untitled: r.untitled ?? undefined,
    createdAt: Date.parse(r.created_at), updatedAt: Date.parse(r.updated_at), dirty: 0,
  }
}

const toMessageRow = (m: Message, userId: string): MessageRow => ({
  id: m.id, user_id: userId, thread_id: m.threadId, role: m.role, content: m.content,
  reasoning: m.reasoning ?? null, model: m.model ?? null, usage: m.usage ?? null,
  sources: m.sources ?? null, tool_steps: m.toolSteps ?? null,
  variants: m.variants ? { list: m.variants, index: m.variantIndex ?? m.variants.length - 1 } : null,
  status: m.status === 'streaming' ? 'stopped' : m.status,
  error: m.error ?? null, deleted: m.deleted,
  created_at: new Date(m.createdAt).toISOString(), updated_at: new Date(m.updatedAt).toISOString(),
})
const fromMessageRow = (r: MessageRow): Message => {
  const v = (r.variants ?? null) as { list?: string[]; index?: number } | null
  return {
  id: r.id, threadId: r.thread_id, role: r.role as Message['role'], content: r.content,
  reasoning: r.reasoning ?? undefined, model: (r.model as Message['model']) ?? undefined,
  usage: (r.usage as Message['usage']) ?? undefined, sources: (r.sources as Message['sources']) ?? undefined,
  toolSteps: (r.tool_steps as Message['toolSteps']) ?? undefined,
  variants: v?.list ?? undefined, variantIndex: v?.index,
  status: (r.status as Message['status']) ?? 'complete', error: r.error ?? undefined,
  deleted: r.deleted, createdAt: Date.parse(r.created_at), updatedAt: Date.parse(r.updated_at), dirty: 0,
  }
}

const toMemoryRow = (m: Memory, userId: string): MemoryRow => ({
  id: m.id, user_id: userId, content: m.content, source: m.source, enabled: m.enabled,
  deleted: m.deleted, created_at: new Date(m.createdAt).toISOString(), updated_at: new Date(m.updatedAt).toISOString(),
})
const fromMemoryRow = (r: MemoryRow): Memory => ({
  id: r.id, content: r.content, source: r.source as Memory['source'], enabled: r.enabled,
  deleted: r.deleted, createdAt: Date.parse(r.created_at), updatedAt: Date.parse(r.updated_at), dirty: 0,
})

export class SyncEngine {
  private sb: SupabaseClient
  private userId: string
  private events: SyncEvents
  private channel: RealtimeChannel | null = null
  private interval: ReturnType<typeof setInterval> | null = null
  private running = false
  private queued = false
  private stopped = false
  private onFocus = () => void this.sync()

  constructor(sb: SupabaseClient, userId: string, events: SyncEvents = {}) {
    this.sb = sb
    this.userId = userId
    this.events = events
  }

  async start(): Promise<void> {
    const bootstrapped = await kvGet<boolean>(`sync.bootstrapped.${this.userId}`)
    if (!bootstrapped) {
      await db.threads.toCollection().modify({ dirty: 1 })
      await db.messages.toCollection().modify({ dirty: 1 })
      await db.memories.toCollection().modify({ dirty: 1 })
      await kvSet(CURSOR_KEY, 0)
      await kvSet(`sync.bootstrapped.${this.userId}`, true)
    }

    await this.sync()

    this.channel = this.sb
      .channel('opx-sync')
      .on('postgres_changes', { event: '*', schema: 'public', filter: `user_id=eq.${this.userId}`, table: 'threads' }, () => void this.sync())
      .on('postgres_changes', { event: '*', schema: 'public', filter: `user_id=eq.${this.userId}`, table: 'messages' }, () => void this.sync())
      .on('postgres_changes', { event: '*', schema: 'public', filter: `user_id=eq.${this.userId}`, table: 'memories' }, () => void this.sync())
      .subscribe()

    this.interval = setInterval(() => void this.sync(), 60_000)
    window.addEventListener('focus', this.onFocus)
  }

  stop(): void {
    this.stopped = true
    if (this.channel) void this.sb.removeChannel(this.channel)
    if (this.interval) clearInterval(this.interval)
    window.removeEventListener('focus', this.onFocus)
  }

  async sync(): Promise<void> {
    if (this.stopped) return
    if (this.running) {
      this.queued = true
      return
    }
    this.running = true
    this.events.onStatus?.('syncing')
    try {
      await this.push()
      const applied = await this.pull()
      if (applied > 0) this.events.onRemoteApplied?.()
      this.events.onStatus?.('idle')
    } catch (err) {
      this.events.onStatus?.('error', (err as Error).message)
    } finally {
      this.running = false
      if (this.queued) {
        this.queued = false
        void this.sync()
      }
    }
  }

  private async reconcile<L extends { id: string; updatedAt: number }>(
    kind: ConflictKind,
    pushed: L[],
    returned: Array<{ id: string; updated_at: string }> | null,
    convert: (r: never) => L,
    tbl: { put(x: L): Promise<unknown> },
  ): Promise<void> {
    if (!returned) return
    const pushedById = new Map(pushed.map((p) => [p.id, p]))
    for (const row of returned) {
      const server = { ...convert(row as never), dirty: 0 } as L
      // The row we just wrote IS the server state now — remember it as the base for next time.
      await shadowPut(`${kind}:${row.id}`, server, Date.parse(row.updated_at))
      const local = pushedById.get(row.id)
      if (local && Date.parse(row.updated_at) > local.updatedAt) await tbl.put(server)
    }
  }

  /**
   * Decide what may actually be written to the server. A dirty row is only safe to push when the
   * server still holds what we last saw; if the other device moved it too, merge the two and push
   * the merge — or, when they genuinely disagree, hold the row back and ask the user.
   */
  private async resolveOutgoing<L extends { id: string; updatedAt: number; dirty: number }>(
    kind: ConflictKind,
    table: 'threads' | 'messages' | 'memories',
    rows: L[],
    convert: (r: never) => L,
    rules: Record<string, MergeRule>,
    describe: (row: L) => Promise<string>,
    tbl: { put(x: L): Promise<unknown> },
  ): Promise<L[]> {
    const pending = pendingConflictIds()
    const bases = new Map<string, { data: unknown; at: number }>()
    for (const r of rows) {
      const b = await shadowGet(`${kind}:${r.id}`)
      if (b) bases.set(r.id, b)
    }

    // Only rows we've synced before can collide. On a first bootstrap nothing has a base, so this
    // costs no extra round trips at exactly the moment there are thousands of rows to push.
    const server = new Map<string, L>()
    const ids = rows.filter((r) => bases.has(r.id)).map((r) => r.id)
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await this.sb.from(table).select('*').in('id', ids.slice(i, i + 200))
      if (error) throw new Error(`check ${table}: ${error.message}`)
      for (const raw of data ?? []) {
        const rec = convert(raw as never)
        server.set(rec.id, rec)
      }
    }

    const out: L[] = []
    for (const local of rows) {
      const key = `${kind}:${local.id}`
      if (pending.has(key)) continue // waiting on the user; leave both sides alone
      const remote = server.get(local.id)
      const base = bases.get(local.id)
      // Nothing to collide with: brand new remotely, never synced, or untouched since we last looked.
      if (!remote || !base || remote.updatedAt <= base.at) {
        out.push(local)
        continue
      }

      const { merged, conflicts } = merge3(base.data as Partial<L>, local, remote, rules, {
        localNewer: local.updatedAt >= remote.updatedAt,
        skip: ['dirty'],
      })
      if (!conflicts.length) {
        const win = { ...merged, updatedAt: Math.max(local.updatedAt, remote.updatedAt), dirty: 1 } as L
        await tbl.put(win)
        out.push(win)
        continue
      }

      const withLocal = { ...merged } as Record<string, unknown>
      const withRemote = { ...merged } as Record<string, unknown>
      for (const f of conflicts) {
        withLocal[f.field] = f.local
        withRemote[f.field] = f.remote
      }
      await useConflicts.getState().add({
        id: key,
        kind,
        recordId: local.id,
        title: await describe(local),
        fields: conflicts,
        local: { ...withLocal, dirty: 1 },
        remote: { ...withRemote, dirty: 1 },
        localAt: local.updatedAt,
        remoteAt: remote.updatedAt,
        detectedAt: Date.now(),
      })
    }
    return out
  }

  private async push(): Promise<void> {
    const dirtyThreads = await db.threads.where('dirty').equals(1).toArray()
    const threads = dirtyThreads.length
      ? await this.resolveOutgoing('thread', 'threads', dirtyThreads, fromThreadRow as never, THREAD_RULES,
          async (t) => `Chat “${t.title || 'Untitled'}”`, db.threads)
      : []
    if (threads.length) {
      const { data, error } = await this.sb.from('threads').upsert(threads.map((t) => toThreadRow(t, this.userId))).select()
      if (error) throw new Error(`push threads: ${error.message}`)
      await db.threads.bulkPut(threads.map((t) => ({ ...t, dirty: 0 })))
      await this.reconcile('thread', threads, data as ThreadRow[] | null, fromThreadRow as never, db.threads)
    }
    const dirtyMessages = await db.messages.where('dirty').equals(1).toArray()
    const messages = dirtyMessages.length
      ? await this.resolveOutgoing('message', 'messages', dirtyMessages, fromMessageRow as never, MESSAGE_RULES,
          async (m) => `Message in “${(await db.threads.get(m.threadId))?.title || 'a chat'}”`, db.messages)
      : []
    if (messages.length) {
      for (let i = 0; i < messages.length; i += 200) {
        const batch = messages.slice(i, i + 200)
        let rows = batch.map((m) => toMessageRow(m, this.userId)) as unknown as Record<string, unknown>[]
        let { data, error } = await this.sb.from('messages').upsert(rows).select()
        if (error && /variants|tool_steps|schema cache|find the/i.test(error.message)) {
          rows = rows.map(({ variants, tool_steps, ...rest }) => rest)
          ;({ data, error } = await this.sb.from('messages').upsert(rows).select())
        }
        if (error) throw new Error(`push messages: ${error.message}`)
        await db.messages.bulkPut(batch.map((m) => ({ ...m, dirty: 0 })))
        await this.reconcile('message', batch, data as MessageRow[] | null, fromMessageRow as never, db.messages)
      }
    }
    const dirtyMemories = await db.memories.where('dirty').equals(1).toArray()
    const memories = dirtyMemories.length
      ? await this.resolveOutgoing('memory', 'memories', dirtyMemories, fromMemoryRow as never, MEMORY_RULES,
          async (m) => `Memory “${m.content.slice(0, 48)}”`, db.memories)
      : []
    if (memories.length) {
      const { data, error } = await this.sb.from('memories').upsert(memories.map((m) => toMemoryRow(m, this.userId))).select()
      if (error) throw new Error(`push memories: ${error.message}`)
      await db.memories.bulkPut(memories.map((m) => ({ ...m, dirty: 0 })))
      await this.reconcile('memory', memories, data as MemoryRow[] | null, fromMemoryRow as never, db.memories)
    }

    let meta = await this.events.getMetaPayload?.()
    if (meta) {
      let pushedTs = (await kvGet<number>('sync.metaPushedTs')) ?? 0

      // Settings are one row, so pushing blind would replace whatever the other device wrote.
      // If it moved since our last sync, fold it in first and push the merge instead.
      if (meta.ts > pushedTs && this.events.applyRemoteMeta) {
        const row = await this.sb.from('user_settings').select('data, updated_at').eq('user_id', this.userId).maybeSingle()
        if (row.error) throw new Error(`check settings: ${row.error.message}`)
        const remoteTs = row.data ? Date.parse(row.data.updated_at) : 0
        if (row.data && remoteTs > pushedTs) {
          await this.events.applyRemoteMeta(row.data.data, remoteTs)
          await kvSet('sync.metaPushedTs', remoteTs)
          pushedTs = remoteTs
          meta = (await this.events.getMetaPayload?.()) ?? meta
        }
      }

      const payload = meta
      if (payload.ts > pushedTs) {
        const writeMeta = async (ts: number) =>
          this.sb
            .from('user_settings')
            .upsert({ user_id: this.userId, data: payload.data, updated_at: new Date(ts).toISOString() })
            .select('updated_at')
            .maybeSingle()

        let writeTs = payload.ts
        let res = await writeMeta(writeTs)
        if (res.error) throw new Error(`push settings: ${res.error.message}`)
        const storedTs = res.data ? Date.parse(res.data.updated_at) : writeTs
        if (storedTs > writeTs) {
          writeTs = storedTs + 1
          res = await writeMeta(writeTs)
          if (res.error) throw new Error(`push settings: ${res.error.message}`)
        }
        await kvSet('sync.metaPushedTs', writeTs)
        // What we just wrote is now the server's copy — the base for the next three-way merge.
        await shadowPut('settings', (payload.data as { settings?: unknown })?.settings, writeTs)
        this.events.onMetaPushed?.(writeTs)
      }
    }
  }

  private async pull(): Promise<number> {
    const cursor = (await kvGet<number>(CURSOR_KEY)) ?? 0
    const since = new Date(Math.max(0, cursor - OVERLAP_MS)).toISOString()
    let applied = 0
    let maxSeen = cursor

    const pending = pendingConflictIds()
    const apply = async <L extends { id: string; updatedAt: number; dirty: number }>(
      kind: ConflictKind,
      rows: Array<{ updated_at: string }>,
      convert: (r: never) => L,
      tbl: { get(id: string): Promise<L | undefined>; put(x: L): Promise<unknown> },
    ) => {
      for (const raw of rows) {
        const remote = convert(raw as never)
        const at = Date.parse(raw.updated_at)
        maxSeen = Math.max(maxSeen, at)
        // Whatever we do locally, this IS what the server holds — record it as the merge base.
        await shadowPut(`${kind}:${remote.id}`, remote, at)
        if (pending.has(`${kind}:${remote.id}`)) continue // the user hasn't picked a version yet
        const existing = await tbl.get(remote.id)
        if (existing && existing.updatedAt >= remote.updatedAt) continue
        // A dirty local row that lost the timestamp race was already merged (or raised a conflict)
        // during push, so overwriting here can no longer silently drop an edit.
        await tbl.put(remote)
        applied++
      }
    }

    const [t, m, mem] = await Promise.all([
      this.sb.from('threads').select('*').gt('updated_at', since).order('updated_at', { ascending: true }).limit(1000),
      this.sb.from('messages').select('*').gt('updated_at', since).order('updated_at', { ascending: true }).limit(2000),
      this.sb.from('memories').select('*').gt('updated_at', since).order('updated_at', { ascending: true }).limit(1000),
    ])
    if (t.error) throw new Error(`pull threads: ${t.error.message}`)
    if (m.error) throw new Error(`pull messages: ${m.error.message}`)
    if (mem.error) throw new Error(`pull memories: ${mem.error.message}`)

    await apply('thread', (t.data ?? []) as Array<{ updated_at: string }>, fromThreadRow as never, db.threads)
    await apply('message', (m.data ?? []) as Array<{ updated_at: string }>, fromMessageRow as never, db.messages)
    await apply('memory', (mem.data ?? []) as Array<{ updated_at: string }>, fromMemoryRow as never, db.memories)

    if (this.events.applyRemoteMeta && this.events.getMetaPayload) {
      const row = await this.sb.from('user_settings').select('data, updated_at').eq('user_id', this.userId).maybeSingle()
      if (row.error) throw new Error(`pull settings: ${row.error.message}`)
      if (row.data) {
        const remoteTs = Date.parse(row.data.updated_at)
        const local = await this.events.getMetaPayload()
        if (remoteTs > (local?.ts ?? 0)) {
          await this.events.applyRemoteMeta(row.data.data, remoteTs)
          await kvSet('sync.metaPushedTs', remoteTs)
          applied++
        }
      }
    }

    if (maxSeen > cursor) await kvSet(CURSOR_KEY, maxSeen)
    return applied
  }
}
