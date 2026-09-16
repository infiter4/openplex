#!/usr/bin/env node
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SRC = 'https://models.dev/api.json'
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'catalog-seed.json')

const res = await fetch(SRC)
if (!res.ok) {
  console.error(`models.dev returned HTTP ${res.status}`)
  process.exit(1)
}
const raw = await res.json()

const ordered = Object.fromEntries(
  Object.keys(raw)
    .sort()
    .map((k) => [k, raw[k]]),
)

const minified = JSON.stringify(ordered)
await writeFile(OUT, minified + '\n', 'utf8')

let withApi = 0
let models = 0
for (const p of Object.values(ordered)) {
  if (p && typeof p === 'object') {
    if (p.api) withApi++
    models += Object.keys(p.models ?? {}).length
  }
}
console.log(`Wrote ${OUT}`)
console.log(
  `  ${Object.keys(ordered).length} providers (${withApi} with an endpoint) · ${models} models · ${(Buffer.byteLength(minified) / 1024 / 1024).toFixed(2)} MB`,
)
