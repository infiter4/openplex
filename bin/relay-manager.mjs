import { mkdir, writeFile, chmod } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { startRelay } from './relay.mjs'

const DIR = join(homedir(), '.openplex')
const DEVICES_PATH = join(DIR, 'devices.json')
const LEGACY_PATH = join(DIR, 'agent.json')

function readDevices() {
  try {
    if (existsSync(DEVICES_PATH)) {
      const arr = JSON.parse(readFileSync(DEVICES_PATH, 'utf8'))
      if (Array.isArray(arr)) return arr.filter((d) => d?.deviceToken)
    }
  } catch { /* corrupt — fall through */ }
  try {
    if (existsSync(LEGACY_PATH)) {
      const cfg = JSON.parse(readFileSync(LEGACY_PATH, 'utf8'))
      if (cfg?.deviceToken) return [cfg]
    }
  } catch { /* ignore */ }
  return []
}

const ACTIVE_WINDOW_MS = 2 * 60_000

export function createRelayManager(executor, { log = () => {} } = {}) {
  const running = new Map()
  const lastSeen = new Map()
  let devices = readDevices()

  const persist = async () => {
    await mkdir(DIR, { recursive: true, mode: 0o700 }).catch(() => {})
    await writeFile(DEVICES_PATH, JSON.stringify(devices, null, 2), { mode: 0o600 }).catch(() => {})
    await chmod(DEVICES_PATH, 0o600).catch(() => {})
  }

  async function startOne(cfg) {
    if (running.has(cfg.deviceToken)) return { ok: true, already: true, deviceName: cfg.deviceName }
    try {
      const relay = await startRelay(cfg, executor, {
        log,
        onActivity: () => lastSeen.set(cfg.deviceToken, Date.now()),
        onRefresh: async (rt) => {
          const d = devices.find((x) => x.deviceToken === cfg.deviceToken)
          if (d && d.refreshToken !== rt) { d.refreshToken = rt; await persist() }
        },
      })
      running.set(cfg.deviceToken, relay)
      return { ok: true, deviceName: cfg.deviceName, deviceToken: cfg.deviceToken }
    } catch (e) {
      return { ok: false, error: e?.message ?? 'relay failed', deviceName: cfg.deviceName, deviceToken: cfg.deviceToken }
    }
  }

  return {
    async startAll() {
      const out = []
      for (const cfg of devices) out.push(await startOne(cfg))
      return out
    },

    async pair(blob) {
      let cfg
      try { cfg = JSON.parse(Buffer.from(blob ?? '', 'base64').toString('utf8')) } catch { /* bad */ }
      if (!cfg?.deviceToken) return { ok: false, error: 'bad pairing code' }
      const entry = {
        deviceToken: cfg.deviceToken,
        deviceName: cfg.deviceName ?? 'my computer',
        label: cfg.label ?? 'Phone',
        url: cfg.url,
        anonKey: cfg.anonKey,
        refreshToken: cfg.refreshToken,
        pairedAt: cfg.pairedAt ?? Date.now(),
      }
      const idx = devices.findIndex((d) => d.deviceToken === entry.deviceToken)
      if (idx >= 0) devices[idx] = entry
      else devices.push(entry)
      await persist()
      const old = running.get(entry.deviceToken)
      if (old) { try { old.stop() } catch { /* ignore */ } running.delete(entry.deviceToken) }
      return startOne(entry)
    },

    list() {
      const now = Date.now()
      return devices.map((d) => {
        const seen = lastSeen.get(d.deviceToken) ?? null
        return {
          deviceToken: d.deviceToken,
          deviceName: d.deviceName,
          label: d.label ?? 'Phone',
          pairedAt: d.pairedAt ?? null,
          running: running.has(d.deviceToken),
          lastSeen: seen,
          active: Boolean(seen && now - seen < ACTIVE_WINDOW_MS),
        }
      })
    },

    async remove(token) {
      const r = running.get(token)
      if (r) { try { r.stop() } catch { /* ignore */ } running.delete(token) }
      const before = devices.length
      devices = devices.filter((d) => d.deviceToken !== token)
      if (devices.length !== before) await persist()
      return { ok: true }
    },
  }
}
