import {
  Check,
  Copy,
  Download,
  Folder,
  FolderInput,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { IconArchive, IconEdit, IconMore, IconPin } from './icons'
import { useEffect, useMemo, useRef, useState } from 'react'
import { modelDisplayName } from '../lib/catalog'
import { db } from '../lib/db'
import { exportThreadMarkdown, threadToMarkdown } from '../lib/export'
import type { Thread } from '../lib/types'
import { copyText, cx, dateGroupOf, timeAgo, type DateGroup } from '../lib/utils'
import { useProviders } from '../state/providers'
import { useStore, visibleThreads } from '../state/store'
import { toast } from '../state/toasts'
import { Dropdown, MenuItem } from './ui'

const microLabel = 'text-[10px] tracking-[.16em] font-semibold text-faint uppercase'

function ConvRow({ thread }: { thread: Thread }) {
  const selectThread = useStore((s) => s.selectThread)
  const renameThread = useStore((s) => s.renameThread)
  const setThreadFolder = useStore((s) => s.setThreadFolder)
  const togglePin = useStore((s) => s.togglePin)
  const toggleArchive = useStore((s) => s.toggleArchive)
  const deleteThread = useStore((s) => s.deleteThread)
  const catalog = useProviders((s) => s.catalog)

  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [editMode, setEditMode] = useState<null | 'rename' | 'folder'>(null)
  const [draft, setDraft] = useState(thread.title)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const menuBtn = useRef<HTMLButtonElement>(null)

  const commitEdit = () => {
    const mode = editMode
    setEditMode(null)
    if (mode === 'rename') {
      if (draft.trim() && draft.trim() !== thread.title) renameThread(thread.id, draft)
    } else if (mode === 'folder') {
      if (draft.trim() !== (thread.folder ?? '')) setThreadFolder(thread.id, draft)
    }
  }

  const startEdit = (mode: 'rename' | 'folder') => {
    setMenuAnchor(null)
    setDraft(mode === 'rename' ? thread.title : thread.folder ?? '')
    setEditMode(mode)
  }

  const loadMessages = async () => {
    const msgs = await db.messages.where('threadId').equals(thread.id).sortBy('createdAt')
    return msgs.filter((m) => !m.deleted)
  }

  const copyMarkdown = async () => {
    setMenuAnchor(null)
    const msgs = await loadMessages()
    const md = threadToMarkdown(thread, msgs, (m) => modelDisplayName(catalog, m.model))
    const ok = await copyText(md)
    toast[ok ? 'success' : 'error'](ok ? 'Conversation copied as Markdown' : 'Copy failed')
  }

  if (editMode) {
    return (
      <div className="rounded-xl border border-accent bg-bg1 p-3">
        <input
          autoFocus
          value={draft}
          placeholder={editMode === 'folder' ? 'Folder name (blank to remove)' : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitEdit()
            if (e.key === 'Escape') setEditMode(null)
          }}
          className="w-full px-2 py-1.5 rounded-lg bg-bg0 border border-line-strong text-[14px] outline-none focus:border-accent"
        />
      </div>
    )
  }

  return (
    <div
      onClick={() => void selectThread(thread.id)}
      className="op-hover-lift group flex items-start gap-3 rounded-xl border border-line bg-bg1 px-4 py-3.5 cursor-pointer transition-colors hover:border-line-strong"
    >
      <button
        onClick={(e) => {
          e.stopPropagation()
          togglePin(thread.id)
        }}
        data-tip={thread.pinned ? 'Unpin' : 'Pin'}
        className={cx('shrink-0 mt-0.5 p-0.5 transition-colors', thread.pinned ? 'text-accent' : 'text-faint hover:text-ink')}
        aria-label={thread.pinned ? 'Unpin' : 'Pin'}
      >
        <IconPin size={15} filled={thread.pinned} />
      </button>

      <div className="flex-1 min-w-0">
        <div className="font-serif text-[15px] leading-snug text-ink truncate min-w-0">{thread.title}</div>
        <div className={cx('mt-1.5 flex items-center gap-2 font-mono text-[11px] text-faint', 'min-w-0')}>
          <span className="truncate">{modelDisplayName(catalog, thread.modelRef)}</span>
          <span aria-hidden>·</span>
          <span className="shrink-0">{timeAgo(thread.updatedAt)}</span>
          {thread.folder && (
            <span className="shrink-0 rounded-md bg-bg3 px-1.5 py-0.5 text-muted normal-case tracking-normal">{thread.folder}</span>
          )}
        </div>
      </div>

      <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <button
          onClick={(e) => {
            e.stopPropagation()
            toggleArchive(thread.id)
            toast.info(thread.archived ? 'Unarchived' : 'Archived')
          }}
          data-tip={thread.archived ? 'Unarchive' : 'Archive'}
          className="grid h-8 w-8 place-items-center rounded-lg text-faint hover:bg-bg3 hover:text-ink transition-colors"
          aria-label={thread.archived ? 'Unarchive' : 'Archive'}
        >
          <IconArchive size={15} />
        </button>
        <button
          ref={menuBtn}
          onClick={(e) => {
            e.stopPropagation()
            setMenuAnchor(menuAnchor ? null : e.currentTarget)
          }}
          data-tip="More"
          className={cx(
            'grid h-8 w-8 place-items-center rounded-lg text-faint hover:bg-bg3 hover:text-ink transition-colors',
            menuAnchor && 'bg-bg3 text-ink',
          )}
          aria-label="Conversation options"
        >
          <IconMore size={15} />
        </button>
      </div>

      {menuAnchor && (
        <Dropdown
          anchor={menuAnchor}
          onClose={() => {
            setMenuAnchor(null)
            setConfirmDelete(false)
          }}
          width={210}
          align="right"
        >
          <div className="py-1" onClick={(e) => e.stopPropagation()}>
            <MenuItem icon={<IconEdit size={13} />} label="Rename" onClick={() => startEdit('rename')} />
            <MenuItem
              icon={<IconPin size={13} filled={false} />}
              label={thread.pinned ? 'Unpin' : 'Pin'}
              onClick={() => {
                setMenuAnchor(null)
                togglePin(thread.id)
              }}
            />
            <MenuItem
              icon={<FolderInput size={13} />}
              label={thread.folder ? 'Move to folder…' : 'Add to folder…'}
              onClick={() => startEdit('folder')}
            />
            {thread.folder && (
              <MenuItem
                icon={<Folder size={13} />}
                label="Remove from folder"
                onClick={() => {
                  setMenuAnchor(null)
                  setThreadFolder(thread.id, undefined)
                }}
              />
            )}
            <MenuItem
              icon={<IconArchive size={13} />}
              label={thread.archived ? 'Unarchive' : 'Archive'}
              onClick={() => {
                setMenuAnchor(null)
                toggleArchive(thread.id)
              }}
            />
            <MenuItem icon={<Copy size={13} />} label="Copy as Markdown" onClick={() => void copyMarkdown()} />
            <MenuItem
              icon={<Download size={13} />}
              label="Export as Markdown"
              onClick={async () => {
                setMenuAnchor(null)
                const msgs = await loadMessages()
                exportThreadMarkdown(thread, msgs, (m) => modelDisplayName(catalog, m.model))
              }}
            />
            <div className="my-1 h-px bg-line" />
            {confirmDelete ? (
              <MenuItem
                icon={<Check size={13} />}
                label="Confirm delete?"
                danger
                onClick={() => {
                  setMenuAnchor(null)
                  void deleteThread(thread.id)
                }}
              />
            ) : (
              <MenuItem icon={<Trash2 size={13} />} label="Delete" danger onClick={() => setConfirmDelete(true)} />
            )}
          </div>
        </Dropdown>
      )}
    </div>
  )
}

interface Section {
  key: string
  label: string
  folder: boolean
  pinned: boolean
  threads: Thread[]
}

export function Library() {
  const threads = useStore((s) => s.threads)
  const selectThread = useStore((s) => s.selectThread)
  const setSurface = useStore((s) => s.setSurface)

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<string>('all')
  const [contentIds, setContentIds] = useState<Set<string> | null>(null)

  // Full-text search over message contents (debounced, only for queries >= 3 chars).
  useEffect(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 3) {
      setContentIds(null)
      return
    }
    const t = setTimeout(async () => {
      const ids = new Set<string>()
      await db.messages
        .filter((m) => !m.deleted && m.content.toLowerCase().includes(q))
        .until(() => ids.size >= 8)
        .each((m) => void ids.add(m.threadId))
      setContentIds(ids)
    }, 180)
    return () => clearTimeout(t)
  }, [query])

  const folders = useMemo(() => {
    const set = new Set<string>()
    for (const t of threads) if (!t.deleted && !t.archived && t.folder) set.add(t.folder)
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [threads])

  const archivedCount = useMemo(() => threads.filter((t) => t.archived && !t.deleted).length, [threads])

  const sections = useMemo<Section[]>(() => {
    const q = query.trim().toLowerCase()
    const matches = (t: Thread) =>
      !q || t.title.toLowerCase().includes(q) || (contentIds?.has(t.id) ?? false)

    if (filter === 'archived') {
      const list = threads.filter((t) => t.archived && !t.deleted && matches(t)).sort((a, b) => b.updatedAt - a.updatedAt)
      return list.length ? [{ key: 'archived', label: 'Archived', folder: false, pinned: false, threads: list }] : []
    }

    let list = visibleThreads(threads).filter(matches)
    if (filter === 'pinned') list = list.filter((t) => t.pinned)
    else if (filter !== 'all') list = list.filter((t) => t.folder === filter)

    const pinned = list.filter((t) => t.pinned)
    const byFolder = new Map<string, Thread[]>()
    const byDate = new Map<DateGroup, Thread[]>()
    for (const t of list) {
      if (t.pinned) continue
      if (t.folder) {
        if (!byFolder.has(t.folder)) byFolder.set(t.folder, [])
        byFolder.get(t.folder)!.push(t)
      } else {
        const g = dateGroupOf(t.updatedAt)
        if (!byDate.has(g)) byDate.set(g, [])
        byDate.get(g)!.push(t)
      }
    }

    const out: Section[] = []
    if (pinned.length) out.push({ key: 'pinned', label: 'Pinned', folder: false, pinned: true, threads: pinned })
    for (const name of [...byFolder.keys()].sort((a, b) => a.localeCompare(b)))
      out.push({ key: 'f:' + name, label: name, folder: true, pinned: false, threads: byFolder.get(name)! })
    const ordered: DateGroup[] = ['Today', 'Yesterday', 'This week', 'This month', 'Older']
    for (const g of ordered)
      if (byDate.has(g)) out.push({ key: 'd:' + g, label: g, folder: false, pinned: false, threads: byDate.get(g)! })
    return out
  }, [threads, query, contentIds, filter])

  const chips: { id: string; label: string }[] = [
    { id: 'all', label: 'All' },
    ...folders.map((f) => ({ id: f, label: f })),
    { id: 'pinned', label: 'Pinned' },
    ...(archivedCount ? [{ id: 'archived', label: 'Archived' }] : []),
  ]

  const empty = sections.length === 0

  return (
    <div className="op-fadeup h-full overflow-y-auto bg-bg0">
      <div className="mx-auto w-full max-w-[900px] px-6 pt-8 pb-16">
        {/* header */}
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-serif text-[30px] leading-none text-ink">Library</h1>
            <p className="mt-1.5 text-[13.5px] text-muted">Resume, search the full text, and organize your thinking.</p>
          </div>
          <button
            onClick={() => {
              setSurface('stage')
              void selectThread(null)
            }}
            className="op-hover-lift inline-flex h-9 items-center gap-1.5 rounded-xl bg-accent px-3.5 text-[13px] font-semibold text-accent-ink hover:bg-accent-hover transition-colors"
          >
            <Plus size={15} />
            New
          </button>
        </div>

        {/* search + filter chips */}
        <div className="mb-5 flex flex-wrap items-center gap-2.5">
          <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-xl border border-line bg-bg1 px-3 focus-within:border-line-strong transition-colors">
            <Search size={15} className="shrink-0 text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQuery('')
              }}
              placeholder="Search titles and message contents…"
              className="min-w-0 flex-1 bg-transparent py-2.5 text-[14px] outline-none"
            />
            {query && (
              <button onClick={() => setQuery('')} className="shrink-0 text-faint hover:text-ink" aria-label="Clear search">
                <X size={14} />
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <button
                key={c.id}
                onClick={() => setFilter(c.id)}
                className={cx(
                  'op-hover-lift h-8 rounded-full px-3 text-[12.5px] font-medium border transition-colors',
                  filter === c.id
                    ? 'bg-accent text-accent-ink border-accent'
                    : 'bg-bg2 text-muted border-line hover:text-ink hover:bg-bg3',
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* empty state */}
        {empty ? (
          <div className="py-20 text-center">
            <div className="mb-1.5 font-serif text-[19px] text-ink">Nothing here yet</div>
            <div className="text-[13.5px] text-muted">
              {query.trim() ? 'No conversations match. Try a different search or clear it.' : 'Start a new conversation to fill your library.'}
            </div>
          </div>
        ) : (
          sections.map((sec) => (
            <section key={sec.key} className="mb-7">
              <div className={cx('mb-3 flex items-center gap-2', sec.pinned ? 'text-accent' : '')}>
                {sec.pinned && <IconPin size={12} filled className="text-accent" />}
                {sec.folder && <Folder size={12} className="text-accent" />}
                <span className={cx(microLabel, sec.pinned && 'text-accent')}>{sec.label}</span>
                <span className="font-mono text-[10px] text-faint">{sec.threads.length}</span>
              </div>
              <div className="flex flex-col gap-2.5">
                {sec.threads.map((t) => (
                  <ConvRow key={t.id} thread={t} />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  )
}
