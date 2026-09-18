// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const LS_KEY = 'opx.providers'

/** Reproduce the reported state: several providers holding one replayed model list. */
const poisoned = {
  google: { providerId: 'google', kind: 'catalog', apiKey: 'k', models: ['unbiased/pareto', '~deepseek/deepseek-pro-latest'], modelsFetchedAt: Date.now() },
  groq: { providerId: 'groq', kind: 'catalog', apiKey: 'k', models: ['unbiased/pareto', '~deepseek/deepseek-pro-latest'], modelsFetchedAt: Date.now() },
  openrouter: { providerId: 'openrouter', kind: 'catalog', apiKey: 'k', models: ['unbiased/pareto', '~deepseek/deepseek-pro-latest'], modelsFetchedAt: Date.now() },
  zai: { providerId: 'zai', kind: 'catalog', apiKey: 'k', models: ['glm-4.6', 'glm-4.5-air'], modelsFetchedAt: Date.now() },
}

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  if (!window.matchMedia) {
    // @ts-expect-error test stub
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  }
  // Nothing should reach the network in this test.
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
})

describe('startAutoRefresh repairs cache-poisoned model lists', () => {
  it('clears lists that several providers share, and leaves the unique one alone', async () => {
    localStorage.setItem(LS_KEY, JSON.stringify(poisoned))
    const { useProviders } = await import('./providers')
    useProviders.getState().startAutoRefresh()

    const after = useProviders.getState().connections
    // The three that held one replayed list are cleared and marked for refetch...
    for (const id of ['google', 'groq', 'openrouter']) {
      expect(after[id].models, `${id} models`).toEqual([])
      expect(after[id].modelsFetchedAt, `${id} fetchedAt`).toBeUndefined()
    }
    // ...and the provider with its own list keeps it.
    expect(after.zai.models).toEqual(['glm-4.6', 'glm-4.5-air'])
    expect(after.zai.modelsFetchedAt).toBeTruthy()
    // API keys are untouched by the repair.
    expect(after.google.apiKey).toBe('k')
  })

  it('leaves everything alone when every list is distinct', async () => {
    const clean = {
      google: { providerId: 'google', kind: 'catalog', models: ['gemini-3-flash'], modelsFetchedAt: 111 },
      groq: { providerId: 'groq', kind: 'catalog', models: ['llama-4-scout'], modelsFetchedAt: 222 },
    }
    localStorage.setItem(LS_KEY, JSON.stringify(clean))
    const { useProviders } = await import('./providers')
    useProviders.getState().startAutoRefresh()

    const after = useProviders.getState().connections
    expect(after.google.models).toEqual(['gemini-3-flash'])
    expect(after.groq.models).toEqual(['llama-4-scout'])
    expect(after.groq.modelsFetchedAt).toBe(222)
  })
})
