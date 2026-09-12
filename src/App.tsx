import { useEffect } from 'react'
import { CommandPalette } from './components/CommandPalette'
import { Library } from './components/Library'
import { Masthead } from './components/Masthead'
import { Models } from './components/Models'
import { ModelPickerOverlay } from './components/ModelPickerOverlay'
import { Rail, MobileDock } from './components/Rail'
import { Settings } from './components/Settings'
import { ShortcutsModal } from './components/ShortcutsModal'
import { ConflictModal } from './components/ConflictModal'
import { SourcesPanel } from './components/SourcesPanel'
import { Stage } from './components/stage/Stage'
import { CompareOverlay } from './components/stage/Compare'
import { FileViewer } from './components/FileViewer'
import { Toasts } from './components/Toasts'
import { useStore } from './state/store'

function useHashRoute() {
  const selectThread = useStore((s) => s.selectThread)
  useEffect(() => {
    const apply = () => {
      const m = window.location.hash.match(/^#\/t\/([\w-]+)/)
      const id = m?.[1] ?? null
      if (id !== useStore.getState().activeThreadId) {
        const exists = id && useStore.getState().threads.some((t) => t.id === id && !t.deleted)
        void selectThread(exists ? id : null)
      }
    }
    window.addEventListener('hashchange', apply)
    return () => window.removeEventListener('hashchange', apply)
  }, [selectThread])
}

function StreamBar() {
  const streaming = useStore((s) => s.streaming)
  if (!streaming) return null
  return (
    <div className="fixed top-0 left-0 right-0 h-[2px] z-[80] overflow-hidden pointer-events-none">
      <div className="stream-bar h-full w-full" />
    </div>
  )
}

function useKeyboardShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      const s = useStore.getState()
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        s.setPaletteOpen(!s.paletteOpen)
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        void s.selectThread(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

function Surface() {
  const surface = useStore((s) => s.surface)
  if (surface === 'stage') return <Stage />
  if (surface === 'library') return <div className="flex-1 min-h-0 overflow-y-auto"><Library /></div>
  if (surface === 'models') return <div className="flex-1 min-h-0 overflow-y-auto"><Models /></div>
  return <div className="flex-1 min-h-0 overflow-y-auto"><Settings /></div>
}

export default function App() {
  const ready = useStore((s) => s.ready)
  const init = useStore((s) => s.init)
  const selectThread = useStore((s) => s.selectThread)

  useHashRoute()
  useKeyboardShortcuts()

  useEffect(() => {
    void init().then(() => {
      const m = window.location.hash.match(/^#\/t\/([\w-]+)/)
      const id = m?.[1]
      if (id && useStore.getState().threads.some((t) => t.id === id && !t.deleted)) void selectThread(id)
    })
  }, [init, selectThread])

  if (!ready) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="font-serif italic text-[20px] text-faint anim-fade">
          open<span className="text-accent">plex</span>
        </span>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden relative">
      <div className="op-drift" />
      <div className="op-grain" />
      <StreamBar />
      <div className="flex-1 flex min-h-0 relative z-[1]">
        <Rail />
        <main className="flex-1 flex flex-col min-w-0 relative">
          <Masthead />
          <div className="flex-1 min-h-0 relative flex flex-col">
            <Surface />
          </div>
        </main>
        <SourcesPanel />
      </div>
      <MobileDock />

      <ModelPickerOverlay />
      <CompareOverlay />
      <FileViewer />
      <CommandPalette />
      <ShortcutsModal />
      <ConflictModal />
      <Toasts />
    </div>
  )
}
