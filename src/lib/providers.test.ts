import { afterEach, describe, expect, it } from 'vitest'
import { authHeaders, endpointFor, isBrowserReady, resolveModelId, setProviderOverrides } from './providers'
import type { CatalogProvider, ProviderConnection } from './types'

const prov = (id: string, api?: string): CatalogProvider => ({ id, name: id, api, models: {} })
const conn = (providerId: string, extra: Partial<ProviderConnection> = {}): ProviderConnection => ({
  providerId,
  kind: 'catalog',
  ...extra,
})

describe('endpointFor', () => {
  it('uses the curated manual endpoint for well-known providers', () => {
    expect(endpointFor(conn('openai'))).toEqual({ baseUrl: 'https://api.openai.com/v1', style: 'openai' })
  })

  it('falls back to the models.dev catalog api for unlisted providers', () => {
    const ep = endpointFor(conn('requesty'), prov('requesty', 'https://router.requesty.ai/v1'))
    expect(ep).toEqual({ baseUrl: 'https://router.requesty.ai/v1', style: 'openai' })
  })

  it('strips a trailing slash from the catalog api', () => {
    const ep = endpointFor(conn('fireworks-extra'), prov('fireworks-extra', 'https://api.example.ai/v1/'))
    expect(ep?.baseUrl).toBe('https://api.example.ai/v1')
  })

  it('rejects ${VAR} placeholder apis instead of producing a broken endpoint', () => {
    expect(endpointFor(conn('neon'), prov('neon', '${NEON_AI_GATEWAY_BASE_URL}/v1'))).toBeNull()
  })

  it('honors a user/custom base URL override', () => {
    const ep = endpointFor(conn('whatever', { baseUrl: 'https://my-box.local:8000/v1/' }))
    expect(ep?.baseUrl).toBe('https://my-box.local:8000/v1')
  })

  it('returns null when nothing is known and no api is given', () => {
    expect(endpointFor(conn('mystery'), prov('mystery'))).toBeNull()
  })
})

describe('isBrowserReady', () => {
  it('is true for a manually mapped provider', () => {
    expect(isBrowserReady(prov('anthropic'))).toBe(true)
  })
  it('is true for a provider with a usable catalog api', () => {
    expect(isBrowserReady(prov('requesty', 'https://router.requesty.ai/v1'))).toBe(true)
  })
  it('is false for a placeholder api', () => {
    expect(isBrowserReady(prov('neon', '${X}/v1'))).toBe(false)
  })
  it('is false for cloud-IAM providers that cannot work from a browser', () => {
    expect(isBrowserReady(prov('amazon-bedrock'))).toBe(false)
  })
})

describe('provider repair overrides', () => {
  afterEach(() => setProviderOverrides(undefined))

  it('repairs a moved endpoint on a provider we ship a table entry for', () => {
    setProviderOverrides({ openai: { baseUrl: 'https://api.openai.com/v2', updatedAt: 1 } })
    expect(endpointFor(conn('openai'))?.baseUrl).toBe('https://api.openai.com/v2')
  })

  it('still lets a base URL the user typed win over the repair', () => {
    setProviderOverrides({ openai: { baseUrl: 'https://repaired.example/v1', updatedAt: 1 } })
    expect(endpointFor(conn('openai', { baseUrl: 'https://mine.local/v1' }))?.baseUrl).toBe('https://mine.local/v1')
  })

  it('can switch the API style and merge extra headers', () => {
    setProviderOverrides({ groq: { apiStyle: 'anthropic', headers: { 'anthropic-version': '2023-06-01' }, updatedAt: 1 } })
    const ep = endpointFor(conn('groq'))
    expect(ep?.style).toBe('anthropic')
    expect(ep?.headers).toEqual({ 'anthropic-version': '2023-06-01' })
    expect(ep?.baseUrl).toBe('https://api.groq.com/openai/v1')
  })

  it('gives an endpoint to a provider nothing else knows about', () => {
    setProviderOverrides({ mystery: { baseUrl: 'https://new-gateway.example/v1/', updatedAt: 1 } })
    expect(endpointFor(conn('mystery'), prov('mystery'))).toMatchObject({
      baseUrl: 'https://new-gateway.example/v1',
      style: 'openai',
    })
  })

  it('leaves the catalog api in place when the repair only adds headers', () => {
    setProviderOverrides({ requesty: { headers: { 'X-Fix': '1' }, updatedAt: 1 } })
    const ep = endpointFor(conn('requesty'), prov('requesty', 'https://router.requesty.ai/v1'))
    expect(ep?.baseUrl).toBe('https://router.requesty.ai/v1')
    expect(ep?.headers).toEqual({ 'X-Fix': '1' })
  })

  it('does nothing when no override is registered', () => {
    expect(endpointFor(conn('openai'))).toEqual({ baseUrl: 'https://api.openai.com/v1', style: 'openai' })
  })
})

describe('resolveModelId', () => {
  afterEach(() => setProviderOverrides(undefined))

  it('maps a retired model id onto its replacement', () => {
    setProviderOverrides({ openai: { modelAliases: { 'gpt-4-32k': 'gpt-4o' }, updatedAt: 1 } })
    expect(resolveModelId('openai', 'gpt-4-32k')).toBe('gpt-4o')
  })

  it('passes through ids with no alias, and providers with no override', () => {
    setProviderOverrides({ openai: { modelAliases: { 'gpt-4-32k': 'gpt-4o' }, updatedAt: 1 } })
    expect(resolveModelId('openai', 'gpt-4o-mini')).toBe('gpt-4o-mini')
    expect(resolveModelId('groq', 'gpt-4-32k')).toBe('gpt-4-32k')
  })
})

describe('authHeaders', () => {
  it('uses x-api-key for anthropic style', () => {
    expect(authHeaders('anthropic', 'sk-123')['x-api-key']).toBe('sk-123')
  })
  it('uses a Bearer token for openai style', () => {
    expect(authHeaders('openai', 'sk-123')['Authorization']).toBe('Bearer sk-123')
  })
})
