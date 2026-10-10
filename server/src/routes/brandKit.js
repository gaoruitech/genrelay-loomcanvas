'use strict'

/** /api/brand-kits - reusable generation directions attached to nodes. Private to the account. */
const express = require('express')
const BrandKit = require('../models/BrandKit')
const { ok, wrap, badRequest, notFound } = require('../utils/http')
const { requireObjectId, isMediaUrl } = require('../utils/validate')

const router = express.Router()

const MAX_KITS = 50
const { MAX_REF_IMAGES } = BrandKit

function toDTO(k) {
  return {
    id: String(k._id),
    name: k.name,
    refImages: k.refImages || [],
    promptPrefix: k.promptPrefix || '',
    negativePrompt: k.negativePrompt || '',
    defaultRatio: k.defaultRatio || '',
    defaultModel: k.defaultModel || '',
    isDefault: !!k.isDefault,
    shared: false,
    mine: true,
    updatedAt: k.updatedAt,
  }
}

/** Only the writable fields, each with a hard length/count limit. */
function pickPayload(body) {
  const out = {}
  if (typeof body.name === 'string') out.name = body.name.trim().slice(0, 40)
  if (typeof body.promptPrefix === 'string') out.promptPrefix = body.promptPrefix.slice(0, 1000)
  if (typeof body.negativePrompt === 'string') out.negativePrompt = body.negativePrompt.slice(0, 500)
  if (typeof body.defaultRatio === 'string') out.defaultRatio = body.defaultRatio.slice(0, 20)
  if (typeof body.defaultModel === 'string') out.defaultModel = body.defaultModel.slice(0, 200)
  if (typeof body.isDefault === 'boolean') out.isDefault = body.isDefault
  if (Array.isArray(body.refImages)) {
    // URLs only: inline base64 would be copied into every node that uses the kit.
    out.refImages = body.refImages.filter(isMediaUrl).slice(0, MAX_REF_IMAGES)
  }
  return out
}

/** At most one default kit at a time. */
async function clearOtherDefaults(userId, keepId) {
  await BrandKit.updateMany(
    { userId, isDeleted: false, isDefault: true, _id: { $ne: keepId } },
    { $set: { isDefault: false } }
  )
}

async function findKit(req) {
  requireObjectId(req.params.id)
  const kit = await BrandKit.findOne({ _id: req.params.id, userId: req.userId, isDeleted: false })
  if (!kit) throw notFound('brandKit.not_found')
  return kit
}

router.get('/', wrap(async (req, res) => {
  const rows = await BrandKit.find({ userId: req.userId, isDeleted: false }).sort({ updatedAt: -1 }).limit(MAX_KITS * 2).lean()
  ok(res, rows.map(toDTO))
}))

router.post('/', wrap(async (req, res) => {
  const payload = pickPayload(req.body || {})
  if (!payload.name) throw badRequest('brandKit.name_required')
  if ((await BrandKit.countDocuments({ userId: req.userId, isDeleted: false })) >= MAX_KITS) {
    throw badRequest('brandKit.max', { max: MAX_KITS })
  }
  const kit = await BrandKit.create({ ...payload, userId: req.userId })
  if (kit.isDefault) await clearOtherDefaults(req.userId, kit._id)
  ok(res, toDTO(kit))
}))

router.put('/:id', wrap(async (req, res) => {
  const kit = await findKit(req)
  const payload = pickPayload(req.body || {})
  if (payload.name === '') throw badRequest('common.name_required')
  Object.assign(kit, payload)
  await kit.save()
  if (kit.isDefault) await clearOtherDefaults(req.userId, kit._id)
  ok(res, toDTO(kit))
}))

/**
 * Soft delete: nodes store the kit id, and a node pointing at a kit that the
 * list no longer returns simply falls back to "no kit".
 */
router.delete('/:id', wrap(async (req, res) => {
  const kit = await findKit(req)
  kit.isDeleted = true
  await kit.save()
  ok(res, { id: String(kit._id) })
}))

module.exports = router
