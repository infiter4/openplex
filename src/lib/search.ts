import { corsFetch } from './net'
import { canonicalUrl, isTimeSensitive } from './rank'
import type { SearchSettings, Source } from './types'

export class SearchError extends Error {}

const API = 'https://api.tavily.com'

const dedupe = (sources: Source[]): Source[] => {
  const seen = new Set<string>()
  return sources.filter((s) => {
    if (!s.url || seen.has(s.url)) return false
    seen.add(s.url)
    return true
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function keyOrThrow(settings: SearchSettings): string {
  const key = settings.keys.tavily
  if (!key) throw new SearchError('Add a Tavily API key in Settings → Web search — the free tier covers 1,000 searches a month.')
  return key
}

function explain(status: number): string {
  if (status === 401) return 'Invalid Tavily API key — check it in Settings → Web search.'
  if (status === 429) return 'Tavily rate limit hit. Wait a few seconds and try again.'
  if (status === 432 || status === 433) return 'Tavily usage/credit limit reached for this key.'
  return `Tavily request failed (HTTP ${status}).`
}

async function tavily<T>(path: string, key: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await corsFetch(
      `${API}${path}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify(body), signal },
      { buffered: true },
    )
    // One retry for the two failures that are genuinely transient.
    if ((res.status === 429 || res.status >= 500) && attempt === 0) {
      await sleep(1200)
      continue
    }
    if (!res.ok) throw new SearchError(explain(res.status))
    return (await res.json()) as T
  }
}

interface TavilyResult {
  title?: string
  url: string
  content?: string
  raw_content?: string
  score?: number
  published_date?: string
}

/**
 * Tavily's `content` is not a blurb — at advanced depth with chunks_per_source it is the passages
 * its own reranker picked out of the page. That is the highest-value text in the whole response,
 * and truncating it to a preview threw most of it away. Keep the passages for the answer, and a
 * short slice of the first one for the UI.
 */
function splitChunks(content: string): string[] {
  return content
    .split(/\s*\[\.\.\.\]\s*|\n{2,}/)
    .map((c) => c.trim())
    .filter((c) => c.length > 40)
}

const toSource = (r: TavilyResult): Source => {
  const content = (r.content ?? '').trim()
  const passages = splitChunks(content)
  return {
    title: r.title ?? r.url,
    url: canonicalUrl(r.url),
    snippet: (passages[0] ?? content).slice(0, 320),
    passages: passages.length ? passages : content ? [content] : undefined,
    content: typeof r.raw_content === 'string' && r.raw_content.trim() ? r.raw_content.slice(0, 14_000) : undefined,
    score: typeof r.score === 'number' ? r.score : undefined,
  }
}

export interface SearchOptions {
  includeDomains?: string[]
  maxResults?: number
  signal?: AbortSignal
  /** Force the recency-tuned news path on/off; inferred from the query when unset. */
  fresh?: boolean
}

export async function webSearch(query: string, settings: SearchSettings, opts: SearchOptions = {}): Promise<Source[]> {
  const key = keyOrThrow(settings)
  const q = query.slice(0, 400)
  const max = opts.maxResults ?? settings.maxResults ?? 6
  const timely = opts.fresh ?? isTimeSensitive(q)

  const body: Record<string, unknown> = {
    query: q,
    max_results: max,
    search_depth: 'advanced',
    // Advanced depth returns several passages per page rather than one blurb — more to rank on,
    // and often enough to answer without opening the page at all.
    chunks_per_source: 3,
    include_raw_content: true,
  }
  if (opts.includeDomains?.length) body.include_domains = opts.includeDomains.slice(0, 20)
  if (timely) body.time_range = 'year'

  const json = await tavily<{ results?: TavilyResult[] }>('/search', key, body, opts.signal)
  return dedupe((json.results ?? []).map(toSource)).slice(0, max)
}

/**
 * Run every query at once. Each query's results come back as its own ordered list, because the
 * ranking stage fuses those orders — flattening here would throw away the signal.
 * Failures are collected rather than thrown: one dead query shouldn't sink the whole search.
 */
export async function searchAll(
  queries: string[],
  settings: SearchSettings,
  opts: SearchOptions = {},
): Promise<{ lists: Source[][]; errors: unknown[] }> {
  const unique = [...new Set(queries.map((q) => q.trim()).filter(Boolean))].slice(0, 8)
  if (!unique.length) return { lists: [], errors: [] }
  // One query has to carry the whole question on its own, so give it more room; six queries each
  // bring their own angle and the ranker has plenty to fuse.
  const perQuery = opts.maxResults ?? Math.max(4, Math.round((settings.maxResults ?? 6) * (unique.length <= 2 ? 1.6 : 1)))
  const settled = await Promise.all(
    unique.map(async (q) => {
      try {
        return { list: await webSearch(q, settings, { ...opts, maxResults: perQuery }), err: null as unknown }
      } catch (err) {
        return { list: [] as Source[], err }
      }
    }),
  )
  return {
    lists: settled.map((s) => s.list).filter((l) => l.length),
    errors: settled.map((s) => s.err).filter(Boolean),
  }
}

/**
 * Full text for pages worth reading. Tavily's extract endpoint takes up to 20 URLs per call, so
 * this is one round trip for the whole batch instead of one per page — the single biggest reason
 * the old pipeline felt slow. Falls back to Jina's keyless reader for anything it can't parse.
 */
export async function fetchPages(
  urls: string[],
  settings: SearchSettings,
  opts: { signal?: AbortSignal } = {},
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const todo = [...new Set(urls.filter(Boolean))]
  if (!todo.length) return out

  const key = settings.keys.tavily
  if (key) {
    const batches: string[][] = []
    for (let i = 0; i < todo.length; i += 20) batches.push(todo.slice(i, i + 20))
    const results = await Promise.all(
      batches.map(async (batch) => {
        try {
          return await tavily<{ results?: Array<{ url: string; raw_content?: string }> }>(
            '/extract',
            key,
            { urls: batch, extract_depth: 'advanced' },
            opts.signal,
          )
        } catch {
          return { results: [] }
        }
      }),
    )
    for (const r of results) {
      for (const row of r.results ?? []) {
        const text = (row.raw_content ?? '').replace(/\n{3,}/g, '\n\n').trim()
        if (text) out.set(row.url, text.slice(0, 14_000))
      }
    }
  }

  const missed = todo.filter((u) => !out.has(u))
  if (missed.length) {
    await Promise.all(
      missed.slice(0, 6).map(async (url) => {
        try {
          const text = await readerFallback(url, settings, opts.signal)
          if (text) out.set(url, text)
        } catch {
          /* unreadable page — the snippet still stands */
        }
      }),
    )
  }
  return out
}

/** r.jina.ai works without a key at low volume; it's only here for pages Tavily can't extract. */
async function readerFallback(url: string, settings: SearchSettings, signal?: AbortSignal): Promise<string> {
  const headers: Record<string, string> = { 'X-Return-Format': 'text' }
  const res = await corsFetch(`https://r.jina.ai/${url}`, { headers, signal }, { buffered: true })
  if (!res.ok) throw new SearchError(`Couldn’t open page (HTTP ${res.status}).`)
  void settings
  return (await res.text()).replace(/\n{3,}/g, '\n\n').trim().slice(0, 14_000)
}

/** Single-page read, kept for callers that want one URL. */
export async function fetchPage(url: string, settings: SearchSettings, opts: { signal?: AbortSignal } = {}): Promise<string> {
  const got = await fetchPages([url], settings, opts)
  const text = got.get(url)
  if (!text) throw new SearchError('Page had no readable text.')
  return text
}

export function mergeSources(a: Source[], b: Source[], cap = 10): Source[] {
  return dedupe([...a, ...b])
    .sort((x, y) => (y.score ?? 0.5) - (x.score ?? 0.5))
    .slice(0, cap)
}

/** Strip the bulk text before a source is stored on a message and synced — the UI only shows the
 *  title, host and snippet, and passages/full pages would multiply every thread's size. */
export function lightSources(sources: Source[]): Source[] {
  return sources.map(({ content: _content, passages: _passages, ...s }) => s)
}
