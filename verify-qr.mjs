/**
 * Offline check of the QR encoder behind the LAN page.
 *
 * The encoder is private to the browser half, so this drives the real component
 * and decodes the SVG path it renders — an end-to-end check of encoding,
 * masking, format information, Reed-Solomon and layout together. The decoder
 * below is written independently from the spec's figures: it re-derives the
 * function-module map, reads both format copies, checks the BCH codeword
 * arithmetically, verifies every block's RS syndromes, and finally compares the
 * recovered payload with the URL that went in.
 *
 * Run: node verify-qr.mjs
 */
import assert from 'node:assert/strict'

// ---- module loader + React stubs ----------------------------------------------
let spec
globalThis.window = { __ModuleLoader__: { load: (value) => { spec = value } } }
await import('./dsh-no-token/client.js')
assert.equal(spec.id, 'dsh-no-token')

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
  useEffect: (callback) => {
    callback()
  },
}
const client = spec.factory((id) => {
  if (id === 'react') return React
  throw new Error(`unexpected require(${id})`)
})

const VERSION = 6
const SIZE = 17 + 4 * VERSION
const DATA_CODEWORDS = 108
const BLOCKS = 4
const DATA_PER_BLOCK = 27
const EC_PER_BLOCK = 16

/** Mount the plugin against a canned LAN state and return its section view. */
async function mountSection(loginUrl, options = {}) {
  states = [] // a fresh component instance per case
  cursor = 0
  const state = {
    bind: options.bind ?? '0.0.0.0',
    port: 3080,
    mode: options.mode ?? 'loopback',
    tokenRequired: options.mode !== 'all',
    enabled: options.enabled ?? true,
    addresses: options.enabled === false
      ? []
      : [{ address: '192.168.1.20', authority: '192.168.1.20:3080', url: 'http://192.168.1.20:3080/', loginUrl, trusted: true, usable: true }],
    notes: options.notes ?? [],
  }
  globalThis.fetch = async () => ({ status: 200, json: async () => ({ ok: true, state }) })

  let section
  const ctx = {
    locale: { bind: () => (key) => key, register: () => () => {} },
    // The client Cordis seam. This mock deliberately has no `configForms`, which is
    // the desktop case: the service is optional, and the page must come up without it.
    inject: (services, callback) => {
      if (services.includes('configForms')) return () => {}
      callback({ effect: (execute) => execute() })
      return () => {}
    },
    slots: {
      inject: (slot, callback) => {
        callback()
        return () => {}
      },
      register: (registration, view) => {
        if (registration.name === 'settings.section') section = { registration, view }
        return () => {}
      },
    },
    effect: (execute) => execute(),
  }
  client.apply(ctx)
  assert.ok(section !== undefined, 'the LAN section is registered')
  assert.equal(section.registration.id, 'no-token-lan')
  assert.equal(section.registration.order, 25)
  await new Promise((resolve) => {
    setTimeout(resolve, 20)
  })
  return section
}

/** Render with React's per-render hook cursor reset. */
function render(section, store) {
  cursor = 0
  return section.view({ store, t: (key) => key })
}

/** Depth-first walk over the stub element tree. */
function findAll(node, predicate, out = []) {
  if (node === null || node === undefined) return out
  if (Array.isArray(node)) {
    node.forEach((child) => findAll(child, predicate, out))
    return out
  }
  if (typeof node !== 'object') return out
  if (predicate(node)) out.push(node)
  findAll(node.children, predicate, out)
  return out
}

// ---- an independent decoder ---------------------------------------------------

/** Rebuild the matrix from the rendered path's run-length runs. */
function matrixFromPath(d, quiet = 4) {
  const modules = Array.from({ length: SIZE }, () => new Uint8Array(SIZE))
  const pattern = /M(\d+) (\d+)h(\d+)v1h-(\d+)z/g
  let match
  let runs = 0
  while ((match = pattern.exec(d)) !== null) {
    const col = Number(match[1]) - quiet
    const row = Number(match[2]) - quiet
    const length = Number(match[3])
    assert.equal(Number(match[4]), length, 'a run closes with its own width')
    assert.ok(row >= 0 && row < SIZE && col >= 0 && col + length <= SIZE, 'runs stay inside the symbol')
    for (let offset = 0; offset < length; offset += 1) modules[row][col + offset] = 1
    runs += 1
  }
  assert.ok(runs > 0, 'the path draws modules')
  return modules
}

/** The spec's function-module map, derived from the figures. */
function reservedMap() {
  const reserved = Array.from({ length: SIZE }, () => new Uint8Array(SIZE))
  const mark = (row, col) => {
    reserved[row][col] = 1
  }
  for (const [top, left] of [[0, 0], [0, SIZE - 7], [SIZE - 7, 0]]) {
    for (let row = -1; row <= 7; row += 1) {
      for (let col = -1; col <= 7; col += 1) {
        const y = top + row
        const x = left + col
        if (y < 0 || y >= SIZE || x < 0 || x >= SIZE) continue
        mark(y, x)
      }
    }
  }
  for (let index = 8; index < SIZE - 8; index += 1) {
    mark(6, index)
    mark(index, 6)
  }
  const center = SIZE - 7
  for (let row = -2; row <= 2; row += 1) {
    for (let col = -2; col <= 2; col += 1) mark(center + row, center + col)
  }
  for (let index = 0; index <= 8; index += 1) {
    mark(index, 8)
    mark(8, index)
  }
  for (let index = 0; index < 8; index += 1) {
    mark(SIZE - 1 - index, 8)
    mark(8, SIZE - 1 - index)
  }
  mark(SIZE - 8, 8)
  return reserved
}

/** Throws unless the three finder patterns, timing, alignment and dark module are right. */
function assertStructure(modules) {
  const finder = (top, left) => {
    for (let row = 0; row < 7; row += 1) {
      for (let col = 0; col < 7; col += 1) {
        const dark = row === 0 || row === 6 || col === 0 || col === 6 || (row >= 2 && row <= 4 && col >= 2 && col <= 4)
        assert.equal(modules[top + row][left + col], dark ? 1 : 0, `finder at ${top},${left} module ${row},${col}`)
      }
    }
  }
  finder(0, 0)
  finder(0, SIZE - 7)
  finder(SIZE - 7, 0)
  for (let index = 8; index < SIZE - 8; index += 1) {
    assert.equal(modules[6][index], index % 2 === 0 ? 1 : 0, `horizontal timing at ${index}`)
    assert.equal(modules[index][6], index % 2 === 0 ? 1 : 0, `vertical timing at ${index}`)
  }
  const center = SIZE - 7
  for (let row = -2; row <= 2; row += 1) {
    for (let col = -2; col <= 2; col += 1) {
      const dark = Math.max(Math.abs(row), Math.abs(col)) !== 1
      assert.equal(modules[center + row][center + col], dark ? 1 : 0, `alignment module ${row},${col}`)
    }
  }
  assert.equal(modules[SIZE - 8][8], 1, 'the dark module is set')
}

/** Read both format copies and validate the BCH codeword arithmetically. */
function readFormat(modules) {
  const first = []
  for (let index = 0; index <= 5; index += 1) first.push(modules[index][8])
  first.push(modules[7][8], modules[8][8], modules[8][7])
  for (let index = 9; index < 15; index += 1) first.push(modules[8][14 - index])
  const second = []
  for (let index = 0; index < 8; index += 1) second.push(modules[8][SIZE - 1 - index])
  for (let index = 8; index < 15; index += 1) second.push(modules[SIZE - 15 + index][8])
  const toValue = (list) => list.reduce((value, bit, index) => value | (bit << index), 0)
  const a = toValue(first)
  const b = toValue(second)
  assert.equal(a, b, 'both format copies agree')
  const plain = a ^ 0x5412
  const data = plain >> 10
  let rest = data << 10
  for (let index = 14; index >= 10; index -= 1) {
    if (((rest >> index) & 1) !== 0) rest ^= 0x537 << (index - 10)
  }
  assert.equal(plain & 0x3ff, rest & 0x3ff, 'the format bits are a valid BCH codeword')
  assert.equal(data >> 3, 0b00, 'the EC level is M')
  return { ecLevel: data >> 3, mask: data & 7 }
}

/** Read the data modules in the two-column zigzag. */
function readCodewords(modules) {
  const reserved = reservedMap()
  const bits = []
  let upward = true
  for (let right = SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let step = 0; step < SIZE; step += 1) {
      const row = upward ? SIZE - 1 - step : step
      for (let offset = 0; offset < 2; offset += 1) {
        const col = right - offset
        if (reserved[row][col] === 1) continue
        bits.push(modules[row][col])
      }
    }
    upward = !upward
  }
  // 172 codewords, then the 7 remainder bits every version 2-6 symbol carries.
  assert.equal(bits.length, (DATA_CODEWORDS + BLOCKS * EC_PER_BLOCK) * 8 + 7, 'the free modules carry the codewords plus the remainder bits')
  const codewords = []
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    let value = 0
    for (let offset = 0; offset < 8; offset += 1) value = (value << 1) | bits[index + offset]
    codewords.push(value)
  }
  return codewords
}

const MASKS = [
  (row, col) => (row + col) % 2 === 0,
  (row) => row % 2 === 0,
  (row, col) => col % 3 === 0,
  (row, col) => (row + col) % 3 === 0,
  (row, col) => (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0,
  (row, col) => ((row * col) % 2) + ((row * col) % 3) === 0,
  (row, col) => (((row * col) % 2) + ((row * col) % 3)) % 2 === 0,
  (row, col) => (((row + col) % 2) + ((row * col) % 3)) % 2 === 0,
]

/** Undo one mask on the data modules only. */
function unmask(modules, mask) {
  const reserved = reservedMap()
  const out = modules.map((row) => Uint8Array.from(row))
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      if (reserved[row][col] === 1) continue
      if (MASKS[mask](row, col)) out[row][col] ^= 1
    }
  }
  return out
}

/** RS syndromes of one block; all zero means a valid codeword. */
function syndromes(codeword, count) {
  const exp = new Uint8Array(512)
  const log = new Uint8Array(256)
  for (let index = 0, value = 1; index < 255; index += 1) {
    exp[index] = value
    log[value] = index
    value <<= 1
    if ((value & 0x100) !== 0) value ^= 0x11d
  }
  for (let index = 255; index < 512; index += 1) exp[index] = exp[index - 255]
  const multiply = (left, right) => (left === 0 || right === 0 ? 0 : exp[log[left] + log[right]])
  const result = []
  for (let power = 0; power < count; power += 1) {
    let value = 0
    for (const byte of codeword) value = multiply(value, exp[power]) ^ byte
    result.push(value)
  }
  return result
}

/** De-interleave and verify every block, then return the data codewords. */
function decodeCodewords(codewords) {
  const data = Array.from({ length: BLOCKS }, () => [])
  for (let index = 0; index < DATA_PER_BLOCK; index += 1) {
    for (let block = 0; block < BLOCKS; block += 1) data[block].push(codewords[index * BLOCKS + block])
  }
  const ec = Array.from({ length: BLOCKS }, () => [])
  for (let index = 0; index < EC_PER_BLOCK; index += 1) {
    for (let block = 0; block < BLOCKS; block += 1) ec[block].push(codewords[DATA_CODEWORDS + index * BLOCKS + block])
  }
  for (let block = 0; block < BLOCKS; block += 1) {
    assert.deepEqual(syndromes([...data[block], ...ec[block]], EC_PER_BLOCK), new Array(EC_PER_BLOCK).fill(0), `block ${block} is a valid RS codeword`)
  }
  return data.flat()
}

/** Pull the byte-mode payload out of the data codewords. */
function decodePayload(data) {
  const bits = []
  for (const byte of data) for (let shift = 7; shift >= 0; shift -= 1) bits.push((byte >> shift) & 1)
  const take = (count) => {
    let value = 0
    for (let index = 0; index < count; index += 1) value = (value << 1) | bits.shift()
    return value
  }
  assert.equal(take(4), 0b0100, 'the mode indicator is byte mode')
  const length = take(8)
  const bytes = []
  for (let index = 0; index < length; index += 1) bytes.push(take(8))
  return new TextDecoder().decode(Uint8Array.from(bytes))
}

/** Decode one rendered URL back from its SVG path. */
function decodePath(d) {
  const modules = matrixFromPath(d)
  assertStructure(modules)
  const format = readFormat(modules)
  const unmasked = unmask(modules, format.mask)
  const codewords = readCodewords(unmasked)
  return { payload: decodePayload(decodeCodewords(codewords)), mask: format.mask, modules: unmasked, codewords }
}

/** Render the section for one URL and return the drawn path. */
async function pathFor(loginUrl, options) {
  const section = await mountSection(loginUrl, options)
  const store = section.registration.inject().store
  const tree = render(section, store)
  const svgs = findAll(tree, (node) => node.type === 'svg')
  if (svgs.length === 0) return undefined
  const paths = findAll(svgs[0], (node) => node.type === 'path')
  assert.equal(paths.length, 1, 'one path draws the symbol')
  return paths[0].props.d
}

// ---- the checks ---------------------------------------------------------------
const LONG_TOKEN = 'z'.repeat(43)
const CASES = [
  ['short clean url', 'http://192.168.1.20:3080/'],
  ['tokenized url', `http://192.168.1.20:3080/?token=${LONG_TOKEN}`],
  ['longest realistic url', `http://255.255.255.255:65535/?token=${LONG_TOKEN}`],
  ['capacity edge', `http://192.168.1.20:3080/${'a'.repeat(106 - 26)}`],
]

for (const [label, url] of CASES) {
  const d = await pathFor(url)
  assert.ok(d !== undefined, `${label}: a code is drawn`)
  const decoded = decodePath(d)
  assert.equal(decoded.payload, url, `${label}: the payload round-trips`)
  assert.ok(decoded.mask >= 0 && decoded.mask <= 7)
  assert.ok(d.includes('M'), `${label}: the path has runs`)
  console.log(`ok  ${label} (${url.length} bytes, mask ${decoded.mask})`)
}

// ---- a flipped data module must break RS --------------------------------------
{
  const url = `http://192.168.1.20:3080/?token=${LONG_TOKEN}`
  const decoded = decodePath(await pathFor(url))
  const damaged = decoded.modules.map((row) => Uint8Array.from(row))
  const reserved = reservedMap()
  let flipped
  for (let row = 9; row < SIZE && flipped === undefined; row += 1) {
    for (let col = 9; col < SIZE; col += 1) {
      if (reserved[row][col] === 0) {
        damaged[row][col] ^= 1
        flipped = [row, col]
        break
      }
    }
  }
  assert.ok(flipped !== undefined)
  const codewords = readCodewords(damaged)
  const data = []
  for (let index = 0; index < DATA_PER_BLOCK; index += 1) {
    for (let block = 0; block < BLOCKS; block += 1) data.push(codewords[index * BLOCKS + block])
  }
  const ec = []
  for (let index = 0; index < EC_PER_BLOCK; index += 1) {
    for (let block = 0; block < BLOCKS; block += 1) ec.push(codewords[DATA_CODEWORDS + index * BLOCKS + block])
  }
  const damagedSyndromes = []
  for (let block = 0; block < BLOCKS; block += 1) {
    damagedSyndromes.push(syndromes([...data.slice(block * DATA_PER_BLOCK, (block + 1) * DATA_PER_BLOCK), ...ec.slice(block * EC_PER_BLOCK, (block + 1) * EC_PER_BLOCK)], EC_PER_BLOCK))
  }
  assert.ok(damagedSyndromes.some((block) => block.some((value) => value !== 0)), 'RS detects a single flipped module')
  console.log(`ok  a flipped module at ${flipped.join(',')} is detected by RS`)
}

// ---- oversized payloads fall back to copy-only --------------------------------
{
  const d = await pathFor(`http://192.168.1.20:3080/${'b'.repeat(200)}`)
  assert.equal(d, undefined, 'an oversized payload draws no code')
  console.log('ok  an oversized payload draws no code')
}

// ---- the disabled state draws no code either ---------------------------------
{
  const section = await mountSection('http://192.168.1.20:3080/', { enabled: false })
  const store = section.registration.inject().store
  const tree = render(section, store)
  assert.equal(findAll(tree, (node) => node.type === 'svg').length, 0, 'the off state has no code')
  console.log('ok  the off state draws no code')
}

console.log('\nverify-qr: the rendered codes decode back to their payloads')
