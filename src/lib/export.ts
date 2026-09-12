import { db } from './db'
import { saveText } from './save'
import type { Memory, Message, Thread } from './types'

export function threadToMarkdown(thread: Thread, messages: Message[], modelName: (m: Message) => string): string {
  const lines: string[] = [`# ${thread.title}`, '', `_Exported from openplex on ${new Date().toLocaleString()}_`, '']
  for (const m of messages.filter((m) => !m.deleted)) {
    lines.push(m.role === 'user' ? `## You` : `## ${modelName(m)}`)
    lines.push('')
    lines.push(m.content)
    if (m.sources?.length) {
      lines.push('', '**Sources**', '')
      m.sources.forEach((s, i) => lines.push(`${i + 1}. [${s.title}](${s.url})`))
    }
    lines.push('')
  }
  return lines.join('\n')
}

export function exportThreadMarkdown(thread: Thread, messages: Message[], modelName: (m: Message) => string): void {
  const safe = thread.title.replace(/[^a-z0-9-_ ]/gi, '').trim().replace(/\s+/g, '-').toLowerCase() || 'thread'
  void saveText(`${safe}.md`, threadToMarkdown(thread, messages, modelName), 'text/markdown')
}

export interface ExportBundle {
  app: 'openplex'
  version: 1
  exportedAt: number
  threads: Thread[]
  messages: Message[]
  memories: Memory[]
}

export async function exportAll(): Promise<void> {
  const bundle: ExportBundle = {
    app: 'openplex',
    version: 1,
    exportedAt: Date.now(),
    threads: await db.threads.toArray(),
    messages: await db.messages.toArray(),
    memories: await db.memories.toArray(),
  }
  void saveText(`openplex-export-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(bundle, null, 2), 'application/json')
}

export async function importBundle(json: string): Promise<{ threads: number; messages: number; memories: number }> {
  const bundle = JSON.parse(json) as ExportBundle
  if (bundle.app !== 'openplex' || !Array.isArray(bundle.threads)) throw new Error('Not an openplex export file')
  const counts = { threads: 0, messages: 0, memories: 0 }
  await db.transaction('rw', db.threads, db.messages, db.memories, async () => {
    for (const t of bundle.threads) {
      const existing = await db.threads.get(t.id)
      if (!existing || (t.updatedAt ?? 0) > existing.updatedAt) {
        await db.threads.put({ ...t, dirty: 1 })
        counts.threads++
      }
    }
    for (const m of bundle.messages) {
      const existing = await db.messages.get(m.id)
      if (!existing || (m.updatedAt ?? 0) > existing.updatedAt) {
        await db.messages.put({ ...m, dirty: 1 })
        counts.messages++
      }
    }
    for (const m of bundle.memories ?? []) {
      const existing = await db.memories.get(m.id)
      if (!existing || (m.updatedAt ?? 0) > existing.updatedAt) {
        await db.memories.put({ ...m, dirty: 1 })
        counts.memories++
      }
    }
  })
  return counts
}
