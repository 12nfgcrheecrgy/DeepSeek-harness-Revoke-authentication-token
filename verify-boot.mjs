/**
 * Live check that the running server has registered this bundle's browser half.
 *
 * The client module table is scanned out of the Loader tree once per process
 * ("scanning is incremental per package — there is no full-rescan code path"),
 * and the served chunk URL is matched exactly, revision included, so a bare
 * /plugins/dsh-no-token/client.js is never a valid URL. This script therefore
 * reads the boot manifest embedded in index.html and follows the URL the
 * manifest advertises for `dsh-no-token`.
 *
 * A process started before this bundle declared `dsh.client` has no such entry;
 * that is the state this script reports as "restart dsh web".
 *
 * Run: node verify-boot.mjs
 */
const base = `http://127.0.0.1:${String(process.env.DSH_WEB_PORT ?? 3080)}`
const results = []

function check(name, ok, detail = '') {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`)
}

/**
 * Read the inline `globalThis["__DSH_BOOT__"] = {…}` object out of index.html by
 * brace depth, so a `}` inside a string cannot end the slice early.
 * @param html - the served index document.
 * @returns the parsed manifest, or undefined when it cannot be read.
 */
function readBootManifest(html) {
  const marker = html.indexOf('__DSH_BOOT__')
  if (marker === -1) return undefined
  const start = html.indexOf('{', marker)
  if (start === -1) return undefined
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < html.length; index += 1) {
    const character = html[index]
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') inString = true
    else if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, index + 1))
        } catch {
          return undefined
        }
      }
    }
  }
  return undefined
}

const html = await (await fetch(`${base}/`)).text()
const boot = readBootManifest(html)
check('the boot manifest is readable', boot !== undefined, boot === undefined ? 'no __DSH_BOOT__ JSON found' : `${boot.entries?.length ?? 0} roster entries, rev ${boot.rev}`)

const roster = boot?.entries ?? []
const entry = roster.find((row) => row.id === 'dsh-no-token')
check('the roster carries this package', entry !== undefined, entry === undefined ? `none of ${roster.length} entries is dsh-no-token` : `rev ${entry.rev}`)

// The narrow-viewport layer must be in the document itself, not in the browser
// half: a phone can hold a cached document that points at an older module, and a
// style mounted by that module would then never arrive. This check therefore reads
// the served HTML head.
const injected = html.includes('_rightbarCol') && html.includes('max-width: 820px')
check(
  'the served document carries the injected mobile stylesheet',
  injected,
  injected ? 'found the narrow-viewport rows in the head' : 'not in this process: restart `dsh web` to load the index injection',
)
const diagnostics = html.includes('mobile-debug')
check('the served document carries the opt-in diagnostics', diagnostics, diagnostics ? 'active only with #mobile-debug' : 'restart `dsh web`')

// `env(safe-area-inset-*)` is 0 for the whole document until the served viewport
// meta carries viewport-fit=cover, so the stylesheet is inert without the tapIndex
// rewrite — and two viewport metas would leave the effective one to the browser.
// Both halves are asserted here because this is the document a phone really gets.
const viewportMetas = html.match(/<meta\b[^>]*\bname=["']viewport["'][^>]*>/gi) ?? []
const viewport = viewportMetas[0] ?? ''
check('the served document carries exactly one viewport meta', viewportMetas.length === 1, `${viewportMetas.length} found`)
check(
  'the served viewport meta is edge-to-edge',
  viewport.includes('viewport-fit=cover'),
  viewport.includes('viewport-fit=cover') ? 'env(safe-area-inset-*) resolves against it' : `as served: ${viewport || 'none'}`,
)
check(
  'the served viewport meta asks Android to resize for the keyboard',
  viewport.includes('interactive-widget=resizes-content'),
  viewport.includes('interactive-widget=resizes-content') ? 'the composer stays above the keyboard' : `as served: ${viewport || 'none'}`,
)
const safeArea = html.includes('safe-area-inset-top') && html.includes('env(safe-area-inset-bottom)')
check('the served stylesheet carries the safe-area rules', safeArea, safeArea ? 'the frame, the drawer and the composer all pad off the insets' : 'restart `dsh web`')

if (entry !== undefined) {
  // Only the locale package is a hard module dependency. `configForms` comes from the
  // plugin manager, and a profile need not load it: a hard dependency there would
  // keep the whole page — and the stylesheet — inactive without a word, so it is
  // resolved at runtime instead and asserted absent from this list.
  check('dsh.client.inject lists @deepseek-ai/dsh-client-locale', (entry.inject ?? []).includes('@deepseek-ai/dsh-client-locale'))
  for (const optional of ['@deepseek-ai/dsh-client-ui-settings', '@deepseek-ai/dsh-client-ui-plugin-manager']) {
    check(`dsh.client.inject leaves ${optional} optional`, !(entry.inject ?? []).includes(optional))
  }
  const url = new URL(entry.url, `${base}/`)
  const response = await fetch(url)
  const body = await response.text()
  check('the advertised URL serves the browser half', response.status === 200, `${url.pathname}${url.search} -> ${response.status}, ${body.length} bytes`)
  check('the factory declares the package name', body.includes('id: "dsh-no-token"') || body.includes("id: 'dsh-no-token'"))
  check('the page claims the independent LAN section', body.includes('settings.section') && body.includes('no-token-lan'))
  for (const dropped of ['plugins.row.config', 'settings.plugins.tab', 'plugins.bundle.config']) {
    check(`the page registers no second seat (${dropped})`, !body.includes(`name: '${dropped}'`) && !body.includes(`name: "${dropped}"`))
  }
  check('the page resolves configForms at runtime', body.includes("ctx.inject(['configForms']"))
  check('the page takes an optional row controller', body.includes('props.controller'))
}

const failed = results.filter((ok) => !ok).length
if (entry === undefined) {
  console.log('\nThis bundle\'s browser half is not in the running process\'s module table: it was')
  console.log('scanned before the package declared `dsh.client`. Restart `dsh web`, reload the page,')
  console.log('and re-run this script.')
}
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exitCode = failed === 0 ? 0 : 1
