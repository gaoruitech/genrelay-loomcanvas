'use strict'

const mongoose = require('mongoose')
const { LOCAL_USER } = require('../constants')
const { CURRENT_SCHEMA_VERSION } = require('../utils/workflowSchema')

const { Mixed } = mongoose.Schema.Types

/** One canvas: the node graph plus its viewport and appearance settings. */
const workflowSchema = new mongoose.Schema({
  userId: { type: String, default: LOCAL_USER, index: true },
  name: { type: String, required: true, default: 'Untitled', maxlength: 80 },
  schemaVersion: { type: Number, default: CURRENT_SCHEMA_VERSION },

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
