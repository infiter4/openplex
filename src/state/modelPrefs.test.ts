// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

// matchMedia is referenced at module-init in settings.ts; happy-dom usually
// provides it, but stub defensively so the test is environment-independent.
beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  if (!window.matchMedia) {
    // @ts-expect-error test stub
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  }
})

describe('modelPrefs (synced favorites)', () => {
  it('initializes without throwing and migrates legacy localStorage pins into settings', async () => {
    const legacy = [{ providerId: 'openai', modelId: 'gpt-5' }]
    localStorage.setItem('opx.pinnedModels', JSON.stringify(legacy))

    // Regression: this import used to crash at module init when legacy pins
    // existed (the migration update fired a subscriber that read a half-built
    // store), which blanked the whole app.
    const { useModelPrefs } = await import('./modelPrefs')
    const { useSettings } = await import('./settings')

    expect(useModelPrefs.getState().pinned).toEqual(legacy)
    expect(useSettings.getState().settings.pinnedModels).toEqual(legacy)
  })

  it('togglePin adds/removes a favorite and mirrors it into synced settings', async () => {
    const { useModelPrefs } = await import('./modelPrefs')
    const { useSettings } = await import('./settings')
    const ref = { providerId: 'anthropic', modelId: 'claude-opus-4-8' }

    useModelPrefs.getState().togglePin(ref)
    expect(useModelPrefs.getState().isPinned(ref)).toBe(true)
    expect(useSettings.getState().settings.pinnedModels).toContainEqual(ref)

    useModelPrefs.getState().togglePin(ref)
    expect(useModelPrefs.getState().isPinned(ref)).toBe(false)
    expect(useSettings.getState().settings.pinnedModels).not.toContainEqual(ref)
  })

  it('a settings update from another device is mirrored into the store', async () => {
    const { useModelPrefs } = await import('./modelPrefs')
    const { useSettings } = await import('./settings')
    const remote = [{ providerId: 'groq', modelId: 'llama-4' }]

    useSettings.getState().update({ pinnedModels: remote })
    expect(useModelPrefs.getState().pinned).toEqual(remote)
  })
})
