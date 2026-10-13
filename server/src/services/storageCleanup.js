'use strict'

/**
 * Removing the files of an account or a team that is being deleted, without
 * making the deletion wait for storage.
 *
 * Every backend is cleaned at the same time (storage.deleteUserFiles). The
 * caller waits a few seconds at most; a bucket that needs longer goes on in
 * the background, and one that cannot be reached is tried again later. So
 * that "later" survives a restart, what is still owed is written down first:
 * a journal in `settings` (key "storageCleanup") lists the owners whose files
 * may still be somewhere, and in which buckets. An entry goes when those
 * buckets have been cleaned, when they are no longer configured, or - with a
 * line in the log - after 30 days of trying.
 */
const Setting = require('../models/Setting')
const { getStorage } = require('../storage')

const SETTING_KEY = 'storageCleanup'
/**
 * How long the deletion of an account or a team waits for its files to go. A little more than
 * a bucket that is only read gets to answer (storage LOOKUP_MS), so that the answer normally
 * says where files are left rather than "still at it".
 */
const WAIT_MS = 4000
const RETRY_EVERY_MS = 10 * 60 * 1000
const FIRST_RETRY_MS = 60 * 1000
const GIVE_UP_MS = 30 * 24 * 3600 * 1000
const MAX_ENTRIES = 5000

let timer = null
let first = null
/** owner -> the promise of a cleaning that is still going on in the background. */
const inFlight = new Map()
/** Journal writes happen one after the other: each reads the list, changes it, writes it back. */
let queue = Promise.resolve()

async function readJournal() {
  const row = await Setting.findOne({ key: SETTING_KEY }).lean()
  const list = row && row.value && Array.isArray(row.value.owners) ? row.value.owners : []
  return list.filter((e) => e && typeof e.owner === 'string')
}

/** Change the journal: `change(list)` returns the new list. Never rejects - the journal is a safety net, not a gate. */
function writeJournal(change) {
  queue = queue.then(async () => {
    const before = await readJournal()
    const after = change(before).slice(-MAX_ENTRIES)
    if (JSON.stringify(after) !== JSON.stringify(before)) {
      await Setting.updateOne({ key: SETTING_KEY }, { $set: { value: { owners: after } } }, { upsert: true })
    }
  }).catch((err) => console.error(`[storage] the cleanup journal could not be written: ${err.message}`))
  return queue
}

const without = (list, owner) => list.filter((e) => e.owner !== owner)

/** After a round of cleaning: note what is still owed for `owner`, or strike it off. */
function settle(owner, since, outcome) {
  const left = [...outcome.failed, ...(outcome.pending || [])]
  if (!left.length) return writeJournal((list) => without(list, owner))
  return writeJournal((list) => [...without(list, owner), { owner, since, backends: left.map((b) => b.id) }])
}

const describe = (items) => items.map((b) => (b.reason ? `${b.label} (${b.reason})` : b.label)).join(', ')

/**
 * Remove the files of an account or a team. Resolves within about `waitMs`:
 *   removed  how many files went so far
 *   error    '' when everything is gone; otherwise a line for the log saying where files
 *            are left. Those are removed in the background (see above), not by hand.
 * `timeoutMs`: how long a bucket gets to answer one request (its own default otherwise).
 */
async function removeOwnerFiles(ownerId, { waitMs = WAIT_MS, timeoutMs = 0 } = {}) {
  const owner = String(ownerId)
  const storage = getStorage()
  const since = new Date().toISOString()
  // With buckets in play the debt is written down before the work starts: the process may not live to see it end.
  const ahead = storage.buckets().length > 0
  if (ahead) await writeJournal((list) => [...without(list, owner), { owner, since, backends: null }])
  const outcome = await storage.deleteUserFiles(owner, { waitMs, timeoutMs })
  const left = [...outcome.failed, ...outcome.pending]
  if (left.length || ahead) await settle(owner, since, outcome)
  if (outcome.pending.length) {
    // Still at it: the journal is settled again when the last backend is done.
    const rest = outcome.settled.then((final) => {
      if (final.failed.length) console.warn(`[storage] files of ${owner} are left in ${describe(final.failed)}; trying again every ${RETRY_EVERY_MS / 60000} minutes`)
      return settle(owner, since, final)
    }).finally(() => inFlight.delete(owner))
    inFlight.set(owner, rest)
  }
  if (!left.length) return { removed: outcome.removed, error: '' }
  const parts = []
  if (outcome.failed.length) parts.push(`left in ${describe(outcome.failed)}, tried again in the background`)
  if (outcome.pending.length) parts.push(`still being removed from ${describe(outcome.pending)}`)
  return { removed: outcome.removed, error: parts.join('; ') }
}

/**
 * Go through the journal once: clean what can be cleaned now. Resolves
 * { owners, removed, left } - how many owners were tried, how many files went,
 * how many owners are still owed.
 */
async function retry({ now = Date.now() } = {}) {
  await queue
  const storage = getStorage()
  const configured = new Set(storage.buckets().map((b) => b.id))
  configured.add('local')
  let removed = 0
  let left = 0
  const entries = await readJournal()
  for (const entry of entries) {
    if (!/^[0-9a-f]{24}$/.test(entry.owner)) { await writeJournal((list) => without(list, entry.owner)); continue }
    // Being cleaned right now by the deletion that wrote the entry: not twice at the same time.
    if (inFlight.has(entry.owner)) { left++; continue }
    const only = Array.isArray(entry.backends) ? entry.backends.filter((id) => configured.has(id)) : null
    // The buckets that were owed are not configured any more: nothing is left to ask.
    if (only && !only.length) { await writeJournal((list) => without(list, entry.owner)); continue }
    const outcome = await storage.deleteUserFiles(entry.owner, only ? { only } : {})
    removed += outcome.removed
    if (!outcome.failed.length) {
      console.log(`[storage] removed the remaining files of ${entry.owner} (${outcome.removed} file(s))`)
      await settle(entry.owner, entry.since, outcome)
    } else if (now - Date.parse(entry.since) > GIVE_UP_MS) {
      console.error(`[storage] giving up on the files of ${entry.owner} after 30 days: still left in ${describe(outcome.failed)}. Remove them from there by hand (key prefixes: <uploads|outputs|tools|thumbs/of/...>/${entry.owner}/)`)
      await writeJournal((list) => without(list, entry.owner))
    } else {
      left++
      await settle(entry.owner, entry.since, outcome)
    }
  }
  return { owners: entries.length, removed, left }
}

/** How many owners still have files somewhere (for the status page and for tests). */
async function owed() {
  await queue
  return (await readJournal()).length
}

/** Resolves when no cleaning is going on in the background and the journal is written (tests, shutdown). */
async function idle() {
  while (inFlight.size) await Promise.all([...inFlight.values()])
  await queue
}

function start() {
  if (timer) return
  const tick = () => retry().catch((err) => console.error(`[storage] cleanup retry failed: ${err.message}`))
  timer = setInterval(tick, RETRY_EVERY_MS)
  timer.unref()
  first = setTimeout(tick, FIRST_RETRY_MS)
  first.unref()
}

function stop() {
  if (timer) clearInterval(timer)
  if (first) clearTimeout(first)
  timer = null
  first = null
}

module.exports = { removeOwnerFiles, retry, owed, idle, start, stop, SETTING_KEY, WAIT_MS }
