// A tiny static server for the examples. No dependencies.
//
//   node examples/serve.mjs            -> http://127.0.0.1:4173
//   PORT=5000 node examples/serve.mjs
//   LC_LIB=/path/to/a/library/build node examples/serve.mjs   (another build than web/dist-lib,
//                                              e.g. one made with `node scripts/build-lib.mjs --out=<dir>`)
//
// It serves four things:
//   /                 this folder (the example pages)
//   /lib/             web/dist-lib/            (run `npm run build:lib` in web/ first)
//   /vendor/vue/      web/node_modules/vue/dist/ (only the Vue example needs it: Vue is a peer dependency)
//   /react-host/      react-host/dist/         (the React example is built with a bundler: run
//                                              `npm install && npm run build` in react-host/ first).
//                                              Served with a strict Content-Security-Policy; LC_API names
//                                              the API origin it allows (default http://127.0.0.1:3000/api).
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { contentSecurityPolicy } from './react-host/csp.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..')
const MOUNTS = [
  ['/lib/', process.env.LC_LIB ? path.resolve(process.env.LC_LIB) : path.join(repo, 'web/dist-lib')],
  ['/vendor/vue/', path.join(repo, 'web/node_modules/vue/dist')],
  ['/react-host/', path.join(here, 'react-host/dist')],
  ['/', here],
]
// Mounts that are the output of a build: when a file is missing, say which command produces it
// instead of falling through to the sources in this folder.
const BUILT = {
  '/lib/': 'Not found. Run `npm run build:lib` in web/ first.',
  '/react-host/': 'Not found. Run `npm install && npm run build` in examples/react-host/ first.',
}
const REACT_CSP = contentSecurityPolicy(process.env.LC_API || 'http://127.0.0.1:3000/api')
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
}

const server = http.createServer((req, res) => {
  const [rawPath, query = ''] = (req.url || '/').split('?')
  const url = decodeURIComponent(rawPath)
  // A folder without the trailing slash: redirect, or the page's relative addresses (./main.js) point one level up.
  if (!url.endsWith('/') && MOUNTS.some(([prefix, dir]) => `${url}/`.startsWith(prefix) && fs.existsSync(path.join(dir, `${url}/`.slice(prefix.length))) && fs.statSync(path.join(dir, `${url}/`.slice(prefix.length))).isDirectory())) {
    res.writeHead(302, { Location: `${rawPath}/${query ? `?${query}` : ''}` })
    res.end()
    return
  }
  for (const [prefix, dir] of MOUNTS) {
    if (!url.startsWith(prefix)) continue
    let file = path.join(dir, url.slice(prefix.length))
    // Never leave the mounted folder.
    if (!file.startsWith(dir)) break
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html')
    if (!fs.existsSync(file)) {
      if (BUILT[prefix]) break
      continue
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      ...(prefix === '/react-host/' ? { 'Content-Security-Policy': REACT_CSP } : {}),
    })
    fs.createReadStream(file).pipe(res)
    return
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end(BUILT[Object.keys(BUILT).find((prefix) => url.startsWith(prefix))] || 'Not found')
})

const port = Number(process.env.PORT) || 4173
server.listen(port, '127.0.0.1', () => {
  console.log(`LoomCanvas examples: http://127.0.0.1:${port}/`)
})
