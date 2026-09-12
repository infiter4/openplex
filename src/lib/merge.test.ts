import { describe, expect, it } from 'vitest'
import { merge3, mergeKeyedMap, mergeListBy, sameValue, type MergeRule } from './merge'

const RULES: Record<string, MergeRule> = {
  title: { kind: 'text', label: 'Title' },
  systemPrompt: { kind: 'text', label: 'System prompt' },
  deleted: { kind: 'flagTrue' },
  pinned: { kind: 'flagTrue' },
  variants: { kind: 'longer' },
}

const run = (base: any, local: any, remote: any, localNewer = true) =>
  merge3(base, local, remote, RULES, { localNewer })

describe('merge3', () => {
  it('keeps each side’s change when they touched different fields', () => {
    const base = { title: 'Trip', systemPrompt: 'be brief', temperature: 0.7 }
    const local = { title: 'Trip to Rome', systemPrompt: 'be brief', temperature: 0.7 }
    const remote = { title: 'Trip', systemPrompt: 'be brief', temperature: 1 }
    const { merged, conflicts } = run(base, local, remote)
    expect(conflicts).toEqual([])
    expect(merged).toEqual({ title: 'Trip to Rome', systemPrompt: 'be brief', temperature: 1 })
  })

  it('does not resurrect a value the other device deliberately changed', () => {
    // Regression against last-write-wins: local never touched the prompt, so remote's edit stands
    // even though the local record is the newer one.
    const { merged } = run({ systemPrompt: 'old' }, { systemPrompt: 'old' }, { systemPrompt: 'new' }, true)
    expect(merged.systemPrompt).toBe('new')
  })

  it('raises a conflict only when both sides moved the same text field', () => {
    const { merged, conflicts } = run({ title: 'A' }, { title: 'B' }, { title: 'C' })
    expect(conflicts).toEqual([{ field: 'title', label: 'Title', local: 'B', remote: 'C' }])
    expect(merged.title).toBe('B') // provisional until the user picks
  })

  it('never conflicts when both sides made the same edit', () => {
    const { conflicts } = run({ title: 'A' }, { title: 'B' }, { title: 'B' })
    expect(conflicts).toEqual([])
  })

  it('lets a deletion stick and a pin survive', () => {
    const { merged, conflicts } = run(
      { deleted: false, pinned: false },
      { deleted: true, pinned: false },
      { deleted: false, pinned: true },
    )
    expect(merged).toEqual({ deleted: true, pinned: true })
    expect(conflicts).toEqual([])
  })

  it('keeps the longer list of answer variants', () => {
    const { merged } = run({ variants: ['a'] }, { variants: ['a', 'b'] }, { variants: ['a', 'c', 'd'] })
    expect(merged.variants).toEqual(['a', 'c', 'd'])
  })

  it('falls back to the newer record for unknown fields', () => {
    expect(run({ x: 1 }, { x: 2 }, { x: 3 }, true).merged.x).toBe(2)
    expect(run({ x: 1 }, { x: 2 }, { x: 3 }, false).merged.x).toBe(3)
  })

  it('treats a missing base as "both sides are new" and still prefers the newer side', () => {
    const { merged, conflicts } = run(undefined, { title: 'B' }, { title: 'C' }, false)
    expect(merged.title).toBe('C')
    expect(conflicts).toHaveLength(1)
  })

  it('skips fields it is told to ignore', () => {
    const { merged } = merge3({ dirty: 0 }, { dirty: 1 }, { dirty: 0 }, RULES, { localNewer: true, skip: ['dirty'] })
    expect(merged.dirty).toBe(1)
  })
})

describe('mergeKeyedMap', () => {
  it('keeps repairs added on either device', () => {
    const base = { openai: { note: 'a', updatedAt: 1 } }
    const local = { openai: { note: 'a', updatedAt: 1 }, zai: { note: 'phone fix', updatedAt: 5 } }
    const remote = { openai: { note: 'a', updatedAt: 1 }, groq: { note: 'pc fix', updatedAt: 6 } }
    expect(mergeKeyedMap(base, local, remote, true)).toEqual({
      openai: { note: 'a', updatedAt: 1 },
      zai: { note: 'phone fix', updatedAt: 5 },
      groq: { note: 'pc fix', updatedAt: 6 },
    })
  })

  it('honours a removal made on the other device', () => {
    const base = { openai: { note: 'a' }, zai: { note: 'b' } }
    const local = { openai: { note: 'a' }, zai: { note: 'b' } }
    const remote = { openai: { note: 'a' } }
    expect(mergeKeyedMap(base, local, remote, true)).toEqual({ openai: { note: 'a' } })
  })

  it('prefers the entry with the newer updatedAt when both edited the same provider', () => {
    const base = { zai: { baseUrl: 'old', updatedAt: 1 } }
    const local = { zai: { baseUrl: 'from-phone', updatedAt: 10 } }
    const remote = { zai: { baseUrl: 'from-pc', updatedAt: 20 } }
    expect(mergeKeyedMap(base, local, remote, true)).toEqual({ zai: { baseUrl: 'from-pc', updatedAt: 20 } })
  })
})

describe('mergeListBy', () => {
  const byId = mergeListBy((x: any) => x.id)

  it('unions additions from both devices', () => {
    const out = byId([{ id: 'a' }], [{ id: 'a' }, { id: 'b' }], [{ id: 'a' }, { id: 'c' }], true) as any[]
    expect(out.map((x) => x.id)).toEqual(['a', 'b', 'c'])
  })

  it('honours a deletion of an entry that existed in the base', () => {
    const out = byId([{ id: 'a' }, { id: 'b' }], [{ id: 'a' }, { id: 'b' }], [{ id: 'a' }], true) as any[]
    expect(out.map((x) => x.id)).toEqual(['a'])
  })
})

describe('sameValue', () => {
  it('compares structurally and treats null/undefined as equal', () => {
    expect(sameValue({ a: [1, 2] }, { a: [1, 2] })).toBe(true)
    expect(sameValue(undefined, null)).toBe(true)
    expect(sameValue({ a: 1 }, { a: 2 })).toBe(false)
  })
})
