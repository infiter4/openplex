import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { useToasts } from '../state/toasts'

export function Toasts() {
  const toasts = useToasts((s) => s.toasts)
  const dismiss = useToasts((s) => s.dismiss)
  if (!toasts.length) return null
  return (
    <div className="fixed bottom-4 right-4 z-[70] flex flex-col gap-2 w-[340px] max-w-[calc(100vw-32px)]">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="anim-rise flex items-start gap-2.5 rounded-xl border border-line-strong bg-bg1 px-3.5 py-3"
          style={{ boxShadow: 'var(--shadow)' }}
        >
          {t.kind === 'error' ? (
            <AlertCircle size={16} className="text-danger mt-0.5 shrink-0" />
          ) : t.kind === 'success' ? (
            <CheckCircle2 size={16} className="text-accent mt-0.5 shrink-0" />
          ) : (
            <Info size={16} className="text-muted mt-0.5 shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium leading-snug">{t.title}</div>
            {t.detail && <div className="text-[12px] text-muted leading-relaxed mt-0.5 break-words">{t.detail}</div>}
          </div>
          <button onClick={() => dismiss(t.id)} className="text-faint hover:text-ink shrink-0 mt-0.5">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
