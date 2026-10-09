'use strict'

const mongoose = require('mongoose')
const { LOCAL_USER } = require('../constants')

/**
 * Two asset collections share this file:
 *
 *  - UserAsset:   the user's own library ("我的资产") - product shots, brand
 *                 material, references and saved outputs. Fully editable.
 *  - CanvasAsset: a read-only, categorised library of stock material that an
 *                 operator may import. Empty on a fresh install.
 */

const USER_ASSET_KINDS = ['product', 'brand', 'reference', 'output']

const userAssetSchema = new mongoose.Schema({
  userId: { type: String, default: LOCAL_USER, index: true },
  kind: { type: String, enum: USER_ASSET_KINDS, default: 'product' },
  nodeType: { type: String, enum: ['IMAGE', 'VIDEO'], default: 'IMAGE' },

  name: { type: String, default: '', maxlength: 300 },
  folder: { type: String, default: '', maxlength: 120 },
  tags: { type: [String], default: [] },

  mediaUrl: { type: String, required: true },
  thumbnailUrl: { type: String, default: '' },
  width: { type: Number, default: 0 },
  height: { type: Number, default: 0 },
  aspectRatio: { type: String, default: '' },

  source: { type: String, enum: ['upload', 'generated'], default: 'upload' },
  fromFlowId: { type: String, default: '' },
  fromProduct: { type: String, default: '' },

  isDeleted: { type: Boolean, default: false },
}, { timestamps: true })

userAssetSchema.index({ userId: 1, kind: 1, isDeleted: 1, createdAt: -1 })

const canvasAssetSchema = new mongoose.Schema({
  userId: { type: String, default: LOCAL_USER, index: true },
  code: { type: String, default: '', index: true },
  categoryName: { type: String, default: '' },
  name: { type: String, default: '', maxlength: 300 },
  nodeType: { type: String, enum: ['IMAGE', 'VIDEO'], default: 'IMAGE' },
  mediaUrl: { type: String, default: '' },
  thumbnailUrl: { type: String, default: '' },
  width: { type: Number, default: 0 },
  height: { type: Number, default: 0 },
  aspectRatio: { type: String, default: '' },
  order: { type: Number, default: 0 },
  isPublished: { type: Boolean, default: true },
  isDeleted: { type: Boolean, default: false },
}, { timestamps: true })

canvasAssetSchema.index({ code: 1, isPublished: 1, isDeleted: 1, createdAt: -1 })

module.exports = {
  UserAsset: mongoose.model('UserAsset', userAssetSchema),
  CanvasAsset: mongoose.model('CanvasAsset', canvasAssetSchema),
  USER_ASSET_KINDS,
}
