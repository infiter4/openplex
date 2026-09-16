import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Start openplex at login.
 *
 * The point is the phone: computer use only works while this machine is reachable, and having to
 * remember to start it by hand is exactly the failure the relay was supposed to remove. Everything
 * here is per-user — no admin, no service install, no root — and `uninstall` removes every file it
 * wrote.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const ENTRY = join(HERE, 'openplex.mjs')
const NODE = process.execPath
const LABEL = 'openplex'
const DEFAULT_PORT = 43210

const q = (s) => `"${s}"`

/**
 * `server` = app + relay, opens the window at login. `quiet` = same, no window. `agent` = the phone
 * relay only. Default is `server`: a login item you can't see is indistinguishable from one that
 * failed to start, which is exactly how this got reported as "didn't boot".
 */
function argvFor(mode, port) {
  if (mode === 'agent') return ['agent']
  const args = ['--port', String(port)]
  if (mode === 'quiet') args.push('--no-open')
  return args
}

/** A line every platform's file can carry, so `status` reads back fact rather than guessing. */
const marker = (mode, port) => `openplex-autostart mode=${mode} port=${port}`
const MARKER_RE = /openplex-autostart mode=(\w+) port=(\d+)/

function parseMarker(body, path) {
  const m = MARKER_RE.exec(body)
  return { path, mode: m?.[1] ?? 'server', port: Number(m?.[2]) || DEFAULT_PORT }
}

/** Is something actually answering? Both loopback families, because only one may be bound. */
async function probe(port) {
  for (const host of ['127.0.0.1', '[::1]']) {
    try {
      const ac = new AbortController()
      const t = setTimeout(() => ac.abort(), 1500)
      const res = await fetch(`http://${host}:${port}/`, { signal: ac.signal }).finally(() => clearTimeout(t))
      if (res.ok) return true
    } catch {
      /* try the other family */
    }
  }
  return false
}

// ---- Windows: a Startup-folder .vbs, because it needs no admin and shows no console window ----

const winStartupDir = () =>
  join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
const winScript = () => join(winStartupDir(), `${LABEL}.vbs`)

async function winInstall(mode, port) {
  const args = argvFor(mode, port).map(q).join(' ')
  const vbs = [
    `' ${marker(mode, port)}`,
    "' Written by `openplex autostart install`; remove with `openplex autostart uninstall`.",
    'Set sh = CreateObject("WScript.Shell")',
    `sh.CurrentDirectory = "${join(HERE, '..')}"`,
    // 0 = no console window (the app opens in the browser), False = don't block the logon sequence.
    `sh.Run """${NODE}"" ""${ENTRY}"" ${args.replace(/"/g, '""')}", 0, False`,
    '',
  ].join('\r\n')
  await mkdir(winStartupDir(), { recursive: true })
  await writeFile(winScript(), vbs, 'utf8')
  return winScript()
}

async function winUninstall() {
  if (!existsSync(winScript())) return false
  await rm(winScript())
  return true
}

async function winStatus() {
  if (!existsSync(winScript())) return null
  return parseMarker(await readFile(winScript(), 'utf8'), winScript())
}

// ---- macOS: a LaunchAgent, which also restarts the process if it dies ----

const macPlist = () => join(homedir(), 'Library', 'LaunchAgents', `com.${LABEL}.plist`)

async function macInstall(mode, port) {
  const args = [NODE, ENTRY, ...argvFor(mode, port)]
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- ${marker(mode, port)} -->
<plist version="1.0">
<dict>
  <key>Label</key><string>com.${LABEL}</string>
  <key>ProgramArguments</key>
  <array>${args.map((a) => `\n    <string>${a}</string>`).join('')}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>WorkingDirectory</key><string>${join(HERE, '..')}</string>
  <key>StandardOutPath</key><string>${join(homedir(), `.${LABEL}-autostart.log`)}</string>
  <key>StandardErrorPath</key><string>${join(homedir(), `.${LABEL}-autostart.log`)}</string>
</dict>
</plist>
`
  await mkdir(dirname(macPlist()), { recursive: true })
  await writeFile(macPlist(), plist, 'utf8')
  spawnSync('launchctl', ['unload', macPlist()], { stdio: 'ignore' })
  spawnSync('launchctl', ['load', macPlist()], { stdio: 'ignore' })
  return macPlist()
}

async function macUninstall() {
  if (!existsSync(macPlist())) return false
  spawnSync('launchctl', ['unload', macPlist()], { stdio: 'ignore' })
  await rm(macPlist())
  return true
}

async function macStatus() {
  if (!existsSync(macPlist())) return null
  return parseMarker(await readFile(macPlist(), 'utf8'), macPlist())
}

// ---- Linux: a systemd --user unit (lingering keeps it alive without a desktop session) ----

const unitPath = () => join(homedir(), '.config', 'systemd', 'user', `${LABEL}.service`)

async function linuxInstall(mode, port) {
  const unit = `# ${marker(mode, port)}
[Unit]
Description=openplex (${mode})
After=network-online.target

[Service]
Type=simple
ExecStart=${q(NODE)} ${q(ENTRY)} ${argvFor(mode, port).map(q).join(' ')}
WorkingDirectory=${join(HERE, '..')}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`
  await mkdir(dirname(unitPath()), { recursive: true })
  await writeFile(unitPath(), unit, 'utf8')
  spawnSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' })
  spawnSync('systemctl', ['--user', 'enable', '--now', `${LABEL}.service`], { stdio: 'ignore' })
  return unitPath()
}

async function linuxUninstall() {
  if (!existsSync(unitPath())) return false
  spawnSync('systemctl', ['--user', 'disable', '--now', `${LABEL}.service`], { stdio: 'ignore' })
  await rm(unitPath())
  spawnSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' })
  return true
}

async function linuxStatus() {
  if (!existsSync(unitPath())) return null
  return parseMarker(await readFile(unitPath(), 'utf8'), unitPath())
}

const BY_OS = {
  win32: { install: winInstall, uninstall: winUninstall, status: winStatus, what: 'a Startup-folder script' },
  darwin: { install: macInstall, uninstall: macUninstall, status: macStatus, what: 'a LaunchAgent' },
  linux: { install: linuxInstall, uninstall: linuxUninstall, status: linuxStatus, what: 'a systemd user service' },
}

export async function autostart(argv) {
  const impl = BY_OS[process.platform]
  if (!impl) {
    console.error(`openplex autostart: ${process.platform} isn't supported — start it from your own login items.`)
    process.exit(1)
  }
  const action = argv[0] || 'status'
  const mode = argv.includes('--agent') ? 'agent' : argv.includes('--quiet') ? 'quiet' : 'server'
  const portFlag = Number(argv[argv.indexOf('--port') + 1])
  const port = argv.includes('--port') && Number.isFinite(portFlag) ? portFlag : DEFAULT_PORT

  if (action === 'install' || action === 'enable') {
    const path = await impl.install(mode, port)
    console.log(`\n  ◆ openplex will start at login (${impl.what})`)
    if (mode === 'agent') console.log('    mode: agent — the phone relay only, nothing served locally')
    else if (mode === 'quiet') console.log(`    mode: quiet — serving http://localhost:${port} and the phone relay, no window`)
    else console.log(`    mode: server — opens http://localhost:${port} at login, phone relay included`)
    console.log(`    ${path}`)
    console.log('\n  Options:  --quiet (no window)   --agent (relay only)   --port <n>')
    console.log('  Turn it off with:  openplex autostart uninstall\n')
    return
  }
  if (action === 'uninstall' || action === 'disable' || action === 'remove') {
    console.log(await impl.uninstall() ? '\n  openplex will no longer start at login.\n' : '\n  openplex was not set to start at login.\n')
    return
  }
  if (action === 'status') {
    const s = await impl.status()
    if (!s) {
      console.log('\n  openplex does not start at login.')
      console.log('  Enable it with:  openplex autostart install        (app + phone relay)')
      console.log('                   openplex autostart install --agent  (phone relay only)\n')
      return
    }
    console.log(`\n  ◆ openplex starts at login — mode: ${s.mode}`)
    console.log(`    ${s.path}`)
    if (s.mode === 'agent') {
      console.log('    nothing is served locally in this mode; the relay answers your phone.\n')
      return
    }
    // "Is it installed" is not the question people actually ask — "is it up" is.
    const live = await probe(s.port)
    console.log(
      live
        ? `    running now → \x1b[36mhttp://localhost:${s.port}\x1b[0m\n`
        : `    NOT running right now (nothing answering on port ${s.port}) — start it with: openplex --port ${s.port}\n`,
    )
    return
  }
  console.error(`openplex autostart: unknown action "${action}". Use install | uninstall | status.`)
  process.exit(1)
}
