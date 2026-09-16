import type { AgentImage, AgentTool, ToolStep } from './types'
import { computeAvailable, invalidateComputeLiveness, runAgentJob, type RunResult } from './agentBackend'
import { makeLocalDocument } from './localDocs'

export interface ToolSpec {
  name: AgentTool
  description: string
  parameters: Record<string, unknown>
}

const str = (description: string) => ({ type: 'string', description })

export const AGENT_TOOLS: ToolSpec[] = [
  {
    name: 'terminal',
    description:
      "Run a shell command on the user's computer in this conversation's persistent shell (cwd, env and any activated virtualenv carry over between calls). Use for git, npm, pip, builds, file ops, anything. Returns stdout, stderr and the exit code. NOTE: a command that produces no output for 30s is auto-paused (killed) and control returns to you — so do NOT run servers, long jobs, or anything that opens/displays a file here (those block); use run_background for those instead.",
    parameters: {
      type: 'object',
      properties: { command: str('The shell command to run, e.g. `ls -la` or `pip install pandas`.') },
      required: ['command'],
    },
  },
  {
    name: 'run_background',
    description:
      'Start a long-running or blocking command in the background and return immediately — for servers, watchers, training jobs, or anything that does not exit on its own. Then poll it with check_background. Use this instead of terminal whenever a command would otherwise hang.',
    parameters: {
      type: 'object',
      properties: { command: str('The command to run in the background.') },
      required: ['command'],
    },
  },
  {
    name: 'check_background',
    description:
      'Check on a background job started with run_background: wait up to wait_seconds for new output (returns as soon as there is any, or when the job exits), or pass stop:true to kill it. Call repeatedly to keep watching — set wait_seconds to how long to wait before the next check.',
    parameters: {
      type: 'object',
      properties: {
        id: str('The background job id from run_background.'),
        wait_seconds: { type: 'number', description: 'How long to wait for new output/exit before returning (default 30).' },
        stop: { type: 'boolean', description: 'Set true to stop (kill) the job.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'code',
    description:
      'Write and run a snippet of code (python, javascript/node, bash, …) on the computer and return its output. Prefer this for quick scripts/calculations; use write_file first if you need the code kept on disk.',
    parameters: {
      type: 'object',
      properties: {
        language: str('Language/interpreter: python, javascript, bash, ruby, …'),
        code: str('The full source to execute.'),
      },
      required: ['language', 'code'],
    },
  },
  {
    name: 'write_file',
    description: 'Create a new file or overwrite an existing one with the given content.',
    parameters: {
      type: 'object',
      properties: {
        path: str('File path, relative to the workspace or absolute.'),
        content: str('Full file contents.'),
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description:
      'Edit an existing file by replacing text. Replaces the first occurrence of `find` with `replace` (set all=true for every occurrence). For wholesale rewrites use write_file instead.',
    parameters: {
      type: 'object',
      properties: {
        path: str('File to edit.'),
        find: str('Exact text to find.'),
        replace: str('Text to replace it with.'),
        all: { type: 'boolean', description: 'Replace every occurrence, not just the first.' },
      },
      required: ['path', 'find', 'replace'],
    },
  },
  {
    name: 'read_file',
    description: 'Read a text file and return its contents.',
    parameters: {
      type: 'object',
      properties: { path: str('File to read.') },
      required: ['path'],
    },
  },
  {
    name: 'list_files',
    description: 'List the entries in a directory (defaults to the current working directory).',
    parameters: {
      type: 'object',
      properties: { path: str('Directory to list. Optional.') },
    },
  },
  {
    name: 'make_document',
    description:
      "Produce a downloadable document. Works even with NO computer connected for pdf/html/md/txt/csv/json (built right here in the app); docx/pptx/xlsx and CSS-perfect PDFs need a connected computer. For anything styled, set source='html' and author a COMPLETE, self-contained HTML document in `content` — PDFs are rendered by a real headless browser, so you may use ANY modern CSS (flexbox, grid, gradients, web fonts via <link>/@import, SVG, charts). For print-perfect output include `@page { size: A4; margin: 0 }` and manage your own padding; for multiple pages put `page-break-after: always` (or `break-after: page`) on section/page boundaries. Use source='markdown' only for plain, unstyled docs. The runner returns the HTML/MD source alongside the converted file. For raw code/data files use write_file instead.",
    parameters: {
      type: 'object',
      properties: {
        filename: str('Desired file name with extension, e.g. report.pdf.'),
        source: { type: 'string', enum: ['html', 'markdown'], description: 'Format of `content`.' },
        content: str('The HTML or Markdown source for the document.'),
        target_format: str('Output format/extension: pdf, docx, pptx, xlsx, html, odt, …'),
      },
      required: ['filename', 'source', 'content', 'target_format'],
    },
  },
  {
    name: 'download_file',
    description:
      'Deliver a file from the computer to the user as a download in chat. Use this for ANY file a command or script produced (an image, archive, dataset, audio, anything) — the user cannot reach files left only on disk, so this is how they actually get them. (write_file and make_document already deliver their output; use download_file for everything else.)',
    parameters: {
      type: 'object',
      properties: { path: str('Path of the file to deliver to the user.') },
      required: ['path'],
    },
  },
  {
    name: 'view_image',
    description:
      "Look at an image or PDF on the computer with your own eyes (vision). ALWAYS use this to VERIFY your work: after you generate an image, chart, diagram, or document, view it and check it actually looks correct and matches the request BEFORE telling the user it's done — fix and re-render if it's wrong. Returns the image(s) to you; for a PDF it renders the first pages.",
    parameters: {
      type: 'object',
      properties: { path: str('Path of the image or PDF to view.') },
      required: ['path'],
    },
  },
]

/** Tools that can only run on the user's computer. */
const COMPUTER_ONLY = new Set<AgentTool>([
  'terminal', 'run_background', 'check_background', 'code',
  'write_file', 'edit_file', 'read_file', 'list_files', 'download_file', 'view_image',
])
/** Tools that run entirely in the browser — always available, no computer required. */
export const BROWSER_TOOLS: ToolSpec[] = AGENT_TOOLS.filter((t) => !COMPUTER_ONLY.has(t.name))
export const COMPUTER_TOOLS: ToolSpec[] = AGENT_TOOLS.filter((t) => COMPUTER_ONLY.has(t.name))
/** What the model is allowed to see this turn. */
export function toolsFor(computeOk: boolean): ToolSpec[] {
  return computeOk ? AGENT_TOOLS : BROWSER_TOOLS
}

const TOOL_NAMES = new Set<string>(AGENT_TOOLS.map((t) => t.name))
export function isAgentTool(name: string): name is AgentTool {
  return TOOL_NAMES.has(name)
}

const OUTPUT_BUDGET = 8000

function clip(s: string | undefined, n = OUTPUT_BUDGET): string {
  if (!s) return ''
  return s.length > n ? `${s.slice(0, n)}\n…[${s.length - n} more chars truncated]` : s
}

function detailFor(name: AgentTool, args: any): string | undefined {
  const clipD = (s: unknown) => (s == null ? undefined : clip(String(s), 6000))
  switch (name) {
    case 'terminal':
      return clipD(args?.command)
    case 'code':
      return clipD(`# ${args?.language ?? ''}\n${args?.code ?? ''}`)
    case 'write_file':
      return clipD(`/* ${args?.path ?? ''} */\n${args?.content ?? ''}`)
    case 'edit_file':
      return clipD(`${args?.path ?? ''}\n--- ${args?.find ?? ''}\n+++ ${args?.replace ?? ''}`)
    case 'make_document':
      return clipD(`${args?.source ?? 'html'} → ${args?.target_format ?? ''}\n\n${args?.content ?? ''}`)
    case 'download_file':
    case 'view_image':
      return clipD(args?.path)
    case 'run_background':
      return clipD(args?.command)
    default:
      return undefined
  }
}

function titleFor(name: AgentTool, args: any): string {
  switch (name) {
    case 'terminal':
      return `$ ${String(args?.command ?? '').slice(0, 120)}`
    case 'code':
      return `run ${args?.language ?? 'code'}`
    case 'write_file':
      return `write ${args?.path ?? ''}`
    case 'edit_file':
      return `edit ${args?.path ?? ''}`
    case 'read_file':
      return `read ${args?.path ?? ''}`
    case 'list_files':
      return `ls ${args?.path ?? ''}`.trim()
    case 'make_document':
      return `make ${args?.filename ?? 'document'}`
    case 'download_file':
      return `download ${args?.path ?? ''}`
    case 'view_image':
      return `view ${args?.path ?? ''}`
    case 'run_background':
      return `bg: ${String(args?.command ?? '').slice(0, 100)}`
    case 'check_background':
      return args?.stop ? `stop job ${args?.id ?? ''}` : `check job ${args?.id ?? ''}`
    default:
      return name
  }
}

function summariseForModel(name: AgentTool, r: RunResult): string {
  if (r.status === 'error') return `ERROR: ${r.error ?? 'tool failed'}`
  if (r.text != null && (name === 'read_file' || name === 'list_files')) return clip(r.text)
  if (name === 'view_image') {
    if (r.images?.length) return `${clip(r.text) || 'Image rendered.'} — it is attached below; inspect it and confirm it matches the request (re-render if not).`
    return clip(r.text) || 'viewed.'
  }
  if (name === 'make_document' || name === 'write_file' || name === 'edit_file' || name === 'download_file') {
    const fileNote = r.files?.length ? ` Delivered to the user: ${r.files.map((f) => f.name).join(', ')} (downloadable in chat).` : ''
    return `${clip(r.text) || 'OK.'}${fileNote}`
  }
  if (name === 'run_background' || name === 'check_background') {
    return `${clip(r.text) || ''}${r.stdout ? `\n${clip(r.stdout)}` : ''}`.trim() || 'OK.'
  }
  const parts: string[] = []
  if (r.exitCode != null) parts.push(`exit code: ${r.exitCode}`)
  if (r.stdout) parts.push(`stdout:\n${clip(r.stdout)}`)
  if (r.stderr) parts.push(`stderr:\n${clip(r.stderr)}`)
  return parts.join('\n') || 'OK (no output).'
}

function uiOutput(r: RunResult): string {
  if (r.status === 'error') return r.error ?? 'failed'
  return clip([r.stdout, r.stderr, r.text].filter(Boolean).join('\n'), 4000)
}

export interface ToolExecResult {
  content: string
  step: ToolStep
  images?: AgentImage[]
}

export async function executeTool(
  name: AgentTool,
  args: any,
  threadId: string,
  onStep: (step: ToolStep) => void,
  signal?: AbortSignal,
): Promise<ToolExecResult> {
  const id = crypto.randomUUID()
  const running: ToolStep = { id, tool: name, title: titleFor(name, args), detail: detailFor(name, args), status: 'running' }
  onStep(running)

  // No computer? Build the everyday formats right here instead of failing.
  if (name === 'make_document' && !(await computeAvailable()).ok) {
    try {
      const file = makeLocalDocument(args ?? {})
      const step: ToolStep = { ...running, status: 'done', output: `Built ${file.name} in the app (${file.bytes} bytes).`, files: [file] }
      onStep(step)
      return { content: `Created ${file.name} (${file.bytes} bytes) and delivered it to the user as a download, without needing a computer.`, step }
    } catch (e) {
      const step: ToolStep = { ...running, status: 'error', output: (e as Error).message }
      onStep(step)
      return { content: `ERROR: ${(e as Error).message}`, step }
    }
  }

  const result = await runAgentJob({ tool: name, input: args, threadId }, { signal })
  // Lost the computer mid-thread — force a re-probe before tools get advertised again.
  if (result.status === 'error' && /no computer|computer endpoint|is online|could not reach|no computer paired/i.test(result.error ?? '')) invalidateComputeLiveness()

  const step: ToolStep = {
    ...running,
    status: result.status === 'done' ? 'done' : 'error',
    output: uiOutput(result),
    exitCode: result.exitCode,
    files: result.files,
  }
  onStep(step)
  return { content: summariseForModel(name, result), step, images: result.images }
}
