import { createClient } from '@supabase/supabase-js'

export async function startRelay(cfg, executor, { log = () => {}, onRefresh, onActivity } = {}) {
  const sb = createClient(cfg.url, cfg.anonKey, { auth: { persistSession: false, autoRefreshToken: true } })
  const { data: refreshed, error } = await sb.auth.refreshSession({ refresh_token: cfg.refreshToken })
  if (error || !refreshed?.session) throw new Error(`pairing expired/invalid: ${error?.message ?? 'no session'}`)
  if (onRefresh) await onRefresh(refreshed.session.refresh_token)
  const UID = refreshed.session.user.id

  let busy = Promise.resolve()
  const enqueue = (job) => { busy = busy.then(() => handleJob(job).catch((e) => log(`job error: ${e?.message}`))) }

  async function claimPending() {
    const { data } = await sb.from('agent_jobs').select('*').eq('device', cfg.deviceToken).eq('status', 'pending')
    for (const job of data ?? []) enqueue(job)
  }
  const channel = sb
    .channel(`agent_jobs_runner_${cfg.deviceToken}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'agent_jobs', filter: `device=eq.${cfg.deviceToken}` },
      (payload) => { if (payload.new.status === 'pending') enqueue(payload.new) })
    .subscribe((status) => { if (status === 'SUBSCRIBED') claimPending() })
  const timer = setInterval(claimPending, 6_000)
  timer.unref?.()

  async function handleJob(job) {
    onActivity?.()
    log(`▸ ${job.tool}: ${JSON.stringify(job.input).slice(0, 80)}`)
    await sb.from('agent_jobs').update({ status: 'running', updated_at: new Date().toISOString() }).eq('id', job.id)
    const r = await executor.exec({ tool: job.tool, input: job.input || {}, threadId: job.thread_id })
    const output = {}
    if (r.error) output.error = r.error
    if (r.text != null) output.text = r.text
    if (r.images?.length) output.images = r.images
    if (r.files?.length) {
      output.files = []
      for (const f of r.files) {
        const key = `${UID}/${job.id}/${f.name}`
        const { error: upErr } = await sb.storage.from('agent-files').upload(key, Buffer.from(f.b64, 'base64'), { upsert: true })
        if (upErr) { output.error = `upload failed: ${upErr.message}`; break }
        output.files.push({ name: f.name, bucketKey: key, bytes: f.bytes, mime: f.mime })
      }
    }
    await sb.from('agent_jobs').update({
      status: r.status, stdout: r.stdout ?? null, stderr: r.stderr ?? null, exit_code: r.exitCode ?? null,
      output, updated_at: new Date().toISOString(),
    }).eq('id', job.id)
    log(`  ↳ ${r.status}`)
  }

  return {
    deviceToken: cfg.deviceToken,
    deviceName: cfg.deviceName,
    uid: UID,
    stop: () => { try { clearInterval(timer); void sb.removeChannel(channel) } catch { /* ignore */ } },
  }
}
