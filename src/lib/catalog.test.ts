import { describe, expect, it } from 'vitest'
import { modelsForProvider } from './catalog'
import type { CatalogProvider, ProviderConnection } from './types'

const provider = (id: string, modelIds: string[]): CatalogProvider => ({
  id,
  name: id,
  models: Object.fromEntries(modelIds.map((m) => [m, { id: m, name: m }])),
})
const conn = (providerId: string, models?: string[]): ProviderConnection => ({ providerId, kind: 'catalog', models })
const ids = (list: { id: string }[]) => list.map((m) => m.id).sort()

describe('modelsForProvider', () => {
  it('falls back to the catalog when there is no live model list', () => {
    const p = provider('openai', ['gpt-5', 'o3'])
    expect(ids(modelsForProvider(p, conn('openai')))).toEqual(['gpt-5', 'o3'])
    expect(ids(modelsForProvider(p, undefined))).toEqual(['gpt-5', 'o3'])
  })

  it('drops catalog models the provider no longer serves', () => {
    // models.dev still lists a retired model; the provider's own /models does not.
    const p = provider('openai', ['gpt-5', 'retired-model'])
    expect(ids(modelsForProvider(p, conn('openai', ['gpt-5'])))).toEqual(['gpt-5'])
  })

  it('adds models the provider serves that the catalog has not caught up with', () => {
    const p = provider('groq', ['llama-3'])
    expect(ids(modelsForProvider(p, conn('groq', ['llama-3', 'brand-new-model'])))).toEqual(['brand-new-model', 'llama-3'])
  })

  it('treats an empty live list as "unknown" rather than "nothing available"', () => {
    const p = provider('openai', ['gpt-5'])
    expect(ids(modelsForProvider(p, conn('openai', [])))).toEqual(['gpt-5'])
  })

  it('filters proxied vendor models out of opencode', () => {
    const p = provider('opencode', ['claude-sonnet'])
    const got = ids(modelsForProvider(p, conn('opencode', ['claude-sonnet', 'gpt-4o', 'gemini-2.5-pro'])))
    expect(got).toEqual(['claude-sonnet'])
  })
})
