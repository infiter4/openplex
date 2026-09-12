import { Check, Lock, Plug } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { IconSearch } from './icons'
import { sttModelsFor, type SttOption } from '../lib/stt'
import type { CatalogModel } from '../lib/types'
import { cx, formatContext } from '../lib/utils'
import { useProviders } from '../state/providers'
import { useSettings } from '../state/settings'
import { ProviderLogo } from './ui'

function isFree(m?: CatalogModel) {
  return Boolean(m && m.cost?.input === 0 && (m.cost?.output ?? 0) === 0)
}
function priceLabel(m?: CatalogModel): string {
  const c = m?.cost
  if (!c || c.input == null) return ''
  if (isFree(m)) return 'free'
  return `$${c.input}/${c.output ?? '?'}`
}
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
const summary = (list: SttOption[]) =>
  `${plural(list.length, 'model')} · ${plural(new Set(list.map((o) => o.providerId)).size, 'provider')}`

const FREE_TINT = { background: 'oklch(0.78 0.09 150 / 0.14)' }

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'op-hover-lift flex items-center gap-1.5 shrink-0 h-7 px-3 rounded-full text-[12px] font-semibold border transition-colors',
        active ? 'border-transparent bg-accent-soft text-accent' : 'border-line-strong text-muted hover:text-ink hover:bg-bg2',
      )}
    >
      {children}
    </button>
  )
}

/** The voice picker's body, shared by the composer modal and the Settings → Voice page so they
 *  can't drift. Browses the whole speech-to-text catalog grouped into "Ready to use" (connected)
 *  and "Connect to unlock" (the rest); the current selection floats to the top. The parent decides
 *  what choosing a row means via onChoose (set + close, or route to connect). */
export function VoiceModelList({
  variant,
  onChoose,
}: {
  variant: 'modal' | 'page'
  onChoose: (o: SttOption) => void
}) {
  const settings = useSettings((s) => s.settings)
  const catalog = useProviders((s) => s.catalog)
  const connections = useProviders((s) => s.connections)

  const voice = settings.voice
  const [query, setQuery] = useState('')
  const [fReady, setFReady] = useState(false)
  const [fFree, setFFree] = useState(false)
  const [sel, setSel] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  const options = useMemo(
    () => sttModelsFor(catalog, connections, settings.showAllProviders),
    [catalog, connections, settings.showAllProviders],
  )
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return options.filter((o) => {
      if (fReady && !o.connected) return false
      if (fFree && !isFree(o.model)) return false
      if (q && !`${o.providerName} ${o.modelName} ${o.modelId}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [options, query, fReady, fFree])

  const isCurrent = (o: SttOption) => Boolean(voice?.providerId === o.providerId && voice?.model === o.modelId)
  const connected = useMemo(() => filtered.filter((o) => o.connected), [filtered])
  const unconnected = useMemo(() => filtered.filter((o) => !o.connected), [filtered])
  const band = useMemo(() => connected.find(isCurrent), [connected, voice]) // eslint-disable-line react-hooks/exhaustive-deps
  const readyRows = useMemo(() => connected.filter((o) => !isCurrent(o)), [connected, voice]) // eslint-disable-line react-hooks/exhaustive-deps
  const nav = useMemo(() => [...(band ? [band] : []), ...readyRows, ...unconnected], [band, readyRows, unconnected])

  useEffect(() => { setSel(0) }, [query, fReady, fFree])
  useEffect(() => {
    bodyRef.current?.querySelector(`[data-sel="${sel}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [sel])
  useEffect(() => {
    if (variant !== 'modal') return // don't grab focus when it's just a settings tab
    const t = requestAnimationFrame(() => searchRef.current?.focus())
    return () => cancelAnimationFrame(t)
  }, [variant])

  const row = (o: SttOption, idx: number) => {
    const price = priceLabel(o.model)
    const ctx = o.model?.limit?.context
    return (
      <button
        key={`${o.providerId}/${o.modelId}`}
        data-sel={idx}
        onMouseMove={() => setSel(idx)}
        onClick={() => onChoose(o)}
        className={cx(
          'relative w-full flex items-center gap-3.5 px-5 py-2.5 text-left border-b border-line/60 transition-colors',
          idx === sel ? 'bg-bg2' : 'hover:bg-bg2',
        )}
      >
        <span className={cx('shrink-0', !o.connected && 'opacity-55')}>
          <ProviderLogo id={o.providerId} name={o.providerName} size={34} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-2">
            <span className={cx('font-serif text-[15.5px] truncate min-w-0', o.connected ? 'text-ink' : 'text-muted')}>{o.modelName}</span>
            {o.connected && <span data-tip="Ready" className="shrink-0 w-1.5 h-1.5 rounded-full bg-ok" />}
          </span>
          <span className="block font-mono text-[10.5px] tracking-[.03em] text-faint mt-0.5 truncate">{o.modelId} · {o.providerName}</span>
        </span>
        {o.connected ? (
          isFree(o.model) ? (
            <span className="shrink-0 text-[11px] font-semibold text-ok px-2 py-0.5 rounded-full" style={FREE_TINT}>free</span>
          ) : (
            <span className="shrink-0 text-right font-mono leading-tight">
              <span className="block text-[11px] text-muted">{ctx ? formatContext(ctx) : 'audio → text'}</span>
              {price && <span className="block text-[10.5px] text-faint mt-0.5">{price}</span>}
            </span>
          )
        ) : (
          <span className="shrink-0 flex items-center gap-1 text-[11.5px] font-semibold text-accent"><Plug size={12} /> Connect</span>
        )}
      </button>
    )
  }

  const sectionHead = (icon: ReactNode, title: string, count: string, dim: boolean) => (
    <div className="sticky top-0 z-[1] flex items-center gap-2.5 px-5 pt-3.5 pb-1.5 bg-bg1">
      {icon}
      <span className={cx('text-[12px] font-semibold tracking-[.01em]', dim ? 'text-faint' : 'text-muted')}>{title}</span>
      <span className="flex-1 h-px bg-line" />
      <span className="font-mono text-[10.5px] text-faint">{count}</span>
    </div>
  )

  const empty = !query.trim() && !fReady && !fFree

  return (
    <div className="flex flex-col min-h-0 flex-1">
      {/* Search + filters — pinned above the scrolling list so it's always reachable */}
      <div className="shrink-0 px-5 pt-4 bg-bg1">
        <div className="flex items-center gap-3 pb-4 border-b border-line">
          <IconSearch size={18} className="text-faint shrink-0" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, nav.length - 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
              else if (e.key === 'Enter') { e.preventDefault(); if (nav[sel]) onChoose(nav[sel]) }
            }}
            placeholder="Search speech-to-text models…"
            className="op-input flex-1 bg-transparent outline-none text-[16.5px] min-w-0"
          />
          {variant === 'modal' && <span className="font-mono text-[10.5px] text-faint px-1.5 py-0.5 rounded bg-bg3 shrink-0">esc</span>}
        </div>
        <div className="flex gap-2 pt-3.5 pb-3">
          <Chip active={fReady} onClick={() => setFReady(!fReady)}><Plug size={12} /> Ready to use</Chip>
          <Chip active={fFree} onClick={() => setFFree(!fFree)}>Free</Chip>
        </div>
      </div>

      {/* Body */}
      <div ref={bodyRef} className="flex-1 overflow-y-auto min-h-0">
        {nav.length === 0 ? (
          <div className="text-center py-14 px-6">
            <div className="font-serif text-[18px] text-ink mb-1.5">No models {empty ? 'available' : 'match'}</div>
            <p className="text-[13px] text-muted leading-relaxed">{empty ? 'The catalog is still loading — give it a moment.' : 'Loosen the filters or search.'}</p>
          </div>
        ) : (
          <>
            {band && (
              <button
                data-sel={0}
                onMouseMove={() => setSel(0)}
                onClick={() => onChoose(band)}
                className="relative w-full flex items-center gap-3.5 px-5 py-3 text-left bg-accent-soft border-b border-line transition-colors"
              >
                <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r bg-accent" />
                <ProviderLogo id={band.providerId} name={band.providerName} size={34} />
                <span className="flex-1 min-w-0">
                  <span className="block font-serif text-[15.5px] text-ink truncate">{band.modelName}</span>
                  <span className="block font-mono text-[10.5px] tracking-[.03em] text-faint mt-0.5 truncate">{band.modelId} · {band.providerName}</span>
                </span>
                <span className="shrink-0 flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-accent text-accent-ink"><Check size={12} /> Selected</span>
              </button>
            )}
            {readyRows.length > 0 && sectionHead(<span className="w-1.5 h-1.5 rounded-full bg-ok shrink-0" />, 'Ready to use', summary(connected), false)}
            {readyRows.map((o) => row(o, nav.indexOf(o)))}
            {unconnected.length > 0 && sectionHead(<Lock size={12} className="text-faint shrink-0" />, 'Connect to unlock', summary(unconnected), true)}
            {unconnected.map((o) => row(o, nav.indexOf(o)))}
          </>
        )}
      </div>
    </div>
  )
}
