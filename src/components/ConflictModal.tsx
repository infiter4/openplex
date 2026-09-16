import { Laptop, Smartphone } from 'lucide-react'
import { useEffect } from 'react'
import type { FieldConflict } from '../lib/merge'
import { cx, timeAgo } from '../lib/utils'
import { useConflicts, type SyncConflict } from '../state/conflicts'
import { Modal } from './ui'

/** Render any settings/record value in a form a person can compare at a glance. */
function preview(v: unknown): string {
  if (v == null || v === '') return '— empty —'
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.length ? `${v.length} item${v.length === 1 ? '' : 's'}` : '— none —'
  const o = v as Record<string, unknown>
  if (typeof o.providerId === 'string' && typeof o.modelId === 'string') return `${o.providerId} / ${o.modelId}`
  try {
    return JSON.stringify(v, null, 1).slice(0, 400)
  } catch {
    return String(v)
  }
}

function Side({
  label,
  when,
  icon,
  fields,
  pick,
  onChoose,
}: {
  label: string
  when: number
  icon: React.ReactNode
  fields: FieldConflict[]
  pick: 'local' | 'remote'
  onChoose: () => void
}) {
  return (
    <div className="flex-1 min-w-0 flex flex-col rounded-xl border border-line bg-bg0/40 overflow-hidden">
      <div className="flex items-center gap-1.5 px-3.5 py-2 border-b border-line text-[12.5px] font-medium">
        <span className="text-faint shrink-0">{icon}</span>
        {label}
        <span className="ml-auto text-[11px] text-faint">{when ? timeAgo(when) : ''}</span>
      </div>
      <div className="flex-1 px-3.5 py-2.5 space-y-2.5">
        {fields.map((f) => (
          <div key={f.field}>
            <div className="text-[10.5px] uppercase tracking-wider text-faint mb-0.5">{f.label}</div>
            <div className="text-[13px] leading-snug whitespace-pre-wrap break-words max-h-[140px] overflow-y-auto">
              {preview(pick === 'local' ? f.local : f.remote)}
            </div>
          </div>
        ))}
      </div>
      <button
        onClick={onChoose}
        className="shrink-0 m-2.5 mt-0 py-1.5 rounded-lg text-[12.5px] font-semibold bg-bg2 border border-line-strong hover:bg-accent-soft hover:border-accent transition-colors"
      >
        Keep this version
      </button>
    </div>
  )
}

function Card({ conflict }: { conflict: SyncConflict }) {
  const resolve = useConflicts((s) => s.resolve)
  return (
    <div className="rounded-xl border border-line-strong bg-bg1 p-3.5">
      <div className="text-[13.5px] font-medium mb-0.5">{conflict.title}</div>
      <div className="text-[12px] text-muted mb-3">
        Changed in both places{conflict.fields.length > 1 ? ` — ${conflict.fields.length} fields differ` : ''}. Pick the
        version to keep; everything else was merged automatically.
      </div>
      <div className="flex flex-col sm:flex-row gap-2.5 items-stretch">
        <Side
          label="This device"
          when={conflict.localAt}
          icon={<Laptop size={13} />}
          fields={conflict.fields}
          pick="local"
          onChoose={() => void resolve(conflict.id, 'local')}
        />
        <Side
          label="Your other device"
          when={conflict.remoteAt}
          icon={<Smartphone size={13} />}
          fields={conflict.fields}
          pick="remote"
          onChoose={() => void resolve(conflict.id, 'remote')}
        />
      </div>
    </div>
  )
}

/**
 * Shown when two devices changed the same thing to different values. Everything that could be
 * merged already has been by the time this opens — these are the genuine disagreements.
 */
export function ConflictModal() {
  const conflicts = useConflicts((s) => s.conflicts)
  const open = useConflicts((s) => s.open)
  const setOpen = useConflicts((s) => s.setOpen)
  const load = useConflicts((s) => s.load)

  useEffect(() => { void load() }, [load])
  useEffect(() => { if (!conflicts.length) setOpen(false) }, [conflicts.length, setOpen])

  if (!open || !conflicts.length) return null

  return (
    <Modal open onClose={() => setOpen(false)} title="Two versions of the same thing" width={760}>
      <div className="space-y-3">
        <p className="text-[12.5px] text-muted leading-relaxed">
          This device and another one both changed{' '}
          {conflicts.length === 1 ? 'something' : `${conflicts.length} things`} while apart, in ways that can't be
          combined. Choose which version to keep — the other is discarded.
        </p>
        {conflicts.map((c) => (
          <Card key={c.id} conflict={c} />
        ))}
      </div>
    </Modal>
  )
}

/** Small banner for Settings → Account & devices so a dismissed conflict is still reachable. */
export function ConflictBanner() {
  const conflicts = useConflicts((s) => s.conflicts)
  const setOpen = useConflicts((s) => s.setOpen)
  const load = useConflicts((s) => s.load)

  useEffect(() => { void load() }, [load])
  if (!conflicts.length) return null

  return (
    <button
      onClick={() => setOpen(true)}
      className={cx(
        'w-full text-left rounded-xl border border-warn/40 bg-warn/8 px-3.5 py-2.5 mb-4',
        'text-[12.5px] hover:border-warn transition-colors',
      )}
    >
      <span className="font-medium">
        {conflicts.length} sync {conflicts.length === 1 ? 'conflict needs' : 'conflicts need'} your choice
      </span>
      <span className="block text-muted mt-0.5">
        Two devices changed the same thing differently. Tap to pick which version to keep.
      </span>
    </button>
  )
}
