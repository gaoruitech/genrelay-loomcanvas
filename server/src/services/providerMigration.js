'use strict'

/**
 * One-time upgrade of stored providers to the vendor model (schemaVersion 3).
 *
 * Before, a provider had a "type" that was really an API format, its models
 * were typed into free-text fields (or fetched from the upstream), and their
 * kind was guessed from their names. Now a provider belongs to a vendor, the
 * vendor's models come from its catalog, and anything else is a custom model
 * whose kind was chosen by a person.
 *
 * For every provider older than version 2, exactly once:
 *
 *  1. type "openai-compatible" becomes "openai". The slug - and with it every
 *     model id on canvases and in usage records - stays as it was.
 *  2. Models typed into the old fields become custom models:
 *       openai  `models` -> chat, `imageModels` -> image (both were explicit)
 *       gemini  `models` -> the old name rule, applied here for the last time
 *               (a name containing "image" or "banana" was an image model,
 *               anything else a chat model). This is the only place left
 *               that reads a kind off a name; it runs on old data only.
 *  3. Where the old code fetched the list from the upstream instead (gaorui
 *     chat models; openai / gemini with the fields left empty) there is no
 *     stored list to carry over. The models that were actually in use are
 *     recovered from what is recorded: the kind of each past run, and the
 *     kind of the canvas node a model is selected on. Both are facts.
 *  4. A model the vendor's catalog already lists needs no custom entry and is
 *     skipped; so is a kind the vendor cannot take as a custom model.
 *  5. The old fields are removed, and the misspelt brand name that earlier
 *     versions put into a provider's default name is corrected.
 *
 *  6. A 高瑞 provider still carrying the old default name ("高瑞 API", or
 *     "Gaorui API" where it was added in English) is renamed to today's
 *     default, the vendor's own name. A name the user chose is left alone.
 *
 * A provider at version 2 was written by a build that had done steps 1-5 and
 * still used the old default name: for it only step 6 runs (version 2 -> 3).
 * After that nothing here touches the provider again, so naming one
 * "高瑞 API" on purpose later is respected.
 *
 * Keys, addresses, the enabled flag, order and model overrides are not touched.
 */
const Provider = require('../models/Provider')
const Run = require('../models/Run')
const Workflow = require('../models/Workflow')
const registry = require('../providers')
const { MODEL_NAME } = require('../providers/catalog')

const CURRENT = 3
const RENAMED_TYPES = { 'openai-compatible': 'openai' }
const MAX_CUSTOM = 100
// Earlier versions wrote the brand with the wrong second character. Escapes,
// so that the wrong spelling appears nowhere in the repository.
const OLD_BRAND = '\u9ad8\u777f'
const BRAND = '\u9ad8\u745e'
// Default names earlier versions gave a \u9ad8\u745e provider -> today's default.
const OLD_DEFAULT_NAMES = { [`${BRAND} API`]: BRAND, 'Gaorui API': 'Gaorui' }

/** The provider's name after the upgrade, or undefined when it stays as it is. */
function newName(type, name) {
  if (typeof name !== 'string') return undefined
  let out = name.includes(OLD_BRAND) ? name.split(OLD_BRAND).join(BRAND) : name
  if (type === 'gaorui' && Object.prototype.hasOwnProperty.call(OLD_DEFAULT_NAMES, out)) out = OLD_DEFAULT_NAMES[out]
  return out === name ? undefined : out
}

/** "a, b\nc" -> ['a','b','c'], de-duplicated. The format of the old free-text fields. */
function parseModelList(text) {
  const seen = new Set()
  for (const part of String(text || '').split(/[\s,，;；]+/)) {
    const id = part.trim()
    if (id && MODEL_NAME.test(id)) seen.add(id)
    if (seen.size >= 200) break
  }
  return [...seen]
}

/** The retired Gemini name rule. Do not call this from anywhere else. */
const legacyGeminiKind = (id) => (/image|banana/i.test(id) ? 'image' : 'chat')

// Which kind of model each canvas node selects.
const NODE_KIND = {
  'image-gen': 'image',
  'image-edit': 'image',
  'video-gen': 'video',
  'video-edit': 'video',
  llm: 'chat',
  'video-analysis': 'chat',
}

/** Models typed into the old form fields, as [{ id, kind }]. */
function typedModels(type, options) {
  const o = options && typeof options === 'object' ? options : {}
  if (type === 'openai') {
    const image = parseModelList(o.imageModels)
    const imageSet = new Set(image)
    return [
      ...image.map((id) => ({ id, kind: 'image' })),
      ...parseModelList(o.models).filter((id) => !imageSet.has(id)).map((id) => ({ id, kind: 'chat' })),
    ]
  }
  if (type === 'gemini') return parseModelList(o.models).map((id) => ({ id, kind: legacyGeminiKind(id) }))
  return []
}

/** Models of this provider that runs and canvases refer to, with the kind recorded there. */
async function usedModels(doc) {
  const prefix = `${doc.slug}:`
  const out = []
  const runs = await Run.aggregate([
    { $match: { providerId: doc._id } },
    { $group: { _id: { model: '$upstreamModel', kind: '$kind' }, last: { $max: '$createdAt' } } },
    { $sort: { last: 1 } },
  ])
  for (const r of runs) {
    if (typeof r._id.model === 'string' && r._id.model) out.push({ id: r._id.model, kind: r._id.kind })
  }
  // Slugs are per account: only this account's canvases refer to this provider.
  const flows = await Workflow.find({ userId: doc.userId, isDeleted: { $ne: true }, 'nodes.data.model': { $regex: `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` } })
    .select('nodes.type nodes.data.model').sort({ createdAt: 1 }).lean()
  for (const flow of flows) {
    for (const node of Array.isArray(flow.nodes) ? flow.nodes : []) {
      const model = node && node.data && node.data.model
      const kind = node && NODE_KIND[node.type]
      if (kind && typeof model === 'string' && model.startsWith(prefix)) out.push({ id: model.slice(prefix.length), kind })
    }
  }
  return out
}

/**
 * The new shape of one stored provider. Pure apart from `used`, which the
 * caller looks up; exported for tests.
 * @param {object} doc    raw document
 * @param {Array}  used   [{ id, kind }] from usedModels()
 */
function plan(doc, used) {
  const type = RENAMED_TYPES[doc.type] || doc.type
  const plugin = registry.getType(type)
  const name = newName(type, doc.name)
  // Version 2 already has its models in the new shape: only the name is left to do.
  if (doc.schemaVersion === 2) {
    return { set: name === undefined ? { schemaVersion: CURRENT } : { schemaVersion: CURRENT, name }, customModels: null }
  }
  const set = { type, schemaVersion: CURRENT }
  if (name !== undefined) set.name = name
  if (!plugin) return { set, customModels: null }

  const typed = typedModels(type, doc.options)
  // History stands in for a list only where the old code had none stored.
  const candidates = [...(Array.isArray(doc.customModels) ? doc.customModels : []), ...(typed.length ? typed : used)]
  const customModels = []
  const taken = new Set(plugin.catalog.map((m) => m.id))
  for (const c of candidates) {
    if (!c || typeof c.id !== 'string' || !MODEL_NAME.test(c.id) || taken.has(c.id)) continue
    if (!plugin.customKinds.includes(c.kind)) continue
    if (customModels.length >= MAX_CUSTOM) break
    taken.add(c.id)
    customModels.push({ id: c.id, kind: c.kind, label: typeof c.label === 'string' ? c.label : '' })
  }
  return { set, customModels }
}

/** Bring every stored provider to the current shape. Safe to run on every start. */
async function migrateProviders() {
  const docs = await Provider.collection.find({ schemaVersion: { $ne: CURRENT } }).toArray()
  let custom = 0
  for (const doc of docs) {
    const { set, customModels } = plan(doc, doc.schemaVersion === 2 ? [] : await usedModels(doc))
    if (customModels) {
      set.customModels = customModels
      custom += customModels.length
    }
    await Provider.collection.updateOne({ _id: doc._id }, { $set: set, $unset: { options: '' } })
  }
  return { providers: docs.length, customModels: custom }
}

/**
 * A catalog grows between versions. When it gains a model that a provider
 * already has as a custom model (same name), the catalog entry is the one
 * served - see rawSpecsFor() in providers/index.js - and the custom row is
 * dead weight that would still show up in the settings page. Remove such rows.
 *
 * Only the row goes. The model id is unchanged, so its override (enabled,
 * order, display name, price), the canvases that select it and its usage
 * records all keep working, now against the catalog entry.
 *
 * Safe to run on every start; returns how many rows were removed.
 */
async function dropShadowedCustomModels() {
  const docs = await Provider.collection.find({ 'customModels.0': { $exists: true } }).project({ type: 1, customModels: 1 }).toArray()
  let dropped = 0
  for (const doc of docs) {
    const plugin = registry.getType(doc.type)
    if (!plugin || !Array.isArray(doc.customModels)) continue
    const inCatalog = new Set(plugin.catalog.map((m) => m.id))
    const kept = doc.customModels.filter((c) => !(c && inCatalog.has(c.id)))
    if (kept.length === doc.customModels.length) continue
    await Provider.collection.updateOne({ _id: doc._id }, { $set: { customModels: kept } })
    dropped += doc.customModels.length - kept.length
  }
  return dropped
}

module.exports = { migrateProviders, dropShadowedCustomModels, plan, parseModelList, CURRENT, MAX_CUSTOM }
