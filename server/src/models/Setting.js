'use strict'

const mongoose = require('mongoose')

/** Key/value site settings (one set for the whole instance, managed by the owner). Keys and value shapes are defined in services/settings.js. */
const settingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, maxlength: 60 },
  value: { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: true, minimize: false })

module.exports = mongoose.model('Setting', settingSchema)
