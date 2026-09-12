import { Download, FileText, Loader2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { downloadAgentFile } from '../lib/agentBackend'
import { renderPdf } from '../lib/files'
import { saveBlob } from '../lib/save'
import type { AgentFile } from '../lib/types'
import { useStore } from '../state/store'
import { toast } from '../state/toasts'

export const isImageFileMeta = (f: AgentFile): boolean =>
  /^image\//i.test(f.mime ?? '') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(f.name)
const isPdfFileMeta = (f: AgentFile): boolean => f.mime === 'application/pdf' || /\.pdf$/i.test(f.name)

type ViewState =
  | { kind: 'loading' }
  | { kind: 'image'; url: string }
  | { kind: 'pdf'; pages: string[] }
  | { kind: 'none' }
  | { kind: 'error'; message: string }

export function FileViewer() {
  const file = useStore((s) => s.viewerFile)
  const close = useStore((s) => s.closeFile)
  const [state, setState] = useState<ViewState>({ kind: 'loading' })
  const [blob, setBlob] = useState<Blob | null>(null)

  useEffect(() => {
    if (!file) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [file, close])

  useEffect(() => {
    if (!file) return
    let cancelled = false
    let objectUrl: string | null = null
    setState({ kind: 'loading' })
    setBlob(null)
    void (async () => {
      try {
        const b = await downloadAgentFile(file)
        if (cancelled) return
        if (!b) {
          setState({ kind: 'error', message: 'Couldn’t load this file — it may have expired or the computer is offline.' })
          return
        }
        setBlob(b)
        if (isImageFileMeta(file)) {
          objectUrl = URL.createObjectURL(b)
          setState({ kind: 'image', url: objectUrl })
        } else if (isPdfFileMeta(file)) {
          const pages = await renderPdf(await b.arrayBuffer())
          if (cancelled) return
          setState(pages.length ? { kind: 'pdf', pages } : { kind: 'none' })
        } else {
          setState({ kind: 'none' })
        }
      } catch (e) {
        if (!cancelled) setState({ kind: 'error', message: (e as Error).message })
      }
    })()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [file])

  if (!file) return null

  const download = () => {
    if (blob) void saveBlob(blob, file.name)
    else toast.error('Not ready yet', 'The file is still loading.')
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[70] bg-black/75 backdrop-blur-[2px] anim-fade flex flex-col"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}
    >
      <div className="shrink-0 flex items-center gap-3 px-4 py-3 text-white/90 pt-safe">
        <FileText size={15} className="shrink-0 opacity-70" />
        <span className="font-mono text-[12.5px] truncate flex-1 min-w-0">{file.name}</span>
        <button onClick={download} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12.5px] hover:bg-white/10 transition-colors">
          <Download size={14} /> <span className="hidden sm:inline">Download</span>
        </button>
        <button onClick={close} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors" aria-label="Close">
          <X size={18} />
        </button>
      </div>
      <div
        className="flex-1 min-h-0 overflow-y-auto flex items-start justify-center p-4"
        onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}
      >
        {state.kind === 'loading' && (
          <div className="m-auto flex items-center gap-2 text-white/70 text-[13px]"><Loader2 size={16} className="animate-spin" /> Loading…</div>
        )}
        {state.kind === 'image' && (
          <img src={state.url} alt={file.name} className="max-w-full rounded-lg shadow-2xl object-contain" style={{ maxHeight: '100%' }} />
        )}
        {state.kind === 'pdf' && (
          <div className="flex flex-col items-center gap-3 w-full max-w-[900px]">
            {state.pages.map((src, i) => (
              <img key={i} src={src} alt={`page ${i + 1}`} className="w-full rounded-lg shadow-2xl bg-white" />
            ))}
          </div>
        )}
        {(state.kind === 'none' || state.kind === 'error') && (
          <div className="m-auto text-center text-white/70 text-[13px] max-w-sm px-6">
            <p>{state.kind === 'error' ? state.message : 'No in-app preview for this file type.'}</p>
            <button onClick={download} className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/25 hover:bg-white/10 text-[12.5px]">
              <Download size={13} /> Download {file.name}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
