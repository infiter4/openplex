import { Check } from 'lucide-react'
import type { Settings } from '../../lib/types'
import { cx } from '../../lib/utils'
import { useSettings } from '../../state/settings'
import { Field, inputCls } from '../ui'

type ThemeId = Settings['theme']
type Density = NonNullable<Settings['density']>

const THEMES: Array<{ id: ThemeId; name: string; desc: string; bg: string; ink: string; accent: string }> = [
  { id: 'system', name: 'System', desc: 'auto', bg: 'oklch(0.165 0.006 70)', ink: 'oklch(0.945 0.008 80)', accent: 'oklch(0.83 0.082 80)' },
  { id: 'obsidian', name: 'Obsidian', desc: 'warm dark', bg: 'oklch(0.165 0.006 70)', ink: 'oklch(0.945 0.008 80)', accent: 'oklch(0.83 0.082 80)' },
  { id: 'paper', name: 'Paper', desc: 'light', bg: 'oklch(0.975 0.004 85)', ink: 'oklch(0.24 0.01 70)', accent: 'oklch(0.55 0.11 48)' },
  { id: 'nocturne', name: 'Nocturne', desc: 'blue dark', bg: 'oklch(0.165 0.008 250)', ink: 'oklch(0.95 0.012 245)', accent: 'oklch(0.78 0.108 250)' },
  { id: 'ember', name: 'Ember', desc: 'red dark', bg: 'oklch(0.168 0.008 40)', ink: 'oklch(0.95 0.01 62)', accent: 'oklch(0.72 0.122 38)' },
]

const DENSITIES: Array<{ id: Density; label: string }> = [
  { id: 'compact', label: 'Compact' },
  { id: 'comfortable', label: 'Comfortable' },
  { id: 'spacious', label: 'Spacious' },
]

export function AppearanceTab() {
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  const density: Density = settings.density ?? 'comfortable'

  return (
    <div>
      <Field
        label="Theme"
        hint="Five worlds, each tuned for contrast and calm. Light and dark live here too."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {THEMES.map((t) => {
            const active = settings.theme === t.id
            return (
              <button
                key={t.id}
                onClick={() => update({ theme: t.id })}
                aria-pressed={active}
                className={cx(
                  'op-hover-lift text-left rounded-xl overflow-hidden bg-bg1 border transition-colors',
                  active ? 'border-accent' : 'border-line hover:border-line-strong',
                )}
              >
                <div
                  className="relative h-[58px] flex items-center gap-2 px-3.5"
                  style={{ background: t.bg }}
                >
                  <span className="font-serif text-[20px]" style={{ color: t.ink }}>
                    Aa
                  </span>
                  <span className="w-[18px] h-[18px] rounded-full" style={{ background: t.accent }} />
                  <span
                    className="ml-auto w-[5px] h-6 rounded-sm opacity-35"
                    style={{ background: t.ink }}
                  />
                  <span className="w-[5px] h-4 rounded-sm" style={{ background: t.accent }} />
                  {active && (
                    <span
                      className="absolute top-2 right-2 inline-flex items-center justify-center w-[18px] h-[18px] rounded-full"
                      style={{ background: t.accent, color: t.bg }}
                    >
                      <Check size={11} strokeWidth={3} />
                    </span>
                  )}
                </div>
                <div className="px-3.5 py-2.5">
                  <div className="font-serif text-[14px] text-ink">{t.name}</div>
                  <div className="text-[10px] tracking-[.16em] font-semibold uppercase text-faint mt-1">
                    {t.desc}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </Field>

      <Field label="Density">
        <div className="flex gap-2">
          {DENSITIES.map((d) => (
            <button
              key={d.id}
              onClick={() => update({ density: d.id })}
              aria-pressed={density === d.id}
              className={cx(
                'op-hover-lift flex-1 h-[38px] rounded-lg text-[13px] font-medium border transition-colors',
                density === d.id
                  ? 'bg-accent-soft text-ink border-accent'
                  : 'bg-bg1 text-muted border-line hover:text-ink hover:bg-bg2',
              )}
            >
              {d.label}
            </button>
          ))}
        </div>
      </Field>

      <Field
        label="Default system prompt"
        hint="Added on top of openplex’s built-in prompt for every conversation — it augments, never replaces it. Individual threads can layer their own on top (gear icon in the chat header). Memories are appended automatically."
      >
        <textarea
          value={settings.defaultSystemPrompt}
          onChange={(e) => update({ defaultSystemPrompt: e.target.value })}
          placeholder="You are a concise, direct assistant…"
          rows={4}
          className={cx(inputCls, 'resize-y min-h-[90px] leading-relaxed')}
        />
      </Field>

      <Field
        label={`Temperature ${settings.temperature != null ? `· ${settings.temperature.toFixed(1)}` : '· model default'}`}
        hint="Lower is more focused, higher is more creative. Leave on “model default” unless you have a reason."
      >
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={2}
            step={0.1}
            value={settings.temperature ?? 1}
            onChange={(e) => update({ temperature: Number(e.target.value) })}
            className="flex-1 accent-(--accent)"
            disabled={settings.temperature == null}
          />
          <label className="flex items-center gap-1.5 text-[12.5px] text-muted whitespace-nowrap">
            <input
              type="checkbox"
              checked={settings.temperature == null}
              onChange={(e) => update({ temperature: e.target.checked ? undefined : 1 })}
              className="accent-(--accent)"
            />
            model default
          </label>
        </div>
      </Field>
    </div>
  )
}
