import { Brain, Eye, Plug, Star, Wrench } from 'lucide-react'
import { IconSearch } from './icons'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { modelsForProvider } from '../lib/catalog'
import { outputsText } from '../lib/modality'
import { FEATURED_ORDER, isBrowserReady } from '../lib/providers'
import type { CatalogModel, CatalogProvider, ModelRef } from '../lib/types'
import { cx, formatContext } from '../lib/utils'
import { useModelPrefs } from '../state/modelPrefs'
import { useProviders } from '../state/providers'
import { useSettings } from '../state/settings'
import { useStore } from '../state/store'
import { ProviderLogo } from './ui'

interface FlatModel {
  ref: ModelRef
  model: CatalogModel
  provider: CatalogProvider
  connected: boolean
  haystack: string
}

const MAX_ROWS = 60

const refKey = (r: ModelRef) => `${r.providerId}/${r.modelId}`

function hasVision(m: CatalogModel) {
  return Boolean(m.modalities?.input?.includes('image') || m.attachment)
}
function isFree(m: CatalogModel, providerId?: string) {
  if (providerId === 'opencode') return m.id.endsWith('-free')
  return m.cost?.input === 0 && (m.cost?.output ?? 0) === 0
}
function priceLabel(m: CatalogModel, providerId?: string): string {
  if (providerId === 'opencode') return m.id.endsWith('-free') ? 'free' : 'paid'
  const c = m.cost
  if (!c || c.input == null) return ''
  if (isFree(m)) return 'free'
  return `$${c.input}/${c.output ?? '?'}`
}
function traitLine(m: CatalogModel): string {
  const t: string[] = []
  if (hasVision(m)) t.push('vision')
  if (m.reasoning) t.push('reasoning')
  if (m.tool_call) t.push('tools')
  return t.join(' · ') || 'chat'
}

function Chip({ active, onClick, tip, children }: { active: boolean; onClick: () => void; tip?: string; children: React.ReactNode }) {
  return (
    <button
      data-tip={tip}
      onClick={onClick}
      className={cx(
        'op-hover-lift flex items-center gap-1 shrink-0 h-7 px-3 rounded-full text-[11.5px] font-semibold border transition-colors',
        active ? 'border-accent bg-accent-soft text-accent' : 'border-line text-muted hover:text-ink hover:bg-bg2',
      )}
    >
      {children}
    </button>
  )
}

export function ModelPickerOverlay() {
  const pickerOpen = useStore((s) => s.pickerOpen)
  const setPickerOpen = useStore((s) => s.setPickerOpen)
  const setSurface = useStore((s) => s.setSurface)
  const openSettings = useStore((s) => s.openSettings)
  const setModel = useStore((s) => s.setModel)
  const activeThreadId = useStore((s) => s.activeThreadId)
  const threads = useStore((s) => s.threads)

  const catalog = useProviders((s) => s.catalog)
  const connections = useProviders((s) => s.connections)
  const showAll = useSettings((s) => s.settings.showAllProviders)
  const defaultModel = useSettings((s) => s.settings.defaultModel)
  const pinned = useModelPrefs((s) => s.pinned)
  const togglePin = useModelPrefs((s) => s.togglePin)
  const recents = useModelPrefs((s) => s.recents)
  const pushRecent = useModelPrefs((s) => s.pushRecent)

  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [sel, setSel] = useState(0)

  const [fFree, setFFree] = useState(false)
  const [fVision, setFVision] = useState(false)
  const [fReasoning, setFReasoning] = useState(false)
  const [fTools, setFTools] = useState(false)
  const [fConnected, setFConnected] = useState(false)

  const pinnedSet = useMemo(() => new Set(pinned.map(refKey)), [pinned])

  const currentRef = useMemo<ModelRef | null>(() => {
    const thread = activeThreadId ? threads.find((t) => t.id === activeThreadId) : null
    return thread?.modelRef ?? defaultModel ?? null
  }, [activeThreadId, threads, defaultModel])

  const index = useMemo(() => {
    if (!catalog) return [] as FlatModel[]
    const connectedIds = new Set(Object.keys(connections))
    const out: FlatModel[] = []
    for (const provider of Object.values(catalog)) {
      if (!(showAll || isBrowserReady(provider) || connectedIds.has(provider.id))) continue
      // The provider's own live list prunes models it no longer serves — see modelsForProvider.
      const modelList = modelsForProvider(provider, connections[provider.id])
      for (const model of modelList) {
        if (!outputsText(model)) continue // chat needs text out — hide image/video/speech generators
        out.push({
          ref: { providerId: provider.id, modelId: model.id },
          model,
          provider,
          connected: connectedIds.has(provider.id),
          haystack: `${provider.name} ${model.name} ${model.id}`.toLowerCase(),
        })
      }
    }
    return out
  }, [catalog, connections, showAll])

  const byRef = useMemo(() => {
    const m = new Map<string, FlatModel>()
    for (const fm of index) m.set(refKey(fm.ref), fm)
    return m
  }, [index])

  const passes = useMemo(() => {
    return (fm: FlatModel) => {
      if (fFree && !isFree(fm.model, fm.provider.id)) return false
      if (fVision && !hasVision(fm.model)) return false
      if (fReasoning && !fm.model.reasoning) return false
      if (fTools && !fm.model.tool_call) return false
      if (fConnected && !fm.connected) return false
      return true
    }
  }, [fFree, fVision, fReasoning, fTools, fConnected])

  const rows = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase()
    const tokens = q.split(/\s+/).filter(Boolean)
    const first = tokens[0]
    const list = index.filter((fm) => (!tokens.length || tokens.every((t) => fm.haystack.includes(t))) && passes(fm))

    if (q) {
      const scored = list.map((fm) => {
        const name = fm.model.name.toLowerCase()
        let score = 0
        if (pinnedSet.has(refKey(fm.ref))) score += 5000
        if (fm.connected) score += 1000
        if (name === q) score += 500
        else if (name.startsWith(first)) score += 300
        else if (name.includes(q)) score += 150
        if (fm.model.id.toLowerCase().startsWith(first)) score += 80
        const fi = FEATURED_ORDER.indexOf(fm.provider.id)
        if (fi >= 0) score += (FEATURED_ORDER.length - fi) * 3
        if (fm.model.release_date) score += Math.min(50, (Date.parse(fm.model.release_date) || 0) / 1e12)
        return { fm, score }
      })
      scored.sort((a, b) => b.score - a.score)
      return scored.map((s) => s.fm).slice(0, MAX_ROWS)
    }

    // No query: lead with pinned, then recents, then featured/newest.
    const seen = new Set<string>()
    const ordered: FlatModel[] = []
    const push = (fm?: FlatModel) => {
      if (!fm) return
      const k = refKey(fm.ref)
      if (seen.has(k)) return
      seen.add(k)
      ordered.push(fm)
    }
    for (const r of pinned) push(byRef.get(refKey(r)))
    for (const r of recents) push(byRef.get(refKey(r)))
    const rest = list
      .filter((fm) => !seen.has(refKey(fm.ref)))
      .sort((a, b) => {
        if (a.connected !== b.connected) return a.connected ? -1 : 1
        const fa = FEATURED_ORDER.indexOf(a.provider.id)
        const fb = FEATURED_ORDER.indexOf(b.provider.id)
        if (fa !== fb) return (fa >= 0 ? fa : 999) - (fb >= 0 ? fb : 999)
        return (b.model.release_date ?? '').localeCompare(a.model.release_date ?? '')
      })
    for (const fm of rest) push(fm)
    return ordered.slice(0, MAX_ROWS)
  }, [deferredQuery, index, passes, pinnedSet, pinned, recents, byRef])

  useEffect(() => {
    if (pickerOpen) {
      setQuery('')
      setSel(0)
      setFFree(false); setFVision(false); setFReasoning(false); setFTools(false); setFConnected(false)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [pickerOpen])

  useEffect(() => {
    setSel((s) => (rows.length ? Math.min(s, rows.length - 1) : 0))
  }, [rows.length])
  useEffect(() => {
    setSel(0)
  }, [deferredQuery, fFree, fVision, fReasoning, fTools, fConnected])
  useEffect(() => {
    listRef.current?.querySelector(`[data-sel="${sel}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  if (!pickerOpen) return null

  const pick = (ref: ModelRef) => {
    pushRecent(ref)
    setModel(ref)
    setPickerOpen(false)
  }
  const clearFilters = () => {
    setQuery('')
    setFFree(false); setFVision(false); setFReasoning(false); setFTools(false); setFConnected(false)
  }
  const openBrowser = () => {
    setPickerOpen(false)
    setSurface('models')
  }
  const connect = () => {
    setPickerOpen(false)
    openSettings('providers')
  }

  return createPortal(
    <div
      onClick={() => setPickerOpen(false)}
      className="op-fadeup fixed inset-0 z-[55] flex items-start justify-center px-4 pt-[10vh] pb-4"
      style={{ background: 'oklch(0.1 0.01 70 / 0.55)', backdropFilter: 'blur(3px)' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="op-scalein w-full max-w-[560px] max-h-[76vh] flex flex-col rounded-2xl border border-line bg-bg1 overflow-hidden"
        style={{ boxShadow: 'var(--shadow)' }}
      >
        {/* Heading + search */}
        <div className="shrink-0 px-4 pt-2">
          <div className="text-[10px] tracking-[.2em] font-semibold text-faint px-0.5 pt-2 pb-2.5">CHOOSE AN INSTRUMENT</div>
          <div className="flex items-center gap-3 pb-3 border-b border-line">
            <IconSearch size={17} className="text-faint shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search 5,000+ models &amp; 146 providers…"
              className="flex-1 bg-transparent outline-none text-[16px] min-w-0"
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setSel((s) => Math.min(s + 1, rows.length - 1))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setSel((s) => Math.max(s - 1, 0))
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  if (rows[sel]) pick(rows[sel].ref)
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setPickerOpen(false)
                }
              }}
            />
            <span className="font-mono text-[10px] text-faint px-1.5 py-0.5 rounded bg-bg3 shrink-0">ESC</span>
          </div>
        </div>

        {/* Filter chips */}
        <div className="shrink-0 flex gap-1.5 overflow-x-auto no-scrollbar px-4 py-3 border-b border-line">
          <Chip active={fFree} onClick={() => setFFree(!fFree)} tip="Free models only">Free</Chip>
          <Chip active={fVision} onClick={() => setFVision(!fVision)} tip="Vision">
            <Eye size={11} /> Vision
          </Chip>
          <Chip active={fReasoning} onClick={() => setFReasoning(!fReasoning)} tip="Reasoning">
            <Brain size={11} /> Reasoning
          </Chip>
          <Chip active={fTools} onClick={() => setFTools(!fTools)} tip="Tool calling">
            <Wrench size={11} /> Tools
          </Chip>
          <Chip active={fConnected} onClick={() => setFConnected(!fConnected)} tip="Connected only">
            <Plug size={11} /> Connected
          </Chip>
        </div>

        {/* Rows */}
        <div ref={listRef} className="flex-1 overflow-y-auto min-h-[140px]">
          {rows.length === 0 ? (
            <div className="text-center py-12 px-5 text-faint">
              <div className="font-serif text-[18px] text-ink mb-1.5">No instruments match</div>
              <p className="text-[13px] mb-4">
                Try another search, widen the filter, or{' '}
                <button onClick={connect} className="text-accent hover:underline">connect a provider</button>.
              </p>
              <button onClick={clearFilters} className="op-hover-lift h-8 px-4 rounded-lg border border-line text-[12.5px] text-ink hover:bg-bg2">
                Show all models
              </button>
            </div>
          ) : (
            rows.map((fm, i) => {
              const isCurrent = currentRef?.providerId === fm.ref.providerId && currentRef?.modelId === fm.ref.modelId
              const isPinned = pinnedSet.has(refKey(fm.ref))
              const label = priceLabel(fm.model, fm.provider.id)
              const ctx = fm.model.limit?.context
              return (
                <div
                  key={refKey(fm.ref)}
                  data-sel={i}
                  onMouseMove={() => setSel(i)}
                  onClick={() => pick(fm.ref)}
                  className={cx(
                    'group/row relative w-full flex items-center gap-3 px-4 py-3 text-left border-b border-line cursor-pointer transition-colors',
                    i === sel ? 'bg-bg2' : 'hover:bg-bg2',
                  )}
                >
                  {isCurrent && <span className="absolute left-0 top-2 bottom-2 w-0.5 bg-accent" />}
                  <span className="shrink-0 font-mono text-[11px] text-faint w-3 text-center">{i + 1}</span>
                  <ProviderLogo id={fm.provider.id} name={fm.provider.name} size={32} />
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="font-serif text-[15.5px] text-ink truncate min-w-0">{fm.model.name}</span>
                      {fm.connected && <span data-tip="Connected" className="shrink-0 w-1.5 h-1.5 rounded-full bg-ok" />}
                    </span>
                    <span className="block font-mono text-[10px] tracking-[.05em] text-faint mt-0.5 truncate">
                      {fm.provider.name} · {traitLine(fm.model)}
                    </span>
                  </span>
                  <span className="shrink-0 text-right font-mono">
                    <span className="block text-[11px] text-muted">{ctx ? formatContext(ctx) : '—'}</span>
                    <span className="block text-[10.5px] text-faint mt-0.5">{label === 'free' ? 'free' : label || ''}</span>
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      togglePin(fm.ref)
                    }}
                    data-tip={isPinned ? 'Unfavorite' : 'Favorite'}
                    className={cx(
                      'shrink-0 p-1 rounded-md transition-all',
                      isPinned ? 'text-accent' : 'text-faint opacity-0 group-hover/row:opacity-100 hover:text-ink',
                    )}
                  >
                    <Star size={15} fill={isPinned ? 'currentColor' : 'none'} />
                  </button>
                </div>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between px-4 py-3 bg-bg2 border-t border-line">
          <span className="font-mono text-[10px] tracking-[.08em] text-faint">{rows.length} SHOWN · 5,000+ TOTAL</span>
          <button onClick={openBrowser} className="op-hover-lift text-[11px] tracking-[.12em] font-semibold text-accent">
            FULL BROWSER →
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
