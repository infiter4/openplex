import { Brain, Cloud, Database, Globe, KeyRound, Mic, Palette, Stethoscope } from 'lucide-react'
import type { ReactNode } from 'react'
import { cx } from '../lib/utils'
import { useStore, type SettingsTab } from '../state/store'
import { AppearanceTab } from './settings/AppearanceTab'
import { DataTab } from './settings/DataTab'
import { MemoryTab } from './settings/MemoryTab'
import { ProvidersTab } from './settings/ProvidersTab'
import { RepairTab } from './settings/RepairTab'
import { SearchTab } from './settings/SearchTab'
import { SyncTab } from './settings/SyncTab'
import { VoiceTab } from './settings/VoiceTab'

const SECTIONS: Array<{ id: SettingsTab; label: string; icon: ReactNode }> = [
  { id: 'providers', label: 'Providers & keys', icon: <KeyRound size={14} /> },
  { id: 'search', label: 'Web search', icon: <Globe size={14} /> },
  { id: 'voice', label: 'Voice', icon: <Mic size={14} /> },
  { id: 'memory', label: 'Memory', icon: <Brain size={14} /> },
  { id: 'sync', label: 'Account & devices', icon: <Cloud size={14} /> },
  { id: 'repair', label: 'Repair', icon: <Stethoscope size={14} /> },
  { id: 'appearance', label: 'Appearance & persona', icon: <Palette size={14} /> },
  { id: 'data', label: 'Data', icon: <Database size={14} /> },
]

const BODIES: Record<SettingsTab, ReactNode> = {
  providers: <ProvidersTab />,
  search: <SearchTab />,
  voice: <VoiceTab />,
  memory: <MemoryTab />,
  sync: <SyncTab />,
  repair: <RepairTab />,
  appearance: <AppearanceTab />,
  data: <DataTab />,
}

export function Settings() {
  const stored = useStore((s) => s.settingsTab)
  const open = useStore((s) => s.openSettings)
  const tab: SettingsTab = stored ?? 'providers'

  return (
    <div className="op-fadeup h-full overflow-y-auto bg-bg0">
      <div className="mx-auto max-w-[760px] px-6 pt-8 pb-16">
        <h1 className="font-serif text-[30px] leading-tight text-ink mb-5">Settings</h1>

        <nav
          className="flex gap-2 overflow-x-auto pb-1 mb-6 -mx-1 px-1"
          aria-label="Settings sections"
        >
          {SECTIONS.map((s) => {
            const active = tab === s.id
            return (
              <button
                key={s.id}
                onClick={() => open(s.id)}
                data-tip={s.label}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'op-hover-lift relative shrink-0 flex items-center gap-2 h-[34px] px-3.5 rounded-full text-[13px] font-medium border whitespace-nowrap transition-colors',
                  active
                    ? 'bg-accent-soft text-ink border-accent'
                    : 'bg-bg1 text-muted border-line hover:text-ink hover:bg-bg2',
                )}
              >
                <span className={active ? 'text-accent' : 'text-faint'}>{s.icon}</span>
                {s.label}
                {active && (
                  <span className="absolute left-3.5 right-3.5 -bottom-[5px] h-[2px] rounded-sm bg-accent" />
                )}
              </button>
            )
          })}
        </nav>

        <div className="rounded-xl border border-line bg-bg1 p-5 max-h-[calc(100vh-220px)] overflow-y-auto min-w-0">
          {BODIES[tab]}
        </div>
      </div>
    </div>
  )
}
