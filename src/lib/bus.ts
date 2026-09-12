
export const bus = new EventTarget()

const TS_KEY = 'opx.sync.metaTs'

export function bumpMetaTs(): void {
  const ts = Math.max(Date.now(), getMetaTs() + 1)
  localStorage.setItem(TS_KEY, String(ts))
  bus.dispatchEvent(new Event('meta-changed'))
}

export function getMetaTs(): number {
  return Number(localStorage.getItem(TS_KEY) ?? 0)
}

export function setMetaTs(ts: number): void {
  localStorage.setItem(TS_KEY, String(ts))
}
