import { AlertCircle, Check, Stethoscope, Trash2, Wrench, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { modelsForProvider } from '../../lib/catalog'
import { runHeal, type HealRun, type HealStep } from '../../lib/heal'
import type { CatalogModel } from '../../lib/types'
import { cx } from '../../lib/utils'
import { useProviders } from '../../state/providers'
import { useSettings } from '../../state/settings'
import { useStore } from '../../state/store'
import { toast } from '../../state/toasts'
import { btnCls, btnPrimaryCls, Field, inputCls, ProviderLogo, SectionLabel, Spinner } from '../ui'

interface Option {
  providerId: string
  providerName: string
  modelId: string
  modelName: string
  model: CatalogModel
}

const key = (o: { providerId: string; modelId: string }) => `${o.providerId}/${o.modelId}`

export function RepairTab() {
  const catalog = useProviders((s) => s.catalog)
  const connections = useProviders((s) => s.connections)
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  const target = useStore((s) => s.healTarget)

  const [note, setNote] = useState('')
  const [picked, setPicked] = useState('')
  const [steps, setSteps] = useState<HealStep[]>([])
  const [run, setRun] = useState<HealRun | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Only models that are connected AND can call tools — the repair agent is a tool loop.
  const options = useMemo<Option[]>(() => {
    const out: Option[] = []
    for (const [providerId, conn] of Object.entries(connections)) {
      const provider = catalog?.[providerId]
      if (!provider) continue
      for (const model of modelsForProvider(provider, conn)) {
        if (model.tool_call === false) continue
        out.push({ providerId, providerName: provider.name, modelId: model.id, modelName: model.name || model.id, model })
      }
    }
    return out.sort((a, b) => a.providerName.localeCompare(b.providerName) || a.modelName.localeCompare(b.modelName))
  }, [catalog, connections])

  // Default to the user's usual model — unless it's on the provider we're here to fix, in which
  // case it is exactly the wrong thing to run the repair with.
  useEffect(() => {
    if (picked && options.some((o) => key(o) === picked)) return
    const suspect = target?.providerId
    const preferred = settings.defaultModel
    const fromDefault = preferred && preferred.providerId !== suspect ? options.find((o) => key(o) === key({ providerId: preferred.providerId, modelId: preferred.modelId })) : undefined
    const fallback = options.find((o) => o.providerId !== suspect) ?? options[0]
    const choice = fromDefault ?? fallback
    if (choice) setPicked(key(choice))
  }, [options, target, settings.defaultModel, picked])

  const overrides = Object.entries(settings.providerOverrides ?? {})

  const start = async () => {
    const opt = options.find((o) => key(o) === picked)
    if (!opt) return
    const conn = connections[opt.providerId]
    if (!conn) return
    setBusy(true)
    setError(null)
    setRun(null)
    setSteps([])
    const ac = new AbortController()
    abortRef.current = ac
    try {
      const result = await runHeal({
        conn,
        catalogProvider: catalog?.[opt.providerId],
        model: opt.modelId,
        target: { ...(target ?? {}), note: note.trim() || target?.note },
        onStep: (s) => setSteps((prev) => {
          const i = prev.findIndex((x) => x.id === s.id)
          if (i < 0) return [...prev, s]
          const next = [...prev]
          next[i] = s
          return next
        }),
        signal: ac.signal,
      })
      setRun(result)
      if (result.changed) {
        if (result.ok) toast.success('Repair applied', 'It synced to your other devices too.')
        else toast.info('Something was changed', 'The repair could not be verified — check the run below.')
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  const removeOverride = (providerId: string) => {
    const all = { ...(settings.providerOverrides ?? {}) }
    delete all[providerId]
    update({ providerOverrides: all })
  }

  return (
    <div>
      <p className="text-[12.5px] text-muted leading-relaxed mb-4">
        Providers move endpoints, rename models and change headers without warning, and openplex talks to them
        straight from your device — so when that happens, chats just start failing. Point a model that still works at
        the problem: it can search the web, read the provider's docs, send real test requests, and save a repair.
        Repairs sync to your other devices, so fixing it here fixes it on your phone too.
      </p>

      {target && (target.error || target.providerId) && (
        <div className="mb-4 rounded-xl border border-line bg-bg0/40 px-3.5 py-3">
          <div className="flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5 shrink-0 text-danger" />
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-medium mb-0.5">
                {target.providerId ? `Reported on ${target.providerId}${target.modelId ? ` · ${target.modelId}` : ''}` : 'Reported failure'}
              </div>
              {target.error && <div className="text-[12px] text-muted leading-relaxed break-words">{target.error}</div>}
            </div>
            <button onClick={() => useStore.getState().openRepair(undefined)} data-tip="Clear" className="shrink-0 text-faint hover:text-ink">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      <Field
        label="What's going wrong?"
        hint={target?.error ? 'Optional — anything the error message does not say.' : 'Describe the failure: which provider or model, and what you see.'}
      >
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="e.g. z.ai returns 404 for glm-4.6 since yesterday"
          className={cx(inputCls, 'resize-y font-sans')}
        />
      </Field>

      <Field label="Repair with" hint="Pick a model you know still works — it needs tool calling. This one does the diagnosing.">
        <select value={picked} onChange={(e) => setPicked(e.target.value)} className={inputCls} disabled={busy}>
          {options.length === 0 && <option value="">No connected tool-capable models</option>}
          {options.map((o) => (
            <option key={key(o)} value={key(o)}>
              {o.providerName} · {o.modelName}
            </option>
          ))}
        </select>
      </Field>

      <div className="flex items-center gap-2 mb-5">
        <button onClick={() => void start()} disabled={busy || !picked} className={btnPrimaryCls}>
          {busy ? <Spinner /> : <Stethoscope size={14} />}
          {busy ? 'Diagnosing…' : 'Diagnose and repair'}
        </button>
        {busy && (
          <button onClick={() => abortRef.current?.abort()} className={btnCls}>
            Stop
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-danger/30 bg-danger/8 px-3.5 py-2.5 text-[12.5px] text-danger">{error}</div>
      )}

      {steps.length > 0 && (
        <div className="mb-4">
          <SectionLabel>What it did</SectionLabel>
          <div className="rounded-xl border border-line bg-bg0/40 divide-y divide-line/60">
            {steps.map((s) => (
              <details key={s.id} className="group">
                <summary className="flex items-center gap-2 px-3.5 py-2 cursor-pointer list-none text-[12.5px]">
                  <span className={cx('shrink-0 w-3 text-center', s.status === 'error' ? 'text-danger' : s.status === 'done' ? 'text-accent' : 'text-faint')}>
                    {s.status === 'running' ? '…' : s.status === 'error' ? '✗' : '✓'}
                  </span>
                  <span className="truncate min-w-0 flex-1">{s.title}</span>
                  <span className="shrink-0 font-mono text-[10.5px] text-faint">{s.tool}</span>
                </summary>
                {s.output && (
                  <pre className="px-3.5 pb-2.5 text-[11.5px] font-mono text-muted whitespace-pre-wrap break-words max-h-[260px] overflow-y-auto">
                    {s.output}
                  </pre>
                )}
              </details>
            ))}
          </div>
        </div>
      )}

      {run && (
        <div
          className={cx(
            'mb-5 rounded-xl border px-3.5 py-3 text-[13px] leading-relaxed',
            run.ok ? 'border-accent bg-accent-soft' : 'border-line bg-bg0/40',
          )}
        >
          <div className="flex items-center gap-1.5 font-medium mb-1">
            {run.ok ? <Check size={14} className="text-accent" /> : <AlertCircle size={14} className="text-muted" />}
            {run.ok ? 'Repaired' : run.changed ? 'Changed something — not verified' : 'No repair applied'}
          </div>
          <div className="text-muted whitespace-pre-wrap">{run.summary}</div>
        </div>
      )}

      <SectionLabel>Saved repairs</SectionLabel>
      {overrides.length === 0 ? (
        <p className="text-[12.5px] text-faint">None yet. Anything the repair agent saves shows up here, and syncs to your other devices.</p>
      ) : (
        <div className="space-y-2">
          {overrides.map(([providerId, ov]) => (
            <div key={providerId} className="flex items-start gap-2.5 rounded-xl border border-line bg-bg0/40 px-3.5 py-3">
              <span className="shrink-0 mt-0.5">
                <ProviderLogo id={providerId} name={catalog?.[providerId]?.name ?? providerId} size={22} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[13px] font-medium">
                  <Wrench size={12} className="text-accent shrink-0" />
                  {catalog?.[providerId]?.name ?? providerId}
                  {ov.updatedAt && <span className="text-[11px] font-normal text-faint">{new Date(ov.updatedAt).toLocaleDateString()}</span>}
                </div>
                {ov.note && <div className="text-[12px] text-muted mt-0.5 leading-relaxed">{ov.note}</div>}
                <div className="mt-1 space-y-0.5 font-mono text-[10.5px] text-faint break-all">
                  {ov.baseUrl && <div>base: {ov.baseUrl}</div>}
                  {ov.apiStyle && <div>style: {ov.apiStyle}</div>}
                  {ov.headers && Object.keys(ov.headers).length > 0 && <div>headers: {Object.keys(ov.headers).join(', ')}</div>}
                  {ov.modelAliases &&
                    Object.entries(ov.modelAliases).map(([from, to]) => (
                      <div key={from}>
                        {from} → {to}
                      </div>
                    ))}
                </div>
              </div>
              <button onClick={() => removeOverride(providerId)} data-tip="Remove repair" className="shrink-0 p-1 rounded text-faint hover:text-danger">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
