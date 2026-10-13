'use strict'

/** Helpers shared by the storage tests: a changed environment, and the settings collection in memory. */
const { resetConfig } = require('../../src/config')
const Setting = require('../../src/models/Setting')

/** Run fn with these environment variables (undefined removes one); fn may be async. */
function withEnv(vars, fn) {
  const before = {}
  for (const [k, v] of Object.entries(vars)) {
    before[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  resetConfig()
  const restore = () => {
    for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
    resetConfig()
  }
  let out
  try { out = fn() } catch (err) { restore(); throw err }
  if (out && typeof out.then === 'function') return out.finally(restore)
  restore()
  return out
}

/** The settings collection, in memory. */
function fakeSettings() {
  const rows = new Map()
  const original = { findOne: Setting.findOne, updateOne: Setting.updateOne }
  Setting.findOne = ({ key }) => ({ lean: async () => (rows.has(key) ? { key, value: structuredClone(rows.get(key)) } : null) })
  Setting.updateOne = async ({ key }, update) => { rows.set(key, structuredClone(update.$set.value)) }
  return { rows, restore: () => Object.assign(Setting, original) }
}

/** Collect what is written with console.warn / console.error / console.log while fn runs. */
async function capturingLog(fn) {
  const lines = []
  const original = { warn: console.warn, error: console.error, log: console.log }
  for (const level of Object.keys(original)) console[level] = (...args) => { lines.push(args.map(String).join(' ')) }
  try {
    await fn(lines)
  } finally {
    Object.assign(console, original)
  }
  return lines
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Resolves [result, how long fn took in ms]; a rejection is the result. */
async function timed(fn) {
  const started = Date.now()
  let out
  try { out = await fn() } catch (err) { out = err }
  return [out, Date.now() - started]
}

module.exports = { withEnv, fakeSettings, capturingLog, sleep, timed }
