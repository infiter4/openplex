/**
 * Three-way merge for sync.
 *
 * Until now sync was last-write-wins: whichever device pushed last silently overwrote the other.
 * Edit a thread's prompt on the PC while the phone renames it and one of those edits just vanished.
 *
 * With the last-synced value as a base we can tell "changed here" from "unchanged here", which
 * settles the overwhelming majority of disagreements without asking anyone: if only one side moved
 * a field, that side wins. Only when BOTH sides moved the same field to different values is there
 * a real conflict — and those go to the user, who picks the version to keep.
 */

export type MergeRule =
  /** User-authored content. Both sides changed it -> ask. */
  | { kind: 'text'; label: string }
  /** Low-stakes preference. Both sides changed it -> the more recently touched record wins. */
  | { kind: 'newer' }
  /** Tombstones, pins, archive flags: a true anywhere sticks. */
  | { kind: 'flagTrue' }
  /** Append-mostly lists (answer variants): keep whichever side has more. */
  | { kind: 'longer' }
  /** Anything with its own shape (per-key maps, keyed lists). */
  | { kind: 'custom'; merge: (base: unknown, local: unknown, remote: unknown, localNewer: boolean) => unknown }

export interface FieldConflict {
  field: string
  /** Human label for the conflict card. */
  label: string
  local: unknown
  remote: unknown
}

export interface MergeResult<T> {
  merged: T
  conflicts: FieldConflict[]
}

/** Structural equality good enough for the shapes we sync (JSON-ish records). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  if (typeof a !== 'object' || typeof b !== 'object') return false
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Merge `local` and `remote`, both descended from `base`. Fields absent from `rules` fall back to
 * `defaultRule` (newer-wins), which keeps unknown//new fields from ever blocking a sync.
 */
export function merge3<T extends Record<string, unknown>>(
  base: Partial<T> | undefined,
  local: T,
  remote: T,
  rules: Record<string, MergeRule>,
  opts: { localNewer: boolean; defaultRule?: MergeRule; skip?: string[] } = { localNewer: true },
): MergeResult<T> {
  const { localNewer } = opts
  const fallback: MergeRule = opts.defaultRule ?? { kind: 'newer' }
  const skip = new Set(opts.skip ?? [])
  const merged: Record<string, unknown> = { ...local }
  const conflicts: FieldConflict[] = []

  for (const field of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    if (skip.has(field)) continue
    const l = local[field]
    const r = remote[field]
    if (sameValue(l, r)) continue

    const b = base?.[field]
    const localMoved = !sameValue(l, b)
    const remoteMoved = !sameValue(r, b)

    // The easy 90%: only one side actually changed, so there is nothing to argue about.
    if (!localMoved) { merged[field] = r; continue }
    if (!remoteMoved) { merged[field] = l; continue }

    const rule = rules[field] ?? fallback
    switch (rule.kind) {
      case 'flagTrue':
        merged[field] = Boolean(l) || Boolean(r)
        break
      case 'longer': {
        const ll = Array.isArray(l) ? l.length : 0
        const rl = Array.isArray(r) ? r.length : 0
        merged[field] = rl > ll ? r : l
        break
      }
      case 'custom':
        merged[field] = rule.merge(b, l, r, localNewer)
        break
      case 'text':
        conflicts.push({ field, label: rule.label, local: l, remote: r })
        merged[field] = localNewer ? l : r // provisional; the user's choice replaces it
        break
      case 'newer':
      default:
        merged[field] = localNewer ? l : r
    }
  }

  return { merged: merged as T, conflicts }
}

// ---- reusable custom mergers ------------------------------------------------------------

/** Union two id-keyed maps, preferring the entry each side changed; ties go to the newer device. */
export function mergeKeyedMap(base: unknown, local: unknown, remote: unknown, localNewer: boolean): unknown {
  if (!isPlainObject(local) || !isPlainObject(remote)) return localNewer ? local : remote
  const b = isPlainObject(base) ? base : {}
  const out: Record<string, unknown> = {}
  for (const k of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const hasL = k in local
    const hasR = k in remote
    if (hasL && !hasR) { if (!(k in b)) out[k] = local[k]; continue } // absent remotely = deleted there, unless it's new here
    if (!hasL && hasR) { if (!(k in b)) out[k] = remote[k]; continue }
    if (sameValue(local[k], remote[k])) { out[k] = local[k]; continue }
    const lMoved = !sameValue(local[k], b[k])
    const rMoved = !sameValue(remote[k], b[k])
    if (!lMoved) out[k] = remote[k]
    else if (!rMoved) out[k] = local[k]
    else out[k] = pickNewerEntry(local[k], remote[k], localNewer)
  }
  return out
}

/** Two versions of one entry: prefer an `updatedAt` if the shape carries one, else the newer device. */
function pickNewerEntry(l: unknown, r: unknown, localNewer: boolean): unknown {
  const lt = isPlainObject(l) && typeof l.updatedAt === 'number' ? l.updatedAt : undefined
  const rt = isPlainObject(r) && typeof r.updatedAt === 'number' ? r.updatedAt : undefined
  if (lt != null && rt != null) return lt >= rt ? l : r
  return localNewer ? l : r
}

/** Union two lists of objects/refs by identity, keeping each side's additions. */
export function mergeListBy(idOf: (x: unknown) => string) {
  return (base: unknown, local: unknown, remote: unknown, localNewer: boolean): unknown => {
    if (!Array.isArray(local) || !Array.isArray(remote)) return localNewer ? local : remote
    const baseIds = new Set((Array.isArray(base) ? base : []).map(idOf))
    const out: unknown[] = []
    const seen = new Set<string>()
    const add = (x: unknown) => {
      const id = idOf(x)
      if (seen.has(id)) return
      seen.add(id)
      out.push(x)
    }
    // Keep local order, then anything the other device added that we never had.
    for (const x of local) add(x)
    for (const x of remote) {
      const id = idOf(x)
      if (seen.has(id)) continue
      if (baseIds.has(id)) continue // it was in the base and is gone here: removed on this device
      add(x)
    }
    // Honour removals made on the other device for entries that existed in the base.
    const remoteIds = new Set(remote.map(idOf))
    const localIds = new Set(local.map(idOf))
    return out.filter((x) => {
      const id = idOf(x)
      if (!baseIds.has(id)) return true
      return remoteIds.has(id) && localIds.has(id)
    })
  }
}
