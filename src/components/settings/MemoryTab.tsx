import { Bookmark, Plus, Sparkles, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useSettings } from '../../state/settings'
import { useStore } from '../../state/store'
import { btnPrimaryCls, inputCls, SectionLabel, Switch } from '../ui'
import { cx, timeAgo } from '../../lib/utils'

export function MemoryTab() {
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  const memories = useStore((s) => s.memories).filter((m) => !m.deleted)
  const addMemory = useStore((s) => s.addMemory)
  const updateMemory = useStore((s) => s.updateMemory)
  const deleteMemory = useStore((s) => s.deleteMemory)

  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')

  const mem = settings.memory
  const setMem = (patch: Partial<typeof mem>) => update({ memory: { ...mem, ...patch } })

  return (
    <div>
      <p className="text-[12.5px] text-muted leading-relaxed mb-4">
        Memories are short facts injected into every conversation, so any model you talk to knows your context. They
        sync across devices when you're signed in.
      </p>

      <div className="space-y-3 mb-5">
        <label className="flex items-center justify-between gap-3">
          <span>
            <span className="text-[13.5px] font-medium block">Use memory</span>
            <span className="text-[12px] text-muted">Include memories in the system prompt</span>
          </span>
          <Switch checked={mem.enabled} onChange={(v) => setMem({ enabled: v })} />
        </label>
        <label className="flex items-center justify-between gap-3">
          <span>
            <span className="text-[13.5px] font-medium flex items-center gap-1.5">
              <Sparkles size={13} className="text-accent" /> Auto-remember
            </span>
            <span className="text-[12px] text-muted">
              After each reply, quietly extract durable facts (uses the current model, costs a tiny extra call)
            </span>
          </span>
          <Switch checked={mem.auto} onChange={(v) => setMem({ auto: v })} disabled={!mem.enabled} />
        </label>
      </div>

      <SectionLabel>
        {memories.length} {memories.length === 1 ? 'memory' : 'memories'}
      </SectionLabel>

      <div className="flex gap-2 mb-3">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a memory (e.g. “I prefer TypeScript and concise answers”)"
          className={inputCls}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) {
              addMemory(draft, 'manual')
              setDraft('')
            }
          }}
        />
        <button
          onClick={() => {
            if (draft.trim()) {
              addMemory(draft, 'manual')
              setDraft('')
            }
          }}
          disabled={!draft.trim()}
          className={btnPrimaryCls}
        >
          <Plus size={13} />
        </button>
      </div>

      <div className="space-y-1.5">
        {memories.length === 0 && (
          <div className="text-center text-[12.5px] text-faint py-6 leading-relaxed">
            Nothing remembered yet. Add one above, or hover a message and hit <Bookmark size={11} className="inline" />.
          </div>
        )}
        {[...memories].sort((a, b) => b.createdAt - a.createdAt).map((m) => (
          <div key={m.id} className={cx('rounded-xl border border-line bg-bg0/40 px-3 py-2.5 group', !m.enabled && 'opacity-50')}>
            {editingId === m.id ? (
              <input
                autoFocus
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                onBlur={() => {
                  setEditingId(null)
                  if (editDraft.trim() && editDraft !== m.content) updateMemory(m.id, { content: editDraft.trim() })
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  if (e.key === 'Escape') setEditingId(null)
                }}
                className={inputCls}
              />
            ) : (
              <div className="flex items-start gap-2.5">
                <button
                  className="text-[13px] leading-relaxed flex-1 text-left cursor-text"
                  onClick={() => {
                    setEditingId(m.id)
                    setEditDraft(m.content)
                  }}
                >
                  {m.content}
                </button>
                <span className="text-[10.5px] text-faint shrink-0 mt-0.5 font-mono" data-tip={m.source === 'auto' ? 'Extracted automatically' : 'Added manually'}>
                  {m.source === 'auto' ? '✦ auto' : timeAgo(m.createdAt)}
                </span>
                <Switch checked={m.enabled} onChange={(v) => updateMemory(m.id, { enabled: v })} />
                <button
                  onClick={() => deleteMemory(m.id)}
                  className="p-1 rounded-md text-faint hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  data-tip="Delete"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
