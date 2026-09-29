/**
 * Read-only phone check: can another device get in, and with exactly which link?
 *
 * It never changes the bind. It reports the LAN state, then — for every detected
 * address — makes the same two requests a phone makes: the bare URL (which the
 * token gate refuses) and the tokenized link the settings page shows (which must
 * answer 303 and set the browser cookie). It also confirms the `/api` trust
 * fence admits the LAN authority, since a 403 there means the address is not in
 * the fence list at all.
 *
 * Run: node verify-phone.mjs
 */
import http from 'node:http'

const BASE = `http://127.0.0.1:${String(process.env.DSH_WEB_PORT ?? 3080)}`
const ROUTE = '/api/no-token/lan'

/** The refusal the shipped index gate writes, for comparison. */
const SHIPPED_REFUSAL = 'dsh web authentication required'

/** One request over loopback claiming a foreign authority, as a phone would. */
function raw(address, port, options = {}) {
  return new Promise((resolve) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      method: options.method ?? 'GET',
      path: options.path ?? '/',
      headers: { host: `${address}:${port}`, ...options.headers },
    }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        body += chunk
      })
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }))
    })
    request.on('error', (error) => resolve({ status: 0, error: error.message }))
    request.end()
  })
}

const response = await fetch(`${BASE}${ROUTE}`, { headers: { accept: 'application/json' } })
if (response.status === 404) {
  console.log('The LAN route is not loaded in this process (`dsh web` predates it):')
  console.log('restart `dsh web`, then run this again.')
  process.exit(1)
}
const payload = await response.json()
if (payload.ok !== true) {
  console.log('The host refused the state read:', payload.error)
  process.exit(1)
}
const state = payload.state

console.log(`bind ${state.bind}:${state.port} | enabled ${state.enabled} | mode ${state.mode} | token required ${state.tokenRequired}`)
if (state.enabled !== true) {
  console.log('LAN access is OFF, so no phone can reach these addresses: turn it on in Settings → LAN access.')
  console.log('(The checks below still exercise the gate and the token link over loopback.)')
}
if (state.notes.length > 0) console.log(`notes: ${state.notes.join(', ')}`)
if (state.addresses.length === 0) {
  console.log('No non-internal IPv4 address was detected, so there is nothing to open from a phone.')
  process.exit(1)
}

for (const entry of state.addresses) {
  console.log(`\n--- ${entry.address} (trusted ${entry.trusted}, usable ${entry.usable}) ---`)
  const bare = await raw(entry.address, state.port, { path: '/' })
  console.log(`bare  GET / -> ${bare.status} ${JSON.stringify(bare.body.slice(0, 60).trim())}`)
  if (bare.body.includes(SHIPPED_REFUSAL) && !bare.body.includes('二维码') && state.mode !== 'off') {
    console.log('      (this is the message a phone shows when the token link is not used)')
  }

  const fence = await raw(entry.address, state.port, { path: ROUTE })
  console.log(`fence GET ${ROUTE} -> ${fence.status}${fence.status === 403 ? ' (NOT in the trust list)' : ' (admitted, only the cookie is missing)'}`)

  const token = new URL(entry.loginUrl).searchParams.get('token')
  const exchange = await raw(entry.address, state.port, { path: `/?token=${token}` })
  const cookie = exchange.headers['set-cookie']
  console.log(`link  GET /?token=… -> ${exchange.status}${cookie === undefined ? ' (no cookie)' : ' (cookie set)'}`)
  if (exchange.status === 303 && cookie !== undefined) {
    const maxAge = /Max-Age=(\d+)/.exec(cookie[0])
    const days = maxAge === null ? undefined : Math.round(Number(maxAge[1]) / 86400)
    console.log(`      open this on the phone: ${entry.loginUrl}`)
    console.log(`      the cookie lasts${days === undefined ? '' : ` about ${String(days)} day(s)`}, so the next bare visit works too`)
  } else {
    console.log(`      the tokenized link did NOT authenticate; open the page on the computer and re-read the state`)
  }
}
