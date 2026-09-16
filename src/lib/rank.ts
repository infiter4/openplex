import type { Source } from './types'
import { hostOf } from './utils'

/**
 * Ranking for web results.
 *
 * The old pipeline sorted by `score ?? 0.5` — the search engine's own number — so results from
 * different queries were never really compared, and anything without a score sat in insertion
 * order. That is the difference between "some pages about the topic" and "the pages that answer
 * the question": the engine ranks for the *query*, we have to rank for the *question*.
 *
 * Four signals, each normalised to 0..1, combined with fixed weights:
 *   fusion    — agreement across the queries we ran (reciprocal rank fusion)
 *   lexical   — does this page actually mention what was asked
 *   authority — primary source vs. SEO aggregator
 *   fresh     — only when the question is time-sensitive
 */

const TRACKING = /^(utm_|ref$|referrer$|fbclid$|gclid$|msclkid$|mc_[ce]id$|igshid$|si$|spm$|source$|_ga$|yclid$|at_|trk$|sc_)/i

/**
 * One page, one identity. Search engines hand back the same article with tracking parameters, an
 * /amp suffix, or a trailing slash, and every variant used to count as a separate source — it split
 * the page's cross-query credit, showed up twice in the citations, and burned two context slots on
 * identical text.
 */
export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw)
    u.hash = ''
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '')
    u.protocol = 'https:'
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k)
    u.pathname = u.pathname.replace(/\/amp\/?$/i, '/').replace(/\.amp(\.html?)?$/i, '$1')
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '')
    const qs = u.searchParams.toString()
    return `${u.origin.replace(/^https:\/\/www\./, 'https://')}${u.pathname}${qs ? `?${qs}` : ''}`
  } catch {
    return raw
  }
}

/** Cheap content fingerprint: syndicated copies share a title and an opening paragraph. */
function fingerprint(s: Source): string {
  const title = (s.title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 90)
  const body = `${s.snippet ?? ''} ${s.content ?? ''}`.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 160)
  return `${title}|${body}`
}

/**
 * Drop syndicated re-posts of the same article. Wire stories and press releases come back from five
 * hosts at once; keeping all five spends the context budget on one fact repeated five times.
 * The first copy wins — the list is already ranked, so that's the most authoritative one.
 */
export function dedupeNearDuplicates(sources: Source[]): Source[] {
  const seen = new Set<string>()
  const out: Source[] = []
  for (const s of sources) {
    const fp = fingerprint(s)
    // A title alone is too weak to dedupe on; require some body text to agree as well.
    if (fp.split('|')[1].length > 60 && seen.has(fp)) continue
    seen.add(fp)
    out.push(s)
  }
  return out
}

const STOP = new Set([
  'the', 'a', 'an', 'of', 'for', 'and', 'or', 'to', 'in', 'on', 'at', 'by', 'with', 'about', 'from', 'into',
  'what', 'whats', 'which', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how', 'is', 'are', 'was', 'were',
  'be', 'been', 'do', 'does', 'did', 'can', 'could', 'should', 'would', 'will', 'has', 'have', 'had', 'its',
  'it', 'they', 'them', 'their', 'this', 'that', 'these', 'those', 'you', 'your', 'me', 'my', 'we', 'our',
  'vs', 'versus', 'compare', 'comparison', 'between', 'give', 'tell', 'show', 'find', 'list', 'best', 'top',
])

export function queryTerms(question: string): string[] {
  return [...new Set(
    question
      .toLowerCase()
      .split(/[^a-z0-9.+#-]+/)
      .map((w) => w.replace(/^[-.]+|[-.]+$/g, ''))
      .filter((w) => w.length > 2 && !STOP.has(w)),
  )]
}

/** Hosts that are the subject's own voice, or a primary record of it. */
const PRIMARY_HINT = /(^|\.)(docs?|developer|developers|api|platform|help|support|blog|news|research|arxiv|github|gitlab|huggingface)\./
const PRIMARY_TLD = /\.(gov|edu|mil|int)(\.[a-z]{2})?$/
const PRIMARY_HOST = new Set([
  'arxiv.org', 'github.com', 'huggingface.co', 'openai.com', 'anthropic.com', 'ai.google.dev',
  'wikipedia.org', 'en.wikipedia.org', 'nature.com', 'science.org', 'acm.org', 'ieee.org',
])
/** Content farms, listicles and "stat sites" — they routinely publish invented numbers. */
const LOW_TRUST_HOST = /(^|\.)(medium\.com|quora\.com|pinterest\.|reddit\.com|answers\.|ezinearticles|hubpages|slideshare|scribd|coursehero|studocu|linkedin\.com)$/
const LISTICLE_PATH = /\/(best|top|top-?\d+|\d+-best|cheapest|vs|review|reviews|alternatives|comparison)[-/]/i

export function hostAuthority(url: string, trusted: Set<string> = new Set()): number {
  const host = hostOf(url)
  if (!host) return 0.5
  const trustedHit = [...trusted].some((t) => host === t || host.endsWith(`.${t}`) || t.endsWith(`.${host}`))
  if (trustedHit) return 1
  if (LOW_TRUST_HOST.test(host)) return 0.2
  if (PRIMARY_HOST.has(host) || PRIMARY_TLD.test(host)) return 0.85
  if (PRIMARY_HINT.test(host)) return 0.8
  if (LISTICLE_PATH.test(url)) return 0.3
  return 0.5
}

/** Fraction of the question's distinctive terms the page actually carries; the title counts double. */
export function lexicalScore(s: Source, terms: string[]): number {
  if (!terms.length) return 0.5
  const title = (s.title ?? '').toLowerCase()
  const body = `${s.snippet ?? ''} ${s.content ?? ''}`.toLowerCase().slice(0, 20_000)
  let hit = 0
  for (const t of terms) {
    const inTitle = title.includes(t)
    const inBody = body.includes(t)
    if (inTitle && inBody) hit += 1
    else if (inTitle) hit += 0.85
    else if (inBody) hit += 0.6
  }
  return Math.min(1, hit / terms.length)
}

const TIME_WORDS = /\b(latest|newest|current|currently|today|todays|now|recent|recently|this (?:year|month|week)|so far|up to date|updated|20\d\d|news|just (?:released|announced|launched)|right now)\b/i
export function isTimeSensitive(question: string): boolean {
  return TIME_WORDS.test(question)
}

const YEAR_RE = /\b(20[12]\d)\b/g
/** Best-guess publication year from the URL or the text. Undefined when nothing looks like a date. */
export function yearOf(s: Source): number | undefined {
  const fromUrl = /\/(20[12]\d)\/(?:[01]?\d)\//.exec(s.url ?? '')
  if (fromUrl) return Number(fromUrl[1])
  const text = `${s.title ?? ''} ${s.snippet ?? ''} ${(s.content ?? '').slice(0, 1500)}`
  const years = [...text.matchAll(YEAR_RE)].map((m) => Number(m[1]))
  if (!years.length) return undefined
  return Math.max(...years)
}

export function freshness(s: Source, nowYear: number): number {
  const y = yearOf(s)
  if (y == null) return 0.5 // unknown shouldn't be punished as hard as known-old
  const age = nowYear - y
  if (age <= 0) return 1
  if (age === 1) return 0.75
  if (age === 2) return 0.45
  return 0.2
}

/**
 * Reciprocal rank fusion across the result lists of every query we ran. A page that several
 * different queries surfaced is far likelier to be the right page than one a single query ranked
 * first, and RRF gets that without needing comparable scores between engines or runs.
 */
export function rrf(lists: Source[][], k = 60): Map<string, number> {
  const out = new Map<string, number>()
  for (const list of lists) {
    list.forEach((s, i) => {
      if (!s?.url) return
      out.set(s.url, (out.get(s.url) ?? 0) + 1 / (k + i + 1))
    })
  }
  return out
}

export interface RankOptions {
  trusted?: string[]
  now?: Date
  /** Weights, mostly for tests; the defaults are what the app uses. */
  weights?: { fusion: number; lexical: number; authority: number; fresh: number }
}

const DEFAULT_WEIGHTS = { fusion: 0.42, lexical: 0.3, authority: 0.18, fresh: 0.1 }

/** One merged, ordered list. Sources keep their identity; only the order and `score` change. */
export function rankSources(question: string, lists: Source[][], opts: RankOptions = {}): Source[] {
  const weights = opts.weights ?? DEFAULT_WEIGHTS
  const now = opts.now ?? new Date()
  const nowYear = now.getFullYear()
  const trusted = new Set((opts.trusted ?? []).map((t) => t.toLowerCase().replace(/^www\./, '')))
  const terms = queryTerms(question)
  const timely = isTimeSensitive(question)

  // Merge duplicates across lists, keeping the richest copy of each page.
  const byUrl = new Map<string, Source>()
  for (const list of lists) {
    for (const s of list) {
      if (!s?.url) continue
      const key = canonicalUrl(s.url)
      const prev = byUrl.get(key)
      if (!prev) byUrl.set(key, { ...s, url: key })
      else {
        if (!prev.content && s.content) prev.content = s.content
        if (!prev.snippet && s.snippet) prev.snippet = s.snippet
        if (!prev.title && s.title) prev.title = s.title
        if (!prev.passages?.length && s.passages?.length) prev.passages = s.passages
      }
    }
  }

  const fusion = rrf(lists.map((l) => l.map((s) => ({ ...s, url: canonicalUrl(s.url) }))))
  const maxFusion = Math.max(...fusion.values(), 1e-9)

  const scored = [...byUrl.values()].map((s) => {
    const f = (fusion.get(s.url) ?? 0) / maxFusion
    const l = lexicalScore(s, terms)
    const a = hostAuthority(s.url, trusted)
    const fr = timely ? freshness(s, nowYear) : 0.5
    const score = weights.fusion * f + weights.lexical * l + weights.authority * a + weights.fresh * fr
    return { ...s, score }
  })

  return dedupeNearDuplicates(scored.sort((x, y) => (y.score ?? 0) - (x.score ?? 0)))
}

/**
 * Stop one site from owning the answer. Extra pages from a host aren't dropped, just moved behind
 * everything else — with a cap of 2 a single doc site can still supply its second-best page once
 * the other hosts have had their turn.
 */
export function diversify(sources: Source[], maxPerHost = 2): Source[] {
  const seen = new Map<string, number>()
  const kept: Source[] = []
  const overflow: Source[] = []
  for (const s of sources) {
    const host = hostOf(s.url)
    const n = seen.get(host) ?? 0
    if (n < maxPerHost) {
      seen.set(host, n + 1)
      kept.push(s)
    } else {
      overflow.push(s)
    }
  }
  return [...kept, ...overflow]
}
