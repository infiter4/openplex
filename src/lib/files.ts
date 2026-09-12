import type { Attachment } from './types'
import { fileToDataUrl } from './utils'

export class FileError extends Error {}

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024
export const MAX_DOC_BYTES = 25 * 1024 * 1024
const MAX_TEXT_CHARS = 200_000
const MAX_PDF_PAGE_IMAGES = 6
const MAX_DOC_IMAGES = 6
const PDF_PAGE_WIDTH = 1280

const TEXT_EXTENSIONS = new Set([
  'txt', 'text', 'md', 'markdown', 'rst', 'log', 'csv', 'tsv', 'json', 'jsonl', 'json5', 'xml',
  'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'properties',
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'scala',
  'c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'hh', 'cs', 'swift', 'm', 'mm', 'php', 'pl', 'lua', 'r',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'sql', 'graphql', 'gql', 'proto',
  'html', 'htm', 'css', 'scss', 'sass', 'less', 'vue', 'svelte', 'astro',
  'dockerfile', 'makefile', 'gitignore', 'gradle', 'tex',
])

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function ext(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/')
}

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || ext(file.name) === 'pdf'
}

function isDocx(file: File): boolean {
  return file.type === DOCX_MIME || ext(file.name) === 'docx'
}

export function isTextFile(file: File): boolean {
  if (file.type.startsWith('text/')) return true
  if (/^application\/(json|xml|x-yaml|yaml|javascript|x-sh|x-www-form-urlencoded)/.test(file.type)) return true
  return TEXT_EXTENSIONS.has(ext(file.name)) || TEXT_EXTENSIONS.has(file.name.toLowerCase())
}

export function isSupportedFile(file: File): boolean {
  return isImageFile(file) || isPdf(file) || isDocx(file) || isTextFile(file)
}

async function readAsText(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  const head = bytes.subarray(0, 8192)
  for (let i = 0; i < head.length; i++) {
    if (head[i] === 0) throw new FileError(`“${file.name}” looks like a binary file that can’t be read as text.`)
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes).slice(0, MAX_TEXT_CHARS)
}

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null
async function getPdfjs(): Promise<typeof import('pdfjs-dist')> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist')
      const WorkerCtor = (await import('pdfjs-dist/build/pdf.worker.min.mjs?worker')).default
      pdfjs.GlobalWorkerOptions.workerPort = new WorkerCtor()
      return pdfjs
    })()
  }
  return pdfjsPromise
}

/** Render the first `maxPages` of a PDF (raw bytes) to JPEG data URLs — for in-app preview. */
export async function renderPdf(data: ArrayBuffer | Uint8Array, maxPages = 12): Promise<string[]> {
  const pdfjs = await getPdfjs()
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise
  const out: string[] = []
  try {
    const n = Math.min(doc.numPages, maxPages)
    for (let p = 1; p <= n; p++) {
      const page = await doc.getPage(p)
      const base = page.getViewport({ scale: 1 })
      const scale = Math.min(2, PDF_PAGE_WIDTH / base.width)
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const ctx = canvas.getContext('2d')
      if (ctx) {
        await page.render({ canvasContext: ctx, viewport }).promise
        out.push(canvas.toDataURL('image/jpeg', 0.8))
      }
      canvas.width = canvas.height = 0
    }
  } finally {
    void doc.destroy()
  }
  return out
}

async function processPdf(file: File, vision: boolean): Promise<Attachment> {
  const pdfjs = await getPdfjs()
  const data = new Uint8Array(await file.arrayBuffer())
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise
  const textPages: string[] = []
  const pageImages: string[] = []
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      const tc = await page.getTextContent()
      const pageText = tc.items
        .map((it) => ('str' in it ? it.str : ''))
        .join(' ')
        .replace(/[ \t]{2,}/g, ' ')
        .trim()
      if (pageText) textPages.push(`[Page ${p}]\n${pageText}`)

      if (vision && pageImages.length < MAX_PDF_PAGE_IMAGES) {
        const base = page.getViewport({ scale: 1 })
        const scale = Math.min(2, PDF_PAGE_WIDTH / base.width)
        const viewport = page.getViewport({ scale })
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        const ctx = canvas.getContext('2d')
        if (ctx) {
          await page.render({ canvasContext: ctx, viewport }).promise
          pageImages.push(canvas.toDataURL('image/jpeg', 0.72))
        }
        canvas.width = canvas.height = 0
      }
    }
  } finally {
    void doc.destroy()
  }

  let text = textPages.join('\n\n').slice(0, MAX_TEXT_CHARS)
  if (!text.trim()) {
    text = vision
      ? '(No selectable text — this looks like a scanned PDF; the page images below carry the content.)'
      : '(No selectable text could be extracted — this looks like a scanned PDF. Use a vision-capable model to read it.)'
  }
  return {
    kind: 'document',
    mimeType: 'application/pdf',
    name: file.name,
    text,
    pageImages: pageImages.length ? pageImages : undefined,
    size: file.size,
  }
}

async function processDocx(file: File, vision: boolean): Promise<Attachment> {
  let text = ''
  const images: string[] = []
  try {
    const mammoth = await import('mammoth')
    const arrayBuffer = await file.arrayBuffer()
    const result = await mammoth.extractRawText({ arrayBuffer })
    text = (result.value ?? '').trim()
    if (vision) {
      await mammoth.convertToHtml(
        { arrayBuffer },
        {
          convertImage: mammoth.images.imgElement(async (image) => {
            try {
              if (images.length < MAX_DOC_IMAGES) {
                const b64 = await image.read('base64')
                images.push(`data:${image.contentType};base64,${b64}`)
              }
            } catch {
              /* skip unreadable image */
            }
            return { src: '' }
          }),
        },
      )
    }
  } catch {
    throw new FileError(`Couldn’t read “${file.name}”. Export it as PDF or paste the text instead.`)
  }
  if (!text) text = images.length ? '(No body text — see the attached images.)' : '(No text found in this document.)'
  return {
    kind: 'document',
    mimeType: DOCX_MIME,
    name: file.name,
    text: text.slice(0, MAX_TEXT_CHARS),
    pageImages: images.length ? images : undefined,
    size: file.size,
  }
}

export interface ProcessResult {
  attachment?: Attachment
  skipped?: string
}

export async function processFile(file: File, opts: { vision: boolean }): Promise<ProcessResult> {
  if (isImageFile(file)) {
    if (!opts.vision) return { skipped: `${file.name}: this model can’t see images — pick a vision model.` }
    if (file.size > MAX_IMAGE_BYTES) return { skipped: `${file.name} is over 8 MB.` }
    return { attachment: { kind: 'image', mimeType: file.type, name: file.name, dataUrl: await fileToDataUrl(file), size: file.size } }
  }

  if (file.size > MAX_DOC_BYTES) return { skipped: `${file.name} is over 25 MB.` }

  if (isPdf(file)) return { attachment: await processPdf(file, opts.vision) }
  if (isDocx(file)) return { attachment: await processDocx(file, opts.vision) }
  if (isTextFile(file)) {
    return { attachment: { kind: 'document', mimeType: file.type || 'text/plain', name: file.name, text: await readAsText(file), size: file.size } }
  }

  const text = await readAsText(file)
  return { attachment: { kind: 'document', mimeType: file.type || 'application/octet-stream', name: file.name, text, size: file.size } }
}
