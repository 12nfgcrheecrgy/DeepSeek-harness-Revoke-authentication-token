/**
 * Regenerate the mobile stylesheet into both halves, against the running shell.
 *
 * Why this exists: 0.1.7 named CSS-module classes `_<name>_<hash>_<line>` and
 * 0.2.0 names them `<hash>_<name>`. A selector written for one silently matches
 * nothing in the other — the whole mobile layer went inert on 0.2.0 while every
 * offline suite stayed green, because those suites cannot see the shell. This tool
 * reads the real class names out of the served client bundles, keeps only the
 * selectors whose names actually exist, writes the identical template into both
 * `index.js` and `client.js`, and reports what it dropped.
 *
 * Run: node tools/build-mobile-css.mjs [--port 19387] [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const portFlag = args.indexOf('--port')
const PORT = portFlag === -1 ? Number(process.env.DSH_WEB_PORT ?? 19387) : Number(args[portFlag + 1])
const DRY = args.includes('--dry')
const BASE = `http://127.0.0.1:${String(PORT)}`

/** The names the stylesheet wants, each with the rule block it carries. */
const SPEC = [
  {
    names: ['viewArea', 'scrollBody', 'scroll'],
    body: 'min-width: 0 !important;\n    padding-left: 12px !important;\n    padding-right: 12px !important;',
  },
  { names: ['headline'], body: 'font-size: 22px !important;\n    line-height: 1.35 !important;' },
  {
    names: ['composerSeat', 'composerHero', 'composerStack'],
    body: 'padding-left: max(8px, env(safe-area-inset-left)) !important;\n    padding-right: max(8px, env(safe-area-inset-right)) !important;\n    padding-bottom: max(8px, env(safe-area-inset-bottom)) !important;',
  },
  { names: ['editor'], body: 'min-height: 40px;' },
  { names: ['iconButton'], body: 'min-width: 36px !important;\n    min-height: 36px !important;' },
  { names: ['row', 'item'], body: 'min-height: 38px;' },
  { names: ['dialog', 'panelBody'], body: 'max-width: 100% !important;' },
  { names: ['tablePane', 'summaryScrollRegion', 'scrollport'], body: 'overflow-x: auto;' },
]

/**
 * The same names again for the coarse-pointer band between the phone query and the
 * shell's own 1024px narrow threshold — a phone held sideways is 844-932 CSS px, so
 * it is inside the shell's narrow mode while `max-width: 820px` no longer matches.
 * Only device-level rules belong there: at those widths the shell's own narrow
 * layout is right, and restating the three-column template would reshape a 900px
 * desktop window. `pointer: coarse` keeps a mouse-driven window out.
 */
const SPEC_COARSE = [
  { names: ['frame'], body: 'box-sizing: border-box;\n    padding-top: env(safe-area-inset-top);\n    padding-left: env(safe-area-inset-left);\n    padding-right: env(safe-area-inset-right);' },
  { names: ['composerSeat', 'composerHero', 'composerStack'], body: 'padding-left: max(8px, env(safe-area-inset-left)) !important;\n    padding-right: max(8px, env(safe-area-inset-right)) !important;\n    padding-bottom: max(8px, env(safe-area-inset-bottom)) !important;' },
  { names: ['iconButton'], body: 'min-width: 36px !important;\n    min-height: 36px !important;' },
  { names: ['dialog'], body: 'max-height: calc(100dvh - 16px - env(safe-area-inset-top) - env(safe-area-inset-bottom)) !important;' },
]

/**
 * Every class token a selector must match, for one module-scoped name.
 *
 * The token is `<hash>_<name>` in 0.2.0 and `_<name>_<hash>_<line>` in 0.1.7, so
 * the name is followed by the end of the attribute, a space, or an underscore —
 * and `[class$="…"]`/`[class*="… "]` are how CSS spells those boundaries. Exact
 * names only: `_row_` never matches `_rowText`, so the rules stay narrow.
 * @param name - the module-scoped class name.
 * @returns the selector list for that name.
 */
function selectorsFor(name) {
  return [`[class$="_${name}"]`, `[class*="_${name} "]`, `[class*="_${name}_"]`]
}

/** Read the live roster out of the served document. */
async function readRoster() {
  const html = await (await fetch(`${BASE}/`)).text()
  const marker = html.indexOf('__DSH_BOOT__')
  if (marker === -1) throw new Error('no __DSH_BOOT__ in the served document')
  const start = html.indexOf('{', marker)
  let depth = 0
  for (let index = start; index < html.length; index += 1) {
    if (html[index] === '{') depth += 1
    else if (html[index] === '}') {
      depth -= 1
      if (depth === 0) return JSON.parse(html.slice(start, index + 1))
    }
  }
  throw new Error('unterminated boot payload')
}

/**
 * Every class name the shipped shell really uses, in either naming scheme.
 * The plugin's own module is skipped: its fallback stylesheet contains the very
 * strings being looked for, which would make this check prove itself.
 * @param boot - the served boot manifest.
 * @returns the set of class names.
 */
async function collectShellNames(boot) {
  const names = new Set()
  for (const entry of boot.entries) {
    if (entry.id === 'dsh-no-token') continue
    const response = await fetch(new URL(entry.url, `${BASE}/`))
    if (response.status !== 200) {
      console.log(`  note: ${entry.id} answered ${String(response.status)}`)
      continue
    }
    const body = await response.text()
    for (const match of body.matchAll(/\._([A-Za-z][A-Za-z0-9]*)_[a-z0-9]{4,8}_\d+/g)) names.add(match[1])
    for (const match of body.matchAll(/\.([A-Za-z0-9][A-Za-z0-9_-]{2,14})_([A-Za-z][A-Za-z0-9]*)\{/g)) names.add(match[2])
  }
  return names
}

/** Build the stylesheet body plus the list of dropped names. */
function build(shellNames, spec = SPEC) {
  const rules = []
  const dropped = []
  for (const { names, body } of spec) {
    const kept = names.filter((name) => shellNames.has(name))
    for (const name of names) if (!shellNames.has(name)) dropped.push(name)
    if (kept.length === 0) continue
    const selector = kept.flatMap(selectorsFor).join(',\n  ')
    rules.push(`  ${selector} {\n    ${body}\n  }`)
  }
  return { rules, dropped }
}

const css = (rules, coarse) => `/* dsh-no-token/mobile */
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
${rules.join('\n')}

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
${coarse.join('\n')}
}
`

/**
 * Replace the template literal that defines MOBILE_CSS in one source file.
 * @param path - the file to rewrite.
 * @param next - the new template body (including its own backticks are added here).
 * @returns the previous body, for comparison.
 */
function rewrite(path, next) {
  const source = readFileSync(path, 'utf8')
  const match = /const MOBILE_CSS = `[\s\S]*?`\n/.exec(source)
  if (match === null) throw new Error(`no MOBILE_CSS template in ${path}`)
  const previous = match[0]
  writeFileSync(path, source.replace(previous, `const MOBILE_CSS = \`${next}\`\n`))
  return previous
}

const boot = await readRoster()
console.log(`shell ${String(boot.entries.length)} modules from ${BASE}`)
const shellNames = await collectShellNames(boot)
console.log(`distinct shell class names: ${String(shellNames.size)}`)
const { rules, dropped } = build(shellNames)
const { rules: coarse, dropped: droppedCoarse } = build(shellNames, SPEC_COARSE)
console.log(`rules kept: ${String(rules.length)} of ${String(SPEC.length)} in the phone query, ${String(coarse.length)} of ${String(SPEC_COARSE.length)} in the coarse band`)
const missing = [...new Set([...dropped, ...droppedCoarse])]
if (missing.length > 0) console.log(`names not present in this build (skipped): ${missing.join(', ')}`)

const next = css(rules, coarse)
if (DRY) {
  console.log('\n--- generated (dry run) ---\n' + next)
} else {
  const host = fileURLToPath(new URL('../dsh-no-token/index.js', import.meta.url))
  const client = fileURLToPath(new URL('../dsh-no-token/client.js', import.meta.url))
  rewrite(host, next)
  rewrite(client, next)
  const a = /const MOBILE_CSS = `([\s\S]*?)`\n/.exec(readFileSync(host, 'utf8'))[1]
  const b = /const MOBILE_CSS = `([\s\S]*?)`\n/.exec(readFileSync(client, 'utf8'))[1]
  if (a !== b) throw new Error('the two copies diverged while writing')
  console.log(`wrote ${String(a.length)} bytes into both halves, byte-identical`)
}
