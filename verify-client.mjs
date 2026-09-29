/**
 * Offline render test for dsh-no-token's browser half: the module-loader entry
 * is executed against a stub React and stub Client services, then the
 * registered page component is rendered and driven, so the tree, the locale
 * lookup, and every write path are asserted without a browser.
 * Run: node verify-client.mjs
 */
import assert from 'node:assert/strict'

// ---- module loader entry ------------------------------------------------------
let spec
globalThis.window = { __ModuleLoader__: { load: (value) => { spec = value } } }
await import('./dsh-no-token/client.js')
assert.equal(spec.id, 'dsh-no-token', 'the factory id must equal the package name')

// ---- a React stub with the state semantics the page relies on ------------------
let states = []
let cursor = 0
const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState: (init) => {
    const index = cursor++
    if (states.length <= index) states.push(typeof init === 'function' ? init() : init)
    return [states[index], (next) => {
      states[index] = typeof next === 'function' ? next(states[index]) : next
    }]
  },
  useEffect: () => {},
}

const client = spec.factory((id) => {
  if (id === 'react') return React
  throw new Error(`unexpected require(${id})`)
})
// Only the locale package is a hard module dependency: `configForms` comes from the
// plugin manager, and a profile need not load it. A hard inject there keeps the whole
// page inactive without a word, so the service is resolved at runtime instead.
assert.deepEqual(client.inject, ['slots', 'locale'])
assert.equal(typeof client.apply, 'function')

// ---- Client service stubs -----------------------------------------------------
const dictionaries = {}

function makeController({ mode = 'loopback', base = mode, writable = true, status = 'ready' } = {}) {
  const writes = []
  const listeners = new Set()
  let snapshot = { status, value: { mode }, base: { mode: base }, user: undefined, revision: 1, writable, mode: 'host' }
  return {
    writes,
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set: (field, value) => {
      writes.push(['set', field, value])
      snapshot = { ...snapshot, value: { ...snapshot.value, [field]: value } }
      listeners.forEach((listener) => listener())
      return Promise.resolve(true)
    },
    unset: (field) => {
      writes.push(['unset', field])
      snapshot = { ...snapshot, value: { ...snapshot.value, [field]: base } }
      listeners.forEach((listener) => listener())
      return Promise.resolve(true)
    },
    dispose: () => {},
  }
}

function mount(controller, served = ['no-token']) {
  const registrations = {}
  const registered = []
  const requested = []
  const ctx = {
    // The client Cordis seam. `configForms` is optional, so the plugin asks for it
    // here rather than declaring it as a hard dependency.
    inject: (services, callback) => {
      if (!services.includes('configForms')) return () => {}
      callback({ configForms: ctx.configForms, effect: (execute) => execute() })
      return () => {}
    },
    locale: {
      bind: (ns) => (key) => dictionaries[ns]?.zh?.[key] ?? key,
      register: (ns, dictionary) => {
        dictionaries[ns] = dictionary
        return () => {}
      },
    },
    configForms: {
      get: (entryId) => {
        requested.push(entryId)
        return controller
      },
      whileServed: (namespaces, register) => {
        assert.deepEqual([...namespaces], ['no-token', 'include:no-token'], 'both spellings of the entry id are watched')
        return register(new Set(served))
      },
    },
    slots: {
      inject: (slot, callback) => {
        assert.ok(
          slot === 'settings.section' || slot === 'shell.overlay',
          `the page only claims known seats, got ${slot}`,
        )
        return callback()
      },
      register: (options, view) => {
        registrations[options.name] = { options, view }
        // A list slot can hold several entries under one name, so the ids are kept.
        registered.push({ name: options.name, id: options.id })
        return () => {}
      },
    },
    effect: (execute) => execute(),
  }
  client.apply(ctx)
  return { registrations, registered, requested }
}

/** Depth-first walk over the stub element tree, collecting nodes and text. */
function findAll(node, predicate, out = []) {
  if (node === null || node === undefined) return out
  if (Array.isArray(node)) {
    node.forEach((child) => findAll(child, predicate, out))
    return out
  }
  if (typeof node !== 'object') {
    if (predicate(node)) out.push(node)
    return out
  }
  if (predicate(node)) out.push(node)
  findAll(node.children, predicate, out)
  return out
}

/** Render with React's per-render hook cursor reset. */
function render(component, props) {
  cursor = 0
  return component(props)
}

mount(makeController()) // applying the plugin is what registers its dictionaries
const zh = dictionaries['settings.noToken']?.zh
assert.ok(zh, 'the page registers its dictionaries')

/** Localized text, resolved the way the page resolves it. */
const t = (key) => zh[key] ?? key

// ---- the registered seats ------------------------------------------------------
/**
 * The mode form as the LAN section embeds it. The form no longer has seats of its
 * own — reaching it through the section's tree is also what proves the two controls
 * now share one page.
 * @param controller - the stub Config controller.
 * @param served - the entry ids the Host serves.
 * @returns the form renderer plus the mount's registrations and requested entries.
 */
function modeFormOf(controller, served = ['no-token']) {
  const { registrations, requested } = mount(controller, served)
  const registration = registrations['settings.section']
  const props = registration.options.inject()
  const tree = render(registration.view, { ...props, t })
  const node = findAll(tree, (candidate) => candidate.props?.controller !== undefined)[0]
  assert.ok(node !== undefined, 'the LAN section embeds the mode form on the same page')
  // The stub keeps hook values in a shared array, so the form's first render starts
  // from an empty cursor; later renders keep it, which is what lets a changed radio
  // survive into the next render.
  states = []
  return { view: (extra) => node.type({ ...node.props, ...extra }), requested, registrations, sectionProps: props }
}

{
  const controller = makeController()
  const { registrations, requested } = mount(controller)

  assert.deepEqual(requested, ['no-token'], 'the served namespace is the one bound')

  // One page, not four: the sidebar Plugins page, the Settings → Built-in plugins
  // tab and the bundle card are all gone, leaving only the settings section.
  assert.equal(registrations['plugins.row.config'], undefined, 'the sidebar row seat is gone')
  assert.equal(registrations['settings.plugins.tab'], undefined, 'the plugins-settings tab is gone')
  assert.equal(registrations['plugins.bundle.config'], undefined, 'the bundle card seat is gone')

  const section = registrations['settings.section']?.options
  assert.ok(section !== undefined, 'the settings section is registered')
  assert.equal(section.id, 'no-token-lan')
  assert.equal(section.locale, 'settings.noToken')
  assert.equal(section.label(), zh.lanNav, 'the section label is the localized nav text')
  assert.equal(typeof section.inject().controller, 'object', 'the section receives the row controller the mode form drives')

  const { view } = modeFormOf(controller)
  let tree = render(view, {})

  const radios = findAll(tree, (node) => node.type === 'input').filter((input) => input.props.name === 'dsh-no-token-mode')
  assert.deepEqual(radios.map((radio) => radio.props.value), ['loopback', 'all', 'off'])
  assert.deepEqual(radios.map((radio) => radio.props.checked), [true, false, false])
  assert.ok(radios.every((radio) => radio.props.disabled === false))

  const texts = findAll(tree, (node) => typeof node === 'string')
  for (const copy of [zh.hint, zh.loopback, zh.all, zh.off, zh.effective, zh.save]) {
    assert.ok(texts.some((text) => text.includes(copy)), `the form renders "${copy}"`)
  }

  let buttons = findAll(tree, (node) => node.type === 'button')
  assert.equal(buttons.length, 1, 'nothing is overridden yet, so there is no reset button')
  assert.equal(buttons[0].props.disabled, true, 'an unmodified form cannot be saved')

  // Choose a different mode: the save becomes available, one write is issued,
  // and the form reports the outcome.
  radios.find((radio) => radio.props.value === 'all').props.onChange()
  tree = render(view, {})
  buttons = findAll(tree, (node) => node.type === 'button')
  assert.equal(buttons[0].props.disabled, false)
  await buttons[0].props.onClick()
  assert.deepEqual(controller.writes, [['set', 'mode', 'all']])
  tree = render(view, {})
  assert.ok(findAll(tree, (node) => typeof node === 'string').some((text) => text.includes(zh.saved)))
}

// ---- an overridden row offers its reset ---------------------------------------
{
  const controller = makeController({ mode: 'all', base: 'loopback' })
  const { view } = modeFormOf(controller)
  states = []
  let tree = render(view, {})

  assert.ok(findAll(tree, (node) => typeof node === 'string').some((text) => text.includes(zh.overridden)))
  const buttons = findAll(tree, (node) => node.type === 'button')
  assert.equal(buttons.length, 2, 'an override adds the reset button')
  await buttons[1].props.onClick()
  assert.deepEqual(controller.writes, [['unset', 'mode']])
}

// ---- a nested include layer prefixes the entry id -----------------------------
{
  const controller = makeController()
  const { requested, view } = modeFormOf(controller, ['include:no-token'])
  assert.deepEqual(requested, ['include:no-token'], 'the prefixed entry id is bound when that is what the Host serves')
  states = []
  const tree = render(view, {})
  assert.equal(findAll(tree, (node) => node.type === 'input').filter((input) => input.props.name === 'dsh-no-token-mode').length, 3)
}

// ---- a read-only deployment, and an unloaded plugin ---------------------------
{
  const controller = makeController({ writable: false })
  const { view } = modeFormOf(controller)
  states = []
  let tree = render(view, {})
  assert.ok(findAll(tree, (node) => typeof node === 'string').some((text) => text.includes(zh.readOnly)))
  assert.equal(findAll(tree, (node) => node.type === 'button')[0].props.disabled, true)

  const gone = makeController({ status: 'unavailable' })
  const { view: unavailableView } = modeFormOf(gone)
  states = []
  tree = render(unavailableView, {})
  assert.ok(findAll(tree, (node) => typeof node === 'string').some((text) => text.includes(zh.unavailable)))
}

// ---- the independent LAN section ----------------------------------------------
{
  const realTimeout = globalThis.setTimeout
  globalThis.setTimeout = (callback) => {
    callback()
    return 0
  }
  try {
    const address = {
      address: '192.168.1.20',
      authority: '192.168.1.20:3080',
      url: 'http://192.168.1.20:3080/',
      loginUrl: 'http://192.168.1.20:3080/?token=SECRET',
      trusted: true,
      usable: true,
    }
    let current = { bind: '0.0.0.0', port: 3080, mode: 'loopback', tokenRequired: true, enabled: true, addresses: [address], notes: [] }
    const calls = []
    const copied = []
    globalThis.fetch = async (path, options = {}) => {
      calls.push([path, options.method])
      if (options.method === 'POST') {
        const body = JSON.parse(options.body)
        if (body.trustedHosts !== undefined) {
          current = { ...current, trustedHosts: body.trustedHosts.filter((entry) => String(entry).trim() !== '') }
        } else if (body.password !== undefined) {
          current = { ...current, password: { ...current.password, set: body.password !== null } }
        } else {
          current = { ...current, enabled: body.enabled, bind: body.enabled ? '0.0.0.0' : '127.0.0.1' }
        }
      }
      return { status: 200, json: async () => ({ ok: true, state: current }) }
    }
    // Node exposes `navigator` as a getter, so the clipboard is installed on it.
    const clipboard = { writeText: async (value) => { copied.push(value) } }
    try {
      Object.defineProperty(globalThis, 'navigator', { value: { clipboard }, configurable: true, writable: true })
    } catch {
      Object.defineProperty(globalThis.navigator, 'clipboard', { value: clipboard, configurable: true })
    }
    const t = (key) => dictionaries['settings.noToken']?.zh?.[key] ?? key

    const { registrations } = mount(makeController())
    const section = registrations['settings.section']
    assert.ok(section !== undefined, 'the LAN page claims its own settings section')
    assert.equal(section.options.id, 'no-token-lan')
    assert.equal(section.options.order, 25)
    assert.equal(section.options.locale, 'settings.noToken')
    assert.equal(section.options.label(), zh.lanNav, 'the nav row is localized')

    const store = section.options.inject().store
    assert.ok(store !== undefined, 'the section receives its store')
    await new Promise((resolve) => {
      realTimeout(resolve, 10)
    })

    // On: the status line, the queue to turn it off, the code, and the firewall hint.
    states = []
    let tree = render(section.view, { store, t })
    let texts = findAll(tree, (node) => typeof node === 'string')
    for (const copy of [zh.lanTitle, zh.lanIntro, zh.lanDisable, zh.lanStateOn, zh.lanScan, zh.lanFirewall, zh.lanCopyCommand, zh.lanModeNote]) {
      assert.ok(texts.some((text) => text.includes(copy)), `the on state renders "${copy}"`)
    }
    assert.equal(findAll(tree, (node) => node.type === 'svg').length, 1, 'one code per usable address')

    // Copy puts exactly the login link on the clipboard.
    const copyButton = findAll(tree, (node) => node.type === 'button').find((button) => button.children[0] === zh.lanCopy)
    assert.ok(copyButton !== undefined, 'the link has a copy button')
    await copyButton.props.onClick()
    assert.deepEqual(copied, [address.loginUrl])

    // One click turns it off, without the user touching anything else.
    const offButton = findAll(tree, (node) => node.type === 'button').find((button) => button.children[0] === zh.lanDisable)
    offButton.props.onClick()
    await new Promise((resolve) => {
      realTimeout(resolve, 10)
    })
    assert.ok(calls.some(([path, method]) => path === '/api/no-token/lan' && method === 'POST'), 'the click writes through the host route')
    states = []
    tree = render(section.view, { store, t })
    texts = findAll(tree, (node) => typeof node === 'string')
    assert.ok(texts.some((text) => text.includes(zh.lanEnable)), 'the button flips to enable')
    assert.equal(findAll(tree, (node) => node.type === 'svg').length, 0, 'no code while it is off')

    // Risky mode: the button stays disabled until the warning is acknowledged.
    current = { bind: '127.0.0.1', port: 3080, mode: 'all', tokenRequired: false, enabled: false, addresses: [address], notes: [] }
    states = []
    const risky = mount(makeController())
    const riskyStore = risky.registrations['settings.section'].options.inject().store
    await new Promise((resolve) => {
      realTimeout(resolve, 10)
    })
    states = []
    tree = render(risky.registrations['settings.section'].view, { store: riskyStore, t })
    texts = findAll(tree, (node) => typeof node === 'string')
    assert.ok(texts.some((text) => text.includes(zh.lanRiskWarn)), 'the risky mode warns')
    let enableButton = findAll(tree, (node) => node.type === 'button').find((button) => button.children[0] === zh.lanEnable)
    assert.equal(enableButton.props.disabled, true, 'the risky mode blocks the one click until accepted')
    const checkbox = findAll(tree, (node) => node.type === 'input').find((input) => input.props.type === 'checkbox')
    assert.ok(checkbox !== undefined, 'the acknowledgement is offered')
    checkbox.props.onChange({ target: { checked: true } })
    tree = render(risky.registrations['settings.section'].view, { store: riskyStore, t })
    enableButton = findAll(tree, (node) => node.type === 'button').find((button) => button.children[0] === zh.lanEnable)
    assert.equal(enableButton.props.disabled, false, 'acknowledging unblocks it')

    // The password card: presence only, saved through the host route.
    current = { bind: '0.0.0.0', port: 3080, mode: 'loopback', tokenRequired: true, enabled: true, addresses: [address], notes: [], password: { ref: 'DSH_LAN_PASSWORD', set: false, writable: true } }
    states = []
    const vault = mount(makeController())
    const vaultStore = vault.registrations['settings.section'].options.inject().store
    await new Promise((resolve) => {
      realTimeout(resolve, 10)
    })
    states = []
    tree = render(vault.registrations['settings.section'].view, { store: vaultStore, t })
    texts = findAll(tree, (node) => typeof node === 'string')
    assert.ok(texts.some((text) => text.includes(zh.lanPasswordTitle)), 'the password card renders')
    assert.ok(texts.some((text) => text.includes(zh.lanPasswordStateUnset)))
    let field = findAll(tree, (node) => node.type === 'input').find((input) => input.props.type === 'password')
    assert.ok(field !== undefined, 'the password field is offered')
    let saveButton = findAll(tree, (node) => node.type === 'button').find((button) => button.children[0] === zh.lanPasswordSave)
    assert.equal(saveButton.props.disabled, true, 'an empty password cannot be saved')
    field.props.onChange({ target: { value: 'hunter2' } })
    tree = render(vault.registrations['settings.section'].view, { store: vaultStore, t })
    saveButton = findAll(tree, (node) => node.type === 'button').find((button) => button.children[0] === zh.lanPasswordSave)
    assert.equal(saveButton.props.disabled, false)
    saveButton.props.onClick()
    await new Promise((resolve) => {
      realTimeout(resolve, 10)
    })
    assert.ok(calls.some(([path, method]) => path === '/api/no-token/lan' && method === 'POST'), 'saving writes through the host route')
    states = []
    tree = render(vault.registrations['settings.section'].view, { store: vaultStore, t })
    texts = findAll(tree, (node) => typeof node === 'string')
    assert.ok(texts.some((text) => text.includes(zh.lanPasswordStateSet)), 'the card reports it as set')
    const clearButton = findAll(tree, (node) => node.type === 'button').find((button) => button.children[0] === zh.lanPasswordClear)
    assert.ok(clearButton !== undefined, 'a set password can be cleared')

    // A password supplied by the environment is reported, not editable here.
    current = { ...current, password: { ref: 'DSH_LAN_PASSWORD', set: true, writable: false } }
    states = []
    const fromEnv = mount(makeController())
    const envStore = fromEnv.registrations['settings.section'].options.inject().store
    await new Promise((resolve) => {
      realTimeout(resolve, 10)
    })
    states = []
    tree = render(fromEnv.registrations['settings.section'].view, { store: envStore, t })
    texts = findAll(tree, (node) => typeof node === 'string')
    assert.ok(texts.some((text) => text.includes(zh.lanPasswordEnv)), 'the environment source is named')
    field = findAll(tree, (node) => node.type === 'input').find((input) => input.props.type === 'password')
    assert.equal(field, undefined, 'and the field is withheld')

    // Extra trusted hosts: the tunnel case. A tunnel presents a hostname, the fence
    // refuses it, and the page is where the operator lists it.
    current = { ...current, trustedHosts: [] }
    states = []
    const trustMount = mount(makeController())
    const trustStore = trustMount.registrations['settings.section'].options.inject().store
    await new Promise((resolve) => {
      realTimeout(resolve, 10)
    })
    states = []
    tree = render(trustMount.registrations['settings.section'].view, { store: trustStore, t })
    texts = findAll(tree, (node) => typeof node === 'string')
    assert.ok(texts.some((text) => text.includes(zh.lanTrustedTitle)), 'the trusted-host card renders')
    assert.ok(texts.some((text) => text.includes(zh.lanTrustedNone)), 'and reports an empty list')
    const area = findAll(tree, (node) => node.type === 'textarea')[0]
    assert.ok(area !== undefined, 'a field takes the tunnel hostname')
    area.props.onChange({ target: { value: 'abc.ngrok-free.app\n\n' } })
    // The click has to come from a render that saw the new draft, or its closure
    // still holds the empty one.
    tree = render(trustMount.registrations['settings.section'].view, { store: trustStore, t })
    const trustSave = findAll(tree, (node) => node.type === 'button').find((button) => button.children[0] === zh.lanTrustedSave)
    assert.ok(trustSave !== undefined, 'and has a save')
    trustSave.props.onClick()
    await new Promise((resolve) => {
      realTimeout(resolve, 10)
    })
    states = []
    tree = render(trustMount.registrations['settings.section'].view, { store: trustStore, t })
    texts = findAll(tree, (node) => typeof node === 'string')
    assert.ok(texts.some((text) => text.includes('abc.ngrok-free.app')), 'the saved hostname is shown back')

    // A Host half that predates the field answers 400 while naming its own, older
    // body. That is a restart, not a bad request, and the page has to say so — the
    // raw 400 is what an operator reported when the older half was still running.
    {
      const stale = mount(makeController())
      const staleStore = stale.registrations['settings.section'].options.inject().store
      await new Promise((resolve) => {
        realTimeout(resolve, 10)
      })
      const healthy = globalThis.fetch
      globalThis.fetch = async () => ({
        status: 400,
        json: async () => ({ ok: false, code: 'bad-request', error: 'the body must be { "enabled": boolean }' }),
      })
      await staleStore.setTrustedHosts(['abc.ngrok-free.app'])
      globalThis.fetch = healthy
      assert.match(staleStore.getSnapshot().error, /重启/, 'the page points at the restart, not the raw 400')
    }
    const missing = mount(makeController())
    const missingStore = missing.registrations['settings.section'].options.inject().store
    await new Promise((resolve) => {
      realTimeout(resolve, 10)
    })
    globalThis.fetch = async () => ({ status: 404, json: async () => ({}) })
    await missingStore.setEnabled(true)
    globalThis.fetch = async (path, options = {}) => {
      calls.push([path, options.method])
      return { status: 200, json: async () => ({ ok: true, state: current }) }
    }
    assert.match(missingStore.getSnapshot().error, /重启/, 'a route that is absent entirely says the same thing')
  } finally {
    globalThis.setTimeout = realTimeout
  }
}

// The mobile stylesheet is not rendered here: it rides the Host's index injection
// table, so a phone receives it in the document itself even when a cached document
// kept an older client module. `verify-mobile.mjs` covers that side.
{
  const { registrations, registered } = mount(makeController())
  const names = [...new Set(registered.map((entry) => entry.name))].sort()
  assert.deepEqual(
    names,
    ['settings.section', 'shell.overlay'],
    'the browser half claims exactly two seats: the settings page and the frame-wide layer',
  )
  const ids = registered.filter((entry) => entry.name === 'shell.overlay').map((entry) => entry.id)
  assert.deepEqual(ids, ['no-token-mobile', 'no-token-mobile-debug'], 'the stylesheet and the readout both sit in the frame-wide layer')
  assert.equal(registrations['settings.section'].options.id, 'no-token-lan')
}

console.log('verify-client: all assertions passed')
