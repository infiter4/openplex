import { ArrowRight, Mic } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { sttModelsFor, type SttOption } from '../../lib/stt'
import { useProviders } from '../../state/providers'
import { useSettings } from '../../state/settings'
import { useStore } from '../../state/store'
import { VoiceModelList } from '../VoiceModelList'

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

/** Composer ⌄ picker — a centered modal wrapping the shared VoiceModelList. Choosing a connected
 *  model sets it (and the composer auto-starts recording via onPicked); an unconnected one routes
 *  to Providers to connect that provider. */
export function VoicePicker({
  open,
  onClose,
  onPicked,
}: {
  open: boolean
  onClose: () => void
  onPicked?: (providerId: string, model: string) => void
}) {
  const update = useSettings((s) => s.update)
  const showAll = useSettings((s) => s.settings.showAllProviders)
  const catalog = useProviders((s) => s.catalog)
  const connections = useProviders((s) => s.connections)
  const openSettings = useStore((s) => s.openSettings)

  const total = useMemo(() => {
    const opts = sttModelsFor(catalog, connections, showAll)
    return `${plural(opts.length, 'model')} · ${plural(new Set(opts.map((o) => o.providerId)).size, 'provider')}`
  }, [catalog, connections, showAll])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const choose = (o: SttOption) => {
    if (!o.connected) { onClose(); openSettings('providers', o.providerId); return }
    update({ voice: { providerId: o.providerId, model: o.modelId } })
    onPicked?.(o.providerId, o.modelId)
    onClose()
  }

  return createPortal(
    <div
      onClick={onClose}
      className="op-fadeup fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[11vh] pb-4"
      style={{ background: 'oklch(0.1 0.01 70 / 0.55)', backdropFilter: 'blur(3px)' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="op-scalein w-full max-w-[560px] max-h-[80vh] flex flex-col rounded-2xl border border-line-strong bg-bg1 overflow-hidden"
        style={{ boxShadow: 'var(--shadow)' }}
      >
        <div className="shrink-0 flex items-center gap-2 px-5 pt-3.5 text-[11px] tracking-[.14em] font-semibold text-faint">
          <Mic size={13} className="text-accent" /> Choose a voice
        </div>

        <VoiceModelList variant="modal" onChoose={choose} />

        <div className="shrink-0 flex items-center justify-between px-5 py-3 bg-bg2 border-t border-line">
          <span className="font-mono text-[10.5px] tracking-[.04em] text-faint">{total}</span>
          <button
            onClick={() => { onClose(); openSettings('voice') }}
            className="op-hover-lift flex items-center gap-1.5 text-[12px] font-semibold text-accent"
          >
            Voice settings <ArrowRight size={13} />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
