'use strict'

const mongoose = require('mongoose')
const { LOCAL_USER } = require('../constants')

const { Mixed } = mongoose.Schema.Types

/**
 * A read-only share link for a canvas.
 *
 * Publishing takes a snapshot: later edits to (or deletion of) the source
 * workflow do not change what the link shows. The link is addressed by a long
 * random token, can expire, and can be revoked.
 */
const shareSchema = new mongoose.Schema({
  userId: { type: String, default: LOCAL_USER, index: true },
  token: { type: String, required: true, unique: true },
  sourceWorkflowId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workflow', index: true },

  title: { type: String, required: true, default: 'Untitled', maxlength: 80 },
  description: { type: String, default: '', maxlength: 500 },

  snapshot: {
    nodes: { type: [Mixed], default: [] },
    edges: { type: [Mixed], default: [] },
    viewport: {
      x: { type: Number, default: 0 },
      y: { type: Number, default: 0 },
      zoom: { type: Number, default: 1 },
    },
    settings: { type: Mixed, default: {} },
  },

  thumbnail: { type: String, default: '' },
  thumbnailType: { type: String, enum: ['image', 'video', ''], default: '' },
  nodeCount: { type: Number, default: 0 },

  stats: {
    viewCount: { type: Number, default: 0 },
    copyCount: { type: Number, default: 0 },
  },

  // null = never expires
  expiresAt: { type: Date, default: null },
  revoked: { type: Boolean, default: false },
  isDeleted: { type: Boolean, default: false },
}, { timestamps: true, minimize: false })

shareSchema.index({ userId: 1, isDeleted: 1, createdAt: -1 })

module.exports = mongoose.model('Share', shareSchema)
