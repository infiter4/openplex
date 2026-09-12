import Dexie, { type Table } from 'dexie'
import type { Memory, Message, Thread } from './types'

class OpenplexDB extends Dexie {
  threads!: Table<Thread, string>
  messages!: Table<Message, string>
  memories!: Table<Memory, string>
  kv!: Table<{ key: string; value: unknown }, string>
  /** Last state we know the server had, per record — the base for three-way merges. */
  shadow!: Table<ShadowRow, string>

  constructor() {
    super('openplex')
    this.version(1).stores({
      threads: 'id, updatedAt, dirty',
      messages: 'id, threadId, createdAt, updatedAt, dirty',
      memories: 'id, updatedAt, dirty',
      kv: 'key',
    })
    this.version(2).stores({
      threads: 'id, updatedAt, dirty',
      messages: 'id, threadId, createdAt, updatedAt, dirty',
      memories: 'id, updatedAt, dirty',
      kv: 'key',
      shadow: 'key',
    })
  }
}

export interface ShadowRow {
  /** `${kind}:${recordId}` */
  key: string
  data: unknown
  /** updatedAt of the record when we last saw it on the server. */
  at: number
}

export const db = new OpenplexDB()

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const row = await db.kv.get(key)
  return row?.value as T | undefined
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await db.kv.put({ key, value })
}

export async function shadowGet(key: string): Promise<ShadowRow | undefined> {
  return db.shadow.get(key)
}

export async function shadowPut(key: string, data: unknown, at: number): Promise<void> {
  await db.shadow.put({ key, data, at })
}

export async function wipeLocalData(): Promise<void> {
  await db.delete()
  for (const k of Object.keys(localStorage)) {
    if (k.startsWith('opx.')) localStorage.removeItem(k)
  }
}
