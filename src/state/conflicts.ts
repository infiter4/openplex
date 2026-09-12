import { create } from 'zustand'
import { bus } from '../lib/bus'
import { db, kvGet, kvSet } from '../lib/db'
import type { FieldConflict } from '../lib/merge'
import type { Memory, Message, Settings, Thread } from '../lib/types'
import { useSettings } from './settings'

export type ConflictKind = 'thread' | 'message' | 'memory' | 'settings'

/**
 * Two versions of the same thing that can't be reconciled automatically — both devices changed
 * the same field to different values. Each candidate is a COMPLETE record (auto-merged on every
 * other field), so resolving is just "write the one the user picked".
 */
export interface SyncConflict {
  id: string
  kind: ConflictKind
  recordId: string
  /** What the user is looking at: 'Thread "Trip planning"'. */
  title: string
  fields: FieldConflict[]
  local: unknown
  remote: unknown
  localAt: number
  remoteAt: number
  detectedAt: number
}

const KEY = 'sync.conflicts'

interface ConflictStore {
  conflicts: SyncConflict[]
  open: boolean
  loaded: boolean
  setOpen: (open: boolean) => void
  load: () => Promise<void>
  add: (c: SyncConflict) => Promise<void>
  resolve: (id: string, side: 'local' | 'remote') => Promise<void>
  dismiss: (id: string) => Promise<void>
}

export const useConflicts = create<ConflictStore>()((set, get) => {
  const persist = async (conflicts: SyncConflict[]) => {
    set({ conflicts })
    await kvSet(KEY, conflicts)
  }

  return {
    conflicts: [],
    open: false,
    loaded: false,
    setOpen: (open) => set({ open }),

    load: async () => {
      if (get().loaded) return
      const stored = (await kvGet<SyncConflict[]>(KEY)) ?? []
      // Anything still unresolved is holding records out of sync — show it rather than hide it.
      set({ conflicts: stored, loaded: true, open: stored.length > 0 })
    },

    add: async (c) => {
      const existing = get().conflicts
      // One conflict per record: a later sync re-detects the same disagreement, it shouldn't stack.
      const next = [...existing.filter((x) => x.id !== c.id), c]
      await persist(next)
      set({ open: true })
    },

    resolve: async (id, side) => {
      const c = get().conflicts.find((x) => x.id === id)
      if (!c) return
      const chosen = side === 'local' ? c.local : c.remote
      const now = Date.now()
      // Bump updatedAt / the meta clock so the winning version is what propagates outward.
      if (c.kind === 'thread') await db.threads.put({ ...(chosen as Thread), updatedAt: now, dirty: 1 })
      else if (c.kind === 'message') await db.messages.put({ ...(chosen as Message), updatedAt: now, dirty: 1 })
      else if (c.kind === 'memory') await db.memories.put({ ...(chosen as Memory), updatedAt: now, dirty: 1 })
      else if (c.kind === 'settings') useSettings.getState().update(chosen as Partial<Settings>)

      await persist(get().conflicts.filter((x) => x.id !== id))
      bus.dispatchEvent(new Event('conflict-resolved'))
    },

    dismiss: async (id) => {
      await persist(get().conflicts.filter((x) => x.id !== id))
    },
  }
})

/** Records with an unresolved conflict are held out of sync until the user decides. */
export function pendingConflictIds(): Set<string> {
  return new Set(useConflicts.getState().conflicts.map((c) => c.id))
}
