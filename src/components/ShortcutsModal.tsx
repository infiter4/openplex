import { useStore } from '../state/store'
import { Modal } from './ui'

const SHORTCUTS: Array<{ keys: string[]; label: string }> = [
  { keys: ['Ctrl', 'K'], label: 'Command palette & global search' },
  { keys: ['Ctrl', 'Shift', 'O'], label: 'New chat' },
  { keys: ['Ctrl', 'B'], label: 'Toggle sidebar' },
  { keys: ['Enter'], label: 'Send message' },
  { keys: ['Shift', 'Enter'], label: 'New line' },
  { keys: ['↑'], label: 'Recall last message (empty composer)' },
  { keys: ['Esc'], label: 'Close dialogs / stop overlays' },
]

export function ShortcutsModal() {
  const open = useStore((s) => s.shortcutsOpen)
  const setOpen = useStore((s) => s.setShortcutsOpen)
  return (
    <Modal open={open} onClose={() => setOpen(false)} width={400} title="Keyboard shortcuts">
      <div className="space-y-2.5">
        {SHORTCUTS.map((s) => (
          <div key={s.label} className="flex items-center justify-between gap-4">
            <span className="text-[13px] text-muted">{s.label}</span>
            <span className="flex gap-1 shrink-0">
              {s.keys.map((k) => (
                <kbd key={k}>{k}</kbd>
              ))}
            </span>
          </div>
        ))}
      </div>
    </Modal>
  )
}
