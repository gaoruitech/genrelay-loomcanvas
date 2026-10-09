'use strict'

const mongoose = require('mongoose')
const { LOCAL_USER } = require('../constants')

/** Preset prompt text that a text node can be filled with in one click. */
const textTemplateSchema = new mongoose.Schema({
  userId: { type: String, default: LOCAL_USER, index: true },
  key: { type: String, default: '' },
  title: { type: String, required: true, maxlength: 80 },
  content: { type: String, required: true, maxlength: 5000 },
  category: { type: String, default: '', maxlength: 40 },
  lang: { type: String, enum: ['zh', 'en'], default: 'zh', index: true },
  order: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  builtin: { type: Boolean, default: false },
}, { timestamps: true })

module.exports = mongoose.model('TextTemplate', textTemplateSchema)
