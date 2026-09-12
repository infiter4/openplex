import { Check, Loader2, Search, X } from 'lucide-react'
import { IconCompare } from '../icons'
import { useDeferredValue, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { modelDisplayName } from '../../lib/catalog'
import { isBrowserReady } from '../../lib/providers'
import type { ModelRef } from '../../lib/types'
import { cx, formatCost, formatTokens } from '../../lib/utils'
import { useModelPrefs } from '../../state/modelPrefs'
import { useProviders } from '../../state/providers'
import { useSettings } from '../../state/settings'
import { useStore } from '../../state/store'
import { Dropdown } from '../ui'
import { Markdown } from '../Markdown'

const DOT_COLORS = ['#e0894a', '#7fae8a', '#6a8caf', '#b07bac', '#5fa8d3', '#c97b63', '#d0a14b']
function dotFor(id: string): string {
  return DOT_COLORS[Math.abs([...id].reduce((h, c) => h * 31 + c.charCodeAt(0), 7)) % DOT_COLORS.length]
}
const keyOf = (r: ModelRef) => `${r.providerId}/${r.modelId}`

export function CompareButton({ messageId }: { messageId: string }) {
  const btnRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<Map<string, ModelRef>>(new Map())
  const [query, setQuery] = useState('')
  const dq = useDeferredValue(query)
  const pinned = useModelPrefs((s) => s.pinned)
  const recents = useModelPrefs((s) => s.recents)
  const defaultModel = useSettings((s) => s.settings.defaultModel)
  const showAll = useSettings((s) => s.settings.showAllProviders)
  const catalog = useProviders((s) => s.catalog)
  const connections = useProviders((s) => s.connections)
  const startCompare = useStore((s) => s.startCompare)

  // convenient defaults shown before searching: your default + pinned + recent models
  const candidates = useMemo(() => {
    const out: ModelRef[] = []
    const seen = new Set<string>()
    for (const r of [...(defaultModel ? [defaultModel] : []), ...pinned, ...recents]) {
      if (!seen.has(keyOf(r))) { seen.add(keyOf(r)); out.push(r) }
    }
    return out
  }, [defaultModel, pinned, recents])

  // every pickable model, built ONLY while this dropdown is open (so the per-message
  // buttons stay cheap); connected providers are always included even if not browser-ready
  const index = useMemo(() => {
    if (!open || !catalog) return [] as { ref: ModelRef; label: string; haystack: string }[]
    const connectedIds = new Set(Object.keys(connections))
    const out: { ref: ModelRef; label: string; haystack: string }[] = []
    for (const provider of Object.values(catalog)) {
      if (!(showAll || isBrowserReady(provider) || connectedIds.has(provider.id))) continue
      const conn = connections[provider.id]
      const known = new Set(Object.keys(provider.models))
      const extras = (conn?.models ?? []).filter((id) => !known.has(id)).map((id) => ({ id, name: id }))
      for (const model of [...Object.values(provider.models), ...extras]) {
        out.push({
          ref: { providerId: provider.id, modelId: model.id },
          label: `${provider.name} · ${model.name}`,
          haystack: `${provider.name} ${model.name} ${model.id}`.toLowerCase(),
        })
      }
    }
    return out
  }, [open, catalog, connections, showAll])

  const results = useMemo(() => {
    const q = dq.trim().toLowerCase()
    if (!q) return null
    return index.filter((m) => m.haystack.includes(q)).slice(0, 40)
  }, [dq, index])

  const toggle = (r: ModelRef) =>
    setPicked((p) => {
      const n = new Map(p)
      const k = keyOf(r)
      if (n.has(k)) n.delete(k)
      else n.set(k, r)
      return n
    })

  const run = () => {
    const refs = [...picked.values()]
    if (refs.length < 2) return
    setOpen(false)
    setPicked(new Map())
    setQuery('')
    void startCompare(messageId, refs)
  }

  const renderRow = (r: ModelRef, label: string) => {
    const on = picked.has(keyOf(r))
    return (
      <button
        key={keyOf(r)}
        onClick={() => toggle(r)}
        className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left hover:bg-bg2 transition-colors"
      >
        <span className={cx('w-4 h-4 rounded-[5px] border flex items-center justify-center shrink-0', on ? 'bg-accent border-accent' : 'border-line-strong')}>
          {on && <Check size={11} className="text-accent-ink" />}
        </span>
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: dotFor(r.providerId) }} />
        <span className="flex-1 truncate text-[13px]">{label}</span>
      </button>
    )
  }

  return (
    <>
      <button
        ref={btnRef}
        data-tip="Compare across models"
        aria-label="Compare across models"
        onClick={() => setOpen((v) => !v)}
        className="p-1.5 rounded-lg text-faint hover:text-ink hover:bg-bg2 transition-colors"
      >
        <IconCompare size={13} />
      </button>
      {open && (
        <Dropdown anchor={btnRef.current} onClose={() => setOpen(false)} width={300} align="right">
          <div className="p-2">
            <div className="px-2 pt-1 pb-2 text-[10.5px] font-semibold uppercase tracking-[.14em] text-faint">
              Ask several models at once
            </div>
            <div className="flex items-center gap-2 px-2 py-1.5 mb-1 rounded-lg border border-line bg-bg0/50">
              <Search size={13} className="text-faint shrink-0" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search every model…"
                className="flex-1 bg-transparent outline-none text-[13px] min-w-0"
              />
            </div>
            <div className="max-h-[240px] overflow-y-auto">
              {results
                ? results.length
                  ? results.map((m) => renderRow(m.ref, m.label))
                  : <div className="px-2 py-3 text-[12.5px] text-muted">No models match “{dq}”.</div>
                : candidates.length
                  ? candidates.map((r) => renderRow(r, modelDisplayName(catalog, r)))
                  : <div className="px-2 py-3 text-[12.5px] text-muted">Search above to pick models to compare.</div>}
            </div>
            <button
              onClick={run}
              disabled={picked.size < 2}
              className="mt-1.5 w-full py-2 rounded-lg bg-accent text-accent-ink text-[12.5px] font-semibold disabled:opacity-40"
            >
              {picked.size >= 2 ? `Compare ${picked.size} models` : picked.size === 1 ? 'Pick 1 more model' : 'Pick 2+ models to compare'}
            </button>
          </div>
        </Dropdown>
      )}
    </>
  )
}

export function CompareOverlay() {
  const compare = useStore((s) => s.compare)
  const close = useStore((s) => s.closeCompare)
  const keep = useStore((s) => s.keepCompare)
  const catalog = useProviders((s) => s.catalog)
  if (!compare) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[60] bg-black/55 backdrop-blur-[2px] anim-fade flex items-start justify-center p-4 pt-[8vh] overflow-y-auto"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}
    >
      <div className="op-scalein w-full max-w-[1040px] rounded-2xl border border-line-strong bg-bg1" style={{ boxShadow: 'var(--shadow)' }}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line">
          <span className="text-[11px] font-semibold uppercase tracking-[.14em] text-faint">Comparing answers</span>
          <button onClick={close} className="p-1.5 rounded-lg text-muted hover:text-ink hover:bg-bg2"><X size={16} /></button>
        </div>
        <div className="p-4 grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))' }}>
          {compare.items.map((it, i) => (
            <div key={i} className="flex flex-col rounded-xl border border-line-strong bg-bg0/40 p-4 op-fadeup">
              <div className="flex items-center gap-2 mb-2.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: dotFor(it.ref.providerId) }} />
                <span className="font-serif text-[15px] truncate flex-1">{modelDisplayName(catalog, it.ref)}</span>
                {it.usage && (
                  <span className="font-mono text-[10.5px] text-faint shrink-0">
                    {it.usage.cost != null ? formatCost(it.usage.cost) : `${formatTokens(it.usage.outputTokens ?? 0)} tok`}
                    {it.usage.latencyMs != null ? ` · ${(it.usage.latencyMs / 1000).toFixed(1)}s` : ''}
                  </span>
                )}
              </div>
              <div className="flex-1 min-h-[80px] text-[13.5px] leading-relaxed">
                {it.status === 'pending' && (
                  <div className="flex items-center gap-2 text-faint text-[12.5px] py-4"><Loader2 size={14} className="animate-spin" /> thinking…</div>
                )}
                {it.status === 'error' && <div className="text-danger text-[12.5px] py-2">{it.error}</div>}
                {it.status === 'done' && <div className="font-serif"><Markdown content={it.text} /></div>}
              </div>
              <button
                onClick={() => void keep(i)}
                disabled={it.status !== 'done'}
                className="mt-3 py-1.5 rounded-lg border border-line-strong text-[12.5px] font-medium hover:bg-bg3 transition-colors disabled:opacity-40"
              >
                Keep this answer
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
