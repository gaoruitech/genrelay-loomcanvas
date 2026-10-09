'use strict'

const mongoose = require('mongoose')
const { LOCAL_USER } = require('../constants')

/** Key/value site settings. Keys and value shapes are defined in services/settings.js. */
const settingSchema = new mongoose.Schema({
  userId: { type: String, default: LOCAL_USER, index: true },
  key: { type: String, required: true, unique: true, maxlength: 60 },
  value: { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: true, minimize: false })

module.exports = mongoose.model('Setting', settingSchema)
