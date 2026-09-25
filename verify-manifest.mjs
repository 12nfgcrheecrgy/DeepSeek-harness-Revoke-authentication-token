/**
 * Pre-restart proof that the client-module scanner will find this bundle.
 *
 * `@deepseek-ai/dsh-client-modules` locates a row's manifest with the same
 * resolution the Loader used to import its host half (a `require` from the
 * profile directory), then reads `dsh.client` and the package's `./client`
 * export. This script repeats that resolution without a server, so a manifest
 * mistake surfaces before a restart rather than after it.
 *
 * Run: node verify-manifest.mjs
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PACKAGE_NAME = 'dsh-no-token'
const LOCAL_MANIFEST = fileURLToPath(new URL(`./${PACKAGE_NAME}/package.json`, import.meta.url))

// The client-module scanner resolves a row's manifest with a `require` from the
// profile directory, so that is the faithful place to ask — but only when this
// script runs inside a launch of that profile. A fresh clone, or any runner
// outside the harness, answers from the package directory itself.
const PROFILE_DIR = process.env.DSH_PROFILE_DIR
function resolveManifest() {
  if (PROFILE_DIR !== undefined) {
    try {
      return createRequire(`${PROFILE_DIR}/package.json`).resolve(`${PACKAGE_NAME}/package.json`)
    } catch {
      console.log(`note: ${PACKAGE_NAME} is not linked into ${PROFILE_DIR}; checking the directory as written`)
    }
  }
  return LOCAL_MANIFEST
}

const manifestPath = resolveManifest()
const require = createRequire(manifestPath)
console.log('manifest:', manifestPath)
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const packageRoot = dirname(manifestPath)
assert.equal(manifest.name, PACKAGE_NAME)

// 2. parseDshClient: platform is mandatory; inject/external/immediately are typed.
const declaration = manifest.dsh?.client
assert.ok(declaration !== undefined, 'the package declares dsh.client')
assert.equal(declaration.platform, 'web', 'this deployment is the web platform')
for (const key of ['inject', 'external']) {
  const value = declaration[key]
  assert.ok(value === undefined || (Array.isArray(value) && value.every((item) => typeof item === 'string')), `dsh.client.${key} is a string array`)
}
assert.ok(declaration.immediately === undefined || typeof declaration.immediately === 'boolean')

// 3. clientExportOf: the "./client" export must name a real file.
function clientExportOf(exports) {
  const entry = exports?.['./client']
  if (typeof entry === 'string') return entry
  if (entry !== null && typeof entry === 'object') return entry.default ?? entry.import
  return undefined
}

const clientRelative = clientExportOf(manifest.exports)
assert.ok(clientRelative !== undefined, 'the package exports "./client"')
const clientPath = resolve(packageRoot, clientRelative)
assert.ok(existsSync(clientPath), `the browser half exists at ${clientPath}`)
const clientSource = readFileSync(clientPath, 'utf8')
assert.ok(clientSource.includes("id: 'dsh-no-token'"), 'the factory id equals the package name')
assert.ok(clientSource.includes('window.__ModuleLoader__.load'), 'the browser half uses the module loader')

// 4. The bundle patch the plugin manager applies must keep declaring the row.
const patchPath = resolve(packageRoot, manifest.dsh.bundle.patch)
assert.ok(existsSync(patchPath), `the bundle patch exists at ${patchPath}`)
const patch = readFileSync(patchPath, 'utf8')
const rowId = /id:\s*([A-Za-z0-9._-]+)/.exec(patch)?.[1]
assert.ok(rowId !== undefined, 'the patch declares a row id')
assert.equal(rowId, 'no-token')
assert.ok(new RegExp(`name:\\s*${PACKAGE_NAME}`).test(patch), 'the patch declares this package name')

// The Plugins page dispatches a row's configuration under
// `<bundle package name>#<row id the patch declares>` (`rowConfigKey`), so the
// page's key must be derived from exactly those two values. Renaming the row in
// the patch without renaming the key would leave the page silently unrendered.
const dispatchKey = `${manifest.name}#${rowId}`
assert.ok(
  clientSource.includes(`'${dispatchKey}'`) || clientSource.includes(`"${dispatchKey}"`),
  `the browser half registers under ${dispatchKey}`,
)

// 5. The Host half must export what the Loader and the settings service read.
const entryPath = resolve(packageRoot, manifest.exports['.'] ?? manifest.main)
const host = await import(pathToFileURL(entryPath).href)
assert.equal(host.name, 'no-token')
assert.equal(typeof host.apply, 'function')
assert.ok(host.Config !== undefined, 'the Config schema the settings form is projected from')
assert.equal(host.Config['~standard'].vendor, 'schemastery')

// dsh-settings rebuilds this schema and keeps only paths beneath a volatile
// node, so the mode field must survive that round trip as editable.
const { default: z } = await import('@deepseek-ai/schemastery')
const rebuilt = new z(host.Config.toJSON())
assert.equal(rebuilt.dict.mode.meta.volatile, true, 'the mode field stays editable through the form')

// 6. Display metadata the Plugins card reads without activating the plugin.
assert.ok(existsSync(resolve(packageRoot, manifest.icon)), 'the icon exists')
for (const locale of ['en', 'zh']) {
  const dictionary = JSON.parse(readFileSync(resolve(packageRoot, 'locale', `${locale}.json`), 'utf8'))
  assert.equal(typeof dictionary.meta?.title, 'string', `${locale} carries a card title`)
}

console.log('verify-manifest: manifest, client export, patch, host exports, and metadata all agree')
