import { MessageSquarePlus, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { cx } from '../lib/utils'
import { useStore } from '../state/store'
import { toast } from '../state/toasts'
import { PromptPresetEditor } from './SystemPrompt'
import { btnPrimaryCls, inputCls, Modal, SectionLabel } from './ui'

export function ThreadSettings({ onClose }: { onClose: () => void }) {
  const insertAssistantMessage = useStore((s) => s.insertAssistantMessage)
  const [reply, setReply] = useState('')

  const addReply = () => {
    const t = reply.trim()
    if (!t) return
    void insertAssistantMessage(t)
    setReply('')
    onClose()
    toast.success('Reply added', 'Injected into the conversation as context for the next message.')
  }

  return (
    <Modal open onClose={onClose} title="Thread settings" width={580}>
      {/* ---- Custom system prompt + presets ---- */}
      <div className="mb-6">
        <SectionLabel>Custom system prompt</SectionLabel>
        <PromptPresetEditor />
      </div>

      {/* ---- Inject a reply ---- */}
      <div className="pt-5 border-t border-line">
        <SectionLabel>Inject a reply</SectionLabel>
        <p className="text-[12.5px] text-muted leading-relaxed mb-2.5">
          Add a hand-written <span className="text-ink font-medium">assistant</span> reply to the conversation. The
          model treats it as something it already said — use it to fix a wrong output format or steer behaviour, then
          send your next message. Nothing is generated now.
        </p>
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="Paste the corrected / desired assistant response…"
          rows={4}
          className={cx(inputCls, 'resize-y min-h-[90px] leading-relaxed font-mono text-[12.5px]')}
        />
        <div className="flex items-center justify-between gap-2 mt-3">
          <span className="flex items-center gap-1.5 text-[11.5px] text-faint">
            <Sparkles size={12} className="text-accent/70" /> Joins the thread as a real assistant turn.
          </span>
          <button onClick={addReply} disabled={!reply.trim()} className={btnPrimaryCls}>
            <MessageSquarePlus size={14} /> Add to conversation
          </button>
        </div>
      </div>
    </Modal>
  )
}
