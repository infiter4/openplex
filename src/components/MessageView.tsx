import { AlertCircle, Check, ChevronDown, ChevronLeft, ChevronRight, FileText, Globe, Image as ImageIcon, Loader2, Search, Sparkles, Terminal, X } from 'lucide-react'
import { IconBookmark, IconCopy, IconEdit, IconRegenerate } from './icons'
import { memo, useEffect, useMemo, useState } from 'react'
import { modelDisplayName } from '../lib/catalog'
import type { AgentFile, Catalog, Message, SearchStep, ToolStep } from '../lib/types'
import { copyText, cx, faviconFor, formatCost, formatTokens } from '../lib/utils'
import { downloadAgentFile } from '../lib/agentBackend'
import { isImageFileMeta } from './FileViewer'
import { useStore } from '../state/store'
import { Markdown } from './Markdown'
import { CompareButton } from './stage/Compare'

function FileChip({ file }: { file: AgentFile }) {
  const openFile = useStore((s) => s.openFile)
  const isImg = isImageFileMeta(file)
  const [thumb, setThumb] = useState<string | null>(
    isImg && file.b64 ? `data:${file.mime || 'image/png'};base64,${file.b64}` : null,
  )
  useEffect(() => {
    if (thumb || !isImg || file.b64) return
    let cancelled = false
    let url: string | null = null
    void downloadAgentFile(file).then((b) => {
      if (cancelled || !b) return
      url = URL.createObjectURL(b)
      setThumb(url)
    })
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url) }
  }, [file, isImg, thumb])

  if (isImg) {
    return (
      <button
        onClick={() => openFile(file)}
        data-tip={file.name}
        className="block rounded-lg overflow-hidden border border-line hover:border-accent transition-colors"
      >
        {thumb ? (
          <img src={thumb} alt={file.name} className="h-24 w-auto max-w-[220px] object-cover" />
        ) : (
          <span className="flex items-center justify-center h-24 w-24 text-faint"><ImageIcon size={18} /></span>
        )}
      </button>
    )
  }
  return (
    <button
      onClick={() => openFile(file)}
      data-tip="View / download"
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-line hover:border-accent text-[11.5px]"
    >
      <FileText size={12} /> {file.name}
    </button>
  )
}

function ToolTrace({ steps }: { steps?: ToolStep[] }) {
  // collapsed by default so a multi-step computer-use reply stays compact; the command
  // title + any download chips are always visible, expand to see the code/output.
  const [open, setOpen] = useState(false)
  if (!steps?.length) return null
  const running = steps.some((s) => s.status === 'running')
  const errored = steps.some((s) => s.status === 'error')
  const files = steps.flatMap((s) => s.files ?? [])
  const heading = running
    ? 'Working on your computer…'
    : steps.length === 1
      ? steps[0].title
      : `Ran ${steps.length} steps on your computer`
  return (
    <div className="my-2 rounded-lg border border-line bg-bg0/40 text-[12.5px]">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 w-full px-2.5 py-1.5 text-left">
        <Terminal size={12} className={cx('shrink-0', errored ? 'text-danger' : 'text-accent')} />
        <span className="font-mono text-[11.5px] truncate min-w-0">{heading}</span>
        {running && <Loader2 size={12} className="animate-spin text-faint shrink-0" />}
        {open ? <ChevronDown size={12} className="ml-auto shrink-0 text-faint" /> : <ChevronRight size={12} className="ml-auto shrink-0 text-faint" />}
      </button>
      {open && (
        <div className="px-2.5 pb-2 space-y-2">
          {steps.map((s) => (
            <div key={s.id}>
              {steps.length > 1 && (
                <div className="flex items-center gap-2 font-mono text-[11.5px]">
                  <span className={cx('shrink-0', s.status === 'error' ? 'text-danger' : s.status === 'done' ? 'text-accent' : 'text-faint')}>
                    {s.status === 'running' ? '…' : s.status === 'error' ? '✗' : '✓'}
                  </span>
                  <span className="truncate">{s.title}</span>
                </div>
              )}
              {s.detail && (
                <pre className="mt-1 max-h-44 overflow-auto rounded border border-line bg-bg0/60 p-2 text-[11px] whitespace-pre-wrap text-muted">{s.detail}</pre>
              )}
              {s.output && (
                <pre className="mt-1 max-h-40 overflow-auto rounded border border-line bg-bg0/80 p-2 text-[11px] whitespace-pre-wrap">{s.output}</pre>
              )}
            </div>
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 px-2.5 pb-2 pt-0.5">
          {files.map((f, i) => <FileChip key={`${f.bucketKey ?? f.name}:${i}`} file={f} />)}
        </div>
      )}
    </div>
  )
}

function SourcesRow({ message }: { message: Message }) {
  const setSourcesFor = useStore((s) => s.setSourcesFor)
  const sources = message.sources ?? []
  if (!sources.length) return null
  return (
    <button
      onClick={() => setSourcesFor(message.id)}
      className="flex items-center gap-2 mb-3 px-2.5 py-1.5 rounded-lg border border-line bg-bg1 hover:bg-bg2 hover:border-line-strong transition-colors group"
    >
      <Globe size={12} className="text-accent" />
      <span className="flex -space-x-1.5">
        {sources.slice(0, 5).map((s, i) => (
          <img
            key={i}
            src={faviconFor(s.url)}
            alt=""
            className="w-[16px] h-[16px] rounded-full border border-line-strong bg-bg2"
            loading="lazy"
          />
        ))}
      </span>
      <span className="text-[12px] text-muted group-hover:text-ink transition-colors">
        {sources.length} source{sources.length > 1 ? 's' : ''}
      </span>
    </button>
  )
}

function ResearchTrace({ steps }: { steps?: SearchStep[] }) {
  const [open, setOpen] = useState(false)
  if (!steps?.length) return null
  const searches = steps.filter((s) => s.kind === 'search').length
  const reads = steps.filter((s) => s.kind === 'read').length
  const thoughts = steps.filter((s) => s.kind === 'think').length
  return (
    <div className="mb-2.5">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-[11.5px] text-faint hover:text-muted transition-colors"
      >
        <Sparkles size={11} className="text-accent/70" />
        <span>
          Researched · {searches} search{searches === 1 ? '' : 'es'}
          {reads ? ` · ${reads} page${reads === 1 ? '' : 's'} read` : ''}
          {thoughts ? ' · reasoning' : ''}
        </span>
        <ChevronRight size={11} className={cx('transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <div className="mt-1.5 ml-[5px] pl-3 border-l border-line space-y-1.5">
          {steps.map((s, i) => {
            if (s.kind === 'think') {
              return (
                <div key={i} className="flex items-start gap-2 text-[12px] text-faint italic">
                  <Sparkles size={12} className="text-accent/60 shrink-0 mt-0.5" />
                  <span className="whitespace-pre-wrap leading-relaxed">{s.label}</span>
                </div>
              )
            }
            if (s.kind === 'sources') {
              return (
                <div key={i} className="flex items-start gap-2 text-[12px] text-muted">
                  <Globe size={12} className="text-accent/60 shrink-0 mt-0.5" />
                  <span>
                    Trusted sources: <span className="text-ink">{s.label}</span>
                  </span>
                </div>
              )
            }
            return (
              <div key={i} className="flex items-center gap-2 text-[12px] text-muted">
                {s.kind === 'read' ? (
                  <FileText size={12} className="text-accent/70 shrink-0" />
                ) : (
                  <Search size={12} className="text-accent/70 shrink-0" />
                )}
                <span className="truncate">{s.kind === 'read' ? `Read ${s.label}` : `Searched “${s.label}”`}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Reasoning({ message, reasoning, content }: { message: Message; reasoning?: string; content: string }) {
  const isLive = useStore((s) => s.streaming?.messageId === message.id)
  const [open, setOpen] = useState(false)
  if (!reasoning) return null
  const expanded = open || (isLive && !content)
  return (
    <div className="mb-3">
      <button
        onClick={() => setOpen(!expanded)}
        className="flex items-center gap-1.5 text-[12px] text-muted hover:text-ink transition-colors"
      >
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {isLive && !content ? <span className="shimmer-text font-medium">Reasoning…</span> : 'Reasoning'}
      </button>
      {expanded && (
        <div className="mt-2 pl-3 border-l-2 border-line text-[13px] text-muted whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto">
          {reasoning}
        </div>
      )}
    </div>
  )
}

function ActionButton(props: { tip: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      data-tip={props.tip}
      aria-label={props.tip}
      onClick={props.onClick}
      className="p-1.5 rounded-lg text-faint hover:text-ink hover:bg-bg2 transition-colors"
    >
      {props.children}
    </button>
  )
}

function UsageBadge({ message }: { message: Message }) {
  const u = message.usage
  if (!u) return null
  const tip = `${u.estimated ? '~' : ''}${formatTokens(u.inputTokens ?? 0)} in / ${formatTokens(u.outputTokens ?? 0)} out${u.cost != null ? ` · ${formatCost(u.cost)}` : ''}`
  return (
    <span data-tip={tip} className="text-[11px] text-faint font-mono px-1 cursor-default">
      {u.cost ? formatCost(u.cost) : `${formatTokens((u.inputTokens ?? 0) + (u.outputTokens ?? 0))} tok`}
      {u.latencyMs != null ? ` · ${(u.latencyMs / 1000).toFixed(1)}s` : ''}
    </span>
  )
}

export const MessageView = memo(function MessageView({ message, catalog }: { message: Message; catalog: Catalog | null }) {
  const isLive = useStore((s) => s.streaming?.messageId === message.id)
  const busy = useStore((s) => s.streaming != null)
  const regenerate = useStore((s) => s.regenerate)
  const setMessageVariant = useStore((s) => s.setMessageVariant)
  const editUserMessage = useStore((s) => s.editUserMessage)
  const editAssistantMessage = useStore((s) => s.editAssistantMessage)
  const rememberMessage = useStore((s) => s.rememberMessage)
  const setSourcesFor = useStore((s) => s.setSourcesFor)
  const openRepair = useStore((s) => s.openRepair)
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const isUser = message.role === 'user'

  const { displayContent, reasoning } = useMemo(() => {
    const m = message.content.match(/^\s*<think>([\s\S]*?)<\/think>\s*/i)
    if (m) return { displayContent: message.content.slice(m[0].length), reasoning: message.reasoning ?? m[1].trim() }
    return { displayContent: message.content, reasoning: message.reasoning }
  }, [message.content, message.reasoning])

  const stepById = useMemo(
    () => new Map((message.toolSteps ?? []).map((s) => [s.id, s] as const)),
    [message.toolSteps],
  )
  // segments are valid only for the latest generation; on an older variant fall back to content
  const showSegments =
    !!message.segments?.length &&
    (!message.variants?.length || (message.variantIndex ?? message.variants.length - 1) === message.variants.length - 1)

  const doCopy = async () => {
    if (await copyText(displayContent || message.content)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  if (isUser) {
    return (
      <div className="flex justify-end group anim-rise">
        <div className={cx('min-w-0', editing ? 'w-full max-w-[680px]' : 'max-w-[85%]')}>
          {editing ? (
            <div className="w-full rounded-2xl border border-accent/40 bg-bg1 p-3 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11.5px] font-medium text-accent flex items-center gap-1.5">
                  <IconEdit size={12} /> Editing message
                </span>
                <button onClick={() => setEditing(false)} className="p-1 rounded-md text-muted hover:bg-bg3" data-tip="Cancel (Esc)">
                  <X size={14} />
                </button>
              </div>
              <textarea
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    setEditing(false)
                    if (draft.trim() && draft.trim() !== message.content) void editUserMessage(message.id, draft)
                  }
                  if (e.key === 'Escape') setEditing(false)
                }}
                className="w-full bg-transparent resize-y outline-none text-[15px] leading-relaxed min-h-[120px] max-h-[55vh]"
              />
              <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-line">
                <span className="hidden sm:block text-[11px] text-faint">
                  <kbd>Enter</kbd> save &amp; resend · <kbd>Shift</kbd>+<kbd>Enter</kbd> newline · <kbd>Esc</kbd> cancel
                </span>
                <div className="flex items-center gap-2 ml-auto">
                  <button onClick={() => setEditing(false)} className="px-3 py-1.5 rounded-lg text-[12.5px] text-muted hover:bg-bg3 transition-colors">Cancel</button>
                  <button
                    onClick={() => {
                      setEditing(false)
                      if (draft.trim() && draft.trim() !== message.content) void editUserMessage(message.id, draft)
                    }}
                    disabled={!draft.trim() || draft.trim() === message.content}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-[12.5px] font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
                  >
                    <Check size={13} /> Save &amp; resend
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              {message.attachments?.length ? (
                <div className="flex gap-2 justify-end mb-1.5 flex-wrap">
                  {message.attachments.map((a, i) =>
                    a.kind === 'document' ? (
                      <div key={i} className="flex items-center gap-2 pl-2 pr-3 py-2 rounded-xl border border-line-strong bg-bg2 max-w-[220px]">
                        <FileText size={16} className="text-accent shrink-0" />
                        <span className="text-[12.5px] font-medium truncate">{a.name ?? 'document'}</span>
                      </div>
                    ) : (
                      <img key={i} src={a.dataUrl} alt={a.name ?? 'attachment'} className="h-20 rounded-xl border border-line-strong object-cover" />
                    ),
                  )}
                </div>
              ) : null}
              <div className="rounded-2xl rounded-br-md bg-bg2 border border-line px-4 py-2.5 whitespace-pre-wrap break-words text-[15px]">
                {message.content}
              </div>
              <div className="flex justify-end gap-0.5 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <ActionButton tip={copied ? 'Copied' : 'Copy'} onClick={doCopy}>
                  {copied ? <Check size={13} className="text-accent" /> : <IconCopy size={13} />}
                </ActionButton>
                {!busy && (
                  <ActionButton
                    tip="Edit & resend"
                    onClick={() => {
                      setDraft(message.content)
                      setEditing(true)
                    }}
                  >
                    <IconEdit size={13} />
                  </ActionButton>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  if (editing) {
    const saveEdit = () => {
      setEditing(false)
      void editAssistantMessage(message.id, draft)
    }
    return (
      <div className="group anim-rise min-w-0">
        <div className="rounded-2xl border border-line-strong bg-bg1 p-3">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                saveEdit()
              }
              if (e.key === 'Escape') setEditing(false)
            }}
            className="w-full bg-transparent resize-none outline-none text-[14px] leading-relaxed font-mono min-h-[120px]"
          />
          <div className="flex items-center justify-between gap-2 mt-1">
            <span className="text-[11px] text-faint">Saved as-is — not regenerated. <kbd>⌘/Ctrl</kbd>+<kbd>Enter</kbd></span>
            <div className="flex gap-2">
              <button onClick={() => setEditing(false)} className="p-1.5 rounded-lg text-muted hover:bg-bg3" data-tip="Cancel">
                <X size={14} />
              </button>
              <button onClick={saveEdit} className="p-1.5 rounded-lg text-accent hover:bg-bg3" data-tip="Save reply">
                <Check size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="group anim-rise min-w-0">
      <ResearchTrace steps={message.searchSteps} />
      {!message.segments?.length && <ToolTrace steps={message.toolSteps} />}
      <SourcesRow message={message} />
      {message.searchError && (
        <div className="flex items-start gap-2 mb-3 px-2.5 py-1.5 rounded-lg border border-[#e3a23c]/30 bg-[#e3a23c]/8 text-[12px] text-[#e3a23c]">
          <Globe size={12} className="mt-0.5 shrink-0" />
          <span>Web search didn’t run: {message.searchError}</span>
        </div>
      )}
      <Reasoning message={message} reasoning={reasoning} content={displayContent} />
      {showSegments ? (
        <div className={cx('font-serif text-[16px] leading-[1.72]', isLive && 'streaming-md')}>
          {message.segments!.map((seg, i) =>
            seg.kind === 'tool' ? (
              <ToolTrace key={i} steps={stepById.get(seg.stepId) ? [stepById.get(seg.stepId)!] : []} />
            ) : (
              <Markdown key={i} content={seg.text} sources={message.sources} onCitationClick={() => setSourcesFor(message.id)} />
            ),
          )}
        </div>
      ) : message.status === 'error' && !message.content ? null : (
        <div className={cx('font-serif text-[16px] leading-[1.72]', isLive && 'streaming-md')}>
          <Markdown content={displayContent} sources={message.sources} onCitationClick={() => setSourcesFor(message.id)} />
        </div>
      )}
      {message.status === 'error' && (
        <div className="flex items-start gap-2 mt-2 px-3 py-2.5 rounded-xl border border-danger/30 bg-danger/8 text-[13px] text-danger">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <div className="min-w-0">
            {/* The provider's own words follow ours on their own line — keep the break. */}
            <div className="whitespace-pre-wrap break-words">{message.error ?? 'Something went wrong.'}</div>
            {!busy && (
              <div className="mt-1 flex flex-wrap items-center gap-3">
                <button onClick={() => void regenerate(message.id)} className="font-medium underline underline-offset-2">
                  Try again
                </button>
                {/* Keeps failing? Hand the error to a model that still works and let it repair the provider. */}
                <button
                  onClick={() =>
                    openRepair({
                      providerId: message.model?.providerId,
                      modelId: message.model?.modelId,
                      error: message.error,
                    })
                  }
                  className="font-medium underline underline-offset-2"
                >
                  Fix this
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {message.status === 'stopped' && !isLive && <div className="mt-1.5 text-[12px] text-faint italic">Stopped</div>}
      {!isLive && (
        <div className="flex flex-wrap items-center gap-0.5 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <ActionButton tip={copied ? 'Copied' : 'Copy'} onClick={doCopy}>
            {copied ? <Check size={13} className="text-accent" /> : <IconCopy size={13} />}
          </ActionButton>
          {!busy && (
            <ActionButton tip="Regenerate" onClick={() => void regenerate(message.id)}>
              <IconRegenerate size={13} />
            </ActionButton>
          )}
          {!busy && <CompareButton messageId={message.id} />}
          {message.variants && message.variants.length > 1 && (
            <span className="flex items-center text-faint" role="group" aria-label="Answer versions">
              <button
                onClick={() => void setMessageVariant(message.id, (message.variantIndex ?? message.variants!.length - 1) - 1)}
                disabled={(message.variantIndex ?? message.variants.length - 1) === 0}
                data-tip="Previous answer"
                aria-label="Previous answer"
                className="p-1 rounded hover:text-ink disabled:opacity-30 disabled:cursor-default"
              >
                <ChevronLeft size={13} />
              </button>
              <span className="text-[11px] tabular-nums cursor-default px-0.5">
                {(message.variantIndex ?? message.variants.length - 1) + 1}/{message.variants.length}
              </span>
              <button
                onClick={() => void setMessageVariant(message.id, (message.variantIndex ?? message.variants!.length - 1) + 1)}
                disabled={(message.variantIndex ?? message.variants.length - 1) === message.variants.length - 1}
                data-tip="Next answer"
                aria-label="Next answer"
                className="p-1 rounded hover:text-ink disabled:opacity-30 disabled:cursor-default"
              >
                <ChevronRight size={13} />
              </button>
            </span>
          )}
          {!busy && (
            <ActionButton
              tip="Edit reply (kept as-is, not regenerated)"
              onClick={() => {
                setDraft(displayContent)
                setEditing(true)
              }}
            >
              <IconEdit size={13} />
            </ActionButton>
          )}
          <ActionButton tip="Save to memory" onClick={() => void rememberMessage(message.id)}>
            <IconBookmark size={13} />
          </ActionButton>
          {message.manual && (
            <span
              className="text-[11px] text-faint italic px-1.5 cursor-default"
              data-tip={message.model ? 'You edited this reply' : 'You added this reply'}
            >
              {message.model ? 'Edited' : 'Added by you'}
            </span>
          )}
          {message.model && (
            <span className="text-[11px] text-faint font-mono px-1.5 cursor-default truncate max-w-[140px]" data-tip={message.model.modelId}>
              {modelDisplayName(catalog, message.model)}
            </span>
          )}
          <UsageBadge message={message} />
        </div>
      )}
    </div>
  )
})
