import { describe, expect, it } from 'vitest'
import { buildSearchAugmentedText, packPassages, relevantExcerpt } from './prompts'
import type { Source } from './types'

describe('relevantExcerpt', () => {
  const filler = (n: number) => 'lorem ipsum dolor sit amet '.repeat(n)

  it('returns short text untouched', () => {
    expect(relevantExcerpt('a short page', ['page'], 500)).toBe('a short page')
  })

  it('collects the answer from several places in one page, not just the first', () => {
    // The two facts are far apart — a single window can only ever carry one of them.
    const text = `${filler(60)} the rate limit is 30 rpm ${filler(120)} the price is $2 per million ${filler(60)}`
    const out = relevantExcerpt(text, ['rate', 'limit', 'price'], 3000)
    expect(out).toContain('rate limit is 30 rpm')
    expect(out).toContain('price is $2 per million')
    expect(out.length).toBeLessThanOrEqual(3000)
  })

  it('falls back to the head of the page when nothing matches', () => {
    const text = filler(200)
    expect(relevantExcerpt(text, ['nothingmatcheshere'], 300)).toBe(text.slice(0, 300))
  })

  it('respects the budget', () => {
    const text = `${filler(50)} limit ${filler(50)} limit ${filler(50)} limit ${filler(50)}`
    expect(relevantExcerpt(text, ['limit'], 900).length).toBeLessThanOrEqual(900)
  })
})

describe('packPassages', () => {
  const filler = (n: number) => 'unrelated background prose about the company history '.repeat(n)

  it('spends the budget on the page that answers, not evenly across pages', () => {
    const answer: Source = {
      title: 'Docs', url: 'https://docs.example/limits',
      passages: ['The rate limit is 30 requests per minute on the free tier.'],
    }
    const filler1: Source = { title: 'Blog', url: 'https://blog.example/a', content: filler(40) }
    const filler2: Source = { title: 'News', url: 'https://news.example/b', content: filler(40) }
    const packed = packPassages('what is the rate limit per minute', [filler1, answer, filler2], 900)
    expect(packed.get(1)).toContain('30 requests per minute')
  })

  it('stops one long page from eating the whole budget', () => {
    const hog: Source = { title: 'Hog', url: 'https://a.example', content: `rate limit ${filler(400)}` }
    const other: Source = { title: 'Other', url: 'https://b.example', passages: ['rate limit is 30 rpm'] }
    const packed = packPassages('rate limit', [hog, other], 4000)
    expect(packed.get(1)).toBeTruthy()
    expect((packed.get(0) ?? '').length).toBeLessThanOrEqual(4000 * 0.4 + 1200)
  })

  it('keeps a page’s passages in document order', () => {
    const s: Source = { title: 'Doc', url: 'https://a.example', passages: ['alpha limit', 'beta limit', 'gamma limit'] }
    const packed = packPassages('limit', [s], 10_000)
    const text = packed.get(0) ?? ''
    expect(text.indexOf('alpha')).toBeLessThan(text.indexOf('beta'))
    expect(text.indexOf('beta')).toBeLessThan(text.indexOf('gamma'))
  })

  it('respects the total budget', () => {
    const s: Source = { title: 'Doc', url: 'https://a.example', content: `limit ${filler(500)}` }
    const total = [...packPassages('limit', [s, s, s], 2000).values()].reduce((n, t) => n + t.length, 0)
    expect(total).toBeLessThanOrEqual(2000)
  })
})

describe('buildSearchAugmentedText', () => {
  const sources: Source[] = [
    { title: 'Docs', url: 'https://docs.example/limits', content: 'x'.repeat(2000) },
    { title: 'Blog', url: 'https://blog.example/post', snippet: 'a short preview' },
  ]

  it('numbers the sources so citations can point at them', () => {
    const out = buildSearchAugmentedText('what are the limits', sources)
    expect(out).toContain('[1] Docs — https://docs.example/limits')
    expect(out).toContain('[2] Blog — https://blog.example/post')
  })

  it('marks which sources are whole pages and which are only previews', () => {
    const out = buildSearchAugmentedText('what are the limits', sources)
    expect(out).toContain('(full page)')
    expect(out).toContain('(preview only)')
  })

  it('keeps the question at the top so the model answers it, not the sources', () => {
    expect(buildSearchAugmentedText('what are the limits', sources).startsWith('what are the limits')).toBe(true)
  })
})
