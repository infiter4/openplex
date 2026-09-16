import { describe, expect, it } from 'vitest'
import { friendlyError, makeThinkSplitter } from './llm'

/** Feed `chunks` through the splitter (simulating a token stream) and collect the routed output. */
function run(chunks: string[]) {
  let text = ''
  let reason = ''
  const s = makeThinkSplitter((d) => (text += d), (d) => (reason += d))
  for (const c of chunks) s.push(c)
  s.flush()
  return { text, reason }
}

describe('friendlyError', () => {
  it('relays the provider’s exact message, whatever the status', () => {
    // The whole point: openplex never decides what the error "really" was. It reports what the
    // provider said. Paraphrasing is how "free tier rate limit" once became "your account doesn't
    // have access to this model" — a billing-page wild goose chase over a 60-second limit.
    const cases: Array<[number, string, string]> = [
      [400, 'opencode', "Error from provider (Console): OpenCode's free tier can only be used in OpenCode"],
      [402, 'zai', 'insufficient balance for model glm-4.6'],
      [403, 'opencode', 'daily limit reached for free accounts'],
      [429, 'groq', 'free tier rate limit exceeded'],
      [403, 'openai', 'your organization must be verified to use this model'],
      [503, 'anthropic', 'upstream overloaded, retry shortly'],
      [404, 'cohere', 'model command-r-old was retired'],
      [418, 'weird', 'something nobody has a pattern for'],
    ]
    for (const [status, provider, raw] of cases) {
      const out = friendlyError(status, provider, raw)
      expect(out).toContain(raw)
      expect(out.startsWith(`${provider} (HTTP ${status}): `)).toBe(true)
    }
  })

  it('never invents a diagnosis the provider did not give', () => {
    const out = friendlyError(400, 'opencode', "OpenCode's free tier can only be used in OpenCode")
    expect(out).not.toMatch(/doesn’t have access|paid plan|verification/)
  })

  it('collapses whitespace so a multi-line body stays readable', () => {
    expect(friendlyError(400, 'x', 'line one\n\n  line two')).toContain('line one line two')
  })

  it('adds a tip only where there is something to actually do', () => {
    expect(friendlyError(429, 'groq', 'rate limit exceeded')).toMatch(/wait ~30–60s/i)
    expect(friendlyError(400, 'openai', 'maximum context length is 8192 tokens')).toMatch(/lower the context cap/i)
    expect(friendlyError(401, 'openai', 'bad key')).toMatch(/check the API key/i)
    // Nothing actionable to add — the provider's sentence stands alone.
    expect(friendlyError(418, 'weird', 'teapot')).toBe('weird (HTTP 418): teapot')
  })

  it('treats a 429 as a limit no matter what words came with it', () => {
    expect(friendlyError(429, 'opencode', 'not allowed to use this on your tier')).toMatch(/wait ~30–60s/i)
  })

  it('is honest when the provider sent nothing at all', () => {
    expect(friendlyError(500, 'openai', '')).toContain('sent no error message')
    expect(friendlyError(401, 'openai', '')).toMatch(/check the API key/i)
  })
})

describe('makeThinkSplitter', () => {
  it('routes <thought>…</thought> with no trailing space (the Gemma case)', () => {
    const r = run(['<thought>Plan: state the fact.</thought>Octopuses can edit their RNA.'])
    expect(r.reason).toBe('Plan: state the fact.')
    expect(r.text).toBe('Octopuses can edit their RNA.')
  })

  it('strips an optional trailing space after the close tag', () => {
    const r = run(['<think>reasoning here</think> the answer'])
    expect(r.reason).toBe('reasoning here')
    expect(r.text).toBe('the answer')
  })

  it('handles a tag split across streaming chunks', () => {
    const r = run(['<thou', 'ght>hidden</thou', 'ght>visible'])
    expect(r.reason).toBe('hidden')
    expect(r.text).toBe('visible')
  })

  it('passes plain content through untouched', () => {
    const r = run(['just ', 'an answer'])
    expect(r.reason).toBe('')
    expect(r.text).toBe('just an answer')
  })
})
