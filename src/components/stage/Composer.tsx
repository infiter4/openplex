import { Capacitor } from '@capacitor/core'
import { Camera, ChevronDown, CornerDownRight, FileText, Loader2, Mic, Square, X } from 'lucide-react'
import { IconAttach, IconResearch, IconSeed, IconSend } from '../icons'
import { useEffect, useMemo, useRef, useState } from 'react'
import { processFile } from '../../lib/files'
import { transcribe } from '../../lib/stt'
import { buildSystemPrompt, estimateContextUsage } from '../../lib/prompts'
import type { Attachment, ModelRef } from '../../lib/types'
import { cx } from '../../lib/utils'
import { useProviders } from '../../state/providers'
import { useSettings } from '../../state/settings'
import { useStore, visibleMessages } from '../../state/store'
import { toast } from '../../state/toasts'
import { ContextMeter } from './ContextMeter'
import { PromptControl } from './PromptControl'
import { VoicePicker } from './VoicePicker'

function formatBytes(n?: number): string {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function Composer({ centered = false }: { centered?: boolean }) {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [processing, setProcessing] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [seed, setSeed] = useState('')
  const [seedOpen, setSeedOpen] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const send = useStore((s) => s.send)
  const stop = useStore((s) => s.stop)
  const streaming = useStore((s) => s.streaming)
  const activeThreadId = useStore((s) => s.activeThreadId)
  const threads = useStore((s) => s.threads)
  const draftWebSearch = useStore((s) => s.draftWebSearch)
  const draftSystemPrompt = useStore((s) => s.draftSystemPrompt)
  const setWebSearch = useStore((s) => s.setWebSearch)
  const memories = useStore((s) => s.memories)
  const messages = useStore((s) => s.messages)

  const catalog = useProviders((s) => s.catalog)
  const connections = useProviders((s) => s.connections)
  const settings = useSettings((s) => s.settings)

  const thread = activeThreadId ? threads.find((t) => t.id === activeThreadId) : null
  const webOn = thread ? Boolean(thread.webSearch) : draftWebSearch

  const currentRef: ModelRef | null = thread?.modelRef ?? settings.defaultModel ?? null
  const currentModel = currentRef && catalog ? catalog[currentRef.providerId]?.models[currentRef.modelId] : null
  const supportsVision = Boolean(currentModel?.attachment || currentModel?.modalities?.input?.includes('image'))

  const modelContext = currentModel?.limit?.context ?? 128_000

  // base (system prompt + conversation) recomputes only when the thread/memories change —
  // NOT on every keystroke; the draft's own tokens are a cheap addition on top.
  const baseTokens = useMemo(() => {
    const systemPrompt = buildSystemPrompt({
      defaultPrompt: settings.defaultSystemPrompt,
      threadPrompt: thread ? thread.systemPrompt : draftSystemPrompt,
      memories,
      memoryEnabled: settings.memory.enabled,
    })
    const list = activeThreadId ? visibleMessages(messages[activeThreadId]) : []
    return estimateContextUsage({ messages: list, systemPrompt })
  }, [messages, activeThreadId, memories, settings, thread, draftSystemPrompt])
  const usedTokens = baseTokens + Math.ceil(text.length / 4)

  useEffect(() => {
    if (centered) taRef.current?.focus()
  }, [activeThreadId, centered])

  const autoGrow = () => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, centered ? 280 : 200)}px`
  }

  const doSend = () => {
    if (streaming || processing) return
    const t = text
    const a = attachments
    if (!t.trim() && !a.length) return
    const p = seed.trim()
    setText('')
    setAttachments([])
    setSeed('')
    setSeedOpen(false)
    requestAnimationFrame(autoGrow)
    void send(t, a, p || undefined)
  }

  const addFiles = async (files: FileList | File[]) => {
    const list = [...files]
    if (!list.length) return
    const room = 6 - attachments.length
    if (room <= 0) return toast.error('Attachment limit', 'Up to 6 files per message.')
    setProcessing(true)
    try {
      const next: Attachment[] = []
      for (const f of list.slice(0, room)) {
        try {
          const { attachment, skipped } = await processFile(f, { vision: supportsVision })
          if (attachment) next.push(attachment)
          else if (skipped) toast.error('Skipped', skipped)
        } catch (err) {
          toast.error('Couldn’t read file', (err as Error).message)
        }
      }
      if (next.length) setAttachments((a) => [...a, ...next].slice(0, 6))
    } finally {
      setProcessing(false)
    }
  }

  const native = Capacitor.isNativePlatform()
  const takePhoto = async () => {
    try {
      const { Camera: Cam, CameraResultType, CameraSource } = await import('@capacitor/camera')
      const photo = await Cam.getPhoto({ quality: 85, resultType: CameraResultType.Uri, source: CameraSource.Camera })
      if (!photo.webPath) return
      const blob = await (await fetch(photo.webPath)).blob()
      const file = new File([blob], `photo-${Date.now()}.${photo.format || 'jpg'}`, { type: blob.type || 'image/jpeg' })
      await addFiles([file])
    } catch (err) {
      const m = (err as Error)?.message ?? ''
      if (!/cancel/i.test(m)) toast.error('Camera failed', m)
    }
  }

  const voice = settings.voice
  const voiceReady = Boolean(voice?.providerId && voice?.model && connections[voice.providerId])
  const [voicePickerOpen, setVoicePickerOpen] = useState(false)
  const pendingRecord = useRef(false)

  const startMic = async (target?: { providerId: string; model: string }) => {
    const v = target ?? (voice?.providerId && voice?.model ? { providerId: voice.providerId, model: voice.model } : null)
    if (!v || !connections[v.providerId]) { setVoicePickerOpen(true); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      chunksRef.current = []
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data) }
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' })
        if (!blob.size) return
        setTranscribing(true)
        try {
          const said = await transcribe(connections[v.providerId], v.model, blob, catalog?.[v.providerId])
          if (said) {
            setText((t) => (t.trim() ? t.replace(/\s*$/, ' ') : '') + said)
            requestAnimationFrame(autoGrow)
            taRef.current?.focus()
          }
        } catch (err) {
          toast.error('Transcription failed', (err as Error).message)
        } finally {
          setTranscribing(false)
        }
      }
      rec.start()
      recRef.current = rec
      setRecording(true)
    } catch (err) {
      toast.error('Microphone unavailable', (err as Error).message || 'Grant mic permission and try again.')
    }
  }
  const stopMic = () => { recRef.current?.stop(); setRecording(false) }
  const onMicClick = () => {
    if (recording) return stopMic()
    if (transcribing) return
    if (!voiceReady) { pendingRecord.current = true; setVoicePickerOpen(true); return } // no dead-end — let them pick
    void startMic()
  }
  // If the picker was opened by tapping the mic, start recording the moment a model is chosen.
  const onVoicePicked = (providerId: string, model: string) => {
    if (pendingRecord.current) { pendingRecord.current = false; void startMic({ providerId, model }) }
  }
  const closeVoicePicker = () => { pendingRecord.current = false; setVoicePickerOpen(false) }

  const actionLabel = (active: boolean) => (active ? 'var(--accent)' : 'var(--ink-2, var(--muted))')

  return (
    <div className={cx('relative', centered ? '' : 'w-full')}>
      <div
        className={cx(
          'relative',
          !centered && 'rounded-2xl border border-line-strong bg-bg1 px-4 pt-3 pb-2.5',
          dragOver && 'ring-1 ring-accent',
        )}
        style={!centered ? { boxShadow: 'var(--shadow)' } : undefined}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); void addFiles(e.dataTransfer.files) }}
      >
        {dragOver && (
          <div className="absolute inset-0 z-10 rounded-2xl bg-accent-soft border border-dashed border-accent flex items-center justify-center pointer-events-none">
            <span className="flex items-center gap-2 text-[13px] font-medium text-accent"><IconAttach size={15} /> Drop to attach</span>
          </div>
        )}

        {(attachments.length > 0 || processing) && (
          <div className="flex gap-2 flex-wrap mb-2.5">
            {attachments.map((a, i) => (
              <div key={i} className="relative group/att">
                {a.kind === 'document' ? (
                  <div className="flex items-center gap-2 h-12 pl-2 pr-3 rounded-lg border border-line-strong bg-bg2 max-w-[180px]">
                    <FileText size={15} className="text-accent shrink-0" />
                    <div className="min-w-0">
                      <div className="text-[12px] font-medium truncate">{a.name}</div>
                      <div className="text-[10px] text-faint truncate font-mono">{formatBytes(a.size)}</div>
                    </div>
                  </div>
                ) : (
                  <img src={a.dataUrl} alt={a.name} className="h-12 w-12 object-cover rounded-lg border border-line-strong" />
                )}
                <button
                  onClick={() => setAttachments(attachments.filter((_, j) => j !== i))}
                  className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-bg3 border border-line-strong text-muted hover:text-ink"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
            {processing && (
              <div className="flex items-center justify-center h-12 w-12 rounded-lg border border-dashed border-line-strong text-faint">
                <Loader2 size={15} className="animate-spin" />
              </div>
            )}
          </div>
        )}

        <div className="relative">
          <textarea
            ref={taRef}
            value={text}
            rows={centered ? 2 : 1}
            onChange={(e) => { setText(e.target.value); autoGrow() }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                doSend()
              }
            }}
            onPaste={(e) => {
              if (e.clipboardData.files.length) { e.preventDefault(); void addFiles(e.clipboardData.files) }
            }}
            placeholder={centered ? '' : webOn ? 'Search the web and ask…' : 'Ask anything…'}
            className={cx(
              'op-input w-full bg-transparent resize-none outline-none text-ink',
              centered ? 'font-serif text-[26px] sm:text-[30px] leading-[1.3] caret-accent pb-3' : 'text-[15px] leading-relaxed',
            )}
          />
          {centered && !text && (
            <div className="absolute top-0 left-0 pointer-events-none font-serif italic text-[26px] sm:text-[30px] leading-[1.3] text-faint">
              what are you thinking about?
            </div>
          )}
        </div>

        {centered && <div className="h-px bg-muted/45" />}

        {(seedOpen || seed.trim()) && (
          <div className="flex items-center gap-2.5 mt-3">
            <CornerDownRight size={13} className="text-accent shrink-0" />
            <input
              autoFocus
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setSeedOpen(false); if (e.key === 'Enter') { e.preventDefault(); doSend() } }}
              placeholder="begin the answer with…"
              className="op-input flex-1 min-w-0 bg-transparent outline-none font-serif italic text-[15px] text-muted placeholder:text-faint border-b border-dotted border-line"
            />
            <button onClick={() => { setSeed(''); setSeedOpen(false) }} className="text-faint hover:text-ink"><X size={13} /></button>
          </div>
        )}

        <div className="flex items-center justify-between flex-wrap gap-x-3 gap-y-2.5 sm:gap-x-5 sm:gap-y-3 mt-3 sm:mt-3.5">
          <div className="flex items-center gap-3.5 sm:gap-4 flex-wrap">
            <button onClick={() => fileRef.current?.click()} className="op-hover-lift flex items-center gap-1.5 text-[11px] tracking-[.14em] font-semibold" style={{ color: 'var(--muted)' }}>
              <IconAttach size={15} /><span className="hidden sm:inline ml-1.5">ATTACH</span>
            </button>
            <button onClick={() => setSeedOpen((v) => !v)} className="op-hover-lift flex items-center gap-1.5 text-[11px] tracking-[.14em] font-semibold" style={{ color: actionLabel(Boolean(seed.trim()) || seedOpen) }}>
              <IconSeed size={15} /><span className="hidden sm:inline ml-1.5">SEED</span>
            </button>
            <button onClick={() => setWebSearch(!webOn)} className="op-hover-lift flex items-center gap-1.5 text-[11px] tracking-[.14em] font-semibold" style={{ color: actionLabel(webOn) }}>
              <IconResearch size={15} /><span className="hidden sm:inline ml-1.5">RESEARCH</span>
            </button>
            <PromptControl />
            <span className="flex items-center rounded-md hover:bg-bg2/60 transition-colors">
              <button
                onClick={onMicClick}
                disabled={transcribing}
                data-tip={recording ? 'Stop & transcribe' : voiceReady ? `Dictate · ${voice!.model}` : 'Set up voice dictation'}
                className="op-hover-lift flex items-center gap-1.5 text-[11px] tracking-[.14em] font-semibold disabled:opacity-50 pl-0.5"
                style={{ color: actionLabel(recording) }}
              >
                {transcribing ? <Loader2 size={15} className="animate-spin" /> : <Mic size={15} className={recording ? 'animate-pulse' : ''} />}
                <span className="hidden sm:inline ml-1.5">{recording ? 'STOP' : 'VOICE'}</span>
              </button>
              <button
                onClick={() => { pendingRecord.current = false; setVoicePickerOpen(true) }}
                disabled={recording || transcribing}
                data-tip="Change voice model"
                aria-label="Change voice model"
                className="op-hover-lift flex items-center px-0.5 text-faint hover:text-ink disabled:opacity-40"
              >
                <ChevronDown size={13} />
              </button>
            </span>
            {native && supportsVision && (
              <button onClick={() => void takePhoto()} className="op-hover-lift flex items-center gap-1.5 text-[11px] tracking-[.14em] font-semibold" style={{ color: 'var(--muted)' }}>
                <Camera size={15} /><span className="hidden sm:inline ml-1.5">CAMERA</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-3.5 sm:gap-5">
            <ContextMeter used={usedTokens} total={modelContext} />
            {streaming ? (
              <button onClick={stop} className="op-hover-lift flex items-center gap-2 font-serif italic text-[18px] text-danger">
                Stop <Square size={15} fill="currentColor" />
              </button>
            ) : (
              <button
                onClick={doSend}
                disabled={(!text.trim() && !attachments.length) || processing}
                className="op-hover-lift flex items-center gap-2 font-serif italic text-[19px] text-accent disabled:opacity-40"
              >
                {processing ? <Loader2 size={17} className="animate-spin" /> : <>Ask <IconSend size={18} /></>}
              </button>
            )}
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept={supportsVision
            ? 'image/*,application/pdf,.pdf,.docx,.txt,.md,.csv,.tsv,.json,.xml,.yaml,.yml,.html,.css,.js,.mjs,.ts,.tsx,.jsx,.py,.java,.c,.h,.cpp,.cs,.go,.rs,.rb,.php,.sql,.sh,.log'
            : 'application/pdf,.pdf,.docx,.txt,.md,.csv,.tsv,.json,.xml,.yaml,.yml,.html,.css,.js,.mjs,.ts,.tsx,.jsx,.py,.java,.c,.h,.cpp,.cs,.go,.rs,.rb,.php,.sql,.sh,.log'}
          multiple
          hidden
          onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = '' }}
        />
      </div>

      <VoicePicker open={voicePickerOpen} onClose={closeVoicePicker} onPicked={onVoicePicked} />
    </div>
  )
}
