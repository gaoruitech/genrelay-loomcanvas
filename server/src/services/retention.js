'use strict'

/**
 * Result retention. When the `retentionDays` setting is above zero, the files
 * of runs that finished longer ago than that are deleted from storage. The
 * run records themselves stay: they are the usage history.
 *
 * Off by default (0 = keep forever), because a canvas that still shows an old
 * result will show a broken image once its file is gone.
 */
const Run = require('../models/Run')
const settings = require('./settings')
const { getStorage } = require('../storage')

const SWEEP_INTERVAL_MS = 6 * 3600 * 1000
const BATCH = 200

let timer = null

async function sweep() {
  const days = settings.get('retentionDays')
  if (!days) return 0
  const before = new Date(Date.now() - days * 24 * 3600 * 1000)
  const storage = getStorage()
  const runs = await Run.find({
    status: 'succeeded',
    filesPurged: false,
    finishedAt: { $lt: before },
    'outputs.0': { $exists: true },
  }).select('outputs').limit(BATCH).lean()

  let purged = 0
  for (const run of runs) {
    for (const o of run.outputs || []) {
      for (const key of [o.key, o.thumbKey]) {
        if (key) await storage.delete(key).catch(() => {})
      }
    }
    await Run.updateOne({ _id: run._id }, { $set: { filesPurged: true } }, { timestamps: false })
    purged++
  }
  return purged
}

function start() {
  if (timer) return
  const tick = () => sweep()
    .then((n) => { if (n) console.log(`[retention] removed the files of ${n} expired run(s)`) })
    .catch((err) => console.error('[retention] sweep failed:', err.message))
  timer = setInterval(tick, SWEEP_INTERVAL_MS)
  timer.unref()
  setTimeout(tick, 60 * 1000).unref()
}

function stop() {
  if (timer) clearInterval(timer)
  timer = null
}

module.exports = { sweep, start, stop }
