import { Capacitor } from '@capacitor/core'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AgentFile, AgentImage, AgentTool } from './types'
import { getSupabase } from './supabase'
import { useSettings } from '../state/settings'

export interface RunResult {
  status: 'done' | 'error'
  stdout?: string
  stderr?: string
  exitCode?: number
  files?: AgentFile[]
  images?: AgentImage[]
  text?: string
  error?: string
}

export interface JobInput {
  tool: AgentTool
  input: unknown
  threadId?: string
}

const isNative = () => Capacitor.isNativePlatform()
const CLAIM_TIMEOUT_MS = 14_000
const JOB_TIMEOUT_MS = 10 * 60_000

export function computeReady(): { ok: boolean; reason?: string } {
  const s = useSettings.getState().settings
  if (!s.compute.enabled) return { ok: false, reason: 'Computer access is off (Settings → Computer & code).' }
  if (!isNative()) return { ok: true }
  if (!s.compute.deviceToken) return { ok: false, reason: 'No computer paired yet (Settings → Computer & code).' }
  if (!getSupabase(s.sync)) return { ok: false, reason: 'Sync isn’t set up — phone↔PC commands ride over your Supabase project.' }
  return { ok: true }
}

export async function runAgentJob(job: JobInput, opts: { signal?: AbortSignal } = {}): Promise<RunResult> {
  return isNative() ? runViaSupabase(job, opts) : runViaLocal(job, opts)
}

async function runViaLocal(job: JobInput, opts: { signal?: AbortSignal }): Promise<RunResult> {
  try {
    const res = await fetch('/__exec', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tool: job.tool, input: job.input, threadId: job.threadId }),
      signal: opts.signal,
    })
    if (!res.ok) {
      return { status: 'error', error: `No computer endpoint here (HTTP ${res.status}). Run the app with \`npm run dev\` or the \`openplex\` CLI so it can execute on this machine.` }
    }
    const r = await res.json()
    return {
      status: r.status === 'done' ? 'done' : 'error',
      stdout: r.stdout,
      stderr: r.stderr,
      exitCode: r.exitCode,
      files: r.files,
      images: r.images,
      text: r.text,
      error: r.error,
    }
  } catch (e) {
    return { status: 'error', error: `Couldn’t reach the local computer endpoint: ${(e as Error).message}` }
  }
}

async function runViaSupabase(job: JobInput, opts: { signal?: AbortSignal }): Promise<RunResult> {
  const s = useSettings.getState().settings
  const sb = getSupabase(s.sync)
  if (!sb) return { status: 'error', error: 'Sync not configured' }
  const { data: sess } = await sb.auth.getSession()
  const uid = sess.session?.user?.id
  if (!uid) return { status: 'error', error: 'Not signed in to sync' }
  const device = s.compute.deviceToken
  if (!device) return { status: 'error', error: 'No computer paired' }

  const id = crypto.randomUUID()
  const { error: insErr } = await sb.from('agent_jobs').insert({
    id, user_id: uid, device, thread_id: job.threadId ?? null, tool: job.tool, input: job.input ?? {}, status: 'pending',
  })
  if (insErr) return { status: 'error', error: `couldn’t queue the job: ${insErr.message}` }
  return waitForJob(sb, id, opts.signal)
}

function rowToResult(row: any): RunResult {
  const out = (row?.output ?? {}) as { files?: AgentFile[]; images?: AgentImage[]; text?: string; error?: string }
  return {
    status: row?.status === 'done' ? 'done' : 'error',
    stdout: row?.stdout ?? undefined,
    stderr: row?.stderr ?? undefined,
    exitCode: row?.exit_code ?? undefined,
    files: out.files,
    images: out.images,
    text: out.text,
    error: out.error,
  }
}

function waitForJob(sb: SupabaseClient, id: string, signal?: AbortSignal): Promise<RunResult> {
  return new Promise<RunResult>((resolve) => {
    let settled = false
    let claimed = false
    const finish = (r: RunResult) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(r)
    }
    const observe = (row: any) => {
      if (!row) return
      if (row.status === 'running') claimed = true
      if (row.status === 'done' || row.status === 'error') finish(rowToResult(row))
    }

    const channel = sb
      .channel(`agent_job_${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'agent_jobs', filter: `id=eq.${id}` },
        (payload: any) => observe(payload.new))
      .subscribe()

    const poll = setInterval(async () => {
      const { data } = await sb.from('agent_jobs').select('*').eq('id', id).maybeSingle()
      observe(data)
    }, 1500)

    const claimTimer = setTimeout(() => {
      if (!claimed) finish({ status: 'error', error: 'No computer is online. Start `openplex agent` on your PC (it auto-runs with `npm run dev`), then try again.' })
    }, CLAIM_TIMEOUT_MS)

    const timer = setTimeout(() => finish({ status: 'error', error: 'The computer took too long to finish.' }), JOB_TIMEOUT_MS)
    const onAbort = () => finish({ status: 'error', error: 'Cancelled' })
    signal?.addEventListener('abort', onAbort)

    function cleanup() {
      clearInterval(poll)
      clearTimeout(timer)
      clearTimeout(claimTimer)
      signal?.removeEventListener('abort', onAbort)
      void sb.removeChannel(channel)
    }
  })
}

export async function pingComputer(timeoutMs = 8000): Promise<{ ok: boolean; reason?: string }> {
  const s = useSettings.getState().settings
  const sb = getSupabase(s.sync)
  if (!sb) return { ok: false, reason: 'Sync isn’t set up.' }
  const { data: sess } = await sb.auth.getSession()
  const uid = sess.session?.user?.id
  const device = s.compute.deviceToken
  if (!uid) return { ok: false, reason: 'Not signed in to sync.' }
  if (!device) return { ok: false, reason: 'No computer paired.' }

  const id = crypto.randomUUID()
  const { error } = await sb.from('agent_jobs').insert({ id, user_id: uid, device, tool: 'ping', input: {}, status: 'pending' })
  if (error) return { ok: false, reason: error.message }

  return new Promise((resolve) => {
    let done = false
    const finish = (ok: boolean, reason?: string) => {
      if (done) return
      done = true
      clearInterval(poll)
      clearTimeout(timer)
      void sb.removeChannel(channel)
      resolve({ ok, reason })
    }
    const seen = (status?: string) => status === 'running' || status === 'done'
    const channel = sb
      .channel(`ping_${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'agent_jobs', filter: `id=eq.${id}` },
        (p: any) => { if (seen(p.new?.status)) finish(true) })
      .subscribe()
    const poll = setInterval(async () => {
      const { data } = await sb.from('agent_jobs').select('status').eq('id', id).maybeSingle()
      if (seen((data as any)?.status)) finish(true)
    }, 1200)
    const timer = setTimeout(() => finish(false, 'The computer didn’t respond — make sure it’s running.'), timeoutMs)
  })
}

export async function downloadAgentFile(file: AgentFile): Promise<Blob | null> {
  if (file.b64) {
    const bin = atob(file.b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new Blob([bytes], { type: file.mime || 'application/octet-stream' })
  }
  if (!file.bucketKey) return null
  const s = useSettings.getState().settings
  const sb = getSupabase(s.sync)
  if (!sb) return null
  const { data, error } = await sb.storage.from('agent-files').download(file.bucketKey)
  if (error || !data) return null
  return data
}

// ---- liveness ---------------------------------------------------------------------------
// computeReady() only says compute is *configured*. Before advertising the tools to a model we
// must know the computer is actually reachable — otherwise the model calls them and only then
// discovers it has to tell the user to "connect/sync". Probe for real, cache briefly.
let liveCache: { ok: boolean; reason?: string; at: number } | null = null
const LIVE_TTL_MS = 60_000

export function invalidateComputeLiveness(): void {
  liveCache = null
}

async function pingLocal(timeoutMs: number): Promise<{ ok: boolean; reason?: string }> {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch('/__exec', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tool: 'ping', input: {} }),
      signal: ac.signal,
    })
    if (!res.ok) return { ok: false, reason: 'This build has no computer endpoint — run `npm run dev` or the `openplex` CLI.' }
    const j = await res.json().catch(() => null)
    return j?.status === 'done' ? { ok: true } : { ok: false, reason: 'The computer endpoint did not answer.' }
  } catch {
    return { ok: false, reason: 'Could not reach the local computer endpoint.' }
  } finally {
    clearTimeout(t)
  }
}

/** Configured AND actually reachable right now? Cached for a minute so we probe at most once/turn. */
export async function computeAvailable(opts: { timeoutMs?: number; maxAgeMs?: number } = {}): Promise<{ ok: boolean; reason?: string }> {
  const cfg = computeReady()
  if (!cfg.ok) return cfg
  const maxAge = opts.maxAgeMs ?? LIVE_TTL_MS
  if (liveCache && Date.now() - liveCache.at < maxAge) return { ok: liveCache.ok, reason: liveCache.reason }
  const probe = isNative() ? await pingComputer(opts.timeoutMs ?? 6000) : await pingLocal(opts.timeoutMs ?? 2500)
  liveCache = { ok: probe.ok, reason: probe.reason, at: Date.now() }
  return probe
}
