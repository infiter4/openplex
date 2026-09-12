import { Keyboard, MessageSquare, MessageSquarePlus, Moon, Search, Settings, Stethoscope, Sun } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { db } from '../lib/db'
import type { Thread } from '../lib/types'
import { cx, timeAgo } from '../lib/utils'
import { useSettings } from '../state/settings'
import { useStore, visibleThreads } from '../state/store'

interface Item {
  id: string
  icon: ReactNode
  label: string
  hint?: string
  action: () => void
}

export function CommandPalette() {
  const open = useStore((s) => s.paletteOpen)
  const setOpen = useStore((s) => s.setPaletteOpen)
  const threads = useStore((s) => s.threads)
  const selectThread = useStore((s) => s.selectThread)
  const openSettings = useStore((s) => s.openSettings)
  const openRepair = useStore((s) => s.openRepair)
  const setShortcutsOpen = useStore((s) => s.setShortcutsOpen)
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)

  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const [contentHits, setContentHits] = useState<Thread[]>([])
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setSel(0)
      setContentHits([])
    }
  }, [open])

  useEffect(() => {
    if (!open || query.trim().length < 3) {
      setContentHits([])
      return
    }
    const q = query.trim().toLowerCase()
    const t = setTimeout(async () => {
      const matchIds = new Set<string>()
      await db.messages
        .filter((m) => !m.deleted && m.content.toLowerCase().includes(q))
        .until(() => matchIds.size >= 8)
        .each((m) => void matchIds.add(m.threadId))
      const all = visibleThreads(useStore.getState().threads)
      setContentHits(all.filter((t) => matchIds.has(t.id)))
    }, 180)
    return () => clearTimeout(t)
  }, [query, open])

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase()
    const actions: Item[] = [
      {
        id: 'new',
        icon: <MessageSquarePlus size={15} />,
        label: 'New chat',
        hint: 'Ctrl+Shift+O',
        action: () => void selectThread(null),
      },
      {
        id: 'theme',
        icon: settings.theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />,
        label: `Switch to ${settings.theme === 'dark' ? 'light' : 'dark'} theme`,
        action: () => update({ theme: settings.theme === 'dark' ? 'light' : 'dark' }),
      },
      { id: 'settings', icon: <Settings size={15} />, label: 'Open settings', action: () => openSettings() },
      { id: 'repair', icon: <Stethoscope size={15} />, label: 'Repair a broken provider', action: () => openRepair() },
      { id: 'shortcuts', icon: <Keyboard size={15} />, label: 'Keyboard shortcuts', action: () => setShortcutsOpen(true) },
    ].filter((a) => !q || a.label.toLowerCase().includes(q))

    const titleMatches = visibleThreads(threads).filter((t) => !q || t.title.toLowerCase().includes(q))
    const seen = new Set(titleMatches.map((t) => t.id))
    const extra = contentHits.filter((t) => !seen.has(t.id))
    const threadItems: Item[] = [...titleMatches.slice(0, 8), ...extra.slice(0, 6)].map((t) => ({
      id: `t-${t.id}`,
      icon: <MessageSquare size={15} />,
      label: t.title,
      hint: timeAgo(t.updatedAt),
      action: () => void selectThread(t.id),
    }))

    return [...actions, ...threadItems]
  }, [query, threads, contentHits, settings.theme, selectThread, openSettings, openRepair, update, setShortcutsOpen])

  useEffect(() => {
    setSel((s) => Math.min(s, Math.max(0, items.length - 1)))
  }, [items.length])

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${sel}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  if (!open) return null

  const run = (item: Item) => {
    setOpen(false)
    item.action()
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] bg-black/55 backdrop-blur-[2px] anim-fade flex items-start justify-center p-4 pt-[14vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false)
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search and commands"
        className="anim-scale w-full max-w-[560px] rounded-2xl border border-line-strong bg-bg1 overflow-hidden"
        style={{ boxShadow: 'var(--shadow)' }}
      >
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-line">
          <Search size={15} className="text-faint shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search threads, messages, and actions…"
            className="flex-1 bg-transparent outline-none text-[14px]"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSel((s) => Math.min(s + 1, items.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSel((s) => Math.max(s - 1, 0))
              } else if (e.key === 'Enter' && items[sel]) {
                run(items[sel])
              } else if (e.key === 'Escape') {
                setOpen(false)
              }
            }}
          />
          <kbd>esc</kbd>
        </div>
        <div ref={listRef} className="max-h-[380px] overflow-y-auto py-1.5">
          {items.length === 0 && <div className="px-4 py-8 text-center text-[13px] text-muted">Nothing found.</div>}
          {items.map((item, i) => (
            <button
              key={item.id}
              data-idx={i}
              onMouseEnter={() => setSel(i)}
              onClick={() => run(item)}
              className={cx(
                'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors',
                i === sel ? 'bg-bg2' : '',
              )}
            >
              <span className="text-muted shrink-0">{item.icon}</span>
              <span className="flex-1 truncate text-[13.5px]">{item.label}</span>
              {item.hint && <span className="text-[11px] text-faint shrink-0">{item.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
