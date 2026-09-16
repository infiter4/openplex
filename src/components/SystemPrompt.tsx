import { Bookmark, Check, Plus, ScrollText, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { cx, uid } from '../lib/utils'
import { useSettings } from '../state/settings'
import { useStore } from '../state/store'
import { toast } from '../state/toasts'
import { btnCls, btnPrimaryCls, Dropdown, inputCls, Modal } from './ui'

function useCurrentPrompt(): { hasThread: boolean; current: string } {
  const activeThreadId = useStore((s) => s.activeThreadId)
  const thread = useStore((s) => (activeThreadId ? s.threads.find((t) => t.id === activeThreadId) : null))
  const draftSystemPrompt = useStore((s) => s.draftSystemPrompt)
  return { hasThread: Boolean(activeThreadId), current: (thread ? thread.systemPrompt : draftSystemPrompt) ?? '' }
}

export function PromptPresetEditor() {
  const { hasThread, current } = useCurrentPrompt()
  const setSystemPrompt = useStore((s) => s.setSystemPrompt)
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  const presets = settings.promptPresets ?? []

  const [prompt, setPrompt] = useState(current)
  const [naming, setNaming] = useState(false)
  const [presetName, setPresetName] = useState('')

  const dirty = current !== prompt

  const apply = () => {
    setSystemPrompt(prompt)
    toast.success('System prompt applied', hasThread ? 'Applies to this thread.' : 'Will seed your next new chat.')
  }
  const saveAsPreset = () => {
    const name = presetName.trim()
    const content = prompt.trim()
    if (!name || !content) return
    update({ promptPresets: [...presets, { id: uid(), name, content }] })
    setNaming(false)
    setPresetName('')
    toast.success('Preset saved', `${name} — available on all your devices.`)
  }
  const deletePreset = (id: string) => update({ promptPresets: presets.filter((p) => p.id !== id) })

  return (
    <div>
      <p className="text-[12.5px] text-muted leading-relaxed mb-2.5">
        Added <span className="text-ink font-medium">on top of</span> openplex’s built-in prompt — it’s never
        replaced, and where they differ, your instructions win.{' '}
        {hasThread ? 'Applies to this thread.' : 'Will seed the next new chat you start.'}
      </p>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="e.g. Always answer in British English, prefer tables, and assume I’m a senior engineer."
        rows={5}
        className={cx(inputCls, 'resize-y min-h-[110px] leading-relaxed')}
      />

      {presets.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
          <span className="text-[11.5px] text-faint mr-0.5">Presets:</span>
          {presets.map((p) => (
            <span
              key={p.id}
              className="group inline-flex items-center gap-1 rounded-full border border-line bg-bg0/50 pl-2.5 pr-1 py-1 text-[12px]"
            >
              <button
                onClick={() => setPrompt(p.content)}
                className="text-muted hover:text-accent transition-colors max-w-[160px] truncate"
                data-tip="Load this preset into the box above"
              >
                {p.name}
              </button>
              <button
                onClick={() => deletePreset(p.id)}
                className="p-0.5 rounded-full text-faint hover:text-danger transition-colors"
                data-tip="Delete preset"
                aria-label={`Delete preset ${p.name}`}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 mt-3 flex-wrap">
        <button onClick={apply} disabled={!dirty} className={btnPrimaryCls}>
          <Check size={13} /> Apply
        </button>
        {naming ? (
          <div className="flex items-center gap-1.5">
            <input
              autoFocus
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveAsPreset()
                if (e.key === 'Escape') setNaming(false)
              }}
              placeholder="Preset name"
              className={cx(inputCls, 'w-44 py-1')}
            />
            <button onClick={saveAsPreset} disabled={!presetName.trim() || !prompt.trim()} className={btnCls}>
              Save
            </button>
            <button onClick={() => setNaming(false)} className="p-1.5 rounded-lg text-muted hover:bg-bg2" aria-label="Cancel">
              <X size={14} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setNaming(true)}
            disabled={!prompt.trim()}
            className={btnCls}
            data-tip="Save the text above as a reusable preset (syncs across devices)"
          >
            <Bookmark size={13} /> Save as preset
          </button>
        )}
      </div>
    </div>
  )
}

export function SystemPromptModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title="System prompt" width={560}>
      <PromptPresetEditor />
    </Modal>
  )
}

export function SystemPromptControl() {
  const btnRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const { current } = useCurrentPrompt()
  const setSystemPrompt = useStore((s) => s.setSystemPrompt)
  const presets = useSettings((s) => s.settings.promptPresets) ?? []

  const isCustom = current.trim().length > 0
  const activePreset = presets.find((p) => p.content === current)
  const label = activePreset ? activePreset.name : isCustom ? 'Custom' : 'Prompt'

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen(!open)}
        data-tip="System prompt — pick a saved one or write a new one"
        className={cx(
          'flex items-center gap-1.5 px-2 py-1 rounded-lg text-[12.5px] font-medium transition-colors',
          isCustom ? 'text-accent bg-accent-soft' : 'text-muted hover:text-ink hover:bg-bg2',
        )}
      >
        <ScrollText size={14} />
        <span className="max-sm:hidden max-w-[110px] truncate">{label}</span>
      </button>
      {open && (
        <Dropdown anchor={btnRef.current} onClose={() => setOpen(false)} width={252}>
          <div className="py-1">
            <div className="px-3 pt-1.5 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-faint">System prompt</div>
            <button
              onClick={() => {
                setSystemPrompt(undefined)
                setOpen(false)
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-colors hover:bg-bg2"
            >
              <span className="flex-1">openplex default</span>
              {!isCustom && <Check size={13} className="text-accent" />}
            </button>
            {presets.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setSystemPrompt(p.content)
                  setOpen(false)
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-colors hover:bg-bg2 min-w-0"
              >
                <span className="flex-1 truncate">{p.name}</span>
                {activePreset?.id === p.id && <Check size={13} className="text-accent shrink-0" />}
              </button>
            ))}
            <div className="border-t border-line my-1" />
            <button
              onClick={() => {
                setOpen(false)
                setEditorOpen(true)
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[13px] text-accent transition-colors hover:bg-bg2"
            >
              <Plus size={13} /> <span>New / edit prompt…</span>
            </button>
          </div>
        </Dropdown>
      )}
      {editorOpen && <SystemPromptModal onClose={() => setEditorOpen(false)} />}
    </>
  )
}
