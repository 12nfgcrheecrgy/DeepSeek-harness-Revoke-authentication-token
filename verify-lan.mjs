/**
 * Live check of the one-click LAN switch.
 *
 * It drives the real host route the settings page uses: read the state, flip the
 * bind on, and assert what the switch is supposed to buy — the LAN authority
 * moves from "refused by the trust fence" (403) to "admitted, token required"
 * (401), and the tokenized link the page shows actually mints the browser
 * cookie. Then it puts the bind back.
 *
 * The fence reads the Host header, not the socket address, so the checks below
 * connect over loopback while claiming the LAN authority — the same decision a
 * phone would hit. Network reachability (firewall, Wi-Fi) is not testable from
 * the machine itself and stays a user check.
 *
 * Run: node verify-lan.mjs [--keep-lan]
 */
import http from 'node:http'

const BASE = 'http://127.0.0.1:3080'
const ROUTE = '/api/no-token/lan'
const KEEP = process.argv.includes('--keep-lan')
const results = []

function check(name, ok, detail = '') {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`)
}

/** Read the state through the same route the page uses. */
async function readState() {
  const response = await fetch(`${BASE}${ROUTE}`, { headers: { accept: 'application/json' } })
  if (response.status === 404) throw new Error('the running process predates this route')
  const body = await response.json().catch(() => ({}))
  if (body.ok !== true) throw new Error(body.error ?? `HTTP ${response.status}`)
  return body.state
}

/** Ask the host to switch. A rebind can close this socket; that is not a failure. */
async function setEnabled(enabled) {
  try {
    const response = await fetch(`${BASE}${ROUTE}`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ enabled }),
    })
    return await response.json()
  } catch (error) {
    return { ok: false, network: error instanceof Error ? error.message : String(error) }
  }
}

/** Poll until the bind lands, or give up. */
async function waitFor(enabled, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const state = await readState()
      if (state.enabled === enabled) return state
    } catch {
      /* the server is rebinding */
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 400)
    })
  }
  return undefined
}

/** One request over loopback that claims a foreign authority, as a phone would. */
function raw(address, port, options = {}) {
  return new Promise((resolve) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      method: options.method ?? 'GET',
      path: options.path ?? '/',
      headers: { host: `${address}:${port}`, ...options.headers },
    }, (response) => {
      response.resume()
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers }))
    })
    request.on('error', (error) => resolve({ status: 0, error: error.message }))
    request.end()
  })
}

// ---- start from a known state -------------------------------------------------
let start
try {
  start = await readState()
} catch (error) {
  console.log(`FAIL  the host route is unreachable: ${error instanceof Error ? error.message : String(error)}`)
  console.log('\nThe running `dsh web` process loads one module generation, and this route belongs to')
  console.log('the current one. Restart `dsh web`, reload the page, and re-run this script.')
  process.exit(1)
}
check('the route answers', start !== undefined, `bind ${start.bind}:${start.port}`)
if (start.enabled) {
  await setEnabled(false)
  const settled = await waitFor(false)
  check('an already-enabled bind is turned back off first', settled !== undefined, settled?.bind)
}
const before = await readState()
check('the bind starts on loopback', before.bind === '127.0.0.1', before.bind)
check('the state lists the detected LAN addresses', Array.isArray(before.addresses))

const target = before.addresses[0]
if (target === undefined) {
  console.log('\nSKIP  no non-internal IPv4 address on this machine, so the fence checks cannot run.')
} else {
  console.log(`      using ${target.address}:${before.port}`)
  check('a loopback bind leaves the LAN links unusable', target.usable === false)

  const refused = await raw(target.address, before.port, { path: ROUTE })
  check('the LAN authority is refused before the switch', refused.status === 403, `status ${refused.status}`)

  const enable = await setEnabled(true)
  check('the switch request is accepted', enable.ok === true, enable.error ?? enable.network ?? 'ok')
  const on = await waitFor(true)
  check('the bind becomes the wildcard', on !== undefined, on === undefined ? 'timed out' : `bind ${on.bind}`)
  if (on !== undefined) {
    check('the reloaded fence trusts every LAN literal', on.addresses.every((entry) => entry.trusted === true))
    check('the links are usable now', on.addresses.every((entry) => entry.usable === true))
  }

  const admitted = await raw(target.address, before.port, { path: ROUTE })
  check('the LAN authority passes the fence and only lacks the cookie', admitted.status === 401, `status ${admitted.status}`)

  const link = (on ?? before).addresses.find((entry) => entry.address === target.address)
  if (link !== undefined) {
    const token = new URL(link.loginUrl).searchParams.get('token')
    check('the shown link carries the process token', typeof token === 'string' && token.length > 20)
    const exchange = await raw(target.address, before.port, { path: `/?token=${token}` })
    check('scanning that link mints the browser cookie', exchange.status === 303 && typeof exchange.headers['set-cookie'] !== 'undefined', `status ${exchange.status}`)
  }
}

// ---- put it back --------------------------------------------------------------
if (!KEEP) {
  await setEnabled(false)
  const off = await waitFor(false)
  check('the switch turns the bind back to loopback', off !== undefined, off?.bind)
  if (target !== undefined) {
    const refusedAgain = await raw(target.address, before.port, { path: ROUTE })
    check('the LAN authority is refused again', refusedAgain.status === 403, `status ${refusedAgain.status}`)
  }
} else {
  console.log('\n--keep-lan: leaving LAN access on.')
}

const failed = results.filter((ok) => !ok).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exitCode = failed === 0 ? 0 : 1
