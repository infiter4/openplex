import type { ComponentType } from 'react'
import { IconAsk, IconChevronDown, IconLibrary, IconModels, IconSearch, IconSettings } from './icons'
import { modelDisplayName } from '../lib/catalog'
import { useProviders } from '../state/providers'
import { useSettings } from '../state/settings'
import { useStore } from '../state/store'

const META: Record<string, { label: string; icon: ComponentType<{ size?: number }> }> = {
  stage: { label: 'ASK', icon: IconAsk },
  library: { label: 'LIBRARY', icon: IconLibrary },
  models: { label: 'MODELS', icon: IconModels },
  settings: { label: 'SETTINGS', icon: IconSettings },
}

export function Masthead() {
  const surface = useStore((s) => s.surface)
  const activeThreadId = useStore((s) => s.activeThreadId)
  const threads = useStore((s) => s.threads)
  const setPaletteOpen = useStore((s) => s.setPaletteOpen)
  const setPickerOpen = useStore((s) => s.setPickerOpen)
  const catalog = useProviders((s) => s.catalog)
  const defaultModel = useSettings((s) => s.settings.defaultModel)

  const meta = META[surface] ?? META.stage
  const Icon = meta.icon
  const thread = surface === 'stage' && activeThreadId ? threads.find((t) => t.id === activeThreadId) : null
  const modelName = modelDisplayName(catalog, thread?.modelRef ?? defaultModel) || 'Choose model'

  return (
    <header className="shrink-0 flex items-center justify-between gap-3 min-h-[54px] py-2.5 px-4 sm:px-6 border-b border-line bg-bg0/80 backdrop-blur-sm pt-safe">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="text-accent shrink-0"><Icon size={17} /></span>
        {thread ? (
          <span className="font-serif italic text-[16px] text-muted truncate max-w-[42vw]">{thread.title}</span>
        ) : (
          <span className="text-[12px] tracking-[.22em] font-semibold text-muted">{meta.label}</span>
        )}
      </div>

      <div className="flex items-center gap-3 sm:gap-4">
        <button onClick={() => setPaletteOpen(true)} className="op-hover-lift flex items-center gap-2 text-faint hover:text-ink">
          <IconSearch size={15} />
          <span className="hidden sm:inline text-[11px] tracking-[.16em] font-semibold">SEARCH</span>
          <span className="hidden sm:inline font-mono text-[10px] px-1.5 py-0.5 rounded bg-bg3">⌘K</span>
        </button>
        <span className="w-px h-5 bg-line" />
        <button onClick={() => setPickerOpen(true)} className="op-hover-lift flex items-center gap-2.5">
          <span className="hidden sm:inline text-[10px] tracking-[.16em] font-semibold text-faint">INSTRUMENT</span>
          <span className="w-1.5 h-1.5 rounded-full bg-accent op-pulse" />
          <span className="font-serif text-[16px] text-ink truncate max-w-[120px] sm:max-w-[160px]">{modelName}</span>
          <IconChevronDown size={13} className="text-faint shrink-0" />
        </button>
      </div>
    </header>
  )
}
