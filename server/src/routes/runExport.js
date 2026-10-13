'use strict'

/**
 * Taking results out of the history: several records as ONE zip.
 *
 *   POST /api/runs/download-zip { ids: [<record id>], urls?: [<address>], name? }
 *
 * What goes into the archive always comes from the stored records - the files
 * of image and video runs, the text answers of chat runs - and only from
 * records the caller may read in the space the request acts in: all of them in
 * a personal space and for whoever has `usage:view_all` in a team, their own
 * for every other team member (the rule of the record list, routes/admin.js).
 * `urls` only narrows the files down, so no request can make the server fetch
 * an address that is not already a result of one of those runs.
 */
const express = require('express')
const Run = require('../models/Run')
const admin = require('./admin')
const zip = require('../services/zipExport')
const { wrap, badRequest, notFound, ApiError } = require('../utils/http')
const { isObjectId } = require('../utils/validate')
const { RUN_STATUS } = require('../constants')

const router = express.Router()

/** How many records one archive may be asked for. What ends up in it is capped by zip.limits. */
const MAX_RECORDS = 100
/** `urls` only narrows the files of those records down: more addresses than they could ever hold is not a selection. */
const MAX_URLS = 2000
/**
 * How many archives one account may have being written at the same moment. An archive is cheap
 * for the server (nothing is compressed, one file open at a time) but can take minutes; a
 * button pressed again and again, or a script, should not be able to stack them up.
 */
const limits = { perAccount: 3 }
const inFlight = new Map()

/** The model part of "<provider slug>:<upstream model>", as a piece of a file name. */
function modelPart(run) {
  const id = String(run.modelId || '')
  const name = id.includes(':') ? id.slice(id.indexOf(':') + 1) : id
  return name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || run.kind || 'run'
}

/**
 * The entries of the archive for a list of runs, in the order given:
 * `<nn>-<model>-<yyyymmdd-hhmmss>[-<k>]` - numbered so the order of the
 * selection survives, dated (UTC) so a file still says when it was made once
 * it has left the archive.
 */
function entriesFor(runs, wanted) {
  const entries = []
  const seen = new Set()
  const pad = String(runs.length).length < 2 ? 2 : String(runs.length).length
  runs.forEach((run, index) => {
    const base = `${String(index + 1).padStart(pad, '0')}-${modelPart(run)}-${zip.stamp(run.createdAt)}`
    if (run.kind === 'chat') {
      // A text answer is a result like any other. `urls` is about files and does not filter it out
      // unless it is given, in which case only files were asked for.
      if (!wanted && run.text) entries.push({ name: `${base}.txt`, text: run.text })
      return
    }
    const outputs = (run.outputs || []).filter((o) => o && o.url && !seen.has(o.url) && (!wanted || wanted.has(o.url)))
    outputs.forEach((o, k) => {
      seen.add(o.url)
      entries.push({ name: outputs.length > 1 ? `${base}-${k + 1}` : base, url: o.url, kind: o.type })
    })
  })
  return entries
}

router.post('/runs/download-zip', wrap(async (req, res) => {
  const body = req.body || {}
  if (!Array.isArray(body.ids)) throw badRequest('validation.array', { field: 'ids' })
  if (body.ids.length > MAX_RECORDS) throw badRequest('validation.max_items', { field: 'ids', max: MAX_RECORDS })
  if (body.urls !== undefined && body.urls !== null && !Array.isArray(body.urls)) throw badRequest('validation.array', { field: 'urls' })
  if (Array.isArray(body.urls) && body.urls.length > MAX_URLS) throw badRequest('validation.max_items', { field: 'urls', max: MAX_URLS })
  const ids = [...new Set(body.ids.filter(isObjectId).map((id) => String(id).toLowerCase()))]
  if (!ids.length) throw badRequest('validation.required', { field: 'ids' })
  const wanted = Array.isArray(body.urls) && body.urls.length ? new Set(body.urls.filter((u) => typeof u === 'string')) : null

  // Only finished work: a run that failed or was canceled has nothing to take, one still running not yet.
  const found = await Run.find({ _id: { $in: ids }, ...admin.readableRecords(req), status: RUN_STATUS.SUCCEEDED })
    .select('kind modelId outputs text createdAt')
    .lean()
  const byId = new Map(found.map((r) => [String(r._id), r]))
  // The order the caller selected them in; ids that are not theirs to read are simply not there.
  const runs = ids.filter((id) => byId.has(id)).map((id) => byId.get(id))
  const entries = entriesFor(runs, wanted)
  if (!entries.length) throw notFound('run.nothing_to_download')
  if (entries.length > zip.limits.items) throw badRequest('run.zip_max', { max: zip.limits.items, count: entries.length })

  const wantedName = typeof body.name === 'string' ? zip.safeName(body.name.replace(/\.zip$/i, '')) : ''
  const filename = `${wantedName || `history-${zip.stamp(new Date())}`}.zip`

  // The last refusal: from here on the answer is the archive itself.
  const account = String(req.userId)
  const busy = inFlight.get(account) || 0
  if (busy >= limits.perAccount) throw new ApiError(429, 'run.zip_busy', { max: limits.perAccount })
  inFlight.set(account, busy + 1)
  try {
    await zip.streamZip(res, entries, { filename, locale: req.locale, log: 'runs/download-zip' })
  } finally {
    const left = (inFlight.get(account) || 1) - 1
    if (left > 0) inFlight.set(account, left)
    else inFlight.delete(account)
  }
}))

module.exports = router
module.exports.MAX_RECORDS = MAX_RECORDS
module.exports.limits = limits
module.exports.inFlight = inFlight
module.exports.entriesFor = entriesFor
