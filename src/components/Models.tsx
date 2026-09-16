import { Brain, Eye, Plug, Star, Wrench } from 'lucide-react'
import { IconRegenerate, IconSearch } from './icons'
import { useDeferredValue, useMemo, useState } from 'react'
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

type SortKey = 'relevance' | 'new' | 'cheap' | 'context'

const WINDOW_STEP = 60

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

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'relevance', label: 'Relevance' },
  { key: 'new', label: 'Newest' },
  { key: 'cheap', label: 'Cheapest' },
  { key: 'context', label: 'Context' },
]

function Chip({ active, onClick, tip, children }: { active: boolean; onClick: () => void; tip?: string; children: React.ReactNode }) {
  return (
    <button
      data-tip={tip}
      onClick={onClick}
      className={cx(
        'op-hover-lift flex items-center gap-1.5 h-8 px-3.5 rounded-full text-[12.5px] font-medium border shrink-0 transition-colors',
        active ? 'border-accent bg-accent-soft text-accent' : 'border-line text-muted hover:text-ink hover:bg-bg2',
      )}
    >
      {children}
    </button>
  )
}

function Cap({ children }: { children: React.ReactNode }) {
  return <span className="text-[9.5px] px-2 py-[3px] rounded-md bg-bg3 text-muted">{children}</span>
}

export function Models() {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [sort, setSort] = useState<SortKey>('relevance')
  const [visibleCount, setVisibleCount] = useState(WINDOW_STEP)

  const [fFree, setFFree] = useState(false)
  const [fVision, setFVision] = useState(false)
  const [fReasoning, setFReasoning] = useState(false)
  const [fTools, setFTools] = useState(false)
  const [fConnected, setFConnected] = useState(false)
  const [fProvider, setFProvider] = useState('')

  const catalog = useProviders((s) => s.catalog)
  const catalogStatus = useProviders((s) => s.catalogStatus)
  const connections = useProviders((s) => s.connections)
  const loadCatalog = useProviders((s) => s.loadCatalog)
  const showAll = useSettings((s) => s.settings.showAllProviders)
  const defaultModel = useSettings((s) => s.settings.defaultModel)
  const activeThreadId = useStore((s) => s.activeThreadId)
  const threads = useStore((s) => s.threads)
  const setModel = useStore((s) => s.setModel)
  const setSurface = useStore((s) => s.setSurface)
  const pinned = useModelPrefs((s) => s.pinned)
  const togglePin = useModelPrefs((s) => s.togglePin)

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

  const providerOptions = useMemo(() => {
    const seen = new Map<string, CatalogProvider>()
    for (const fm of index) if (!seen.has(fm.provider.id)) seen.set(fm.provider.id, fm.provider)
    return [...seen.values()].sort((a, b) => {
      const fa = FEATURED_ORDER.indexOf(a.id)
      const fb = FEATURED_ORDER.indexOf(b.id)
      return (fa >= 0 ? fa : 999) - (fb >= 0 ? fb : 999) || a.name.localeCompare(b.name)
    })
  }, [index])

  const passes = useMemo(() => {
    return (fm: FlatModel) => {
      if (fVision && !hasVision(fm.model)) return false
      if (fReasoning && !fm.model.reasoning) return false
      if (fTools && !fm.model.tool_call) return false
      if (fFree && !isFree(fm.model, fm.provider.id)) return false
      if (fConnected && !fm.connected) return false
      if (fProvider && fm.provider.id !== fProvider) return false
      return true
    }
  }, [fVision, fReasoning, fTools, fFree, fConnected, fProvider])

  const sortCmp = useMemo(() => {
    const key: SortKey = sort === 'relevance' ? 'new' : sort
    return (a: FlatModel, b: FlatModel) => {
      const pa = pinnedSet.has(refKey(a.ref)) ? 1 : 0
      const pb = pinnedSet.has(refKey(b.ref)) ? 1 : 0
      if (pa !== pb) return pb - pa
      if (key === 'cheap') return (a.model.cost?.input ?? 1e9) - (b.model.cost?.input ?? 1e9)
      if (key === 'context') return (b.model.limit?.context ?? 0) - (a.model.limit?.context ?? 0)
      return (b.model.release_date ?? '').localeCompare(a.model.release_date ?? '')
    }
  }, [sort, pinnedSet])

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase()
    const tokens = q.split(/\s+/).filter(Boolean)
    const first = tokens[0]
    let list = index.filter((fm) => (!tokens.length || tokens.every((t) => fm.haystack.includes(t))) && passes(fm))

    if (q && sort === 'relevance') {
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
      list = scored.map((s) => s.fm)
    } else {
      list = [...list].sort(sortCmp)
    }
    return list
  }, [deferredQuery, index, passes, sort, sortCmp, pinnedSet])

  const clearFilters = () => {
    setQuery('')
    setFFree(false); setFVision(false); setFReasoning(false); setFTools(false); setFConnected(false); setFProvider('')
    setSort('relevance')
  }
  const use = (ref: ModelRef) => {
    setModel(ref)
    setSurface('stage')
  }

  const visible = filtered.slice(0, visibleCount)
  const remaining = filtered.length - visible.length
  const loading = catalogStatus === 'loading' && !catalog

  return (
    <div className="op-fadeup h-full overflow-y-auto bg-bg0">
      <div className="mx-auto w-full max-w-[1080px] px-6 pt-8 pb-16">
        {/* Title */}
        <div className="flex items-end justify-between gap-4 flex-wrap mb-5">
          <div>
            <h1 className="font-serif text-3xl leading-tight">Models</h1>
            <p className="text-[13.5px] text-faint mt-1">
              5,000+ models · 146 providers · showing <span className="font-mono text-muted">{filtered.length}</span> of{' '}
              <span className="font-mono text-muted">{index.length}</span> reachable
            </p>
          </div>
          <button
            onClick={() => void loadCatalog(true)}
            data-tip="Reload the models.dev catalog"
            className="op-hover-lift flex items-center gap-2 h-9 px-3.5 rounded-xl border border-line text-[13px] text-muted hover:bg-bg2"
          >
            <IconRegenerate size={14} className={cx(catalogStatus === 'loading' && 'animate-spin')} /> Refresh
          </button>
        </div>

        {/* Search + sort */}
        <div className="flex items-center gap-3 flex-wrap mb-4">
          <div className="relative flex-1 min-w-[200px]">
            <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search models &amp; providers…"
              className="w-full h-[38px] rounded-xl border border-line-strong bg-bg1 pl-10 pr-3 text-[14px] outline-none focus:border-accent transition-colors"
            />
          </div>
          <div className="flex items-center gap-1.5 text-[12.5px]">
            <span className="text-faint mr-1">Sort</span>
            {SORTS.map((s) => (
              <button
                key={s.key}
                onClick={() => setSort(s.key)}
                className={cx('op-hover-lift h-[30px] px-2.5 rounded-lg font-medium transition-colors', sort === s.key ? 'text-accent' : 'text-muted hover:text-ink')}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Filter chips */}
        <div className="flex gap-2 flex-wrap mb-6">
          <Chip active={fFree} onClick={() => setFFree(!fFree)} tip="Free models only">Free</Chip>
          <Chip active={fVision} onClick={() => setFVision(!fVision)} tip="Vision (image input)">
            <Eye size={12} /> Vision
          </Chip>
          <Chip active={fReasoning} onClick={() => setFReasoning(!fReasoning)} tip="Reasoning models">
            <Brain size={12} /> Reasoning
          </Chip>
          <Chip active={fTools} onClick={() => setFTools(!fTools)} tip="Tool calling">
            <Wrench size={12} /> Tools
          </Chip>
          <Chip active={fConnected} onClick={() => setFConnected(!fConnected)} tip="Connected providers only">
            <Plug size={12} /> Connected
          </Chip>
          <select
            value={fProvider}
            onChange={(e) => setFProvider(e.target.value)}
            data-tip="Filter by provider"
            className="h-8 px-3 rounded-full text-[12.5px] bg-bg1 border border-line text-muted outline-none focus:border-accent max-w-[150px]"
          >
            <option value="">All providers</option>
            {providerOptions.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        {/* Loading skeletons */}
        {loading && (
          <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="op-pulse rounded-2xl border border-line bg-bg1 p-[17px] h-[150px]">
                <div className="w-[38px] h-[38px] rounded-xl bg-bg3 mb-3.5" />
                <div className="w-3/5 h-3 rounded bg-bg3 mb-2.5" />
                <div className="w-2/5 h-2.5 rounded bg-bg3" />
              </div>
            ))}
          </div>
        )}

        {/* Empty */}
        {!loading && filtered.length === 0 && (
          <div className="text-center py-[70px] text-faint">
            <div className="w-12 h-12 rounded-xl border border-line flex items-center justify-center mx-auto mb-4">
              <IconSearch size={22} className="text-faint" />
            </div>
            <div className="font-serif text-[19px] text-ink mb-1.5">No models match</div>
            <p className="text-[13.5px] mb-4">Try a different search or clear the filters.</p>
            <button onClick={clearFilters} className="op-hover-lift h-[34px] px-4 rounded-lg border border-line text-[13px] text-ink hover:bg-bg2">
              Clear filters
            </button>
          </div>
        )}

        {/* Grid */}
        {!loading && filtered.length > 0 && (
          <>
            <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
              {visible.map((fm) => {
                const isCurrent = currentRef?.providerId === fm.ref.providerId && currentRef?.modelId === fm.ref.modelId
                const isPinned = pinnedSet.has(refKey(fm.ref))
                const label = priceLabel(fm.model, fm.provider.id)
                const ctx = fm.model.limit?.context
                return (
                  <div key={refKey(fm.ref)} className="op-hover-lift flex flex-col rounded-2xl border border-line bg-bg1 p-4 hover:border-line-strong">
                    <div className="flex items-start gap-3 mb-3">
                      <ProviderLogo id={fm.provider.id} name={fm.provider.name} size={38} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-serif text-[15px] leading-tight truncate min-w-0">{fm.model.name}</span>
                          {fm.connected && <span data-tip="Connected" className="shrink-0 w-1.5 h-1.5 rounded-full bg-ok" />}
                        </div>
                        <div className="text-[11.5px] text-faint font-mono mt-0.5 truncate">{fm.provider.name}</div>
                      </div>
                      <button
                        onClick={() => togglePin(fm.ref)}
                        data-tip={isPinned ? 'Unfavorite' : 'Favorite'}
                        className={cx('op-hover-lift shrink-0 p-0.5', isPinned ? 'text-accent' : 'text-faint hover:text-ink')}
                      >
                        <Star size={17} fill={isPinned ? 'currentColor' : 'none'} />
                      </button>
                    </div>
                    <div className="flex gap-1.5 flex-wrap mb-3.5 min-h-[22px]">
                      {hasVision(fm.model) && <Cap>Vision</Cap>}
                      {fm.model.reasoning && <Cap>Reasoning</Cap>}
                      {fm.model.tool_call && <Cap>Tools</Cap>}
                      {isFree(fm.model, fm.provider.id) && (
                        <span className="text-[9.5px] px-2 py-[3px] rounded-md bg-accent-soft text-ok font-semibold">Free</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between mt-auto pt-3 border-t border-line">
                      <div className="font-mono text-[11px] text-faint">
                        <div>{ctx ? `${formatContext(ctx)} ctx` : '—'}</div>
                        {label && label !== 'free' && <div className="mt-0.5 text-muted">{label === 'paid' ? 'paid' : label}</div>}
                      </div>
                      <button
                        onClick={() => use(fm.ref)}
                        className={cx(
                          'op-hover-lift h-8 px-4 rounded-lg text-[12.5px] font-semibold transition-colors',
                          isCurrent ? 'bg-bg3 text-muted' : 'bg-accent text-accent-ink hover:bg-accent-hover',
                        )}
                      >
                        {isCurrent ? 'In use' : 'Use'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Load more / total affordance */}
            <div className="mt-[18px] flex items-center gap-3.5">
              <span className="flex-1 h-px bg-line" />
              {remaining > 0 ? (
                <button
                  onClick={() => setVisibleCount((c) => c + WINDOW_STEP)}
                  className="op-hover-lift text-[11px] tracking-[.14em] font-semibold text-muted hover:text-ink uppercase"
                >
                  Load more · {remaining} of 5,000+ →
                </button>
              ) : (
                <span className="text-[11px] tracking-[.14em] font-semibold text-faint uppercase">End · 5,000+ total</span>
              )}
              <span className="flex-1 h-px bg-line" />
            </div>
            <div className="mt-3 text-[11px] text-faint font-mono text-center">$ / 1M TOKENS — IN / OUT · PRICES ILLUSTRATIVE</div>
          </>
        )}

        {catalogStatus === 'error' && !loading && (
          <div className="mt-6 text-center text-[13px] text-muted">
            Couldn't load the models.dev catalog.{' '}
            <button className="text-accent underline" onClick={() => void loadCatalog(true)}>
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
