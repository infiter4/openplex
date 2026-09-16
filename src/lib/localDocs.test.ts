import { describe, expect, it } from 'vitest'
import { canMakeLocally, makeLocalDocument } from './localDocs'

const bin = (b64: string) => atob(b64)

describe('localDocs (no-computer document generation)', () => {
  it('builds a structurally valid PDF whose xref offsets actually point at the objects', () => {
    const file = makeLocalDocument({
      filename: 'report.pdf',
      source: 'markdown',
      target_format: 'pdf',
      content: '# Quarterly report\n\nRevenue grew **12%** this quarter.\n\n- one\n- two\n',
    })
    expect(file.name).toBe('report.pdf')
    expect(file.mime).toBe('application/pdf')

    const pdf = bin(file.b64!)
    expect(pdf.startsWith('%PDF-1.4')).toBe(true)
    expect(pdf).toContain('/Type /Catalog')
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true)

    // startxref must point at the xref table…
    const xrefPos = Number(/startxref\s+(\d+)/.exec(pdf.slice(pdf.lastIndexOf('startxref')))![1])
    expect(pdf.slice(xrefPos, xrefPos + 4)).toBe('xref')

    // …and the first recorded offset must land exactly on "1 0 obj" (validates the byte math).
    const firstOffset = Number(/0000000000 65535 f \n(\d{10}) 00000 n/.exec(pdf.slice(xrefPos))![1])
    expect(pdf.slice(firstOffset, firstOffset + 7)).toBe('1 0 obj')
  })

  it('paginates long documents instead of overflowing one page', () => {
    const long = Array.from({ length: 400 }, (_, i) => `Paragraph ${i} with enough words to wrap across the page width.`).join('\n\n')
    const file = makeLocalDocument({ filename: 'long.pdf', source: 'markdown', target_format: 'pdf', content: long })
    const count = Number(/\/Count (\d+)/.exec(bin(file.b64!))![1])
    expect(count).toBeGreaterThan(1)
  })

  it('renders markdown to a self-contained HTML document', () => {
    const file = makeLocalDocument({ filename: 'notes.html', source: 'markdown', target_format: 'html', content: '# Hi\n\n- a\n- b\n' })
    const html = new TextDecoder().decode(Uint8Array.from(bin(file.b64!), (c) => c.charCodeAt(0)))
    expect(file.mime).toBe('text/html')
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('<h1>Hi</h1>')
    expect(html).toContain('<li>a</li>')
  })

  it('refuses formats that genuinely need a computer, with a useful message', () => {
    expect(canMakeLocally('docx')).toBe(false)
    expect(canMakeLocally('pdf')).toBe(true)
    expect(() => makeLocalDocument({ filename: 'x.docx', target_format: 'docx', content: 'hi' })).toThrow(/needs a connected computer/i)
  })
})
