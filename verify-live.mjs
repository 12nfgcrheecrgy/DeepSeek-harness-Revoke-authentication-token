/**
 * Live check of the installed dsh-no-token bundle against the running server.
 * Uses node:http so the Host, Origin, and Sec-Fetch-Site headers are exactly
 * what we set — those are the headers the trust fence reads.
 * Run: node verify-live.mjs
 */
import http from 'node:http'

const HOST = '127.0.0.1'
const PORT = 3080

function probe(name, path, headers = {}) {
  return new Promise((resolve) => {
    const req = http.request({ host: HOST, port: PORT, path, method: headers.method ?? 'GET', headers: { host: `${HOST}:${PORT}`, ...headers } }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location, body: body.slice(0, 60).replace(/\s+/g, ' ') }))
    })
    req.on('error', (error) => resolve({ status: 0, error: error.message }))
    req.end()
  })
}

const results = []
function check(name, actual, ok, detail = '') {
  results.push({ name, actual, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} -> ${actual}${detail ? ` (${detail})` : ''}`)
}

const index = await probe('index', '/')
check('GET / without a token serves the app', index.status, index.status === 200, index.body)

const reboundIndex = await probe('index-rebound', '/', { host: 'evil.example' })
check('GET / from a foreign Host keeps the gate', reboundIndex.status, reboundIndex.status === 401)

const api = await probe('api', '/api')
check('GET /api without a cookie is not 401', api.status, api.status !== 401 && api.status !== 0, api.body)

const apiRebound = await probe('api-rebound', '/api', { host: 'evil.example' })
check('GET /api from a foreign Host is refused by the fence', apiRebound.status, apiRebound.status === 403)

const apiCrossSite = await probe('api-cookied', '/api', { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' })
check('GET /api from a cross-site page is refused by the fence', apiCrossSite.status, apiCrossSite.status === 403)

const upload = await probe('upload', '/api/session/uploadFileBinary', { method: 'POST', 'content-type': 'application/octet-stream', 'content-length': '0' })
check('upload route no longer demands the cookie', upload.status, upload.status !== 401 && upload.status !== 0, upload.body)

const failed = results.filter((entry) => !entry.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exitCode = failed.length === 0 ? 0 : 1
