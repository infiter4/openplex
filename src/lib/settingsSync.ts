import { bumpMetaTs, getMetaTs, setMetaTs } from './bus'
import { decryptJson, encryptJson, type EncryptedBlob } from './crypto'
import { shadowGet, shadowPut } from './db'
import { merge3, mergeKeyedMap, mergeListBy, sameValue, type MergeRule } from './merge'
import type { ModelRef, ProviderConnection, PromptPreset, SearchProviderId, Settings } from './types'
import { useConflicts } from '../state/conflicts'
import { useProviders } from '../state/providers'
import { useSettings } from '../state/settings'

const PASS_KEY = 'opx.keysync.pass'
const BLOB_KEY = 'opx.keysync.blob'

export interface SecretsPayload {
  connections: Record<string, ProviderConnection>
  searchKeys: Partial<Record<SearchProviderId, string>>
}

interface MetaPayload {
  settings: Partial<Settings>
  keysBlob?: EncryptedBlob | null
}

export function getStoredPassphrase(): string | null {
  return localStorage.getItem(PASS_KEY)
}

export function storePassphrase(pass: string): void {
  localStorage.setItem(PASS_KEY, pass)
}

export function clearPassphrase(): void {
  localStorage.removeItem(PASS_KEY)
}

export function getStoredBlob(): EncryptedBlob | null {
  try {
    const raw = localStorage.getItem(BLOB_KEY)
    return raw ? (JSON.parse(raw) as EncryptedBlob) : null
  } catch {
    return null
  }
}

function storeBlob(blob: EncryptedBlob | null): void {
  if (blob) localStorage.setItem(BLOB_KEY, JSON.stringify(blob))
  else localStorage.removeItem(BLOB_KEY)
}

export function clearStoredBlob(): void {
  storeBlob(null)
}

function syncableSettings(s: Settings): Partial<Settings> {
  return {
    defaultModel: s.defaultModel,
    defaultSystemPrompt: s.defaultSystemPrompt,
    promptPresets: s.promptPresets,
    temperature: s.temperature,
    memory: s.memory,
    keySync: s.keySync,
    showAllProviders: s.showAllProviders,
    pinnedModels: s.pinnedModels,
    // Repairs and the chosen voice model are plain config — they should follow you between devices.
    providerOverrides: s.providerOverrides,
    voice: s.voice,
    search: { provider: s.search.provider, maxResults: s.search.maxResults, keys: {} },
  }
}

const SHADOW_KEY = 'settings'

/**
 * Settings used to be replaced wholesale by whichever device wrote last — change the theme on the
 * phone and the PC's provider repairs went with it. Now each key is merged on its own, and lists
 * and id-keyed maps are merged entry by entry, so two devices editing different things both keep
 * their work. Only the handful of keys below can actually disagree.
 */
const SETTINGS_RULES: Record<string, MergeRule> = {
  defaultSystemPrompt: { kind: 'text', label: 'Default system prompt' },
  defaultModel: { kind: 'text', label: 'Default model' },
  promptPresets: { kind: 'custom', merge: mergeListBy((p) => (p as PromptPreset)?.id ?? '') },
  pinnedModels: { kind: 'custom', merge: mergeListBy((m) => `${(m as ModelRef)?.providerId}/${(m as ModelRef)?.modelId}`) },
  providerOverrides: { kind: 'custom', merge: mergeKeyedMap },
}

export async function buildMetaPayload(): Promise<{ data: MetaPayload; ts: number } | null> {
  const ts = getMetaTs()
  if (!ts) return null
  const settings = useSettings.getState().settings
  const data: MetaPayload = { settings: syncableSettings(settings) }
  if (settings.keySync.enabled) {
    const pass = getStoredPassphrase()
    if (pass) {
      const secrets: SecretsPayload = {
        connections: useProviders.getState().connections,
        searchKeys: settings.search.keys,
      }
      const blob = await encryptJson(pass, secrets)
      storeBlob(blob)
      data.keysBlob = blob
    } else {
      data.keysBlob = getStoredBlob()
    }
  } else {
    data.keysBlob = null
  }
  return { data, ts }
}

export async function applyMetaPayload(data: MetaPayload, ts: number): Promise<void> {
  const settingsStore = useSettings.getState()
  const providers = useProviders.getState()

  let repush = false

  if (data.settings) {
    const local = settingsStore.settings
    const mine = syncableSettings(local) as Record<string, unknown>
    const theirs = data.settings as Record<string, unknown>
    const base = (await shadowGet(SHADOW_KEY))?.data as Record<string, unknown> | undefined
    const { merged, conflicts } = merge3(base, mine, theirs, SETTINGS_RULES, { localNewer: getMetaTs() >= ts })

    settingsStore.update(
      {
        ...(merged as Partial<Settings>),
        theme: local.theme,
        sync: local.sync,
        compute: local.compute,
        search: {
          ...local.search,
          ...(merged as Partial<Settings>).search,
          keys: local.search.keys, // plaintext keys never ride along; they come via the blob
        },
      },
      { silent: true },
    )

    if (conflicts.length) {
      const withLocal: Record<string, unknown> = { ...merged }
      const withRemote: Record<string, unknown> = { ...merged }
      for (const f of conflicts) {
        withLocal[f.field] = f.local
        withRemote[f.field] = f.remote
      }
      await useConflicts.getState().add({
        id: 'settings:settings',
        kind: 'settings',
        recordId: 'settings',
        title: 'App settings',
        fields: conflicts,
        local: withLocal,
        remote: withRemote,
        localAt: getMetaTs(),
        remoteAt: ts,
        detectedAt: Date.now(),
      })
    }

    await shadowPut(SHADOW_KEY, theirs, ts)
    // We contributed something the server doesn't have yet, so the merge has to go back out.
    repush = !sameValue(merged, theirs)
  }

  if (data.keysBlob) {
    storeBlob(data.keysBlob)
    const pass = getStoredPassphrase()
    if (pass) {
      try {
        const secrets = await decryptJson<SecretsPayload>(pass, data.keysBlob)
        applySecrets(secrets)
        providers.setPendingKeysBlob(null)
      } catch {
        clearPassphrase()
        providers.setPendingKeysBlob(data.keysBlob)
      }
    } else {
      providers.setPendingKeysBlob(data.keysBlob)
    }
  } else if (data.keysBlob === null) {
    storeBlob(null)
    providers.setPendingKeysBlob(null)
  }

  setMetaTs(ts)
  if (repush) bumpMetaTs()
}

export function applySecrets(secrets: SecretsPayload): void {
  const providers = useProviders.getState()
  providers.applyRemoteConnections(secrets.connections ?? {})
  const settingsStore = useSettings.getState()
  const localKeys = settingsStore.settings.search.keys
  settingsStore.update(
    { search: { ...settingsStore.settings.search, keys: { ...localKeys, ...secrets.searchKeys } } },
    { silent: true },
  )
}

export async function unlockSecrets(pass: string): Promise<boolean> {
  const blob = useProviders.getState().pendingKeysBlob ?? getStoredBlob()
  if (!blob) return false
  const secrets = await decryptJson<SecretsPayload>(pass, blob)
  storePassphrase(pass)
  applySecrets(secrets)
  useProviders.getState().setPendingKeysBlob(null)
  return true
}
