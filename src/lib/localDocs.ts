import type { AgentFile } from './types'

/**
 * Browser-side document generation — works with NO computer paired.
 * Covers the everyday formats (html/md/txt/csv/json + a real text PDF) with zero dependencies,
 * so "make me a PDF" still works on a phone. Rich conversions (docx/pptx/xlsx, CSS-perfect PDFs)
 * still route to the computer when one is reachable.
 */

export const LOCAL_FORMATS = ['pdf', 'html', 'htm', 'md', 'markdown', 'txt', 'text', 'csv', 'json'] as const

export function canMakeLocally(format: string): boolean {
  return (LOCAL_FORMATS as readonly string[]).includes((format || '').toLowerCase().replace(/^\./, ''))
}

const PAGE = { w: 595.28, h: 841.89 } // A4 points
const MARGIN = 56
const LEADING = 1.45

// Helvetica / Helvetica-Bold AFM advance widths (per 1000 em) for ASCII 32..126.
const HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584]
const HELVB = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584]

function widthOf(s: string, size: number, bold: boolean): number {
  const t = bold ? HELVB : HELV
  let w = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    w += c >= 32 && c <= 126 ? t[c - 32] : 556
  }
  return (w / 1000) * size
}

// Exotic spaces (NBSP, figure/thin/hair spaces, ideographic space, BOM) -> a plain space. Built
// from a string so the source stays readable — the characters themselves are invisible.
const ODD_SPACE = new RegExp('[\\u00A0\\u1680\\u2000-\\u200B\\u202F\\u205F\\u3000\\uFEFF]', 'g')

/** PDF base-14 fonts are single-byte; fold typography down to Latin-1 so byte offsets stay exact. */
function toLatin1(s: string): string {
  return s
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(ODD_SPACE, ' ')
    .replace(/[^ -ÿ\n\r\t]/g, '?')
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')

const CODE_RE = new RegExp('`([^`]+)`', 'g')

const stripInline = (s: string) =>
  s
    .replace(CODE_RE, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')

interface Block { text: string; size: number; bold: boolean; gap: number; indent: number }

function parseBlocks(md: string): Block[] {
  const out: Block[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) out.push({ text: stripInline(para.join(' ')), size: 11, bold: false, gap: 9, indent: 0 })
    para = []
  }
  for (const raw of md.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd()
    if (!line.trim()) { flush(); continue }
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      flush()
      const lvl = h[1].length
      out.push({ text: stripInline(h[2]), size: [20, 16, 13.5, 12][lvl - 1], bold: true, gap: lvl === 1 ? 6 : 15, indent: 0 })
      continue
    }
    const b = line.match(/^\s*[-*+]\s+(.*)$/)
    if (b) { flush(); out.push({ text: '• ' + stripInline(b[1]), size: 11, bold: false, gap: 4, indent: 14 }); continue }
    const n = line.match(/^\s*(\d+)[.)]\s+(.*)$/)
    if (n) { flush(); out.push({ text: `${n[1]}. ${stripInline(n[2])}`, size: 11, bold: false, gap: 4, indent: 14 }); continue }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flush(); out.push({ text: '', size: 11, bold: false, gap: 10, indent: 0 }); continue }
    if (/^\s*>\s?/.test(line)) { flush(); out.push({ text: stripInline(line.replace(/^\s*>\s?/, '')), size: 11, bold: false, gap: 6, indent: 18 }); continue }
    para.push(line.trim())
  }
  flush()
  return out
}

function wrapLine(text: string, size: number, bold: boolean, maxW: number): string[] {
  if (!text) return ['']
  const lines: string[] = []
  let cur = ''
  for (const word of text.split(/\s+/)) {
    const next = cur ? `${cur} ${word}` : word
    if (!cur || widthOf(next, size, bold) <= maxW) cur = next
    else { lines.push(cur); cur = word }
  }
  if (cur) lines.push(cur)
  return lines
}

function latin1Bytes(s: string): Uint8Array {
  const b = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff
  return b
}

/** Minimal, valid, selectable-text PDF (base-14 Helvetica) built from markdown-ish text. */
export function pdfFromMarkdown(md: string): Uint8Array {
  const maxW = PAGE.w - MARGIN * 2
  const pages: string[][] = []
  let ops: string[] = []
  let y = PAGE.h - MARGIN
  const breakPage = () => { pages.push(ops); ops = []; y = PAGE.h - MARGIN }

  for (const b of parseBlocks(md)) {
    y -= b.gap
    for (const ln of wrapLine(b.text, b.size, b.bold, maxW - b.indent)) {
      const lh = b.size * LEADING
      if (y - lh < MARGIN) breakPage()
      y -= lh
      if (ln) {
        ops.push(`BT /${b.bold ? 'F2' : 'F1'} ${b.size} Tf ${(MARGIN + b.indent).toFixed(2)} ${y.toFixed(2)} Td (${esc(toLatin1(ln))}) Tj ET`)
      }
    }
  }
  pages.push(ops)

  const n = pages.length
  const pageIds: number[] = []
  const contentIds: number[] = []
  let next = 3
  for (let i = 0; i < n; i++) pageIds.push(next++)
  for (let i = 0; i < n; i++) contentIds.push(next++)
  const f1 = next++
  const f2 = next++

  const objs: string[] = []
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objs[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${n} >>`
  pageIds.forEach((id, i) => {
    objs[id] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.w.toFixed(2)} ${PAGE.h.toFixed(2)}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${contentIds[i]} 0 R >>`
  })
  contentIds.forEach((id, i) => {
    const s = pages[i].join('\n')
    objs[id] = `<< /Length ${s.length} >>\nstream\n${s}\nendstream`
  })
  objs[f1] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  objs[f2] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'

  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = out.length
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`
  }
  const xref = out.length
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`
  for (let i = 1; i < objs.length; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return latin1Bytes(out)
}

const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const inlineHtml = (s: string) =>
  escHtml(s)
    .replace(CODE_RE, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')

/** Small markdown -> styled, self-contained HTML (used for the html target). */
export function mdToHtml(md: string, title: string): string {
  const body: string[] = []
  let list: 'ul' | 'ol' | null = null
  const closeList = () => { if (list) { body.push(`</${list}>`); list = null } }
  for (const raw of md.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd()
    if (!line.trim()) { closeList(); continue }
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) { closeList(); body.push(`<h${h[1].length}>${inlineHtml(h[2])}</h${h[1].length}>`); continue }
    const b = line.match(/^\s*[-*+]\s+(.*)$/)
    if (b) {
      if (list !== 'ul') { closeList(); body.push('<ul>'); list = 'ul' }
      body.push(`<li>${inlineHtml(b[1])}</li>`)
      continue
    }
    const n = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (n) {
      if (list !== 'ol') { closeList(); body.push('<ol>'); list = 'ol' }
      body.push(`<li>${inlineHtml(n[1])}</li>`)
      continue
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { closeList(); body.push('<hr>'); continue }
    closeList()
    body.push(`<p>${inlineHtml(line.trim())}</p>`)
  }
  closeList()
  const style = [
    'body{font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;max-width:46rem;margin:3rem auto;padding:0 1.25rem;color:#1a1a1a}',
    'h1,h2,h3,h4{line-height:1.25;margin:1.6em 0 .5em}h1{font-size:2em}',
    'hr{border:0;border-top:1px solid #e5e5e5;margin:2em 0}',
    'code{background:#f4f4f5;padding:.15em .35em;border-radius:4px;font-size:.9em}a{color:#2563eb}',
    '@media print{body{margin:0;max-width:none}@page{size:A4;margin:18mm}}',
  ].join('\n')
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escHtml(title)}</title><style>\n${style}\n</style></head><body>\n${body.join('\n')}\n</body></html>`
}

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  const CH = 0x8000
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH))
  return btoa(bin)
}

const utf8 = (s: string) => new TextEncoder().encode(s)

const MIME: Record<string, string> = {
  pdf: 'application/pdf', html: 'text/html', htm: 'text/html', md: 'text/markdown',
  markdown: 'text/markdown', txt: 'text/plain', text: 'text/plain', csv: 'text/csv', json: 'application/json',
}

export interface LocalDocInput { filename?: string; source?: string; content?: string; target_format?: string }

/** Build a downloadable file entirely in the browser. Throws for formats that need a computer. */
export function makeLocalDocument(input: LocalDocInput): AgentFile {
  const content = String(input.content ?? '')
  const rawName = String(input.filename ?? '').trim()
  const fmt =
    String(input.target_format ?? '').toLowerCase().replace(/^\./, '') ||
    rawName.split('.').pop()?.toLowerCase() ||
    'pdf'
  if (!canMakeLocally(fmt)) {
    throw new Error(
      `"${fmt}" needs a connected computer to convert. Without one you can still make: ${LOCAL_FORMATS.join(', ')}. Produce a pdf or html instead, or ask the user to connect their computer (Settings → Computer & code).`,
    )
  }
  const stem = (rawName.replace(/\.[^.]+$/, '') || 'document').replace(/[\\/:*?"<>|]+/g, '-')
  const ext = fmt === 'markdown' ? 'md' : fmt === 'text' ? 'txt' : fmt
  const name = `${stem}.${ext}`
  const isHtmlSource = String(input.source ?? '').toLowerCase() === 'html' || /^\s*<(!doctype|html)/i.test(content)

  let bytes: Uint8Array
  if (fmt === 'pdf') {
    // An HTML source gets flattened to text here — a real CSS render needs the computer path.
    const text = isHtmlSource
      ? content
          .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
          .replace(/<li[^>]*>/gi, '- ')
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
      : content
    bytes = pdfFromMarkdown(text)
  } else if (fmt === 'html' || fmt === 'htm') {
    bytes = utf8(isHtmlSource ? content : mdToHtml(content, stem))
  } else {
    bytes = utf8(content)
  }
  return { name, bytes: bytes.length, b64: toBase64(bytes), mime: MIME[fmt] ?? 'application/octet-stream' }
}
