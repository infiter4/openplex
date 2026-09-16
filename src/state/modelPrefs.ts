import { create } from 'zustand'
import type { ModelRef } from '../lib/types'
import { useSettings } from './settings'

const PINNED_KEY = 'opx.pinnedModels'
const RECENTS_KEY = 'opx.recentModels'

function load(key: string): ModelRef[] {
  try {
    const arr = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(arr) ? arr.filter((r) => r && r.providerId && r.modelId) : []
  } catch {
    return []
  }
}

const refKey = (r: ModelRef) => `${r.providerId}/${r.modelId}`
const sameRef = (a: ModelRef, b: ModelRef) => a.providerId === b.providerId && a.modelId === b.modelId

interface ModelPrefsStore {
  pinned: ModelRef[]
  recents: ModelRef[]
  isPinned: (ref: ModelRef) => boolean
  togglePin: (ref: ModelRef) => void
  pushRecent: (ref: ModelRef) => void
}

export const useModelPrefs = create<ModelPrefsStore>()((set, get) => ({
  pinned: useSettings.getState().settings.pinnedModels ?? load(PINNED_KEY),
  recents: load(RECENTS_KEY),

  isPinned: (ref) => get().pinned.some((r) => sameRef(r, ref)),

  togglePin: (ref) => {
    const cur = useSettings.getState().settings.pinnedModels ?? get().pinned
    const exists = cur.some((r) => sameRef(r, ref))
    const pinned = exists ? cur.filter((r) => !sameRef(r, ref)) : [...cur, ref].slice(-12)
    useSettings.getState().update({ pinnedModels: pinned })
    set({ pinned })
  },

  pushRecent: (ref) => {
    const recents = [ref, ...get().recents.filter((r) => !sameRef(r, ref))].slice(0, 8)
    localStorage.setItem(RECENTS_KEY, JSON.stringify(recents))
    set({ recents })
  },
}))

useSettings.subscribe((s) => {
  const next = s.settings.pinnedModels ?? []
  if (next !== useModelPrefs.getState().pinned) useModelPrefs.setState({ pinned: next })
})

const _legacy = load(PINNED_KEY)
if (useSettings.getState().settings.pinnedModels === undefined && _legacy.length) {
  useSettings.getState().update({ pinnedModels: _legacy })
}

export { refKey, sameRef }
