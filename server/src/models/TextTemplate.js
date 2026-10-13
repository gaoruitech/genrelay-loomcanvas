'use strict'

const mongoose = require('mongoose')
const { SYSTEM_USER } = require('../constants')

/** Preset prompt text that a text node can be filled with in one click. */
const textTemplateSchema = new mongoose.Schema({
  // Built-in snippets belong to the site; any other one is private to this account.
  userId: { type: String, default: SYSTEM_USER, index: true },
  key: { type: String, default: '' },
  // The account that made it. `userId` is the SPACE it belongs to (an account's personal
  // space, or a team); rows from before teams have no createdBy and read as userId.
  createdBy: { type: String, default: '' },
  title: { type: String, required: true, maxlength: 80 },
  content: { type: String, required: true, maxlength: 5000 },
  category: { type: String, default: '', maxlength: 40 },
  lang: { type: String, enum: ['zh', 'en'], default: 'zh', index: true },
  order: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  builtin: { type: Boolean, default: false },
}, { timestamps: true })

module.exports = mongoose.model('TextTemplate', textTemplateSchema)
