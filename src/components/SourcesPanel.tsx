import { ExternalLink, X } from 'lucide-react'
import { useMemo } from 'react'
import { faviconFor, hostOf, safeHref } from '../lib/utils'
import { useStore } from '../state/store'

export function SourcesPanel() {
  const sourcesFor = useStore((s) => s.sourcesFor)
  const setSourcesFor = useStore((s) => s.setSourcesFor)
  const messages = useStore((s) => s.messages)
  const activeThreadId = useStore((s) => s.activeThreadId)

  const sources = useMemo(() => {
    if (!sourcesFor || !activeThreadId) return null
    return (messages[activeThreadId] ?? []).find((m) => m.id === sourcesFor)?.sources ?? null
  }, [sourcesFor, activeThreadId, messages])

  const favicons = useMemo(() => (sources ?? []).map((s) => faviconFor(s.url)), [sources])

  if (!sources?.length) return null

  return (
    <aside className="w-[320px] shrink-0 h-full border-l border-line bg-bg1 flex flex-col anim-fade max-md:fixed max-md:right-0 max-md:top-0 max-md:bottom-0 max-md:z-40 max-md:shadow-2xl max-md:w-[88vw] max-md:max-w-[340px] pt-safe">
      <div className="flex items-center justify-between px-4 h-12 border-b border-line shrink-0">
        <span className="text-[13.5px] font-semibold">{sources.length} sources</span>
        <button
          onClick={() => setSourcesFor(null)}
          className="p-1.5 rounded-lg text-muted hover:text-ink hover:bg-bg2 transition-colors"
          aria-label="Close sources"
        >
          <X size={15} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {sources.map((s, i) => (
          <a
            key={i}
            id={`source-${i + 1}`}
            href={safeHref(s.url)}
            target="_blank"
            rel="noreferrer"
            className="block rounded-xl border border-line bg-bg0/50 hover:bg-bg2 hover:border-line-strong transition-all p-3 group"
          >
            <div className="flex items-center gap-2 mb-1.5">
              <span className="cite-chip shrink-0">{i + 1}</span>
              <img src={favicons[i]} alt="" className="w-4 h-4 rounded-sm shrink-0" loading="lazy" />
              <span className="text-[11.5px] text-faint truncate">{hostOf(s.url)}</span>
              <ExternalLink size={11} className="ml-auto shrink-0 text-faint opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <div className="text-[13px] font-medium leading-snug mb-1 line-clamp-2">{s.title}</div>
            {s.snippet && <div className="text-[12px] text-muted leading-relaxed line-clamp-3">{s.snippet}</div>}
          </a>
        ))}
      </div>
    </aside>
  )
}
