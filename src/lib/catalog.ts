import { kvGet, kvSet } from './db'
import { providerOverride } from './providers'
import type { Catalog, CatalogModel, CatalogProvider, ModelRef, ProviderConnection } from './types'

const CATALOG_URL = 'https://models.dev/api.json'
const SEED_URL = `${import.meta.env.BASE_URL}catalog-seed.json`
const CACHE_KEY = 'catalog_v2'
const MAX_AGE = 12 * 60 * 60 * 1000

const CONTEXT_FALLBACKS: Array<[RegExp, number]> = [
  [/grok-4/i, 256_000],
  [/grok-3/i, 131_072],
  [/grok-2/i, 131_072],
  [/^o[134]\b|^o[134]-/i, 200_000],
]

function fallbackContext(modelId: string): number | undefined {
  for (const [re, ctx] of CONTEXT_FALLBACKS) if (re.test(modelId)) return ctx
  return undefined
}

interface CachedCatalog {
  fetchedAt: number
  data: Catalog
}

function sanitize(raw: unknown): Catalog {
  const out: Catalog = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [id, p] of Object.entries(raw as Record<string, unknown>)) {
    if (!p || typeof p !== 'object') continue
    const prov = p as Partial<CatalogProvider> & { models?: unknown }
    const models: Record<string, CatalogModel> = {}
    if (prov.models && typeof prov.models === 'object') {
      for (const [mid, m] of Object.entries(prov.models as Record<string, unknown>)) {
        if (!m || typeof m !== 'object') continue
        const mm = m as CatalogModel
        const model: CatalogModel = { ...mm, id: mm.id ?? mid, name: mm.name ?? mid }
        if (model.limit?.context == null) {
          const fb = fallbackContext(model.id)
          if (fb) model.limit = { ...model.limit, context: fb }
        }
        models[mid] = model
      }
    }
    out[id] = {
      id,
      name: prov.name ?? id,
      api: prov.api || undefined,
      env: prov.env,
      npm: prov.npm,
      doc: prov.doc,
      models,
    }
  }
  return out
}

let seedPromise: Promise<Catalog> | null = null

export async function loadSeedCatalog(): Promise<Catalog> {
  if (!seedPromise) {
    seedPromise = (async () => {
      const res = await fetch(SEED_URL)
      if (!res.ok) throw new Error(`seed HTTP ${res.status}`)
      const data = sanitize(await res.json())
      if (Object.keys(data).length === 0) throw new Error('empty seed')
      return data
    })().catch((err) => {
      seedPromise = null
      throw err
    })
  }
  return seedPromise
}

export async function peekCachedCatalog(): Promise<Catalog | null> {
  const cached = await kvGet<CachedCatalog>(CACHE_KEY)
  return cached?.data ?? null
}

export async function loadCatalog(opts?: { force?: boolean }): Promise<{ catalog: Catalog; stale: boolean }> {
  const cached = await kvGet<CachedCatalog>(CACHE_KEY)
  const fresh = cached && Date.now() - cached.fetchedAt < MAX_AGE
  if (cached && fresh && !opts?.force) return { catalog: cached.data, stale: false }

  try {
    const { corsFetch } = await import('./net')
    const res = await corsFetch(CATALOG_URL, {}, { buffered: true })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = sanitize(await res.json())
    if (Object.keys(data).length === 0) throw new Error('empty catalog')
    await kvSet(CACHE_KEY, { fetchedAt: Date.now(), data } satisfies CachedCatalog)
    return { catalog: data, stale: false }
  } catch (err) {
    if (cached) return { catalog: cached.data, stale: true }
    try {
      return { catalog: await loadSeedCatalog(), stale: true }
    } catch {
      throw err
    }
  }
}

/**
 * Which models to show for a provider.
 *
 * When we have the provider's own live /models list, THAT is the source of truth: catalog entries
 * the provider no longer serves are dropped, and anything it serves that models.dev hasn't got yet
 * is added. models.dev lags both ways, and a dead model that fails on send is worse than a missing
 * one. With no live list we fall back to the catalog as-is.
 */
export function modelsForProvider(provider: CatalogProvider, conn?: ProviderConnection): CatalogModel[] {
  const catalogModels = Object.values(provider.models)
  // Models a repair added. They're never pruned by the live list: the whole reason a repair adds
  // one is that neither the catalog nor /models knows about it yet.
  const repaired = (providerOverride(provider.id)?.models ?? []).map((id) => ({ id, name: id }) as CatalogModel)
  const withRepaired = (list: CatalogModel[]) => {
    if (!repaired.length) return list
    const seen = new Set(list.map((m) => m.id))
    return [...list, ...repaired.filter((m) => !seen.has(m.id))]
  }

  let live = conn?.models
  // opencode proxies other vendors' models under names we don't want to duplicate.
  if (provider.id === 'opencode' && live?.length) live = live.filter((id) => !/^(gpt-|gemini-)/i.test(id))
  if (!live || live.length === 0) return withRepaired(catalogModels)

  const liveSet = new Set(live)
  const known = new Set(Object.keys(provider.models))

  const kept = catalogModels.filter((m) => liveSet.has(m.id))
  const extras = live.filter((id) => !known.has(id)).map((id) => ({ id, name: id }) as CatalogModel)
  return withRepaired([...kept, ...extras])
}

export function resolveModel(catalog: Catalog | null, ref: ModelRef | undefined): { provider?: CatalogProvider; model?: CatalogModel } {
  if (!catalog || !ref) return {}
  const provider = catalog[ref.providerId]
  const model = provider?.models[ref.modelId]
  return { provider, model }
}

export function modelDisplayName(catalog: Catalog | null, ref: ModelRef | undefined): string {
  if (!ref) return 'No model'
  const { model } = resolveModel(catalog, ref)
  return model?.name ?? ref.modelId
}
