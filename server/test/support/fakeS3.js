'use strict'

/**
 * Stand-ins for storage services, for tests that must not depend on one:
 *
 *   startFakeS3()   an S3 API in memory, enough of it for the storage layer (path-style
 *                   requests: put, head, get with ranges and validators, delete, list by
 *                   prefix). Signatures are not checked. It counts what it is asked.
 *   refusedPort()   a port on 127.0.0.1 nothing listens on: connections are refused
 *   startBlackHole() a server that accepts connections and never says a word
 *
 * The real SDK talks to all three over real sockets, so timeouts and errors are
 * the ones a deployment would see.
 */
const http = require('http')
const net = require('net')
const crypto = require('crypto')

const xml = (body) => `<?xml version="1.0" encoding="UTF-8"?>${body}`
const escape = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))

async function startFakeS3({ accessKeyId = 'FAKEKEY', secretAccessKey = 'fake-secret-0123456789' } = {}) {
  /** bucket -> Map(key -> { body, type, etag, at }) */
  const buckets = new Map()
  const requests = []
  const state = { down: false }
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const url = new URL(req.url, 'http://x')
      const [, bucket, ...rest] = url.pathname.split('/')
      const key = decodeURIComponent(rest.join('/'))
      requests.push(`${req.method} ${bucket}/${key}${url.searchParams.has('list-type') ? `?prefix=${url.searchParams.get('prefix')}` : ''}`)
      if (state.down) return req.socket.destroy()
      const objects = buckets.get(bucket)
      const fail = (status, code) => {
        res.statusCode = status
        res.setHeader('Content-Type', 'application/xml')
        res.end(req.method === 'HEAD' ? undefined : xml(`<Error><Code>${code}</Code><Message>${code}</Message></Error>`))
      }
      if (!objects) return fail(404, 'NoSuchBucket')

      if (req.method === 'GET' && url.searchParams.get('list-type') === '2') {
        const prefix = url.searchParams.get('prefix') || ''
        const found = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort()
        res.setHeader('Content-Type', 'application/xml')
        return res.end(xml(`<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${bucket}</Name><Prefix>${escape(prefix)}</Prefix><KeyCount>${found.length}</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>${
          found.map((k) => `<Contents><Key>${escape(k)}</Key><Size>${objects.get(k).body.length}</Size><ETag>${objects.get(k).etag}</ETag><LastModified>${objects.get(k).at.toISOString()}</LastModified></Contents>`).join('')
        }</ListBucketResult>`))
      }
      if (req.method === 'PUT') {
        const body = Buffer.concat(chunks)
        const etag = `"${crypto.createHash('md5').update(body).digest('hex')}"`
        objects.set(key, { body, type: req.headers['content-type'] || 'application/octet-stream', etag, at: new Date() })
        res.setHeader('ETag', etag)
        return res.end()
      }
      if (req.method === 'DELETE') {
        objects.delete(key)
        res.statusCode = 204
        return res.end()
      }
      const object = objects.get(key)
      if (!object) return fail(404, 'NoSuchKey')
      res.setHeader('ETag', object.etag)
      res.setHeader('Last-Modified', object.at.toUTCString())
      res.setHeader('Content-Type', object.type)
      res.setHeader('Accept-Ranges', 'bytes')
      if (req.method === 'HEAD') {
        res.setHeader('Content-Length', object.body.length)
        return res.end()
      }
      if (req.headers['if-none-match'] === object.etag) { res.statusCode = 304; return res.end() }
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '')
      if (range) {
        const size = object.body.length
        const start = range[1] === '' ? Math.max(0, size - Number(range[2])) : Number(range[1])
        const end = range[1] === '' || range[2] === '' ? size - 1 : Math.min(Number(range[2]), size - 1)
        if (start >= size) return fail(416, 'InvalidRange')
        res.statusCode = 206
        res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
        return res.end(object.body.subarray(start, end + 1))
      }
      res.end(object.body)
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const endpoint = `http://127.0.0.1:${server.address().port}`
  return {
    endpoint,
    requests,
    buckets,
    /** Create a bucket and return a storage configuration for it (storage/schema.js input). */
    bucket(name, over = {}) {
      if (!buckets.has(name)) buckets.set(name, new Map())
      return { preset: 'minio', endpoint, region: 'us-east-1', bucket: name, accessKeyId, secretAccessKey, forcePathStyle: true, ...over }
    },
    objects: (name) => buckets.get(name),
    /** From now on every connection is dropped without an answer (the service is down), until set back. */
    set down(value) { state.down = !!value },
    close() { server.closeAllConnections(); server.close() },
  }
}

/** A port on 127.0.0.1 that nothing listens on. */
async function refusedPort() {
  const server = net.createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  await new Promise((resolve) => server.close(resolve))
  return port
}

/** A server that accepts every connection and never answers. `connections` counts them. */
async function startBlackHole() {
  const sockets = new Set()
  const hole = { connections: 0 }
  const server = net.createServer((socket) => {
    hole.connections++
    sockets.add(socket)
    socket.on('error', () => {})
    socket.on('close', () => sockets.delete(socket))
    socket.on('data', () => {}) // read and say nothing
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  hole.port = server.address().port
  hole.endpoint = `http://127.0.0.1:${hole.port}`
  hole.close = () => { for (const s of sockets) s.destroy(); server.close() }
  return hole
}

module.exports = { startFakeS3, refusedPort, startBlackHole }
