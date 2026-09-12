import { Capacitor } from '@capacitor/core'
import { Check, Cloud, Download, KeyRound, LogOut, Mail, Monitor, Plus, RefreshCw, Smartphone, Trash2, Unlock } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { clearPassphrase, clearStoredBlob, getStoredPassphrase, storePassphrase, unlockSecrets } from '../../lib/settingsSync'
import { decodePairing, encodePairing } from '../../lib/pairing'
import { bumpMetaTs } from '../../lib/bus'
import { pingComputer } from '../../lib/agentBackend'
import { effectiveConfig, getSupabase, signInWithEmail, signInWithGoogle, signOut, syncConfigured } from '../../lib/supabase'
import { cx } from '../../lib/utils'
import { useProviders } from '../../state/providers'
import { useSettings } from '../../state/settings'
import { useStore } from '../../state/store'
import { toast } from '../../state/toasts'
import { btnCls, btnPrimaryCls, Field, inputCls, SectionLabel, Spinner, Switch } from '../ui'
import { ConflictBanner } from '../ConflictModal'

function KeySyncSection() {
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  const pendingKeysBlob = useProviders((s) => s.pendingKeysBlob)
  const setPendingKeysBlob = useProviders((s) => s.setPendingKeysBlob)
  const syncNow = useStore((s) => s.syncNow)

  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)

  const enabled = settings.keySync.enabled
  const unlocked = Boolean(getStoredPassphrase())
  const needsUnlock = Boolean(pendingKeysBlob) || (enabled && !unlocked)

  const enable = () => {
    if (pass.length < 8) {
      toast.error('Passphrase too short', 'Use at least 8 characters — it protects all your API keys.')
      return
    }
    storePassphrase(pass)
    update({ keySync: { enabled: true } })
    setPass('')
    syncNow()
    toast.success('Key sync enabled', 'Sign in on another device and enter the same passphrase once.')
  }

  const disable = () => {
    update({ keySync: { enabled: false } })
    clearPassphrase()
    bumpMetaTs()
    syncNow()
    toast.info('Key sync disabled', 'The encrypted blob is removed from your sync database.')
  }

  const reset = () => {
    const savedConnections = { ...useProviders.getState().connections }
    const savedSearchKeys = { ...useSettings.getState().settings.search.keys }

    update({ keySync: { enabled: false } })
    clearPassphrase()
    clearStoredBlob()
    setPendingKeysBlob(null)
    setPass('')
    bumpMetaTs()
    syncNow()

    useProviders.getState().applyRemoteConnections(savedConnections)
    const liveSearch = useSettings.getState().settings.search
    update({ search: { ...liveSearch, keys: { ...savedSearchKeys, ...liveSearch.keys } } }, { silent: true })

    toast.success('Key sync reset', 'Your API keys saved on this device are kept. Set a new passphrase to start fresh.')
  }

  const unlock = async () => {
    setBusy(true)
    try {
      let ok = await unlockSecrets(pass)
      if (!ok) {
        syncNow()
        await new Promise((r) => setTimeout(r, 1800))
        ok = await unlockSecrets(pass)
      }
      if (ok) {
        setPass('')
        toast.success('API keys unlocked', 'Your providers are connected on this device.')
      } else {
        toast.error('No synced keys found yet', 'Make sure you’re signed in and sync has finished, then try again.')
      }
    } catch {
      toast.error('Wrong passphrase', 'It must match the one you set on your other device.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-6">
      <SectionLabel>API-key sync</SectionLabel>
      <div className="rounded-xl border border-line bg-bg0/40 p-4">
        {needsUnlock ? (
          <>
            <div className="flex items-center gap-2 text-[13.5px] font-medium mb-1">
              <KeyRound size={14} className="text-accent" /> Synced keys are waiting
            </div>
            <p className="text-[12.5px] text-muted leading-relaxed mb-3">
              Another device synced its API keys (end-to-end encrypted). Enter your key-sync passphrase to connect
              every provider here in one go.
            </p>
            <div className="flex gap-2 max-w-sm">
              <input
                type="password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                placeholder="Key-sync passphrase"
                className={inputCls}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && pass) void unlock()
                }}
              />
              <button onClick={() => void unlock()} disabled={!pass || busy} className={btnPrimaryCls}>
                <Unlock size={13} /> Unlock
              </button>
            </div>
            <button onClick={reset} className="mt-3 text-[12px] text-faint hover:text-danger transition-colors">
              Forgot your passphrase? Reset key sync and start over
            </button>
          </>
        ) : (
          <>
            <label className="flex items-center justify-between gap-3">
              <span>
                <span className="text-[13.5px] font-medium block">Sync API keys across devices</span>
                <span className="text-[12px] text-muted leading-relaxed">
                  Keys are encrypted on-device (AES-256, your passphrase) before they touch the database — connect
                  providers once, use them everywhere.
                </span>
              </span>
              <Switch
                checked={enabled}
                onChange={(v) => {
                  if (!v) disable()
                }}
                disabled={!enabled}
              />
            </label>
            {!enabled && (
              <div className="flex gap-2 max-w-sm mt-3">
                <input
                  type="password"
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                  placeholder="Create a passphrase (min 8 chars)"
                  className={inputCls}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') enable()
                  }}
                />
                <button onClick={enable} disabled={pass.length < 8} className={btnPrimaryCls}>
                  <KeyRound size={13} /> Enable
                </button>
              </div>
            )}
            {enabled && (
              <p className="text-[12px] text-faint mt-2">
                {unlocked
                  ? 'Active on this device. On a new device: sign in, then enter the same passphrase once.'
                  : 'Enabled, but this device is locked — re-enter the passphrase above when prompted.'}
              </p>
            )}
          </>
        )}
      </div>
      <p className="text-[11.5px] text-faint leading-relaxed mt-2">
        The passphrase never leaves your devices — if you forget it, disable key sync and re-enable it with a new one
        (your locally stored keys are unaffected).
      </p>
    </div>
  )
}

interface PairedDevice {
  deviceToken: string
  deviceName: string
  label: string
  running: boolean
  active?: boolean
  lastSeen?: number | null
}

function ComputeSection() {
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  const native = Capacitor.isNativePlatform()
  const enabled = settings.compute.enabled

  const [devices, setDevices] = useState<PairedDevice[] | null>(null)
  const [pairing, setPairing] = useState<string | null>(null)
  const [relay, setRelay] = useState<'idle' | 'starting' | 'running' | 'failed'>('idle')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [code, setCode] = useState('')
  const [repairing, setRepairing] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [phoneStatus, setPhoneStatus] = useState<'checking' | 'online' | 'offline' | null>(null)

  const checkPhone = useCallback(async () => {
    setPhoneStatus('checking')
    const r = await pingComputer()
    setPhoneStatus(r.ok ? 'online' : 'offline')
  }, [])

  const refreshDevices = useCallback(async () => {
    if (native) return
    try {
      const res = await fetch('/__agent')
      const j = await res.json().catch(() => ({}))
      setDevices(j?.ok && Array.isArray(j.devices) ? j.devices : [])
    } catch {
      setDevices(null)
    }
  }, [native])

  useEffect(() => {
    if (!enabled || native) return
    void refreshDevices()
    const t = setInterval(() => void refreshDevices(), 5000)
    return () => clearInterval(t)
  }, [enabled, native, refreshDevices])

  useEffect(() => {
    if (enabled && native && settings.compute.deviceToken && !repairing) void checkPhone()
  }, [enabled, native, settings.compute.deviceToken, repairing, checkPhone])

  const toggle = (v: boolean) => {
    update({ compute: { ...settings.compute, enabled: v } })
    if (!v) { setPairing(null); setRelay('idle') }
  }

  const makePairing = async () => {
    setBusy(true)
    try {
      const sb = getSupabase(settings.sync)
      if (!sb) return toast.error('Set up sync first', 'Phone↔PC commands ride over your Supabase project.')
      const { data } = await sb.auth.getSession()
      if (!data.session) return toast.error('Sign in first')
      const token = crypto.randomUUID().replace(/-/g, '')
      const eff = effectiveConfig(settings.sync)
      const blob = encodePairing({
        url: eff.url ?? '', anonKey: eff.anonKey ?? '', refreshToken: data.session.refresh_token,
        deviceToken: token,
        deviceName: settings.compute.deviceName?.trim() || 'my computer',
        label: label.trim() || 'Phone',
        pairedAt: Date.now(),
      })
      setPairing(blob)
      setRelay('starting')
      try {
        const res = await fetch('/__agent', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ pair: blob }),
        })
        const j = await res.json().catch(() => ({}))
        setRelay(res.ok && j.ok ? 'running' : 'failed')
        if (Array.isArray(j.devices)) setDevices(j.devices)
      } catch {
        setRelay('failed')
      }
      setLabel('')
    } finally {
      setBusy(false)
    }
  }

  const removeDevice = async (deviceToken: string) => {
    try {
      const res = await fetch('/__agent', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'remove', deviceToken }),
      })
      const j = await res.json().catch(() => ({}))
      if (Array.isArray(j.devices)) setDevices(j.devices)
      toast.success('Device removed')
    } catch {
      toast.error('Couldn’t remove the device')
    }
  }

  const applyCode = async () => {
    const decoded = decodePairing(code)
    if (!decoded.ok) {
      return decoded.reason === 'incomplete'
        ? toast.error('Invalid code', 'That pairing code is incomplete — copy the whole thing from your PC.')
        : toast.error('Invalid code', 'That doesn’t look like a pairing code. Paste it — retyping or autocorrect will corrupt it.')
    }
    const j = decoded.payload
    setConnecting(true)
    update({ compute: { ...settings.compute, enabled: true, deviceToken: j.deviceToken, deviceName: j.deviceName } })
    try {
      const r = await pingComputer()
      if (r.ok) {
        toast.success('Connected', `${j.deviceName || 'Your computer'} is online.`)
        setCode(''); setRepairing(false)
      } else {
        toast.error('Computer not reachable', r.reason ?? 'Make sure it’s running, then try a command.')
      }
    } finally {
      setConnecting(false)
    }
  }
  const disconnect = () => {
    update({ compute: { ...settings.compute, deviceToken: undefined, deviceName: undefined } })
    setRepairing(false)
    toast.success('Disconnected from the computer')
  }

  return (
    <div className="mt-6">
      <SectionLabel>Computer &amp; code</SectionLabel>
      <div className="rounded-xl border border-line bg-bg0/40 p-3.5">
        <label className="flex items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="text-[13.5px] font-medium flex items-center gap-1.5">
              {native ? <Smartphone size={13} /> : <Monitor size={13} />} Let the AI run code &amp; make files
            </span>
            <span className="text-[11.5px] text-muted leading-snug block mt-0.5">
              {native
                ? 'Runs on a paired computer over your own Supabase project.'
                : 'Runs here when started with npm run dev or the openplex CLI.'}
            </span>
          </span>
          <Switch checked={enabled} onChange={toggle} />
        </label>

        {enabled && native && (
          <div className="mt-3">
            {settings.compute.deviceToken && !repairing ? (
              <div className="rounded-lg border border-line bg-bg1/60 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className={cx('h-2 w-2 rounded-full shrink-0', phoneStatus === 'online' ? 'bg-accent' : phoneStatus === 'offline' ? 'bg-danger' : 'bg-faint animate-pulse')} />
                  <Monitor size={14} className="text-muted shrink-0" />
                  <span className="text-[13px] font-medium flex-1 min-w-0 truncate">{settings.compute.deviceName || 'your computer'}</span>
                  <span className="text-[10.5px] text-faint shrink-0">{phoneStatus === 'online' ? 'online' : phoneStatus === 'offline' ? 'offline' : '…'}</span>
                  <button onClick={() => void checkPhone()} disabled={phoneStatus === 'checking'} data-tip="Re-check" aria-label="Re-check" className="p-1 rounded text-faint hover:text-ink shrink-0">
                    <RefreshCw size={13} className={phoneStatus === 'checking' ? 'animate-spin' : ''} />
                  </button>
                  <button onClick={disconnect} data-tip="Disconnect" aria-label="Disconnect" className="p-1 rounded text-faint hover:text-danger shrink-0">
                    <Trash2 size={13} />
                  </button>
                </div>
                {phoneStatus === 'offline' && (
                  <p className="text-[11px] text-danger/90 leading-snug mt-1.5">Can’t reach it — make sure the app is running on the computer.</p>
                )}
                <button onClick={() => setRepairing(true)} className="text-[11.5px] text-faint hover:text-accent mt-2">Pair a different computer</button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-[11.5px] text-muted leading-snug">
                  On the computer: <span className="text-ink">Settings → Computer &amp; code → Connect a phone</span>, then paste its code:
                </p>
                <div className="flex gap-2">
                  {/* Base64 is case-sensitive and a phone keyboard will capitalise the first
                      letter of a plain text field, which silently corrupts the code. */}
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="Paste pairing code"
                    autoCapitalize="none"
                    autoCorrect="off"
                    autoComplete="off"
                    spellCheck={false}
                    className={cx(inputCls, 'flex-1 min-w-0 font-mono text-[11px]')}
                  />
                  <button onClick={() => void applyCode()} disabled={!code.trim() || connecting} className={cx(btnPrimaryCls, 'shrink-0')}>
                    {connecting ? <Spinner size={12} /> : null} Connect
                  </button>
                </div>
                {repairing && (
                  <button onClick={() => setRepairing(false)} className="text-[11.5px] text-faint hover:text-muted">Cancel</button>
                )}
              </div>
            )}
          </div>
        )}

        {enabled && !native && (
          <div className="mt-3 space-y-2.5">
            <div className="flex items-center gap-2">
              <span className="text-[11.5px] text-muted shrink-0">Name</span>
              <input
                value={settings.compute.deviceName ?? ''}
                onChange={(e) => update({ compute: { ...settings.compute, deviceName: e.target.value } })}
                placeholder="my computer"
                className={cx(inputCls, 'flex-1 min-w-0 py-1.5')}
              />
            </div>

            {devices === null ? (
              <p className="text-[11.5px] text-muted leading-snug">
                Start with <span className="font-mono">npm run dev</span> or the <span className="font-mono">openplex</span> CLI to pair phones.
              </p>
            ) : (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-faint">Paired phones</span>
                  <button onClick={() => void refreshDevices()} data-tip="Refresh" aria-label="Refresh" className="p-1 rounded text-faint hover:text-ink"><RefreshCw size={12} /></button>
                </div>
                {devices.length === 0 ? (
                  <p className="text-[11.5px] text-muted">None yet — add one below.</p>
                ) : (
                  devices.map((d) => {
                    const state = d.active ? 'active' : d.running ? 'waiting' : 'offline'
                    return (
                      <div key={d.deviceToken} className="flex items-center gap-2 rounded-lg border border-line bg-bg1/50 px-2.5 py-1.5">
                        <span className={cx('h-2 w-2 rounded-full shrink-0', state === 'active' ? 'bg-accent' : state === 'waiting' ? 'bg-yellow-400' : 'bg-faint')} />
                        <Smartphone size={13} className="text-muted shrink-0" />
                        <span className="text-[12.5px] flex-1 min-w-0 truncate">{d.label}</span>
                        <span className="text-[10.5px] text-faint shrink-0">{state === 'active' ? 'active' : state === 'waiting' ? 'waiting' : 'offline'}</span>
                        <button onClick={() => void removeDevice(d.deviceToken)} data-tip="Remove" aria-label={`Remove ${d.label}`} className="p-1 rounded text-faint hover:text-danger shrink-0">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    )
                  })
                )}
              </div>
            )}

            {devices !== null && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="New phone label" className={cx(inputCls, 'flex-1 min-w-0 py-1.5')} />
                  <button onClick={() => void makePairing()} disabled={busy} className={cx(btnPrimaryCls, 'shrink-0')}>
                    {busy ? <Spinner size={12} /> : <Plus size={13} />} Add phone
                  </button>
                </div>

                {pairing && (
                  <div className="rounded-lg border border-line bg-bg1/60 p-2.5 space-y-2">
                    <p className={cx('text-[11.5px] flex items-center gap-1 leading-snug', relay === 'running' ? 'text-accent' : 'text-muted')}>
                      {relay === 'running'
                        ? <><Check size={12} className="shrink-0" /> Ready — paste on the phone (shows “active” once it connects).</>
                        : relay === 'starting' ? 'Starting the relay…'
                        : 'Run the app via npm run dev or the openplex CLI to auto-start the relay.'}
                    </p>
                    <div className="flex gap-2">
                      <input readOnly value={pairing} onFocus={(e) => e.currentTarget.select()} className={cx(inputCls, 'flex-1 min-w-0 font-mono text-[11px] py-1.5')} />
                      <button onClick={() => void navigator.clipboard?.writeText(pairing).then(() => toast.success('Copied'))} className={cx(btnCls, 'shrink-0')}>Copy</button>
                    </div>
                    <p className="text-[10.5px] text-danger/80 leading-snug">Contains a login for your account — keep it private; remove a phone to revoke.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.49 12c0-.73.13-1.43.35-2.1V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.16-3.16A11 11 0 0 0 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
    </svg>
  )
}

function AndroidAppSection() {
  if (Capacitor.isNativePlatform()) return null
  return (
    <div className="mt-6">
      <SectionLabel>Android app</SectionLabel>
      <div className="rounded-xl border border-line bg-bg0/40 p-4 flex items-center gap-3">
        <Smartphone size={18} className="text-accent shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] font-medium">Get the Android app</div>
          <div className="text-[12px] text-muted leading-snug">
            Native build — camera capture, share sheet, deep-link sign-in. Signs into this same account.
          </div>
        </div>
        <a
          href="https://github.com/infiter4/openplex/raw/main/docs/openplex.apk"
          download
          className={cx(btnPrimaryCls, 'shrink-0')}
        >
          <Download size={13} /> Download APK
        </a>
      </div>
      <p className="text-[11px] text-faint leading-relaxed mt-2">
        Debug APK — Android warns about installs from outside the Play Store; allow “install unknown apps” for your
        browser, then open the file.
      </p>
    </div>
  )
}

export function SyncTab() {
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  const syncUser = useStore((s) => s.syncUser)
  const syncStatus = useStore((s) => s.syncStatus)
  const lastSyncError = useStore((s) => s.lastSyncError)
  const initSync = useStore((s) => s.initSync)
  const syncNow = useStore((s) => s.syncNow)

  const [url, setUrl] = useState(settings.sync.url ?? '')
  const [anonKey, setAnonKey] = useState(settings.sync.anonKey ?? '')
  const [email, setEmail] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const configured = syncConfigured(settings.sync)
  const eff = effectiveConfig(settings.sync)

  const saveConfig = async () => {
    update({ sync: { url: url.trim(), anonKey: anonKey.trim() } })
    await initSync()
    toast.success('Sync configured', 'Now sign in to start syncing.')
  }

  if (!configured) {
    return (
      <div>
        <p className="text-[12.5px] text-muted leading-relaxed mb-4">
          Sync keeps threads and memories identical across your devices (and the future mobile app) using your own
          free <span className="text-ink font-medium">Supabase</span> project as the backend. Chats stay in{' '}
          <span className="text-ink font-medium">your</span> database — nothing goes through anyone else's server.
          Without sync, everything still works and is stored on this device.
        </p>

        <div className="rounded-xl border border-line bg-bg0/40 p-3.5 mb-4 text-[12.5px] text-muted leading-relaxed space-y-1">
          <div className="font-medium text-ink text-[13px] mb-1.5">One-time setup (~5 minutes, free)</div>
          <div>1. Create a project at <span className="font-mono text-ink">supabase.com</span></div>
          <div>2. In the SQL editor, paste & run <span className="font-mono text-ink">supabase/schema.sql</span> from this repo</div>
          <div>3. Copy the project URL and anon key from Settings → API into the fields below</div>
          <div>4. (Optional) Enable the Google provider under Authentication for one-click sign-in</div>
        </div>

        <Field label="Supabase project URL">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxxx.supabase.co" className={cx(inputCls, 'font-mono text-[12.5px]')} />
        </Field>
        <Field label="Anon (public) key" hint="Safe to use in the browser — row-level security keeps each account's data private.">
          <input value={anonKey} onChange={(e) => setAnonKey(e.target.value)} type="password" placeholder="eyJhbGciOi…" className={cx(inputCls, 'font-mono text-[12.5px]')} />
        </Field>
        <button onClick={() => void saveConfig()} disabled={!url.trim() || !anonKey.trim()} className={btnPrimaryCls}>
          <Cloud size={13} /> Save & enable sync
        </button>

        <AndroidAppSection />
      </div>
    )
  }

  if (!syncUser) {
    return (
      <div>
        <p className="text-[12.5px] text-muted leading-relaxed mb-5">
          Sync is configured (<span className="font-mono text-[11.5px]">{eff.url}</span>). Sign in to link this device.
        </p>
        <div className="space-y-3 max-w-sm">
          <button
            onClick={async () => {
              try {
                await signInWithGoogle(settings.sync)
              } catch (err) {
                toast.error('Google sign-in failed', (err as Error).message)
              }
            }}
            className={cx(btnCls, 'w-full justify-center py-2.5')}
          >
            <GoogleIcon /> Continue with Google
          </button>
          <div className="flex items-center gap-3 text-[11px] text-faint">
            <span className="h-px bg-line flex-1" /> or <span className="h-px bg-line flex-1" />
          </div>
          <div className="flex gap-2">
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" type="email" className={inputCls} />
            <button
              disabled={!email.includes('@') || busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await signInWithEmail(settings.sync, email.trim())
                  setSentTo(email.trim())
                } catch (err) {
                  toast.error('Couldn’t send magic link', (err as Error).message)
                } finally {
                  setBusy(false)
                }
              }}
              className={btnPrimaryCls}
            >
              <Mail size={13} /> {sentTo ? 'Resend link' : 'Send link'}
            </button>
          </div>
          {sentTo && (
            <div className="text-[12.5px] text-muted">
              Magic link sent to <span className="text-ink font-medium">{sentTo}</span>; you can resend another link
              anytime.
            </div>
          )}
          <p className="text-[11.5px] text-faint leading-relaxed">
            Google sign-in requires the Google provider to be enabled in your Supabase project; the magic link works out
            of the box.
          </p>
        </div>
        <button
          onClick={() => update({ sync: {} })}
          className="mt-6 text-[12px] text-faint hover:text-danger transition-colors"
        >
          Remove sync configuration
        </button>
      </div>
    )
  }

  return (
    <div>
      <ConflictBanner />
      <SectionLabel>Account</SectionLabel>
      <div className="rounded-xl border border-line bg-bg0/40 p-4 mb-4">
        <div className="flex items-center gap-3">
          <span className="w-9 h-9 rounded-full bg-accent-soft text-accent flex items-center justify-center font-semibold">
            {(syncUser.email ?? 'U').charAt(0).toUpperCase()}
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-[13.5px] font-medium truncate">{syncUser.email ?? 'Signed in'}</div>
            <div className={cx('text-[12px]', syncStatus === 'error' ? 'text-danger' : 'text-muted')}>
              {syncStatus === 'syncing' ? 'Syncing…' : syncStatus === 'error' ? `Sync error: ${lastSyncError}` : 'Synced'}
            </div>
          </div>
          <button onClick={syncNow} className={btnCls} data-tip="Sync now">
            <RefreshCw size={13} className={syncStatus === 'syncing' ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>
      <p className="text-[12.5px] text-muted leading-relaxed">
        Threads, messages, memories, and settings sync to your Supabase project and to every signed-in device.
      </p>

      <AndroidAppSection />
      <KeySyncSection />
      <ComputeSection />

      <button
        onClick={async () => {
          await signOut(settings.sync)
          toast.info('Signed out', 'Local data stays on this device.')
        }}
        className={cx(btnCls, 'text-danger mt-6')}
      >
        <LogOut size={13} /> Sign out
      </button>
    </div>
  )
}
