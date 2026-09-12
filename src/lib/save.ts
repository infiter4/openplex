import { Capacitor } from '@capacitor/core'
import { toast } from '../state/toasts'

function sanitize(name: string): string {
  const cleaned = name.replace(/[/\\]+/g, '_').trim()
  return cleaned || 'file'
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const s = String(reader.result)
      resolve(s.slice(s.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

async function saveNative(blob: Blob, filename: string): Promise<void> {
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share'),
  ])
  const path = sanitize(filename)
  const data = await blobToBase64(blob)
  await Filesystem.writeFile({ path, data, directory: Directory.Cache })
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache })
  try {
    await Share.share({ title: filename, url: uri, dialogTitle: `Save ${filename}` })
  } catch (err) {
    // Dismissing the share sheet rejects — that's a cancel, not a failure.
    if (!/cancel/i.test(String((err as Error)?.message ?? ''))) throw err
  }
}

function saveWeb(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export async function saveBlob(blob: Blob, filename: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      await saveNative(blob, filename)
    } catch (err) {
      toast.error('Couldn’t save file', (err as Error)?.message ?? 'Unknown error')
    }
    return
  }
  saveWeb(blob, filename)
}

export async function saveText(filename: string, content: string, mime = 'text/plain'): Promise<void> {
  await saveBlob(new Blob([content], { type: mime }), filename)
}
