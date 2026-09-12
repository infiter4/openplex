import { ArrowDown, FileText, Globe, KeyRound, Search, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { modelDisplayName } from '../../lib/catalog'
import type { Message } from '../../lib/types'
import { useProviders } from '../../state/providers'
import { useSettings } from '../../state/settings'
import { useStore, visibleMessages, visibleThreads } from '../../state/store'
import { MessageView } from '../MessageView'
import { Composer } from './Composer'
import { ReasoningDial } from './ReasoningDial'
import { useReasoning } from './useReasoning'

const SUGGESTIONS = [
  { label: 'Explain RAG like I’m a programmer', web: false },
  { label: 'What shipped in AI this week?', web: true },
  { label: 'Compare Postgres and SQLite for a side project', web: true },
  { label: 'Draft a crisp cold email to a recruiter', web: false },
]

function ThinkingInline() {
  const streaming = useStore((s) => s.streaming)
  const threads = useStore((s) => s.threads)
  const catalog = useProviders((s) => s.catalog)
  const defaultModel = useSettings((s) => s.settings.defaultModel)
  if (!streaming || streaming.phase === 'streaming') return null
  const thread = threads.find((t) => t.id === streaming.threadId)
  const name = modelDisplayName(catalog, thread?.modelRef ?? defaultModel)

  if (streaming.phase === 'searching') {
    const steps = streaming.steps ?? []
    return (
      <div className="rounded-2xl border border-line bg-bg1 p-5 anim-fade">
        <div className="flex items-center gap-2.5 mb-3">
          <span className="w-2.5 h-2.5 rounded-full bg-accent op-pulse" />
          <span className="op-think-text text-[14px] font-medium">{steps.length ? 'Researching…' : 'Searching the web…'}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          {steps.map((s, i) => (
            <div key={i} className="flex items-start gap-2.5 text-[12.5px] anim-fade">
              {s.kind === 'think' ? (
                <><Sparkles size={12} className="text-accent/70 shrink-0 mt-0.5" /><span className="text-faint italic leading-snug">{s.label}</span></>
              ) : s.kind === 'sources' ? (
                <><Globe size={12} className="text-accent/70 shrink-0 mt-0.5" /><span className="text-muted">Trusted: <span className="text-ink">{s.label}</span></span></>
              ) : s.kind === 'read' ? (
                <><FileText size={12} className="text-accent/70 shrink-0 mt-0.5" /><span className="text-muted truncate">Read {s.label}</span></>
              ) : (
                <><Search size={12} className="text-accent/70 shrink-0 mt-0.5" /><span className="text-muted truncate">Searched “{s.label}”</span></>
              )}
            </div>
          ))}
        </div>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2.5 anim-fade">
      <span className="thinking-dots"><span /><span /><span /></span>
      <span className="op-think-text text-[13.5px] font-medium">{name} is thinking…</span>
    </div>
  )
}

function Home() {
  const send = useStore((s) => s.send)
  const setWebSearch = useStore((s) => s.setWebSearch)
  const selectThread = useStore((s) => s.selectThread)
  const openSettings = useStore((s) => s.openSettings)
  const threads = useStore((s) => s.threads)
  const catalog = useProviders((s) => s.catalog)
  const connections = useProviders((s) => s.connections)
  const hasProvider = Object.keys(connections).length > 0
  const dial = useReasoning()

  const now = new Date()
  const today = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()
  const time = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const recent = useMemo(() => visibleThreads(threads).slice(0, 6), [threads])

  return (
    <div className="op-fadeup w-full max-w-[880px] mx-auto px-4 sm:px-7 py-6 sm:py-8 pb-20 min-h-full flex flex-col">
      <div className="flex items-center justify-between font-mono text-[11px] tracking-[.16em] text-faint pb-3.5 border-b border-line">
        <span>{today}</span>
        <span>{time} · OPENPLEX</span>
      </div>

      {!hasProvider && (
        <div className="mt-5 inline-flex items-center gap-2.5 self-start px-3 py-1.5 rounded-full border border-line bg-bg1 text-[12.5px] text-muted">
          <span className="w-1.5 h-1.5 rounded-full bg-warn" />
          No providers connected —{' '}
          <button onClick={() => openSettings('providers')} className="text-accent font-medium underline underline-offset-2 inline-flex items-center gap-1">
            <KeyRound size={11} /> connect a key
          </button>
        </div>
      )}

      <div className="mt-10 flex items-start justify-between gap-6">
        <div className="text-[11px] tracking-[.22em] font-semibold text-accent pt-2">BEGIN A THREAD</div>
        {dial.show && (
          <div className="hidden md:block shrink-0 -mt-1">
            <ReasoningDial
              stops={dial.stops}
              value={dial.value}
              onChange={dial.onChange}
              modelInitial={dial.modelInitial}
              modelColor={dial.modelColor}
            />
          </div>
        )}
      </div>
      <div className="mt-3">
        <Composer centered />
      </div>

      <div className="mt-6 flex items-baseline gap-x-3.5 gap-y-2 flex-wrap">
        <span className="text-[10px] tracking-[.16em] text-faint font-semibold">TRY</span>
        {SUGGESTIONS.map((s, i) => (
          <button
            key={s.label}
            onClick={() => { setWebSearch(s.web); void send(s.label) }}
            disabled={!hasProvider}
            className={`op-hover-lift font-serif italic text-[13px] sm:text-[15px] text-muted hover:text-accent border-b border-dotted border-line disabled:opacity-40${i >= 2 ? ' hidden sm:inline-block' : ''}`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {recent.length > 0 && (
        <div className="mt-auto pt-14">
          <div className="flex items-center gap-3.5 mb-1">
            <span className="text-[10px] tracking-[.2em] text-accent font-semibold">INDEX</span>
            <span className="flex-1 h-px bg-line" />
            <span className="text-[10px] tracking-[.16em] text-faint font-semibold">RECENT THINKING</span>
          </div>
          {recent.map((t, i) => (
            <button
              key={t.id}
              onClick={() => void selectThread(t.id)}
              className="op-hover-lift w-full flex items-baseline gap-4 py-3.5 px-1 border-b border-line text-left hover:bg-bg1"
            >
              <span className="font-mono text-[11px] text-accent w-6 shrink-0">{String(i + 1).padStart(2, '0')}</span>
              <span className="flex-1 min-w-0 font-serif text-[17px] truncate">{t.title}</span>
              <span className="hidden sm:block font-mono text-[10px] text-faint truncate max-w-[160px]">{modelDisplayName(catalog, t.modelRef)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Transcript() {
  const activeThreadId = useStore((s) => s.activeThreadId)!
  const threadMessages = useStore((s) => s.messages[activeThreadId])
  const streamingId = useStore((s) => s.streaming?.messageId ?? null)
  const catalog = useProviders((s) => s.catalog)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [stick, setStick] = useState(true)
  const list: Message[] = useMemo(() => visibleMessages(threadMessages), [threadMessages])

  useEffect(() => {
    if (!stick) return
    const el = scrollRef.current
    if (!el) return
    const id = requestAnimationFrame(() => { el.scrollTop = el.scrollHeight })
    return () => cancelAnimationFrame(id)
  }, [list, stick, streamingId])
  useEffect(() => {
    setStick(true)
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [activeThreadId])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 90)
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 relative">
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[760px] px-4 sm:px-6 py-6 sm:py-8 flex flex-col gap-5 sm:gap-7">
          {list.map((m) => (
            <MessageView key={m.id} message={m} catalog={catalog} />
          ))}
          <ThinkingInline />
          <div className="h-2" />
        </div>
      </div>

      {!stick && (
        <button
          onClick={() => { setStick(true); scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }) }}
          className="absolute bottom-[104px] left-1/2 -translate-x-1/2 p-2 rounded-full border border-line-strong bg-bg2 text-muted hover:text-ink hover:bg-bg3 transition-all anim-rise z-10"
          style={{ boxShadow: 'var(--shadow)' }}
          aria-label="Scroll to bottom"
        >
          <ArrowDown size={15} />
        </button>
      )}

      <div className="shrink-0 px-4 sm:px-6 pb-safe pt-2">
        <div className="mx-auto max-w-[760px]">
          <Composer />
        </div>
      </div>
    </div>
  )
}

export function Stage() {
  const activeThreadId = useStore((s) => s.activeThreadId)
  if (!activeThreadId) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto relative">
        <Home />
      </div>
    )
  }
  return <Transcript />
}
