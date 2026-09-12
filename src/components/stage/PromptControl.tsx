import { Check, MessageSquarePlus, Plus, ScrollText, Sparkles } from 'lucide-react'
import { useRef, useState } from 'react'
import { cx } from '../../lib/utils'
import { useSettings } from '../../state/settings'
import { useStore } from '../../state/store'
import { toast } from '../../state/toasts'
import { PromptPresetEditor } from '../SystemPrompt'
import { btnPrimaryCls, Dropdown, inputCls, Modal } from '../ui'

function InjectModal({ onClose }: { onClose: () => void }) {
  const insertAssistantMessage = useStore((s) => s.insertAssistantMessage)
  const [text, setText] = useState('')
  return (
    <Modal open onClose={onClose} title="Inject a reply" width={560}>
      <p className="text-[12.5px] text-muted leading-relaxed mb-2.5">
        Add a hand-written <span className="text-ink font-medium">assistant</span> turn to this thread. The model treats
        it as something it already said — use it to fix an output format or steer behaviour, then send your next message.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste the corrected / desired assistant response…"
        rows={4}
        className={cx(inputCls, 'resize-y min-h-[110px] leading-relaxed font-mono text-[12.5px]')}
      />
      <div className="flex items-center justify-between gap-2 mt-3">
        <span className="flex items-center gap-1.5 text-[11.5px] text-faint">
          <Sparkles size={12} className="text-accent/70" /> Joins the thread as a real assistant turn.
        </span>
        <button
          onClick={() => {
            const t = text.trim()
            if (!t) return
            void insertAssistantMessage(t)
            toast.success('Reply added', 'Injected into the conversation as context for the next message.')
            onClose()
          }}
          disabled={!text.trim()}
          className={btnPrimaryCls}
        >
          <MessageSquarePlus size={14} /> Add to conversation
        </button>
      </div>
    </Modal>
  )
}

export function PromptControl() {
  const btnRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [injectOpen, setInjectOpen] = useState(false)

  const activeThreadId = useStore((s) => s.activeThreadId)
  const thread = useStore((s) => (activeThreadId ? s.threads.find((t) => t.id === activeThreadId) : null))
  const draftSystemPrompt = useStore((s) => s.draftSystemPrompt)
  const setSystemPrompt = useStore((s) => s.setSystemPrompt)
  const presets = useSettings((s) => s.settings.promptPresets) ?? []

  const current = (thread ? thread.systemPrompt : draftSystemPrompt) ?? ''
  const isCustom = current.trim().length > 0
  const activePreset = presets.find((p) => p.content === current)
  const label = (activePreset ? activePreset.name : isCustom ? 'Custom' : 'Prompt').toUpperCase()

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        className="op-hover-lift flex items-center gap-1.5 text-[11px] tracking-[.14em] font-semibold max-w-[120px]"
        style={{ color: isCustom ? 'var(--accent)' : 'var(--muted)' }}
      >
        <ScrollText size={13} className="shrink-0" />
        <span className="truncate">{label}</span>
      </button>
      {open && (
        <Dropdown anchor={btnRef.current} onClose={() => setOpen(false)} width={252}>
          <div className="py-1">
            <div className="px-3 pt-1.5 pb-1 text-[10.5px] font-semibold uppercase tracking-[.14em] text-faint">System prompt</div>
            <button
              onClick={() => { setSystemPrompt(undefined); setOpen(false) }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-bg2 transition-colors"
            >
              <span className="flex-1">openplex default</span>
              {!isCustom && <Check size={13} className="text-accent" />}
            </button>
            {presets.map((p) => (
              <button
                key={p.id}
                onClick={() => { setSystemPrompt(p.content); setOpen(false) }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-bg2 transition-colors min-w-0"
              >
                <span className="flex-1 truncate">{p.name}</span>
                {activePreset?.id === p.id && <Check size={13} className="text-accent shrink-0" />}
              </button>
            ))}
            <div className="border-t border-line my-1" />
            <button
              onClick={() => { setOpen(false); setEditorOpen(true) }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[13px] text-accent hover:bg-bg2 transition-colors"
            >
              <Plus size={13} /> New / edit prompt…
            </button>
            {activeThreadId && (
              <button
                onClick={() => { setOpen(false); setInjectOpen(true) }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-bg2 transition-colors"
              >
                <MessageSquarePlus size={13} className="text-muted" /> Inject a reply…
              </button>
            )}
          </div>
        </Dropdown>
      )}
      {editorOpen && (
        <Modal open onClose={() => setEditorOpen(false)} title="System prompt" width={560}>
          <PromptPresetEditor />
        </Modal>
      )}
      {injectOpen && <InjectModal onClose={() => setInjectOpen(false)} />}
    </>
  )
}
