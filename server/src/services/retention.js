'use strict'

/**
 * Result retention. When the `retentionDays` setting is above zero, the files
 * of runs that finished longer ago than that are deleted from storage. The
 * run records themselves stay: they are the usage history.
 *
 * Off by default (0 = keep forever), because a canvas that still shows an old
 * result will show a broken image once its file is gone.
 *
 * A run is marked as cleaned (`filesPurged`) when its files are gone - not
 * when a storage that may hold them could not be asked. Such a run is left
 * for the next sweep. Should the storage stay away for GIVE_UP_DAYS past the
 * retention time, the run is marked anyway and the log says so: the record
 * then claims no files, and whatever is left in that storage has to be
 * removed there.
 */
const Run = require('../models/Run')
const settings = require('./settings')
const { getStorage, isUnavailable } = require('../storage')

const SWEEP_INTERVAL_MS = 6 * 3600 * 1000
/** Runs cleaned per sweep. */
const BATCH = 200
/** Runs looked at per sweep, so that runs waiting for a storage to come back cannot hold up the ones behind them. */
const LOOK_AT = 10 * BATCH
const GIVE_UP_DAYS = 30
const DAY_MS = 24 * 3600 * 1000

let timer = null

async function sweep() {
  const days = settings.get('retentionDays')
  if (!days) return 0
  const now = Date.now()
  const before = new Date(now - days * DAY_MS)
  const giveUpBefore = new Date(now - (days + GIVE_UP_DAYS) * DAY_MS)
  const storage = getStorage()
  const runs = await Run.find({
    status: 'succeeded',
    filesPurged: false,
    finishedAt: { $lt: before },
    'outputs.0': { $exists: true },
  }).select('outputs finishedAt').sort({ finishedAt: 1 }).limit(LOOK_AT).lean()

  let purged = 0
  let waiting = 0
  let givenUp = 0
  for (const run of runs) {
    if (purged >= BATCH) break
    let unreachable = false
    for (const o of run.outputs || []) {
      for (const key of [o.key, o.thumbKey]) {
        if (!key) continue
        try {
          await storage.delete(key)
        } catch (err) {
          // Could not be looked up or removed where it is: not the same as gone.
          if (isUnavailable(err)) unreachable = true
        }
      }
    }
    if (unreachable && run.finishedAt > giveUpBefore) { waiting++; continue }
    if (unreachable) givenUp++
    await Run.updateOne({ _id: run._id }, { $set: { filesPurged: true } }, { timestamps: false })
    purged++
  }
  if (waiting) console.warn(`[retention] ${waiting} expired run(s) keep their files for now: a storage that may hold them cannot be reached. They are tried again at the next sweep`)
  if (givenUp) console.error(`[retention] ${givenUp} run(s) marked as cleaned although a storage that may hold their files has not been reachable for ${GIVE_UP_DAYS} days: remove what is left there by hand`)
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
