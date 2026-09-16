import { Check, ChevronDown, Eye, EyeOff, ExternalLink, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { corsFetch } from '../../lib/net'
import { authHeaders, endpointFor, FEATURED_ORDER, isBrowserReady } from '../../lib/providers'
import type { CatalogProvider, ProviderConnection } from '../../lib/types'
import { cx, uid } from '../../lib/utils'
import { useProviders } from '../../state/providers'
import { useSettings } from '../../state/settings'
import { useStore } from '../../state/store'
import { toast } from '../../state/toasts'
import { btnCls, btnPrimaryCls, inputCls, ProviderLogo, SectionLabel, Spinner, Switch } from '../ui'

function KeyForm({ provider, existing, onDone }: { provider: CatalogProvider; existing?: ProviderConnection; onDone: () => void }) {
  const connect = useProviders((s) => s.connect)
  const refreshCustomModels = useProviders((s) => s.refreshCustomModels)
  const isLocal = provider.id === 'ollama' || provider.id === 'lmstudio'
  const isCloudflare = provider.id === 'cloudflare-workers-ai'
  const needsBaseUrl = !isLocal && !isCloudflare && !endpointFor({ providerId: provider.id, kind: 'catalog' }, provider)

  const [key, setKey] = useState(existing?.apiKey ?? '')
  const [accountId, setAccountId] = useState(existing?.accountId ?? '')
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? '')
  const [show, setShow] = useState(false)
  const [advanced, setAdvanced] = useState(Boolean(existing?.baseUrl) || needsBaseUrl)
  const [testing, setTesting] = useState(false)

  const canSubmit =
    isLocal || Boolean(key.trim() && (!isCloudflare || accountId.trim()) && (!needsBaseUrl || baseUrl.trim()))

  const save = async () => {
    const conn: ProviderConnection = {
      providerId: provider.id,
      apiKey: key.trim() || undefined,
      accountId: isCloudflare ? accountId.trim() || undefined : existing?.accountId,
      baseUrl: baseUrl.trim() || undefined,
      kind: existing?.kind ?? 'catalog',
      label: existing?.label,
      models: existing?.models,
    }
    connect(conn)
    toast.success(`${provider.name} connected`)
    onDone()
    try {
      await refreshCustomModels(provider.id)
    } catch {
      /* /models unsupported or blocked — catalog models still work */
    }
  }

  const test = async () => {
    setTesting(true)
    try {
      const conn: ProviderConnection = {
        providerId: provider.id,
        apiKey: key.trim() || undefined,
        accountId: isCloudflare ? accountId.trim() || undefined : existing?.accountId,
        baseUrl: baseUrl.trim() || undefined,
        kind: 'catalog',
      }
      const ep = endpointFor(conn, provider)
      if (!ep) throw new Error('No endpoint known — set a base URL below.')

      if (isCloudflare) {
        const acct = accountId.trim()
        if (!acct) throw new Error('Enter your Cloudflare account ID.')
        const res = await corsFetch(`https://api.cloudflare.com/client/v4/accounts/${acct}/ai/models/search?per_page=1`, {
          headers: { Authorization: `Bearer ${conn.apiKey}` },
        }, { buffered: true })
        if (res.status === 401 || res.status === 403) throw new Error('Token rejected — check it has Workers AI access.')
        if (res.status === 404) throw new Error('Account not found — double-check the account ID.')
        if (!res.ok) throw new Error(`Cloudflare answered HTTP ${res.status}.`)
        toast.success('Connection looks good')
        return
      }

      const res = await corsFetch(`${ep.baseUrl}/models`, { headers: authHeaders(ep.style, conn.apiKey, ep.headers) }, { buffered: true })
      if (res.status === 401 || res.status === 403) throw new Error('Key rejected (401). Double-check it.')
      if (!res.ok && ![400, 404, 405, 501].includes(res.status)) throw new Error(`Endpoint answered HTTP ${res.status}.`)
      toast.success('Connection looks good')
    } catch (err) {
      const msg = (err as Error).message
      const corsLike = msg.includes('fetch') || msg.toLowerCase().includes('network')
      toast.info(
        corsLike ? 'Can’t test from the browser' : 'Test failed',
        corsLike
          ? 'This provider blocks browser test calls (CORS). It still works in the mobile app and on desktop with a proxy set — just try sending a message.'
          : msg,
      )
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="px-3 pb-3 pt-1 space-y-2.5" onClick={(e) => e.stopPropagation()}>
      {!isLocal && (
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type={show ? 'text' : 'password'}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={isCloudflare ? 'Cloudflare API token' : `${provider.env?.[0] ?? 'API key'}…`}
              className={cx(inputCls, 'pr-9 font-mono text-[12.5px]')}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSubmit) void save()
              }}
            />
            <button
              onClick={() => setShow(!show)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-faint hover:text-ink"
              data-tip={show ? 'Hide' : 'Show'}
            >
              {show ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>
      )}
      {isCloudflare && (
        <input
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          placeholder="Cloudflare account ID"
          className={cx(inputCls, 'font-mono text-[12.5px]')}
        />
      )}
      {needsBaseUrl && (
        <p className="text-[11.5px] text-muted leading-relaxed">
          {provider.name} isn’t pre-wired. Paste its OpenAI-compatible base URL once (usually ends in <code>/v1</code>) —
          it’s saved with the key.
        </p>
      )}
      {(advanced || isLocal) && (
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder={`Base URL${needsBaseUrl ? '' : ' override'} (e.g. ${provider.api ?? 'https://api.example.com/v1'})`}
          className={cx(inputCls, 'font-mono text-[12.5px]')}
        />
      )}
      <div className="flex items-center gap-2">
        <button onClick={() => void save()} disabled={!canSubmit} className={btnPrimaryCls}>
          <Check size={13} /> Save
        </button>
        <button onClick={() => void test()} disabled={testing || !canSubmit} className={btnCls}>
          {testing ? <Spinner size={12} /> : null} Test
        </button>
        {!isLocal && !advanced && (
          <button onClick={() => setAdvanced(true)} className="text-[12px] text-faint hover:text-muted">
            Advanced
          </button>
        )}
        <span className="flex-1" />
        {provider.doc && (
          <a
            href={provider.doc}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-[12px] text-muted hover:text-accent"
          >
            Get a key <ExternalLink size={11} />
          </a>
        )}
      </div>
    </div>
  )
}

function CustomProviderForm({ onDone }: { onDone: () => void }) {
  const connect = useProviders((s) => s.connect)
  const refreshCustomModels = useProviders((s) => s.refreshCustomModels)
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [key, setKey] = useState('')
  const [models, setModels] = useState('')

  const save = async () => {
    const id = `custom-${uid().slice(0, 8)}`
    connect({
      providerId: id,
      apiKey: key.trim() || undefined,
      baseUrl: baseUrl.trim().replace(/\/$/, ''),
      label: name.trim() || 'Custom provider',
      kind: 'custom',
      models: models.trim() ? models.split(',').map((m) => m.trim()).filter(Boolean) : undefined,
    })
    toast.success('Custom provider added')
    onDone()
    if (!models.trim()) {
      try {
        await refreshCustomModels(id)
      } catch {
        toast.info('Couldn’t auto-list models', 'Edit the provider and enter model ids manually.')
      }
    }
  }

  return (
    <div className="rounded-xl border border-line-strong bg-bg0/50 p-3 space-y-2.5 anim-rise">
      <div className="text-[13px] font-medium">Custom OpenAI-compatible endpoint</div>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. My vLLM box)" className={inputCls} autoFocus />
      <input
        value={baseUrl}
        onChange={(e) => setBaseUrl(e.target.value)}
        placeholder="Base URL (e.g. http://192.168.1.10:8000/v1)"
        className={cx(inputCls, 'font-mono text-[12.5px]')}
      />
      <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="API key (optional)" type="password" className={cx(inputCls, 'font-mono text-[12.5px]')} />
      <input
        value={models}
        onChange={(e) => setModels(e.target.value)}
        placeholder="Model ids, comma-separated (optional — auto-detected if empty)"
        className={cx(inputCls, 'font-mono text-[12.5px]')}
      />
      <div className="flex gap-2">
        <button onClick={() => void save()} disabled={!baseUrl.trim()} className={btnPrimaryCls}>
          <Plus size={13} /> Add provider
        </button>
        <button onClick={onDone} className={btnCls}>
          Cancel
        </button>
      </div>
    </div>
  )
}

function ConnectionSection() {
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  const loadCatalog = useProviders((s) => s.loadCatalog)
  const [open, setOpen] = useState(false)
  const [proxy, setProxy] = useState(settings.proxyUrl ?? '')
  const [refreshing, setRefreshing] = useState(false)
  const isDev = import.meta.env.DEV

  return (
    <div className="rounded-xl border border-line bg-bg0/40 mb-5">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left">
        <span className="text-[13px] font-medium flex-1">Connection & CORS</span>
        {isDev && <span className="text-[10.5px] text-accent bg-accent-soft px-1.5 py-0.5 rounded-md">dev proxy active</span>}
        <ChevronDown size={14} className={cx('text-faint transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="px-3.5 pb-3.5 pt-1 space-y-3 border-t border-line">
          <p className="text-[12px] text-muted leading-relaxed">
            {isDev
              ? 'In dev, all provider and local-model calls are auto-proxied through Vite — Ollama, LM Studio, and strict providers work with no setup.'
              : 'When deployed, providers that block browser calls (and local model servers) need a proxy. Run the bundled proxy/server.mjs (or deploy it) and paste its URL here.'}
          </p>
          <div>
            <div className="text-[12px] font-medium mb-1.5">CORS proxy URL {isDev && <span className="text-faint">(used in production builds)</span>}</div>
            <div className="flex gap-2">
              <input
                value={proxy}
                onChange={(e) => setProxy(e.target.value)}
                placeholder="https://your-proxy.example"
                className={cx(inputCls, 'font-mono text-[12.5px]')}
              />
              <button
                onClick={() => {
                  update({ proxyUrl: proxy.trim() })
                  toast.success(proxy.trim() ? 'Proxy saved' : 'Proxy cleared')
                }}
                className={btnPrimaryCls}
              >
                <Check size={13} /> Save
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between pt-1">
            <div>
              <div className="text-[12.5px] font-medium">Model catalog</div>
              <div className="text-[11.5px] text-faint">Refresh provider & model list from models.dev</div>
            </div>
            <button
              onClick={async () => {
                setRefreshing(true)
                await loadCatalog(true)
                setRefreshing(false)
                toast.success('Catalog refreshed')
              }}
              className={btnCls}
            >
              <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function ProvidersTab() {
  const catalog = useProviders((s) => s.catalog)
  const catalogStatus = useProviders((s) => s.catalogStatus)
  const connections = useProviders((s) => s.connections)
  const disconnect = useProviders((s) => s.disconnect)
  const refreshCustomModels = useProviders((s) => s.refreshCustomModels)
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  const providerFocus = useStore((s) => s.settingsProviderFocus)
  const setProviderFocus = useStore((s) => s.setSettingsProviderFocus)

  const [openId, setOpenId] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [showCustomForm, setShowCustomForm] = useState(false)
  const [refreshing, setRefreshing] = useState<string | null>(null)

  const { connected, available } = useMemo(() => {
    if (!catalog) return { connected: [], available: [] }
    const all = Object.values(catalog)
    const conn = all.filter((p) => connections[p.id])
    let avail = all.filter((p) => !connections[p.id] && (settings.showAllProviders || isBrowserReady(p)))
    const q = filter.trim().toLowerCase()
    if (q) avail = avail.filter((p) => p.name.toLowerCase().includes(q) || p.id.includes(q))
    const order = (p: CatalogProvider) => {
      const i = FEATURED_ORDER.indexOf(p.id)
      return i >= 0 ? i : 1000
    }
    avail.sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name))
    return { connected: conn, available: avail }
  }, [catalog, connections, filter, settings.showAllProviders])

  // Deep-link: picking an unconnected voice model (or any openSettings('providers', id) call)
  // surfaces that provider and opens its key form.
  useEffect(() => {
    if (!providerFocus || !catalog) return
    setFilter(catalog[providerFocus]?.name ?? providerFocus)
    setOpenId(providerFocus)
    setProviderFocus(null)
  }, [providerFocus, catalog, setProviderFocus])

  if (catalogStatus === 'loading') {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-muted text-[13px]">
        <Spinner /> Loading provider catalog from models.dev…
      </div>
    )
  }
  if (catalogStatus === 'error') {
    return (
      <div className="text-center py-12 text-[13px] text-muted">
        Couldn't reach models.dev.{' '}
        <button className="text-accent underline" onClick={() => void useProviders.getState().loadCatalog(true)}>
          Retry
        </button>
      </div>
    )
  }

  return (
    <div>
      <p className="text-[12.5px] text-muted leading-relaxed mb-4">
        Keys stay <span className="text-ink font-medium">on this device</span>; calls go straight from your browser to
        the provider. Want them on your other devices too? Turn on encrypted key sync in{' '}
        <button className="text-accent hover:underline" onClick={() => useStore.getState().openSettings('sync')}>
          Account & sync
        </button>
        .
      </p>

      <ConnectionSection />

      {connected.length > 0 && (
        <>
          <SectionLabel>Connected</SectionLabel>
          <div className="space-y-1.5 mb-5">
            {connected.map((p) => {
              const conn = connections[p.id]
              const isOpen = openId === p.id
              const catalogCount = Object.keys(p.models).length
              return (
                <div key={p.id} className="rounded-xl border border-line bg-bg0/40 overflow-hidden">
                  <div className="flex items-center gap-2.5 px-3 py-2.5">
                    <ProviderLogo id={p.id} name={p.name} size={22} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px] font-medium truncate">{conn.label ?? p.name}</div>
                      <div className="text-[11.5px] text-faint font-mono truncate">
                        {conn.apiKey ? `${conn.apiKey.slice(0, 7)}…${conn.apiKey.slice(-4)}` : 'no key (local)'}
                        {conn.accountId ? ` · acct ${conn.accountId.slice(0, 6)}…${conn.accountId.slice(-4)}` : ''}
                        {(() => {
                          const total = new Set([...Object.keys(p.models), ...(conn.models ?? [])]).size
                          if (!total) return ''
                          const live = (conn.models?.length ?? 0) > catalogCount
                          return ` · ${total} models${live ? ' (live)' : ''}`
                        })()}
                      </div>
                    </div>
                    <button
                      data-tip="Fetch the provider’s live model list (shows every model the key can use)"
                      onClick={async () => {
                        setRefreshing(p.id)
                        try {
                          const models = await refreshCustomModels(p.id)
                          toast.success(`Found ${models.length} models`)
                        } catch (err) {
                          toast.error('Couldn’t list models', (err as Error).message)
                        } finally {
                          setRefreshing(null)
                        }
                      }}
                      className="p-1.5 rounded-lg text-muted hover:text-ink hover:bg-bg2"
                    >
                      <RefreshCw size={13} className={refreshing === p.id ? 'animate-spin' : ''} />
                    </button>
                    <button
                      onClick={() => setOpenId(isOpen ? null : p.id)}
                      className="text-[12px] text-muted hover:text-ink px-2 py-1 rounded-lg hover:bg-bg2"
                    >
                      Edit
                    </button>
                    <button
                      data-tip="Disconnect"
                      onClick={() => disconnect(p.id)}
                      className="p-1.5 rounded-lg text-muted hover:text-danger hover:bg-bg2"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  {isOpen && <KeyForm provider={p} existing={conn} onDone={() => setOpenId(null)} />}
                </div>
              )
            })}
          </div>
        </>
      )}

      <div className="flex items-center justify-between mb-2">
        <SectionLabel>Add a provider</SectionLabel>
        <label className="flex items-center gap-2 text-[12px] text-muted mb-2">
          Show all {catalog ? Object.keys(catalog).length : ''} providers
          <Switch checked={settings.showAllProviders} onChange={(v) => update({ showAllProviders: v })} />
        </label>
      </div>

      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter providers…"
        className={cx(inputCls, 'mb-2.5')}
      />

      {showCustomForm ? (
        <div className="mb-2.5">
          <CustomProviderForm onDone={() => setShowCustomForm(false)} />
        </div>
      ) : (
        <button
          onClick={() => setShowCustomForm(true)}
          className="w-full flex items-center gap-2 px-3 py-2.5 mb-2.5 rounded-xl border border-dashed border-line-strong text-[13px] text-muted hover:text-ink hover:border-accent/50 transition-colors"
        >
          <Plus size={14} /> Custom endpoint (vLLM, LiteLLM, any OpenAI-compatible server)
        </button>
      )}

      <div className="space-y-1">
        {available.slice(0, 40).map((p) => {
          const isOpen = openId === p.id
          return (
            <div key={p.id} className={cx('rounded-xl border overflow-hidden transition-colors', isOpen ? 'border-accent/50 bg-bg0/40' : 'border-transparent hover:bg-bg2/50')}>
              <button onClick={() => setOpenId(isOpen ? null : p.id)} className="w-full flex items-center gap-2.5 px-3 py-2 text-left">
                <ProviderLogo id={p.id} name={p.name} size={20} />
                <span className="text-[13.5px] flex-1 truncate">{p.name}</span>
                <span className="text-[11px] text-faint">{Object.keys(p.models).length || ''}</span>
                <ChevronDown size={13} className={cx('text-faint transition-transform', isOpen && 'rotate-180')} />
              </button>
              {isOpen && <KeyForm provider={p} onDone={() => setOpenId(null)} />}
            </div>
          )
        })}
        {available.length > 40 && (
          <div className="text-[12px] text-faint text-center py-2">{available.length - 40} more — refine the filter to see them</div>
        )}
      </div>
    </div>
  )
}
