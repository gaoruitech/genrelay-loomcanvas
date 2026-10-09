'use strict'

const mongoose = require('mongoose')
const { LOCAL_USER } = require('../constants')

const { Mixed } = mongoose.Schema.Types

/**
 * Canvas template: a preset node graph dropped onto a canvas in one click.
 * Node ids inside `graph` are local to the template; the frontend assigns
 * fresh ids when applying it.
 */
const templateSchema = new mongoose.Schema({
  userId: { type: String, default: LOCAL_USER, index: true },
  key: { type: String, required: true, unique: true, maxlength: 60 },
  title: { type: String, required: true, maxlength: 80 },
  description: { type: String, default: '', maxlength: 500 },
  cover: { type: String, default: '' },
  order: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  builtin: { type: Boolean, default: false },
  graph: {
    nodes: { type: [Mixed], default: [] },
    edges: { type: [Mixed], default: [] },
    viewport: { type: Mixed, default: { x: 0, y: 0, zoom: 1 } },
    group: { type: Boolean, default: false },
  },
}, { timestamps: true, minimize: false })

module.exports = mongoose.model('Template', templateSchema)
