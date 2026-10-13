'use strict'

const mongoose = require('mongoose')

/**
 * Three collections share this file:
 *
 *  - UserAsset:   one account's own library ("我的资产") - product shots, brand
 *                 material, references and saved outputs. Fully editable.
 *  - CanvasAsset: a read-only, categorised library of stock material that an
 *                 operator may import. Site-wide: every account sees it.
 *                 Empty on a fresh install.
 *  - UserAssetFolder: the folders of a UserAsset library that exist while empty.
 */

const USER_ASSET_KINDS = ['product', 'brand', 'reference', 'output']

const userAssetSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  kind: { type: String, enum: USER_ASSET_KINDS, default: 'product' },
  // The account that made it. `userId` is the SPACE it belongs to (an account's personal
  // space, or a team); rows from before teams have no createdBy and read as userId.
  createdBy: { type: String, default: '' },
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

/**
 * A folder of a space's library that exists by itself. A folder is first of
 * all the `folder` field of the assets in it - that is still how an asset says
 * where it is, and a folder nobody made by hand exists exactly as long as an
 * asset names it. A row here is what lets a folder exist while it is EMPTY:
 * one that was created before anything was put into it, or one whose assets
 * were moved out or deleted. It carries no assets and gives nobody anything.
 */
const userAssetFolderSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  name: { type: String, required: true, maxlength: 120 },
  createdBy: { type: String, default: '' },
}, { timestamps: true })

userAssetFolderSchema.index({ userId: 1, name: 1 }, { unique: true })

const canvasAssetSchema = new mongoose.Schema({
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
  UserAssetFolder: mongoose.model('UserAssetFolder', userAssetFolderSchema),
  USER_ASSET_KINDS,
}
