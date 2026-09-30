/**
 * dsh-no-token — serve the Harness Web UI without the mandatory browser-token
 * gate, while leaving the Host/Origin trust fence switched on.
 *
 * The gate lives in `@deepseek-ai/dsh-client-connection`. `BrowserAuth` mints a
 * signed cookie when the process token (`/?token=…`) is exchanged at the root,
 * and every later `/api` request must carry that cookie again. Two decisions on
 * the live `connection` service enforce it:
 *
 *   requestRejection(request)  401 when the cookie is missing/invalid,
 *                              403 when the Host/Origin fence refuses;
 *   authorizeIndex(req, res)   401 (or a 303 cookie exchange) for index.html.
 *
 * This plugin wraps those two decisions — plus `authenticatedUrl`, so the
 * printed/opened URL stops carrying the secret — on the live service instance,
 * and drops ONLY the 401 authentication layer:
 *
 *   - `requestRejection`: 401 becomes "admitted"; 403 and `undefined` pass
 *     through untouched, so DNS-rebinding and cross-site protection still hold.
 *   - `authorizeIndex`: index.html is served directly on the bypassed scope.
 *   - `authenticatedUrl`: the `?token=` parameter is removed on the bypassed
 *     scope only, so a remote URL keeps its token while `mode: 'loopback'`.
 *
 * `mode` is a volatile Config field, so the Settings page (`client.js`) edits a
 * running plugin: the Loader commits an accepted edit in place and emits
 * `loader/volatile-update` instead of re-running `apply`, which is why the mode
 * lives in one mutable holder the wrappers read on every request.
 *
 *   - 'loopback' (default) — only requests whose Host authority is the local
 *     machine (localhost, 127/8, [::1]) skip the gate. A server bound to a LAN
 *     address still demands the token from every other machine, and the printed
 *     LAN URL stays usable for that.
 *   - 'all' — every request that passes the Host/Origin fence skips the gate.
 *     Use this only when nothing but you can reach the port.
 *   - 'off' — official behaviour: the process token is mandatory again. The
 *     wrappers stay installed and become pass-through, so a live edit in either
 *     direction takes effect without a reload.
 *
 * The module imports exactly one package — schemastery, which the Config schema
 * requires — and nothing from the Harness itself.
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import { networkInterfaces } from 'node:os'
import z from '@deepseek-ai/schemastery'

/** Stable Cordis plugin name. */
export const name = 'no-token'

/** Accepted `mode` values. */
const LOOPBACK = 'loopback'
const ALL = 'all'
const OFF = 'off'

/** The accepted modes, as the schema and the page's copy enumerate them. */
const MODES = [LOOPBACK, ALL, OFF]

/**
 * Plugin Config — one volatile enum field.
 *
 * `volatile()` is what makes the field editable at all: `dsh-settings` refuses
 * an edit to any path that is not beneath a volatile node, and the Loader's
 * volatile commit path is what applies an accepted edit without remounting this
 * plugin. The default is the loopback scope, so an unconfigured install is
 * already useful and still refuses remote clients.
 */
export const Config = z.object({
  mode: z.union(MODES).default(LOOPBACK).volatile(),
  /**
   * Non-loopback authorities this deployment serves besides the LAN literals —
   * the same idea as the CLI's `--trusted-host`, which a plugin cannot add to
   * someone's launch line. A tunnel (ngrok, a Cloudflare tunnel, a reverse proxy
   * or a private DNS name) presents a hostname the shipped fence refuses with 403,
   * which leaves the page loading but its `/api` bridge and event stream dead: the
   * UI sits on "reconnecting" forever.
   *
   * One authority per line. An entry with a port matches exactly; a port-less
   * entry matches that hostname on any port, mirroring `isTrustedAuthority`.
   */
  trustedHosts: z.array(z.string()).default([]),
})

/**
 * Marker cosmokit puts on a volatile reference. A volatile Config field
 * resolves to such a reference — never to the plain value it holds — so every
 * read goes through {@link readMode}.
 */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/**
 * Whether a resolved config value is a cosmokit volatile reference.
 * @param value - one resolved Config field.
 * @returns true when the value must be read through `get()`.
 */
function isVolatileRef(value) {
  return value !== null && typeof value === 'object' && (VOLATILE_WRITE in value || typeof value.get === 'function')
}

/**
 * The current mode, from a plain value or from the live reference the Loader
 * substitutes for a volatile field.
 * @param config - the plugin's resolved Config.
 * @param warn - reporter for a value outside the schema.
 * @returns one of the three modes, defaulting to the safe one.
 */
function readMode(config, warn) {
  const raw = config?.mode
  const value = isVolatileRef(raw) ? raw.get() : raw
  if (value === LOOPBACK || value === ALL || value === OFF) return value
  if (value !== undefined) warn(`unknown mode ${JSON.stringify(value)}; using "${LOOPBACK}"`)
  return LOOPBACK
}

/**
 * Normalize one authority for comparison: lowercase, no scheme, no trailing slash.
 * @param value - one raw entry.
 * @returns the comparable authority, or undefined when the entry is unusable.
 */
function normalizeAuthority(value) {
  const trimmed = String(value ?? '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/\/+$/, '')
  return trimmed === '' ? undefined : trimmed
}

/**
 * The extra authorities this deployment trusts, from the live Config.
 * @param config - the plugin's resolved Config.
 * @returns normalized authorities, in configured order.
 */
function readTrustedHosts(config) {
  const raw = config?.trustedHosts
  const value = isVolatileRef(raw) ? raw.get() : raw
  if (!Array.isArray(value)) return []
  return value.map(normalizeAuthority).filter((entry) => entry !== undefined)
}

/**
 * Whether a request authority matches one configured entry.
 *
 * Mirrors the shipped `isTrustedAuthority`: a port-less entry matches the
 * hostname on any port, an entry with a port matches that exact authority, and
 * both sides compare after WHATWG normalization so case and a redundant `:80`
 * never decide trust.
 * @param authority - the request's `host` header.
 * @param trusted - the configured authorities.
 * @returns true when the authority is explicitly trusted.
 */
function matchesTrustedAuthority(authority, trusted) {
  const wanted = normalizeAuthority(authority)
  if (wanted === undefined) return false
  const host = wanted.replace(/:\d+$/, '')
  return trusted.some((entry) => (entry.includes(':') ? entry === wanted : entry === host))
}

/**
 * The browser markers the shipped fence checks before it trusts a Host.
 *
 * Kept verbatim for explicitly trusted authorities: a listed tunnel hostname must
 * not also disable the DNS-rebinding defence that stops a hostile page from
 * driving this machine through the browser.
 * @param request - the request facts the fence receives.
 * @returns true when no browser marker contradicts the request's own authority.
 */
function isSameOriginRequest(request) {
  const host = headerValue(request.headers, 'host')
  if (host === undefined) return false
  let authority
  try {
    authority = new URL(`http://${host}`)
  } catch {
    return false
  }
  const site = headerValue(request.headers, 'sec-fetch-site')
  if (typeof site === 'string' && site.toLowerCase() === 'cross-site') return false
  const origin = headerValue(request.headers, 'origin')
  if (origin === undefined || origin === '') return true
  try {
    return new URL(origin).host === authority.host
  } catch {
    return false
  }
}

/**
 * Patch record kept on the live `connection` instance: it identifies this
 * plugin's wrapper functions, carries the current mode, and holds the teardown
 * hook. A symbol key keeps it invisible to the service's own surface.
 */
const PATCH = Symbol.for('dsh-no-token/patch')

/**
 * Read one header from either a WHATWG `Headers` instance or a node:http header
 * record (`string`, or an array of strings for repeated headers).
 * @param headers - the request's header bag.
 * @param wanted - lowercase header name.
 * @returns the first value, or undefined when the header is absent.
 */
function headerValue(headers, wanted) {
  if (headers === undefined || headers === null || typeof headers !== 'object') return undefined
  if (typeof Headers === 'function' && headers instanceof Headers) return headers.get(wanted) ?? undefined
  const value = headers[wanted]
  if (typeof value === 'string') return value
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  return undefined
}

/**
 * Whether a normalized hostname names the local machine.
 * @param hostname - WHATWG URL hostname (IPv6 literals keep their brackets).
 * @returns true for localhost, IPv6 loopback, or any IPv4 address in 127/8.
 */
function isLoopbackHostname(hostname) {
  if (typeof hostname !== 'string') return false
  if (hostname === 'localhost' || hostname === '[::1]' || hostname === '::1') return true
  const parts = hostname.split('.')
  return parts.length === 4 && parts[0] === '127' && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/**
 * Hostname of the authority the request arrived with. The Host header is what
 * DNS rebinding cannot forge, which is why it — not the socket address — is
 * what both the fence and this decision read.
 * @param request - `{ headers }` as Connection defines it.
 * @returns the hostname, or undefined when the header is absent or unparsable.
 */
function requestHostname(request) {
  const host = headerValue(request?.headers, 'host')
  if (host === undefined) return undefined
  try {
    return new URL(`http://${host}`).hostname
  } catch {
    return undefined
  }
}

/**
 * Hostname of a URL string.
 * @param url - absolute URL.
 * @returns the hostname, or undefined when the URL does not parse.
 */
function urlHostname(url) {
  try {
    return new URL(url).hostname
  } catch {
    return undefined
  }
}

/**
 * Remove the process `?token=` secret from an application URL.
 * @param url - the tokenized URL.
 * @returns the same URL without its token parameter.
 */
function stripToken(url) {
  try {
    const parsed = new URL(url)
    parsed.searchParams.delete('token')
    return parsed.href
  } catch {
    return url
  }
}

/**
 * Whether the gate is skipped for this authority under a mode. A missing or
 * unparsable Host never bypasses: the decision fails closed.
 * @param mode - the mode currently in force.
 * @param hostname - request or URL hostname.
 * @returns true when the 401 layer should be dropped for this request.
 */
function bypasses(mode, hostname) {
  if (mode === ALL) return true
  if (mode === OFF) return false
  return isLoopbackHostname(hostname)
}

/**
 * Wrap the gate decisions on one live connection instance. Idempotent: a second
 * call on an already-patched instance only repoints it at the shared mode
 * holder, so wrapper functions always read the mode in force.
 * @param connection - the live `connection` service instance.
 * @param state - the mutable holder carrying the current mode.
 * @param config - the plugin's resolved Config, read live for the trusted-host list.
 * @returns true when this call installed the wrappers.
 */
function patchConnection(connection, state, config) {
  const existing = connection[PATCH]
  if (existing !== undefined) {
    existing.state = state
    existing.config = config
    return false
  }

  const record = { state, config, restore: undefined }
  Object.defineProperty(connection, PATCH, { value: record, enumerable: false, configurable: true })

  const originalRejection = connection.requestRejection
  const originalAuthorizeIndex = connection.authorizeIndex
  const originalAuthenticatedUrl = connection.authenticatedUrl

  const requestRejection = function requestRejection(request) {
    const rejection = typeof originalRejection === 'function' ? originalRejection.call(connection, request) : undefined
    // 403 is the trust fence. A hostname the operator listed by name earns the
    // same trust the CLI's `--trusted-host` gives it — a tunnel hostname is not an
    // IP literal, so the shipped fence refuses every `/api` request and the page
    // loads into a permanent "reconnecting" with a dead event stream. The browser
    // markers the fence checks are re-applied here, so listing a name never
    // disables the DNS-rebinding defence.
    if (rejection === 403) {
      // The raw `host` header, not the parsed hostname: a configured entry may name
      // a port, and `requestHostname` drops it.
      const authority = headerValue(request.headers, 'host')
      const configured = connection[PATCH].config
      if (matchesTrustedAuthority(authority, readTrustedHosts(configured)) && isSameOriginRequest(request)) {
        return undefined
      }
      return rejection
    }
    if (rejection !== 401) return rejection
    return bypasses(connection[PATCH].state.mode, requestHostname(request)) ? undefined : rejection
  }

  const authorizeIndex = function authorizeIndex(request, response) {
    // The document names its client modules by content revision, and a chunk URL
    // whose revision is gone answers 404 — so a browser that reuses a cached
    // document cannot boot the app at all: it renders a blank page. The shipped
    // static server sets no cache headers, which leaves that decision to each
    // browser's heuristic, and Chrome reuses a stale document where Firefox
    // revalidates. This wrapper is the one place that sees every index response, so
    // the header is set here — for the bypassed path and the shipped one alike.
    try {
      if (typeof response.setHeader === 'function') response.setHeader('cache-control', 'no-store')
    } catch {
      /* a response that cannot take a header is not worth failing the request over */
    }
    if (bypasses(connection[PATCH].state.mode, requestHostname(request))) {
      // The Desktop app authenticates itself against this very server with a
      // tokenized request over loopback; a bypass that swallows the exchange leaves
      // it without its session cookie and it aborts the whole boot with "Desktop
      // Host authentication failed". A tokenized request therefore always runs the
      // shipped exchange — the bypass only serves a bare index directly.
      const carriesToken = /\btoken=/.test(request.url ?? '')
      if (carriesToken && typeof originalAuthorizeIndex === 'function') {
        return originalAuthorizeIndex.call(connection, request, response)
      }
      return true
    }
    if (typeof originalAuthorizeIndex !== 'function') return true
    const hostname = requestHostname(request)
    // Loopback keeps the shipped refusal, which is accurate there. A visitor from
    // the network is sent to the sign-in route instead: the shipped text points
    // at a terminal line this process prints at most once, and the sign-in route
    // is where a password — or the token link — is actually offered.
    if (isLoopbackHostname(hostname)) {
      return originalAuthorizeIndex.call(connection, request, response)
    }
    let status
    let headers
    const proxy = {
      writeHead(code, next) {
        status = code
        headers = next
        return proxy
      },
      end(body) {
        // Only the authentication refusal is rewritten, and only when the
        // original wrote a body: the token exchange's 303 passes through.
        if (status === 401 && body !== undefined) {
          response.writeHead(302, {
            'cache-control': 'no-store',
            location: LOGIN_PATH,
            'referrer-policy': 'no-referrer',
          })
          return response.end()
        }
        // `writeHead` is the only call a wrapped response is guaranteed to expose —
        // a mount proxy (reverse-proxy subpaths) hands over exactly this shape — so
        // the no-store header is merged here as well as set on the raw response.
        response.writeHead(status === undefined ? 200 : status, { 'cache-control': 'no-store', ...headers })
        return response.end(body)
      },
    }
    return originalAuthorizeIndex.call(connection, request, proxy)
  }

  const authenticatedUrl = function authenticatedUrl(baseUrl) {
    // The token stays on every authority. Stripping it from the bypassed one broke
    // the Desktop host's self-authentication: it builds its login URL through this
    // method and then performs the exchange, so a tokenless URL fails the boot. A
    // one-time process token in a login link is what the shipped behaviour is, and
    // a bare loopback visit still opens without one — the gate, not the URL, is the
    // policy.
    return typeof originalAuthenticatedUrl === 'function'
      ? originalAuthenticatedUrl.call(connection, baseUrl)
      : baseUrl
  }

  connection.requestRejection = requestRejection
  connection.authorizeIndex = authorizeIndex
  connection.authenticatedUrl = authenticatedUrl

  const restoreMethod = (key, patched, original) => {
    if (connection[key] !== patched) return
    if (typeof original === 'function') connection[key] = original
    else delete connection[key]
  }

  record.restore = () => {
    if (connection[PATCH] !== record) return
    restoreMethod('requestRejection', requestRejection, originalRejection)
    restoreMethod('authorizeIndex', authorizeIndex, originalAuthorizeIndex)
    restoreMethod('authenticatedUrl', authenticatedUrl, originalAuthenticatedUrl)
    delete connection[PATCH]
  }

  return true
}

/**
 * One console/logger line describing what a mode does, for the boot log.
 * @param mode - the mode in force.
 * @returns the sentence to print.
 */
function describeMode(mode) {
  if (mode === ALL) return 'token gate disabled for every trusted-host request — make sure only you can reach this port'
  if (mode === OFF) return `mode "${OFF}": the browser-token gate is enforced as shipped`
  return 'token gate disabled for loopback requests — open the printed URL directly, no ?token= needed'
}

//#region mobile layout

/**
 * Narrow-viewport corrections for the shipped shell, which carries no media
 * query of its own (its only one is `prefers-reduced-motion`). Every rule sits
 * behind the query, so a desktop window is untouched. Selectors match the
 * semantic part of a generated class name (`[class*="_backdrop_"]`), which
 * survives a rebuild that changes the hash around it.
 *
 * It is injected into `<head>` through `webserver/index-inject` rather than
 * rendered by the browser half: the served document carries no cache headers, so
 * a phone can keep a cached document pointing at an older client module — and a
 * style mounted by that module would then never arrive. A head row is present at
 * the first paint and needs no JavaScript.
 */
const MOBILE_CSS = `/* dsh-no-token/mobile */
@media (max-width: 820px) {
  html, body, #root { height: 100dvh; max-width: 100%; overflow-x: hidden; }
  html { -webkit-text-size-adjust: 100%; }
  body { overscroll-behavior-y: none; }
  *, *::before, *::after { -webkit-tap-highlight-color: transparent; }
  /* iOS zooms any focused control under 16px and does not zoom back out. */
  input, textarea, select { font-size: 16px !important; }
  button, [role="button"], [role="tab"], [role="menuitem"] { touch-action: manipulation; }
  img, video, canvas { max-width: 100%; height: auto; }
  pre, table { max-width: 100%; overflow-x: auto; }

  /* ---- the frame ----------------------------------------------------------
     The shell lays out a JS-computed grid whose centre column is floored at
     minmax(400px, 1fr) and whose sidebar, when expanded, is a fixed 264-420px
     column. On a phone that leaves the conversation a strip, so only the template
     is overridden and the three items are pinned to their tracks - necessary,
     because an absolutely positioned sidebar would otherwise let auto-placement
     slide the centre into the first track. The right column stays a zero-width
     track, which is what its occupant expects: it draws its panel anchored to the
     frame's right edge and only uses the track to ask the centre for room. ------- */
  [class$="_frame"], [class*="_frame "] { grid-template-columns: 0 minmax(0, 1fr) 0 !important; }
  [class$="_frame"][data-sidebar-collapsed], [class*="_frame "][data-sidebar-collapsed] {
    grid-template-columns: 56px minmax(0, 1fr) 0 !important;
  }
  html[data-platform="darwin"] [class$="_frame"][data-sidebar-collapsed],
  html[data-platform="darwin"] [class*="_frame "][data-sidebar-collapsed] {
    grid-template-columns: 0 minmax(0, 1fr) 0 !important;
  }
  [class$="_sidebarCol"], [class*="_sidebarCol "] { grid-column: 1 !important; grid-row: 1 !important; }
  [class$="_centerCol"], [class*="_centerCol "] { grid-column: 2 !important; grid-row: 1 !important; min-width: 0 !important; }
  [class$="_rightbarCol"], [class*="_rightbarCol "] { grid-column: 3 !important; grid-row: 1 !important; }
  /* Expanded on a phone the session list is a drawer over the conversation. */
  [class$="_frame"]:not([data-sidebar-collapsed]) [class$="_sidebarCol"],
  [class*="_frame "]:not([data-sidebar-collapsed]) [class$="_sidebarCol"],
  [class$="_frame"]:not([data-sidebar-collapsed]) [class*="_sidebarCol "],
  [class*="_frame "]:not([data-sidebar-collapsed]) [class*="_sidebarCol "] {
    position: absolute !important;
    inset: 0 auto 0 0 !important;
    z-index: 40 !important;
    width: min(86vw, 320px) !important;
    box-shadow: 0 0 0 100vmax rgb(0 0 0 / 45%) !important;
  }
  [class$="_frame"]:not([data-sidebar-collapsed]) [class$="_sidebarCol"] > *,
  [class*="_frame "]:not([data-sidebar-collapsed]) [class$="_sidebarCol"] > * { max-width: 100% !important; }

  /* ---- the shell's own controls, by names the running build really uses ---- */
  [class$="_viewArea"],
  [class*="_viewArea "],
  [class*="_viewArea_"],
  [class$="_scrollBody"],
  [class*="_scrollBody "],
  [class*="_scrollBody_"],
  [class$="_scroll"],
  [class*="_scroll "],
  [class*="_scroll_"] {
    min-width: 0 !important;
    padding-left: 12px !important;
    padding-right: 12px !important;
  }
  [class$="_headline"],
  [class*="_headline "],
  [class*="_headline_"] {
    font-size: 22px !important;
    line-height: 1.35 !important;
  }
  [class$="_composerSeat"],
  [class*="_composerSeat "],
  [class*="_composerSeat_"],
  [class$="_composerHero"],
  [class*="_composerHero "],
  [class*="_composerHero_"],
  [class$="_composerStack"],
  [class*="_composerStack "],
  [class*="_composerStack_"] {
    padding-left: max(8px, env(safe-area-inset-left)) !important;
    padding-right: max(8px, env(safe-area-inset-right)) !important;
    padding-bottom: max(8px, env(safe-area-inset-bottom)) !important;
  }
  [class$="_editor"],
  [class*="_editor "],
  [class*="_editor_"] {
    min-height: 40px;
  }
  [class$="_iconButton"],
  [class*="_iconButton "],
  [class*="_iconButton_"] {
    min-width: 36px !important;
    min-height: 36px !important;
  }
  [class$="_row"],
  [class*="_row "],
  [class*="_row_"],
  [class$="_item"],
  [class*="_item "],
  [class*="_item_"] {
    min-height: 38px;
  }
  [class$="_dialog"],
  [class*="_dialog "],
  [class*="_dialog_"],
  [class$="_panelBody"],
  [class*="_panelBody "],
  [class*="_panelBody_"] {
    max-width: 100% !important;
  }
  [class$="_tablePane"],
  [class*="_tablePane "],
  [class*="_tablePane_"],
  [class$="_summaryScrollRegion"],
  [class*="_summaryScrollRegion "],
  [class*="_summaryScrollRegion_"],
  [class$="_scrollport"],
  [class*="_scrollport "],
  [class*="_scrollport_"] {
    overflow-x: auto;
  }

  /* ---- markup-keyed rules, which survive any renaming --------------------- */
  [role="dialog"] { max-width: 100% !important; max-height: calc(100dvh - 16px) !important; }
  [role="menu"], [role="listbox"] { max-width: 92vw !important; }
}

/* A phone held sideways (about 844-932 CSS px) is already inside the shell's own
   narrow mode, which starts at SIDEBAR_AUTO_COLLAPSE = 1024 and keys its layout in
   JavaScript. Only device-level rules belong here. */
@media (pointer: coarse) and (min-width: 821px) and (max-width: 1023.98px) {
  html { -webkit-text-size-adjust: 100%; }
  body { overscroll-behavior-y: none; }
  *, *::before, *::after { -webkit-tap-highlight-color: transparent; }
  input, textarea, select { font-size: 16px !important; }
  button, [role="button"], [role="tab"], [role="menuitem"] { touch-action: manipulation; }
  [class$="_frame"],
  [class*="_frame "],
  [class*="_frame_"] {
    box-sizing: border-box;
    padding-top: env(safe-area-inset-top);
    padding-left: env(safe-area-inset-left);
    padding-right: env(safe-area-inset-right);
  }
  [class$="_composerSeat"],
  [class*="_composerSeat "],
  [class*="_composerSeat_"],
  [class$="_composerHero"],
  [class*="_composerHero "],
  [class*="_composerHero_"],
  [class$="_composerStack"],
  [class*="_composerStack "],
  [class*="_composerStack_"] {
    padding-left: max(8px, env(safe-area-inset-left)) !important;
    padding-right: max(8px, env(safe-area-inset-right)) !important;
    padding-bottom: max(8px, env(safe-area-inset-bottom)) !important;
  }
  [class$="_iconButton"],
  [class*="_iconButton "],
  [class*="_iconButton_"] {
    min-width: 36px !important;
    min-height: 36px !important;
  }
  [class$="_dialog"],
  [class*="_dialog "],
  [class*="_dialog_"] {
    max-height: calc(100dvh - 16px - env(safe-area-inset-top) - env(safe-area-inset-bottom)) !important;
  }
}
`

/**
 * Replace this row's trusted-host list, the same durable write the LAN switch
 * performs on the webserver row.
 * @param deps - live service handles.
 * @param values - the authorities the page sent.
 * @throws {LanError} `unavailable`, `busy`, or `write-failed`.
 */
async function writeTrustedHosts(deps, values) {
  const editor = deps.configEditor
  if (editor === undefined) {
    throw new LanError('unavailable', 'this deployment cannot change the trust list: the profile config editor is not mounted')
  }
  const entry = editor.entries().find((row) => row.options.id === ROW_ID)
  if (entry === undefined) {
    throw new LanError('unavailable', `no addressable profile row named "${ROW_ID}"`)
  }
  const normalized = values.map(normalizeAuthority).filter((value) => value !== undefined)
  try {
    // `current` is this row's existing override, `inherited` the layer beneath it.
    // Basing the new config on `inherited` — as this did at first — silently threw
    // away every value already saved on this row: saving the trusted hosts reset the
    // access mode to its default, which reads as the page switching itself back to
    // "this machine only".
    await editor.edit(entry, (current, inherited) => ({ ...inherited, ...current, trustedHosts: normalized }))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/cannot be nested/i.test(message)) {
      throw new LanError('busy', 'another configuration edit is still in flight (a hand-edited cordis.patch.yml can leave one open), so nothing changed: restart dsh web and try again')
    }
    throw new LanError('write-failed', message)
  }
}

/**
 * The viewport keys this plugin adds to the served document.
 *
 * `viewport-fit=cover` is what makes any `env(safe-area-inset-*)` in MOBILE_CSS
 * non-zero: without it the browser reserves the notch and the home indicator
 * outside the layout, every inset rule resolves to zero, and the composer sits
 * on the indicator instead of above it. `interactive-widget=resizes-content` asks
 * Chrome/Android to shrink the layout viewport for the on-screen keyboard rather
 * than overlay it, so the composer stays visible; browsers that do not know the
 * key ignore it, which is why it can ride along unconditionally.
 */
const MOBILE_VIEWPORT_KEYS = 'viewport-fit=cover, interactive-widget=resizes-content'

/**
 * The viewport meta the shipped shell serves (`dsh-web-frontend/dist/index.html`).
 * `name` is matched wherever it sits in the tag, so a reordered or reformatted
 * document is still edited in place instead of gaining a second meta.
 */
const VIEWPORT_TAG = /<meta\b[^>]*\bname=["']viewport["'][^>]*>/i
/** The `content` attribute inside that tag. */
const VIEWPORT_CONTENT = /content=["']([^"']*)["']/i
/** The keys this plugin owns, so a second pass replaces instead of appending. */
const VIEWPORT_OWNED = /^(?:viewport-fit|interactive-widget)=/i
/** The opening head tag, the insertion point when a document has no viewport meta. */
const HEAD_TAG = /<head(?:\s[^>]*)?>/i

/**
 * Rewrite the served document's viewport meta to carry the mobile keys.
 *
 * This rides `webServer.tapIndex`, which `renderIndex` applies after the
 * structured rows, so the phone receives it inside the same document that
 * carries MOBILE_CSS. The existing meta is edited rather than joined by a second
 * one: two viewport metas would leave the winner to the browser. The transform is
 * idempotent, so a document that already carries the keys comes back unchanged,
 * and a document without a viewport meta gets the shipped base keys plus ours.
 *
 * @param html - the served index.html body.
 * @returns the body with exactly one viewport meta carrying the mobile keys.
 */
function withMobileViewport(html) {
  const meta = VIEWPORT_TAG.exec(html)
  if (meta === null) {
    return html.replace(HEAD_TAG, (open) => `${open}\n    <meta name="viewport" content="width=device-width, initial-scale=1, ${MOBILE_VIEWPORT_KEYS}" />`)
  }
  const tag = meta[0]
  const content = VIEWPORT_CONTENT.exec(tag)
  const base = (content === null ? 'width=device-width, initial-scale=1' : content[1])
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '' && !VIEWPORT_OWNED.test(part))
    .join(', ')
  const next = base === '' ? MOBILE_VIEWPORT_KEYS : `${base}, ${MOBILE_VIEWPORT_KEYS}`
  const rewritten = content === null
    ? tag.replace(/\s*\/?>$/, (close) => ` content="${next}"${close}`)
    : tag.replace(VIEWPORT_CONTENT, `content="${next}"`)
  return html.slice(0, meta.index) + rewritten + html.slice(meta.index + tag.length)
}

/**
 * Cache tag for the links this plugin hands out. It changes whenever anything the
 * document carries changes — the stylesheet AND the viewport rewrite — and it only
 * ever affects the cache key: the token exchange ignores extra query parameters.
 * Without it a phone can keep serving a cached document and never see the new
 * layout, or see the layout on top of a document whose meta still lacks
 * `viewport-fit=cover` (where every safe-area rule is inert).
 */
const UI_TAG = createHash('sha256').update(MOBILE_CSS).update(MOBILE_VIEWPORT_KEYS).digest('hex').slice(0, 8)

/**
 * Opt-in diagnostics, completely silent without `#mobile-debug` in the URL. With
 * it the page reports each frame column's measured width, the resolved safe-area
 * insets and whether the document's viewport meta carries `viewport-fit`, which
 * turns a phone screenshot into something actionable without developer tools.
 */
const MOBILE_DEBUG_SCRIPT = `(function(){
  if (!location.hash.includes('mobile-debug')) return;
  var query = window.matchMedia('(max-width: 820px)');
  var coarse = window.matchMedia('(pointer: coarse)');
  var bar = document.createElement('div');
  bar.setAttribute('data-dsh-no-token-mobile-debug', '');
  bar.style.cssText = 'position:fixed;left:0;right:0;bottom:env(safe-area-inset-bottom,0px);z-index:2147483647;margin:0;padding:6px 8px;font:11px/1.5 ui-monospace,SFMono-Regular,monospace;background:#000;color:#0f0;white-space:pre-wrap;pointer-events:none';
  /* The probe reports what the document actually resolved: every inset is 0px
     until the viewport meta carries viewport-fit=cover. */
  var probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
  var insets = function(){
    if (!probe.isConnected) document.body.appendChild(probe);
    var resolved = getComputedStyle(probe);
    return [resolved.paddingTop, resolved.paddingRight, resolved.paddingBottom, resolved.paddingLeft].join('/');
  };
  var cover = function(){
    var meta = document.querySelector('meta[name="viewport"]');
    return meta !== null && (meta.getAttribute('content') || '').indexOf('viewport-fit=cover') !== -1;
  };
  var draw = function(){
    var parts = ['_frame', '_sidebarCol', '_centerCol', '_rightbarCol'].map(function(suffix){
      var node = document.querySelector('[class$="' + suffix + '"], [class*="' + suffix + ' "]');
      return suffix.replace(/_/g, '') + '=' + (node === null ? '-' : Math.round(node.getBoundingClientRect().width));
    });
    bar.textContent = 'w=' + window.innerWidth + ' dpr=' + window.devicePixelRatio + ' narrow=' + query.matches + ' coarse=' + coarse.matches + ' fit=' + cover() + ' insets=' + insets() + ' | ' + parts.join(' ');
  };
  var mount = function(){
    document.body.appendChild(bar);
    draw();
    new ResizeObserver(draw).observe(document.documentElement);
    window.addEventListener('resize', draw);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})()`

//#endregion

//#region LAN access

/** The profile row whose config owns the bind. */
const WEBSERVER_ENTRY = 'webserver'
/** This bundle's own row, whose config carries the mode and the trusted hosts. */
const ROW_ID = 'no-token'
/** The webserver schema's two bind literals (`z.union([z.const(…), z.const(…)])`). */
const BIND_LOOPBACK = '127.0.0.1'
const BIND_ALL = '0.0.0.0'
/** Exact Fetch route the settings page reads and writes. */
const LAN_PATH = '/api/no-token/lan'
/**
 * The ordinary web-server route that carries the password form.
 *
 * It must sit outside `/api`: the connection carrier admits that prefix only
 * after authentication, which is exactly what a visitor does not have yet. This
 * route therefore owns its own gate, and its success path is the shipped token
 * exchange — no cookie format is reimplemented here.
 */
const LOGIN_PATH = '/no-token/login'
/**
 * Credential reference holding the LAN password. A reference (not a stored
 * record) so the value can also come from the process environment or a `.env`
 * file, and so `credentials.set`/`unset` manage it without any config file
 * carrying the secret.
 */
const LAN_PASSWORD_REF = 'DSH_LAN_PASSWORD'
/** Failed attempts per authority before the form refuses for a while. */
const LOGIN_ATTEMPT_LIMIT = 8
/** How long a locked-out authority stays locked, in milliseconds. */
const LOGIN_LOCKOUT_MS = 10 * 60 * 1000

/**
 * One LAN control failure, carrying the code the settings page shows.
 */
class LanError extends Error {
  /**
   * @param code - `unavailable`, `overridden`, `busy`, `mismatch`, `write-failed`, `bad-request`.
   * @param message - operator-facing text, shown verbatim.
   */
  constructor(code, message) {
    super(message)
    this.name = 'LanError'
    this.code = code
  }
}

/**
 * Every non-internal IPv4 address, the same filter `dsh-web-app`'s
 * `resolveLanTrust` applies when it derives the fence authorities from a
 * wildcard bind. Read live so a NIC change shows up without a reload.
 * @returns sorted, de-duplicated dotted-quad addresses.
 */
function lanAddresses() {
  const found = new Set()
  for (const list of Object.values(networkInterfaces())) {
    for (const iface of list ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) found.add(iface.address)
    }
  }
  return [...found].sort()
}

/**
 * Wait for the reload a config write triggers to re-provide the web server.
 *
 * The write reloads the edited row, and during that window `deps.webServer` is
 * briefly absent; {@link readLanState} would then fall back to the loopback literal
 * and the page would report "this machine only" right after a save that changed
 * nothing of the sort.
 * @param deps - live service handles.
 */
async function settleAfterWrite(deps) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (deps.webServer !== undefined) return
    await new Promise((resolve) => {
      setTimeout(resolve, 100)
    })
  }
}

/**
 * Compose the state the settings page renders.
 * @param deps - live service handles (`webServer`, `webRuntime`, `connection`, `configEditor`).
 * @param mode - the mode currently in force.
 * @returns the LAN state payload.
 */
function readLanState(deps, mode) {
  const bind = deps.webServer?.host ?? BIND_LOOPBACK
  const port = deps.webServer?.port
  const trusted = deps.webRuntime?.trustedHosts ?? []
  const addresses = lanAddresses().map((address) => {
    const authority = port === undefined ? address : `${address}:${String(port)}`
    const url = `http://${authority}/`
    let loginUrl = url
    try {
      if (typeof deps.connection?.authenticatedUrl === 'function') loginUrl = deps.connection.authenticatedUrl(url)
    } catch {
      /* the clean URL is still useful when the token cannot be resolved */
    }
    // A cache tag, so a phone that would otherwise keep a cached document gets the
    // document this build was tested against. The token exchange ignores extra
    // query parameters, so the link stays a working sign-in link.
    try {
      const tagged = new URL(loginUrl)
      tagged.searchParams.set('v', UI_TAG)
      loginUrl = tagged.href
    } catch {
      /* an unparseable link is left exactly as the token exchange produced it */
    }
    const trustedAddress = trusted.includes(address)
    return { address, authority, url, loginUrl, trusted: trustedAddress, usable: bind === BIND_ALL && trustedAddress }
  })
  const notes = []
  if (addresses.length === 0) notes.push('no-lan-address')
  if (deps.configEditor === undefined) notes.push('no-editor')
  if (bind === BIND_ALL && addresses.some((entry) => !entry.trusted)) notes.push('fence-stale')
  return {
    bind,
    port,
    mode,
    tokenRequired: mode !== ALL,
    enabled: bind === BIND_ALL,
    addresses,
    notes,
  }
}

/**
 * Switch the bind by writing the webserver row's config into the profile patch.
 *
 * Enable restates the inherited config with `host: 0.0.0.0`; disable restates it
 * unchanged, which makes `configEditor.edit` drop this row's profile override
 * and return the row to `!!js ctx.webStartup.host ?? '127.0.0.1'`. Restating the
 * inherited layer (rather than the resolved config) is what keeps `port` and
 * `compression` as expressions.
 * @param deps - live service handles.
 * @param enabled - target state.
 * @param mode - the mode in force, for the returned state.
 * @returns the state after the write.
 * @throws {LanError} `unavailable`, `overridden`, `mismatch`, or `write-failed`.
 */
async function setLan(deps, enabled, mode) {
  const editor = deps.configEditor
  if (editor === undefined) {
    throw new LanError('unavailable', 'this deployment cannot change the bind: the profile config editor is not mounted')
  }
  if (deps.webServer === undefined) {
    throw new LanError('unavailable', 'the web server service is not available')
  }
  const entry = editor.entries().find((row) => row.options.id === WEBSERVER_ENTRY)
  if (entry === undefined) {
    throw new LanError('unavailable', `no addressable profile row named "${WEBSERVER_ENTRY}"`)
  }
  try {
    // `current` is the row's existing override; `inherited` is the layer beneath it.
    // Deriving the new config from `inherited` alone would drop every other override
    // the operator saved on this row (a custom port, a compression setting), so the
    // existing override is spread back in and only `host` is touched. Disabling
    // removes the host override rather than pinning the literal, which leaves the
    // schema default in charge again.
    await editor.edit(entry, (current, inherited) => {
      const next = { ...inherited, ...current }
      if (enabled) return { ...next, host: BIND_ALL }
      delete next.host
      return next
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // A profile patch edited by hand while the process runs can leave an HMR
    // transaction open; the editor then refuses every later write with a message
    // that names no remedy. Handing the user the one action that works — and
    // telling them the state did not change — is the whole point of this branch.
    if (/cannot be nested/i.test(message)) {
      throw new LanError(
        'busy',
        'another configuration edit is still in flight (a hand-edited cordis.patch.yml can leave one open), so nothing changed: restart dsh web and try again',
      )
    }
    const code = /overridden by a home patch or command-line overlay/.test(message) ? 'overridden' : 'write-failed'
    throw new LanError(code, message)
  }
  // The webserver row reloads through the Loader; wait briefly for the rebind.
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const bind = deps.webServer?.host
    if (enabled ? bind === BIND_ALL : bind !== BIND_ALL) break
    await new Promise((resolve) => {
      setTimeout(resolve, 100)
    })
  }
  const next = readLanState(deps, mode)
  if (next.enabled !== enabled) {
    throw new LanError(
      'mismatch',
      `the bind is still ${next.bind}: the command line or a home patch decides it, so the profile write cannot take effect`,
    )
  }
  return next
}

/**
 * Answer one LAN control request.
 * @param request - the Fetch request the connection carrier admitted.
 * @param deps - live service handles.
 * @param currentMode - reads the mode in force at call time.
 * @param currentTrusted - reads the trusted-host list in force at call time.
 * @returns the JSON response.
 */
async function handleLanRequest(request, deps, currentMode, currentTrusted) {
  const json = (status, payload) => new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
  /** One control failure, with the status its code deserves. */
  const failure = (error) => {
    const code = error instanceof LanError ? error.code : 'write-failed'
    const status = code === 'unavailable' ? 503 : code === 'write-failed' ? 500 : 409
    return json(status, { ok: false, code, error: error instanceof Error ? error.message : String(error) })
  }
  /** The state plus what the page may say about the password, never the value. */
  const state = async () => {
    const current = readLanState(deps, currentMode())
    current.password = await passwordState(deps)
    current.trustedHosts = currentTrusted()
    return current
  }
  if (request.method === 'GET') return json(200, { ok: true, state: await state() })
  let body
  try {
    body = await request.json()
  } catch {
    return json(400, { ok: false, code: 'bad-request', error: 'the request body must be JSON' })
  }
  // A tunnel or reverse proxy presents a hostname the shipped fence refuses, which
  // kills the API bridge and the event stream while the page itself still loads.
  if (Array.isArray(body?.trustedHosts)) {
    try {
      await writeTrustedHosts(deps, body.trustedHosts)
      await settleAfterWrite(deps)
      return json(200, { ok: true, state: await state() })
    } catch (error) {
      return failure(error)
    }
  }
  const wantsPassword = typeof body?.password === 'string' || body?.password === null
  if (wantsPassword) {
    try {
      await writePassword(deps, body.password)
      return json(200, { ok: true, state: await state() })
    } catch (error) {
      const code = error instanceof LanError ? error.code : 'write-failed'
      const status = code === 'unavailable' ? 503 : code === 'write-failed' ? 500 : 409
      return json(status, { ok: false, code, error: error instanceof Error ? error.message : String(error) })
    }
  }
  if (typeof body?.enabled !== 'boolean') {
    return json(400, { ok: false, code: 'bad-request', error: 'the body must be { "enabled": boolean } or { "password": string | null }' })
  }
  try {
    const next = await setLan(deps, body.enabled, currentMode())
    next.password = await passwordState(deps)
    return json(200, { ok: true, state: next })
  } catch (error) {
    const code = error instanceof LanError ? error.code : 'write-failed'
    const status = code === 'unavailable' ? 503 : code === 'write-failed' ? 500 : 409
    return json(status, { ok: false, code, error: error instanceof Error ? error.message : String(error) })
  }
}

//#endregion

//#region LAN password

/**
 * Escape a value for an HTML text or attribute position. The authority comes
 * from a request header, so it is attacker-controlled and must never be
 * interpolated raw.
 * @param value - the value to escape.
 * @returns the escaped text.
 */
function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * Compare two secrets in constant time, over digests so the comparison never
 * depends on the candidate's length.
 * @param submitted - what the form sent.
 * @param expected - what the credential store holds.
 * @returns true when they are equal.
 */
function secretMatches(submitted, expected) {
  const left = createHash('sha256').update(submitted, 'utf8').digest()
  const right = createHash('sha256').update(expected, 'utf8').digest()
  return timingSafeEqual(left, right)
}

/**
 * Describe the configured password without exposing it.
 * @param deps - live service handles.
 * @returns `{ ref, set, writable }`, or undefined when no credential store is mounted.
 */
async function passwordState(deps) {
  if (deps.credentials === undefined) return undefined
  try {
    const info = await deps.credentials.describe(LAN_PASSWORD_REF)
    return { ref: LAN_PASSWORD_REF, set: info.configured, writable: info.writable }
  } catch {
    return undefined
  }
}

/**
 * The configured password value.
 * @param deps - live service handles.
 * @returns the value, or undefined while unconfigured or unresolvable.
 */
async function passwordValue(deps) {
  if (deps.credentials === undefined) return undefined
  try {
    const resolved = await deps.credentials.resolve(LAN_PASSWORD_REF)
    return resolved === undefined ? undefined : resolved.value
  } catch {
    return undefined
  }
}

/**
 * Store or clear the password.
 * @param deps - live service handles.
 * @param value - the new password, or null/'' to clear it.
 */
async function writePassword(deps, value) {
  const credentials = deps.credentials
  if (credentials === undefined) {
    throw new LanError('unavailable', 'this deployment has no credential store, so a password cannot be kept')
  }
  try {
    if (value === null || value === '') await credentials.unset(LAN_PASSWORD_REF)
    else await credentials.set(LAN_PASSWORD_REF, value)
  } catch (error) {
    throw new LanError('write-failed', error instanceof Error ? error.message : String(error))
  }
}

/**
 * The phone-facing sign-in page: one field, one button, no assets.
 * @param authority - the Host the visitor used.
 * @param message - an optional line above the field.
 * @returns the HTML document.
 */
function loginPage(authority, message) {
  const note = message === undefined ? '' : `<p class="warn">${escapeHtml(message)}</p>`
  return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>dsh web 登录</title>
<style>
  :root { color-scheme: dark light }
  body { margin:0; min-height:100dvh; display:flex; align-items:center; justify-content:center; padding:16px;
         background:#0f0f10; color:#e8eaed; font:15px/1.5 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif }
  form { width:min(92vw,360px); display:flex; flex-direction:column; gap:12px; padding:22px;
         border-radius:14px; background:#1c1c1e; border:.5px solid #2f2f31 }
  h1 { margin:0; font-size:16px; font-weight:600 }
  p { margin:0; font-size:13px; color:#9aa0a6; word-break:break-all }
  .warn { color:#f87171 }
  input,button { font-size:16px; padding:12px 14px; border-radius:10px; border:1px solid #3a3a3c; background:#2c2c2e; color:#e8eaed }
  button { border-color:#3b82f6; background:#3b82f6; color:#fff; font-weight:600 }
</style></head>
<body>
<form method="post" action="${LOGIN_PATH}">
  <h1>DeepSeek Harness</h1>
  <p>输入密码即可在这台设备上打开，30 天内无需再输。</p>
  ${note}
  <input name="password" type="password" autocomplete="current-password" placeholder="密码" autofocus required>
  <button type="submit">打开</button>
  <p>${escapeHtml(authority)}</p>
</form>
</body></html>`
}

/**
 * Read a bounded form body.
 * @param request - the node request stream.
 * @param limit - maximum accepted bytes.
 * @returns the body text, or undefined when it exceeds the limit.
 */
async function readBody(request, limit = 4096) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > limit) return undefined
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Failed attempts per authority, so a LAN password cannot simply be ground down. */
const loginAttempts = new Map()
/**
 * How many authorities are tracked at once. The key is the `Host` header, which a
 * visitor chooses, so an unbounded map would be a memory leak with a trivially
 * cheap trigger; the oldest entry is dropped past this size.
 */
const LOGIN_ATTEMPT_TRACKED = 64

/**
 * Record one failed attempt, keeping the map bounded and moving the authority to
 * the youngest position so a burst against one Host cannot evict the others.
 * @param authority - the `Host` the attempt arrived on.
 * @param count - failures since the last success.
 * @param lockedUntil - the release timestamp, or 0 while unlocked.
 */
function trackLoginFailure(authority, count, lockedUntil) {
  loginAttempts.delete(authority)
  loginAttempts.set(authority, { count, lockedUntil })
  while (loginAttempts.size > LOGIN_ATTEMPT_TRACKED) {
    const oldest = loginAttempts.keys().next().value
    if (oldest === undefined) break
    loginAttempts.delete(oldest)
  }
}


/**
 * Serve the password form, and turn a correct password into the shipped token
 * exchange: the redirect target is the tokenized URL, so Connection itself mints
 * the browser cookie. No cookie format is reimplemented here.
 * @param request - the node request.
 * @param response - the node response.
 * @param deps - live service handles.
 * @returns true once the response is owned.
 */
async function handleLoginRequest(request, response, deps) {
  const authority = request.headers.host ?? ''
  const send = (status, body, headers = {}) => {
    response.writeHead(status, {
      'cache-control': 'no-store',
      'content-type': 'text/html; charset=utf-8',
      'referrer-policy': 'no-referrer',
      ...headers,
    })
    response.end(request.method === 'HEAD' ? undefined : body)
    return true
  }
  const configured = await passwordValue(deps)
  const missing = '还没有设置密码：请在电脑上的「设置 → 局域网访问」里设置一个，或改用带 token 的链接。'
  if (request.method === 'GET' || request.method === 'HEAD') {
    return send(200, loginPage(authority, configured === undefined ? missing : undefined))
  }
  if (request.method !== 'POST') return send(405, loginPage(authority, '只支持 GET 与 POST。'))

  const record = loginAttempts.get(authority)
  const now = Date.now()
  if (record !== undefined && record.lockedUntil > now) {
    const seconds = Math.ceil((record.lockedUntil - now) / 1000)
    return send(429, loginPage(authority, `尝试次数过多，请 ${String(seconds)} 秒后再试。`))
  }

  const body = await readBody(request)
  if (body === undefined) return send(413, loginPage(authority, '提交内容过大。'))
  if (configured === undefined) return send(409, loginPage(authority, missing))

  const submitted = new URLSearchParams(body).get('password') ?? ''
  if (submitted.length === 0 || !secretMatches(submitted, configured)) {
    const count = (record === undefined ? 0 : record.count) + 1
    const locked = count >= LOGIN_ATTEMPT_LIMIT
    trackLoginFailure(authority, locked ? 0 : count, locked ? now + LOGIN_LOCKOUT_MS : 0)
    await new Promise((resolve) => {
      setTimeout(resolve, 300)
    })
    return send(401, loginPage(authority, locked ? '尝试次数过多，请稍后再试。' : '密码不对，请再试一次。'))
  }

  loginAttempts.delete(authority)
  const target = typeof deps.connection?.authenticatedUrl === 'function'
    ? deps.connection.authenticatedUrl(`http://${authority}/`)
    : '/'
  response.writeHead(303, { 'cache-control': 'no-store', location: target, 'referrer-policy': 'no-referrer' })
  response.end()
  return true
}

//#endregion

/**
 * Mount the plugin: read the mode, follow live Config edits, and wrap the
 * transport's `connection` decisions.
 * @param ctx - the plugin's Cordis context.
 * @param config - the row's resolved Config (`{ mode }`).
 */
export function apply(ctx, config) {
  const say = (message, level = 'info') => {
    try {
      ctx.logger?.[level]?.(`[no-token] ${message}`)
    } catch {
      /* the logger is best-effort; the console line below always lands */
    }
    console.log(`[no-token] ${message}`)
  }

  /** The one holder every wrapper reads, so a live edit needs no re-apply. */
  const state = { mode: readMode(config, (message) => say(message, 'warn')) }

  /**
   * Live service handles. Each is refreshed through the injection seam, so the
   * rebind a LAN toggle triggers — which re-provides `webServer` and cascades
   * through `webRuntime` and `connection` — leaves the route reading current
   * values instead of stale ones.
   */
  const deps = { webServer: undefined, webRuntime: undefined, connection: undefined, configEditor: undefined, credentials: undefined }
  ctx.inject(['webServer'], (serverCtx) => {
    deps.webServer = serverCtx.webServer
    serverCtx.effect(() => () => {
      if (deps.webServer === serverCtx.webServer) deps.webServer = undefined
    }, 'no-token: bind handle')
    // The password form is an ordinary web-server route: `/api` is admitted only
    // after authentication, which is exactly what a visitor does not have yet.
    serverCtx.effect(() => serverCtx.webServer.register({
      kind: 'exact',
      path: LOGIN_PATH,
      handler: (request, response) => handleLoginRequest(request, response, deps),
    }), 'no-token: password form route')
    // The viewport meta is markup no IndexInjection row replaces in place, so it
    // rides the raw tap table: `renderIndex` applies taps after the rows, on every
    // index response, which is the document a phone receives.
    serverCtx.effect(() => {
      const server = serverCtx.webServer
      if (typeof server.tapIndex !== 'function') {
        say('this webServer has no tapIndex, so the mobile viewport meta is not applied', 'warn')
        return undefined
      }
      return server.tapIndex(withMobileViewport)
    }, 'no-token: mobile viewport meta')
  })
  ctx.inject(['credentials'], (credentialsCtx) => {
    deps.credentials = credentialsCtx.credentials
    credentialsCtx.effect(() => () => {
      if (deps.credentials === credentialsCtx.credentials) deps.credentials = undefined
    }, 'no-token: credential handle')
  })
  ctx.inject(['webRuntime'], (runtimeCtx) => {
    deps.webRuntime = runtimeCtx.webRuntime
    runtimeCtx.effect(() => () => {
      if (deps.webRuntime === runtimeCtx.webRuntime) deps.webRuntime = undefined
    }, 'no-token: trust handle')
  })
  ctx.inject(['configEditor'], (editorCtx) => {
    deps.configEditor = editorCtx.configEditor
    editorCtx.effect(() => () => {
      if (deps.configEditor === editorCtx.configEditor) deps.configEditor = undefined
    }, 'no-token: config editor handle')
  })

  // The mobile stylesheet rides the index injection table rather than a client
  // slot: the document is what a phone loads first, and a head row is in the first
  // paint even when a cached document kept an older client module.
  ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'style', text: MOBILE_CSS })
    table.push({ kind: 'script', placement: 'head', text: MOBILE_DEBUG_SCRIPT })
  })

  // A volatile field is committed in place: `apply` is not re-run, so read the
  // accepted value here rather than capturing it once.
  ctx.on('loader/volatile-update', () => {
    const next = readMode(config, (message) => say(message, 'warn'))
    if (next === state.mode) return
    state.mode = next
    say(describeMode(next))
  })

  // This bundle ships the page that edits its own row, so it does not also want
  // a schema-generated page. The policy never affects reads or writes.
  const self = ctx.fiber
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.effect(() => {
      try {
        return settingsCtx.settings.configure({ auto: false }, self)
      } catch (error) {
        say(`could not register the settings page policy: ${error.message}`, 'warn')
        return undefined
      }
    }, 'no-token: settings page policy')
  })

  // `connection` is provided by another row, and is re-provided on reload, so
  // resolve it through the injection seam instead of reading it once.
  ctx.inject(['connection'], (connectionCtx) => {
    const connection = connectionCtx.connection
    if (connection === undefined || connection === null) return
    deps.connection = connection
    connectionCtx.effect(() => () => {
      if (deps.connection === connection) deps.connection = undefined
    }, 'no-token: connection handle')

    // The LAN control route rides the same `/api` admission as every other
    // route, so it opens no bypass of its own. The disposer became asynchronous in
    // 0.2.0, so the effect returns one that awaits it. A failure here must never
    // take the connection service down with it — the Desktop app's whole boot rides
    // on this service — so it is contained and reported.
    connectionCtx.effect(() => {
      try {
        const remove = connection.fetch.register({
          path: LAN_PATH,
          methods: ['GET', 'POST'],
          requestBody: 'buffered',
          fetch: (request) => handleLanRequest(request, deps, () => state.mode, () => readTrustedHosts(config)),
        })
        return () => {
          void Promise.resolve(typeof remove === 'function' ? remove() : undefined).catch(() => {})
        }
      } catch (error) {
        say(`could not register the LAN control route: ${error instanceof Error ? error.message : String(error)}`, 'error')
        return undefined
      }
    }, 'no-token: LAN control route')

    try {
      if (patchConnection(connection, state, config)) {
        connectionCtx.effect(() => () => {
          connection[PATCH]?.restore?.()
        }, 'no-token: connection gate patch')
        say(describeMode(state.mode))
      } else {
        say(`connection service was already patched; mode holder refreshed to "${state.mode}"`)
      }
    } catch (error) {
      say(`could not patch the connection service, the token gate stays as shipped: ${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  })
}
