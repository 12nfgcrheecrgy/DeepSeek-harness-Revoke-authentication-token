/**
 * Run every verification suite in its own process and print one verdict.
 *
 * The suites are stand-alone scripts, and each installs its own globals — a stub
 * `fetch`, a stub module-loader `window`, a compressed `setTimeout`. Importing
 * them into one process lets those leak into the next suite and produce results
 * that describe the previous stub instead of the running server, so every suite
 * gets a child process. `stdio: 'inherit'` keeps each suite's output in the
 * terminal without opening a pipe.
 *
 * Run: node verify-all.mjs
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SUITES = [
  ['manifest and client-scan contract (offline)', './verify-manifest.mjs'],
  ['host gate decisions (offline)', './verify-no-token.mjs'],
  ['browser configuration page (offline)', './verify-client.mjs'],
  ['injected mobile layer (offline)', './verify-mobile.mjs'],
  ['QR encoder round-trip (offline)', './verify-qr.mjs'],
  ['live gate and trust fence', './verify-live.mjs'],
  ['live client-module roster', './verify-boot.mjs'],
  ['live one-click LAN switch', './verify-lan.mjs'],
  ['live phone reachability (read-only)', './verify-phone.mjs'],
]

/**
 * Run one suite to completion.
 * @param specifier - path of the suite, relative to this file.
 * @returns its exit code.
 */
function run(specifier) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL(specifier, import.meta.url))], { stdio: 'inherit' })
    child.on('error', (error) => {
      console.log(`FAIL  could not start ${specifier}: ${error.message}`)
      resolve(1)
    })
    child.on('close', (code) => resolve(code ?? 1))
  })
}

const outcomes = []
for (const [label, specifier] of SUITES) {
  console.log(`\n===== ${label} =====`)
  outcomes.push({ label, ok: (await run(specifier)) === 0 })
}

console.log('\n===== summary =====')
for (const { label, ok } of outcomes) console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
const failed = outcomes.filter((outcome) => !outcome.ok)
console.log(`\n${outcomes.length - failed.length}/${outcomes.length} suites passed`)
if (failed.some((outcome) => outcome.label.includes('live'))) {
  console.log('\nA failing live suite can also mean the running process predates the change: one process')
  console.log('loads one JavaScript module generation. Restart `dsh web` and re-run.')
}
process.exitCode = failed.length === 0 ? 0 : 1
