'use strict'

const mongoose = require('mongoose')
const { LOCAL_USER, RUN_STATUS, RUN_KINDS } = require('../constants')

const { Mixed } = mongoose.Schema.Types

const outputSchema = new mongoose.Schema({
  type: { type: String, enum: ['image', 'video', 'audio'], required: true },
  url: { type: String, required: true },
  thumbnailUrl: { type: String, default: '' },
  // Storage keys, kept so retention cleanup can delete the files.
  key: { type: String, default: '' },
  thumbKey: { type: String, default: '' },
  width: { type: Number, default: 0 },
  height: { type: Number, default: 0 },
}, { _id: false })

/**
 * One execution of a model: an image/video generation or a chat completion.
 * This is both the job record the runner works from and the usage ledger.
 */
const runSchema = new mongoose.Schema({
  userId: { type: String, default: LOCAL_USER, index: true },
  kind: { type: String, enum: RUN_KINDS, required: true },
  status: { type: String, enum: Object.values(RUN_STATUS), default: RUN_STATUS.QUEUED, index: true },
  progress: { type: Number, default: 0, min: 0, max: 100 },

  // "<provider slug>:<upstream model>", the public ModelSpec id.
  modelId: { type: String, required: true, index: true },
  modelLabel: { type: String, default: '' },
  providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Provider', required: true },
  providerType: { type: String, default: '' },
  upstreamModel: { type: String, required: true },

  prompt: { type: String, default: '' },
  systemPrompt: { type: String, default: '' },
  imageUrls: { type: [String], default: [] },
  videoUrls: { type: [String], default: [] },
  params: { type: Mixed, default: {} },
  count: { type: Number, default: 1 },

  // Attribution only; not foreign keys.
  workflowId: { type: String, default: '', index: true },
  nodeId: { type: String, default: '' },

  // Task id at the upstream once submitted. Present = safe to keep polling after a restart.
  externalId: { type: String, default: '' },
  submittedAt: { type: Date, default: null },
  startedAt: { type: Date, default: null },
  finishedAt: { type: Date, default: null },

  outputs: { type: [outputSchema], default: [] },
  text: { type: String, default: '' },
  // User-facing failure reason. Never contains credentials or stack traces.
  // Stored as a catalog message (errorCode + errorParams, see ../i18n) and rendered in
  // the reader's language; `error` is its text in the fallback language, which is
  // all that records from before the catalog have.
  error: { type: String, default: '' },
  errorCode: { type: String, default: '' },
  errorParams: { type: Mixed, default: {} },

  // Estimated at submit time from the ModelSpec pricing (plus overrides).
  cost: {
    amount: { type: Number, default: 0 },
    currency: { type: String, default: '' },
    unknown: { type: Boolean, default: true },
  },
  usage: { type: Mixed, default: null },

  // True once billing.beforeRun allowed the run, so a re-queued run is not charged twice.
  billingStarted: { type: Boolean, default: false },
  filesPurged: { type: Boolean, default: false },
}, { timestamps: true, minimize: false })

runSchema.index({ userId: 1, createdAt: -1 })
runSchema.index({ status: 1, createdAt: 1 })

module.exports = mongoose.model('Run', runSchema)
