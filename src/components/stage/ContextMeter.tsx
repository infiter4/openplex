import { useRef, useState } from 'react'
import { formatTokens } from '../../lib/utils'
import { useStore } from '../../state/store'
import { Dropdown } from '../ui'

// Default reply cap when set to "Auto" — keep in sync with store.ts answerTokens (32_768).
const AUTO_LABEL = '32K'
const PRESETS: Array<{ v: number; label: string }> = [
  { v: 8192, label: '8K' },
  { v: 16384, label: '16K' },
  { v: 32768, label: '32K' },
  { v: 65536, label: '64K' },
  { v: 128000, label: '128K' },
]

export function ContextMeter({ used, total }: { used: number; total: number }) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const activeThreadId = useStore((s) => s.activeThreadId)
  const draftMaxOutput = useStore((s) => s.draftMaxOutput)
  const setMaxOutput = useStore((s) => s.setMaxOutput)
  const threadMaxOutput = useStore((s) =>
    s.activeThreadId ? s.threads.find((t) => t.id === s.activeThreadId)?.maxOutput : undefined,
  )
  const maxOutput = activeThreadId ? threadMaxOutput : draftMaxOutput

  const frac = total > 0 ? Math.max(0, Math.min(1, used / total)) : 0
  const pct = Math.round(frac * 100)
  const r = 7
  const circ = 2 * Math.PI * r
  const color = frac > 0.92 ? 'var(--err)' : frac > 0.75 ? 'var(--warn)' : 'var(--accent)'

  const sel = (active: boolean) =>
    `px-2 py-1.5 rounded-md text-[11.5px] border transition-colors ${
      active ? 'border-accent text-accent' : 'border-line text-muted hover:bg-bg2'
    }`

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-md px-1 -mx-1 py-0.5 hover:bg-bg2 transition-colors"
        // Kept short on purpose: this was one 341px-wide line that ran off a 320px screen. The
        // detail is in the panel this button opens.
        data-tip={`Context ${formatTokens(used)}/${formatTokens(total)} · reply ${maxOutput ? formatTokens(maxOutput) : AUTO_LABEL}`}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" className="-rotate-90 shrink-0">
          <circle cx="9" cy="9" r={r} fill="none" stroke="var(--bg3)" strokeWidth="2.4" />
          <circle
            cx="9"
            cy="9"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={circ * (1 - frac)}
            style={{ transition: 'stroke-dashoffset .25s ease, stroke .25s ease' }}
          />
        </svg>
        <span className="font-mono text-[11px] text-muted tabular-nums" style={{ color }}>
          {pct}%
        </span>
      </button>
      {open && (
        <Dropdown anchor={btnRef.current} onClose={() => setOpen(false)} width={236} align="right">
          <div className="p-3">
            <div className="text-[10.5px] font-semibold uppercase tracking-[.14em] text-faint mb-1">Max reply length</div>
            <p className="text-[11.5px] text-muted leading-snug mb-2.5">
              How many tokens one reply may use. Lower is safer — some providers reject very large values;
              raise it for long writeups or code.
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              <button onClick={() => { setMaxOutput(undefined); setOpen(false) }} className={sel(maxOutput == null)}>
                Auto
              </button>
              {PRESETS.map((p) => (
                <button key={p.v} onClick={() => { setMaxOutput(p.v); setOpen(false) }} className={`${sel(maxOutput === p.v)} font-mono`}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </Dropdown>
      )}
    </>
  )
}
