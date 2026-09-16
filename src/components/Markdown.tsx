import { Check, Copy } from 'lucide-react'
import { memo, useEffect, useMemo, useState, type ReactNode } from 'react'
import ReactMarkdown, { type Options } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import type { Source } from '../lib/types'
import { copyText, cx, safeHref } from '../lib/utils'

type RehypePlugins = NonNullable<Options['rehypePlugins']>

let katexPlugin: (typeof import('rehype-katex'))['default'] | null = null
let katexLoading: Promise<void> | null = null
function loadKatex(): Promise<void> | null {
  if (katexPlugin) return null
  if (!katexLoading) {
    katexLoading = Promise.all([import('rehype-katex'), import('katex/dist/katex.min.css')]).then(
      ([m]) => { katexPlugin = m.default },
    )
  }
  return katexLoading
}

let highlightPlugin: (typeof import('rehype-highlight'))['default'] | null = null
let highlightLoading: Promise<void> | null = null
function loadHighlight(): Promise<void> | null {
  if (highlightPlugin) return null
  if (!highlightLoading) {
    highlightLoading = import('rehype-highlight').then((m) => { highlightPlugin = m.default })
  }
  return highlightLoading
}

function useRehypePlugins(content: string): Options['rehypePlugins'] {
  const needsMath = useMemo(() => /\$|\\\(|\\\[/.test(content), [content])
  const needsCode = useMemo(() => /```|~~~/.test(content), [content])
  const [, bump] = useState(0)
  const rerender = () => bump((n) => n + 1)

  useEffect(() => {
    if (needsMath) loadKatex()?.then(rerender)
  }, [needsMath])
  useEffect(() => {
    if (needsCode) loadHighlight()?.then(rerender)
  }, [needsCode])

  const plugins: RehypePlugins = []
  if (needsMath && katexPlugin) plugins.push([katexPlugin, { throwOnError: false, strict: false }])
  if (needsCode && highlightPlugin) plugins.push([highlightPlugin, { detect: false }])
  return plugins
}

function normalizeMath(text: string): string {
  return text
    .replace(/\\\[([\s\S]+?)\\\]/g, (_m, inner) => `\n$$\n${inner}\n$$\n`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_m, inner) => `$${inner}$`)
}

function CodeBlock({ children, className }: { children?: ReactNode; className?: string }) {
  const [copied, setCopied] = useState(false)
  const lang = /language-(\w+)/.exec(className ?? '')?.[1]

  const getText = (node: ReactNode): string => {
    if (typeof node === 'string') return node
    if (Array.isArray(node)) return node.map(getText).join('')
    if (node && typeof node === 'object' && 'props' in node) return getText((node as { props: { children?: ReactNode } }).props.children)
    return ''
  }

  return (
    <div className="my-3 rounded-xl border border-line-strong overflow-hidden bg-bg1 group/code">
      <div className="flex items-center justify-between px-3.5 py-1.5 border-b border-line bg-bg2/60">
        <span className="text-[11px] font-medium text-muted font-mono">{lang ?? 'text'}</span>
        <button
          onClick={async () => {
            const target = (children as { props?: { children?: ReactNode } })?.props?.children ?? children
            if (await copyText(getText(target))) {
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }
          }}
          className="flex items-center gap-1 text-[11px] text-muted hover:text-ink transition-colors"
        >
          {copied ? <Check size={12} className="text-accent" /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="md-pre">{children}</pre>
    </div>
  )
}

function preprocess(text: string, sourceCount: number): string {
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]*`)/g)
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part
      let out = normalizeMath(part)
      if (sourceCount) {
        out = out.replace(/\[(\d{1,2})\](?!\()/g, (m, n) => {
          const num = parseInt(n, 10)
          return num >= 1 && num <= sourceCount ? `[${n}](#cite-${n})` : m
        })
      }
      // Inline document section references (e.g. §5.3, §20.1, §§5–7) — style as
      // clean citation pills rather than leaving the raw character in the text.
      out = out.replace(
        /§§?\s?\d+(?:\.\d+)*(?:\s?[–—-]\s?\d+(?:\.\d+)*)?/g,
        (m) => `[${m}](#sec-${m.replace(/[^\d.]/g, '')})`,
      )
      return out
    })
    .join('')
}

export const Markdown = memo(function Markdown({
  content,
  sources,
  onCitationClick,
  className,
}: {
  content: string
  sources?: Source[]
  onCitationClick?: (index: number) => void
  className?: string
}) {
  const processed = useMemo(() => preprocess(content, sources?.length ?? 0), [content, sources?.length])
  const rehypePlugins = useRehypePlugins(processed)

  return (
    <div className={cx('md text-[15px]', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={rehypePlugins}
        components={{
          pre: ({ children, ...rest }) => {
            const child = Array.isArray(children) ? children[0] : children
            const cls = (child as { props?: { className?: string } })?.props?.className
            void rest
            return <CodeBlock className={cls}>{children}</CodeBlock>
          },
          a: ({ href, children, ...rest }) => {
            if (href?.startsWith('#sec-')) {
              return (
                <span className="doc-ref" title="Section of an attached document">
                  {children}
                </span>
              )
            }
            const cite = href?.match(/^#cite-(\d+)$/)
            if (cite) {
              const idx = parseInt(cite[1], 10) - 1
              const src = sources?.[idx]
              return (
                <a
                  href={safeHref(src?.url)}
                  className="cite-chip"
                  title={src ? `${src.title} — ${src.url}` : undefined}
                  onClick={(e) => {
                    e.preventDefault()
                    onCitationClick?.(idx)
                  }}
                >
                  {cite[1]}
                </a>
              )
            }
            return (
              <a href={href} target="_blank" rel="noreferrer" {...rest}>
                {children}
              </a>
            )
          },
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {processed}
      </ReactMarkdown>
    </div>
  )
})
