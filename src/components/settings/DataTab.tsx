import { Download, Trash2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { exportAll, importBundle } from '../../lib/export'
import { wipeLocalData } from '../../lib/db'
import { useStore } from '../../state/store'
import { toast } from '../../state/toasts'
import { btnCls, SectionLabel } from '../ui'
import { cx } from '../../lib/utils'

export function DataTab() {
  const fileRef = useRef<HTMLInputElement>(null)
  const reloadFromDb = useStore((s) => s.reloadFromDb)
  const [confirmWipe, setConfirmWipe] = useState(false)

  return (
    <div>
      <SectionLabel>Backup</SectionLabel>
      <div className="flex gap-2 mb-2">
        <button onClick={() => void exportAll()} className={btnCls}>
          <Download size={13} /> Export everything (JSON)
        </button>
        <button onClick={() => fileRef.current?.click()} className={btnCls}>
          <Upload size={13} /> Import
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (!file) return
            try {
              const counts = await importBundle(await file.text())
              await reloadFromDb()
              toast.success('Import complete', `${counts.threads} threads, ${counts.messages} messages, ${counts.memories} memories merged.`)
            } catch (err) {
              toast.error('Import failed', (err as Error).message)
            }
          }}
        />
      </div>
      <p className="text-[12px] text-faint leading-relaxed mb-6">
        Exports include threads, messages, and memories — not API keys. Imports merge by id; the newer copy wins.
      </p>

      <SectionLabel>Danger zone</SectionLabel>
      <button
        onClick={async () => {
          if (!confirmWipe) {
            setConfirmWipe(true)
            setTimeout(() => setConfirmWipe(false), 4000)
            return
          }
          await wipeLocalData()
          window.location.href = '/'
        }}
        className={cx(btnCls, 'border-danger/40 text-danger hover:bg-danger/10')}
      >
        <Trash2 size={13} />
        {confirmWipe ? 'Click again to confirm — erases this device' : 'Wipe local data'}
      </button>
      <p className="text-[12px] text-faint leading-relaxed mt-2">
        Clears chats, memories, settings, and keys from this browser. Data already synced to your Supabase project is
        not touched and will sync back if you sign in again.
      </p>
    </div>
  )
}
