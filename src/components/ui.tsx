import { X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cx } from '../lib/utils'

export function Modal(props: {
  open: boolean
  onClose: () => void
  children: ReactNode
  width?: number
  title?: ReactNode
  noPad?: boolean
}) {
  const { open, onClose } = props
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 anim-fade backdrop-blur-[2px] p-4 pt-[8vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="anim-scale w-full rounded-2xl border border-line-strong bg-bg1 overflow-hidden flex flex-col max-h-[80vh]"
        style={{ maxWidth: props.width ?? 560, boxShadow: 'var(--shadow)' }}
        role="dialog"
        aria-modal
      >
        {props.title != null && (
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-line shrink-0">
            <div className="font-semibold text-[15px]">{props.title}</div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-muted hover:text-ink hover:bg-bg2 transition-colors"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        )}
        <div className={cx('overflow-y-auto', !props.noPad && 'p-5')}>{props.children}</div>
      </div>
    </div>,
    document.body,
  )
}

export function Dropdown(props: {
  anchor: HTMLElement | null
  onClose: () => void
  children: ReactNode
  align?: 'left' | 'right'
  width?: number
  maxHeight?: number
}) {
  const { anchor, onClose } = props
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  const [width, setWidth] = useState(props.width ?? 240)
  const [maxH, setMaxH] = useState(props.maxHeight ?? 420)
  useLayoutEffect(() => {
    if (!anchor) return
    const place = () => {
      const r = anchor.getBoundingClientRect()
      // visualViewport is the honest size on a phone — window.innerHeight ignores the on-screen
      // keyboard, which would otherwise put the panel under it.
      const vv = window.visualViewport
      const vw = vv?.width ?? window.innerWidth
      const vh = vv?.height ?? window.innerHeight
      const width = Math.min(props.width ?? 240, vw - 16)
      setWidth(width)

      const room = Math.max(r.top - 14, vh - r.bottom - 14)
      const maxHeight = Math.min(props.maxHeight ?? 420, Math.max(160, room))
      setMaxH(maxHeight)

      let left = props.align === 'right' ? r.right - width : r.left
      left = Math.max(8, Math.min(left, vw - width - 8))
      let top = r.bottom + 6
      if (top + maxHeight > vh - 8) {
        const above = r.top - 6 - maxHeight
        top = above > 8 ? above : Math.max(8, vh - maxHeight - 8)
      }
      setPos({ top, left })
    }
    place()
    // A fixed panel keeps its viewport coordinates while the page moves under it, so re-place it
    // on anything that changes the geometry rather than letting it drift off the anchor.
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    window.visualViewport?.addEventListener('resize', place)
    window.visualViewport?.addEventListener('scroll', place)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      window.visualViewport?.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('scroll', place)
    }
  }, [anchor, props.align, props.width, props.maxHeight])

  useEffect(() => {
    if (!anchor) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [anchor, onClose])

  if (!anchor || !pos) return anchor ? <div ref={ref} /> : null
  return createPortal(
    <div
      ref={ref}
      // overflow-y-auto, not hidden: with a max height, hidden silently cuts off anything taller
      // and leaves no way to reach it.
      className="fixed z-50 anim-scale rounded-xl border border-line-strong bg-bg1 overflow-x-hidden overflow-y-auto overscroll-contain flex flex-col"
      style={{ top: pos.top, left: pos.left, width, maxHeight: maxH, boxShadow: 'var(--shadow)' }}
    >
      {props.children}
    </div>,
    document.body,
  )
}

export function MenuItem(props: {
  icon?: ReactNode
  label: string
  onClick: () => void
  danger?: boolean
  hint?: string
}) {
  return (
    <button
      onClick={props.onClick}
      className={cx(
        'flex items-center gap-2.5 w-full px-3 py-2 text-[13px] text-left transition-colors',
        props.danger ? 'text-danger hover:bg-danger/10' : 'text-ink hover:bg-bg2',
      )}
    >
      {props.icon && <span className={cx('shrink-0', props.danger ? 'text-danger' : 'text-muted')}>{props.icon}</span>}
      <span className="flex-1 truncate">{props.label}</span>
      {props.hint && <span className="text-faint text-[11px]">{props.hint}</span>}
    </button>
  )
}

export function Switch(props: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={props.checked}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
      className={cx(
        'relative w-[34px] h-[20px] rounded-full transition-colors shrink-0 disabled:opacity-40',
        props.checked ? 'bg-accent' : 'bg-bg3',
      )}
    >
      <span
        className="absolute top-[2px] w-4 h-4 rounded-full bg-white transition-all shadow-sm"
        style={{ left: props.checked ? 16 : 2 }}
      />
    </button>
  )
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span
      className="inline-block rounded-full border-2 border-line-strong animate-spin"
      style={{ width: size, height: size, borderTopColor: 'var(--accent)' }}
    />
  )
}

const AVATAR_COLORS = ['#e07a5f', '#81b29a', '#f2cc8f', '#6a8caf', '#b07bac', '#5fa8d3', '#c97b63', '#7fb069']

export function ProviderLogo({ id, name, size = 20 }: { id: string; name: string; size?: number }) {
  const [failed, setFailed] = useState(false)
  const letter = (name || id).charAt(0).toUpperCase()
  const color = AVATAR_COLORS[Math.abs([...id].reduce((h, c) => h * 31 + c.charCodeAt(0), 7)) % AVATAR_COLORS.length]
  if (failed) {
    return (
      <span
        className="inline-flex items-center justify-center rounded-md font-semibold text-white shrink-0"
        style={{ width: size, height: size, background: color, fontSize: size * 0.55 }}
      >
        {letter}
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center justify-center rounded-md shrink-0 overflow-hidden"
      style={{ width: size, height: size, background: '#f4f4f2', padding: Math.max(1, size * 0.12) }}
    >
      <img
        src={`https://models.dev/logos/${id}.svg`}
        alt=""
        className="w-full h-full object-contain"
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </span>
  )
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="text-[11px] font-semibold uppercase tracking-wider text-faint px-1 mb-2">{children}</div>
}

export function Field(props: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block mb-4">
      <div className="text-[13px] font-medium mb-1.5">{props.label}</div>
      {props.children}
      {props.hint && <div className="text-[12px] text-faint mt-1.5 leading-relaxed">{props.hint}</div>}
    </label>
  )
}

export const inputCls =
  'w-full px-3 py-2 rounded-lg bg-bg0 border border-line-strong text-[13.5px] transition-colors focus:border-accent focus:outline-none'

export const btnCls =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium border border-line-strong bg-bg2 hover:bg-bg3 transition-colors disabled:opacity-40'

export const btnPrimaryCls =
  'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[13px] font-semibold bg-accent text-accent-ink hover:bg-accent-hover transition-colors disabled:opacity-40'
