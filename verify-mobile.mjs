/**
 * Offline check of the injected narrow-viewport layer.
 *
 * The layer rides the webserver's index injection table — one `<style>` row and
 * one opt-in diagnostics `<script>` row — so a phone receives it inside the
 * document itself, at first paint, even when a cached document kept an older
 * client module. This suite asserts the rows, that every rule is inside the media
 * query (so a desktop window is untouched), that the selectors key off class
 * names the shipped shell really uses, and that the browser half carries no copy.
 *
 * Run: node verify-mobile.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { apply } from './dsh-no-token/index.js'

/** The viewport keys both halves must agree on. */
const VIEWPORT_KEYS = 'viewport-fit=cover, interactive-widget=resizes-content'

/** A connection double: this suite never exercises the gate. */
function makeConnection() {
  return {
    fetch: { register: () => () => {} },
    requestRejection: () => 401,
    authorizeIndex: () => false,
    authenticatedUrl: (baseUrl) => `${baseUrl}?token=SECRET`,
  }
}

function mount(config) {
  const listeners = new Map()
  const restorers = []
  const taps = []
  apply({
    logger: {},
    fiber: { plugin: 'no-token' },
    on(event, listener) {
      const list = listeners.get(event) ?? []
      list.push(listener)
      listeners.set(event, list)
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
      if (services.includes('webServer')) {
        callback({
          ...child,
          webServer: {
            host: '0.0.0.0',
            port: 3080,
            register: () => () => {},
            tapIndex: (transform) => {
              taps.push(transform)
              return () => {}
            },
          },
        })
      }
      if (services.includes('connection')) callback({ ...child, connection: makeConnection() })
      if (services.includes('webRuntime')) callback({ ...child, webRuntime: { trustedHosts: [] } })
      if (services.includes('settings')) callback({ ...child, settings: { configure: () => () => {} } })
    },
  }, config)
  return { listeners, restorers, taps }
}

/** Emit the index injection table exactly as the webserver does. */
function collect(config) {
  const { listeners } = mount(config)
  const handlers = listeners.get('webserver/index-inject') ?? []
  assert.equal(handlers.length, 1, 'the plugin subscribes to the index injection table once')
  const table = []
  handlers[0](table)
  return table
}

// ---- the rows -----------------------------------------------------------------
const table = collect({ mode: 'loopback' })
assert.equal(table.length, 2, 'one stylesheet row and one diagnostics row')

const style = table.find((row) => row.kind === 'style')
const script = table.find((row) => row.kind === 'script')
assert.ok(style !== undefined && typeof style.text === 'string', 'the stylesheet is a style row')
assert.ok(script !== undefined && typeof script.text === 'string', 'the diagnostics are a script row')
assert.equal(script.placement, 'head', 'the script runs before the app mounts')

const css = style.text
assert.ok(css.startsWith('/* dsh-no-token/mobile */'), 'the row opens with the sentinel both copies share')
const body = css.slice('/* dsh-no-token/mobile */'.length)
assert.ok(body.trimStart().startsWith('@media (max-width: 820px)'), 'and the stylesheet itself is the narrow-viewport query')

// Every rule lives in a phone-only context: a desktop window must not match
// anything, in width or in pointer.
{
  let depth = 0
  let prelude = ''
  const blocks = []
  for (const character of css) {
    if (character === '{') {
      if (depth === 0) {
        blocks.push(prelude.replace(/\/\*[\s\S]*?\*\//g, '').trim())
        prelude = ''
      }
      depth += 1
    } else if (character === '}') {
      depth -= 1
      assert.ok(depth >= 0, 'the braces never close early')
      prelude = ''
    } else if (depth === 0) {
      prelude += character
    }
  }
  assert.equal(depth, 0, 'the braces balance')
  assert.deepEqual(
    blocks,
    [
      '@media (max-width: 820px)',
      '@media (pointer: coarse) and (min-width: 821px) and (max-width: 1023.98px)',
    ],
    'every top-level block is phone-only: the phone width query, then the coarse-pointer band between it and the shell\'s own 1024px narrow threshold',
  )
}

// The names are the shell's own — and each is matched in BOTH naming schemes the
// shell has used: `_<name>_<hash>_<line>` in 0.1.7 and `<hash>_<name>` in 0.2.0.
// A selector written for one scheme silently matches nothing in the other, which is
// exactly how this layer went inert on 0.2.0 while every offline suite stayed green.
for (const marker of [
  '_frame',
  '_sidebarCol',
  '_centerCol',
  '_rightbarCol',
  '_viewArea',
  '_scrollBody',
  '_composerSeat',
  '_composerHero',
  '_composerStack',
  '_headline',
  '_iconButton',
  '_dialog',
  'min-width: 0',
  '100dvh',
  'font-size: 16px',
  'touch-action: manipulation',
  'env(safe-area-inset-bottom)',
  'data-sidebar-collapsed',
]) {
  assert.ok(css.includes(marker), `the stylesheet keys off ${marker}`)
}
for (const name of ['viewArea', 'composerSeat', 'headline', 'iconButton']) {
  assert.ok(css.includes(`[class$="_${name}"]`), `${name} matches the 0.2.0 form (hash_name, ends the attribute)`)
  assert.ok(css.includes(`[class*="_${name}_"]`), `${name} matches the 0.1.7 form (name_hash_line)`)
  assert.ok(css.includes(`[class*="_${name} "]`), `${name} matches the 0.2.0 form with a sibling class`)
}

// The two behaviours the phone screenshots demanded, each tied to a fact read out
// of `dsh-client-ui-layout/lib/client.js` (the inline `minmax(400px, 1fr)` floor and
// `clampWidth(sidebar, 264, 420)` for an expanded sidebar) and out of `SidebarRoot`
// (which freezes its content width inline while collapsed).
assert.match(css, /grid-template-columns: 0 minmax\(0, 1fr\) 0 !important/, 'the centre track loses the 400px floor')
assert.match(css, /\[data-sidebar-collapsed\][\s\S]{0,140}grid-template-columns: 56px minmax\(0, 1fr\) 0 !important/, 'the collapsed rail keeps the shell\'s own 56px track')
assert.match(css, /\[class\$="_centerCol"\], [\s\S]{0,40}\[class\*="_centerCol "\] \{ grid-column: 2 !important/, 'the centre is pinned to its own track')
assert.match(css, /\[class\$="_rightbarCol"\], [\s\S]{0,40}\[class\*="_rightbarCol "\] \{ grid-column: 3 !important/, 'so is the right track, which stays zero-width')
assert.match(css, /:not\(\[data-sidebar-collapsed\]\)[\s\S]{0,340}position: absolute !important/, 'an expanded sidebar becomes an overlay')
assert.match(css, /min\(86vw, 320px\)/, 'the drawer is capped to the screen')
assert.match(css, /box-shadow: 0 0 0 100vmax/, 'and dims what it covers')
assert.ok(!css.includes('display: flex !important'), 'the shell grid is kept rather than replaced')

// ---- the safe areas -----------------------------------------------------------
// Every `env(safe-area-inset-*)` here resolves to 0 until the served viewport meta
// carries `viewport-fit=cover`, which the Host adds through its tapIndex transform.
// These rules are what makes the insets real once it does. The frame's padding-top
// deliberately carries NO `!important`: the shell's own
// `[data-windows-titlebar] .frame { padding-top: var(--dsh-windows-titlebar-height) }`
// is more specific and must keep winning on a Windows desktop, which is exactly
// what an important declaration here would break.
assert.match(
  css,
  /\[class\$="_frame"\],\n\s+\[class\*="_frame "\],\n\s+\[class\*="_frame_"\] \{\n\s+box-sizing: border-box;\n\s+padding-top: env\(safe-area-inset-top\);/,
  'the frame clears the notch, stating the box model the shell only states for its Windows titlebar',
)
assert.ok(!/padding-top: env\(safe-area-inset-top\) !important/.test(css), 'and never overrides the shell\'s Windows titlebar padding')
assert.match(css, /env\(safe-area-inset-bottom\)\) !important/, 'the composer clears the bottom inset')
assert.match(css, /env\(safe-area-inset-left\)/, 'and the leading and trailing insets')
const coarse = css.slice(css.indexOf('@media (pointer: coarse)'))
assert.ok(coarse.includes('font-size: 16px !important'), 'the landscape band stops iOS zoom on focus')
assert.ok(coarse.includes('env(safe-area-inset-left)'), 'and carries the landscape insets')
assert.ok(!coarse.includes('grid-template-columns'), 'without restating the three-column template, which belongs to the shell at those widths')

// ---- the diagnostics ----------------------------------------------------------
assert.ok(script.text.includes('mobile-debug'), 'the diagnostics are opt-in through the URL fragment')
assert.ok(script.text.includes("location.hash.includes('mobile-debug')"), 'and stay silent without it')
assert.ok(script.text.includes('matchMedia'), 'they report whether the media query matched')
assert.ok(!script.text.includes('document.write'), 'they never write a document')

// ---- one stylesheet, two delivery paths --------------------------------------
// The Host copy is in the document head at first paint (cache-proof); the browser
// half carries the same text so the layout changes on the next reload without a
// Host restart. A sentinel comment makes the browser half stand down once the
// Host's copy is present, and the two copies must stay byte-identical.
const client = readFileSync(new URL('./dsh-no-token/client.js', import.meta.url), 'utf8')
const hostSource = readFileSync(new URL('./dsh-no-token/index.js', import.meta.url), 'utf8')
const readTemplate = (source, label) => {
  const match = /const MOBILE_CSS = `([\s\S]*?)`\n/.exec(source)
  assert.ok(match !== null, `the ${label} copy is a template literal`)
  return match[1]
}
const hostCss = readTemplate(hostSource, 'host')
const browserCss = readTemplate(client, 'browser')
assert.equal(browserCss, hostCss, 'the browser copy is byte-identical to the injected one')
assert.ok(hostCss.startsWith('/* dsh-no-token/mobile */'), 'both copies open with the shared sentinel')
assert.ok(client.includes("const MOBILE_SENTINEL = 'dsh-no-token/mobile'"), 'the browser half knows the sentinel')
assert.ok(
  client.includes("document.querySelectorAll('style')") && client.includes('MOBILE_SENTINEL'),
  'and stands down when the document already carries a copy',
)
assert.ok(/return needed \? h\('style'/.test(client), 'the fallback renders the stylesheet only when needed')

// The browser half also carries the two things that keep a phone current without a
// Host restart: a revision watcher, and the readout the injected script mirrors.
assert.ok(client.includes('bootedRevision') && client.includes('__DSH_BOOT__'), 'the browser half reads the revision its document booted with')
assert.ok(/setInterval\([\s\S]{0,260}300000\)/.test(client), 'and polls the served document on a slow interval')
assert.ok(client.includes("document.visibilityState !== 'hidden'"), 'only while the page is in the background, so a reload cannot discard a draft')
assert.ok(client.includes('clearInterval(timer)'), 'clearing the timer when the plugin unloads')
assert.ok(client.includes("location.hash.includes('mobile-debug')"), 'the readout is opt-in through the same fragment as the injected one')
assert.ok(client.includes("addEventListener('hashchange'"), 'and appears even when only the fragment changed, which never reloads a document')
assert.ok(client.includes("pointerEvents: 'none'"), 'the readout never swallows a tap')
assert.ok(client.includes('matchMedia'), 'and reports whether the media query matched')

console.log('verify-mobile: the injected narrow-viewport layer is complete and desktop-inert')

// ---- the viewport meta --------------------------------------------------------
// `env(safe-area-inset-*)` is 0 for the whole document until the served viewport
// meta carries `viewport-fit=cover`, so the stylesheet above is inert without this
// rewrite. It rides `webServer.tapIndex`, which `renderIndex` applies after the
// structured rows, on every index response — the document a phone loads.
{
  const { taps } = mount({ mode: 'loopback' })
  assert.equal(taps.length, 1, 'the plugin registers exactly one index tap')
  const rewrite = taps[0]
  assert.equal(typeof rewrite, 'function', 'the tap is a transform, not a row')

  // The shipped meta, exactly as `dsh-web-frontend/dist/index.html` serves it.
  const shipped = '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1" />\n    <meta name="theme-color" content="#000" />\n    <title>DeepSeek Harness</title>\n  </head>\n</html>'
  const once = rewrite(shipped)
  assert.ok(once.includes('viewport-fit=cover'), 'the served viewport meta becomes edge-to-edge')
  assert.ok(once.includes('interactive-widget=resizes-content'), 'and asks Chrome to resize for the keyboard rather than cover the composer')
  assert.ok(once.includes('width=device-width, initial-scale=1'), 'while keeping the keys the shell shipped')
  assert.equal((once.match(/name="viewport"/g) ?? []).length, 1, 'the document still carries exactly one viewport meta')
  assert.ok(once.includes('<meta name="theme-color" content="#000" />'), 'and no neighbouring meta is touched')
  assert.equal(rewrite(once), once, 'the transform is idempotent, so a second pass changes nothing')
  assert.equal((rewrite(once).match(/viewport-fit=cover/g) ?? []).length, 1, 'never appending a duplicate key')
  assert.ok(!once.includes('</script'), 'and it adds no script text')

  // A document that lost its viewport meta still gets one, immediately in the head.
  const bare = rewrite('<!doctype html>\n<html><head><title>t</title></head></html>')
  assert.match(
    bare,
    /<head>\s*<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content" \/>/,
    'a document with no viewport meta gets the shipped base keys plus ours, in the head',
  )
  assert.equal((bare.match(/name="viewport"/g) ?? []).length, 1, 'and still only one of them')
  assert.equal(rewrite(bare), bare, 'that path is idempotent too')

  // Attribute order and single quotes are the browser's business, not ours.
  const odd = rewrite('<head><meta content="width=device-width" name="viewport"></head>')
  assert.ok(odd.includes('content="width=device-width, viewport-fit=cover, interactive-widget=resizes-content"'), 'an existing content is extended in place, whatever the attribute order')
}

// ---- the cache tag ------------------------------------------------------------
// The links the settings page hands out carry a tag derived from the stylesheet AND
// from the viewport rewrite, so a phone that would otherwise reuse a cached document
// fetches a fresh one whenever either changes — including the case the stylesheet
// alone cannot fix: a document whose meta still lacks viewport-fit=cover. The token
// exchange ignores extra query parameters, so the link still signs in.
{
  const viewportKeys = (() => {
    const match = /const MOBILE_VIEWPORT_KEYS = '([^']+)'/.exec(hostSource)
    assert.ok(match !== null, 'the viewport keys are one constant')
    return match[1]
  })()
  assert.ok(viewportKeys.includes('viewport-fit=cover'), 'and that constant is what makes the insets real')
  assert.ok(
    /const UI_TAG = createHash\('sha256'\)\.update\(MOBILE_CSS\)\.update\(MOBILE_VIEWPORT_KEYS\)/.test(hostSource),
    'the link tag covers both the stylesheet and the viewport rewrite',
  )

  const { listeners } = mount({ mode: 'loopback' })
  const injected = (listeners.get('webserver/index-inject') ?? [])[0]
  assert.ok(typeof injected === 'function', 'the subscription is live')
  const rows = []
  injected(rows)
  const text = rows.find((row) => row.kind === 'style').text

  const { createHash } = await import('node:crypto')
  const tag = createHash('sha256').update(text).update(viewportKeys).digest('hex').slice(0, 8)
  assert.match(tag, /^[0-9a-f]{8}$/)
  assert.notEqual(tag, createHash('sha256').update(text).digest('hex').slice(0, 8), 'a viewport change alone moves the tag')

  const url = `http://192.168.1.20:3080/?token=SECRET&v=${tag}`
  assert.equal(new URL(url).searchParams.get('token'), 'SECRET', 'the token survives the added tag')
  assert.equal(new URL(url).searchParams.get('v'), tag, 'and the tag rides along for the cache key')
}

// ---- the viewport meta ---------------------------------------------------------
// `env(safe-area-inset-*)` is zero unless the document asks for `cover`, so the
// safe-area rules in the stylesheet are inert without this rewrite.
{
  const taps = []
  const listeners = new Map()
  apply({
    logger: {},
    fiber: { plugin: 'no-token' },
    on(event, listener) {
      listeners.set(event, listener)
      return () => {}
    },
    inject(services, callback) {
      const child = { effect: (execute) => execute() }
      if (services.includes('connection')) callback({ ...child, connection: makeConnection() })
      if (services.includes('webServer')) {
        callback({
          ...child,
          webServer: {
            host: '127.0.0.1',
            port: 3080,
            register: () => () => {},
            tapIndex: (transform) => {
              taps.push(transform)
              return () => {}
            },
          },
        })
      }
      if (services.includes('settings')) callback({ ...child, settings: { configure: () => () => {} } })
    },
  }, { mode: 'loopback' })
  assert.equal(taps.length, 1, 'the viewport rewrite rides the raw index tap table')
  const tap = taps[0]
  const plain = '<html><head><meta name="viewport" content="width=device-width, initial-scale=1" /><title>x</title></head><body></body></html>'

  const once = tap(plain)
  assert.equal((once.match(/name="viewport"/g) ?? []).length, 1, 'the existing meta is edited, never duplicated')
  assert.ok(once.includes(VIEWPORT_KEYS), 'and it carries the mobile keys')
  assert.ok(once.includes('width=device-width'), 'while the shipped keys survive')
  assert.equal(tap(once), once, 'the rewrite is idempotent')

  const owned = tap(`<head><meta name="viewport" content="${VIEWPORT_KEYS}"></head>`)
  assert.equal((owned.match(/viewport-fit=cover/g) ?? []).length, 1, 'a second pass replaces its own keys instead of appending')

  const bare = tap('<html><head><title>x</title></head></html>')
  assert.ok(bare.includes(VIEWPORT_KEYS), 'a document with no viewport meta gains one')
  assert.ok(bare.indexOf('viewport') > bare.indexOf('<head>'), 'inside the head')

  const noContent = tap('<head><meta name="viewport"></head>')
  assert.ok(/content="[^"]*viewport-fit=cover/.test(noContent), 'a meta without a content attribute gains one')
}

// The browser half must patch the same document for a page that predates the Host
// change, and must agree on the keys byte for byte.
assert.ok(client.includes(`const MOBILE_VIEWPORT_KEYS = '${VIEWPORT_KEYS}'`), 'the browser half carries the identical viewport keys')
assert.ok(client.includes('applyMobileViewport'), 'and applies them to its own document')
assert.ok(/meta\.setAttribute\('content', original\)/.test(client), 'restoring the original when the plugin unloads')

// ---- anti-drift: the live shell must still carry every name in the stylesheet ----
// This is the check whose absence let the layer go inert on 0.2.0: the stylesheet is
// generated against real class names, but the shell can rename them in any release,
// and an offline suite cannot see the shell. It runs only when a server answers, so
// the suite stays usable without one.
{
  const port = Number(process.env.DSH_WEB_PORT ?? 3080)
  const base = `http://127.0.0.1:${String(port)}`
  let shellNames
  try {
    const html = await (await fetch(`${base}/`)).text()
    const marker = html.indexOf('__DSH_BOOT__')
    if (marker === -1) throw new Error('no boot payload in the served document')
    const start = html.indexOf('{', marker)
    let depth = 0
    let manifest
    for (let index = start; index < html.length; index += 1) {
      if (html[index] === '{') depth += 1
      else if (html[index] === '}') {
        depth -= 1
        if (depth === 0) {
          manifest = JSON.parse(html.slice(start, index + 1))
          break
        }
      }
    }
    shellNames = new Set()
    for (const entry of manifest.entries) {
      if (entry.id === 'dsh-no-token') continue
      const response = await fetch(new URL(entry.url, `${base}/`))
      if (response.status !== 200) continue
      const bundle = await response.text()
      for (const match of bundle.matchAll(/\._([A-Za-z][A-Za-z0-9]*)_[a-z0-9]{4,8}_\d+/g)) shellNames.add(match[1])
      for (const match of bundle.matchAll(/\.([A-Za-z0-9][A-Za-z0-9_-]{2,14})_([A-Za-z][A-Za-z0-9]*)\{/g)) shellNames.add(match[2])
    }
  } catch (error) {
    console.log(`verify-mobile: live drift check skipped (${error instanceof Error ? error.message : String(error)})`)
  }
  if (shellNames !== undefined) {
    const wanted = [...new Set([...css.matchAll(/\[class\$="_([A-Za-z][A-Za-z0-9]*)"/g)].map((match) => match[1]))]
    assert.ok(wanted.length >= 10, `the stylesheet names ${String(wanted.length)} classes`)
    const missing = wanted.filter((name) => !shellNames.has(name))
    assert.deepEqual(missing, [], `every name in the stylesheet exists in the running shell (${String(shellNames.size)} names scanned)`)
    console.log(`verify-mobile: live drift check passed against ${base} (${String(wanted.length)} names, ${String(shellNames.size)} shell names)`)
  }
}

console.log('verify-mobile: the injected narrow-viewport layer is complete and desktop-inert')
