import type { ComponentType } from 'react'
import { useSettings } from '../state/settings'
import { useStore, type Surface } from '../state/store'
import { cx } from '../lib/utils'
import { IconAsk, IconLibrary, IconModels, IconSettings, IconTheme } from './icons'

const THEME_CYCLE = ['obsidian', 'paper', 'nocturne', 'ember'] as const

const NAV: Array<{ id: Surface; label: string; icon: ComponentType<{ size?: number }> }> = [
  { id: 'stage', label: 'ASK', icon: IconAsk },
  { id: 'library', label: 'LIBRARY', icon: IconLibrary },
  { id: 'models', label: 'MODELS', icon: IconModels },
  { id: 'settings', label: 'SETTINGS', icon: IconSettings },
]

function useNav() {
  const surface = useStore((s) => s.surface)
  const setSurface = useStore((s) => s.setSurface)
  const openSettings = useStore((s) => s.openSettings)
  const selectThread = useStore((s) => s.selectThread)
  const go = (id: Surface) => {
    if (id === 'settings') openSettings()
    else if (id === 'stage') void selectThread(null)
    else setSurface(id)
  }
  return { surface, go }
}

function cycleTheme(current: string): (typeof THEME_CYCLE)[number] {
  const i = THEME_CYCLE.indexOf(current as (typeof THEME_CYCLE)[number])
  return THEME_CYCLE[(i + 1) % THEME_CYCLE.length]
}

function Logo() {
  return (
    <svg width="26" height="26" viewBox="14 11 36 36" fill="none" aria-hidden>
      <path d="M20 44 C20 30, 28 30, 32 22" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round" fill="none" />
      <path d="M44 44 C44 30, 36 30, 32 22" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round" fill="none" opacity="0.45" />
      <circle cx="32" cy="19" r="4.5" fill="var(--accent)" />
    </svg>
  )
}

export function Rail() {
  const { surface, go } = useNav()
  const theme = useSettings((s) => s.settings.theme)
  const update = useSettings((s) => s.update)

  return (
    <nav className="hidden md:flex w-[78px] shrink-0 flex-col items-center border-r border-line bg-bg1 py-4 pt-safe">
      <button onClick={() => go('stage')} title="openplex" className="block"><Logo /></button>
      <div className="w-5 h-px bg-line mt-4" />
      <div className="flex-1 flex flex-col gap-6 mt-6 items-center">
        {NAV.map(({ id, label, icon: Icon }) => {
          const active = surface === id
          return (
            <button
              key={id}
              onClick={() => go(id)}
              className="op-hover-lift flex flex-col items-center gap-1.5"
              style={{ color: active ? 'var(--ink)' : 'var(--faint)' }}
            >
              <Icon size={22} />
              <span className="text-[9px] tracking-[.18em] font-semibold">{label}</span>
              <span className={cx('w-3 h-0.5 rounded', active ? 'bg-accent' : 'bg-transparent')} />
            </button>
          )
        })}
      </div>
      <button
        onClick={() => update({ theme: cycleTheme(theme) })}
        title="Cycle theme"
        className="op-hover-lift w-9 h-9 flex items-center justify-center text-faint hover:text-ink mb-4"
      >
        <IconTheme size={18} />
      </button>
      <button
        onClick={() => go('stage')}
        title="openplex — home"
        aria-label="Go to home"
        className="op-hover-lift font-mono text-[9px] tracking-[.42em] text-faint opacity-60 hover:opacity-100 hover:text-accent transition-opacity"
        style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
      >
        OPENPLEX
      </button>
    </nav>
  )
}

export function MobileDock() {
  const { surface, go } = useNav()
  return (
    <nav className="md:hidden shrink-0 flex items-stretch border-t border-line bg-bg1 pb-safe-sm">
      {NAV.map(({ id, label, icon: Icon }) => {
        const active = surface === id
        return (
          <button
            key={id}
            onClick={() => go(id)}
            className="flex-1 flex flex-col items-center gap-1 py-2.5"
            style={{ color: active ? 'var(--accent)' : 'var(--faint)' }}
          >
            <Icon size={20} />
            <span className="text-[9px] tracking-[.12em] font-semibold">{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
