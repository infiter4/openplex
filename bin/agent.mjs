#!/usr/bin/env node
import { hostname } from 'node:os'
import { createExecutor } from './executor.mjs'
import { createRelayManager } from './relay-manager.mjs'

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--pair') out.pair = argv[++i]
    else if (argv[i] === '--workspace') out.workspace = argv[++i]
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const executor = createExecutor({ workspace: args.workspace })
const manager = createRelayManager(executor, { log: (m) => console.log(m) })

if (args.pair) {
  const r = await manager.pair(args.pair)
  if (!r.ok) {
    console.error('Pairing failed:', r.error ?? 'invalid code — copy it again from Settings → Computer & code.')
    process.exit(1)
  }
}

const results = await manager.startAll()
const live = results.filter((r) => r.ok)
if (!live.length) {
  console.error('No paired phones to reconnect. Pair one:  openplex agent --pair <code>   (Settings → Computer & code)')
  process.exit(1)
}

console.log(`openplex agent ready on "${hostname()}" — serving ${live.length} paired phone${live.length > 1 ? 's' : ''}.`)
console.log(`workspace: ${executor.workspace}`)
console.log('waiting for jobs… (Ctrl-C to stop)')
