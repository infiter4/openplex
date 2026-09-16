// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { safeHref } from './utils'

describe('safeHref', () => {
  it('passes through safe navigable schemes', () => {
    expect(safeHref('https://example.com/x')).toBe('https://example.com/x')
    expect(safeHref('http://localhost:11434')).toBe('http://localhost:11434')
    expect(safeHref('mailto:a@b.com')).toBe('mailto:a@b.com')
  })

  it('neutralizes dangerous schemes from untrusted source URLs', () => {
    expect(safeHref('javascript:alert(document.cookie)')).toBe('#')
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBe('#')
    expect(safeHref('vbscript:msgbox(1)')).toBe('#')
  })

  it('handles empty/garbage input', () => {
    expect(safeHref(undefined)).toBe('#')
    expect(safeHref('')).toBe('#')
  })
})
