/**
 * Offline check of dsh-no-token's decision logic: the plugin is mounted against
 * a fake `connection` service that mimics upstream's contract (403 for the
 * Host/Origin fence, 401 for a missing cookie) and every branch is asserted,
 * including the live Config edit path a Settings write uses.
 * Run: node verify-no-token.mjs
 */
import assert from 'node:assert/strict'
import { Config, apply, name } from './dsh-no-token/index.js'

const LOOPBACK = { headers: { host: '127.0.0.1:3080' } }
const LOCALHOST = { headers: { host: 'localhost:3080' } }
const IPV6 = { headers: { host: '[::1]:3080' } }
const LAN = { headers: { host: '192.168.1.20:3080' } }
const REBOUND = { headers: { host: 'evil.example' } }
const COOKIELESS_FETCH = { headers: new Headers({ host: '127.0.0.1:3080' }) }

function makeConnection() {
  const routes = []
  return {
    routes,
    fetch: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
    requestRejection(request) {
      const host = request.headers instanceof Headers ? request.headers.get('host') : request.headers.host
      if (host === 'evil.example') return 403 // untrusted Host: the trust fence
      return 401 // no browser cookie: the authentication layer
    },
    authorizeIndex() {
      return false
    },
    authenticatedUrl(baseUrl) {
      // Same shape as BrowserAuth: parse, then set the token parameter.
      const url = new URL(baseUrl)
      url.searchParams.set('token', 'SECRET')
      return url.href
    },
  }
}

/** A resolved Config field, exactly as the Loader substitutes it. */
function volatile(value) {
  return { get: () => value }
}

function mount(connection, config, extra = {}) {
  const restorers = []
  const volatileListeners = []
  const configureCalls = []
  const fiber = { plugin: 'no-token' }
  apply({
    logger: {},
    fiber,
    on(event, listener) {
      if (event === 'loader/volatile-update') volatileListeners.push(listener)
      return () => {}
    },
    inject(services, callback) {
      const child = {
        effect: (execute) => {
          const disposer = execute()
          if (typeof disposer === 'function') restorers.push(disposer)
          return disposer
        },
      }
      if (services.includes('connection')) callback({ ...child, connection })
      // The real seam fires only once the service exists, so the double must too.
      if (services.includes('webServer') && extra.webServer !== undefined) callback({ ...child, webServer: extra.webServer })
      if (services.includes('webRuntime') && extra.webRuntime !== undefined) callback({ ...child, webRuntime: extra.webRuntime })
      if (services.includes('configEditor') && extra.configEditor !== undefined) callback({ ...child, configEditor: extra.configEditor })
      if (services.includes('credentials') && extra.credentials !== undefined) callback({ ...child, credentials: extra.credentials })
      if (services.includes('settings')) {
        callback({
          ...child,
          settings: {
            configure: (presentation, owner) => {
              configureCalls.push({ presentation, owner })
              return () => {}
            },
          },
        })
      }
    },
  }, config)
  return {
    dispose: () => restorers.forEach((dispose) => dispose()),
    fire: () => volatileListeners.forEach((listener) => listener()),
    configureCalls,
    fiber,
  }
}

assert.equal(name, 'no-token')
assert.equal(Config['~standard'].vendor, 'schemastery')
assert.ok(Config['~standard'].validate({ mode: 'all' }).issues === undefined)
assert.ok(Config['~standard'].validate({ mode: 'nope' }).issues !== undefined)
assert.equal(new (await import('@deepseek-ai/schemastery')).default(Config.toJSON()).dict.mode.meta.volatile, true)

// ---- default: mode 'loopback' -------------------------------------------------
{
  const connection = makeConnection()
  const mounted = mount(connection, undefined)

  // Loopback authorities lose the 401 layer.
  for (const request of [LOOPBACK, LOCALHOST, IPV6, COOKIELESS_FETCH]) {
    assert.equal(connection.requestRejection(request), undefined)
    assert.equal(connection.authorizeIndex(request, {}), true)
  }

  // The trust fence is untouched, and a remote authority still authenticates.
  assert.equal(connection.requestRejection(REBOUND), 403)
  assert.equal(connection.requestRejection(LAN), 401)
  assert.equal(connection.authorizeIndex(LAN, {}), false)
  assert.equal(connection.requestRejection({ headers: {} }), 401)

  // Only the bypassed URL loses the token; the LAN URL stays loggable-in.
  assert.equal(connection.authenticatedUrl('http://127.0.0.1:3080'), 'http://127.0.0.1:3080/')
  assert.equal(connection.authenticatedUrl('http://192.168.1.20:3080'), 'http://192.168.1.20:3080/?token=SECRET')

  // The bundle ships its own settings page, so it opts out of a generated one.
  assert.equal(mounted.configureCalls.length, 1)
  assert.deepEqual(mounted.configureCalls[0].presentation, { auto: false })
  assert.equal(mounted.configureCalls[0].owner, mounted.fiber)
}

// ---- mode 'all' ---------------------------------------------------------------
{
  const connection = makeConnection()
  mount(connection, { mode: volatile('all') })

  assert.equal(connection.requestRejection(LAN), undefined)
  assert.equal(connection.authorizeIndex(LAN, {}), true)
  assert.equal(connection.authenticatedUrl('http://192.168.1.20:3080'), 'http://192.168.1.20:3080/')
  // Even here the fence decides: a rebound Host is still refused.
  assert.equal(connection.requestRejection(REBOUND), 403)
}

// ---- mode 'off' ---------------------------------------------------------------
{
  const connection = makeConnection()
  mount(connection, { mode: volatile('off') })
  assert.equal(connection.requestRejection(LOOPBACK), 401)
  assert.equal(connection.authorizeIndex(LOOPBACK, {}), false)
  assert.ok(connection.authenticatedUrl('http://127.0.0.1:3080').includes('token=SECRET'))
}

// ---- an unknown mode falls back to 'loopback' ---------------------------------
{
  const connection = makeConnection()
  mount(connection, { mode: volatile('whatever') })
  assert.equal(connection.requestRejection(LOOPBACK), undefined)
  assert.equal(connection.requestRejection(LAN), 401)
}

// ---- a Settings write: volatile ref, committed in place, no re-apply ----------
{
  const connection = makeConnection()
  const config = { mode: volatile('loopback') }
  const mounted = mount(connection, config)
  assert.equal(connection.requestRejection(LAN), 401)

  // The Loader replaces the reference's contents; `apply` is never re-run.
  config.mode = volatile('all')
  mounted.fire()
  assert.equal(connection.requestRejection(LAN), undefined)

  // ...and back to the shipped behaviour, live.
  config.mode = volatile('off')
  mounted.fire()
  assert.equal(connection.requestRejection(LOOPBACK), 401)
  assert.equal(connection.authorizeIndex(LOOPBACK, {}), false)
}

// ---- options refresh on a second apply, teardown restores the gate ------------
{
  const connection = makeConnection()
  const originalRejection = connection.requestRejection
  const mounted = mount(connection, { mode: volatile('loopback') })
  assert.equal(connection.requestRejection(LAN), 401)

  mount(connection, { mode: volatile('all') }) // e.g. a config change + plugin reload
  assert.equal(connection.requestRejection(LAN), undefined)

  mounted.dispose()
  assert.equal(connection.requestRejection, originalRejection)
  assert.equal(connection.requestRejection(LAN), 401)
  assert.equal(connection.authorizeIndex(LOOPBACK, {}), false)
}

// ---- LAN control: one write switches the bind, and the route reports it -------
{
  const realTimeout = globalThis.setTimeout
  // Polling waits are compressed so the failure paths stay instant.
  globalThis.setTimeout = (callback) => {
    callback()
    return 0
  }
  try {
    const connection = makeConnection()
    const writes = []
    const inherited = {
      host: { __jsExpr: "ctx.webStartup.host ?? '127.0.0.1'" },
      port: { __jsExpr: 'ctx.webStartup.port ?? 3080' },
      compression: 'gzip',
      compressionLevel: 1,
      compressionThresholdBytes: 1024,
    }
    const webServer = {
      host: '127.0.0.1',
      port: 3080,
      // The password form registers an ordinary web route; this double ignores it.
      register: () => () => {},
      // The mobile layer registers one raw index tap; this double ignores it too.
      tapIndex: () => () => {},
    }
    const webRuntime = { trustedHosts: [] }
    let onWrite = () => {}
    let failure
    const editor = {
      entries: () => [{ options: { id: 'webserver' } }],
      edit: async (entry, change) => {
        assert.equal(entry.options.id, 'webserver', 'the write targets the web server row')
        if (failure !== undefined) throw failure
        writes.push(change(undefined, inherited))
        onWrite()
      },
    }
    mount(connection, undefined, { webServer, webRuntime, configEditor: editor })

    const [route] = connection.routes
    assert.equal(route.path, '/api/no-token/lan')
    assert.deepEqual(route.methods, ['GET', 'POST'])
    assert.equal(route.requestBody, 'buffered')

    const call = async (method, body) => {
      const request = new Request('http://127.0.0.1:3080/api/no-token/lan', {
        method,
        ...body === undefined ? {} : { body: JSON.stringify(body) },
      })
      const response = await route.fetch(request)
      return { status: response.status, body: await response.json() }
    }

    // Off: the bind is loopback, so no listed address is usable yet, and every
    // entry still carries the tokenized link the phone would open.
    const off = await call('GET')
    assert.equal(off.status, 200)
    assert.equal(off.body.ok, true)
    assert.equal(off.body.state.bind, '127.0.0.1')
    assert.equal(off.body.state.enabled, false)
    assert.equal(off.body.state.port, 3080)
    assert.equal(off.body.state.tokenRequired, true)
    for (const entry of off.body.state.addresses) {
      assert.equal(entry.usable, false, 'a loopback bind serves no LAN address')
      assert.match(entry.loginUrl, /[?&]token=SECRET/, 'the link carries the process token')
    }
    const detected = off.body.state.addresses.map((entry) => entry.address)

    // Enable: host becomes the wildcard, and the inherited expressions survive.
    onWrite = () => {
      webServer.host = '0.0.0.0'
      webRuntime.trustedHosts = [...detected]
    }
    const enable = await call('POST', { enabled: true })
    assert.equal(enable.status, 200)
    assert.equal(enable.body.ok, true)
    assert.equal(writes[0].host, '0.0.0.0')
    assert.deepEqual(writes[0].port, inherited.port, 'the port keeps its !!js expression')
    assert.equal(writes[0].compression, 'gzip', 'the rest of the row config is restated')
    assert.equal(enable.body.state.enabled, true)
    assert.equal(enable.body.state.bind, '0.0.0.0')
    for (const entry of enable.body.state.addresses) {
      assert.equal(entry.trusted, true, 'the reloaded fence trusts the LAN literal')
      assert.equal(entry.usable, true)
    }

    // Disable: only the host override is dropped, so the schema default takes over
    // again. Everything else the operator had saved on this row survives — writing
    // the inherited layer back instead would have discarded it.
    onWrite = () => {
      webServer.host = '127.0.0.1'
    }
    const disable = await call('POST', { enabled: false })
    assert.equal(disable.status, 200)
    const expectedOff = { ...inherited }
    delete expectedOff.host
    assert.deepEqual(writes[1], expectedOff, 'the host override is dropped, the rest of the row survives')
    assert.equal('host' in writes[1], false, 'and no literal is pinned in its place')
    assert.equal(disable.body.state.enabled, false)

    // Failure paths are reported verbatim, never swallowed.
    assert.equal((await call('POST', { enabled: 'yes' })).status, 400)
    assert.equal((await call('POST', { enabled: 'yes' })).body.code, 'bad-request')

    onWrite = () => {}
    const mismatch = await call('POST', { enabled: true })
    assert.equal(mismatch.status, 409)
    assert.equal(mismatch.body.code, 'mismatch')
    assert.match(mismatch.body.error, /still 127\.0\.0\.1/)
    onWrite = () => {
      webServer.host = '127.0.0.1'
    }

    failure = new Error('Configuration for "webserver" is overridden by a home patch or command-line overlay')
    const overridden = await call('POST', { enabled: true })
    assert.equal(overridden.status, 409)
    assert.equal(overridden.body.code, 'overridden')

    failure = new Error('disk on fire')
    const broken = await call('POST', { enabled: true })
    assert.equal(broken.status, 500)
    assert.equal(broken.body.code, 'write-failed')
    assert.match(broken.body.error, /disk on fire/)
  } finally {
    globalThis.setTimeout = realTimeout
  }

  // Without the profile editor the route says so instead of pretending.
  const bare = makeConnection()
  mount(bare, undefined, { webServer: { host: '127.0.0.1', port: 3080, register: () => () => {}, tapIndex: () => () => {} } })
  const response = await bare.routes[0].fetch(new Request('http://127.0.0.1:3080/api/no-token/lan', {
    method: 'POST',
    body: JSON.stringify({ enabled: true }),
  }))
  const body = await response.json()
  assert.equal(response.status, 503)
  assert.equal(body.code, 'unavailable')
}

// ---- a remote index refusal names the step that works --------------------------
{
  const SHIPPED = 'dsh web authentication required; reopen the URL printed by dsh web.\n'
  const makeIndexConnection = () => ({
    requestRejection: () => 401,
    authorizeIndex(request, response) {
      const url = new URL(request.url ?? '/', 'http://dsh.invalid')
      if (url.searchParams.get('token') === 'good') {
        response.writeHead(303, { location: './', 'set-cookie': 'dsh-auth-x=y' })
        response.end()
        return false
      }
      response.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' })
      response.end(SHIPPED)
      return false
    },
    authenticatedUrl: (baseUrl) => `${baseUrl}?token=SECRET`,
    fetch: { register: () => () => {} },
  })
  const capture = () => {
    const state = { status: undefined, headers: undefined, body: undefined }
    return {
      state,
      writeHead(status, headers) {
        state.status = status
        state.headers = headers
        return this
      },
      end(body) {
        state.body = body
        return this
      },
    }
  }

  // With the gate enforced as shipped, a visitor on the machine keeps the
  // shipped text, which is accurate there.
  {
    const connection = makeIndexConnection()
    mount(connection, { mode: volatile('off') })
    const response = capture()
    connection.authorizeIndex({ headers: { host: '127.0.0.1:3080' }, url: '/' }, response)
    assert.equal(response.state.status, 401)
    assert.equal(response.state.body, SHIPPED, 'loopback keeps the shipped refusal')
  }

  // A visitor from the network is sent to the sign-in route, which offers the
  // password — or explains that only the token link works.
  {
    const connection = makeIndexConnection()
    mount(connection, undefined)
    const response = capture()
    connection.authorizeIndex({ headers: { host: '192.168.1.20:3080' }, url: '/' }, response)
    assert.equal(response.state.status, 302, 'the remote refusal becomes a redirect')
    assert.equal(response.state.headers.location, '/no-token/login')
    assert.equal(response.state.body, undefined, 'the dead-end text is not sent')
  }

  // The token exchange is a 303 with no body: it must pass through untouched.
  {
    const connection = makeIndexConnection()
    mount(connection, undefined)
    const response = capture()
    connection.authorizeIndex({ headers: { host: '192.168.1.20:3080' }, url: '/?token=good' }, response)
    assert.equal(response.state.status, 303)
    assert.equal(response.state.headers.location, './')
    assert.equal(response.state.body, undefined, 'the redirect body is not substituted')
  }
}

// ---- the password gate ---------------------------------------------------------
{
  const realTimeout = globalThis.setTimeout
  globalThis.setTimeout = (callback) => {
    callback()
    return 0
  }
  try {
    /** A credential store double with the reference half the real one exposes. */
    const makeCredentials = (initial) => {
      const value = { current: initial }
      return {
        value,
        async describe(ref) {
          assert.equal(ref, 'DSH_LAN_PASSWORD')
          return { configured: value.current !== undefined, writable: true }
        },
        async resolve(ref) {
          assert.equal(ref, 'DSH_LAN_PASSWORD')
          return value.current === undefined ? undefined : { value: value.current, source: 'store' }
        },
        async set(ref, next) {
          assert.equal(ref, 'DSH_LAN_PASSWORD')
          assert.notEqual(next, '', 'an empty value must go through unset')
          value.current = next
        },
        async unset(ref) {
          assert.equal(ref, 'DSH_LAN_PASSWORD')
          value.current = undefined
        },
      }
    }
    const mountHost = (credentials) => {
      const connection = makeConnection()
      const registered = []
      const webServer = {
        host: '127.0.0.1',
        port: 3080,
        register(route) {
          registered.push(route)
          return () => {}
        },
        tapIndex: () => () => {},
      }
      mount(connection, undefined, { webServer, credentials, webRuntime: { trustedHosts: [] } })
      return { connection, webServer, registered }
    }
    /** A node request double: an async iterable body plus headers. */
    const nodeRequest = (method, headers, body) => ({
      method,
      headers,
      url: '/no-token/login',
      async *[Symbol.asyncIterator]() {
        if (body !== undefined) yield Buffer.from(body, 'utf8')
      },
    })
    const nodeResponse = () => {
      const state = { status: undefined, headers: undefined, body: undefined }
      return {
        state,
        writeHead(status, headers) {
          state.status = status
          state.headers = headers
          return this
        },
        end(body) {
          state.body = body
          return this
        },
      }
    }

    // The LAN route stores and clears the password, and never returns its value.
    const credentials = makeCredentials(undefined)
    const { connection, registered } = mountHost(credentials)
    const lanRoute = connection.routes[0]
    const call = async (method, body) => {
      const response = await lanRoute.fetch(new Request('http://127.0.0.1:3080/api/no-token/lan', {
        method,
        ...body === undefined ? {} : { body: JSON.stringify(body) },
      }))
      return { status: response.status, body: await response.json() }
    }
    const before = await call('GET')
    assert.equal(before.body.state.password.set, false)
    assert.equal(before.body.state.password.ref, 'DSH_LAN_PASSWORD')
    assert.equal(JSON.stringify(before.body).includes('password":'), true)
    const saved = await call('POST', { password: 'hunter2' })
    assert.equal(saved.status, 200)
    assert.equal(credentials.value.current, 'hunter2')
    assert.equal(saved.body.state.password.set, true, 'the page learns presence, not the value')
    assert.ok(!JSON.stringify(saved.body).includes('hunter2'), 'the value never travels back')
    const cleared = await call('POST', { password: null })
    assert.equal(cleared.status, 200)
    assert.equal(credentials.value.current, undefined)
    assert.equal(cleared.body.state.password.set, false)

    // The sign-in route: a form, then the shipped token exchange on success.
    const loginRoute = registered.find((route) => route.path === '/no-token/login')
    assert.ok(loginRoute !== undefined, 'the password form registers an ordinary web route')
    assert.equal(loginRoute.kind, 'exact', 'and it is not under /api, which needs the session a visitor lacks')

    await credentials.set('DSH_LAN_PASSWORD', 'hunter2')
    const form = nodeResponse()
    await loginRoute.handler(nodeRequest('GET', { host: '192.168.1.20:3080' }), form)
    assert.equal(form.state.status, 200)
    assert.match(form.state.body, /<form method="post" action="\/no-token\/login">/)
    assert.match(form.state.body, /type="password"/)
    assert.match(form.state.body, /192\.168\.1\.20:3080/, 'the form names the address it was reached on')

    const wrong = nodeResponse()
    await loginRoute.handler(nodeRequest('POST', { host: '192.168.1.20:3080' }, 'password=nope'), wrong)
    assert.equal(wrong.state.status, 401)
    assert.match(wrong.state.body, /密码不对/)

    const right = nodeResponse()
    await loginRoute.handler(nodeRequest('POST', { host: '192.168.1.20:3080' }, 'password=hunter2'), right)
    assert.equal(right.state.status, 303, 'a correct password hands over to the shipped token exchange')
    assert.match(right.state.headers.location, /[?&]token=SECRET/, 'the redirect carries the process token')

    // Brute force is refused after the limit, per authority.
    let locked
    for (let attempt = 0; attempt < 10; attempt += 1) {
      locked = nodeResponse()
      await loginRoute.handler(nodeRequest('POST', { host: '10.0.0.9:3080' }, 'password=nope'), locked)
      if (locked.state.status === 429) break
    }
    assert.equal(locked.state.status, 429, 'repeated failures lock the authority out')

    // The authority is attacker-controlled text and must be escaped.
    const injection = nodeResponse()
    await loginRoute.handler(nodeRequest('GET', { host: 'evil"><script>alert(1)</script>' }), injection)
    assert.ok(!injection.state.body.includes('<script>alert(1)</script>'), 'the Host header cannot inject markup')
    assert.match(injection.state.body, /&quot;&gt;&lt;script&gt;/)

    // With no password configured the form says what to do instead.
    const empty = makeCredentials(undefined)
    const bare = mountHost(empty)
    const bareLogin = bare.registered.find((route) => route.path === '/no-token/login')
    const noPassword = nodeResponse()
    await bareLogin.handler(nodeRequest('GET', { host: '192.168.1.20:3080' }), noPassword)
    assert.equal(noPassword.state.status, 200)
    assert.match(noPassword.state.body, /还没有设置密码/)
    const refused = nodeResponse()
    await bareLogin.handler(nodeRequest('POST', { host: '192.168.1.20:3080' }, 'password=anything'), refused)
    assert.equal(refused.state.status, 409)

    // The lockout table is keyed by a header the visitor chooses, so it is bounded:
    // enough distinct authorities must push the oldest attempt history out, and the
    // proof is that a locked authority is answerable again rather than remembered.
    {
      const bounded = makeCredentials('hunter2')
      const host = mountHost(bounded)
      const route = host.registered.find((candidate) => candidate.path === '/no-token/login')
      const attempt = async (authority) => {
        const response = nodeResponse()
        await route.handler(nodeRequest('POST', { host: authority }, 'password=nope'), response)
        return response.state.status
      }
      for (let index = 0; index < 9; index += 1) assert.equal(await attempt('10.1.1.1:3080'), index === 8 ? 429 : 401)
      assert.equal(await attempt('10.1.1.1:3080'), 429, 'and it stays locked while it is remembered')
      for (let index = 0; index < 70; index += 1) await attempt(`10.9.${String(index)}.1:3080`)
      assert.equal(await attempt('10.1.1.1:3080'), 401, 'a forgotten authority starts over instead of growing the table without bound')
    }

    // A hand-edited profile patch can leave an HMR transaction open; the editor then
    // refuses the write, and the operator has to be told the one action that works.
    {
      const stuck = makeConnection()
      const registered = []
      mount(stuck, undefined, {
        webServer: { host: '127.0.0.1', port: 3080, register: (route) => { registered.push(route); return () => {} } },
        credentials: makeCredentials(undefined),
        webRuntime: { trustedHosts: [] },
        configEditor: {
          entries: () => [{ options: { id: 'webserver' } }],
          edit: () => Promise.reject(new Error('HMR transactions cannot be nested')),
        },
      })
      const response = await stuck.routes[0].fetch(new Request('http://127.0.0.1:3080/api/no-token/lan', {
        method: 'POST',
        body: JSON.stringify({ enabled: true }),
      }))
      const body = await response.json()
      assert.equal(body.code, 'busy', 'a stuck configuration editor is reported as busy, not as a generic failure')
      assert.match(body.error, /restart dsh web/, 'and the message names the action that clears it')
      assert.equal(response.status, 409)
    }
  } finally {
    globalThis.setTimeout = realTimeout
  }
}

// ---- extra trusted hosts: tunnels and reverse proxies --------------------------
// A tunnel presents a hostname, not an IP literal, so the shipped fence answers 403
// to every /api request and the page loads into a permanent "reconnecting". The
// configured list is this plugin's `--trusted-host`, and the browser markers the
// fence checks must survive it.
{
  /** A connection double whose fence behaves like the shipped one. */
  const makeFenced = () => {
    const routes = []
    return {
      routes,
      fetch: {
        register(route) {
          routes.push(route)
          return () => {}
        },
      },
      requestRejection(request) {
        const host = request.headers instanceof Headers ? request.headers.get('host') : request.headers.host
        const hostname = String(host ?? '').replace(/:\d+$/, '')
        if (hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '192.168.1.20') return 401
        return 403
      },
      authorizeIndex: () => false,
      authenticatedUrl: (baseUrl) => `${baseUrl}?token=SECRET`,
    }
  }
  const headers = (extra = {}) => ({ headers: { host: 'abc.ngrok-free.app', ...extra } })

  const without = makeFenced()
  mount(without, { mode: 'loopback' })
  assert.equal(without.requestRejection(headers()), 403, 'an unlisted tunnel hostname is still refused')

  const withTrust = makeFenced()
  mount(withTrust, { mode: 'loopback', trustedHosts: ['abc.ngrok-free.app'] })
  assert.equal(withTrust.requestRejection(headers()), undefined, 'a listed tunnel hostname is admitted')
  assert.equal(
    withTrust.requestRejection(headers({ 'sec-fetch-site': 'cross-site' })),
    403,
    'but a cross-site request through it is still refused',
  )
  assert.equal(
    withTrust.requestRejection(headers({ origin: 'https://evil.example' })),
    403,
    'and so is a request whose Origin contradicts its Host',
  )
  assert.equal(
    withTrust.requestRejection(headers({ origin: 'https://abc.ngrok-free.app' })),
    undefined,
    'while the tunnel own origin passes',
  )
  assert.equal(
    withTrust.requestRejection(headers({ host: 'other.ngrok-free.app' })),
    403,
    'a different hostname on the same provider is not covered',
  )

  // A port-qualified entry matches that port only; a bare one matches any port.
  const ported = makeFenced()
  mount(ported, { mode: 'loopback', trustedHosts: ['abc.example:8443', 'plain.example'] })
  assert.equal(ported.requestRejection(headers({ host: 'abc.example:8443' })), undefined)
  assert.equal(ported.requestRejection(headers({ host: 'abc.example:9999' })), 403, 'a listed port is exact')
  assert.equal(ported.requestRejection(headers({ host: 'plain.example:9999' })), undefined, 'a port-less entry matches any port')

  // The list is written through the same profile editor the bind uses, normalized.
  {
    const writes = []
    const connection = makeFenced()
    mount(connection, { mode: 'loopback' }, {
      webServer: { host: '127.0.0.1', port: 3080, register: () => () => {} },
      webRuntime: { trustedHosts: [] },
      credentials: { describe: async () => ({ configured: false, writable: true }), resolve: async () => undefined },
      configEditor: {
        entries: () => [{ options: { id: 'no-token' } }],
        edit: async (entry, mutate) => {
          // `current` is what the operator already saved on this row; the write must
          // keep it. Deriving the config from the inherited layer alone is what once
          // reset the access mode as a side effect of saving a trusted host.
          writes.push(mutate({ mode: 'all' }, { mode: 'loopback', trustedHosts: [] }))
        },
      },
    })
    const response = await connection.routes[0].fetch(new Request('http://127.0.0.1:3080/api/no-token/lan', {
      method: 'POST',
      body: JSON.stringify({ trustedHosts: [' ABC.Example ', 'http://x.test/', '   '] }),
    }))
    const body = await response.json()
    assert.equal(body.ok, true)
    assert.deepEqual(writes[0].trustedHosts, ['abc.example', 'x.test'], 'entries are normalized, blank ones dropped')
    assert.equal(writes[0].mode, 'all', 'and the access mode the operator already saved survives the write')
  }
}

console.log('verify-no-token: all assertions passed')
