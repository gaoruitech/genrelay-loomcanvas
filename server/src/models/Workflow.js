'use strict'

const mongoose = require('mongoose')
const { CURRENT_SCHEMA_VERSION } = require('../utils/workflowSchema')

const { Mixed } = mongoose.Schema.Types

/** One canvas: the node graph plus its viewport and appearance settings. */
const workflowSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  name: { type: String, required: true, default: 'Untitled', maxlength: 80 },
  schemaVersion: { type: Number, default: CURRENT_SCHEMA_VERSION },
  // True while the node positions date from before schema version 2 and the editor has
  // not yet checked them against the current node sizes (see utils/workflowSchema.js).
  legacyLayout: { type: Boolean, default: false },

  nodes: { type: [Mixed], default: [] },
  edges: { type: [Mixed], default: [] },
  viewport: {
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 },
    zoom: { type: Number, default: 1 },
  },
  // Canvas-level appearance (background colour/pattern...). Shape owned by the frontend.
  settings: { type: Mixed, default: {} },

  // Cover for the list card, derived from the nodes on every save.
  thumbnail: { type: String, default: '' },
  thumbnailType: { type: String, enum: ['image', 'video', ''], default: '' },

  isDeleted: { type: Boolean, default: false },
}, { timestamps: true, minimize: false })

workflowSchema.index({ userId: 1, isDeleted: 1, createdAt: -1 })

module.exports = mongoose.model('Workflow', workflowSchema)
