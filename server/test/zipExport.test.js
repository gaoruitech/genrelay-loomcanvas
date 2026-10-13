'use strict'

/**
 * One zip out of many results (services/zipExport.js), without a server or a
 * database: the archive is written to a stand-in for the response and the
 * files come from an `open` given here.
 *
 *  - one source is open at a time, in the order asked for, whatever sits between two files;
 *  - a file that cannot be opened or is too large leaves a note, the rest is intact;
 *  - anything that would make the archive silently short ends it instead: a file
 *    breaking off half way, the size budget, the time budget;
 *  - a client that goes away stops the work at once and leaves nothing open -
 *    in the middle of a file as well as while the end is being sent;
 *  - names inside the archive are single path segments and unique.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { PassThrough, Readable } = require('stream')
const zip = require('../src/services/zipExport')

/** What stands in for the HTTP response: a stream that remembers its headers. */
function fakeResponse({ consume = true, highWaterMark } = {}) {
  const res = new PassThrough(highWaterMark ? { highWaterMark } : undefined)
  res.headers = {}
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v }
  const chunks = []
  if (consume) res.on('data', (c) => chunks.push(c))
  res.body = () => Buffer.concat(chunks)
  return res
}

/** The entries of a stored (not compressed) zip, from its central directory: [{ name, data }]. */
function readZip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  assert.ok(end >= 0, 'the archive has its end record: it is complete')
  const count = buf.readUInt16LE(end + 10)
  let at = buf.readUInt32LE(end + 16)
  const out = []
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(at), 0x02014b50)
    const size = buf.readUInt32LE(at + 20)
    const nameLen = buf.readUInt16LE(at + 28)
    const extraLen = buf.readUInt16LE(at + 30)
    const commentLen = buf.readUInt16LE(at + 32)
    const local = buf.readUInt32LE(at + 42)
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString('utf8')
    const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    out.push({ name, data: buf.subarray(dataAt, dataAt + size) })
    at += 46 + nameLen + extraLen + commentLen
  }
  return out
}

/** Files by address, and a record of what was opened and what is still open. */
function library(files) {
  const log = { opened: [], open: 0, maxOpen: 0, streams: {} }
  const open = async (url) => {
    const f = files[url]
    if (!f || f.missing) throw new Error('gone')
    log.opened.push(url)
    log.open++
    log.maxOpen = Math.max(log.maxOpen, log.open)
    const stream = f.stream ? f.stream() : Readable.from([f.data])
    stream.once('close', () => { log.open-- })
    log.streams[url] = stream
    return { stream, mime: 'image/png', size: f.size === undefined ? (f.data ? f.data.length : null) : f.size }
  }
  return { open, log }
}

/** A file that never ends by itself: it gives data for as long as somebody reads. */
const endless = () => new Readable({ read() { this.push(Buffer.alloc(16 * 1024, 7)) } })
/** A file that gives `good` bytes and then breaks. */
const breaking = (good) => {
  let sent = false
  return new Readable({
    read() {
      if (!sent) { sent = true; this.push(Buffer.alloc(good, 1)); return }
      this.destroy(new Error('connection reset'))
    },
  })
}
const within = (promise, ms, what) => Promise.race([
  promise,
  new Promise((_resolve, reject) => setTimeout(() => reject(new Error(`${what}: still waiting after ${ms} ms`)), ms).unref()),
])
const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms))

test('files and texts go in one after the other, in the order asked for, as they are', async () => {
  const a = Buffer.from('picture-a'.repeat(5000))
  const b = Buffer.from('video-b'.repeat(9000))
  const { open, log } = library({ '/files/a.png': { data: a }, '/files/b.mp4': { data: b } })
  const res = fakeResponse()
  const stats = await zip.streamZip(res, [
    { name: '01-talker-20260101-000000.txt', text: '第一条回复' },
    { name: '02-banana-20260101-000001', url: '/files/a.png', kind: 'image' },
    { name: '03-talker-20260101-000002.txt', text: 'second answer' },
    { name: '04-veo-20260101-000003', url: '/files/b.mp4', kind: 'video' },
  ], { filename: '十月.zip', open })

  assert.deepEqual(stats, { written: 4, failed: 0, skipped: 0 })
  assert.equal(res.headers['content-type'], 'application/zip')
  assert.match(res.headers['content-disposition'], /^attachment; filename="download\.zip"; filename\*=UTF-8''%E5%8D%81%E6%9C%88\.zip$/)
  const entries = readZip(res.body())
  assert.deepEqual(entries.map((e) => e.name), ['01-talker-20260101-000000.txt', '02-banana-20260101-000001.png', '03-talker-20260101-000002.txt', '04-veo-20260101-000003.mp4'])
  assert.equal(entries[0].data.toString('utf8'), '第一条回复')
  assert.ok(entries[1].data.equals(a) && entries[3].data.equals(b), 'stored byte for byte')
  assert.deepEqual([log.opened, log.maxOpen, log.open], [['/files/a.png', '/files/b.mp4'], 1, 0], 'one open at a time, none left open')
})

test('a file that cannot be opened, or is too large, leaves a note in the reader\'s language - the rest is intact', async () => {
  const good = Buffer.from('good')
  const was = { ...zip.limits }
  zip.limits.itemBytes = 1000
  try {
    for (const [locale, failed, skipped] of [['zh-CN', /这个文件下载失败/, /已跳过/], ['en', /could not be downloaded/, /Skipped/]]) {
      const { open, log } = library({ '/files/gone.png': { missing: true }, '/files/huge.mp4': { stream: endless, size: 5000 }, '/files/ok.png': { data: good } })
      const res = fakeResponse()
      const stats = await zip.streamZip(res, [
        { name: '01-x', url: '/files/gone.png', kind: 'image' },
        { name: '02-x', url: '/files/huge.mp4', kind: 'video' },
        { name: '03-x', url: '/files/ok.png', kind: 'image' },
      ], { locale, open })
      assert.deepEqual(stats, { written: 1, failed: 1, skipped: 1 })
      const entries = readZip(res.body())
      assert.deepEqual(entries.map((e) => e.name), ['01-x-failed.txt', '02-x-skipped.txt', '03-x.png'])
      assert.match(entries[0].data.toString('utf8'), failed)
      assert.match(entries[1].data.toString('utf8'), skipped)
      assert.ok(entries[2].data.equals(good))
      assert.equal(log.open, 0, 'the file that was too large was closed again')
    }
  } finally {
    Object.assign(zip.limits, was)
  }
})

test('a file breaking off half way ends the archive: cut, never silently short', async () => {
  const { open, log } = library({ '/files/a.mp4': { stream: () => breaking(64 * 1024), size: null }, '/files/b.png': { data: Buffer.from('b') } })
  const res = fakeResponse()
  const closed = new Promise((resolve) => res.once('close', resolve))
  const stats = await within(zip.streamZip(res, [
    { name: '01-x', url: '/files/a.mp4', kind: 'video' },
    { name: '02-x', url: '/files/b.png', kind: 'image' },
  ], { open, log: 'test' }), 3000, 'a broken file')
  await closed
  await tick()
  assert.equal(stats, undefined)
  assert.deepEqual([res.destroyed, res.writableEnded], [true, false], 'destroyed, not ended: the client sees a failed download')
  assert.equal(res.body().lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])), -1, 'no end record was sent')
  assert.deepEqual([log.opened, log.open], [['/files/a.mp4'], 0], 'nothing was opened after it and nothing is left open')
})

test('the size budget of the whole archive ends it when a file of unknown size runs over', async () => {
  const was = { ...zip.limits }
  zip.limits.totalBytes = 200 * 1024
  try {
    const { open, log } = library({ '/files/a.mp4': { stream: endless, size: null } })
    const res = fakeResponse()
    const stats = await within(zip.streamZip(res, [{ name: '01-x', url: '/files/a.mp4', kind: 'video' }], { open, log: 'test' }), 3000, 'the size budget')
    assert.equal(stats, undefined)
    assert.ok(res.destroyed && !res.writableEnded)
    assert.ok(res.body().length < 400 * 1024, 'and little more than the budget ever left')
    await tick()
    assert.equal(log.open, 0)
  } finally {
    Object.assign(zip.limits, was)
  }
})

test('the time budget ends it too', async () => {
  const was = { ...zip.limits }
  zip.limits.totalTimeoutMs = 80
  try {
    // A reader that never takes anything: the file is held back for good.
    const { open, log } = library({ '/files/a.mp4': { stream: endless, size: null } })
    const res = fakeResponse({ consume: false, highWaterMark: 1024 })
    const stats = await within(zip.streamZip(res, [{ name: '01-x', url: '/files/a.mp4', kind: 'video' }], { open, log: 'test' }), 3000, 'the time budget')
    assert.equal(stats, undefined)
    assert.ok(res.destroyed)
    await tick()
    assert.equal(log.open, 0)
  } finally {
    Object.assign(zip.limits, was)
  }
})

test('the client going away in the middle of a file stops the work at once and leaves nothing open', async () => {
  const { open, log } = library({ '/files/a.mp4': { stream: endless, size: null }, '/files/b.png': { data: Buffer.from('b') } })
  // Reads nothing: the archive fills up and the file waits - as with a client on a slow line.
  const res = fakeResponse({ consume: false, highWaterMark: 1024 })
  const work = zip.streamZip(res, [
    { name: '01-x', url: '/files/a.mp4', kind: 'video' },
    { name: '02-x', url: '/files/b.png', kind: 'image' },
  ], { open, log: 'test' })
  await tick(60)
  assert.deepEqual([log.opened, log.open], [['/files/a.mp4'], 1], 'in the middle of the first file')
  res.destroy()
  assert.equal(await within(work, 2000, 'after the client left'), undefined)
  await tick()
  assert.deepEqual([log.opened, log.open, log.streams['/files/a.mp4'].destroyed], [['/files/a.mp4'], 0, true], 'the file was closed and the next one never opened')
})

test('the client going away while the end of the archive is being sent does not leave the work waiting', async () => {
  const { open, log } = library({ '/files/a.png': { data: Buffer.from('a'.repeat(4000)) } })
  const res = fakeResponse({ consume: false, highWaterMark: 512 })
  const work = zip.streamZip(res, [{ name: '01-x', url: '/files/a.png', kind: 'image' }, { name: '02-x.txt', text: 'answer' }], { open, log: 'test' })
  await tick(60)
  assert.equal(log.open, 0, 'everything is in the archive; only the sending is left')
  res.destroy()
  assert.equal(await within(work, 2000, 'after the client left'), undefined)
})

test('storage that does not answer cannot hold the work past the client leaving - and a file that opens after all is closed', async () => {
  let answer
  const late = Readable.from([Buffer.from('late')])
  // Never answers by itself: only when the test says so, long after the client has gone.
  const open = () => new Promise((resolve) => { answer = () => resolve({ stream: late, mime: 'image/png', size: 4 }) })
  const res = fakeResponse({ consume: false })
  const work = zip.streamZip(res, [{ name: '01-x', url: '/files/a.png', kind: 'image' }], { open, log: 'test' })
  await tick(40)
  res.destroy()
  assert.equal(await within(work, 2000, 'while storage is silent'), undefined)
  answer()
  await tick()
  assert.equal(late.destroyed, true, 'the file that opened too late was closed again')

  // The time budget is heard in the same place.
  const was = { ...zip.limits }
  zip.limits.totalTimeoutMs = 60
  try {
    const silent = () => new Promise(() => {})
    const res2 = fakeResponse({ consume: false })
    assert.equal(await within(zip.streamZip(res2, [{ name: '01-x', url: '/files/a.png', kind: 'image' }], { open: silent, log: 'test' }), 2000, 'the time budget while storage is silent'), undefined)
    assert.ok(res2.destroyed)
  } finally {
    Object.assign(zip.limits, was)
  }
})

test('names inside the archive are single path segments, and unique', async () => {
  const { open } = library({ '/files/a.png': { data: Buffer.from('a') } })
  const res = fakeResponse()
  await zip.streamZip(res, [
    { name: '../../etc/passwd.txt', text: 'x' },
    { name: 'a\\b:c', url: '/files/a.png', kind: 'image' },
    { name: 'same.txt', text: '1' },
    { name: 'SAME.txt', text: '2' },
    { name: '', text: '3' },
    { name: 'con.txt', text: '4' },
  ], { open })
  const names = readZip(res.body()).map((e) => e.name)
  assert.deepEqual(names, ['_.._etc_passwd.txt', 'a_b_c.png', 'same.txt', 'SAME-2.txt', 'file-5', '_con.txt'])
  for (const n of names) assert.ok(!/[\\/]/.test(n) && !n.startsWith('.'), n)

  assert.equal(zip.entryName('x'.repeat(300) + '.png').length, 120)
  assert.ok(zip.entryName('x'.repeat(300) + '.png').endsWith('.png'), 'a long name keeps its extension')
  assert.equal(zip.entryName('..'), 'file')
})
