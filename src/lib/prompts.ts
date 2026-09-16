import type { ChatTurn } from './llm'
import type { Attachment, CatalogModel, Memory, Message, Source } from './types'
import { estimateTokens } from './utils'

function attachmentTokens(atts?: Attachment[]): number {
  if (!atts?.length) return 0
  let n = 0
  for (const a of atts) {
    if (a.kind === 'document') n += estimateTokens(a.text ?? '') + (a.pageImages?.length ?? 0) * 1100
    else n += 1100
  }
  return n
}

export const DEFAULT_ASSISTANT_PROMPT = `You are openplex, a sharp, direct AI assistant.

Style:
- Lead with the answer. No filler, no restating the question, no "great question".
- Match depth to the ask: a one-liner for simple things; headings, lists, or tables only when they genuinely help.
- Use tables for comparisons, specs, and limits. Use fenced code blocks with language tags for code.
- Bold the key figures and decisions so answers are scannable.
- If something is uncertain or may have changed, say so plainly and note what would confirm it.
- Never invent facts, citations, or URLs. Respond in the user's language.`

export function buildSystemPrompt(opts: {
  defaultPrompt?: string
  threadPrompt?: string
  memories: Memory[]
  memoryEnabled: boolean
}): string {
  const parts: string[] = []
  parts.push(DEFAULT_ASSISTANT_PROMPT)
  const custom = [opts.defaultPrompt, opts.threadPrompt].map((p) => p?.trim()).filter(Boolean)
  if (custom.length) {
    parts.push(
      `Additional instructions from the user — follow these closely; where they conflict with the defaults above, the user's instructions win:\n\n${custom.join('\n\n')}`,
    )
  }

  if (opts.memoryEnabled) {
    const active = opts.memories.filter((m) => m.enabled && !m.deleted)
    if (active.length) {
      const lines = active
        .slice(-60)
        .map((m) => `- ${m.content}`)
        .join('\n')
      parts.push(`Things to remember about the user (from previous conversations):\n${lines}`)
    }
  }

  parts.push(`Today's date: ${new Date().toDateString()}.`)
  return parts.join('\n\n')
}

/**
 * Pull the passages that actually mention what was asked. A single window (what this used to do)
 * loses the answer whenever a page states half of it in a spec table and the other half three
 * screens down, so take several non-overlapping windows and stitch them with an ellipsis.
 */
export function relevantExcerpt(text: string, focus: string[], max: number, windows = 3): string {
  if (text.length <= max) return text
  const lower = text.toLowerCase()
  const hits: number[] = []
  for (const w of focus) {
    let i = lower.indexOf(w)
    while (i >= 0 && hits.length < 600) { hits.push(i); i = lower.indexOf(w, i + w.length) }
  }
  if (!hits.length) return text.slice(0, max)
  hits.sort((a, b) => a - b)

  const size = Math.max(400, Math.floor(max / windows))
  const picked: Array<{ start: number; end: number }> = []
  const used = new Set<number>()
  for (let n = 0; n < windows && picked.length * size < max; n++) {
    let bestStart = -1
    let bestCount = 0
    for (const h of hits) {
      if (used.has(h)) continue
      const start = Math.max(0, h - Math.floor(size / 4))
      const end = start + size
      if (picked.some((p) => start < p.end && end > p.start)) continue
      const count = hits.reduce((acc, x) => (x >= start && x < end && !used.has(x) ? acc + 1 : acc), 0)
      if (count > bestCount) { bestCount = count; bestStart = start }
    }
    if (bestStart < 0) break
    const end = bestStart + size
    picked.push({ start: bestStart, end })
    for (const h of hits) if (h >= bestStart && h < end) used.add(h)
  }
  if (!picked.length) return text.slice(0, max)

  picked.sort((a, b) => a.start - b.start)
  const parts = picked.map((p) => text.slice(p.start, p.end).trim())
  const joined = (picked[0].start > 0 ? '…' : '') + parts.join('\n…\n')
  return joined.length > max ? joined.slice(0, max) : joined
}

/** Slice a long page into overlapping windows so a passage can't be cut in half at a boundary. */
function windowsOf(text: string, size = 1100, stride = 850): string[] {
  const out: string[] = []
  for (let i = 0; i < text.length && out.length < 40; i += stride) out.push(text.slice(i, i + size))
  return out
}

/** Every candidate passage a source can offer, best-known text first. */
function passagesOf(s: Source): string[] {
  const out: string[] = []
  for (const p of s.passages ?? []) if (p.trim()) out.push(p.trim())
  if (!out.length && s.snippet?.trim()) out.push(s.snippet.trim())
  const full = s.content?.trim()
  if (full) out.push(...windowsOf(full.replace(/\s{3,}/g, '  ')))
  return out
}

function passageScore(text: string, focus: string[]): number {
  if (!focus.length) return 0.5
  const lower = text.toLowerCase()
  let hit = 0
  for (const f of focus) if (lower.includes(f)) hit++
  const coverage = hit / focus.length
  // A passage carrying concrete figures is usually the one holding the answer.
  const figures = /\b\d[\d,.]*\s*(%|k|m|b|gb|mb|tb|ms|s|rpm|rps|tokens?|usd|eur|\$|€|£)?\b/gi
  const density = Math.min(1, ((text.match(figures) ?? []).length / 12))
  return coverage * 0.8 + density * 0.2
}

/**
 * Choose the text the model gets to read, passage by passage instead of page by page.
 *
 * Splitting the budget evenly across sources is what makes an answer engine vague: the page that
 * actually holds the answer gets the same slice as the seventh-best link, and its relevant section
 * may be the part that got cut. Score every candidate passage against the question, take the best
 * globally, and cap how much any one page can claim so a single long doc can't crowd the rest out.
 */
export function packPassages(question: string, sources: Source[], budgetChars: number): Map<number, string> {
  const focus = [...new Set(question.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3))]
  const perSourceCap = Math.max(1_200, Math.floor(budgetChars * 0.4))

  const candidates: Array<{ src: number; order: number; text: string; score: number }> = []
  sources.forEach((s, src) => {
    passagesOf(s).forEach((text, order) => {
      candidates.push({ src, order, text, score: passageScore(text, focus) })
    })
  })
  // Ties broken by document order, so an unscoreable page still yields its opening.
  candidates.sort((a, b) => b.score - a.score || a.src - b.src || a.order - b.order)

  const taken = new Map<number, Array<{ order: number; text: string }>>()
  const usedBySource = new Map<number, number>()
  let used = 0
  for (const c of candidates) {
    if (used >= budgetChars) break
    const mine = usedBySource.get(c.src) ?? 0
    if (mine + c.text.length > perSourceCap) continue
    if (used + c.text.length > budgetChars) continue
    usedBySource.set(c.src, mine + c.text.length)
    used += c.text.length
    const list = taken.get(c.src) ?? []
    list.push({ order: c.order, text: c.text })
    taken.set(c.src, list)
  }

  const out = new Map<number, string>()
  for (const [src, list] of taken) {
    list.sort((a, b) => a.order - b.order)
    // Mark the jumps so the model knows the page continues between quoted parts.
    const joined = list.map((p, i) => (i > 0 && list[i - 1].order + 1 !== p.order ? `…\n${p.text}` : p.text)).join('\n')
    out.set(src, joined.trim())
  }
  return out
}

export function buildSearchAugmentedText(question: string, sources: Source[], budgetChars = 24_000): string {
  const packed = packPassages(question, sources, budgetChars)
  const block = sources
    .map((s, i) => {
      const isFull = (s.content?.trim().length ?? 0) > 1200
      const body = packed.get(i) || (s.snippet ?? '').trim() || '(no text retrieved)'
      // Saying which are whole pages and which are previews lets the model weigh them: a preview
      // that doesn't mention a figure is no evidence the figure isn't on the page.
      return `[${i + 1}] ${s.title} — ${s.url} (${isFull ? 'full page' : 'preview only'})\n${body}`
    })
    .join('\n\n')
  return `${question}

---
Web search results for the question above:

${block}
---
Answer the question using these results:
- Cite sources inline with bracketed numbers like [1] or [2][3] right after the claims they support. Never invent a citation or a URL.
- Lead with the direct answer; use a table when comparing limits, prices, or specs.
- Trust PRIMARY sources (official model cards/blogs, benchmark leaderboards like Artificial Analysis/LMArena, papers, vendor docs) over unfamiliar aggregator sites. A generic "best X scores 2026" page is NOT reliable on its own.
- NEVER state a benchmark number, price, or spec you can't attribute to a credible source. If the reliable figure isn't in the results, write "no reliable figure found" for that cell — do NOT fill it from a sketchy source or from memory and present it as fact.
- If sources conflict, show the discrepancy and say which source is more authoritative; don't silently pick one.
- Watch the dates. When a figure can change over time (prices, limits, rankings, "latest"), prefer the most recent source and say when it's from; treat an undated page as older than a dated one.
- "preview only" means you are seeing a snippet, not the whole page — its silence on a detail proves nothing.
- The results may be noisy — use the parts that genuinely address the question and ignore the rest.
- If the results don't fully cover the question, answer what you can, then add what you reliably know clearly marked (e.g. "Beyond the sources:"). Be specific: give the concrete numbers, names, and limits asked for — but only when they're actually supported.`
}

export function agenticSearchPrompt(): string {
  return `You are the research planner for an answer engine. You decide, ENTITY BY ENTITY, whether the gathered sources actually contain the specific data the user asked for — and what to search next for anything still missing.

You get: the user's question, the list of entities it asks about, and a numbered list of sources (each tagged [FULL] = whole page loaded, or [SNIPPET] = preview only).

For EACH entity, look in the sources for the concrete data the question asks about it (the actual number / price / policy / date / fact). A name merely APPEARING in a source is NOT coverage — only count an entity as covered when the asked-for data is genuinely present.

Reply with ONLY JSON, no prose, no code fence:
{"thought": "one or two plain sentences for the user — what's covered and what's still missing", "gaps": [{"entity": "<name>", "query": "<a specific search that would find its missing data>"}, ...], "read": [source numbers worth opening in full]}

Rules:
- "gaps": one entry for EVERY entity still missing its data. For each, write a NEW, specific query — the entity's correct name + the exact data asked + (when useful) "official" or the kind of page you'd expect. Do NOT repeat a query that clearly already ran; try a different angle.
- "gaps": [] means EVERY entity now has the asked-for data — only then are you done.
- If an entity's data plausibly isn't published anywhere, still list it as a gap once but say so in "thought" — the loop stops on its own, so never pad gaps to look busy.
- Prefer "read" of an existing [SNIPPET] over re-searching when the right page is already listed. At most 4 reads and 6 gaps per step.
- Never invent data — judge only from the sources shown. Today is ${new Date().toDateString()}.`
}

export function sourceSelectionPrompt(): string {
  return `You are choosing which web sources to trust before answering a question. You get the question and a numbered list of REAL results from a first search — each with its host and a short preview.

Pick the hosts that are PRIMARY or authoritative for THIS question, and the specific results worth opening in full.

Reply with ONLY JSON, no prose:
{"thought": "one plain sentence naming which sources you'll trust and why (shown to the user)", "trust": ["host.com", ...], "read": [result numbers]}

Rules:
- Choose "trust" hosts ONLY from the hosts shown in the list — never invent or recall a domain that isn't there. Prefer the primary source for the subject: its official site / release blog, the benchmark's own leaderboard, the paper (e.g. arxiv.org), the project's repo (e.g. github.com), or first-party vendor docs.
- Be skeptical of aggregators, listicles, "best X 2026" round-ups, SEO blogs, and calculator/stat sites — they routinely publish made-up numbers. Don't trust a lone aggregator for a figure you could get from the primary source.
- "read": 1-5 result numbers most likely to hold the exact data asked for (favor the primary sources you trusted).
- If NONE of the results look authoritative, return {"thought": "...", "trust": [], "read": []} — the search will broaden rather than lock onto bad sources.
- Today is ${new Date().toDateString()}.`
}

export function coverageCheckPrompt(): string {
  return `You check whether web search results adequately cover a user's question.

Reply with ONLY JSON, nothing else:
- {"covered": true} if the results contain what's needed to answer well.
- {"covered": false, "queries": ["...", "..."]} with 1-2 NEW search queries targeting exactly what's missing (different terms, the precise product/doc name, official sources, specific numbers). Don't repeat queries that clearly produced these results.`
}

export function searchQueryPrompt(): string {
  return `You turn a user's latest message into effective web-search queries, and list the entities it asks about.

Reply with ONLY a JSON object, no prose, no code fence:
{"thought": "one or two sentences — what the user is really after (resolved from the conversation) and what data you'll search for; shown to the user, so keep it readable", "entities": ["Each Named Subject", "..."], "queries": ["query 1", "query 2"]}

Rules:
- "entities": EVERY distinct named subject the question asks about — each product, API, company, model, person, place. Spell each one correctly: fix typos and expand abbreviations (e.g. "crebas"→"Cerebras", "minstreal ai"→"Mistral AI", "gpt oss 120b"→"GPT-OSS-120B", "kilo gateways"→"Kilo Code"). List them ALL — this is the coverage checklist.
- "queries" (1-5 short strings): NEVER use the user's sentence as a query. Search the SUBJECT and the DATA, not the wording. If the message is an instruction ("make a table of…", "compare…"), search the underlying facts. Give EACH entity its own query combined with the specific thing asked (e.g. "Cerebras API data retention policy").
- Resolve references from the conversation: "it", "that", "those", "the ones above" → the actual names from earlier turns (even from your own previous answer).
- Prefer short keyword queries over full sentences. For time-sensitive topics add the current year. Today is ${new Date().toDateString()}.

Example → user: "what are the limts for the free models github ai offers(not co-poilet)"
{"thought": "They want GitHub Models free-tier limits, not Copilot.", "entities": ["GitHub Models"], "queries": ["GitHub Models free tier rate limits", "GitHub Models API free usage limits ${new Date().getFullYear()}"]}

Example → user: "Wbat are crebas api and minstreal ai api and kilo gateways data retention policies"
{"thought": "They want the data-retention policy of three services, names corrected.", "entities": ["Cerebras", "Mistral AI", "Kilo Code"], "queries": ["Cerebras API data retention policy", "Mistral AI API data retention policy", "Kilo Code data retention policy"]}

Reply with only the JSON object.`
}

export function buildTurns(opts: {
  messages: Message[]
  model?: CatalogModel
  systemPrompt: string
  finalUserTextOverride?: string
  reserveOutput?: number
  contextCap?: number
}): { turns: ChatTurn[]; trimmed: number } {
  const visible = opts.messages.filter(
    (m) => !m.deleted && m.status !== 'error' && (m.content.trim().length > 0 || (m.attachments?.length ?? 0) > 0),
  )

  const modelLimit = opts.model?.limit?.context ?? 16_000
  const contextLimit = Math.min(modelLimit, Math.max(2_000, opts.contextCap ?? modelLimit))
  const reserve = opts.reserveOutput ?? Math.min(opts.model?.limit?.output ?? 4096, 8192)
  let budget = Math.floor(contextLimit * 0.85) - reserve - estimateTokens(opts.systemPrompt)

  const turns: ChatTurn[] = []
  let trimmed = 0
  for (let i = visible.length - 1; i >= 0; i--) {
    const m = visible[i]
    const isLast = i === visible.length - 1
    const text = isLast && m.role === 'user' && opts.finalUserTextOverride ? opts.finalUserTextOverride : m.content
    const tokens = estimateTokens(text) + attachmentTokens(m.attachments)
    if (budget - tokens < 0 && turns.length > 0) {
      trimmed = i + 1
      break
    }
    budget -= tokens
    turns.unshift({ role: m.role, content: text, attachments: m.attachments })
  }

  while (turns.length && turns[0].role === 'assistant') {
    turns.shift()
    trimmed++
  }

  const merged: ChatTurn[] = []
  for (const t of turns) {
    const prev = merged[merged.length - 1]
    if (prev && prev.role === t.role) {
      prev.content = `${prev.content}\n\n${t.content}`
      if (t.attachments?.length) prev.attachments = [...(prev.attachments ?? []), ...t.attachments]
    } else {
      merged.push({ ...t })
    }
  }
  return { turns: merged, trimmed }
}

export function estimateContextUsage(opts: { messages: Message[]; systemPrompt: string }): number {
  let total = estimateTokens(opts.systemPrompt)
  for (const m of opts.messages) {
    if (m.deleted || m.status === 'error') continue
    total += estimateTokens(m.content) + attachmentTokens(m.attachments)
  }
  return total
}

export const TITLE_PROMPT = `Generate a short title (3-6 words) for this conversation. Reply with ONLY the title — no quotes, no punctuation at the end, no explanations.`

export function memoryExtractionPrompt(existing: string[]): string {
  return `You maintain long-term memory for an AI assistant. From the conversation excerpt, extract durable facts about the user worth remembering across future conversations: stable preferences, their role/expertise, ongoing projects, important constraints.

Rules:
- Only genuinely durable facts. Ignore one-off questions, pleasantries, and anything ephemeral.
- Each memory is one short, self-contained sentence.
- Do not repeat anything from the existing memory list.
- Reply with ONLY a JSON array of strings. If there is nothing worth remembering, reply [].

Existing memories:
${existing.length ? existing.map((m) => `- ${m}`).join('\n') : '(none)'}`
}
