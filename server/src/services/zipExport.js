'use strict'

/**
 * One zip out of many results, streamed.
 *
 * The caller decides WHAT goes in - a list of entries it has already checked
 * the reader may have - and this writes them to the response one after the
 * other: a file by its address (our own files from storage; anything else
 * through the SSRF guard, exactly like the download proxy), or a piece of text.
 *
 * Nothing is buffered: one download is open at a time and flows straight into
 * the archive, which is stored, not compressed (images and videos already
 * are). The archive as a whole and each file in it have a size cap, and the
 * whole operation a time budget; the client going away stops the work.
 *
 * A file that cannot be opened (gone, unreachable, too large) does not ruin
 * the archive: a short note takes its place, in the reader's language. One that
 * breaks off half way does end it - see streamZip.
 */
const { Transform } = require('stream')
const archiver = require('archiver')
const { openStream } = require('./media')
const { t } = require('../i18n')

/** Changeable for tests; the numbers are those of the canvas export (routes/workflow.js). */
const limits = {
  items: 100,
  itemBytes: 1024 * 1024 * 1024,
  totalBytes: 4 * 1024 * 1024 * 1024,
  itemTimeoutMs: 120 * 1000,
  totalTimeoutMs: 10 * 60 * 1000,
}

const MEDIA_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'mp4', 'mov', 'webm', 'mkv', 'mp3', 'wav', 'm4a', 'ogg']
const FALLBACK_EXT = { image: 'png', video: 'mp4', audio: 'mp3' }

/** The extension an entry gets: the address's own when it is a well-known media one, else by kind. */
function extOf(url, kind) {
  const m = /\.([a-zA-Z0-9]{2,5})$/.exec(String(url).split(/[?#]/)[0])
  const ext = m ? m[1].toLowerCase() : ''
  return MEDIA_EXT.includes(ext) ? ext : (FALLBACK_EXT[kind] || 'bin')
}

/** A string as part of a file name: no path separators, no control characters, nothing Windows refuses. */
function safeName(v, max = 60) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/[\/\\:*?"<>|\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[ .]+|[ .]+$/g, '')
    .slice(0, max)
}

/** 20250131-142233, in UTC: sorts by time in any file manager and means the same everywhere. */
function stamp(date) {
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
}

/** Content-Disposition for a download whose name may hold any character. */
function attachment(filename, asciiFallback) {
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

/**
 * An entry's name inside the archive: one path segment, whatever the caller
 * built it from. No separators (nothing can be unpacked outside the folder the
 * reader chose), no leading dots, nothing Windows refuses - and never empty.
 */
function entryName(v, fallback = 'file') {
  const s = safeName(v, 1000)
  const dot = s.lastIndexOf('.')
  const ext = dot > 0 && s.length - dot <= 8 ? s.slice(dot) : ''
  const stem = (ext ? s.slice(0, dot) : s).slice(0, 120 - ext.length).replace(/[ .]+$/, '')
  if (!stem) return fallback + ext
  // Device names Windows will not create a file under, whatever the extension.
  return (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(stem) ? `_${stem}` : stem) + ext
}

/** `name` unless it was used before; then `name-2`, `name-3` ... in front of the extension. */
function uniqueName(name, used) {
  let out = name
  const dot = name.lastIndexOf('.')
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
  for (let n = 2; used.has(out.toLowerCase()); n++) out = `${stem}-${n}${ext}`
  used.add(out.toLowerCase())
  return out
}

/**
 * Stream `entries` to `res` as a zip.
 *
 *   entries: [{ name, url, kind } | { name, text }]
 *     name  the entry's file name WITHOUT extension for a file (it follows from the address),
 *           WITH extension for a text
 *   filename: the archive's name (with .zip)
 *
 * Headers are sent here, so every refusal has to have happened before the call.
 * Resolves { written, failed, skipped } once the archive is complete and handed
 * to the client, or undefined when it was cut short (client gone, time or size
 * budget used up, a file breaking off half way) - the response is destroyed
 * then, so the client sees a failed download and never a silently short one.
 *
 * One thing is read at a time and each is waited for; whatever is open when the
 * work stops is closed, so a client that walks away leaves nothing behind.
 * `open` is how a file is opened (services/media.js openStream; tests give their own).
 */
async function streamZip(res, entries, { filename = 'download.zip', locale = '', log = 'zip', open = openStream } = {}) {
  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', attachment(filename, 'download.zip'))
  res.setHeader('Cache-Control', 'no-store')

  const abort = new AbortController()
  const stop = (why) => { if (!abort.signal.aborted) abort.abort(why instanceof Error ? why : new Error(String(why))) }
  const timer = setTimeout(() => stop('zip timeout'), limits.totalTimeoutMs)
  const onClose = () => { if (!res.writableFinished) stop('client closed') }
  res.on('close', onClose)
  // A connection that breaks while it is written to: stop, and never let it be an uncaught error.
  res.on('error', () => stop('client closed'))
  /** Rejects when the work is stopped; never resolves. For waits that take no signal. */
  const stopped = new Promise((_resolve, reject) => { abort.signal.addEventListener('abort', () => reject(abort.signal.reason), { once: true }) })
  stopped.catch(() => {})

  // Stored, not compressed: images and videos already are.
  const archive = archiver('zip', { zlib: { level: 0 } })
  archive.on('warning', () => {})
  // Whatever goes wrong inside the archive (a source breaking off in the middle of an entry
  // included) ends the whole of it: part of that entry is already on its way to the client.
  archive.on('error', (err) => stop(err))
  archive.pipe(res)

  /** Put one thing into the archive and wait until it is in - or until the work is stopped. */
  const add = (source, name) => new Promise((resolve, reject) => {
    if (abort.signal.aborted) return reject(abort.signal.reason)
    const settle = (err) => {
      archive.off('entry', onEntry)
      abort.signal.removeEventListener('abort', onAbort)
      if (err) reject(err)
      else resolve()
    }
    const onEntry = () => settle()
    const onAbort = () => settle(abort.signal.reason)
    archive.once('entry', onEntry)
    abort.signal.addEventListener('abort', onAbort, { once: true })
    archive.append(source, { name })
  })

  const used = new Set()
  const named = (name, n) => uniqueName(entryName(name, `file-${n}`), used)
  const note = (name, n, key, params) => add(Buffer.from(`${t(locale, key, params)}\n`, 'utf8'), named(`${name}.txt`, n))
  const stats = { written: 0, failed: 0, skipped: 0 }
  let room = limits.totalBytes
  let n = 0
  try {
    for (const entry of entries) {
      if (abort.signal.aborted) break
      n++
      if (entry.text !== undefined) {
        const body = Buffer.from(String(entry.text), 'utf8')
        if (body.length > room) { stats.skipped++; continue }
        room -= body.length
        await add(body, named(entry.name, n))
        stats.written++
        continue
      }

      let opened
      try {
        // A file whose size is not known up front may use what is left and no more.
        const opening = open(entry.url, { maxBytes: Math.min(limits.itemBytes, Math.max(1, room)), signal: abort.signal, timeoutMs: limits.itemTimeoutMs })
        // Storage that does not answer must not hold the work past its end either: whoever
        // stops it (the client leaving, the time budget) is heard here, and a file that
        // opens after all is closed again.
        opened = await Promise.race([opening, stopped])
          .catch((err) => { opening.then((late) => late && late.stream && late.stream.destroy(), () => {}); throw err })
      } catch (err) {
        if (abort.signal.aborted) break
        // Not there, not reachable, not allowed: the rest of the archive is still good.
        await note(`${entry.name}-failed`, n, 'zip.entry_failed', { url: entry.url })
        stats.failed++
        continue
      }
      const { stream, size } = opened
      // From here on somebody always listens: an error of this stream is never an uncaught one.
      stream.on('error', () => {})
      if (size !== null && size !== undefined && (size > room || size > limits.itemBytes)) {
        stream.destroy()
        await note(`${entry.name}-skipped`, n, 'zip.entry_skipped', { url: entry.url })
        stats.skipped++
        continue
      }
      // Counts what goes in. Running over the limit in the middle of an entry
      // (only possible when the size was not known) ends the whole archive.
      const counted = new Transform({
        transform(chunk, _enc, done) {
          room -= chunk.length
          done(room < 0 ? new Error('zip size limit') : null, chunk)
        },
      })
      // A stream that breaks off does not tell whoever it is piped into, and the archive reads this
      // one through a pipe of its own: it would wait for the rest for ever. So the end is said here.
      stream.once('error', (err) => counted.destroy(err))
      counted.once('error', (err) => stop(err))
      try {
        await add(stream.pipe(counted), named(`${entry.name}.${extOf(entry.url, entry.kind)}`, n))
        stats.written++
      } finally {
        // Whichever way this ended, nothing stays open: not a file handle, not a connection to the bucket.
        stream.destroy()
        counted.destroy()
      }
    }
  } catch (err) {
    stop(err)
  }

  let complete = false
  if (!abort.signal.aborted) {
    // Done when the last byte has been handed over - or when the client leaves while it is still being sent.
    complete = await new Promise((resolve) => {
      const onFinish = () => { abort.signal.removeEventListener('abort', onGone); resolve(true) }
      const onGone = () => { res.off('finish', onFinish); resolve(false) }
      res.once('finish', onFinish)
      abort.signal.addEventListener('abort', onGone, { once: true })
      archive.finalize().catch(stop)
    })
  }
  clearTimeout(timer)
  res.off('close', onClose)
  if (complete) return stats

  const why = abort.signal.reason && abort.signal.reason.message
  if (why !== 'client closed') console.error(`[${log}] archive cut short:`, why)
  // Cut, not ended: the client must not take what it got for the whole archive.
  archive.unpipe(res)
  res.destroy()
  archive.abort()
  return undefined
}

module.exports = { limits, streamZip, extOf, safeName, entryName, uniqueName, stamp, attachment }
