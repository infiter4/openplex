import { describe, expect, it } from 'vitest'
import { canonicalUrl, dedupeNearDuplicates, diversify, freshness, hostAuthority, isTimeSensitive, lexicalScore, queryTerms, rankSources, rrf, yearOf } from './rank'
import type { Source } from './types'

const src = (url: string, title = '', snippet = '', content?: string): Source => ({ url, title, snippet, content })

describe('queryTerms', () => {
  it('keeps the distinctive words and drops the question scaffolding', () => {
    expect(queryTerms('What are the rate limits for the Cerebras API?')).toEqual(['rate', 'limits', 'cerebras', 'api'])
  })

  it('keeps version-ish tokens intact', () => {
    expect(queryTerms('gpt-4o vs claude-opus-5 pricing')).toContain('gpt-4o')
    expect(queryTerms('gpt-4o vs claude-opus-5 pricing')).toContain('claude-opus-5')
  })
})

describe('hostAuthority', () => {
  it('puts primary sources above random blogs and aggregators above nothing', () => {
    const docs = hostAuthority('https://docs.anthropic.com/en/api/rate-limits')
    const blog = hostAuthority('https://some-random-site.example/post')
    const farm = hostAuthority('https://medium.com/@someone/the-truth')
    expect(docs).toBeGreaterThan(blog)
    expect(blog).toBeGreaterThan(farm)
  })

  it('treats a listicle path as low trust even on an unknown host', () => {
    expect(hostAuthority('https://example.com/best-10-ai-models/')).toBeLessThan(hostAuthority('https://example.com/docs/limits'))
  })

  it('a host the model explicitly trusted wins outright', () => {
    expect(hostAuthority('https://medium.com/@x/post', new Set(['medium.com']))).toBe(1)
  })

  it('matches subdomains of a trusted host', () => {
    expect(hostAuthority('https://api.example.com/page', new Set(['example.com']))).toBe(1)
  })
})

describe('lexicalScore', () => {
  const terms = queryTerms('cerebras api rate limits')
  it('rewards a page that carries the asked-for terms in its title', () => {
    const onPoint = lexicalScore(src('https://a.example', 'Cerebras API rate limits', 'requests per minute'), terms)
    const offPoint = lexicalScore(src('https://b.example', 'Our company blog', 'we love computers'), terms)
    expect(onPoint).toBeGreaterThan(offPoint)
    expect(offPoint).toBeLessThan(0.3)
  })

  it('is neutral when the question has no distinctive terms', () => {
    expect(lexicalScore(src('https://a.example', 'x'), [])).toBe(0.5)
  })
})

describe('recency', () => {
  it('spots a time-sensitive question', () => {
    expect(isTimeSensitive('what is the latest claude model')).toBe(true)
    expect(isTimeSensitive('best gpu 2026')).toBe(true)
    expect(isTimeSensitive('how does tcp work')).toBe(false)
  })

  it('reads a year out of the url or the text', () => {
    expect(yearOf(src('https://a.example/2024/06/post'))).toBe(2024)
    expect(yearOf(src('https://a.example/x', 'Report', 'published 2025, updated 2026'))).toBe(2026)
    expect(yearOf(src('https://a.example/x', 'Report', 'no dates here'))).toBeUndefined()
  })

  it('prefers this year, and is kinder to undated pages than to old ones', () => {
    expect(freshness(src('https://a/2026/01/x'), 2026)).toBe(1)
    const undated = freshness(src('https://a/x', 'no date'), 2026)
    const old = freshness(src('https://a/2019/01/x'), 2026)
    expect(undated).toBeGreaterThan(old)
  })
})

describe('rrf', () => {
  it('rewards a page several queries agree on over one query’s favourite', () => {
    const a = src('https://a.example')
    const b = src('https://b.example')
    const c = src('https://c.example')
    const scores = rrf([[a, b], [c, b], [c, b]])
    expect(scores.get(b.url)!).toBeGreaterThan(scores.get(a.url)!)
    expect(scores.get(b.url)!).toBeGreaterThan(scores.get(c.url)!)
  })
})

describe('rankSources', () => {
  it('lifts the on-topic primary source above a first-placed listicle', () => {
    const listicle = src('https://contentfarm.example/best-10-apis-2019/', 'Best 10 APIs', 'a list of apis')
    const docs = src('https://docs.cerebras.ai/api/limits', 'Cerebras API rate limits', 'The Cerebras API allows 30 requests per minute')
    // The listicle is what the engine put first.
    const out = rankSources('cerebras api rate limits', [[listicle, docs]])
    expect(out[0].url).toBe(docs.url)
  })

  it('merges duplicates across queries and keeps the richest copy', () => {
    const thin = src('https://a.example', 'A', 'short preview')
    const rich = { ...src('https://a.example', 'A', 'short preview'), content: 'the whole page text' }
    const out = rankSources('anything', [[thin], [rich]])
    expect(out).toHaveLength(1)
    expect(out[0].content).toBe('the whole page text')
  })

  it('only lets recency matter when the question is time-sensitive', () => {
    const old = src('https://a.example/2019/01/x', 'Model list', 'model list')
    const fresh = src('https://b.example/2026/01/x', 'Model list', 'model list')
    const timeless = rankSources('model list', [[old], [fresh]])
    const timely = rankSources('latest model list', [[old], [fresh]])
    expect(timely[0].url).toBe(fresh.url)
    // Without a time cue the two are ranked on their merits, not their dates.
    expect(Math.abs((timeless[0].score ?? 0) - (timeless[1].score ?? 0))).toBeLessThan(0.1)
  })

  it('returns an empty list for no input rather than throwing', () => {
    expect(rankSources('q', [])).toEqual([])
  })
})

describe('canonicalUrl', () => {
  it('collapses the variants search engines hand back for one page', () => {
    const want = 'https://example.com/docs/limits'
    expect(canonicalUrl('https://www.example.com/docs/limits/')).toBe(want)
    expect(canonicalUrl('http://example.com/docs/limits?utm_source=x&utm_medium=y')).toBe(want)
    expect(canonicalUrl('https://example.com/docs/limits#section-2')).toBe(want)
    expect(canonicalUrl('https://example.com/docs/limits/amp/')).toBe(want)
  })

  it('keeps parameters that actually select content', () => {
    expect(canonicalUrl('https://example.com/p?id=42&utm_source=x')).toBe('https://example.com/p?id=42')
  })

  it('leaves an unparseable string alone', () => {
    expect(canonicalUrl('not a url')).toBe('not a url')
  })
})

describe('dedupeNearDuplicates', () => {
  const body = 'The company announced today that the new rate limit is thirty requests per minute for all free accounts.'
  it('keeps one copy of a syndicated story', () => {
    const out = dedupeNearDuplicates([
      src('https://origin.example/a', 'Company raises limits', body),
      src('https://syndicated.example/b', 'Company raises limits', body),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].url).toBe('https://origin.example/a')
  })

  it('does not merge different pages that happen to share a title', () => {
    const out = dedupeNearDuplicates([
      src('https://a.example/1', 'Release notes', 'version 2 adds streaming support and a new endpoint for batches'),
      src('https://b.example/2', 'Release notes', 'version 9 removes the legacy parameter and changes default timeouts'),
    ])
    expect(out).toHaveLength(2)
  })
})

describe('diversify', () => {
  it('stops one host from owning the top of the list, without dropping its pages', () => {
    const list = [
      src('https://a.example/1'), src('https://a.example/2'), src('https://a.example/3'),
      src('https://b.example/1'),
    ]
    const out = diversify(list, 2)
    expect(out.map((s) => s.url)).toEqual([
      'https://a.example/1', 'https://a.example/2', 'https://b.example/1', 'https://a.example/3',
    ])
  })
})
