// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
// Imported statically: pulling heal.ts in spins up the settings/providers stores, which is slow
// enough to blow a per-test timeout if it happens inside the first `it`.
import { REPAIR_TOOLS, runHeal, safeHeaders } from './heal'

describe('safeHeaders', () => {
  it('drops credentials — an override is stored in plain synced settings', () => {
    expect(safeHeaders({ Authorization: 'Bearer sk-123', 'X-Title': 'openplex' })).toEqual({ 'X-Title': 'openplex' })
    expect(safeHeaders({ 'x-api-key': 'sk-123', 'API-Key': 'sk-123' })).toBeUndefined()
  })

  it('keeps ordinary headers and ignores non-string values', () => {
    expect(safeHeaders({ 'anthropic-version': '2023-06-01', retries: 3 })).toEqual({ 'anthropic-version': '2023-06-01' })
    expect(safeHeaders(undefined)).toBeUndefined()
  })
})

describe('REPAIR_TOOLS', () => {
  it('offers diagnosis, verification and a way to persist the fix', () => {
    const names = REPAIR_TOOLS.map((t) => t.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'get_provider_config',
        'list_provider_models',
        'web_search',
        'fetch_page',
        'test_request',
        'apply_override',
        'clear_override',
        'refresh_catalog',
      ]),
    )
  })

  it('never advertises computer-only tools by default — those are added only when a PC is reachable', () => {
    const names = REPAIR_TOOLS.map((t) => t.name)
    for (const n of ['terminal', 'read_file', 'edit_file', 'write_file']) expect(names).not.toContain(n)
  })

  it('can add a provider the app has never heard of', () => {
    // Without this the agent could only patch providers that already existed, so "add Chutes and
    // its models" was impossible — on the phone and on the PC alike.
    const add = REPAIR_TOOLS.find((t) => t.name === 'add_provider')
    expect(add).toBeDefined()
    const props = (add!.parameters as { properties: Record<string, unknown> }).properties
    for (const p of ['provider_id', 'name', 'base_url', 'api_style', 'models']) expect(props).toHaveProperty(p)
    // Keys are the user's to paste; the agent must never be handed one.
    expect(Object.keys(props)).not.toContain('api_key')
  })
})

describe('runHeal guards', () => {
  it('refuses a provider with no endpoint instead of posting into the void', async () => {
    await expect(runHeal({ conn: { providerId: 'mystery', kind: 'catalog' }, model: 'whatever', target: {} })).rejects.toThrow(/No endpoint/i)
  })

  it('refuses a repair model whose API cannot call tools', async () => {
    await expect(runHeal({ conn: { providerId: 'cohere', kind: 'catalog' }, model: 'command-r', target: {} })).rejects.toThrow(/tool calling/i)
  })
})
