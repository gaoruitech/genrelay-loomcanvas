'use strict'

/**
 * /api/brand-kits - reusable generation directions chosen per canvas. They
 * belong to the space: private to the account in a personal space; in a team
 * every member can choose one, and the owner and admins create and change them.
 */
const express = require('express')
const BrandKit = require('../models/BrandKit')
const Workflow = require('../models/Workflow')
const { ok, wrap, badRequest, notFound } = require('../utils/http')
const { requireObjectId, isMediaUrl } = require('../utils/validate')
const spaces = require('../services/spaces')
const permissions = require('../services/permissions')

const router = express.Router()

const MAX_KITS = 50
const { MAX_REF_IMAGES } = BrandKit

function toDTO(req, k, usedBy) {
  const team = spaces.isTeam(req)
  return {
    id: String(k._id),
    name: k.name,
    refImages: k.refImages || [],
    promptPrefix: k.promptPrefix || '',
    negativePrompt: k.negativePrompt || '',
    defaultRatio: k.defaultRatio || '',
    defaultModel: k.defaultModel || '',
    isDefault: !!k.isDefault,
    // In a team a kit is the team's: everybody uses it, managers change it.
    shared: team,
    mine: !team || permissions.creatorOf(k) === req.userId,
    canManage: permissions.can(req.space, 'brandkit:manage'),
    updatedAt: k.updatedAt,
    // In how many of the account's canvases it is in use (list only).
    ...(usedBy === undefined ? {} : { usedBy }),
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
    // URLs only, never inline base64.
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
  const kit = await BrandKit.findOne({ _id: req.params.id, userId: req.spaceId, isDeleted: false })
  if (!kit) throw notFound('brandKit.not_found')
  return kit
}

/**
 * kit id -> number of the space's canvases that use it, as the canvas's kit or as one
 * node's own exception. A canvas counts once per kit.
 */
async function usageByKit(userId, ids) {
  const counts = new Map()
  if (!ids.length) return counts
  const rows = await Workflow.find(
    { userId, isDeleted: false, $or: [{ brandKitId: { $in: ids } }, { 'nodes.data.brandKitOverride': { $in: ids } }] },
    { brandKitId: 1, 'nodes.data.brandKitOverride': 1 }
  ).lean()
  for (const wf of rows) {
    const used = new Set([wf.brandKitId, ...(wf.nodes || []).map((n) => n && n.data && n.data.brandKitOverride)])
    for (const id of used) if (typeof id === 'string' && id) counts.set(id, (counts.get(id) || 0) + 1)
  }
  return counts
}

router.get('/', wrap(async (req, res) => {
  const rows = await BrandKit.find({ userId: req.spaceId, isDeleted: false }).sort({ updatedAt: -1 }).limit(MAX_KITS * 2).lean()
  const usage = await usageByKit(req.spaceId, rows.map((k) => String(k._id)))
  ok(res, rows.map((k) => toDTO(req, k, usage.get(String(k._id)) || 0)))
}))

const manage = spaces.requireCan('brandkit:manage')

router.post('/', manage, wrap(async (req, res) => {
  const payload = pickPayload(req.body || {})
  if (!payload.name) throw badRequest('brandKit.name_required')
  if ((await BrandKit.countDocuments({ userId: req.spaceId, isDeleted: false })) >= MAX_KITS) {
    throw badRequest('brandKit.max', { max: MAX_KITS })
  }
  const kit = await BrandKit.create({ ...payload, userId: req.spaceId, createdBy: req.userId })
  if (kit.isDefault) await clearOtherDefaults(req.spaceId, kit._id)
  ok(res, toDTO(req, kit))
}))

router.put('/:id', manage, wrap(async (req, res) => {
  const kit = await findKit(req)
  const payload = pickPayload(req.body || {})
  if (payload.name === '') throw badRequest('common.name_required')
  Object.assign(kit, payload)
  await kit.save()
  if (kit.isDefault) await clearOtherDefaults(req.spaceId, kit._id)
  ok(res, toDTO(req, kit))
}))

/**
 * Soft delete: canvases and nodes store the kit id, and one pointing at a kit that the
 * list no longer returns simply runs without a kit.
 */
router.delete('/:id', manage, wrap(async (req, res) => {
  const kit = await findKit(req)
  kit.isDeleted = true
  await kit.save()
  ok(res, { id: String(kit._id) })
}))

module.exports = router
