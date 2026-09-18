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

describe('modelsForProvider — the live list is the provider speaking for itself', () => {
  it('believes a live list even when the catalog recognises none of it', () => {
    // Regression: this used to fall back to the catalog, on the theory that zero overlap meant a
    // wrong endpoint. But models.dev lags — a provider that renamed everything shares nothing with
    // it, and rejecting the truth left the picker showing only retired models.
    const groq = { id: 'groq', name: 'Groq', models: { 'llama-3.1-70b-retired': { id: 'llama-3.1-70b-retired', name: 'old' } } } as never
    const conn = { providerId: 'groq', kind: 'catalog', models: ['llama-4-scout', 'qwen/qwen3.8-27b'] } as never
    expect(modelsForProvider(groq, conn).map((m) => m.id)).toEqual(['llama-4-scout', 'qwen/qwen3.8-27b'])
  })

  it('still trusts the live list when it genuinely overlaps', () => {
    const google = {
      id: 'google', name: 'Google',
      models: { 'gemini-2.5-pro': { id: 'gemini-2.5-pro', name: 'x' }, 'gemini-old': { id: 'gemini-old', name: 'y' } },
    } as never
    const conn = { providerId: 'google', kind: 'catalog', models: ['gemini-2.5-pro', 'gemini-3-new'] } as never
    const out = modelsForProvider(google, conn).map((m) => m.id)
    expect(out).toContain('gemini-2.5-pro') // kept
    expect(out).toContain('gemini-3-new') // added
    expect(out).not.toContain('gemini-old') // pruned
  })

  it('still trusts the live list for a custom provider the catalog knows nothing about', () => {
    const custom = { id: 'mygw', name: 'My Gateway', models: {} } as never
    const conn = { providerId: 'mygw', kind: 'custom', models: ['vendor/a', 'vendor/b'] } as never
    expect(modelsForProvider(custom, conn).map((m) => m.id)).toEqual(['vendor/a', 'vendor/b'])
  })
})

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
