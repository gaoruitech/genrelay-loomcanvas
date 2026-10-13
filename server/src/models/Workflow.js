'use strict'

const mongoose = require('mongoose')
const { CURRENT_SCHEMA_VERSION } = require('../utils/workflowSchema')

const { VISIBILITY } = require('../constants')
const { Mixed } = mongoose.Schema.Types

/** One canvas: the node graph plus its viewport and appearance settings. */
const workflowSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  // `userId` is the space the canvas belongs to: an account (its personal space) or a team.
  // `createdBy` is the account that made it; canvases from before teams have none and read as userId.
  createdBy: { type: String, default: '' },
  // Set when a team canvas passed to the team's owner because its creator left: who made it originally.
  inheritedFrom: { type: String, default: '' },
  // Team canvases only: who else in the team may see or edit it ('' in a personal space).
  visibility: { type: String, enum: ['', ...Object.values(VISIBILITY)], default: '' },
  // Counts content saves. A save names the revision it was made from (`baseRevision`); when the
  // canvas has moved on, the save is refused instead of overwriting somebody else's work.
  revision: { type: Number, default: 0 },
  // Counts changes to what is not content: the name and the old-layout flag. A rename does not
  // touch `revision`, so it never makes somebody's content save a conflict; an open editor
  // sees the new name because this number moved (it travels with every lock and save answer).
  metaRevision: { type: Number, default: 0 },
  lastEditedBy: { type: String, default: '' },
  lastEditedAt: { type: Date, default: null },
  // The edit lock of a team canvas: one editing session at a time. Free when empty or past expiresAt.
  lock: {
    by: { type: String, default: '' },
    // The editing session (a browser tab) that holds it: a random id the client makes up.
    // '' for a client that sends none - such clients share one implicit session per account.
    session: { type: String, default: '', maxlength: 64 },
    at: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    // Whom this lock was taken from, and how ('takeover' | 'expired'): what lets the former
    // holder be told why it lost the canvas. Empty when the canvas was free. On a FREE lock
    // (`by` empty) with prevHow 'released': the session that just gave it back, and `at` is when -
    // a save of that session still on its way is written without taking the lock again.
    prevBy: { type: String, default: '' },
    prevSession: { type: String, default: '' },
    prevHow: { type: String, default: '' },
  },
  name: { type: String, required: true, default: 'Untitled', maxlength: 80 },
  schemaVersion: { type: Number, default: CURRENT_SCHEMA_VERSION },
  // True while the node positions date from before schema version 2 and the editor has
  // not yet checked them against the current node sizes (see utils/workflowSchema.js).
  legacyLayout: { type: Boolean, default: false },

  // The brand kit of this canvas ('' = none): every generation node uses it unless the node
  // carries its own `data.brandKitOverride` (a kit id, or 'none').
  brandKitId: { type: String, default: '', maxlength: 24 },

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
  deletedAt: { type: Date, default: null },
  deletedBy: { type: String, default: '' },
}, { timestamps: true, minimize: false })

workflowSchema.index({ userId: 1, isDeleted: 1, createdAt: -1 })

module.exports = mongoose.model('Workflow', workflowSchema)
