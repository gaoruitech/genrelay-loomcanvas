'use strict'

/**
 * Vendor catalogs: the models each vendor supports, stated by hand.
 *
 * A catalog file is `{ "image": [...], "video": [...], "chat": [...] }`. The
 * section an entry sits in IS its kind; nothing about a model is ever derived
 * from its name. All three sections must be present, so "this vendor has no
 * models of that kind" is written down as an empty list rather than implied.
 *
 * An entry:
 *   id                  upstream model name, sent as-is
 *   label               display name
 *   acceptsImage        takes reference images
 *   maxReferenceImages  how many (0 when acceptsImage is false)
 *   acceptsVideo        takes a video (chat: to read; video: as the source)
 *   videoEdit           video section only: a "video edit" model
 *   options             { aspectRatios?, resolutions?, durations?, counts?, imgModes? }
 *   defaults            { aspectRatio?, resolution?, duration?, count?, imgMode? }
 *   verified            optional "YYYY-MM-DD": the day this model completed a
 *                       real text-to-image / text-to-video / chat run against
 *                       the vendor's service, made by the project. Absent = the
 *                       entry follows the vendor's documentation and was not run.
 *   _anything           private to the vendor module, never served
 *
 * Where each OpenAI / Gemini entry comes from is recorded in SOURCES.md.
 */
const KINDS = ['image', 'video', 'chat']
// Also the rule for a custom model's name (see routes/admin.js).
const MODEL_NAME = /^[\w.:/@-]{1,120}$/

const ENTRY_KEYS = new Set(['id', 'label', 'acceptsImage', 'acceptsVideo', 'videoEdit', 'maxReferenceImages', 'options', 'defaults', 'verified'])
const OPTION_LISTS = { aspectRatios: 'string', resolutions: 'string', durations: 'number', counts: 'number', imgModes: 'string' }
// defaults key -> the options list its value has to come from
const DEFAULT_OF = { aspectRatio: 'aspectRatios', resolution: 'resolutions', duration: 'durations', imgMode: 'imgModes' }

/** A real calendar day written as YYYY-MM-DD. */
function isDay(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Check a catalog and return its entries as one flat list, each with `kind`.
 * Throws on the first problem: a broken catalog must stop the process at
 * start-up, not surface later as a model that half works.
 */
function validateCatalog(vendor, data) {
  const fail = (why) => { throw new Error(`catalog "${vendor}": ${why}`) }
  if (!isObject(data)) fail('must be an object with image, video and chat sections')
  for (const key of Object.keys(data)) if (!KINDS.includes(key)) fail(`unknown section "${key}"`)
  const out = []
  const seen = new Set()
  for (const kind of KINDS) {
    if (!Array.isArray(data[kind])) fail(`section "${kind}" is missing (use [] for none)`)
    for (const entry of data[kind]) {
      if (!isObject(entry)) fail(`${kind}: every entry must be an object`)
      const at = `${kind} "${entry.id}"`
      if (typeof entry.id !== 'string' || !MODEL_NAME.test(entry.id)) fail(`${kind}: bad model id ${JSON.stringify(entry.id)}`)
      if (seen.has(entry.id)) fail(`${at} is listed twice`)
      seen.add(entry.id)
      for (const key of Object.keys(entry)) {
        if (key === 'kind') fail(`${at}: the section decides the kind, remove "kind"`)
        if (!ENTRY_KEYS.has(key) && !key.startsWith('_')) fail(`${at}: unknown field "${key}"`)
      }
      if (typeof entry.label !== 'string' || !entry.label.trim()) fail(`${at}: label is required`)
      for (const flag of ['acceptsImage', 'acceptsVideo', 'videoEdit']) {
        if (typeof entry[flag] !== 'boolean') fail(`${at}: ${flag} must be true or false`)
      }
      if (!Number.isInteger(entry.maxReferenceImages) || entry.maxReferenceImages < 0) fail(`${at}: maxReferenceImages must be an integer >= 0`)
      if (entry.acceptsImage !== (entry.maxReferenceImages > 0)) fail(`${at}: acceptsImage and maxReferenceImages disagree`)
      if (entry.videoEdit && (kind !== 'video' || !entry.acceptsVideo)) fail(`${at}: videoEdit needs a video model that accepts a video`)
      if (!isObject(entry.options)) fail(`${at}: options must be an object`)
      for (const [name, list] of Object.entries(entry.options)) {
        const type = OPTION_LISTS[name]
        if (!type) fail(`${at}: unknown option "${name}"`)
        if (!Array.isArray(list) || !list.length || list.some((v) => typeof v !== type)) fail(`${at}: options.${name} must be a non-empty list of ${type}s`)
        if (new Set(list).size !== list.length) fail(`${at}: options.${name} has duplicates`)
      }
      if (!isObject(entry.defaults)) fail(`${at}: defaults must be an object`)
      for (const [name, value] of Object.entries(entry.defaults)) {
        if (name === 'count') {
          if (!Number.isInteger(value) || value < 1) fail(`${at}: defaults.count must be a positive integer`)
          if (entry.options.counts && !entry.options.counts.includes(value)) fail(`${at}: defaults.count is not one of options.counts`)
          continue
        }
        const list = entry.options[DEFAULT_OF[name]]
        if (!DEFAULT_OF[name]) fail(`${at}: unknown default "${name}"`)
        if (!list || !list.includes(value)) fail(`${at}: defaults.${name} is not one of options.${DEFAULT_OF[name]}`)
      }
      if (entry.verified !== undefined && !isDay(entry.verified)) fail(`${at}: verified must be a date written as YYYY-MM-DD`)
      out.push({ ...entry, kind })
    }
  }
  return out
}

function loadCatalog(vendor) {
  return validateCatalog(vendor, require(`./${vendor}.json`))
}

module.exports = { KINDS, MODEL_NAME, validateCatalog, loadCatalog }
