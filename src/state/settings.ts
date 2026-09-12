import { create } from 'zustand'
import { bumpMetaTs } from '../lib/bus'
import { setProviderOverrides } from '../lib/providers'
import { DEFAULT_SETTINGS, type Settings } from '../lib/types'

const LS_KEY = 'opx.settings'

function load(): Settings {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return structuredClone(DEFAULT_SETTINGS)
    const parsed = JSON.parse(raw) as Partial<Settings>
    return {
      ...structuredClone(DEFAULT_SETTINGS),
      ...parsed,
      search: { ...structuredClone(DEFAULT_SETTINGS.search), ...parsed.search },
      memory: { ...DEFAULT_SETTINGS.memory, ...parsed.memory },
      keySync: { ...DEFAULT_SETTINGS.keySync, ...parsed.keySync },
      compute: { ...DEFAULT_SETTINGS.compute, ...parsed.compute },
      sync: { ...parsed.sync },
    }
  } catch {
    return structuredClone(DEFAULT_SETTINGS)
  }
}

export function resolveTheme(theme: Settings['theme']): string {
  if (theme === 'system') return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'obsidian' : 'paper'
  if (theme === 'dark') return 'obsidian'
  if (theme === 'light') return 'paper'
  return theme
}

export function applyTheme(theme: Settings['theme']): void {
  document.documentElement.dataset.theme = resolveTheme(theme)
  localStorage.setItem('opx.theme', theme)
}

export function applyDensity(density: Settings['density']): void {
  document.documentElement.dataset.density = density ?? 'comfortable'
}

interface SettingsStore {
  settings: Settings
  update: (patch: Partial<Settings>, opts?: { silent?: boolean }) => void
}

const initial = load()
setProviderOverrides(initial.providerOverrides)

export const useSettings = create<SettingsStore>()((set, get) => ({
  settings: initial,
  update: (patch, opts) => {
    const next = { ...get().settings, ...patch }
    set({ settings: next })
    localStorage.setItem(LS_KEY, JSON.stringify(next))
    // Keep the endpoint-resolution registry in step (repairs arrive here from sync too).
    if ('providerOverrides' in patch) setProviderOverrides(next.providerOverrides)
    if (patch.theme) applyTheme(patch.theme)
    if (patch.density) applyDensity(patch.density)
    if (!opts?.silent) bumpMetaTs()
  },
}))

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const { settings } = useSettings.getState()
  if (settings.theme === 'system') applyTheme('system')
})
