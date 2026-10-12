// A tiny static server for the examples. No dependencies.
//
//   node examples/serve.mjs            -> http://127.0.0.1:4173
//   PORT=5000 node examples/serve.mjs
//
// It serves three things:
//   /                 this folder (the example pages)
//   /lib/             web/dist-lib/            (run `npm run build:lib` in web/ first)
//   /vendor/vue/      web/node_modules/vue/dist/ (only the Vue example needs it: Vue is a peer dependency)
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..')
const MOUNTS = [
  ['/lib/', path.join(repo, 'web/dist-lib')],
  ['/vendor/vue/', path.join(repo, 'web/node_modules/vue/dist')],
  ['/', here],
]
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0])
  for (const [prefix, dir] of MOUNTS) {
    if (!url.startsWith(prefix)) continue
    let file = path.join(dir, url.slice(prefix.length))
    // Never leave the mounted folder.
    if (!file.startsWith(dir)) break
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html')
    if (!fs.existsSync(file)) continue
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
    fs.createReadStream(file).pipe(res)
    return
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' })
  res.end(url.startsWith('/lib/') ? 'Not found. Run `npm run build:lib` in web/ first.' : 'Not found')
})

const port = Number(process.env.PORT) || 4173
server.listen(port, '127.0.0.1', () => {
  console.log(`LoomCanvas examples: http://127.0.0.1:${port}/`)
})
