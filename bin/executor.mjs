import { spawn, spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile, readdir, stat, rename, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, isAbsolute, resolve, relative, basename, extname } from 'node:path'

const IDLE_MS = 10 * 60_000

class Shell {
  constructor(cwd) {
    this.lastUsed = Date.now()
    this.queue = Promise.resolve()
    this.dead = false
    this.proc = spawn(SHELL_BIN, [], { cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] })
    this.proc.stdin.write('exec 2>&1\n')
    this.buf = ''
    this.proc.stdout.on('data', (d) => { this.buf += d.toString() })
    this.proc.on('error', () => { this.dead = true })
    this.proc.on('exit', () => { this.dead = true })
  }
  run(command, opts = {}) {
    if (typeof opts === 'number') opts = { hardMs: opts }
    this.queue = this.queue.then(() => this._run(command, opts))
    return this.queue
  }
  _run(command, { stallMs = 0, hardMs = 10 * 60_000 } = {}) {
    return new Promise((resolveRun) => {
      this.lastUsed = Date.now()
      const marker = `__OPX_DONE_${Math.random().toString(36).slice(2)}__`
      this.buf = ''
      let lastOut = Date.now()
      let stalled = false
      let settled = false
      let stallTimer = null
      let hardTimer = null
      let graceTimer = null
      const done = (output, exit) => {
        if (settled) return
        settled = true
        this.proc.stdout.off('data', onData)
        if (stallTimer) clearInterval(stallTimer)
        if (hardTimer) clearTimeout(hardTimer)
        if (graceTimer) clearTimeout(graceTimer)
        resolveRun({ output, exit, stalled })
      }
      const onData = () => {
        lastOut = Date.now()
        const idx = this.buf.indexOf(marker)
        if (idx < 0) return
        const after = this.buf.slice(idx + marker.length)
        const m = after.match(/:(-?\d+)/)
        done(this.buf.slice(0, idx).replace(/\n$/, ''), m ? parseInt(m[1], 10) : 0)
      }
      // Stalled / timed-out command: kill it and STOP waiting. On Linux/macOS `pkill -P` kills
      // the command but not the shell, so the shell still emits the marker (cwd persists). On
      // Windows `taskkill /T` also kills the shell, so the marker never returns — force-resolve
      // after a short grace and mark the shell dead so the next command spins up a fresh one.
      const abort = () => {
        if (settled || graceTimer) return
        stalled = true
        this._killChild()
        graceTimer = setTimeout(() => {
          this.dead = true
          try { this.proc.kill() } catch { /* already gone */ }
          done(this.buf.replace(/\n$/, ''), 124)
        }, 1500)
      }
      this.proc.stdout.on('data', onData)
      hardTimer = setTimeout(abort, hardMs)
      if (stallMs > 0) stallTimer = setInterval(() => {
        if (!stalled && Date.now() - lastOut >= stallMs) abort()
      }, 1000)
      this.proc.stdin.write(`${command}\nprintf '${marker}:%s\\n' "$?"\n`)
    })
  }
  _killChild() {
    killTree(this.proc.pid)
  }
  async cwd() {
    const { output } = await this.run(IS_WIN ? 'pwd -W 2>/dev/null || pwd' : 'pwd', 10_000)
    return output.trim() || process.cwd()
  }
  kill() { try { this.proc.kill() } catch { /* ignore */ } }
}

const EXT = { python: 'py', py: 'py', javascript: 'js', js: 'js', node: 'js', typescript: 'ts', bash: 'sh', sh: 'sh', ruby: 'rb', php: 'php' }
const RUNNER = { python: 'python3', py: 'python3', javascript: 'node', js: 'node', node: 'node', typescript: 'npx -y tsx', bash: 'bash', sh: 'bash', ruby: 'ruby', php: 'php' }
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown',
  '.csv': 'text/csv', '.json': 'application/json', '.html': 'text/html', '.zip': 'application/zip', '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}
const mimeFor = (p) => MIME[extname(p).toLowerCase()] || 'application/octet-stream'
const RASTER_IMG = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])
const STALL_MS = 30_000
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const isAlive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }

const OS = process.platform
const IS_WIN = OS === 'win32'

const SHELL_BIN = (() => {
  if (!IS_WIN) return process.env.SHELL && /(?:bash|zsh)$/.test(process.env.SHELL) ? process.env.SHELL : 'bash'
  for (const p of [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  ]) if (existsSync(p)) return p
  return 'bash'
})()

const shPath = (p) => (IS_WIN ? String(p).replace(/\\/g, '/') : p)
const fileUrl = (p) => (IS_WIN ? 'file:///' + shPath(p) : 'file://' + p)

const killTree = (pid) => {
  try {
    if (IS_WIN) spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)])
    else spawnSync('pkill', ['-9', '-P', String(pid)])
  } catch { /* tool missing */ }
}

const MAC_BROWSERS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
]
const WIN_BROWSERS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Chromium\\Application\\chrome.exe',
]
const STALL_NOTE = `\n\n[paused: no output for ${STALL_MS / 1000}s, so the command was stopped. If it was meant to keep running (a server, a long job, or opening/displaying something), launch it with run_background and watch it with check_background instead. If it was hung or already finished, just move on. Note: don't try to open or display files on the user's screen — deliver them with download_file.]`

async function findBrowser(shell) {
  if (OS === 'darwin') {
    for (const p of MAC_BROWSERS) if (existsSync(p)) return p
  } else if (IS_WIN) {
    for (const p of WIN_BROWSERS) if (existsSync(p)) return shPath(p)
  }
  const { output } = await shell.run(
    'for b in google-chrome google-chrome-stable chromium chromium-browser brave-browser microsoft-edge chrome; do command -v "$b" && break; done',
    10_000,
  )
  return output.trim().split('\n').filter(Boolean)[0] || ''
}

export function createExecutor({ workspace } = {}) {
  const WS = workspace ? resolve(workspace.replace(/^~/, homedir())) : join(homedir(), 'openplex-workspace')
  const shells = new Map()
  const bgJobs = new Map()
  const getShell = (threadId) => {
    const key = threadId || 'default'
    const existing = shells.get(key)
    if (!existing || existing.dead) shells.set(key, new Shell(WS))
    return shells.get(key)
  }
  const reaper = setInterval(() => {
    const now = Date.now()
    for (const [k, sh] of shells) if (now - sh.lastUsed > IDLE_MS) { sh.kill(); shells.delete(k) }
  }, 60_000)
  reaper.unref?.()

  const inWorkspace = (abs) => {
    const rel = relative(WS, abs)
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  }
  // File tools are confined to the workspace: a prompt-injected model can't read ~/.ssh or write
  // outside WS even after `cd`-ing away. (Shell tools are gated by the opt-in compute toggle.)
  const resolvePath = async (shell, p) => {
    const abs = isAbsolute(p) ? resolve(p) : resolve(await shell.cwd(), p)
    if (!inWorkspace(abs)) throw new Error(`refused: "${p}" is outside the workspace (${WS}); file tools are confined there.`)
    return abs
  }
  const fileResult = async (absPath) => {
    const buf = await readFile(absPath)
    return { name: basename(absPath), bytes: buf.length, b64: buf.toString('base64'), mime: mimeFor(absPath) }
  }

  async function convertDocument(shell, { filename, source, content, target_format }) {
    const cwd = await shell.cwd()
    const outName = basename(filename || `document.${target_format || 'pdf'}`)
    const target = (target_format || extname(outName).slice(1) || 'pdf').toLowerCase()
    const outFile = join(cwd, outName)
    const stem = outName.replace(/\.[^.]+$/, '')

    const htmlFile = join(cwd, `${stem}.html`)
    let sourceFile = htmlFile
    if (source === 'html') {
      await writeFile(htmlFile, content)
    } else {
      const mdFile = join(cwd, `${stem}.md`)
      await writeFile(mdFile, content)
      sourceFile = mdFile
      const { exit } = await shell.run(`pandoc ${JSON.stringify(shPath(mdFile))} -s -o ${JSON.stringify(shPath(htmlFile))}`, 60_000)
      if (exit !== 0 || !existsSync(htmlFile)) {
        await writeFile(htmlFile, `<!doctype html><meta charset="utf-8"><body style="font:16px/1.6 system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;white-space:pre-wrap">${escapeHtml(content)}</body>`)
      }
    }
    const done = () => ({ out: outFile, source: sourceFile })
    const renameLO = async (ext) => {
      const lo = htmlFile.replace(/\.[^.]+$/, `.${ext}`)
      if (existsSync(lo)) { await rename(lo, outFile).catch(() => {}) }
    }

    if (target === 'pdf') {
      const browser = await findBrowser(shell)
      if (browser) {
        // --print-to-pdf-no-header is IGNORED by the new headless mode, which then stamps every
        // page with the print date, the document title, the page number, and — worse — the
        // file:/// path of the temp file. --no-pdf-header-footer is the switch new headless
        // actually reads; both are passed so older Chromium builds stay covered too.
        await shell.run(
          `${JSON.stringify(browser)} --headless=new --no-sandbox --disable-gpu --no-first-run --no-default-browser-check --hide-scrollbars --no-pdf-header-footer --print-to-pdf-no-header --virtual-time-budget=10000 --print-to-pdf=${JSON.stringify(shPath(outFile))} ${JSON.stringify(fileUrl(htmlFile))}`,
          120_000,
        )
        if (existsSync(outFile)) return done()
      }
      for (const cmd of [
        `weasyprint ${JSON.stringify(shPath(htmlFile))} ${JSON.stringify(shPath(outFile))}`,
        `wkhtmltopdf --enable-local-file-access ${JSON.stringify(shPath(htmlFile))} ${JSON.stringify(shPath(outFile))}`,
        `${IS_WIN ? 'soffice' : 'libreoffice'} --headless --convert-to pdf --outdir ${JSON.stringify(shPath(cwd))} ${JSON.stringify(shPath(htmlFile))}`,
      ]) {
        await shell.run(cmd, 120_000)
        if (existsSync(outFile)) return done()
        await renameLO('pdf')
        if (existsSync(outFile)) return done()
      }
      throw new Error('No HTML→PDF engine found. Install Google Chrome / Chromium / Brave (best fidelity), or weasyprint / wkhtmltopdf / LibreOffice.')
    }

    for (const cmd of [
      `pandoc ${JSON.stringify(shPath(htmlFile))} -o ${JSON.stringify(shPath(outFile))}`,
      `${IS_WIN ? 'soffice' : 'libreoffice'} --headless --convert-to ${target} --outdir ${JSON.stringify(shPath(cwd))} ${JSON.stringify(shPath(htmlFile))}`,
    ]) {
      await shell.run(cmd, 120_000)
      if (existsSync(outFile)) return done()
      await renameLO(target)
      if (existsSync(outFile)) return done()
    }
    throw new Error(`conversion to ${target} failed — install pandoc or LibreOffice.`)
  }

  async function exec({ tool, input = {}, threadId }) {
    if (tool === 'ping') return { status: 'done', text: 'pong' }
    await mkdir(WS, { recursive: true })
    const shell = getShell(threadId)
    try {
      switch (tool) {
        case 'terminal': {
          const r = await shell.run(String(input.command ?? ''), { stallMs: STALL_MS })
          return { status: 'done', stdout: r.output + (r.stalled ? STALL_NOTE : ''), exitCode: r.exit }
        }
        case 'code': {
          const lang = String(input.language ?? 'bash').toLowerCase()
          const f = join(await shell.cwd(), `.opx_code_${Date.now()}.${EXT[lang] ?? 'txt'}`)
          await writeFile(f, String(input.code ?? ''))
          const fp = JSON.stringify(shPath(f))
          const runCmd = (lang === 'python' || lang === 'py')
            ? `if command -v python3 >/dev/null 2>&1; then python3 ${fp}; else python ${fp}; fi`
            : `${RUNNER[lang] ?? lang} ${fp}`
          const r = await shell.run(runCmd, { stallMs: STALL_MS })
          return { status: 'done', stdout: r.output + (r.stalled ? STALL_NOTE : ''), exitCode: r.exit }
        }
        case 'run_background': {
          const cwd = await shell.cwd()
          const id = Math.random().toString(36).slice(2, 8)
          const log = join(WS, `.opx_bg_${id}.log`)
          await writeFile(log, '')
          const { output } = await shell.run(`cd ${JSON.stringify(shPath(cwd))}; { ${input.command}; } >${JSON.stringify(shPath(log))} 2>&1 & echo $!`)
          const pid = parseInt(output.trim().split(/\s+/).pop(), 10)
          bgJobs.set(id, { pid, log, command: String(input.command ?? ''), readLen: 0 })
          return { status: 'done', text: `Started in background — job "${id}" (pid ${pid}). Watch it with check_background({ id: "${id}", wait_seconds }) or stop it with check_background({ id: "${id}", stop: true }).` }
        }
        case 'check_background': {
          const id = String(input.id ?? '')
          const job = bgJobs.get(id)
          if (!job) return { status: 'error', error: `no background job "${id}"` }
          if (input.stop) {
            killTree(job.pid)
            try { process.kill(job.pid, 'SIGKILL') } catch { /* gone */ }
            const all = existsSync(job.log) ? await readFile(job.log, 'utf8') : ''
            bgJobs.delete(id)
            return { status: 'done', stdout: all.slice(-8000), text: `Stopped job ${id}.` }
          }
          const waitMs = Math.min(Math.max(Number(input.wait_seconds) || 30, 1), 600) * 1000
          const t0 = Date.now()
          while (Date.now() - t0 < waitMs) {
            if (!isAlive(job.pid)) break
            const size = existsSync(job.log) ? (await stat(job.log)).size : 0
            if (size > job.readLen) break
            await sleep(1000)
          }
          const content = existsSync(job.log) ? await readFile(job.log, 'utf8') : ''
          const newOut = content.slice(job.readLen)
          job.readLen = content.length
          if (!isAlive(job.pid)) { bgJobs.delete(id); return { status: 'done', stdout: content.slice(-8000), text: `Job ${id} finished.` } }
          return { status: 'done', stdout: newOut || '(no new output yet)', text: `Job ${id} is still running. Call check_background again (set wait_seconds for how long to wait before the next check) to keep watching, or pass stop:true to kill it.` }
        }
        case 'write_file': {
          const p = await resolvePath(shell, String(input.path ?? 'untitled.txt'))
          await mkdir(resolve(p, '..'), { recursive: true }).catch(() => {})
          await writeFile(p, String(input.content ?? ''))
          return { status: 'done', text: `wrote ${p}`, files: [await fileResult(p)] }
        }
        case 'edit_file': {
          const p = await resolvePath(shell, String(input.path ?? ''))
          const before = await readFile(p, 'utf8')
          const after = input.all
            ? before.split(String(input.find ?? '')).join(String(input.replace ?? ''))
            : before.replace(String(input.find ?? ''), String(input.replace ?? ''))
          if (after === before) return { status: 'error', error: 'find text not present — no change made' }
          await writeFile(p, after)
          return { status: 'done', text: `edited ${p}`, files: [await fileResult(p)] }
        }
        case 'read_file': {
          const p = await resolvePath(shell, String(input.path ?? ''))
          return { status: 'done', text: (await readFile(p, 'utf8')).slice(0, 20_000) }
        }
        case 'list_files': {
          const dir = await resolvePath(shell, String(input.path ?? '.'))
          const names = await readdir(dir)
          const lines = await Promise.all(names.slice(0, 500).map(async (n) => {
            try { const s = await stat(join(dir, n)); return `${s.isDirectory() ? 'd' : '-'} ${String(s.size).padStart(9)}  ${n}` } catch { return `?  ${n}` }
          }))
          return { status: 'done', text: `${dir}\n${lines.join('\n')}` }
        }
        case 'make_document': {
          const { out, source } = await convertDocument(shell, input)
          const files = [await fileResult(out)]
          if (source && source !== out && existsSync(source)) files.push(await fileResult(source))
          return { status: 'done', text: `created ${basename(out)} (from ${basename(source)})`, files }
        }
        case 'download_file': {
          const p = await resolvePath(shell, String(input.path ?? ''))
          if (!existsSync(p)) return { status: 'error', error: `no such file: ${p}` }
          return { status: 'done', text: `${basename(p)} is ready to download`, files: [await fileResult(p)] }
        }
        case 'view_image': {
          const p = await resolvePath(shell, String(input.path ?? ''))
          if (!existsSync(p)) return { status: 'error', error: `no such file: ${p}` }
          const ext = extname(p).toLowerCase()
          if (RASTER_IMG.has(ext)) {
            const buf = await readFile(p)
            return { status: 'done', text: `viewing ${basename(p)}`, images: [{ b64: buf.toString('base64'), mime: mimeFor(p) }] }
          }
          if (ext === '.svg') {
            return { status: 'done', text: (await readFile(p, 'utf8')).slice(0, 20_000) }
          }
          if (ext === '.pdf') {
            await shell.run(`pdftoppm -png -r 110 -f 1 -l 3 ${JSON.stringify(shPath(p))} ${JSON.stringify(shPath(p + '_pg'))}`, 60_000)
            const images = []
            for (let i = 1; i <= 3; i++) {
              const f = `${p}_pg-${i}.png`
              if (existsSync(f)) { images.push({ b64: (await readFile(f)).toString('base64'), mime: 'image/png' }); await rm(f).catch(() => {}) }
            }
            if (images.length) return { status: 'done', text: `previewing ${basename(p)} (${images.length} page${images.length > 1 ? 's' : ''})`, images }
            const sz = (await stat(p)).size
            return { status: 'done', text: `Couldn't render a preview (install poppler-utils for pdftoppm). ${basename(p)} exists, ${sz} bytes.` }
          }
          return { status: 'done', text: `${basename(p)} isn't a viewable image.` }
        }
        default:
          return { status: 'error', error: `unknown tool ${tool}` }
      }
    } catch (e) {
      return { status: 'error', error: e?.message ?? String(e) }
    }
  }

  return { exec, workspace: WS, dispose: () => { clearInterval(reaper); for (const s of shells.values()) s.kill() } }
}
